"""
Domain.Intelligence.AIIntelligenceEngine
========================================

The SOLE intelligence layer for the SIEM platform.

Architecture contract (from central-ai-agent-sole-intelligence-prompt.md):
  - External SDKs are zero-processing telemetry conduits.
  - All detection, correlation, anomaly scoring, and response decisions
    are made ONLY here — never at the edge.
  - This module is INTERNAL ONLY. It is never exposed through public ingress.
  - Response actions flow through authenticated SOAR endpoints, never
    back to external SDKs directly.

Lifecycle:
  1. Background asyncio task started at FastAPI startup (wired in main.py).
  2. Continuously reads from the internal event bus (sliding window per tenant).
  3. Runs LLM-powered triage via LangGraph when anomaly thresholds are exceeded.
  4. Emits alerts/tasks into PostgreSQL for the UI and SOAR response layer.
"""

import asyncio
import logging
import json
import os
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Internal event bus: /api/v1/agent/push writes here; this engine reads here.
# This is NOT accessible from any public HTTP route.
# ──────────────────────────────────────────────────────────────────────────────
_internal_event_bus: asyncio.Queue = asyncio.Queue(maxsize=50_000)

# Sliding window: tenant_id -> deque of recent events (last 5 min, max 1000)
_tenant_windows: Dict[str, deque] = defaultdict(lambda: deque(maxlen=1000))

# Severity thresholds for triggering AI triage
ANOMALY_THRESHOLD_WARNING  = 5   # WARNING events in window
ANOMALY_THRESHOLD_CRITICAL = 2   # CRITICAL events in window


async def ingest_event(event: Dict[str, Any]) -> None:
    """
    Called by /api/v1/agent/push after enrichment.
    Non-blocking: drops events when bus is full rather than blocking ingestion.
    """
    try:
        _internal_event_bus.put_nowait(event)
    except asyncio.QueueFull:
        logger.warning(
            "[AI Engine] Internal event bus full — dropping event from "
            f"endpoint={event.get('endpoint_id')} tenant={event.get('tenant_id')}"
        )


async def _classify_batch(tenant_id: str, events: List[Dict[str, Any]], db) -> Optional[Dict]:
    """
    Internal AI triage: LLM-powered threat classification.
    NEVER exposed to external systems. Returns an alert dict or None.
    """
    try:
        from Domain.Investigations.LargeLanguageModelTriage import run_triage
        summary = json.dumps([
            {"source": e.get("source"), "severity": e.get("severity"), "message": e.get("message")}
            for e in events[:20]  # Limit context window
        ], indent=2)

        result = await run_triage(
            tenant_id=tenant_id,
            event_summary=summary,
            correlation_id=uuid.uuid4().hex[:16]
        )
        return result
    except Exception as e:
        logger.error(f"[AI Engine] LLM triage failed for tenant={tenant_id}: {e}")
        return None


async def _emit_alert(tenant_id: str, classification: Dict, db) -> None:
    """
    Persists AI-generated alert into PostgreSQL audit_logs.
    The UI reads from this table; external SDKs never see this data.
    """
    try:
        await db.execute("""
            INSERT INTO audit_logs (correlation_id, agent, action, context, risk_level, policy_decision)
            VALUES ($1, 'ai-intelligence-engine', 'anomaly_detected', $2, $3, 'ALERT')
        """,
            uuid.uuid4().hex[:16],
            json.dumps({
                "tenant_id":       tenant_id,
                "classification":  classification.get("classification", "unknown"),
                "confidence":      classification.get("confidence", 0),
                "summary":         classification.get("summary", ""),
                "recommended_action": classification.get("recommended_action", "investigate"),
            }),
            classification.get("risk_level", "MEDIUM")
        )
        logger.info(
            f"[AI Engine] 🚨 Alert emitted: tenant={tenant_id} "
            f"class={classification.get('classification')} "
            f"risk={classification.get('risk_level')}"
        )
    except Exception as e:
        logger.error(f"[AI Engine] Failed to persist alert for tenant={tenant_id}: {e}")


def _check_anomaly_thresholds(window: deque) -> bool:
    """
    Simple sliding-window anomaly signal: triggers AI triage when
    the WARNING/CRITICAL event density exceeds configured thresholds.
    This is the ONLY place where event severity is evaluated; edge SDKs
    send raw data without any pre-scoring.
    """
    warning_count  = sum(1 for e in window if e.get("severity") in ("WARNING",  "WARN"))
    critical_count = sum(1 for e in window if e.get("severity") in ("CRITICAL", "ERROR"))
    return (
        warning_count  >= ANOMALY_THRESHOLD_WARNING or
        critical_count >= ANOMALY_THRESHOLD_CRITICAL
    )


async def run_intelligence_loop(get_db_func) -> None:
    """
    Main background loop — started once at FastAPI startup.

    Isolation guarantees:
      - Reads ONLY from internal event bus.
      - Writes ONLY to PostgreSQL audit_logs/agent_tasks.
      - NEVER calls back to external SDK endpoints.
      - NEVER exposes its internal tool list or model outputs externally.
    """
    logger.info("[AI Engine] 🧠 Central Intelligence Engine started.")
    
    # Triage cool-down: avoid re-triggering on the same tenant within 60s
    _triage_cooldown: Dict[str, float] = {}

    while True:
        try:
            event = await asyncio.wait_for(_internal_event_bus.get(), timeout=5.0)
        except asyncio.TimeoutError:
            continue

        tenant_id = event.get("tenant_id", "unknown")
        _tenant_windows[tenant_id].append(event)

        window = _tenant_windows[tenant_id]
        now = datetime.now(timezone.utc).timestamp()

        # Respect cool-down to prevent alert storms
        last_triage = _triage_cooldown.get(tenant_id, 0)
        if (now - last_triage) < 60:
            continue

        if not _check_anomaly_thresholds(window):
            continue

        # Anomaly threshold crossed — run AI triage
        _triage_cooldown[tenant_id] = now
        events_snapshot = list(window)

        logger.info(
            f"[AI Engine] ⚡ Anomaly threshold crossed for tenant={tenant_id} "
            f"({len(events_snapshot)} events in window). Running AI triage..."
        )

        try:
            async for db in get_db_func():
                classification = await _classify_batch(tenant_id, events_snapshot, db)
                if classification:
                    await _emit_alert(tenant_id, classification, db)
        except Exception as e:
            logger.error(f"[AI Engine] Triage pipeline error for tenant={tenant_id}: {e}")
