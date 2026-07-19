# Principal Engineer Prompt — Phase 7: Backend Contract Verification & Integration Hardening

This document defines the next mandatory phase after the claimed completion of the Frontend FSD Redevelopment (Phases 1-6). It exists because a "complete" declaration from an AI agent or engineer must never be accepted at face value — it must be independently verified against the real backend services (Python AI orchestration layer + Go ingestion core) before it is considered production-ready.

---

## Why This Phase Is Necessary

The frontend redevelopment plan assumed a set of REST/WebSocket contracts (`GET /api/metrics/overview`, `WS /ws/investigations/{id}`, `POST /api/endpoints/{id}/isolate`, etc.) that were **specified from the frontend side only**. Nothing in the prior phases confirmed that:

- These exact routes exist in `soc-backend` (Python/FastAPI) or `core-ingest` (Go).
- Response payload shapes match the TypeScript interfaces defined in `shared/types/`.
- WebSocket channels (`useWebSocketStream` targets) are actually implemented and emit the expected event schema.
- Destructive-action endpoints (isolation, rule-disable, session revocation) enforce the same risk-gating server-side that `TwoKeyModal` enforces client-side — a client-side-only safety gate is not a security control.

Given the earlier pattern in this project (hardcoded KPIs, fully mocked `ThreatIntelPanel`, dead Sidebar routes, missing pages) — all "invisible" until explicitly audited — the same rigor must now be applied to the claimed Phase 1-6 completion and to the frontend-backend boundary.

---

## Phase 7 Principal Engineer Prompt

