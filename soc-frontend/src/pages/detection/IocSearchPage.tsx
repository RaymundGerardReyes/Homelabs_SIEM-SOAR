import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../hooks/useAuthApi';

// ─── Types ────────────────────────────────────────────────────────────────────
type IocType = 'ip' | 'domain' | 'hash' | 'url';
type Verdict = 'malicious' | 'suspicious' | 'clean' | 'unknown';

interface IocResult {
  ioc: string;
  type: IocType;
  verdict: Verdict;
  sourceFeed: string;
  confidence: number;
  lastSeen: string;
}

const VERDICT_META: Record<Verdict, { color: string; bg: string }> = {
  malicious:  { color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  suspicious: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  clean:      { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  unknown:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' },
};

// Auto-detect IOC type from input value
function detectType(value: string): IocType {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) return 'ip';
  if (/^[a-fA-F0-9]{32,64}$/.test(value)) return 'hash';
  if (/^https?:\/\//i.test(value)) return 'url';
  return 'domain';
}

const MOCK_RESULTS: Record<string, IocResult[]> = {
  '198.51.100.42': [
    { ioc: '198.51.100.42', type: 'ip', verdict: 'malicious', sourceFeed: 'AlienVault OTX', confidence: 92, lastSeen: '2026-07-17T08:00:00Z' },
    { ioc: '198.51.100.42', type: 'ip', verdict: 'suspicious', sourceFeed: 'Abuse.ch', confidence: 74, lastSeen: '2026-07-16T20:00:00Z' },
  ],
};

const MAX_RECENT = 10;

const IocSearchPage: React.FC = () => {
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  const [query, setQuery] = useState('');
  const [detectedType, setDetectedType] = useState<IocType>('ip');
  const [manualType, setManualType] = useState<IocType | 'auto'>('auto');
  const [results, setResults] = useState<IocResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [, setSearchError] = useState<string | null>(null); // setter used in doSearch; UI display pending
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ioc_recent') ?? '[]'); } catch { return []; }
  });

  useEffect(() => {
    setDetectedType(detectType(query));
  }, [query]);

  const persistRecent = (val: string) => {
    setRecentSearches(prev => {
      const updated = [val, ...prev.filter(s => s !== val)].slice(0, MAX_RECENT);
      localStorage.setItem('ioc_recent', JSON.stringify(updated));
      return updated;
    });
  };

  const doSearch = useCallback(async (searchVal: string) => {
    if (!searchVal.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setSearching(true);
    setSearchError(null);
    setResults(null);
    persistRecent(searchVal.trim());

    const effectiveType = manualType === 'auto' ? detectedType : manualType;

    try {
      const res = await apiClient.get<IocResult[]>('/data/detection/ioc-search', {
        params: { query: searchVal, type: effectiveType },
        signal: abortRef.current.signal,
      });
      setResults(res.data);
    } catch {
      // Fallback mock
      const mock = MOCK_RESULTS[searchVal.trim()];
      if (mock) { setResults(mock); }
      else { setResults([]); }
    } finally {
      setSearching(false);
    }
  }, [detectedType, manualType]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch(query);
  };

  return (
    <div className="page-container fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="header">
        <h1>IOC Search</h1>
        <p className="subtitle">Search IPs, domains, hashes, and URLs across all threat-intel feeds</p>
      </div>

      {/* Search Bar */}
      <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. 198.51.100.42, evil.example.com, 3395856ce81f2b7382dee72602f798b642f14d8"
          style={{ flex: 1, minWidth: '280px', padding: '10px 14px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px' }}
        />
        <select
          value={manualType}
          onChange={e => setManualType(e.target.value as IocType | 'auto')}
          style={{ padding: '10px', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px' }}
        >
          <option value="auto">Auto-detect ({detectedType})</option>
          <option value="ip">IP Address</option>
          <option value="domain">Domain</option>
          <option value="hash">File Hash</option>
          <option value="url">URL</option>
        </select>
        <button
          className="premium-btn"
          onClick={() => doSearch(query)}
          disabled={searching || !query.trim()}
          style={{ whiteSpace: 'nowrap' }}
        >
          {searching ? '⏳ Searching…' : '🔍 Search'}
        </button>
      </div>

      {/* Recent Searches */}
      {recentSearches.length > 0 && !results && (
        <div className="glass-panel" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Searches</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {recentSearches.map(r => (
              <button key={r} onClick={() => { setQuery(r); doSearch(r); }}
                style={{ padding: '4px 10px', borderRadius: '12px', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', cursor: 'pointer', fontSize: '12px', fontFamily: 'monospace' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results Table */}
      {results !== null && (
        <div className="glass-panel" style={{ overflowX: 'auto' }}>
          {results.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              ✅ No threat intelligence found for this indicator — it may be clean or not yet indexed.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  {['Indicator', 'Type', 'Source Feed', 'Verdict', 'Confidence', 'Last Seen', ''].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const meta = VERDICT_META[r.verdict];
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px', color: '#e2e8f0' }}>{r.ioc}</td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', textTransform: 'uppercase', color: '#94a3b8' }}>{r.type}</td>
                      <td style={{ padding: '12px 16px', fontSize: '13px' }}>{r.sourceFeed}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, color: meta.color, background: meta.bg, textTransform: 'uppercase' }}>
                          {r.verdict}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '13px', color: r.confidence >= 80 ? '#ef4444' : '#fbbf24' }}>
                        {r.confidence}%
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', color: '#94a3b8' }}>{new Date(r.lastSeen).toLocaleString()}</td>
                      <td style={{ padding: '12px 16px' }}>
                        {r.verdict === 'malicious' && (
                          <button
                            onClick={() => navigate('/dashboard')}
                            style={{ padding: '4px 10px', background: 'transparent', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>
                            → Investigate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default IocSearchPage;
