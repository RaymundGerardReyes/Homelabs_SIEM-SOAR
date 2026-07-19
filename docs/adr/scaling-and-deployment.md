# ADR: Scaling and Deployment Strategy

## Context
As the Hybrid LLM SIEM/SOAR platform scales to handle massive ingestion telemetry and concurrent AI investigations, we must transition from single-instance containers to a horizontally scalable microservice architecture.

## Decision
1. **Frontend Proxy Scaling (Nginx)**: 
   - We utilize Nginx edge servers connected via Cloudflare Tunnels to provide load balancing and software-defined WAF protections.
   - Nginx uses Docker's internal DNS (`127.0.0.11`) to round-robin traffic to scaled backend services without needing fixed IP configurations.

2. **Backend Workers (FastAPI / soc-backend)**:
   - We removed the hardcoded `container_name` from `docker-compose.yml` to support Docker replicas.
   - The production profile defaults to `deploy: replicas: 3`.
   - **Statelessness**: Because all session identities are stored in HttpOnly cookies signed by a symmetric `JWT_PRIVATE_KEY` (in `.env`), the backend is completely stateless. Any worker can service any request.

3. **Ingestion Core (Go / core-ingest)**:
   - Defaulting to `deploy: replicas: 2`.
   - Traffic is load-shed at the Nginx edge and distributed across Go nodes.
   - All state is persisted in Postgres (Tenant Config) and ClickHouse (Security Telemetry). 

## Deployment Playbook
We have consolidated operational commands into `ops/Makefile`.

- **To deploy the platform:**
  `make deploy-prod`
  
- **To scale the platform dynamically:**
  `make scale WORKERS=5` (This will instruct Docker Compose to spin up 5 Python workers with zero downtime for existing traffic).
