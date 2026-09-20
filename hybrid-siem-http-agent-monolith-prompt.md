# Principal Architect Prompt — Robust End‑to‑End Plan for HTTP‑Based Hybrid SIEM‑SOAR Agent Fabric (No WireGuard Dependency)

## 0. Context & Non‑Negotiable Constraints

```text
You are a Principal Architect / Principal Platform Engineer responsible for turning a single‑tenant, dockerized Hybrid SIEM‑SOAR (soc-backend, core-ingest, soc-frontend, ClickHouse, Postgres, Cloudflare Tunnel) into a robust, multi‑tenant, multi‑environment platform.

Environments the agent must run in:
- Local servers (bare metal, home lab, office networks).
- IaaS VMs (AWS EC2, DigitalOcean, GCP, etc.).
- PaaS / serverless containers (AWS Fargate, Cloud Run, Render, Vercel‑style platforms) with **no kernel or device control**.

These constraints are **non‑negotiable**:
1) The agent must be deployable as a simple container / sidecar without `CAP_NET_ADMIN`, `/dev/net/tun`, or kernel modules.
2) No inbound ports are opened on agents; all communication is outbound‑only.
3) Tenants/endpoints must never require manual SQL (`INSERT INTO tenant_registry`) to onboard.
4) The solution must be multi‑tenant aware (tenant_registry in Postgres + per‑tenant data isolation in ClickHouse).
5) The SIEM‑SOAR must support **both** log ingestion **and** SOAR actions, safely and reliably.

Your job is to define a single, coherent architecture and implementation plan that satisfies all of these simultaneously.
```

---

## 1. Core Architectural Decision: HTTP/Cloudflare Tunnel as the Universal Fabric

```text
You must explicitly adopt this decision:

- WireGuard and other VPN meshes are **optional** infrastructure tools, not the primary data plane.
- The **universal fabric** for agent ↔ hub communication is:
  - Outbound HTTPS from agents, and
  - Cloudflare Tunnel on the hub side providing inbound‑less access.

Rationale:
- WireGuard (kernel or user space) requires CAP_NET_ADMIN and access to /dev/net/tun; these are blocked in PaaS and many managed/containerized environments.
- Cloudflare Tunnel + HTTPS works anywhere outbound web traffic is allowed and requires no special kernel capabilities.

Implementation:
1) Keep a single Cloudflare Tunnel (or a small set of tunnels) terminating at soc-nginx-proxy.
2) All agent traffic targets URLs under this tunnel (e.g., https://siem.yourdomain.com/...).
3) Cloudflare Access service tokens (and optionally mTLS) protect these endpoints; the origin is never directly exposed.

This decision is the foundation; every subsequent design choice must align to it.
```

---

## 2. Logical Components of the Agent Fabric

```text
Design the system around three logical planes:

1) Identity & Enrollment Plane
   - Responsible for initial trust bootstrap, tenant/endpoint registration, and issuance of per‑endpoint credentials.

2) Telemetry Plane (Logs, Metrics, Events)
   - Responsible for high‑volume, reliable, backpressure‑aware forwarding of logs and metrics from endpoints to the hub.

3) Control Plane (SOAR Actions)
   - Responsible for delivering actions (e.g., block user, isolate host) from the hub back to endpoints without inbound ports.

Your architecture and implementation plan must define concrete APIs and data flows for each plane.
```

---

## 3. Identity & Enrollment Plane — API‑Driven Auto‑Registration

### 3.1 Database & Schema Assumptions

```text
Assume Postgres has:
- tenant_registry(tenant_id, webhook_secret, clickhouse_db, llm_keys, created_at, ...)
- endpoint_inventory(endpoint_id, tenant_id, hostname, label, type, capabilities, region, last_seen_at, ...)

ClickHouse: one DB per tenant (e.g., clickhouse_db_tenant01) or a shared DB with tenant_id partitioning.
```

### 3.2 Enrollment & Registration APIs

