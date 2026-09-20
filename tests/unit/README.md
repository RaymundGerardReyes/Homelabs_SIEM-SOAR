# Root-Level Unit Test Aggregator

This manifest tracks the distributed unit testing suites across the polyglot SIEM/SOAR monorepo. Unit tests are correctly isolated next to their respective microservices.

## Unit Test Coverage Catalog

| Service | Test File | Covers | Last Verified Date |
| `soc-backend` | `tests/unit/test_api_routes.py` | Comprehensive API routes unit tests (Auth, Endpoints, Investigations, Marketplace, Settings). | 2026-07-26 |
| `soc-backend` | `tests/domain/test_policy_engine.py` | Validates pure Policy Engine business rules without I/O. | *Pending* |
| `soc-backend` | `tests/unit/test_main.py` | Baseline backend initialization validation. | *Pending* |
| `core-ingest` | `tests/domain/parser_domain_test.go` | Validates CDM parsing logic and structs. | *Pending* |
| `core-ingest` | `tests/unit/main_test.go` | Validates Go ingestion server initialization. | *Pending* |
| `soc-frontend`| `tests/unit/CommandCenter.test.tsx` | Validates React render stability for CommandCenter. | *Pending* |

> **Note:** To run all distributed unit tests from the root of the repository, execute: `make test-unit-all`
