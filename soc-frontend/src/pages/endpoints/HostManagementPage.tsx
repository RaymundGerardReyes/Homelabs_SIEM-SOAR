import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type AgentHealth = 'healthy' | 'stale' | 'outdated' | 'offline';

interface ManagedHost {
  id: string;
  hostname: string;
  os: string;
  agentVersion: string;
  latestVersion: string;
  health: AgentHealth;
  lastCheckIn: string;
}

const MOCK_HOSTS: ManagedHost[] = [
  { id: 'h1', hostname: 'WIN-DC-01',   os: 'Windows Server 2022', agentVersion: '3.4.1', latestVersion: '3.4.1', health: 'healthy', lastCheckIn: new Date(Date.now() - 120000).toISOString() },
  { id: 'h2', hostname: 'WIN-WS-14',   os: 'Windows 11',          agentVersion: '3.3.9', latestVersion: '3.4.1', health: 'outdated', lastCheckIn: new Date(Date.now() - 600000).toISOString() },
  { id: 'h3', hostname: 'WIN-FIN-03',  os: 'Windows 10',          agentVersion: '3.4.1', latestVersion: '3.4.1', health: 'offline',  lastCheckIn: new Date(Date.now() - 3700000).toISOString() },
  { id: 'h4', hostname: 'LINUX-WEB-01',os: 'Ubuntu 22.04 LTS',    agentVersion: '3.4.1', latestVersion: '3.4.1', health: 'stale',    lastCheckIn: new Date(Date.now() - 90000000).toISOString() },
  { id: 'h5', hostname: 'WIN-WEB-02',  os: 'Windows Server 2019', agentVersion: '3.4.1', latestVersion: '3.4.1', health: 'healthy',  lastCheckIn: new Date(Date.now() - 60000).toISOString() },
];

const HEALTH_META: Record<AgentHealth, { color: string; bg: string; label: string; icon: string }> = {
  healthy:  { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  label: 'Healthy',  icon: '✔' },
  outdated: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', label: 'Outdated', icon: '⬆' },
  stale:    { color: '#fb923c', bg: 'rgba(249,115,22,0.1)', label: 'Stale',    icon: '⏱' },
  offline:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Offline',  icon: '✖' },
};

function timeSince(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

const HostManagementPage: React.FC = () => {
  const navigate = useNavigate();
  const [hosts, setHosts] = useState<ManagedHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [osFilter, setOsFilter] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<ManagedHost[]>('/data/endpoints/hosts')
      .then(res => setHosts(res.data))
      .catch(() => setHosts(MOCK_HOSTS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const triggerUpdate = async (host: ManagedHost) => {
    if (!window.confirm(`Trigger agent update/restart on ${host.hostname}?`)) return;
    setUpdatingId(host.id);
    try {
      await apiClient.post(`/data/endpoints/${host.id}/agent-update`);
      setHosts(prev => prev.map(h => h.id === host.id ? { ...h, health: 'healthy', agentVersion: h.latestVersion } : h));
    } catch {
      alert('Update trigger failed — backend not yet wired.');
    } finally {
      setUpdatingId(null);
    }
  };

  const osList = [...new Set(hosts.map(h => h.os))];

  const filtered = hosts.filter(h => {
    const matchSearch = h.hostname.toLowerCase().includes(searchQuery.toLowerCase());
    const matchOs = osFilter === 'all' || h.os === osFilter;
    const matchHealth = healthFilter === 'all' || h.health === healthFilter;
    return matchSearch && matchOs && matchHealth;
  });

  const staleOrOffline = hosts.filter(h => h.health === 'stale' || h.health === 'offline' || h.health === 'outdated').length;

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header">
        <h1>Host Management</h1>
        <p className="subtitle">Data source: <code>GET /api/endpoints/hosts</code></p>
      </div>

      {staleOrOffline > 0 && (
        <div style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid #fbbf24', borderRadius: '8px', padding: '0.75rem 1.25rem', fontSize: '13px', color: '#fbbf24', display: 'flex', gap: '10px', alignItems: 'center' }}>
          ⚠ <strong>{staleOrOffline} host{staleOrOffline > 1 ? 's' : ''}</strong> require attention (outdated agent, stale check-in, or offline).
        </div>
      )}

      {/* Filters */}
      <div className="glass-panel" style={{ display: 'flex', gap: '1rem', padding: '1rem', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search by hostname…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }} />
        <select value={osFilter} onChange={e => setOsFilter(e.target.value)}
          style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }}>
          <option value="all">All OS</option>
          {osList.map(os => <option key={os} value={os}>{os}</option>)}
        </select>
        <select value={healthFilter} onChange={e => setHealthFilter(e.target.value)}
          style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }}>
          <option value="all">All Health States</option>
          <option value="healthy">Healthy</option>
          <option value="outdated">Outdated</option>
          <option value="stale">Stale</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {/* Host table */}
      <div className="glass-panel" style={{ overflowX: 'auto' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading hosts…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Hostname', 'OS', 'Agent Version', 'Health', 'Last Check-in', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(host => {
                const meta = HEALTH_META[host.health];
                const needsUpdate = host.agentVersion !== host.latestVersion;
                return (
                  <tr key={host.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#e2e8f0' }}>{host.hostname}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#94a3b8' }}>{host.os}</td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px' }}>
                      <span style={{ color: needsUpdate ? '#fbbf24' : '#94a3b8' }}>v{host.agentVersion}</span>
                      {needsUpdate && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#64748b' }}>→ v{host.latestVersion}</span>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: meta.color, background: meta.bg }}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: host.health === 'offline' || host.health === 'stale' ? '#ef4444' : '#94a3b8' }}>
                      {timeSince(host.lastCheckIn)}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {(host.health === 'outdated' || needsUpdate) && (
                          <button
                            onClick={() => triggerUpdate(host)}
                            disabled={updatingId === host.id}
                            style={{ padding: '4px 10px', border: '1px solid #fbbf24', background: 'transparent', color: '#fbbf24', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                            {updatingId === host.id ? '…' : '⬆ Update Agent'}
                          </button>
                        )}
                        <button
                          onClick={() => navigate('/endpoints/edr')}
                          style={{ padding: '4px 10px', border: '1px solid #334155', background: 'transparent', color: '#38bdf8', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                          EDR Logs
                        </button>
                        <button
                          onClick={() => navigate('/endpoints/isolation')}
                          style={{ padding: '4px 10px', border: '1px solid #334155', background: 'transparent', color: '#94a3b8', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                          Isolation
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hosts match current filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default HostManagementPage;
