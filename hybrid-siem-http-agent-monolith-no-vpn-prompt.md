# Principal Architect Prompt — End‑to‑End Plan for HTTP‑Based Hybrid SIEM‑SOAR Agent Fabric (VPN‑Free, PaaS‑Safe)

## 0. Context & Non‑Negotiable Constraints

```text
You are a Principal Architect / Principal Platform Engineer responsible for turning a single‑tenant, dockerized Hybrid SIEM‑SOAR (soc-backend, core-ingest, soc-frontend, ClickHouse, Postgres, Cloudflare Tunnel) into a robust, multi‑tenant, multi‑environment platform.

Environments the agent must run in:
- Local servers (bare metal, home lab, office networks).
- IaaS VMs (AWS EC2, DigitalOcean, GCP, etc.).
- PaaS / serverless containers (AWS Fargate, Cloud Run, Render, Vercel‑style platforms) with **no kernel or device control**.

These constraints are **non‑negotiable**:
1) The agent must be deployable as a simple container / sidecar without extra Linux capabilities (no CAP_NET_ADMIN, no /dev/net/tun, no privileged pods/containers).
2) No inbound ports are opened on agents; all communication is outbound‑only over HTTPS.
3) Tenants/endpoints must never require manual SQL (`INSERT INTO tenant_registry`) to onboard.
4) The solution must be multi‑tenant aware (tenant_registry in Postgres + per‑tenant data isolation in ClickHouse).
5) The SIEM‑SOAR must support **both** log ingestion **and** SOAR actions, safely and reliably.

Your job is to define a single, coherent architecture and implementation plan that satisfies all of these simultaneously, using only HTTP(S) and Zero‑Trust tunnels — no VPN dependencies.
```

---

## 1. Core Architectural Decision: HTTPS + Cloudflare Tunnel as the Universal Fabric

```text
Adopt this decision explicitly:

- The **universal fabric** for agent ↔ hub communication is:
  - Outbound HTTPS from agents, and
  - Cloudflare Tunnel on the hub side providing inbound‑less access.

There is **no dependency on any VPN protocol** (WireGuard, IPSec, etc.) for the SIEM/SOAR dataplane.

Rationale:
- Outbound HTTPS works everywhere (Local, IaaS, PaaS, serverless) and requires no special kernel capabilities.
- Cloudflare Tunnel provides secure, post‑quantum‑ready, outbound‑only connectivity for your hub, with WAF, Access, and DDoS protection.

Implementation:
1) Maintain a Cloudflare Tunnel that terminates at soc-nginx-proxy.
2) All agent traffic targets URLs under this tunnel (e.g., https://siem.yourdomain.com/...).
3) Cloudflare Access service tokens (and optionally mTLS) protect these endpoints; your origin has no public IP.

Every design choice below must be compatible with this fabric.
```

---

## 2. Logical Planes of the Agent Fabric

```text
Structure the system around three logical planes:

1) Identity & Enrollment Plane
   - Initial trust bootstrap, tenant/endpoint registration, and issuance of per‑endpoint credentials.

2) Telemetry Plane (Logs, Metrics, Events)
   - High‑volume, reliable, backpressure‑aware forwarding of logs and metrics from endpoints to the hub.

3) Control Plane (SOAR Actions)
   - Delivery of actions (e.g., block user, isolate host) from the hub back to endpoints without opening inbound ports at the edge.

The rest of this prompt defines concrete APIs and data flows for each plane.
```

---

## 3. Identity & Enrollment Plane — API‑Driven Auto‑Registration

### 3.1 Database & Schema Assumptions

```text
Assume Postgres has at least:
- tenant_registry(tenant_id, webhook_secret, clickhouse_db, llm_keys, created_at, ...)
- endpoint_inventory(endpoint_id, tenant_id, hostname, label, type, capabilities, region, last_seen_at, status, ...)

ClickHouse: one DB per tenant (e.g., clickhouse_db_tenant01) OR a shared DB with tenant_id partitioning.
```

### 3.2 Enrollment & Registration APIs

