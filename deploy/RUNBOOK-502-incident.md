# 502 Bad Gateway Incident Runbook
## SOC Platform — Cloudflare Tunnel → Nginx → FastAPI Stack

> **Copy this to your SRE channel when a 502 is reported.**

---

## Step 1 — Verify container status (30 seconds)

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "soc-|NAMES"
```

**Expected:** All four containers show `Up ... (healthy)`:
- `soc-cloudflared-edge`
- `soc-nginx-proxy`
- `soc-python-ai-backend`
- `soc-go-ingest-core`

**If any show `Unhealthy` or `Restarting`:**
```bash
docker logs --tail 50 <container-name>
```

---

## Step 2 — Curl origin directly from Docker host (30 seconds)

```bash
# Test Nginx is responding on the host-bound port
curl -sv http://localhost/health

# Expected: HTTP 200  {"status": "healthy"}
```

If this fails → Nginx is down. Skip to Step 5 (restart).

---

## Step 3 — Curl origin from INSIDE the cloudflared container (60 seconds)

This confirms Docker network name resolution works between `public-ingress` members.

```bash
docker exec -it soc-cloudflared-edge sh
# Inside the container:
curl -sv http://soc-nginx-proxy:80/health
exit
```

**If this returns `connection refused`** → Docker DNS is broken; recreate the network:
```bash
docker-compose -f deploy/docker-compose.yml down
docker-compose -f deploy/docker-compose.yml up -d
```

**If this returns `Could not resolve host`** → The `public-ingress` alias `soc-nginx-proxy` is missing:
```bash
docker network inspect deploy_public-ingress | grep -A5 soc-nginx
```

---

## Step 4 — Inspect Nginx access + error logs (60 seconds)

```bash
docker exec -it soc-nginx-proxy tail -n 100 /var/log/nginx/error.log
docker exec -it soc-nginx-proxy tail -n 100 /var/log/nginx/access.log
```

**Look for:**
- `upstream timed out` → FastAPI is slow; AI inference overload. Scale `soc-backend`.
- `no live upstreams while connecting to upstream` → `soc-backend` container is down.
- `connect() failed (111: Connection refused)` → Port mismatch or service not listening.

---

## Step 5 — Check resource usage on Docker host (30 seconds)

```bash
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

**Red flags:** 
- `soc-python-ai-backend` CPU > 90% → LLM inference overloading; 502 is a timeout.
- Any container Mem > 90% → Risk of OOM kill → restart loop → 502.

---

## Step 6 — Validate Cloudflare Dashboard settings

1. **SSL/TLS → Overview**: Must be **`Full`** or **`Full (strict)`**. Never `Flexible` (causes redirect loops).
2. **Zero Trust → Tunnels → Your Tunnel → Public Hostnames**:
   - Service must be: `http://soc-nginx-proxy:80`  
   - ⚠️ If it shows `localhost` — that resolves to the cloudflared container itself, **not** Nginx. Fix immediately.

---

## Step 7 — Collect Cloudflare Trace for deeper analysis

Open in browser (or curl) while the 502 is active:
```
https://socanalyst.raymundgerardestaca.dev/cdn-cgi/trace
```

Paste the output to your incident ticket. Key fields: `colo`, `visit_scheme`, `h`, `ip`.

---

## Step 8 — Emergency restart sequence (last resort)

```bash
# Restart only the tunnel — fastest resolution if origin is healthy
docker-compose -f deploy/docker-compose.yml restart cloudflared

# Restart Nginx + tunnel if Nginx was the cause
docker-compose -f deploy/docker-compose.yml restart soc-frontend cloudflared

# Full stack restart (all services, preserves volumes)
docker-compose -f deploy/docker-compose.yml up -d --force-recreate
```

---

## Known Root Causes & Fixes Applied

| Cause | Symptom | Fix Applied |
|---|---|---|
| QUIC/UDP packet drops on Docker | Intermittent 502, tunnel otherwise healthy | `TUNNEL_TRANSPORT_PROTOCOL=http2` |
| Tunnel starts before Nginx is ready | 502 on first load after deploy | `depends_on: soc-frontend: condition: service_healthy` |
| No healthcheck on Nginx | Docker can't know if origin is ready | `healthcheck: wget /health` on `soc-frontend` |
| No healthcheck on FastAPI | Nginx healthcheck polls dead backend | `healthcheck: wget :8000/api/health` on `soc-backend` |
| Per-request TCP reconnects | Latency spikes → Cloudflare timeout → 502 | `upstream python_backend { keepalive 32; }` |
| LLM inference > 60s timeout | AI triage requests killed mid-flight | `proxy_read_timeout 120s` on `/api/` block |
| EDR WebSocket 404 | Live-tail broken | Nginx regex expanded to `/api/ws/.*` |
