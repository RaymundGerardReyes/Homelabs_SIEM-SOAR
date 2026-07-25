# Principal SIEM/SOAR Architect Prompt: Hybrid Endpoint Integration via Cloudflare Zero Trust

## Objective
You are a Principal SIEM/SOAR Architect. Your objective is to design and implement the logic for "adding external servers" (Endpoints) to the SIEM/SOAR platform so they can be monitored and controlled. 

These external servers represent the *targets* of the SIEM (not the SIEM infrastructure itself). They exist in disparate environments:
1. **Local Servers** running behind Cloudflare Zero Trust Tunnels (no public inbound IP).
2. **PaaS/IaaS Cloud Servers** producing public internet traffic.
Both route through the same Cloudflare Reverse Proxy ecosystem.

## Task Instructions for the AI to Execute

### 1. Hub-and-Spoke Ingestion Logic (Spoke to Hub)
Define exactly how disparate servers send their logs to the SIEM `core-ingest` engine.
- **The Logic:** The SIEM is the "Hub" accessible via `https://siem.yourdomain.com/ingest/` (fronted by Cloudflare). The external servers are "Spokes".
- **Implementation:** Guide the setup of a lightweight agent (e.g., FluentBit or a custom Go binary) on the Local and PaaS servers. This agent collects system logs/metrics and POSTs them over outbound HTTPS to the SIEM edge proxy, bypassing inbound firewall restrictions entirely.
- **Authentication:** Detail how these spokes authenticate using the Zero-Trust API keys established in ADR-001.

### 2. SOAR Execution Logic through Cloudflare Tunnels (Hub to Spoke)
Define how the `soc-backend` executes automated playbooks (e.g., "isolate host", "block IP") on a Local Server that is completely hidden behind a Cloudflare Zero Trust Tunnel.
- **The Logic:** Because the Local Server has no public IP, the `soc-backend` cannot SSH into it directly.
- **Implementation (Option A: Polling Agent):** The agent on the local server polls the `soc-backend` every 5 seconds over outbound HTTPS asking, "Are there any SOAR playbooks I need to execute locally?"
- **Implementation (Option B: CF Service Tokens):** The `soc-backend` sends an HTTP webhook directly to the Local Server's Cloudflare Tunnel URL, injecting `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers to bypass the Zero Trust identity barrier and trigger a local script.
- Provide the exact Python snippet for `soc-backend/domain/playbooks/executor.py` demonstrating how to authenticate through a Cloudflare Tunnel using Service Tokens.

### 3. Registering the Servers in the SIEM Asset Inventory
Explain how these diverse servers are actually "added" to the `soc-frontend` and `soc-backend`.
- **Backend (`soc-backend`):** Define a `/api/endpoints/register` route where a new server (PaaS, IaaS, or Local) announces its presence, its capabilities (e.g., "Can execute Docker blocks", "Runs Windows"), and its Cloudflare Tunnel URL.
- **Frontend (`soc-frontend`):** Define how these appear in the Asset Inventory page, clearly tagging whether the endpoint is "Local (CF Tunnel)", "PaaS", or "IaaS", along with its live connection status.

### 4. Cross-Environment Correlation (The Magic)
Explain how the SIEM unifies attacks crossing these boundaries. For example, if an attacker hits the public Cloudflare Reverse Proxy of the PaaS system, and then attempts to pivot to the Local Server via an internal tunnel.
- Define how `core-ingest` standardizes the logs from both systems into a single Common Data Model (CDM) using the `CF-Ray` header or client IP to trace the attack path across the hybrid environments.

## Output Format
Provide a comprehensive implementation plan that bridges `soc-frontend`, `soc-backend`, and `core-ingest`. Include specific code snippets for the Cloudflare Service Token SOAR executor and the FluentBit/Agent ingestion configuration that must run on the external servers.
