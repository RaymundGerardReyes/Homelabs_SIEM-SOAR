"""
Domain.Investigations.RatDetector
==================================
Remote Access Trojan (RAT) & Covert Remote-Access Detector.

Detection strategy (Phase 4.1 of the Multi-System Network Monitoring Plan):
  1. Beacon Interval Analysis   — Periodic, low-jitter outbound connections that
     match known RAT beaconing patterns (< 30 s interval, < 10 % jitter).
  2. Process × Network Correlation — Long-lived connections from unexpected binary
     names (not in a configurable allowlist).
  3. GUI Spawning Script Engine  — A UI-process (e.g., explorer.exe, finder) that
     spawns a script interpreter (python, powershell, bash, wscript) which then
     makes a network connection.
  4. Novel Destination Heuristic — Connection to a previously unseen external IP
     with very low byte volume (C2 keepalive pattern).

All findings are emitted as `SecurityFinding` dicts on the shared `agent_event_bus`
and can be persisted to PostgreSQL `security_findings` by the caller.

Usage:
    from Domain.Investigations.RatDetector import rat_detector
    finding = rat_detector.analyze(process_events, flow_events)
"""

import math
import logging
import uuid
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
from statistics import mean, stdev, StatisticsError

from Infrastructure.AgentEvents import agent_event_bus

logger = logging.getLogger("rat-detector")

# ---------------------------------------------------------------------------
# Configuration Constants
# ---------------------------------------------------------------------------

# Minimum number of connection events required to attempt interval analysis
BEACON_MIN_SAMPLES = 4

# Maximum beacon interval in seconds to be considered a RAT beacon pattern
BEACON_MAX_INTERVAL_S = 300.0  # 5 minutes — longer is also suspicious but more ambiguous

# Maximum coefficient of variation (stdev/mean) to qualify as "low-jitter"
BEACON_JITTER_CV_THRESHOLD = 0.15   # 15 % jitter tolerance

# Score thresholds
SCORE_BEACON              = 60
SCORE_BEACON_HIGH_JITTER  = 35
SCORE_UNKNOWN_BINARY      = 25
SCORE_GUI_SPAWN_SCRIPT    = 30
SCORE_NOVEL_DEST          = 15
SCORE_LONG_LIVED_CONN     = 10
SCORE_SUSPICIOUS_PORT     = 10
SCORE_C2_DOMAIN           = 30       # domain_category == known_c2 or malware_host

# Known-benign process names (allowlist) — extend per deployment
BENIGN_PROCESS_ALLOWLIST = frozenset({
    "chrome", "firefox", "safari", "edge", "msedge",
    "outlook", "thunderbird", "slack", "teams", "zoom",
    "explorer", "explorer.exe", "finder",
    "svchost.exe", "services.exe", "lsass.exe",
    "systemd", "init", "launchd",
    "curl", "wget", "apt", "yum", "pip", "python3",
    "node", "npm", "yarn",
    "git", "ssh", "scp", "rsync",
    "dockerd", "containerd", "runc",
    "fluent-bit", "agent_poller", "agent_poller.py",
})

# Script engines that are suspicious when spawned by a GUI parent
SCRIPT_ENGINE_NAMES = frozenset({
    "python", "python3", "python.exe",
    "powershell", "powershell.exe", "pwsh", "pwsh.exe",
    "bash", "sh", "zsh", "dash", "fish",
    "wscript.exe", "cscript.exe",
    "cmd.exe",
    "perl", "perl.exe",
    "ruby", "ruby.exe",
    "node", "node.exe",
})

# GUI processes that should NOT be spawning script engines
GUI_PROCESS_NAMES = frozenset({
    "explorer.exe", "explorer",
    "finder",
    "taskbar.exe",
    "winlogon.exe",
    "dwm.exe",
})

# Ports commonly abused for reverse shells / RAT C2
SUSPICIOUS_RAT_PORTS = frozenset({
    4444, 4445, 4446,     # Metasploit default
    1337, 31337,          # "Elite" hacker ports
    8888, 8080, 8443,     # Tunnelled C2
    5555, 9001, 9002,     # Tor / custom C2
    6666, 6667, 6668,     # IRC-based C2
})