```text
Implement the following endpoints in soc-backend (FastAPI):

1) POST /api/endpoints/enroll
   - Input: { "enrollment_token": "<short-lived-single-use-token>", optional basic metadata }
   - Behavior:
     - Validate token: tenant_id, expiry, single-use constraint.
     - Generate a new endpoint_id (UUID) and a per-endpoint secret / service token or mTLS cert.
     - Insert endpoint row into endpoint_inventory with tenant_id and initial metadata (status = "pending_register").
     - Mark enrollment_token as consumed.
   - Output: { "endpoint_id", "endpoint_secret" (or cert), "tenant_id" }

2) POST /api/endpoints/register
   - Auth: endpoint_secret (e.g., in Authorization header or via mTLS client cert).
   - Input: {
       "hostname", "label",
       "type": "local_cf_tunnel" | "iaas" | "paas",
       "cf_tunnel_url" (optional, for local_cf_tunnel),
       "capabilities": ["can_execute_docker", "runs_windows", "has_agent_v1"],
       "agent_version", "os", "region"
     }
   - Behavior:
     - Resolve endpoint by endpoint_secret.
     - Update endpoint_inventory with full metadata, set status = "active".
     - Ensure tenant_registry entry exists; if needed, provision ClickHouse DB for this tenant.
   - Output: confirmation + any hub configuration the agent needs (e.g., ingest URL, polling interval).

3) GET /api/endpoints/me
   - Auth: endpoint_secret.
   - Output: endpoint metadata and tenant settings so the agent can adjust behavior dynamically.
```

### 3.3 Enrollment Token Issuance

```text
Add an Admin API + UI:

- POST /api/admin/enrollment-tokens
  - Auth: SOC super-admin.
  - Input: { "tenant_id", "expires_in": 900, "max_use": 1 }
  - Output: { "enrollment_token" }

Expose this in the Settings → Tenant & Endpoint Management UI:
- Button: "+ Issue Enrollment Token".
- Shows token once, with copy-to-clipboard and instructions for running the agent container.

The enrollment token must be short-lived (e.g., 15 minutes) and single-use.
```

---

## 4. Telemetry Plane — HTTP Log Shipping with Edge Buffering

### 4.1 Agent Docker Image Design (`hybrid-siem-agent`)

```text
Create a single standardized Docker image:

FROM: alpine or debian-slim (or distroless for final hardening).
INCLUDES:
- Fluent Bit or Vector as the log router.
- A small Go or Python sidecar process (`siem-agent`) responsible for:
  - Enrollment + registration (Section 3).
  - Health reporting and metrics.
  - Polling the control plane.

ENV VARS (minimal set):
- TENANT_ENROLLMENT_TOKEN (one-time, short-lived).
- HUB_BASE_URL=https://siem.yourdomain.com
- CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (or client cert path) for outbound auth.
- ENDPOINT_LABEL, ENDPOINT_TYPE, CAPABILITIES (optional hints for registration).

ENTRYPOINT LOGIC:
1) siem-agent starts first:
   - Calls /api/endpoints/enroll using TENANT_ENROLLMENT_TOKEN.
   - Stores endpoint_id + endpoint_secret securely (e.g., in a small local file or environment of fluent-bit process).
   - Calls /api/endpoints/register with metadata.
2) siem-agent writes a Fluent Bit config file with:
   - Input(s): files, journald, stdout, etc. according to platform.
   - Output: HTTP POST to HUB_BASE_URL/ingest/ with endpoint_id and CF Access headers.
3) siem-agent launches Fluent Bit with this generated config and supervises it.
```

### 4.2 Fluent Bit / Vector HTTP Output Configuration

```text
Standard HTTP output target:

- URL: https://siem.yourdomain.com/ingest/
- Method: POST
- Headers:
  - CF-Access-Client-Id: <id>
  - CF-Access-Client-Secret: <secret>
  - X-Endpoint-Id: <endpoint_id>
- Format: JSON (one record per line or batched array, depending on backend design).

Buffering & reliability:
- Enable filesystem buffering with backpressure limits (e.g., up to N MB or N days of logs).
- Configure retry with exponential backoff on HTTP non-2xx or network errors.
- Tag records by source and severity.

At the hub (core-ingest):
- Validate Access tokens and endpoint_id.
- Normalize logs into your Common Data Model (CDM) with cf_ray_id, client_ip, endpoint_id, etc.
- Write to ClickHouse and/or Postgres as appropriate.
```

---

## 5. Control Plane — Polling + Optional Webhook

### 5.1 Primary: Polling Model (Works Everywhere)

```text
Implement the primary control plane as polling; this is the only model guaranteed to work on PaaS and constrained environments.

Endpoint: GET /api/agents/tasks
- Auth: endpoint_secret.
- Query: ?endpoint_id=<id>&max_tasks=<n>
- Response: [
    {
      "task_id": "...",
      "action": "isolate_host" | "block_user" | "rotate_credential" | ...,
      "params": { ... },
      "requested_at": "..."
    }, ...
  ]

Endpoint: POST /api/agents/tasks/{task_id}/result
- Auth: endpoint_secret.
- Body: { "status": "success" | "failed", "details": { ... }, "completed_at": "..." }

Agent side:
- siem-agent runs a loop (e.g., every 5–10 seconds):
  - Calls GET /api/agents/tasks.
  - Executes each action via local handlers (shell commands, OS APIs, application hooks) according to capabilities.
  - Posts results back.
- Backoff logic on errors to avoid tight loops.

This model requires only outbound HTTPS.
```

