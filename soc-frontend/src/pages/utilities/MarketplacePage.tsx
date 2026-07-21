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

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-[-20%] left-[20%] w-[60%] h-[50%] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="relative z-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Integration Marketplace</h1>
          <p className="text-slate-400">Extend platform capabilities with certified integrations and playbooks.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {(data || []).map(item => (
            <div key={item.id} className="glass-panel-dark border border-slate-700/50 p-6 rounded-2xl flex flex-col justify-between hover-lift shadow-xl group transition-all duration-300 hover:shadow-blue-900/20 hover:border-blue-500/30">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    {/* Mock Icon Placeholder */}
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 group-hover:text-blue-400 group-hover:border-blue-500/50 transition-colors shadow-inner">
                       <span>🧩</span>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white tracking-tight">{item.name}</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mt-0.5">By {item.publisher}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                    item.status === 'installed' ? 'bg-slate-800 text-slate-500' 
                    : item.status === 'update_available' ? 'bg-yellow-900/50 text-yellow-500 border border-yellow-700/50' 
                    : 'bg-blue-900/30 text-blue-400 border border-blue-700/30'
                  }`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>
                
                <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                  {item.description}
                </p>
                
                <div className="flex flex-wrap gap-2 mb-8">
                  {item.tags.map(tag => 
                    <span key={tag} className="bg-slate-900 border border-slate-800 text-[10px] font-mono px-2 py-1 rounded text-slate-400">
                      #{tag}
                    </span>
                  )}
                </div>
              </div>
              
              <button 
                onClick={() => {
                  if (item.status === 'not_installed') {
                    item.requiresElevated ? setPendingInstall(item) : handleInstall(); 
                  }
                }}
                disabled={item.status === 'installed'}
                className={`w-full py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide transition-all duration-300 ${
                  item.status === 'installed' 
                    ? 'bg-slate-900 text-slate-600 border border-slate-800 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-900/50 hover:shadow-blue-700/50'
                }`}
              >
                {item.status === 'installed' ? 'Installed' : item.status === 'update_available' ? 'Update Available' : 'Install Integration'}
              </button>
            </div>
          ))}
        </div>
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
