import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsyncState, useWebSocketStream } from '../../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge, ConfirmModal } from '../../../shared/ui';
import apiClient from '../../../shared/api/apiClient';
import { InvestigationData, LogEntry, ActionInfo } from '../../../shared/types';
import ThreatIntelPanel from './ThreatIntelPanel';
import InvestigationGraph from './InvestigationGraph';

export default function InvestigationDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [pendingAction, setPendingAction] = useState<ActionInfo | null>(null);

  const { data, loading, error, execute } = useAsyncState<InvestigationData>(async () => {
    const res = await apiClient.get(`/investigations/${id}`);
    setLogs(res.data.details.conversation_log || []);
    setActions(res.data.details.proposed_actions || []);
    return res.data;
  });

  useEffect(() => {
    if (id) execute();
  }, [id, execute]);

  const { isConnected } = useWebSocketStream<LogEntry>(`/ws/investigations/${id}`, (newLog) => {
    setLogs(prev => [...prev, newLog]);
  });

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleActionClick = (action: ActionInfo) => {
    if (action.risk === 'HIGH_IMPACT_WRITE' || action.risk === 'DESTRUCTIVE') {
      setPendingAction(action); 
    } else {
      approveAction(action);
    }
  };

  const approveAction = async (action: ActionInfo) => {
    try {
      await apiClient.post(`/investigations/${id}/actions`, action);
      alert(`Action '${action.action}' approved successfully.`);
      setPendingAction(null);
    } catch (err) {
      console.error(err);
      alert('Failed to execute action.');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={10} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="flex flex-col h-screen bg-slate-950 ml-64 overflow-hidden">
      <header className="flex items-center justify-between p-4 bg-slate-900 border-b border-slate-800">
        <div>
          <button onClick={() => navigate('/')} className="text-blue-400 hover:text-blue-300 text-sm mb-1 flex items-center">
            &larr; Back to Command Center
          </button>
          <h1 className="text-xl font-bold text-white">Investigation: {id}</h1>
        </div>
        <div className="flex items-center">
          <span className="text-xs text-slate-400 mr-2">Stream Status:</span>
          <Badge severity={isConnected ? 'S4' : 'S1'}>{isConnected ? 'LIVE' : 'DISCONNECTED'}</Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 flex flex-col border-r border-slate-800 bg-slate-950">
          <div className="p-3 bg-slate-900 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Agent Event Log</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {logs.map((log, idx) => (
              <div key={idx} className="bg-slate-900 border border-slate-800 p-3 rounded">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-blue-400 font-mono text-sm">{log.agent}</span>
                  {log.confidence < 70 && <Badge severity="S2" className="text-[10px]">Low Confidence ({log.confidence}%)</Badge>}
                </div>
                <p className="text-slate-300 text-sm">{log.message}</p>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="w-1/2 flex flex-col bg-slate-900 overflow-y-auto">
          <div className="p-4 space-y-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Execution Provenance</h2>
              <div className="h-64 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden relative">
                <InvestigationGraph investigationId={id!} initialData={{ nodes: data?.nodes || [], edges: data?.edges || [] }} />
              </div>
            </div>

            {data?.source_ip && <ThreatIntelPanel ipAddress={data.source_ip} />}

            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">Proposed Actions</h2>
              <div className="space-y-3">
                {actions.map((action, idx) => {
                  const isHighRisk = action.risk === 'HIGH_IMPACT_WRITE' || action.risk === 'DESTRUCTIVE';
                  return (
                    <div key={idx} className={`p-4 rounded-lg border ${isHighRisk ? 'bg-red-500/5 border-red-500/30' : 'bg-slate-800 border-slate-700'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className={`font-bold ${isHighRisk ? 'text-red-400' : 'text-white'}`}>{action.action}</h3>
                          <p className="text-sm text-slate-400 mt-1">{action.justification}</p>
                          <p className="text-xs font-mono text-slate-500 mt-2">Target: {action.target}</p>
                        </div>
                        <button 
                          onClick={() => handleActionClick(action)}
                          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                            isHighRisk ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          Execute
                        </button>
                      </div>
                    </div>
                  );
                })}
                {actions.length === 0 && <div className="text-slate-500 italic text-sm">No pending actions recommended by agents.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={pendingAction !== null}
        title="High-Risk Action Approval"
        message={`You are about to execute a destructive action: ${pendingAction?.action} on ${pendingAction?.target}. This requires your explicit two-key confirmation.`}
        isDestructive={true}
        confirmText="Confirm Execution"
        onConfirm={() => { if (pendingAction) approveAction(pendingAction); }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
