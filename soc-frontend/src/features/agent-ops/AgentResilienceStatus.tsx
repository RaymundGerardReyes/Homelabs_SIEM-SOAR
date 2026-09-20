import React, { useState, useEffect, useRef } from 'react';

interface AgentNode {
  name: 'Ingest' | 'Deobfuscation' | 'LLMTriage' | 'Action';
  status: 'healthy' | 'degraded' | 'failed' | 'idle';
  latencyMs: number;
  lastEventAt: string | null;
  fallbackRate: number; // 0-100 percent
}

interface ResilienceData {
  nodes: AgentNode[];
  totalProcessed: number;
  fallbackTotal: number;
  provider: string;
}

const MOCK_INITIAL: ResilienceData = {
  nodes: [
    { name: 'Ingest', status: 'healthy', latencyMs: 12, lastEventAt: new Date().toISOString(), fallbackRate: 0 },
    { name: 'Deobfuscation', status: 'healthy', latencyMs: 340, lastEventAt: new Date().toISOString(), fallbackRate: 2 },
    { name: 'LLMTriage', status: 'degraded', latencyMs: 1820, lastEventAt: new Date().toISOString(), fallbackRate: 18 },
    { name: 'Action', status: 'healthy', latencyMs: 55, lastEventAt: new Date().toISOString(), fallbackRate: 0 },
  ],
  totalProcessed: 4821,
  fallbackTotal: 91,
  provider: 'openai/gpt-4o-mini',
};

function statusColor(status: AgentNode['status']): string {
  switch (status) {
    case 'healthy': return 'text-emerald-400';
    case 'degraded': return 'text-amber-400';
    case 'failed':   return 'text-red-400';
    default:         return 'text-slate-500';
  }
}

function statusBg(status: AgentNode['status']): string {
  switch (status) {
    case 'healthy': return 'bg-emerald-500';
    case 'degraded': return 'bg-amber-500 animate-pulse';
    case 'failed':   return 'bg-red-500 animate-pulse';
    default:         return 'bg-slate-600';
  }
}

function latencyColor(ms: number): string {
  if (ms < 200) return 'text-emerald-400';
  if (ms < 1000) return 'text-amber-400';
  return 'text-red-400';
}

export default function AgentResilienceStatus() {
  const [data, setData] = useState<ResilienceData>(MOCK_INITIAL);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Attempt to receive real-time updates from the agent stream WebSocket.
    // On message, we look for a 'resilience' type update.
    const connect = () => {
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/ws/agent/stream`);

        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          setTimeout(connect, 5000);
        };
        ws.onerror = () => {
          setConnected(false);
        };
        ws.onmessage = (msg) => {
          try {
            const d = JSON.parse(msg.data);
            if (d.type === 'resilience') {
              setData(d.payload);
            }
            // Also update latency from live agent events
            if (d.type === 'live' && d.event?.latencyMs && d.event?.node) {
              setData(prev => ({
                ...prev,
                totalProcessed: prev.totalProcessed + 1,
                nodes: prev.nodes.map(n =>
                  n.name === d.event.node
                    ? { ...n, latencyMs: d.event.latencyMs, lastEventAt: d.event.timestamp,
                        status: d.event.status === 'failed' ? 'degraded' : 'healthy' }
                    : n
                ),
              }));
            }
          } catch (_) {
            // Ignore non-JSON WS frames
          }
        };
        wsRef.current = ws;
      } catch (_) {
        // WebSocket may not be available; fall back to mock
      }
    };

    connect();
    return () => wsRef.current?.close();
  }, []);

  const fallbackRate = data.totalProcessed > 0
    ? ((data.fallbackTotal / data.totalProcessed) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest">
            🧠 LangGraph Node Resilience
          </h3>
          <div className="flex items-center space-x-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
            <span className={`text-xs font-mono ${connected ? 'text-emerald-400' : 'text-slate-500'}`}>
              {connected ? 'LIVE' : 'MOCK'}
            </span>
          </div>
        </div>
        <div className="flex items-center space-x-4 text-xs text-slate-400">
          <span>Provider: <span className="text-indigo-400 font-mono">{data.provider}</span></span>
          <span>Processed: <span className="text-white font-bold">{data.totalProcessed.toLocaleString()}</span></span>
          <span>Fallback Rate: <span className={`font-bold ${parseFloat(fallbackRate) > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>{fallbackRate}%</span></span>
        </div>
      </div>

      {/* Node Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {data.nodes.map((node, i) => (
          <div
            key={node.name}
            className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col space-y-2 hover:border-slate-600 transition-colors"
          >
            {/* Node Name + Status Dot */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                {['①','②','③','④'][i]} {node.name}
              </span>
              <span className={`w-2.5 h-2.5 rounded-full ${statusBg(node.status)}`} />
            </div>

            {/* Status Badge */}
            <span className={`text-[11px] font-semibold uppercase tracking-wider ${statusColor(node.status)}`}>
              {node.status}
            </span>

            {/* Latency Bar */}
            <div>
              <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                <span>Latency</span>
                <span className={`font-mono font-bold ${latencyColor(node.latencyMs)}`}>
                  {node.latencyMs}ms
                </span>
              </div>
              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    node.latencyMs < 200 ? 'bg-emerald-500' :
                    node.latencyMs < 1000 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min((node.latencyMs / 2000) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Fallback Rate */}
            {node.fallbackRate > 0 && (
              <div className="text-[10px] text-amber-500 font-mono">
                ⚠ {node.fallbackRate}% fallback
              </div>
            )}

            {/* Last Seen */}
            {node.lastEventAt && (
              <div className="text-[10px] text-slate-600">
                Last: {new Date(node.lastEventAt).toLocaleTimeString([], { hour12: false })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pipeline flow arrow */}
      <div className="hidden md:flex items-center justify-center mt-3 space-x-2 text-[10px] text-slate-700 font-mono">
        {data.nodes.map((n, i) => (
          <React.Fragment key={n.name}>
            <span className={statusColor(n.status)}>{n.name}</span>
            {i < data.nodes.length - 1 && <span>→</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
