// =============================================================================
// src/types/index.ts — SINGLE SOURCE OF TRUTH for all domain interfaces.
// All page-level types must be declared here, not inline in page files.
// Import from here; never re-declare elsewhere.
// =============================================================================

// ─── Core Platform Types ──────────────────────────────────────────────────────

export interface Alert {
  id: string;
  type: string;
  severity: number;
}

export interface ActionInfo {
  action: string;
  target: string;
  justification: string;
  risk: 'READ_ONLY' | 'LOW_IMPACT_WRITE' | 'HIGH_IMPACT_WRITE' | 'DESTRUCTIVE';
}

export interface LogEntry {
  agent: string;
  message: string;
  confidence: number;
}

export interface InvestigationData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Primary threat actor IP returned by the backend investigation engine */
  source_ip?: string;
  details: {
    conversation_log: LogEntry[];
    proposed_actions: ActionInfo[];
  };
}

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
  properties?: string;
  status: 'success' | 'running' | 'failed';
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  relation: string;
}

export interface Playbook {
  id: string;
  name: string;
  trigger: string;
  code: string;
}

/** SystemMetrics — canonical definition. Do NOT re-declare in hooks/useSystemMetrics.ts */
export interface SystemMetrics {
  alertsScanned: number;
  eventsIngestGB24h: number;
  dataIngestTB24h: number;
  openIncidents: number;
  preventedEvents: number;
}

export interface NotificationItem {
  id: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  read: boolean;
}

export interface AnalystIdentity {
  email: string;
  name: string;
  role: string;
  avatar_url?: string;
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'disconnected';

// ─── Asset Domain ─────────────────────────────────────────────────────────────

export type AssetType = 'server' | 'workstation' | 'network_device' | 'cloud_resource';
export type AssetCriticality = 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Untiered';

export interface Asset {
  id: string;
  hostname: string;
  ipAddress: string;
  type: AssetType;
  owner: string;
  criticality: AssetCriticality;
  lastSeen: string;
}

export interface NetworkMapNode {
  id: string;
  label: string;
  type: string;
  hasActiveAlert: boolean;
  x: number;
  y: number;
  subnet: string;
}

export interface NetworkMapEdge {
  source: string;
  target: string;
}

// ─── Vulnerability Domain ─────────────────────────────────────────────────────

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low';
export type PatchStatus = 'unpatched' | 'in_progress' | 'patched' | 'accepted_risk';

export interface Vulnerability {
  id: string;
  cveId: string;
  affectedAsset: string;
  affectedAssetId: string;
  cvssScore: number;
  severity: VulnSeverity;
  patchStatus: PatchStatus;
  discoveredAt: string;
  description: string;
}

// ─── Detection Domain ─────────────────────────────────────────────────────────

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DetectionRule {
  id: string;
  name: string;
  severity: RuleSeverity;
  enabled: boolean;
  lastTriggered: string | null;
  isAutoResponse: boolean;
  description: string;
}

export type FeedHealth = 'healthy' | 'degraded' | 'down';
export type FeedType = 'STIX/TAXII' | 'AlienVault OTX' | 'Abuse.ch' | 'MISP' | 'Custom API';

export interface ThreatFeed {
  id: string;
  name: string;
  type: FeedType;
  health: FeedHealth;
  lastSync: string;
  iocVolume7d: number[];
  authFailed?: boolean;
}

export interface IocResult {
  ioc: string;
  type: string;
  verdict: 'malicious' | 'suspicious' | 'clean' | 'unknown';
  sourceFeed: string;
  confidence: number;
  lastSeen: string;
}

// ─── Endpoint Domain ──────────────────────────────────────────────────────────

export type AgentHealth = 'healthy' | 'stale' | 'outdated' | 'offline';
export type EventType =
  | 'process_exec'
  | 'file_modification'
  | 'registry_change'
  | 'network_connection';

export interface ManagedHost {
  id: string;
  hostname: string;
  os: string;
  agentVersion: string;
  latestVersion: string;
  health: AgentHealth;
  lastCheckIn: string;
}

export interface AuditEntry {
  action: 'isolated' | 'released';
  by: string;
  at: string;
  justification: string;
}

export interface EndpointHost {
  id: string;
  hostname: string;
  ipAddress: string;
  isIsolated: boolean;
  isolatedAt?: string;
  isolatedBy?: string;
  auditTrail: AuditEntry[];
}

export interface EdrLogEntry {
  id: string;
  host: string;
  eventType: EventType;
  timestamp: string;
  process: string;
  detail: string;
  rawJson: Record<string, unknown>;
  isSuspicious: boolean;
}

// ─── Incident Domain ──────────────────────────────────────────────────────────

export interface Incident {
  id: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
  assignedTo: string;
  linkedAlerts: number;
}

export interface ClosedIncident {
  id: string;
  title: string;
  severity: string;
  closedAt: string;
  resolvedBy: string;
  duration: string;
  postIncidentSummary: string;
}

// ─── Dashboard Domain ─────────────────────────────────────────────────────────

export interface KPIData {
  totalIncidents: number;
  mttd_minutes: number;
  mttr_minutes: number;
  criticalOpenCount: number;
  resolvedThisMonth: number;
  riskTrend: { date: string; score: number }[];
  topThreats: { category: string; count: number }[];
}

export interface ComplianceControl {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'warning';
  lastChecked: string;
  notes?: string;
}

export interface ComplianceFramework {
  id: string;
  framework: string;
  score: number;
  status: 'compliant' | 'warning' | 'non_compliant';
  controls: ComplianceControl[];
}

// ─── Marketplace Domain ───────────────────────────────────────────────────────

export interface MarketplaceListing {
  id: string;
  name: string;
  publisher: string;
  category: string;
  status: 'installed' | 'not_installed' | 'update_available';
  requiresElevated: boolean;
  tags: string[];
  description: string;
}

