# ADR 002: PaaS-First Orchestration & Networking

## Status
Accepted

## Context
The initial Enterprise Architecture roadmap proposed Kubernetes, Istio, and a raw WireGuard mesh network for internal service isolation. However, the actual deployment model relies heavily on "PaaS-like" managed Droplets (deployed via GitHub Actions + Docker Compose) and true PaaS components (e.g., Managed Databases, App Platform). A blanket recommendation for Kubernetes and custom WireGuard kernel modules assumes full IaaS control, which we intentionally avoid to reduce operational overhead.

## Decision
1. **Orchestration**: We will use GitHub Actions as the primary control plane, triggering `docker compose up` on Tier P2 Droplets and calling platform APIs for Tier P1 PaaS resources. 
2. **Networking**: We adopt **Tailscale** over raw WireGuard for our Tier P2 nodes. It provides the same WireGuard-backed security but automatically handles key exchange and NAT traversal, integrating seamlessly with our CI/CD philosophy.
3. **Postponed Complexity**: We explicitly defer migrating to Kubernetes or Nomad indefinitely. Docker Compose is the right-sized orchestration tool for the current scale.

## Zero-Trust Reconciliation
All Zero-Trust hardening measures introduced in the previous cycle (network segmentation, Nginx rate-limiting, internal API keys, non-root execution, and resource quotas) remain 100% valid and necessary at the Tier P2 level. 

## Trigger Conditions for Reconsideration
We will only revisit the Kubernetes/Swarm decision if the number of Tier P2 nodes grows to >5, rendering manual per-node deployment via GitHub Actions excessively error-prone.
