# Principal SRE Prompt — Incident Regression: cloudflared CLI Flags Broke the Tunnel (Root Cause of the Worsened 502s)

## Critical Finding: The "Fix" Introduced a New, More Severe Failure

```text
You are a Principal SRE analyzing why the 502 rate got dramatically worse (602/890 successful, ~68% failure, up from ~31% failure) immediately after applying the previous remediation, using the cloudflared docker logs as direct evidence.

The cloudflared container logs show a CLI HELP/USAGE DUMP, not normal tunnel operation logs. This is the single most important piece of evidence in this incident: cloudflared only prints its full flag reference and command help text when it fails to parse the arguments it was given and cannot start the "tunnel run" process normally. A healthy cloudflared container prints connectivity prechecks and "Registered tunnel connection" messages (as seen in all prior incident logs) — it does NOT print `--proxy-dns-upstream value (accepts multiple inputs)` style help text during normal operation.

Root cause: the docker-compose.yml edit added `--connect-timeout 30s --keep-alive-timeout 90s --retries 5 --grace-period 15s` directly as CLI arguments to the cloudflared command. At least one of these flags is invalid or malformed for the `tunnel run` subcommand as configured:
- `--connect-timeout` and `--keep-alive-timeout` are NOT valid top-level cloudflared CLI flags for `tunnel run` — origin connection timeout tuning belongs in the tunnel's `originRequest` ingress configuration (config.yml or the Zero Trust dashboard's Public Hostname settings), not as a bare CLI flag.
- `--retries` and `--grace-period` ARE valid flags per the help output shown, but if they were appended incorrectly (wrong order relative to the `run` subcommand, or combined with an invalid flag in the same command string), the entire argument parse fails and cloudflared aborts to the help screen instead of starting the tunnel.

Because cloudflared failed to start (or crash-looped repeatedly restarting into the same bad argument set), the tunnel had zero or grossly degraded connectivity to Cloudflare's edge — this is why the failure rate jumped from an intermittent ~30% to a sustained ~68%+ with many consecutive 502s in a row, a pattern never seen before this change (previously 502s were isolated single events between long strings of 200 OKs; now they cluster in long unbroken runs, exactly matching a tunnel that keeps failing to establish rather than one hitting an occasional timeout).

Return this as the confirmed regression root cause: an invalid/misapplied cloudflared CLI flag broke tunnel startup, and the database pooling fix from the previous remediation cycle is very likely working correctly but is now irrelevant because the tunnel itself cannot reliably reach the origin at all.
```

---

## Task 1 — Confirm cloudflared Container State Directly

```text
You are a Principal SRE confirming the exact failure state of the soc-cloudflared-edge container before touching any configuration.

1. Run `docker ps -a --filter name=soc-cloudflared-edge` and check the STATUS column — determine if the container is in a restart loop (rapidly cycling Restarting/Exited), stuck in "Exited" permanently, or "Up" but non-functional.
2. Run `docker logs soc-cloudflared-edge --tail 100` and confirm whether the most recent output is the CLI help dump (confirming argument parse failure) or normal tunnel operation logs (which would suggest a different, transient cause) — do not assume, verify directly against current logs.
3. Run `docker inspect soc-cloudflared-edge --format='{{.RestartCount}}'` to quantify how many times it has restarted since the docker-compose.yml change was applied — a high, rapidly climbing count confirms the crash-loop theory.
4. Cross-reference the exact command array currently defined in docker-compose.yml for the cloudflared service, character by character, against cloudflared's actual accepted syntax for `tunnel run` to identify precisely which flag or flag ordering is invalid.

Return the exact confirmed state (restart-looping / permanently exited / other) and the specific invalid flag or malformed command line identified.
```

---

## Task 2 — Correct the cloudflared Configuration Properly

```text
You are a Principal SRE fixing the cloudflared configuration correctly, moving connection timeout tuning to where it actually belongs instead of as invalid top-level CLI flags.

1. Remove `--connect-timeout 30s` and `--keep-alive-timeout 90s` entirely from the docker-compose.yml command/args for cloudflared — these are not valid flags for tuning origin connectivity from the `tunnel run` command line in this context.
2. Move origin connection timeout tuning into the tunnel's ingress configuration instead, via either:
   a. A config.yml mounted into the container with an `originRequest` block:
      ```yaml
      ingress:
        - hostname: socanalyst.raymundgerardestaca.dev
          service: http://soc-nginx-proxy:80
          originRequest:
            connectTimeout: 30s
            tcpKeepAlive: 30s
            keepAliveTimeout: 90s
            keepAliveConnections: 100
        - service: http_status:404
      ```
   b. Or, if using a dashboard-managed (remotely configured) tunnel, set these same values under Zero Trust > Networks > Tunnels > [tunnel] > Public Hostname > Additional application settings > Origin configuration — do not attempt to pass them as CLI flags when the tunnel is dashboard-managed, since dashboard-managed tunnels source their ingress config remotely, not from local CLI arguments.
3. Keep only the flags confirmed valid from the help output for the `tunnel run` command: `--retries 5` and `--grace-period 15s` may remain as CLI flags since they appear in the valid flag list shown in the logs — but verify each is placed correctly (after `tunnel run <tunnel-name>` or per your existing invocation pattern) and test in isolation first.
4. Test the corrected command locally (`docker compose run --rm cloudflared tunnel run --retries 5 --grace-period 15s <tunnel-name>` or equivalent) BEFORE deploying via compose up, to confirm cloudflared starts normally and prints the connectivity precheck + "Registered tunnel connection" logs rather than the help dump.

Return the corrected docker-compose.yml cloudflared service definition and, if applicable, the new config.yml content with the originRequest block.
```

