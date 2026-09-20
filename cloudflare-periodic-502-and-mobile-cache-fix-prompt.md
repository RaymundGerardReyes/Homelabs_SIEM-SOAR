# Principal SRE Prompt — Resolving Periodic 502s + the Mobile "Stuck Cached Error" Symptom

## Critical Pattern Identified From Your Own Logs (Do Not Skip This)

```text
You are a Principal SRE analyzing a precise, repeatable failure signature extracted directly from the uptime logger output, not a vague "network jitter" theory.

The pattern in the provided logs is completely consistent and periodic:

05:58:48.983258 -> 502 GATEWAY ERROR, Latency: 3083ms
05:59:22.673278 -> 502 GATEWAY ERROR, Latency: 3032ms
06:00:38.706926 -> 502 GATEWAY ERROR, Latency: 2527ms
06:01:11.696775 -> 502 GATEWAY ERROR, Latency: 2969ms
06:01:55.373559 -> 502 GATEWAY ERROR, Latency: 3020ms
06:03:09.691533 -> 502 GATEWAY ERROR, Latency: 3007ms

Every single 502 in this log is preceded by a latency spike clustering tightly around 3000ms (2527-3083ms), never below 2500ms and never above 3100ms. Every successful request runs at 174-351ms (with one outlier at 1758ms immediately after a 502, which is itself diagnostic — see Task 2). Rolling stats consistently show roughly 65-69% success rate over each ~10-request window, meaning this is not rare or random — it is a frequent, structural, periodic failure occurring roughly every 30-90 seconds.

This tight ~3000ms clustering is not consistent with random internet jitter (which produces variable, unpredictable latency distributions). A consistent ~3-second ceiling before failure is the signature of a FIXED TIMEOUT being hit somewhere in the request path — something is waiting exactly ~3 seconds, then giving up and returning a 502. Your job is to find which layer owns that 3-second timeout.

Return this pattern classification as the starting fact of the investigation: "fixed ~3s timeout ceiling, not random jitter" — reject any further "it's just internet weather" explanation unless it can account for this exact consistency.
```

---

## Task 1 — Locate the Exact 3-Second Timeout Source

```text
You are a Principal SRE tracing every timeout value configured across the request path to find which one is set to approximately 3 seconds (2500-3100ms range), since that is the exact ceiling observed before every 502 in the logs.

Check each of these, in order, and report the configured value for each:

1. cloudflared origin request timeout: check the tunnel's ingress configuration (config.yml or dashboard-managed tunnel settings) for `originRequest.connectTimeout` and `originRequest.tlsTimeout` — if either is set near 3000ms (or left at a low default), cloudflared will abandon the connection to soc-nginx-proxy at that mark and return a 502 to the client, which matches this pattern exactly[web:179][web:182].
2. Nginx proxy timeouts: check nginx.conf for `proxy_connect_timeout`, `proxy_read_timeout`, and `proxy_send_timeout` on the server block proxying to soc-backend/core-ingest — a low proxy_connect_timeout (e.g., 3s) would cause Nginx itself to fail upstream connection attempts at that mark.
3. Backend connection pool acquisition timeout: check soc-backend's database connection pool configuration (e.g., SQLAlchemy pool_timeout, asyncpg pool acquire timeout) — if the pool is exhausted, a request can stall for exactly the configured pool_timeout value before failing, which is a very common cause of a clean, consistent multi-second stall.
4. core-ingest gRPC client timeout: check soc-backend's gRPC client call options (Infrastructure/gRPC/Client.py) for a context deadline/timeout value — a fixed grpc deadline near 3000ms would produce this exact signature when core-ingest is briefly slow to respond.
5. Docker/container health check or restart timing: check `docker inspect` healthcheck intervals/timeouts for soc-nginx-proxy, soc-backend, and core-ingest — confirm none of them are restarting or briefly unhealthy on a cadence that lines up with the ~30-90 second gaps between 502s in the log.

Return the exact timeout value found in whichever layer matches ~3000ms, and flag it as the primary suspect. If multiple candidates exist, rank them by how closely they match 2500-3100ms.
```

---

## Task 2 — Explain the 1758ms Recovery Outlier (Important Secondary Clue)

