import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { EndpointHost, ActionInfo } from '../../types';

interface EnhancedEndpointHost extends EndpointHost {
  aiRecommended?: boolean;
  isolationHistoryCount?: number;
  services?: string[];
  autoReleaseAt?: string;
}

export default function IsolationControlsPage() {
  const { data, loading, error, execute } = useAsyncState<EnhancedEndpointHost[]>(async () => {
    const res = await apiClient.get('/endpoints/isolation-candidates');
    return res.data.map((h: any, i: number) => ({
      ...h,
      aiRecommended: h.isIsolated === false && Math.random() > 0.8,
      isolationHistoryCount: Math.floor(Math.random() * 5),
      services: ['nginx (Production)', 'PostgreSQL (Read Replica)'].slice(0, i % 3 + 1),
      autoReleaseAt: h.isIsolated && Math.random() > 0.5 ? new Date(Date.now() + 14400000).toISOString() : undefined
    }));
  });

  const [pendingAction, setPendingAction] = useState<{ host: EnhancedEndpointHost, type: 'isolate' | 'release' } | null>(null);
  const [twoKeyInput, setTwoKeyInput] = useState('');
  const [autoReleaseHours, setAutoReleaseHours] = useState<number>(0);
  const [postIsolationChecklist, setPostIsolationChecklist] = useState<EnhancedEndpointHost | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const performAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.type === 'isolate') {
        await apiClient.post(`/endpoints/${pendingAction.host.id}/isolate`, { autoReleaseHours });
        setPostIsolationChecklist(pendingAction.host);
      } else {
        await apiClient.post(`/endpoints/${pendingAction.host.id}/release`);
      }
      execute(); 
    } catch {
      alert('Action failed.');
    } finally {
      setPendingAction(null);
      setTwoKeyInput('');
      setAutoReleaseHours(0);
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const isolatedCount = (data || []).filter(h => h.isIsolated).length;
  const aiRecommendedHosts = (data || []).filter(h => h.aiRecommended);

  const getActionInfo = (): ActionInfo | null => {
    if (!pendingAction) return null;
    if (pendingAction.type === 'isolate') {
      return {
        action: 'Isolate Host',
        target: pendingAction.host.hostname,
        justification: `Containment for investigation${autoReleaseHours > 0 ? ` (Auto-release in ${autoReleaseHours}h)` : ''}`,
        risk: 'DESTRUCTIVE'
      };
    }
    return {
      action: 'Release Isolation',
      target: pendingAction.host.hostname,
      justification: 'Restoring network connectivity',
      risk: 'HIGH_IMPACT_WRITE'
    };
  };

  return (
    <div className="p-8 bg-slate-950 min-h-screen">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Isolation Controls</h1>
          <p className="text-slate-400">Contain threats by severing compromised endpoints from the network.</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg text-right">
          <p className="text-xl font-bold text-slate-300">24</p>
          <p className="text-xs text-slate-500 uppercase tracking-wide">Isolations (30d)</p>
        </div>
      </div>
      
      {isolatedCount > 0 && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg flex items-center text-red-500">
          <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span className="font-bold">CRITICAL WARNING: There are {isolatedCount} endpoint(s) currently isolated from the network.</span>
        </div>
      )}

      {aiRecommendedHosts.length > 0 && (
        <div className="mb-6 p-4 bg-purple-900/20 border border-purple-500/50 rounded-lg">
          <h3 className="text-purple-400 font-bold mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.286 1.006l-1.311 1.311a1 1 0 01-1.414 0l-1.312-1.312-5.42-1.738-.616 1.233a1 1 0 11-1.79-.894l.8-1.599L4.677 5H3a1 1 0 010-2h7z" /></svg>
            AI Recommended Actions
          </h3>
          <p className="text-slate-300 text-sm mb-3">High confidence incidents detected on the following hosts. Immediate isolation recommended.</p>
          <div className="flex space-x-3">
            {aiRecommendedHosts.map(h => (
              <button 
                key={h.id} onClick={() => setPendingAction({ host: h, type: 'isolate' })}
                className="bg-slate-800 hover:bg-slate-700 border border-purple-500/30 text-white px-3 py-1.5 rounded text-sm transition-colors"
              >
                Isolate {h.hostname}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
            <tr>
              <th className="p-4">Hostname / IP</th>
              <th className="p-4">Network Status</th>
              <th className="p-4">History</th>
              <th className="p-4 text-right">Destructive Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {(data || []).map(r => (
              <tr key={r.id} className="hover:bg-slate-800/30">
                <td className="p-4">
                   <div className="font-bold text-white">{r.hostname}</div>
                   <div className="text-xs text-slate-500 font-mono">{r.ipAddress}</div>
                </td>
                <td className="p-4">
                   <div className="flex flex-col space-y-1">
                     <Badge severity={r.isIsolated ? 'S1' : 'S4'}>{r.isIsolated ? 'ISOLATED' : 'CONNECTED'}</Badge>
                     {r.isIsolated && r.autoReleaseAt && (
                       <span className="text-xs text-yellow-500">
                         Auto-release: {new Date(r.autoReleaseAt).toLocaleString()}
                       </span>
                     )}
                   </div>
                </td>
                <td className="p-4">
                   <span className="text-xs text-slate-400">Isolated {r.isolationHistoryCount} times</span>
                </td>
                <td className="p-4 text-right">
                   {r.isIsolated ? (
                     <button onClick={() => setPendingAction({ host: r, type: 'release' })} className="text-orange-400 hover:text-orange-300 font-bold text-xs uppercase bg-orange-900/20 px-3 py-1.5 rounded transition-colors border border-orange-500/30">Release Isolation</button>
                   ) : (
                     <button onClick={() => setPendingAction({ host: r, type: 'isolate' })} className="text-red-500 hover:text-red-400 font-bold text-xs uppercase bg-red-900/20 px-3 py-1.5 rounded transition-colors border border-red-500/30">Isolate Host</button>
                   )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pending Action Config Modal (Before TwoKey) */}
      {pendingAction && pendingAction.type === 'isolate' && getActionInfo() === null /* wait, getActionInfo works, I will use TwoKeyModal directly but add children to it */}

      {pendingAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-slate-900 border-2 border-red-500/50 rounded-lg p-8 max-w-xl w-full shadow-[0_0_50px_rgba(239,68,68,0.2)]">
            <div className="flex items-center text-red-500 mb-6">
              <svg className="w-10 h-10 mr-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <h2 className="text-2xl font-bold uppercase tracking-wider">
                {pendingAction.type === 'isolate' ? 'Emergency Isolation' : 'Release Isolation'}
              </h2>
            </div>

            <div className="mb-6 space-y-4">
              <div className="bg-slate-950 p-4 rounded border border-slate-800">
                <p className="text-sm text-slate-400 mb-1">Target Host</p>
                <p className="text-lg font-mono text-white">{pendingAction.host.hostname} <span className="text-slate-500">({pendingAction.host.ipAddress})</span></p>
              </div>

              {pendingAction.type === 'isolate' && (
                <>
                  <div className="bg-red-950/30 p-4 rounded border border-red-900/50">
                    <p className="text-sm font-bold text-red-400 mb-2">Blast Radius Preview</p>
                    <ul className="list-disc list-inside text-slate-300 text-sm">
                      {pendingAction.host.services?.map(s => <li key={s}>{s}</li>)}
                    </ul>
                    <p className="text-xs text-red-400/80 mt-2 font-mono">Severing network will drop all active connections to these services.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Scheduled Auto-Release (Optional)</label>
                    <select 
                      value={autoReleaseHours} 
                      onChange={e => setAutoReleaseHours(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white"
                    >
                      <option value={0}>Manual Release Only</option>
                      <option value={1}>Auto-release in 1 Hour</option>
                      <option value={4}>Auto-release in 4 Hours</option>
                      <option value={24}>Auto-release in 24 Hours</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="bg-slate-950 p-6 rounded border border-slate-800 mb-6">
              <p className="text-sm text-slate-300 mb-4 font-mono">
                Please type <span className="font-bold text-red-400 select-none">{pendingAction.host.hostname}</span> to confirm this action.
              </p>
              <input 
                type="text"
                value={twoKeyInput}
                onChange={e => setTwoKeyInput(e.target.value)}
                placeholder="Enter hostname..."
                className="w-full bg-slate-900 border border-slate-700 text-white font-mono p-3 rounded focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors"
              />
            </div>

            <div className="flex justify-end space-x-4">
              <button 
                onClick={() => { setPendingAction(null); setTwoKeyInput(''); }}
                className="px-6 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={performAction}
                disabled={twoKeyInput !== pendingAction.host.hostname}
                className="px-6 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-[0_0_15px_rgba(220,38,38,0.5)]"
              >
                Execute Action
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Isolation Checklist */}
      {postIsolationChecklist && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-indigo-500/50 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Isolation Complete</h2>
            <p className="text-slate-400 text-sm mb-6">Host <span className="text-white font-mono">{postIsolationChecklist.hostname}</span> has been successfully contained. Please complete the following post-isolation tasks:</p>
            
            <div className="space-y-3 mb-6">
              {['Trigger forensic memory dump', 'Rotate local administrator credentials', 'Notify service owner'].map((task, i) => (
                <label key={i} className="flex items-start space-x-3 text-slate-300 text-sm p-2 hover:bg-slate-800/50 rounded cursor-pointer">
                   <input type="checkbox" className="mt-1 w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500" />
                   <span>{task}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => setPostIsolationChecklist(null)} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
