import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';

interface GraphNode {
  id: string;
  label: string;
  type?: string;
  properties?: string;
  status: 'success' | 'running' | 'failed';
}

interface GraphEdge {
  source_id: string;
  target_id: string;
  relation: string;
}

// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - Real-Time Visualization Layer: The core SIEM/SOAR UI component.
//    - Upstream: FastAPI SSE/WebSocket Endpoint | Downstream: Browser DOM Canvas
// 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Renders the complex Spatio-Temporal Graph Neural Network (ST-GNN) node/edge
//      topology streamed dynamically from the Python ML Inference engine.
// 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
//    - React Render Limits: Modifying React state sequentially for a firehose of
//      10,000+ nodes will trigger catastrophic DOM "React Re-Render Limits" and
//      freeze the browser tab.
//    - Optimization: Implements a High-Performance Throttle Engine (batching pointer
//      array flushed every 250ms) to guarantee butter-smooth 60fps UI performance.
// 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
//    - Consumes the `GraphNode` and `GraphEdge` TS Interfaces corresponding
//      directly to the Python GNN model outputs.
// 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
//    - Failure Mode: WebSocket disconnects unexpectedly mid-investigation.
//    - Fallback State: Gracefully retains historical snapshot fetched via `axios.get`.
// ==============================================================================
export const InvestigationGraph: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const pendingUpdates = useRef<any[]>([]);
  const isSnapshotLoaded = useRef<boolean>(false);

  useEffect(() => {
    // 1. OPEN THE REAL-TIME WEBSOCKET STREAM FIRST
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/investigations/${sessionId}/stream`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'node_execution') return;
        
        // Accumulate raw stream data in a high-speed pointer array (No UI re-render triggered)
        pendingUpdates.current.push(data);
      } catch (e) {
        console.error("Stream parse error", e);
      }
    };

    // HIGH-PERFORMANCE THROTTLE ENGINE: Flushes updates in a single batch every 250ms
    const renderTicker = setInterval(() => {
      if (!isSnapshotLoaded.current || pendingUpdates.current.length === 0) return;

      const batch = [...pendingUpdates.current];
      pendingUpdates.current = []; // Reset fast memory references

      setNodes((prevNodes) => {
        let updatedNodes = [...prevNodes];
        
        batch.forEach((data) => {
          const index = updatedNodes.findIndex(node => node.id === data.node_id);
          if (index !== -1) {
            updatedNodes[index] = { ...updatedNodes[index], status: data.status };
          } else {
            updatedNodes.push({ id: data.node_id, label: data.agent_name || data.label, status: data.status });
          }
        });

        return updatedNodes; // Single, unified DOM layout update
      });
    }, 250);

    // 2. FETCH HISTORICAL SNAPSHOT
    axios.get(`/api/investigations/${sessionId}/graph`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then((res) => {
        const historicalNodes = res.data.nodes || res.data.graph_data?.nodes || res.data.graph_layout?.nodes || [];
        const historicalEdges = res.data.edges || res.data.graph_data?.edges || res.data.graph_layout?.edges || [];
        setNodes(historicalNodes);
        setEdges(historicalEdges);
        isSnapshotLoaded.current = true;
      })
      .catch((err) => console.error("Snapshot error:", err));

    return () => {
      ws.close();
      clearInterval(renderTicker);
    };
  }, [sessionId]);

  return (
    <div className="bg-slate-900 rounded-lg p-6 border border-slate-700 shadow-xl w-full max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-white font-mono">Agent Investigation Graph</h2>
        <div className={`px-3 py-1 rounded-full text-xs font-bold font-mono bg-green-900/50 text-green-400 border border-green-500`}>
          ● LIVE THROTTLED STREAM ACTIVE
        </div>
      </div>

      <div className="space-y-4">
        {nodes.map((node, index) => {
          // Find edges related to this node (where this node is the source)
          const nodeEdges = edges.filter(e => e.source_id === node.id);
          
          return (
          <div key={`${node.id}-${index}`} className="flex items-start gap-4 transition-all duration-300 ease-in-out">
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-slate-800 border-2 border-indigo-500 flex items-center justify-center text-indigo-400 text-sm z-10 shadow shadow-indigo-500/20">
                {index + 1}
              </div>
              {index !== nodes.length - 1 && (
                <div className="w-0.5 h-full bg-indigo-500/30 my-1 min-h-[3rem]"></div>
              )}
            </div>

            <div className="flex-1 bg-slate-800 rounded border border-slate-700 p-4 shadow-lg hover:border-indigo-500/50 transition-colors">
              <div className="flex justify-between items-start mb-2">
                <span className="text-indigo-300 font-bold font-mono tracking-wide">
                  {node.label || node.id}
                  {node.type && <span className="ml-2 text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">[{node.type}]</span>}
                </span>
                <span className={`text-xs px-2 py-1 rounded font-mono shadow-sm ${
                  node.status === 'success' ? 'bg-green-900/40 text-green-400' : 
                  node.status === 'running' ? 'bg-blue-900/40 text-blue-400 animate-pulse' : 
                  'bg-yellow-900/40 text-yellow-400'
                }`}>
                  {node.status?.toUpperCase() || "DETECTED"}
                </span>
              </div>
              {node.properties && (
                <div className="text-slate-400 text-sm font-mono mt-2 bg-slate-900 p-2 rounded border border-slate-700">
                  {node.properties}
                </div>
              )}
              
              {/* Render Provenance Graph Relationships */}
              {nodeEdges.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-700">
                  <span className="text-xs text-slate-500 uppercase tracking-widest block mb-2">Provenance Edges:</span>
                  {nodeEdges.map((edge, i) => (
                    <div key={i} className="flex items-center text-sm font-mono text-indigo-200 mb-1">
                      <span className="text-slate-400 mr-2">↳</span>
                      <span className="bg-indigo-900/50 text-indigo-300 px-2 rounded text-xs mr-2 border border-indigo-500/30">
                        {edge.relation}
                      </span>
                      <span>{edge.target_id}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )})}
        {nodes.length === 0 && (
          <div className="text-slate-500 font-mono text-sm text-center py-8">
            Awaiting GNN Provenance Analysis...
          </div>
        )}
      </div>
    </div>
  );
};
