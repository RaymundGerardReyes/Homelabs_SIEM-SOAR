# ADR 003: HTTP Agent Primary, SSH Break-Glass Only

## Status
Accepted

## Context
The SOC platform must execute automated SOAR playbooks (e.g., isolate host, restart service) on diverse endpoints, including local servers behind Cloudflare Zero Trust Tunnels and remote PaaS instances. The conventional approach involves the SIEM/SOAR hub connecting via SSH to these endpoints. However, maintaining SSH keys for hundreds of endpoints on the SIEM hub drastically increases the blast radius if the hub is compromised. Furthermore, SSH does not natively traverse inbound-blocked Zero Trust Tunnels without complex reverse proxying.

## Decision
1. **HTTP(S) Agent as Primary Control Plane:** Routine monitoring and SOAR actions will be executed exclusively via outbound HTTP(S) polling or Zero-Trust authenticated webhooks. Endpoints will run a lightweight agent (e.g., FluentBit + control daemon) that interacts with `soc-backend` over HTTPS.
2. **Cloudflare Service Tokens for Push Actions:** When `soc-backend` must push a command to a local endpoint hidden behind a tunnel, it will use a Cloudflare Service Token (`CF-Access-Client-Id` and `CF-Access-Client-Secret`) injected into an HTTPS webhook rather than establishing an SSH connection.
3. **SSH for Break-Glass Only:** Interactive SSH is reserved for rare, manual emergency debugging. SSH access must be gated by Cloudflare Access or a bastion host, completely removing direct SSH access from the SIEM's automated SOAR engine.

## Rationale
- **Reduced Blast Radius:** The SIEM does not hold permanent, powerful SSH keys to the entire infrastructure.
- **Zero-Trust Compatibility:** Webhooks authenticated via Cloudflare Access seamlessly traverse Zero Trust Tunnels without exposing any public TCP ports on the target endpoints.
- **Stateless Execution:** HTTP-based SOAR execution integrates cleanly into our stateless backend architecture, allowing Python `asyncio` to trigger thousands of parallel webhooks without managing stateful SSH connection pools.

## Implementation Implications
- `soc-backend`: The playbook execution engine must be updated to dispatch HTTP requests with CF Access headers instead of invoking SSH commands.
- `core-ingest`: Logs must be accepted via HTTPS POST requests from endpoint agents.
- `soc-frontend`: Endpoint management UI must reflect HTTP agent connectivity status rather than SSH ping status.
