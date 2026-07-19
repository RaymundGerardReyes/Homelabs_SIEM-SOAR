// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { Asset } from '../../shared/types';

export default function AssetInventoryPage() {
  const { data, loading, error, execute } = useAsyncState<Asset[]>(async () => {
    const res = await apiClient.get('/assets/inventory');
    return res.data;
  });

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-white">Asset Inventory</h1>
        <button className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm font-medium">Add Asset</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
        <DataTable<Asset>
          data={data || []}
          keyExtractor={item => item.id}
          columns={[
            { key: 'hostname', header: 'Asset Name' },
            { key: 'ipAddress', header: 'IP Address' },
            { key: 'type', header: 'Type' },
            { 
              key: 'criticality', header: 'Criticality',
              render: (r) => <Badge severity={r.criticality === 'Tier 1' ? 'S1' : r.criticality === 'Tier 2' ? 'S2' : 'S4'}>{r.criticality}</Badge>
            },
            { key: 'owner', header: 'Owner' }
          ]}
        />
      </div>
    </div>
  );
}
