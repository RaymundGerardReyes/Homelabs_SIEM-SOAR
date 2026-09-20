"""
tests/test_ddos_detector.py
============================
Unit tests for Domain.Investigations.DDoSDetector (Phase 4.3).

Fixtures are fully synthetic — no live endpoints, databases, or network required.
All tests run with:  pytest tests/test_ddos_detector.py -v
"""

import pytest
from datetime import datetime, timezone

from Domain.Investigations.DDoSDetector import (
    DDoSDetector,
    ddos_detector,
    EWMABaseline,
    PPS_HARD_THRESHOLD,
    ZSCORE_THRESHOLD,
    UNIQUE_DST_SCAN_THRESHOLD,
    UNIQUE_DST_EXTREME_THRESHOLD,
    CONTAINER_RESTART_STORM,
    CONTAINER_OOM_THRESHOLD,
    SCORE_PPS_HARD,
    SCORE_ZSCORE_ANOMALY,
    SCORE_UNIQUE_DST_EXTREME,
    SCORE_UNIQUE_DST_SCAN,
    SCORE_CONTAINER_RESTART,
    SCORE_CONTAINER_OOM,
    BASELINE_MIN_SAMPLES,
)


# ---------------------------------------------------------------------------
# Helper Factories
# ---------------------------------------------------------------------------

