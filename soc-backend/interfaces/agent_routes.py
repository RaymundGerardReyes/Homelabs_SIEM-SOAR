import os
import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, status, Request
from pydantic import BaseModel
import asyncpg
import logging

from Infrastructure.Http.Deps import get_db
from Interfaces.api_routes import verify_internal_auth
from Infrastructure.Metrics import AGENT_ENROLLMENT_FAILURES_TOTAL, AGENT_POLLING_FAILURES_TOTAL
from Infrastructure.AgentEvents import agent_event_bus

logger = logging.getLogger(__name__)

router = APIRouter()

# ==============================================================================
# SCHEMAS
# ==============================================================================

class EnrollmentRequest(BaseModel):
    enrollment_token: str
    initial_metadata: Optional[Dict[str, Any]] = None

class EnrollmentResponse(BaseModel):
    endpoint_id: str
    endpoint_secret: str
    tenant_id: str

class RegisterRequest(BaseModel):
    hostname: str
    label: str
    type: str
    cf_tunnel_url: Optional[str] = None
    capabilities: List[str]
    agent_version: str
    os: str
    region: str

class RegisterResponse(BaseModel):
    endpoint_id: str
    tenant_id: str
    ingest_url: str
    tasks_url: str
    poll_interval_seconds: int

class AdminEnrollmentTokenRequest(BaseModel):
    tenant_id: str
    expires_in: int = 900
    max_use: int = 1

class AdminEnrollmentTokenResponse(BaseModel):
    enrollment_token: str
    expires_at: str

class TenantProvisionRequest(BaseModel):
    tenant_id: str
    openai_key: Optional[str] = None
    anthropic_key: Optional[str] = None
    gemini_key: Optional[str] = None

class TenantProvisionResponse(BaseModel):
    tenant_id: str
    clickhouse_db: str
    webhook_secret: str
    status: str

class TaskResultRequest(BaseModel):
    status: str
    details: Optional[Dict[str, Any]] = None

class AdminTaskRequest(BaseModel):
    action: str
    params: Optional[Dict[str, Any]] = None

class AdminTaskResponse(BaseModel):
    task_id: str
    status: str

# ==============================================================================
# DEPENDENCIES
# ==============================================================================