```text
You are a Principal SRE explaining why the request immediately following the second 502 (05:59:35.709758, Latency: 1758ms) took noticeably longer than the normal 170-350ms baseline, despite succeeding.

This is a classic "cold recovery" signature: whatever resource caused the ~3000ms stall (most likely a connection pool, a gRPC channel, or an Nginx upstream keepalive slot) was being re-established or recovering during that specific request, producing elevated but non-failing latency right after a failure. Your task:

1. If Task 1 identifies a database/connection pool timeout as the primary suspect, check the pool's min/max size and idle connection recycling settings — an undersized pool under concurrent load (health checker + real analyst traffic + agent polling) would produce exactly this pattern: occasional full exhaustion (502), followed by a slow reacquire (1758ms), followed by normal service once a connection frees up.
2. If Task 1 identifies a gRPC client timeout as the primary suspect, check whether core-ingest recycles or re-establishes its gRPC server-side connection handling under load, which could explain a slow-but-successful recovery request.

Return which resource's exhaustion-and-recovery cycle best explains both the 502 pattern and this specific recovery outlier together, since a correct root cause must explain both symptoms, not just the 502 itself.
```

---

## Task 3 — Fix the Confirmed Timeout/Exhaustion Source

```text
You are a Principal Backend/SRE Engineer applying the concrete fix once Task 1/2 identify the actual bottleneck.

Apply whichever of these matches the confirmed root cause:

1. If it's a database/connection pool exhaustion:
   - Increase the pool's max size to comfortably exceed peak concurrent demand (health checker + real traffic + agent polling loops all compete for the same pool).
   - Add pool timeout monitoring (log a warning whenever a request waits more than 500ms to acquire a connection) so future exhaustion is visible before it causes a 502, not just after.
   - Consider a dedicated, smaller connection pool exclusively for health checks/metrics so they cannot starve real request traffic of pool slots.

2. If it's an Nginx proxy timeout:
   - Raise `proxy_connect_timeout` and `proxy_read_timeout` to values that comfortably exceed your backend's worst-case legitimate response time (e.g., AI triage calls), while keeping them bounded (e.g., 10-15s, not unlimited) so a truly hung backend still fails fast enough to be noticed.

3. If it's a cloudflared originRequest timeout:
   - Explicitly set `originRequest.connectTimeout` in the tunnel ingress config to a value above your backend's worst legitimate latency, and set `originRequest.tcpKeepAlive` to maintain persistent connections rather than repeatedly reconnecting.

4. If it's a gRPC client deadline:
   - Increase the context deadline passed to core-ingest calls to a value with headroom above core-ingest's actual p99 latency, and add client-side retry-with-backoff for transient deadline-exceeded errors instead of surfacing them directly as a failed request.

5. Regardless of which layer is fixed, add a Prometheus metric/alert specifically tracking "requests exceeding 2000ms" as a leading indicator — since every 502 in your logs was preceded by exactly this signature, this metric will catch the next occurrence minutes before it becomes a visible 502.

Return the exact configuration diff for the confirmed fix, plus the new Prometheus metric/alert definition.
```

---

## Task 4 — The Mobile "Hard Refresh Fixes It, But Only on Desktop" Symptom (Separate, Critical Bug)

