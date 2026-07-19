// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge, ConfirmModal } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { EndpointHost } from '../../shared/types';

export default function IsolationControlsPage() {
  const { data, loading, error, execute } = useAsyncState<EndpointHost[]>(async () => {
    const res = await apiClient.get('/endpoints/isolation-candidates');
    return res.data;
  });

  const [pendingAction, setPendingAction] = useState<{ host: EndpointHost, type: 'isolate' | 'release' } | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const performAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'isolate') {
        await apiClient.post(`/endpoints/${pendingAction.host.id}/isolate`);
      } else {
        await apiClient.post(`/endpoints/${pendingAction.host.id}/release`);
      }
      execute(); // refresh list
    } catch {
      alert('Action failed.');
    } finally {
      setPendingAction(null);
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  const isolatedCount = (data || []).filter(h => h.isIsolated).length;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-4">Isolation Controls</h1>
      
      {isolatedCount > 0 && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg flex items-center text-red-500">
          <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span className="font-bold">CRITICAL WARNING: There are {isolatedCount} endpoint(s) currently isolated from the network.</span>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<EndpointHost>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'hostname', header: 'Hostname' },
            { key: 'ipAddress', header: 'IP Address' },
            { 
              key: 'isIsolated', header: 'Network Status',
              render: (r) => <Badge severity={r.isIsolated ? 'S1' : 'S4'}>{r.isIsolated ? 'ISOLATED' : 'CONNECTED'}</Badge>
            },
            { 
              key: 'action', header: 'Destructive Action',
              render: (r) => r.isIsolated ? (
                <button onClick={() => setPendingAction({ host: r, type: 'release' })} className="text-orange-400 hover:text-orange-300 font-bold text-xs uppercase">Release Isolation</button>
              ) : (
                <button onClick={() => setPendingAction({ host: r, type: 'isolate' })} className="text-red-500 hover:text-red-400 font-bold text-xs uppercase bg-red-500/10 px-3 py-1 rounded">Isolate Host</button>
              )
            }
          ]}
        />
      </div>

      <ConfirmModal
        isOpen={pendingAction !== null}
        title={pendingAction?.type === 'isolate' ? 'EMERGENCY ENDPOINT ISOLATION' : 'RELEASE ENDPOINT ISOLATION'}
        message={pendingAction?.type === 'isolate' 
          ? `You are about to sever ${pendingAction.host.hostname} from the corporate network. All active sessions will be terminated.` 
          : `You are about to reconnect ${pendingAction?.host.hostname} to the corporate network.`}
        isDestructive={true}
        confirmText="Confirm Action"
        onConfirm={performAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
