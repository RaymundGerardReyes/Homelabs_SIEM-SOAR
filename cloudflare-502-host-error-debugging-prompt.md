# Principal DevOps & Cloudflare Tunnel Debugging Prompt — Intermittent 502 Host Errors

This prompt is tailored to the current production stack:
- Cloudflare Zero Trust Tunnel → `cloudflared` container (`soc-cloudflared-edge`)
- Tunnel ingress mapping to `http://soc-nginx-proxy:80`
- Docker networks: `public-ingress` and `internal-mesh`
- Nginx reverse proxy (`soc-nginx-proxy`) with the config from `deploy/nginx.conf`
- Backend services: `soc-backend` (FastAPI) and `core-ingest` (Go)

The cloudflared pre-check logs show a healthy environment (DNS, UDP/QUIC, TCP/HTTP2, Cloudflare API all PASS), yet you still see intermittent `502 Bad Gateway — Host Error` at the browser. This means **Cloudflare edge and the tunnel are fine; the origin path from cloudflared → Nginx → backend is intermittently failing**.

Use the following prompt as a comprehensive debugging and hardening runbook.

---

## 1. Clarify the Current Tunnel & Origin Wiring

```text
You are a Principal DevOps Engineer debugging intermittent "Bad gateway — Error code 502, Host Error" responses for a Cloudflare Tunnel fronting a Dockerized Nginx origin.

Current wiring (from docker-compose.yml and nginx.conf):
- cloudflared:
  - Runs in container `soc-cloudflared-edge` on network `public-ingress`.
  - Uses TUNNEL_TOKEN and TUNNEL_TRANSPORT_PROTOCOL=http2.
  - Ingress config (Cloudflare Zero Trust) maps hostname (e.g., socanalyst.raymundgerardestaca.dev) to `http://soc-nginx-proxy:80`.
- soc-frontend (Nginx):
  - Container name: `soc-nginx-proxy`, on networks `public-ingress` + `internal-mesh`.
  - Exposes ports 80/443 to host.
  - Uses nginx.conf with two servers:
    - `ingest.yourdomain.com` → Go core-ingest (telemetry APIs) → returns 403 on `/`.
    - `admin.yourdomain.com` + `localhost` → serves React app and proxies `/api/*` to soc-backend, includes `/health`.

Your first task:
1. In Cloudflare Zero Trust → Tunnels → Public Hostnames, confirm:
   - The hostname you are using in the browser (e.g., socanalyst.raymundgerardestaca.dev) is mapped to `http://soc-nginx-proxy:80`.
   - If TLS is configured, confirm you are not pointing the tunnel to an HTTPS origin port that Nginx does not listen on.
2. Confirm that `soc-nginx-proxy` is reachable by name from inside the cloudflared container:
   - `docker exec -it soc-cloudflared-edge sh`
   - `curl -I http://soc-nginx-proxy:80` — must return a 200/403/404 from Nginx, not connection refused or timeout.
