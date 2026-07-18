// =============================================================================
// src/shared/config/eventMeta.ts
// Shared lookup maps for event/health/severity display metadata.
// Centralized here so EdrLogsPage, HostManagementPage, ThreatFeedsPage,
// VulnerabilitiesPage, and AlertRulesPage all read from one source.
// =============================================================================

// ─── EDR Event Types (used by EdrLogsPage) ───────────────────────────────────
export type EventType =
  | 'process_exec'
  | 'file_modification'
  | 'registry_change'
  | 'network_connection';

export const EVENT_META: Record<EventType, { label: string; color: string; icon: string }> = {
  process_exec:       { label: 'Process Exec',  color: '#a78bfa', icon: '⚙' },
  file_modification:  { label: 'File Mod',       color: '#fbbf24', icon: '📝' },
  registry_change:    { label: 'Registry',       color: '#fb923c', icon: '🔧' },
  network_connection: { label: 'Network Conn',   color: '#38bdf8', icon: '🌐' },
};

// ─── EDR Agent/Host Health (used by HostManagementPage) ──────────────────────
export type AgentHealth = 'healthy' | 'stale' | 'outdated' | 'offline';

export const HEALTH_META: Record<AgentHealth, { color: string; bg: string; label: string; icon: string }> = {
  healthy:  { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  label: 'Healthy',  icon: '✔' },
  outdated: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', label: 'Outdated', icon: '⬆' },
  stale:    { color: '#fb923c', bg: 'rgba(249,115,22,0.1)', label: 'Stale',    icon: '⏱' },
  offline:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Offline',  icon: '✖' },
};

// ─── Threat Feed Health (used by ThreatFeedsPage) ────────────────────────────
export type FeedHealth = 'healthy' | 'degraded' | 'down';

export const FEED_HEALTH_META: Record<FeedHealth, { color: string; bg: string; dot: string }> = {
  healthy:  { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  dot: '#4ade80' },
  degraded: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', dot: '#fbbf24' },
  down:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  dot: '#ef4444' },
};

// ─── Vulnerability Severity (used by VulnerabilitiesPage) ────────────────────
export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low';

export const SEV_META: Record<VulnSeverity, { color: string; bg: string }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  high:     { color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
  medium:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  low:      { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
};

// ─── Patch Status (used by VulnerabilitiesPage) ───────────────────────────────
export type PatchStatus = 'unpatched' | 'in_progress' | 'patched' | 'accepted_risk';

export const PATCH_META: Record<PatchStatus, { color: string; label: string }> = {
  unpatched:     { color: '#ef4444', label: 'Unpatched' },
  in_progress:   { color: '#fbbf24', label: 'In Progress' },
  patched:       { color: '#4ade80', label: 'Patched' },
  accepted_risk: { color: '#94a3b8', label: 'Risk Accepted' },
};

// ─── Detection Rule Severity (used by AlertRulesPage) ────────────────────────
export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

export const SEV_COLOR: Record<RuleSeverity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#fbbf24',
  low:      '#4ade80',
};
