# Principal Engineer Prompt Pack — Local Dev Docker Overlay & DevOps Flaw Review

This file gives you (1) the exact flaws found in your current DevOps codebase, (2) the reasoning behind the new `docker-compose.dev.yml` overlay, and (3) a Principal Engineer / Principal AppSec / Principal DevOps prompt suite specific to your dev/prod split and Cloudflare Tunnel logic.

---

## 1. Flaws Identified in Current Codebase

### 1.1 No dev/prod separation exists
Your `docker-compose.yml` is a single monolithic file hardwired for production: it hardcodes `cloudflared`, TLS-adjacent Nginx routing, `internal: true` air-gapped networks, and no host-exposed database ports. Running it locally either fails silently (ports not exposed) or forces you to keep editing the production file directly, which is risky and error-prone.

### 1.2 Postgres and ClickHouse are not reachable from host tools
`postgres` and `clickhouse-server` only declare `networks: internal-mesh` with no `ports:` mapping. Locally, you cannot connect via pgAdmin, DBeaver, or `psql` from your host machine unless you `docker exec` into the container — this was very likely the "my database doesn't show up" confusion from earlier.

### 1.3 Frontend Dockerfile always builds the full Nginx/TLS production image
`Dockerfile-5.react` always executes both build stages: Vite build **and** Nginx + self-signed cert generation. There is no dev target, so every local iteration requires a full rebuild-and-restart cycle instead of Vite's hot module reload (HMR).

### 1.4 Python backend has no live-reload wiring for local dev
`Dockerfile-4.python`'s `CMD` runs `uvicorn main:app --host 0.0.0.0 --port 8000` without `--reload`, and there is no bind mount for `soc-backend/`. Every code change requires a full image rebuild.

### 1.5 `internal-mesh` is air-gapped even for local dev
`internal: true` on `internal-mesh` blocks host-to-container routing for Postgres/ClickHouse entirely, which is correct for production but actively hostile to local development and debugging.

### 1.6 Cloudflare Tunnel is a hard dependency, not an optional layer
`cloudflared` has no `profiles:` tag and no conditional logic; it always tries to start and requires a valid `CLOUDFLARE_TUNNEL_TOKEN`, which is meaningless and potentially failure-prone in a local-only workflow.

### 1.7 Go and Python Dockerfiles have no dev-stage separation
Both are single-purpose production Dockerfiles (`FROM scratch` for Go, hardened `python:3.11-slim` for Python). There's no builder-stage-only target for fast local iteration, and the Go binary must be fully rebuilt on every change (no `air`/`reflex`/live-rebuild tool wired in).

### 1.8 Nginx TLS self-signing happens even when not needed
`Dockerfile-5.react` always generates a self-signed cert during image build, even in dev-target builds where Nginx never runs, wasting build time and coupling frontend/TLS concerns.

---

## 2. What the New `docker-compose.dev.yml` Overlay Fixes

Run it as an **override**, layered on top of your existing production file — nothing in your production compose file is modified or deleted:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Key corrections:
- `cloudflared` is gated behind `profiles: ["prod"]` so it never starts locally.
- `soc-frontend` targets the Vite `builder` stage only and runs `npm run dev` with hot reload on `localhost:5173`, skipping Nginx and self-signed TLS entirely.
- `core-ingest` publishes `8080` and `9090` directly to `localhost`.
- `soc-backend` runs Uvicorn with `--reload` and bind-mounts your source folder for instant iteration.
- `postgres` and `clickhouse-server` publish `5432`, `8123`, and `9000` to localhost so pgAdmin/DBeaver/psql work natively.
- `internal-mesh` has `internal: false` in the dev overlay only, restoring host-to-container reachability for local debugging while your production file remains air-gapped.

This preserves your working Cloudflare Tunnel + Nginx production logic completely untouched, while giving you a clean, fast, local-only mode.

---

## 3. Master Prompt — Principal Engineer (Dev/Prod Split Review)

```text
You are acting as a Principal Engineer reviewing the dev/prod separation strategy for a multi-service SOC platform (React/TypeScript frontend, Go ingestion core, Python FastAPI + LangGraph backend, PostgreSQL, ClickHouse, Nginx, Cloudflare Tunnel).

Context:
- Production uses a single docker-compose.yml with Cloudflare Tunnel, air-gapped internal-mesh network, and no exposed database ports.
- Local development currently has no dedicated compose overlay, causing developers to edit production files directly or work without hot reload.

Your task:
1. Evaluate whether an override-file strategy (docker-compose.yml + docker-compose.dev.yml) is the correct pattern versus alternatives (separate full dev compose file, Makefile-driven profiles, or Tilt/Skaffold).
2. Identify any remaining coupling between dev and prod configuration that could cause drift or accidental production behavior locally.
3. Verify that hot-reload wiring for Python (uvicorn --reload + bind mount) and React (Vite dev server) does not leak into production images.
4. Confirm that disabling network isolation (internal-mesh internal:false) for dev does not introduce a security regression if a developer accidentally runs the dev overlay against a shared or production-adjacent host.
5. Recommend safeguards (e.g., .env.dev vs .env.prod, compose profile guards, CI checks) to prevent the dev overlay from ever being deployed to production.

Return your answer as:
1. Verdict on the override pattern
2. Residual risks
3. Concrete safeguards to add
4. Exact file/config changes required
```

---

## 4. Master Prompt — Principal Application Security Engineer (Dev Overlay Risk)

