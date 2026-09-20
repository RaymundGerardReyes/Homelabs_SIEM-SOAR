# Principal Architect Prompt — Secure, Multi‑Language SIEM Integration SDK & Quick Launch Flow

## 0. Context: What You Already Have (And Why It’s Strong)

```text
You have already implemented a solid foundation for agent onboarding and log ingestion:

- Backend (FastAPI, soc-backend):
  - /api/endpoints/enroll (Interfaces.agent_routes) performs token‑based enrollment into endpoint_inventory with short‑lived, max‑use‑bounded enrollment_tokens and a generated endpoint_secret.
  - /admin/enrollment-tokens issues these tokens from the Host Management UI, auto‑provisioning tenant_registry entries when needed.
  - /admin/endpoints/{endpoint_id}/rotate revokes the current endpoint_secret and forces re‑registration.
  - /api/agents/tasks and /api/agents/tasks/{task_id}/result provide a polling control plane.

- UI (HostManagementPage.tsx):
  - Generates enrollment tokens via /admin/enrollment-tokens.
  - Displays an "Enrollment Token (Secret)" field with reveal + copy while keeping the value obscured by default.
  - Renders Quick Launch commands and language snippets (Bash/cURL, Python, C# .NET, Go, TypeScript) that call /api/endpoints/enroll and /api/v1/agent/push.

- SDK examples (Python, C#, Go, TS, Bash):
  - All follow the same two‑step protocol: enroll once, then push logs continuously via Authorization: Bearer <endpoint_secret> and X-Tenant-ID.

This is already close to a production‑grade SIEM integration SDK; the missing pieces are:
- Hardening token issuance and storage.
- Making SDK behavior consistent across languages.
- Ensuring multi‑tenant isolation and revocation semantics are enforced uniformly.
- Documenting a single, authoritative flow so future connectors don’t diverge.
```

---

## 1. Security Model for Enrollment Tokens and Endpoint Secrets

```text
You must define and enforce clear security properties for both artifacts:

1) Enrollment tokens:
   - Short‑lived (e.g., 15 minutes) and single‑use (max_use often = 1, or small fleet values like 5/100).
   - Scoped to a specific tenant_id.
   - Never stored on disk by agents; only passed via environment variable or secure secret store at first run.
   - Invalidated immediately after use (uses++ in enrollment_tokens, status codes 401/403 for reused tokens).

2) Endpoint secrets:
   - Long‑lived per agent but revocable at any time via /admin/endpoints/{endpoint_id}/rotate.
   - Stored by agents only in local, host‑specific credential files (e.g., .siem_credentials.json) or OS keychains.
   - Never exposed in UI; only displayed implicitly via "Rotate" operations.
   - Must be validated for status in endpoint_inventory: if status != 'active', reject ingestion and require re‑registration.

3) Transport & auth:
   - All SDK calls use HTTPS via Cloudflare Tunnel.
   - All ingestion uses Authorization: Bearer <endpoint_secret> plus X-Tenant-ID.
   - Tenant_id must be cross‑checked against endpoint_inventory to avoid spoofing.

Your backend already enforces most of this in agent_routes.verify_endpoint_secret and admin rotation; you must now ensure all SDKs and Quick Launch commands respect the same rules.
```

---

## 2. Backend Improvements for Robust Security & Consistency

