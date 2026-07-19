// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Incident } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

export default function ActiveIncidentsPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute } = useAsyncState<Incident[]>(async () => {
    const res = await apiClient.get('/incidents/active');
    return res.data;
  });

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Active Incidents</h1>
      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<Incident>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'id', header: 'Incident ID' },
            { key: 'title', header: 'Title' },
            { 
              key: 'severity', header: 'Severity',
              render: (r) => <Badge severity={r.severity === 'Critical' ? 'S1' : r.severity === 'High' ? 'S2' : 'S3'}>{r.severity}</Badge>
            },
            { key: 'assignedTo', header: 'Assigned To' },
            { key: 'createdAt', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleString() },
            { 
              key: 'action', header: 'Actions',
              render: (r) => <button onClick={() => navigate(`/incidents/war-room/${r.id}`)} className="text-blue-400 hover:text-blue-300 font-bold text-sm">Join War Room</button>
            }
          ]}
        />
      </div>
    </div>
  );
}
