// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, StatusDot } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { NetworkMapNode, NetworkMapEdge } from '../../shared/types';

export default function NetworkMapPage() {
  const { data, loading, error, execute } = useAsyncState<{ nodes: NetworkMapNode[], edges: NetworkMapEdge[] }>(async () => {
    const res = await apiClient.get('/assets/network-map');
    return res.data;
  });

  const [selectedNode, setSelectedNode] = useState<NetworkMapNode | null>(null);

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="h-screen bg-slate-950 ml-64 flex flex-col relative overflow-hidden pt-16">
      <div className="p-4 border-b border-slate-800 bg-slate-900 z-10 flex justify-between items-center">
        <h1 className="text-xl font-bold text-white">Network Topology</h1>
        <div className="text-xs text-slate-500">Live Asset Mapping</div>
      </div>
      
      <div className="flex-1 relative bg-slate-950">
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {data?.edges.map((e, idx) => {
            const src = data.nodes.find(n => n.id === e.source);
            const tgt = data.nodes.find(n => n.id === e.target);
            if (!src || !tgt) return null;
            return (
              <line 
                key={idx} 
                x1={`${src.x}%`} y1={`${src.y}%`} 
                x2={`${tgt.x}%`} y2={`${tgt.y}%`} 
                stroke="#334155" strokeWidth="2" 
                className="opacity-50"
              />
            );
          })}
        </svg>

        {data?.nodes.map(node => (
          <div 
            key={node.id} 
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-125 z-10"
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            onClick={() => setSelectedNode(node)}
          >
            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-slate-900 ${node.hasActiveAlert ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]' : 'border-blue-500'}`}>
              <StatusDot status={node.hasActiveAlert ? 'error' : 'success'} pulse={node.hasActiveAlert} />
            </div>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-[10px] text-white whitespace-nowrap shadow-xl">
              {node.label}
            </div>
          </div>
        ))}

        {selectedNode && (
          <div className="absolute top-4 right-4 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-4 z-20">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-white font-bold text-sm truncate">{selectedNode.label}</h3>
              <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">&times;</button>
            </div>
            <div className="text-xs space-y-2 text-slate-300">
              <p><span className="text-slate-500">ID:</span> {selectedNode.id}</p>
              <p><span className="text-slate-500">Type:</span> {selectedNode.type}</p>
              <p><span className="text-slate-500">Subnet:</span> {selectedNode.subnet}</p>
              <p><span className="text-slate-500">Alerts:</span> {selectedNode.hasActiveAlert ? <span className="text-red-400 font-bold">ACTIVE BREACH DETECTED</span> : <span className="text-green-400">Clear</span>}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
