// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, StatusDot } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ThreatFeed } from '../../shared/types';

export default function ThreatFeedsPage() {
  const { data, loading, error, execute } = useAsyncState<ThreatFeed[]>(async () => {
    const res = await apiClient.get('/detection/feeds');
    return res.data;
  });

  const [syncingId, setSyncingId] = useState<string | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      await apiClient.post(`/detection/feeds/${id}/sync`);
      execute(); 
    } catch {
      alert('Sync failed');
    } finally {
      setSyncingId(null);
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Threat Intelligence Feeds</h1>
        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Add New Feed</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<ThreatFeed>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { 
              key: 'health', header: 'Health', 
              render: (r) => <div className="flex items-center space-x-2"><StatusDot status={r.health === 'healthy' ? 'success' : r.health === 'degraded' ? 'warning' : 'error'} /> <span>{r.health}</span></div> 
            },
            { key: 'name', header: 'Feed Name' },
            { key: 'type', header: 'Protocol' },
            { key: 'lastSync', header: 'Last Sync', render: (r) => new Date(r.lastSync).toLocaleString() },
            { 
              key: 'action', header: 'Actions',
              render: (r) => (
                <button 
                  onClick={() => handleSync(r.id)}
                  disabled={syncingId === r.id}
                  className="text-blue-400 hover:text-blue-300 text-sm font-medium disabled:opacity-50"
                >
                  {syncingId === r.id ? 'Syncing...' : 'Force Sync'}
                </button>
              )
            }
          ]}
        />
      </div>
    </div>
  );
}
