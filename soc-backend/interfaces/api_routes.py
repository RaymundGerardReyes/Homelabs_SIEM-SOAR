import os
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Optional
from Domain.Playbooks.Executor import record_action_success

INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "dev-internal-key-change-in-prod")

import jwt

def verify_internal_auth(request: Request):
    # Accept either analyst session cookie OR internal service key
    auth_cookie = request.cookies.get("access_token")
    if not auth_cookie:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            auth_cookie = auth_header.split(" ")[1]

    internal_key = request.headers.get("X-Internal-Service-Key")
    
    if auth_cookie:
        try:
            key = os.environ.get("JWT_PUBLIC_KEY") or os.environ.get("JWT_PRIVATE_KEY", "")
            key = key.strip("\"'").replace("\\n", "\n")
            if key:
                jwt.decode(auth_cookie, key, algorithms=["RS256"])
            else:
                jwt.decode(auth_cookie, options={"verify_signature": False})
            return True # Valid analyst session
        except Exception:
            pass # Fallback to internal service key if JWT is invalid
        
    if internal_key and internal_key == INTERNAL_SERVICE_KEY:
        return True # Valid service-to-service call
        
    raise HTTPException(status_code=401, detail="Unauthorized: Missing valid session or internal service key")

from Domain.Playbooks.Registry import get_all_playbooks
from Infrastructure.SandBox.Runner import execute_playbook_in_sandbox
from Domain.Playbooks.Executor import execute_playbook_on_endpoint, EndpointTarget
from pydantic import BaseModel
import asyncio
import json
import uuid
import os
import time
from Domain.Investigations.LargeLanguageModelTriage import _event_buffer, _subscribers
from datetime import datetime, timezone, timedelta
from cryptography.fernet import Fernet

class EndpointRegistration(BaseModel):
    id: Optional[str] = None
    hostname: str
    label: str
    type: str
    cf_tunnel_url: Optional[str] = None
    cf_client_id: Optional[str] = None
    cf_client_secret: Optional[str] = None
    capabilities: List[str]
    agent_version: str
    os: str
    region: str

router = APIRouter(dependencies=[Depends(verify_internal_auth)])

# WebSocket 1: Autonomous Triage Feed (Broadcast)
@router.websocket("/ws/agent/stream")
async def agent_stream_websocket(websocket: WebSocket):
    # Basic auth check would go here in production
    await websocket.accept()
    
    # Send recent history to avoid a blank screen
    recent_events = list(_event_buffer)
    if recent_events:
        await websocket.send_json({"type": "history", "events": recent_events})
        
    # Create a dedicated queue for this client
    client_queue = asyncio.Queue(maxsize=100)
    _subscribers.add(client_queue)
    
    try:
        while True:
            # Wait for a new event from the global pub/sub emitter
            event = await client_queue.get()
            await websocket.send_json({"type": "live", "event": event})
    except WebSocketDisconnect:
        pass
    finally:
        _subscribers.remove(client_queue)

# Rate limiting tracker for chat
_chat_rate_limits = {}

# WebSocket 2: Interactive Chat (Session-scoped)
@router.websocket("/ws/agent/chat")
async def agent_chat_websocket(websocket: WebSocket):
    # Needs session-scoped auth in production. Here we use connection IP/UUID as mock session.
    await websocket.accept()
    client_id = str(uuid.uuid4())
    _chat_rate_limits[client_id] = []

    try:
        while True:
            data = await websocket.receive_text()
            
            # Rate limit check: max 10 requests per 60 seconds
            now = time.time()
            recent = [t for t in _chat_rate_limits[client_id] if now - t < 60]
            if len(recent) >= 10:
                await websocket.send_json({
                    "type": "error", 
                    "message": "Rate limit exceeded (10 queries/min). Please wait."
                })
                continue
                
            _chat_rate_limits[client_id] = recent + [now]
            
            # Echo typing indicator
            await websocket.send_json({"type": "typing", "message": "Agent is thinking..."})
            await asyncio.sleep(0.5)
            
            # Mock restricted tool logic
            response = f"(Read-Only Assistant via OpenAI) I analyzed your query: '{data}'. I cannot perform disruptive actions like isolate_host, but I can summarize investigations."
            
            # Stream response in chunks
            for chunk in response.split(" "):
                await websocket.send_json({"type": "chunk", "content": chunk + " "})
                await asyncio.sleep(0.05)
            await websocket.send_json({"type": "done"})
            
    except WebSocketDisconnect:
        pass
    finally:
        if client_id in _chat_rate_limits:
            del _chat_rate_limits[client_id]

