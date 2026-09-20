# Principal Engineer Prompt — Redesigning the Test & Architecture Workflow for a Polyglot SIEM/SOAR Monorepo

## 1. Current State Assessment (What You Already Did Right)

```text
You are a Principal Engineer reviewing the current repo + test layout for a hybrid SIEM/SOAR monorepo containing:
- soc-backend (Python / FastAPI / LangGraph)
- core-ingest (Go / gRPC)
- soc-frontend (React/Vite)
- deploy/ (Docker, Nginx, ClickHouse, Postgres, Prometheus)
- shared-proto/ (gRPC proto contracts)
- tests/ (root-level e2e, integration, regression, api, orchestration)

Your first task is to acknowledge what is already correct and should NOT be torn down:

1. There is already a root-level tests/ directory with:
   - e2e/ (Playwright) hitting the live browser.
   - integration/ (test_pipeline.py) validating cross-service flows.
   - regression/ (test_502_reproduction.py) locking in fixes for Cloudflare incidents.
   - api/ (test_health.py) for basic contract checks.
   - orchestration/run_all_tests.sh as a global test harness.

2. Each major service already has its own local unit tests:
   - soc-backend/tests/unit/ for Python.
   - core-ingest/tests/unit/ for Go.
   - soc-frontend/tests/unit/ with Vitest + React Testing Library.

3. There is a clear separation between deploy/ infra (docker-compose, Nginx, Prometheus) and service source code, which is good — infra and app code are not intermingled.

Conclusion: the general direction is correct — root-level orchestration + per-service unit tests is the right baseline. The goal is not to replace this but to evolve it into a deliberate, object-oriented, system-design-friendly testing workflow that mirrors your actual architecture.
```

---

## 2. Introduce an Architecture-First Test Taxonomy (Map Tests to System Design, Not Just Tools)

```text
You are a Principal System Designer aligning the test layout with the actual system architecture layers, not just by test runner type.

Refine the testing taxonomy to match these architectural layers:

1. Domain-level tests (per service):
   - Validate pure domain logic (policy engine, playbook registry, correlation rules, LLM triage rules) with no I/O.
   - Directory pattern: `<service>/tests/domain/` in addition to `<service>/tests/unit/` where `unit` is low-level, `domain` expresses business rules/OOP concepts explicitly.

2. Service-level tests (per service):
   - Validate each service boundary in isolation: FastAPI routers with DB mocked, Go gRPC handlers with fake repositories, React feature modules with mocked API client.
   - Directory pattern: `<service>/tests/service/` (or `<service>/tests/integration/`) distinct from domain-only tests.

3. Cross-service integration tests (root-level):
   - Validate Nginx → soc-backend → Postgres, core-ingest → ClickHouse, and LLM agent orchestration flows.
   - Reside under `tests/integration/` but grouped by scenario (e.g., `tests/integration/siem_to_soar/`, `tests/integration/agent_pipeline/`).

4. End-to-end tests (root-level e2e/):
   - Validate analyst workflows across the browser, CommandCenter, InvestigationGraph, NetworkMap, and agent operations.

5. Non-functional tests (root-level performance/chaos):
   - Add `tests/performance/` and `tests/chaos/` in the future to simulate load (e.g., high alert ingestion) and failure injection (e.g., core-ingest down, LLM provider unavailable).

Return a mapping table where each architectural layer (Domain, Service, Cross-service, E2E, Non-functional) maps to concrete existing or planned directories in this repo.
```

---

## 3. Refactor the Root tests/ Layout to Reflect Architecture

```text
You are a Principal Engineer refactoring the root tests/ directory to better express the architecture, while preserving all existing tests.

Target structure:

/tests
  /e2e
    - playwright.config.ts
    /tests
      - dashboard.spec.ts              # Analyst workflows
  /integration
    /siem_to_soar
      - test_pipeline.py               # core-ingest → soc-backend → DB
    /infra
      - test_nginx_routing.py          # Nginx → backend health and routing
  /api
    - test_health.py                   # Basic REST/gRPC contracts
  /regression
    - test_502_reproduction.py         # Locked-in Cloudflare tunnel bug
  /orchestration
    - run_all_tests.sh                 # Global orchestration entrypoint
  /performance
    - test_ingest_throughput.py        # (planned) load-focused tests
  /chaos
    - test_core_ingest_failure.py      # (planned) resilience tests

Refactor plan:
1. Move `tests/integration/test_pipeline.py` into `tests/integration/siem_to_soar/test_pipeline.py` (no behavior change, just clearer grouping).
2. Keep `tests/regression/test_502_reproduction.py` as-is, but ensure naming convention `test_<incident-id>_<short_description>.py` so multiple incidents can be added over time.
3. Keep `tests/api/test_health.py` as-is; later add additional files for specific contracts (e.g., `test_endpoints_register.py`).
4. Create empty placeholder files for `tests/performance/` and `tests/chaos/` so the structure is ready when you add load and chaos tests.

Return this refactored tree and a short script (bash or Makefile target) to migrate any moved files.
```

