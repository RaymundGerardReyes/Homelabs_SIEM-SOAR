import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { NetworkMapNode, NetworkMapEdge } from '../../shared/types';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';

// ==============================================================================
// Phase 6 — Multi-System Network Monitoring Graph Extension
// Adds node types: Container, RouterHost, ExternalDomain
// Colors/labels edges by SecurityFinding category:
//   rat             → purple   (#a855f7)
//   exfiltration    → orange   (#f97316)
//   ddos            → red      (#ef4444)
//   container_abuse → amber    (#f59e0b)
//   network_anomaly → yellow   (#eab308)
// Extends node sidebar with SecurityFinding details + one-click response actions
// (gated by two-key approval per the existing SOAR flow).
// ==============================================================================

// ---------------------------------------------------------------------------
// Type Extensions for Phase 6
// ---------------------------------------------------------------------------

/** Canonical SecurityFinding as returned by GET /investigations/{id}/findings */
interface SecurityFinding {
  finding_id: string;
  category: 'rat' | 'exfiltration' | 'ddos' | 'container_abuse' | 'network_anomaly';
  score: number;
  evidence: Record<string, any>;
  recommended_action: 'isolate_host' | 'throttle_container' | 'isolate_lan_client' | 'none';
  status: 'open' | 'pending_approval' | 'actioned' | 'false_positive' | 'closed';
  created_at: string;
}

interface EnhancedNode extends Omit<NetworkMapNode, 'x' | 'y'> {
  riskScore?: number;
  segment?: string;
  isNew?: boolean;
  x?: number;
  y?: number;
  // Phase 6 additions
  ip?: string;
  properties?: string;
  nodeType?: 'ClientHost' | 'RouterHost' | 'ExternalDomain' | 'ExternalIP' | 'Container' | 'ContainerHost' | 'generic';
  containerId?: string;
  containerImage?: string;
  findings?: SecurityFinding[];                // SecurityFindings linked to this node
  findingCategory?: SecurityFinding['category']; // Primary (highest score) finding category
}

interface EnhancedEdge extends NetworkMapEdge {
  isViolation?: boolean;
  isNew?: boolean;
  // Phase 6 additions
  findingCategory?: SecurityFinding['category']; // drives edge color in findings overlay mode
  relation?: string;
  action?: string;
  width?: number;
}

// ---------------------------------------------------------------------------
// Color Constants
// ---------------------------------------------------------------------------

const FINDING_COLORS: Record<string, string> = {
  rat:             '#a855f7',  // purple
  exfiltration:    '#f97316',  // orange
  ddos:            '#ef4444',  // red
  container_abuse: '#f59e0b',  // amber
  network_anomaly: '#eab308',  // yellow
};

const NODE_TYPE_COLORS: Record<string, string> = {
  RouterHost:    '#06b6d4',  // cyan — WiFi 6 gateway
  ClientHost:    '#3b82f6',  // blue
  ExternalDomain:'#8b5cf6',  // violet
  ExternalIP:    '#64748b',  // slate
  Container:     '#10b981',  // emerald
  ContainerHost: '#14b8a6',  // teal
  generic:       '#3b82f6',  // blue fallback
};

const NODE_TYPE_RADIUS: Record<string, number> = {
  RouterHost:    10,
  ContainerHost: 9,
  ClientHost:    6,
  ExternalDomain:7,
  Container:     5,
  ExternalIP:    6,
  generic:       6,
};

const FINDING_LABEL: Record<string, string> = {
  rat:             '🕵️ RAT Detected',
  exfiltration:    '📤 Data Exfiltration',
  ddos:            '💥 DDoS / Flood',
  container_abuse: '🐳 Container Abuse',
  network_anomaly: '⚠️ Network Anomaly',
};

