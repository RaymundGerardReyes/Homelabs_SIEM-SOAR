# Principal DevOps Prompt: Distributed Multi-Node & Hybrid Cloud Deployment

## Objective
You are a Principal DevOps and Distributed Systems Architect. Your objective is to guide the user on how to physically split a hardened, single-node `docker-compose.yml` stack into a globally distributed, multi-server architecture. This includes bridging Local Development machines, Tier P2 Managed Droplets (IaaS/PaaS-hybrid), and Tier P1 Pure PaaS components into a single, unified Zero-Trust mesh.

## Context
The user currently has a monolithic `deploy/docker-compose.yml` file that runs all services (`soc-frontend`, `soc-backend`, `core-ingest`, `postgres`, `clickhouse`, `node-exporter`) on a single machine. The Zero-Trust capabilities (dropped capabilities, non-root users, rate-limiting edge proxy) are already implemented. 

The next step is to distribute these containers across **many servers** (e.g., separating the DB onto Server A, the AI Backend onto Server B, and the Edge/Frontend onto Server C) while allowing a **local development laptop** to interact with them securely.

## Task Instructions for the AI to Execute

### 1. The Tailscale Mesh Foundation (The "How it Works" Logic)
Explain the core logic of hybrid-cloud connectivity:
- We cannot rely on Docker's default `internal-mesh` bridge network anymore, because the containers are on different physical machines.
- Instead, we install **Tailscale** on every server (Remote Droplets, Local Laptops, and CI/CD Runners). Tailscale assigns a static, private `100.x.y.z` IP address to every machine.
- **The Magic:** Services communicate using these `100.x.y.z` IPs. `soc-backend` (on Server B) connects to PostgreSQL (on Server A) via `100.x.x.x:5432`—and the traffic is end-to-end encrypted automatically by WireGuard via Tailscale.

### 2. Splitting the Monolithic Compose File
Provide the exact YAML templates to split `deploy/docker-compose.yml` into role-specific deployment files. Create definitions for:
- `deploy/compose.database.yml` (For Server A: Postgres, ClickHouse, Node Exporter)
- `deploy/compose.backend.yml` (For Server B: soc-backend, core-ingest, Node Exporter)
- `deploy/compose.edge.yml` (For Server C: soc-frontend Nginx Proxy, Cloudflared)

### 3. Environment Variable Re-routing (The Glue)
Explain how to update the `.env` configuration to connect the decoupled systems. Provide a template `.env.production` that replaces local hostnames (`postgres:5432`, `core-ingest:9090`) with the dynamic Tailscale IPs.
- Example: `DATABASE_URL=postgresql://user:pass@100.64.0.5:5432/soc`
- Example: `GO_CORE_URL=grpc://100.64.0.10:9090`

### 4. Local Area (Developer Machine) Integration
Write a step-by-step guide on how a developer connects their local machine to this distributed setup:
1. The developer runs a local instance of `soc-backend` on their laptop for debugging.
2. The developer installs Tailscale locally.
3. The local `soc-backend` accesses the production/staging `postgres` securely over the `100.x.y.z` IP without exposing the database to the public internet.
4. Show how to configure `docker-compose.local.yml` to only spin up the services the developer is currently editing, while relying on the remote mesh for the rest.

### 5. Deployment Orchestration via GitHub Actions
Write the logic for how GitHub Actions deploys to these independent servers:
- The pipeline pushes the Docker image to GHCR.
- The pipeline SSHes into **Server A**, pulls `compose.database.yml`, and restarts.
- The pipeline SSHes into **Server B**, pulls `compose.backend.yml`, and restarts.
- Emphasize that GitHub Actions runners can use the `tailscale/github-action` to join the mesh dynamically during the CI/CD run, meaning SSH ports do not need to be exposed to the public internet.

## Output Format
Provide a comprehensive, step-by-step tutorial addressing the above 5 points. Include the split `docker-compose` YAML snippets, the updated Nginx proxy routing rules (pointing to Tailscale IPs instead of Docker DNS), and the exact commands to link a local machine to the remote swarm.
