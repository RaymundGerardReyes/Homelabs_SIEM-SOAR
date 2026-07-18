from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Optional
from playbooks import get_all_playbooks, execute_playbook_in_sandbox
from pydantic import BaseModel
import asyncio
import json

router = APIRouter()

# --- Mock Data Seed (Will be replaced with PostgreSQL queries later) ---
MOCK_ALERTS = [
    {"id": "alert-172102001", "type": "Brute_Force_Attack", "severity": 3},
    {"id": "alert-172102002", "type": "Impossible_Travel", "severity": 2},
    {"id": "alert-172102003", "type": "Ransomware_Behavior", "severity": 4},
    {"id": "alert-172102004", "type": "Suspicious_Powershell", "severity": 3},
]

# --- API Endpoints ---

@router.get("/metrics/overview")
async def get_metrics_overview() -> Dict[str, Any]:
    """Returns live platform KPI metrics. TODO: source from ClickHouse aggregations."""
    return {
        "alertsScanned": 2404,
        "eventsIngestGB24h": 40,
        "dataIngestTB24h": 65,
        "openIncidents": 10,
        "preventedEvents": 286100
    }

@router.get("/notifications")
async def get_notifications() -> List[Dict[str, Any]]:
    """Returns analyst notification feed. TODO: source from events DB."""
    return [
        {"id": "n-1", "message": "Brute Force attack escalated to Tier 2.", "severity": "warning", "timestamp": "2026-07-17T00:01:00Z", "read": False},
        {"id": "n-2", "message": "Ransomware playbook auto-contained endpoint.", "severity": "critical", "timestamp": "2026-07-17T00:05:00Z", "read": False},
    ]

@router.get("/threat-intel/enrich")
async def enrich_threat_intel(ip: str) -> Dict[str, Any]:
    """
    Enriches an IP address via threat intel feeds.
    TODO: Wire to real AlienVault OTX, Abuse.ch, MISP integrations.
    Returns partial data with None for unavailable sources.
    """
    if not ip:
        raise HTTPException(status_code=400, detail="ip query parameter is required")
    return {
        "source_ip": ip,
        "alienvault_otx": {
            "reputation": 85,
            "pulse_count": 12,
            "tags": ["cobaltstrike", "c2", "apt29"],
        },
        "abuse_ch": {
            "listed": True,
            "malware_family": "Qakbot",
        },
        "misp_correlation": True,
        "overall_risk_score": 9.4,
    }

@router.get("/alerts")
async def get_alerts() -> List[Dict[str, Any]]:
    """Fetch all active security alerts."""
    # TODO: Connect to asyncpg/SQLAlchemy to fetch live from PostgreSQL
    return MOCK_ALERTS

@router.get("/playbooks")
async def get_playbooks() -> List[Dict[str, Any]]:
    """Fetch all available playbooks."""
    playbooks = get_all_playbooks()
    return [{"id": p.id, "name": p.name, "trigger": p.trigger, "code": p.code} for p in playbooks]

class PlaybookRunContext(BaseModel):
    target: str
    justification: str = "Manual execution from Frontend Dashboard"

@router.post("/playbooks/{playbook_id}/run")
async def run_playbook(playbook_id: str, context: PlaybookRunContext) -> Dict[str, Any]:
    """Execute a playbook securely inside the Sandbox (blocking REST path)."""
    result = execute_playbook_in_sandbox(playbook_id, context.dict())
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.get("/playbooks/{playbook_id}/execute/stream")
async def stream_playbook_execution(playbook_id: str, token: Optional[str] = None) -> StreamingResponse:
    """
    SSE streaming endpoint for PlaybookSandbox.tsx.
    Runs the playbook and emits log lines as server-sent events, finishing with
    a `done` event carrying the exit code.
    Frontend fallback: if this endpoint returns an error, PlaybookSandbox.tsx
    automatically retries via POST /playbooks/{id}/run (blocking REST path).
    """
    async def event_generator():
        # Run the blocking sandbox call in a thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        result: Dict[str, Any] = await loop.run_in_executor(
            None, execute_playbook_in_sandbox, playbook_id, {"target": "demo_target", "justification": "SSE stream execution"}
        )

        # Emit each log line as an SSE `message` event
        for line in result.get("logs", []):
            yield f"data: {line}\n\n"
            await asyncio.sleep(0.05)  # Brief inter-event pause for streaming effect

        # Emit terminal `done` event with exit code
        exit_code = 0 if result.get("status") == "success" else 1
        done_payload = json.dumps({"exit_code": exit_code, "status": result.get("status")})
        yield f"event: done\ndata: {done_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disables Nginx proxy buffering for SSE
        },
    )