```text
You are a Principal Full-Stack Engineer and Systems Integration Auditor responsible for verifying and hardening the contract between the newly redeveloped soc-frontend (React + TypeScript, FSD architecture) and the existing backend services: soc-backend (Python, FastAPI + LiteLLM Router + LangGraph agent orchestration) and core-ingest (Go stream ingestion engine), as defined in docker-compose.yml.

Context:
- The frontend team claims Phases 1-6 of the redevelopment plan are complete: shared foundation utilities, auth/layouts, investigations domain, playbooks domain, all 17 page routes, and cross-cutting QA.
- Every frontend feature/page prompt specified assumed backend endpoints (e.g., GET /api/metrics/overview, GET /api/investigations/{id}, WS /ws/investigations/{id}, POST /api/endpoints/{id}/isolate, GET /api/threat-intel/enrich, GET/POST /api/playbooks/*, GET /api/detection/*, GET /api/assets/*, GET /api/incidents/*, GET /api/marketplace/listings, GET/PATCH /api/settings) that were never confirmed against the real backend implementation.
- Do not trust the "complete" claim. Verify every integration point independently before accepting it as production-ready.

Your tasks:

1. **Endpoint inventory and gap matrix**
   - Enumerate every backend endpoint actually implemented in soc-backend (Python) and core-ingest (Go) — via route inspection (FastAPI's /openapi.json or /docs, and Go router definitions).
   - Cross-reference against every endpoint assumed by the frontend prompts.
   - Produce a gap matrix: MATCHED (exists, shape confirmed) / SHAPE-MISMATCH (exists, but response schema differs from frontend TypeScript types) / MISSING (frontend expects it, backend does not implement it) / ORPHANED (backend exposes it, frontend never calls it).

2. **Schema contract validation**
   - For every MATCHED or SHAPE-MISMATCH endpoint, diff the actual JSON response against the shared/types/ TypeScript interfaces (Alert, Investigation, ActionInfo, Playbook, Asset, Incident, ThreatIntelResult, SystemMetrics, User, Role).
   - Flag every field name, type, or nullability mismatch explicitly (e.g., backend returns `risk_level` but frontend expects `risk`; backend returns ISO date string but frontend expects epoch millis).
   - Recommend either a backend schema fix, a frontend adapter/mapper layer, or a shared OpenAPI-generated types package to eliminate future drift.

3. **WebSocket/streaming contract validation**
   - Confirm soc-backend actually exposes the WebSocket channels assumed by useWebSocketStream consumers: /ws/investigations/{id} (InvestigationDashboard, InvestigationGraph), playbook execution streaming (PlaybookSandbox), and any live-tail channel assumed by EdrLogsPage/WarRoomPage.
   - Verify the emitted event schema (agent log entries, node status transitions, playbook stdout lines) matches what the frontend expects to append/render.
   - Confirm the Go ingestion core's role: does it publish events consumed downstream by soc-backend before reaching the frontend, or does the frontend ever need to connect to core-ingest directly? Document the actual event flow (core-ingest -> soc-backend -> frontend) precisely, since this was previously ambiguous.

4. **Server-side enforcement of client-side safety gates**
   - For every action gated by TwoKeyModal on the frontend (host isolation, high-risk action approval, detection-rule disable, settings danger-zone), verify the corresponding backend endpoint independently enforces the same risk check, confirmation token, or approval workflow server-side.
   - Explicitly flag any endpoint where the backend would execute a destructive action from a bare API call without requiring the same confirmation the frontend enforces — this is a critical security gap since API clients can bypass the UI entirely.
   - Recommend a shared confirmation-token or two-person-approval mechanism enforced at the API layer, not just the UI layer.

5. **Auth/session contract validation**
   - Confirm soc-backend implements the endpoints ProtectedRoute/tokenService/Login now assume: POST /api/auth/login, GET /api/auth/session, POST /api/auth/logout, and the JWT claim structure (role/tier claim, exp claim) that Sidebar RBAC rendering and ProfilePage's JWT decoding depend on.
   - Verify whether the documented HttpOnly-cookie migration path (from the earlier ProtectedRoute security remediation) has any corresponding backend readiness, or whether it remains purely aspirational — state this explicitly either way.

6. **Load and failure-mode testing across the real stack**
   - With docker-compose up, exercise each MATCHED endpoint under realistic conditions: verify CommandCenter's usePolling/useWebSocketStream do not overwhelm soc-backend or core-ingest under sustained polling; verify PlaybookSandbox's streaming execution behaves correctly when a sandboxed script fails, hangs, or produces very large stdout volume.
   - Confirm graceful degradation: if core-ingest or clickhouse-server is temporarily unavailable, does soc-backend degrade cleanly (cached/partial data with a clear frontend error state) or cascade into a hard failure visible to the analyst as a blank page?

7. **Produce the final integration readiness report**
   - Deliver the gap matrix, schema contract diffs, WebSocket flow diagram (core-ingest -> soc-backend -> frontend), server-side enforcement audit results, and auth contract status.
   - Explicitly state a go/no-go recommendation: which pages/features are genuinely production-ready end-to-end, and which are frontend-complete but backend-incomplete (i.e., will render correctly against mocked data but fail or 404 against the real Python/Go services).

Do not accept the Phase 1-6 "complete" declaration as evidence of backend readiness. Verify each contract independently and report discrepancies precisely, including exact endpoint paths, expected vs. actual schema fields, and reproduction steps for any failure found.
```

---

## Sub-Prompt — Python Backend (soc-backend) Contract Audit

```text
You are a Principal Backend Engineer auditing soc-backend (FastAPI + LiteLLM Router + LangGraph agent orchestration) against the frontend's assumed API contract.

Your task:
1. Enumerate all currently implemented FastAPI routes via the auto-generated OpenAPI schema (/openapi.json) and compare against the full list of endpoints the frontend expects (metrics, investigations, threat-intel, playbooks, detection rules, assets, incidents, marketplace, settings, auth).
2. For each investigation-related endpoint, confirm the LangGraph agent state (stored in the langgraph_state volume) is correctly serialized into the Investigation/ActionInfo shapes the frontend consumes, including conversation_log entries and proposed_actions with risk levels.
3. Confirm the WebSocket handler for /ws/investigations/{id} streams agent state transitions in real time and correctly handles client disconnect/reconnect (matching the frontend's reconnect/backoff expectations) without leaking agent execution state across sessions.
4. Verify that any endpoint triggering a destructive action (isolate host, execute high-risk playbook step) independently validates a confirmation flag or two-key approval token in the request body, and rejects the action if it is missing, regardless of what the frontend UI enforces.
5. Confirm LiteLLM Router configuration (model routing, rate limiting, fallback behavior) does not silently degrade investigation quality under load, and that failures surface as explicit error states rather than malformed partial responses.

Return a findings report listing exact route paths verified, schema mismatches found, and any missing server-side enforcement of destructive-action confirmations.
```

