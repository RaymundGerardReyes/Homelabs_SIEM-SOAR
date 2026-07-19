// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge, ConfirmModal } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { MarketplaceListing } from '../../shared/types';

export default function MarketplacePage() {
  const { data, loading, error, execute } = useAsyncState<MarketplaceListing[]>(async () => {
    const res = await apiClient.get('/utilities/marketplace');
    return res.data;
  });

  const [pendingInstall, setPendingInstall] = useState<MarketplaceListing | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const handleInstall = async () => {
    if (!pendingInstall) return;
    try {
      await apiClient.post(`/utilities/marketplace/${pendingInstall.id}/install`);
      execute();
    } catch {
      alert('Install failed.');
    } finally {
      setPendingInstall(null);
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-2xl font-bold text-white mb-6">Integration Marketplace</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(data || []).map(item => (
          <div key={item.id} className="bg-slate-900 border border-slate-800 p-6 rounded-xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-white">{item.name}</h3>
                <Badge severity={item.status === 'installed' ? 'S4' : item.status === 'update_available' ? 'S3' : 'S1'}>
                  {item.status.replace('_', ' ').toUpperCase()}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mb-4">By {item.publisher}</p>
              <p className="text-sm text-slate-300 mb-4">{item.description}</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {item.tags.map(tag => <span key={tag} className="bg-slate-800 text-xs px-2 py-1 rounded text-slate-400">{tag}</span>)}
              </div>
            </div>
            
            <button 
              onClick={() => {
                if (item.status === 'not_installed') {
                  item.requiresElevated ? setPendingInstall(item) : handleInstall(); 
                }
              }}
              disabled={item.status === 'installed'}
              className={`w-full py-2 rounded text-sm font-medium transition-colors ${
                item.status === 'installed' ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {item.status === 'installed' ? 'Installed' : item.status === 'update_available' ? 'Update Integration' : 'Install Integration'}
            </button>
          </div>
        ))}
      </div>

      <ConfirmModal
        isOpen={pendingInstall !== null}
        title="Elevated Permissions Required"
        message={`The integration '${pendingInstall?.name}' requires elevated privileges to access raw tenant data. Do you approve this installation?`}
        isDestructive={false}
        confirmText="Approve Installation"
        onConfirm={handleInstall}
        onCancel={() => setPendingInstall(null)}
      />
    </div>
  );
}
