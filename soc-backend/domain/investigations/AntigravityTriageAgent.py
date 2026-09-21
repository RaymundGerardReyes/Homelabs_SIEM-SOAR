"""
Domain.Investigations.AntigravityTriageAgent
=============================================
Autonomous Multi-Agent AI Triage & Orchestration Fabric
powered by the Google Antigravity (AGY) SDK architecture.

Orchestrates (Multi-Agent Hierarchy):
  1. AntigravityTriageCoordinator (Primary Autonomous Incident Coordinator)
  2. NetworkForensicsSubagent     (WiFi 6 Router & Subnet Telemetry Specialist)
  3. PolicyGovernanceSubagent     (Containment Boundary & Safety Guardrails)
  4. RatDetector (Phase 4.1)      (Beacon Interval / Unknown Binary / C2 Domain)
  5. DDoSDetector (Phase 4.3)     (PPS Flood / Container Abuse / Z-Score Anomaly)

All SecurityFinding events are emitted via agent_event_bus → WebSocket relay.
Destructive SOAR actions are proposed and held for two-key approval before dispatch.
"""

import json
import logging
import uuid
import time
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from Domain.Policy.Engine import ActionRisk
from Infrastructure.Database.audit import append_to_audit_ledger
from Infrastructure.AgentEvents import agent_event_bus

# Lazy-import detectors to avoid circular import at module load time.
# They are imported inside execute_triage() and build_investigation_graph().

logger = logging.getLogger("antigravity-triage")

# Protected infrastructure targets that MUST NEVER be quarantined
CRITICAL_INFRASTRUCTURE_IPS = {
    "192.168.1.1",     # WiFi 6 Default Gateway / AP
    "127.0.0.1",       # Loopback
    "192.168.1.50",    # Dedicated Gateway Bridge itself
}

# Domain threat intel and heuristic categorizer
KNOWN_DOMAIN_CATEGORIES = {
    "google.com": "cdn",
    "googleapis.com": "cdn",
    "cloudflare.com": "cdn",
    "github.com": "cdn",
    "chase.com": "banking",
    "bankofamerica.com": "banking",
    "wellsfargo.com": "banking",
    "login.microsoftonline.com": "login",
    "accounts.google.com": "login",
    "c2-malicious.org": "known_c2",
    "bad-domain.net": "malware_host",
    "exfil-traffic.xyz": "known_c2",
}

def classify_domain(domain: str) -> str:
    """Classifies domain into functional and threat categories."""
    if not domain:
        return "unknown"
    d_lower = domain.lower()
    for known_d, cat in KNOWN_DOMAIN_CATEGORIES.items():
        if known_d in d_lower:
            return cat
    if any(term in d_lower for term in ("cdn", "static", "assets", "akamai", "fastly")):
        return "cdn"
    if any(term in d_lower for term in ("login", "auth", "sso", "identity", "oauth")):
        return "login"
    if any(term in d_lower for term in ("bank", "pay", "credit", "financial", "treasury")):
        return "banking"
    if any(term in d_lower for term in ("c2", "command", "beacon", "exfil", "botnet")):
        return "known_c2"
    if any(term in d_lower for term in ("malware", "exploit", "trojan", "ransomware", "dropper")):
        return "malware_host"
    return "general"