@router.get("/investigation/{alert_id}")
async def get_investigation(alert_id: str) -> Dict[str, Any]:
    """Fetch AI Investigation context for a specific alert."""
    alert = next((a for a in MOCK_ALERTS if a["id"] == alert_id), None)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # TODO: Connect to LangGraph state / Postgres for live investigation data
    return {
        "nodes": [],
        "edges": [],
        # source_ip is returned here so the frontend can mount ThreatIntelPanel
        "source_ip": "198.51.100.42",
        "details": {
            "conversation_log": [
                {
                    "agent": "TriageAgent",
                    "message": f"Assessed alert severity as {alert['severity']}. Classification: True Positive",
                    "confidence": 85.0,
                },
                {
                    "agent": "TriageAgent",
                    "message": "Found anomalies in source IP geo-location (198.51.100.42).",
                    "confidence": 65.0,
                },
                {
                    "agent": "ResponseProposer",
                    "message": "Generated proposed actions for containment.",
                    "confidence": 95.0,
                },
            ],
            "proposed_actions": [
                {
                    "action": "Tag Alert",
                    "target": alert_id,
                    "justification": "Marked as confirmed by AI",
                    "risk": "LOW_IMPACT_WRITE",
                },
                {
                    "action": "Block IP",
                    "target": "198.51.100.42",
                    "justification": "Brute force source identified",
                    "risk": "HIGH_IMPACT_WRITE",
                },
                {
                    "action": "Isolate Host",
                    "target": "target_server_01",
                    "justification": "Prevent lateral movement",
                    "risk": "DESTRUCTIVE",
                },
            ],
        },
    }


class ActionExecuteRequest(BaseModel):
    action: str
    target: str
    justification: str
    risk: str


@router.post("/actions/execute")
async def execute_action(payload: ActionExecuteRequest) -> Dict[str, Any]:
    """
    Governance action execution endpoint — called after Two-Key confirmation.
    TODO: Wire to the real SOAR action dispatcher (policy engine + audit log).
    """
    import logging
    logging.getLogger(__name__).info(
        f"[POLICY ENGINE] Action approved: {payload.action} on {payload.target} "
        f"(risk={payload.risk}) — justification: {payload.justification}"
    )
    return {
        "status": "accepted",
        "action": payload.action,
        "target": payload.target,
        "risk": payload.risk,
        "message": f"Action '{payload.action}' on '{payload.target}' submitted to policy engine.",
    }

# ==============================================================================
# MISSING ENDPOINTS FOR NEW FRONTEND PAGES (Implemented with Mock Data)
# ==============================================================================

@router.get("/dashboards/executive-summary")
async def get_executive_summary():
    return {
        "activeThreats": 12, "criticalAssetsExposed": 3, "automatedResponses": 145,
        "mttd_minutes": 18, "mttr_minutes": 94, "criticalOpenCount": 7, "resolvedThisMonth": 135,
        "complianceScore": 92,
        "riskTrend": [
            {"date": "07-11", "score": 45}, {"date": "07-12", "score": 42}, {"date": "07-13", "score": 48},
            {"date": "07-14", "score": 55}, {"date": "07-15", "score": 50}, {"date": "07-16", "score": 40},
            {"date": "07-17", "score": 35}
        ],
        "topThreats": [
            {"category": "Ransomware (LockBit)", "count": 14},
            {"category": "Credential Stuffing", "count": 89},
            {"category": "Data Exfiltration (DNS)", "count": 3},
            {"category": "Privilege Escalation", "count": 7},
            {"category": "Lateral Movement (SMB)", "count": 22}
        ]
    }

@router.get("/dashboards/compliance-status")
async def get_compliance_status():
    return [
        {
            "id": "c1", "framework": "ISO 27001", "score": 92, "status": "compliant",
            "controls": [
                {"id": "A.9.1.1", "name": "Access Control Policy", "status": "passed", "lastChecked": "2026-07-16T12:00:00Z"},
                {"id": "A.9.2.3", "name": "Management of Privileged Access Rights", "status": "failed", "lastChecked": "2026-07-16T12:00:00Z", "notes": "3 unused admin accounts detected."}
            ]
        },
        {
            "id": "c2", "framework": "SOC 2 Type II", "score": 85, "status": "warning",
            "controls": [
                {"id": "CC6.1", "name": "Logical Access Security", "status": "passed", "lastChecked": "2026-07-16T12:00:00Z"},
                {"id": "CC6.8", "name": "Unauthorized Access Prevention", "status": "failed", "lastChecked": "2026-07-16T12:00:00Z", "notes": "WAF ruleset outdated on edge firewall."}
            ]
        }
    ]

