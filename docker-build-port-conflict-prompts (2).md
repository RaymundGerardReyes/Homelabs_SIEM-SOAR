# Principal Engineer Prompt Pack — Docker Build/Network & Port Conflict Diagnosis

This file documents the exact root causes of your two errors and gives Principal Engineer / Principal DevOps / Principal AppSec prompts to diagnose and prevent recurrence.

---

## 1. Root Cause Analysis

### Error 1 — TLS handshake timeout pulling `node:20-alpine`

```
failed to resolve source metadata for docker.io/library/node:20-alpine:
failed to do request: Head "https://registry-1.docker.io/v2/library/node/manifests/20-alpine":
net/http: TLS handshake timeout
```

This is **not a code defect**. It is a transient network-layer failure between Docker Desktop's build engine (BuildKit) and Docker Hub's registry over HTTPS. Common causes on Windows:
- Corporate/ISP firewall, proxy, or VPN interfering with TLS handshakes to `registry-1.docker.io`.
- Docker Desktop's WSL2 network adapter in a bad state (very common after sleep/resume or Windows updates).
- DNS resolution flakiness inside the WSL2 VM.
- Docker Hub rate-limiting or a transient registry-side blip.

Other images (`postgres:16-alpine`, `clickhouse-server`, `cloudflared`) pulled successfully in the same run, which confirms this is intermittent/registry-specific, not a systemic network outage.

### Error 2 — Port 5432 bind permission denied

```
Error response from daemon: ports are not available: exposing port TCP 127.0.0.1:5432 -> 127.0.0.1:0:
listen tcp4 127.0.0.1:5432: bind: An attempt was made to access a socket in a way forbidden by its access permissions.
```

This is a **Windows host port conflict**, not a Docker Compose logic error. The dev overlay correctly requests port `5432` on `127.0.0.1`, but Windows refuses the bind. Typical causes:
- A **native Windows PostgreSQL service** is already listening on 5432 (very common if PostgreSQL was ever installed via the Windows installer or pgAdmin bundle).
- **Hyper-V's dynamic port reservation range** on Windows sometimes reserves ports including 5432, blocking any process (including Docker) from binding to it, even if nothing is visibly "using" it.
- A leftover container from a previous `docker compose up` still holding the port (stale container not fully torn down).
- Windows Defender Firewall or another security tool blocking Docker Desktop's socket bind.

---

## 2. Immediate Fix Steps

**For the TLS handshake timeout:**
1. Retry the build — this is usually transient: `docker compose build soc-frontend`.
2. If it repeats, restart Docker Desktop's WSL2 backend: `wsl --shutdown` then reopen Docker Desktop.
3. Pull the image manually first to isolate the issue: `docker pull node:20-alpine`.
4. If behind corporate VPN/proxy, temporarily disconnect VPN and retry, or configure Docker Desktop's proxy settings (Settings → Resources → Proxies).
5. As a resilience fix, pin a digest or mirror the base image to reduce exposure to registry flakiness (see Section 4).

**For the port 5432 conflict:**
1. Check what's holding the port on Windows: `netstat -ano | findstr :5432` in PowerShell/cmd, then `tasklist /FI "PID eq <pid>"` to identify the process.
2. If it's a native Postgres/pgAdmin service, stop it: `net stop postgresql-x64-16` (adjust service name) or disable it from `services.msc`.
3. If nothing shows in `netstat` but the bind still fails, it is very likely the Hyper-V dynamic port exclusion range. Check with:
   ```powershell
   netsh interface ipv4 show excludedportrange protocol=tcp
   ```
   If `5432` falls inside an excluded range, either remap Docker's dev port (recommended) or free the reserved range.
4. **Recommended permanent fix:** remap the host-side port in `docker-compose.dev.yml` instead of fighting Windows' reserved ranges, e.g. bind Postgres to `127.0.0.1:5433:5432` and connect your local client to port `5433`.

---

## 3. Master Prompt — Principal Engineer (Build & Runtime Failure Triage)

```text
You are acting as a Principal Engineer triaging two Docker Compose failures on a Windows + Docker Desktop (WSL2) development machine for a multi-service SOC platform (React/Vite, Go, Python/FastAPI, PostgreSQL, ClickHouse, Nginx, Cloudflare Tunnel).

Failure 1:
- `docker compose up --build -d` fails during the soc-frontend build stage with:
  "node:20-alpine: failed to resolve source metadata ... net/http: TLS handshake timeout"
- Other images (postgres:16-alpine, clickhouse-server, cloudflared) pulled successfully in the same run.

Failure 2:
- `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d` fails while starting soc-postgres-state with:
  "ports are not available: exposing port TCP 127.0.0.1:5432 -> 127.0.0.1:0: listen tcp4 127.0.0.1:5432: bind: An attempt was made to access a socket in a way forbidden by its access permissions."

Your tasks:
1. Classify each failure as either an application/config defect vs. an environment/infrastructure defect, with justification.
2. For Failure 1, provide a prioritized list of root causes (network, DNS, proxy, WSL2, registry-side) and the fastest diagnostic command for each.
3. For Failure 2, explain precisely why Windows can return a "forbidden by access permissions" error for a port that appears free, including the Hyper-V dynamic port exclusion range mechanism, and how to detect it.
4. Recommend a permanent resilience fix for each failure so that this does not silently block onboarding for other developers on the team.
5. Recommend whether any change is needed in docker-compose.dev.yml, Dockerfile.react, or developer documentation as a result.

Return your answer as:
1. Root cause classification (app defect vs environment defect)
2. Step-by-step diagnostic commands
3. Immediate fix
4. Permanent resilience fix
5. Required documentation or config changes
```

---

## 4. Master Prompt — Principal DevOps Engineer (Build Resilience & Registry Reliability)

