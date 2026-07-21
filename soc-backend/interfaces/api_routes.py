import os
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Optional

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
from pydantic import BaseModel
import asyncio
import json

router = APIRouter(dependencies=[Depends(verify_internal_auth)])

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

@router.post("/playbooks/{playbook_id}/run")
async def run_playbook(playbook_id: str, context: PlaybookRunContext) -> Dict[str, Any]:
    result = execute_playbook_in_sandbox(playbook_id, context.dict())
    if result.get("status") == "error":
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
        "riskTrend": [{"date": "07-11", "score": 45}],
        "topThreats": [{"category": "Ransomware (LockBit)", "count": 14}]
    }

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

@router.get("/endpoints/hosts")
async def get_hosts():
    return [
        {"id": "h1", "hostname": "WIN-DC-01", "os": "Windows Server 2022", "agentVersion": "3.4.1", "latestVersion": "3.4.1", "health": "healthy", "lastCheckIn": "2026-07-17T00:00:00Z"},
    ]

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

@router.get("/incidents/active")
async def get_active_incidents():
    return [{"id": "i1", "title": "Ransomware Campaign", "severity": "critical", "status": "investigating", "createdAt": "2026-07-17T10:05:00Z", "assignedTo": "J. Reyes", "linkedAlerts": 14}]

@router.get("/settings")
async def get_settings():
    return {"name": "Principal Analyst", "email": "analyst@soc.internal", "role": "SOC Analyst", "tier": "Tier 3", "timezone": "UTC", "defaultDashboard": "overview", "notifications": {"email": True, "inApp": True, "critical": True}, "apiKeys": []}

@router.post("/auth/revoke-all-sessions")
async def revoke_all_sessions():
    return {"status": "success"}

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

@router.get("/detection/rules")
async def get_detection_rules():
    return [
        {
            "id": "rule-1", 
            "name": "Suspicious Login", 
            "severity": "high", 
            "enabled": True, 
            "lastTriggered": "2026-07-20T08:00:00Z", 
            "isAutoResponse": False, 
            "description": "Detects logins from impossible travel locations."
        }
    ]

@router.get("/detection/feeds")
async def get_threat_feeds():
    return [
        {
            "id": "feed-1", 
            "name": "AlienVault OTX", 
            "type": "AlienVault OTX", 
            "health": "healthy", 
            "lastSync": "2026-07-21T00:00:00Z", 
            "iocVolume7d": [10, 20, 15, 30, 25, 40, 35]
        }
    ]

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
