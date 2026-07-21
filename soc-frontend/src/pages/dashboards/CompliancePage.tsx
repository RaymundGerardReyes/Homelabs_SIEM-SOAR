import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ComplianceFramework } from '../../shared/types';
import { Link } from 'react-router-dom';

interface EnhancedFramework extends ComplianceFramework {
  historicalScores?: number[];
}

export default function CompliancePage() {
  const [expandedFrameworks, setExpandedFrameworks] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingAuditLink, setIsGeneratingAuditLink] = useState(false);
  const [auditLink, setAuditLink] = useState('');
  
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignControlId, setAssignControlId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState('');

  const { data, loading, error, execute } = useAsyncState<EnhancedFramework[]>(async () => {
    const res = await apiClient.get('/dashboards/compliance-status');
    // Mock enhanced historical data and evidence links
    return res.data.map((fw: any) => ({
      ...fw,
      historicalScores: [fw.score - 12, fw.score - 5, fw.score],
      controls: fw.controls.map((c: any) => ({
        ...c,
        evidenceLink: c.status === 'failed' ? `/assets/vulnerabilities?control=${c.id}` : undefined,
        sharedWith: c.id.includes('AC') ? ['SOC 2'] : []
      }))
    }));
  });

  useEffect(() => {
    execute();
  }, [execute]);

  const toggleFramework = (id: string) => {
    setExpandedFrameworks(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await apiClient.post('/dashboards/compliance-status/export', {}, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'compliance_report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Failed to export compliance report.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleGenerateAuditLink = async () => {
    setIsGeneratingAuditLink(true);
    try {
      // Mock audit link generation
      await new Promise(r => setTimeout(r, 800));
      setAuditLink(`https://soc.enterprise.local/audit/read-only?token=tk_${Math.random().toString(36).substring(7)}&expires=7d`);
    } catch (err) {
      alert('Failed to generate audit link.');
    } finally {
      setIsGeneratingAuditLink(false);
    }
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post(`/dashboards/compliance-status/${assignControlId}/tasks`, { assignee, dueDate });
      alert('Remediation task assigned successfully!');
      setAssignModalOpen(false);
    } catch (e) {
      alert('Failed to assign task.');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
        <div>
           <h1 className="text-3xl font-bold text-white">Compliance & Audit Posture</h1>
           <p className="text-slate-400 mt-1">Track regulatory framework adherence and remediation workflows.</p>
        </div>
        <div className="flex space-x-3 mt-4 md:mt-0">
          <button 
            onClick={handleGenerateAuditLink}
            disabled={isGeneratingAuditLink}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded transition-colors disabled:opacity-50"
          >
            {isGeneratingAuditLink ? 'Generating...' : 'Audit-Ready Link'}
          </button>
          <button 
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors disabled:opacity-50 flex items-center"
          >
            {isExporting ? 'Generating PDF...' : 'Export Compliance Report'}
          </button>
        </div>
      </div>

      {auditLink && (
        <div className="mb-6 bg-green-900/30 border border-green-500/50 p-4 rounded-lg flex justify-between items-center">
           <div>
             <p className="text-green-400 font-bold text-sm">Auditor Read-Only Link Generated (Valid for 7 days)</p>
             <p className="text-slate-300 font-mono text-xs mt-1">{auditLink}</p>
           </div>
           <button onClick={() => navigator.clipboard.writeText(auditLink)} className="px-3 py-1 bg-green-800 hover:bg-green-700 text-white text-xs rounded">
             Copy
           </button>
        </div>
      )}

      <div className="space-y-6">
        {(data || []).map(framework => {
          const isExpanded = !!expandedFrameworks[framework.id];
          return (
            <div key={framework.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
              <div 
                className="p-6 cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center hover:bg-slate-800/50 transition-colors"
                onClick={() => toggleFramework(framework.id)}
              >
                <div className="flex items-center space-x-6">
                  <div>
                    <h2 className="text-xl font-bold text-white">{framework.framework}</h2>
                    <p className="text-sm text-slate-400 mt-1">{framework.controls.length} controls mapped</p>
                  </div>
                  <Badge severity={framework.status === 'compliant' ? 'S4' : framework.status === 'warning' ? 'S3' : 'S1'}>
                    {framework.status === 'compliant' ? 'Compliant' : framework.status === 'warning' ? 'Needs Attention' : 'Non-Compliant'}
                  </Badge>
                </div>

                {/* Historical Trend Sparkline */}
                {framework.historicalScores && (
                   <div className="hidden lg:flex flex-col items-center mx-8">
                     <div className="flex items-end h-8 space-x-1">
                       {framework.historicalScores.map((score, i) => (
                          <div key={i} className="w-3 bg-blue-500/50 hover:bg-blue-400 rounded-t-sm transition-all" style={{ height: `${score}%` }} title={`Audit ${i+1}: ${score}%`} />
                       ))}
                     </div>
                     <span className="text-xs text-slate-500 mt-1">Last 3 Audits</span>
                   </div>
                )}

                <div className="flex items-center space-x-6 mt-4 md:mt-0">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{framework.score}%</p>
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Coverage Score</p>
                  </div>
                  <svg className={`w-6 h-6 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-800 bg-slate-950/50">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-900 text-slate-500">
                      <tr>
                        <th className="p-4 font-medium">Control ID</th>
                        <th className="p-4 font-medium">Description</th>
                        <th className="p-4 font-medium">Overlap</th>
                        <th className="p-4 font-medium">Last Checked</th>
                        <th className="p-4 font-medium">Status & Evidence</th>
                        <th className="p-4 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {framework.controls.map((control: any) => (
                        <tr key={control.id} className="hover:bg-slate-800/30 group">
                          <td className="p-4 font-mono text-xs text-slate-400">{control.id}</td>
                          <td className="p-4 max-w-xs truncate" title={control.name}>{control.name}</td>
                          <td className="p-4">
                            {control.sharedWith?.length > 0 ? (
                               <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-xs rounded border border-slate-700">+ {control.sharedWith.join(', ')}</span>
                            ) : <span className="text-slate-600">-</span>}
                          </td>
                          <td className="p-4 text-slate-500">{new Date(control.lastChecked).toLocaleDateString()}</td>
                          <td className="p-4">
                            <div className="flex flex-col space-y-1">
                              {control.status === 'passed' ? (
                                <span className="inline-flex items-center text-green-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg> Passed</span>
                              ) : control.status === 'failed' ? (
                                <span className="inline-flex items-center text-red-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg> Failed</span>
                              ) : (
                                <span className="inline-flex items-center text-yellow-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> Partial</span>
                              )}
                              {control.evidenceLink && (
                                <Link to={control.evidenceLink} className="text-xs text-blue-400 hover:text-blue-300 underline">View Evidence</Link>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            {(control.status === 'failed' || control.status === 'warning') && (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); setAssignControlId(control.id); setAssignModalOpen(true); }}
                                 className="opacity-0 group-hover:opacity-100 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs rounded transition-all"
                               >
                                 Assign Remediation
                               </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Assign Remediation Modal */}
      {assignModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-sm w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Assign Remediation</h2>
            <form onSubmit={handleAssignTask}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Assign To</label>
                  <select 
                    required 
                    value={assignee} onChange={e => setAssignee(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select Analyst...</option>
                    <option value="alice">Alice (SecOps)</option>
                    <option value="bob">Bob (AppSec)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Due Date</label>
                  <input 
                    type="date" required 
                    value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setAssignModalOpen(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors">
                  Assign Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
