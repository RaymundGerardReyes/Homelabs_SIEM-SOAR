import json
from datetime import datetime
from typing import Dict, Any
from domain.policy.engine import ActionRisk
import asyncio
import logging

logger = logging.getLogger(__name__)

async def _insert_audit(entry: dict):
    from infra.http.deps import get_db
    try:
        async for conn in get_db():
            await conn.execute(
                "INSERT INTO audit_logs (correlation_id, timestamp, agent, action, context, risk_level, policy_decision) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                entry["correlation_id"], entry["timestamp"], entry["agent"], entry["action"], json.dumps(entry["context"]), entry["risk_level"], entry["policy_decision"]
            )
            break
    except Exception as e:
        logger.error(f"Failed to insert audit log to Postgres: {e}")

def append_to_audit_ledger(agent_name: str, action: str, context: Dict[str, Any], risk_level: str):
    """Immutable audit logging of every agent action and tool invocation."""
    from interfaces.main import correlation_id_ctx
    
    try:
        corr_id = correlation_id_ctx.get()
    except LookupError:
        corr_id = "system"

    entry = {
        "correlation_id": corr_id,
        "timestamp": datetime.utcnow(),
        "agent": agent_name,
        "action": action,
        "context": context,
        "risk_level": risk_level,
        "policy_decision": "ALLOWED" if risk_level in [ActionRisk.READ_ONLY, ActionRisk.LOW_IMPACT_WRITE] else "PENDING_HUMAN_APPROVAL"
    }
    
    # Keep print for fast debugging container logs
    print(f"[AUDIT LEDGER] {json.dumps(entry, default=str)}")
    
    # Fire and forget async insert to database to preserve synchronous API for LangGraph
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_insert_audit(entry))
    except RuntimeError:
        pass
