# Principal SRE Prompt — Resolving Persistent Cloudflare Tunnel 502s (Rejecting the "Just Internet Weather" Diagnosis)

## Why the Previous Two "Analyses" Must Be Rejected

Both prior explanations conclude "nothing is wrong, this is normal self-healing internet weather, you can safely ignore it" — this conclusion is not supportable from the evidence actually presented, and treating it as final leaves the 502s recurring indefinitely. Three specific problems with that reasoning:

1. **"Local internet jitter" is asserted, never verified.** Neither analysis checked the actual network path, host resource state, or Docker container health at the moment of the drop — it inferred "your ISP/Wi-Fi dropped" purely from the presence of `EOF` and `connection with edge closed` messages, which are generic disconnect signals that can equally originate from host CPU/memory exhaustion, container restarts, or `cloudflared` itself timing out waiting on an overloaded origin[web:172][web:176][web:177][web:181].
2. **A single connIndex dropping is not the same as all four dropping.** Cloudflare's `cloudflared` maintains 4 redundant HA connections specifically so one dropping does NOT cause a public 502 — a 502 only occurs when `cloudflared` cannot reach the origin service at all, or when the tunnel loses too many/all connections simultaneously[web:172][web:175][web:179]. If you are seeing recurring 502s alongside single-connIndex drops, the two are likely not directly causal, and the real trigger (origin unreachable, not "edge closed") was never actually checked.
3. **"health checks return 200 every 15 seconds" does not prove the origin was reachable at 02:32:51 UTC specifically.** A health check succeeding seconds before and after an outage window does not prove the service was responsive during the outage — it is entirely consistent with a brief but real origin-side stall (GC pause, DB connection pool exhaustion, CPU throttling under Docker resource limits) that a periodic health check simply missed by timing[web:178][web:179].

**"Ignoring loop detection" and repeatedly declaring the system "fully stable" without new evidence each time is itself a red flag — a resolved incident does not need to be re-declared resolved after every recurrence.** If the 502 keeps recurring, the previous fix (or non-fix) did not address the actual root cause, and this must be verified with fresh diagnostic evidence each time, not the same reassurance script.

---

## Task 1 — Determine Definitively Which of the Three 502 Sources Is Firing

```text
You are a Principal SRE resolving a recurring Cloudflare 502 by definitively identifying which of three possible sources is responsible, per Cloudflare's own diagnostic model: the origin, Cloudflare's edge, or the tunnel between them[web:178][web:179].

Execute these checks in order, capturing timestamped evidence for each — do not conclude "self-healing, ignore it" without completing all three:

1. Check A — Origin reachability at the exact failure timestamp:
   - Correlate the exact UTC timestamp of the 502 (02:32:51Z in this case) against soc-nginx-proxy's own access/error logs, not just soc-backend/soc-frontend health check logs. If Nginx itself has no log entry for that request, the request never reached Nginx — meaning cloudflared could not reach the origin, not that the origin was slow.
   - Run `docker inspect --format='{{.State.Health.Status}}' soc-nginx-proxy` and `docker logs soc-nginx-proxy --since <timestamp-5min> --until <timestamp+5min>` filtered to the exact incident window.

2. Check B — Cloudflare edge status at that timestamp:
   - Check https://www.cloudflarestatus.com/ for any incident logged at the colo(s) seen in your logs (mnl01, ceb01, hkg08, hkg10) during the failure window[web:178].
   - If no incident is listed, Cloudflare's edge is not the cause, and root cause must be at the tunnel or origin.

3. Check C — Tunnel-to-origin connectivity specifically:
   - Run `docker exec soc-cloudflared-edge cloudflared tunnel info <tunnel-name>` (or check the Cloudflare Zero Trust dashboard's Tunnel health tab) at the next occurrence to see live connection state.
   - Search cloudflared logs for the specific phrase "Unable to reach the origin service" — this exact message means the tunnel is connected to Cloudflare but cannot reach soc-nginx-proxy, which is a DIFFERENT failure mode than "connection with edge closed" and requires a different fix[web:179][web:182][web:183].

Return a definitive classification: Origin-side failure / Cloudflare edge incident / Tunnel-to-origin failure — with the supporting log evidence for whichever is confirmed, and explicitly state if evidence is insufficient to classify (in which case more logging must be added, per Task 2).
```

---

## Task 2 — Instrument for Root Cause Instead of Re-Reading the Same Ambiguous Logs

```text
You are a Principal SRE adding the instrumentation needed to stop re-diagnosing this incident from insufficient logs every time it recurs.

Your tasks:
1. Add Docker resource monitoring correlated to timestamps: run `docker stats --no-stream` on a cron/loop (e.g., every 10 seconds, logged to a file) for soc-nginx-proxy, soc-backend, core-ingest during a monitoring window, so the next 502 can be checked against actual CPU/memory/restart data at that exact second — this directly tests whether host resource exhaustion (not "internet weather") is causing cloudflared or Nginx to become briefly unresponsive.
2. Check for container restarts explicitly: run `docker events --filter event=restart --filter event=die --since 24h` and cross-reference any restart timestamp against 502 occurrence timestamps. A restarting container is completely unable to serve requests for several seconds — this is a far more concrete explanation than unverified "ISP jitter" and is fully within your control to fix.
3. Confirm whether cloudflared's configured protocol is actually http2 consistently, per the existing environment variable `TUNNEL_TRANSPORT_PROTOCOL=http2` — verify in the logs that no fallback to quic is silently occurring, since mixed protocol behavior has caused documented intermittent drops in other cloudflared deployments[web:172][web:174][web:177].
4. Check host-level network stability independently of Docker: run a continuous ping/mtr to 1.1.1.1 (Cloudflare's own resolver) from the host machine (not inside a container) for several hours, logging packet loss with timestamps — this is the only way to actually verify or falsify the "local internet jitter" claim instead of asserting it.
5. Enable verbose cloudflared logging (`--loglevel debug`) temporarily during the next reproduction window to capture the exact reason for connection termination rather than the generic summary-level message currently seen.

Return the instrumentation scripts/commands and a plan for correlating their output against the next 502 occurrence, so the next incident report is backed by concrete evidence rather than inference.
```

