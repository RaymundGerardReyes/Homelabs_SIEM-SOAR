import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, EmptyState } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { KPIData } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

interface EnhancedKPIData extends KPIData {
  deltas?: {
    totalIncidents: number;
    mttd_minutes: number;
    mttr_minutes: number;
  };
  benchmark?: {
    mttdPercentile: number;
    mttrPercentile: number;
  };
}

export default function ExecutiveDashboardPage() {
  const navigate = useNavigate();
  const [isExporting, setIsExporting] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleEmail, setScheduleEmail] = useState('');
  const [scheduleFreq, setScheduleFreq] = useState('weekly');

  const { data, loading, error, execute } = useAsyncState<EnhancedKPIData>(async () => {
    // Mock enhanced response with deltas and benchmarks
    const res = await apiClient.get('/dashboards/executive-summary?compare=previous_period');
    return {
      ...res.data,
      deltas: { totalIncidents: 12, mttd_minutes: -18, mttr_minutes: -5 },
      benchmark: { mttdPercentile: 85, mttrPercentile: 72 }
    };
  });

  useEffect(() => {
    execute();
  }, [execute]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await apiClient.post('/dashboards/executive-summary/export', {}, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Executive_Board_Report.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      alert('Failed to generate board report (mocked).');
    } finally {
      setIsExporting(false);
    }
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/dashboards/executive-summary/schedule', { email: scheduleEmail, frequency: scheduleFreq });
      alert('Report scheduled successfully!');
      setShowScheduleModal(false);
    } catch (e) {
      alert('Failed to schedule report.');
    }
  };

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;
  if (!data) return <div className="p-8 bg-slate-950 min-h-screen"><EmptyState message="No historical data found for this tenant." /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[20%] w-[40%] h-[40%] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[10%] w-[30%] h-[40%] bg-red-600/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
              Executive Security Summary
            </h1>
            <p className="text-slate-400">
              High-level metrics and risk trends for CISO reporting.
            </p>
          </div>
          <div className="flex space-x-3 mt-4 md:mt-0">
            <button 
              onClick={() => setShowScheduleModal(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded font-medium text-sm transition-colors"
            >
              Schedule Delivery
            </button>
            <button 
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-sm transition-colors disabled:opacity-50"
            >
              {isExporting ? 'Generating PDF...' : 'Generate Board Report'}
            </button>
          </div>
        </div>
        
        {/* Benchmark Banner */}
        {data.benchmark && (
          <div className="mb-6 bg-gradient-to-r from-indigo-900/40 to-blue-900/20 border border-indigo-500/30 rounded-lg p-4 flex items-center">
             <div className="bg-indigo-500/20 p-2 rounded-full mr-4">
               <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
             </div>
             <div>
               <p className="text-slate-200 text-sm font-medium">Industry Benchmark Context</p>
               <p className="text-slate-400 text-xs mt-1">
                 Your MTTD is in the <span className="text-indigo-400 font-bold">Top {100 - data.benchmark.mttdPercentile}%</span> for your industry tier. MTTR is operating within expected baseline limits.
               </p>
             </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <KpiCard 
            title="Total Incidents (Month)" 
            value={data.totalIncidents} 
            delta={data.deltas?.totalIncidents} 
            isNegativeGood={true} 
          />
          <KpiCard 
            title="MTTD" 
            value={data.mttd_minutes} 
            unit="mins"
            delta={data.deltas?.mttd_minutes} 
            isNegativeGood={true} 
          />
          <KpiCard 
            title="MTTR" 
            value={data.mttr_minutes} 
            unit="mins"
            delta={data.deltas?.mttr_minutes} 
            isNegativeGood={true} 
          />
          <div className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <h3 className="text-slate-400 text-sm font-medium mb-2 relative z-10">Critical Open</h3>
            <p className="text-4xl font-bold text-red-500 relative z-10 drop-shadow-md">{data.criticalOpenCount}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Mock Interactive Trend Chart */}
          <div 
            className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-2xl relative overflow-hidden cursor-pointer hover:border-slate-600 transition-colors"
            onClick={() => navigate('/incidents/closed?timeRange=30d')} // Drill-down interactivity
          >
            <h3 className="text-lg font-semibold text-white mb-6">Enterprise Risk Trend (30 Days)</h3>
            <div className="h-64 flex flex-col justify-end relative">
              <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-slate-900/60 transition-opacity z-20">
                 <span className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded shadow-lg">Pivot to Closed Incidents</span>
              </div>
              {/* Mock SVG Line Chart */}
              <svg viewBox="0 0 100 50" className="w-full h-full drop-shadow-[0_0_10px_rgba(79,70,229,0.5)] z-10">
                 <path d="M0,40 Q10,30 20,35 T40,20 T60,25 T80,10 T100,15" fill="none" stroke="#818cf8" strokeWidth="3" />
                 <path d="M0,50 L0,40 Q10,30 20,35 T40,20 T60,25 T80,10 T100,15 L100,50 Z" fill="url(#gradient)" opacity="0.2" />
                 <defs>
                   <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="0%" stopColor="#818cf8" />
                     <stop offset="100%" stopColor="transparent" />
                   </linearGradient>
                 </defs>
              </svg>
            </div>
          </div>

          {/* Mock Interactive Bar Chart */}
          <div 
            className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-2xl relative overflow-hidden cursor-pointer hover:border-slate-600 transition-colors"
            onClick={() => navigate('/incidents/active?category=phishing,malware')} // Drill-down interactivity
          >
            <h3 className="text-lg font-semibold text-white mb-6">Top Threat Categories</h3>
            <div className="h-64 flex items-end justify-around relative">
              <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-slate-900/60 transition-opacity z-20">
                 <span className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded shadow-lg">Pivot to Active Incidents</span>
              </div>
              {[85, 60, 45, 30, 20].map((val, i) => (
                <div key={i} className="w-12 bg-slate-700 hover:bg-slate-500 transition-colors rounded-t" style={{ height: `${val}%` }} />
              ))}
            </div>
            <div className="flex justify-around mt-4 text-xs text-slate-400 font-mono">
              <span>Phish</span><span>Mal</span><span>Ransom</span><span>Exfil</span><span>DDoS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">Schedule Report Delivery</h2>
            <form onSubmit={handleScheduleSubmit}>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Recipient Email(s)</label>
                  <input 
                    type="email" required 
                    value={scheduleEmail} onChange={e => setScheduleEmail(e.target.value)}
                    placeholder="ciso@company.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Delivery Frequency</label>
                  <select
                    value={scheduleFreq} onChange={e => setScheduleFreq(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="daily">Daily (08:00 AM)</option>
                    <option value="weekly">Weekly (Mon 08:00 AM)</option>
                    <option value="monthly">Monthly (1st Day)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setShowScheduleModal(false)} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors">
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ title, value, unit = '', delta, isNegativeGood }: { title: string, value: number, unit?: string, delta?: number, isNegativeGood: boolean }) {
  const isGood = delta ? (isNegativeGood ? delta <= 0 : delta >= 0) : true;
  const deltaText = delta ? (delta > 0 ? `+${delta}%` : `${delta}%`) : null;

  return (
    <div className="glass-panel-dark rounded-xl p-6 border border-slate-800 shadow-xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <h3 className="text-slate-400 text-sm font-medium mb-2 relative z-10">{title}</h3>
      <div className="flex items-end space-x-2 relative z-10">
        <p className="text-4xl font-bold text-white drop-shadow-md">
          {value} {unit && <span className="text-sm font-normal text-slate-500">{unit}</span>}
        </p>
      </div>
      {delta !== undefined && (
        <p className={`text-xs mt-2 font-medium ${isGood ? 'text-emerald-400' : 'text-red-400'}`}>
          {deltaText} vs prior period
        </p>
      )}
    </div>
  );
}