def _make_flow(
    src="192.168.1.105",
    dst_prefix="203.0.113.",
    dst_suffix=1,
    dst_port=80,
    bytes_out=1024,
    bytes_in=256,
    pps_tx=10.0,
):
    return {
        "source_ip": src,
        "destination_ip": f"{dst_prefix}{dst_suffix}",
        "destination_port": dst_port,
        "bytes_out": bytes_out,
        "bytes_in": bytes_in,
        "pps_tx": pps_tx,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _make_flood_flows(
    count=300,
    src="192.168.1.105",
    pps_per_flow=20.0,
    bytes_out_per_flow=64,
):
    """Creates `count` flows to unique external IPs (simulating a UDP flood)."""
    return [
        _make_flow(
            src=src,
            dst_prefix="198.51.",
            dst_suffix=i % 255,
            pps_tx=pps_per_flow,
            bytes_out=bytes_out_per_flow,
        )
        for i in range(count)
    ]


def _make_container_metric(
    container_id="c_abc123",
    container_name="soc-nginx-proxy",
    lifecycle="running",
    pps_tx=5.0,
    unique_dst_count=10,
    restarts=0,
    ooms=0,
):
    return {
        "container_id": container_id,
        "container_name": container_name,
        "lifecycle_event": lifecycle,
        "pps_tx": pps_tx,
        "unique_dst_count": unique_dst_count,
        "restarts": restarts,
        "ooms": ooms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# EWMABaseline Unit Tests
# ---------------------------------------------------------------------------

class TestEWMABaseline:
    def test_mean_converges(self):
        bl = EWMABaseline(alpha=0.2)
        for _ in range(50):
            bl.update(100.0)
        assert abs(bl.mean - 100.0) < 1.0

    def test_zscore_normal_returns_near_zero(self):
        bl = EWMABaseline()
        for _ in range(20):
            bl.update(50.0)
        assert abs(bl.zscore(50.0)) < 0.5

    def test_zscore_anomaly_exceeds_threshold(self):
        bl = EWMABaseline()
        for _ in range(20):
            bl.update(100.0)
        # A value 10x the mean is clearly anomalous
        z = bl.zscore(1000.0)
        assert z >= ZSCORE_THRESHOLD

    def test_not_reliable_below_min_samples(self):
        bl = EWMABaseline()
        for i in range(BASELINE_MIN_SAMPLES - 1):
            bl.update(float(i))
        assert not bl.is_reliable()

    def test_reliable_at_min_samples(self):
        bl = EWMABaseline()
        for i in range(BASELINE_MIN_SAMPLES):
            bl.update(float(i))
        assert bl.is_reliable()


# ---------------------------------------------------------------------------
# PPS Hard Threshold Tests
# ---------------------------------------------------------------------------

class TestPPSHardThreshold:
    def test_single_host_exceeds_pps_threshold(self):
        detector = DDoSDetector(score_threshold=60)
        flows = [
            _make_flow(src="192.168.1.105", dst_suffix=1, pps_tx=PPS_HARD_THRESHOLD + 500)
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert finding["category"] == "ddos"
        assert "pps_hard_threshold" in finding["evidence"].get("triggers", [])

    def test_below_pps_threshold_no_finding(self):
        detector = DDoSDetector(score_threshold=60)
        flows = [_make_flow(pps_tx=50.0)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is None

    def test_pps_score_meets_minimum(self):
        detector = DDoSDetector(score_threshold=1)
        flows = [_make_flow(pps_tx=PPS_HARD_THRESHOLD + 1)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        assert finding["score"] >= SCORE_PPS_HARD


# ---------------------------------------------------------------------------
# Unique Destination Count Tests
# ---------------------------------------------------------------------------

class TestUniqueDestinationCount:
    def test_scan_threshold_triggers_finding(self):
        detector = DDoSDetector(score_threshold=30)
        # Create flows to UNIQUE_DST_SCAN_THRESHOLD unique IPs
        flows = [
            _make_flow(
                src="192.168.1.200",
                dst_prefix="203.0.",
                dst_suffix=i,
                pps_tx=1.0,
            )
            for i in range(UNIQUE_DST_SCAN_THRESHOLD)
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "unique_dst_scan" in triggers or "unique_dst_extreme" in triggers

    def test_extreme_dst_count_higher_score(self):
        detector = DDoSDetector(score_threshold=1)
        flows = [
            _make_flow(
                src="192.168.1.201",
                dst_prefix="45.",
                dst_suffix=i % 255,
                pps_tx=2.0,
            )
            for i in range(UNIQUE_DST_EXTREME_THRESHOLD)
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "unique_dst_extreme" in triggers
        assert finding["score"] >= SCORE_UNIQUE_DST_EXTREME

    def test_few_destinations_no_scan_flag(self):
        detector = DDoSDetector(score_threshold=60)
        flows = [
            _make_flow(src="192.168.1.101", dst_suffix=i, pps_tx=1.0)
            for i in range(5)
        ]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is None


# ---------------------------------------------------------------------------
# Baseline Z-Score Anomaly Tests
# ---------------------------------------------------------------------------

class TestBaselineZScore:
    def test_zscore_anomaly_triggers_finding(self):
        detector = DDoSDetector(score_threshold=40)
        src = "192.168.1.150"
        # Seed normal baseline with 30 pps
        detector.seed_baseline(src, "pps_tx", [30.0] * 20)
        # Now submit a 10x spike
        flows = [_make_flow(src=src, pps_tx=300.0)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "pps_zscore_anomaly" in triggers

    def test_normal_traffic_within_baseline_no_finding(self):
        detector = DDoSDetector(score_threshold=40)
        src = "192.168.1.151"
        detector.seed_baseline(src, "pps_tx", [50.0] * 20)
        detector.seed_baseline(src, "bytes_out", [10000.0] * 20)
        # Normal observation (within 1 sigma)
        flows = [_make_flow(src=src, pps_tx=50.0, bytes_out=10000)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is None

    def test_byte_burst_zscore_triggers(self):
        detector = DDoSDetector(score_threshold=40)
        src = "192.168.1.152"
        detector.seed_baseline(src, "bytes_out", [1024.0] * 20)
        # 1000x burst
        flows = [_make_flow(src=src, bytes_out=1_000_000, pps_tx=5.0)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "byte_burst_anomaly" in triggers or "byte_burst_hard_multiplier" in triggers


# ---------------------------------------------------------------------------
# Container Metrics Tests
# ---------------------------------------------------------------------------

class TestContainerMetrics:
    def test_container_restart_storm_triggers_abuse(self):
        detector = DDoSDetector(score_threshold=30)
        metrics = [
            _make_container_metric(
                container_id="container_abc",
                lifecycle="restart",
                pps_tx=5.0,
            )
            for _ in range(CONTAINER_RESTART_STORM)
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        assert finding["category"] == "container_abuse"
        assert "container_restart_storm" in finding["evidence"].get("triggers", [])
        assert finding["recommended_action"] == "throttle_container"

    def test_container_oom_triggers_abuse(self):
        detector = DDoSDetector(score_threshold=30)
        metrics = [
            _make_container_metric(container_id="container_oom", lifecycle="oom")
            for _ in range(CONTAINER_OOM_THRESHOLD)
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        assert finding["category"] == "container_abuse"
        assert "container_oom_kill" in finding["evidence"].get("triggers", [])

    def test_healthy_container_no_finding(self):
        detector = DDoSDetector(score_threshold=60)
        metrics = [
            _make_container_metric(
                container_id="container_healthy",
                lifecycle="running",
                pps_tx=5.0,
                unique_dst_count=3,
            )
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is None

    def test_container_unique_dst_scan(self):
        detector = DDoSDetector(score_threshold=30)
        metrics = [
            _make_container_metric(
                container_id="container_scan",
                pps_tx=100.0,
                unique_dst_count=UNIQUE_DST_SCAN_THRESHOLD + 10,
            )
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "container_unique_dst_scan" in triggers

    def test_container_pps_flood(self):
        detector = DDoSDetector(score_threshold=60)
        metrics = [
            _make_container_metric(
                container_id="container_flood",
                pps_tx=PPS_HARD_THRESHOLD + 1000,
                unique_dst_count=5,
            )
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        triggers = finding["evidence"].get("triggers", [])
        assert "container_pps_flood" in triggers


# ---------------------------------------------------------------------------
# Combined Flow + Container Tests
# ---------------------------------------------------------------------------

class TestCombinedFlowAndContainer:
    def test_combined_host_ddos_plus_container_abuse(self):
        """When both host flows and container metrics fire, score accumulates."""
        detector = DDoSDetector(score_threshold=60)
        # Host DDoS flows
        flows = [_make_flow(src="192.168.1.100", pps_tx=PPS_HARD_THRESHOLD + 100)]
        # Container abuse
        metrics = [
            _make_container_metric(lifecycle="restart")
            for _ in range(CONTAINER_RESTART_STORM)
        ]
        finding = detector.analyze(flows, container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        assert finding["score"] >= SCORE_PPS_HARD  # at minimum the PPS score


# ---------------------------------------------------------------------------
# Governance: Recommended Action
# ---------------------------------------------------------------------------

class TestRecommendedAction:
    def test_high_score_ddos_recommends_isolate_lan_client(self):
        detector = DDoSDetector(score_threshold=60)
        flows = [_make_flow(src="192.168.1.120", pps_tx=PPS_HARD_THRESHOLD + 1000)]
        finding = detector.analyze(flows, tenant_id="test-tenant")
        assert finding is not None
        if finding["score"] >= 70:
            assert finding["recommended_action"] == "isolate_lan_client"

    def test_container_abuse_always_recommends_throttle(self):
        detector = DDoSDetector(score_threshold=30)
        metrics = [
            _make_container_metric(lifecycle="restart")
            for _ in range(CONTAINER_RESTART_STORM)
        ]
        finding = detector.analyze([], container_metrics=metrics, tenant_id="test-tenant")
        assert finding is not None
        assert finding["recommended_action"] == "throttle_container"


# ---------------------------------------------------------------------------
# Module singleton
# ---------------------------------------------------------------------------

def test_module_singleton_is_ddos_detector_instance():
    assert isinstance(ddos_detector, DDoSDetector)

