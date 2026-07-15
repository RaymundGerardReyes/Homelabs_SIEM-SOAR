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
import grpc
# import soc_service_pb2         (Assuming compiled by protoc)
# import soc_service_pb2_grpc    (Assuming compiled by protoc)

# Using mock types to prevent ModuleNotFoundError until protoc generation
class MockGRPCAio:
    pass

from context_config import get_grpc_stub
# from pb import soc_service_pb2

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Step 4 of 6: The AI Orchestration Loop (LangGraph State Machine).
#    - Upstream: SIEM Alert Queue / Webhooks | Downstream: FastAPI LLM Triage / Go gRPC
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Provides the `tool_fetch_alert_context` binding which executes the secure
#      ContextVar-based gRPC call to stream high-velocity logs from Go to Python.
#    - Architected to keep socket state thread-safe and isolated from LangGraph.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Python Backend / ML: This is an `async def` I/O-bound block. Do not introduce
#      synchronous loops (like heavy AST parsing) directly inside this coroutine,
#      or you will freeze the asyncio event loop and block all concurrent gRPC streams.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Invokes `FetchAlertContext` over the persistent `core-ingest:9090` channel.
#    - Depends on the `LogContextRequest` and `LogContextResponse` Protobuf schemas.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: If the Go gRPC channel drops or timeouts, the tool returns an
#      empty list, depriving the AI agent of context.
#    - Fallback State: The LangGraph `llm_fallback_node` routes the alert to a
#      human SOC analyst queue instead of making blind containment decisions.
# ==============================================================================
async def tool_fetch_alert_context(evidence_ids: List[str]) -> List[Dict[str, Any]]:
    """
    Queries the high-performance Go Core via gRPC streams to extract security metadata records.
    Uses ContextVars to securely retrieve the warm stub without leaking Request signatures to LangGraph.
    """
    append_to_audit_ledger("TriageAgent", "fetch_alert_context", {"evidence_ids": evidence_ids}, ActionRisk.READ_ONLY)
    
    # Look up the warm, persistent socket instantly and safely
    stub = get_grpc_stub()
    
    # proto_request = soc_service_pb2.LogContextRequest(evidence_ids=evidence_ids)
    
    context_logs = []
    print(f"[gRPC Stream] Using warm context var to stream {len(evidence_ids)} logs...")
    
    try:
        # Mocking for immediate execution without compiled protoc
        context_logs.append({
            "id": "mock-event-uuid",
            "action": "Login_Attempt",
            "risk": 45
        })
        return context_logs
        
    except Exception as e:
        print(f"[gRPC Error] Core gRPC processing failure occurred: {str(e)}")
        return []

def tool_propose_action(action_type: str, target: str, justification: str, risk: str) -> Dict[str, Any]:
    """Allowed ONLY for Response Proposer Agent."""
    append_to_audit_ledger("ResponseProposer", "propose_action", {"type": action_type, "target": target}, risk)
    return {"status": "pending_approval", "action": action_type, "target": target, "justification": justification, "risk": risk}

# ==========================================
# 4. AGENT EXECUTION ROUTINES
# ==========================================
import ast

def extract_ast_features(script_content: str) -> Dict[str, Any]:
    """
    Parses a raw script string into an Abstract Syntax Tree (AST) to defeat obfuscation.
    For PowerShell, we'd use a language-specific tree-sitter parser, but this demonstrates 
    the structural approach (mimicking the concept in Python's native AST).
    """
    try:
        tree = ast.parse(script_content)
        features = {
            "num_functions": 0,
            "imported_modules": [],
            "suspicious_calls": []
        }
        
        # Traverse the AST to extract behavioral semantics, ignoring variable names (deobfuscation)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef):
                features["num_functions"] += 1
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    features["imported_modules"].append(alias.name)
            elif isinstance(node, ast.Call):
                # Detect structural patterns of execution, e.g., base64 decoding or shell execution
                if isinstance(node.func, ast.Name):
                    if node.func.id in ['eval', 'exec', 'system', 'popen']:
                        features["suspicious_calls"].append(node.func.id)
                        
        return features
    except Exception as e:
        return {"error": f"AST parsing failed: {str(e)}"}

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Triage Entry Point: Fired when a raw alert enters the LangGraph execution graph.
#    - Upstream: Alert Trigger | Downstream: Response Proposer Agent
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Triggers AST script deobfuscation and requests deep log context via gRPC.
#    - Evaluates semantic features against known attack heuristics.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Python Backend / ML: `extract_ast_features` is CPU-bound and locks the GIL.
#      If the `script_payload` is extremely large, the asyncio event loop will stall.
#      It should be offloaded to `asyncio.to_thread()`.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Mutates and passes the internal LangGraph `GraphState`.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Large payloads breaking AST parsing will return an error dict.
#    - Fallback State: Returns a "Needs Investigation" state, deferring to human analysts.
# ==============================================================================
async def run_triage_agent(alert_data: dict) -> Dict[str, Any]:
    """
    Triage Agent: Initial assessment of raw alerts, enriched with AST logic.
    """
    print(f"\n[{datetime.utcnow().isoformat()}] [{triage_agent.name}] Assessing Alert {alert_data['id']}...")
    append_to_audit_ledger(triage_agent.name, "start_triage", {"alert_id": alert_data['id']}, ActionRisk.READ_ONLY)
    
    # AST Extraction for Scripts (e.g., PowerShell payloads)
    script_payload = alert_data.get("raw_script")
    if script_payload:
        ast_features = extract_ast_features(script_payload)
        print(f"[{triage_agent.name}] Extracted AST Semantic Features: {ast_features}")
        if ast_features.get("suspicious_calls"):
            print(f"[{triage_agent.name}] ⚠️ AST Engine detected highly obfuscated execution patterns!")
    
    # 1. Agent calls the log querying tool to hit the Go core API via gRPC streams
    target_ip = alert_data.get('entities', ['Unknown'])[0]
    log_context = await tool_fetch_alert_context(evidence_ids=[target_ip], limit=500)
    print(f"[{triage_agent.name}] Tool output retrieved {len(log_context)} structured events.")
    
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

# ==========================================
# 5. LANGGRAPH STATE GRAPH & FALLBACK ROUTING
# ==========================================
from typing import TypedDict, Optional

class GraphState(TypedDict):
    alert_data: dict
    triage_result: Optional[dict]
    proposed_actions: List[dict]
    error_state: Optional[str]

async def llm_fallback_node(state: GraphState) -> GraphState:
    """
    Fallback Error Node: Executed gracefully if the primary LLM API hits rate limits, 
    token exhaustion (HTTP 429), or internal server errors (HTTP 500).
    Instead of crashing the streaming loop, it routes the alert to a manual queue.
    """
    print(f"[{datetime.utcnow().isoformat()}] ⚠️ [FALLBACK NODE] Token Exhaustion or API Error Detected.")
    append_to_audit_ledger("SystemFallback", "route_to_manual", {"alert_id": state['alert_data']['id']}, ActionRisk.READ_ONLY)
    
    state['error_state'] = "LLM_API_EXHAUSTION"
    state['triage_result'] = {
        "classification": "Manual Investigation Required",
        "confidence": 0.0,
        "priority": "High" # Default to high priority when AI fails to analyze safely
    }
    return state

# Pseudo-LangGraph construction to demonstrate the fallback branching
# builder = StateGraph(GraphState)
# builder.add_node("triage", run_triage_agent)
# builder.add_node("fallback", llm_fallback_node)
# builder.add_edge("triage", "fallback") # Fallback triggered on API Exception
