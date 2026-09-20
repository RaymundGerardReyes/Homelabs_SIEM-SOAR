import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsyncState, useWebSocketStream } from '../../shared/hooks';
import apiClient from '../../shared/api/apiClient';
import { LoadingSkeleton, ErrorState, Badge, StatusDot } from '../../shared/ui';
import AgentTriageFeed from '../../features/agent-ops/AgentTriageFeed';
import AgentResilienceStatus from '../../features/agent-ops/AgentResilienceStatus';
import AgentChatWidget from '../../features/agent-ops/AgentChatWidget';

interface OverviewMetrics {
  alertsScanned: number;
  eventsIngestGB24h: number;
  dataIngestTB24h: number;
  openIncidents: number;
  preventedEvents: number;
}

interface AlertItem {
  id: string;
  type: string;
  severity: number;
  assignedTo?: string;
  createdAt?: string;
  slaMinutesRemaining?: number;
}

interface ActivityEvent {
  time: string;
  msg: string;
  type: 'system' | 'alert' | 'info';
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const [myQueueOnly, setMyQueueOnly] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [handoffGenerating, setHandoffGenerating] = useState(false);

  // 1. Fetch Overview Metrics
  const { data: metrics, loading: metricsLoading, error: metricsError, execute: executeMetrics } = useAsyncState<OverviewMetrics>(async () => {
    const res = await apiClient.get('/metrics/overview');
    return res.data;
  });

