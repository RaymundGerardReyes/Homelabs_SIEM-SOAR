import asyncio
import json
from datetime import datetime, timezone
from collections import deque
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

# Ring buffer for the last 500 events (Section 2.6)
_event_buffer = deque(maxlen=500)

# Global pub/sub set of asyncio.Queues for active WebSocket connections
_subscribers = set()

def emit_agent_event(
    correlation_id: str,
    node: str,
    status: str,
    investigation_id: Optional[str] = None,
    provider: Optional[str] = None,
    fallback_triggered: bool = False,
    fallback_reason: Optional[str] = None,
    latency_ms: Optional[float] = None,
    summary: Optional[str] = None
):
    """
    Fire-and-forget event emitter for LangGraph state transitions.
    Never blocks the main triage pipeline.
    """
    try:
        event = {
            "correlationId": correlation_id,
            "investigationId": investigation_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "node": node,
            "status": status,
            "provider": provider,
            "fallbackTriggered": fallback_triggered,
            "fallbackReason": fallback_reason,
            "latencyMs": latency_ms,
            "summary": summary
        }
        
        _event_buffer.append(event)
        
        # Non-blocking publish to all active subscribers
        for queue in _subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Backpressure: if a client is too slow, we just skip it (or drop oldest)
                pass
                
    except Exception as e:
        logger.error(f"Failed to emit agent event: {e}")

async def simulate_triage_pipeline(correlation_id: str, investigation_id: str = None):
    """
    A mock pipeline that simulates the LangGraph progression, 
    demonstrating how the emitter wraps each node.
    """
    import random
    
    # 1. Ingest
    emit_agent_event(correlation_id, "Ingest", "started", investigation_id)
    await asyncio.sleep(0.1)
    emit_agent_event(correlation_id, "Ingest", "completed", investigation_id, latency_ms=100.5)
    
    # 2. Deobfuscation
    emit_agent_event(correlation_id, "Deobfuscation", "started", investigation_id)
    await asyncio.sleep(0.3)
    emit_agent_event(correlation_id, "Deobfuscation", "completed", investigation_id, latency_ms=305.2)
    
    # 3. LLM Triage (with simulated fallback)
    emit_agent_event(correlation_id, "LLMTriage", "started", investigation_id, provider="openai")
    await asyncio.sleep(0.5)
    
    # Simulate OpenAI failure 20% of the time
    if random.random() > 0.8:
        emit_agent_event(correlation_id, "LLMTriage", "failed", investigation_id, provider="openai", fallback_triggered=True, fallback_reason="Timeout: Provider un-responsive", latency_ms=500.0)
        emit_agent_event(correlation_id, "LLMTriage", "started", investigation_id, provider="anthropic")
        await asyncio.sleep(0.4)
        
        # Simulate secondary failure 5% of the time (falling back to Deterministic Rules)
        if random.random() > 0.95:
             emit_agent_event(correlation_id, "LLMTriage", "failed", investigation_id, provider="anthropic", fallback_triggered=True, fallback_reason="Rate limit exceeded", latency_ms=400.0)
             emit_agent_event(correlation_id, "LLMTriage", "started", investigation_id, provider="static_ruleset")
             emit_agent_event(correlation_id, "LLMTriage", "FALLBACK_DETERMINISTIC_RULE_TRIGGERED", investigation_id, provider="static_ruleset", summary="Applied Rule: Suspicious_PowerShell_Execution")
             emit_agent_event(correlation_id, "LLMTriage", "completed", investigation_id, provider="static_ruleset", latency_ms=10.0)
        else:
             emit_agent_event(correlation_id, "LLMTriage", "completed", investigation_id, provider="anthropic", latency_ms=400.0)
    else:
        emit_agent_event(correlation_id, "LLMTriage", "completed", investigation_id, provider="openai", latency_ms=512.4)

    # 4. Action
    emit_agent_event(correlation_id, "Action", "started", investigation_id)
    await asyncio.sleep(0.1)
    emit_agent_event(correlation_id, "Action", "completed", investigation_id, latency_ms=85.0)
