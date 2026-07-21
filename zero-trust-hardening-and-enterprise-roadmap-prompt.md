# Principal Platform Architect Prompt — Zero-Trust Hardening & Staged Path to Enterprise Architecture

This document reconciles two artifacts already produced for this project: the immediate, actionable **Multi-Service Orchestration & Zero-Trust Security Plan** (Docker Compose-scoped) and the aspirational **Enterprise Architecture & Distributed Orchestration Study** (Kubernetes/Istio/Kafka-scoped). Rather than treating these as competing plans, this prompt defines how to execute the Zero-Trust plan correctly right now, on the current docker-compose.yml, while explicitly staging the enterprise-scale concepts as a documented future path — so nothing in the current stack contradicts or blocks the eventual migration.

---

## 1. Resolving the Open Question: Webhook Routing

```text
You are a Principal Platform Architect resolving the open question: should core-ingest:8080 remain directly publicly reachable for third-party webhooks, or should all webhook traffic route through soc-frontend (Nginx) first?

Decision: Route all webhook traffic through Nginx. Do not expose core-ingest directly to public-ingress under any circumstance, for three concrete reasons specific to this stack:
1. core-ingest currently has no WAF, no centralized rate limiting, and no TLS termination of its own — Nginx already provides all three and is the only component in this architecture designed to face the public internet.
2. The Zero-Trust plan's own network segmentation goal (soc-frontend as the only bridge between public-ingress and internal-mesh) is violated the moment core-ingest keeps a public-ingress binding for "webhook convenience" — this single exception undermines the entire segmentation model.
3. Third-party webhook providers (e.g., threat intel feeds, SIEM integrations) universally support a single HTTPS endpoint with a path-based route (e.g., https://socanalyst.raymundgerardestaca.dev/ingest/webhook/{provider}) — there is no technical requirement for them to reach core-ingest's raw port directly.

Your task:
1. Update the Nginx configuration to add a dedicated /ingest/ location block that proxies to core-ingest:8080 over internal-mesh only, with its own limit_req_zone (strict burst control, as already specified in the Zero-Trust plan).
2. Remove any public-ingress binding from core-ingest entirely — it must only be reachable via internal-mesh, from soc-frontend.
3. Document this decision as an ADR (architecture decision record) so future engineers do not "temporarily" re-expose core-ingest for a new webhook integration without going through Nginx first.

Return the finalized Nginx /ingest/ location block and the ADR entry.
```

---

## 2. Immediate Hardening — Correcting and Completing the Zero-Trust Plan

The original Zero-Trust plan is directionally correct but has three precision gaps that must be closed before implementation, plus one sequencing risk that must be managed carefully.

```text
You are a Principal Security Engineer and DevOps Engineer implementing and correcting the Multi-Service Orchestration & Zero-Trust Security Plan against the current docker-compose.yml.

Gaps to close before implementation:

1. Healthcheck dependency breakage risk: soc-backend and core-ingest currently participate in docker-compose healthcheck/depends_on chains involving soc-frontend, postgres, and clickhouse-server. Removing public-ingress from soc-backend and core-ingest must NOT remove their internal-mesh connectivity to postgres and clickhouse-server — verify explicitly that internal-mesh remains attached to soc-backend, core-ingest, postgres, and clickhouse-server, and that only the public-ingress removal is scoped to soc-backend and core-ingest, not internal-mesh.

2. cloudflared dependency chain: cloudflared currently depends_on soc-frontend (service_healthy) and connects only via public-ingress to reach soc-nginx-proxy. Confirm this remains completely unaffected by the segmentation change, since cloudflared must never be granted internal-mesh access — it should only ever reach the Nginx edge, exactly as today.

3. Local development breakage — provide a mitigation, not just a warning: the plan correctly warns that direct access to ports 8000/8080 will break if you bypass Nginx during local testing. Instead of just accepting this friction, implement a docker-compose.dev.yml override (the repo already has this file) that selectively re-attaches public-ingress or exposes ports 8000/8080 to localhost ONLY in the dev compose file, never in the production docker-compose.yml, so production segmentation is never weakened for local convenience.

4. Service-to-service authentication mechanism precision: the plan says "Implement an internal service API Key validation" but does not specify how the key is provisioned, rotated, or where it is stored. Specify explicitly:
   a. Generate a shared internal API key (or better, per-service key pairs) and inject via .env / Docker secrets, never hardcoded.
   b. core-ingest must send this key as a header (e.g., X-Internal-Service-Key) on every gRPC/HTTP call to soc-backend.
   c. soc-backend must validate this header before processing any request that did NOT originate from an authenticated analyst session (i.e., service-to-service calls, distinct from analyst-originated API calls which use the HttpOnly session cookie).
   d. Define a rotation procedure (even if manual for now): document how to rotate this key without downtime (e.g., accept both old and new key for a grace window).

Return the corrected docker-compose.yml network assignments, the docker-compose.dev.yml override additions, and the internal service API key validation implementation in both api_routes.py (Python) and the Go HTTP/gRPC server (core-ingest).
```

