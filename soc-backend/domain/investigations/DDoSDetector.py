"""
Domain.Investigations.DDoSDetector
====================================
DDoS & Container Abuse Detector.

Detection strategy (Phase 4.3 of the Multi-System Network Monitoring Plan):
  1. Packets-Per-Second (PPS) Threshold  — If a host or container transmits
     packets at a rate far above its rolling baseline, flag as a DDoS source.
  2. Unique Destination Count            — A host hammering many unique external
     IPs in a short window is a reliable flood / scan indicator.
  3. Rolling Baseline Z-Score            — Uses an Exponentially Weighted Moving
     Average (EWMA) baseline so the detector adapts to legitimate traffic spikes
     (e.g., a nightly backup) without generating false positives.
  4. Container-Specific Signals          — Sudden container restart storms, OOM
     kills, or extreme resource deviation are treated as container abuse signals.
  5. Per-Host Byte Rate Burst            — Outbound byte bursts exceeding a
     configurable multiplier of the EWMA baseline trigger a bandwidth-flood alert.

All findings are emitted as `SecurityFinding` dicts on the shared `agent_event_bus`.

Usage:
    from Domain.Investigations.DDoSDetector import ddos_detector
    finding = ddos_detector.analyze(container_metrics, flow_events)
"""

import logging
import uuid
import math
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
from collections import defaultdict

from Infrastructure.AgentEvents import agent_event_bus

logger = logging.getLogger("ddos-detector")

# ---------------------------------------------------------------------------
# Configuration Constants
# ---------------------------------------------------------------------------

# Absolute PPS threshold — no baseline needed; anything above is suspicious
PPS_HARD_THRESHOLD = 5_000.0        # packets/sec outbound

# Z-score threshold for baseline-relative anomalies
ZSCORE_THRESHOLD = 3.0

# Minimum observations before baseline is considered reliable
BASELINE_MIN_SAMPLES = 5

# Unique destination count thresholds
UNIQUE_DST_SCAN_THRESHOLD    = 50   # within a measurement window → port-scan/UDP flood
UNIQUE_DST_EXTREME_THRESHOLD = 200  # very high → confirmed DDoS

# Container restart storm threshold (restarts within the observation window)
CONTAINER_RESTART_STORM = 5

# OOM kill count threshold
CONTAINER_OOM_THRESHOLD = 2

# Byte-rate multiplier above EWMA baseline to trigger burst alert
BYTE_BURST_MULTIPLIER = 10.0

# Score components
SCORE_PPS_HARD              = 70
SCORE_ZSCORE_ANOMALY        = 50
SCORE_UNIQUE_DST_SCAN       = 40
SCORE_UNIQUE_DST_EXTREME    = 75
SCORE_CONTAINER_RESTART     = 35
SCORE_CONTAINER_OOM         = 40
SCORE_BYTE_BURST            = 45

# EWMA smoothing factor (α) for rolling baseline
EWMA_ALPHA = 0.2


# ---------------------------------------------------------------------------
# EWMA Baseline Tracker (in-memory, per detector instance)
# ---------------------------------------------------------------------------

class EWMABaseline:
    """
    Exponentially Weighted Moving Average baseline tracker for a single metric.
    Maintains mean and variance estimates using the Welford online algorithm
    adapted for exponential weighting.
    """
    def __init__(self, alpha: float = EWMA_ALPHA):
        self.alpha = alpha
        self.mean: Optional[float] = None
        self.var: Optional[float] = None
        self.n: int = 0

    def update(self, value: float) -> None:
        if self.mean is None:
            self.mean = value
            self.var = 0.0
        else:
            delta = value - self.mean
            self.mean += self.alpha * delta
            self.var = (1 - self.alpha) * (self.var + self.alpha * delta ** 2)
        self.n += 1

    @property
    def std(self) -> float:
        if self.var is None or self.var <= 0:
            return 1.0   # Avoid divide-by-zero; return unit std when unknown
        return math.sqrt(self.var)

    def zscore(self, value: float) -> float:
        if self.mean is None or self.n < BASELINE_MIN_SAMPLES:
            return 0.0   # Not enough data yet — don't flag
        return (value - self.mean) / self.std

    def is_reliable(self) -> bool:
        return self.n >= BASELINE_MIN_SAMPLES


