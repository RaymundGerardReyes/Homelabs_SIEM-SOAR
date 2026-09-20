# Test Traceability Catalog

This catalog maps Architectural Decision Records (ADRs), Runbooks, and UI Workflows to the specific test suites that validate their requirements.

| Feature / Decision | Defining Document | Validating Test Suites |
| :--- | :--- | :--- |
| **Zero-Trust HTTP Agent Model** | `deploy/ADR-003-http-agent-over-ssh.md` | `tests/integration/infra/test_nginx_routing.py` <br> `core-ingest/tests/service/grpc_handler_test.go` |
| **Cloudflare Tunnel 502 Stability** | `scratch/incident_closure_report.md` | `tests/regression/test_502_reproduction.py` |
| **PaaS-First Orchestration** | `deploy/ADR-002-paas-orchestration.md` | `tests/api/test_health.py` <br> `tests/integration/siem_to_soar/test_pipeline.py` |
| **Monolith Hybrid DB Architecture** | `deploy/ADR-001-hybrid-db.md` | `soc-backend/tests/service/db_repo_test.py` |
| **Command Center Triage UI** | `PLATFORM.md` | `tests/e2e/command-center.spec.ts` |
| **Network Topology Graph UI** | `PLATFORM.md` | `tests/e2e/network-map.spec.ts` |
| **Investigation Provenance UI** | `PLATFORM.md` | `tests/e2e/investigation-graph.spec.ts` |
| **Playbook Sandbox Automation UI** | `PLATFORM.md` | `tests/e2e/playbook-sandbox.spec.ts` |
| **Two-Key Host Isolation Controls** | `PLATFORM.md` | `tests/e2e/isolation-controls.spec.ts` |
| **Incident War Room UI** | `PLATFORM.md` | `tests/e2e/war-room.spec.ts` |
| **Asset Fleet Inventory UI** | `PLATFORM.md` | `tests/e2e/asset-inventory.spec.ts` |
| **Executive Security Dashboard** | `PLATFORM.md` | `tests/e2e/dashboard.spec.ts` |
