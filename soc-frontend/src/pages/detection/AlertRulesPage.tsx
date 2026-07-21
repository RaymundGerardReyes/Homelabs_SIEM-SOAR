import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { DetectionRule, ActionInfo } from '../../types';
import TwoKeyModal from '../../shared/ui/TwoKeyModal';

interface EnhancedDetectionRule extends DetectionRule {
  performance?: {
    falsePositiveRate: number;
    triggerCount30d: number;
  };
  dependencies?: string[];
}

export default function AlertRulesPage() {
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedDetectionRule[]>(async () => {
    const res = await apiClient.get('/detection/rules');
    return res.data.map((r: any) => ({
      ...r,
      performance: { falsePositiveRate: Math.floor(Math.random() * 40), triggerCount30d: Math.floor(Math.random() * 500) },
      dependencies: r.isAutoResponse ? ['Playbook: Auto-Containment'] : []
    }));
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<{ action: ActionInfo; type: 'toggle' | 'bulk-disable'; payload?: any } | null>(null);
  const [twoKeyInput, setTwoKeyInput] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRuleJson, setNewRuleJson] = useState('{\n  "name": "New Rule",\n  "severity": "high",\n  "enabled": true,\n  "isAutoResponse": false,\n  "dsl": "source=\\"firewall\\" AND action=\\"drop\\""\n}');

  // Modals state
  const [simulatingRule, setSimulatingRule] = useState<EnhancedDetectionRule | null>(null);
  const [simResult, setSimResult] = useState<any>(null);
  const [versionRule, setVersionRule] = useState<EnhancedDetectionRule | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const toggleRule = async (rule: EnhancedDetectionRule) => {
    if (rule.enabled && rule.isAutoResponse) {
      setPendingAction({
        type: 'toggle',
        payload: rule,
        action: {
          action: 'Disable High-Impact Rule',
          target: rule.name,
          justification: 'Disabling auto-response detection rule affects dependent playbooks',
          risk: 'DESTRUCTIVE'
        }
      });
    } else {
      performToggle(rule);
    }
  };

  const performToggle = async (rule: EnhancedDetectionRule) => {
    const original = [...(data || [])];
    if (data) {
      setData(data.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    }
    try {
      await apiClient.patch(`/detection/rules/${rule.id}`, { enabled: !rule.enabled });
      setPendingAction(null);
      setTwoKeyInput('');
    } catch {
      setData(original);
      alert('Failed to toggle rule');
    }
  };

  const handleBulkDisable = () => {
    if (!data) return;
    const selectedRules = data.filter(r => selectedIds.has(r.id));
    const hasHighImpact = selectedRules.some(r => r.isAutoResponse && r.enabled);

    if (hasHighImpact) {
      setPendingAction({
        type: 'bulk-disable',
        action: {
          action: 'Bulk Disable Rules',
          target: `${selectedIds.size} rules`,
          justification: 'Bulk disabling includes high-impact auto-response rules',
          risk: 'DESTRUCTIVE'
        }
      });
    } else {
      performBulkDisable();
    }
  };

  const performBulkDisable = async () => {
    // Mock bulk update
    if (data) {
      setData(data.map(r => selectedIds.has(r.id) ? { ...r, enabled: false } : r));
    }
    setPendingAction(null);
    setTwoKeyInput('');
    setSelectedIds(new Set());
    alert(`Bulk disabled ${selectedIds.size} rules`);
  };

  const handleBulkEnable = () => {
    if (data) {
      setData(data.map(r => selectedIds.has(r.id) ? { ...r, enabled: true } : r));
    }
    setSelectedIds(new Set());
    alert('Bulk enabled rules');
  };

  const handleSimulate = async (rule: EnhancedDetectionRule) => {
    setSimulatingRule(rule);
    setSimResult(null);
    try {
      // Mock simulation endpoint
      await new Promise(r => setTimeout(r, 1000));
      setSimResult({ matches: Math.floor(Math.random() * 50) + 10, timeTaken: '240ms' });
    } catch (e) {
      alert('Simulation failed');
    }
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === data?.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(data?.map(r => r.id)));
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <div>
           <h1 className="text-2xl font-bold text-white">Detection Rules</h1>
           <p className="text-sm text-slate-400 mt-1">Manage rule lifecycles, performance metrics, and automated responses.</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Create Rule</button>
      </div>

      {/* Bulk Operations Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-indigo-900/30 border border-indigo-500/50 p-3 rounded-lg mb-4 flex justify-between items-center">
           <span className="text-indigo-300 font-medium text-sm">{selectedIds.size} rules selected</span>
           <div className="flex space-x-2">
             <button onClick={handleBulkEnable} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded transition-colors">
               Bulk Enable
             </button>
             <button onClick={handleBulkDisable} className="px-3 py-1.5 bg-red-900/50 hover:bg-red-800/80 text-white text-xs rounded transition-colors border border-red-500/30">
               Bulk Disable
             </button>
             <button onClick={() => alert('Tag modal opened')} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs rounded transition-colors">
               Tag Category
             </button>
           </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="text-xs uppercase bg-slate-800/50 text-slate-400">
            <tr>
              <th className="p-4 w-10">
                <input 
                  type="checkbox" 
                  checked={(data && data.length > 0 && selectedIds.size === data.length) || false}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
                />
              </th>
              <th className="px-4 py-3">Rule Name</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">Performance (30d)</th>
              <th className="px-4 py-3">Dependencies</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {(data || []).map(r => (
              <tr key={r.id} className="hover:bg-slate-800/30">
                <td className="p-4">
                  <input 
                    type="checkbox" 
                    checked={selectedIds.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-blue-600 focus:ring-offset-slate-900"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-white">{r.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">ID: {r.id}</div>
                </td>
                <td className="px-4 py-3">
                   <Badge severity={r.severity === 'critical' ? 'S1' : r.severity === 'high' ? 'S2' : 'S4'}>{r.severity.toUpperCase()}</Badge> 
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                     <span className="text-xs text-slate-300">Triggered: <span className="font-mono">{r.performance?.triggerCount30d}</span></span>
                     <span className="text-xs text-slate-500">Noise: <span className={`${(r.performance?.falsePositiveRate || 0) > 20 ? 'text-yellow-500' : 'text-green-500'}`}>{r.performance?.falsePositiveRate}% FP</span></span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {r.dependencies && r.dependencies.length > 0 ? (
                    <div className="flex flex-col space-y-1">
                      {r.dependencies.map(d => <span key={d} className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">{d}</span>)}
                    </div>
                  ) : '-'}
                </td>
                <td className="px-4 py-3">
                  <button 
                    onClick={() => toggleRule(r)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                   <div className="flex justify-end space-x-2">
                     <button onClick={() => setVersionRule(r)} className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors">
                       History
                     </button>
                     <button onClick={() => handleSimulate(r)} className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-600/30 text-xs rounded transition-colors">
                       Simulate
                     </button>
                   </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TwoKeyModal
        show={pendingAction !== null}
        action={pendingAction?.action || null}
        input={twoKeyInput}
        setInput={setTwoKeyInput}
        onCancel={() => {
          setPendingAction(null);
          setTwoKeyInput('');
        }}
        onConfirm={() => { 
          if (pendingAction?.type === 'toggle') performToggle(pendingAction.payload);
          if (pendingAction?.type === 'bulk-disable') performBulkDisable();
        }}
      />

      {/* Simulation Modal */}
      {simulatingRule && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-lg w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Rule Simulation (Dry Run)</h2>
            <p className="text-slate-400 text-sm mb-6">Testing <span className="text-white font-mono">{simulatingRule.name}</span> against the last 7 days of historical telemetry.</p>
            
            {!simResult ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                 <span className="text-slate-400 animate-pulse text-sm">Executing DSL query against data lake...</span>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded p-6 text-center">
                 <p className="text-4xl font-bold text-white mb-2">{simResult.matches} <span className="text-sm text-slate-500 font-normal">matches found</span></p>
                 <p className="text-xs text-slate-500 font-mono mb-4">Query executed in {simResult.timeTaken}</p>
                 {simResult.matches > 100 && <p className="text-yellow-500 text-sm">Warning: High noise potential detected.</p>}
              </div>
            )}
            
            <div className="flex justify-end mt-6">
              <button onClick={() => setSimulatingRule(null)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionRule && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-2xl w-full shadow-2xl flex flex-col max-h-[80vh]">
            <h2 className="text-xl font-bold text-white mb-2">Version History: {versionRule.name}</h2>
            <p className="text-slate-400 text-sm mb-6">Audit trail of logic modifications and rollbacks.</p>
            
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
               {[ 
                 { v: 'v3 (Current)', date: 'Today, 10:45 AM', author: 'You', change: 'Adjusted threshold to > 50' },
                 { v: 'v2', date: '2 days ago', author: 'Alice (AppSec)', change: 'Added exclusion for internal subnet' },
                 { v: 'v1', date: '2 weeks ago', author: 'System', change: 'Initial creation from Threat Intel Feed' },
               ].map((hist, i) => (
                 <div key={i} className="bg-slate-950 border border-slate-800 p-4 rounded-lg flex justify-between items-center">
                    <div>
                      <div className="flex items-center space-x-3 mb-1">
                        <span className="text-white font-bold font-mono">{hist.v}</span>
                        <span className="text-xs text-slate-500">{hist.date}</span>
                      </div>
                      <p className="text-sm text-slate-300">{hist.change}</p>
                      <p className="text-xs text-slate-500 mt-1">By {hist.author}</p>
                    </div>
                    {i !== 0 && (
                      <button onClick={() => { alert('Rollback initiated via optimistic update'); setVersionRule(null); }} className="px-3 py-1.5 bg-red-900/40 text-red-400 border border-red-500/30 hover:bg-red-900/60 rounded text-xs transition-colors">
                        Rollback to {hist.v}
                      </button>
                    )}
                 </div>
               ))}
            </div>
            
            <div className="flex justify-end mt-6 pt-4 border-t border-slate-800">
              <button onClick={() => setVersionRule(null)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Rule Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-2xl w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Create Detection Rule</h2>
            <p className="text-slate-400 text-sm mb-4">Define rule properties using DSL JSON schema.</p>
            <textarea
              className="w-full h-64 bg-slate-950 border border-slate-800 text-green-400 font-mono p-4 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 mb-4"
              value={newRuleJson}
              onChange={e => setNewRuleJson(e.target.value)}
            />
            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                Cancel
              </button>
              <button onClick={() => alert('Created')} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors">
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