```text
You are acting as a Principal Application Security Engineer auditing a local-development Docker Compose overlay for a SOC platform that in production uses Cloudflare Tunnel and an air-gapped internal-mesh network.

The dev overlay:
- Publishes PostgreSQL (5432), ClickHouse (8123/9000), Go ingestion core (8080/9090), Python FastAPI (8000), and Vite (5173) directly to localhost.
- Sets internal-mesh network to internal:false.
- Disables Cloudflare Tunnel via a compose profile guard.
- Bind-mounts source code into containers for hot reload.

Audit for:
1. Whether any of these exposed ports could be accidentally bound to 0.0.0.0 on a shared or cloud-hosted development VM instead of a true localhost-only machine, and how to prevent that (e.g., explicit 127.0.0.1: prefix on port mappings).
2. Whether default credentials (DB_USER/DB_PASSWORD) used in dev are safe, or whether they risk being copy-pasted into production .env files.
3. Whether bind-mounting source code introduces any container escape or dependency-poisoning risk (e.g., malicious node_modules or Python packages executing on mount).
4. Whether disabling the internal-mesh air-gap could ever be merged or scripted into a production deployment path by mistake.
5. What CI/CD guardrails should exist to hard-block the dev compose file from being referenced in any production deployment pipeline or systemd/cron job.

Return your answer as:
1. Exploitable misconfigurations found
2. Exact corrected configuration (with 127.0.0.1 binding examples)
3. Required environment variable separation strategy
4. CI/CD guardrail recommendations
```

---

## 5. Master Prompt — Principal DevOps / Platform Engineer (Cloudflare Tunnel Hardening)

```text
You are acting as a Principal DevOps / Platform Engineer responsible for a working Cloudflare Tunnel + Nginx production deployment for a SOC platform, which you must now harden and extend without breaking its current stability.

Context:
- cloudflared runs as a non-root user (65532:65532) on the public-ingress network and depends on soc-frontend.
- Nginx (soc-frontend container) terminates HTTP only, since Cloudflare handles edge TLS (SSL offloading, mode Full or Full-strict).
- core-ingest and soc-backend sit on both public-ingress and internal-mesh, with Postgres and ClickHouse isolated to internal-mesh only.
- A new docker-compose.dev.yml overlay now exists purely for local development, with cloudflared disabled via a "prod" profile.

Your tasks:
1. Verify that the "prod" profile guard on cloudflared cannot silently fail open (i.e., confirm cloudflared truly never starts unless --profile prod is explicitly passed, across all shells and CI runners).
2. Recommend a documented, repeatable command reference for three modes: local dev (no tunnel), staging (tunnel + staging domain), and production (tunnel + production domain).
3. Assess whether core-ingest and soc-backend truly need to sit on public-ingress at all, or whether Nginx should be the sole ingress point with all API traffic proxied internally — reducing the public attack surface.
4. Propose a startup-order and health-check strategy so cloudflared only starts after Nginx reports healthy, preventing Cloudflare from routing traffic to a not-yet-ready origin.
5. Propose monitoring/alerting (via the existing Prometheus setup) for tunnel disconnects, 502s from Nginx, and origin unavailability.

Return your answer as:
1. Verified safety of the profile guard
2. Documented command reference for dev/staging/prod
3. Recommended ingress topology change (if any)
4. Health-check and startup-order fix
5. Monitoring additions
```

---

## 6. Exact Prompt — Full Codebase DevOps Flaw Sweep

```text
Act as a combined Principal Engineer, Principal Application Security Engineer, and Principal DevOps Engineer performing a full flaw sweep across this SOC platform's DevOps codebase:
- docker-compose.yml (production)
- docker-compose.dev.yml (new local dev overlay)
- Dockerfile.go, Dockerfile.python, Dockerfile.react
- nginx.conf
- init-platform.sh, certbot-cron-job.sh
- prometheus.yml
- postgres_schema.sql, clickhouse_schema.sql

For each file, identify:
1. Hidden or undocumented dependencies (host paths, external services, environment variables with no default).
2. Inconsistent or missing health checks and startup ordering.
3. Hardcoded secrets, weak defaults, or credentials that could leak into logs or images.
4. Build-time inefficiencies (missing layer caching, unnecessary steps running in every environment).
5. Any place where dev-only convenience (hot reload, exposed ports, relaxed network isolation) could accidentally leak into a production deployment path.

Return your answer as a table of:
| File | Issue | Severity | Fix |

Followed by a prioritized remediation plan, ordered by risk and implementation effort.
```

---

## 7. Quick Reference — Commands for Each Environment

```bash
# Local development (no Cloudflare Tunnel, hot reload, exposed DB ports)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Local development, background mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

# Stop and remove local dev stack
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Production (Cloudflare Tunnel active, air-gapped internal-mesh, no dev overlay)
docker compose -f docker-compose.yml --profile prod up --build -d
```

---

## 8. Principal-Level Verification Checklist (Dev Overlay)

- Does `cloudflared` start when running the dev command with no `--profile prod` flag? (It must not.)
- Are `5432`, `8123`, `9000`, `8080`, `9090`, `8000`, and `5173` all reachable from `localhost` only, not `0.0.0.0` on a shared host?
- Does editing files under `soc-backend/` or `soc-frontend/` trigger reload without a container rebuild?
- Does the production compose file remain byte-for-byte unmodified after adopting the overlay pattern?
- Is there a `.env.dev` separate from `.env` (production) so credentials never cross environments?
- Does CI/CD explicitly reject any pipeline that references `docker-compose.dev.yml`?
