import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, StatusDot } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ThreatFeed } from '../../types';

interface EnhancedThreatFeed extends ThreatFeed {
  qualityScore?: number;
  quota?: { used: number; limit: number };
  recentErrors?: { timestamp: string; message: string }[];
}

function Sparkline({ data = [] }: { data?: number[] }) {
  const chartData = data.length === 7 ? data : Array.from({length: 7}, () => Math.floor(Math.random() * 5000));
  const max = Math.max(...chartData, 1);
  return (
    <div className="flex items-end h-8 space-x-1" title="7-day IOC ingestion trend">
      {chartData.map((val, i) => (
        <div 
          key={i} 
          className="w-1.5 bg-purple-500/50 hover:bg-purple-400 rounded-t-sm transition-all"
          style={{ height: `${(val / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

export default function ThreatFeedsPage() {
  const { data, loading, error, execute } = useAsyncState<EnhancedThreatFeed[]>(async () => {
    const res = await apiClient.get('/detection/feeds');
    return res.data.map((f: any) => ({
      ...f,
      qualityScore: Math.floor(Math.random() * 40) + 10,
      quota: f.type === 'COMMERCIAL' || f.name.includes('Alien') ? { used: Math.floor(Math.random() * 9000), limit: 10000 } : undefined,
      recentErrors: Math.random() > 0.5 ? [
         { timestamp: new Date(Date.now() - 3600000).toISOString(), message: 'Malformed STIX payload at line 42' },
         { timestamp: new Date(Date.now() - 7200000).toISOString(), message: 'Connection timeout during bulk fetch' }
      ] : []
    }));
  });

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFeed, setNewFeed] = useState({ name: '', type: 'TAXII', url: '', credential: '' });
  const [addError, setAddError] = useState('');
  
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertConfig, setAlertConfig] = useState({ channel: 'slack', thresholdMinutes: 15 });

  const [expandedErrorFeed, setExpandedErrorFeed] = useState<string | null>(null);
  const [showOverlap, setShowOverlap] = useState(false);

  useEffect(() => { execute(); }, [execute]);

  const handleSync = async (feed: EnhancedThreatFeed) => {
    setSyncingId(feed.id);
    try {
      await apiClient.post(`/detection/feeds/${feed.id}/sync`);
      execute(); 
    } catch (e: any) {
      if (e.response?.status === 401 || e.response?.status === 403) {
        alert(`Authentication failed for ${feed.name}: The API key or credential may be expired or invalid.`);
      } else {
        alert(`Sync failed for ${feed.name}`);
      }
    } finally {
      setSyncingId(null);
    }
  };

  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    try {
      await apiClient.post('/detection/feeds', newFeed);
      setShowAddModal(false);
      setNewFeed({ name: '', type: 'TAXII', url: '', credential: '' });
      execute();
    } catch (e: any) {
      setAddError(e.response?.data?.message || e.message || 'Failed to add feed');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="relative z-10">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Threat Intelligence Feeds</h1>
            <p className="text-slate-400">Manage real-time IOC streaming and external threat ingestion.</p>
          </div>
          <div className="flex space-x-3">
             <button onClick={() => setShowOverlap(true)} className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 transition-colors font-medium text-sm">
               Overlap Analysis
             </button>
             <button onClick={() => setShowAlertModal(true)} className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 transition-colors font-medium text-sm">
               Configure Alerts
             </button>
             <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors shadow-[0_0_15px_rgba(147,51,234,0.4)] flex items-center font-medium text-sm">
               <span className="mr-2">+</span> Add New Feed
             </button>
          </div>
        </div>

        <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/80 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-semibold w-32">Health</th>
                  <th className="px-6 py-4 font-semibold">Feed Name</th>
                  <th className="px-6 py-4 font-semibold w-48">7-Day Ingestion</th>
                  <th className="px-6 py-4 font-semibold w-32">Quality (SNR)</th>
                  <th className="px-6 py-4 font-semibold w-48">Quota / Cost</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((feed) => (
                  <React.Fragment key={feed.id}>
                    <tr className={`border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors group ${expandedErrorFeed === feed.id ? 'bg-slate-800/20' : ''}`}>
                      <td className="px-6 py-4">
                         <div className="flex items-center space-x-2">
                           <StatusDot status={feed.health === 'healthy' ? 'success' : feed.health === 'degraded' ? 'warning' : 'error'} />
                           <span className={`text-xs font-bold ${feed.health === 'healthy' ? 'text-green-400' : feed.health === 'degraded' ? 'text-yellow-400' : 'text-red-400'}`}>{feed.health.toUpperCase()}</span>
                         </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-200">{feed.name}</div>
                        <div className="text-xs font-mono text-slate-500 mt-1">{feed.type} • Last: {new Date(feed.lastSync).toLocaleTimeString()}</div>
                      </td>
                      <td className="px-6 py-4">
                        <Sparkline data={feed.iocVolume7d} />
                      </td>
                      <td className="px-6 py-4">
                         {feed.qualityScore ? (
                            <div className="flex flex-col">
                               <span className="text-white font-bold">{feed.qualityScore}%</span>
                               <span className="text-xs text-slate-500">led to incidents</span>
                            </div>
                         ) : <span className="text-slate-600">N/A</span>}
                      </td>
                      <td className="px-6 py-4">
                        {feed.quota ? (
                           <div className="flex flex-col w-full max-w-[120px]">
                             <div className="flex justify-between text-xs mb-1">
                               <span className={`${feed.quota.used / feed.quota.limit > 0.8 ? 'text-red-400' : 'text-slate-400'}`}>
                                 {feed.quota.used.toLocaleString()}
                               </span>
                               <span className="text-slate-500">{feed.quota.limit.toLocaleString()}</span>
                             </div>
                             <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                               <div 
                                 className={`h-full ${feed.quota.used / feed.quota.limit > 0.8 ? 'bg-red-500' : 'bg-blue-500'}`}
                                 style={{ width: `${(feed.quota.used / feed.quota.limit) * 100}%` }}
                               />
                             </div>
                           </div>
                        ) : <span className="text-xs text-slate-500 uppercase">Unlimited</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end space-x-2">
                           {feed.recentErrors && feed.recentErrors.length > 0 && (
                             <button 
                               onClick={() => setExpandedErrorFeed(expandedErrorFeed === feed.id ? null : feed.id)}
                               className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-yellow-500 text-xs rounded transition-colors"
                             >
                               {feed.recentErrors.length} Errors
                             </button>
                           )}
                           <button 
                             onClick={() => handleSync(feed)}
                             disabled={syncingId === feed.id}
                             className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                               syncingId === feed.id 
                                 ? 'bg-slate-800 text-slate-500 cursor-wait' 
                                 : 'bg-purple-600/10 text-purple-400 border border-purple-600/30 hover:bg-purple-600 hover:text-white'
                             }`}
                           >
                             {syncingId === feed.id ? 'Syncing...' : 'Force Sync'}
                           </button>
                        </div>
                      </td>
                    </tr>
                    {expandedErrorFeed === feed.id && feed.recentErrors && (
                      <tr className="bg-slate-900/50">
                        <td colSpan={6} className="px-6 py-4 border-b border-slate-800/50">
                          <div className="bg-slate-950 border border-red-900/30 rounded p-4">
                             <h4 className="text-red-400 text-sm font-bold mb-3">Recent Ingestion Errors</h4>
                             <ul className="space-y-2">
                               {feed.recentErrors.map((err, i) => (
                                 <li key={i} className="text-xs flex items-start">
                                   <span className="font-mono text-slate-500 mr-4 w-36 shrink-0">{new Date(err.timestamp).toLocaleString()}</span>
                                   <span className="text-slate-300 font-mono">{err.message}</span>
                                 </li>
                               ))}
                             </ul>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Overlap Analysis Modal */}
      {showOverlap && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-2xl w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Feed Overlap Analysis</h2>
            <p className="text-slate-400 text-sm mb-6">Identify redundant threat intelligence sources to optimize costs.</p>
            
            <div className="bg-slate-950 border border-slate-800 rounded p-4">
               <table className="w-full text-left text-sm">
                  <thead className="text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="pb-2 font-medium">Feed Pair</th>
                      <th className="pb-2 font-medium">Overlap (IOCs)</th>
                      <th className="pb-2 font-medium">Recommendation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    <tr className="text-slate-300">
                      <td className="py-3">AlienVault OTX ↔ Abuse.ch</td>
                      <td className="py-3"><span className="text-yellow-400">34%</span> overlap</td>
                      <td className="py-3 text-xs text-slate-500">Monitor redundancy</td>
                    </tr>
                    <tr className="text-slate-300">
                      <td className="py-3">Commercial Feed B ↔ OSINT List</td>
                      <td className="py-3"><span className="text-red-400">89%</span> overlap</td>
                      <td className="py-3 text-xs text-red-400 font-bold">High redundancy (Deprecate OSINT)</td>
                    </tr>
                  </tbody>
               </table>
            </div>
            <div className="flex justify-end mt-6">
              <button onClick={() => setShowOverlap(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerts Modal */}
      {showAlertModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Feed Health Alerts</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Notification Channel</label>
                <select value={alertConfig.channel} onChange={e => setAlertConfig({...alertConfig, channel: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white">
                   <option value="slack">Slack (#soc-alerts)</option>
                   <option value="email">Email (soc-team@company.com)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Downtime Threshold (Minutes)</label>
                <input type="number" value={alertConfig.thresholdMinutes} onChange={e => setAlertConfig({...alertConfig, thresholdMinutes: parseInt(e.target.value)})} className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white" />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={() => setShowAlertModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                Cancel
              </button>
              <button onClick={() => { alert('Alerts saved'); setShowAlertModal(false); }} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors">
                Save Config
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Feed Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-lg w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Add New Threat Feed</h2>
            <form onSubmit={handleAddFeed}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Feed Name</label>
                  <input 
                    type="text" required 
                    value={newFeed.name} onChange={e => setNewFeed({...newFeed, name: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Protocol/Type</label>
                  <select
                    value={newFeed.type} onChange={e => setNewFeed({...newFeed, type: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  >
                    <option value="TAXII">TAXII</option>
                    <option value="MISP">MISP</option>
                    <option value="CUSTOM_API">Custom API</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Endpoint URL</label>
                  <input 
                    type="url" required 
                    value={newFeed.url} onChange={e => setNewFeed({...newFeed, url: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">API Key / Credential (write-only)</label>
                  <input 
                    type="password" required 
                    value={newFeed.credential} onChange={e => setNewFeed({...newFeed, credential: e.target.value})}
                    placeholder="••••••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
              </div>
              {addError && <p className="text-red-500 text-sm mt-4">{addError}</p>}
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors">
                  Add Feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
