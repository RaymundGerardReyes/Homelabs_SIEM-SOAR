import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { StatusDot } from '../../../shared/ui';

interface AgentEvent {
  correlationId: string;
  investigationId: string | null;
  timestamp: string;
  node: string;
  status: 'started' | 'completed' | 'failed';
  provider: string | null;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  latencyMs: number | null;
  summary: string | null;
}

export default function AgentTriageFeed({ events }: { events: AgentEvent[] }) {
  const [isPaused, setIsPaused] = useState(false);
  const [filterNode, setFilterNode] = useState('');
  const [filterCorrelation, setFilterCorrelation] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  // Display events (pause freezes the view but underlying events prop still grows)
  const [displayedEvents, setDisplayedEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    if (!isPaused) {
      setDisplayedEvents(events);
      if (feedRef.current) {
         feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    }
  }, [events, isPaused]);

  const filtered = displayedEvents.filter(e => 
    (filterNode ? e.node.toLowerCase().includes(filterNode.toLowerCase()) : true) &&
    (filterCorrelation ? e.correlationId.includes(filterCorrelation) : true)
  );

  return (
    <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl flex flex-col h-full min-w-0 w-full overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 bg-slate-900/50">
        <h3 className="text-xs sm:text-sm font-bold text-white flex items-center">
          <StatusDot status="success" pulse className="mr-2" /> 
          Live Agent Triage Feed
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
          <input 
            type="text" placeholder="Filter Node..."
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 flex-1 min-w-[80px] sm:min-w-0 sm:w-24 focus:outline-none focus:border-indigo-500"
            value={filterNode} onChange={e => setFilterNode(e.target.value)}
          />
          <input 
            type="text" placeholder="Correlation ID..."
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 flex-1 min-w-[90px] sm:min-w-0 sm:w-28 focus:outline-none focus:border-indigo-500"
            value={filterCorrelation} onChange={e => setFilterCorrelation(e.target.value)}
          />
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={`px-2.5 sm:px-3 py-1 text-xs font-bold rounded ${isPaused ? 'bg-orange-600 hover:bg-orange-500' : 'bg-slate-700 hover:bg-slate-600'} text-white transition-colors flex-shrink-0`}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
      
      <div ref={feedRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 custom-scrollbar font-mono text-xs min-w-0">
        {filtered.map((ev, i) => {
           const statusColor = ev.status === 'started' ? 'text-amber-400' : ev.status === 'failed' ? 'text-red-400' : 'text-emerald-400';
           return (
             <div key={i} className="flex items-start space-x-2 sm:space-x-3 hover:bg-slate-800/30 p-1.5 rounded transition-colors min-w-0">
                <span className="text-slate-500 text-[10px] sm:text-xs flex-shrink-0">[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-1 sm:gap-1.5 mb-1 min-w-0">
                     <span className="text-slate-300 font-bold truncate max-w-[120px] sm:max-w-none">{ev.node}</span>
                     <span className="text-slate-600">-&gt;</span>
                     <span className={`${statusColor} font-bold uppercase text-[11px] sm:text-xs`}>{ev.status}</span>
                     {ev.latencyMs && <span className="text-slate-500 text-[11px]">({ev.latencyMs}ms)</span>}
                  </div>
                  {ev.summary && <div className="text-slate-300 text-[11px] sm:text-xs ml-1 sm:ml-2 break-words">&gt; {ev.summary}</div>}
                  {ev.fallbackTriggered && (
                    <div className="text-red-400 text-[11px] sm:text-xs ml-1 sm:ml-2 mt-1 break-words">
                      ⚠️ Fallback: {ev.fallbackReason} 
                      {ev.provider && <span className="text-slate-400"> -&gt; Routed to {ev.provider}</span>}
                    </div>
                  )}
                  <div className="mt-1 text-slate-600 text-[10px] ml-1 sm:ml-2 flex items-center flex-wrap gap-x-3 gap-y-1">
                     <span className="truncate max-w-[160px] sm:max-w-none">ID: {ev.correlationId}</span>
                     {ev.investigationId && (
                       <Link to={`/investigations/${ev.investigationId}`} className="text-blue-400 hover:underline flex-shrink-0">
                         View {ev.investigationId}
                       </Link>
                     )}
                  </div>
                </div>
             </div>
           );
        })}
        {filtered.length === 0 && <div className="text-slate-500 italic text-center py-8">No events found.</div>}
      </div>
    </div>
  );
}
