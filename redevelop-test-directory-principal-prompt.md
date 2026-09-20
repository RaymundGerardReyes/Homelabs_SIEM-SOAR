# Principal Engineer Prompt — Fixing the Actually-Broken Test Directory (Root Cause + Full Rebuild)

## Confirmed Diagnosis: The Cleanup Was Never Actually Executed

```text
You are a Principal Engineer auditing whether the previously "approved" test directory cleanup plan was actually executed, based on the current tree output.

Confirmed evidence of incomplete execution:

1. THE DUPLICATE FILE WAS NEVER DELETED.
   The plan explicitly stated: "I will remove the old tests/integration/test_pipeline.py because it was properly moved to tests/integration/siem_to_soar/test_pipeline.py." The current tree shows BOTH files still exist:
   tests/integration/test_pipeline.py
   tests/integration/siem_to_soar/test_pipeline.py
   This means either the same test now runs twice (silently duplicating coverage and wasting CI time), or worse, the two files have diverged and only one reflects the real pipeline behavior while the other is stale dead code nobody remembers to update.

2. NO ROOT-LEVEL tests/unit/ DIRECTORY EXISTS AT ALL.
   Despite building out api/, chaos/, e2e/, integration/, orchestration/, performance/, regression/, there is no tests/unit/ at the root. Per-service unit tests exist (soc-backend/tests/unit, core-ingest/tests/unit, soc-frontend/tests/unit) — but there is no root-level aggregation point that documents which unit suites exist across the whole system, meaning nobody can answer "what is our total unit test coverage" without manually visiting three different subfolders.

3. NO EXPLICIT CONTRACT/PATH TESTING EXISTS ANYWHERE.
   tests/api/test_health.py is a single file — there is no test validating the actual REST contract shapes (request/response schemas) for endpoints like /api/endpoints/register, /api/agents/tasks, /api/agents/tasks/{id}/result, or the gRPC contract defined in shared-proto/soc_service.proto. "API testing" was requested and approved but never implemented beyond a health check.

4. E2E COVERAGE IS A SINGLE FILE FOR THE ENTIRE PLATFORM.
   tests/e2e/tests/dashboard.spec.ts is the only E2E test in the entire repo. Given the platform includes CommandCenter, NetworkMapPage, InvestigationGraph, WarRoomPage, PlaybookSandbox, and IsolationControlsPage, a single dashboard spec cannot possibly validate these critical analyst workflows.

5. INTEGRATION COVERAGE IS SHALLOW AND UNBALANCED.
   Only two integration test files exist (test_nginx_routing.py, test_pipeline.py/siem_to_soar duplicate) despite the system spanning Nginx → core-ingest → soc-backend → Postgres → ClickHouse → LangGraph agents → Cloudflare Tunnel. There is no integration test for the agent orchestration pipeline, the endpoint registration/enrollment flow, or the correlation logic (cf_ray_id/client_ip) built in earlier phases.

6. NO ENFORCEMENT MECHANISM EXISTS TO PREVENT THIS FROM RECURRING.
   There is no CI check, pre-commit hook, or lint rule that would have caught the duplicate file or the missing unit/contract/e2e coverage before it was declared "done." This is the actual root cause: past plans described the target structure but had no automated guardrail confirming the structure was achieved and stayed achieved.

Return this diagnosis as the official incident record before any further rebuild work begins — the problem was never "the plan was wrong," it was that execution was not verified against the plan.
```

---

## Task 1 — Immediate Cleanup (No New Structure Until This Is Done)

```text
You are a Principal Engineer executing the exact, minimal cleanup required before any new test code is written.

1. Diff tests/integration/test_pipeline.py against tests/integration/siem_to_soar/test_pipeline.py line by line. If identical, delete tests/integration/test_pipeline.py immediately. If they have diverged, treat siem_to_soar/test_pipeline.py as canonical (it matches the approved architecture), manually port any missing assertions from the old file into it, then delete the old file — do not keep both under any circumstances.
2. Grep the entire tests/ tree and each service's tests/ tree for any other duplicate filenames (same basename in two different directories) and resolve each one using the same rule: one canonical location per test, determined by the architecture layer it belongs to.
3. Confirm deletion by re-running `tree tests/` and diffing it against the intended structure below — do not proceed to Task 2 until the tree matches exactly with zero duplicates.

Return the diff result and confirmation that exactly one test_pipeline.py exists in the entire tests/ tree.
```

---

## Task 2 — Establish the Missing Root-Level Unit Test Aggregation Layer