---

## Task 3 — Add a Guardrail So Invalid CLI Flags Never Silently Break the Tunnel Again

```text
You are a Principal SRE adding a startup validation guardrail so an invalid cloudflared flag can never again cause a silent, hard-to-diagnose regression.

1. Add a healthcheck to the cloudflared service in docker-compose.yml that checks for actual tunnel connectivity (e.g., querying cloudflared's local metrics endpoint at http://localhost:METRICS_PORT/ready, which cloudflared exposes specifically for this purpose) rather than assuming the container is healthy just because it is "Up".
2. Set `restart: unless-stopped` behavior to be paired with the new healthcheck so Docker/monitoring can clearly surface "cloudflared is Up but Unhealthy" instead of it silently crash-looping while other containers report normal.
3. Add a pre-deploy validation step (a simple shell check in your deploy script or Makefile) that runs `cloudflared tunnel --help` argument validation, or simply runs the exact configured command with `--dry-run`-equivalent behavior if supported, before applying any docker-compose.yml change that touches the cloudflared command/args — catching invalid flags before they reach a running deployment.
4. Update the incident closure report (scratch/incident_closure_report.md) to explicitly log this regression as a distinct incident from the original DB pooling fix, since conflating them would hide the fact that the pooling fix itself may be entirely correct and just needs the tunnel restored to validate it.

Return the healthcheck definition and the pre-deploy validation check.
```

---

## Task 4 — Re-Validate the Original Database Pooling Fix Once the Tunnel Is Restored

```text
You are a Principal SRE re-validating whether the original asyncpg connection pooling fix (Deps.py, main.py, Metrics.py) actually resolved the original ~3000ms timeout pattern, since that fix could not be properly evaluated while cloudflared itself was broken.

1. Once Task 2's corrected cloudflared configuration is deployed and confirmed healthy (Task 1's verification steps show normal tunnel logs, not help dumps), run the uptime logger for a fresh 2-hour window.
2. Confirm two things independently:
   a. No more clustering of 502s at the ~3000ms latency ceiling that was the original symptom (validates the DB pooling fix).
   b. No more long unbroken runs of consecutive 502s (validates the cloudflared configuration fix).
3. If 502s still occur but are now isolated and rare (not clustered, not consecutive), the DB pooling fix is working and any remaining issue is a separate, smaller-magnitude problem to investigate fresh — do not assume the pooling fix failed just because this cloudflared regression temporarily masked its effectiveness.
4. Update the incident closure report with a clear timeline: Original incident (DB pool exhaustion, ~3000ms ceiling) -> Fix applied -> Regression incident (cloudflared invalid CLI flags, sustained high failure) -> Regression fix applied -> Final validation.

Return the final validation results and the corrected, timeline-accurate incident closure report.
```

---

## Why This Is a Regression, Not a Continuation of the Original Bug

| Signal | Before (Original Incident) | After (This Regression) |
|---|---|---|
| Failure rate | ~31% (518-542/770-800) | ~68%+ (602/870-890) |
| 502 pattern | Isolated, single events between long strings of 200 OK | Long unbroken consecutive runs of 502s |
| Latency signature | Clean ~2500-3100ms ceiling, then success | Same ceiling present, but far more frequent AND some very fast failures (399ms, 426ms) mixed in — a NEW signature |
| cloudflared logs | Normal precheck + "Registered tunnel connection" | CLI help/usage dump — parse failure, not runtime behavior |
| Root cause | soc-backend created a new DB connection per request (no pooling) | Invalid CLI flags (`--connect-timeout`, `--keep-alive-timeout`) broke `tunnel run` startup |

The appearance of very fast failures (399ms, 426ms) mixed with the original ~3000ms ones is itself confirmation that a second, different failure mode was introduced on top of the first — a tunnel that cannot connect at all fails fast, while a tunnel hitting the origin timeout ceiling fails slow. Both patterns appearing together confirms two simultaneous problems, not one worsening problem.

---

## Recommended Immediate Next Step

Do not attempt any further application-level tuning until Task 1 and Task 2 are complete — confirm the cloudflared container's actual state via `docker logs`/`docker ps`, remove the invalid `--connect-timeout`/`--keep-alive-timeout` CLI flags, move that tuning into the tunnel's `originRequest` ingress config instead, and redeploy. The database pooling fix from the previous cycle should be left untouched and re-evaluated only after the tunnel itself is confirmed to be starting and running normally again.
