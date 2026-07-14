import json
import urllib.request
from datetime import datetime
from typing import List, Dict, Any

# ==========================================
# 1. ACTION CLASSIFICATION & RISK SCORING
# ==========================================
class ActionRisk:
    READ_ONLY = "READ_ONLY"             # e.g., query_logs
    LOW_IMPACT_WRITE = "LOW_IMPACT_WRITE" # e.g., tag_alert
    HIGH_IMPACT_WRITE = "HIGH_IMPACT_WRITE" # e.g., block_ip
    DESTRUCTIVE = "DESTRUCTIVE"         # e.g., wipe_device

def append_to_audit_ledger(agent_name: str, action: str, context: Dict[str, Any], risk_level: str):
    """Immutable audit logging of every agent action and tool invocation."""
    entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "agent": agent_name,
        "action": action,
        "context": context,
        "risk_level": risk_level,
        "policy_decision": "ALLOWED" if risk_level in [ActionRisk.READ_ONLY, ActionRisk.LOW_IMPACT_WRITE] else "PENDING_HUMAN_APPROVAL"
    }
    print(f"[AUDIT LEDGER] {json.dumps(entry)}")

# ==========================================
# 2. AUTOGEN / LANGCHAIN AGENT SKETCHES
# ==========================================
# This aligns with Section 7.3: Implementing Agents (sketch)
class AssistantAgentStub:
    """Mock stub representing an AutoGen AssistantAgent"""
    def __init__(self, name: str, system_message: str):
        self.name = name
        self.system_message = system_message

triage_agent = AssistantAgentStub(
    name="triage_agent",
    system_message="You are a SOC triage analyst. Classify alerts and suggest next steps."
)

response_agent = AssistantAgentStub(
    name="response_agent",
    system_message="You are a Response Proposer. Propose containment actions securely."
)

# ==========================================
# 3. SECURE TOOL WRAPPERS (Section 7.5)
# ==========================================
def tool_query_logs(query: str, start_time: str, end_time: str) -> str:
    """Allowed for Triage and Investigation Agents. Calls Go Core Query API."""
    append_to_audit_ledger("TriageAgent", "query_logs", {"query": query}, ActionRisk.READ_ONLY)
    
    # Actually call the Go Core API running on port 9090
    try:
        url = f"http://localhost:9090/api/query/logs?q={query.replace(' ', '+')}"
        req = urllib.request.Request(url, headers={"Authorization": "Bearer SYSTEM_TOKEN"})
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.read().decode('utf-8')
    except Exception as e:
        return f"[Tool Error] Could not reach Go Query API: {e}"

def tool_propose_action(action_type: str, target: str, justification: str, risk: str) -> Dict[str, Any]:
    """Allowed ONLY for Response Proposer Agent."""
    append_to_audit_ledger("ResponseProposer", "propose_action", {"type": action_type, "target": target}, risk)
    return {"status": "pending_approval", "action": action_type, "target": target, "justification": justification, "risk": risk}

# ==========================================
# 4. AGENT EXECUTION ROUTINES
# ==========================================
async def run_triage_agent(alert_data: dict) -> Dict[str, Any]:
    """
    Triage Agent: Initial assessment of raw alerts.
    """
    print(f"\n[{datetime.utcnow().isoformat()}] [{triage_agent.name}] Assessing Alert {alert_data['id']}...")
    append_to_audit_ledger(triage_agent.name, "start_triage", {"alert_id": alert_data['id']}, ActionRisk.READ_ONLY)
    
    # 1. Agent calls the log querying tool to hit the Go core API
    target_ip = alert_data.get('entities', ['Unknown'])[0]
    log_context = tool_query_logs(f"source_ip:{target_ip}", "now-1h", "now")
    print(f"[{triage_agent.name}] Tool output retrieved: {log_context}")
    
    # Mocking LLM Assessment based on retrieved context
    confidence = 85.0 if alert_data.get('severity', 1) >= 3 else 60.0
    classification = "True Positive" if confidence > 70 else "Needs Investigation"
    
    return {
        "classification": classification,
        "confidence": confidence,
        "priority": "High" if classification == "True Positive" else "Medium"
    }

async def run_response_proposer(alert_data: dict, triage_result: dict) -> List[Dict[str, Any]]:
    """
    Response Proposer Agent: Formulates containment plans.
    """
    proposed_actions = []
    
    if triage_result["classification"] == "True Positive":
        # Low Impact Action
        proposed_actions.append(
            tool_propose_action("Tag Alert", alert_data["id"], "Marked as confirmed by AI", ActionRisk.LOW_IMPACT_WRITE)
        )
        # High Impact Action
        target_ip = alert_data.get("entities", ["Unknown"])[0]
        proposed_actions.append(
            tool_propose_action("Block IP", target_ip, "Brute force source identified", ActionRisk.HIGH_IMPACT_WRITE)
        )
        # Destructive Action (requires two-key turn)
        target_host = alert_data.get("entities", ["Unknown"])[1] if len(alert_data.get("entities", [])) > 1 else "target_server_01"
        proposed_actions.append(
            tool_propose_action("Isolate Host", target_host, "Prevent lateral movement", ActionRisk.DESTRUCTIVE)
        )
        
    return proposed_actions
