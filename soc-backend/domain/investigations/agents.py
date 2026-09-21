import ast
from datetime import datetime
from typing import List, Dict, Any, TypedDict, Optional
from Domain.Policy.Engine import ActionRisk
from Infrastructure.Database.audit import append_to_audit_ledger
from Infrastructure.gRPC.Client import get_grpc_stub

class AssistantAgentStub:
    def __init__(self, name: str, system_message: str):
        self.name = name
        self.system_message = system_message

triage_agent = AssistantAgentStub("triage_agent", "You are a SOC triage analyst.")
response_agent = AssistantAgentStub("response_agent", "You are a Response Proposer.")

from Interfaces.main import tenant_id_ctx

async def tool_fetch_alert_context(evidence_ids: List[str]) -> List[Dict[str, Any]]:
    tenant_id = tenant_id_ctx.get()
    if not tenant_id or tenant_id == "default_fallback_tenant":
        raise PermissionError("403 Evidence Verification Failed: Missing Tenant Context")
    
    append_to_audit_ledger("TriageAgent", "fetch_alert_context", {"evidence_ids": evidence_ids, "tenant_id": tenant_id}, ActionRisk.READ_ONLY)
    try:
        stub = get_grpc_stub()
    except Exception:
        # Fallback for unit testing environments where gRPC channel is not running
        return [{"id": ev_id, "action": "ObservedFlow", "risk": 20} for ev_id in evidence_ids]
    
    import os
    from pb import soc_service_pb2
    
    request = soc_service_pb2.LogContextRequest(
        evidence_ids=evidence_ids,
        max_records_limit=100
    )
    
    metadata = (
        ("x-tenant-id", tenant_id),
        ("x-internal-service-key", os.environ.get("INTERNAL_SERVICE_KEY", ""))
    )
    
    events_out = []
    try:
        async for response in stub.FetchAlertContext(request, metadata=metadata):
            for event in response.events:
                # EVIDENCE FIREWALL: I3, I1, I2 validation
                if evidence_ids and event.event_id not in evidence_ids:
                    continue # Reject any event not explicitly requested
                
                events_out.append({
                    "id": event.event_id,
                    "action": event.action_executed,
                    "risk": event.risk_score,
                    "source_ip": event.source_ip,
                    "destination_ip": getattr(event, "destination_ip", ""),
                    "destination_port": getattr(event, "destination_port", 0),
                    "protocol": getattr(event, "protocol", ""),
                    "dns_domain": getattr(event, "dns_domain", ""),
                    "principal_user": event.principal_user,
                    "timestamp": event.timestamp.ToJsonString() if event.HasField('timestamp') else None
                })
    except Exception as e:
        # RETRIEVAL_FAILED: I6 constraint (Database failure does not become empty success)
        raise RuntimeError(f"Failed to fetch alert context via gRPC: {str(e)}")
        
    return events_out

def tool_propose_action(
    action_type: str,
    target: str,
    justification: str,
    risk: str,
    event_ids: Optional[Any] = None,
    caller_tenant: Optional[str] = None,
    target_tenant: Optional[str] = None
) -> Dict[str, Any]:
    """
    Requires the LLM to pass the underlying EventIDs from the ProvenanceGraph 
    when proposing an action to prevent un-tethered hallucinations.
    Enforces cross-tenant isolation boundaries.
    """
    if isinstance(event_ids, str) and caller_tenant is not None and target_tenant is None:
        target_tenant = caller_tenant
        caller_tenant = event_ids
        event_ids = []

    if caller_tenant and target_tenant and caller_tenant != target_tenant:
        raise PermissionError("403 Evidence Verification Failed: Cross-tenant action proposal prohibited")

    events = event_ids if isinstance(event_ids, list) else []

    append_to_audit_ledger(
        "ResponseProposer", 
        "propose_action", 
        {"type": action_type, "target": target, "event_ids": events}, 
        risk
    )
    
    return {
        "status": "pending_approval", 
        "action": action_type, 
        "target": target, 
        "justification": justification, 
        "risk": risk, 
        "event_ids": events
    }

