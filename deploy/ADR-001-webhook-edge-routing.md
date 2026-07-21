# Architecture Decision Record (ADR-001): Webhook Edge Routing

## Title
Enforce Nginx Edge Proxy for all Third-Party Webhook Ingestion

## Status
Accepted

## Context
The `core-ingest` service receives webhooks from third-party tools (e.g. threat intel feeds, SIEM integrations). There was an ambiguity regarding whether `core-ingest` should expose port 8080 directly to the public internet (`public-ingress` Docker network) to accept these webhooks without friction, or if all webhooks should route through the `soc-frontend` (Nginx Edge Proxy) first.

## Decision
We will strictly route **ALL** webhook traffic through the Nginx Edge Proxy (`soc-frontend`). `core-ingest` must **never** be exposed directly to the `public-ingress` network. 

The Nginx configuration has been updated to include a dedicated `/ingest/` location block that proxies traffic to `core-ingest:8080` over the `internal-mesh` network.

## Rationale
1. **Security & Centralized Defense:** `core-ingest` lacks its own WAF, rate limiting, and TLS termination. Nginx provides all three.
2. **Network Segmentation Integrity:** Exposing `core-ingest` directly violates our Zero-Trust network segmentation model, creating a bypass vector directly to backend databases.
3. **Vendor Compatibility:** Third-party providers universally support configuring webhook paths (e.g., `https://socanalyst.domain.com/ingest/webhook/...`). Direct port exposure is fundamentally unnecessary.

## Consequences
- **Positive:** Enforces strict Zero-Trust boundaries. Protects the ingestion pipeline against layer 7 volumetric DDoS and exploitation.
- **Negative:** Adds a slight configuration overhead to ensure the Nginx `/ingest/` location block handles all expected downstream webhook paths correctly.
