export interface Alert {
  id: string;
  type: string;
  severity: number;
}

export interface ActionInfo {
  action: string;
  target: string;
  justification: string;
  risk: "READ_ONLY" | "LOW_IMPACT_WRITE" | "HIGH_IMPACT_WRITE" | "DESTRUCTIVE";
}

export interface LogEntry {
  agent: string;
  message: string;
  confidence: number;
}

export interface InvestigationData {
  nodes: any[];
  edges: any[];
  details: {
    conversation_log: LogEntry[];
    proposed_actions: ActionInfo[];
  };
}

export interface Playbook {
  id: string;
  name: string;
  trigger: string;
  code: string;
}