---

## Sub-Prompt — Go Backend (core-ingest) Contract Audit

```text
You are a Principal Backend Engineer auditing core-ingest (Go stream ingestion engine) against the frontend and soc-backend's assumed data flow.

Your task:
1. Confirm the exact responsibilities of core-ingest's exposed ports: gRPC on 9090 (internal) and HTTP webhook ingestion on 8080 (public-facing via public-ingress network) as defined in docker-compose.yml.
2. Determine whether the frontend (CommandCenter metrics, alert feed) consumes core-ingest data directly, or exclusively through soc-backend as an intermediary — document the real data flow explicitly, since this was left ambiguous in the frontend redevelopment plan.
3. Verify how core-ingest writes to postgres (via DATABASE_URL) and clickhouse-server (via CLICKHOUSE_ADDRESS), and confirm the metrics SystemMetrics interface on the frontend (alertsScanned, eventsIngestGB24h, dataIngestTB24h, openIncidents, preventedEvents) can actually be derived from current ClickHouse/Postgres schemas — flag any metric with no corresponding backend aggregation query yet.
4. Confirm core-ingest's health/readiness behavior: does soc-frontend (Nginx) or soc-backend have any dependency on core-ingest being healthy before serving requests, and what happens to CommandCenter's live feed if core-ingest is temporarily down?
5. Validate that the HTTP webhook endpoint on port 8080 has appropriate authentication/validation (not an open unauthenticated ingestion endpoint reachable from public-ingress) given it is bound to the public-facing network per the compose file's own comment ("Bound to public ingress strictly for port 8080 routing").

Return a findings report on the real ingestion-to-frontend data flow, any exposed unauthenticated endpoints, and any SystemMetrics fields lacking backend aggregation support.
```

---

## Phase 7 Deliverables Checklist

| Deliverable | Owner | Verifies |
|---|---|---|
| Endpoint gap matrix (MATCHED/SHAPE-MISMATCH/MISSING/ORPHANED) | Full-Stack Integration Auditor | Frontend-backend contract alignment |
| Schema diff report vs shared/types/ | Full-Stack Integration Auditor | TypeScript interface accuracy |
| WebSocket flow diagram (core-ingest → soc-backend → frontend) | Go + Python Backend Engineers | Real-time streaming architecture |
| Server-side enforcement audit for all TwoKeyModal-gated actions | Python Backend Engineer | Security — no client-only safety gates |
| Auth/session contract confirmation (login, session, logout, JWT claims) | Python Backend Engineer | Auth integration correctness |
| Go ingestion data-flow and public-endpoint exposure audit | Go Backend Engineer | core-ingest security and metrics feasibility |
| Go/no-go production readiness report per feature/page | Principal Engineer (integration lead) | Final release decision |

---

## Recommended Immediate Next Step

Before writing any further frontend code, run the **Phase 7 Principal Engineer Prompt** above against the actual `soc-backend` and `core-ingest` codebases. Given the project's history of components that looked complete but were mocked or disconnected (Sidebar routes, ThreatIntelPanel, KPI values), the safest assumption is that some fraction of the 17 "complete" pages will surface as MISSING or SHAPE-MISMATCH once checked against the real Python/Go services — this phase exists specifically to find those gaps before an analyst finds them in production during a live incident.