@router.get("/assets/inventory")
async def get_asset_inventory():
    return [
        {"id": "a1", "hostname": "WIN-DC-01", "ipAddress": "10.0.0.5", "type": "server", "owner": "IT-Infra", "criticality": "Tier 1", "lastSeen": "2026-07-17T00:00:00Z"},
        {"id": "a2", "hostname": "WIN-WS-14", "ipAddress": "10.0.1.14", "type": "workstation", "owner": "J.Doe", "criticality": "Tier 3", "lastSeen": "2026-07-17T00:00:00Z"},
        {"id": "a3", "hostname": "FW-EDGE-01", "ipAddress": "198.51.100.1", "type": "network_device", "owner": "NetSec", "criticality": "Tier 1", "lastSeen": "2026-07-17T00:00:00Z"},
        {"id": "a4", "hostname": "prod-db-cluster", "ipAddress": "10.10.0.50", "type": "cloud_resource", "owner": "DBA-Team", "criticality": "Tier 1", "lastSeen": "2026-07-17T00:00:00Z"},
    ]

@router.get("/assets/vulnerabilities")
async def get_vulnerabilities():
    return [
        {"id": "v1", "cveId": "CVE-2024-21412", "affectedAsset": "WIN-DC-01", "affectedAssetId": "a1", "cvssScore": 9.8, "severity": "critical", "patchStatus": "unpatched", "discoveredAt": "2026-07-10", "description": "Internet Shortcut Files Security Feature Bypass."},
        {"id": "v3", "cveId": "CVE-2024-3400", "affectedAsset": "FW-EDGE-01", "affectedAssetId": "a3", "cvssScore": 10.0, "severity": "critical", "patchStatus": "unpatched", "discoveredAt": "2026-07-12", "description": "PAN-OS command injection in GlobalProtect."},
    ]

@router.get("/assets/network-map")
async def get_network_map():
    return {
        "nodes": [
            {"id": "n1", "label": "FW-EDGE-01", "type": "network_device", "hasActiveAlert": False, "x": 400, "y": 60, "subnet": "DMZ"},
            {"id": "n2", "label": "WIN-DC-01", "type": "server", "hasActiveAlert": False, "x": 200, "y": 200, "subnet": "10.0.0.0/24"},
            {"id": "n3", "label": "WIN-FIN-03", "type": "workstation", "hasActiveAlert": True, "x": 100, "y": 350, "subnet": "10.0.5.0/24"},
        ],
        "edges": [
            {"source": "n1", "target": "n2"},
            {"source": "n2", "target": "n3"},
        ]
    }

@router.get("/endpoints/hosts")
async def get_hosts():
    return [
        {"id": "h1", "hostname": "WIN-DC-01", "os": "Windows Server 2022", "agentVersion": "3.4.1", "latestVersion": "3.4.1", "health": "healthy", "lastCheckIn": "2026-07-17T00:00:00Z"},
        {"id": "h2", "hostname": "WIN-WS-14", "os": "Windows 11", "agentVersion": "3.3.9", "latestVersion": "3.4.1", "health": "outdated", "lastCheckIn": "2026-07-17T00:00:00Z"},
    ]

@router.get("/endpoints/isolation-candidates")
async def get_isolation_candidates():
    return [
        {
            "id": "h1", "hostname": "WIN-FIN-03", "ipAddress": "10.0.5.21",
            "isIsolated": True, "isolatedAt": "2026-07-17T10:13:00Z", "isolatedBy": "ResponseAgent",
            "auditTrail": [
                {"action": "isolated", "by": "ResponseAgent", "at": "2026-07-17T10:13:00Z", "justification": "Ransomware campaign detected"}
            ]
        },
        {
            "id": "h3", "hostname": "WIN-DC-01", "ipAddress": "10.0.0.5",
            "isIsolated": False,
            "auditTrail": []
        }
    ]

@router.post("/endpoints/{host_id}/isolate")
async def isolate_host(host_id: str):
    return {"status": "success", "message": f"Host {host_id} isolated"}

@router.post("/endpoints/{host_id}/release")
async def release_host(host_id: str):
    return {"status": "success", "message": f"Host {host_id} released"}

