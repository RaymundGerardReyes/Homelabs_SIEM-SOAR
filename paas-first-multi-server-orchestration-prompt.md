# Principal Platform Architect Prompt — PaaS-First Multi-Server Orchestration & Monitoring (Docker + GitHub-Driven)

This prompt reframes the previous Zero-Trust hardening and enterprise roadmap for the reality of the actual deployment model: **primarily PaaS (DigitalOcean App Platform / managed droplets provisioned via Docker images built from GitHub, not raw self-managed IaaS VMs), with only occasional/rare direct IaaS access**. It explicitly resolves whether WireGuard is viable in a PaaS context, and defines how to orchestrate and monitor services across local development machines and remote PaaS-hosted servers using Docker and GitHub as the primary control mechanisms, rather than assuming full root/network-level control of every node.

---

## 1. Clarify the PaaS vs IaaS Boundary Before Choosing Any Networking Strategy

```text
You are a Principal Platform Architect determining which orchestration and networking techniques are actually available given a PaaS-first deployment model, before recommending any specific tool.

Context: The current production system runs via Docker containers built from a GitHub repository, deployed primarily to PaaS-style hosting (e.g., DigitalOcean App Platform, or DigitalOcean Droplets managed largely through docker-compose rather than hand-tuned bare-metal configuration), with IaaS-level access (raw VM root access, custom kernel networking, ability to install arbitrary system-level VPN daemons) being rare, not the default operating mode.

Your task:
1. Classify each of the current/target hosting surfaces explicitly into one of three tiers:
   - Tier P1 (Pure PaaS, no shell/root access): e.g., DigitalOcean App Platform, most serverless container platforms. WireGuard, custom kernel modules, or raw iptables rules are NOT possible here — the platform manages networking entirely.
   - Tier P2 (Managed Droplet/VM with root access, but managed as "PaaS-like" via Docker/GitHub Actions): e.g., a DigitalOcean Droplet you provisioned but interact with primarily through `docker compose up` via CI/CD rather than manual server administration. WireGuard IS possible here because you have root/SSH access, even though the day-to-day workflow feels PaaS-like.
   - Tier IaaS (rare, occasional direct access): full manual server administration when explicitly needed (e.g., emergency debugging, one-off migrations).
2. For every current server/component in the stack (soc-frontend, soc-backend, core-ingest, Postgres, ClickHouse, any GPU inference node), determine which tier it actually belongs to today, and document this in a simple table.
3. State explicitly: WireGuard-based mesh networking is only viable on Tier P2 and Tier IaaS nodes (anything where you can install a VPN daemon and open a UDP port). On true Tier P1 PaaS platforms, private networking must instead rely on the platform's own built-in private networking feature (e.g., DigitalOcean VPC/Private Networking) or a managed alternative (see Section 2).

Return the tier classification table and a one-paragraph recommendation on which networking strategy applies to each tier.
```

---

## 2. Networking Strategy Per Tier — What Actually Works on PaaS

```text
You are a Principal Network Architect defining exactly how private connectivity between servers is achieved for each tier identified in Section 1, since a single blanket "use WireGuard" answer does not apply cleanly to pure PaaS platforms.

For Tier P1 (Pure PaaS, no root access):
1. Use the platform's native private networking feature where available (e.g., DigitalOcean VPC gives all droplets/App Platform components in the same region a private IP range automatically, with no VPN daemon required on your part).
2. If the PaaS platform offers no private networking at all, fall back to encrypted public communication: all cross-service traffic must go over HTTPS/TLS with mutual authentication at the application layer (API keys, JWT service tokens) rather than relying on network-level isolation — since you cannot control the network layer on this tier, you must push the Zero-Trust boundary up into the application layer instead.
3. Recommend Tailscale as a middle-ground alternative to raw WireGuard specifically because it works even in more constrained environments: Tailscale is built on WireGuard but handles NAT traversal, key exchange, and coordination automatically via a control-plane service, and it has a lightweight userspace client that can run inside a container without needing kernel-level network configuration in many cases — evaluate whether the specific PaaS platform allows even a userspace Tailscale client to run as a sidecar container.

For Tier P2 (Droplet/VM with root access, operated PaaS-style via Docker/GitHub):
1. WireGuard IS viable here since root/SSH access exists — but the workflow should still remain PaaS-like: WireGuard configuration (keys, peer lists) should be generated once, stored as GitHub Actions secrets or environment variables, and injected into the container/VM via the deployment pipeline, not manually typed on the server each time.
2. Alternatively, and often simpler for a small number of Tier P2 nodes, use Tailscale instead of raw WireGuard — it eliminates manual key/peer management entirely, integrates with GitHub Actions (official `tailscale/github-action`) to bring a CI/CD runner or deployment step onto the private mesh automatically, and requires zero manual VPN administration going forward.
3. If already using DigitalOcean, prefer DigitalOcean VPC private networking between droplets in the same region/account before adding WireGuard/Tailscale — VPC is free, requires no extra daemon, and is already effectively "PaaS-native" private networking.

For Tier IaaS (rare direct access):
1. Full WireGuard mesh remains the most control-maximizing option when you do have occasional deep access, but should still be provisioned via an Infrastructure-as-Code script (Ansible/Terraform or even a documented shell script committed to the repo) rather than manual one-off configuration, so it is reproducible if the server needs to be rebuilt.

Return a decision matrix: Tier | Recommended Networking Approach | Why | Fallback If Unavailable.
```

