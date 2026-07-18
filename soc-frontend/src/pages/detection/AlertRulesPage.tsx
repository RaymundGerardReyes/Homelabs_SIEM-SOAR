import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

interface DetectionRule {
  id: string;
  name: string;
  severity: RuleSeverity;
  enabled: boolean;
  lastTriggered: string | null;
  isAutoResponse: boolean;
  description: string;
}

const MOCK_RULES: DetectionRule[] = [
  { id: 'r1', name: 'Brute Force Login Detection', severity: 'high', enabled: true,  lastTriggered: '2026-07-17T10:21:00Z', isAutoResponse: false, description: 'Fires after 5 failed logins in 60s from same IP.' },
  { id: 'r2', name: 'C2 Beacon via DNS TXT', severity: 'critical', enabled: true, lastTriggered: '2026-07-16T22:00:00Z', isAutoResponse: true, description: 'Detects exfil via DNS TXT record tunneling.' },
  { id: 'r3', name: 'Mimikatz LSASS Memory Read', severity: 'critical', enabled: true, lastTriggered: null, isAutoResponse: true, description: 'Detects credential dump via process access patterns.' },
  { id: 'r4', name: 'Lateral Movement via SMB', severity: 'high', enabled: false, lastTriggered: '2026-07-14T03:00:00Z', isAutoResponse: false, description: 'Unusual SMB share access across hosts.' },
  { id: 'r5', name: 'Suspicious PowerShell Execution', severity: 'medium', enabled: true, lastTriggered: '2026-07-17T08:45:00Z', isAutoResponse: false, description: 'Encoded command or network-fetching PowerShell.' },
  { id: 'r6', name: 'Large Data Exfiltration Alert', severity: 'critical', enabled: true, lastTriggered: null, isAutoResponse: true, description: 'Outbound transfer >500MB in a single session.' },
];

const SEV_COLOR: Record<RuleSeverity, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#fbbf24', low: '#4ade80',
};

const AlertRulesPage: React.FC = () => {
  const [rules, setRules] = useState<DetectionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<DetectionRule | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sevFilter, setSevFilter] = useState<string>('all');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient.get<DetectionRule[]>('/data/detection/rules')
      .then(res => setRules(res.data))
      .catch(() => {
        setError('Failed to load detection rules. Using cached data.');
        setRules(MOCK_RULES);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleRule = async (rule: DetectionRule) => {
    // High-impact auto-response rules require confirmation before disabling
    if (rule.enabled && rule.isAutoResponse) {
      setConfirmDisable(rule);
      return;
    }
    await applyToggle(rule);
  };

  const applyToggle = async (rule: DetectionRule) => {
    setTogglingId(rule.id);
    setConfirmDisable(null);
    const newState = !rule.enabled;
    // Optimistic update
    setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: newState } : r));
    try {
      await apiClient.patch(`/data/detection/rules/${rule.id}`, { enabled: newState });
    } catch {
      // Rollback on failure
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !newState } : r));
    } finally {
      setTogglingId(null);
    }
  };

  const filtered = rules.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchSev = sevFilter === 'all' || r.severity === sevFilter;
    return matchSearch && matchSev;
  });

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header">
        <h1>Alert Rules</h1>
        <p className="subtitle">Data source: <code>GET /api/detection/rules</code> · <code>PATCH /api/detection/rules/{'{id}'}</code></p>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ display: 'flex', gap: '1rem', padding: '1rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search rules..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }}
        />
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)}
          style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }}>
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Rules table */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading rules…</div>
      ) : error ? (
        <div className="glass-panel" style={{ padding: '1.5rem', borderLeft: '3px solid #ef4444' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
          <button className="premium-btn" onClick={fetchData} style={{ marginTop: '1rem' }}>↻ Retry</button>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Rule Name', 'Severity', 'Auto-Response', 'Last Triggered', 'Status', 'Toggle'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(rule => (
                <tr key={rule.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '14px' }}>{rule.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{rule.description}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ color: SEV_COLOR[rule.severity], fontWeight: 700, fontSize: '12px', textTransform: 'uppercase' }}>
                      {rule.severity}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    {rule.isAutoResponse ? <span style={{ color: '#fbbf24' }}>⚡ YES</span> : <span style={{ color: '#64748b' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                    {rule.lastTriggered ? new Date(rule.lastTriggered).toLocaleString() : 'Never'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                      background: rule.enabled ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
                      color: rule.enabled ? '#4ade80' : '#ef4444' }}>
                      {rule.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => toggleRule(rule)}
                      disabled={togglingId === rule.id}
                      style={{
                        padding: '5px 12px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer',
                        border: '1px solid #334155', background: 'transparent',
                        color: rule.enabled ? '#f87171' : '#4ade80',
                        opacity: togglingId === rule.id ? 0.5 : 1,
                      }}>
                      {togglingId === rule.id ? '…' : rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No rules match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* High-impact disable confirmation modal */}
      {confirmDisable && (
        <div className="modal-overlay glass-overlay fadeIn" role="dialog" onClick={e => { if (e.target === e.currentTarget) setConfirmDisable(null); }}>
          <div className="modal-content popIn" style={{ padding: '2rem', maxWidth: '480px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>⚡</div>
            <h3 style={{ color: '#fbbf24', marginBottom: '0.75rem' }}>Auto-Response Rule Disable</h3>
            <p style={{ color: '#94a3b8', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              <strong style={{ color: '#e2e8f0' }}>{confirmDisable.name}</strong> is an active auto-response rule.
              Disabling it will stop automated containment for this threat category.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button className="btn-secondary" onClick={() => setConfirmDisable(null)}>Cancel</button>
              <button
                style={{ padding: '10px 24px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}
                onClick={() => applyToggle(confirmDisable)}>
                Disable Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertRulesPage;
