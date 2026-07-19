export * from '../../types';

export interface ThreatIntelResult {
  source_ip: string;
  alienvault_otx: any;
  abuse_ch: any;
  misp_correlation: boolean | null;
  overall_risk_score: number | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface Role {
  name: string;
  permissions: string[];
}
