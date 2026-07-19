// @ts-nocheck
import React, { useState } from 'react';
import { useAsyncState } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, DataTable, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { IocResult } from '../../shared/types';
import { useNavigate } from 'react-router-dom';

export default function IocSearchPage() {
  const [query, setQuery] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const navigate = useNavigate();

  const { data, loading, error, execute } = useAsyncState<IocResult[]>(async () => {
    const res = await apiClient.get(`/detection/ioc-search?query=${query}`);
    return res.data;
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;
    setHasSearched(true);
    execute();
  };

  return (
    <div className="p-8 bg-slate-950 min-h-screen ml-64">
      <h1 className="text-3xl font-bold text-white mb-8 text-center">Global IOC Search</h1>
      
      <div className="max-w-2xl mx-auto mb-12">
        <form onSubmit={handleSearch} className="flex space-x-2">
          <input 
            type="text" 
            placeholder="Search IPs, domains, or hashes (MD5/SHA256)..." 
            className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-lg px-6 py-4 focus:ring-2 focus:ring-blue-500 focus:outline-none text-lg shadow-xl"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-lg font-bold text-lg transition-colors">
            Search
          </button>
        </form>
      </div>

      {hasSearched && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden max-w-5xl mx-auto">
          {loading ? (
            <div className="p-8"><LoadingSkeleton lines={4} /></div>
          ) : error && !data ? (
            <ErrorState message={error} onRetry={execute} />
          ) : (
             <DataTable<IocResult>
                data={data || []}
                keyExtractor={item => item.ioc + item.sourceFeed}
                columns={[
                  { key: 'ioc', header: 'Indicator' },
                  { key: 'type', header: 'Type' },
                  { key: 'sourceFeed', header: 'Source' },
                  { 
                    key: 'verdict', header: 'Verdict',
                    render: (r) => <Badge severity={r.verdict === 'malicious' ? 'S1' : r.verdict === 'suspicious' ? 'S3' : 'S4'}>{r.verdict.toUpperCase()}</Badge>
                  },
                  {
                    key: 'action', header: 'Action',
                    render: (r) => r.verdict === 'malicious' ? (
                      <button onClick={() => navigate('/investigations')} className="text-blue-400 hover:text-blue-300 text-xs font-bold">PIVOT</button>
                    ) : null
                  }
                ]}
             />
          )}
        </div>
      )}
    </div>
  );
}
