# Principal DevOps Engineer Audit: Topology Rollback & Architecture Review

## 1. Root Cause Analysis
The previous scalability implementation introduced horizontal replicas (`deploy: replicas: 3` for Python backend, `replicas: 2` for Go ingest) directly into the base `docker-compose.yml`. 
While this conceptually matches a production scaling pattern, it was prematurely applied. The backend explicitly relies on stateful `FastAPI WebSocket` connections in memory (specifically, `router.websocket("/ws/incidents/war-room/{incident_id}")` in `api_routes.py`). Because there is no Redis pub/sub backplane implemented to sync messages across containers, deploying multiple replicas actively breaks the War Room functionality. Analysts connecting to different replicas will suffer a "split-brain" state. Therefore, the replica scaling was **unnecessarily introduced and actively harmful** to the application's current state.

## 2. Current vs Expected Container Topology
**Current (Flawed) Topology:**
- `soc-nginx-proxy` (1)
- `deploy-soc-backend-[1, 2, 3]` (3)
- `deploy-core-ingest-[1, 2]` (2)
- Databases (1 each)

**Expected (Corrected) Topology:**
- `soc-nginx-proxy` (1)
- `soc-python-ai-backend` (1)
- `soc-go-ingest-core` (1)
- Databases (1 each)

## 3. Replica Justification Matrix
| Service | Current Replicas | Architecturally Justified? | Reason |
|---------|-----------------|---------------------------|--------|
| `soc-backend` | 3 | **NO** | In-memory WebSocket connections (Stateful). Will cause split-brain data loss. |
| `core-ingest` | 2 | **NO** | While stateless, scaling locally via Compose without a Swarm/K8s load-balancer adds unnecessary overhead for local development/testing. |

## 4. Development vs Production Deployment Strategy
- **Development (`docker-compose.dev.yml`)**: Should always enforce `replicas: 1` using explicit `container_name`s and port bindings to localhost to prevent host conflicts.
- **Production (`docker-compose.yml`)**: Should strictly define `replicas: 1` and `container_name`s until a Redis Pub/Sub container is successfully integrated into the architecture.

## 5. Rollback Plan
1. Edit `deploy/docker-compose.yml`.
2. Remove the `deploy:` block (including `replicas` and `resources`) from `soc-backend` and `core-ingest`.
3. Restore the strict `container_name: soc-python-ai-backend` and `container_name: soc-go-ingest-core` directives.
4. Execute `docker compose down && docker compose up --build -d` to clean up orphaned scaled containers and force the architecture back into a 1:1 reliable state.

## 6. Updated Docker Compose Recommendation
The base `docker-compose.yml` has been immediately rolled back to the single-instance topology to ensure stability. No networking, volume, or dependency structures were compromised during this rollback.

## 7. Risk Assessment
- **Running Multiple Replicas (Before Rollback)**: **HIGH RISK**. Loss of live telemetry data in WebSockets.
- **Rolling Back to 1 Replica (Now)**: **LOW RISK**. Stabilizes the application and restores expected baseline behavior.

## 8. Definition of Done
The architectural audit confirms the previous scaling was flawed. The rollback has been executed, restoring strict 1:1 container mappings.