```text
Implement the following endpoints in soc-backend (FastAPI):

1) POST /api/endpoints/enroll
   - Purpose: Convert a short‑lived enrollment token into a persistent endpoint identity.
   - Input JSON: {
       "enrollment_token": "<short-lived-single-use-token>",
       "initial_metadata": { optional hints: hostname, label, type, capabilities }
     }
   - Behavior:
     - Validate token: tenant_id, expiry, single-use.
     - Generate endpoint_id (UUID) and a per-endpoint credential (endpoint_secret or client cert).
     - Insert endpoint row into endpoint_inventory with minimal metadata, status = "pending_register".
     - Mark enrollment_token as consumed.
   - Output: {
       "endpoint_id": "...",
       "endpoint_secret": "..." (or references to client cert),
       "tenant_id": "..."
     }

2) POST /api/endpoints/register
   - Auth: endpoint_secret (e.g., in Authorization header) or mTLS client cert.
   - Input JSON: {
       "hostname": "host-01",
       "label": "prod-web-1",
       "type": "local" | "iaas" | "paas",
       "cf_tunnel_url": "https://endpoint-123.yourdomain.com/agent/execute" (optional),
       "capabilities": ["can_execute_docker", "has_agent_v1"],
       "agent_version": "1.0.0",
       "os": "linux",
       "region": "ap-southeast-1"
     }
   - Behavior:
     - Resolve endpoint by endpoint_secret.
     - Update endpoint_inventory with full metadata; set status = "active".
     - Ensure tenant_registry entry exists; if necessary, provision ClickHouse DB for this tenant.
   - Output: {
       "endpoint_id": "...",
       "tenant_id": "...",
       "ingest_url": "https://siem.yourdomain.com/ingest/",
       "tasks_url": "https://siem.yourdomain.com/api/agents/tasks",
       "poll_interval_seconds": 10
     }

3) GET /api/endpoints/me
   - Auth: endpoint_secret.
   - Purpose: Allow the agent to retrieve its current configuration and tenant settings.
```

### 3.3 Enrollment Token Issuance & Admin UI

```text
Add an Admin API + UI to issue enrollment tokens:

Endpoint: POST /api/admin/enrollment-tokens
- Auth: SOC super-admin.
- Input: {
    "tenant_id": "acme-corp",
    "expires_in": 900,
    "max_use": 1
  }
- Output: { "enrollment_token": "..." }

UI (Settings → Tenant & Endpoint Management):
- Button: "+ Issue Enrollment Token".
- Shows the token once with copy-to-clipboard and usage instructions for running the agent container.

Rules:
- Enrollment tokens are time‑bound (e.g., 15 minutes) and single‑use.
- Tokens encode tenant_id and scope; they do not grant any general hub access beyond enroll.
```

---

## 4. Telemetry Plane — HTTP Log Shipping with Robust Buffering

### 4.1 Agent Docker Image Design (`hybrid-siem-agent`)

```text
Build a single standardized Docker image that can be deployed to any environment that runs containers.

Base image:
- alpine, debian-slim, or distroless (for hardened builds).

Components inside the image:
1) Log shipper: Fluent Bit or Vector.
2) Control sidecar: a small Go or Python process (`siem-agent`) responsible for:
   - Enrollment & registration (Section 3).
   - Writing/generated config for Fluent Bit/Vector.
   - Health reporting & metrics.
   - Polling the control plane.

Required environment variables:
- HUB_BASE_URL = https://siem.yourdomain.com
- TENANT_ENROLLMENT_TOKEN = <short-lived token>
- CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET (or path to mTLS cert/key).
- ENDPOINT_LABEL, ENDPOINT_TYPE, CAPABILITIES (optional, for better metadata).

Agent startup sequence:
1) siem-agent boots.
2) Calls POST /api/endpoints/enroll with TENANT_ENROLLMENT_TOKEN.
3) Receives endpoint_id + endpoint_secret + tenant_id.
4) Calls POST /api/endpoints/register with metadata.
5) Writes a Fluent Bit/Vector config file pointing to HUB_BASE_URL/ingest/ with correct auth headers and endpoint_id.
6) Starts Fluent Bit/Vector and supervises it.
```

### 4.2 Fluent Bit / Vector HTTP Output Configuration

```text
HTTP output (conceptual example for Fluent Bit):

[OUTPUT]
    Name          http
    Match         *
    Host          siem.yourdomain.com
    Port          443
    URI           /ingest/
    Format        json
    tls           On
    Header        CF-Access-Client-Id  ${CF_ACCESS_CLIENT_ID}
    Header        CF-Access-Client-Secret  ${CF_ACCESS_CLIENT_SECRET}
    Header        X-Endpoint-Id  ${ENDPOINT_ID}

Buffering & reliability:
- Enable filesystem buffering:
  - storage.type  filesystem
  - storage.total_limit_size   (e.g., 512MB or per-tenant policy).
- Configure retry policy with exponential backoff.
- Optionally compress payloads.

On the hub side (core-ingest):
- Authenticate via CF Access + endpoint_secret mapping.
- Enforce rate limits per endpoint/tenant.
- Normalize into your Common Data Model and write to ClickHouse.
```

---

## 5. Control Plane — Polling‑First, Webhook‑Optional

### 5.1 Polling Control Plane (Works Everywhere)

```text
Define the polling-based control plane as the default; it must work even in the most restrictive PaaS.

Endpoint: GET /api/agents/tasks
- Auth: endpoint_secret.
- Query params: endpoint_id, optional max_tasks.
- Response:
  [
    {
      "task_id": "...",
      "action": "isolate_host" | "block_user" | "rotate_credential" | ..., 
      "params": { ... },
      "requested_at": "2026-07-25T04:00:00Z"
    }, ...
  ]

Endpoint: POST /api/agents/tasks/{task_id}/result
- Auth: endpoint_secret.
- Body: {
    "status": "success" | "failed",
    "details": { optional structured info },
    "completed_at": "..."
  }

Agent behavior:
- siem-agent runs a loop every N seconds (configurable, e.g., 5–10):
  - GET /api/agents/tasks.
  - For each task, dispatch to a local handler function module.
  - Execute action and POST result.
- Implements backoff when errors occur to avoid tight loops.

This model uses only outbound HTTPS and is therefore valid for Local, IaaS, and PaaS.
```

