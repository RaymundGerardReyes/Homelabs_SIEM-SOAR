# Principal SIEM/SOAR Architect Prompt (Monolith) — Hybrid PaaS/IaaS/Local Endpoint Orchestration over Cloudflare Zero Trust

## Objective

You are a Principal SIEM/SOAR Architect and Backend/Frontend Engineer responsible for a single, complete, end-to-end implementation of a hybrid endpoint monitoring and control system. This system must allow a central SIEM/SOAR hub (`soc-frontend`, `soc-backend`, `core-ingest`) to ingest logs from, and execute automated response actions on, external endpoints across three distinct environments — Local servers behind Cloudflare Zero Trust Tunnels (no public inbound IP), IaaS droplets/VMs (full terminal access), and PaaS platforms (HTTP/build-log access only, no persistent SSH) — using open-source tooling wherever possible, without requiring the hub to generate, distribute, or manage raw SSH keys to every endpoint.

This prompt consolidates and finalizes four previously drafted sub-prompts (ingestion/control agent design, endpoint registration and asset inventory, cross-environment correlation, and the SSH feasibility policy) into one authoritative implementation specification. Execute all sections in order; do not treat any section as optional.

---

## Architectural Decision (Non-Negotiable, Established Upfront)

Before writing any code, adopt this decision as the foundation for every subsequent task:

**HTTP agents over Cloudflare Zero Trust are the primary automation path for both monitoring and control, across all three endpoint tiers (Local/IaaS/PaaS). SSH is a secondary, manual, break-glass mechanism only — never the mechanism the SIEM/SOAR hub uses to automate actions.**

Rationale to document in an ADR before implementation begins:
1. Reverse SSH tunnels (autossh) from every endpoint to a central server are technically possible, but require the hub to hold SSH credentials to every endpoint, which maximizes blast radius if the hub is ever compromised[web:124][web:128][web:135].
2. Managing and rotating SSH keys across a growing number of endpoints becomes fragile compared to Cloudflare Access service tokens and mTLS certificates, which are centrally issued, scoped, and revocable[web:126][web:130][web:137].
3. PaaS platforms frequently cannot run persistent SSH daemons or autossh tunnels inside their managed containers/dynos at all — Heroku's own SSH tunneling (Heroku Exec) is scoped to a live dyno session, not a persistent inbound channel, and free/managed tiers add further restrictions[web:127][web:131][web:138]. Any design that assumes SSH works identically everywhere will silently fail on PaaS.
4. Cloudflare Zero Trust already solves the "no public IP" problem for HTTP without any SSH involvement — Cloudflare Tunnel exposes an HTTP service outbound-only, and Cloudflare Access enforces identity before any request reaches the origin[web:125][web:129][web:136].
5. Cloudflare Zero Trust SSH remains available specifically for the rare cases where a human operator needs a real terminal session, using identity-based access (Warp + Access policies) instead of static keys distributed to automation systems[web:125][web:129][web:136].

Write this as ADR-002 ("HTTP Agent Primary, SSH Break-Glass Only") before proceeding.

---

## Open-Source Tooling Selection (Use These, Justify Any Deviation)

Select and justify each tool choice explicitly so the resulting stack is fully open-source and swappable:

| Layer | Recommended Open-Source Tool | Why |
|---|---|---|
| Log/telemetry shipping agent | **Fluent Bit** (CNCF project) | Lightweight (low CPU/memory footprint), ideal for resource-constrained IaaS/local nodes and PaaS sidecars, supports HTTPS output with custom headers for Cloudflare Access tokens[web:142][web:148][web:154]. |
| Alternative shipping agent (if higher throughput/processing needed) | **Vector** (Datadog, open-source, Rust) | Higher throughput and lower resource use than Logstash in benchmarks; a valid substitute for Fluent Bit if the endpoint has more compute headroom and needs richer transform pipelines[web:140][web:144][web:146][web:150][web:152]. |
| Custom control agent (polling/webhook executor) | Custom lightweight Go or Python binary (built in-repo) | No existing open-source agent perfectly matches your polling + webhook hybrid model; build a minimal agent reusing your existing Go/Python skillset rather than adopting a heavyweight external agent framework. |
| SOAR workflow/playbook reference patterns | **CISA shareable-soar-workflows** (vendor-agnostic playbook definitions) | Free, government-published, vendor-agnostic SOAR workflow patterns you can adapt into your own playbook schema instead of designing playbook structure from zero[web:147]. |
| SOAR platform inspiration / potential future replacement or complement | **Shuffle**, **Tracecat**, **StackStorm**, **TheHive**, **SOARCA** | All fully open-source SOAR/case-management platforms; SOARCA specifically ships native HTTP(S), SSH, and OpenC2 execution support and is worth studying for its playbook execution model even if you keep your own custom soc-backend[web:141][web:143][web:149][web:151]. Do not adopt one wholesale mid-project — reference their execution/playbook models to validate your own design choices. |
| Zero-Trust tunnel and identity layer | **Cloudflare Tunnel + Cloudflare Access** (already in use) | Already integrated into your stack; continue as the exclusive tunnel/identity layer rather than introducing a second overlapping system. |