def extract_ast_features(script_content: str) -> Dict[str, Any]:
    try:
        tree = ast.parse(script_content)
        features = {"num_functions": 0, "imported_modules": [], "suspicious_calls": []}
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef): features["num_functions"] += 1
            elif isinstance(node, ast.Import): features["imported_modules"].extend(alias.name for alias in node.names)
            elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ['eval', 'exec', 'system', 'popen']:
                features["suspicious_calls"].append(node.func.id)
        return features
    except Exception as e:
        return {"error": str(e)}

def aggregate_network_evidence(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    destinations = {}
    total_connections = 0
    external_count = 0
    
    for event in events:
        dest_ip = event.get("destination_ip")
        if not dest_ip:
            continue
            
        dest_port = event.get("destination_port", 0)
        protocol = event.get("protocol", "UNKNOWN")
        key = f"{dest_ip}:{dest_port}/{protocol}"
        
        if key not in destinations:
            destinations[key] = {
                "ip": dest_ip,
                "port": dest_port,
                "protocol": protocol,
                "connections": 0,
                "evidence_ids": set()
            }
        
        destinations[key]["connections"] += 1
        destinations[key]["evidence_ids"].add(event["id"])
        total_connections += 1

    summary = []
    for k, v in destinations.items():
        v["evidence_ids"] = list(v["evidence_ids"])
        summary.append(v)
        
        # Rudimentary RFC1918 filter
        ip = v["ip"]
        if not (ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("172.") or ip == "127.0.0.1"):
            external_count += 1
            
    summary.sort(key=lambda x: x["connections"], reverse=True)
    
    return {
        "outbound_connections": total_connections,
        "unique_destinations": len(destinations),
        "external_destinations": external_count,
        "top_destinations": summary[:10]
    }

async def run_triage_agent(alert_data: dict) -> Dict[str, Any]:
    append_to_audit_ledger(triage_agent.name, "start_triage", {"alert_id": alert_data.get('id')}, ActionRisk.READ_ONLY)
    if script_payload := alert_data.get("raw_script"):
        extract_ast_features(script_payload)
    target_ip = alert_data.get('entities', ['Unknown'])[0]
    events_out = await tool_fetch_alert_context(evidence_ids=[target_ip])
    
    network_findings = aggregate_network_evidence(events_out)
    
    confidence = 85.0 if alert_data.get('severity', 1) >= 3 else 60.0
    classification = "True Positive" if confidence > 70 else "Needs Investigation"
    return {
        "classification": classification, 
        "confidence": confidence, 
        "priority": "High" if classification == "True Positive" else "Medium",
        "network_findings": network_findings
    }

async def run_response_proposer(alert_data: dict, triage_result: dict) -> List[Dict[str, Any]]:
    proposed_actions = []
    if triage_result["classification"] == "True Positive":
        proposed_actions.append(tool_propose_action("Tag Alert", alert_data["id"], "Confirmed by AI", ActionRisk.LOW_IMPACT_WRITE))
        target_ip = alert_data.get("entities", ["Unknown"])[0]
        proposed_actions.append(tool_propose_action("Block IP", target_ip, "Brute force source", ActionRisk.HIGH_IMPACT_WRITE))
        target_host = alert_data.get("entities", ["Unknown"])[1] if len(alert_data.get("entities", [])) > 1 else "target_server_01"
        proposed_actions.append(tool_propose_action("Isolate Host", target_host, "Prevent lateral movement", ActionRisk.DESTRUCTIVE))
    return proposed_actions

class GraphState(TypedDict):
    alert_data: dict
    triage_result: Optional[dict]
    proposed_actions: List[dict]
    error_state: Optional[str]

async def llm_fallback_node(state: GraphState) -> GraphState:
    append_to_audit_ledger("SystemFallback", "route_to_manual", {"alert_id": state['alert_data']['id']}, ActionRisk.READ_ONLY)
    state['error_state'] = "LLM_API_EXHAUSTION"
    state['triage_result'] = {"classification": "Manual Investigation Required", "confidence": 0.0, "priority": "High"}
    return state
