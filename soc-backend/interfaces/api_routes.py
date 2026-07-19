from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Optional
from domain.playbooks.registry import get_all_playbooks
from infra.sandbox.runner import execute_playbook_in_sandbox
from pydantic import BaseModel
import asyncio
import json

router = APIRouter()

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

@router.get("/playbooks/{playbook_id}/execute/stream")
async def stream_playbook_execution(playbook_id: str, token: Optional[str] = None) -> StreamingResponse:
    async def event_generator():
        loop = asyncio.get_event_loop()
        result: Dict[str, Any] = await loop.run_in_executor(
            None, execute_playbook_in_sandbox, playbook_id, {"target": "demo_target", "justification": "SSE"}
        )
        for line in result.get("logs", []):
            yield f"data: {line}\n\n"
            await asyncio.sleep(0.05)
        exit_code = 0 if result.get("status") == "success" else 1
        done_payload = json.dumps({"exit_code": exit_code, "status": result.get("status")})
        yield f"event: done\ndata: {done_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

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

@router.get("/endpoints/hosts")
async def get_hosts():
    return [
        {"id": "h1", "hostname": "WIN-DC-01", "os": "Windows Server 2022", "agentVersion": "3.4.1", "latestVersion": "3.4.1", "health": "healthy", "lastCheckIn": "2026-07-17T00:00:00Z"},
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