# ---------------------------------------------------------------------------
# DDoSDetector
# ---------------------------------------------------------------------------

class DDoSDetector:
    """
    Stateful DDoS & container-abuse detector with per-host EWMA baselines.

    The detector accumulates baseline samples via `update_baseline()` during
    normal operation, then evaluates incoming telemetry via `analyze()`.
    In unit tests, baselines can be seeded directly via `seed_baseline()`.
    """

    def __init__(self, score_threshold: int = 60):
        """
        :param score_threshold: Minimum cumulative evidence score to emit a finding.
        """
        self.score_threshold = score_threshold
        # key: host_id (ip or container_id) → metric_name → EWMABaseline
        self._baselines: Dict[str, Dict[str, EWMABaseline]] = defaultdict(
            lambda: defaultdict(EWMABaseline)
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def seed_baseline(self, host_id: str, metric: str, values: List[float]) -> None:
        """
        Pre-seed the EWMA baseline for a host/metric with historical values.
        Useful for unit tests and bootstrap from ClickHouse historical data.
        """
        bl = self._baselines[host_id][metric]
        for v in values:
            bl.update(v)

    def update_baseline(self, host_id: str, metrics: Dict[str, float]) -> None:
        """
        Feed a telemetry sample into the baseline model (called during normal,
        non-alerting operation so the detector learns the host's normal pattern).
        """
        for metric, value in metrics.items():
            self._baselines[host_id][metric].update(value)

    def analyze(
        self,
        flow_events: List[Dict[str, Any]],
        container_metrics: Optional[List[Dict[str, Any]]] = None,
        endpoint_id: Optional[str] = None,
        tenant_id: str = "default-tenant",
    ) -> Optional[Dict[str, Any]]:
        """
        Main entry point.

        :param flow_events: Network flow dicts (per-host or per-container).
                            Each must contain: source_ip, destination_ip,
                            bytes_out, pps_tx (optional), timestamp.
        :param container_metrics: Container telemetry dicts containing:
                                  container_id, container_name, pps_tx,
                                  unique_dst_count, baseline_dev, lifecycle_event
                                  (start, stop, restart, die, oom).
        :param endpoint_id:   Reporting endpoint UUID for DB linkage.
        :param tenant_id:     Tenant for multi-tenant isolation.
        :returns: SecurityFinding dict if threshold exceeded, else None.
        """
        score = 0
        evidence: Dict[str, Any] = {"triggers": []}
        finding_category = "ddos"

        # ---- Network flow analysis ----
        if flow_events:
            flow_score, flow_ev = self._analyze_flows(flow_events)
            score += flow_score
            if flow_ev:
                evidence.update(flow_ev)

        # ---- Container metrics analysis ----
        if container_metrics:
            cm_score, cm_ev, is_container_abuse = self._analyze_container_metrics(container_metrics)
            score += cm_score
            if cm_ev:
                evidence.update(cm_ev)
            if is_container_abuse:
                finding_category = "container_abuse"

        evidence["total_score"] = score
        logger.debug(
            f"[DDoSDetector] score={score} threshold={self.score_threshold} "
            f"category={finding_category} triggers={evidence.get('triggers', [])}"
        )

        if score < self.score_threshold:
            return None

        source_ip = self._primary_source(flow_events, container_metrics or [])
        finding = self._build_finding(
            category=finding_category,
            score=min(score, 100),
            source_ip=source_ip,
            evidence=evidence,
            endpoint_id=endpoint_id,
            tenant_id=tenant_id,
        )

        agent_event_bus.emit({
            "type": "SecurityFinding",
            "category": finding_category,
            "finding_id": finding["finding_id"],
            "source_ip": source_ip,
            "score": finding["score"],
            "triggers": evidence.get("triggers", []),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        logger.warning(
            f"[DDoSDetector] {finding_category.upper()} finding raised: "
            f"score={score} source={source_ip} triggers={evidence.get('triggers')}"
        )
        return finding

    # ------------------------------------------------------------------
    # Flow Analysis
    # ------------------------------------------------------------------

    def _analyze_flows(
        self, flows: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        score = 0
        evidence: Dict[str, Any] = {}

        # Aggregate per source IP
        per_host: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "bytes_out": 0,
            "pps_tx": 0.0,
            "unique_dsts": set(),
            "flow_count": 0,
        })

        for f in flows:
            src = f.get("source_ip", "unknown")
            dst = f.get("destination_ip", "")
            host = per_host[src]
            host["bytes_out"] += int(f.get("bytes_out", 0) or 0)
            host["pps_tx"] += float(f.get("pps_tx", 0) or 0)
            host["flow_count"] += 1
            if dst:
                host["unique_dsts"].add(dst)

        triggers = evidence.get("triggers") or []

        for src_ip, agg in per_host.items():
            pps = agg["pps_tx"]
            unique_dsts = len(agg["unique_dsts"])
            bytes_out = agg["bytes_out"]

            # Check 1: Hard PPS threshold
            if pps >= PPS_HARD_THRESHOLD:
                score += SCORE_PPS_HARD
                evidence["pps_flood"] = {
                    "src_ip": src_ip,
                    "pps_tx": pps,
                    "threshold": PPS_HARD_THRESHOLD,
                }
                triggers.append("pps_hard_threshold")

            # Check 2: Baseline Z-score on PPS
            bl_pps = self._baselines[src_ip]["pps_tx"]
            if bl_pps.is_reliable():
                z = bl_pps.zscore(pps)
                if z >= ZSCORE_THRESHOLD:
                    score += SCORE_ZSCORE_ANOMALY
                    evidence["pps_zscore"] = {
                        "src_ip": src_ip,
                        "pps_observed": pps,
                        "baseline_mean": round(bl_pps.mean, 2),
                        "zscore": round(z, 2),
                    }
                    triggers.append("pps_zscore_anomaly")

            # Check 3: Baseline Z-score on bytes_out
            bl_bytes = self._baselines[src_ip]["bytes_out"]
            if bl_bytes.is_reliable():
                z_bytes = bl_bytes.zscore(bytes_out)
                if z_bytes >= ZSCORE_THRESHOLD:
                    score += SCORE_BYTE_BURST
                    evidence["byte_burst"] = {
                        "src_ip": src_ip,
                        "bytes_out": bytes_out,
                        "baseline_mean": round(bl_bytes.mean, 2),
                        "zscore": round(z_bytes, 2),
                    }
                    triggers.append("byte_burst_anomaly")
            elif bl_bytes.mean and bytes_out >= bl_bytes.mean * BYTE_BURST_MULTIPLIER:
                # Fallback: hard multiplier if baseline not yet reliable
                score += SCORE_BYTE_BURST // 2
                triggers.append("byte_burst_hard_multiplier")

            # Check 4: Unique destination count
            if unique_dsts >= UNIQUE_DST_EXTREME_THRESHOLD:
                score += SCORE_UNIQUE_DST_EXTREME
                evidence["unique_dst_flood"] = {
                    "src_ip": src_ip,
                    "unique_dest_count": unique_dsts,
                    "threshold": UNIQUE_DST_EXTREME_THRESHOLD,
                }
                triggers.append("unique_dst_extreme")
            elif unique_dsts >= UNIQUE_DST_SCAN_THRESHOLD:
                score += SCORE_UNIQUE_DST_SCAN
                evidence["unique_dst_scan"] = {
                    "src_ip": src_ip,
                    "unique_dest_count": unique_dsts,
                    "threshold": UNIQUE_DST_SCAN_THRESHOLD,
                }
                triggers.append("unique_dst_scan")

            # Update baseline with current observation for future windows
            self.update_baseline(src_ip, {"pps_tx": pps, "bytes_out": bytes_out})

        evidence["triggers"] = triggers
        return score, evidence if score > 0 else None

    # ------------------------------------------------------------------
    # Container Metrics Analysis
    # ------------------------------------------------------------------

    def _analyze_container_metrics(
        self, metrics: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]], bool]:
        """
        Returns (score, evidence, is_container_abuse_primary).
        is_container_abuse_primary is True when container signals dominate.
        """
        score = 0
        evidence: Dict[str, Any] = {}
        triggers: List[str] = []
        is_container_abuse = False

        # Aggregate per container
        per_container: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
            "restarts": 0,
            "ooms": 0,
            "pps_tx": 0.0,
            "unique_dst_count": 0,
            "name": "",
        })

        for m in metrics:
            cid = m.get("container_id", "unknown")
            evt = (m.get("lifecycle_event") or "").lower()
            c = per_container[cid]
            c["name"] = m.get("container_name", cid)
            if evt == "restart":
                c["restarts"] += 1
            elif evt == "oom":
                c["ooms"] += 1
            c["pps_tx"] = max(c["pps_tx"], float(m.get("pps_tx", 0) or 0))
            c["unique_dst_count"] = max(
                c["unique_dst_count"],
                int(m.get("unique_dst_count", 0) or 0)
            )

        for cid, agg in per_container.items():
            name = agg["name"]
            pps = agg["pps_tx"]
            unique_dsts = agg["unique_dst_count"]
            restarts = agg["restarts"]
            ooms = agg["ooms"]

            if restarts >= CONTAINER_RESTART_STORM:
                score += SCORE_CONTAINER_RESTART
                evidence["container_restart_storm"] = {
                    "container_id": cid,
                    "container_name": name,
                    "restart_count": restarts,
                    "threshold": CONTAINER_RESTART_STORM,
                }
                triggers.append("container_restart_storm")
                is_container_abuse = True

            if ooms >= CONTAINER_OOM_THRESHOLD:
                score += SCORE_CONTAINER_OOM
                evidence["container_oom"] = {
                    "container_id": cid,
                    "container_name": name,
                    "oom_count": ooms,
                }
                triggers.append("container_oom_kill")
                is_container_abuse = True

            # Container PPS flood
            if pps >= PPS_HARD_THRESHOLD:
                score += SCORE_PPS_HARD
                evidence["container_pps_flood"] = {
                    "container_id": cid,
                    "pps_tx": pps,
                    "threshold": PPS_HARD_THRESHOLD,
                }
                triggers.append("container_pps_flood")

            # Per-container Z-score
            bl = self._baselines[cid]["pps_tx"]
            if bl.is_reliable():
                z = bl.zscore(pps)
                if z >= ZSCORE_THRESHOLD:
                    score += SCORE_ZSCORE_ANOMALY
                    evidence["container_pps_zscore"] = {
                        "container_id": cid,
                        "pps_observed": pps,
                        "zscore": round(z, 2),
                    }
                    triggers.append("container_pps_zscore")

            # Unique destination count
            if unique_dsts >= UNIQUE_DST_SCAN_THRESHOLD:
                score += SCORE_UNIQUE_DST_SCAN
                evidence["container_unique_dst"] = {
                    "container_id": cid,
                    "unique_dest_count": unique_dsts,
                }
                triggers.append("container_unique_dst_scan")

            self.update_baseline(cid, {"pps_tx": pps})

        evidence["triggers"] = triggers
        return score, evidence if score > 0 else None, is_container_abuse

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _primary_source(
        self, flows: List[Dict[str, Any]], container_metrics: List[Dict[str, Any]]
    ) -> str:
        if flows:
            counts: Dict[str, int] = {}
            for f in flows:
                ip = f.get("source_ip", "")
                if ip:
                    counts[ip] = counts.get(ip, 0) + 1
            if counts:
                return max(counts, key=counts.get)
        if container_metrics:
            return container_metrics[0].get("container_id", "unknown-container")
        return "unknown"

    def _build_finding(
        self,
        category: str,
        score: int,
        source_ip: str,
        evidence: Dict[str, Any],
        endpoint_id: Optional[str],
        tenant_id: str,
    ) -> Dict[str, Any]:
        # Container abuse stays at container/host level — use throttle_container if applicable
        if category == "container_abuse":
            action = "throttle_container"
        else:
            action = "isolate_lan_client" if score >= 70 else "none"

        return {
            "finding_id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "endpoint_id": endpoint_id,
            "category": category,
            "score": score,
            "evidence": evidence,
            "source_ip": source_ip,
            "recommended_action": action,
            "status": "open",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
ddos_detector = DDoSDetector(score_threshold=60)

