import React, { useState, useEffect } from 'react';

export default function AgentResilienceStatus() {
  const [activeProvider, setActiveProvider] = useState<string>('openai');
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null);
  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/agent/stream');
    
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      const events = data.type === 'history' ? data.events : [data.event];
      
      for (const e of events) {
        if (e.node === 'LLMTriage') {
          if (e.status === 'FALLBACK_DETERMINISTIC_RULE_TRIGGERED') {
            setIsDegraded(true);
            setActiveProvider('STATIC_RULES');
          } else if (e.provider && e.status === 'started' && e.provider !== activeProvider && e.provider !== 'static_ruleset') {
            setActiveProvider(e.provider);
            if (e.provider !== 'openai') {
                setFallbackMessage(`Failover active: Switched to ${e.provider}`);
                setTimeout(() => setFallbackMessage(null), 5000);
            }
          }
        }
      }
    };
    return () => ws.close();
  }, [activeProvider]);

  return (
    <div className="flex flex-col space-y-2 mb-4">
      {isDegraded && (
        <div className="bg-red-900/30 border border-red-500 p-3 rounded flex justify-between items-center shadow-lg shadow-red-900/20">
          <div className="flex items-center space-x-3">
            <svg className="w-6 h-6 text-red-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <div>
              <h3 className="text-red-400 font-bold text-sm uppercase tracking-wider">AI Triage Degraded</h3>
              <p className="text-red-300 text-xs">All cloud AI providers failed. Reverted to static deterministic ruleset.</p>
            </div>
          </div>
          <button onClick={() => setIsDegraded(false)} className="text-xs bg-red-950 text-red-400 hover:text-white px-3 py-1 rounded border border-red-800">
            Acknowledge
          </button>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 p-3 rounded flex items-center justify-between">
        <div className="flex items-center space-x-3">
           <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">Active Engine:</span>
           <span className="flex items-center bg-slate-950 px-3 py-1 rounded-full border border-slate-800">
             <span className={`w-2 h-2 rounded-full mr-2 ${
                activeProvider === 'openai' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                activeProvider === 'STATIC_RULES' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
             }`}></span>
             <span className="text-sm font-bold text-white uppercase tracking-wider">{activeProvider}</span>
           </span>
        </div>
        {fallbackMessage && (
          <div className="text-xs text-amber-400 animate-pulse flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
            {fallbackMessage}
          </div>
        )}
      </div>
    </div>
  );
}
