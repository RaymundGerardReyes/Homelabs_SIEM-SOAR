import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, StatusDot, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { NetworkMapNode, NetworkMapEdge } from '../../shared/types';

interface EnhancedNode extends NetworkMapNode {
  riskScore?: number;
  segment?: string;
  isNew?: boolean;
}

interface EnhancedEdge extends NetworkMapEdge {
  isViolation?: boolean;
  isNew?: boolean;
}

export default function NetworkMapPage() {
  const { data, loading, error, execute } = useAsyncState<{ nodes: EnhancedNode[], edges: EnhancedEdge[] }>(async () => {
    const res = await apiClient.get('/assets/network-map');
    const nodes = res.data.nodes.map((n: any, i: number) => ({
      ...n,
      riskScore: Math.floor(Math.random() * 100),
      segment: i % 3 === 0 ? 'DMZ' : i % 2 === 0 ? 'Production' : 'Corporate',
      isNew: i === 4
    }));
    const edges = res.data.edges.map((e: any, i: number) => ({
      ...e,
      isViolation: i % 5 === 0, // Mock unexpected cross-segment connectivity
      isNew: i === 6
    }));
    return { nodes, edges };
  });

  const [selectedNode, setSelectedNode] = useState<EnhancedNode | null>(null);
  const [overlayMode, setOverlayMode] = useState<'standard' | 'heat' | 'segmentation' | 'diff'>('standard');
  const [simulatingPath, setSimulatingPath] = useState(false);
  
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { execute(); }, [execute]);

  // Calculate reachable nodes from selected node (mock BFS)
  const reachableNodes = useMemo(() => {
    if (!simulatingPath || !selectedNode || !data) return new Set<string>();
    const visited = new Set<string>([selectedNode.id]);
    const queue = [selectedNode.id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      data.edges.forEach(e => {
         if (e.source === curr && !visited.has(e.target)) {
            visited.add(e.target);
            queue.push(e.target);
         }
         // Undirected fallback for visualization
         if (e.target === curr && !visited.has(e.source)) {
            visited.add(e.source);
            queue.push(e.source);
         }
      });
    }
    return visited;
  }, [simulatingPath, selectedNode, data]);

  const handleExport = () => {
    if (!mapRef.current) return;
    alert('Exporting network map is mocked for now in this demo (html-to-image required).');
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="h-[calc(100vh-4rem)] bg-slate-950 flex flex-col relative overflow-hidden rounded-xl border border-slate-800 shadow-2xl mt-4 mx-4 mb-4">
      <div className="p-4 border-b border-slate-800 bg-slate-900 z-20 flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Network Topology & Attack Surface</h1>
          <p className="text-xs text-slate-500">Visualize lateral movement paths and policy violations.</p>
        </div>
        
        <div className="flex space-x-2">
          <select 
            value={overlayMode} 
            onChange={(e: any) => setOverlayMode(e.target.value)} 
            className="bg-slate-950 border border-slate-700 text-slate-300 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="standard">Standard View</option>
            <option value="heat">Risk Heat Map</option>
            <option value="segmentation">Segmentation Policy</option>
            <option value="diff">Topology Diff (7 Days)</option>
          </select>
          <button onClick={handleExport} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm transition-colors border border-slate-700">
            Export for Tabletop
          </button>
        </div>
      </div>
      
      <div className="flex-1 relative bg-slate-950 overflow-hidden" ref={mapRef}>
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
          {data?.edges.map((e, idx) => {
            const src = data.nodes.find(n => n.id === e.source);
            const tgt = data.nodes.find(n => n.id === e.target);
            if (!src || !tgt) return null;
            
            let strokeColor = '#334155';
            let strokeWidth = "2";
            let dashArray = "";
            
            if (simulatingPath && (reachableNodes.has(e.source) && reachableNodes.has(e.target))) {
               strokeColor = '#ef4444';
               strokeWidth = "3";
            } else if (overlayMode === 'segmentation' && e.isViolation) {
               strokeColor = '#f59e0b';
               strokeWidth = "3";
               dashArray = "4 4";
            } else if (overlayMode === 'diff' && e.isNew) {
               strokeColor = '#10b981';
               strokeWidth = "3";
            }
            
            return (
              <line 
                key={idx} 
                x1={`${src.x}%`} y1={`${src.y}%`} 
                x2={`${tgt.x}%`} y2={`${tgt.y}%`} 
                stroke={strokeColor} 
                strokeWidth={strokeWidth} 
                strokeDasharray={dashArray}
                className={`transition-all duration-500 ${simulatingPath && !(reachableNodes.has(e.source) && reachableNodes.has(e.target)) ? 'opacity-20' : 'opacity-70'}`}
              />
            );
          })}
        </svg>

        {data?.nodes.map(node => {
           let bgClass = 'bg-slate-900';
           let borderClass = node.hasActiveAlert ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-blue-500';
           let textClass = 'text-white';
           
           if (simulatingPath && !reachableNodes.has(node.id)) {
              bgClass = 'bg-slate-900/50';
              borderClass = 'border-slate-800';
              textClass = 'text-slate-600';
           }
           
           if (overlayMode === 'heat') {
              const risk = node.riskScore || 0;
              if (risk > 80) { bgClass = 'bg-red-900'; borderClass = 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.6)]'; }
              else if (risk > 50) { bgClass = 'bg-orange-900'; borderClass = 'border-orange-500'; }
              else { bgClass = 'bg-green-900'; borderClass = 'border-green-500'; }
           }
           
           if (overlayMode === 'segmentation') {
              if (node.segment === 'DMZ') borderClass = 'border-fuchsia-500';
              if (node.segment === 'Production') borderClass = 'border-blue-500';
              if (node.segment === 'Corporate') borderClass = 'border-emerald-500';
           }
           
           if (overlayMode === 'diff') {
              if (node.isNew) { bgClass = 'bg-emerald-900'; borderClass = 'border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)]'; }
           }

           return (
            <div 
              key={node.id} 
              className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-125 z-10"
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onClick={() => { setSelectedNode(node); setSimulatingPath(false); }}
            >
              <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-colors duration-500 ${bgClass} ${borderClass}`}>
                {overlayMode !== 'heat' && <StatusDot status={node.hasActiveAlert ? 'error' : 'success'} pulse={node.hasActiveAlert} />}
                {overlayMode === 'heat' && <span className="text-[10px] font-bold text-white">{node.riskScore}</span>}
              </div>
              <div className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-[10px] whitespace-nowrap shadow-xl transition-colors duration-500 ${textClass}`}>
                {node.label}
                {overlayMode === 'segmentation' && <span className="block text-[8px] text-slate-400 opacity-80 mt-0.5">{node.segment}</span>}
              </div>
            </div>
           );
        })}

        {/* Sidebar Panel for Selected Node */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl z-20 flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-800 flex justify-between items-start">
              <div>
                <h3 className="text-white font-bold text-base truncate pr-4">{selectedNode.label}</h3>
                <Badge severity={selectedNode.hasActiveAlert ? 'S1' : 'S4'}>{selectedNode.hasActiveAlert ? 'COMPROMISED' : 'SECURE'}</Badge>
              </div>
              <button onClick={() => { setSelectedNode(null); setSimulatingPath(false); }} className="text-slate-400 hover:text-white p-1">&times;</button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                 <div className="bg-slate-950 p-2 rounded border border-slate-800">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Asset ID</span>
                    <span className="text-slate-300 font-mono truncate">{selectedNode.id}</span>
                 </div>
                 <div className="bg-slate-950 p-2 rounded border border-slate-800">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Asset Type</span>
                    <span className="text-slate-300">{selectedNode.type}</span>
                 </div>
                 <div className="bg-slate-950 p-2 rounded border border-slate-800">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Segment</span>
                    <span className="text-slate-300">{selectedNode.segment}</span>
                 </div>
                 <div className="bg-slate-950 p-2 rounded border border-slate-800">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Risk Score</span>
                    <span className={`font-bold ${selectedNode.riskScore && selectedNode.riskScore > 80 ? 'text-red-500' : 'text-slate-300'}`}>{selectedNode.riskScore}/100</span>
                 </div>
              </div>

              <div className="bg-red-900/10 border border-red-500/20 p-3 rounded-lg">
                 <h4 className="text-red-400 font-bold text-xs uppercase tracking-wider mb-2 flex items-center">
                    <span className="mr-2">⚔️</span> Attack Path Simulation
                 </h4>
                 <p className="text-slate-400 text-xs mb-3">
                    Visualize the potential blast radius if this node is fully compromised. Highlights all reachable downstream assets based on current network rules.
                 </p>
                 <button 
                   onClick={() => setSimulatingPath(!simulatingPath)} 
                   className={`w-full py-2 rounded text-xs font-bold transition-colors ${simulatingPath ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'}`}
                 >
                   {simulatingPath ? 'Clear Simulation' : 'Simulate Blast Radius'}
                 </button>
                 {simulatingPath && (
                    <div className="mt-3 p-2 bg-slate-950 rounded text-xs text-slate-400 border border-slate-800">
                       <span className="text-red-400 font-bold">{reachableNodes.size - 1}</span> downstream assets exposed.
                    </div>
                 )}
              </div>
            </div>
          </div>
        )}

        {/* Legend Overlay */}
        <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur border border-slate-800 p-3 rounded shadow-xl z-20 text-xs space-y-2 pointer-events-none">
           <h4 className="text-slate-400 font-bold uppercase tracking-wider border-b border-slate-700 pb-1 mb-2">Legend</h4>
           {overlayMode === 'segmentation' && (
             <>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-fuchsia-500 mr-2"></div><span className="text-slate-300">DMZ Segment</span></div>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-blue-500 mr-2"></div><span className="text-slate-300">Production Segment</span></div>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-emerald-500 mr-2"></div><span className="text-slate-300">Corporate Segment</span></div>
               <div className="flex items-center"><div className="w-4 border-b-2 border-dashed border-amber-500 mr-2"></div><span className="text-amber-500 font-medium">Policy Violation</span></div>
             </>
           )}
           {overlayMode === 'diff' && (
             <>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-emerald-900 border-2 border-emerald-400 mr-2"></div><span className="text-emerald-400">New Node (Last 7d)</span></div>
               <div className="flex items-center"><div className="w-4 border-b-2 border-emerald-500 mr-2"></div><span className="text-emerald-400">New Connection</span></div>
             </>
           )}
           {overlayMode === 'heat' && (
             <>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-900 border-2 border-red-500 mr-2"></div><span className="text-red-400">Critical Risk (80+)</span></div>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-orange-900 border-2 border-orange-500 mr-2"></div><span className="text-orange-400">High Risk (50-79)</span></div>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-green-900 border-2 border-green-500 mr-2"></div><span className="text-green-400">Standard Risk</span></div>
             </>
           )}
           {overlayMode === 'standard' && (
             <>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-slate-900 border-2 border-red-500 mr-2"></div><span className="text-red-400">Active Alert</span></div>
               <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-slate-900 border-2 border-blue-500 mr-2"></div><span className="text-slate-300">Secure</span></div>
             </>
           )}
        </div>
      </div>
    </div>
  );
}