### 5.2 Optional: Webhook Model for Local/IaaS (Low Latency)

```text
For endpoints that CAN run cloudflared (Local/IaaS), support an optional webhook mode.

Agent configuration:
- In addition to polling, the endpoint can register a cf_tunnel_url in /api/endpoints/register.
- Example: https://endpoint-123.yourdomain.com/agent/execute

Hub side:
- For urgent or synchronous actions, soc-backend calls the endpoint's cf_tunnel_url with CF Access headers and a signed command payload.
- The agent's local HTTP server processes the command immediately.

This remains Zero-Trust:
- The tunnel is outbound-only from the endpoint.
- Cloudflare enforces Access policies.
- The hub authenticates via tokens/mTLS.

Webhook is an optimization; polling remains the baseline and must continue as a fallback.
```

---

## 6. Security & Identity Hardening

```text
Enforce these rules strictly:

1) No long-lived secrets in frontends or scripts.
   - CF Access tokens and endpoint secrets live only on agents and soc-backend, never in soc-frontend bundles.

2) Enrollment tokens are short-lived and single-use.
   - Expire tokens after e.g., 15 minutes.
   - Mark them consumed after first successful enroll.

3) Per-endpoint credentials are unique and least privilege.
   - Scope each endpoint_secret to that endpoint_id and a specific tenant_id.
   - If a credential is compromised, revoke it without affecting others.

4) TLS everywhere.
   - All agent ↔ hub traffic uses HTTPS.
   - Use Cloudflare’s TLS termination + optionally mTLS between Cloudflare and origin.

5) Rotation & decommissioning.
   - Provide a way to rotate endpoint credentials from the UI and revoke enrollment tokens.
   - When an endpoint is decommissioned, mark it inactive in endpoint_inventory and revoke its secret.

6) Observability.
   - Log every enroll/register/rotate/decommission action with audit context.
   - Expose metrics for enrollment failures, auth failures, and control‑plane errors.
```

---

## 7. Implementation Phases

```text
Phase 1 — Identity & Enrollment
- Implement /api/endpoints/enroll and /api/endpoints/register.
- Add tenant_registry & endpoint_inventory migrations if needed.
- Implement Admin API + UI for issuing enrollment tokens.
- Wire ClickHouse provisioning into tenant creation (if DB per tenant).

Phase 2 — Agent Image (Telemetry Only)
- Build v1 of hybrid-siem-agent with:
  - siem-agent sidecar (Go or Python) that performs enrollment & registration.
  - Fluent Bit/Vector configured to send logs to /ingest/ with filesystem buffering.
- Deploy to one Local server and one IaaS VM.
- Verify end-to-end log ingestion and tenant/endpoint visibility in the UI.

Phase 3 — Control Plane (Polling)
- Implement /api/agents/tasks and /api/agents/tasks/{task_id}/result.
- Extend siem-agent to poll for tasks and execute local handlers.
- Add SOAR UI actions in CommandCenter to issue tasks.

Phase 4 — Optional Webhook Mode
- Implement optional cf_tunnel_url registration and per-endpoint Cloudflare Tunnel webhook.
- Implement /agent/execute handler in siem-agent.
- Use webhook only for Local/IaaS where cloudflared is available.

Phase 5 — Hardening & Observability
- Add Prometheus metrics (latency, error rates, queue depth, buffer usage).
- Add retries/backoff for agent operations.
- Add detailed audit logging for all identity & action flows.

At each phase, add tests:
- Unit: domain logic for enrollment, registration, task assignment.
- Integration: end-to-end pipeline from agent → hub → DB.
- E2E: UI workflows for tenant/endpoint onboarding and simple SOAR action.
```

---

## 8. Final Architectural Statement

```text
State this clearly:

- The platform standardizes on **HTTP(S) agents + Cloudflare Tunnel + REST APIs** as the universal, environment-agnostic fabric for telemetry and SOAR control.
- WireGuard and other VPNs are optional, restricted to environments where kernel-level control is available and only used for site-to-site admin scenarios — never as a mandatory dependency for endpoint agents.
- A single `hybrid-siem-agent` Docker image uses enrollment tokens, per-endpoint credentials, and Fluent Bit/Vector to provide a robust, buffered, and secure pipeline from any supported environment (Local, IaaS, PaaS) into the central SIEM-SOAR hub.

This is the reference architecture and implementation blueprint you must follow for both your thesis and production roadmap.
```
