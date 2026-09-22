# Docker, Dotenvx & Secrets Management Invariants

1. **Always Use `dotenvx run` for Docker Operations**:
   - Never run raw `docker compose up` when `.env` contains `encrypted:...` secrets.
   - Use `dotenvx run -- docker compose up -d` (or `cmd /c "dotenvx run -- docker compose ..."` on Windows).

2. **Never Export `DOCKER_HOST` in Root `.env`**:
   - Keep `DOCKER_HOST` commented out in local `.env` files to prevent overriding the host Docker Desktop named pipe.

3. **Explicit Environment Mappings in `docker-compose.yml`**:
   - Always map sensitive variables explicitly in `environment:` blocks (e.g., `POSTGRES_USER: ${DB_USER}`) so Docker Compose substitutes the decrypted values from the host shell.

4. **Force Recreate Containers After Secret Decryption Changes**:
   - Always pass `--force-recreate` when switching from encrypted tokens to decrypted secrets to eliminate stale XML/role configurations generated during initial boots.

5. **Strict No-Hardcoded-Secrets Invariant**:
   - Production source code must NEVER contain default fallback literals for secrets, API keys, or OAuth client IDs (e.g., `your-google-client-id`, `mock-client-id`, `dev-internal-key-...`).
   - If an environment variable is required and missing, the service must fail fast with a descriptive configuration error.
   - Mock credentials belong solely in unit test fixtures (`conftest.py` / `monkeypatch`).

6. **Egress Network Placement & IPv4 Enforcement**:
   - In `docker-compose.yml`, always list the network with the internet gateway first under `networks:` for any service that makes external API calls (e.g., Google OAuth).
   - In Python services, enforce IPv4 resolution to prevent Docker bridge IPv6 connection aborts (`RemoteDisconnected`).

7. **Responsive Dashboard Grid & Fluid Canvas Sizing**:
   - For multi-column dashboards with persistent sidebars, use `xl:grid-cols-2` rather than `lg:grid-cols-2` to prevent cramped columns on standard 1080p laptop displays.
   - All child containers in CSS grids must include `min-w-0` to prevent word/content overflow from expanding tracks.
   - Dynamic canvas elements must adapt to container widths via `ResizeObserver` without static initial width overshoots.
   - Floating overlays and widgets must be placed outside grid tracks at the root level.

8. **Host Ingress Routing & Port Collision Avoidance**:
   - Internal mesh services (`core-ingest:8080`, `soc-backend:8000`) are not exposed directly to the host.
   - Always target the unified Nginx edge proxy at `http://localhost:81` for all external agents, CLI curls, and browser traffic.
   - Never use host port 8080 directly without verifying native host process occupancy (`httpd.exe`).

9. **ClickHouse Type Conformance & Deterministic UUIDs**:
   - When streaming to ClickHouse tables requiring `UUID` columns (e.g. `tenant_id`), parse strings with `uuid.Parse` or generate deterministic UUIDs via `uuid.NewMD5(uuid.NameSpaceDNS, []byte(tenantID))`.

10. **Dynamic Host Network Discovery**:
    - Agent sidecars must dynamically discover host IP, default gateway, and ARP cache stations rather than hardcoding subnets.

11. **Release & Branch Synchronization**:
    - When promoting release milestones (`v0.8.0`), ensure `Development` is fully verified with 100% test coverage before updating `main` and pushing tags.

12. **Zero Hardcoded Hostnames & Dynamic URL Resolution**:
    - Never embed static external hostnames, private domain URLs, or hardcoded hub fallbacks (e.g. `socanalyst.raymundgerardestaca.dev`, `soc.enterprise.local`) in source files, UI snippets, agent configs, or registration payloads.
    - Dynamically resolve endpoints via runtime environment variables (`PUBLIC_HUB_URL`, `HUB_BASE_URL`, `VITE_HUB_URL`), request reverse-proxy headers (`X-Forwarded-*`), or browser context (`window.location.origin` / `window.location.hostname`), with `http://localhost:81` as default local fallback.

13. **Remote Git De-Tracking with Local Disk Preservation (`git rm --cached` + `.gitignore`)**:
    - When removing prompt files, local scratch notes, or working specifications from remote Git tracking, never use raw `git rm` (which deletes files from the local disk).
    - Always execute `git rm --cached <files>` accompanied by `.gitignore` rules. This guarantees local working copies remain 100% intact on the developer's computer while cleanly purging them from remote branches.


