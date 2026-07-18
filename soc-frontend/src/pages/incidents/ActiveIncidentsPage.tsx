import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

type IncidentStatus = 'investigating' | 'contained' | 'resolving';
type IncidentSeverity = 'critical' | 'high' | 'medium';

interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: string;
  assignedTo: string;
  linkedAlerts: number;
}

const MOCK: Incident[] = [
  { id: 'i1', title: 'Ransomware Campaign — Finance VLAN', severity: 'critical', status: 'investigating', createdAt: '2026-07-17T10:05:00Z', assignedTo: 'J. Reyes', linkedAlerts: 14 },
  { id: 'i2', title: 'Credential Stuffing Attack — Auth Portal', severity: 'high', status: 'contained', createdAt: '2026-07-17T08:30:00Z', assignedTo: 'S. Patel', linkedAlerts: 4 },
];

const SEV_COLOR: Record<IncidentSeverity, string> = { critical: '#ef4444', high: '#f97316', medium: '#fbbf24' };

const ActiveIncidentsPage: React.FC = () => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<Incident[]>('/data/incidents/active')
      .then(res => setIncidents(res.data))
      .catch(() => setIncidents(MOCK))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header">
        <h1>Active Incidents</h1>
        <p className="subtitle">Data source: <code>GET /api/incidents/active</code></p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {loading ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading incidents…</div>
        ) : incidents.length === 0 ? (
          <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
            <div>No active incidents. All clear.</div>
          </div>
        ) : incidents.map(inc => (
          <div key={inc.id} className="glass-panel" style={{ padding: '1.25rem 1.5rem', borderLeft: `3px solid ${SEV_COLOR[inc.severity]}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ color: SEV_COLOR[inc.severity], fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{inc.severity}</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>• {inc.status}</span>
              </div>
              <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '15px' }}>{inc.title}</div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                Assigned: {inc.assignedTo} · {inc.linkedAlerts} linked alerts · Opened {new Date(inc.createdAt).toLocaleString()}
              </div>
            </div>
            <button className="premium-btn" style={{ flexShrink: 0 }} onClick={() => {}}>Open War Room</button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActiveIncidentsPage;
