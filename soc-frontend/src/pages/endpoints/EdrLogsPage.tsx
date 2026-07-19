// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { EdrLogEntry } from '../../shared/types';
import { useSearchParams } from 'react-router-dom';

export default function EdrLogsPage() {
  const [searchParams] = useSearchParams();
  const hostId = searchParams.get('host') || 'all';

  const { data, loading, error, execute } = useAsyncState<EdrLogEntry[]>(async () => {
    const res = await apiClient.get(`/endpoints/logs?host=${hostId}`);
    return res.data;
  });

  useEffect(() => { execute(); }, [execute, hostId]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">EDR Telemetry Logs</h1>
          <p className="text-slate-500 text-sm">Host: {hostId === 'all' ? 'Entire Fleet' : hostId}</p>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<EdrLogEntry>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'timestamp', header: 'Timestamp', render: (r) => new Date(r.timestamp).toLocaleString() },
            { key: 'host', header: 'Host' },
            { key: 'eventType', header: 'Event Type', render: (r) => <span className="font-mono text-xs">{r.eventType}</span> },
            { key: 'process', header: 'Process' },
            { 
              key: 'detail', header: 'Details',
              render: (r) => (
                <div className="flex items-center justify-between">
                  <span className="truncate max-w-md" title={r.detail}>{r.detail}</span>
                  {r.isSuspicious && <Badge severity="S2" className="ml-2">SUSPICIOUS</Badge>}
                </div>
              )
            }
          ]}
        />
      </div>
    </div>
  );
}
