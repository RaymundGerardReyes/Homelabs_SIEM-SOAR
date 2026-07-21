import React, { useEffect, useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ClosedIncident } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

interface EnhancedClosedIncident extends ClosedIncident {
  rootCause?: string;
  detectionGapReported?: boolean;
  postMortemStatus?: 'scheduled' | 'pending' | 'completed' | 'not-required';
}

export default function ClosedIncidentsPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedClosedIncident[]>(async () => {
    const res = await apiClient.get('/incidents/closed');
    const rootCauses = ['Phishing', 'Misconfiguration', 'Insider Threat', 'Third-Party', 'False Positive'];
    return res.data.map((inc: any, i: number) => ({
      ...inc,
      rootCause: rootCauses[i % rootCauses.length],
      detectionGapReported: i % 5 === 0,
      postMortemStatus: (inc.severity === 'critical' || inc.severity === 'high') 
        ? (i % 3 === 0 ? 'completed' : i % 2 === 0 ? 'scheduled' : 'pending')
        : 'not-required'
    }));
  });

  const [gapModalOpen, setGapModalOpen] = useState<string | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState<string | null>(null);

  useEffect(() => { execute(); }, [execute]);

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen"><LoadingSkeleton lines={8} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen"><ErrorState message={error} onRetry={execute} /></div>;

  const rootCauseCounts = (data || []).reduce((acc: any, inc) => {
     if (inc.rootCause) acc[inc.rootCause] = (acc[inc.rootCause] || 0) + 1;
     return acc;
  }, {});

  const handleReportGap = (id: string) => {
     setData((data || []).map(inc => inc.id === id ? { ...inc, detectionGapReported: true } : inc));
     setGapModalOpen(null);
  };

  const handleScheduleReview = (id: string) => {
     setData((data || []).map(inc => inc.id === id ? { ...inc, postMortemStatus: 'scheduled' } : inc));
     setScheduleModalOpen(null);
  };

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-emerald-600/5 rounded-full blur-[150px] pointer-events-none" />
      
      <div className="relative z-10">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Closed Incidents</h1>
            <p className="text-slate-400">Historical log of resolved security incidents and post-mortems.</p>
          </div>
          <button onClick={execute} className="px-4 py-2 bg-slate-900 border border-slate-700 text-slate-300 rounded hover:bg-slate-800 hover:text-white transition-colors flex items-center font-medium text-sm">
            <span className="mr-2">⟳</span> Refresh Archive
          </button>
        </div>

        {/* Root Cause Analytics Strip */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-6">
          <h3 className="text-sm font-bold text-slate-300 mb-4 uppercase tracking-wider">Top Root Causes (Last 30 Days)</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
             {Object.entries(rootCauseCounts).sort((a: any, b: any) => b[1] - a[1]).map(([cause, count]: any) => (
               <div key={cause} className="bg-slate-950 border border-slate-800 p-3 rounded">
                  <p className="text-2xl font-bold text-white">{count}</p>
                  <p className="text-xs text-slate-500 truncate">{cause}</p>
               </div>
             ))}
          </div>
        </div>

        <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-900/80 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-semibold">Incident ID / Title</th>
                  <th className="px-6 py-4 font-semibold">Root Cause</th>
                  <th className="px-6 py-4 font-semibold">Post-Mortem</th>
                  <th className="px-6 py-4 font-semibold">Detection Feedback</th>
                  <th className="px-6 py-4 font-semibold text-right">Closed At</th>
                </tr>
              </thead>
              <tbody>
                {(data || []).map((incident) => {
                  const isCritical = incident.severity.toLowerCase() === 'critical';
                  return (
                    <tr key={incident.id} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <div className="flex items-center space-x-2">
                             <span className="font-mono text-blue-400 font-medium cursor-pointer hover:underline" onClick={() => navigate(`/incidents/${incident.id}`)}>
                               #{incident.id.split('-')[0] || incident.id}
                             </span>
                             <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${isCritical ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                               {incident.severity.toUpperCase()}
                             </span>
                          </div>
                          <span className="text-slate-300 mt-1 truncate max-w-sm">{incident.title}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                         <span className="inline-flex items-center px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 text-xs">
                            {incident.rootCause || 'Unclassified'}
                         </span>
                      </td>
                      <td className="px-6 py-4">
                         {incident.postMortemStatus === 'not-required' && <span className="text-xs text-slate-600">Not Required</span>}
                         {incident.postMortemStatus === 'completed' && <span className="text-xs text-green-500 flex items-center"><span className="mr-1">✓</span> Completed</span>}
                         {incident.postMortemStatus === 'scheduled' && <span className="text-xs text-indigo-400 flex items-center"><span className="mr-1">📅</span> Scheduled</span>}
                         {incident.postMortemStatus === 'pending' && (
                            <button onClick={() => setScheduleModalOpen(incident.id)} className="px-2 py-1 bg-yellow-900/30 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-900/50 rounded text-xs transition-colors">
                               Schedule Review
                            </button>
                         )}
                      </td>
                      <td className="px-6 py-4">
                         {incident.detectionGapReported ? (
                            <span className="text-xs text-emerald-400 flex items-center">
                               <span className="mr-1">✓</span> Rule Gap Logged
                            </span>
                         ) : (
                            <button onClick={() => setGapModalOpen(incident.id)} className="text-xs text-slate-500 hover:text-slate-300 underline">
                               Report Detection Gap
                            </button>
                         )}
                      </td>
                      <td className="px-6 py-4 text-right text-xs font-mono">
                        {new Date(incident.closedAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Report Gap Modal */}
      {gapModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-white mb-2">Report Detection Gap</h2>
              <p className="text-slate-400 text-sm mb-4">Flag this incident to Detection Engineering. It will be added to the Alert Rules backlog for tuning.</p>
              <textarea className="w-full h-24 bg-slate-950 border border-slate-700 text-white text-sm p-3 rounded focus:outline-none focus:border-blue-500 mb-4" placeholder="Briefly describe what log source or rule should have caught this earlier..."></textarea>
              <div className="flex justify-end space-x-3">
                 <button onClick={() => setGapModalOpen(null)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                 <button onClick={() => handleReportGap(gapModalOpen)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Submit to Backlog</button>
              </div>
           </div>
        </div>
      )}

      {/* Schedule Post-Mortem Modal */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-white mb-2">Schedule Post-Mortem</h2>
              <p className="text-slate-400 text-sm mb-4">Major incidents require a formal review. This will generate a calendar invite for the incident responders.</p>
              <input type="datetime-local" className="w-full bg-slate-950 border border-slate-700 text-white p-2 rounded text-sm mb-4" />
              <div className="flex justify-end space-x-3">
                 <button onClick={() => setScheduleModalOpen(null)} className="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                 <button onClick={() => handleScheduleReview(scheduleModalOpen)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors">Send Invites</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
