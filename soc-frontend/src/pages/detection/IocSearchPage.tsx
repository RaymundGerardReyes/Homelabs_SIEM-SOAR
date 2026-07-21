import React, { useState } from 'react';
import { Badge, DataTable } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';

interface IOCResult {
  ioc: string;
  type: string;
  feed: string;
  verdict: 'malicious' | 'suspicious' | 'clean' | 'unknown';
  confidence: number;
  lastSeen?: string;
  searchCount30d: number;
  globalRiskScore?: number;
  isWatched?: boolean;
}

export default function IocSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IOCResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ioc_recent_searches') || '[]'); }
    catch { return []; }
  });

  const handleSearch = async (searchQuery: string = query) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    
    // Save to recents
    const newRecents = [searchQuery, ...recentSearches.filter(q => q !== searchQuery)].slice(0, 10);
    setRecentSearches(newRecents);
    localStorage.setItem('ioc_recent_searches', JSON.stringify(newRecents));

    const iocList = searchQuery.split('\n').map(s => s.trim()).filter(Boolean);
    
    try {
      // Mock batch backend search
      await new Promise(r => setTimeout(r, 800));
      const mockResults: IOCResult[] = iocList.map(ioc => {
        const verdict = Math.random() > 0.5 ? 'malicious' : 'clean';
        const confidence = verdict === 'malicious' ? 80 + Math.floor(Math.random() * 20) : 0;
        return {
          ioc,
          type: ioc.includes('.') ? (ioc.match(/^[0-9]+(?:\.[0-9]+){3}$/) ? 'ip' : 'domain') : 'hash',
          feed: verdict === 'malicious' ? 'AlienVault OTX' : 'Internal Lookup',
          verdict,
          confidence,
          lastSeen: verdict === 'malicious' ? new Date().toISOString() : undefined,
          searchCount30d: Math.floor(Math.random() * 15),
          globalRiskScore: verdict === 'malicious' ? parseFloat((7 + Math.random() * 3).toFixed(1)) : 1.2,
          isWatched: false
        };
      });
      setResults(mockResults);
    } catch {
      alert('Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "IOC,Type,Verdict,Global Risk,Confidence,Feed,Search Count (30d)\n"
      + results.map(r => `${r.ioc},${r.type},${r.verdict},${r.globalRiskScore || 0},${r.confidence}%,${r.feed},${r.searchCount30d}`).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "ioc_search_results.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const toggleWatchlist = async (ioc: string) => {
    try {
      await apiClient.post('/detection/watchlist', { ioc });
      setResults(results.map(r => r.ioc === ioc ? { ...r, isWatched: !r.isWatched } : r));
    } catch (e) {
      alert('Failed to update watchlist');
    }
  };

  return (
    <div className="p-8 bg-slate-950 min-h-screen flex flex-col">
      <div className="flex justify-between items-start mb-8">
         <div>
           <h1 className="text-3xl font-bold text-white mb-2">IOC Threat Hunting</h1>
           <p className="text-slate-400">Batch search IPs, Domains, and Hashes across all active intelligence feeds.</p>
         </div>
         {results.length > 0 && (
            <button onClick={handleExport} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded transition-colors text-sm font-medium border border-slate-700">
              Export CSV
            </button>
         )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1">
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
             <label className="block text-sm font-medium text-slate-300 mb-2">
               Indicators of Compromise
               <span className="ml-2 text-xs text-slate-500 font-normal">(Newline separated, max 100)</span>
             </label>
             <textarea 
               className="w-full h-40 bg-slate-950 border border-slate-700 rounded p-3 text-slate-200 font-mono text-sm focus:outline-none focus:border-blue-500 transition-colors"
               placeholder="1.1.1.1\nevil-domain.com\n8b1a9953c4611296a827abf8c47804d7"
               value={query}
               onChange={e => setQuery(e.target.value)}
             />
             <button 
               onClick={() => handleSearch()} 
               disabled={loading || !query.trim()} 
               className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium py-2 rounded transition-colors"
             >
               {loading ? 'Scanning Feeds...' : 'Hunt IOCs'}
             </button>
          </div>

          {recentSearches.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
               <h3 className="text-sm font-medium text-slate-300 mb-3">Recent Searches</h3>
               <div className="flex flex-wrap gap-2">
                 {recentSearches.map((s, i) => (
                   <button 
                     key={i} 
                     onClick={() => { setQuery(s); handleSearch(s); }} 
                     className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono rounded max-w-full truncate border border-slate-700 transition-colors"
                     title={s}
                   >
                     {s.split('\n')[0]} {s.includes('\n') ? '(Batch)' : ''}
                   </button>
                 ))}
               </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          {loading ? (
             <div className="flex-1 flex flex-col items-center justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                <p className="text-slate-400">Aggregating feed data and calculating global risk...</p>
             </div>
          ) : results.length === 0 ? (
             <div className="flex-1 flex items-center justify-center p-12 text-slate-500">
               Enter indicators on the left to begin hunting.
             </div>
          ) : (
             <div className="overflow-auto flex-1">
               <DataTable<IOCResult>
                 data={results}
                 keyExtractor={r => r.ioc}
                 columns={[
                   { 
                     key: 'ioc', 
                     header: 'Indicator',
                     render: r => (
                        <div className="flex flex-col">
                           <span className="font-mono text-white">{r.ioc}</span>
                           <span className="text-xs text-slate-500 uppercase tracking-wide">{r.type} • Searched {r.searchCount30d} times (30d)</span>
                        </div>
                     )
                   },
                   { 
                     key: 'verdict', 
                     header: 'Verdict & Risk',
                     render: r => (
                        <div className="flex items-center space-x-3">
                           <Badge severity={r.verdict === 'malicious' ? 'S1' : r.verdict === 'suspicious' ? 'S2' : 'S4'}>{r.verdict.toUpperCase()}</Badge>
                           {r.globalRiskScore !== undefined && (
                              <div className="flex items-center space-x-1" title="Global Risk Score (Aggregated)">
                                 <span className={`font-bold text-sm ${r.globalRiskScore >= 7 ? 'text-red-500' : r.globalRiskScore >= 4 ? 'text-yellow-500' : 'text-green-500'}`}>
                                    {r.globalRiskScore.toFixed(1)}
                                 </span>
                                 <span className="text-xs text-slate-500">/ 10</span>
                              </div>
                           )}
                        </div>
                     )
                   },
                   { 
                     key: 'feed', 
                     header: 'Primary Source',
                     render: r => <span className="text-slate-300">{r.feed} <span className="text-slate-500 ml-1">({r.confidence}% conf)</span></span>
                   },
                   { 
                     key: 'actions', 
                     header: '',
                     render: r => (
                       <div className="flex justify-end space-x-2">
                         {r.verdict === 'malicious' && (
                           <button className="px-3 py-1 text-xs font-medium bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded border border-red-500/30 transition-colors">
                             Pivot to Investigation
                           </button>
                         )}
                         <button 
                           onClick={() => toggleWatchlist(r.ioc)} 
                           className={`px-3 py-1 text-xs font-medium rounded border transition-colors ${r.isWatched ? 'bg-indigo-900/50 text-indigo-300 border-indigo-500/50' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
                         >
                           {r.isWatched ? '★ Watched' : '☆ Watch'}
                         </button>
                       </div>
                     )
                   }
                 ]}
               />
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