---

## 3. Orchestration Without Full IaaS Control — Docker + GitHub as the Control Plane

```text
You are a Principal DevOps Engineer designing an orchestration workflow that does not assume full Kubernetes/Swarm-style multi-node scheduling control, since that model assumes IaaS-level access to every node, which is not the primary operating mode here.

Your task:
1. Treat GitHub (the repository) as the source of truth and GitHub Actions as the orchestration trigger, rather than a traditional cluster scheduler:
   - Every push/merge to main triggers a GitHub Actions workflow that builds Docker images for soc-frontend, soc-backend, and core-ingest and pushes them to a container registry (GitHub Container Registry or Docker Hub).
   - Separate deployment jobs in the same workflow then deploy the updated images to each target server/platform independently: a Tier P1 job calls the PaaS platform's deploy API/CLI (e.g., `doctl apps update` for DigitalOcean App Platform); a Tier P2 job SSHes into the droplet (using a GitHub Actions SSH action) and runs `docker compose pull && docker compose up -d`.
2. For Tier P2 droplets specifically, define a lightweight "orchestration" pattern that does not require full Swarm/Kubernetes:
   - Use Docker Compose with `restart: unless-stopped` (as already configured) for self-healing on a single node.
   - If a specific service must run redundantly across 2+ Tier P2 droplets (e.g., soc-backend for availability), use a simple external health-check-based load balancer (Cloudflare Load Balancing, or Nginx upstream with health checks) rather than standing up a full Swarm cluster just for 2-3 services — this matches the PaaS-first philosophy of using managed edge services instead of self-hosted cluster control planes.
3. Only recommend Docker Swarm or Kubernetes if/when the number of Tier P2 nodes grows large enough (e.g., 5+) that manual per-node deployment via GitHub Actions becomes error-prone — document this as an explicit future trigger condition, not a default assumption.
4. Ensure secrets (API keys, database URLs, internal service keys from the earlier Zero-Trust plan) are stored as GitHub Actions encrypted secrets and injected as environment variables at deploy time for every tier, never committed to the repository or hardcoded in Dockerfiles.

Return the GitHub Actions workflow YAML structure (build job + per-tier deploy jobs) and the corresponding docker-compose deployment commands for Tier P2 nodes.
```

---

## 4. Connecting Local Development to Remote PaaS/Droplet Servers

```text
You are a Principal DevOps Engineer defining how a local development machine (used for coding and testing) connects securely to remote Tier P2/PaaS-hosted services, without requiring the local machine to join a full production network.

Your task:
1. For local-to-remote database/service access during development (e.g., connecting a local script to a remote Postgres or ClickHouse instance for debugging), recommend either:
   a. Tailscale on the local development machine as well — since Tailscale's client runs easily on Windows/Mac/Linux dev machines, joining the local machine to the same private mesh as Tier P2 droplets makes remote debugging feel like accessing a local service, without exposing the database port publicly.
   b. If Tailscale is not desired for local dev, use SSH port-forwarding/tunneling (`ssh -L 5432:localhost:5432 user@droplet-ip`) as a lower-overhead, no-install-required alternative for occasional debugging access.
2. Explicitly prohibit exposing production databases (Postgres, ClickHouse) on public IPs with password-only authentication for "developer convenience" — this must always go through either the Tailscale mesh or an SSH tunnel, never a public port with just a password.
3. Document this local-to-remote access pattern as a short onboarding note (e.g., in PLATFORM.md) so future contributors have one clear, secure method rather than each improvising their own (often less secure) workaround.

Return the documented local development connectivity procedure (Tailscale-based and SSH-tunnel-based options), with clear guidance on when to use each.
```

---

## 5. Monitoring Across PaaS + Tier P2 Nodes