MOCK_ALERTS = [
    {"id": "alert-172102001", "type": "Brute_Force_Attack", "severity": 3},
    {"id": "alert-172102002", "type": "Impossible_Travel", "severity": 2},
    {"id": "alert-172102003", "type": "Ransomware_Behavior", "severity": 4},
    {"id": "alert-172102004", "type": "Suspicious_Powershell", "severity": 3},
]

@router.get("/metrics/overview")
async def get_metrics_overview() -> Dict[str, Any]:
    return {
        "alertsScanned": 2404,
        "eventsIngestGB24h": 40,
        "dataIngestTB24h": 65,
        "openIncidents": 10,
        "preventedEvents": 286100
    }

@router.get("/notifications")
async def get_notifications() -> List[Dict[str, Any]]:
    return [
        {"id": "n-1", "message": "Brute Force attack escalated.", "severity": "warning", "timestamp": "2026-07-17T00:01:00Z", "read": False},
        {"id": "n-2", "message": "Ransomware playbook auto-contained endpoint.", "severity": "critical", "timestamp": "2026-07-17T00:05:00Z", "read": False},
    ]

@router.get("/threat-intel/enrich")
async def enrich_threat_intel(ip: str) -> Dict[str, Any]:
    if not ip:
        raise HTTPException(status_code=400, detail="ip is required")
    return {
        "source_ip": ip,
        "alienvault_otx": {"reputation": 85, "pulse_count": 12, "tags": ["cobaltstrike", "c2"]},
        "abuse_ch": {"listed": True, "malware_family": "Qakbot"},
        "misp_correlation": True,
        "overall_risk_score": 9.4,
    }

@router.get("/alerts")
async def get_alerts() -> List[Dict[str, Any]]:
    return MOCK_ALERTS

@router.get("/playbooks")
async def get_playbooks() -> List[Dict[str, Any]]:
    playbooks = get_all_playbooks()
    return [{"id": p.id, "name": p.name, "trigger": p.trigger, "code": p.code} for p in playbooks]

class PlaybookRunContext(BaseModel):
    target: str
    justification: str = "Manual execution"
    endpoint_url: Optional[str] = None  # URL of the remote agent for HTTP execution

@router.post("/playbooks/{playbook_id}/run")
async def run_playbook(playbook_id: str, context: PlaybookRunContext) -> Dict[str, Any]:
    if context.endpoint_url:
        # Execute on remote endpoint via Cloudflare Zero Trust HTTP Webhook (ADR-002)
        # Look up the endpoint details from the registry based on target/url
        # For this example, we mock the EndpointTarget mapping since it's typically pulled from DB
        endpoint = EndpointTarget(
            id=context.target,
            cf_tunnel_url=context.endpoint_url,
            cf_client_id=os.environ.get("CF_ACCESS_CLIENT_ID", "mock-client-id"),
            cf_client_secret=os.environ.get("CF_ACCESS_CLIENT_SECRET", "mock-client-secret")
        )
        
        action_payload = {"action": playbook_id, "params": context.dict(), "correlationId": uuid.uuid4().hex}
        resp = await execute_playbook_on_endpoint(endpoint, action_payload)
        
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail=f"Remote Execution Failed: {resp.text}")
        result = resp.json()
    else:
        # Local sandbox execution (e.g. for static malware analysis)
        result = execute_playbook_in_sandbox(playbook_id, context.dict())
        
    if isinstance(result, dict) and result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result

