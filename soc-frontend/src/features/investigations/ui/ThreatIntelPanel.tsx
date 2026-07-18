import React, { useEffect, useState, useRef } from 'react';
import apiClient from '@/shared/hooks/useAuthApi';

interface ThreatIntelSource<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

interface OtxData {
  reputation: number;
  pulse_count: number;
  tags: string[];
}

interface AbuseChData {
  listed: boolean;
  malware_family?: string;
}

interface ThreatIntelData {
  source_ip: string;
  alienvault_otx: ThreatIntelSource<OtxData>;
  abuse_ch: ThreatIntelSource<AbuseChData>;
  misp_correlation: boolean | null;
  overall_risk_score: number | null;
}

export const ThreatIntelPanel: React.FC<{ ipAddress: string }> = ({ ipAddress }) => {
  const [state, setState] = useState<ThreatIntelData | null>(null);
  const [totalLoading, setTotalLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchIntel = async (ip: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    setTotalLoading(true);
    setFatalError(null);

    try {
      const res = await apiClient.get(`/threat-intel/enrich`, {
        params: { ip },
        signal,
      });
      const d = res.data;
      setState({
        source_ip: ip,
        alienvault_otx: { data: d.alienvault_otx ?? null, loading: false, error: d.alienvault_otx === undefined },
        abuse_ch: { data: d.abuse_ch ?? null, loading: false, error: d.abuse_ch === undefined },
        misp_correlation: d.misp_correlation ?? null,
        overall_risk_score: d.overall_risk_score ?? null,
      });
    } catch (err: unknown) {
      if ((err as { name: string })?.name === 'CanceledError' || (err as { name: string })?.name === 'AbortError') return;
      setFatalError('Threat intelligence enrichment failed. Check network or backend status.');
    } finally {
      setTotalLoading(false);
    }
  };

  useEffect(() => {
    fetchIntel(ipAddress);
    return () => {
      abortRef.current?.abort();
    };
  }, [ipAddress]);

  if (totalLoading) {
    return (
      <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem', maxWidth: '48rem' }}>
        <div style={{ animation: 'pulse 2s infinite' }}>
          <div style={{ height: '12px', background: '#1e293b', borderRadius: '4px', width: '33%', marginBottom: '1rem' }} />
          <div style={{ height: '80px', background: '#1e293b', borderRadius: '4px', width: '100%' }} />
        </div>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '1.5rem', marginTop: '1.5rem', maxWidth: '48rem', color: '#fca5a5', fontFamily: 'monospace' }}>
        ⚠ {fatalError}
        <div style={{ marginTop: '0.75rem' }}>
          <button onClick={() => fetchIntel(ipAddress)}
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px' }}>
            ↻ Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div style={{ background: '#0f172a', border: '1px solid rgba(127,29,29,0.5)', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 20px 25px rgba(0,0,0,0.3)', maxWidth: '48rem', position: 'relative', overflow: 'hidden', marginTop: '1.5rem' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '3px', background: 'linear-gradient(to right, #dc2626, #ea580c)' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ color: 'white', fontFamily: 'monospace', fontWeight: 700, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#ef4444' }}>⚡</span> SOAR Threat Intel Enrichment
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '13px', fontFamily: 'monospace', marginTop: '4px' }}>Target Entity: {state.source_ip}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: state.overall_risk_score !== null ? '#ef4444' : '#64748b', fontSize: '2rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {state.overall_risk_score !== null ? `${state.overall_risk_score}/10` : '—'}
          </div>
          <div style={{ color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px' }}>Global Risk Score</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div style={{ background: '#1e293b', borderRadius: '6px', padding: '1rem', border: '1px solid #334155' }}>
          <h3 style={{ color: '#818cf8', fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '2px' }}>
            AlienVault OTX
          </h3>
          {state.alienvault_otx.error ? (
            <p style={{ color: '#f87171', fontFamily: 'monospace', fontSize: '12px' }}>⚠ Source Unavailable</p>
          ) : state.alienvault_otx.data ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>Reputation Score</span>
                <span style={{ color: 'white', fontWeight: 700 }}>{state.alienvault_otx.data.reputation}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span style={{ color: '#94a3b8', fontSize: '13px' }}>Correlated Pulses</span>
                <span style={{ color: '#f87171', fontWeight: 700 }}>{state.alienvault_otx.data.pulse_count}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {state.alienvault_otx.data.tags.map(tag => (
                  <span key={tag} style={{ background: '#0f172a', color: '#cbd5e1', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', border: '1px solid #334155' }}>#{tag}</span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div style={{ background: '#1e293b', borderRadius: '6px', padding: '1rem', border: '1px solid #334155' }}>
          <h3 style={{ color: '#818cf8', fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '2px' }}>
            Internal &amp; Open Feeds
          </h3>
          {state.abuse_ch.error ? (
            <p style={{ color: '#f87171', fontFamily: 'monospace', fontSize: '12px', marginBottom: '8px' }}>⚠ Abuse.ch Unavailable</p>
          ) : state.abuse_ch.data ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#0f172a', borderRadius: '4px', marginBottom: '8px' }}>
                <span style={{ color: '#cbd5e1', fontSize: '13px', fontFamily: 'monospace' }}>Abuse.ch Status</span>
                {state.abuse_ch.data.listed
                  ? <span style={{ background: 'rgba(127,29,29,0.5)', color: '#f87171', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, border: '1px solid rgba(239,68,68,0.3)' }}>BLACKLISTED</span>
                  : <span style={{ color: '#4ade80', fontSize: '11px' }}>CLEAN</span>
                }
              </div>
              {state.abuse_ch.data.malware_family && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#0f172a', borderRadius: '4px', marginBottom: '8px' }}>
                  <span style={{ color: '#cbd5e1', fontSize: '13px', fontFamily: 'monospace' }}>Malware Signature</span>
                  <span style={{ color: '#fb923c', fontSize: '11px', fontWeight: 700 }}>{state.abuse_ch.data.malware_family}</span>
                </div>
              )}
            </>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: '#0f172a', borderRadius: '4px' }}>
            <span style={{ color: '#cbd5e1', fontSize: '13px', fontFamily: 'monospace' }}>Local MISP Instance</span>
            {state.misp_correlation === null
              ? <span style={{ color: '#64748b', fontSize: '11px' }}>Unavailable</span>
              : <span style={{ color: state.misp_correlation ? '#f87171' : '#4ade80', fontSize: '11px', fontWeight: 700 }}>
                  {state.misp_correlation ? 'KNOWN THREAT' : 'NO MATCH'}
                </span>
            }
          </div>
        </div>
      </div>
    </div>
  );
};
