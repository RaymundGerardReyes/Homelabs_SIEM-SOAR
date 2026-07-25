import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
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

interface AlertQueueItem {
  id: string;
  title: string;
  severity: string;
  assignedTo: string;
  slaMinutesRemaining: number;
}

export default function OverviewPage() {
  const { data: metrics, loading: metricsLoading, error: metricsError, execute: executeMetrics } = useAsyncState<OverviewMetrics>(async () => {
    const res = await apiClient.get('/metrics/overview');
    return res.data;
  });
  
  const [myQueueOnly, setMyQueueOnly] = useState(true);
  const [alerts] = useState<AlertQueueItem[]>([
    { id: 'ALT-104', title: 'Suspicious PowerShell Execution', severity: 'critical', assignedTo: 'me', slaMinutesRemaining: 12 },
    { id: 'ALT-105', title: 'Multiple Failed Logins', severity: 'high', assignedTo: 'me', slaMinutesRemaining: -5 },
    { id: 'ALT-106', title: 'Malware Detected on WIN-DB-02', severity: 'critical', assignedTo: 'alice', slaMinutesRemaining: 45 }
  ]);
  
  const [handoffGenerating, setHandoffGenerating] = useState(false);

  useEffect(() => {
    executeMetrics();
  }, [executeMetrics]);

  const handleGenerateHandoff = async () => {
    setHandoffGenerating(true);
    try {
      await apiClient.post('/shifts/handoff', { queue: myQueueOnly ? 'me' : 'all' });
      alert('Shift handoff note generated and persisted successfully.');
    } catch (e) {
      alert('Failed to generate handoff note (mocked endpoint).');
    } finally {
      setHandoffGenerating(false);
    }
  };

  const filteredAlerts = myQueueOnly ? alerts.filter(a => a.assignedTo === 'me') : alerts;

  if (metricsLoading) return <div className="p-8 bg-slate-950 min-h-screen pt-24"><LoadingSkeleton lines={8} /></div>;
  if (metricsError && !metrics) return <div className="p-8 bg-slate-950 min-h-screen pt-24"><ErrorState message={metricsError} onRetry={executeMetrics} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div className="mb-4 md:mb-0">
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
              Global Operations Overview
            </h1>
            <p className="text-slate-400">
              Real-time telemetry and threat prevention metrics across all managed tenants.
            </p>
          </div>
          {/* System Health Micro-Status */}
          <div className="flex space-x-6 bg-slate-900 border border-slate-800 px-4 py-2 rounded-lg shadow-md">
             <div className="flex items-center space-x-2">
                <StatusDot status="success" pulse />
                <span className="text-xs font-mono text-slate-300">CORE-INGEST</span>
             </div>
             <div className="flex items-center space-x-2">
                <StatusDot status="success" />
                <span className="text-xs font-mono text-slate-300">SOC-BACKEND</span>
             </div>
             <div className="flex items-center space-x-2">
                <StatusDot status="warning" />
                <span className="text-xs font-mono text-slate-300">THREAT-FEEDS</span>
             </div>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricCard title="Alerts Scanned (24h)" value={metrics?.alertsScanned.toLocaleString() || '0'} color="text-blue-400" />
          <MetricCard title="Open Incidents" value={metrics?.openIncidents.toString() || '0'} color="text-red-400" />
          <MetricCard title="Events Ingested" value={`${metrics?.eventsIngestGB24h || 0} GB`} color="text-indigo-400" />
          <MetricCard title="Threats Prevented" value={metrics?.preventedEvents.toLocaleString() || '0'} color="text-emerald-400" />
        </div>

        {/* LangGraph Agent Operations Panel */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">LangGraph Operations Panel</h2>
          <AgentResilienceStatus />
          <AgentTriageFeed />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Active Critical Alerts Queue */}
          <div className="lg:col-span-2 glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center space-x-4">
                <h3 className="text-lg font-semibold text-white">Critical Alerts Queue</h3>
                <div className="bg-slate-800 rounded-full p-1 flex">
                  <button onClick={() => setMyQueueOnly(true)} className={`px-4 py-1 text-xs font-medium rounded-full transition-colors ${myQueueOnly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>My Queue</button>
                  <button onClick={() => setMyQueueOnly(false)} className={`px-4 py-1 text-xs font-medium rounded-full transition-colors ${!myQueueOnly ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>Team Queue</button>
                </div>
              </div>
              <button onClick={handleGenerateHandoff} disabled={handoffGenerating} className="px-3 py-1.5 bg-indigo-600/20 text-indigo-400 border border-indigo-600/30 hover:bg-indigo-600 hover:text-white rounded text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50">
                {handoffGenerating ? 'Generating...' : 'Generate Handoff Note'}
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
              {filteredAlerts.length === 0 ? (
                 <p className="text-slate-500 text-sm text-center py-8">No alerts in this queue.</p>
              ) : (
                filteredAlerts.map(alert => {
                  const isBreached = alert.slaMinutesRemaining < 0;
                  const isWarning = !isBreached && alert.slaMinutesRemaining < 15;
                  
                  return (
                    <div key={alert.id} className="bg-slate-900 border border-slate-700/50 hover:border-slate-600 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between transition-colors group">
                      <div className="flex flex-col mb-3 sm:mb-0">
                        <div className="flex items-center space-x-3 mb-1">
                           <span className="text-sm font-mono text-slate-400">{alert.id}</span>
                           <h4 className="text-white font-medium">{alert.title}</h4>
                        </div>
                        <div className="flex items-center space-x-3 text-xs">
                          <Badge severity={alert.severity === 'critical' ? 'S1' : 'S2'}>{alert.severity.toUpperCase()}</Badge>
                          <span className="text-slate-500">Assigned: {alert.assignedTo === 'me' ? 'You' : alert.assignedTo}</span>
                          <span className={`font-mono font-medium ${isBreached ? 'text-red-500' : isWarning ? 'text-yellow-500' : 'text-green-500'}`}>
                            {isBreached ? `SLA BREACHED (${Math.abs(alert.slaMinutesRemaining)}m ago)` : `SLA: ${alert.slaMinutesRemaining}m left`}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors">Start Investigation</button>
                        <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded transition-colors">Escalate</button>
                        <button className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded transition-colors">False Positive</button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* System Activity Feed */}
          <div className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-2xl flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-white">System Activity</h3>
              <div className="flex items-center">
                <span className="relative flex h-2 w-2 mr-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs text-emerald-500 font-mono">LIVE</span>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {[ 
                { time: '10:42 AM', msg: 'Playbook Auto-Containment executed', type: 'system' },
                { time: '10:39 AM', msg: 'Multiple failed logins from 192.168.1.5', type: 'alert' },
                { time: '10:15 AM', msg: 'Threat intel feed "AlienVault OTX" synced', type: 'info' },
                { time: '09:55 AM', msg: 'New endpoint WIN-DB-02 registered', type: 'info' }
              ].map((act, i) => (
                <div key={i} className="flex items-start space-x-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800/50 hover:border-slate-700 transition-colors">
                  <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${act.type === 'alert' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : act.type === 'system' ? 'bg-blue-500' : 'bg-slate-500'}`} />
                  <div>
                    <p className="text-sm text-slate-200">{act.msg}</p>
                    <p className="text-xs text-slate-500 font-mono mt-1">{act.time}</p>
                  </div>
                </div>
              ))}
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
    <div className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl relative overflow-hidden group flex flex-col justify-between">
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-white/5 to-transparent rounded-bl-full pointer-events-none" />
      <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/0 via-blue-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <h3 className="text-slate-400 text-sm font-medium mb-4 relative z-10">{title}</h3>
      <div className={`text-4xl font-bold tracking-tight ${color} relative z-10 drop-shadow-md`}>
        {value}
      </div>
    </div>
  );
}