### 5.2 Optional Webhook Mode (Low Latency for Local/IaaS)

```text
For environments where you can also run a local Cloudflare Tunnel (Local, IaaS), support a webhook mode as an optimization.

Agent:
- Runs a small HTTP listener (only bound to localhost or internal network).
- Registers a `cf_tunnel_url` in /api/endpoints/register.

Local Cloudflare Tunnel on the endpoint:
- Exposes this local listener as https://endpoint-<id>.yourdomain.com/agent/execute via an outbound-only tunnel.

Hub (soc-backend):
- For urgent SOAR actions, calls the `cf_tunnel_url` with CF Access tokens and signed payload.
- Agent executes the action synchronously and returns a result.

Webhook mode is optional and must **not** be required for basic functionality. Polling remains the baseline.
```

---

## 6. Security & Identity Hardening

```text
Enforce these practices across the system:

1) No secrets in the frontend.
   - CF Access service token IDs/secrets and endpoint secrets are never included in soc-frontend builds or shipped to browsers.

2) Short‑lived, single‑use enrollment tokens.
   - Expire quickly (e.g., 15 minutes).
   - Cannot be reused once consumed.

3) Per‑endpoint least privilege.
   - Each endpoint_secret is scoped to one endpoint_id and tenant_id.
   - Endpoint credentials can only call the minimal set of APIs (/ingest/, /api/agents/tasks, /api/endpoints/me/register).

4) Credential rotation & decommissioning.
   - Admin UI supports "Rotate endpoint credential" and "Deactivate endpoint" actions.
   - Backend revokes old credentials and logs all such operations.

5) TLS & Zero‑Trust.
   - All agent traffic is HTTPS.
   - Cloudflare Tunnel + Access sits in front of your origin; origin only trusts Cloudflare.

6) Observability & auditing.
   - Log all enroll/register, task assignment, and task completion events with tenant_id, endpoint_id, actor, and timestamp.
   - Expose Prometheus metrics (per-endpoint error rate, high-latency counts, buffer usage, polling failures).
```

---

## 7. Implementation Phases & Deliverables

```text
Phase 1 — Identity & Enrollment
- Implement POST /api/endpoints/enroll and /api/endpoints/register.
- Create enrollment_tokens table if needed.
- Implement POST /api/admin/enrollment-tokens.
- Wire tenant_registry → ClickHouse provisioning.
- Add unit + integration tests for these flows.

Phase 2 — Agent v1 (Telemetry Only)
- Build hybrid-siem-agent image with:
  - siem-agent sidecar for enroll/register.
  - Fluent Bit or Vector for HTTP log shipping with filesystem buffering.
- Deploy to:
  - One local server.
  - One IaaS VM.
  - One PaaS app (where feasible) using stdout logs.
- Validate logs arrive in ClickHouse with correct tenant_id and endpoint_id.

Phase 3 — Control Plane (Polling)
- Implement /api/agents/tasks and /api/agents/tasks/{task_id}/result.
- Extend siem-agent to poll and execute actions.
- Add simple SOAR actions in the UI (e.g., "Mark endpoint in maintenance", "Trigger test alert").
- Add integration tests covering agent polling and action execution.

Phase 4 — Optional Webhook Mode
- Implement optional cf_tunnel_url registration and local HTTP listener in the agent.
- Configure per-endpoint Cloudflare Tunnels for select Local/IaaS nodes.
- Add tests verifying synchronous webhook execution.

Phase 5 — Hardening & SRE Practices
- Add Prometheus metrics and alerts for:
  - Enrollment failures.
  - High-latency requests (>2s).
  - Agent polling failures.
  - Ingest error rates.
- Add regression tests linked to past incidents (e.g., 502 patterns, tenant onboarding bugs).

Each phase should update ADRs and the TEST-CATALOG so architecture and tests stay in sync.
```

---

## 8. Final Architectural Statement

```text
Declare this as the authoritative design:

- The Hybrid SIEM‑SOAR platform standardizes on an HTTP(S) agent fabric fronted by Cloudflare Tunnel. All agent ↔ hub communication is outbound HTTPS; no VPN or kernel-level networking features are required.
- Tenant and endpoint onboarding is fully API-driven via short-lived enrollment tokens and automated registration; manual SQL manipulation is forbidden in normal operations.
- A single, portable `hybrid-siem-agent` container image provides log shipping, local buffering, health reporting, and SOAR command execution across Local, IaaS, and PaaS environments.

This specification is the monolithic blueprint you must follow for both the thesis implementation and any future production deployment.
```
