# Principal System Designer Prompt — Strong, Maintainable, Debuggable & Scalable Architecture

This document is a high-level, Principal System Designer–grade prompt for reorganizing and hardening the entire "Hybrid LLM with SOAR and SIEM" codebase as a coherent, layered, and debuggable system. It treats the current repo layout (Go ingestion core, Python AI backend, React FSD frontend, Docker deploy files, research docs, and proto definitions) as inputs, and defines how to re-establish the architecture for long-term maintainability, observability, and scalability.

Repo snapshot (simplified):
- core-ingest/ (Go)
- soc-backend/ (Python FastAPI + agents, playbooks, policy, sandbox runner)
- soc-frontend/ (React + TypeScript, FSD, pages/features/shared)
- deploy/ (Dockerfiles, docker-compose, schemas, nginx, playbook sandbox Dockerfile, Prometheus config)
- shared-proto/ (gRPC proto)
- docs & prompts (PLATFORM.md, threat_model_and_core_arch.md, soc_console_and_red_team.md, SOC Automation Machine Learning Research.pdf, various incident runbooks and prompt packs)

---

## 1. Global Architectural Intent

```text
You are a Principal System Designer responsible for transforming the "Hybrid LLM with SOAR and SIEM" project into a clean, layered architecture with strong maintainability, debuggability, and scalability across three main runtime services:
- core-ingest (Go stream ingestion & correlation)
- soc-backend (Python AI orchestration, FastAPI, LangGraph, LiteLLM, sandbox runner)
- soc-frontend (React FSD SOC console)

High-level goals:
1. Enforce a clear, hierarchical structure: domain layers, service boundaries, and shared contracts are obvious from the repo layout.
2. Ensure any engineer can debug a cross-service incident (from a bad alert through Go ingestion, Python agents, and React UI) using consistent logging, tracing, and metrics.
3. Make scaling strategies explicit: stateless vs stateful components, horizontal scaling patterns, and data partitioning are documented and reflected in code and deploy configs.
4. Preserve your Feature-Sliced Design (FSD) on the frontend while aligning backend and deploy structure to similar domain boundaries.

Your output must be a concrete refactoring and design plan, not just abstract principles.
```

---

## 2. Repository-Level Structure & Layering Prompt

```text
You are a Principal System Designer reorganizing the repo into a clear, hierarchical, domain-oriented structure. Use the existing directories as anchors.

Target top-level layout:
- /docs
  - threat_model_and_core_arch.md
  - soc_console_and_red_team.md
  - SOC Automation Machine Learning Research.pdf
  - incident runbooks (RUNBOOK-502-incident.md, etc.)
  - architecture decision records (ADRs) for major changes (HttpOnly cookies, Phase 7 backend contract verification, Phase 8 auth migration).
- /proto
  - shared-proto/soc_service.proto
  - generated code directories separated per language (go/pb, python/pb).
- /services
  - /core-ingest (Go)
  - /soc-backend (Python)
  - /soc-frontend (React FSD)
- /deploy
  - docker-compose.dev.yml, docker-compose.yml
  - Dockerfile.go, Dockerfile.python, Dockerfile.react, playbook sandbox Dockerfile.
  - clickhouse_schema.sql, postgres_schema.sql
  - nginx.conf, prometheus.yml, certbot scripts.
- /ops
  - run-all.sh, Makefile, pre-pull scripts, migrate_architecture.ps1.

Your tasks:
1. Define a precise mapping from the current layout to the target layout (e.g., move soc-frontend/src/shared-proto references into /proto, ensure core-ingest/pb and soc-backend/pb are generated from /proto, not ad hoc).
2. For each /services subdirectory, enforce a three-layer internal structure: /domain (business logic), /infra (adapters to DB, queues, HTTP, gRPC), /interfaces (API handlers, CLIs, UI components).
3. Document these mapping rules as ADRs under /docs/adr/ so future contributors understand why the structure looks this way.

Return the mapping plan and one example of the three-layer structure applied to soc-backend/.
```

---

## 3. Backend Service Design Prompts (Go + Python)

### 3.1 Go Service (`core-ingest`) — Clean Ingestion & Correlation Layer

