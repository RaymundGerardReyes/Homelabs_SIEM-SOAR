import React, { useEffect } from 'react';
import { useAsyncState } from '../../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../../shared/ui';
import apiClient from '../../../shared/api/apiClient';
import { ThreatIntelResult } from '../../../shared/types';

interface ThreatIntelPanelProps {
  ipAddress: string;
}

export default function ThreatIntelPanel({ ipAddress }: ThreatIntelPanelProps) {
  const { data, loading, error, execute } = useAsyncState<ThreatIntelResult>(async () => {
    const res = await apiClient.get(`/threat-intel/enrich?ip=${ipAddress}`);
    return res.data;
  });

  useEffect(() => {
    if (ipAddress) {
      execute();
    }
  }, [ipAddress, execute]);

  if (loading) return <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg"><LoadingSkeleton lines={4} /></div>;
  if (error && !data) return <ErrorState message="All threat intel sources failed to load." onRetry={execute} />;
  if (!data) return null;

  const riskScore = data.overall_risk_score || 0;
  const severityBadge = riskScore >= 7 ? 'S1' : riskScore >= 4 ? 'S2' : 'S4';
  const riskLabel = riskScore >= 7 ? 'High' : riskScore >= 4 ? 'Medium' : 'Low';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-white font-bold text-lg">Threat Intel: {ipAddress}</h3>
        <div className="flex flex-col items-end">
          <span className="text-xs text-slate-500 uppercase mb-1">Global Risk Score</span>
          <Badge severity={severityBadge} className="text-lg px-3 py-1">{riskScore.toFixed(1)}/10 - {riskLabel}</Badge>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">AlienVault OTX</h4>
          {data.alienvault_otx ? (
            <div className="text-sm text-slate-400">
              <p>Reputation: <span className="text-white">{data.alienvault_otx.reputation || 'Unknown'}</span></p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(data.alienvault_otx.tags || []).map((tag: string) => (
                  <span key={tag} className="px-1.5 py-0.5 bg-slate-700 text-xs rounded">{tag}</span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">Source unavailable or no data.</p>
          )}
        </div>

        <div className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
          <h4 className="text-sm font-semibold text-slate-300 mb-2">Abuse.ch</h4>
          {data.abuse_ch ? (
            <div className="text-sm text-slate-400">
              <p>Status: <span className={data.abuse_ch.listed ? 'text-red-400 font-bold' : 'text-green-400'}>{data.abuse_ch.listed ? 'Listed' : 'Clean'}</span></p>
              <p>Threat Type: {data.abuse_ch.threat_type || 'N/A'}</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">Source unavailable or no data.</p>
          )}
        </div>
      </div>
    </div>
  );
}
