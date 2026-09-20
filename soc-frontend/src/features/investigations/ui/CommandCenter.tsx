import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling, useWebSocketStream } from '../../../shared/hooks';
import apiClient from '../../../shared/api/apiClient';

import { SystemMetrics, Alert } from '../../../shared/types';
import AgentTriageFeed from './AgentTriageFeed';
import AgentResilienceStatus from './AgentResilienceStatus';
import AgentChatWidget from './AgentChatWidget';

// ----------------------------------------------------------------------
// SYSTEM HEALTH BAR COMPONENT
// ----------------------------------------------------------------------
const SystemHealthBar = ({ 
  agentConnected, 
  alertsConnected, 
  metricsError, 
  activeProvider 
}: { 
  agentConnected: boolean, 
  alertsConnected: boolean, 
  metricsError: boolean, 
  activeProvider: string 
}) => {
  return (
    <div className="flex flex-wrap items-center gap-y-2 gap-x-4 p-3 mb-6 bg-slate-900/50 border border-slate-800 rounded-lg text-xs">
      <div className="flex items-center space-x-2">
        <span className="text-slate-400 font-bold uppercase tracking-wider">System Health:</span>
      </div>
      
      <div className="flex items-center space-x-1.5 sm:border-l sm:border-slate-800 sm:pl-4">
        <div className={`w-2 h-2 rounded-full ${agentConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`}></div>
        <span className={agentConnected ? 'text-slate-300' : 'text-red-400'}>Agent Stream</span>
      </div>

      <div className="flex items-center space-x-1.5 sm:border-l sm:border-slate-800 sm:pl-4">
        <div className={`w-2 h-2 rounded-full ${alertsConnected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`}></div>
        <span className={alertsConnected ? 'text-slate-300' : 'text-red-400'}>Alerts Stream</span>
      </div>

      <div className="flex items-center space-x-1.5 sm:border-l sm:border-slate-800 sm:pl-4">
        <div className={`w-2 h-2 rounded-full ${!metricsError ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-orange-500 animate-pulse'}`}></div>
        <span className={!metricsError ? 'text-slate-300' : 'text-orange-400'}>Metrics Polling</span>
      </div>

      <div className="flex items-center space-x-2 sm:border-l sm:border-slate-800 sm:pl-4">
        <span className="text-slate-500">LLM Engine:</span>
        <span className={`font-mono px-2 py-0.5 rounded text-[11px] ${activeProvider === 'Static Ruleset' ? 'bg-orange-900/30 text-orange-400 border border-orange-500/30' : 'bg-blue-900/30 text-blue-400 border border-blue-500/30'}`}>
          {activeProvider}
        </span>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// MAIN COMMAND CENTER
// ----------------------------------------------------------------------
export default function CommandCenter() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Load initial alerts from live API
  React.useEffect(() => {
    apiClient.get<Alert[]>('/alerts')
      .then(res => {
        if (Array.isArray(res.data)) {
          setAlerts(res.data);
        }
      })
      .catch(err => console.error("Failed to load initial alerts", err));
  }, []);

  // 1. Metrics Polling (Added explicit error state)
  usePolling<SystemMetrics>('/metrics/overview', 30000, 
    (data) => {
      setMetrics(data);
      setMetricsError(false);
    }, 
    (err) => {
      console.error(err.message);
      setMetricsError(true);
    }
  );

  // 2. Alerts WebSocket (Destructured isConnected)
  const { isConnected: alertsConnected } = useWebSocketStream<Alert>('/api/ws/alerts', (newAlert) => {
    if (!newAlert || !newAlert.id) return;
    setAlerts((prev: Alert[]) => {
      if (prev.some((a: Alert) => a.id === newAlert.id)) return prev;
      return [newAlert, ...prev].sort((a: Alert, b: Alert) => b.severity - a.severity);
    });
  });

  // 3. Agent WebSocket
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const { isConnected: agentConnected } = useWebSocketStream<any>('/api/ws/agent/stream', (newEvent) => {
    // Inject a timestamp so we can calculate staleness
    const eventWithTime = { ...newEvent, _receivedAt: Date.now() };
    setAgentEvents((prev: any[]) => [...prev, eventWithTime]);
  });

  // Calculate agent fallback state with 10-minute staleness expiration
  const STALENESS_WINDOW_MS = 10 * 60 * 1000; 
  const latestFallbackEvent = agentEvents.slice().reverse().find(e => e.fallbackTriggered);
  
  let isDegraded = false;
  let fallbackRuleTriggered = false;
  let activeProvider = 'openai/gpt-4o'; // Default baseline

  if (latestFallbackEvent) {
    const isStale = (Date.now() - latestFallbackEvent._receivedAt) > STALENESS_WINDOW_MS;
    if (!isStale) {
      isDegraded = latestFallbackEvent.provider !== 'static_ruleset';
      fallbackRuleTriggered = latestFallbackEvent.provider === 'static_ruleset';
      activeProvider = fallbackRuleTriggered ? 'Static Ruleset' : latestFallbackEvent.provider;
    }
  }

  // Quick Triage Actions
  const handleAcknowledge = async (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation(); // Prevent navigation
    try {
      await apiClient.patch(`/alerts/${alertId}/acknowledge`);
      setAlerts((prev: Alert[]) => prev.filter((a: Alert) => a.id !== alertId));
    } catch (err) {
      console.error("Failed to acknowledge alert", err);
    }
  };

  const handleAssignToMe = async (e: React.MouseEvent, alertId: string) => {
    e.stopPropagation(); // Prevent navigation
    try {
      await apiClient.patch(`/alerts/${alertId}/assign`);
      alert(`Alert ${alertId} assigned to you.`);
    } catch (err) {
      console.error("Failed to assign alert", err);
    }
  };

  return (
    <div className="dashboard-home fadeIn p-4 sm:p-6 lg:p-8 min-h-screen bg-slate-950 text-slate-300 relative overflow-hidden">
      {/* Ambient background glows for premium feel */}
      <div className="absolute top-[-20%] left-[10%] w-[40%] h-[50%] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[40%] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />
      
      {/* New Unified System Health Bar */}
      <SystemHealthBar 
        agentConnected={agentConnected}
        alertsConnected={alertsConnected}
        metricsError={metricsError}
        activeProvider={activeProvider}
      />

      <div className="header mb-6 sm:mb-8 relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
           <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 tracking-tight">Good Evening, Analyst</h1>
           <p className="subtitle text-xs sm:text-sm text-slate-400">System metrics and active investigations are operating nominally.</p>
        </div>
        <div className="w-full lg:w-96">
           <AgentResilienceStatus 
             activeProvider={activeProvider}
             isDegraded={isDegraded}
             fallbackRuleTriggered={fallbackRuleTriggered}
             connectionStatus={agentConnected ? 'connected' : 'disconnected'}
             events={agentEvents}
           />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8 mb-8 relative z-10">
         <div className="lg:col-span-2 space-y-6 sm:space-y-8">
            {/* Bottom KPI Metrics */}
            <div className="kpi-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                 <div className="kpi-card glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-blue-500/30">
                     <div className="kpi-label text-slate-400 text-xs sm:text-sm font-medium mb-2 flex items-center justify-between">
                       Events Ingestion
                       {metricsError && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Metrics unavailable - retrying..."></span>}
                     </div>
                     <div className="kpi-value text-2xl sm:text-3xl font-bold text-blue-400">
                       {metrics ? metrics.eventsIngestGB24h : (metricsError ? 'ERR' : '...') } <span className="kpi-unit text-xs sm:text-sm text-slate-500 font-normal">GB/24H</span>
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-indigo-500/30">
                     <div className="kpi-label text-slate-400 text-xs sm:text-sm font-medium mb-2 flex items-center justify-between">
                       Data Ingestion
                       {metricsError && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Metrics unavailable - retrying..."></span>}
                     </div>
                     <div className="kpi-value text-2xl sm:text-3xl font-bold text-indigo-400">
                       {metrics ? metrics.dataIngestTB24h : (metricsError ? 'ERR' : '...')} <span className="kpi-unit text-xs sm:text-sm text-slate-500 font-normal">TB/24H</span>
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-red-500/30">
                     <div className="kpi-label text-slate-400 text-xs sm:text-sm font-medium mb-2 flex items-center justify-between">
                       Total Open Incidents
                       {metricsError && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Metrics unavailable - retrying..."></span>}
                     </div>
                     <div className="kpi-value text-2xl sm:text-3xl font-bold text-red-400">
                       {metrics ? metrics.openIncidents : (metricsError ? 'ERR' : '...')}
                     </div>
                 </div>
                 <div className="kpi-card glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-xl interactive-card hover-lift transition-all hover:border-emerald-500/30">
                     <div className="kpi-label text-slate-400 text-xs sm:text-sm font-medium mb-2 flex items-center justify-between">
                       Prevented Events
                       {metricsError && <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" title="Metrics unavailable - retrying..."></span>}
                     </div>
                     <div className="kpi-value text-2xl sm:text-3xl font-bold text-emerald-400">
                       {metrics ? new Intl.NumberFormat().format(metrics.preventedEvents) : (metricsError ? 'ERR' : '...')}
                     </div>
                 </div>
            </div>

            {/* Active Alerts Table/List embedded in Dashboard */}
            <div className="alerts-section glass-panel-dark rounded-xl p-4 sm:p-6 border border-slate-800 shadow-2xl relative">
              <h3 className="section-title text-lg sm:text-xl font-bold text-white mb-4 sm:mb-6 flex items-center">
                Active High-Priority Alerts 
                <span className={`pulse-dot ml-3 w-2 h-2 rounded-full ${alertsConnected ? 'bg-red-500 animate-ping' : 'bg-slate-600'}`}></span>
              </h3>
              
              {!alertsConnected && (
                <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-xs sm:text-sm flex items-center">
                  <span className="mr-2">⚠️</span> Live alerts feed disconnected — showing last known data.
                </div>
              )}

              <div className="alert-grid space-y-3 sm:space-y-4">
                {alerts.length === 0 ? (
                   <div className="text-slate-500 italic text-sm p-4 text-center">No active alerts.</div>
                ) : (
                  alerts.map((alert: Alert, index: number) => {
                    const isCritical = alert.severity <= 2;
                    return (
                      <div 
                        key={alert.id} 
                        className="alert-list-item flex flex-col md:flex-row md:items-center justify-between p-3.5 sm:p-4 bg-slate-900/50 border border-slate-800 rounded-lg hover:border-slate-700 transition-all cursor-pointer group"
                        style={{animationDelay: `${index * 0.1}s`}}
                        onClick={() => navigate(`/investigations/${alert.id}`)}
                      >
                        <div className="flex items-center space-x-3 sm:space-x-4">
                          <div className={`severity-indicator w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 flex items-center justify-center rounded-full font-bold font-mono text-xs sm:text-sm border ${isCritical ? 'bg-red-500/10 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'bg-orange-500/10 text-orange-400 border-orange-500/50'}`}>
                            S{alert.severity}
                          </div>
                          <div className="alert-details flex flex-col min-w-0">
                            <span className="alert-type text-white font-medium text-xs sm:text-sm truncate">{alert.type.replace(/_/g, ' ')}</span>
                            <span className="alert-id text-slate-500 text-[10px] sm:text-xs font-mono mt-0.5 truncate">{alert.id}</span>
                          </div>
                        </div>
                        
                        <div className="flex items-center flex-wrap gap-2 mt-3 md:mt-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => handleAcknowledge(e, alert.id)}
                            className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded hover:bg-slate-700 transition-all text-xs font-medium"
                          >
                            ACKNOWLEDGE
                          </button>
                          <button 
                            onClick={(e) => handleAssignToMe(e, alert.id)}
                            className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-slate-800 text-slate-300 border border-slate-700 rounded hover:bg-slate-700 transition-all text-xs font-medium"
                          >
                            ASSIGN
                          </button>
                          <button className="px-2.5 py-1 sm:px-3 sm:py-1.5 bg-blue-600/10 text-blue-400 border border-blue-600/30 rounded hover:bg-blue-600 hover:text-white transition-all text-xs font-bold uppercase tracking-wider">
                            INVESTIGATE
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
         </div>

         <div className="h-[600px] lg:h-auto lg:min-h-[600px] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold flex items-center">
                Agent Triage Feed
                <span className={`pulse-dot ml-3 w-2 h-2 rounded-full ${agentConnected ? 'bg-blue-500 animate-pulse' : 'bg-slate-600'}`}></span>
              </h3>
            </div>
            
            {!agentConnected && (
              <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded text-red-400 text-xs flex items-center">
                <span className="mr-2">⚠️</span> Live agent feed disconnected.
              </div>
            )}
            
            <div className="flex-1 overflow-hidden border border-slate-800 rounded-xl glass-panel-dark relative">
               <AgentTriageFeed events={agentEvents} />
            </div>
         </div>
      </div>
      
      <AgentChatWidget />
    </div>
  );
}