---

## 4. Strengthen Per-Service Test Layout With OOP-Aligned Folders

```text
You are a Principal Backend Architect making each service's test layout reflect its internal object-oriented design and system boundaries.

For soc-backend (Python):
1. Under `soc-backend/tests/` introduce:
   - `/domain` for pure domain objects: Auth.Identity, Investigations.Agents, Playbooks.Registry, Policy.Engine, MachineLearningInference.*. These tests import directly from Domain/* and MachineLearningInference/* without touching FastAPI or DB — they validate business rules and agent orchestration logic in isolation.
   - `/service` for FastAPI routers and service-layer glue (Interfaces/api_routes.py, auth.py, etc.), using pytest fixtures and FastAPI's TestClient but mocking repositories and external services.
   - Keep `/unit` for very small low-level helpers that do not belong to a domain concept.

For core-ingest (Go):
2. Under `core-ingest/tests/` introduce:
   - `/domain` tests targeting cdm_parser.go, correlation.go, tenant_registry.go as pure functions and structs, independent of database or gRPC.
   - `/service` tests for gRPC handlers, database.go, metrics.go — using test containers or mocks as needed.
   - `*_test.go` remain next to their source files for go test discovery, but you conceptually group them via package naming and test file naming (`parser_domain_test.go`, `grpc_service_test.go`).

For soc-frontend (React):
3. Under `soc-frontend/tests/` keep `/unit` but conceptually align tests to feature boundaries:
   - tests for CommandCenter, InvestigationDashboard, NetworkMapPage go into `soc-frontend/tests/unit/features/` or use a colocated pattern under `src/features/*/__tests__` (already partially present with apiClient and hooks tests).
   - Ensure each major UI feature (CommandCenter, NetworkMap, WarRoom) has: a render test, an interaction test, and at least one regression test tied to a historical incident (e.g., "NetworkMap not visible" → regression test to ensure at least one node is visible and zoom/pan work).

Return a short OOP-oriented mapping from Domain objects → their test file locations for soc-backend and core-ingest.
```

---

## 5. Make run_all_tests.sh a First-Class Orchestrator (System Test Runner)

```text
You are a Principal SRE/Platform Engineer turning tests/orchestration/run_all_tests.sh into a deterministic, debuggable orchestrator that mirrors the system design and supports selective focus.

Upgrade the script to:

1. Accept a MODE argument: `./tests/orchestration/run_all_tests.sh [unit|service|integration|e2e|full]`.
   - unit: run per-service unit + domain tests only (fast feedback for devs).
   - service: add service-level tests (routers, gRPC handlers) with mocked dependencies.
   - integration: spin up docker-compose.dev.yml (or a dedicated docker-compose.test.yml) and run tests/integration + tests/api.
   - e2e: run Playwright e2e tests against a running stack.
   - full: run everything above + regression + (later) performance/chaos.

2. For integration/e2e/full:
   - Bring up a dedicated test stack via `docker-compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.test.override.yml up -d` so tests do not interfere with your dev stack.
   - Wait for health checks on soc-backend, soc-frontend, core-ingest, Postgres, ClickHouse using curl/wget health endpoints before starting tests.

3. Emit a simple structured log and exit codes:
   - Prefix each phase with `[UNIT]`, `[SERVICE]`, `[INTEGRATION]`, `[E2E]`, `[REGRESSION]` so CI logs are greppable.
   - Exit non-zero on the first failing phase when MODE=unit/service, but for MODE=full you may want to continue through all phases then aggregate status at the end.

4. Keep runtimes short for local dev:
   - Default MODE when omitted is `unit`, so `./tests/orchestration/run_all_tests.sh` is a fast local smoke test.

Return the revised script structure (pseudocode or bash) with clear phase separation and health-check gating.
```

---

## 6. Connect Tests to Architecture Docs and ADRs (Traceability)

```text
You are a Principal Architect adding traceability between tests and design/incident docs so future debugging is faster and more disciplined.

Your tasks:
1. For each ADR in deploy/ (ADR-001, ADR-002, ADR-003) and for major runbooks (RUNBOOK-502-incident.md, verify_zero_trust.sh), ensure there is at least one associated test case in tests/ whose docstring or comment references that ADR or runbook explicitly.
   - Example: tests/regression/test_502_reproduction.py includes "Linked ADR: ADR-003-http-agent-over-ssh.md" and "Linked Runbook: RUNBOOK-502-incident.md" in its module docstring.
   - Example: tests/api/test_endpoints_register.py references ADR-002 (PaaS-first orchestration) since that ADR defines the endpoint registration contract.

2. Create a simple markdown manifest `tests/TEST-CATALOG.md` listing:
   - Each major feature/decision (e.g., "Zero-Trust HTTP agent model", "Cloudflare tunnel 502 regression", "Agent Operations Panel")
   - The ADR/Runbook that defines it
   - The test files that validate it.

3. Update PLATFORM.md or docs/adr/scaling-and-deployment.md with a short "Testing Strategy" section that points to tests/TEST-CATALOG.md and explains how test layers map to architecture layers.

Return the initial TEST-CATALOG.md content covering at least: ADR-001, ADR-002, ADR-003, and the 502 regression runbook.
```

---

## 7. Apply Object-Oriented and System-Design Principles Explicitly

```text
You are a Principal Engineer ensuring that both the codebase and the tests exhibit explicit OO and system design discipline.

Enforce these principles across services and tests:

1. Encapsulation:
   - Domain objects in soc-backend (Auth.Identity, Policy.Engine, Playbooks.Registry, Investigations.Agents) expose clear methods and hide implementation details — tests target these methods rather than private internals.
   - Similarly, core-ingest exposes a small set of well-defined functions/structs for correlation/CDM parsing that tests use, rather than reaching deep into package internals.

2. Clear boundaries and contracts:
   - Interfaces/Http in soc-backend defines DTOs and shapes for each API; tests in tests/api validate these contracts, and any change to DTOs must be accompanied by updated tests and an ADR if it affects external behavior.
   - shared-proto/soc_service.proto defines the gRPC contract; core-ingest domain tests validate business logic, and service tests validate gRPC handlers match the proto expectations.

3. Single Responsibility for each test suite:
   - Unit/domain tests answer "does this class/function work?".
   - Service tests answer "does this service boundary behave correctly with its immediate dependencies?".
   - Integration tests answer "do these services work together across process boundaries?".
   - E2E tests answer "can an analyst complete this workflow in the browser?".

4. Observability built into tests:
   - For critical flows (enrollment, agent orchestration, Cloudflare tunnel health), tests assert not only on functional outcomes but also that key metrics/log entries are produced (e.g., audit logs written, Prometheus counters incremented) so you can debug production incidents with confidence that instrumentation exists.

Return a short checklist developers must follow when adding a new feature: required ADR, required domain tests, required service tests, required integration/e2e coverage, and where in the tree each goes.
```

---

## 8. Recommended Immediate Actions

```text
You are a Principal Engineer choosing the first three concrete steps to execute in this repo to move toward the redesigned testing and architecture workflow without causing disruption.

Prioritize:
1. Refactor tests/integration into a scenario-based structure (siem_to_soar, infra) and upgrade run_all_tests.sh to support MODE=unit|service|integration|e2e|full. This gives immediate leverage and better debuggability for your existing tests.
2. Add soc-backend/tests/domain/ with at least one domain-focused test suite (e.g., Policy.Engine or Playbooks.Registry) to establish the pattern for OO-aligned testing.
3. Create tests/TEST-CATALOG.md linking ADR-001/002/003 and the 502 runbook to their existing tests, so traceability starts now rather than retrofitting later.

Return these as a short actionable checklist with owners (even if the owner is just "you" for now) and rough time estimates (e.g., 2–4 hours each) to keep the work scoped and achievable.
```