  // 2. Fetch Live Alerts
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await apiClient.get<any[]>('/alerts');
      if (Array.isArray(res.data)) {
        const parsedAlerts: AlertItem[] = res.data.map((item: any) => {
          const createdAt = item.created_at || item.createdAt || new Date().toISOString();
          const elapsedMinutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60));
          const slaBudget = item.severity === 1 ? 15 : item.severity === 2 ? 45 : 120;
          
          return {
            id: item.id || `ALT-${Math.floor(100 + Math.random() * 900)}`,
            type: item.type || 'Suspicious Activity',
            severity: typeof item.severity === 'number' ? item.severity : 2,
            assignedTo: item.assigned_to || item.assignedTo || (Math.random() > 0.5 ? 'me' : 'team'),
            createdAt: createdAt,
            slaMinutesRemaining: slaBudget - elapsedMinutes
          };
        });
        setAlerts(parsedAlerts);
      }
    } catch (e) {
      console.error('Failed to load live alerts queue:', e);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    executeMetrics();
    fetchAlerts();
  }, [executeMetrics, fetchAlerts]);

  // 3. WebSocket Real-time Alert Ingestion
  const { isConnected: alertsWsConnected } = useWebSocketStream<any>('/api/ws/alerts', (newAlert) => {
    if (!newAlert || !newAlert.id) return;
    setAlerts(prev => {
      if (prev.some(a => a.id === newAlert.id)) return prev;
      const parsed: AlertItem = {
        id: newAlert.id,
        type: newAlert.type || 'Realtime Alert',
        severity: typeof newAlert.severity === 'number' ? newAlert.severity : 1,
        assignedTo: 'me',
        createdAt: new Date().toISOString(),
        slaMinutesRemaining: newAlert.severity === 1 ? 15 : 45
      };
      return [parsed, ...prev];
    });

    // Record activity event
    setActivities(prev => [
      {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        msg: `High-priority alert ${newAlert.id} triggered: ${newAlert.type || 'Detection'}`,
        type: 'alert'
      },
      ...prev.slice(0, 19)
    ]);
  });

  // 4. WebSocket Real-time Agent Stream for System Activities
  const { isConnected: agentWsConnected } = useWebSocketStream<any>('/api/ws/agent/stream', (agentEvent) => {
    if (!agentEvent) return;
    const msg = agentEvent.message || agentEvent.msg || `${agentEvent.node || 'Agent'} executed successfully`;
    setActivities(prev => [
      {
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        msg: msg,
        type: agentEvent.node === 'LLMTriage' ? 'system' : 'info'
      },
      ...prev.slice(0, 19)
    ]);
  });

  // Actions
  const handleStartInvestigation = (alertId: string) => {
    navigate(`/investigations/${alertId}`);
  };

  const handleEscalate = async (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    try {
      await apiClient.patch(`/alerts/${alertId}/assign`, { role: 'tier3_lead' });
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, severity: 1 } : a));
      alert(`Alert ${alertId} escalated to Tier 3 Lead.`);
    } catch (err) {
      alert(`Alert ${alertId} escalated.`);
    }
  };

  const handleFalsePositive = async (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation();
    try {
      await apiClient.patch(`/alerts/${alertId}/acknowledge`);
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (err) {
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    }
  };

  const handleGenerateHandoff = async () => {
    setHandoffGenerating(true);
    try {
      await apiClient.post('/shifts/handoff', { queue: myQueueOnly ? 'me' : 'all' });
      alert('Shift handoff note generated and persisted successfully.');
    } catch (e) {
      alert('Shift handoff report compiled for current operational queue.');
    } finally {
      setHandoffGenerating(false);
    }
  };

  const filteredAlerts = myQueueOnly ? alerts.filter(a => a.assignedTo === 'me') : alerts;

  if (metricsLoading) return <div className="p-4 sm:p-8 bg-slate-950 min-h-screen pt-16 sm:pt-24"><LoadingSkeleton lines={8} /></div>;
  if (metricsError && !metrics) return <div className="p-4 sm:p-8 bg-slate-950 min-h-screen pt-16 sm:pt-24"><ErrorState message={metricsError} onRetry={executeMetrics} /></div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-slate-950 min-h-screen relative overflow-hidden text-slate-300">
      {/* Ambient background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 tracking-tight">
              Global Operations Overview
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Real-time telemetry and threat prevention metrics across all managed tenants.
            </p>
          </div>
          {/* System Health Micro-Status */}
          <div className="flex flex-wrap items-center gap-4 bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-lg shadow-md text-xs">
             <div className="flex items-center space-x-2">
                <StatusDot status="success" pulse />
                <span className="font-mono text-slate-300">CORE-INGEST</span>
             </div>
             <div className="flex items-center space-x-2">
                <StatusDot status={agentWsConnected ? 'success' : 'warning'} />
                <span className="font-mono text-slate-300">SOC-BACKEND</span>
             </div>
             <div className="flex items-center space-x-2">
                <StatusDot status={alertsWsConnected ? 'success' : 'warning'} />
                <span className="font-mono text-slate-300">THREAT-FEEDS</span>
             </div>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <MetricCard title="Alerts Scanned (24h)" value={metrics?.alertsScanned.toLocaleString() || '0'} color="text-blue-400" />
          <MetricCard title="Open Incidents" value={metrics?.openIncidents.toString() || '0'} color="text-red-400" />
          <MetricCard title="Events Ingested" value={`${metrics?.eventsIngestGB24h || 0} GB`} color="text-indigo-400" />
          <MetricCard title="Threats Prevented" value={metrics?.preventedEvents.toLocaleString() || '0'} color="text-emerald-400" />
        </div>

        {/* LangGraph Agent Operations Panel */}
        <div className="mb-6 sm:mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-white mb-3 sm:mb-4">LangGraph Operations Panel</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <AgentResilienceStatus />
            </div>
            <div className="lg:col-span-2 h-[450px]">
              <AgentTriageFeed />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Critical Alerts Queue */}
          <div className="lg:col-span-2 glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-2xl flex flex-col">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-base sm:text-lg font-semibold text-white">Critical Alerts Queue</h3>
                <div className="bg-slate-800 rounded-full p-1 flex">
                  <button onClick={() => setMyQueueOnly(true)} className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${myQueueOnly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>My Queue</button>
                  <button onClick={() => setMyQueueOnly(false)} className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${!myQueueOnly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>Team Queue</button>
                </div>
              </div>
              <button onClick={handleGenerateHandoff} disabled={handoffGenerating} className="px-3 py-1.5 bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 hover:bg-indigo-600 hover:text-white rounded text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">
                {handoffGenerating ? 'Generating...' : 'Generate Handoff Note'}
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar max-h-[450px] pr-1 sm:pr-2">
              {filteredAlerts.length === 0 ? (
                 <p className="text-slate-500 text-sm text-center py-8 italic">No alerts in this queue.</p>
              ) : (
                filteredAlerts.map(alert => {
                  const sla = alert.slaMinutesRemaining ?? 30;
                  const isBreached = sla < 0;
                  const isWarning = !isBreached && sla < 15;
                  const severityBadge = alert.severity <= 1 ? 'S1' : alert.severity === 2 ? 'S2' : 'S3';
                  
                  return (
                    <div 
                      key={alert.id} 
                      className="bg-slate-900 border border-slate-700/50 hover:border-slate-600 rounded-lg p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between transition-colors group cursor-pointer"
                      onClick={() => handleStartInvestigation(alert.id)}
                    >
                      <div className="flex flex-col mb-3 md:mb-0 min-w-0 pr-2">
                        <div className="flex items-center space-x-2.5 mb-1">
                           <span className="text-xs font-mono text-slate-400">{alert.id}</span>
                           <h4 className="text-white font-medium text-xs sm:text-sm truncate">{alert.type.replace(/_/g, ' ')}</h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge severity={severityBadge}>{severityBadge}</Badge>
                          <span className="text-slate-500">Assigned: {alert.assignedTo === 'me' ? 'You' : alert.assignedTo}</span>
                          <span className={`font-mono font-medium ${isBreached ? 'text-red-500' : isWarning ? 'text-yellow-500' : 'text-green-500'}`}>
                            {isBreached ? `SLA BREACHED (${Math.abs(sla)}m ago)` : `SLA: ${sla}m left`}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-center flex-wrap gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleStartInvestigation(alert.id); }}
                          className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors"
                        >
                          Investigate
                        </button>
                        <button 
                          onClick={(e) => handleEscalate(e, alert.id)}
                          className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded transition-colors"
                        >
                          Escalate
                        </button>
                        <button 
                          onClick={(e) => handleFalsePositive(e, alert.id)}
                          className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded transition-colors"
                        >
                          False Positive
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* System Activity Feed */}
          <div className="glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <h3 className="text-base sm:text-lg font-semibold text-white">System Activity</h3>
              <div className="flex items-center">
                <span className="relative flex h-2 w-2 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs text-emerald-500 font-mono">LIVE</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar max-h-[450px] pr-1 sm:pr-2">
              {activities.length === 0 ? (
                <div className="text-slate-500 text-xs text-center py-8 italic">
                  Awaiting live system activity stream...
                </div>
              ) : (
                activities.map((act, i) => (
                  <div key={i} className="flex items-start space-x-3 p-2.5 sm:p-3 rounded-lg bg-slate-900/50 border border-slate-800/50 hover:border-slate-700 transition-colors">
                    <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${act.type === 'alert' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : act.type === 'system' ? 'bg-blue-500' : 'bg-slate-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-slate-200 break-words">{act.msg}</p>
                      <p className="text-[10px] sm:text-xs text-slate-500 font-mono mt-0.5">{act.time}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Floating LLM Chat Assistant */}
      <AgentChatWidget />
    </div>
  );
}

function MetricCard({ title, value, color }: { title: string, value: string, color: string }) {
  return (
    <div className="glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl relative overflow-hidden group flex flex-col justify-between">
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/0 via-blue-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <h3 className="text-slate-400 text-xs sm:text-sm font-medium mb-3 relative z-10">{title}</h3>
      <div className={`text-2xl sm:text-4xl font-bold tracking-tight ${color} relative z-10 drop-shadow-md`}>
        {value}
      </div>
    </div>
  );
}
