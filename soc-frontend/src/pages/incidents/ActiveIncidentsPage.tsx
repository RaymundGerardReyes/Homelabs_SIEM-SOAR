import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Incident } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

interface EnhancedIncident extends Incident {
  slaStatus?: 'ok' | 'warning' | 'breached';
  assignee?: string;
}

export default function ActiveIncidentsPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedIncident[]>(async () => {
    const res = await apiClient.get('/incidents/active');
    return res.data.map((inc: any, i: number) => ({
      ...inc,
      slaStatus: i % 7 === 0 ? 'breached' : i % 4 === 0 ? 'warning' : 'ok'
    }));
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [reassignTarget, setReassignTarget] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => { execute(); }, [execute]);

  const handleBulkReassign = async () => {
    if (!data) return;
    try {
       // mock API
       setData(data.map(inc => selectedIds.has(inc.id) ? { ...inc, assignee: reassignTarget } : inc));
       setSelectedIds(new Set());
       setShowReassignModal(false);
    } catch (e) {
       alert('Failed to reassign');
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === data?.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(data?.map(i => i.id)));
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const breachedCount = data?.filter(i => i.slaStatus === 'breached').length || 0;
  const warningCount = data?.filter(i => i.slaStatus === 'warning').length || 0;

  // Analyst workload mock
  const analystWorkload = [ { name: 'alice', count: 4 }, { name: 'bob', count: 12 }, { name: 'charlie', count: 2 }, { name: 'unassigned', count: data?.filter(i => !i.assignee).length || 0 } ];

  const filteredData = data?.filter(i => i.id.toLowerCase().includes(searchQuery.toLowerCase()) || i.title.toLowerCase().includes(searchQuery.toLowerCase()) || i.assignee?.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Active Incidents</h1>
            <p className="text-slate-400">Triage and manage ongoing security alerts in real-time.</p>
          </div>
          <div className="flex space-x-3 mt-4 md:mt-0">
            <button onClick={execute} className="px-4 py-2 bg-slate-900 border border-slate-700 text-slate-300 rounded hover:bg-slate-800 hover:text-white transition-colors flex items-center font-medium text-sm">
              <span className="mr-2">⟳</span> Refresh
            </button>
          </div>
        </div>

        {/* SLA Analytics Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
           <div className="bg-slate-900 border border-slate-800 p-4 rounded-lg flex items-center justify-between">
              <div>
                 <p className="text-xs text-slate-500 uppercase tracking-wide">Average TTR</p>
                 <p className="text-2xl font-bold text-white mt-1">2.4h</p>
              </div>
              <div className="h-10 w-10 bg-blue-900/30 rounded-full flex items-center justify-center text-blue-500">⏱️</div>
           </div>
           <div className={`bg-slate-900 border ${warningCount > 0 ? 'border-yellow-500/50' : 'border-slate-800'} p-4 rounded-lg flex items-center justify-between`}>
              <div>
                 <p className="text-xs text-yellow-500 uppercase tracking-wide">Approaching SLA Breach</p>
                 <p className="text-2xl font-bold text-white mt-1">{warningCount} <span className="text-sm text-slate-500 font-normal">incidents</span></p>
              </div>
              <div className="h-10 w-10 bg-yellow-900/30 rounded-full flex items-center justify-center text-yellow-500">⚠️</div>
           </div>
           <div className={`bg-slate-900 border ${breachedCount > 0 ? 'border-red-500/50' : 'border-slate-800'} p-4 rounded-lg flex items-center justify-between`}>
              <div>
                 <p className="text-xs text-red-500 uppercase tracking-wide">SLA Breached</p>
                 <p className="text-2xl font-bold text-white mt-1">{breachedCount} <span className="text-sm text-slate-500 font-normal">incidents</span></p>
              </div>
              <div className="h-10 w-10 bg-red-900/30 rounded-full flex items-center justify-center text-red-500">🔥</div>
           </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
           <div className="bg-indigo-900/30 border border-indigo-500/50 p-3 rounded-lg mb-4 flex justify-between items-center">
              <span className="text-indigo-300 font-medium text-sm">{selectedIds.size} incidents selected</span>
              <div className="flex space-x-2">
                 <button onClick={() => setShowReassignModal(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors">
                   Bulk Reassign (Load Balance)
                 </button>
              </div>
           </div>
        )}

        <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col md:flex-row gap-4">
             <input 
               type="text"
               value={searchQuery}
               onChange={e => setSearchQuery(e.target.value)}
               placeholder="Search incidents by ID, Title, or Assignee..."
               className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
             />
             <select className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-300 focus:outline-none focus:border-blue-500">
               <option>All Severities</option>
               <option>Critical</option>
               <option>High</option>
               <option>Medium</option>
               <option>Low</option>
             </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/80 border-b border-slate-800">
                <tr>
                  <th className="p-4 w-10">
                     <input type="checkbox" checked={filteredData && filteredData.length > 0 && selectedIds.size === filteredData.length} onChange={toggleSelectAll} className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600" />
                  </th>
                  <th className="px-6 py-4 font-semibold">Incident ID</th>
                  <th className="px-6 py-4 font-semibold">Title</th>
                  <th className="px-6 py-4 font-semibold">Severity</th>
                  <th className="px-6 py-4 font-semibold">Assignee</th>
                  <th className="px-6 py-4 font-semibold">Created</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(filteredData || []).map((inc) => (
                  <tr key={inc.id} className={`border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors group ${inc.slaStatus === 'breached' ? 'bg-red-900/10' : inc.slaStatus === 'warning' ? 'bg-yellow-900/10' : ''}`}>
                    <td className="p-4">
                       <input type="checkbox" checked={selectedIds.has(inc.id)} onChange={() => toggleSelect(inc.id)} className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600" />
                    </td>
                    <td className="px-6 py-4 font-mono text-blue-400 cursor-pointer hover:underline" onClick={() => navigate(`/incidents/${inc.id}`)}>
                      {inc.id}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-200">
                      {inc.title}
                      {inc.slaStatus === 'breached' && <span className="ml-2 text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30">BREACHED</span>}
                      {inc.slaStatus === 'warning' && <span className="ml-2 text-xs bg-yellow-900/50 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/30">EXPIRING</span>}
                    </td>
                    <td className="px-6 py-4">
                      <Badge severity={inc.severity === 'critical' ? 'S1' : inc.severity === 'high' ? 'S2' : inc.severity === 'medium' ? 'S3' : 'S4'}>
                        {inc.severity.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-4">
                      {inc.assignee ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold mr-1.5">
                             {inc.assignee.charAt(0).toUpperCase()}
                          </div>
                          {inc.assignee}
                        </span>
                      ) : (
                        <span className="text-slate-500 italic text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-400">
                      {new Date(inc.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => navigate(`/incidents/${inc.id}/war-room`)} className="px-3 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white rounded text-xs font-medium transition-colors border border-blue-600/30">
                        War Room
                      </button>
                    </td>
                  </tr>
                ))}
                {(!filteredData || filteredData.length === 0) && (
                  <tr>
                     <td colSpan={7} className="p-12 text-center text-slate-500">
                        No active incidents found matching criteria.
                     </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reassign Modal */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Bulk Reassign (Load Balance)</h2>
            <p className="text-slate-400 text-sm mb-4">Reassigning {selectedIds.size} incident(s). View current analyst workloads below.</p>
            
            <div className="space-y-2 mb-6">
               {analystWorkload.map(a => (
                 <div key={a.name} onClick={() => setReassignTarget(a.name === 'unassigned' ? '' : a.name)} className={`p-3 rounded border flex justify-between items-center cursor-pointer transition-colors ${reassignTarget === (a.name === 'unassigned' ? '' : a.name) ? 'bg-indigo-900/40 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:bg-slate-800'}`}>
                    <span className="text-slate-300 capitalize">{a.name}</span>
                    <div className="flex items-center">
                       <div className="w-32 bg-slate-800 h-2 rounded-full mr-3 overflow-hidden">
                         <div className={`h-full ${a.count > 10 ? 'bg-red-500' : a.count > 5 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min((a.count / 15) * 100, 100)}%` }} />
                       </div>
                       <span className="text-xs text-slate-500 w-8 text-right">{a.count}</span>
                    </div>
                 </div>
               ))}
            </div>

            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowReassignModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                Cancel
              </button>
              <button onClick={handleBulkReassign} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors">
                Confirm Reassignment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