```text
Implement the following backend changes based on your current code:

1) Strengthen verify_endpoint_secret:
   - In agent_routes.verify_endpoint_secret, also enforce endpoint status:
     - If status != 'active', return 401 with "Endpoint not active; re-register required".
   - Optionally store a hash of endpoint_secret instead of plaintext in endpoint_inventory.

2) Enforce tenant consistency:
   - When ingesting logs (in your /api/v1/agent/push handler — currently documented in SDK but not yet implemented in code), cross‑check:
     - The tenant_id from X-Tenant-ID.
     - The tenant_id from endpoint_inventory associated with endpoint_secret.
   - If they differ, reject the request with 403.

3) Standardize rotation behavior:
   - In /admin/endpoints/{endpoint_id}/rotate (agent_routes), after generating new_secret:
     - Mark status = 'pending_register'.
     - Optionally emit an audit event so your UI & logs clearly show a rotation occurred.
   - Ensure that any ingestion attempt with the old secret fails immediately.

4) Add endpoint scoping to agent tasks:
   - /agents/tasks and /agents/tasks/{task_id}/result already validate endpoint via endpoint_secret.
   - Ensure that AdminTaskRequest assignments (/admin/endpoints/{endpoint_id}/tasks) always include tenant_id from endpoint_inventory and that no cross‑tenant assignment is allowed.

5) Implement the actual /api/v1/agent/push handler:
   - Use Depends(verify_endpoint_secret) to get endpoint context.
   - Parse events payload and attach correlation_id, endpoint_id, tenant_id.
   - Write to ClickHouse and/or emit to your gRPC pipeline (core-ingest).
   - Increment metrics for ingestion errors, invalid payloads, etc.

These backend changes ensure the SDK contracts are enforced uniformly and make your system resistant to spoofing and stale credentials.
```

---

## 3. Quick Launch Flow: How to Make It Robust and Safe

```text
Your HostManagementPage already provides a strong UX for enrollment and command generation. Harden it with these principles:

1) Token reveal/copy UX:
   - Keep default state as masked (type="password").
   - Only reveal token on explicit user action ("👁️ Reveal Secret").
   - Copy actions should always go through the helper that surfaces a toast (you already do this).

2) Quick Launch commands must:
   - Use TENANT_ENROLLMENT_TOKEN as an environment variable, not hardcoded literal in scripts.
   - Never write the token to disk; only pass it into the process for initial enroll.
   - Always write endpoint credentials (.siem_credentials.json) to a local path that is not world‑readable.

3) Per‑language snippet alignment:
   - All snippets must follow exactly two steps:
     a) Enroll via POST /api/endpoints/enroll with current TENANT_ENROLLMENT_TOKEN.
     b) Push logs via POST /api/v1/agent/push with Authorization: Bearer <endpoint_secret> and X-Tenant-ID.
   - All snippets must handle 401 as "credentials revoked" and in that case remove the local credential file and re‑enroll automatically.

4) Fleet‑wide tokens:
   - When max_use > 1, highlight in the UI that this token can bootstrap multiple agents and must be treated like a short‑lived secret.
   - Consider a visual warning when expires_in is large (e.g., 24h) to discourage long‑lived tokens.

5) Audit logging:
   - Every call to /admin/enrollment-tokens must be logged with tenant_id, expires_in, max_use, and analyst identity.
   - Every execution of Quick Launch commands can optionally write a small heartbeat log event ("enrollment success") to make verification easier.
```

---

## 4. Multi‑Language SDK Strategy (Python, C#, Go, JS/TS, Bash, Java)

```text
You already have inline examples for Python, C#, Go, TypeScript, and Bash. Convert these into a more formal SDK strategy:

1) Common contract:
   - All SDKs expose three core operations:
     - enroll(enrollment_token: string) -> { endpoint_id, endpoint_secret, tenant_id }
     - pushLogs(events: Event[]) -> void
     - rotateOrReEnrol() [optional helper for handling 401/rotation]

2) Python SDK (siem_connector.py):
   - Extract enrollment + push logic into a reusable class:
     class SiemConnector:
       def __init__(hub_url, cred_path, enroll_token_env_var="TENANT_ENROLLMENT_TOKEN"):
         ...
       def enroll():
         POST /api/endpoints/enroll ...
       def push_logs(events):
         reads creds file or calls enroll; handles 401 by deleting cred file.
   - Package as pip‑installable module for future use.

3) C# .NET SDK (SiemConnector.cs):
   - Already structured as a class — add:
     - Persistent storage of endpoint_secret/tenant_id to a local config file or secrets store.
     - A static builder that reads TENANT_ENROLLMENT_TOKEN from environment for first run.

4) Go SDK (package siem):
   - Provide NewConnector(hubURL, enrollToken) and methods Enroll(), PushLogs(events).
   - Add simple file‑based storage of EndpointSecret/TenantID with re‑enroll on 401.

5) TypeScript SDK (siemConnector.ts):
   - Turn the current file into a module exporting functions enroll() and pushLogs(events).
   - In Node/Bun, store creds to disk; in serverless/PaaS, rely on in‑memory or provider secrets.

6) Bash/CLI use cases:
   - Provide a canonical enroll_and_push.sh script in your repo (you already have one in documentation).
   - Always require TENANT_ENROLLMENT_TOKEN passed at invocation; never embed token in the script.

7) Java (optional, for future):
   - Mirror the C# pattern using HttpClient, making enroll + pushLogs operations the same.

Document all SDKs in a single "SIEM Integration SDK Reference" doc (you started this) and keep the examples in sync with the backend API version.
```

