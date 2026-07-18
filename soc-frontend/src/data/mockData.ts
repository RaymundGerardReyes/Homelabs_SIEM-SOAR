/**
 * mockData.ts — Development & Testing Fixtures
 * ─────────────────────────────────────────────
 * Used by Vitest unit tests and Storybook stories.
 * Do NOT import this in production component code — all live data
 * is fetched from the FastAPI backend via apiClient.
 */

import type { Alert, Playbook, InvestigationData, NotificationItem, SystemMetrics } from '../types';

// ─── Alerts ──────────────────────────────────────────────────────────────────

export const MOCK_ALERTS: Alert[] = [
  { id: 'ALT-001', type: 'LATERAL_MOVEMENT_DETECTED',    severity: 1 },
  { id: 'ALT-002', type: 'RANSOMWARE_SIGNATURE_MATCH',   severity: 1 },
  { id: 'ALT-003', type: 'CREDENTIAL_STUFFING_ATTEMPT',  severity: 2 },
  { id: 'ALT-004', type: 'C2_BEACON_DETECTED',           severity: 1 },
  { id: 'ALT-005', type: 'DATA_EXFILTRATION_SUSPECTED',  severity: 2 },
  { id: 'ALT-006', type: 'PRIVILEGE_ESCALATION',         severity: 3 },
];

// ─── System Metrics ───────────────────────────────────────────────────────────

export const MOCK_METRICS: SystemMetrics = {
  alertsScanned:      1_482_390,
  eventsIngestGB24h:  847.3,
  dataIngestTB24h:    2.14,
  openIncidents:      23,
  preventedEvents:    9_412,
};

// ─── Notifications ────────────────────────────────────────────────────────────

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  {
    id:        'NOTIF-001',
    message:   'Critical: Ransomware signature match on endpoint WIN-DC-01.',
    severity:  'critical',
    timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    read:      false,
  },
  {
    id:        'NOTIF-002',
    message:   'Warning: Unusual outbound traffic spike detected on VLAN-42.',
    severity:  'warning',
    timestamp: new Date(Date.now() - 18 * 60_000).toISOString(),
    read:      false,
  },
  {
    id:        'NOTIF-003',
    message:   'Info: Playbook "Isolate Host" completed successfully.',
    severity:  'info',
    timestamp: new Date(Date.now() - 45 * 60_000).toISOString(),
    read:      true,
  },
];

// ─── Playbooks ────────────────────────────────────────────────────────────────

export const MOCK_PLAYBOOKS: Playbook[] = [
  {
    id:      'PB-001',
    name:    'Isolate Compromised Host',
    trigger: 'LATERAL_MOVEMENT_DETECTED | RANSOMWARE_SIGNATURE_MATCH',
    code:    `#!/usr/bin/env python3
"""
Playbook: Isolate Compromised Host
Risk Level: DESTRUCTIVE
Author: SOC Automation Engine v2
"""
import soar_sdk

def run(target: str, justification: str) -> dict:
    print(f"[ISOLATE] Acquiring EDR handle for: {target}")
    edr = soar_sdk.get_edr_client()

    print(f"[ISOLATE] Quarantining network interfaces on {target}...")
    edr.isolate_host(hostname=target, reason=justification)

    print(f"[ISOLATE] Snapshotting volatile memory...")
    snapshot_id = edr.capture_memory(hostname=target)

    print(f"[ISOLATE] Creating incident ticket...")
    ticket = soar_sdk.create_incident(
        title=f"Host Isolation: {target}",
        severity="CRITICAL",
        evidence={"snapshot_id": snapshot_id},
    )

    return {"status": "isolated", "ticket_id": ticket.id, "snapshot": snapshot_id}
`,
  },
  {
    id:      'PB-002',
    name:    'Block Malicious IP via Firewall',
    trigger: 'C2_BEACON_DETECTED | DATA_EXFILTRATION_SUSPECTED',
    code:    `#!/usr/bin/env python3
"""
Playbook: Block Malicious IP
Risk Level: HIGH_IMPACT_WRITE
Author: SOC Automation Engine v2
"""
import soar_sdk

def run(target: str, justification: str) -> dict:
    print(f"[BLOCK] Resolving firewall policy for IP: {target}")
    fw = soar_sdk.get_firewall_client(zone="perimeter")

    print(f"[BLOCK] Inserting DROP rule at top of INPUT chain for {target}...")
    rule_id = fw.add_block_rule(
        ip=target,
        direction="both",
        reason=justification,
        ttl_hours=24,
    )

    print(f"[BLOCK] Pushing rule to all edge nodes via Ansible...")
    soar_sdk.ansible_push(playbook="enforce_fw_rules.yml", vars={"rule_id": rule_id})

    return {"status": "blocked", "rule_id": rule_id, "ttl_hours": 24}
`,
  },
  {
    id:      'PB-003',
    name:    'Rotate Compromised Credentials',
    trigger: 'CREDENTIAL_STUFFING_ATTEMPT | PRIVILEGE_ESCALATION',
    code:    `#!/usr/bin/env python3
"""
Playbook: Rotate Compromised Credentials
Risk Level: HIGH_IMPACT_WRITE
Author: SOC Automation Engine v2
"""
import soar_sdk

def run(target: str, justification: str) -> dict:
    print(f"[ROTATE] Identifying all active sessions for account: {target}")
    idp = soar_sdk.get_idp_client()

    sessions = idp.get_active_sessions(username=target)
    print(f"[ROTATE] Terminating {len(sessions)} active sessions...")
    idp.revoke_all_sessions(username=target)

    print(f"[ROTATE] Generating temporary credentials and dispatching via secure channel...")
    temp_pw = idp.force_password_reset(username=target, notify=True)

    print(f"[ROTATE] Enabling MFA enforcement on next login...")
    idp.enforce_mfa(username=target)

    return {"status": "rotated", "sessions_revoked": len(sessions), "mfa_enforced": True}
`,
  },
];

