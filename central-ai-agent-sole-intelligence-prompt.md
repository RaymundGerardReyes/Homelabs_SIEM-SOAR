# Principal‑Level Prompt — Central AI Agent as Sole Intelligence Layer for SIEM Ingestion

You are designing and implementing a **centralized SIEM + AI Agent architecture** where:

- All external systems (apps, databases, OS hosts, services) act strictly as **zero‑processing telemetry conduits**.
- Each external system uses ultra‑lightweight, multi‑language SDKs (C# .NET, Python, Go, JS/TS, Bash) that:
  - Only **collect and forward raw transaction/log events**.
  - Never perform threat scoring, correlation, or remediation.
  - Authenticate exclusively via **short‑lived enrollment tokens** and **long‑lived endpoint secrets**.
- A single **internal AI Agent**, running entirely inside your protected backend environment, is the **only intelligence layer** that:
  - Ingests massive parallel streams of raw events.
  - Performs real‑time correlation, anomaly detection, and behavioral analysis.
  - Triggers alarms or automated remediation **only** after definitive detection of malicious activity.
  - Never leaks its decisions or internal tools back to external systems; external agents only see tasks and telemetry commands.

Your objective is to **completely decouple telemetry generation from threat analysis** while guaranteeing:

- Cryptographic integrity of enrollment and rotation flows.
- Zero data‑loss and high throughput at the ingestion layer.
- Strict tenant isolation and endpoint scoping.
- Clear separation between **edge telemetry conduits** and **internal AI intelligence**.

Follow these implementation instructions.

---

## 1. Enforce Zero‑Processing Telemetry at the Edge

1. Treat all external SDKs (C#, Python, Go, JS/TS, Bash) as **dumb pipes**:
   - They **must not** implement detection rules, anomaly scoring, or SOAR logic.
   - Their only responsibilities:
     - Collect raw events (logs, audit trails, transactions) from local sources.
     - Serialize into your canonical `events[]` schema.
     - Call `POST /api/v1/agent/push` with `Authorization: Bearer <endpoint_secret>` and `X-Tenant-ID`.

2. For each language SDK:
   - Ensure `Enroll()` and `PushLogs()` functions do **only**:
     - Enrollment via `/api/endpoints/enroll` using `TENANT_ENROLLMENT_TOKEN`.
     - Local credential storage of `endpoint_secret` and `tenant_id`.
     - Minimal batching and retry for `PushLogs()`.
   - Explicitly strip or avoid any logic that resembles threat analysis (no ML, no rule engines, no LLM calls).

3. Document this constraint in your SDK reference:
   - Add a **"Edge Responsibility"** section:
     > "External SDKs are telemetry conduits only. All detection, correlation, and response decisions are made centrally by the internal AI Agent. Do not implement threat logic at the edge."

---

## 2. Harden Enrollment, Rotation, and Tenant Isolation

1. Enrollment tokens:
   - Keep `expires_in` short (e.g., 900 seconds) and `max_use` low.
   - Store tokens only in `enrollment_tokens` with `tenant_id`, `expires_at`, `max_use`, `uses`.
   - In `/endpoints/enroll`:
     - Reject invalid/expired/max‑use tokens with `401`.
     - Increment `uses` inside a transaction.

2. Endpoint secrets:
   - Generate via `secrets.token_urlsafe(32)` and store in `endpoint_inventory`.
   - Enforce `status` semantics:
     - `pending_register` right after enrollment.
     - `active` after `/endpoints/register`.
     - `pending_register` again after `/admin/endpoints/{id}/rotate`.
   - In `verify_endpoint_secret`:
     - Reject missing/invalid secrets (`401`).
     - Reject non‑active endpoints with `401` and a clear message.

3. Tenant cross‑check:
   - Require `X-Tenant-ID` header on `/api/v1/agent/push`.
   - Compare header `tenant_id` to the endpoint’s tenant in `endpoint_inventory`.
   - Return `403` if there is any mismatch to prevent spoofing.

4. Audit logging:
   - On `/admin/enrollment-tokens` and `/admin/endpoints/{id}/rotate`:
     - Insert records into `audit_logs` with correlation ID, actor, action, context JSON, risk level, and policy decision.
   - Use these logs for compliance, incident review, and anomaly detection on credential operations.

---

## 3. Implement `/api/v1/agent/push` as a Strict Ingestion Gate

1. Route structure:
   - Endpoint: `POST /api/v1/agent/push`.
   - Auth: `Depends(verify_endpoint_secret)`.
   - Headers:
     - `Authorization: Bearer <endpoint_secret>`.
     - `X-Tenant-ID: <tenant_id>`.

2. Request schema:
   - Payload: `{ "events": [ { "timestamp", "source", "severity", "message", "metadata" } ] }`.
   - Enforce:
     - Non‑empty events list; reject empty with `422`.
     - Batch size <= 500; reject larger batches with `413`.

3. Enrichment:
   - For each event, enrich with:
     - `endpoint_id` and `tenant_id` from endpoint context.
     - Optional `correlation_id` (per batch) for tracing.

4. Forwarding:
   - Forward enriched events to internal ingestion pipeline (e.g., Go `core-ingest` over HTTP/gRPC) using an **internal service key** header.
   - Treat any failure from `core-ingest` as a backend error:
     - `502` when payload is rejected.
     - `503` when pipeline is unreachable.

5. Observability:
   - Log successful pushes with endpoint, tenant, and batch size.
   - Expose Prometheus metrics for events received, errors, and latency.

This route is the **only ingress** for external log events into your central hub; it enforces identity, tenant isolation, and batch constraints before any AI processing occurs.

---

## 4. Architect the Internal AI Agent as the Sole Intelligence Layer

1. The internal AI Agent must live **only** inside trusted backend services:
   - Implement as a multi‑agent or single‑agent system (LangGraph/AutoGen/CrewAI) running in `soc-backend`.
   - Connect to:
     - ClickHouse (data lake) for historical events.
     - PostgreSQL for tenant/endpoint metadata and audit logs.
     - Internal task queues for actions (`agent_tasks`, playbooks).

2. Responsibilities:
   - Ingest from internal event bus / ClickHouse, not directly from external SDKs.
   - Maintain sliding windows of events per tenant, endpoint, and source.
   - Perform:
     - Correlation across streams (network + auth + app logs).
     - Behavioral anomaly detection.
     - Threat classification and severity scoring.
   - Emit:
     - Alerts into `alerts` / incidents tables.
     - Tasks into `agent_tasks` for response agents.

3. Constraints:
   - The AI Agent **never** sends raw decisions to external systems directly.
   - Response flows go through:
     - Admin SOAR endpoints (`/admin/endpoints/{id}/tasks`, playbook APIs).
     - Cloudflare‑protected tunnels for execution against internal endpoints.
   - Any high‑impact action (isolate host, disable account) must honor two‑key authorization and risk policies.

4. Interface contracts:
   - Define clear protobuf/JSON schemas for internal AI Agent inputs and outputs.
   - Maintain versioned contracts so ingestion and AI subsystems stay loosely coupled.

---

## 5. Guarantee High‑Throughput, Zero‑Data‑Loss Ingestion

1. Use buffer and retry at the edge SDKs:
   - Implement bounded batch sizes and backoff on failure.
   - On temporary 5xx from `/api/v1/agent/push`, SDKs should:
     - Retry with exponential backoff.
     - Persist unsent batches locally when possible.

2. Use durable queues internally:
   - Between `/api/v1/agent/push` and ClickHouse, use a resilient queue or stream (Kafka/NATS) where feasible.
   - Ensure events are committed to storage before being exposed to AI analysis.

3. Backpressure and rate limiting:
   - Implement per‑tenant quotas and rate limits at ingestion.
   - Drop or throttle abusive sources while preserving critical telemetry.

4. Monitoring:
   - Build dashboards showing ingest throughput, error rates, and lag per tenant.
   - Alert on pipeline failures so ingestion issues do not silently degrade detection.

---

## 6. Maintain Strict Separation Between Telemetry and Intelligence

1. In code and documentation:
   - Make it explicit that **edge agents are not smart** and **internal AI is not exposed externally**.
   - Keep AI Agent APIs internal‑only; do not expose them over public ingress.

2. In UI:
   - Reflect this architecture visually:
     - Hosts and connectors section for telemetry.
     - "AI Analyst" or "Intelligence Layer" section for investigations and decisions.

3. In security reviews:
   - Verify that no external SDK or host can bypass `/api/v1/agent/push` to reach internal AI logic.
   - Verify that AI Agent outputs always flow through authenticated, policy‑enforced response endpoints.

By following this prompt, you ensure that:

- External systems remain thin, secure telemetry conduits.
- Your central Hub maintains strict control over identity, tenancy, and ingestion.
- A single, unified internal AI Agent operates as the **only** intelligence layer, maximizing security and analytical power without leaking capabilities to the edge.