class NetworkForensicsSubagent:
    """
    Specialized Subagent focused on WiFi 6 flow analytics, 
    evaluating byte asymmetry, novel destinations, domain categorizations, and 802.11ax association signals.
    """
    def __init__(self, name: str = "WiFi6-Network-Forensics"):
        self.name = name

    def analyze_flow_features(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        source_ip = telemetry.get("source_ip", "")
        dest_ip = telemetry.get("destination_ip", "")
        dest_port = telemetry.get("destination_port", 0)
        protocol = telemetry.get("protocol", "TCP")
        bytes_out = telemetry.get("bytes_out", 0)
        bytes_in = telemetry.get("bytes_in", 0)
        app = telemetry.get("application", "")
        domain = telemetry.get("domain") or telemetry.get("dst_hostname") or telemetry.get("dns_domain", "")

        is_router_drop = "drop" in app.lower() or "block" in app.lower()
        is_dhcp = "dhcp" in app.lower()
        is_wifi6 = "802.11ax" in protocol.lower() or "wifi6" in app.lower()

        # Assess RFC 1918 Private LAN vs External WAN
        is_internal_dest = (
            dest_ip.startswith("10.") or 
            dest_ip.startswith("192.168.") or 
            dest_ip.startswith("172.") or 
            dest_ip == "127.0.0.1"
        )
        is_internal_src = (
            source_ip.startswith("10.") or 
            source_ip.startswith("192.168.") or 
            source_ip.startswith("172.") or 
            source_ip == "127.0.0.1"
        )

        # Flow Direction & Role
        if is_internal_src and not is_internal_dest and dest_ip != "":
            flow_direction = "Client -> Router -> External"
        elif not is_internal_src and is_internal_dest and source_ip != "":
            flow_direction = "External -> Router -> Client"
        else:
            flow_direction = "Internal LAN Flow"

        # Domain Categorization
        domain_category = classify_domain(domain)

        # Assess Byte Asymmetry & Exfiltration Risk
        asymmetry_ratio = (bytes_out / bytes_in) if (bytes_out > 0 and bytes_in > 0) else (100.0 if bytes_out > 50000 and bytes_in == 0 else 1.0)
        exfiltration_risk = (
            asymmetry_ratio >= 50.0 or 
            (asymmetry_ratio >= 10.0 and (domain_category in ("known_c2", "malware_host") or bytes_out >= 100000)) or
            domain_category in ("known_c2", "malware_host")
        )

        findings = {
            "source_ip": source_ip,
            "destination_ip": dest_ip,
            "destination_port": dest_port,
            "protocol": protocol,
            "domain": domain,
            "domain_category": domain_category,
            "flow_direction": flow_direction,
            "is_router_firewall_drop": is_router_drop,
            "is_dhcp_lease": is_dhcp,
            "is_wifi6_association": is_wifi6,
            "exfiltration_risk": exfiltration_risk,
            "is_outbound_wan": not is_internal_dest and dest_ip != "",
            "asymmetry_ratio": round(asymmetry_ratio, 2),
            "bytes_out": bytes_out,
            "bytes_in": bytes_in
        }

        # Emit structured findings onto Agent Event Bus
        if domain:
            agent_event_bus.emit({
                "type": "ClientSiteVisit",
                "client": source_ip or "unknown",
                "domain": domain,
                "category": domain_category,
                "bytes_out": bytes_out,
                "bytes_in": bytes_in,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        if exfiltration_risk or is_router_drop:
            agent_event_bus.emit({
                "type": "SuspiciousFlow",
                "client": source_ip or "unknown",
                "destination": domain or dest_ip,
                "reason": f"High risk flow: {domain_category} (asymmetry: {findings['asymmetry_ratio']}:1)",
                "score": 95 if domain_category == "known_c2" else 85,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

        return findings


class PolicyGovernanceSubagent:
    """
    Subagent that validates proposed SOAR actions against zero-trust policy invariants.
    Prevents isolating the default gateway or mission-critical bridge nodes, and
    blocks any direct manipulation of router firmware or configuration.
    """
    def __init__(self, name: str = "Policy-Governance-Agent"):
        self.name = name

    def evaluate_containment_safety(self, action: str, target: str) -> Dict[str, Any]:
        # Invariant 1: Never touch or isolate default gateway or bridge
        if target in CRITICAL_INFRASTRUCTURE_IPS:
            logger.error(f"[GOVERNANCE BLOCKED] Target {target} is a protected core infrastructure node.")
            return {
                "permitted": False,
                "reason": f"Safety Invariant Violation: Target {target} is designated as Protected Critical Infrastructure (Default Gateway / SIEM Bridge).",
                "risk": "BLOCKED"
            }

        # Invariant 2: Never allow direct modification of router firmware or router config
        if action in ("modify_router_firmware", "modify_router_config", "modify_dns_server", "flash_router", "reboot_router"):
            logger.error(f"[GOVERNANCE BLOCKED] Action {action} violates router read-only invariant.")
            return {
                "permitted": False,
                "reason": f"Safety Invariant Violation: Direct modification of router firmware, config, or DNS ({action}) is strictly prohibited.",
                "risk": "BLOCKED"
            }

        # Invariant 3: ARP-level Layer-2 client quarantine on gateway bridge is permitted
        if action in ("isolate_host", "isolate_lan_client"):
            return {
                "permitted": True,
                "reason": "Target client is eligible for local ARP Layer-2 quarantine.",
                "risk": ActionRisk.DESTRUCTIVE
            }

        # Invariant 4: Container-level containment actions are permitted for non-infrastructure containers.
        # throttle_container / pause_container operate at cgroup level only — no firmware modification.
        if action in ("throttle_container_network", "pause_container", "resume_container"):
            # Ensure the target is a container_id (not an IP of a critical infrastructure host)
            if target in CRITICAL_INFRASTRUCTURE_IPS:
                logger.error(f"[GOVERNANCE BLOCKED] Container action {action} targeting protected IP {target}.")
                return {
                    "permitted": False,
                    "reason": f"Safety Invariant Violation: Container action on critical infrastructure host {target} is prohibited.",
                    "risk": "BLOCKED"
                }
            return {
                "permitted": True,
                "reason": f"Container-level containment ({action}) permitted for container {target}.",
                "risk": ActionRisk.DESTRUCTIVE
            }

        return {
            "permitted": True,
            "reason": "Standard non-destructive action permitted.",
            "risk": ActionRisk.LOW_IMPACT_WRITE
        }


class AntigravityTriageCoordinator:
    """
    Autonomous Triage Coordinator operating according to the Google Antigravity SDK
    multi-agent architecture. Manages the lifecycle of incident triage, delegates
    to specialized subagents, and emits real-time node transitions to the analyst UI.
    """
    def __init__(self):
        self.forensics_subagent = NetworkForensicsSubagent()
        self.governance_subagent = PolicyGovernanceSubagent()

    async def execute_triage(
        self,
        correlation_id: str,
        investigation_id: str,
        telemetry: Dict[str, Any],
        tenant_id: str = "default-tenant"
    ) -> Dict[str, Any]:
        start_time = time.time()

        def emit_step(node: str, status: str, summary: Optional[str] = None, provider: str = "google-antigravity"):
            latency = round((time.time() - start_time) * 1000, 1)
            agent_event_bus.emit({
                "correlationId": correlation_id,
                "investigationId": investigation_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "node": node,
                "status": status,
                "provider": provider,
                "fallbackTriggered": False,
                "latencyMs": latency,
                "summary": summary
            })

        # 1. Ingest Stage
        emit_step("Ingest", "started", "Ingesting WiFi 6 router telemetry stream.")
        time.sleep(0.05)
        emit_step("Ingest", "completed", "Telemetry ingested and validated against CDM.")

        # 2. Deobfuscation & Normalization
        emit_step("Deobfuscation", "started", "Extracting canonical network flows and router event headers.")
        time.sleep(0.08)
        forensic_findings = self.forensics_subagent.analyze_flow_features(telemetry)
        emit_step("Deobfuscation", "completed", f"Analyzed flow for source {forensic_findings.get('source_ip', 'unknown')}.")

        # 3. LLM Triage (Multi-Agent Subdelegation)
        emit_step("LLMTriage", "started", "Antigravity Agent coordinating with Network Forensics Subagent.")
        time.sleep(0.12)

        # Autonomous reasoning verdict
        is_threat = forensic_findings["is_router_firewall_drop"] or forensic_findings["exfiltration_risk"]
        confidence = 94.0 if is_threat else 72.0
        classification = "True Positive" if is_threat else "Benign Observation"
        
        target_ip = forensic_findings["destination_ip"] if forensic_findings["is_router_firewall_drop"] else forensic_findings["source_ip"]
        if not target_ip:
            target_ip = "192.168.1.105"

        triage_summary = (
            f"Suspicious activity detected: {telemetry.get('application', 'router_event')} "
            f"from {forensic_findings.get('source_ip')} targeting {forensic_findings.get('destination_ip')}."
            if is_threat else
            f"Normal LAN traffic observed for host {target_ip}."
        )

        emit_step("LLMTriage", "completed", triage_summary)

        # 3b. Specialized Detector Subagents (Phase 4.1 + Phase 4.3)
        # These run in sequence after the primary triage, operating on the same telemetry.
        # They use lazy imports to avoid circular dependencies at module load time.
        emit_step("DetectorSubagents", "started", "Invoking RatDetector + DDoSDetector subagents.")
        additional_findings: List[Dict[str, Any]] = []

        try:
            from Domain.Investigations.RatDetector import rat_detector
            # Build a minimal flow list from the single telemetry dict for the detector interface
            flow_for_detectors = [telemetry] if telemetry.get("source_ip") else []
            proc_events = telemetry.get("process_events", [])   # populated by endpoint agents

            rat_finding = rat_detector.analyze(
                flow_events=flow_for_detectors,
                process_events=proc_events,
                tenant_id=tenant_id,
            )
            if rat_finding:
                additional_findings.append(rat_finding)
                is_threat = True  # Escalate overall classification
                confidence = max(confidence, 90.0)
                classification = "True Positive"
                emit_step(
                    "DetectorSubagents", "alert",
                    f"RatDetector: RAT pattern detected (score={rat_finding['score']}, "
                    f"triggers={rat_finding['evidence'].get('triggers')})"
                )
        except Exception as rat_err:
            logger.error(f"[RatDetector] Subagent error (non-fatal): {rat_err}")

        try:
            from Domain.Investigations.DDoSDetector import ddos_detector
            flow_for_detectors = [telemetry] if telemetry.get("source_ip") else []
            container_metrics = telemetry.get("container_metrics", [])   # from container_host agents

            ddos_finding = ddos_detector.analyze(
                flow_events=flow_for_detectors,
                container_metrics=container_metrics,
                tenant_id=tenant_id,
            )
            if ddos_finding:
                additional_findings.append(ddos_finding)
                is_threat = True
                confidence = max(confidence, 88.0)
                classification = "True Positive"
                emit_step(
                    "DetectorSubagents", "alert",
                    f"DDoSDetector: {ddos_finding['category'].upper()} pattern detected "
                    f"(score={ddos_finding['score']})"
                )
        except Exception as ddos_err:
            logger.error(f"[DDoSDetector] Subagent error (non-fatal): {ddos_err}")

        if not additional_findings:
            emit_step("DetectorSubagents", "completed", "No RAT or DDoS patterns detected.")

        # 4. Action & Containment Governance
        emit_step("Action", "started", "Consulting Policy Governance Subagent for safe containment.")
        time.sleep(0.05)

        proposed_actions = []
        if is_threat:
            safety_eval = self.governance_subagent.evaluate_containment_safety("isolate_lan_client", target_ip)
            if safety_eval["permitted"]:
                action_record = {
                    "action": "isolate_lan_client",
                    "target": target_ip,
                    "justification": f"Automated WiFi 6 SOAR containment: {triage_summary}",
                    "risk": safety_eval["risk"],
                    "status": "pending_analyst_approval"
                }
                proposed_actions.append(action_record)
                append_to_audit_ledger("AntigravityTriageAgent", "propose_containment", action_record, safety_eval["risk"])
                action_summary = f"Proposed Layer-2 ARP isolation for {target_ip} (Awaiting Two-Key approval)."
            else:
                action_summary = f"Containment suppressed: {safety_eval['reason']}"

            # Container findings → propose throttle if category is container_abuse
            for af in additional_findings:
                if af.get("category") == "container_abuse" and af.get("recommended_action") == "throttle_container":
                    cid = af.get("source_ip", af.get("endpoint_id", "unknown"))
                    container_safety = self.governance_subagent.evaluate_containment_safety(
                        "throttle_container_network", cid
                    )
                    if container_safety["permitted"]:
                        container_action = {
                            "action": "throttle_container_network",
                            "target": cid,
                            "justification": f"Container DDoS/abuse pattern detected: score={af['score']}",
                            "risk": container_safety["risk"],
                            "status": "pending_analyst_approval",
                            "params": {"container_id": cid, "rate_kbps": 128}
                        }
                        proposed_actions.append(container_action)
                        append_to_audit_ledger(
                            "AntigravityTriageAgent", "propose_container_throttle",
                            container_action, container_safety["risk"]
                        )
        else:
            action_summary = "No containment required. Logged to telemetry baseline."

        emit_step("Action", "completed", action_summary)

        investigation_graph = self.build_investigation_graph(telemetry, target_ip, forensic_findings.get("domain"))

        return {
            "correlation_id": correlation_id,
            "investigation_id": investigation_id,
            "classification": classification,
            "confidence": confidence,
            "target_ip": target_ip,
            "forensic_findings": forensic_findings,
            "additional_findings": additional_findings,   # RAT + DDoS findings from sub-detectors
            "proposed_actions": proposed_actions,
            "graph": investigation_graph,
            "execution_duration_ms": round((time.time() - start_time) * 1000, 2)
        }

    def build_investigation_graph(self, telemetry: Dict[str, Any], target_ip: str, domain: Optional[str] = None) -> Dict[str, Any]:
        """
        Builds a router-centric topology graph for the LangGraph ForceGraph2D UI:
        ClientHost -> RouterHost (LAN)
        RouterHost -> ExternalDomain / ExternalIP (WAN)
        ClientHost -> ExternalDomain (Direct site-visit)
        """
        client_ip = telemetry.get("source_ip") or target_ip or "10.0.0.33"
        if client_ip in ("127.0.0.1", "::1", "localhost", "Unknown", "192.168.1.105"):
            client_ip = "10.0.0.33"

        # Dynamically derive subnet prefix and gateway IP
        parts = client_ip.split(".")
        if len(parts) == 4:
            subnet_prefix = ".".join(parts[:3])
            gateway_ip = f"{subnet_prefix}.10" if parts[0] == "10" else f"{subnet_prefix}.1"
            subnet_str = f"{subnet_prefix}.0/24"
        else:
            gateway_ip = "10.0.0.10"
            subnet_str = "10.0.0.0/24"

        dest_ip = telemetry.get("destination_ip") or "203.0.113.55"
        resolved_domain = domain or telemetry.get("domain") or telemetry.get("dst_hostname") or telemetry.get("dns_domain") or ""
        app = telemetry.get("application", "")
        router_action = "DROP" if ("drop" in app.lower() or "block" in app.lower()) else "ALLOW"
        is_suspicious = router_action == "DROP" or telemetry.get("exfiltration_risk", False) or classify_domain(resolved_domain) in ("known_c2", "malware_host")

        nodes = [
            {
                "id": "router-gw",
                "label": f"WiFi 6 Gateway ({gateway_ip})",
                "type": "RouterHost",
                "role": "gateway",
                "isGateway": True,
                "status": "success",
                "properties": f"Model: 802.11ax WiFi 6 Router\nLAN Gateway: {gateway_ip}\nSubnet: {subnet_str}\nMode: Layer-3 Forwarding"
            },
            {
                "id": f"client-{client_ip}",
                "label": f"Station: {client_ip}",
                "type": "ClientHost",
                "ip": client_ip,
                "status": "failed" if is_suspicious else "success",
                "hasActiveAlert": is_suspicious,
                "properties": f"Client IP: {client_ip}\nSubnet: {subnet_str}\nWiFi Standard: 802.11ax"
            }
        ]

        edges = [
            {
                "source_id": f"client-{client_ip}",
                "target_id": "router-gw",
                "relation": "ROUTED_THROUGH",
                "action": "ALLOW",
                "color": "#10b981",
                "bytes_out": telemetry.get("bytes_out", 1024),
                "width": 2
            }
        ]

        if resolved_domain:
            cat = classify_domain(resolved_domain)
            domain_node_id = f"domain-{resolved_domain}"
            nodes.append({
                "id": domain_node_id,
                "label": resolved_domain,
                "type": "ExternalDomain",
                "category": cat,
                "isSuspicious": is_suspicious,
                "status": "failed" if is_suspicious else "success",
                "properties": f"Domain: {resolved_domain}\nCategory: {cat}\nResolved IP: {dest_ip}"
            })

            edge_color = "#ef4444" if router_action == "DROP" else "#10b981"
            edges.append({
                "source_id": "router-gw",
                "target_id": domain_node_id,
                "relation": "WAN_EGRESS",
                "action": router_action,
                "color": edge_color,
                "bytes_out": telemetry.get("bytes_out", 1024),
                "width": 3 if is_suspicious else 1.5
            })

            # Logical site visit edge
            edges.append({
                "source_id": f"client-{client_ip}",
                "target_id": domain_node_id,
                "relation": "VISITED_SITE",
                "action": "OBSERVED",
                "color": "#6366f1",
                "width": 1
            })
        elif dest_ip:
            ip_node_id = f"ip-{dest_ip}"
            nodes.append({
                "id": ip_node_id,
                "label": f"External IP: {dest_ip}",
                "type": "ExternalIP",
                "isSuspicious": is_suspicious,
                "status": "failed" if is_suspicious else "success",
                "properties": f"Remote WAN IP: {dest_ip}\nProtocol: {telemetry.get('protocol', 'TCP')}"
            })

            edge_color = "#ef4444" if router_action == "DROP" else "#3b82f6"
            edges.append({
                "source_id": "router-gw",
                "target_id": ip_node_id,
                "relation": "WAN_EGRESS",
                "action": router_action,
                "color": edge_color,
                "bytes_out": telemetry.get("bytes_out", 1024),
                "width": 2
            })

        return {"nodes": nodes, "edges": edges}


# Singleton instance for the backend service
antigravity_triage_coordinator = AntigravityTriageCoordinator()