```text
You are a Principal Engineer creating the missing root-level unit test visibility layer, without duplicating the per-service unit tests that already correctly exist close to their source code.

1. Do NOT move soc-backend/tests/unit, core-ingest/tests/unit, or soc-frontend/tests/unit — per-service unit tests correctly live next to their source code and must stay there.
2. Create tests/unit/README.md as a manifest (not a duplicate test runner) that lists:
   - Every unit test file across all three services, with a one-line description of what class/function it covers.
   - A generated-or-maintained table with columns: Service | Test File | Covers | Last Verified Date.
3. Add a Makefile target `make test-unit-all` (or extend the existing root Makefile) that runs all three services' unit suites in sequence (pytest for soc-backend, go test ./... for core-ingest, vitest run for soc-frontend) and prints a combined pass/fail summary — this is the "root-level unit testing" capability that was actually missing, implemented as aggregation rather than duplication.

Return the tests/unit/README.md content and the Makefile target.
```

---

## Task 3 — Build Real API / Contract Testing (Currently Just a Health Check)

```text
You are a Principal Backend Engineer building actual API contract tests, since tests/api/ currently only contains a health check and nothing validating real request/response contracts.

Create the following files under tests/api/, one per contract surface:

1. tests/api/test_endpoints_register.py — validate POST /api/endpoints/register:
   - Valid payload (hostname, label, type, capabilities) returns 201 with an assigned id.
   - Missing required fields (hostname, type) returns 422 with a clear validation error, not a 500.
   - Invalid type value (not one of "local_cf_tunnel"|"iaas"|"paas") is rejected.
   - Request without valid Cloudflare Access headers/mTLS is rejected with 401/403 (per ADR-002/ADR-003).

2. tests/api/test_agents_tasks.py — validate GET /api/agents/tasks and POST /api/agents/tasks/{id}/result:
   - Polling with a valid endpoint_id returns a well-formed tasks array matching the agreed JSON schema (action, params, correlationId).
   - Posting a result for a non-existent task id returns 404, not a silent 200.
   - Posting a malformed result payload is rejected with a schema validation error.

3. tests/api/test_grpc_contract.py — validate the gRPC contract defined in shared-proto/soc_service.proto:
   - Use the generated soc_service_pb2/grpc stubs to call each RPC method against a running or mocked core-ingest service and assert response message shapes match the .proto definition exactly (field presence and types), catching any drift between core-ingest's Go implementation and the shared proto contract.

4. Add a `tests/api/schemas/` folder with JSON Schema files for each request/response shape referenced above, so contract tests validate against a single source of truth rather than embedding expected shapes inline in every test — any future API change requires updating the schema file, which naturally forces a conscious decision rather than silent drift.

Return the four test files and the schemas folder content, each test written to fail clearly (not silently pass) when the contract is violated.
```

---

## Task 4 — Expand End-to-End Coverage to Match Actual Platform Surface

```text
You are a Principal QA/Frontend Engineer expanding tests/e2e/ beyond the single dashboard.spec.ts, since the platform has at least seven analyst-facing workflows with zero E2E coverage.

Create one Playwright spec per critical workflow under tests/e2e/tests/:

1. command-center.spec.ts — login → land on Command Center → verify KPI tiles populate → verify at least one alert renders → click an alert → confirm navigation to Investigation page.
2. network-map.spec.ts — navigate to Network Map → verify at least one node is visible on initial load (regression guard for the exact bug just fixed) → verify scroll-zoom changes visible node scale → verify clicking a node opens the sidebar detail panel.
3. investigation-graph.spec.ts — open an investigation → verify InvestigationGraph renders nodes/edges → verify AgentChatWidget accepts input and displays a response.
4. playbook-sandbox.spec.ts — open Playbook Sandbox → run a sandboxed playbook → verify execution result renders without needing a live production action.
5. isolation-controls.spec.ts — navigate to Isolation Controls for a specific endpoint → verify the Two-Key Modal (TwoKeyModal) requires both confirmations before an isolation action is enabled, per the existing two-person-control safety design.
6. war-room.spec.ts — open War Room for an active incident → verify real-time updates render (mock or test WebSocket data) without requiring a full page reload.
7. asset-inventory.spec.ts — navigate to Asset Inventory → verify endpoint badges (Local/IaaS/PaaS) render correctly → verify deep-link to EdrLogsPage filtered for that endpoint works.

Each spec must assert on concrete, currently-broken-if-regressed behavior (e.g., "at least one node visible," "modal requires two confirmations") rather than only checking that a page loads without a JS error.

Return all seven spec files with the Playwright config updated to include them in CI.
```

---

## Task 5 — Deepen Integration Testing to Cover the Real Cross-Service Flows

