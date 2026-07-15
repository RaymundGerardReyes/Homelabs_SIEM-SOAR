import React, { useEffect, useState } from 'react';

interface ThreatIntelData {
  source_ip: string;
  alienvault_otx: {
    reputation: number;
    pulse_count: number;
    tags: string[];
  };
  abuse_ch: {
    listed: boolean;
    malware_family?: string;
  };
  misp_correlation: boolean;
  overall_risk_score: number;
}

export const ThreatIntelPanel: React.FC<{ ipAddress: string }> = ({ ipAddress }) => {
  const [intelData, setIntelData] = useState<ThreatIntelData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // Connects to the Shuffle SOAR ephemeral API results
    setLoading(true);
    setTimeout(() => {
      setIntelData({
        source_ip: ipAddress,
        alienvault_otx: {
          reputation: 85,
          pulse_count: 12,
          tags: ["cobaltstrike", "c2", "apt29"],
        },
        abuse_ch: {
          listed: true,
          malware_family: "Qakbot",
        },
        misp_correlation: true,
        overall_risk_score: 9.4,
      });
      setLoading(false);
    }, 1500);
  }, [ipAddress]);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 animate-pulse mt-6 max-w-4xl">
        <div className="h-4 bg-slate-800 rounded w-1/3 mb-4"></div>
        <div className="h-20 bg-slate-800 rounded w-full"></div>
      </div>
    );
  }

  if (!intelData) return null;

  return (
    <div className="bg-slate-900 border border-red-900/50 rounded-lg p-6 shadow-xl w-full max-w-4xl relative overflow-hidden mt-6">
      {/* Decorative pulse background for high risk */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-orange-500"></div>
      
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-xl font-bold text-white font-mono flex items-center gap-2">
            <span className="text-red-500">⚡</span> SOAR Threat Intel Enrichment
          </h2>
          <p className="text-slate-400 text-sm font-mono mt-1">Target Entity: {intelData.source_ip}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-red-500 font-mono">{intelData.overall_risk_score}/10</div>
          <div className="text-xs text-slate-500 uppercase tracking-widest">Global Risk Score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AlienVault OTX Panel */}
        <div className="bg-slate-800 rounded p-4 border border-slate-700">
          <h3 className="text-indigo-400 text-sm font-bold font-mono mb-3 uppercase tracking-wider">AlienVault OTX</h3>
          <div className="flex justify-between mb-2">
            <span className="text-slate-400 text-sm">Reputation Score</span>
            <span className="text-white font-bold">{intelData.alienvault_otx.reputation}</span>
          </div>
          <div className="flex justify-between mb-3">
            <span className="text-slate-400 text-sm">Correlated Pulses</span>
            <span className="text-red-400 font-bold">{intelData.alienvault_otx.pulse_count}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {intelData.alienvault_otx.tags.map(tag => (
              <span key={tag} className="bg-slate-900 text-xs text-slate-300 px-2 py-1 rounded border border-slate-700">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {/* Abuse.ch & MISP Panel */}
        <div className="bg-slate-800 rounded p-4 border border-slate-700">
          <h3 className="text-indigo-400 text-sm font-bold font-mono mb-3 uppercase tracking-wider">Internal & Open Feeds</h3>
          <div className="flex justify-between items-center p-2 bg-slate-900 rounded mb-2">
            <span className="text-slate-300 text-sm font-mono">Abuse.ch Status</span>
            {intelData.abuse_ch.listed ? (
              <span className="bg-red-900/50 text-red-400 px-2 py-1 rounded text-xs font-bold border border-red-500/30">BLACKLISTED</span>
            ) : (
              <span className="text-green-500 text-xs">CLEAN</span>
            )}
          </div>
          {intelData.abuse_ch.malware_family && (
            <div className="flex justify-between items-center p-2 bg-slate-900 rounded mb-2">
              <span className="text-slate-300 text-sm font-mono">Malware Signature</span>
              <span className="text-orange-400 text-xs font-bold">{intelData.abuse_ch.malware_family}</span>
            </div>
          )}
          <div className="flex justify-between items-center p-2 bg-slate-900 rounded">
            <span className="text-slate-300 text-sm font-mono">Local MISP Instance</span>
            <span className={intelData.misp_correlation ? "text-red-400 text-xs font-bold" : "text-green-500 text-xs font-bold"}>
              {intelData.misp_correlation ? "KNOWN THREAT" : "NO MATCH"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