// ─── Investigation Data ───────────────────────────────────────────────────────

export const MOCK_INVESTIGATION: InvestigationData = {
  source_ip: '185.220.101.47',
  nodes: [
    { id: 'node-triage',    label: 'Triage Agent',         type: 'agent',    status: 'success' },
    { id: 'node-hunt',      label: 'Threat Hunter',        type: 'agent',    status: 'success' },
    { id: 'node-forensic',  label: 'Forensic Analyzer',    type: 'agent',    status: 'running' },
    { id: 'node-response',  label: 'Response Planner',     type: 'agent',    status: 'running' },
    { id: 'node-enrich',    label: 'IOC Enrichment',       type: 'service',  status: 'success' },
  ],
  edges: [
    { source_id: 'node-triage',   target_id: 'node-hunt',     relation: 'delegates_to'   },
    { source_id: 'node-triage',   target_id: 'node-enrich',   relation: 'queries'        },
    { source_id: 'node-hunt',     target_id: 'node-forensic', relation: 'escalates_to'   },
    { source_id: 'node-forensic', target_id: 'node-response', relation: 'informs'        },
  ],
  details: {
    conversation_log: [
      {
        agent:      'Triage Agent',
        message:    'Alert ALT-004 classified as HIGH severity C2 beacon. Source IP 185.220.101.47 correlates with known Cobalt Strike infrastructure (OTX pulse count: 47). Delegating to Threat Hunter.',
        confidence: 94,
      },
      {
        agent:      'Threat Hunter',
        message:    'Lateral movement path confirmed: WIN-WS-14 → WIN-DC-01 via SMB (port 445). Timeline: 03:12–03:47 UTC. Three additional endpoints show beacon intervals. Escalating to Forensic Analyzer.',
        confidence: 88,
      },
      {
        agent:      'Forensic Analyzer',
        message:    'Analyzing process tree on WIN-DC-01. Suspicious parent: lsass.exe → cmd.exe → powershell.exe -enc <base64>. Memory artifact extraction in progress. Confidence limited pending full dump.',
        confidence: 61,
      },
      {
        agent:      'Response Planner',
        message:    'Recommended actions: (1) Immediate host isolation for WIN-DC-01, (2) Block 185.220.101.47 at perimeter firewall, (3) Rotate credentials for domain admin accounts detected in memory artifact.',
        confidence: 91,
      },
    ],
    proposed_actions: [
      {
        action:        'isolate_host',
        target:        'WIN-DC-01',
        justification: 'Active C2 beacon and lateral movement confirmed. Isolation prevents further spread.',
        risk:          'DESTRUCTIVE',
      },
      {
        action:        'block_ip',
        target:        '185.220.101.47',
        justification: 'Known Cobalt Strike C2 server. Block all traffic at perimeter.',
        risk:          'HIGH_IMPACT_WRITE',
      },
      {
        action:        'rotate_credentials',
        target:        'svc-domain-admin',
        justification: 'Credential artifact found in WIN-DC-01 memory dump. Rotation is precautionary.',
        risk:          'LOW_IMPACT_WRITE',
      },
    ],
  },
};
