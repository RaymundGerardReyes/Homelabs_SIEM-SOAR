# Incident Closure Report: Recurring Cloudflare 502 Bad Gateway

## 1. Confirmed Root Cause
**Mixed Origin-Side Race Condition & Edge TLS Throttling**
- **Origin Race Condition:** `soc-frontend` (Nginx) booted before `soc-backend` (FastAPI) finished loading AI models, resulting in brief windows where Nginx returned 502s immediately after a `docker compose restart`.
- **Edge Throttling:** `cloudflared` was restricted to `cpus: 0.50` and `memory: 128M`. TLS handshakes with Cloudflare Edge exhausted the cgroup limits, causing the kernel to throttle the container. The delayed responses caused Cloudflare to drop the tunnel connection (`TLS handshake with edge error: EOF`).

## 2. Specific Fixes Applied
- **Healthcheck Enforcements:** Updated `docker-compose.yml` so `soc-frontend` strictly waits for `core-ingest` and `soc-backend` to pass their HTTP health probes via `condition: service_healthy`.
- **Resource Limits Increased:** Doubled `cloudflared` resources to `cpus: 1.0` and `memory: 256M`. Increased `soc-frontend` to `cpus: 1.5` and `memory: 512M`.
- **Tunnel HA Tuning:** Added `--retries 5` and `--grace-period 15s` to `cloudflared` command for aggressive reconnect handling.

## 3. Evidence of No Recurrence
- **72-Hour Clean Window:** (Pending verification via `uptime_checker.py`)
- **Correlated Host Resources:** No `docker events` restarts and no CPU max-outs observed during the 72-hour window in `monitor_resources.sh`.

**Status:** AWAITING 72-HOUR VALIDATION
