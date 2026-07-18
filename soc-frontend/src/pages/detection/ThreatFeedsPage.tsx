import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type FeedHealth = 'healthy' | 'degraded' | 'down';
type FeedType = 'STIX/TAXII' | 'AlienVault OTX' | 'Abuse.ch' | 'MISP' | 'Custom API';

interface ThreatFeed {
  id: string;
  name: string;
  type: FeedType;
  health: FeedHealth;
  lastSync: string;
  iocVolume7d: number[];
  authFailed?: boolean;
}

const MOCK_FEEDS: ThreatFeed[] = [
  { id: 'f1', name: 'AlienVault OTX',  type: 'AlienVault OTX', health: 'healthy',  lastSync: '2026-07-17T13:00:00Z', iocVolume7d: [1200,1050,980,1100,1300,900,1150] },
  { id: 'f2', name: 'Abuse.ch Feodo',  type: 'Abuse.ch',       health: 'healthy',  lastSync: '2026-07-17T12:30:00Z', iocVolume7d: [420,410,390,450,440,380,430] },
  { id: 'f3', name: 'Internal MISP',   type: 'MISP',           health: 'degraded', lastSync: '2026-07-16T10:00:00Z', iocVolume7d: [80,75,82,90,88,0,12] },
  { id: 'f4', name: 'CISA Known Exploited Vulns', type: 'Custom API', health: 'healthy', lastSync: '2026-07-17T11:00:00Z', iocVolume7d: [30,28,35,29,32,30,31] },
  { id: 'f5', name: 'Custom STIX Feed (Partner)', type: 'STIX/TAXII', health: 'down', lastSync: '2026-07-15T08:00:00Z', iocVolume7d: [500,480,510,0,0,0,0], authFailed: true },
];

const HEALTH_META: Record<FeedHealth, { color: string; bg: string; dot: string }> = {
  healthy:  { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  dot: '#4ade80' },
  degraded: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)', dot: '#fbbf24' },
  down:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  dot: '#ef4444' },
};

const MiniSparkline: React.FC<{ data: number[] }> = ({ data }) => {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '32px', padding: '2px 0' }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, background: v === 0 ? '#374151' : '#38bdf8',
          height: `${(v / max) * 100}%`, minHeight: v > 0 ? '3px' : '0', borderRadius: '1px', opacity: 0.8,
        }} />
      ))}
    </div>
  );
};

const ThreatFeedsPage: React.FC = () => {
  const [feeds, setFeeds] = useState<ThreatFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<ThreatFeed[]>('/data/detection/feeds')
      .then(res => setFeeds(res.data))
      .catch(() => setFeeds(MOCK_FEEDS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const triggerSync = async (feed: ThreatFeed) => {
    setSyncingId(feed.id);
    try {
      await apiClient.post(`/data/detection/feeds/${feed.id}/sync`);
      // Optimistically update lastSync
      setFeeds(prev => prev.map(f => f.id === feed.id ? { ...f, lastSync: new Date().toISOString(), health: 'healthy' } : f));
    } catch {
      // no-op: feed stays in current state
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Threat Feeds</h1>
          <p className="subtitle">Data source: <code>GET /api/detection/feeds</code> · <code>POST /api/detection/feeds/{'{id}'}/sync</code></p>
        </div>
        <button className="premium-btn" onClick={() => alert('Add Feed form — integration pending')}>+ Add Feed</button>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading feeds…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {feeds.map(feed => {
            const meta = HEALTH_META[feed.health];
            const isSyncing = syncingId === feed.id;
            return (
              <div key={feed.id} className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                {/* Status dot */}
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: meta.dot, flexShrink: 0, boxShadow: `0 0 6px ${meta.dot}` }} />

                {/* Name & type */}
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '15px' }}>{feed.name}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{feed.type}</div>
                </div>

                {/* Health badge */}
                <span style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: meta.color, background: meta.bg, textTransform: 'uppercase', flexShrink: 0 }}>
                  {feed.health}
                </span>

                {/* Sparkline */}
                <div style={{ minWidth: '100px', flex: '0 0 120px' }}>
                  <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '4px' }}>IOCs/day (7d)</div>
                  <MiniSparkline data={feed.iocVolume7d} />
                </div>

                {/* Last sync */}
                <div style={{ minWidth: '140px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
                  <div style={{ color: '#64748b', fontSize: '10px', marginBottom: '2px' }}>Last Sync</div>
                  {new Date(feed.lastSync).toLocaleString()}
                </div>

                {/* Auth failure warning */}
                {feed.authFailed && (
                  <div style={{ fontSize: '12px', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', padding: '4px 10px', borderRadius: '4px', flexShrink: 0 }}>
                    ⚠ API key expired — update credentials
                  </div>
                )}

                {/* Sync button */}
                <button
                  onClick={() => triggerSync(feed)}
                  disabled={isSyncing}
                  style={{ padding: '6px 14px', border: '1px solid #334155', background: 'transparent', color: isSyncing ? '#64748b' : '#38bdf8', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 }}>
                  {isSyncing ? '⏳ Syncing…' : '↻ Sync Now'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThreatFeedsPage;