```text
You are acting as a Principal DevOps Engineer hardening a Docker Compose build pipeline against registry and network flakiness on developer machines (Windows/WSL2, macOS, Linux).

Context:
- Dockerfile.react currently pulls node:20-alpine directly from Docker Hub with no digest pin, no retry logic, and no fallback mirror.
- Dockerfile.go and Dockerfile.python similarly pull golang:1.25-alpine and python:3.11-slim from Docker Hub with no pin or mirror.
- A developer experienced a TLS handshake timeout specifically on the node:20-alpine pull while other images succeeded in the same build run.

Your tasks:
1. Recommend whether base images should be pinned by digest (sha256) instead of floating tags, and the tradeoffs (security/reproducibility vs. maintenance overhead).
2. Recommend a private registry mirror or pull-through cache (e.g., Docker Hub mirror, GitHub Container Registry, or self-hosted registry proxy) to reduce dependency on registry-1.docker.io directly.
3. Recommend BuildKit-level retry/timeout configuration to make transient registry failures self-heal without manual intervention.
4. Recommend a pre-flight health check script that developers run before `docker compose up --build` to confirm registry reachability and warn early.
5. Recommend CI/CD equivalents so the same registry flakiness does not break automated builds.

Return your answer as:
1. Digest-pinning recommendation with example syntax
2. Mirror/pull-through cache setup steps
3. BuildKit retry/timeout configuration
4. Pre-flight health check script (bash/PowerShell)
5. CI/CD hardening recommendations
```

---

## 5. Master Prompt — Principal DevOps Engineer (Windows Port Reservation Conflict)

```text
You are acting as a Principal DevOps Engineer resolving a recurring Windows host port-binding conflict for local Docker Compose development.

Context:
- docker-compose.dev.yml maps postgres to 127.0.0.1:5432, clickhouse-server to 8123/9000, core-ingest to 8080/9090, soc-backend to 8000, and soc-frontend (Vite) to 5173.
- Starting the stack on Windows with Docker Desktop (WSL2 backend) fails specifically on port 5432 with:
  "bind: An attempt was made to access a socket in a way forbidden by its access permissions."
- This error can occur even when no visible process is using the port, due to Windows' Hyper-V dynamic port exclusion ranges or a native Windows service silently bound to it.

Your tasks:
1. Provide the exact Windows diagnostic commands (netstat, netsh interface ipv4 show excludedportrange, tasklist) to identify whether the conflict is a running process or a reserved port range.
2. Provide the exact remediation for each scenario:
   a. A native PostgreSQL/pgAdmin Windows service is bound to 5432.
   b. The port falls inside a Hyper-V dynamic port exclusion range.
   c. A stale/orphaned container from a previous compose run still holds the port.
3. Recommend whether the long-term fix should be "free the host port" or "remap the dev compose file to a non-conflicting port" (e.g., 5433), and justify the choice for a multi-developer team where Windows port reservations vary by machine.
4. Propose an update to docker-compose.dev.yml that makes the host-side port configurable via an environment variable (e.g., ${DEV_POSTGRES_PORT:-5433}:5432) so each developer can override it without editing tracked files.
5. Propose a short section for the developer onboarding docs explaining this exact failure and its fix, so future teammates do not get stuck on it.

Return your answer as:
1. Diagnostic commands with expected output interpretation
2. Remediation for each root-cause scenario
3. Recommended long-term strategy with justification
4. Updated docker-compose.dev.yml port mapping pattern
5. Onboarding documentation snippet
```

---

## 6. Exact Prompt — Combined Incident Report Generation

```text
Act as a Principal Engineer, Principal DevOps Engineer, and Principal Application Security Engineer producing a single incident report for two Docker Compose failures encountered during local development of a SOC platform:

1. A TLS handshake timeout while pulling node:20-alpine during `docker compose up --build -d`.
2. A port bind permission error on 127.0.0.1:5432 while starting soc-postgres-state during `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d`.

Produce a structured incident report containing:
- Summary of both incidents
- Root cause for each (clearly separating environment/infrastructure causes from code/config causes)
- Immediate remediation steps taken or recommended
- Permanent preventive measures (digest pinning, registry mirror, configurable dev ports, pre-flight health checks)
- Whether any change to docker-compose.yml, docker-compose.dev.yml, or Dockerfiles is required
- A short "runbook" section a teammate can follow if they hit the same errors again
```

---

## 7. Recommended Immediate Config Change

Make the dev Postgres/ClickHouse ports overridable so Windows port reservation conflicts never block onboarding again:

```yaml
# docker-compose.dev.yml (excerpt)
services:
  postgres:
    ports:
      - "${DEV_POSTGRES_PORT:-5433}:5432"

  clickhouse-server:
    ports:
      - "${DEV_CLICKHOUSE_HTTP_PORT:-8123}:8123"
      - "${DEV_CLICKHOUSE_NATIVE_PORT:-9000}:9000"
```

Then in `.env.dev`:

```env
DEV_POSTGRES_PORT=5433
```

Connect your local Postgres client to `localhost:5433` instead of `5432` — no code, container, or production file changes required.

---

## 8. Principal-Level Verification Checklist

- Does `docker pull node:20-alpine` succeed standalone before attempting `docker compose build`?
- Does `netstat -ano | findstr :5432` show a competing process before assuming it's a Hyper-V reservation?
- Does `netsh interface ipv4 show excludedportrange protocol=tcp` show 5432 inside a reserved range?
- Is the dev overlay's Postgres port now driven by an environment variable instead of a hardcoded value?
- Does `docker ps -a` show any stale/orphaned containers from a previous `up` still holding a port?
- Has Docker Desktop's WSL2 backend been restarted (`wsl --shutdown`) since the last TLS timeout?
