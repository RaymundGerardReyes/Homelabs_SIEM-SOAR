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
    <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl flex flex-col h-full">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
        <h3 className="text-sm font-bold text-white flex items-center">
          <StatusDot status="success" pulse className="mr-2" /> 
          Live Agent Triage Feed
        </h3>
        <div className="flex space-x-2">
          <input 
            type="text" placeholder="Filter Node..."
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 w-24"
            value={filterNode} onChange={e => setFilterNode(e.target.value)}
          />
          <input 
            type="text" placeholder="Correlation ID..."
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 w-28"
            value={filterCorrelation} onChange={e => setFilterCorrelation(e.target.value)}
          />
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className={`px-3 py-1 text-xs font-bold rounded ${isPaused ? 'bg-orange-600 hover:bg-orange-500' : 'bg-slate-700 hover:bg-slate-600'} text-white transition-colors`}
          >
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
      
      <div ref={feedRef} className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar font-mono text-xs">
        {filtered.map((ev, i) => {
           const statusColor = ev.status === 'started' ? 'text-amber-400' : ev.status === 'failed' ? 'text-red-400' : 'text-emerald-400';
           return (
             <div key={i} className="flex items-start space-x-3 hover:bg-slate-800/30 p-1.5 rounded transition-colors">
                <span className="text-slate-500 flex-shrink-0">[{new Date(ev.timestamp).toLocaleTimeString()}]</span>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                     <span className="text-slate-400 font-bold">{ev.node}</span>
                     <span className="text-slate-600">-&gt;</span>
                     <span className={`${statusColor} font-bold uppercase`}>{ev.status}</span>
                     {ev.latencyMs && <span className="text-slate-500">({ev.latencyMs}ms)</span>}
                  </div>
                  {ev.summary && <div className="text-slate-300 ml-2">&gt; {ev.summary}</div>}
                  {ev.fallbackTriggered && (
                    <div className="text-red-400 ml-2 mt-1">
                      ⚠️ Fallback: {ev.fallbackReason} 
                      {ev.provider && <span className="text-slate-400"> -&gt; Routed to {ev.provider}</span>}
                    </div>
                  )}
                  <div className="mt-1 text-slate-600 text-[10px] ml-2 flex items-center space-x-3">
                     <span>ID: {ev.correlationId}</span>
                     {ev.investigationId && (
                       <Link to={`/investigations/${ev.investigationId}`} className="text-blue-500 hover:underline">
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
