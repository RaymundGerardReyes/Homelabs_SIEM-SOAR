import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePolling, useWebSocketStream } from '../../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../../shared/ui';
import { SystemMetrics, Alert } from '../../../shared/types';

export default function CommandCenter() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  usePolling<SystemMetrics>('/metrics/overview', 30000, setMetrics, (err) => setMetricsError(err.message));

  const { isConnected } = useWebSocketStream<Alert>('/ws/alerts', (newAlert) => {
    setAlerts(prev => [newAlert, ...prev].sort((a, b) => b.severity - a.severity));
  });

  return (
    <div className="p-8 ml-64 min-h-screen bg-slate-950">
      <h1 className="text-2xl font-bold text-white mb-6">Command Center</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="col-span-1 lg:col-span-3 bg-slate-900 border border-slate-800 p-6 rounded-lg">
          <h2 className="text-lg font-medium text-slate-300 mb-4">System Metrics (24h)</h2>
          {metricsError ? (
            <ErrorState message="Failed to load metrics" />
          ) : !metrics ? (
            <LoadingSkeleton lines={2} />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
              <div>
                <p className="text-sm text-slate-500 mb-1">Alerts Scanned</p>
                <p className="text-2xl font-bold text-white">{new Intl.NumberFormat().format(metrics.alertsScanned)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 mb-1">Data Ingested (TB)</p>
                <p className="text-2xl font-bold text-white">{metrics.dataIngestTB24h}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 mb-1">Events (GB)</p>
                <p className="text-2xl font-bold text-white">{metrics.eventsIngestGB24h}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 mb-1">Open Incidents</p>
                <p className="text-2xl font-bold text-white">{metrics.openIncidents}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 mb-1">Prevented Events</p>
                <p className="text-2xl font-bold text-green-400">{new Intl.NumberFormat().format(metrics.preventedEvents)}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-medium text-white flex items-center">
            Active Alerts feed
            <span className={`ml-3 w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
          </h2>
        </div>
        <div className="p-0">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-slate-500">Listening for new alerts over WebSocket...</div>
          ) : (
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-800/50 text-slate-400">
                <tr>
                  <th className="p-4">ID</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Severity</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(alert => (
                  <tr key={alert.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                    <td className="p-4">{alert.id}</td>
                    <td className="p-4">{alert.type}</td>
                    <td className="p-4">
                      <Badge severity={alert.severity >= 4 ? 'S1' : alert.severity === 3 ? 'S2' : alert.severity === 2 ? 'S3' : 'S4'}>
                        {alert.severity >= 4 ? 'Critical' : alert.severity === 3 ? 'High' : alert.severity === 2 ? 'Medium' : 'Low'}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <button 
                        onClick={() => navigate(`/investigations/${alert.id}`)}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        Investigate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