---

## 3. Edge Rate Limiting & WAF — Precise Nginx Configuration

```text
You are a Principal Nginx/Edge Engineer implementing the rate limiting and WAF layer specified in the Zero-Trust plan with exact, testable configuration.

Your tasks:
1. Define three distinct limit_req_zone directives in nginx.conf's http block:
   - zone=frontend_zone:10m rate=50r/s (general UI asset/page requests)
   - zone=api_zone:10m rate=10r/s (authenticated /api/ calls)
   - zone=ingest_zone:10m rate=5r/s with a defined burst (e.g., burst=10 nodelay) for /ingest/ webhook traffic, since this is the most abuse-prone entry point.
2. Apply limit_req with an explicit zone and burst value inside each corresponding location block, and configure limit_req_status 429 so rate-limited clients receive a clear, testable 429 rather than a generic connection drop.
3. Add a limit_conn_zone (e.g., limit_conn_zone $binary_remote_addr zone=conn_limit:10m; limit_conn conn_limit 20;) to cap concurrent connections per IP, mitigating connection-exhaustion attacks distinct from request-rate attacks.
4. Add baseline WAF-style protections directly in Nginx even without a dedicated WAF module: block common exploit path patterns (e.g., /.env, /.git, /wp-admin) with explicit deny rules, and set security headers (X-Content-Type-Options, X-Frame-Options, Content-Security-Policy scoped to your own asset origins) on all responses.
5. Ensure rate-limit responses are logged with enough detail (client IP, requested path, zone that triggered the limit) to distinguish a legitimate burst from a DDoS pattern during incident review.

Return the complete updated nginx.conf http block and location blocks with all three zones applied correctly to their respective paths.
```

---

## 4. Container Resource Quotas & Non-Root Execution — Exact Values

```text
You are a Principal DevOps Engineer applying concrete resource quotas and non-root execution to every service in docker-compose.yml, replacing the plan's general statement with exact configuration.

Your tasks:
1. For each service (soc-nginx-proxy, soc-python-ai-backend, soc-go-ingest-core, postgres, clickhouse-server, cloudflared), add explicit deploy.resources.limits and reservations (cpus and memory) sized to that service's actual role — e.g., clickhouse-server and postgres need materially more memory than core-ingest; do not apply a uniform limit across all services without justification.
2. Confirm or add a non-root USER directive in Dockerfile.go, Dockerfile.python, and Dockerfile.react — cloudflared already runs as user 65532:65532 per the existing compose file; bring the other three Dockerfiles to the same standard explicitly, verifying with `docker exec <container> whoami` that no container runs as root or UID 0.
3. Add `read_only: true` filesystem mode to containers that do not need to write to their own filesystem at runtime (evaluate case by case — e.g., core-ingest and soc-backend may need a writable /tmp or /app/state, in which case mount that specific path as a tmpfs or named volume while keeping the rest of the filesystem read-only).
4. Add `cap_drop: [ALL]` and only re-add the specific Linux capabilities each service actually requires (most application containers require none beyond default), reducing kernel-level attack surface further than resource quotas alone.
5. Verify under a stress test (e.g., a deliberate fork-bomb or memory-leak simulation inside one container) that the resource limits actually stop that single container from starving CPU/memory from its sibling containers on the same host.

Return the complete resource-limited, non-root, capability-dropped service definitions for all six services in docker-compose.yml.
```

