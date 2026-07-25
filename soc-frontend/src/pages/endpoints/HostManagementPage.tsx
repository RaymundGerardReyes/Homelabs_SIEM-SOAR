import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ManagedHost } from '../../shared/types';
import { useNavigate, Link } from 'react-router-dom';

interface EnhancedHost extends ManagedHost {
  criticality?: 'Tier-1' | 'Tier-2' | 'Tier-3';
  openIncidentsCount?: number;
  lastIsolatedDaysAgo?: number;
  trendingStale?: boolean;
  type?: 'paas' | 'iaas' | 'local_cf_tunnel';
}

export default function HostManagementPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedHost[]>(async () => {
    const res = await apiClient.get('/endpoints/hosts');
    // Mock enhanced data
    return res.data.map((h: any, i: number) => ({
      ...h,
      criticality: i % 5 === 0 ? 'Tier-1' : i % 3 === 0 ? 'Tier-2' : 'Tier-3',
      openIncidentsCount: i % 4 === 0 ? Math.floor(Math.random() * 3) + 1 : 0,
      lastIsolatedDaysAgo: i % 7 === 0 ? Math.floor(Math.random() * 30) + 1 : undefined,
      trendingStale: h.health === 'healthy' && Math.random() > 0.8,
      type: i % 4 === 0 ? 'paas' : i % 2 === 0 ? 'iaas' : 'local_cf_tunnel',
    })).sort((a: any) => (a.criticality === 'Tier-1' ? -1 : 1));
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'restart' | 'update' | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; completed: number; failed: number } | null>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'out-of-compliance'>('all');
  const [enrollmentToken, setEnrollmentToken] = useState<string | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const handleEnrollNewSpoke = async () => {
    try {
      const res = await apiClient.post('/api/endpoints/generate-enrollment-token');
      setEnrollmentToken(res.data.token);
    } catch (e) {
      alert('Failed to generate enrollment token');
    }
  };

  const handleRotateCredential = async (endpointId: string) => {
    if (window.confirm('Are you sure you want to rotate the Zero-Trust service credential for this endpoint? Existing active tunnels will be broken until re-enrolled.')) {
      try {
        await apiClient.post(`/api/endpoints/${endpointId}/rotate`);
        alert('Credential rotated successfully. The agent must now be re-enrolled.');
        execute();
      } catch (e) {
        alert('Failed to rotate credential');
      }
    }
  };

  const handleBulkAction = async (action: 'restart' | 'update') => {
    setBulkAction(action);
    setBulkProgress({ total: selectedIds.size, completed: 0, failed: 0 });
    
    // Simulate batch processing with progress
    let completed = 0;
    let failed = 0;
    for (const id of Array.from(selectedIds)) {
      await new Promise(r => setTimeout(r, 400));
      if (Math.random() > 0.9) failed++;
      else completed++;
      
      if (action === 'update' && data) {
         setData(data.map(h => h.id === id ? { ...h, agentVersion: h.latestVersion } : h));
      }
      setBulkProgress({ total: selectedIds.size, completed, failed });
    }
    
    setTimeout(() => {
      setBulkAction(null);
      setBulkProgress(null);
      setSelectedIds(new Set());
    }, 2000);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredData?.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredData?.map(h => h.id)));
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const outOfComplianceCount = data?.filter(h => h.agentVersion !== h.latestVersion || h.health === 'stale').length || 0;
  const complianceRate = data ? Math.round(((data.length - outOfComplianceCount) / data.length) * 100) : 100;

  const filteredData = data?.filter(h => 
    viewFilter === 'all' || (viewFilter === 'out-of-compliance' && (h.agentVersion !== h.latestVersion || h.health === 'stale'))
  );

  return (
    <div className="p-8 bg-slate-950 min-h-screen flex flex-col">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Host Management</h1>
          <p className="text-slate-400 text-sm">Proactive fleet health, compliance baselining, and agent operations.</p>
        </div>
         <div className="flex items-center space-x-6 bg-slate-900 border border-slate-800 p-3 rounded-lg">
           <div className="text-center">
             <button onClick={handleEnrollNewSpoke} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded shadow-lg shadow-indigo-500/20 transition-all text-sm">
                + Enroll Spoke
             </button>
           </div>
           <div className="w-px h-8 bg-slate-800"></div>
           <div className="text-center">
             <p className="text-2xl font-bold text-white">{complianceRate}%</p>
             <p className="text-xs text-slate-500 uppercase tracking-wide">Fleet Compliance</p>
           </div>
           <div className="w-px h-8 bg-slate-800"></div>
           <div className="text-center cursor-pointer" onClick={() => setViewFilter(viewFilter === 'all' ? 'out-of-compliance' : 'all')}>
             <p className={`text-2xl font-bold ${outOfComplianceCount > 0 ? 'text-yellow-500' : 'text-green-500'}`}>{outOfComplianceCount}</p>
             <p className="text-xs text-slate-500 uppercase tracking-wide">{viewFilter === 'out-of-compliance' ? 'View All (Clear)' : 'Out of Baseline'}</p>
           </div>
        </div>
      </div>

      {/* Enrollment Token Display */}
      {enrollmentToken && (
        <div className="bg-green-900/30 border border-green-500/50 p-4 rounded-lg mb-6 flex flex-col justify-between items-start">
            <div className="flex justify-between w-full">
                <h3 className="text-green-400 font-bold mb-2 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    One-Time Bootstrap Token Generated
                </h3>
                <button onClick={() => setEnrollmentToken(null)} className="text-slate-400 hover:text-white">
                    ✕
                </button>
            </div>
            <p className="text-sm text-slate-300 mb-3">
                Run this command on the new Spoke (Local, PaaS, or IaaS) to securely enroll it. This token expires in 15 minutes and can only be used once. Do not share it.
            </p>
            <div className="bg-slate-950 border border-slate-800 p-3 rounded w-full font-mono text-sm text-green-300 break-all select-all">
                curl -fsSL https://siem.yourdomain.com/bootstrap.sh | sh -s -- --enroll-token {enrollmentToken}
            </div>
        </div>
      )}

      {/* Bulk Operations Action Bar & Progress */}
      {(selectedIds.size > 0 || bulkProgress) && (
        <div className="bg-indigo-900/30 border border-indigo-500/50 p-4 rounded-lg mb-6 flex flex-col md:flex-row justify-between items-start md:items-center">
           {!bulkProgress ? (
             <>
               <span className="text-indigo-300 font-medium mb-3 md:mb-0">{selectedIds.size} hosts selected</span>
               <div className="flex space-x-3">
                 <button onClick={() => handleBulkAction('restart')} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm rounded transition-colors border border-slate-700">
                   Restart Agents
                 </button>
                 <button onClick={() => handleBulkAction('update')} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors">
                   Update to Baseline
                 </button>
               </div>
             </>
           ) : (
             <div className="w-full">
               <div className="flex justify-between text-sm text-indigo-300 mb-2">
                 <span>Executing bulk {bulkAction}...</span>
                 <span>{bulkProgress.completed + bulkProgress.failed} / {bulkProgress.total}</span>
               </div>
               <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                 <div className="bg-blue-500 h-full transition-all duration-300" style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }} />
                 <div className="bg-red-500 h-full transition-all duration-300" style={{ width: `${(bulkProgress.failed / bulkProgress.total) * 100}%` }} />
               </div>
               {bulkProgress.failed > 0 && <p className="text-xs text-red-400 mt-2">{bulkProgress.failed} failed</p>}
             </div>
           )}
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-4 w-10">
                <input 
                  type="checkbox" 
                  checked={filteredData && filteredData.length > 0 && selectedIds.size === filteredData.length}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
                />
              </th>
              <th className="p-4">Hostname / Criticality</th>
              <th className="p-4">OS & Agent Baseline</th>
              <th className="p-4">Health / Telemetry</th>
              <th className="p-4">Incident Context</th>
              <th className="p-4">Access (Zero Trust)</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {(filteredData || []).map(h => (
              <tr key={h.id} className={`hover:bg-slate-800/30 ${h.criticality === 'Tier-1' && h.health !== 'healthy' ? 'bg-red-900/10' : ''}`}>
                <td className="p-4">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(h.id)}
                    onChange={() => toggleSelect(h.id)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
                  />
                </td>
                <td className="p-4">
                  <div className="flex flex-col">
                    <span className="font-bold text-white flex items-center space-x-2">
                      <span>{h.hostname}</span>
                      {h.type === 'paas' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-500/30">PaaS</span>}
                      {h.type === 'iaas' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-500/30">IaaS</span>}
                      {h.type === 'local_cf_tunnel' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/30">Local (CF Tunnel)</span>}
                    </span>
                    <span className={`text-xs mt-1 w-max px-1.5 py-0.5 rounded ${h.criticality === 'Tier-1' ? 'bg-red-900/40 text-red-400 border border-red-800/50' : 'bg-slate-800 text-slate-400'}`}>
                      {h.criticality}
                    </span>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col space-y-1">
                    <span className="text-slate-300">{h.os}</span>
                    <span className={`text-xs ${h.agentVersion === h.latestVersion ? 'text-green-500' : 'text-yellow-500 font-bold'}`}>
                      Agent: {h.agentVersion} {h.agentVersion !== h.latestVersion && '(Outdated)'}
                    </span>
                  </div>
                </td>
                <td className="p-4">
                   <div className="flex flex-col space-y-2">
                     <Badge severity={h.health === 'healthy' ? 'S4' : h.health === 'stale' ? 'S3' : 'S1'}>
                       {h.health.toUpperCase()} (HTTP AGENT)
                     </Badge>
                     {h.trendingStale && (
                        <span className="text-xs text-yellow-500 flex items-center" title="Check-in interval increasing">
                          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
                          Trending Stale
                        </span>
                     )}
                     <div className="flex flex-col space-y-1">
                       <span className="text-xs text-slate-500 flex items-center">
                         <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${h.health === 'healthy' ? 'bg-green-500' : 'bg-red-500'}`} />
                         Last Sync: {new Date(h.lastCheckIn).toLocaleTimeString()}
                       </span>
                       <span className="text-xs text-indigo-400 font-mono">
                         [CF Tunnel / HTTPS]
                       </span>
                     </div>
                   </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col space-y-1">
                     {h.openIncidentsCount ? (
                       <Link to={`/incidents/active?entity=${h.id}`} className="inline-flex items-center text-xs text-red-400 hover:text-red-300 bg-red-900/20 px-2 py-1 rounded w-max">
                         ⚠️ Involved in {h.openIncidentsCount} incidents
                       </Link>
                     ) : (
                       <span className="text-xs text-slate-600">No active incidents</span>
                     )}
                     {h.lastIsolatedDaysAgo && (
                       <Link to={`/endpoints/isolation?entity=${h.id}`} className="inline-flex items-center text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-900/20 px-2 py-1 rounded w-max">
                         🛡️ Isolated {h.lastIsolatedDaysAgo}d ago
                       </Link>
                     )}
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col space-y-2">
                    <span className="text-xs text-slate-300 break-all bg-slate-900 p-1 rounded">
                      https://{h.id}.yourdomain.com
                    </span>
                    <a href={`https://${h.id}-ssh.yourdomain.com`} target="_blank" rel="noreferrer" className="text-[10px] uppercase tracking-wider text-red-400 hover:text-red-300 border border-red-900 bg-red-950/30 px-2 py-1 rounded w-max transition-colors">
                      Manual / Break-Glass SSH
                    </a>
                  </div>
                </td>
                <td className="p-4 text-right">
                   <div className="flex justify-end space-x-2">
                     <button 
                       onClick={() => navigate(`/endpoints/isolation?host=${h.id}`)} 
                       disabled={h.type === 'paas'} 
                       title={h.type === 'paas' ? 'Isolation not applicable for PaaS endpoints' : 'Isolate Host'}
                       className={`px-3 py-1.5 rounded text-xs border transition-colors ${h.type === 'paas' ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed' : 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border-red-500/30'}`}
                     >
                       Isolate
                     </button>
                     <button onClick={() => navigate(`/endpoints/logs?host=${h.id}`)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors">
                       EDR Logs
                     </button>
                     <button onClick={() => handleRotateCredential(h.id)} className="px-3 py-1.5 bg-slate-800 hover:bg-yellow-700 text-yellow-500 hover:text-white text-xs rounded transition-colors">
                       Rotate
                     </button>
                   </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
