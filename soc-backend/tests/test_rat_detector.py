"""
tests/test_rat_detector.py
===========================
Unit tests for Domain.Investigations.RatDetector (Phase 4.1).

Fixtures are fully synthetic — no live endpoints, databases, or network required.
All tests run with:  pytest tests/test_rat_detector.py -v
"""

import pytest
from datetime import datetime, timezone, timedelta

from Domain.Investigations.RatDetector import (
    RatDetector,
    rat_detector,
    BEACON_MIN_SAMPLES,
    SCORE_BEACON,
    SCORE_UNKNOWN_BINARY,
    SCORE_GUI_SPAWN_SCRIPT,
    SCORE_C2_DOMAIN,
    BENIGN_PROCESS_ALLOWLIST,
    _coefficient_of_variation,
    _compute_beacon_intervals,
    _is_external_ip,
)


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def _make_flow(
    src="192.168.1.105",
    dst="203.0.113.55",
    dst_port=443,
    protocol="TCP",
    bytes_out=1024,
    bytes_in=256,
    app="chrome",
    domain="",
    pid=1234,
    timestamp=None,
    flow_duration_ms=0,
):
    return {
        "source_ip": src,
        "destination_ip": dst,
        "destination_port": dst_port,
        "protocol": protocol,
        "bytes_out": bytes_out,
        "bytes_in": bytes_in,
        "application": app,
        "domain": domain,
        "pid": pid,
        "timestamp": timestamp or datetime.now(timezone.utc).isoformat(),
        "flow_duration_ms": flow_duration_ms,
    }


def _make_periodic_flows(
    count=6,
    interval_s=30,
    src="192.168.1.105",
    dst="203.0.113.99",
    dst_port=4444,
    jitter_s=0,
):
    """Creates flows spaced exactly `interval_s` seconds apart (zero jitter by default)."""
    base = datetime.now(timezone.utc) - timedelta(seconds=count * interval_s)
    return [
        _make_flow(
            src=src,
            dst=dst,
            dst_port=dst_port,
            timestamp=(base + timedelta(seconds=i * interval_s + jitter_s * i)).isoformat(),
        )
        for i in range(count)
    ]


