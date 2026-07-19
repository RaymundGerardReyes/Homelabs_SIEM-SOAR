// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ComplianceFramework } from '../../shared/types';

export default function CompliancePage() {
  const [expandedFrameworks, setExpandedFrameworks] = useState<Record<string, boolean>>({});
  const [isExporting, setIsExporting] = useState(false);

  const { data, loading, error, execute } = useAsyncState<ComplianceFramework[]>(async () => {
    const res = await apiClient.get('/dashboards/compliance-status');
    return res.data;
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

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-white">Compliance & Audit Posture</h1>
        <button 
          onClick={handleExport}
          disabled={isExporting}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors disabled:opacity-50 flex items-center"
        >
          {isExporting ? 'Generating PDF...' : 'Export Compliance Report'}
        </button>
      </div>

      <div className="space-y-6">
        {(data || []).map(framework => {
          const isExpanded = !!expandedFrameworks[framework.id];
          return (
            <div key={framework.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div 
                className="p-6 cursor-pointer flex justify-between items-center hover:bg-slate-800/50 transition-colors"
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
                <div className="flex items-center space-x-6">
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
                        <th className="p-4 font-medium">Last Checked</th>
                        <th className="p-4 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {framework.controls.map(control => (
                        <tr key={control.id} className="hover:bg-slate-800/30">
                          <td className="p-4 font-mono text-xs text-slate-400">{control.id}</td>
                          <td className="p-4">{control.name}</td>
                          <td className="p-4 text-slate-500">{new Date(control.lastChecked).toLocaleDateString()}</td>
                          <td className="p-4 text-right">
                            {control.status === 'passed' ? (
                              <span className="inline-flex items-center text-green-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg> Passed</span>
                            ) : control.status === 'failed' ? (
                              <span className="inline-flex items-center text-red-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg> Failed</span>
                            ) : (
                              <span className="inline-flex items-center text-yellow-400"><svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg> Warning</span>
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
    </div>
  );
}
