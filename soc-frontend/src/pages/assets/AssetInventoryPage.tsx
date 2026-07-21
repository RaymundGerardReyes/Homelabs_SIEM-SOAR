import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Asset } from '../../shared/types';

interface EnhancedAsset extends Asset {
  lifecycleStatus: 'active' | 'scheduled-decommission' | 'decommissioned';
  isUnmanaged: boolean;
  changeHistory: { date: string; event: string }[];
}

export default function AssetInventoryPage() {
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedAsset[]>(async () => {
    const res = await apiClient.get('/assets/inventory');
    return res.data.map((a: any, i: number) => ({
      ...a,
      owner: i % 4 === 0 ? '' : a.owner || 'Alice',
      criticality: i % 4 === 0 ? '' : a.criticality || 'Tier 3',
      isUnmanaged: i % 4 === 0,
      lifecycleStatus: i % 10 === 0 ? 'decommissioned' : i % 7 === 0 ? 'scheduled-decommission' : 'active',
      changeHistory: [
        { date: new Date(Date.now() - 86400000 * 10).toISOString(), event: 'Asset discovered via EDR telemetry' },
        { date: new Date(Date.now() - 86400000 * 2).toISOString(), event: 'Criticality bumped to Tier 2 by SecOps' }
      ]
    }));
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOwnerModal, setAssignOwnerModal] = useState(false);
  const [ownerInput, setOwnerInput] = useState('');
  
  const [rescoreModalAsset, setRescoreModalAsset] = useState<EnhancedAsset | null>(null);
  const [newCriticality, setNewCriticality] = useState('Tier 2');
  const [rescoreJustification, setRescoreJustification] = useState('');

  const [historyModalAsset, setHistoryModalAsset] = useState<EnhancedAsset | null>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'unmanaged'>('all');

  useEffect(() => { execute(); }, [execute]);

  const handleBulkAssign = () => {
     if (!ownerInput.trim()) return;
     setData((data || []).map(a => selectedIds.has(a.id) ? { ...a, owner: ownerInput, isUnmanaged: false, criticality: a.criticality || 'Tier 3' } : a));
     setSelectedIds(new Set());
     setAssignOwnerModal(false);
     setOwnerInput('');
  };

  const handleRemindOwners = () => {
     alert(`Automated reminders sent via Slack to 3 owners for missing asset context.`);
  };

  const handleSubmitRescore = () => {
     if (!rescoreModalAsset || !rescoreJustification.trim()) return;
     // Mocking an approval request being submitted rather than changing it instantly
     alert(`Approval request submitted to update ${rescoreModalAsset.hostname} to ${newCriticality}.`);
     setRescoreModalAsset(null);
     setRescoreJustification('');
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredData?.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredData?.map(a => a.id)));
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const unmanagedCount = (data || []).filter(a => a.isUnmanaged).length;
  const filteredData = (data || []).filter(a => viewFilter === 'all' || (viewFilter === 'unmanaged' && a.isUnmanaged));

  return (
    <div className="p-8 bg-slate-950 min-h-screen">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Asset Intelligence</h1>
          <p className="text-slate-400">Governance, ownership, and criticality tracking across the enterprise.</p>
        </div>
        <div className="flex space-x-3">
           <button onClick={handleRemindOwners} className="px-4 py-2 bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800 rounded text-sm transition-colors">
             Send Context Reminders
           </button>
           <button className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-500 rounded text-sm font-bold transition-colors shadow-lg">
             + Manually Register Asset
           </button>
        </div>
      </div>

      {unmanagedCount > 0 && (
        <div className="mb-6 p-4 bg-orange-900/20 border border-orange-500/50 rounded-lg flex justify-between items-center">
           <div className="flex items-center text-orange-500">
             <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
             <span className="font-bold uppercase tracking-wider text-sm">Visibility Gap: {unmanagedCount} Rogue/Unclassified Assets Detected</span>
           </div>
           <button onClick={() => setViewFilter(viewFilter === 'all' ? 'unmanaged' : 'all')} className="px-4 py-1.5 bg-orange-500/20 text-orange-400 hover:bg-orange-500/40 rounded text-xs transition-colors border border-orange-500/30">
             {viewFilter === 'unmanaged' ? 'Clear Filter' : 'Review Rogue Assets'}
           </button>
        </div>
      )}

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-900/30 border border-indigo-500/50 p-3 rounded-lg mb-4 flex justify-between items-center">
           <span className="text-indigo-300 font-medium text-sm">{selectedIds.size} assets selected</span>
           <button onClick={() => setAssignOwnerModal(true)} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors">
             Bulk Assign Owner
           </button>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-4 w-10">
                 <input type="checkbox" checked={filteredData.length > 0 && selectedIds.size === filteredData.length} onChange={toggleSelectAll} className="rounded bg-slate-900 border-slate-700 text-blue-600" />
              </th>
              <th className="p-4">Asset Name / IP</th>
              <th className="p-4">Classification</th>
              <th className="p-4">Owner</th>
              <th className="p-4">Lifecycle Status</th>
              <th className="p-4 text-right">Governance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filteredData.map(a => (
              <tr key={a.id} className={`hover:bg-slate-800/30 ${a.isUnmanaged ? 'bg-orange-900/5' : ''} ${a.lifecycleStatus === 'decommissioned' ? 'opacity-50' : ''}`}>
                <td className="p-4">
                   <input type="checkbox" checked={selectedIds.has(a.id)} onChange={() => toggleSelect(a.id)} className="rounded bg-slate-900 border-slate-700 text-blue-600" />
                </td>
                <td className="p-4">
                   <div className="font-bold text-white">{a.hostname}</div>
                   <div className="text-xs text-slate-500 font-mono">{a.ipAddress}</div>
                </td>
                <td className="p-4">
                   {a.isUnmanaged ? (
                      <span className="text-xs bg-orange-900/30 text-orange-400 border border-orange-500/30 px-2 py-1 rounded">UNCLASSIFIED</span>
                   ) : (
                      <div className="flex items-center space-x-2">
                        <Badge severity={a.criticality === 'Tier 1' ? 'S1' : a.criticality === 'Tier 2' ? 'S2' : 'S4'}>{a.criticality}</Badge>
                        <button onClick={() => setRescoreModalAsset(a)} className="text-slate-500 hover:text-white text-xs underline" title="Request Criticality Rescore">
                           Rescore
                        </button>
                      </div>
                   )}
                </td>
                <td className="p-4">
                   {a.owner ? (
                     <div className="flex items-center">
                        <div className="w-5 h-5 rounded-full bg-blue-900 border border-blue-500 flex items-center justify-center text-[10px] font-bold text-blue-300 mr-2">
                           {a.owner.charAt(0).toUpperCase()}
                        </div>
                        <span>{a.owner}</span>
                     </div>
                   ) : (
                     <span className="text-xs text-slate-500 italic">No Owner Assigned</span>
                   )}
                </td>
                <td className="p-4">
                   {a.lifecycleStatus === 'active' && <span className="text-xs text-green-400 flex items-center"><span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Active</span>}
                   {a.lifecycleStatus === 'scheduled-decommission' && <span className="text-xs text-yellow-400 flex items-center"><span className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></span>Retiring Soon</span>}
                   {a.lifecycleStatus === 'decommissioned' && <span className="text-xs text-slate-500 flex items-center"><span className="w-2 h-2 bg-slate-500 rounded-full mr-2"></span>Decommissioned</span>}
                </td>
                <td className="p-4 text-right">
                   <button onClick={() => setHistoryModalAsset(a)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition-colors">
                      View History
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assign Owner Modal */}
      {assignOwnerModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-white mb-2">Bulk Assign Ownership</h2>
              <p className="text-slate-400 text-sm mb-4">Assigning {selectedIds.size} asset(s) to a business owner. They will be responsible for security compliance.</p>
              <input 
                type="text" value={ownerInput} onChange={e => setOwnerInput(e.target.value)} 
                placeholder="Enter owner name or email..." 
                className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm mb-6"
              />
              <div className="flex justify-end space-x-3">
                 <button onClick={() => setAssignOwnerModal(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
                 <button onClick={handleBulkAssign} disabled={!ownerInput.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm disabled:opacity-50 transition-colors">Assign Owner</button>
              </div>
           </div>
        </div>
      )}

      {/* Rescore Modal */}
      {rescoreModalAsset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-white mb-2">Request Criticality Change</h2>
              <p className="text-slate-400 text-sm mb-4">Updating criticality for <span className="text-white font-mono">{rescoreModalAsset.hostname}</span> requires architectural approval.</p>
              
              <div className="mb-4">
                 <label className="block text-xs text-slate-500 mb-1">New Criticality Tier</label>
                 <select value={newCriticality} onChange={e => setNewCriticality(e.target.value)} className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm">
                    <option>Tier 1 (Mission Critical)</option>
                    <option>Tier 2 (Business Important)</option>
                    <option>Tier 3 (Internal Standard)</option>
                 </select>
              </div>
              
              <div className="mb-6">
                 <label className="block text-xs text-slate-500 mb-1">Business Justification</label>
                 <textarea 
                   value={rescoreJustification} onChange={e => setRescoreJustification(e.target.value)}
                   className="w-full h-24 bg-slate-950 border border-slate-700 text-white p-3 rounded text-sm"
                   placeholder="e.g. This server now hosts the production payment processing database..."
                 />
              </div>

              <div className="flex justify-end space-x-3">
                 <button onClick={() => setRescoreModalAsset(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
                 <button onClick={handleSubmitRescore} disabled={!rescoreJustification.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm disabled:opacity-50 transition-colors">Submit Request</button>
              </div>
           </div>
        </div>
      )}

      {/* History Modal */}
      {historyModalAsset && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-white mb-2">Asset Lifecycle History</h2>
              <p className="text-slate-400 text-sm mb-6">Contextual events for <span className="text-white font-mono">{historyModalAsset.hostname}</span></p>
              
              <div className="space-y-4 mb-6">
                 {historyModalAsset.changeHistory.map((h, i) => (
                    <div key={i} className="flex items-start">
                       <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 mr-3 shrink-0"></div>
                       <div>
                          <p className="text-sm text-slate-200">{h.event}</p>
                          <p className="text-xs text-slate-500 font-mono">{new Date(h.date).toLocaleString()}</p>
                       </div>
                    </div>
                 ))}
              </div>

              <div className="flex justify-end">
                 <button onClick={() => setHistoryModalAsset(null)} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-sm transition-colors">Close</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