```text
You are a Principal Systems Engineer expanding tests/integration/ to actually cover the architecture's critical cross-service paths, since only Nginx routing and one pipeline test currently exist.

Create these additional integration suites:

1. tests/integration/agent_pipeline/test_langgraph_orchestration.py — verify a simulated alert flows through soc-backend's LangGraph agents (triage → enrichment → investigation → response) end-to-end, asserting the correct sequence of agent events is emitted on /api/ws/agent/stream, and that a fallback to static_ruleset occurs correctly when the primary LLM provider is unavailable (mock the provider failure).
2. tests/integration/endpoint_lifecycle/test_enrollment_flow.py — verify the full one-time-token enrollment flow: request enrollment token → bootstrap script calls /api/endpoints/enroll → service credential issued → endpoint appears in inventory → enrollment token is rejected if reused (single-use enforcement).
3. tests/integration/correlation/test_cf_ray_correlation.py — verify that two log entries sharing the same cf_ray_id or client_ip across different endpoint_id values are correctly linked by the correlation engine and surfaced as a single attack-path entity, per the CDM correlation logic built earlier.
4. tests/integration/siem_to_soar/test_pipeline.py (existing, canonical) — confirm this still covers core-ingest → soc-backend → Postgres/ClickHouse and extend it with an assertion that ingested events are queryable via ClickHouse within an expected latency window.

Return all three new integration suites plus confirmation of the retained canonical pipeline test.
```

---

## Task 6 — Enforcement: Make This Structure Impossible to Silently Break Again

```text
You are a Principal Platform Engineer adding automated enforcement so the test directory structure cannot silently degrade again, since this is the second time a "cleanup" was approved but not fully executed.

1. Add a `tests/structure_check.py` (or a Makefile target `make verify-test-structure`) that:
   - Walks the tests/ tree and fails if any test filename appears more than once across different directories (catches the exact duplicate-file bug that just occurred).
   - Fails if any of the required top-level directories (unit, api, integration, e2e, regression, performance, chaos, orchestration) is missing.
   - Fails if tests/TEST-CATALOG.md references a test file path that does not actually exist on disk (catches documentation drift).
2. Wire this check into `tests/orchestration/run_all_tests.sh` as a mandatory first step before any test phase runs — if the structure check fails, no tests run at all, forcing structural issues to be fixed immediately rather than accumulating.
3. Add this same check as a pre-commit hook (or a required CI job) so a broken/duplicated test structure cannot be merged, regardless of what any implementation plan promised.

Return the structure_check script and its wiring into both run_all_tests.sh and CI/pre-commit.
```

---

## Target Directory (What "Done" Actually Looks Like)

```text
/tests
├── unit/
│   └── README.md                         # Aggregated manifest, not duplicate tests
├── api/
│   ├── test_health.py
│   ├── test_endpoints_register.py
│   ├── test_agents_tasks.py
│   ├── test_grpc_contract.py
│   └── schemas/
├── integration/
│   ├── infra/
│   │   └── test_nginx_routing.py
│   ├── siem_to_soar/
│   │   └── test_pipeline.py              # ONE canonical copy only
│   ├── agent_pipeline/
│   │   └── test_langgraph_orchestration.py
│   ├── endpoint_lifecycle/
│   │   └── test_enrollment_flow.py
│   └── correlation/
│       └── test_cf_ray_correlation.py
├── e2e/
│   ├── playwright.config.ts
│   └── tests/
│       ├── command-center.spec.ts
│       ├── network-map.spec.ts
│       ├── investigation-graph.spec.ts
│       ├── playbook-sandbox.spec.ts
│       ├── isolation-controls.spec.ts
│       ├── war-room.spec.ts
│       └── asset-inventory.spec.ts
├── regression/
│   └── test_502_reproduction.py
├── performance/
│   └── test_ingest_throughput.py
├── chaos/
│   └── test_core_ingest_failure.py
├── orchestration/
│   └── run_all_tests.sh                  # Runs structure_check.py first
├── structure_check.py                     # Enforcement gate
├── TEST-CATALOG.md
└── DEVELOPER_TESTING_GUIDE.md
```

---

## Execution Order (Do Not Skip Ahead)

| Order | Task | Why It Must Come First |
|---|---|---|
| 1 | Delete/reconcile the duplicate test_pipeline.py | New structure built on top of an unresolved duplicate just recreates the same problem |
| 2 | Add structure_check.py enforcement | Prevents any future step in this list from silently drifting again |
| 3 | Root-level unit test manifest + Makefile target | Cheapest, fastest win — no new test logic, just aggregation |
| 4 | Real API/contract tests | Currently a single health check is the weakest link for a system with many endpoint contracts |
| 5 | Expanded integration suites | Validates cross-service correctness before layering E2E on top |
| 6 | Expanded E2E suites | Most expensive to write/maintain — build once the underlying contracts are verified stable |

---

## Recommended Immediate Next Step

Execute Task 1 and Task 6 together first — delete the duplicate file and add the structure_check.py enforcement gate in the same pass, before writing any new test content. This directly prevents a third occurrence of "the plan was approved but execution silently left the repo in a broken state," which is the actual recurring failure here, not the specific missing test files.
