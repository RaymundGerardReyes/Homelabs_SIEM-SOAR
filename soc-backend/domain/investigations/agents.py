import ast
from datetime import datetime
from typing import List, Dict, Any, TypedDict, Optional
from domain.policy.engine import ActionRisk
from infra.db.audit import append_to_audit_ledger
from infra.grpc.client import get_grpc_stub

class AssistantAgentStub:
    def __init__(self, name: str, system_message: str):
        self.name = name
        self.system_message = system_message

triage_agent = AssistantAgentStub("triage_agent", "You are a SOC triage analyst.")
response_agent = AssistantAgentStub("response_agent", "You are a Response Proposer.")

async def tool_fetch_alert_context(evidence_ids: List[str]) -> List[Dict[str, Any]]:
    append_to_audit_ledger("TriageAgent", "fetch_alert_context", {"evidence_ids": evidence_ids}, ActionRisk.READ_ONLY)
    stub = get_grpc_stub()
    return [{"id": "mock-event", "action": "Login", "risk": 45}]

def tool_propose_action(action_type: str, target: str, justification: str, risk: str) -> Dict[str, Any]:
    append_to_audit_ledger("ResponseProposer", "propose_action", {"type": action_type, "target": target}, risk)
    return {"status": "pending_approval", "action": action_type, "target": target, "justification": justification, "risk": risk}

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

async def run_triage_agent(alert_data: dict) -> Dict[str, Any]:
    append_to_audit_ledger(triage_agent.name, "start_triage", {"alert_id": alert_data.get('id')}, ActionRisk.READ_ONLY)
    if script_payload := alert_data.get("raw_script"):
        extract_ast_features(script_payload)
    target_ip = alert_data.get('entities', ['Unknown'])[0]
    await tool_fetch_alert_context(evidence_ids=[target_ip])
    confidence = 85.0 if alert_data.get('severity', 1) >= 3 else 60.0
    classification = "True Positive" if confidence > 70 else "Needs Investigation"
    return {"classification": classification, "confidence": confidence, "priority": "High" if classification == "True Positive" else "Medium"}

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
