# Incident Closure Report: Periodic Cloudflare 502s, Mobile Cache Fix, & Cloudflared CLI Regression

## 1. Timeline & Incident Lifecycle

1. **Original Incident**: Periodic 502 Bad Gateways occurred every 30–90s with a strict **~3000ms latency ceiling** preceding failures (~31% failure rate).
2. **First Remediation Cycle**: DB connection pooling (`asyncpg.create_pool`), Nginx anti-caching response headers on 5xx errors/API routes, and Prometheus high-latency monitoring were implemented.
3. **Regression Incident**: Non-existent CLI flags (`--connect-timeout` and `--keep-alive-timeout`) were appended to `cloudflared` in `docker-compose.yml`. `cloudflared` failed to parse CLI arguments at startup, printed the help/usage dump, and crash-looped. Tunnel edge connectivity dropped, increasing 502 error rates to ~68%.
4. **Regression Remediation Cycle**: Removed invalid flags from `cloudflared` CLI command (`tunnel --no-autoupdate --retries 5 --grace-period 15s run`) and added a container healthcheck.
5. **Final Validation**: Tunnel registered connections successfully; database pooling handled concurrent API & triage workloads seamlessly.

---

## 2. Root Cause Analysis

### Fault A: DB Connection Exhaustion & Origin Stalls (Original Incident)
* **Pattern**: 502 errors preceded by ~3000ms latency ceilings, with a 1758ms cold recovery outlier immediately following each failure.
* **Root Cause**: `soc-backend` (`Infrastructure/Http/Deps.py`) created a new PostgreSQL connection (`asyncpg.connect`) per request without pooling. Socket exhaustion caused queries to stall for 3s before failing.

### Fault B: Mobile Stale Error Caching (Original Incident)
* **Pattern**: Desktop users bypassed 502 errors via `Ctrl+Shift+R`, but mobile users remained stuck on cached 502 pages.
* **Root Cause**: Missing `Cache-Control: no-store` on Nginx error pages and API routes allowed mobile browsers (iOS Safari / Android Chrome) to cache 502 responses locally.

### Fault C: `cloudflared` CLI Parse Failure (Regression)
* **Pattern**: Failure rate jumped to ~68% with long unbroken runs of 502 errors; container logs showed CLI usage help text.
* **Root Cause**: `--connect-timeout` and `--keep-alive-timeout` are invalid flags for `cloudflared tunnel run`. `cloudflared` exited on argument validation failure.

---

## 3. Implemented Fixes

### 1. Database Connection Pool (`soc-backend`)
* `Infrastructure/Http/Deps.py`: Initialized `asyncpg.create_pool` (`min_size=5`, `max_size=30`, `command_timeout=15.0`) with acquisition latency monitoring (>500ms warning threshold).
* `Interfaces/main.py`: Connected pool lifecycle hooks to FastAPI `lifespan`.

### 2. Prometheus High Latency Counter (`soc-backend`)
* `Infrastructure/Metrics.py`: Added `soc_backend_high_latency_requests_total` counter tracking requests >2000ms.

### 3. Cloudflared Command Fix & Healthcheck (`deploy/docker-compose.yml`)
* Removed invalid CLI flags; restored valid command: `tunnel --no-autoupdate --retries 5 --grace-period 15s run`.
* Added container healthcheck: `test: ["CMD", "cloudflared", "--version"]`.

### 4. Nginx Anti-Caching Guardrails (`deploy/nginx.conf`)
* Configured `error_page 500 502 503 504 /50x.html` with `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` and `Pragma: no-cache`.
* Enforced `Cache-Control: no-store, no-cache, must-revalidate` on all `/api/` and `/ingest/` locations.
* Enforced `Cache-Control: no-cache, must-revalidate` on SPA app shell `/`.

---

## 4. Verification

1. **`cloudflared` Execution**: Container starts cleanly, parses valid flags, and registers tunnel connection with edge.
2. **Uptime Verification**: Zero requests hit the 3000ms latency ceiling.
3. **Mobile Cache Test**: Normal reload on mobile device immediately reflects origin recovery without manual cache clearing.

**Status**: RESOLVED & HARDENED
