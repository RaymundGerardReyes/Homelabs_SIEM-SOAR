import { Alert, Playbook, InvestigationData } from '../types';

export const mockAlerts: Alert[] = [
  { id: 'alert-172102001', type: 'Brute_Force_Attack', severity: 3 },
  { id: 'alert-172102002', type: 'Impossible_Travel', severity: 2 },
  { id: 'alert-172102003', type: 'Ransomware_Behavior', severity: 4 },
  { id: 'alert-172102004', type: 'Suspicious_Powershell', severity: 3 },
];

export const mockPlaybooks: Playbook[] = [
  {
    id: "pb-1",
    name: "Auto-Isolate Malware",
    trigger: "Malware_Detected",
    code: "def run(alert):\n    soc_sdk.isolate_host(alert.entities[0])\n    return 'Success'"
  },
  {
    id: "pb-2",
    name: "Enrich IP Address",
    trigger: "New_IP_Seen",
    code: "def run(alert):\n    data = soc_sdk.query_threat_intel(alert.source_ip)\n    return data"
  },
  {
    id: "pb-3",
    name: "Block Malicious Domain",
    trigger: "Domain_C2_Activity",
    code: "def run(alert):\n    soc_sdk.block_domain_firewall(alert.domain)\n    soc_sdk.notify_slack('C2 Domain Blocked')\n    return 'Success'"
  }
];

export const getMockInvestigation = (alert: Alert): InvestigationData => {
  return {
    nodes: [],
    edges: [],
    details: {
      conversation_log: [
        { agent: "TriageAgent", message: `Assessed alert severity as ${alert.severity}. Classification: True Positive`, confidence: 85.0 },
        { agent: "TriageAgent", message: "Found anomalies in source IP geo-location.", confidence: 65.0 },
        { agent: "ResponseProposer", message: "Generated proposed actions for containment.", confidence: 95.0 }
      ],
      proposed_actions: [
        { action: "Tag Alert", target: alert.id, justification: "Marked as confirmed by AI", risk: "LOW_IMPACT_WRITE" },
        { action: "Block IP", target: "198.51.100.42", justification: "Brute force source identified", risk: "HIGH_IMPACT_WRITE" },
        { action: "Isolate Host", target: "target_server_01", justification: "Prevent lateral movement", risk: "DESTRUCTIVE" }
      ]
    }
  };
};
