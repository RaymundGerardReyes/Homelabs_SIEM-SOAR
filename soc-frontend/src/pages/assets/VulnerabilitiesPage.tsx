// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Vulnerability } from '../../shared/types';

export default function VulnerabilitiesPage() {
  const { data, loading, error, execute } = useAsyncState<Vulnerability[]>(async () => {
    const res = await apiClient.get('/assets/vulnerabilities');
    return res.data;
  });

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Vulnerability Management</h1>
        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Trigger Scanners</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<Vulnerability>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'cveId', header: 'CVE' },
            { 
              key: 'severity', header: 'Severity',
              render: (r) => <Badge severity={r.severity === 'critical' ? 'S1' : r.severity === 'high' ? 'S2' : 'S4'}>{r.severity.toUpperCase()}</Badge>
            },
            { key: 'cvssScore', header: 'CVSS', render: (r) => <span className={`font-mono ${r.cvssScore >= 9.0 ? 'text-red-500 font-bold' : ''}`}>{r.cvssScore.toFixed(1)}</span> },
            { key: 'affectedAsset', header: 'Affected Asset' },
            { 
              key: 'patchStatus', header: 'Patch Status',
              render: (r) => (
                <span className={`text-xs font-bold uppercase ${r.patchStatus === 'patched' ? 'text-green-500' : r.patchStatus === 'unpatched' ? 'text-red-500' : 'text-yellow-500'}`}>
                  {r.patchStatus.replace('_', ' ')}
                </span>
              )
            }
          ]}
        />
      </div>
    </div>
  );
}
