# Developer Testing Guide

This guide defines the strict Object-Oriented testing discipline and architectural taxonomies required for the Hybrid SIEM/SOAR Monorepo.

## 1. Architectural Test Taxonomy

| Layer | Purpose | Target Directory | Framework / Tool |
| :--- | :--- | :--- | :--- |
| **Domain** | Pure business rules and models. No I/O, no databases, no routers. | `soc-backend/tests/domain/` <br> `core-ingest/tests/domain/` | Pytest / Go test |
| **Service** | Microservice boundaries. API Routers, gRPC Handlers, DB Repositories. | `soc-backend/tests/service/` <br> `core-ingest/tests/service/` | Pytest / Go test |
| **Cross-Service (Integration)** | Validates network boundaries (Nginx → Backend → DB). | `tests/integration/` | Pytest (Orchestrated) |
| **End-to-End (E2E)** | Live browser testing of analyst workflows. | `tests/e2e/` | Playwright |
| **Non-Functional** | Load limits, Chaos engineering, failover validation. | `tests/performance/` <br> `tests/chaos/` | Pytest / Locust |

---

## 2. Object-Oriented Domain Mapping

When writing tests for specific backend systems, use this strict mapping to ensure encapsulation:

### Python Backend (`soc-backend`)
*   `Auth.Identity` → `soc-backend/tests/domain/test_auth_identity.py`
*   `Policy.Engine` → `soc-backend/tests/domain/test_policy_engine.py`
*   `Playbooks.Registry` → `soc-backend/tests/domain/test_playbook_registry.py`
*   `Investigations.Agents` → `soc-backend/tests/domain/test_investigation_agents.py`

### Go Core (`core-ingest`)
*   `cdm_parser.go` → `core-ingest/tests/domain/parser_domain_test.go`
*   `correlation.go` → `core-ingest/tests/domain/correlation_test.go`
*   `tenant_registry.go` → `core-ingest/tests/domain/tenant_registry_test.go`

---

## 3. New Feature Checklist

Before a Pull Request can be merged, developers **MUST** complete this checklist:

- [ ] **Architecture Record:** If the feature crosses a network boundary or changes a database schema, is there a new/updated ADR in `deploy/ADR-*.md`?
- [ ] **Domain Tests:** Does the core business logic have 100% coverage in `tests/domain/` without mocking databases?
- [ ] **Service Tests:** Are the FastAPI/gRPC handlers tested in `tests/service/` with proper mocks?
- [ ] **Integration Coverage:** If the API contract changed, is the contract test updated in `tests/api/` or `tests/integration/`?
- [ ] **Observability Assertions:** Do critical workflow tests explicitly assert that Promethus metrics were incremented and Audit Logs were written?
- [ ] **Catalog Traceability:** Is the test documented and linked in `tests/TEST-CATALOG.md`?