Use Fluent Bit as the default agent unless a specific endpoint demonstrates throughput/processing needs that justify Vector; do not run both simultaneously on the same endpoint without a documented reason.

---

## Section 1: Ingestion Agent (Spoke → Hub)

Implement the following exactly as specified:

1. Deploy **Fluent Bit** on every endpoint (Local, IaaS, PaaS) as the default log-shipping agent:
   - Fluent Bit reads system logs (syslog, application logs) and structured telemetry from the endpoint.
   - Fluent Bit batches entries and sends them via HTTPS POST to `https://siem.yourdomain.com/ingest/`, which is fronted by Cloudflare Tunnel and WAF.
   - Every request includes Cloudflare Access service token headers:
     - `CF-Access-Client-Id: <CLIENT_ID>`
     - `CF-Access-Client-Secret: <CLIENT_SECRET>`[web:126][web:137]
   - Optionally attach mTLS client certificates for endpoints requiring device-level assurance beyond the service token[web:130].

2. Example Fluent Bit output configuration (`fluent-bit.conf`) for an endpoint:

```ini
[INPUT]
    Name              tail
    Path              /var/log/app/*.log
    Tag               endpoint.applog

[OUTPUT]
    Name              http
    Match             endpoint.applog
    Host              siem.yourdomain.com
    Port              443
    URI               /ingest/
    Format            json
    tls               On
    Header            CF-Access-Client-Id ${CF_ACCESS_CLIENT_ID}
    Header            CF-Access-Client-Secret ${CF_ACCESS_CLIENT_SECRET}
    Header            X-Endpoint-Id ${ENDPOINT_ID}
    Retry_Limit       5
```

3. On `soc-backend`/`core-ingest`, validate the Cloudflare Access service token (and mTLS certificate, if present) on every ingest request before accepting the payload, and map the validated identity to a registered endpoint (Section 3) before writing to storage. Reject and log any unauthenticated or unregistered request rather than silently dropping it.

---

## Section 2: SOAR Control Protocol (Hub → Spoke)

Implement both control options, selected per endpoint based on its tier:

1. **Option A — Polling Agent** (required for strict PaaS with no inbound capability):
   - The endpoint's control agent calls `GET https://siem.yourdomain.com/api/agents/tasks?endpoint_id=<id>` on an interval (e.g., every 5–15 seconds, configurable per endpoint to balance responsiveness vs. load).
   - `soc-backend` returns any pending actions queued for that endpoint; the agent executes them locally and reports results via `POST /api/agents/tasks/{task_id}/result`.

2. **Option B — Cloudflare Tunnel Webhook** (for endpoints, typically Local/IaaS, that can host an internal agent API behind their own Cloudflare Tunnel):
   - `soc-backend` sends the action directly to `https://endpoint-123.yourdomain.com/agent/execute`, with Cloudflare Access service token headers, avoiding the polling delay.

3. Standardize the action schema across both options:

```json
{
  "action": "isolate_host",
  "params": {
    "target_ip": "10.0.0.5",
    "duration_minutes": 30
  },
  "correlationId": "a1b2c3d4-...",
  "issuedAt": "2026-07-22T03:10:00Z",
  "requiresAck": true
}
```

4. Decision rule for choosing Option A vs B per endpoint: default to Option A for any endpoint tagged `type: paas` (since inbound HTTP is typically unavailable); use Option B only for endpoints tagged `type: iaas` or `type: local_cf_tunnel` that have confirmed their own Cloudflare Tunnel is active and can expose `/agent/execute` internally.