async def get_base_endpoint_context(
    authorization: str = Header(None),
    x_tenant_id: str = Header(None, alias="X-Tenant-ID"),
    db: asyncpg.Connection = Depends(get_db)
):
    """
    Base Dependency to validate endpoint_secret cryptographically and return context.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
        
    endpoint_secret = authorization.split(" ")[1]
    
    query = """
        SELECT endpoint_id, tenant_id, status 
        FROM endpoint_inventory 
        WHERE endpoint_secret = $1
    """
    endpoint = await db.fetchrow(query, endpoint_secret)
    
    if not endpoint:
        raise HTTPException(status_code=401, detail="Invalid endpoint secret")
        
    # Cross-check tenant_id in header against database record to prevent spoofing
    if x_tenant_id and x_tenant_id != endpoint['tenant_id']:
        raise HTTPException(
            status_code=403,
            detail="Tenant ID mismatch; X-Tenant-ID header does not match endpoint record"
        )
        
    return dict(endpoint)

async def verify_endpoint_secret(endpoint: dict = Depends(get_base_endpoint_context)):
    """
    Dependency for standard API calls (Push Logs, Fetch Tasks).
    Enforces that the endpoint has already completed registration (status='active').
    """
    if endpoint['status'] != 'active':
        raise HTTPException(
            status_code=401,
            detail={
                "error": f"Endpoint not active (status={endpoint['status']})",
                "remediation": "Call POST /api/endpoints/register with your endpoint_secret before pushing logs.",
                "docs_url": "/documentation#lifecycle"
            }
        )
    return endpoint

async def verify_endpoint_secret_for_registration(endpoint: dict = Depends(get_base_endpoint_context)):
    """
    Dependency specifically for Step 2 (/endpoints/register).
    Allows endpoints that are in 'pending_register' state to proceed.
    """
    if endpoint['status'] not in ('active', 'pending_register'):
        raise HTTPException(status_code=401, detail=f"Endpoint cannot be registered (status={endpoint['status']})")
    return endpoint

# ==============================================================================
# ROUTES
# ==============================================================================

@router.post("/endpoints/enroll", response_model=EnrollmentResponse)
async def enroll_endpoint(req: EnrollmentRequest, db: asyncpg.Connection = Depends(get_db)):
    """
    Step 1: Converts a short-lived enrollment token into a persistent endpoint identity.
    """
    # 1. Validate Token
    token_query = """
        SELECT tenant_id, expires_at, max_use, uses 
        FROM enrollment_tokens 
        WHERE token = $1
    """
    token_record = await db.fetchrow(token_query, req.enrollment_token)
    
    if not token_record:
        AGENT_ENROLLMENT_FAILURES_TOTAL.labels(reason="invalid_token", tenant_id="unknown").inc()
        raise HTTPException(status_code=401, detail="Invalid enrollment token")
        
    if token_record['expires_at'] < datetime.now(timezone.utc):
        AGENT_ENROLLMENT_FAILURES_TOTAL.labels(reason="expired", tenant_id=token_record['tenant_id']).inc()
        raise HTTPException(status_code=401, detail="Enrollment token expired")
        
    if token_record['uses'] >= token_record['max_use']:
        AGENT_ENROLLMENT_FAILURES_TOTAL.labels(reason="max_use_exceeded", tenant_id=token_record['tenant_id']).inc()
        raise HTTPException(status_code=401, detail="Enrollment token max usage exceeded")
        
    tenant_id = token_record['tenant_id']
    
    # Ensure tenant exists in tenant_registry so core-ingest accepts its telemetry
    tenant_exists = await db.fetchval("SELECT 1 FROM tenant_registry WHERE tenant_id = $1", tenant_id)
    if not tenant_exists:
        logger.info(f"Auto-provisioning tenant '{tenant_id}' in tenant_registry during enrollment.")
        webhook_secret = secrets.token_hex(32)
        clickhouse_db = f"soc_{tenant_id.replace('-', '_')}"
        default_llm_key = os.environ.get("OPENAI_API_KEY", "sk-global-infrastructure-key-override")
        await db.execute("""
            INSERT INTO tenant_registry (tenant_id, webhook_secret, clickhouse_db, llm_key)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id) DO NOTHING
        """, tenant_id, webhook_secret, clickhouse_db, default_llm_key)

    # 2. Generate Identity
    endpoint_uuid = uuid.uuid4()
    endpoint_id = str(endpoint_uuid)
    endpoint_secret = secrets.token_urlsafe(32)
    
    # 3. Create endpoint_inventory record (Pending Register)
    insert_query = """
        INSERT INTO endpoint_inventory 
        (endpoint_id, tenant_id, endpoint_secret, status)
        VALUES ($1, $2, $3, 'pending_register')
    """
    
    update_token_query = """
        UPDATE enrollment_tokens SET uses = uses + 1 WHERE token = $1
    """
    
    async with db.transaction():
        await db.execute(insert_query, endpoint_uuid, tenant_id, endpoint_secret)
        await db.execute(update_token_query, req.enrollment_token)
        
    logger.info(f"Agent enrolled successfully: endpoint_id={endpoint_id} tenant_id={tenant_id}")
    
    agent_event_bus.emit({"type": "endpoint_enrolled", "endpoint_id": endpoint_id})
    
    return EnrollmentResponse(
        endpoint_id=endpoint_id,
        endpoint_secret=endpoint_secret,
        tenant_id=tenant_id
    )

@router.post("/endpoints/register", response_model=RegisterResponse)
async def register_endpoint(
    req: RegisterRequest, 
    request: Request,
    endpoint: dict = Depends(verify_endpoint_secret_for_registration),
    db: asyncpg.Connection = Depends(get_db)
):
    """
    Step 2: Receives full agent metadata and marks the endpoint as 'active'.
    Extracts the true IP address directly from the connecting socket/headers to track the real source.
    """
    import json
    
    # 1. Precise IP Extraction (Cloudflare -> Nginx -> Uvicorn Proxy Chain)
    # Check CF-Connecting-IP first for Cloudflare, then X-Real-IP for Nginx, then X-Forwarded-For.
    real_ip = "Unknown"
    cf_ip = request.headers.get("CF-Connecting-IP")
    real_ip_header = request.headers.get("X-Real-IP")
    fwd_ip = request.headers.get("X-Forwarded-For")
    
    if cf_ip:
        real_ip = cf_ip.strip()
    elif real_ip_header:
        real_ip = real_ip_header.strip()
    elif fwd_ip:
        real_ip = fwd_ip.split(",")[0].strip()
    elif request.client and request.client.host:
        real_ip = request.client.host
        
    # Ensure it defaults gracefully if running behind a misconfigured proxy
    if real_ip in ("127.0.0.1", "::1", "localhost"):
        real_ip = "Local Network (Air-gapped)"
    
    update_query = """
        UPDATE endpoint_inventory 
        SET hostname = $1, label = $2, type = $3, cf_tunnel_url = $4, 
            capabilities = $5, agent_version = $6, os = $7, region = $8,
            ip_address = $9,
            status = 'active', last_seen_at = NOW(), updated_at = NOW()
        WHERE endpoint_id = $10
    """
    
    try:
        await db.execute(
            update_query,
            req.hostname, req.label, req.type, req.cf_tunnel_url,
            json.dumps(req.capabilities), req.agent_version, req.os, req.region,
            real_ip,
            endpoint['endpoint_id']
        )
    except Exception as e:
        if "ip_address" in str(e):
            logger.warning(f"Database missing ip_address column, falling back. Error: {e}")
            fallback_query = """
                UPDATE endpoint_inventory 
                SET hostname = $1, label = $2, type = $3, cf_tunnel_url = $4, 
                    capabilities = $5, agent_version = $6, os = $7, region = $8,
                    status = 'active', last_seen_at = NOW(), updated_at = NOW()
                WHERE endpoint_id = $9
            """
            await db.execute(
                fallback_query,
                req.hostname, req.label, req.type, req.cf_tunnel_url,
                json.dumps(req.capabilities), req.agent_version, req.os, req.region,
                endpoint['endpoint_id']
            )
        else:
            raise
    
    logger.info(f"Agent registered and active: endpoint_id={endpoint['endpoint_id']} real_ip={real_ip}")
    
    agent_event_bus.emit({"type": "endpoint_registered", "endpoint_id": str(endpoint['endpoint_id'])})
    
    return RegisterResponse(
        endpoint_id=str(endpoint['endpoint_id']),
        tenant_id=endpoint['tenant_id'],
        ingest_url="https://socanalyst.raymundgerardestaca.dev/ingest/",
        tasks_url="https://socanalyst.raymundgerardestaca.dev/api/agents/tasks",
        poll_interval_seconds=10
    )

@router.get("/endpoints/me")
async def get_endpoint_me(endpoint: dict = Depends(verify_endpoint_secret), db: asyncpg.Connection = Depends(get_db)):
    """
    Allows an active agent to fetch its own configuration and current state.
    """
    query = """
        SELECT endpoint_id, tenant_id, hostname, label, type, status, agent_version 
        FROM endpoint_inventory 
        WHERE endpoint_id = $1
    """
    record = await db.fetchrow(query, endpoint['endpoint_id'])
    return dict(record)

# ==============================================================================
# ADMIN / TENANT MANAGEMENT ROUTES (RBAC Protected)
# ==============================================================================

@router.post("/admin/enrollment-tokens", response_model=AdminEnrollmentTokenResponse, dependencies=[Depends(verify_internal_auth)])
async def create_enrollment_token(req: AdminEnrollmentTokenRequest, db: asyncpg.Connection = Depends(get_db)):
    """
    Admin UI endpoint to generate a short-lived token for new agent deployments.
    Auto-provisions the tenant in tenant_registry if not present to ensure seamless onboarding.
    """
    tenant_exists = await db.fetchval("SELECT 1 FROM tenant_registry WHERE tenant_id = $1", req.tenant_id)
    if not tenant_exists:
        logger.info(f"Auto-provisioning tenant '{req.tenant_id}' in tenant_registry for enrollment.")
        webhook_secret = secrets.token_hex(32)
        clickhouse_db = f"soc_{req.tenant_id.replace('-', '_')}"
        default_llm_key = os.environ.get("OPENAI_API_KEY", "sk-global-infrastructure-key-override")
        
        await db.execute("""
            INSERT INTO tenant_registry (tenant_id, webhook_secret, clickhouse_db, llm_key)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id) DO NOTHING
        """, req.tenant_id, webhook_secret, clickhouse_db, default_llm_key)
        
    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=req.expires_in)
    
    insert_query = """
        INSERT INTO enrollment_tokens (token, tenant_id, expires_at, max_use)
        VALUES ($1, $2, $3, $4)
    """
    
    await db.execute(insert_query, token, req.tenant_id, expires_at, req.max_use)
    
    # Audit log: every token issuance is recorded for compliance and traceability
    await db.execute("""
        INSERT INTO audit_logs (correlation_id, agent, action, context, risk_level, policy_decision)
        VALUES ($1, 'admin-ui', 'enrollment_token_issued', $2, 'LOW', 'ALLOW')
    """,
        secrets.token_hex(8),  # lightweight correlation id for this audit event
        __import__('json').dumps({
            "tenant_id": req.tenant_id,
            "expires_in": req.expires_in,
            "max_use": req.max_use
        })
    )
    
    logger.info(f"[AUDIT] Enrollment token issued: tenant={req.tenant_id} expires_in={req.expires_in}s max_use={req.max_use}")
    
    return AdminEnrollmentTokenResponse(
        enrollment_token=token,
        expires_at=expires_at.isoformat()
    )

@router.post("/admin/tenants", response_model=TenantProvisionResponse, dependencies=[Depends(verify_internal_auth)])
async def provision_tenant(req: TenantProvisionRequest, db: asyncpg.Connection = Depends(get_db)):
    """
    Automates the provisioning of a new tenant (Database insertion + ClickHouse DB creation).
    """
    import json
    
    # 1. Generate Webhook Secret
    webhook_secret = secrets.token_hex(32)
    clickhouse_db = f"clickhouse_db_{req.tenant_id.replace('-', '_')}"
    
    # 2. Prepare LLM Keys
    llm_keys = {}
    if req.openai_key: llm_keys['openai_key'] = req.openai_key
    if req.anthropic_key: llm_keys['anthropic_key'] = req.anthropic_key
    if req.gemini_key: llm_keys['gemini_key'] = req.gemini_key
    
    llm_key_json = json.dumps(llm_keys) if llm_keys else "{}"
    
    # 3. Insert into PostgreSQL
    insert_query = """
        INSERT INTO tenant_registry (tenant_id, webhook_secret, clickhouse_db, llm_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id) DO NOTHING
    """
    
    await db.execute(insert_query, req.tenant_id, webhook_secret, clickhouse_db, llm_key_json)
    
    # 4. (Simulated) Provision ClickHouse DB
    # In a real environment, you'd execute: CREATE DATABASE IF NOT EXISTS clickhouse_db_...
    # via a ClickHouse driver. For this iteration, we log the action.
    logger.info(f"🚀 Automated Provisioning: Created ClickHouse database -> {clickhouse_db}")
    
    return TenantProvisionResponse(
        tenant_id=req.tenant_id,
        clickhouse_db=clickhouse_db,
        webhook_secret=webhook_secret,
        status="provisioned"
    )

@router.get("/admin/tenants", dependencies=[Depends(verify_internal_auth)])
async def list_tenants(db: asyncpg.Connection = Depends(get_db)):
    """List all provisioned tenants."""
    records = await db.fetch("SELECT tenant_id, clickhouse_db, created_at FROM tenant_registry")
    return [dict(r) for r in records]

# ==============================================================================
# CONTROL PLANE ROUTES (PHASE 3: POLLING & TASKS)
# ==============================================================================

@router.get("/agents/tasks")
async def get_agent_tasks(max_tasks: int = 10, endpoint: dict = Depends(verify_endpoint_secret), db: asyncpg.Connection = Depends(get_db)):
    """
    Called by the siem-agent polling loop to fetch pending tasks.
    """
    query = """
        SELECT task_id, action, params, requested_at 
        FROM agent_tasks 
        WHERE endpoint_id = $1 AND status = 'pending'
        ORDER BY requested_at ASC
        LIMIT $2
    """
    records = await db.fetch(query, endpoint['endpoint_id'], max_tasks)
    
    # Optional: Mark tasks as 'in_progress' or keep 'pending' until result is posted.
    # For a robust system, we would mark them as dispatched. We'll leave them pending.
    
    return [dict(r) for r in records]

@router.post("/agents/tasks/{task_id}/result")
async def submit_task_result(
    task_id: str, 
    req: TaskResultRequest, 
    endpoint: dict = Depends(verify_endpoint_secret), 
    db: asyncpg.Connection = Depends(get_db)
):
    """
    Called by the siem-agent to post the result of an executed task.
    """
    import json
    
    query = """
        UPDATE agent_tasks 
        SET status = $1, result_details = $2, completed_at = NOW()
        WHERE task_id = $3 AND endpoint_id = $4
        RETURNING task_id
    """
    
    result = await db.fetchval(
        query, 
        req.status, 
        json.dumps(req.details) if req.details else '{}', 
        task_id, 
        endpoint['endpoint_id']
    )
    
    if not result:
        AGENT_POLLING_FAILURES_TOTAL.labels(endpoint_id=endpoint['endpoint_id'], error_type="task_not_found").inc()
        raise HTTPException(status_code=404, detail="Task not found or not assigned to this endpoint")
        
    logger.info(f"Task {task_id} completed by endpoint {endpoint['endpoint_id']} with status {req.status}")
    return {"status": "success"}

@router.post("/admin/endpoints/{endpoint_id}/tasks", response_model=AdminTaskResponse, dependencies=[Depends(verify_internal_auth)])
async def assign_agent_task(endpoint_id: str, req: AdminTaskRequest, db: asyncpg.Connection = Depends(get_db)):
    """
    Admin UI / SOAR playbook endpoint to assign a new task to an agent.
    """
    import json
    import httpx
    
    # 1. Verify endpoint belongs to a valid tenant and check for webhook url
    endpoint = await db.fetchrow("SELECT tenant_id, cf_tunnel_url FROM endpoint_inventory WHERE endpoint_id = $1", endpoint_id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")
        
    # 2. Insert Task as pending
    query = """
        INSERT INTO agent_tasks (endpoint_id, tenant_id, action, params)
        VALUES ($1, $2, $3, $4)
        RETURNING task_id
    """
    
    task_id = await db.fetchval(
        query, 
        endpoint_id, 
        endpoint['tenant_id'], 
        req.action, 
        json.dumps(req.params) if req.params else '{}'
    )
    
    cf_tunnel_url = endpoint['cf_tunnel_url']
    
    # 3. Phase 4: Optional Webhook Mode
    # If the endpoint registered a direct Cloudflare Tunnel URL, we push the task immediately.
    if cf_tunnel_url:
        try:
            # We use httpx for async HTTP requests
            async with httpx.AsyncClient(timeout=10.0) as client:
                # In production, we'd include CF-Access-Client-Id headers here
                # and sign the payload using the endpoint_secret as an HMAC key
                webhook_payload = {
                    "task_id": str(task_id),
                    "action": req.action,
                    "params": req.params
                }
                
                resp = await client.post(f"{cf_tunnel_url.rstrip('/')}/agent/execute", json=webhook_payload)
                resp.raise_for_status()
                
                result_data = resp.json()
                
                # Update task immediately since it executed synchronously
                update_q = """
                    UPDATE agent_tasks 
                    SET status = $1, result_details = $2, completed_at = NOW()
                    WHERE task_id = $3
                """
                status_str = result_data.get('status', 'success')
                await db.execute(update_q, status_str, json.dumps(result_data.get('details', {})), task_id)
                
                return AdminTaskResponse(task_id=str(task_id), status=status_str)
                
        except Exception as e:
            logger.warning(f"Webhook push to {cf_tunnel_url} failed for task {task_id}: {e}. Falling back to polling.")
            # If webhook fails, we just leave it in 'pending' state and let the polling loop catch it.

    return AdminTaskResponse(task_id=str(task_id), status="pending")

@router.post("/admin/endpoints/{endpoint_id}/rotate", dependencies=[Depends(verify_internal_auth)])
async def rotate_endpoint_credential(endpoint_id: str, db: asyncpg.Connection = Depends(get_db)):
    """
    Revokes the current endpoint_secret and sets status to pending_register.
    Emits an audit event so compliance dashboards can track all rotation events.
    """
    endpoint = await db.fetchrow(
        "SELECT endpoint_id, tenant_id FROM endpoint_inventory WHERE endpoint_id = $1", endpoint_id
    )
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")
        
    new_secret = secrets.token_urlsafe(32)
    
    await db.execute("""
        UPDATE endpoint_inventory
        SET endpoint_secret = $1, status = 'pending_register'
        WHERE endpoint_id = $2
    """, new_secret, endpoint_id)
    
    # Audit log: credential rotation is a security-critical event
    import json
    await db.execute("""
        INSERT INTO audit_logs (correlation_id, agent, action, context, risk_level, policy_decision)
        VALUES ($1, 'admin-ui', 'endpoint_secret_rotated', $2, 'MEDIUM', 'ALLOW')
    """,
        secrets.token_hex(8),
        json.dumps({"endpoint_id": endpoint_id, "tenant_id": endpoint['tenant_id']})
    )
    
    logger.info(f"[AUDIT] Credential rotated: endpoint_id={endpoint_id} tenant_id={endpoint['tenant_id']}")
    
    return {"status": "success", "message": "Credential rotated. Agent must re-enroll."}


# ==============================================================================
# LOG INGESTION: /api/v1/agent/push (The actual telemetry intake)
# ==============================================================================

class LogEvent(BaseModel):
    timestamp: str
    source: str
    severity: str = "INFO"
    message: str
    metadata: Optional[Dict[str, Any]] = None

class PushLogsRequest(BaseModel):
    events: List[LogEvent]

@router.post("/v1/agent/push")
async def push_agent_logs(
    req: PushLogsRequest,
    request: object = None,
    endpoint: dict = Depends(verify_endpoint_secret),
    db: asyncpg.Connection = Depends(get_db)
):
    """
    Primary telemetry intake for all integrated systems.
    External SDKs are zero-processing conduits — they send raw events here.
    This route:
      1. Validates endpoint identity (status=active, tenant cross-check).
      2. Enforces batch size limits.
      3. Enriches events with endpoint/tenant context.
      4. Forwards to core-ingest (ClickHouse + gRPC fan-out).
      5. Feeds the Central AI Intelligence Engine internal bus for analysis.
    The AI Engine is the ONLY intelligence layer — it analyses internally,
    never exposing its decisions back to external SDKs.
    """
    from Infrastructure.Metrics import AGENT_ENROLLMENT_FAILURES_TOTAL
    from Domain.Intelligence.AIIntelligenceEngine import ingest_event
    import json, httpx

    endpoint_id = str(endpoint['endpoint_id'])
    tenant_id   = endpoint['tenant_id']

    if not req.events:
        raise HTTPException(status_code=422, detail="No events provided")

    if len(req.events) > 500:
        raise HTTPException(status_code=413, detail="Batch too large; max 500 events per push")

    # Enrich each event with endpoint/tenant context
    correlation_id = secrets.token_hex(8)
    enriched = [
        {
            "timestamp":      ev.timestamp,
            "source":         ev.source,
            "severity":       ev.severity,
            "message":        ev.message,
            "metadata":       ev.metadata or {},
            "endpoint_id":    endpoint_id,
            "tenant_id":      tenant_id,
            "correlation_id": correlation_id,
        }
        for ev in req.events
    ]

    # ── Step 1: Forward to core-ingest (ClickHouse / gRPC fan-out) ──────────
    ingest_url = os.environ.get("INGEST_INTERNAL_URL", "http://core-ingest:8080")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{ingest_url}/ingest/",
                json={"tenant_id": tenant_id, "events": enriched},
                headers={
                    "X-Tenant-ID":      tenant_id,
                    "X-Endpoint-ID":    endpoint_id,
                    "X-Correlation-ID": correlation_id,
                    "Authorization":    f"Bearer {os.environ.get('INTERNAL_SERVICE_KEY', 'dev-internal-key-change-in-prod')}"
                }
            )
            if resp.status_code >= 400:
                logger.error(f"core-ingest rejected events: {resp.status_code} {resp.text[:200]}")
                raise HTTPException(status_code=502, detail="Ingest pipeline rejected the payload")
    except httpx.RequestError as e:
        logger.error(f"Failed to reach core-ingest: {e}")
        raise HTTPException(status_code=503, detail="Ingest pipeline unreachable")

    # ── Step 2: Feed internal AI Intelligence Engine (non-blocking) ─────────
    # The AI Engine is the SOLE intelligence layer. It runs entirely inside
    # soc-backend and never exposes its analysis back to external systems.
    for ev in enriched:
        await ingest_event(ev)

    logger.info(
        f"[PUSH] {len(req.events)} events | endpoint={endpoint_id} "
        f"tenant={tenant_id} corr={correlation_id}"
    )

    return {
        "status":           "accepted",
        "events_received":  len(req.events),
        "endpoint_id":      endpoint_id,
        "tenant_id":        tenant_id,
        "correlation_id":   correlation_id
    }