---

## 5. Ensuring Cross‑System Log Coverage & Transaction Capture

```text
You asked: "How do I ensure my codebase can fetch and forward entire transaction logs from different systems simultaneously?"

Design this at the architecture level, then implement per SDK:

1) Sources:
   - Application logs (file, stdout).
   - Database transaction logs (where available and safe to consume).
   - OS audit logs (where agent has permission).
   - Custom app audit events.

2) Agent responsibilities:
   - Each agent (per host/app) must tail, watch, or receive these logs locally.
   - The SDK is responsible only for pushing structured events to the hub; it does not itself parse proprietary formats beyond minimal enrichment.

3) Recommended pattern:
   - Use Fluent Bit/Vector on the host as the primary log collector.
   - Configure Fluent Bit to ship logs over HTTP to /ingest/ using the endpoint credentials.
   - Use your language SDK only for app‑level events (e.g., audit middleware in ASP.NET Core, Express, etc.).

4) Backpressure & robustness:
   - Fluent Bit handles buffering, retries, and backpressure.
   - In your own SDK pushLogs implementations, limit batch size (50–100 events) and implement simple retry with backoff.

5) Multi‑system aggregation:
   - Each system uses the same protocol; the hub distinguishes them via endpoint_id + source + tenant_id.
   - On the ClickHouse side, design tables with tenant_id, endpoint_id, source, severity, timestamp, message, metadata.

6) Verification:
   - Build a small "Log Coverage" dashboard showing for each endpoint:
     - Last ingestion time.
     - Event volume per 5min.
     - Sources seen.
   - This gives you proof that all systems are streaming as expected.
```

---

## 6. Principal‑Level Checklist: What To Implement Next

```text
As a Principal Engineer, treat this as your execution checklist:

1) Backend:
   - Implement /api/v1/agent/push in soc-backend, using verify_endpoint_secret and tenant cross‑check.
   - Harden verify_endpoint_secret to enforce status='active'.
   - Add audit logging for /admin/enrollment-tokens and /admin/endpoints/{id}/rotate.
   - Tie ingestion errors and high‑latency events to Prometheus metrics.

2) UI (HostManagementPage):
   - Ensure TENANT_ENROLLMENT_TOKEN is always treated as a secret (no accidental logging).
   - Keep Quick Launch commands using TENANT_ENROLLMENT_TOKEN env var, not hardcoded tokens.
   - Add a small hint under Quick Launch that the agent should store endpoint_secret locally and re‑enroll on 401.

3) SDKs:
   - Refactor your existing code snippets into small, focused SDK modules per language.
   - Add 401 handling and re‑enroll logic consistently across all languages.
   - Publish internal documentation with a versioned contract for /api/endpoints/enroll and /api/v1/agent/push.

4) Observability:
   - Add a "Agent Health & Enrollment" panel in your UI showing:
     - token issuance events.
     - endpoint status (pending_register vs active).
     - last log push timestamp per endpoint.

5) Security reviews:
   - Review storage locations for .siem_credentials.json and similar artifacts.
   - Consider encrypting local credential files at rest using OS mechanisms or a small symmetric key.
   - Plan secret rotation policies per tenant (e.g., rotate endpoint secrets every 90 days).

Once these items are implemented, your SIEM Integration SDK and Quick Launch flow will be robustly secured, multi-language capable, and architecturally consistent across your entire platform.
```
