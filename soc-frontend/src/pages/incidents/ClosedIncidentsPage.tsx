// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ClosedIncident } from '../../shared/types';

export default function ClosedIncidentsPage() {
  const { data, loading, error, execute } = useAsyncState<ClosedIncident[]>(async () => {
    const res = await apiClient.get('/incidents/closed');
    return res.data;
  });

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Closed Incidents</h1>
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<ClosedIncident>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'id', header: 'Incident ID' },
            { key: 'title', header: 'Title' },
            { 
              key: 'severity', header: 'Severity',
              render: (r) => <Badge severity={r.severity === 'Critical' ? 'S1' : r.severity === 'High' ? 'S2' : 'S3'}>{r.severity}</Badge>
            },
            { key: 'resolvedBy', header: 'Resolved By' },
            { key: 'duration', header: 'Duration' },
            { key: 'closedAt', header: 'Closed At', render: (r) => new Date(r.closedAt).toLocaleString() }
          ]}
        />
      </div>
    </div>
  );
}