---

## Task 3 — Fix the Most Likely Concrete Causes Directly

```text
You are a Principal SRE applying direct fixes for the most probable concrete causes of recurring cloudflared disconnects and 502s in a Dockerized origin, based on documented cloudflared issues, rather than waiting indefinitely on inconclusive "jitter" theories.

Apply and verify each of the following:

1. Origin timeout tuning: if soc-nginx-proxy or soc-backend ever takes more than a few seconds to respond under load (e.g., a slow DB query, a cold LLM inference call), cloudflared can report the connection as failed even though the origin is technically "up." Add explicit `originRequest.connectTimeout` and `originRequest.tcpKeepAlive` settings in the tunnel's ingress configuration, and confirm Nginx's own `proxy_read_timeout`/`proxy_connect_timeout` are set generously enough for your slowest legitimate request (e.g., AI triage calls), not left at Nginx defaults.
2. Container resource limits: if Task 2's `docker stats` correlation shows soc-nginx-proxy or cloudflared hitting CPU/memory limits at failure timestamps, raise the `deploy.resources.limits` for that specific service in docker-compose.yml — a container being CPU-throttled by Docker cgroups can appear identical to "network jitter" in cloudflared's own logs, but the actual fix is a resource limit change, not "wait it out."
3. Healthcheck dependency ordering: confirm `soc-frontend`'s `depends_on: core-ingest, soc-backend` uses `condition: service_healthy` (not just `service_started`) wherever a hard dependency exists, so Nginx does not accept traffic before its upstreams are actually ready after any restart — a race here produces exactly the kind of brief, unpredictable 502 window described.
4. cloudflared restart policy and connection count: confirm `restart: unless-stopped` is functioning (check `docker inspect soc-cloudflared-edge` restart count over the incident period) and consider explicitly setting `--ha-connections 4` (the default) with `--retries` tuned slightly higher if brief edge-side blips are frequent, rather than leaving default retry backoff to repeatedly cycle through short reconnects[web:175].
5. DNS resolution stability inside the container: verify `/etc/resolv.conf` inside soc-cloudflared-edge resolves cleanly and quickly; if using Docker's embedded DNS (127.0.0.11), confirm it is not itself under load — DNS resolution failures inside the tunnel container can masquerade as generic "connection with edge closed" errors[web:182].

Return the exact configuration diffs (nginx.conf, docker-compose.yml, cloudflared ingress config) for whichever of these apply once Task 1/2 evidence identifies the actual bottleneck.
```

---

## Task 4 — Do Not Accept "It's Fixed" Without a No-Recurrence Window

```text
You are a Principal SRE defining the actual closure criteria for this incident, since it has already been prematurely declared "fully stable" at least twice while continuing to recur.

Closure criteria (all required, not optional):
1. A minimum 72-hour monitoring window with zero 502 occurrences reported by an external synthetic check (e.g., a scheduled GitHub Actions job or UptimeRobot-style checker hitting https://socanalyst.raymundgerardestaca.dev every 60 seconds and logging status codes) — not just internal health check logs, since those only prove the origin was up, not that the public route was ever actually 502-free[web:178].
2. During that window, correlate the resource/restart/DNS instrumentation from Task 2 to confirm the specific root cause identified in Task 1 has not recurred even once, not merely that visible 502s stopped (a root cause could still be intermittently occurring below the threshold of visible impact).
3. A written incident summary stating: the confirmed root cause (Origin / Edge / Tunnel, from Task 1), the specific fix applied (from Task 3), and the evidence proving no recurrence (from this task) — replacing the previous "self-healing, ignore it" narrative with a verifiable conclusion.
4. If the 72-hour window is not clean, return to Task 2 with the new evidence rather than re-issuing another "everything is fine" reassurance.

Return the synthetic monitoring script/workflow and the incident closure report template.
```

---

## Summary Decision Table

| Symptom in Your Logs | Previous (Rejected) Explanation | Required Verification | Likely Real Fix If Confirmed |
|---|---|---|---|
| `TLS handshake with edge error: EOF` | "Standard internet jitter" | Check B (Cloudflare status) + host ping/mtr log | If no CF incident and no packet loss: not jitter — check container/network stack instead |
| `Connection terminated error="connection with edge closed"` on 1 connIndex | "Self-healing HA, ignore" | Confirm only 1 of 4 connIndex dropped, and correlate with docker restarts | If restarts correlate: fix whatever is restarting the container |
| `502 Bad Gateway` at 02:32:51Z | "Local internet drop, self-healed" | Check A (Nginx logs at exact timestamp) + Check C (cloudflared "Unable to reach origin" message) | If Nginx log is empty at that second: origin was actually unreachable — check resource limits, health-check race, or Nginx crash/restart |
| Health checks 200 OK every 15s | "Proof everything is fine" | Does NOT cover the actual failure second — irrelevant to root cause | Add sub-15-second synthetic monitoring for real proof |

---

## Recommended Immediate Next Step

Do not act on either prior "everything is fine" analysis. Execute Task 1 fully at the next occurrence of the 502 (or retroactively against any retained logs covering 02:32:51Z) to classify the failure as Origin, Edge, or Tunnel — this single step determines which of Task 3's fixes is actually relevant, and prevents further cycles of vague reassurance without resolution.