3. Document the exact hostname and URL path that produces the 502 in the browser (e.g., https://socanalyst.raymundgerardestaca.dev/, /index.html, or a specific /api route).
```

---

## 2. Distinguish Between Nginx-Level and Backend-Level 502s

```text
Your next task is to determine where the 502 originates:
- Cloudflare -> cloudflared -> Nginx (origin unreachable or Nginx failing).
- Nginx -> soc-backend (FastAPI) or core-ingest (Go) upstream failure.

Steps:
1. Inspect Nginx access and error logs inside `soc-nginx-proxy` during a 502 event:
   - `docker exec -it soc-nginx-proxy sh`
   - `tail -n 200 /var/log/nginx/access.log`
   - `tail -n 200 /var/log/nginx/error.log`
2. If Nginx logs show 502/504 or upstream failures to `dynamic_python_backend` or `dynamic_go_ingest`, note the upstream status and error messages.
3. If Nginx returns a non-502 status (e.g., 403 from the ingest server, 200 for index.html), but Cloudflare still shows 502 Host Error, then the problem is between cloudflared and Nginx (Docker networking, origin timeouts, or TLS mismatch).
4. For each 502 in Cloudflare:
   - Capture the approximate timestamp.
   - Find matching entries in Nginx error.log.
   - Determine whether the root cause is upstream backend failure, Nginx not ready, or Nginx itself returning 502.
```

---

## 3. Verify Healthchecks and Startup Race Conditions

```text
You must ensure cloudflared never starts accepting traffic before Nginx and FastAPI are truly ready.

From docker-compose.yml:
- soc-backend has a healthcheck hitting `http://localhost:8000/api/health`.
- soc-frontend (Nginx) has a healthcheck hitting `http://localhost/health`, which proxies to FastAPI /api/health.
- cloudflared depends_on soc-frontend with condition: service_healthy.

Tasks:
1. Confirm FastAPI /api/health and Nginx /health endpoints behave correctly:
   - `docker exec -it soc-python-ai-backend sh` → `curl -I http://localhost:8000/api/health`.
   - `docker exec -it soc-nginx-proxy sh` → `curl -I http://localhost/health`.
   - Both should reliably return 200 when services are up.
2. Verify that these healthchecks are not failing intermittently due to DB/clickhouse readiness:
   - FastAPI /api/health should be designed to report "healthy" even if non-critical downstreams (e.g., ClickHouse) are warming up — or explicitly distinguish "degraded" vs "down".
3. Confirm the healthcheck intervals and start_periods are sufficient:
   - soc-backend: interval 15s, retries 5, start_period 30s.
   - soc-frontend: interval 15s, retries 5, start_period 20s.
   - If FastAPI starts slowly under load, consider increasing start_period or reducing healthcheck strictness.
4. Validate that cloudflared does not start until Nginx reports healthy; if you see cloudflared logging tunnel registration before Nginx /health is up, adjust healthcheck/depends_on configuration.
```

---

## 4. Check Nginx Server Blocks and Hostname Mismatch

```text
Nginx has two server blocks:
- Ingest gateway: server_name ingest.yourdomain.com; returns 403 for root /.
- Admin dashboard: server_name admin.yourdomain.com localhost _; serves React app and /api routes.

If Cloudflare points your hostname to `soc-nginx-proxy:80` but Nginx does not have a matching server_name for that hostname, traffic may fall through to an unexpected server block and return 403/404 or 502.

Tasks:
1. Confirm which server block handles requests for your public hostname:
   - Temporarily add a distinct `add_header X-Debug-Server "ingest"` in the ingest server block and `add_header X-Debug-Server "admin"` in the admin server block.
   - Make a request from the browser and inspect response headers.
2. Ensure that the hostname Cloudflare uses (e.g., socanalyst.raymundgerardestaca.dev) is listed in the appropriate server_name directive (likely the admin dashboard block).
3. If needed, add a dedicated server block for socanalyst.raymundgerardestaca.dev that:
   - Serves the React app via `root /usr/share/nginx/html;` and `try_files $uri $uri/ /index.html;`.
   - Proxies `/api/*` and `/api/investigations/.../stream` to dynamic_python_backend as currently configured.
4. Reload Nginx and re-test to ensure the correct server block handles requests for your SOC frontend hostname.
```

---

## 5. Investigate Origin Timeouts & Resource Constraints

```text
Intermittent 502s often arise from origin timeouts or resource exhaustion rather than misconfiguration.

Tasks:
1. During a 502 event, check resource usage on the Docker host:
   - CPU, memory, disk I/O.
   - Container-specific stats: `docker stats soc-nginx-proxy soc-python-ai-backend core-ingest`.
2. Confirm Nginx is not hitting worker_connections or worker_processes limits under load.
3. Ensure proxy_read_timeout and proxy_connect_timeout in Nginx are sufficiently high for:
   - /api/investigations/.../stream WebSocket/SSE connections (currently 3600s).
   - Standard /api requests (60s).
4. If FastAPI or core-ingest occasionally hang or restart, Nginx will log upstream failures; correlate these with Cloudflare 502s.
5. Consider adding originRequest tuning to cloudflared (via config file rather than env only):
   - connectTimeout, tlsTimeout, tcpKeepAlive, keepAliveTimeout.
   - Align these with Nginx proxy timeouts to avoid premature connection drops.
```

---

## 6. Verify Docker Networking & Name Resolution

```text
The tunnel service URL uses `soc-nginx-proxy` on `public-ingress`. Any network misalignment will cause 502 Host Error.

Tasks:
1. Confirm network membership:
   - `docker inspect soc-cloudflared-edge` → ensure `public-ingress` is present.
   - `docker inspect soc-nginx-proxy` → ensure `public-ingress` is present.
2. Confirm DNS resolution via Docker's internal resolver:
   - From cloudflared container, `ping soc-nginx-proxy` and `curl -I http://soc-nginx-proxy:80`.
3. If resolution or connectivity fails intermittently, check for:
   - Container restarts (docker ps / logs).
   - Any external process restarting Docker or the host network.
4. Ensure no other service is binding host port 80 that could conflict with the Nginx container.
```

---

## 7. Cloudflare-Specific Checks

```text
Even with a healthy pre-check, Cloudflare configuration can still contribute.

Tasks:
1. In Cloudflare Dashboard → SSL/TLS → Overview:
   - Ensure SSL mode is set to Full or Full (strict) and that your origin does not expect HTTPS on port 80.
2. In Zero Trust → Tunnels → Your Tunnel → Public Hostnames:
   - Confirm the service string is exactly `http://soc-nginx-proxy:80` and does not use localhost.
3. Check Cloudflare Analytics / Logs (if enabled) around 502 events for:
   - Edge server codes.
   - Origin status codes.
   - Connection reset or timeout messages.
4. If you recently changed origin IP or hostname, ensure the tunnel config is up to date and there are no stale records.
```

---

## 8. Final Hardening & Runbook

```text
After identifying the root cause (e.g., hostname mismatch, Nginx upstream failures, origin timeouts), you must:
1. Fix the misconfiguration (update server_name, adjust healthchecks/timeouts, add missing server block) and redeploy.
2. Document the exact fix and rationale in deploy/RUNBOOK-502-incident.md so future incidents can be resolved quickly.
3. Add a synthetic healthcheck that emulates a real user request through Cloudflare:
   - A small script that curls the public hostname via Cloudflare and asserts a 200/expected status.
   - Integrate it into your monitoring so 502s are caught automatically.
4. Ensure your SOC frontend hostname, Nginx server blocks, Cloudflare tunnel service URL, and Docker networks all tell the same consistent story:
   - Cloudflare hostname → cloudflared → soc-nginx-proxy:80 → correct Nginx server block → soc-backend/core-ingest.

Return:
- A concise description of the root cause you found.
- The exact configuration changes you applied (Nginx, docker-compose, Cloudflare Tunnel settings).
- An updated incident runbook entry for 502 Host Error.
```

---

## 9. Recommended Immediate Actions

1. From inside `soc-cloudflared-edge`, run `curl -I http://soc-nginx-proxy:80` while a 502 is visible in the browser to see if the origin is truly reachable.
2. Check Nginx error.log at the exact 502 timestamps to see if upstream failures to soc-backend or core-ingest are occurring.
3. Verify that your public SOC hostname is covered by the right Nginx `server_name` and that there is a dedicated server block for it if necessary.
4. Use the prompt above as a step-by-step debugging script; update `deploy/RUNBOOK-502-incident.md` with your findings and fixes so this becomes a documented, repeatable process.
