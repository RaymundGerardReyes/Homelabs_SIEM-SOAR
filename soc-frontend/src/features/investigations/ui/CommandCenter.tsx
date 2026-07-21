import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling, useWebSocketStream } from '../../../shared/hooks';

import { SystemMetrics, Alert } from '../../../shared/types';
import AgentTriageFeed from './AgentTriageFeed';
import AgentResilienceStatus from './AgentResilienceStatus';
import AgentChatWidget from './AgentChatWidget';

export default function CommandCenter() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  usePolling<SystemMetrics>('/metrics/overview', 30000, setMetrics, (err) => console.error(err.message));

  useWebSocketStream<Alert>('/api/ws/alerts', (newAlert) => {
    setAlerts(prev => [newAlert, ...prev].sort((a, b) => b.severity - a.severity));
  });

  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const { isConnected } = useWebSocketStream<any>('/api/ws/agent/stream', (newEvent) => {
    setAgentEvents(prev => [...prev, newEvent]);
  });

  // Calculate agent stats
  const latestFallbackEvent = agentEvents.slice().reverse().find(e => e.fallbackTriggered);
  const isDegraded = !!latestFallbackEvent && latestFallbackEvent.provider !== 'static_ruleset';
  const fallbackRuleTriggered = !!latestFallbackEvent && latestFallbackEvent.provider === 'static_ruleset';
  const activeProvider = fallbackRuleTriggered ? 'Static Ruleset' : (latestFallbackEvent?.provider || 'openai/gpt-4o');

  return (
    <div className="dashboard-home fadeIn p-8 min-h-screen bg-slate-950 text-slate-300 relative overflow-hidden">
      {/* Ambient background glows for premium feel */}
      <div className="absolute top-[-20%] left-[10%] w-[40%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[40%] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="header mb-8 relative z-10 flex justify-between items-start">
        <div>
           <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Good Evening, Analyst</h1>
           <p className="subtitle text-slate-400">System metrics and active investigations are operating nominally.</p>
        </div>
        <div className="w-96">
           <AgentResilienceStatus 
             activeProvider={activeProvider}
             isDegraded={isDegraded}
             fallbackRuleTriggered={fallbackRuleTriggered}
             connectionStatus={isConnected ? 'connected' : 'disconnected'}
             events={agentEvents}
           />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8 relative z-10">
         <div className="lg:col-span-2 space-y-8">
            {/* Bottom KPI Metrics */}
            <div className="kpi-container grid grid-cols-1 md:grid-cols-4 gap-6">
                 <div className="kpi-card glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-blue-500/30">
                     <div className="kpi-label text-slate-400 text-sm font-medium mb-2">Events Ingestion</div>
                     <div className="kpi-value text-3xl font-bold text-blue-400">
                       {metrics ? metrics.eventsIngestGB24h : '...' } <span className="kpi-unit text-sm text-slate-500 font-normal">GB/24H</span>
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-indigo-500/30">
                     <div className="kpi-label text-slate-400 text-sm font-medium mb-2">Data Ingestion</div>
                     <div className="kpi-value text-3xl font-bold text-indigo-400">
                       {metrics ? metrics.dataIngestTB24h : '...'} <span className="kpi-unit text-sm text-slate-500 font-normal">TB/24H</span>
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-red-500/30">
                     <div className="kpi-label text-slate-400 text-sm font-medium mb-2">Total Open Incidents</div>
                     <div className="kpi-value text-3xl font-bold text-red-400">
                       {metrics ? metrics.openIncidents : '...'}
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-emerald-500/30">
                     <div className="kpi-label text-slate-400 text-sm font-medium mb-2">Prevented Events</div>
                     <div className="kpi-value text-3xl font-bold text-emerald-400">
                       {metrics ? new Intl.NumberFormat().format(metrics.preventedEvents) : '...'}
                     </div>
                 </div>
            </div>

            {/* Active Alerts Table/List embedded in Dashboard */}
            <div className="alerts-section glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-2xl">
              <h3 className="section-title text-xl font-bold text-white mb-6 flex items-center">
                Active High-Priority Alerts 
                <span className="pulse-dot ml-3 w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              </h3>
              <div className="alert-grid space-y-4">
                {alerts.length === 0 ? (
                   <div className="text-slate-500 italic text-sm p-4 text-center">No active alerts.</div>
                ) : (
                  alerts.map((alert, index) => {
                    const isCritical = alert.severity <= 2;
                    return (
                      <div 
                        key={alert.id} 
                        className="alert-list-item flex items-center justify-between p-4 bg-slate-900/50 border border-slate-800 rounded-lg hover:border-slate-700 transition-all cursor-pointer group"
                        style={{animationDelay: `${index * 0.1}s`}}
                        onClick={() => navigate(`/investigations/${alert.id}`)}
                      >
                        <div className="flex items-center space-x-4">
                          <div className={`severity-indicator w-12 h-12 flex items-center justify-center rounded-full font-bold font-mono text-sm border ${isCritical ? 'bg-red-500/10 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-orange-500/10 text-orange-400 border-orange-500/50'}`}>
                            S{alert.severity}
                          </div>
                          <div className="alert-details flex flex-col">
                            <span className="alert-type text-white font-medium">{alert.type.replace(/_/g, ' ')}</span>
                            <span className="alert-id text-slate-500 text-xs font-mono mt-1">{alert.id}</span>
                          </div>
                        </div>
                        <button className="investigate-btn px-4 py-2 bg-blue-600/10 text-blue-400 border border-blue-600/30 rounded hover:bg-blue-600 hover:text-white transition-all text-sm font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100">
                          Investigate
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
         </div>

         <div className="h-[600px] lg:h-auto lg:min-h-[600px]">
            <AgentTriageFeed events={agentEvents} />
         </div>
      </div>
      
      <AgentChatWidget />
    </div>
  );
}
