import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { EdrLogEntry } from '../../shared/types';
import { useSearchParams, useNavigate } from 'react-router-dom';

interface EnhancedEdrLog extends EdrLogEntry {
  processTree?: { name: string; pid: number; children?: any[] };
}

// Mock useSavedView hook
function useSavedView(key: string, defaultView: any) {
  const [view, setView] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : defaultView;
  });
  const saveView = (newView: any) => {
    setView(newView);
    localStorage.setItem(key, JSON.stringify(newView));
  };
  return [view, saveView] as const;
}

const LOLBINS = ['powershell.exe -enc', 'certutil.exe -urlcache', 'wmic process call create', 'regsvr32.exe /s /u /i:'];

export default function EdrLogsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialHost = searchParams.get('host');

  const [filter, setFilter] = useState({ hosts: initialHost ? [initialHost] : [], keyword: '', type: 'all' });
  const [savedHunts, setSavedHunts] = useSavedView('edr_saved_hunts', []);
  const [huntNameInput, setHuntNameInput] = useState('');
  
  const [isLiveTail, setIsLiveTail] = useState(false);
  const [processTreeModal, setProcessTreeModal] = useState<EnhancedEdrLog | null>(null);

  const { data, execute, setData } = useAsyncState<EnhancedEdrLog[]>(async () => {
    const hostsParam = filter.hosts.length > 0 ? filter.hosts.join(',') : 'all';
    const res = await apiClient.get(`/endpoints/logs?hosts=${hostsParam}`);
    
    return res.data.map((l: any) => ({
      ...l,
      isSuspicious: l.isSuspicious || LOLBINS.some(b => l.detail.toLowerCase().includes(b)),
      processTree: l.eventType === 'PROCESS_EXECUTION' ? {
        name: 'explorer.exe', pid: 1422, children: [
          { name: 'cmd.exe', pid: 5122, children: [
            { name: l.process, pid: 8192 }
          ]}
        ]
      } : undefined
    }));
  });

  useEffect(() => {
    execute();
  }, [filter.hosts, execute]);

  useEffect(() => {
    if (!isLiveTail) return;
    const interval = setInterval(() => {
      // Mock live tail
      if (data && data.length > 0) {
        const newLog = { ...data[Math.floor(Math.random() * data.length)], id: Math.random().toString(), timestamp: new Date().toISOString() };
        setData([newLog, ...data].slice(0, 100));
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isLiveTail, data, setData]);

  const handleSaveHunt = () => {
    if (!huntNameInput) return;
    setSavedHunts([...savedHunts, { name: huntNameInput, filter }]);
    setHuntNameInput('');
  };

  const filteredData = data?.filter(l => {
    if (filter.type !== 'all' && l.eventType !== filter.type) return false;
    if (filter.keyword && !l.detail.toLowerCase().includes(filter.keyword.toLowerCase()) && !l.process.toLowerCase().includes(filter.keyword.toLowerCase())) return false;
    return true;
  });

  const renderTree = (node: any, depth = 0) => (
    <div className={`ml-${depth * 4} mt-2 flex flex-col`}>
       <div className="flex items-center space-x-2">
         {depth > 0 && <span className="text-slate-600">└─</span>}
         <span className={`font-mono text-sm ${depth === 2 ? 'text-red-400 font-bold' : 'text-slate-300'}`}>{node.name}</span>
         <span className="text-xs text-slate-500">PID: {node.pid}</span>
       </div>
       {node.children?.map((c: any) => <div key={c.pid}>{renderTree(c, depth + 1)}</div>)}
    </div>
  );

  return (
    <div className="p-8 bg-slate-950 min-h-screen flex flex-col h-screen">
      <div className="flex justify-between items-start mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">EDR Telemetry Logs</h1>
          <p className="text-slate-400 text-sm">Forensic-grade process, network, and file events across the fleet.</p>
        </div>
        <div className="flex space-x-3">
           <button onClick={() => setIsLiveTail(!isLiveTail)} className={`px-4 py-2 rounded text-sm font-medium transition-colors flex items-center ${isLiveTail ? 'bg-green-900/30 text-green-400 border border-green-500/50' : 'bg-slate-800 text-slate-300'}`}>
             <span className={`w-2 h-2 rounded-full mr-2 ${isLiveTail ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`} />
             Live Tail
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-1 space-y-4 overflow-y-auto pr-2">
           <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Telemetry Filters</h3>
              <div className="space-y-4">
                 <div>
                   <label className="block text-xs text-slate-500 mb-1">Target Hosts (Comma separated)</label>
                   <input 
                     type="text"
                     value={filter.hosts.join(',')}
                     onChange={e => setFilter({ ...filter, hosts: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                     placeholder="host-a, host-b..."
                     className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm"
                   />
                 </div>
                 <div>
                   <label className="block text-xs text-slate-500 mb-1">Event Type</label>
                   <select 
                     value={filter.type}
                     onChange={e => setFilter({ ...filter, type: e.target.value })}
                     className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm"
                   >
                     <option value="all">All Events</option>
                     <option value="PROCESS_EXECUTION">Process Execution</option>
                     <option value="NETWORK_CONNECTION">Network Connection</option>
                     <option value="FILE_MODIFICATION">File Modification</option>
                   </select>
                 </div>
                 <div>
                   <label className="block text-xs text-slate-500 mb-1">Keyword Search</label>
                   <input 
                     type="text"
                     value={filter.keyword}
                     onChange={e => setFilter({ ...filter, keyword: e.target.value })}
                     placeholder="e.g. powershell..."
                     className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm"
                   />
                 </div>
              </div>
           </div>

           <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">Saved Hunt Templates</h3>
              <div className="flex space-x-2 mb-4">
                 <input 
                   type="text" value={huntNameInput} onChange={e => setHuntNameInput(e.target.value)} placeholder="Hunt name..."
                   className="flex-1 bg-slate-950 border border-slate-700 text-white px-2 py-1.5 rounded text-xs"
                 />
                 <button onClick={handleSaveHunt} disabled={!huntNameInput} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded transition-colors">
                   Save
                 </button>
              </div>
              <div className="space-y-2">
                 {savedHunts.map((hunt: any, i: number) => (
                   <button 
                     key={i} onClick={() => setFilter(hunt.filter)}
                     className="w-full text-left px-3 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded text-sm text-indigo-300 transition-colors"
                   >
                     🔍 {hunt.name}
                   </button>
                 ))}
                 {savedHunts.length === 0 && <p className="text-xs text-slate-500">No saved hunts.</p>}
              </div>
           </div>
        </div>

        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1 font-mono text-sm">
             <table className="w-full text-left">
               <thead className="bg-slate-950 text-slate-500 sticky top-0 shadow-md">
                 <tr>
                   <th className="py-3 px-4 font-normal w-40">Timestamp</th>
                   <th className="py-3 px-4 font-normal w-32">Host</th>
                   <th className="py-3 px-4 font-normal w-40">Event Type</th>
                   <th className="py-3 px-4 font-normal">Details</th>
                   <th className="py-3 px-4 font-normal text-right w-24">Actions</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-800">
                 {(filteredData || []).map(r => (
                   <tr key={r.id} className={`hover:bg-slate-800/50 transition-colors ${r.isSuspicious ? 'bg-red-900/10' : ''}`}>
                     <td className="py-3 px-4 text-slate-400 text-xs">{new Date(r.timestamp).toLocaleString()}</td>
                     <td className="py-3 px-4">
                       <span className="text-blue-400 hover:underline cursor-pointer" onClick={() => setFilter({ ...filter, hosts: [r.host] })}>{r.host}</span>
                     </td>
                     <td className="py-3 px-4 text-slate-300 text-xs">{r.eventType}</td>
                     <td className="py-3 px-4">
                        <div className="flex flex-col">
                           <span className={r.isSuspicious ? 'text-red-400 font-bold' : 'text-slate-300'}>
                             {r.process} {r.detail}
                           </span>
                           {r.isSuspicious && (
                             <div className="flex items-center mt-1 space-x-2">
                               <span className="text-xs bg-red-900/50 text-red-300 px-1.5 py-0.5 rounded">ANOMALY DETECTED</span>
                               <button onClick={() => navigate(`/endpoints/isolation?entity=${r.host}`)} className="text-xs text-red-400 hover:text-red-300 underline">
                                 Pivot to Isolation
                               </button>
                             </div>
                           )}
                        </div>
                     </td>
                     <td className="py-3 px-4 text-right">
                        {(r.eventType as string) === 'PROCESS_EXECUTION' && (
                          <button 
                            onClick={() => setProcessTreeModal(r)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                            title="View Process Tree"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"/></svg>
                          </button>
                        )}
                     </td>
                   </tr>
                 ))}
                 {(!filteredData || filteredData.length === 0) && (
                   <tr>
                     <td colSpan={5} className="py-12 text-center text-slate-500">
                       No telemetry matches the current filters.
                     </td>
                   </tr>
                 )}
               </tbody>
             </table>
          </div>
        </div>
      </div>

      {/* Process Tree Modal */}
      {processTreeModal && processTreeModal.processTree && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-2xl w-full shadow-2xl">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-white">Process Execution Tree</h2>
              <Badge severity={processTreeModal.isSuspicious ? 'S1' : 'S4'}>{processTreeModal.isSuspicious ? 'SUSPICIOUS CHAIN' : 'NORMAL'}</Badge>
            </div>
            <div className="mb-6 bg-slate-950 border border-slate-800 p-4 rounded text-sm text-slate-300 font-mono overflow-auto">
               {renderTree(processTreeModal.processTree)}
            </div>
            <div className="flex justify-end space-x-3">
              {processTreeModal.isSuspicious && (
                <button onClick={() => navigate(`/endpoints/isolation?entity=${processTreeModal.host}`)} className="px-4 py-2 bg-red-900/30 border border-red-500/30 text-red-400 hover:bg-red-900/50 rounded transition-colors">
                  Isolate Host
                </button>
              )}
              <button onClick={() => setProcessTreeModal(null)} className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