---

## 5. Verification Plan — Precise and Automatable

```text
You are a Principal QA Engineer converting the Zero-Trust plan's verification plan into precise, scriptable test cases.

Test cases:
1. Direct backend access blocked: `curl -m 3 http://localhost:8000/api/health` and `curl -m 3 http://localhost:8080/health` from the host must both fail with connection refused/timeout — write this as a shell script asserting non-zero curl exit code.
2. Edge access works: `curl -I http://localhost/api/health` (via Nginx) must return 200 — assert exact status code.
3. Webhook routing works exclusively via Nginx: `curl -I http://localhost/ingest/webhook/test` must reach core-ingest through Nginx; direct `curl http://localhost:8080/webhook/test` must fail per test case 1.
4. Rate limiting: script a burst of 100 requests within 2 seconds against /api/ and assert that a defined percentage return HTTP 429, with the exact threshold documented (e.g., "requests beyond the 10r/s + burst allowance return 429").
5. Service-to-service auth: send a request to soc-backend's internal-only endpoint without the X-Internal-Service-Key header and assert it is rejected (401/403); send it with a valid key and assert success; send it with an expired/rotated-out key and assert rejection.
6. Non-root enforcement: for each of the six services, run `docker exec <container> whoami` (or `id -u`) and assert the result is never root/0.
7. Resource quota enforcement: run a stress test inside one container (e.g., `stress-ng` or a simple memory-allocation loop) and confirm via `docker stats` that the container is capped at its configured limit and does not degrade sibling containers.
8. Network segmentation proof: run `docker inspect soc-python-ai-backend` and `docker inspect soc-go-ingest-core` and assert neither has public-ingress in its Networks list; run the same for soc-nginx-proxy and assert it has both public-ingress and internal-mesh.

Return an executable verification script (bash) implementing all eight test cases with clear pass/fail output per case.
```

---

## 6. Staged Path to the Enterprise Reference Architecture

The Enterprise Architecture Study is directionally correct as a long-term target, but applying Kubernetes, Istio, Kafka, and Vault all at once to the current single-host Docker Compose stack would be premature and operationally risky. Sequence the migration instead.

```text
You are a Principal Platform Architect defining a staged, low-risk migration path from the current Docker Compose Zero-Trust setup toward the Enterprise Reference Architecture, ensuring each stage is independently valuable and does not require the next stage to already exist.

Stage 1 (current, in progress): Docker Compose Zero-Trust hardening — network segmentation, service-to-service API keys, Nginx rate limiting/WAF, resource quotas, non-root execution. This must be fully verified (Section 5) before any Stage 2 work begins.

Stage 2 — Observability foundation (do this before orchestration migration, not after):
1. Introduce OpenTelemetry instrumentation in core-ingest (Go) and soc-backend (Python) now, while the topology is still simple, generating a W3C Trace-ID at the Nginx edge and propagating it through every service.
2. Stand up a lightweight OTel Collector + Prometheus + Loki (or continue with the existing prometheus.yml, extending it) on the current single host — this validates the observability model before it needs to scale across multiple nodes.
Rationale: adding tracing after a Kubernetes migration is much harder to retrofit correctly than building it into the current, simpler topology first.

Stage 3 — Message queue introduction (before Kubernetes, not after):
1. Introduce a single RabbitMQ or Kafka instance (start with RabbitMQ for lower operational complexity given current team size) between core-ingest's webhook ingestion and soc-backend's processing, so webhook payloads are durably queued instead of directly HTTP-called.
2. Verify this eliminates data loss during a soc-backend restart/outage (kill soc-backend mid-load-test and confirm queued messages are processed on recovery, not dropped).
Rationale: this directly improves reliability on the current single-host setup and is a prerequisite for any future Kafka-based multi-region design — building it now means Stage 5 orchestration migration does not have to solve reliability and orchestration simultaneously.