@router.get("/endpoints/edr-logs")
async def get_edr_logs():
    return [
        {"id": "l1", "timestamp": "2026-07-17T10:00:01Z", "host": "WIN-FIN-03", "process": "powershell.exe", "eventType": "process_exec", "isSuspicious": True, "detail": 'powershell -exec bypass -enc WwBD...', "rawJson": {"pid":4112,"ppid":800}},
        {"id": "l2", "timestamp": "2026-07-17T10:00:05Z", "host": "WIN-FIN-03", "process": "lsass.exe", "eventType": "registry_change", "isSuspicious": True, "detail": "Suspicious registry handle by unknown process", "rawJson": {"key":"HKLM\\SAM"}},
    ]

@router.get("/marketplace/listings")
async def get_marketplace_listings():
    return [
        {"id": "ml-1", "name": "AlienVault OTX Connector", "publisher": "AT&T", "category": "threat-intel", "status": "installed", "requiresElevated": False, "tags": ["threat-intel"], "description": "Integrates AlienVault OTX."},
        {"id": "ml-3", "name": "Ransomware Auto-Contain", "publisher": "Cortex Labs", "category": "soar-playbook", "status": "installed", "requiresElevated": True, "tags": ["soar"], "description": "Auto isolates ransomware hosts."},
    ]

@router.post("/marketplace/listings/{listing_id}/install")
async def install_marketplace_listing(listing_id: str):
    return {"status": "success", "message": f"Installed {listing_id}"}

@router.delete("/marketplace/listings/{listing_id}/install")
async def uninstall_marketplace_listing(listing_id: str):
    return {"status": "success", "message": f"Uninstalled {listing_id}"}

@router.get("/incidents/active")
async def get_active_incidents():
    return [
        {"id": "i1", "title": "Ransomware Campaign", "severity": "critical", "status": "investigating", "createdAt": "2026-07-17T10:05:00Z", "assignedTo": "J. Reyes", "linkedAlerts": 14},
    ]

@router.get("/incidents/closed")
async def get_closed_incidents():
    return [
        {"id": "ci1", "title": "SQL Injection", "severity": "high", "closedAt": "2026-07-14T18:00:00Z", "resolvedBy": "A. Kim", "duration": "3h 20m", "postIncidentSummary": "WAF rule deployed."},
    ]

@router.get("/detection/rules")
async def get_detection_rules():
    return [
        {"id": "r1", "name": "Brute Force Login Detection", "severity": "high", "enabled": True, "lastTriggered": "2026-07-17T10:21:00Z", "isAutoResponse": False, "description": "Fires after 5 failed logins."},
        {"id": "r2", "name": "C2 Beacon via DNS TXT", "severity": "critical", "enabled": True, "lastTriggered": "2026-07-16T22:00:00Z", "isAutoResponse": True, "description": "Detects exfil via DNS TXT record tunneling."},
    ]

@router.get("/detection/ioc-search")
async def search_iocs(query: str, type: str):
    return [
        {"ioc": query, "type": type, "verdict": "malicious", "sourceFeed": "AlienVault OTX", "confidence": 92, "lastSeen": "2026-07-17T08:00:00Z"},
    ]

@router.get("/detection/feeds")
async def get_threat_feeds():
    return [
        {"id": "f1", "name": "AlienVault OTX", "type": "AlienVault OTX", "health": "healthy", "lastSync": "2026-07-17T13:00:00Z", "iocVolume7d": [1200,1050,980,1100,1300,900,1150]},
        {"id": "f5", "name": "Custom STIX Feed", "type": "STIX/TAXII", "health": "down", "lastSync": "2026-07-15T08:00:00Z", "iocVolume7d": [500,480,510,0,0,0,0], "authFailed": True},
    ]

@router.post("/detection/feeds/{feed_id}/sync")
async def sync_threat_feed(feed_id: str):
    return {"status": "success", "message": f"Sync triggered for {feed_id}"}

@router.get("/settings")
async def get_settings():
    return {
        "name": "Principal Analyst", "email": "analyst@soc.internal", "role": "SOC Analyst", "tier": "Tier 3",
        "timezone": "UTC", "defaultDashboard": "overview", "notifications": {"email": True, "inApp": True, "critical": True},
        "apiKeys": [{"id": "k1", "name": "CI/CD Key", "maskedValue": "sk-soc-****", "createdAt": "2026-06-01", "lastUsed": None}]
    }

@router.patch("/settings")
async def update_settings():
    return {"status": "success"}

@router.post("/auth/revoke-all-sessions")
async def revoke_all_sessions():
    return {"status": "success"}