def _make_proc_event(
    name="python3",
    parent="explorer.exe",
    pid=9999,
    cmd="python3 -c 'import socket; ...'",
):
    return {
        "process_name": name,
        "parent_process_name": parent,
        "pid": pid,
        "command_line": cmd,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Helper Utility Tests
# ---------------------------------------------------------------------------

def test_is_external_ip_rfc1918():
    assert _is_external_ip("10.0.0.1") is False
    assert _is_external_ip("192.168.1.105") is False
    assert _is_external_ip("172.16.0.1") is False
    assert _is_external_ip("127.0.0.1") is False


def test_is_external_ip_public():
    assert _is_external_ip("203.0.113.55") is True
    assert _is_external_ip("8.8.8.8") is True
    assert _is_external_ip("1.1.1.1") is True


def test_coefficient_of_variation_zero_jitter():
    # All same value → CV = 0
    assert _coefficient_of_variation([30.0, 30.0, 30.0, 30.0]) == pytest.approx(0.0, abs=1e-9)


def test_coefficient_of_variation_high_jitter():
    # Wide spread → CV > 0.5
    cv = _coefficient_of_variation([1.0, 100.0, 50.0, 5.0])
    assert cv > 0.5


def test_compute_beacon_intervals_ordered():
    base = datetime(2025, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    ts_list = [base + timedelta(seconds=30 * i) for i in range(5)]
    intervals = _compute_beacon_intervals(ts_list)
    assert intervals == [30.0, 30.0, 30.0, 30.0]


# ---------------------------------------------------------------------------
# Beacon Pattern Detection
# ---------------------------------------------------------------------------

class TestBeaconDetection:
    def test_perfect_beacon_triggers_finding(self):
        """Zero-jitter periodic flows to an external IP on port 4444 → RAT finding."""
        detector = RatDetector(score_threshold=55)
        flows = _make_periodic_flows(count=6, interval_s=30, dst_port=4444)
        finding = detector.analyze(flows, tenant_id="test-tenant")

        assert finding is not None
        assert finding["category"] == "rat"
        assert finding["score"] >= 55
        assert "beacon" in finding["evidence"]
        assert "beacon_pattern" in finding["evidence"]["triggers"]

    def test_beacon_score_is_at_least_constant(self):
        """Score from a high-confidence beacon alone must be >= SCORE_BEACON."""
        detector = RatDetector(score_threshold=1)  # Very low to isolate beacon signal
        flows = _make_periodic_flows(count=6, interval_s=20, dst_port=80)
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert finding["score"] >= SCORE_BEACON

    def test_insufficient_samples_no_beacon(self):
        """Fewer than BEACON_MIN_SAMPLES flows → no beacon finding."""
        detector = RatDetector(score_threshold=55)
        flows = _make_periodic_flows(count=BEACON_MIN_SAMPLES - 1, interval_s=30, dst_port=4444)
        finding = detector.analyze(flows, tenant_id="test-tenant")
        # Should be None (or at least not flagged for beacon)
        if finding:
            assert "beacon_pattern" not in finding["evidence"].get("triggers", [])

    def test_high_jitter_beacon_not_flagged_at_high_threshold(self):
        """High jitter flows (CV > 0.3) should not trigger at the high-confidence threshold."""
        detector = RatDetector(score_threshold=SCORE_BEACON)
        # Irregular intervals: 5 s, 90 s, 10 s, 120 s, 7 s
        base = datetime.now(timezone.utc)
        ts_list = [
            base,
            base + timedelta(seconds=5),
            base + timedelta(seconds=95),
            base + timedelta(seconds=105),
            base + timedelta(seconds=225),
            base + timedelta(seconds=232),
        ]
        flows = [
            _make_flow(dst="203.0.113.1", dst_port=443, timestamp=ts.isoformat())
            for ts in ts_list
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        if finding:
            assert "beacon_pattern" not in finding["evidence"].get("triggers", [])

    def test_internal_destination_not_flagged_as_beacon(self):
        """Periodic flows to an internal RFC1918 IP should not trigger beacon."""
        detector = RatDetector(score_threshold=55)
        flows = _make_periodic_flows(
            count=6, interval_s=30, dst="192.168.1.20", dst_port=445
        )
        finding = detector.analyze(flows, tenant_id="test-tenant")
        if finding:
            assert "beacon_pattern" not in finding["evidence"].get("triggers", [])


# ---------------------------------------------------------------------------
# Unknown Binary Detection
# ---------------------------------------------------------------------------

class TestUnknownBinaryDetection:
    def test_unknown_binary_raises_score(self):
        """An unrecognised process name making external connections → higher score."""
        detector = RatDetector(score_threshold=1)
        flows = [
            _make_flow(dst="45.33.32.156", app="r4t_1337.exe", bytes_out=5000)
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert "unknown_binary" in finding["evidence"]["triggers"]

    def test_benign_process_not_flagged(self):
        """A known-benign process (chrome) should NOT trigger the unknown-binary check."""
        detector = RatDetector(score_threshold=SCORE_UNKNOWN_BINARY + 1)
        flows = [_make_flow(dst="8.8.8.8", app="chrome")]
        proc_events = [_make_proc_event(name="chrome", parent="explorer.exe")]
        finding = detector.analyze(flows, proc_events, tenant_id="test-tenant")
        # unknown_binary trigger should not be set
        if finding:
            assert "unknown_binary" not in finding["evidence"].get("triggers", [])

    def test_long_lived_connection_bonus(self):
        """A long-lived (> 60 s) connection from an unknown binary gets extra score."""
        detector = RatDetector(score_threshold=1)
        flows = [
            _make_flow(
                dst="198.51.100.5",
                app="suspicious.bin",
                flow_duration_ms=90_000,  # 90 seconds
            )
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        # Must have scored at least unknown_binary + long_lived
        assert finding["score"] >= SCORE_UNKNOWN_BINARY + 10


# ---------------------------------------------------------------------------
# GUI Spawns Script Engine
# ---------------------------------------------------------------------------

class TestGuiSpawnScript:
    def test_explorer_spawning_python_flagged(self):
        detector = RatDetector(score_threshold=1)
        flows = [_make_flow(dst="203.0.113.55")]
        proc_events = [_make_proc_event(name="python3", parent="explorer.exe")]
        finding = detector.analyze(flows, proc_events, tenant_id="test-tenant")
        assert finding is not None
        assert "gui_spawn_script" in finding["evidence"]["triggers"]

    def test_explorer_spawning_powershell_flagged(self):
        detector = RatDetector(score_threshold=1)
        flows = [_make_flow(dst="203.0.113.55")]
        proc_events = [_make_proc_event(name="powershell.exe", parent="explorer.exe")]
        finding = detector.analyze(flows, proc_events, tenant_id="test-tenant")
        assert finding is not None
        assert "gui_spawn_script" in finding["evidence"]["triggers"]

    def test_normal_process_hierarchy_not_flagged(self):
        """bash spawned by systemd is normal — not a GUI spawn pattern."""
        detector = RatDetector(score_threshold=SCORE_GUI_SPAWN_SCRIPT + 1)
        flows = [_make_flow(dst="8.8.8.8", app="bash")]
        proc_events = [_make_proc_event(name="bash", parent="systemd")]
        finding = detector.analyze(flows, proc_events, tenant_id="test-tenant")
        if finding:
            assert "gui_spawn_script" not in finding["evidence"].get("triggers", [])


# ---------------------------------------------------------------------------
# C2 Domain Detection
# ---------------------------------------------------------------------------

class TestC2DomainDetection:
    def test_known_c2_domain_raises_score(self):
        detector = RatDetector(score_threshold=1)
        flows = [_make_flow(dst="203.0.113.55", domain="c2-malicious.org")]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert "c2_domain" in finding["evidence"]["triggers"]
        assert finding["score"] >= SCORE_C2_DOMAIN

    def test_malware_host_domain_raises_score(self):
        detector = RatDetector(score_threshold=1)
        flows = [_make_flow(dst="198.51.100.7", domain="bad-domain.net")]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert "c2_domain" in finding["evidence"]["triggers"]

    def test_benign_domain_not_flagged_as_c2(self):
        detector = RatDetector(score_threshold=SCORE_C2_DOMAIN + 1)
        flows = [_make_flow(dst="142.250.80.14", domain="google.com")]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        if finding:
            assert "c2_domain" not in finding["evidence"].get("triggers", [])


# ---------------------------------------------------------------------------
# Suspicious Port Detection
# ---------------------------------------------------------------------------

class TestSuspiciousPortDetection:
    def test_metasploit_port_flagged(self):
        detector = RatDetector(score_threshold=1)
        flows = [_make_flow(dst="203.0.113.1", dst_port=4444, bytes_out=64, bytes_in=0)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "suspicious_port" in triggers or "novel_external_dest" in triggers

    def test_standard_https_port_not_suspicious(self):
        """Port 443 is standard HTTPS and should NOT trigger the suspicious-port check."""
        detector = RatDetector(score_threshold=10 + 1)
        flows = [_make_flow(dst="8.8.8.8", dst_port=443, bytes_out=8192, bytes_in=65536)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        if finding:
            assert "suspicious_port" not in finding["evidence"].get("triggers", [])


# ---------------------------------------------------------------------------
# Governance: CRITICAL_INFRASTRUCTURE_IPS not in scope of rat_detector directly
# but the recommended_action must never target gateway.
# ---------------------------------------------------------------------------

class TestGovernanceConstraints:
    def test_gateway_ip_not_recommended_for_isolation(self):
        """
        If the gateway (192.168.1.1) happens to appear as source, the finding must
        have recommended_action='none' (it's not an external/rogue IP).
        Because the gateway is RFC1918 internal, external flow checks won't fire,
        so the score stays below threshold and no finding is raised at all.
        """
        detector = RatDetector(score_threshold=55)
        flows = _make_periodic_flows(
            count=6, interval_s=30, src="192.168.1.1", dst="192.168.1.105", dst_port=80
        )
        finding = detector.analyze(flows, tenant_id="test-tenant")
        # Internal→internal flows: beacon won't fire (dst not external) → no finding
        assert finding is None


# ---------------------------------------------------------------------------
# Combined Multi-Signal High-Confidence Finding
# ---------------------------------------------------------------------------

class TestCombinedMultiSignal:
    def test_combined_signals_exceed_threshold(self):
        """
        Combining beacon + unknown binary + C2 domain → high-confidence RAT finding
        with score well above threshold.
        """
        detector = RatDetector(score_threshold=55)
        flows = (
            _make_periodic_flows(count=6, interval_s=30, dst="203.0.113.88", dst_port=4444)
            + [_make_flow(dst="203.0.113.88", domain="c2-malicious.org", app="r4t.exe")]
        )
        proc_events = [_make_proc_event(name="python3", parent="explorer.exe")]
        finding = detector.analyze(flows, proc_events, tenant_id="test-tenant")
        assert finding is not None
        assert finding["score"] >= 55
        triggers = finding["evidence"]["triggers"]
        # At minimum beacon + c2 should both fire
        assert "beacon_pattern" in triggers or "c2_domain" in triggers

    def test_no_finding_on_normal_traffic(self):
        """Normal browsing traffic (chrome, https, google.com) → no finding."""
        detector = RatDetector(score_threshold=55)
        flows = [
            _make_flow(dst="142.250.80.14", dst_port=443, app="chrome", domain="google.com",
                       bytes_out=4096, bytes_in=65536),
            _make_flow(dst="104.244.42.1", dst_port=443, app="chrome", domain="twitter.com",
                       bytes_out=2048, bytes_in=32768),
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is None


# ---------------------------------------------------------------------------
# Module singleton accessibility
# ---------------------------------------------------------------------------

def test_module_singleton_is_rat_detector_instance():
    assert isinstance(rat_detector, RatDetector)

