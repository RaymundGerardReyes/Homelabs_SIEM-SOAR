import pytest
import asyncio
from Domain.Investigations.AntigravityTriageAgent import antigravity_triage_coordinator, CRITICAL_INFRASTRUCTURE_IPS

@pytest.mark.asyncio
async def test_antigravity_triage_coordinator_firewall_drop():
    telemetry = {
        "source_ip": "203.0.113.55",
        "destination_ip": "192.168.1.105",
        "destination_port": 80,
        "protocol": "TCP",
        "application": "router_firewall_drop",
        "bytes_out": 64,
        "bytes_in": 0
    }
    
    result = await antigravity_triage_coordinator.execute_triage(
        correlation_id="test-corr-1",
        investigation_id="inv-test-1",
        telemetry=telemetry
    )
    
    assert result["classification"] == "True Positive"
    assert result["confidence"] >= 90.0
    assert result["target_ip"] == "192.168.1.105"
    assert len(result["proposed_actions"]) > 0
    assert result["proposed_actions"][0]["action"] == "isolate_lan_client"
    assert result["proposed_actions"][0]["target"] == "192.168.1.105"

@pytest.mark.asyncio
async def test_antigravity_governance_protects_gateway():
    # Attempting to isolate the WiFi 6 default gateway (192.168.1.1) must be BLOCKED
    safety = antigravity_triage_coordinator.governance_subagent.evaluate_containment_safety(
        "isolate_lan_client", "192.168.1.1"
    )
    assert safety["permitted"] is False
    assert safety["risk"] == "BLOCKED"
    assert "Safety Invariant Violation" in safety["reason"]

@pytest.mark.asyncio
async def test_antigravity_triage_coordinator_benign_dhcp():
    telemetry = {
        "source_ip": "192.168.1.1",
        "destination_ip": "192.168.1.105",
        "destination_port": 68,
        "protocol": "UDP",
        "application": "dhcp_lease",
        "bytes_out": 512,
        "bytes_in": 512
    }
    
    result = await antigravity_triage_coordinator.execute_triage(
        correlation_id="test-corr-2",
        investigation_id="inv-test-2",
        telemetry=telemetry
    )
    
    assert result["classification"] == "Benign Observation"
    assert len(result["proposed_actions"]) == 0

@pytest.mark.asyncio
async def test_antigravity_site_visit_classification():
    forensics = antigravity_triage_coordinator.forensics_subagent

    # Test C2 domain
    f1 = forensics.analyze_flow_features({
        "source_ip": "192.168.1.105",
        "destination_ip": "203.0.113.55",
        "domain": "c2-malicious.org",
        "bytes_out": 2048,
        "bytes_in": 512
    })
    assert f1["domain_category"] == "known_c2"
    assert f1["flow_direction"] == "Client -> Router -> External"

    # Test Banking domain
    f2 = forensics.analyze_flow_features({
        "source_ip": "192.168.1.105",
        "destination_ip": "171.161.148.150",
        "domain": "chase.com",
        "bytes_out": 4096,
        "bytes_in": 16384
    })
    assert f2["domain_category"] == "banking"
    assert f2["exfiltration_risk"] is False

@pytest.mark.asyncio
async def test_antigravity_suspicious_exfiltration_detection():
    # Massive byte asymmetry out to WAN
    telemetry = {
        "source_ip": "192.168.1.105",
        "destination_ip": "198.51.100.99",
        "domain": "exfil-traffic.xyz",
        "bytes_out": 5000000,
        "bytes_in": 1000,
        "application": "https_upload"
    }

    result = await antigravity_triage_coordinator.execute_triage(
        correlation_id="test-corr-exfil",
        investigation_id="inv-test-exfil",
        telemetry=telemetry
    )

    assert result["classification"] == "True Positive"
    assert result["forensic_findings"]["exfiltration_risk"] is True
    assert result["forensic_findings"]["asymmetry_ratio"] >= 50.0
    assert len(result["proposed_actions"]) > 0
    assert result["proposed_actions"][0]["action"] == "isolate_lan_client"

@pytest.mark.asyncio
async def test_antigravity_governance_blocks_firmware_modification():
    gov = antigravity_triage_coordinator.governance_subagent

    # Attempting to tamper with router firmware or config
    s1 = gov.evaluate_containment_safety("modify_router_firmware", "192.168.1.1")
    assert s1["permitted"] is False
    assert s1["risk"] == "BLOCKED"

    s2 = gov.evaluate_containment_safety("modify_dns_server", "192.168.1.1")
    assert s2["permitted"] is False
    assert s2["risk"] == "BLOCKED"

@pytest.mark.asyncio
async def test_antigravity_investigation_graph_topology():
    telemetry = {
        "source_ip": "192.168.1.105",
        "destination_ip": "203.0.113.55",
        "domain": "c2-malicious.org",
        "application": "router_firewall_drop",
        "bytes_out": 128
    }

    graph = antigravity_triage_coordinator.build_investigation_graph(telemetry, "192.168.1.105", "c2-malicious.org")

    node_types = {n["type"] for n in graph["nodes"]}
    assert "RouterHost" in node_types
    assert "ClientHost" in node_types
    assert "ExternalDomain" in node_types

    edge_relations = {e["relation"] for e in graph["edges"]}
    assert "ROUTED_THROUGH" in edge_relations
    assert "WAN_EGRESS" in edge_relations
    assert "VISITED_SITE" in edge_relations

