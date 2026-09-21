import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsyncState, useWebSocketStream } from '../../../shared/hooks';
import { LoadingSkeleton, ErrorState } from '../../../shared/ui';
import apiClient from '../../../shared/api/apiClient';
import { InvestigationData, LogEntry, ActionInfo } from '../../../shared/types';
import { ThreatIntelPanel } from './ThreatIntelPanel';
import { InvestigationGraph } from './InvestigationGraph';
import AgentChatWidget from './AgentChatWidget';

export default function InvestigationDashboard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actions, setActions] = useState<ActionInfo[]>([]);

  const { data: investigation, loading, error, execute } = useAsyncState<InvestigationData>(async () => {
    const res = await apiClient.get(`/investigations/${id}`);
    setLogs(res.data.details.conversation_log || []);
    setActions(res.data.details.proposed_actions || []);
    return res.data;
  });

  useEffect(() => {
    if (id) execute();
  }, [id, execute]);

  useWebSocketStream<LogEntry>(`/ws/investigations/${id}`, (newLog) => {
    setLogs(prev => [...prev, newLog]);
  });

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleActionApprove = async (action: ActionInfo) => {
    try {
      await apiClient.post(`/investigations/${id}/actions`, action);
      alert(`Action '${action.action}' approved successfully.`);
      // Refresh actions or Optimistically remove it
      setActions(prev => prev.filter(a => a.action !== action.action));
    } catch (err) {
      console.error(err);
      alert('Failed to execute action.');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={10} /></div>;
  if (error && !investigation) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="investigation-dashboard fadeIn p-4 sm:p-6 lg:p-8 min-h-full w-full min-w-0 bg-slate-950 relative pb-16">
      {/* Ambient background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="breadcrumb mb-6 sm:mb-8 flex justify-between items-center text-xs sm:text-sm relative z-10">
        <div className="flex items-center flex-wrap gap-1">
          <span className="breadcrumb-link cursor-pointer text-slate-400 hover:text-white transition-colors" onClick={() => navigate('/')}>
            Command Center
          </span> 
          <span className="breadcrumb-separator mx-1 sm:mx-2 text-slate-600">/</span> 
          <span className="active-breadcrumb glow-text text-white font-bold tracking-wide break-all">
            Investigation ({id})
          </span>
        </div>
      </div>
      
      {investigation && (
        <div className="investigation-grid grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8 relative z-10 min-w-0 w-full">
          {/* Left Column: Logs and Graph */}
          <div className="space-y-6 sm:space-y-8 min-w-0 w-full">
            <div className="panel conversation-panel glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl min-w-0">
              <h3 className="panel-title flex items-center text-base sm:text-lg font-bold text-white mb-4 sm:mb-6">
                <span className="icon mr-2">🛡️</span> Immutable Agent Log
              </h3>
              <div className="log-container space-y-3 sm:space-y-4 max-h-[400px] overflow-y-auto pr-1 sm:pr-2 custom-scrollbar">
                {logs.map((log, idx) => (
                  <div key={idx} className={`log-entry interactive-card p-3.5 sm:p-4 rounded-lg border ${log.confidence < 70 ? 'bg-orange-900/10 border-orange-500/30' : 'bg-slate-900/50 border-slate-700'} hover:border-slate-600 transition-colors min-w-0`}>
                    <div className="log-header flex justify-between items-start mb-2 gap-2">
                      <span className="agent-name text-blue-400 font-mono text-xs sm:text-sm font-bold truncate">{log.agent}</span>
                      <div className="confidence-score flex items-center space-x-1.5 flex-shrink-0">
                        {log.confidence < 70 && <span className="warning-icon text-orange-400 text-xs flex items-center">⚠️ <span className="ml-1 hidden sm:inline">Low Confidence</span></span>}
                        <span className={`score-badge text-[10px] sm:text-xs px-2 py-0.5 sm:py-1 rounded font-mono ${log.confidence < 70 ? 'bg-orange-500/20 text-orange-300' : 'bg-slate-800 text-slate-300'}`}>
                          {log.confidence}%
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-300 text-xs sm:text-sm leading-relaxed break-words">{log.message}</p>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>

            <InvestigationGraph sessionId={id!} />
          </div>

          {/* Right Column: Actions and Threat Intel */}
          <div className="space-y-6 sm:space-y-8 min-w-0 w-full">
            <div className="panel action-panel glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl min-w-0">
              <h3 className="panel-title flex items-center text-base sm:text-lg font-bold text-white mb-4 sm:mb-6">
                <span className="icon mr-2 text-yellow-500">⚡</span> Proposed Actions
              </h3>
              <div className="action-list space-y-4">
                {actions.map((action, idx) => {
                  const isHighRisk = action.risk.includes('HIGH') || action.risk.includes('DESTRUCTIVE');
                  return (
                    <div key={idx} className={`action-card interactive-card p-4 sm:p-5 rounded-lg border ${isHighRisk ? 'bg-red-900/10 border-red-500/50' : 'bg-slate-900/50 border-slate-700'} min-w-0`}>
                      <div className="action-header flex justify-between items-start mb-3 gap-2">
                        <span className={`action-name font-bold text-sm sm:text-base break-words ${isHighRisk ? 'text-red-400' : 'text-white'}`}>{action.action}</span>
                        <span className={`risk-badge text-[10px] sm:text-xs px-2 py-0.5 sm:py-1 rounded font-bold tracking-wider flex-shrink-0 ${isHighRisk ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-slate-400'}`}>
                          {action.risk.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="action-target text-slate-400 text-xs sm:text-sm mb-2 break-all">
                        Target: <code className="glass-code bg-slate-950 px-2 py-1 rounded text-blue-300 font-mono text-xs border border-slate-800 break-all inline-block max-w-full overflow-hidden text-ellipsis">{action.target}</code>
                      </div>
                      <div className="action-justification text-slate-300 text-xs sm:text-sm italic mb-4 border-l-2 border-slate-600 pl-3 break-words">
                        "{action.justification}"
                      </div>
                      <button 
                        className={`approve-btn premium-btn hover-lift w-full py-2 sm:py-2.5 rounded font-bold uppercase tracking-wider text-xs sm:text-sm transition-all shadow-lg ${isHighRisk ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/20' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'}`}
                        onClick={() => handleActionApprove(action)}
                      >
                        Approve Action
                      </button>
                    </div>
                  );
                })}
                {actions.length === 0 && (
                  <div className="text-slate-500 text-sm italic p-4 text-center border border-slate-800 border-dashed rounded-lg">
                    No pending actions recommended by agents.
                  </div>
                )}
              </div>
            </div>

            {investigation?.source_ip && <ThreatIntelPanel ipAddress={investigation.source_ip} />}
          </div>
        </div>
      )}

      {/* Floating Agent Chat Widget placed safely outside the CSS Grid */}
      <AgentChatWidget defaultOpen={false} defaultInput={`Analyze Investigation ${id}`} />
    </div>
  );
}