# ---------------------------------------------------------------------------
# Helper Utilities
# ---------------------------------------------------------------------------

def _coefficient_of_variation(values: List[float]) -> float:
    """Returns stdev/mean as a dimensionless ratio. Returns 1.0 on degenerate input."""
    try:
        mu = mean(values)
        if mu == 0:
            return 1.0
        return stdev(values) / mu
    except StatisticsError:
        return 1.0


def _is_external_ip(ip: str) -> bool:
    """Returns True if the IP is a public (non-RFC1918 / non-loopback) address."""
    if not ip:
        return False
    return not (
        ip.startswith("10.")
        or ip.startswith("192.168.")
        or ip.startswith("172.")
        or ip.startswith("127.")
        or ip in ("0.0.0.0", "::", "::1")
    )


def _compute_beacon_intervals(timestamps: List[datetime]) -> List[float]:
    """Given a sorted list of connection timestamps, returns inter-arrival intervals in seconds."""
    if len(timestamps) < 2:
        return []
    sorted_ts = sorted(timestamps)
    return [(sorted_ts[i] - sorted_ts[i - 1]).total_seconds() for i in range(1, len(sorted_ts))]


# ---------------------------------------------------------------------------
# RatDetector
# ---------------------------------------------------------------------------

class RatDetector:
    """
    Stateless, testable RAT & covert remote-access detector.

    Receives pre-grouped telemetry dicts and returns a SecurityFinding dict
    (or None if no anomaly is detected above threshold).

    Both `process_events` and `flow_events` follow the common schema used by the
    endpoint agent and network adapter throughout this codebase.
    """

    def __init__(self, score_threshold: int = 55):
        """
        :param score_threshold: Minimum cumulative evidence score to emit a finding.
                                Default 55 is conservative — tune down to catch more.
        """
        self.score_threshold = score_threshold

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(
        self,
        flow_events: List[Dict[str, Any]],
        process_events: Optional[List[Dict[str, Any]]] = None,
        endpoint_id: Optional[str] = None,
        tenant_id: str = "default-tenant",
    ) -> Optional[Dict[str, Any]]:
        """
        Main entry point.  Returns a SecurityFinding dict if RAT activity is
        detected above threshold, otherwise returns None.

        :param flow_events: List of network flow dicts (see network_adapter.go NetworkFlow).
                            Each should contain: source_ip, destination_ip, destination_port,
                            protocol, bytes_out, bytes_in, application (process_name), pid,
                            timestamp (ISO8601 string or datetime), domain (optional).
        :param process_events: Optional list of process telemetry dicts containing:
                               pid, process_name, parent_process_name, command_line, timestamp.
        :param endpoint_id:   UUID of the reporting endpoint (for DB linkage).
        :param tenant_id:     Tenant identifier for multi-tenant isolation.
        """
        if not flow_events:
            return None

        score = 0
        evidence: Dict[str, Any] = {
            "flow_count": len(flow_events),
            "triggers": [],
        }

        # 1. Beacon Interval Analysis
        beacon_score, beacon_ev = self._check_beacon_pattern(flow_events)
        score += beacon_score
        if beacon_ev:
            evidence["beacon"] = beacon_ev
            evidence["triggers"].append("beacon_pattern")

        # 2. Unknown Binary Detection
        ub_score, ub_ev = self._check_unknown_binary(flow_events, process_events or [])
        score += ub_score
        if ub_ev:
            evidence["unknown_binary"] = ub_ev
            evidence["triggers"].append("unknown_binary")

        # 3. GUI-spawning-script-engine Detection
        gs_score, gs_ev = self._check_gui_spawn_script(process_events or [])
        score += gs_score
        if gs_ev:
            evidence["gui_spawn_script"] = gs_ev
            evidence["triggers"].append("gui_spawn_script")

        # 4. Novel Destination / Suspicious Port
        nd_score, nd_ev = self._check_novel_destination(flow_events)
        score += nd_score
        if nd_ev:
            evidence["novel_destination"] = nd_ev
            if "suspicious_port" in nd_ev:
                evidence["triggers"].append("suspicious_port")
            if "novel_external_dest" in nd_ev:
                evidence["triggers"].append("novel_external_dest")

        # 5. C2 Domain Category
        c2_score, c2_ev = self._check_c2_domain(flow_events)
        score += c2_score
        if c2_ev:
            evidence["c2_domain"] = c2_ev
            evidence["triggers"].append("c2_domain")

        evidence["total_score"] = score
        logger.debug(f"[RatDetector] score={score} threshold={self.score_threshold} triggers={evidence['triggers']}")

        if score < self.score_threshold:
            return None

        # Derive primary source IP and recommended action
        source_ip = self._primary_source_ip(flow_events)
        finding = self._build_finding(
            category="rat",
            score=min(score, 100),
            source_ip=source_ip,
            evidence=evidence,
            endpoint_id=endpoint_id,
            tenant_id=tenant_id,
        )

        # Emit to agent event bus for real-time WebSocket relay
        agent_event_bus.emit({
            "type": "SecurityFinding",
            "category": "rat",
            "finding_id": finding["finding_id"],
            "source_ip": source_ip,
            "score": finding["score"],
            "triggers": evidence["triggers"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        logger.warning(
            f"[RatDetector] RAT finding raised: score={score} ip={source_ip} "
            f"triggers={evidence['triggers']}"
        )
        return finding

    # ------------------------------------------------------------------
    # Sub-Checks
    # ------------------------------------------------------------------

    def _check_beacon_pattern(
        self, flows: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        """
        Groups outbound flows by (src_ip, dst_ip, dst_port) and checks each
        group for periodic beacon patterns (low-jitter, regular intervals).
        """
        # Group by (src_ip, dst_ip, dst_port) connection tuple
        groups: Dict[Tuple, List[datetime]] = {}
        for f in flows:
            dst_ip = f.get("destination_ip", "")
            if not _is_external_ip(dst_ip):
                continue
            key = (
                f.get("source_ip", ""),
                dst_ip,
                f.get("destination_port", 0),
            )
            ts_raw = f.get("timestamp")
            if ts_raw is None:
                continue
            ts: datetime
            if isinstance(ts_raw, datetime):
                ts = ts_raw
            else:
                try:
                    ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    continue
            groups.setdefault(key, []).append(ts)

        best_score = 0
        best_evidence = None

        for (src, dst, port), timestamps in groups.items():
            if len(timestamps) < BEACON_MIN_SAMPLES:
                continue

            intervals = _compute_beacon_intervals(timestamps)
            if not intervals:
                continue

            avg_interval = mean(intervals)
            cv = _coefficient_of_variation(intervals)

            if avg_interval > BEACON_MAX_INTERVAL_S:
                continue  # Too slow to be a traditional beacon

            if cv <= BEACON_JITTER_CV_THRESHOLD:
                # High confidence beacon
                ev = {
                    "src_ip": src,
                    "dst_ip": dst,
                    "dst_port": port,
                    "sample_count": len(timestamps),
                    "avg_interval_s": round(avg_interval, 2),
                    "jitter_cv": round(cv, 4),
                    "pattern": "high_confidence_beacon",
                }
                return SCORE_BEACON, ev
            elif cv <= BEACON_JITTER_CV_THRESHOLD * 2:
                # Moderate jitter — still suspicious
                ev = {
                    "src_ip": src,
                    "dst_ip": dst,
                    "dst_port": port,
                    "sample_count": len(timestamps),
                    "avg_interval_s": round(avg_interval, 2),
                    "jitter_cv": round(cv, 4),
                    "pattern": "moderate_jitter_beacon",
                }
                if SCORE_BEACON_HIGH_JITTER > best_score:
                    best_score = SCORE_BEACON_HIGH_JITTER
                    best_evidence = ev

        return best_score, best_evidence

    def _check_unknown_binary(
        self,
        flows: List[Dict[str, Any]],
        proc_events: List[Dict[str, Any]],
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        """
        Detects flows whose originating process name is not in BENIGN_PROCESS_ALLOWLIST
        AND whose connection duration is long-lived (> 60 s).
        """
        score = 0
        evidence = {}

        # Build pid→process_name map from process events
        pid_to_name: Dict[int, str] = {}
        for p in proc_events:
            pid = p.get("pid")
            name = (p.get("process_name") or "").lower()
            if pid and name:
                pid_to_name[int(pid)] = name

        suspicious_binaries = set()
        for f in flows:
            if not _is_external_ip(f.get("destination_ip", "")):
                continue

            proc_name = (
                f.get("process_name")
                or pid_to_name.get(f.get("pid"))
                or f.get("application")
                or ""
            ).lower()

            if not proc_name:
                continue

            if proc_name not in BENIGN_PROCESS_ALLOWLIST:
                suspicious_binaries.add(proc_name)
                score += SCORE_UNKNOWN_BINARY
                evidence["suspicious_process"] = proc_name

            # Long-lived connection bonus
            duration = f.get("flow_duration_ms", 0) or f.get("flow_duration", 0) * 1000
            if duration and float(duration) > 60_000:
                score += SCORE_LONG_LIVED_CONN
                evidence["long_lived_connection_ms"] = duration

        if suspicious_binaries:
            evidence["suspicious_binaries"] = list(suspicious_binaries)

        return score, evidence if evidence else None

    def _check_gui_spawn_script(
        self, proc_events: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        """
        Detects when a known GUI process spawns a script interpreter.
        Classic RAT persistence / dropper pattern.
        """
        for p in proc_events:
            pname = (p.get("process_name") or "").lower()
            parent = (p.get("parent_process_name") or "").lower()
            if pname in SCRIPT_ENGINE_NAMES and parent in GUI_PROCESS_NAMES:
                return SCORE_GUI_SPAWN_SCRIPT, {
                    "parent_process": parent,
                    "child_process": pname,
                    "command_line": p.get("command_line", ""),
                    "pattern": "gui_spawns_script_engine",
                }
        return 0, None

    def _check_novel_destination(
        self, flows: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        """
        Flags external connections to ports in SUSPICIOUS_RAT_PORTS or to IPs
        with tiny byte volume (C2 keepalive pattern).
        """
        score = 0
        evidence: Dict[str, Any] = {}

        for f in flows:
            dst_ip = f.get("destination_ip", "")
            dst_port = int(f.get("destination_port", 0) or 0)
            bytes_total = int(f.get("bytes_out", 0) or 0) + int(f.get("bytes_in", 0) or 0)

            if not _is_external_ip(dst_ip):
                continue

            if dst_port in SUSPICIOUS_RAT_PORTS:
                score += SCORE_SUSPICIOUS_PORT
                evidence["suspicious_port"] = dst_port
                evidence["dst_ip"] = dst_ip

            # Novel destination: external IP, very low byte volume (< 512 bytes) — C2 ping pattern
            if 0 < bytes_total < 512:
                score += SCORE_NOVEL_DEST
                evidence["novel_external_dest"] = dst_ip
                evidence["keepalive_bytes"] = bytes_total

        return score, evidence if evidence else None

    def _check_c2_domain(
        self, flows: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[Dict[str, Any]]]:
        """
        Checks resolved domain categories against known C2 / malware host lists.
        Reuses the classify_domain() heuristic already present in AntigravityTriageAgent.
        """
        # Lazy import to avoid circular dependency
        from Domain.Investigations.AntigravityTriageAgent import classify_domain

        c2_domains = []
        for f in flows:
            domain = f.get("domain") or f.get("dst_hostname") or f.get("dns_domain") or ""
            if not domain:
                continue
            cat = classify_domain(domain)
            if cat in ("known_c2", "malware_host"):
                c2_domains.append({"domain": domain, "category": cat})

        if c2_domains:
            return SCORE_C2_DOMAIN, {"c2_domains": c2_domains}
        return 0, None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _primary_source_ip(self, flows: List[Dict[str, Any]]) -> str:
        """Returns the most frequently occurring source IP in the flow set."""
        counts: Dict[str, int] = {}
        for f in flows:
            ip = f.get("source_ip", "")
            if ip:
                counts[ip] = counts.get(ip, 0) + 1
        return max(counts, key=counts.get) if counts else "unknown"

    def _build_finding(
        self,
        category: str,
        score: int,
        source_ip: str,
        evidence: Dict[str, Any],
        endpoint_id: Optional[str],
        tenant_id: str,
    ) -> Dict[str, Any]:
        """Constructs a standard SecurityFinding dict matching the Postgres schema."""
        action = "isolate_host" if score >= 70 else "none"
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
rat_detector = RatDetector(score_threshold=55)

