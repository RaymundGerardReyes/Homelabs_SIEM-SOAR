import React, { useState, useEffect } from 'react';
import { StatusDot } from '../../../shared/ui';

interface AgentResilienceStatusProps {
  activeProvider: string;
  isDegraded: boolean;
  fallbackRuleTriggered: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  events: any[];
}

export default function AgentResilienceStatus({ activeProvider, isDegraded, fallbackRuleTriggered, connectionStatus, events }: AgentResilienceStatusProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (fallbackRuleTriggered) {
       setAcknowledged(false);
    }
  }, [fallbackRuleTriggered]);

  // Calculate stats dynamically
  const totalTriageEvents = events.filter(e => e.node === 'LLMTriage' && e.status === 'completed').length;
  const fallbackCount = events.filter(e => e.fallbackTriggered).length;
  const uptime = totalTriageEvents === 0 ? 100 : Math.max(0, 100 - ((fallbackCount / totalTriageEvents) * 100)).toFixed(1);

  if (connectionStatus !== 'connected') {
     return (
       <div className="glass-panel-dark rounded-xl p-3.5 sm:p-4 border border-red-500/50 shadow-xl flex items-center space-x-3 sm:space-x-4 bg-red-900/10 min-w-0 w-full">
          <StatusDot status="error" pulse />
          <div className="min-w-0">
             <h3 className="text-red-400 font-bold text-xs sm:text-sm truncate">Agent Telemetry Connection Lost</h3>
             <p className="text-slate-400 text-[11px] sm:text-xs mt-0.5 truncate">{connectionStatus === 'reconnecting' ? 'Reconnecting to stream...' : 'Offline. AI telemetry unavailable.'}</p>
          </div>
       </div>
     );
  }

  if (fallbackRuleTriggered && !acknowledged) {
     return (
       <div className="glass-panel-dark rounded-xl p-3.5 sm:p-4 border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] flex flex-col space-y-2.5 sm:space-y-3 bg-red-900/20 min-w-0 w-full">
          <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
              <StatusDot status="error" pulse />
              <div className="min-w-0">
                 <h3 className="text-red-400 font-bold text-xs sm:text-sm uppercase tracking-wide">AI Triage Fully Degraded</h3>
                 <p className="text-slate-300 text-[11px] sm:text-xs mt-0.5">All LLM paths failed. Static deterministic ruleset is active.</p>
              </div>
          </div>
          <button 
            onClick={() => setAcknowledged(true)}
            className="self-end text-xs font-bold bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors"
          >
             Acknowledge Risk
          </button>
       </div>
     );
  }

  return (
    <div className={`glass-panel-dark rounded-xl p-3 sm:p-3.5 border shadow-xl flex flex-col sm:flex-row lg:flex-col xl:flex-row items-start sm:items-center lg:items-start xl:items-center justify-between gap-2.5 sm:gap-3 min-w-0 w-full ${isDegraded ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-800'}`}>
       <div className="flex items-center space-x-3 min-w-0">
          <StatusDot status={isDegraded ? 'warning' : 'success'} />
          <div className="min-w-0">
             <h3 className="text-white font-bold text-xs sm:text-sm truncate">
               Active Provider: <span className="text-blue-400 font-mono">{activeProvider}</span>
             </h3>
             <p className="text-slate-400 text-[11px] sm:text-xs mt-0.5 truncate">
               {isDegraded ? 'Primary provider failed. Operating on fallback.' : 'LLM Triage is operating nominally.'}
             </p>
          </div>
       </div>
       <div className="text-left sm:text-right lg:text-left xl:text-right text-[11px] sm:text-xs text-slate-500 font-mono pt-2 sm:pt-0 lg:pt-2 xl:pt-0 border-t sm:border-t-0 lg:border-t xl:border-t-0 border-slate-800/60 w-full sm:w-auto lg:w-full xl:w-auto flex sm:block lg:flex xl:block justify-between flex-shrink-0">
          <div>Uptime: <span className="text-slate-300 font-semibold">{uptime}%</span></div>
          <div>Fallbacks: <span className="text-slate-300 font-semibold">{fallbackCount}</span></div>
       </div>
    </div>
  );
}
