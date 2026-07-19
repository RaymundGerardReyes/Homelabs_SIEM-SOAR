// @ts-nocheck
import React, { useEffect } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, EmptyState } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { KPIData } from '../../shared/types';

export default function ExecutiveDashboardPage() {
  const { data, loading, error, execute } = useAsyncState<KPIData>(async () => {
    const res = await apiClient.get('/dashboards/executive-summary');
    return res.data;
  });

  useEffect(() => {
    execute();
  }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><ErrorState message={error} onRetry={execute} /></div>;
  if (!data) return <div className="p-8 bg-slate-950 min-h-screen ml-64"><EmptyState message="No historical data found for this tenant." /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-3xl font-bold text-white mb-8">Executive Security Summary</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-slate-400 text-sm font-medium mb-2">Total Incidents (Month)</h3>
          <p className="text-3xl font-bold text-white">{data.totalIncidents}</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-slate-400 text-sm font-medium mb-2">MTTD (Mean Time to Detect)</h3>
          <p className="text-3xl font-bold text-white">{data.mttd_minutes} <span className="text-sm font-normal text-slate-500">mins</span></p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-slate-400 text-sm font-medium mb-2">MTTR (Mean Time to Resolve)</h3>
          <p className="text-3xl font-bold text-white">{data.mttr_minutes} <span className="text-sm font-normal text-slate-500">mins</span></p>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-slate-400 text-sm font-medium mb-2">Critical Open</h3>
          <p className="text-3xl font-bold text-red-500">{data.criticalOpenCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-white font-bold mb-6">Top 5 Threat Categories</h3>
          {/* Pure HTML/CSS Bar Chart (avoiding external deps) */}
          <div className="space-y-4">
            {(data.topThreats || []).map(threat => {
              const maxCount = Math.max(...(data.topThreats || []).map(t => t.count), 1);
              const percentage = (threat.count / maxCount) * 100;
              return (
                <div key={threat.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300">{threat.category}</span>
                    <span className="text-slate-400 font-mono">{threat.count}</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
            {(!data.topThreats || data.topThreats.length === 0) && (
              <p className="text-slate-500 text-sm italic">No threat category data available.</p>
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
          <h3 className="text-white font-bold mb-6">Risk Trend (Last 7 Days)</h3>
          {/* Pure HTML/CSS Trend Line alternative (avoiding Recharts dependency issues on the fly) */}
          <div className="flex items-end justify-between h-48 border-b border-l border-slate-800 pt-4 pb-2 px-2">
             {(data.riskTrend || []).map((point, idx) => {
               const maxScore = Math.max(...(data.riskTrend || []).map(p => p.score), 10);
               const height = (point.score / maxScore) * 100;
               return (
                 <div key={idx} className="flex flex-col items-center justify-end h-full w-full group relative">
                   <div 
                     className="w-1/2 bg-indigo-500/50 hover:bg-indigo-400 rounded-t transition-all"
                     style={{ height: `${height}%` }}
                   ></div>
                   <span className="text-[10px] text-slate-500 mt-2 rotate-45">{point.date.split('-').pop()}</span>
                   
                   {/* Tooltip */}
                   <div className="absolute bottom-full mb-2 hidden group-hover:block bg-slate-800 text-white text-xs p-1 rounded whitespace-nowrap z-10">
                     Score: {point.score}
                   </div>
                 </div>
               );
             })}
          </div>
        </div>
      </div>
    </div>
  );
}
