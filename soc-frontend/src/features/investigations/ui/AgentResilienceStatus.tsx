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
       <div className="glass-panel-dark rounded-xl p-4 border border-red-500/50 shadow-xl flex items-center space-x-4 bg-red-900/10">
          <StatusDot status="error" pulse />
          <div>
             <h3 className="text-red-400 font-bold text-sm">Agent Telemetry Connection Lost</h3>
             <p className="text-slate-400 text-xs mt-1">{connectionStatus === 'reconnecting' ? 'Reconnecting to ws/agent/stream...' : 'Offline. AI telemetry unavailable.'}</p>
          </div>
       </div>
     );
  }

  if (fallbackRuleTriggered && !acknowledged) {
     return (
       <div className="glass-panel-dark rounded-xl p-4 border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] flex flex-col space-y-3 bg-red-900/20">
          <div className="flex items-center space-x-4">
              <StatusDot status="error" pulse />
              <div>
                 <h3 className="text-red-400 font-bold text-sm uppercase">AI Triage Fully Degraded</h3>
                 <p className="text-slate-300 text-xs mt-1">All LLM paths failed. Static deterministic ruleset is currently handling all detections.</p>
              </div>
          </div>
          <button 
            onClick={() => setAcknowledged(true)}
            className="self-end text-xs font-bold bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded"
          >
             Acknowledge Risk
          </button>
       </div>
     );
  }

  return (
    <div className={`glass-panel-dark rounded-xl p-4 border shadow-xl flex items-center justify-between ${isDegraded ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-800'}`}>
       <div className="flex items-center space-x-4">
          <StatusDot status={isDegraded ? 'warning' : 'success'} />
          <div>
             <h3 className="text-white font-bold text-sm">Active Provider: <span className="text-blue-400">{activeProvider}</span></h3>
             <p className="text-slate-400 text-xs mt-1">
               {isDegraded ? 'Primary provider failed. Operating on fallback.' : 'LLM Triage is operating nominally.'}
             </p>
          </div>
       </div>
       <div className="text-right text-xs text-slate-500 font-mono">
          <div>Uptime: {uptime}%</div>
          <div>Fallbacks (24h): {fallbackCount}</div>
       </div>
    </div>
  );
}
