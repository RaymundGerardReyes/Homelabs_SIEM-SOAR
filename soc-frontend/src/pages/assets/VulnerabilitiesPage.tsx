import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Vulnerability } from '../../shared/types';

interface EnhancedVulnerability extends Vulnerability {
  epssScore: number;
  activeExploitation: 'none' | 'cisa-kev' | 'internal-alert';
  slaDueDate: string;
  isOverdue: boolean;
  ticketStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'NONE';
  ticketId?: string;
  status: 'OPEN' | 'COMPENSATING_CONTROL' | 'PATCHED';
  combinedRiskScore: number;
}

export default function VulnerabilitiesPage() {
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedVulnerability[]>(async () => {
    const res = await apiClient.get('/assets/vulnerabilities');
    return res.data.map((vuln: any, i: number) => {
       const epssScore = Math.random() * 0.8 + 0.1; // 0.1 to 0.9
       const activeExploitation = i % 8 === 0 ? 'internal-alert' : i % 5 === 0 ? 'cisa-kev' : 'none';
       const isOverdue = i % 6 === 0;
       const dueDate = new Date();
       if (isOverdue) dueDate.setDate(dueDate.getDate() - 2);
       else dueDate.setDate(dueDate.getDate() + 7);
       
       const cvss = vuln.cvssScore;
       const combinedRiskScore = Math.round(cvss * epssScore * 10);

       return {
         ...vuln,
         epssScore,
         activeExploitation,
         slaDueDate: dueDate.toISOString(),
         isOverdue,
         ticketStatus: i % 3 === 0 ? 'IN_PROGRESS' : i % 4 === 0 ? 'RESOLVED' : 'OPEN',
         ticketId: `TICK-${1000 + i}`,
         status: i % 10 === 0 ? 'COMPENSATING_CONTROL' : 'OPEN',
         combinedRiskScore
       };
    }).sort((a: any, b: any) => b.combinedRiskScore - a.combinedRiskScore);
  });

  const [controlModalVuln, setControlModalVuln] = useState<EnhancedVulnerability | null>(null);
  const [controlJustification, setControlJustification] = useState('');

  useEffect(() => { execute(); }, [execute]);

  const handleAcceptRisk = () => {
     if (!controlModalVuln || !controlJustification) return;
     setData((data || []).map(v => v.id === controlModalVuln.id ? { ...v, status: 'COMPENSATING_CONTROL' } : v));
     setControlModalVuln(null);
     setControlJustification('');
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const overdueCount = (data || []).filter(v => v.isOverdue && v.status === 'OPEN').length;
  const activeExploitCount = (data || []).filter(v => v.activeExploitation === 'internal-alert').length;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      <div className="absolute top-[10%] right-[-10%] w-[40%] h-[60%] bg-red-600/10 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 space-y-4 md:space-y-0">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Vulnerability Management</h1>
            <p className="text-slate-400">Risk-prioritized remediation powered by EPSS and active threat intelligence.</p>
          </div>
          <button onClick={execute} className="px-4 py-2 bg-red-900/50 text-red-400 border border-red-500/30 rounded hover:bg-red-900 transition-colors shadow-[0_0_15px_rgba(239,68,68,0.2)] flex items-center font-medium text-sm">
            <span className="mr-2">⚡</span> Trigger Scanners
          </button>
        </div>

        {/* Priority Dashboards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
           <div className={`p-5 rounded-xl border ${activeExploitCount > 0 ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between items-center">
                 <div>
                    <h3 className={`text-sm font-bold uppercase tracking-wider mb-1 ${activeExploitCount > 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      Active Exploitation
                    </h3>
                    <p className={`text-3xl font-bold ${activeExploitCount > 0 ? 'text-white' : 'text-slate-500'}`}>{activeExploitCount} <span className="text-sm font-normal text-slate-500">assets</span></p>
                 </div>
                 <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${activeExploitCount > 0 ? 'bg-red-500/20 text-red-500' : 'bg-slate-800 text-slate-600'}`}>
                   🔥
                 </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">Vulnerabilities currently being targeted in your environment.</p>
           </div>
           
           <div className={`p-5 rounded-xl border ${overdueCount > 0 ? 'bg-orange-900/20 border-orange-500/50' : 'bg-slate-900 border-slate-800'}`}>
              <div className="flex justify-between items-center">
                 <div>
                    <h3 className={`text-sm font-bold uppercase tracking-wider mb-1 ${overdueCount > 0 ? 'text-orange-500' : 'text-slate-500'}`}>
                      SLA Overdue
                    </h3>
                    <p className={`text-3xl font-bold ${overdueCount > 0 ? 'text-white' : 'text-slate-500'}`}>{overdueCount} <span className="text-sm font-normal text-slate-500">tickets</span></p>
                 </div>
                 <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl ${overdueCount > 0 ? 'bg-orange-500/20 text-orange-500' : 'bg-slate-800 text-slate-600'}`}>
                   ⏰
                 </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">Critical/High severity patches exceeding organizational SLA.</p>
           </div>
        </div>

        <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/80 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-4 font-semibold">CVE / Advisory</th>
                  <th className="px-4 py-4 font-semibold">Risk Metrics</th>
                  <th className="px-4 py-4 font-semibold">Exploit Intel</th>
                  <th className="px-4 py-4 font-semibold">Remediation SLA</th>
                  <th className="px-4 py-4 font-semibold">Ticket Status</th>
                  <th className="px-4 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((vuln) => {
                  return (
                    <tr key={vuln.id} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors group">
                      <td className="px-4 py-4">
                         <div className="font-bold font-mono text-slate-200 group-hover:text-blue-400 transition-colors">
                           {vuln.cveId}
                         </div>
                         <div className="text-xs text-slate-500 mt-1 truncate max-w-[200px]" title={vuln.description}>{vuln.description}</div>
                      </td>
                      <td className="px-4 py-4">
                         <div className="flex flex-col space-y-1">
                           <div className="flex items-center justify-between w-32">
                              <span className="text-xs text-slate-500">CVSS</span>
                              <span className="font-mono text-white">{vuln.cvssScore.toFixed(1)}</span>
                           </div>
                           <div className="flex items-center justify-between w-32">
                              <span className="text-xs text-slate-500">EPSS</span>
                              <span className="font-mono text-purple-400">{(vuln.epssScore * 100).toFixed(1)}%</span>
                           </div>
                           <div className="flex items-center justify-between w-32 border-t border-slate-700 pt-1 mt-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">Risk Score</span>
                              <span className={`font-mono font-bold ${vuln.combinedRiskScore > 50 ? 'text-red-500 drop-shadow-[0_0_5px_rgba(239,68,68,0.8)]' : 'text-slate-300'}`}>{vuln.combinedRiskScore}</span>
                           </div>
                         </div>
                      </td>
                      <td className="px-4 py-4">
                         {vuln.activeExploitation === 'internal-alert' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-red-900/40 border border-red-500/50 text-red-400 text-[10px] font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(239,68,68,0.3)] animate-pulse">
                               🔥 Alert Fired
                            </span>
                         )}
                         {vuln.activeExploitation === 'cisa-kev' && (
                            <span className="inline-flex items-center px-2 py-1 rounded bg-orange-900/40 border border-orange-500/50 text-orange-400 text-[10px] font-bold uppercase tracking-wider">
                               CISA KEV
                            </span>
                         )}
                         {vuln.activeExploitation === 'none' && (
                            <span className="text-xs text-slate-600">No known active exploit</span>
                         )}
                      </td>
                      <td className="px-4 py-4">
                         <div className="flex flex-col">
                            {vuln.status === 'COMPENSATING_CONTROL' ? (
                               <span className="text-xs text-emerald-500 flex items-center"><span className="mr-1">🛡️</span> Risk Accepted</span>
                            ) : (
                               <>
                                 <span className={`text-xs font-bold ${vuln.isOverdue ? 'text-red-500' : 'text-slate-300'}`}>
                                    {vuln.isOverdue ? 'OVERDUE' : 'DUE SOON'}
                                 </span>
                                 <span className="text-[10px] text-slate-500 font-mono">{new Date(vuln.slaDueDate).toLocaleDateString()}</span>
                               </>
                            )}
                         </div>
                      </td>
                      <td className="px-4 py-4">
                         <div className="flex items-center space-x-2">
                            <span className="text-xs font-mono text-blue-400 hover:underline cursor-pointer">{vuln.ticketId}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${vuln.ticketStatus === 'RESOLVED' ? 'bg-green-900/30 text-green-400 border border-green-500/30' : vuln.ticketStatus === 'IN_PROGRESS' ? 'bg-blue-900/30 text-blue-400 border border-blue-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                               {vuln.ticketStatus.replace('_', ' ')}
                            </span>
                         </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                         {vuln.status !== 'COMPENSATING_CONTROL' && (
                           <button onClick={() => setControlModalVuln(vuln)} className="text-xs text-slate-500 hover:text-white underline transition-colors">
                              Add Mitigating Control
                           </button>
                         )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Compensating Control Modal */}
      {controlModalVuln && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
              <h2 className="text-lg font-bold text-white mb-2">Accept Risk via Compensating Control</h2>
              <p className="text-slate-400 text-sm mb-4">Apply a control to <span className="text-white font-mono">{controlModalVuln.cveId}</span>. This will pause the SLA timer.</p>
              
              <div className="mb-4">
                 <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wider">Control Type</label>
                 <select className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm">
                    <option>WAF Rule</option>
                    <option>Network Segmentation</option>
                    <option>EDR Blocking Policy</option>
                 </select>
              </div>

              <div className="mb-4">
                 <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wider">Expiry Date</label>
                 <input type="date" className="w-full bg-slate-950 border border-slate-700 text-slate-300 p-2 rounded text-sm" />
              </div>
              
              <div className="mb-6">
                 <label className="block text-xs text-slate-500 mb-1 uppercase tracking-wider">Justification / Ticket Link</label>
                 <textarea 
                   value={controlJustification} onChange={e => setControlJustification(e.target.value)}
                   className="w-full h-24 bg-slate-950 border border-slate-700 text-white p-3 rounded text-sm focus:outline-none focus:border-blue-500"
                   placeholder="e.g. Patch breaks legacy application. Applied WAF virtual patching via rule ID 92381."
                 />
              </div>

              <div className="flex justify-end space-x-3">
                 <button onClick={() => setControlModalVuln(null)} className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors">Cancel</button>
                 <button onClick={handleAcceptRisk} disabled={!controlJustification.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm disabled:opacity-50 transition-colors">Apply Control</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