```text
You are a Principal Backend Engineer and System Designer refactoring core-ingest (Go) into a clear layered service.

Current files: auth.go, cdm_parser.go, correlation.go, database.go, metrics.go, tenant_registry.go, main.go.

Target structure inside services/core-ingest:
- /domain
  - ingestion (CDM parsing, normalization, multi-tenant routing)
  - correlation (alert/incident correlation rules and state)
  - tenancy (tenant registry, per-tenant configs)
- /infra
  - db (Postgres + ClickHouse adapters)
  - grpc (soc_service server implementation using generated pb)
  - http (webhook ingestion on :8080)
  - metrics (Prometheus exporters; clickhouse metrics queries)
- /interfaces
  - main.go (composition root, wiring domain to infra)
  - config (env/config loading, validation)

Your tasks:
1. Extract pure domain logic from auth.go, cdm_parser.go, correlation.go, tenant_registry.go into /domain modules that have no direct dependency on net/http, database/sql, or gRPC.
2. Rewrite database.go and metrics.go as infra adapters that implement interfaces defined in /domain (e.g., AlertRepository, MetricsRepository), making it easy to swap out storage or add caching.
3. Centralize configuration parsing in /interfaces/config, enforcing explicit validation (e.g., database URLs, ClickHouse addresses, required env vars).
4. Add structured logging (e.g., logrus or zerolog) with consistent fields (tenantId, alertId, correlationId) so investigation of issues from logs is tractable.
5. Document how this service scales: stateless ingestion workers behind a load balancer, shared DB, and how per-tenant partitioning is handled.

Return the proposed package structure, interface definitions, and a brief scaling strategy note.
```

### 3.2 Python Service (`soc-backend`) — Agentic Orchestration & API Layer

```text
You are a Principal Backend Engineer and System Designer refactoring soc-backend (Python) into a clear layered service aligned with domain-driven design.

Current files: agents.py, api_routes.py, auth.py, auth_google.py, context_config.py, playbooks.py, policy.py, sandbox_runner.py, soc_sdk.py, ml_inference/*, pb/*, main.py.

Target structure inside services/soc-backend:
- /domain
  - investigations (agent graph definitions, Investigation entity, Action entity)
  - playbooks (playbook metadata, execution policies)
  - policy (risk scoring, governance rules, Two-Key requirements)
  - auth (user, role, session abstractions independent of FastAPI)
- /infra
  - http (FastAPI app, route handlers, request/response DTOs)
  - grpc (soc_service client to core-ingest, using pb modules)
  - db (Postgres ORM/alchemy models and repositories)
  - sandbox (Docker sandbox runner integration)
  - llm (LiteLLM Router config, LangGraph state store in langgraph_state volume)
- /interfaces
  - main.py (composition root, FastAPI startup wiring)
  - api_routes.py (public API surface, thin mapping layer from HTTP to /domain)

Your tasks:
1. Move "business" logic out of api_routes.py into /domain modules; make routes thin adapters that validate inputs, call domain services, and return DTOs.
2. Derive domain models (Investigation, Action, Playbook, PolicyRule, User, Role) from the TypeScript shared/types and the existing pb schemas so frontend, backend, and proto contracts converge.
3. Ensure policy.py is the single source of truth for risk scoring and Two-Key requirements; destructive endpoints must call into policy before executing any action.
4. Implement structured logging and tracing throughout investigations and playbook execution, including correlationId and agentStepId, so cross-service debugging becomes possible.
5. Document how soc-backend scales (e.g., multiple FastAPI workers behind a reverse proxy, sandbox runner isolation, LangGraph state store persistence patterns) and what needs to be done to enable horizontal scaling safely.

Return the refactored module structure and a short description of the domain services for investigations and playbooks.
```

---

## 4. Frontend System Design Prompt (React FSD)

```text
You are a Principal Frontend Architect ensuring the soc-frontend FSD architecture remains coherent, maintainable, and debuggable as the system evolves.

Current structure (simplified):
- src/features/{auth, investigations, playbooks}/...
- src/pages/{dashboards, detection, endpoints, incidents, assets, marketplace, profile, settings, utilities}/...
- src/shared/{api, auth, config, hooks, lib, theme, types, ui}/...
- src/layouts/{MainLayout, ui/Sidebar}/...

Your tasks:
1. Enforce a strict separation between "feature" layers (business UI logic) and "page" layers (routing/binding) — no page should contain business logic; it should compose feature-level components and shared primitives only.
2. Ensure every feature consumes shared hooks (useAsyncState, usePolling, useWebSocketStream) and shared/ui primitives (LoadingSkeleton, ErrorState, DataTable, Badge, StatusDot, TwoKeyModal) instead of recreating patterns.
3. Introduce a small, explicit "debugging layer": a set of developer-only panels or overlays (togglable via config) that show live API latency, WebSocket reconnect counts, and per-page error boundaries to support debugging in non-production environments.
4. Align route definitions (src/shared/config/routes.ts) with backend endpoint ownership: each route should document which backend domain it depends on (core-ingest vs soc-backend) so engineers know where to look when a page fails.
5. Maintain HttpOnly cookie auth: remove any lingering assumptions that the frontend can read JWTs; rely exclusively on /api/auth/session for identity and use the shared apiClient with withCredentials.

Return an updated FSD ruleset (as comments or a doc) that future contributors must follow when adding new features/pages.
```