---

## Section 3: Cloudflare Service Token SOAR Executor (Python Implementation)

Implement `soc-backend/domain/playbooks/executor.py` exactly as follows, using Cloudflare Access service tokens rather than SSH:

```python
import httpx
from datetime import datetime, timezone

async def execute_playbook_on_endpoint(endpoint, action_payload):
    """
    Executes a SOAR action against an endpoint via its Cloudflare Tunnel URL,
    authenticated using Cloudflare Access Service Tokens.
    endpoint: object with cf_tunnel_url, cf_client_id, cf_client_secret, id
    action_payload: dict matching the standardized action schema
    """
    url = f"{endpoint.cf_tunnel_url.rstrip('/')}/agent/execute"
    headers = {
        "CF-Access-Client-Id": endpoint.cf_client_id,
        "CF-Access-Client-Secret": endpoint.cf_client_secret,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(url, json=action_payload, headers=headers)
        except httpx.RequestError as e:
            await record_action_failure(
                endpoint.id, action_payload,
                reason=f"network_error: {e}",
                timestamp=datetime.now(timezone.utc),
            )
            raise

    if resp.status_code == 200:
        await record_action_success(endpoint.id, action_payload, resp.json())
    elif resp.status_code == 403:
        await record_action_failure(
            endpoint.id, action_payload,
            reason="service_token_invalid_or_expired",
            timestamp=datetime.now(timezone.utc),
        )
    else:
        await record_action_failure(
            endpoint.id, action_payload,
            reason=f"http_{resp.status_code}: {resp.text}",
            timestamp=datetime.now(timezone.utc),
        )

    return resp
```

For endpoints using Option A (polling), implement the corresponding queue-and-poll pair of routes in `api_routes.py` (`GET /api/agents/tasks`, `POST /api/agents/tasks/{task_id}/result`) using the same `record_action_success`/`record_action_failure` audit functions for consistency.

---

## Section 4: Endpoint Registration and Asset Inventory

### Backend: `/api/endpoints/register`

```json
{
  "id": "optional-existing-id",
  "hostname": "edge-node-01",
  "label": "CDMU Cagayan de Oro CCTV Node",
  "type": "local_cf_tunnel",
  "cf_tunnel_url": "https://edge-node-01.yourdomain.com",
  "cf_client_id": "issued-by-cloudflare",
  "cf_client_secret": "issued-by-cloudflare",
  "capabilities": ["can_execute_docker", "has_agent_v1", "runs_linux"],
  "agent_version": "1.2.0",
  "os": "ubuntu-22.04",
  "region": "ph-cdo"
}
```

Requirements:
1. Reject any registration request that does not present a valid Cloudflare Access service token or mTLS certificate — unauthenticated registration must be impossible.
2. Store the record in an endpoint inventory table keyed by `id`, and link it to both incoming log streams (Section 1) and the SOAR task queue (Section 2) via that same `id`.
3. Update `last_checkin_at` on every successful poll (Option A) or webhook call (Option B) so connection status can be derived without a separate heartbeat mechanism.

### Frontend: Asset Inventory Page

1. Display endpoints grouped and tagged by `type`:
   - Badge: `Local (CF Tunnel)`, `IaaS`, `PaaS`.
   - Live connection status derived from `last_checkin_at` (e.g., green if checked in within the expected polling interval, red/gray otherwise).
2. Provide deep-links from each endpoint row to:
   - `EdrLogsPage` filtered to that `endpoint_id`.
   - `IsolationControlsPage` pre-scoped to that endpoint (meaningful for IaaS/Local; may be disabled or hidden for PaaS endpoints where host isolation is not applicable).
3. Add an "Access" tab per endpoint surfacing:
   - The Cloudflare Tunnel hostname (for Local/IaaS).
   - The Cloudflare SSH application name/link, explicitly labeled "Manual/Break-Glass Access Only" — reinforcing the ADR-002 policy directly in the UI so operators never mistake this for the automation path.

---

## Section 5: Cross-Environment Correlation (Common Data Model)

Extend the Common Data Model (CDM) in `core-ingest` so every log entry passing through Cloudflare includes:

```json
{
  "cf_ray_id": "7d8f9a1b2c3d4e5f-SJC",
  "client_ip": "203.0.113.42",
  "endpoint_id": "edge-node-01",
  "endpoint_type": "local_cf_tunnel",
  "http_path": "/api/login",
  "user_agent": "Mozilla/5.0 ...",
  "tls_fingerprint": "ja3:...",
  "timestamp": "2026-07-22T03:10:00Z"
}
```

Correlation rule example (pseudo-SQL against ClickHouse):

```sql
SELECT client_ip, cf_ray_id,
       groupArray(endpoint_id) AS endpoints_touched,
       groupArray(endpoint_type) AS endpoint_types,
       min(timestamp) AS first_seen,
       max(timestamp) AS last_seen
FROM cdm_events
WHERE timestamp > now() - INTERVAL 15 MINUTE
GROUP BY client_ip, cf_ray_id
HAVING length(groupUniqArray(endpoint_type)) > 1
   AND has(endpoint_types, 'paas')
   AND has(endpoint_types, 'local_cf_tunnel')
```

This flags any `client_ip`/`cf_ray_id` pair that touched both a PaaS-tagged endpoint and a Local-tagged endpoint within a 15-minute window — a strong signal of edge-to-internal pivot behavior[web:136]. Feed matches into `InvestigationGraph` and `WarRoomPage` as a single connected attack-path visualization ("Edge (PaaS app) → Internal Tunnel (Local server)") rather than two disconnected alerts.

---

## Section 6: SSH Policy — Final, Binding Statement

This section resolves definitively whether the hub should auto-generate/distribute SSH keys to endpoints.

**Policy (ADR-002, restated for enforcement):**

1. The SIEM/SOAR hub (`soc-backend`) must never hold, generate, or distribute SSH private keys to endpoints as part of its automation logic. All automated ingestion and control flows through Fluent Bit + the custom control agent over HTTPS with Cloudflare Access service tokens, as specified in Sections 1–3.
2. SSH access to any endpoint, when genuinely required (deep OS debugging, agent recovery when the HTTP control path itself is broken), must go through Cloudflare Zero Trust SSH or a dedicated bastion host with identity-based access — never a direct key held by the hub[web:125][web:129][web:134][web:136].
3. Reverse SSH tunnels/autossh from endpoints to the hub are explicitly disallowed as a design pattern for this platform, despite being technically achievable[web:124][web:128][web:135] — the operational and security cost (key sprawl, expanded blast radius, inconsistent support across PaaS tiers[web:127][web:131][web:138]) outweighs any convenience gained.
4. Any future engineer proposing to "just SSH into the endpoint from soc-backend" for a new feature must be redirected to this ADR and required to implement the feature via the polling agent or Cloudflare Tunnel webhook pattern instead.

---

## Final Deliverables Checklist

| Deliverable | Section | Open-Source Tool Used |
|---|---|---|
| ADR-002: HTTP Agent Primary, SSH Break-Glass Only | Preamble | — |
| Fluent Bit config on every endpoint tier | 1 | Fluent Bit[web:142][web:148] |
| Polling (`/api/agents/tasks`) and webhook (`/agent/execute`) control routes | 2 | Custom Go/Python agent |
| `executor.py` Cloudflare Service Token implementation | 3 | Cloudflare Access[web:126][web:137] |
| `/api/endpoints/register` + Asset Inventory UI with tier badges and Access tab | 4 | — |
| Extended CDM schema + correlation rule | 5 | ClickHouse (existing) |
| Binding SSH policy statement enforced in code review / ADR | 6 | Cloudflare Zero Trust SSH (break-glass only)[web:125][web:129][web:134][web:136] |

---

## Recommended Execution Order

1. Write and merge ADR-002 first — this prevents any parallel work from assuming SSH-based automation.
2. Implement Section 1 (Fluent Bit ingestion) on one pilot endpoint per tier (one PaaS, one IaaS, one Local) before rolling out broadly.
3. Implement Section 3 (executor.py) and Section 2 (polling/webhook routes) together, since they are two sides of the same control flow.
4. Implement Section 4 (registration + inventory UI) once at least one endpoint per tier is successfully sending logs and receiving control actions.
5. Implement Section 5 (correlation) last, since it depends on real CDM data flowing from multiple endpoint types simultaneously.
