import React, { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type EventType = 'process_exec' | 'file_modification' | 'registry_change' | 'network_connection';

interface EdrLogEntry {
  id: string;
  host: string;
  eventType: EventType;
  timestamp: string;
  process: string;
  detail: string;
  rawJson: Record<string, unknown>;
  isSuspicious: boolean;
}

const EVENT_META: Record<EventType, { label: string; color: string; icon: string }> = {
  process_exec:        { label: 'Process Exec',    color: '#a78bfa', icon: '⚙' },
  file_modification:   { label: 'File Mod',        color: '#fbbf24', icon: '📝' },
  registry_change:     { label: 'Registry',        color: '#fb923c', icon: '🔧' },
  network_connection:  { label: 'Network Conn',    color: '#38bdf8', icon: '🌐' },
};

const MOCK_LOGS: EdrLogEntry[] = [
  { id: 'e1', host: 'WIN-FIN-03', eventType: 'process_exec', timestamp: '2026-07-17T10:11:43Z', process: 'powershell.exe', detail: 'Encoded command execution: -EncodedCommand JABX...', isSuspicious: true, rawJson: { pid: 4821, parent: 'winword.exe', cmdline: 'powershell.exe -nop -EncodedCommand JABX...' } },
  { id: 'e2', host: 'WIN-FIN-03', eventType: 'network_connection', timestamp: '2026-07-17T10:11:55Z', process: 'powershell.exe', detail: 'Outbound TCP to 198.51.100.42:443 (C2 candidate)', isSuspicious: true, rawJson: { srcPort: 49210, dstIp: '198.51.100.42', dstPort: 443, bytes: 1200 } },
  { id: 'e3', host: 'WIN-WEB-02', eventType: 'file_modification', timestamp: '2026-07-17T09:50:00Z', process: 'w3wp.exe', detail: 'Modified: C:\\inetpub\\wwwroot\\shell.aspx', isSuspicious: true, rawJson: { path: 'C:\\inetpub\\wwwroot\\shell.aspx', sizeBytes: 4098, sha256: 'b94f6f...' } },
  { id: 'e4', host: 'WIN-DC-01', eventType: 'registry_change', timestamp: '2026-07-17T09:10:00Z', process: 'regedit.exe', detail: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run modified', isSuspicious: false, rawJson: { key: 'HKLM\\...\\Run', value: 'Updater', data: 'C:\\Users\\Admin\\update.exe' } },
  { id: 'e5', host: 'WIN-WS-14', eventType: 'process_exec', timestamp: '2026-07-17T08:30:00Z', process: 'chrome.exe', detail: 'Normal user browser launch', isSuspicious: false, rawJson: { pid: 1234, parent: 'explorer.exe' } },
];

const EdrLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<EdrLogEntry[]>(MOCK_LOGS);
  const [loading, setLoading] = useState(true);
  const [hostFilter, setHostFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all');
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [liveTail, setLiveTail] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listEndRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get<EdrLogEntry[]>('/data/endpoints/edr-logs')
      .then(res => setLogs(res.data))
      .catch(() => setLogs(MOCK_LOGS))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Live-tail WebSocket with reconnect/backoff (mirrors InvestigationGraph pattern)
  useEffect(() => {
    if (!liveTail) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }
    let retryDelay = 1000;
    let alive = true;

    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/ws/edr-stream`);
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        try {
          const entry: EdrLogEntry = JSON.parse(evt.data);
          setLogs(prev => [entry, ...prev].slice(0, 500));
          retryDelay = 1000;
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { if (alive) setTimeout(connect, Math.min(retryDelay, 30000)); retryDelay = Math.min(retryDelay * 2, 30000); };
    };
    connect();
    return () => { alive = false; wsRef.current?.close(); };
  }, [liveTail]);

  // Auto-scroll when live-tailing
  useEffect(() => {
    if (liveTail) listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length, liveTail]);

  const filtered = logs.filter(l => {
    const matchHost = !hostFilter || l.host.toLowerCase().includes(hostFilter.toLowerCase());
    const matchType = typeFilter === 'all' || l.eventType === typeFilter;
    const matchSusp = !suspiciousOnly || l.isSuspicious;
    return matchHost && matchType && matchSusp;
  });

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>EDR Logs</h1>
          <p className="subtitle">Data source: <code>GET /api/endpoints/edr-logs</code> · <code>WS /api/ws/edr-stream</code></p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          {liveTail && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444', animation: 'pulse 1.2s ease-in-out infinite' }} />}
          <button
            onClick={() => setLiveTail(v => !v)}
            style={{ padding: '6px 14px', border: `1px solid ${liveTail ? '#ef4444' : '#334155'}`, background: liveTail ? 'rgba(239,68,68,0.1)' : 'transparent', color: liveTail ? '#ef4444' : '#94a3b8', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>
            {liveTail ? 'Stop Live-Tail' : '▶ Live-Tail'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ display: 'flex', gap: '1rem', padding: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Filter by host…" value={hostFilter} onChange={e => setHostFilter(e.target.value)}
          style={{ flex: 1, minWidth: '160px', padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as EventType | 'all')}
          style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px' }}>
          <option value="all">All Event Types</option>
          <option value="process_exec">Process Execution</option>
          <option value="file_modification">File Modification</option>
          <option value="registry_change">Registry Change</option>
          <option value="network_connection">Network Connection</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#94a3b8', cursor: 'pointer' }}>
          <input type="checkbox" checked={suspiciousOnly} onChange={e => setSuspiciousOnly(e.target.checked)} />
          Suspicious only
        </label>
      </div>

      {/* Log table */}
      <div className="glass-panel" style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading logs…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#0f172a', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                {['Timestamp', 'Host', 'Type', 'Process', 'Detail', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(log => {
                const meta = EVENT_META[log.eventType];
                const isExpanded = expandedId === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      style={{ borderBottom: '1px solid #1e293b', cursor: 'pointer', background: log.isSuspicious ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                      <td style={{ padding: '10px 16px', fontSize: '11px', color: '#64748b', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: 600 }}>{log.host}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <span style={{ color: meta.color, fontSize: '12px' }}>{meta.icon} {meta.label}</span>
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: '12px', color: log.isSuspicious ? '#fbbf24' : '#94a3b8' }}>{log.process}</td>
                      <td style={{ padding: '10px 16px', fontSize: '12px', color: '#94a3b8', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.detail}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                        {log.isSuspicious && <span style={{ color: '#ef4444', fontSize: '10px', fontWeight: 700 }}>⚠ SUSPICIOUS</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ background: '#0a0f1a' }}>
                        <td colSpan={6} style={{ padding: '1rem 1.5rem' }}>
                          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>RAW EVENT DATA</div>
                          <pre style={{ fontFamily: 'monospace', fontSize: '12px', color: '#38bdf8', background: 'rgba(0,0,0,0.4)', padding: '1rem', borderRadius: '6px', overflow: 'auto', margin: 0 }}>
                            {JSON.stringify(log.rawJson, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No logs match current filters.</td></tr>
              )}
            </tbody>
          </table>
        )}
        <div ref={listEndRef} />
      </div>
    </div>
  );
};

export default EdrLogsPage;