---

## 5. Observability, Debuggability & Incident Flow Prompt

```text
You are a Principal Observability Engineer designing a cross-service debugging and observability strategy for this architecture.

Your tasks:
1. Define a unified correlationId convention across core-ingest (Go logs and metrics), soc-backend (Python logs and traces), and soc-frontend (browser console logs and telemetry) so a single incident can be traced end-to-end.
2. Integrate Prometheus (deploy/prometheus.yml) with:
   - core-ingest ingestion rate, correlation latency, per-tenant metrics.
   - soc-backend endpoint latency, agent execution durations, playbook sandbox stats.
   - soc-frontend synthetic metrics (e.g., page load times, WebSocket reconnect counts) via a browser-to-backend telemetry endpoint if needed.
3. Configure Nginx (deploy/nginx.conf) to log request IDs and upstream response codes, and ensure these IDs are propagated into backend logging.
4. For critical flows (investigation creation, high-risk action execution, host isolation, detection-rule changes), design an explicit audit trail schema in Postgres/ClickHouse that stores who/what/when and references correlationId, so investigators can reconstruct events.
5. Document a standard debugging runbook: given a failing investigation step in the UI, where to look in core-ingest logs, soc-backend logs, ClickHouse data, and Prometheus graphs.

Return the observability design and a sample incident trace walkthrough.
```

---

## 6. Scalability & Deployment Prompt

```text
You are a Principal DevOps and Systems Engineer defining how this system scales and how deployment artifacts should reflect the architecture.

Your tasks:
1. Update docker-compose.yml and docker-compose.dev.yml to explicitly separate concerns: one stack for local debugging (single-instance services, verbose logging), another for production-like scaling (multiple soc-backend workers, core-ingest replicas, isolated sandbox runner).
2. Define horizontal scaling strategies:
   - core-ingest: stateless ingestion workers behind a load balancer, shared Postgres/ClickHouse, partitioned streams by tenant or region.
   - soc-backend: multiple FastAPI instances behind Nginx or Cloudflare Tunnel, with LangGraph state persisted in a shared store (volume or external DB).
   - soc-frontend: static asset hosting via Nginx/Cloudflare with cache headers tuned for incident responsiveness.
3. Ensure HttpOnly cookie auth works correctly across scaled instances (consistent domain, Secure flag, SameSite attributes), and that /api/auth/session behaves correctly with multiple backend nodes.
4. Document upgrade and rollback procedures (e.g., via Makefile and run-all.sh) so deploying new playbook or investigation logic can be done safely without breaking live incident flows.

Return a scaling plan and a checklist for safe production deployment.
```

---

## 7. Final System-Design Integration Prompt

```text
You are a Principal System Designer performing the final integration review of this architecture.

Verify:
1. The repo-level structure clearly separates docs, proto contracts, services, deploy, and ops — no cross-cutting files are left in ambiguous locations.
2. Each service (core-ingest, soc-backend, soc-frontend) follows the domain/infra/interfaces layering pattern, and shared contracts (proto, TypeScript types, domain models) are aligned.
3. HttpOnly cookie auth is fully adopted: no tokens in localStorage, no direct JWT decoding on the frontend; identity comes from /api/auth/session only.
4. Observability spans all services with a consistent correlationId and audit trail for critical actions.
5. Scaling strategies and failure modes are documented and reflected in configuration (Prometheus, docker-compose, nginx.conf) rather than living only in prose.

Produce a final architecture summary that a new senior engineer could read to understand the entire system in under 30 minutes.
```

---

## 8. Recommended Next Concrete Step

Run the Backend Service Design prompts (Section 3) against `core-ingest/` and `soc-backend/` first, while keeping the current frontend FSD structure stable. Once backend layering and contracts are clear, apply the Frontend System Design prompt (Section 4) and Phase 8 HttpOnly cookie migration so auth flows are clean and symmetric across all three services. Only after these steps are complete should scaling and observability prompts be executed, since they rely on stable interfaces and logging points.
