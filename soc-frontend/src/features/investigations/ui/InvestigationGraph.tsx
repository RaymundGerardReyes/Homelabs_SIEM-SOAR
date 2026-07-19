import React, { useState } from 'react';
import { useWebSocketStream } from '../../../shared/hooks';
import { GraphNode, GraphEdge } from '../../../shared/types';
import { StatusDot, Badge } from '../../../shared/ui';

interface InvestigationGraphProps {
  investigationId: string;
  initialData: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export default function InvestigationGraph({ investigationId, initialData }: InvestigationGraphProps) {
  const [nodes, setNodes] = useState<GraphNode[]>(initialData.nodes || []);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useWebSocketStream<{ type: string, node: GraphNode }>(`/ws/investigations/${investigationId}/graph`, (msg) => {
    if (msg.type === 'NODE_UPDATE') {
      setNodes(prev => prev.map(n => n.id === msg.node.id ? { ...n, ...msg.node } : n));
    }
  });

  const getStatusColor = (status: string) => {
    if (status === 'running') return 'text-yellow-400 border-yellow-400 bg-yellow-400/10';
    if (status === 'success') return 'text-green-400 border-green-400 bg-green-400/10';
    if (status === 'failed') return 'text-red-400 border-red-400 bg-red-400/10';
    return 'text-slate-400 border-slate-600 bg-slate-800';
  };

  return (
    <div className="w-full h-full relative">
      <div className="absolute inset-0 p-4 flex flex-wrap gap-6 items-center justify-center overflow-auto">
        {nodes.map(node => {
          const isSelected = selectedNode?.id === node.id;
          return (
            <div 
              key={node.id}
              onClick={() => setSelectedNode(node)}
              className={`cursor-pointer px-4 py-2 rounded-full border-2 transition-all shadow-lg flex items-center space-x-2 
                ${getStatusColor(node.status)} 
                ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-slate-900 scale-110 z-10' : 'hover:scale-105'}`}
            >
              <StatusDot status={node.status === 'running' ? 'warning' : node.status === 'success' ? 'success' : node.status === 'failed' ? 'error' : 'info'} pulse={node.status === 'running'} />
              <span className="font-medium text-sm whitespace-nowrap">{node.label}</span>
            </div>
          )
        })}
        {nodes.length === 0 && <div className="text-slate-500 text-sm">No graph nodes available.</div>}
      </div>

      {selectedNode && (
        <div className="absolute bottom-4 right-4 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-4 z-20 animate-in slide-in-from-bottom-4">
          <div className="flex justify-between items-start mb-2">
            <h4 className="text-white font-bold text-sm truncate pr-2">{selectedNode.label}</h4>
            <button onClick={() => setSelectedNode(null)} className="text-slate-400 hover:text-white">&times;</button>
          </div>
          <Badge severity={selectedNode.status === 'running' ? 'S3' : selectedNode.status === 'failed' ? 'S1' : 'S4'} className="mb-3 uppercase text-[10px]">
            {selectedNode.status}
          </Badge>
          <div className="text-xs text-slate-300 space-y-1">
            <p><span className="text-slate-500">ID:</span> {selectedNode.id}</p>
            <p><span className="text-slate-500">Type:</span> {selectedNode.type || 'Agent Action'}</p>
            <p><span className="text-slate-500">Details:</span> {selectedNode.properties || 'No extended details.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
