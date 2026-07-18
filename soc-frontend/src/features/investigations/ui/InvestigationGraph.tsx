import React, { useEffect, useState, useRef } from 'react';
import { ConnectionStatus, GraphNode, GraphEdge } from '@/types';
import { getValidToken } from '@/shared/hooks/useAuthApi';
import apiClient from '@/shared/hooks/useAuthApi';

const MAX_BACKOFF_MS = 30000;

export const InvestigationGraph: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const pendingUpdates = useRef<Array<{ node_id: string; agent_name?: string; label?: string; status: GraphNode['status'] }>>([]);
  const isSnapshotLoaded = useRef<boolean>(false);
  const retryCount = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSnapshot = async () => {
    setSnapshotError(null);
    const token = getValidToken();
    try {
      const res = await apiClient.get(`/investigations/${sessionId}/graph`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const historicalNodes = res.data.nodes ?? res.data.graph_data?.nodes ?? [];
      const historicalEdges = res.data.edges ?? res.data.graph_data?.edges ?? [];
      setNodes(historicalNodes);
      setEdges(historicalEdges);
      isSnapshotLoaded.current = true;
    } catch {
      setSnapshotError('Failed to load investigation snapshot. The graph may be incomplete.');
    }
  };

  const connectWebSocket = () => {
    if (wsRef.current) wsRef.current.close();
    setConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getValidToken();
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/investigations/${sessionId}/stream?token=${token ?? ''}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('live');
      retryCount.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'node_execution') return;
        pendingUpdates.current.push(data);
      } catch (e) {
        console.error('Stream parse error', e);
      }
    };

    ws.onclose = () => {
      setConnectionStatus('reconnecting');
      scheduleReconnect();
    };

    ws.onerror = () => {
      setConnectionStatus('reconnecting');
    };
  };

  const scheduleReconnect = () => {
    const backoff = Math.min(1000 * Math.pow(2, retryCount.current), MAX_BACKOFF_MS);
    retryCount.current += 1;
    retryTimerRef.current = setTimeout(connectWebSocket, backoff);
  };

  useEffect(() => {
    fetchSnapshot();
    connectWebSocket();

    const renderTicker = setInterval(() => {
      if (!isSnapshotLoaded.current || pendingUpdates.current.length === 0) return;
      const batch = [...pendingUpdates.current];
      pendingUpdates.current = [];
      setNodes((prev) => {
        const updated = [...prev];
        batch.forEach((data) => {
          const idx = updated.findIndex((n) => n.id === data.node_id);
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], status: data.status };
          } else {
            updated.push({
              id: data.node_id,
              label: data.agent_name ?? data.label ?? data.node_id,
              status: data.status,
            });
          }
        });
        return updated;
      });
    }, 250);

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      clearInterval(renderTicker);
    };
  }, [sessionId]);

  const svgWidth = 680;
  const svgHeight = 300;
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const cols = Math.ceil(Math.sqrt(nodes.length || 1));
  nodes.forEach((node, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    nodePositions[node.id] = {
      x: 80 + col * (svgWidth / cols),
      y: 60 + row * (svgHeight / Math.ceil(nodes.length / cols || 1)),
    };
  });

  const statusColor = (status: GraphNode['status']) =>
    status === 'success' ? '#4ade80' : status === 'running' ? '#60a5fa' : '#f87171';

  const connectionBadgeStyle: Record<ConnectionStatus, { bg: string; text: string; label: string }> = {
    connecting:    { bg: 'rgba(250,204,21,0.15)',  text: '#facc15', label: '◉ CONNECTING'    },
    live:          { bg: 'rgba(74,222,128,0.15)',  text: '#4ade80', label: '● LIVE'           },
    reconnecting:  { bg: 'rgba(251,146,60,0.15)',  text: '#fb923c', label: '↻ RECONNECTING'  },
    disconnected:  { bg: 'rgba(248,113,113,0.15)', text: '#f87171', label: '✕ DISCONNECTED'  },
  };
  const badge = connectionBadgeStyle[connectionStatus];

  return (
    <div className="bg-slate-900 rounded-lg p-6 border border-slate-700 shadow-xl w-full max-w-4xl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ color: 'white', fontFamily: 'monospace', fontWeight: 700, fontSize: '1.2rem' }}>
          Agent Investigation Graph
        </h2>
        <span style={{
          padding: '2px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
          fontFamily: 'monospace', background: badge.bg, color: badge.text,
          border: `1px solid ${badge.text}55`
        }}>
          {badge.label}
        </span>
      </div>

      {snapshotError && (
        <div role="alert" style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: '6px', padding: '0.75rem', marginBottom: '1rem',
          color: '#fca5a5', fontFamily: 'monospace', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          ⚠ {snapshotError}
          <button onClick={fetchSnapshot}
            style={{ color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}>
            Retry
          </button>
        </div>
      )}

      {nodes.length > 0 ? (
        <>
          <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} style={{ background: 'rgba(15,23,42,0.5)', borderRadius: '8px' }}>
            {edges.map((edge, i) => {
              const src = nodePositions[edge.source_id];
              const tgt = nodePositions[edge.target_id];
              if (!src || !tgt) return null;
              return (
                <line key={i} x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                  stroke="#334155" strokeWidth="1.5" markerEnd="url(#arrow)" />
              );
            })}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#475569" />
              </marker>
            </defs>
            {nodes.map((node) => {
              const pos = nodePositions[node.id];
              if (!pos) return null;
              const color = statusColor(node.status);
              return (
                <g key={node.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedNode(node)}>
                  <circle cx={pos.x} cy={pos.y} r={18} fill={`${color}22`}
                    stroke={color} strokeWidth={selectedNode?.id === node.id ? 3 : 1.5} />
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle"
                    fill={color} fontSize="10" fontFamily="monospace">
                    {node.status === 'running' ? '⟳' : node.status === 'success' ? '✓' : '✕'}
                  </text>
                  <text x={pos.x} y={pos.y + 28} textAnchor="middle"
                    fill="#94a3b8" fontSize="9" fontFamily="monospace">
                    {(node.label ?? node.id).substring(0, 14)}
                  </text>
                </g>
              );
            })}
          </svg>

          {selectedNode && (
            <div style={{
              marginTop: '1rem', background: 'rgba(30,41,59,0.8)', border: '1px solid #334155',
              borderRadius: '8px', padding: '1rem', fontFamily: 'monospace', fontSize: '13px', color: '#e2e8f0',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{selectedNode.label}</strong>
                <button onClick={() => setSelectedNode(null)}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>✕</button>
              </div>
              <div style={{ color: '#64748b', marginTop: '4px' }}>ID: {selectedNode.id}</div>
              {selectedNode.type && <div>Type: <span style={{ color: '#60a5fa' }}>{selectedNode.type}</span></div>}
              <div>Status: <span style={{ color: statusColor(selectedNode.status) }}>{selectedNode.status.toUpperCase()}</span></div>
              {selectedNode.properties && <div style={{ marginTop: '8px', background: '#0f172a', padding: '6px', borderRadius: '4px' }}>{selectedNode.properties}</div>}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: '#475569', fontFamily: 'monospace', textAlign: 'center', padding: '3rem' }}>
          Awaiting GNN Provenance Analysis…
        </div>
      )}
    </div>
  );
};
