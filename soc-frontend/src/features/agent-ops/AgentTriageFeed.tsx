import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

interface AgentEvent {
  correlationId: string;
  investigationId: string | null;
  timestamp: string;
  node: 'Ingest' | 'Deobfuscation' | 'LLMTriage' | 'Action';
  status: 'started' | 'completed' | 'failed' | 'FALLBACK_DETERMINISTIC_RULE_TRIGGERED';
  provider: string | null;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  latencyMs: number | null;
  summary: string | null;
}

export default function AgentTriageFeed() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filterNode, setFilterNode] = useState<string>('All');
  const wsRef = useRef<WebSocket | null>(null);
  const eventsQueue = useRef<AgentEvent[]>([]);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket('ws://localhost:8000/ws/agent/stream');
      
      ws.onopen = () => {
        console.log('Connected to Agent Triage Feed');
      };

      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'history') {
          setEvents(data.events);
        } else if (data.type === 'live') {
          eventsQueue.current.push(data.event);
        }
      };

      ws.onclose = () => {
        console.warn('Agent stream disconnected. Reconnecting in 3s...');
        setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    const interval = setInterval(() => {
      if (!isPaused && eventsQueue.current.length > 0) {
        setEvents(prev => {
          const newEvents = [...prev, ...eventsQueue.current];
          eventsQueue.current = [];
          // Keep the last 500 in memory to avoid UI lag
          return newEvents.slice(-500);
        });
      }
    }, 200);

    return () => {
      clearInterval(interval);
      wsRef.current?.close();
    };
  }, [isPaused]);

  const filteredEvents = events.filter(e => filterNode === 'All' || e.node === filterNode);

  return (
    <div className="flex flex-col h-96 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="bg-slate-900 border-b border-slate-800 p-2 flex justify-between items-center text-xs">
        <div className="flex space-x-4 items-center">
           <span className="font-bold text-slate-300 uppercase tracking-wider">⚡ Live Agent Trace</span>
           <select 
              className="bg-slate-800 text-slate-300 border border-slate-700 rounded px-2 py-1" 
              value={filterNode} 
              onChange={e => setFilterNode(e.target.value)}
           >
             <option value="All">All Nodes</option>
             <option value="Ingest">Ingest</option>
             <option value="Deobfuscation">Deobfuscation</option>
             <option value="LLMTriage">LLMTriage</option>
             <option value="Action">Action</option>
           </select>
        </div>
        <button 
          onClick={() => setIsPaused(!isPaused)}
          className={`px-3 py-1 rounded transition-colors ${isPaused ? 'bg-amber-900/50 text-amber-500 border border-amber-500/50' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'}`}
        >
          {isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed flex flex-col-reverse">
        {[...filteredEvents].reverse().map((e, idx) => (
          <div key={`${e.correlationId}-${idx}`} className="flex items-start hover:bg-slate-900/50 p-1 rounded group">
            <span className="text-slate-500 w-16 shrink-0">{new Date(e.timestamp).toLocaleTimeString([], {hour12:false})}</span>
            
            <span className={`w-28 shrink-0 font-bold ${
                e.status === 'started' ? 'text-blue-400' : 
                e.status === 'completed' ? 'text-emerald-400' : 
                'text-red-400'
            }`}>
              [{e.node}]
            </span>
            
            <span className="text-slate-400 flex-1 break-all">
              {e.status.toUpperCase()}
              {e.provider && <span className="text-indigo-400 ml-2">via {e.provider}</span>}
              {e.latencyMs && <span className="text-slate-600 ml-2">({e.latencyMs.toFixed(1)}ms)</span>}
              {e.fallbackTriggered && <span className="text-amber-500 ml-2">⚠ Fallback: {e.fallbackReason}</span>}
              {e.summary && <span className="text-slate-300 ml-2">- {e.summary}</span>}
              {e.investigationId && (
                <Link to={`/investigations/${e.investigationId}`} className="text-blue-500 hover:text-blue-400 ml-2 underline">
                  {e.investigationId}
                </Link>
              )}
            </span>
          </div>
        ))}
        {events.length === 0 && <div className="text-slate-500 text-center py-8 italic">Waiting for agent telemetry...</div>}
      </div>
    </div>
  );
}
