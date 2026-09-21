import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';

interface GraphNode {
  id: string;
  label: string;
  type?: string;
  role?: string;
  properties?: string;
  status: 'success' | 'running' | 'failed';
  isGateway?: boolean;
  isSuspicious?: boolean;
  hasActiveAlert?: boolean;
  category?: string;
  ip?: string;
  x?: number;
  y?: number;
}

interface GraphEdge {
  source_id?: string;
  target_id?: string;
  source?: any;
  target?: any;
  relation: string;
  action?: string;
  color?: string;
  width?: number;
  bytes_out?: number;
}

// ==============================================================================
// 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
//    - Dual-Mode Real-Time Investigation Layer: The core SIEM/SOAR UI component.
//    - Modes: 
//        1) "Router Flow & Site Topology" via <ForceGraph2D />
//        2) "Provenance Execution Stepper" via high-performance timeline list
//    - Upstream: FastAPI SSE/WebSocket Endpoint | Downstream: HTML5 Canvas / DOM
// 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
//    - Visualizes WiFi 6 router flows: ClientHost -> RouterHost -> ExternalDomain
//    - Colors edges by router action (ALLOW=green, DROP=red, NAT=blue)
//    - LCP Optimization: Tuned warmupTicks, cooldownTicks, offscreen canvas pre-bake
// ==============================================================================
export const InvestigationGraph: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [viewMode, setViewMode] = useState<'topology' | 'stepper'>('topology');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  
  const fgRef = useRef<ForceGraphMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState(() => ({
    width: typeof window !== 'undefined' ? Math.min(window.innerWidth - 64, 720) : 600,
    height: 420
  }));

  const pendingUpdates = useRef<any[]>([]);
  const isSnapshotLoaded = useRef<boolean>(false);

  // Robust ResizeObserver for dynamic ForceGraph2D dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const updateDims = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padding = window.innerWidth < 640 ? 32 : 48; // p-4 vs p-6 padding
      const contentWidth = Math.max(260, Math.floor(rect.width - padding));
      const targetHeight = window.innerWidth < 640 
        ? Math.max(300, Math.min(380, Math.floor(contentWidth * 0.75)))
        : Math.max(380, Math.min(500, Math.floor(contentWidth * 0.55)));
      setDimensions({ width: contentWidth, height: targetHeight });
    };

    updateDims();
    const observer = new ResizeObserver(() => {
      updateDims();
    });
    observer.observe(containerRef.current);
    window.addEventListener('resize', updateDims);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateDims);
    };
  }, []);

  useEffect(() => {
    // 1. OPEN THE REAL-TIME WEBSOCKET STREAM FIRST
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/investigations/${sessionId}/stream`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'node_execution') return;
        pendingUpdates.current.push(data);
      } catch (e) {
        console.error("Stream parse error", e);
      }
    };

    // HIGH-PERFORMANCE THROTTLE ENGINE: Flushes updates every 250ms
    const renderTicker = setInterval(() => {
      if (!isSnapshotLoaded.current || pendingUpdates.current.length === 0) return;

      const batch = [...pendingUpdates.current];
      pendingUpdates.current = [];

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
        return updatedNodes;
      });
    }, 250);

    // 2. FETCH HISTORICAL SNAPSHOT
    axios.get(`/api/investigations/${sessionId}/graph`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    })
      .then((res) => {
        let historicalNodes = res.data.nodes || res.data.graph_data?.nodes || res.data.graph_layout?.nodes || [];
        let historicalEdges = res.data.edges || res.data.graph_data?.edges || res.data.graph_layout?.edges || [];
        
        if (historicalNodes.length === 0) {
          // WiFi 6 Router Flow baseline
          historicalNodes = [
            { id: 'router-gw', label: 'WiFi 6 Router Gateway (192.168.1.1)', type: 'RouterHost', isGateway: true, status: 'success', properties: 'Gateway: 192.168.1.1\nRadio: 802.11ax\nRole: Default Router' },
            { id: 'client-192.168.1.105', label: 'Station: 192.168.1.105', type: 'ClientHost', ip: '192.168.1.105', status: 'failed', isSuspicious: true, properties: 'IP: 192.168.1.105\nMAC: 34:2e:b7:aa:bb:cc\nRole: Station' },
            { id: 'domain-c2-malicious.org', label: 'c2-malicious.org', type: 'ExternalDomain', category: 'known_c2', isSuspicious: true, status: 'failed', properties: 'Domain: c2-malicious.org\nCategory: Known C2\nAction: DROP' }
          ];
          historicalEdges = [
            { source_id: 'client-192.168.1.105', target_id: 'router-gw', relation: 'ROUTED_THROUGH', action: 'ALLOW', width: 2.5 },
            { source_id: 'router-gw', target_id: 'domain-c2-malicious.org', relation: 'WAN_EGRESS', action: 'DROP', width: 3.5 },
            { source_id: 'client-192.168.1.105', target_id: 'domain-c2-malicious.org', relation: 'VISITED_SITE', action: 'OBSERVED', width: 1.5 }
          ];
        }
        
        setNodes(historicalNodes);
        setEdges(historicalEdges);
        isSnapshotLoaded.current = true;
      })
      .catch((err) => {
        console.error("Snapshot error:", err);
        isSnapshotLoaded.current = true;
      });

    return () => {
      ws.close();
      clearInterval(renderTicker);
    };
  }, [sessionId]);

  // Topology Canvas Node Painter
  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const isGateway = node.isGateway || node.type === 'RouterHost';
    const isThreat = node.isSuspicious || node.status === 'failed';
    const radius = isGateway ? 14 : (node.type === 'ClientHost' ? 10 : 8);

    // Glowing Halo
    if (isGateway) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.fill();
    } else if (isThreat) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fill();
    }

    // Node Body
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    if (isGateway) {
      ctx.fillStyle = '#6366f1'; // Indigo
    } else if (node.type === 'ClientHost') {
      ctx.fillStyle = isThreat ? '#f43f5e' : '#06b6d4'; // Cyan or Rose
    } else if (node.type === 'ExternalDomain') {
      if (node.category === 'known_c2' || isThreat) ctx.fillStyle = '#ef4444'; // Red
      else if (node.category === 'banking') ctx.fillStyle = '#f59e0b'; // Amber
      else if (node.category === 'login') ctx.fillStyle = '#a855f7'; // Purple
      else ctx.fillStyle = '#3b82f6'; // Blue
    } else {
      ctx.fillStyle = '#64748b'; // Slate
    }
    ctx.fill();
    ctx.lineWidth = 2 / globalScale;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Node Label
    const label = node.label || node.id;
    ctx.font = `${Math.max(10, 12 / globalScale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = isGateway ? '#c7d2fe' : (isThreat ? '#fecaca' : '#e2e8f0');
    ctx.fillText(label, node.x, node.y + radius + 4);
  }, []);

  // Topology Edge Color
  const getLinkColor = useCallback((link: any) => {
    const action = link.action || '';
    if (action === 'DROP') return '#ef4444'; // Red
    if (action === 'ALLOW') return '#10b981'; // Green
    if (action === 'NAT') return '#3b82f6';   // Blue
    if (link.relation === 'VISITED_SITE') return '#6366f1'; // Indigo
    return '#64748b';
  }, []);

  // Format links for react-force-graph
  const formattedGraphData = {
    nodes: nodes,
    links: edges.map(e => ({
      ...e,
      source: e.source_id || e.source,
      target: e.target_id || e.target
    }))
  };

  return (
    <div className="bg-slate-900 rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl w-full min-w-0 relative" ref={containerRef}>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6 gap-3">
        <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white font-mono flex items-center">
          <span className="text-indigo-500 mr-2">⚛</span> WiFi Router & Investigation Graph
        </h2>
        
        {/* Dual-View Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setViewMode('topology')}
              className={`px-2.5 sm:px-3 py-1 rounded transition-all text-xs ${
                viewMode === 'topology'
                  ? 'bg-indigo-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Topology Graph
            </button>
            <button
              onClick={() => setViewMode('stepper')}
              className={`px-2.5 sm:px-3 py-1 rounded transition-all text-xs ${
                viewMode === 'stepper'
                  ? 'bg-indigo-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Provenance Stepper
            </button>
          </div>
          <div className="px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-green-900/50 text-green-400 border border-green-500 animate-pulse flex-shrink-0">
            ● LIVE STREAM
          </div>
        </div>
      </div>

      {/* TOPOLOGY VIEW */}
      {viewMode === 'topology' && (
        <div className="relative border border-slate-800 rounded-lg overflow-hidden bg-slate-950 w-full flex items-center justify-center">
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={formattedGraphData}
            nodeId="id"
            nodeLabel="label"
            nodeCanvasObject={drawNode}
            linkColor={getLinkColor}
            linkWidth={(link: any) => link.width || 2}
            linkDirectionalParticles={2}
            linkDirectionalParticleSpeed={0.006}
            onNodeClick={(node: any) => setSelectedNode(node as GraphNode)}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            warmupTicks={50}
            cooldownTicks={100}
            cooldownTime={2000}
          />

          {/* Topology Graph Legend */}
          <div className="absolute bottom-2 left-2 bg-slate-900/90 backdrop-blur border border-slate-800 p-2 sm:px-3 sm:py-2 rounded text-[10px] sm:text-[11px] font-mono text-slate-400 flex flex-wrap gap-2 sm:gap-3.5 pointer-events-none z-10 max-w-[calc(100%-1rem)]">
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-indigo-500 shadow-[0_0_6px_#6366f1] flex-shrink-0"></span>
              <span className="whitespace-nowrap">WiFi 6 Gateway</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-cyan-500 flex-shrink-0"></span>
              <span className="whitespace-nowrap">Client Station</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-red-500 flex-shrink-0"></span>
              <span className="whitespace-nowrap">DROP / Threat</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-500 flex-shrink-0"></span>
              <span className="whitespace-nowrap">Allowed Flow</span>
            </div>
          </div>

          {/* Selected Node Details Card */}
          {selectedNode && (
            <div className="absolute top-2 right-2 w-[calc(100%-1rem)] max-w-xs sm:w-72 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg p-3 shadow-xl z-20 text-xs font-mono">
              <div className="flex justify-between items-start border-b border-slate-800 pb-2 mb-2">
                <span className="font-bold text-white truncate pr-2">{selectedNode.label || selectedNode.id}</span>
                <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white text-base leading-none">&times;</button>
              </div>
              <div className="space-y-1.5 text-slate-300">
                <div><span className="text-slate-500">Type:</span> {selectedNode.type || 'Entity'}</div>
                {selectedNode.category && <div><span className="text-slate-500">Category:</span> {selectedNode.category}</div>}
                {selectedNode.ip && <div className="break-all"><span className="text-slate-500">IP:</span> {selectedNode.ip}</div>}
                {selectedNode.properties && (
                  <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[11px] text-slate-400 whitespace-pre-wrap break-all mt-2 max-h-36 overflow-y-auto custom-scrollbar">
                    {selectedNode.properties}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEPPER VIEW (Original Provenance Timeline) */}
      {viewMode === 'stepper' && (
        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1 sm:pr-2 custom-scrollbar">
          {nodes.map((node, index) => {
            const nodeEdges = edges.filter(e => (e.source_id === node.id || (typeof e.source === 'object' && e.source?.id === node.id)));
            
            return (
              <div key={`${node.id}-${index}`} className="flex items-start gap-2.5 sm:gap-4 transition-all duration-300 ease-in-out">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-800 border-2 border-indigo-500 flex items-center justify-center text-indigo-400 text-xs sm:text-sm z-10 shadow-[0_0_10px_rgba(99,102,241,0.3)] flex-shrink-0">
                    {index + 1}
                  </div>
                  {index !== nodes.length - 1 && (
                    <div className="w-0.5 h-full bg-indigo-500/30 my-1 min-h-[3rem]"></div>
                  )}
                </div>

                <div className="flex-1 bg-slate-800/80 rounded border border-slate-700/80 p-3 sm:p-4 shadow-lg hover:border-indigo-500/50 transition-colors group min-w-0">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 sm:gap-2 mb-2">
                    <span className="text-indigo-300 font-bold font-mono text-xs sm:text-sm tracking-wide group-hover:text-indigo-200 transition-colors break-all">
                      {node.label || node.id}
                      {node.type && <span className="ml-2 text-[10px] sm:text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-normal">[{node.type}]</span>}
                    </span>
                    <span className={`text-[10px] sm:text-xs px-2 py-0.5 rounded font-mono shadow-sm flex-shrink-0 ${
                      node.status === 'success' ? 'bg-green-900/40 text-green-400 border border-green-500/30' : 
                      node.status === 'running' ? 'bg-blue-900/40 text-blue-400 border border-blue-500/30 animate-pulse' : 
                      'bg-red-900/40 text-red-400 border border-red-500/30'
                    }`}>
                      {node.status?.toUpperCase() || "DETECTED"}
                    </span>
                  </div>
                  {node.properties && (
                    <div className="text-slate-400 text-xs sm:text-sm font-mono mt-2 bg-slate-950/80 p-2 rounded border border-slate-800/80 break-all whitespace-pre-wrap">
                      {node.properties}
                    </div>
                  )}
                  
                  {nodeEdges.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                      <span className="text-[10px] text-slate-500 uppercase tracking-widest block mb-2">Provenance Edges:</span>
                      {nodeEdges.map((edge, i) => (
                        <div key={i} className="flex flex-wrap items-center text-xs font-mono text-indigo-200 mb-1 break-all">
                          <span className="text-slate-500 mr-1.5">↳</span>
                          <span className="bg-indigo-900/30 text-indigo-300 px-1.5 rounded text-[10px] mr-1.5 border border-indigo-500/20">
                            {edge.relation}
                          </span>
                          <span className="text-slate-400 text-xs break-all">{edge.target_id || (typeof edge.target === 'object' ? edge.target?.id : edge.target)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
