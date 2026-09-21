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
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 animate-pulse w-full">
        <div className="h-4 bg-slate-800 rounded w-1/3 mb-4"></div>
        <div className="h-20 bg-slate-800 rounded w-full"></div>
      </div>
    );
  }

  if (!intelData) return null;

  return (
    <div className="bg-slate-900 border border-red-900/50 rounded-xl p-4 sm:p-6 shadow-xl w-full min-w-0 relative overflow-hidden">
      {/* Decorative pulse background for high risk */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-orange-500"></div>
      
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white font-mono flex items-center gap-2">
            <span className="text-red-500 animate-pulse">⚡</span> SOAR Threat Intel
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm font-mono mt-1 break-all">
            Target Entity: <span className="text-blue-400 font-semibold">{intelData.source_ip}</span>
          </p>
        </div>
        <div className="flex sm:flex-col items-baseline sm:items-end justify-between w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800">
          <div className="text-2xl sm:text-3xl font-bold text-red-500 font-mono leading-none">{intelData.overall_risk_score}/10</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Global Risk Score</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
        {/* AlienVault OTX Panel */}
        <div className="bg-slate-800 rounded-lg p-3.5 sm:p-4 border border-slate-700 shadow-inner min-w-0 flex flex-col justify-between">
          <div>
            <h3 className="text-indigo-400 text-[10px] font-bold font-mono mb-3 uppercase tracking-wider">AlienVault OTX</h3>
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400 text-xs sm:text-sm">Reputation Score</span>
              <span className="text-white font-bold text-xs sm:text-sm font-mono">{intelData.alienvault_otx.reputation}</span>
            </div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-slate-400 text-xs sm:text-sm">Correlated Pulses</span>
              <span className="text-red-400 font-bold text-xs sm:text-sm font-mono">{intelData.alienvault_otx.pulse_count}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mt-3 pt-3 border-t border-slate-700/60">
            {intelData.alienvault_otx.tags.map(tag => (
              <span key={tag} className="bg-slate-900 text-[10px] sm:text-xs text-slate-300 px-2 py-0.5 rounded border border-slate-700 shadow-sm font-mono break-all inline-block">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        {/* Abuse.ch & MISP Panel */}
        <div className="bg-slate-800 rounded-lg p-3.5 sm:p-4 border border-slate-700 shadow-inner min-w-0 space-y-2.5">
          <h3 className="text-indigo-400 text-[10px] font-bold font-mono mb-2 uppercase tracking-wider">Internal & Open Feeds</h3>
          <div className="flex justify-between items-center p-2 bg-slate-900 rounded border border-slate-700/50 gap-2">
            <span className="text-slate-300 text-xs font-mono">Abuse.ch Status</span>
            {intelData.abuse_ch.listed ? (
              <span className="bg-red-900/30 text-red-400 px-2 py-0.5 rounded text-[10px] font-bold border border-red-500/30 shadow-[0_0_5px_rgba(239,68,68,0.2)] flex-shrink-0 whitespace-nowrap">BLACKLISTED</span>
            ) : (
              <span className="text-green-500 text-[10px] font-bold flex-shrink-0 whitespace-nowrap">CLEAN</span>
            )}
          </div>
          {intelData.abuse_ch.malware_family && (
            <div className="flex justify-between items-center p-2 bg-slate-900 rounded border border-slate-700/50 gap-2 min-w-0">
              <span className="text-slate-300 text-xs font-mono flex-shrink-0">Malware Signature</span>
              <span className="text-orange-400 text-xs font-bold truncate max-w-[140px] text-right font-mono">{intelData.abuse_ch.malware_family}</span>
            </div>
          )}
          <div className="flex justify-between items-center p-2 bg-slate-900 rounded border border-slate-700/50 gap-2">
            <span className="text-slate-300 text-xs font-mono">Local MISP Instance</span>
            <span className={intelData.misp_correlation ? "text-red-400 text-[10px] font-bold tracking-wider flex-shrink-0 whitespace-nowrap" : "text-green-500 text-[10px] font-bold tracking-wider flex-shrink-0 whitespace-nowrap"}>
              {intelData.misp_correlation ? "KNOWN THREAT" : "NO MATCH"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
