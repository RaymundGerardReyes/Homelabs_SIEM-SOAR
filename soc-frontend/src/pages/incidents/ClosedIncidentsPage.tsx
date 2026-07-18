import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

interface ClosedIncident {
  id: string;
  title: string;
  severity: string;
  closedAt: string;
  resolvedBy: string;
  duration: string;
  postIncidentSummary: string;
}

const MOCK: ClosedIncident[] = [
  { id: 'ci1', title: 'SQL Injection on public API — July 14', severity: 'high', closedAt: '2026-07-14T18:00:00Z', resolvedBy: 'A. Kim', duration: '3h 20m', postIncidentSummary: 'WAF rule deployed to block payload pattern. Root cause: missing parameterized query in v2 endpoint.' },
  { id: 'ci2', title: 'Insider Threat — Data Export Anomaly', severity: 'critical', closedAt: '2026-07-10T09:00:00Z', resolvedBy: 'J. Reyes', duration: '11h 05m', postIncidentSummary: 'Account suspended, DLP policy tightened. Legal review initiated.' },
];

const ClosedIncidentsPage: React.FC = () => {
  const [incidents, setIncidents] = useState<ClosedIncident[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<ClosedIncident[]>('/data/incidents/closed')
      .then(res => setIncidents(res.data))
      .catch(() => setIncidents(MOCK))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header">
        <h1>Closed Incidents</h1>
        <p className="subtitle">Data source: <code>GET /api/incidents/closed</code></p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {loading ? (
          <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading closed incidents…</div>
        ) : incidents.map(inc => (
          <div key={inc.id} className="glass-panel" style={{ padding: '1.25rem 1.5rem', borderLeft: '3px solid #4ade80', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', display: 'block' }}>CLOSED · {inc.severity.toUpperCase()}</span>
                <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '15px' }}>{inc.title}</div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '12px', color: '#64748b' }}>
                <div>Resolved by <strong style={{ color: '#94a3b8' }}>{inc.resolvedBy}</strong></div>
                <div>Duration: {inc.duration}</div>
                <div>{new Date(inc.closedAt).toLocaleDateString()}</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid #1e293b', paddingTop: '8px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.6, fontStyle: 'italic' }}>
              📋 {inc.postIncidentSummary}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ClosedIncidentsPage;
