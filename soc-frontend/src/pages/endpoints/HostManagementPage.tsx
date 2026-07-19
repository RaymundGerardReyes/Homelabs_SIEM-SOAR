// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ManagedHost } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

export default function HostManagementPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute } = useAsyncState<ManagedHost[]>(async () => {
    const res = await apiClient.get('/endpoints/hosts');
    return res.data;
  });

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Host Management (Fleet)</h1>
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<ManagedHost>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'hostname', header: 'Hostname' },
            { key: 'os', header: 'OS' },
            { 
              key: 'health', header: 'Agent Health',
              render: (r) => <Badge severity={r.health === 'healthy' ? 'S4' : r.health === 'stale' ? 'S3' : 'S1'}>{r.health.toUpperCase()}</Badge>
            },
            { key: 'agentVersion', header: 'Agent Version', render: (r) => r.agentVersion === r.latestVersion ? r.agentVersion : <span className="text-yellow-500">{r.agentVersion} (Outdated)</span> },
            { key: 'lastCheckIn', header: 'Last Check-in', render: (r) => new Date(r.lastCheckIn).toLocaleString() },
            { 
              key: 'actions', header: 'Logs',
              render: (r) => <button onClick={() => navigate(`/endpoints/logs?host=${r.id}`)} className="text-blue-400 hover:text-blue-300 text-sm font-medium">View EDR Logs</button>
            }
          ]}
        />
      </div>
    </div>
  );
}
