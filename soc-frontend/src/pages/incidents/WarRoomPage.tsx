import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
type IncidentSeverity = 'critical' | 'major';

interface TimelineEntry {
  id: string;
  author: string;
  authorType: 'agent' | 'human';
  message: string;
  timestamp: string;
}

interface MajorIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: 'active' | 'contained' | 'resolving';
  declaredAt: string;
  assignedResponders: string[];
  timeline: TimelineEntry[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_INCIDENTS: MajorIncident[] = [
  {
    id: 'inc-001',
    title: 'Active Ransomware Campaign — Finance VLAN',
    severity: 'critical',
    status: 'active',
    declaredAt: '2026-07-17T10:05:00Z',
    assignedResponders: ['J. Reyes', 'A. Kim', 'M. Torres'],
    timeline: [
      { id: 't1', author: 'TriageAgent', authorType: 'agent', message: 'Correlated 14 alerts to a single ransomware campaign. Stage: Pre-encryption.', timestamp: '2026-07-17T10:05:00Z' },
      { id: 't2', author: 'J. Reyes', authorType: 'human', message: 'Confirmed C2 traffic to 198.51.100.42. Initiating isolation of WIN-FIN-03 and WIN-FIN-07.', timestamp: '2026-07-17T10:12:00Z' },
      { id: 't3', author: 'ResponseAgent', authorType: 'agent', message: 'Isolation playbook executed. Hosts removed from production VLAN.', timestamp: '2026-07-17T10:13:00Z' },
    ],
  },
  {
    id: 'inc-002',
    title: 'Credential Stuffing Attack — Auth Portal',
    severity: 'major',
    status: 'contained',
    declaredAt: '2026-07-17T08:30:00Z',
    assignedResponders: ['S. Patel'],
    timeline: [
      { id: 't4', author: 'TriageAgent', authorType: 'agent', message: 'Detected 4,200 failed logins in 3 minutes from 18 distinct IPs.', timestamp: '2026-07-17T08:30:00Z' },
      { id: 't5', author: 'S. Patel', authorType: 'human', message: 'Geo-blocked source IP ranges. Enforced CAPTCHA on login portal.', timestamp: '2026-07-17T08:45:00Z' },
    ],
  },
];

const SEV_COLORS: Record<IncidentSeverity, { color: string; bg: string; border: string }> = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: '#ef4444' },
  major:    { color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: '#f97316' },
};

function elapsedLabel(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const WarRoomPage: React.FC = () => {
  const [incidents, setIncidents] = useState<MajorIncident[]>(MOCK_INCIDENTS);
  const [selectedId, setSelectedId] = useState<string>(MOCK_INCIDENTS[0].id);
  const [newMessage, setNewMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const selected = incidents.find(i => i.id === selectedId)!;

  // Scroll to bottom of timeline when it updates
  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected?.timeline?.length]);

  const postUpdate = useCallback(async () => {
    if (!newMessage.trim() || !selected) return;
    setPosting(true);
    const entry: TimelineEntry = {
      id: `t-${Date.now()}`,
      author: 'Principal Analyst',
      authorType: 'human',
      message: newMessage.trim(),
      timestamp: new Date().toISOString(),
    };
    // Optimistic update
    setIncidents(prev => prev.map(inc =>
      inc.id === selected.id ? { ...inc, timeline: [...inc.timeline, entry] } : inc
    ));
    setNewMessage('');
    setPosting(false);
  }, [newMessage, selected]);

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', gap: '1.5rem', height: '100%' }}>
      {/* Incident List */}
      <div style={{ width: '340px', display: 'flex', flexDirection: 'column', gap: '1rem', flexShrink: 0 }}>
        <div className="header">
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>War Room</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <span style={{ fontSize: '11px', color: '#ef4444', fontFamily: 'monospace' }}>LIVE</span>
          </div>
        </div>
        {incidents.map(inc => {
          const meta = SEV_COLORS[inc.severity];
          return (
            <div
              key={inc.id}
              onClick={() => setSelectedId(inc.id)}
              className="glass-panel"
              style={{
                padding: '1rem', cursor: 'pointer', borderLeft: `3px solid ${meta.border}`,
                background: selectedId === inc.id ? meta.bg : undefined,
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: meta.color, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
                  {inc.severity}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                  T+{elapsedLabel(inc.declaredAt)}
                </span>
              </div>
              <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '14px', lineHeight: 1.4 }}>{inc.title}</div>
              <div style={{ marginTop: '6px', fontSize: '12px', color: '#94a3b8' }}>
                {inc.assignedResponders.join(', ')}
              </div>
              <span style={{
                marginTop: '8px', display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '10px',
                background: inc.status === 'active' ? 'rgba(239,68,68,0.15)' : 'rgba(74,222,128,0.15)',
                color: inc.status === 'active' ? '#f87171' : '#4ade80', fontWeight: 700, textTransform: 'uppercase',
              }}>
                {inc.status}
              </span>
            </div>
          );
        })}
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
        <div className="glass-panel" style={{ padding: '1.25rem', borderBottom: '1px solid #334155' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{selected.title}</h2>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            Declared: {new Date(selected.declaredAt).toLocaleString()} · Responders: {selected.assignedResponders.join(', ')}
          </div>
        </div>

        <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {selected.timeline.map(entry => (
            <div key={entry.id} style={{
              display: 'flex', gap: '12px',
              borderLeft: `3px solid ${entry.authorType === 'agent' ? '#38bdf8' : '#a78bfa'}`,
              paddingLeft: '12px',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: entry.authorType === 'agent' ? '#38bdf8' : '#a78bfa' }}>
                    {entry.author}
                  </span>
                  <span style={{ fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '2px', background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>
                    {entry.authorType === 'agent' ? 'AI AGENT' : 'HUMAN'}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#e2e8f0', lineHeight: 1.6 }}>{entry.message}</div>
              </div>
            </div>
          ))}
          <div ref={timelineEndRef} />
        </div>

        {/* Post human update */}
        <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '0.75rem' }}>
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postUpdate(); } }}
            placeholder="Post a status update… (Enter to submit)"
            style={{ flex: 1, padding: '8px 12px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px' }}
          />
          <button
            className="premium-btn"
            onClick={postUpdate}
            disabled={posting || !newMessage.trim()}
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
};

export default WarRoomPage;