```text
You are a Principal Observability Engineer designing a monitoring setup that works across a mix of Tier P1 PaaS components (limited/no metrics exporter access) and Tier P2 droplets (full access), using the existing prometheus.yml as a starting point.

Your task:
1. For Tier P2 droplets (full access): deploy node_exporter and the existing application-level Prometheus metrics endpoints (soc-backend, core-ingest) as normal, and have a central Prometheus instance (hosted on one of the Tier P2 droplets, or a small dedicated monitoring droplet) scrape them over the private Tailscale/VPC network established in Section 2 — never over the public internet.
2. For Tier P1 PaaS components where you cannot install node_exporter or control the network path: rely on the PaaS platform's own built-in metrics/monitoring API (e.g., DigitalOcean App Platform's built-in metrics and alerting, or the platform's status/health API) and pull those into your central observability stack via a Prometheus "pushgateway" pattern or a scheduled GitHub Actions job that polls the platform API and pushes metrics into your Prometheus/Grafana stack, since you cannot scrape a P1 component directly.
3. Ensure Grafana (pointed at the same central Prometheus) presents both Tier P1 platform-level metrics and Tier P2 infrastructure-level metrics on unified dashboards, clearly labeled by tier so on-call responders understand which metrics come from a fully-controlled node vs. a managed platform's own reporting.
4. Configure Alertmanager to route alerts consistently regardless of tier — a P1 platform health-check failure and a P2 node_exporter `up == 0` should both reach the same Slack/PagerDuty/SMS (PhilSMS/Twilio) channel, so on-call response is not tier-dependent.
5. Add a GitHub Actions scheduled workflow (cron trigger) as a synthetic monitoring layer: periodically curl the public-facing Cloudflare-fronted hostname from GitHub's runners and assert a 200 response, catching the exact class of intermittent 502 Host Errors previously diagnosed, independent of which tier is actually failing underneath.

Return the updated prometheus.yml scrape configuration (Tier P2 targets over the private network) and the GitHub Actions synthetic-monitoring workflow YAML.
```

---

## 6. Final Reconciliation — What Changes From the Previous Zero-Trust/Enterprise Roadmap

```text
You are a Principal Platform Architect reconciling this PaaS-first orchestration model with the previously defined Zero-Trust Hardening and Enterprise Roadmap plan, to ensure no contradictory guidance remains.

Your task:
1. Confirm that all Zero-Trust controls from the prior plan (network segmentation, service-to-service API keys, Nginx rate limiting, non-root execution, resource quotas) remain fully valid and required specifically at the Tier P2 level (droplets you control via Docker Compose) — none of that guidance changes.
2. Explicitly amend the prior plan's "Stage 5: Orchestration migration (Kubernetes or Nomad)" recommendation: given the confirmed PaaS-first, rarely-IaaS operating model, defer full Kubernetes/Nomad migration indefinitely unless Tier P2 node count grows past the threshold defined in Section 3 of this document — Docker Compose + GitHub Actions + Tailscale/VPC is the right-sized orchestration model for the current and near-future scale, not a stepping stone to be abandoned quickly.
3. Confirm the Enterprise Architecture Study's Istio/Service Mesh and Kafka/RabbitMQ recommendations remain valid future options only if Tier P2 node count or message volume grows enough to justify the added operational complexity — restate that they are not required at current scale and would add overhead disproportionate to benefit today.
4. Update the ADR log with this PaaS-first networking and orchestration decision so future engineers understand why WireGuard/Kubernetes were not adopted outright, and what specific growth trigger would justify revisiting that decision.

Return the finalized ADR entry summarizing the PaaS-first orchestration decision, its rationale, and the explicit trigger conditions for reconsidering it.
```

---

## 7. Summary Decision Table

| Concern | Tier P1 (Pure PaaS) | Tier P2 (Droplet, PaaS-operated) | Tier IaaS (Rare direct access) |
|---|---|---|---|
| Private networking | Platform VPC or app-layer TLS/API keys; Tailscale only if sidecar-capable | Tailscale (preferred) or WireGuard, provisioned via CI/CD secrets | Full WireGuard mesh via IaC script |
| Orchestration trigger | GitHub Actions calls platform deploy API/CLI | GitHub Actions SSH + `docker compose up -d` | Manual or Ansible/Terraform, rare |
| Scaling/redundancy | Platform-native autoscaling if offered | Cloudflare/Nginx load balancing across 2+ droplets | N/A until node count justifies Swarm/K8s |
| Monitoring | Platform metrics API polled via scheduled GitHub Action into Prometheus | node_exporter + app metrics scraped directly over private network | Same as P2, plus manual deep-dive access |
| Secrets | GitHub Actions encrypted secrets injected at deploy | Same | Same |
| Local dev connectivity | N/A (no direct access) | Tailscale on dev machine, or SSH tunnel | SSH tunnel |

---

## 8. Recommended Immediate Next Step

Classify every current component against the Tier table in Section 1 first — this single step determines which of the remaining sections actually apply to each part of the stack. For the droplet-hosted components (soc-frontend, soc-backend, core-ingest, Postgres, ClickHouse likely fall into Tier P2 given Docker Compose usage), adopt Tailscale over raw WireGuard as the default private networking layer, since it removes manual key management entirely and integrates directly with GitHub Actions for both deployment and local developer access — then layer the existing Zero-Trust hardening plan on top of that private network exactly as originally specified.
