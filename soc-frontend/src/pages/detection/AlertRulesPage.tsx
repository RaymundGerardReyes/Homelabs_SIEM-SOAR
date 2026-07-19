// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge, ConfirmModal } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { DetectionRule } from '../../shared/types';

export default function AlertRulesPage() {
  const { data, loading, error, execute, setData } = useAsyncState<DetectionRule[]>(async () => {
    const res = await apiClient.get('/detection/rules');
    return res.data;
  });

  const [pendingDisable, setPendingDisable] = useState<DetectionRule | null>(null);

  useEffect(() => { execute(); }, [execute]);

  const toggleRule = async (rule: DetectionRule) => {
    if (rule.enabled && rule.isAutoResponse) {
      setPendingDisable(rule);
    } else {
      performToggle(rule);
    }
  };

  const performToggle = async (rule: DetectionRule) => {
    const original = [...(data || [])];
    if (data) {
      setData(data.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    }
    try {
      await apiClient.patch(`/detection/rules/${rule.id}`, { enabled: !rule.enabled });
      setPendingDisable(null);
    } catch {
      setData(original);
      alert('Failed to toggle rule');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Detection Rules</h1>
        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Create Rule</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<DetectionRule>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'name', header: 'Rule Name' },
            { 
              key: 'severity', header: 'Severity', 
              render: (r) => <Badge severity={r.severity === 'critical' ? 'S1' : r.severity === 'high' ? 'S2' : 'S4'}>{r.severity.toUpperCase()}</Badge> 
            },
            { 
              key: 'status', header: 'Status',
              render: (r) => (
                <button 
                  onClick={() => toggleRule(r)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.enabled ? 'bg-blue-600' : 'bg-slate-700'}`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${r.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              )
            },
            { key: 'lastTriggered', header: 'Last Triggered', render: (r) => r.lastTriggered ? new Date(r.lastTriggered).toLocaleString() : 'Never' }
          ]}
        />
      </div>

      <ConfirmModal
        isOpen={pendingDisable !== null}
        title="Disable High-Impact Rule"
        message={`Are you sure you want to disable the auto-response rule: ${pendingDisable?.name}? This may leave the environment vulnerable.`}
        isDestructive={true}
        confirmText="Yes, Disable Rule"
        onConfirm={() => { if (pendingDisable) performToggle(pendingDisable); }}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
}