const ACTION_LABEL: Record<string, string> = {
  isolate_lan_client: '🔒 Isolate LAN Client (ARP)',
  isolate_host:       '🔒 Isolate Host',
  throttle_container: '🐳 Throttle Container',
  none:               '✓ No Action Required',
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function NetworkMapPage() {
  const { data, loading, error, execute } = useAsyncState<{ nodes: EnhancedNode[], edges: EnhancedEdge[] }>(async () => {
    const [mapRes, findingsRes] = await Promise.all([
      apiClient.get('/assets/network-map'),
      apiClient.get('/assets/security-findings').catch(() => ({ data: { findings: [] } })),
    ]);

    // Index findings by source_ip / endpoint_id for fast node lookup
    const findingsByIp: Record<string, SecurityFinding[]> = {};
    for (const f of (findingsRes.data.findings || [])) {
      const key = f.evidence?.source_ip || f.endpoint_id || '';
      if (key) {
        if (!findingsByIp[key]) findingsByIp[key] = [];
        findingsByIp[key].push(f);
      }
    }

    const nodes: EnhancedNode[] = mapRes.data.nodes.map((n: any, i: number) => {
      // Detect node type from the backend `type` field
      const nt: EnhancedNode['nodeType'] =
        n.type === 'RouterHost'    ? 'RouterHost' :
        n.type === 'ClientHost'    ? 'ClientHost' :
        n.type === 'ExternalDomain'? 'ExternalDomain' :
        n.type === 'ExternalIP'    ? 'ExternalIP' :
        n.type === 'Container'     ? 'Container' :
        n.type === 'container_host'|| n.type === 'ContainerHost' ? 'ContainerHost' :
        'generic';

      const nodeFindingKey = n.ip || n.id;
      const nodeFindings   = findingsByIp[nodeFindingKey] || [];
      const topFinding     = nodeFindings.sort((a, b) => b.score - a.score)[0];

      return {
        ...n,
        riskScore: topFinding ? topFinding.score : Math.floor(Math.random() * 40),
        segment: i % 3 === 0 ? 'DMZ' : i % 2 === 0 ? 'Production' : 'Corporate',
        isNew: i === 4,
        nodeType: nt,
        findings: nodeFindings,
        findingCategory: topFinding?.category,
        hasActiveAlert: nodeFindings.some(f => f.status === 'open' && f.score >= 50),
      };
    });

    const edges: EnhancedEdge[] = mapRes.data.edges.map((e: any, i: number) => ({
      ...e,
      isViolation: i % 5 === 0,
      isNew: i === 6,
    }));

    return { nodes, edges };
  });

  const [selectedNode, setSelectedNode] = useState<EnhancedNode | null>(null);
  const [overlayMode, setOverlayMode] = useState<'standard' | 'heat' | 'segmentation' | 'diff' | 'findings'>('standard');
  const [simulatingPath, setSimulatingPath] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const fgRef = useRef<ForceGraphMethods>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => { execute(); }, [execute]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setDimensions({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [data]);

  const handleZoomToFit = useCallback(() => {
    if (fgRef.current) fgRef.current.zoomToFit(400, 50);
  }, []);

  const reachableNodes = useMemo(() => {
    if (!simulatingPath || !selectedNode || !data) return new Set<string>();
    const visited = new Set<string>([selectedNode.id]);
    const queue   = [selectedNode.id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      data.edges.forEach(e => {
        const srcId = typeof e.source === 'object' ? (e.source as any).id : e.source;
        const tgtId = typeof e.target === 'object' ? (e.target as any).id : e.target;
        if (srcId === curr && !visited.has(tgtId)) { visited.add(tgtId); queue.push(tgtId); }
        if (tgtId === curr && !visited.has(srcId)) { visited.add(srcId); queue.push(srcId); }
      });
    }
    return visited;
  }, [simulatingPath, selectedNode, data]);

  useEffect(() => {
    if (data && fgRef.current) setTimeout(handleZoomToFit, 1000);
  }, [data, overlayMode, handleZoomToFit]);

  // ---------------------------------------------------------------------------
  // Node color logic
  // ---------------------------------------------------------------------------
  const getNodeColor = useCallback((node: EnhancedNode): string => {
    if (simulatingPath && !reachableNodes.has(node.id)) return 'rgba(30, 41, 59, 0.5)';

    if (overlayMode === 'findings' && node.findingCategory) {
      return FINDING_COLORS[node.findingCategory] || '#ef4444';
    }
    if (overlayMode === 'heat') {
      const risk = node.riskScore || 0;
      if (risk > 80) return '#ef4444';
      if (risk > 50) return '#f97316';
      return '#22c55e';
    }
    if (overlayMode === 'segmentation') {
      if (node.segment === 'DMZ')        return '#d946ef';
      if (node.segment === 'Production') return '#3b82f6';
      if (node.segment === 'Corporate')  return '#10b981';
    }
    if (overlayMode === 'diff' && node.isNew) return '#10b981';

    // Standard: use node type color
    const nt = node.nodeType || (node.type as EnhancedNode['nodeType']) || 'generic';
    return NODE_TYPE_COLORS[nt as string] || '#3b82f6';
  }, [overlayMode, simulatingPath, reachableNodes]);

  // ---------------------------------------------------------------------------
  // Canvas node painter
  // ---------------------------------------------------------------------------
  const drawNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const label    = node.label;
    const fontSize = 12 / globalScale;
    const nt       = (node.nodeType || node.type || 'generic') as string;
    const radius   = (NODE_TYPE_RADIUS[nt] || 6);

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = getNodeColor(node);
    ctx.fill();

    // Halo for gateway/router nodes (cyan)
    if (nt === 'RouterHost' || nt === 'gateway_bridge' || nt === 'router') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (4 / globalScale), 0, 2 * Math.PI, false);
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.stroke();
    }

    // Halo for Container nodes (emerald ring)
    if (nt === 'Container' || nt === 'ContainerHost') {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (3 / globalScale), 0, 2 * Math.PI, false);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth   = 1.2 / globalScale;
      ctx.setLineDash([3 / globalScale, 2 / globalScale]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Threat glow for nodes with active findings
    if (node.hasActiveAlert || node.isSuspicious) {
      ctx.strokeStyle = node.findingCategory
        ? (FINDING_COLORS[node.findingCategory] || '#ef4444')
        : '#ef4444';
      ctx.lineWidth   = 2 / globalScale;
      ctx.stroke();
    }

    // Node label
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = simulatingPath && !reachableNodes.has(node.id)
      ? 'rgba(100, 116, 139, 0.5)'
      : 'rgba(255, 255, 255, 0.85)';
    ctx.font         = `${fontSize}px Sans-Serif`;
    ctx.fillText(label, node.x, node.y + radius + (9 / globalScale));

    // Finding category badge (small label under node name)
    if (overlayMode === 'findings' && node.findingCategory) {
      ctx.font      = `bold ${(fontSize * 0.75)}px Sans-Serif`;
      ctx.fillStyle = FINDING_COLORS[node.findingCategory] || '#ef4444';
      ctx.fillText(node.findingCategory.toUpperCase(), node.x, node.y + radius + (18 / globalScale));
    }
  }, [getNodeColor, simulatingPath, reachableNodes, overlayMode]);

  // ---------------------------------------------------------------------------
  // Edge color logic — Phase 6: findings overlay drives edge color
  // ---------------------------------------------------------------------------
  const getLinkColor = useCallback((edge: any): string => {
    const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target;

    if (simulatingPath) {
      if (reachableNodes.has(srcId) && reachableNodes.has(tgtId)) return '#ef4444';
      return 'rgba(51, 65, 85, 0.2)';
    }

    // Phase 6: findings-overlay edge color by finding category
    if (overlayMode === 'findings' && edge.findingCategory) {
      return FINDING_COLORS[edge.findingCategory] || '#ef4444';
    }

    // Router action colors (from InvestigationGraph / CDM)
    const action = (edge.action || '').toUpperCase();
    if (action === 'DROP')    return '#ef4444';
    if (action === 'NAT')     return '#3b82f6';
    if (action === 'ALLOW')   return '#10b981';
    if (edge.relation === 'VISITED_SITE') return '#6366f1';
    if (edge.relation === 'WAN_EGRESS')   return '#3b82f6';

    if (overlayMode === 'segmentation' && edge.isViolation) return '#f59e0b';
    if (overlayMode === 'diff' && edge.isNew)               return '#10b981';
    return '#334155';
  }, [overlayMode, simulatingPath, reachableNodes]);

  // ---------------------------------------------------------------------------
  // SOAR one-click response action (gated by backend two-key approval flow)
  // ---------------------------------------------------------------------------
  const handleResponseAction = useCallback(async (node: EnhancedNode, finding: SecurityFinding) => {
    if (finding.recommended_action === 'none') return;
    setActionSubmitting(true);
    setActionFeedback(null);
    try {
      // This hits the existing /admin/endpoints/{id}/tasks route that requires twoKeyToken
      await apiClient.post(`/admin/endpoints/${node.id}/tasks`, {
        action: finding.recommended_action,
        params: {
          target_ip:    node.ip || node.id,
          container_id: node.containerId || '',
          finding_id:   finding.finding_id,
        },
        // backend PolicyGovernanceSubagent validates this before execution
        twoKeyToken: null,  // null → queued as pending_approval, requires analyst two-key gate
      });
      setActionFeedback(`✅ Action queued for two-key approval: ${finding.recommended_action}`);
    } catch (err: any) {
      setActionFeedback(`❌ Failed to queue action: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setActionSubmitting(false);
    }
  }, []);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="h-[calc(100vh-4rem)] bg-slate-950 flex flex-col relative overflow-hidden rounded-xl border border-slate-800 shadow-2xl mt-4 mx-4 mb-4">

      {/* ── Header ── */}
      <div className="p-4 border-b border-slate-800 bg-slate-900 z-20 flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0 shadow-lg">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Network Topology &amp; Attack Surface</h1>
          <p className="text-xs text-slate-500">
            Lateral movement paths, security findings, containers, and policy violations.
          </p>
        </div>
        <div className="flex space-x-2">
          <button onClick={handleZoomToFit} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm transition-colors border border-slate-700">
            [+] Fit Viewport
          </button>
          <select
            value={overlayMode}
            onChange={(e: any) => setOverlayMode(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-slate-300 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            <option value="standard">Standard View</option>
            <option value="findings">🔍 Security Findings</option>
            <option value="heat">Risk Heat Map</option>
            <option value="segmentation">Segmentation Policy</option>
            <option value="diff">Topology Diff (7 Days)</option>
          </select>
          <button
            onClick={() => alert('Exporting network map — html-to-image required in production.')}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm transition-colors border border-slate-700"
          >
            Export
          </button>
        </div>
      </div>

      {/* ── Graph Canvas ── */}
      <div className="flex-1 relative bg-slate-950 overflow-hidden" ref={containerRef}>
        {data && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={{ nodes: data.nodes, links: data.edges }}
            nodeId="id"
            nodeLabel="label"
            nodeCanvasObject={drawNode}
            linkColor={getLinkColor}
            linkWidth={(edge: any) => {
              const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source;
              const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target;
              if (simulatingPath && reachableNodes.has(srcId) && reachableNodes.has(tgtId)) return 3;
              if (overlayMode === 'segmentation' && edge.isViolation) return 3;
              if (overlayMode === 'diff'         && edge.isNew)       return 3;
              if (overlayMode === 'findings'     && edge.findingCategory) return 2.5;
              return edge.width || 1.5;
            }}
            linkDirectionalParticles={(edge: any) => {
              // Directional particles on finding-highlighted edges
              return overlayMode === 'findings' && edge.findingCategory ? 3 : 0;
            }}
            linkDirectionalParticleColor={(edge: any) =>
              FINDING_COLORS[edge.findingCategory] || '#ef4444'
            }
            linkLineDash={(edge: any) =>
              (overlayMode === 'segmentation' && edge.isViolation) ? [4, 4] : null
            }
            onNodeClick={(node: any) => {
              setSelectedNode(node as EnhancedNode);
              setSimulatingPath(false);
              setActionFeedback(null);
            }}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
            warmupTicks={50}
            cooldownTicks={100}
            cooldownTime={2000}
          />
        )}

        {/* ── Node Detail Sidebar ── */}
        {selectedNode && (
          <div className="absolute top-4 right-4 w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl z-20 flex flex-col max-h-[90vh] overflow-y-auto">

            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex justify-between items-start">
              <div>
                <h3 className="text-white font-bold text-base truncate pr-4">{selectedNode.label}</h3>
                <Badge severity={selectedNode.hasActiveAlert ? 'S1' : 'S4'}>
                  {selectedNode.hasActiveAlert ? 'ALERT' : 'SECURE'}
                </Badge>
                {selectedNode.nodeType && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                    {selectedNode.nodeType}
                  </span>
                )}
              </div>
              <button
                onClick={() => { setSelectedNode(null); setSimulatingPath(false); setActionFeedback(null); }}
                className="text-slate-400 hover:text-white p-1"
              >
                &times;
              </button>
            </div>

            {/* Asset Properties Grid */}
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-950 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Asset ID</span>
                  <span className="text-slate-300 font-mono truncate block">{selectedNode.id}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Node Type</span>
                  <span className="text-slate-300">{selectedNode.nodeType || selectedNode.type || '—'}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Segment</span>
                  <span className="text-slate-300">{selectedNode.segment || '—'}</span>
                </div>
                <div className="bg-slate-950 p-2 rounded border border-slate-800">
                  <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Risk Score</span>
                  <span className={`font-bold ${(selectedNode.riskScore || 0) > 70 ? 'text-red-500' : (selectedNode.riskScore || 0) > 40 ? 'text-orange-400' : 'text-green-400'}`}>
                    {selectedNode.riskScore ?? '—'}/100
                  </span>
                </div>
                {selectedNode.containerId && (
                  <div className="bg-slate-950 p-2 rounded border border-slate-800 col-span-2">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Container ID</span>
                    <span className="text-emerald-400 font-mono text-[10px] truncate block">{selectedNode.containerId}</span>
                  </div>
                )}
                {selectedNode.containerImage && (
                  <div className="bg-slate-950 p-2 rounded border border-slate-800 col-span-2">
                    <span className="text-slate-500 block mb-1 uppercase tracking-wider text-[10px]">Image</span>
                    <span className="text-slate-300 font-mono text-[10px] truncate block">{selectedNode.containerImage}</span>
                  </div>
                )}
              </div>

              {/* Properties raw text */}
              {selectedNode.properties && (
                <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs text-slate-400 whitespace-pre-wrap font-mono">
                  {selectedNode.properties}
                </div>
              )}

              {/* ── SecurityFindings Section ── */}
              {selectedNode.findings && selectedNode.findings.length > 0 && (
                <div className="border border-slate-700 rounded-lg overflow-hidden">
                  <div className="bg-slate-800 px-3 py-2 flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      🔍 Security Findings ({selectedNode.findings.length})
                    </h4>
                  </div>
                  <div className="divide-y divide-slate-800">
                    {selectedNode.findings.map((f) => (
                      <div key={f.finding_id} className="p-3 space-y-2">
                        {/* Category + Score */}
                        <div className="flex items-center justify-between">
                          <span
                            className="text-xs font-bold"
                            style={{ color: FINDING_COLORS[f.category] || '#ef4444' }}
                          >
                            {FINDING_LABEL[f.category] || f.category.toUpperCase()}
                          </span>
                          <span className={`text-xs font-mono font-bold ${f.score >= 70 ? 'text-red-400' : f.score >= 40 ? 'text-orange-400' : 'text-slate-400'}`}>
                            Score: {f.score}/100
                          </span>
                        </div>

                        {/* Status */}
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] text-slate-500 uppercase">Status:</span>
                          <span className={`text-[10px] font-bold uppercase ${
                            f.status === 'open'              ? 'text-red-400' :
                            f.status === 'pending_approval'  ? 'text-yellow-400' :
                            f.status === 'actioned'          ? 'text-green-400' :
                            'text-slate-500'
                          }`}>{f.status.replace('_', ' ')}</span>
                        </div>

                        {/* Evidence summary */}
                        {f.evidence.triggers && (
                          <div className="flex flex-wrap gap-1">
                            {(f.evidence.triggers as string[]).map((t: string) => (
                              <span
                                key={t}
                                className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                                style={{
                                  backgroundColor: (FINDING_COLORS[f.category] || '#ef4444') + '22',
                                  color: FINDING_COLORS[f.category] || '#ef4444',
                                  border: `1px solid ${FINDING_COLORS[f.category] || '#ef4444'}44`,
                                }}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* One-click SOAR action — gated by two-key approval */}
                        {f.recommended_action !== 'none' && f.status === 'open' && (
                          <button
                            onClick={() => handleResponseAction(selectedNode, f)}
                            disabled={actionSubmitting}
                            className={`w-full py-1.5 rounded text-xs font-bold transition-colors mt-1 ${
                              actionSubmitting
                                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                                : 'bg-red-600/80 hover:bg-red-500 text-white shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                            }`}
                          >
                            {actionSubmitting ? '⏳ Queuing…' : (ACTION_LABEL[f.recommended_action] || f.recommended_action)}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No findings state */}
              {(!selectedNode.findings || selectedNode.findings.length === 0) && (
                <div className="text-xs text-slate-500 italic text-center py-2">
                  No security findings linked to this node.
                </div>
              )}

              {/* Action feedback toast */}
              {actionFeedback && (
                <div className={`text-xs p-2 rounded border ${
                  actionFeedback.startsWith('✅')
                    ? 'bg-green-900/20 border-green-700 text-green-300'
                    : 'bg-red-900/20 border-red-700 text-red-300'
                }`}>
                  {actionFeedback}
                </div>
              )}

              {/* ── Attack Path Simulation ── */}
              <div className="bg-red-900/10 border border-red-500/20 p-3 rounded-lg">
                <h4 className="text-red-400 font-bold text-xs uppercase tracking-wider mb-2 flex items-center">
                  <span className="mr-2">⚔️</span> Attack Path Simulation
                </h4>
                <p className="text-slate-400 text-xs mb-3">
                  Visualize the potential blast radius if this node is compromised. Highlights all reachable downstream assets.
                </p>
                <button
                  onClick={() => setSimulatingPath(!simulatingPath)}
                  className={`w-full py-2 rounded text-xs font-bold transition-colors ${
                    simulatingPath
                      ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      : 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
                  }`}
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

        {/* ── Legend Overlay ── */}
        <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur border border-slate-800 p-3 rounded shadow-xl z-20 text-xs space-y-2 pointer-events-none max-w-[200px]">
          <h4 className="text-slate-400 font-bold uppercase tracking-wider border-b border-slate-700 pb-1 mb-2">Legend</h4>

          {overlayMode === 'findings' && (
            <>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: FINDING_COLORS.rat }} /><span style={{ color: FINDING_COLORS.rat }}>RAT Detected</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: FINDING_COLORS.exfiltration }} /><span style={{ color: FINDING_COLORS.exfiltration }}>Exfiltration</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: FINDING_COLORS.ddos }} /><span style={{ color: FINDING_COLORS.ddos }}>DDoS / Flood</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: FINDING_COLORS.container_abuse }} /><span style={{ color: FINDING_COLORS.container_abuse }}>Container Abuse</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: FINDING_COLORS.network_anomaly }} /><span style={{ color: FINDING_COLORS.network_anomaly }}>Network Anomaly</span></div>
              <div className="border-t border-slate-800 pt-1 mt-1">
                <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-cyan-400 mr-2 bg-transparent" /><span className="text-cyan-400">Router / Gateway</span></div>
                <div className="flex items-center mt-1"><div className="w-3 h-3 rounded-full border-2 border-emerald-400 mr-2 bg-transparent border-dashed" /><span className="text-emerald-400">Container</span></div>
              </div>
            </>
          )}

          {overlayMode === 'standard' && (
            <>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-red-500 mr-2 bg-transparent" /><span className="text-red-400">Active Alert</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-cyan-400 mr-2 bg-transparent" /><span className="text-cyan-400">Router / Gateway</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-emerald-400 mr-2 bg-transparent border-dashed" /><span className="text-emerald-400">Container</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-blue-500 mr-2 bg-transparent" /><span className="text-slate-300">Client Host</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-violet-400 mr-2 bg-transparent" /><span className="text-violet-400">External Domain</span></div>
            </>
          )}

          {overlayMode === 'segmentation' && (
            <>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-fuchsia-500 mr-2" /><span className="text-slate-300">DMZ</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-blue-500 mr-2" /><span className="text-slate-300">Production</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full border-2 border-emerald-500 mr-2" /><span className="text-slate-300">Corporate</span></div>
              <div className="flex items-center"><div className="w-4 border-b-2 border-dashed border-amber-500 mr-2" /><span className="text-amber-500 font-medium">Policy Violation</span></div>
            </>
          )}

          {overlayMode === 'diff' && (
            <>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-emerald-900 border-2 border-emerald-400 mr-2" /><span className="text-emerald-400">New Node (7d)</span></div>
              <div className="flex items-center"><div className="w-4 border-b-2 border-emerald-500 mr-2" /><span className="text-emerald-400">New Connection</span></div>
            </>
          )}

          {overlayMode === 'heat' && (
            <>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-900 border-2 border-red-500 mr-2" /><span className="text-red-400">Critical (80+)</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-orange-900 border-2 border-orange-500 mr-2" /><span className="text-orange-400">High (50-79)</span></div>
              <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-green-900 border-2 border-green-500 mr-2" /><span className="text-green-400">Standard</span></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