Stage 4 — Secrets management (before multi-node, while still single-host):
1. Introduce HashiCorp Vault (or a simpler managed secrets manager if Vault's operational overhead is not justified yet at current scale) to replace static .env-based database passwords and the internal service API key from Section 2.
2. Verify credentials are short-lived and rotate automatically without requiring a full docker-compose restart.

Stage 5 — Orchestration migration (Kubernetes or Nomad), only after Stages 1-4 are stable:
1. Choose based on team size and operational maturity: Nomad if the team is small and wants simpler operations; Kubernetes if multi-cloud portability and ecosystem breadth are priorities.
2. Migrate service definitions from docker-compose.yml to Kubernetes manifests/Helm charts (or Nomad job files) preserving the exact network segmentation, resource quotas, and non-root policies already proven in Stage 1 — do not relax any Zero-Trust control during migration for convenience.
3. Only introduce a service mesh (Istio/Linkerd) once basic Kubernetes scheduling and service discovery are stable and understood by the team — mTLS via a mesh is an enhancement on top of working orchestration, not a prerequisite for it.

Stage 6 — Multi-region/hybrid cloud (only if/when actual scale or compliance requirements demand it):
1. Evaluate hybrid networking (Direct Connect/ExpressRoute) and cross-cluster service discovery (Consul/Cilium Cluster Mesh) only once single-cluster Kubernetes operations are mature.
2. This stage should be treated as speculative and not built until a concrete multi-region requirement exists (e.g., data residency law, GPU capacity constraints), since building it prematurely adds operational burden with no current benefit.

Return this staged roadmap as a markdown table: Stage | Goal | Key Deliverables | Exit Criteria (what must be true before moving to the next stage) | Estimated Risk if Skipped.
```

---

## 7. Reconciling a Contradiction Between the Two Documents

```text
You are a Principal Platform Architect resolving a direct contradiction between the Zero-Trust plan and the Enterprise Architecture Study before any engineer gets confused by conflicting guidance.

The contradiction: the Zero-Trust plan assumes core-ingest may need a direct public-ingress binding for webhooks ("unless webhooks explicitly require external port bindings, in which case we map them through Nginx" — note this phrasing itself is ambiguous). The Enterprise Architecture Study's reference topology shows ALL ingress passing through a single Nginx Ingress/API Gateway node, with no direct external path to core-ingest at all.

Resolution: the Enterprise Architecture Study's model is correct and must be the standard applied today, not just at enterprise scale. Update the Zero-Trust plan's language to remove the ambiguous exception entirely — core-ingest never has a public-ingress binding, at any scale, from Stage 1 onward. This was already decided in Section 1 of this document; this section exists specifically to ensure the ambiguous phrasing in the original plan is corrected so it cannot be misread later as permission to reintroduce direct exposure "temporarily" for a new integration.

Return a single corrected paragraph replacing the ambiguous webhook clause in the original Zero-Trust plan document, plus a note in the ADR log referencing this resolution.
```

---

## 8. Final Deliverables Checklist

| Deliverable | Section | Verifies |
|---|---|---|
| Nginx /ingest/ webhook routing + ADR | 1 | No direct public exposure of core-ingest |
| Corrected docker-compose.yml network assignments | 2 | internal-mesh preserved for DB access, public-ingress fully removed from backend/ingest |
| docker-compose.dev.yml local-access override | 2 | Local testing convenience without weakening production |
| Internal service API key implementation (Go + Python) | 2 | Service-to-service authentication |
| Updated nginx.conf with 3 rate-limit zones + WAF headers | 3 | Edge protection |
| Resource-limited, non-root, capability-dropped compose services | 4 | Container hardening |
| Executable bash verification script (8 test cases) | 5 | Automatable proof of Zero-Trust posture |
| Staged migration roadmap table | 6 | Safe, sequenced path to enterprise architecture |
| Corrected webhook clause + ADR entry | 7 | Elimination of contradictory guidance between planning docs |

---

## 9. Recommended Immediate Next Step

Execute Sections 1 through 5 first against the current `docker-compose.yml` and `nginx.conf` — this is fully achievable on the existing single-host setup and closes real, present security gaps (public-ingress exposure of backend services, unauthenticated service-to-service calls, no rate limiting). Do not begin Stage 2 (observability) or any Kubernetes/Istio/Kafka work from the Enterprise Architecture Study until the Section 5 verification script passes every test case — the enterprise-scale concepts are correct as a future direction but are not a substitute for finishing the fundamentals on the stack that is actually running today.