```text
You are a Principal Frontend/Infrastructure Engineer explaining and fixing why Ctrl+Shift+R (a hard refresh that bypasses the browser cache) clears the 502 on desktop, but mobile users — who cannot easily perform an equivalent bypass-cache reload — remain stuck seeing the 502 indefinitely.

This symptom is highly diagnostic and points to ONE specific class of bug: the 502 error response itself, or a stale asset referencing it, is being cached by the browser (or an intermediate cache) with cache headers that permit reuse, and a normal reload re-reads the cached copy instead of making a fresh request — while Ctrl+Shift+R forcibly ignores the cache and gets a fresh (successful) response.

Investigate and fix, in order:

1. Check response headers on the actual document/API response during a 502: inspect whether Nginx or cloudflared is sending any Cache-Control, ETag, or Expires header on error responses. If no explicit `Cache-Control: no-store` is set on error/dynamic responses, browsers and intermediate caches are permitted to cache a 502 (or a stale successful response) and serve it back on subsequent normal reloads[web:88].
2. Explicitly configure Nginx to send `Cache-Control: no-store, no-cache, must-revalidate` and `Pragma: no-cache` on all dynamic/API responses and on any 5xx error response specifically — add an `error_page 502` block with these headers set unconditionally, so a 502 can never be cached by any client regardless of platform.
3. Check Cloudflare's own caching/page rules for this hostname: if "Cache Everything" or an aggressive cache rule is applied to a path that should never be cached (API routes, or the app shell itself), a transient 502 response can get cached at Cloudflare's edge and served to many users afterward, including mobile users, until the cache entry expires or is purged — set a Cloudflare Page Rule / Cache Rule to bypass cache entirely for API paths and set "Respect Existing Headers" or explicit no-cache for the app shell.
4. Check the service worker (if soc-frontend uses one, e.g., via Vite PWA plugin) for any fetch-event caching strategy that could be caching a failed navigation response — a service worker caching a 502 HTML response under a stale-while-revalidate or cache-first strategy would exactly reproduce "desktop hard refresh fixes it, mobile normal reload does not," since hard refresh bypasses service workers while a normal reload does not always do so consistently across mobile browsers.
5. Confirm mobile-specific reproduction: ask whether the affected mobile browser is Chrome, Safari, or an in-app webview — Safari on iOS in particular has historically aggressive HTTP disk caching behavior that persists longer than desktop Chrome, which could explain why the same underlying cached-502 bug is more visible on mobile even if the root cause (missing no-store headers) is identical across platforms.

Return the exact Nginx/Cloudflare/service-worker configuration changes needed so that a 502 (or any dynamic response) can never be cached by any client, on any platform, removing the need for any user to ever manually hard-refresh.
```

---

## Task 5 — Verify Both Fixes Independently

```text
You are a Principal QA Engineer verifying that the periodic-502 fix (Task 3) and the caching fix (Task 4) are independently confirmed, since they are two separate bugs that happened to be observed together.

1. Re-run the existing uptime logger for a minimum 2-hour window after applying Task 3's fix, confirming zero requests exceed the previously identified ~3000ms ceiling and zero 502s occur — compare against the "533/790 successful" style rolling stats already being captured, expecting close to 100% success once fixed.
2. Test the caching fix explicitly on a mobile device: force a 502 (e.g., temporarily stop soc-backend), confirm the mobile browser correctly shows a fresh error state without needing any manual cache-bypass action, then restart soc-backend and confirm a completely normal reload (not a hard refresh) immediately reflects the recovered service — this is the specific behavior that was broken and must now work identically to desktop.
3. Document both fixes and their verification evidence in a short incident report distinguishing the two root causes (timeout/exhaustion vs. response caching) so they are never conflated again in future debugging.

Return the verification results and the final incident report.
```

---

## Summary: Two Distinct Bugs, Not One

| Symptom | Root Cause Category | Evidence | Fix |
|---|---|---|---|
| Periodic 502s every 30-90s with ~3000ms latency spike beforehand | Fixed timeout/connection pool exhaustion somewhere in the request path | Consistent 2527-3083ms ceiling before every 502 in your own logs | Locate and raise/tune the specific ~3s timeout (DB pool, Nginx proxy, cloudflared originRequest, or gRPC deadline) |
| 502 clears with Ctrl+Shift+R on desktop but persists on mobile with normal reload | 502/dynamic response being cached by browser, CDN edge, or service worker | Hard refresh (bypasses cache) fixes it; normal reload (uses cache) does not | Force `Cache-Control: no-store` on all dynamic/error responses; bypass Cloudflare cache for API/app-shell paths; audit service worker fetch strategy |

---

## Recommended Immediate Next Step

Run Task 1 first — it is the fastest to check (reading existing config files) and will most likely immediately reveal a database pool timeout, Nginx proxy timeout, or gRPC deadline set right around 3000ms, since that consistency is too precise to be coincidental. In parallel, apply Task 4's Nginx `Cache-Control: no-store` change on error responses immediately, since it is a low-risk, high-value fix that will stop mobile users from getting stuck on stale 502 pages regardless of how long the timeout root cause takes to fully resolve.