@router.websocket("/playbooks/{playbook_id}/execute/stream")
async def websocket_playbook_execution(websocket: WebSocket, playbook_id: str, token: Optional[str] = None):
    await websocket.accept()
    try:
        loop = asyncio.get_event_loop()
        result: Dict[str, Any] = await loop.run_in_executor(
            None, execute_playbook_in_sandbox, playbook_id, {"target": "demo_target", "justification": "WS"}
        )
        for line in result.get("logs", []):
            await websocket.send_json({"output": line})
            await asyncio.sleep(0.05)
        
        exit_code = 0 if result.get("status") == "success" else 1
        await websocket.send_json({"type": "END", "exitCode": exit_code, "status": result.get("status"), "duration": 120})
    except WebSocketDisconnect:
        pass

@router.get("/investigation/{alert_id}")
async def get_investigation(alert_id: str) -> Dict[str, Any]:
    alert = next((a for a in MOCK_ALERTS if a["id"] == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {
        "nodes": [],
        "edges": [],
        "source_ip": "198.51.100.42",
        "details": {
            "conversation_log": [
                {"agent": "TriageAgent", "message": f"Assessed alert.", "confidence": 85.0},
            ],
            "proposed_actions": [
                {"action": "Isolate Host", "target": "target_server_01", "justification": "Prevent lateral movement", "risk": "DESTRUCTIVE"},
            ],
        },
    }

class ActionExecuteRequest(BaseModel):
    action: str
    target: str
    justification: str
    risk: str
    twoKeyToken: Optional[str] = None

@router.post("/actions/execute")
async def execute_action(payload: ActionExecuteRequest) -> Dict[str, Any]:
    if payload.risk in ["DESTRUCTIVE", "HIGH_IMPACT_WRITE"] and not payload.twoKeyToken:
        raise HTTPException(status_code=403, detail="Two-Key authorization required.")
    return {
        "status": "accepted",
        "action": payload.action,
        "target": payload.target,
        "risk": payload.risk,
        "message": f"Action '{payload.action}' on '{payload.target}' submitted.",
    }

@router.get("/dashboards/executive-summary")
async def get_executive_summary():
    return {
        "totalIncidents": 12, "criticalAssetsExposed": 3, "automatedResponses": 145,
        "mttd_minutes": 18, "mttr_minutes": 94, "criticalOpenCount": 7, "resolvedThisMonth": 135,
        "complianceScore": 92,
        "riskTrend": [{"date": "07-11", "score": 45}, {"date": "07-14", "score": 52}, {"date": "07-17", "score": 38}, {"date": "07-20", "score": 61}, {"date": "07-22", "score": 44}],
        "topThreats": [{"category": "Ransomware (LockBit)", "count": 14}, {"category": "Phishing", "count": 32}, {"category": "Credential Stuffing", "count": 9}]
    }

@router.post("/dashboards/executive-summary/export")
async def export_executive_summary():
    # Returns a minimal PDF-like placeholder blob in production this calls a PDF renderer.
    content = b"%PDF-1.4 Mock Executive Summary Report"
    return StreamingResponse(
        iter([content]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=executive-summary.pdf"}
    )

class ScheduleReportRequest(BaseModel):
    email: str
    frequency: str  # e.g. "weekly", "monthly"

@router.post("/dashboards/executive-summary/schedule")
async def schedule_executive_report(payload: ScheduleReportRequest):
    return {"status": "success", "message": f"Report scheduled {payload.frequency} to {payload.email}"}

@router.get("/dashboards/compliance-status")
async def get_compliance_status():
    return [
        {
            "id": "fw-1", "name": "SOC 2 Type II", "score": 85, "status": "compliant",
            "controls": [
                {"id": "SOC2-AC-01", "name": "Access Control", "status": "passed"},
                {"id": "SOC2-CC-02", "name": "Change Management", "status": "failed"}
            ]
        },
        {
            "id": "fw-2", "name": "ISO 27001", "score": 92, "status": "compliant",
            "controls": [
                {"id": "ISO-AC-01", "name": "Access Control", "status": "passed"},
                {"id": "ISO-VM-01", "name": "Vulnerability Management", "status": "failed"}
            ]
        }
    ]

@router.post("/dashboards/compliance-status/export")
async def export_compliance_report():
    content = b"%PDF-1.4 Mock Compliance Status Report"
    return StreamingResponse(
        iter([content]),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=compliance-report.pdf"}
    )

class ComplianceTaskRequest(BaseModel):
    assignee: str
    dueDate: str

@router.post("/dashboards/compliance-status/{control_id}/tasks")
async def assign_compliance_task(control_id: str, payload: ComplianceTaskRequest):
    return {
        "status": "success",
        "task": {"controlId": control_id, "assignee": payload.assignee, "dueDate": payload.dueDate, "createdAt": datetime.now(timezone.utc).isoformat()}
    }

class ShiftHandoffRequest(BaseModel):
    queue: str  # "me" or "all"

@router.post("/shifts/handoff")
async def generate_shift_handoff(payload: ShiftHandoffRequest):
    scope = "personal" if payload.queue == "me" else "team-wide"
    return {
        "status": "success",
        "scope": scope,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": f"Shift handoff note generated for {scope} queue. 2 critical alerts remain open. Playbook auto-contained 1 ransomware event."
    }

ENDPOINT_REGISTRY = {}
AGENT_TASK_QUEUE = {}
ENROLLMENT_TOKENS = {}

# Initialize encryption key for at-rest storage of CF Access Secrets
# In production, this would be injected via a secure secrets manager and NEVER hardcoded.
_fernet_key = os.environ.get("FERNET_MASTER_KEY")
if not _fernet_key:
    _fernet_key = Fernet.generate_key()
fernet = Fernet(_fernet_key)

@router.post("/api/endpoints/generate-enrollment-token")
async def generate_enrollment_token(request: Request):
    # Requires analyst auth, handled by global router dependency
    token = uuid.uuid4().hex
    ENROLLMENT_TOKENS[token] = datetime.now(timezone.utc) + timedelta(minutes=15)
    return {"token": token, "expires_in": 900}

@router.post("/api/endpoints/enroll")
async def enroll_endpoint(reg: EndpointRegistration, request: Request):
    token = request.headers.get("X-Enrollment-Token")
    if not token or token not in ENROLLMENT_TOKENS:
        raise HTTPException(status_code=403, detail="Invalid or missing enrollment token")
    
    if datetime.now(timezone.utc) > ENROLLMENT_TOKENS[token]:
        del ENROLLMENT_TOKENS[token]
        raise HTTPException(status_code=403, detail="Enrollment token expired")
    
    # Invalidate token after first use
    del ENROLLMENT_TOKENS[token]

    # Generate permanent CF credentials for this specific spoke
    cf_client_id = f"{reg.hostname}-cf-id-{uuid.uuid4().hex[:8]}"
    cf_client_secret = uuid.uuid4().hex + uuid.uuid4().hex
    
    endpoint_id = reg.id or f"ep-{uuid.uuid4().hex[:8]}"
    
    # Encrypt secret at rest before saving to registry
    encrypted_secret = fernet.encrypt(cf_client_secret.encode()).decode()
    
    ENDPOINT_REGISTRY[endpoint_id] = {
        **reg.dict(),
        "id": endpoint_id,
        "cf_client_id": cf_client_id,
        "cf_client_secret": encrypted_secret, # Encrypted at rest
        "last_checkin_at": datetime.now(timezone.utc).isoformat(),
        "status": "healthy"
    }
    
    return {
        "status": "success", 
        "endpoint_id": endpoint_id, 
        "cf_client_id": cf_client_id, 
        "cf_client_secret": cf_client_secret
    }

@router.get("/api/agents/tasks")
async def get_agent_tasks(endpoint_id: str, request: Request):
    cf_client_id = request.headers.get("CF-Access-Client-Id")
    if not cf_client_id:
        raise HTTPException(status_code=403, detail="Zero Trust Violation: Missing Cloudflare Access Token")

    if endpoint_id in ENDPOINT_REGISTRY:
        ENDPOINT_REGISTRY[endpoint_id]["last_checkin_at"] = datetime.now(timezone.utc).isoformat()
    
    tasks = AGENT_TASK_QUEUE.get(endpoint_id, [])
    AGENT_TASK_QUEUE[endpoint_id] = [] # Clear fetched tasks
    return {"tasks": tasks}

@router.post("/api/agents/tasks/{task_id}/result")
async def report_task_result(endpoint_id: str, task_id: str, result: Dict[str, Any], request: Request):
    cf_client_id = request.headers.get("CF-Access-Client-Id")
    if not cf_client_id:
        raise HTTPException(status_code=403, detail="Zero Trust Violation: Missing Cloudflare Access Token")

    if endpoint_id in ENDPOINT_REGISTRY:
        ENDPOINT_REGISTRY[endpoint_id]["last_checkin_at"] = datetime.now(timezone.utc).isoformat()
    
    # Record the successful execution from the polling agent
    action_payload = {"action": result.get("action", "unknown_action"), "task_id": task_id}
    await record_action_success(endpoint_id, action_payload, result)
    
    return {"status": "success", "task_id": task_id, "recorded": True}

@router.post("/api/endpoints/{endpoint_id}/rotate")
async def rotate_endpoint_credential(endpoint_id: str, request: Request):
    # Requires analyst auth, handled by global router dependency
    if endpoint_id not in ENDPOINT_REGISTRY:
        raise HTTPException(status_code=404, detail="Endpoint not found")
        
    # Generate new credentials
    new_cf_client_id = f"{ENDPOINT_REGISTRY[endpoint_id].get('hostname', 'unknown')}-cf-id-{uuid.uuid4().hex[:8]}"
    new_cf_client_secret = uuid.uuid4().hex + uuid.uuid4().hex
    encrypted_secret = fernet.encrypt(new_cf_client_secret.encode()).decode()
    
    ENDPOINT_REGISTRY[endpoint_id]["cf_client_id"] = new_cf_client_id
    ENDPOINT_REGISTRY[endpoint_id]["cf_client_secret"] = encrypted_secret
    
    # In a real system, you might trigger an event to force the agent to re-enroll, 
    # or push the new token down an existing connection.
    return {"status": "success", "message": "Credential rotated", "new_cf_client_id": new_cf_client_id}

@router.get("/endpoints/hosts")
async def get_hosts():
    hosts = [
        {"id": "h1", "hostname": "WIN-DC-01", "type": "iaas", "os": "Windows Server 2022", "agentVersion": "3.4.1", "latestVersion": "3.4.1", "health": "healthy", "lastCheckIn": "2026-07-17T00:00:00Z"},
    ]
    for eid, data in ENDPOINT_REGISTRY.items():
        hosts.append({
            "id": data["id"],
            "hostname": data.get("hostname", "Unknown"),
            "type": data.get("type", "paas"),
            "os": data.get("os", "Unknown"),
            "agentVersion": data.get("agent_version", "1.0.0"),
            "latestVersion": "1.0.0",
            "health": data.get("status", "healthy"),
            "lastCheckIn": data.get("last_checkin_at", "")
            # Note: cf_client_secret is NOT exposed here
        })
    return hosts

@router.get("/endpoints/logs")
async def get_endpoint_logs(host: str = "h1"):
    return [
        {"id": "log-1", "timestamp": "2026-07-19T10:00:00Z", "host": host, "eventType": "ProcessStart", "process": "svchost.exe", "detail": f"Service started on {host}.", "isSuspicious": False},
        {"id": "log-2", "timestamp": "2026-07-19T10:05:00Z", "host": host, "eventType": "NetworkConnection", "process": "powershell.exe", "detail": "Unauthorized access attempt blocked.", "isSuspicious": True}
    ]

@router.get("/assets/inventory")
async def get_asset_inventory():
    return [
        {"id": "a1", "hostname": "DB-PROD-01", "ipAddress": "10.0.10.5", "type": "Database", "criticality": "Tier 1", "owner": "Data Team"},
        {"id": "a2", "hostname": "WEB-FRONT-03", "ipAddress": "10.0.12.50", "type": "Web Server", "criticality": "Tier 2", "owner": "Web Team"}
    ]

@router.get("/endpoints/isolation-candidates")
async def get_isolation_candidates():
    return [{"id": "h1", "hostname": "WIN-FIN-03", "ipAddress": "10.0.5.21", "isIsolated": True, "isolatedAt": "2026-07-17T10:13:00Z", "isolatedBy": "ResponseAgent", "auditTrail": []}]

class IsolateHostRequest(BaseModel):
    twoKeyToken: Optional[str] = None

@router.post("/endpoints/{host_id}/isolate")
async def isolate_host(host_id: str, payload: IsolateHostRequest = None):
    if not payload or not payload.twoKeyToken:
        raise HTTPException(status_code=403, detail="Two-Key token required.")
    return {"status": "success", "message": f"Host {host_id} isolated"}

@router.post("/endpoints/{host_id}/release")
async def release_host(host_id: str, payload: IsolateHostRequest = None):
    if not payload or not payload.twoKeyToken:
        raise HTTPException(status_code=403, detail="Two-Key token required.")
    return {"status": "success", "message": f"Host {host_id} released from isolation"}

@router.get("/incidents/active")
async def get_active_incidents():
    return [{"id": "i1", "title": "Ransomware Campaign", "severity": "critical", "status": "investigating", "createdAt": "2026-07-17T10:05:00Z", "assignedTo": "J. Reyes", "linkedAlerts": 14}]

@router.get("/data/settings")
async def get_settings():
    return {"name": "Principal Analyst", "email": "analyst@soc.internal", "role": "SOC Analyst", "tier": "Tier 3", "timezone": "UTC", "defaultDashboard": "overview", "notifications": {"email": True, "inApp": True, "critical": True}, "apiKeys": []}

class UserProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    timezone: Optional[str] = None
    defaultDashboard: Optional[str] = None
    notifications: Optional[Dict[str, Any]] = None

@router.patch("/data/settings")
async def update_settings(profile: UserProfileUpdate):
    # In production this would persist to DB; here we echo the update back.
    return {"status": "success", "updated": profile.dict(exclude_none=True)}

@router.post("/data/auth/revoke-all-sessions")
async def revoke_all_sessions():
    # In production: invalidate all JWT refresh tokens for the current user in DB.
    return {"status": "success", "message": "All sessions revoked."}

@router.websocket("/ws/investigations/{alert_id}/graph")
async def websocket_investigation_graph(websocket: WebSocket, alert_id: str):
    await websocket.accept()
    try:
        import asyncio
        for i in range(2):
            await asyncio.sleep(2)
            await websocket.send_json({"type": "NODE_UPDATE", "node": {"id": f"n-{i}", "label": f"Analysis {i}", "status": "success"}})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass

@router.websocket("/ws/incidents/war-room/{incident_id}")
async def websocket_war_room(websocket: WebSocket, incident_id: str):
    await websocket.accept()
    try:
        import asyncio
        await websocket.send_json({"id": "sys-1", "sender": "System", "message": f"War room for {incident_id} established.", "timestamp": "2026-07-18T12:00:00Z", "isSystem": True})
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"id": f"msg-{asyncio.get_event_loop().time()}", "sender": "Analyst", "message": data, "timestamp": "2026-07-18T12:01:00Z"})
    except WebSocketDisconnect:
        pass

@router.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await asyncio.sleep(10)
            await websocket.send_json({
                "id": f"alert-ws-{asyncio.get_event_loop().time()}", 
                "type": "Anomalous_Network_Activity", 
                "severity": 2
            })
    except WebSocketDisconnect:
        pass

@router.get("/incidents/closed")
async def get_closed_incidents():
    return [
        {
            "id": "i2", 
            "title": "Phishing Attempt", 
            "severity": "medium", 
            "closedAt": "2026-07-16T15:00:00Z", 
            "resolvedBy": "Auto-SOAR", 
            "duration": "1h 15m", 
            "postIncidentSummary": "Email quarantined and user notified."
        }
    ]

_detection_rules = [
    {"id": "rule-1", "name": "Suspicious Login", "severity": "high", "enabled": True, "lastTriggered": "2026-07-20T08:00:00Z", "isAutoResponse": False, "description": "Detects logins from impossible travel locations."},
    {"id": "rule-2", "name": "Lateral Movement via SMB", "severity": "critical", "enabled": True, "lastTriggered": "2026-07-21T11:00:00Z", "isAutoResponse": True, "description": "Detects SMB-based lateral movement patterns."},
    {"id": "rule-3", "name": "Data Exfiltration via DNS", "severity": "high", "enabled": False, "lastTriggered": None, "isAutoResponse": False, "description": "Detects large DNS TXT record transfers."},
]

@router.get("/detection/rules")
async def get_detection_rules():
    return _detection_rules

class RulePatch(BaseModel):
    enabled: Optional[bool] = None

@router.patch("/detection/rules/{rule_id}")
async def patch_detection_rule(rule_id: str, patch: RulePatch):
    rule = next((r for r in _detection_rules if r["id"] == rule_id), None)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if patch.enabled is not None:
        rule["enabled"] = patch.enabled
    return rule

_threat_feeds = [
    {"id": "feed-1", "name": "AlienVault OTX", "type": "AlienVault OTX", "health": "healthy", "lastSync": "2026-07-21T00:00:00Z", "iocVolume7d": [10, 20, 15, 30, 25, 40, 35]},
    {"id": "feed-2", "name": "Abuse.ch Malware Bazaar", "type": "Abuse.ch", "health": "healthy", "lastSync": "2026-07-22T00:00:00Z", "iocVolume7d": [5, 8, 12, 7, 14, 10, 20]},
]

@router.get("/detection/feeds")
async def get_threat_feeds():
    return _threat_feeds

class NewFeedRequest(BaseModel):
    name: str
    type: str
    url: Optional[str] = None

@router.post("/detection/feeds")
async def add_threat_feed(feed: NewFeedRequest):
    new_id = f"feed-{len(_threat_feeds) + 1}"
    new_feed = {"id": new_id, "name": feed.name, "type": feed.type, "health": "pending", "lastSync": None, "iocVolume7d": []}
    _threat_feeds.append(new_feed)
    return new_feed

@router.post("/detection/feeds/{feed_id}/sync")
async def sync_threat_feed(feed_id: str):
    feed = next((f for f in _threat_feeds if f["id"] == feed_id), None)
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    feed["lastSync"] = datetime.now(timezone.utc).isoformat()
    feed["health"] = "healthy"
    return {"status": "success", "message": f"Feed '{feed['name']}' sync triggered.", "feed": feed}

class WatchlistIOC(BaseModel):
    ioc: str
    type: Optional[str] = "ip"
    notes: Optional[str] = None

_watchlist: List[Dict[str, Any]] = []

@router.post("/detection/watchlist")
async def add_to_watchlist(item: WatchlistIOC):
    entry = {"id": f"wl-{uuid.uuid4().hex[:8]}", **item.dict(), "addedAt": datetime.now(timezone.utc).isoformat()}
    _watchlist.append(entry)
    return {"status": "success", "entry": entry}

@router.get("/detection/watchlist")
async def get_watchlist():
    return _watchlist

@router.get("/assets/vulnerabilities")
async def get_vulnerabilities():
    return [
        {
            "id": "vuln-1", 
            "cveId": "CVE-2021-44228", 
            "affectedAsset": "Web Server 01", 
            "affectedAssetId": "asset-1", 
            "cvssScore": 10.0, 
            "severity": "critical", 
            "patchStatus": "unpatched", 
            "discoveredAt": "2026-07-21T02:00:00Z", 
            "description": "Log4j vulnerability"
        }
    ]

@router.get("/assets/network-map")
async def get_network_map():
    return {
        "nodes": [
            {"id": "node1", "label": "Firewall", "type": "network_device", "hasActiveAlert": False, "x": 0, "y": 0, "subnet": "10.0.0.0/24"}
        ],
        "edges": []
    }

@router.get("/utilities/marketplace")
async def get_marketplace():
    return [
        {
            "id": "app-1", 
            "name": "Splunk Integration", 
            "publisher": "SecOps Inc", 
            "category": "SIEM", 
            "status": "not_installed", 
            "requiresElevated": True, 
            "tags": ["splunk", "logs"], 
            "description": "Forward alerts to Splunk."
        }
    ]

@router.post("/utilities/marketplace/{app_id}/install")
async def install_marketplace_app(app_id: str):
    return {"status": "success", "message": f"App '{app_id}' installation queued."}

# --- Data-prefixed marketplace routes (used by MarketplacePage.tsx) ---

_MARKETPLACE_LISTINGS = [
    {"id": "ml-1", "name": "CrowdStrike Falcon", "publisher": "CrowdStrike", "category": "EDR", "status": "not_installed", "requiresElevated": True, "tags": ["edr", "endpoint"], "description": "Next-gen endpoint protection."},
    {"id": "ml-2", "name": "Elastic SIEM", "publisher": "Elastic", "category": "SIEM", "status": "not_installed", "requiresElevated": False, "tags": ["siem", "logs"], "description": "Full SIEM stack with ECS."},
    {"id": "ml-3", "name": "VirusTotal Enrichment", "publisher": "Google", "category": "TI", "status": "installed", "requiresElevated": False, "tags": ["ti", "hash", "ip"], "description": "Enrich IOCs via VirusTotal API."},
]
_installed_apps: set = {"ml-3"}

@router.get("/data/marketplace/listings")
async def get_marketplace_listings():
    return [{**app, "status": "installed" if app["id"] in _installed_apps else "not_installed"} for app in _MARKETPLACE_LISTINGS]

@router.post("/data/marketplace/listings/{listing_id}/install")
async def install_listing(listing_id: str):
    listing = next((a for a in _MARKETPLACE_LISTINGS if a["id"] == listing_id), None)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    _installed_apps.add(listing_id)
    return {"status": "success", "message": f"'{listing['name']}' installed successfully."}

@router.delete("/data/marketplace/listings/{listing_id}/install")
async def uninstall_listing(listing_id: str):
    listing = next((a for a in _MARKETPLACE_LISTINGS if a["id"] == listing_id), None)
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    _installed_apps.discard(listing_id)
    return {"status": "success", "message": f"'{listing['name']}' uninstalled."}

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from Infrastructure.AgentEvents import agent_event_bus

import time
from collections import deque

@router.websocket("/ws/agent/stream")
async def websocket_agent_stream(websocket: WebSocket, lastEventId: Optional[str] = None):
    # Authentication enforcement mock
    # if not websocket.cookies.get("session"): await websocket.close(code=1008); return
    await websocket.accept()
    
    history = agent_event_bus.get_history()
    if lastEventId:
        # Replay only events after lastEventId
        replay_events = []
        found = False
        for ev in history:
            if found: replay_events.append(ev)
            if ev.get("correlationId") == lastEventId: found = True
        history = replay_events
        
    for event in history:
        await websocket.send_json(event)
    
    queue = agent_event_bus.subscribe()
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        agent_event_bus.unsubscribe(queue)

# Sliding window rate limiter state
chat_rate_limits = {}

@router.websocket("/ws/agent/chat")
async def websocket_agent_chat(websocket: WebSocket):
    # if not websocket.cookies.get("session"): await websocket.close(code=1008); return
    await websocket.accept()
    
    session_id = websocket.client.host if websocket.client else "unknown"
    if session_id not in chat_rate_limits:
        chat_rate_limits[session_id] = deque(maxlen=10)
    
    try:
        while True:
            data = await websocket.receive_text()
            now = time.time()
            
            # Clean old timestamps
            while chat_rate_limits[session_id] and chat_rate_limits[session_id][0] < now - 60:
                chat_rate_limits[session_id].popleft()
                
            if len(chat_rate_limits[session_id]) >= 10:
                await websocket.send_json({"error": "Rate limit exceeded. Max 10 messages per minute.", "done": True})
                continue
                
            chat_rate_limits[session_id].append(now)
            
            # Audit logging of chat interaction
            print(f"AUDIT LOG: Chat query from {session_id} - '{data}'")
            
            # Explicitly restricted LangChain mock
            msg = f"[Read-Only LangChain Executor] I analyzed '{data}'. Bound tools: [query_investigation_history, summarize_alert]. Explicitly excluded: [isolate_host, disable_rule]."
            for i in range(0, len(msg), 4):
                await websocket.send_json({"chunk": msg[i:i+4], "provider": "anthropic/claude-3-5-sonnet-20240620", "done": False})
                await asyncio.sleep(0.02)
            await websocket.send_json({"chunk": "", "done": True})
    except WebSocketDisconnect:
        pass
