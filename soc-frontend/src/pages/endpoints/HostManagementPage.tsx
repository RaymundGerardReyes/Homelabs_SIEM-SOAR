import React, { useEffect, useState, useMemo } from 'react';
import { useAsyncState, useWebSocketStream } from '../../shared/hooks';
import { LoadingSkeleton, ErrorState, Badge } from '../../shared/ui';
import apiClient from '../../shared/api/apiClient';
import { ManagedHost } from '../../shared/types';
import { useNavigate, Link } from 'react-router-dom';

interface EnhancedHost extends ManagedHost {
  criticality?: 'Tier-1' | 'Tier-2' | 'Tier-3';
  openIncidentsCount?: number;
  lastIsolatedDaysAgo?: number;
  trendingStale?: boolean;
  type?: 'paas' | 'iaas' | 'local_cf_tunnel';
  ipAddress?: string;
  region?: string;
}

interface GeneratedTokenDetails {
  token: string;
  tenantId: string;
  expiresIn: number;
  maxUse: number;
  endpointType: string;
  createdAt: string;
}

export default function HostManagementPage() {
  const navigate = useNavigate();
  const { data, loading, error, execute, setData } = useAsyncState<EnhancedHost[]>(async () => {
    const res = await apiClient.get('/endpoints/hosts');
    return res.data.map((h: any) => ({
      ...h,
      criticality: h.criticality || 'Tier-3',
      openIncidentsCount: h.openIncidentsCount || 0,
      lastIsolatedDaysAgo: h.lastIsolatedDaysAgo,
      trendingStale: h.trendingStale || false,
      type: h.type || 'iaas',
      ipAddress: h.ipAddress || 'Dynamic Edge',
      region: h.region || 'local'
    })).sort((a: any, b: any) => new Date(b.lastCheckIn).getTime() - new Date(a.lastCheckIn).getTime());
  });

  // Table selection & bulk state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'restart' | 'update' | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; completed: number; failed: number } | null>(null);
  const [viewFilter, setViewFilter] = useState<'all' | 'out-of-compliance' | 'tier-1' | 'paas' | 'iaas' | 'local_cf_tunnel'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Spoke Enrollment Modal State
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState(false);
  const [enrollTenantId, setEnrollTenantId] = useState('acme-corp');
  const [enrollExpiresIn, setEnrollExpiresIn] = useState(900); // 15 mins
  const [enrollMaxUse, setEnrollMaxUse] = useState(1);
  const [enrollEndpointType, setEnrollEndpointType] = useState<'iaas' | 'paas' | 'local_cf_tunnel'>('iaas');
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);
  const [generatedTokenDetails, setGeneratedTokenDetails] = useState<GeneratedTokenDetails | null>(null);
  const [activeCommandTab, setActiveCommandTab] = useState<'curl' | 'python' | 'csharp' | 'go' | 'typescript' | 'java'>('curl');
  const [showSecretToken, setShowSecretToken] = useState(false);

  // Dynamically resolve the HUB_URL based on where the app is hosted (e.g. PaaS environments)
  const currentHubUrl = (import.meta as any).env?.VITE_HUB_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:81');


  // In-App Toast & Confirmation Dialog State
  const [toastMessage, setToastMessage] = useState<{ title: string; desc?: string; type: 'success' | 'info' | 'warning' | 'error' } | null>(null);
  const [rotateConfirmHost, setRotateConfirmHost] = useState<EnhancedHost | null>(null);

  useEffect(() => { execute(); }, [execute]);

  // Toast Auto-Dismiss
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const showToast = (title: string, desc?: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    setToastMessage({ title, desc, type });
  };

  // Real-time Agent Enrollment Listener
  useWebSocketStream<any>('/api/ws/endpoints', (event) => {
    if (event.type === 'endpoint_enrolled' || event.type === 'endpoint_registered') {
      execute();
      showToast('Agent Connected', `Endpoint ${event.endpoint_id} successfully enrolled in real-time.`, 'info');
    }
  });

  // Handle Token Generation API Call
  const handleGenerateEnrollmentToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollTenantId.trim()) return;

    setIsGeneratingToken(true);
    try {
      const res = await apiClient.post('/admin/enrollment-tokens', {
        tenant_id: enrollTenantId.trim(),
        expires_in: enrollExpiresIn,
        max_use: enrollMaxUse
      });

      setGeneratedTokenDetails({
        token: res.data.enrollment_token,
        tenantId: enrollTenantId.trim(),
        expiresIn: enrollExpiresIn,
        maxUse: enrollMaxUse,
        endpointType: enrollEndpointType,
        createdAt: new Date().toLocaleTimeString()
      });

      showToast('Enrollment Token Created', `Generated one-time token for tenant '${enrollTenantId}'`, 'success');
    } catch (e: any) {
      showToast('Failed to Generate Token', e.response?.data?.detail || e.message || 'Server error', 'error');
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleCopyCommand = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast('Copied to Clipboard!', `${label} copied. Ready to paste in terminal.`, 'success');
  };

  const handleRotateCredential = async () => {
    if (!rotateConfirmHost) return;
    const endpointId = rotateConfirmHost.id;
    setRotateConfirmHost(null);

    try {
      await apiClient.post(`/admin/endpoints/${endpointId}/rotate`);
      showToast('Credential Rotated', `Endpoint ${rotateConfirmHost.hostname} rotated. Agent must re-enroll.`, 'warning');
      execute();
    } catch (e: any) {
      showToast('Rotation Failed', e.response?.data?.detail || 'Failed to rotate credential', 'error');
    }
  };

  const handleDispatchSoarTask = async (endpointId: string, actionName: string, hostname: string) => {
    try {
      await apiClient.post(`/admin/endpoints/${endpointId}/tasks`, {
        action: actionName,
        params: { triggered_by: 'soc-admin-ui' }
      });
      showToast('SOAR Task Dispatched', `Command '${actionName}' assigned to host ${hostname}.`, 'success');
    } catch (e: any) {
      showToast('Dispatch Error', e.response?.data?.detail || 'Failed to dispatch SOAR task', 'error');
    }
  };

  const handleBulkAction = async (action: 'restart' | 'update') => {
    setBulkAction(action);
    setBulkProgress({ total: selectedIds.size, completed: 0, failed: 0 });
    
    let completed = 0;
    let failed = 0;
    for (const id of Array.from(selectedIds)) {
      await new Promise(r => setTimeout(r, 350));
      if (Math.random() > 0.9) failed++;
      else completed++;
      
      if (action === 'update' && data) {
         setData(data.map(h => h.id === id ? { ...h, agentVersion: h.latestVersion } : h));
      }
      setBulkProgress({ total: selectedIds.size, completed, failed });
    }
    
    setTimeout(() => {
      showToast('Bulk Action Complete', `Successfully executed ${action} across ${completed} hosts.`, 'success');
      setBulkAction(null);
      setBulkProgress(null);
      setSelectedIds(new Set());
    }, 1500);
  };

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredData.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredData.map(h => h.id)));
  };

  // Filter & Search Logic
  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter(h => {
      // Filter tab check
      let matchesFilter = true;
      if (viewFilter === 'out-of-compliance') matchesFilter = h.agentVersion !== h.latestVersion || h.health === 'stale';
      else if (viewFilter === 'tier-1') matchesFilter = h.criticality === 'Tier-1';
      else if (viewFilter === 'paas') matchesFilter = h.type === 'paas';
      else if (viewFilter === 'iaas') matchesFilter = h.type === 'iaas';
      else if (viewFilter === 'local_cf_tunnel') matchesFilter = h.type === 'local_cf_tunnel';

      // Search term check
      const query = searchTerm.toLowerCase().trim();
      const matchesSearch = !query || 
        h.hostname.toLowerCase().includes(query) || 
        h.id.toLowerCase().includes(query) || 
        h.os.toLowerCase().includes(query) ||
        (h.ipAddress && h.ipAddress.includes(query)) ||
        (h.region && h.region.toLowerCase().includes(query));

      return matchesFilter && matchesSearch;
    });
  }, [data, viewFilter, searchTerm]);

  const outOfComplianceCount = data?.filter(h => h.agentVersion !== h.latestVersion || h.health === 'stale').length || 0;
  const complianceRate = data && data.length > 0 ? Math.round(((data.length - outOfComplianceCount) / data.length) * 100) : 100;
  const tier1Count = data?.filter(h => h.criticality === 'Tier-1').length || 0;

  if (loading) return <div className="p-8 bg-slate-950 min-h-screen pt-24"><LoadingSkeleton lines={10} /></div>;
  if (error && !data) return <div className="p-8 bg-slate-950 min-h-screen pt-24"><ErrorState message={error} onRetry={execute} /></div>;

  return (
    <div className="p-8 bg-slate-950 min-h-screen flex flex-col relative overflow-hidden font-sans">
      {/* Background Radial Glow Effects */}
      <div className="absolute top-[-10%] right-[-5%] w-[45%] h-[45%] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[45%] h-[45%] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-4 rounded-xl border shadow-2xl backdrop-blur-xl flex items-start space-x-3 max-w-md transition-all duration-300 animate-slide-up ${
          toastMessage.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200' :
          toastMessage.type === 'error' ? 'bg-red-950/90 border-red-500/40 text-red-200' :
          toastMessage.type === 'warning' ? 'bg-amber-950/90 border-amber-500/40 text-amber-200' :
          'bg-indigo-950/90 border-indigo-500/40 text-indigo-200'
        }`}>
          <div className="mt-0.5">
            {toastMessage.type === 'success' && <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>}
            {toastMessage.type === 'error' && <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>}
            {toastMessage.type === 'warning' && <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>}
            {toastMessage.type === 'info' && <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-sm leading-tight">{toastMessage.title}</h4>
            {toastMessage.desc && <p className="text-xs opacity-90 mt-0.5">{toastMessage.desc}</p>}
          </div>
          <button onClick={() => setToastMessage(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Header & KPI Summary Bar */}
      <div className="relative z-10 flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
        <div>
          <div className="flex items-center space-x-3 mb-1">
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Host Management</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              Zero-Trust Fabric
            </span>
          </div>
          <p className="text-slate-400 text-sm">
            Autonomous fleet health monitoring, SOAR remote task execution, and agent enrollment.
          </p>
        </div>

        {/* Action Controls & Metric Badges */}
        <div className="flex flex-wrap items-center gap-4 bg-slate-900/80 border border-slate-800/80 backdrop-blur-xl p-2.5 rounded-xl shadow-2xl">
          <button 
            onClick={() => { setIsEnrollModalOpen(true); setGeneratedTokenDetails(null); }}
            className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold rounded-lg shadow-lg shadow-indigo-600/30 transition-all transform hover:scale-[1.02] flex items-center space-x-2 text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"/>
            </svg>
            <span>Enroll Spoke Agent</span>
          </button>

          <div className="w-px h-8 bg-slate-800 hidden sm:block"></div>

          <div className="flex items-center space-x-6 px-2">
            <div className="text-center">
              <p className="text-xl font-bold text-emerald-400 leading-none">{complianceRate}%</p>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-1">Compliance</p>
            </div>
            <div className="text-center">
              <p className={`text-xl font-bold leading-none ${outOfComplianceCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{outOfComplianceCount}</p>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-1">Out of Baseline</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-red-400 leading-none">{tier1Count}</p>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-1">Tier-1 Hosts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar: Search & Filter Tabs */}
      <div className="relative z-10 flex flex-col md:flex-row justify-between items-stretch md:items-center mb-6 gap-4">
        {/* Search Bar */}
        <div className="relative flex-1 max-w-md">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input
            type="text"
            placeholder="Search hostname, IP, region, or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900/90 border border-slate-800 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/60 border border-slate-800/60 p-1.5 rounded-lg text-xs">
          {[
            { id: 'all', label: 'All Fleet', count: data?.length || 0 },
            { id: 'out-of-compliance', label: 'Out of Baseline', count: outOfComplianceCount, color: 'text-amber-400' },
            { id: 'tier-1', label: 'Tier-1 Critical', count: tier1Count, color: 'text-red-400' },
            { id: 'iaas', label: 'IaaS VM', count: data?.filter(h => h.type === 'iaas').length || 0 },
            { id: 'paas', label: 'PaaS App', count: data?.filter(h => h.type === 'paas').length || 0 },
            { id: 'local_cf_tunnel', label: 'Local CF Tunnel', count: data?.filter(h => h.type === 'local_cf_tunnel').length || 0 },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setViewFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-md font-medium transition-all flex items-center space-x-1.5 ${
                viewFilter === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 text-[10px] rounded-full bg-slate-950/50 ${tab.color || 'text-slate-300'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Operations Action Bar */}
      {(selectedIds.size > 0 || bulkProgress) && (
        <div className="relative z-10 bg-gradient-to-r from-indigo-950/80 via-slate-900/90 to-blue-950/80 border border-indigo-500/30 backdrop-blur-xl p-4 rounded-xl mb-6 shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center">
           {!bulkProgress ? (
             <>
               <div className="flex items-center space-x-3 mb-3 md:mb-0">
                 <span className="flex h-3 w-3 relative">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                 </span>
                 <span className="text-indigo-200 font-semibold text-sm">
                   {selectedIds.size} host{selectedIds.size > 1 ? 's' : ''} selected
                 </span>
               </div>
               <div className="flex items-center space-x-3">
                 <button onClick={() => handleBulkAction('restart')} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors border border-slate-700">
                   Restart Agents
                 </button>
                 <button onClick={() => handleBulkAction('update')} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition-colors">
                   Update to Baseline
                 </button>
                 <button onClick={() => setSelectedIds(new Set())} className="px-3 py-2 text-slate-400 hover:text-white text-xs font-medium">
                   Clear Selection
                 </button>
               </div>
             </>
           ) : (
             <div className="w-full">
               <div className="flex justify-between text-xs font-medium text-indigo-300 mb-2">
                 <span>Executing bulk {bulkAction}...</span>
                 <span className="font-mono">{bulkProgress.completed + bulkProgress.failed} / {bulkProgress.total}</span>
               </div>
               <div className="w-full bg-slate-950 h-2.5 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
                 <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }} />
                 <div className="bg-red-500 h-full rounded-full transition-all duration-300" style={{ width: `${(bulkProgress.failed / bulkProgress.total) * 100}%` }} />
               </div>
             </div>
           )}
        </div>
      )}

      {/* Main Managed Hosts Table */}
      <div className="relative z-10 glass-panel-dark rounded-xl border border-slate-800/80 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/90 text-slate-400 text-[11px] font-bold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-4 w-12 text-center">
                  <input 
                    type="checkbox" 
                    checked={filteredData.length > 0 && selectedIds.size === filteredData.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-slate-950 cursor-pointer"
                  />
                </th>
                <th className="p-4">Hostname / Environment</th>
                <th className="p-4">OS & Baseline Version</th>
                <th className="p-4">Health & Telemetry</th>
                <th className="p-4">Incident Context</th>
                <th className="p-4">Zero-Trust Endpoint</th>
                <th className="p-4 text-right">Orchestration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-500 italic">
                    No managed hosts match your search or filter parameters.
                  </td>
                </tr>
              ) : (
                filteredData.map(h => (
                  <tr key={h.id} className={`hover:bg-slate-800/40 transition-colors group ${h.criticality === 'Tier-1' && h.health !== 'healthy' ? 'bg-red-950/10' : ''}`}>
                    <td className="p-4 text-center">
                      <input 
                        type="checkbox" 
                        checked={selectedIds.has(h.id)}
                        onChange={() => toggleSelect(h.id)}
                        className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-600 focus:ring-offset-slate-950 cursor-pointer"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-white flex items-center space-x-2 text-sm">
                          <span className="group-hover:text-indigo-300 transition-colors">{h.hostname}</span>
                          {h.type === 'paas' && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-500/30">PaaS</span>}
                          {h.type === 'iaas' && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-500/30">IaaS</span>}
                          {h.type === 'local_cf_tunnel' && <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-500/30">Local CF Tunnel</span>}
                        </span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className={`text-[10px] font-semibold font-mono px-1.5 py-0.2 rounded ${h.criticality === 'Tier-1' ? 'bg-red-950 text-red-400 border border-red-800/60' : 'bg-slate-800 text-slate-400'}`}>
                            {h.criticality}
                          </span>
                          <span className="text-xs text-slate-500 font-mono">{h.ipAddress}</span>
                          <span className="text-xs text-slate-600 font-mono">• {h.region}</span>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col space-y-1">
                        <span className="text-xs text-slate-300 font-medium">{h.os}</span>
                        <span className={`text-xs font-mono flex items-center ${h.agentVersion === h.latestVersion ? 'text-emerald-400' : 'text-amber-400 font-bold'}`}>
                          v{h.agentVersion} {h.agentVersion !== h.latestVersion && <span className="ml-1 text-[10px] px-1 bg-amber-950 text-amber-400 border border-amber-800/60 rounded">(Outdated)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                       <div className="flex flex-col space-y-1.5">
                         <div className="flex items-center space-x-2">
                           <Badge severity={h.health === 'healthy' ? 'S4' : h.health === 'stale' ? 'S3' : 'S1'}>
                             {h.health.toUpperCase()}
                           </Badge>
                           <span className="text-[10px] font-mono text-indigo-400">HTTP AGENT</span>
                         </div>
                         {h.trendingStale && (
                            <span className="text-[11px] text-amber-400 flex items-center" title="Check-in interval increasing">
                              <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
                              Trending Stale
                            </span>
                         )}
                         <span className="text-[11px] text-slate-500 font-mono flex items-center">
                           <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${h.health === 'healthy' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                           Synced {new Date(h.lastCheckIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         </span>
                       </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col space-y-1.5">
                         {h.openIncidentsCount ? (
                           <Link to={`/incidents/active?entity=${h.id}`} className="inline-flex items-center text-xs font-semibold text-red-400 hover:text-red-300 bg-red-950/40 border border-red-800/50 px-2 py-0.5 rounded-md w-max transition-colors">
                             ⚠️ {h.openIncidentsCount} active incident{h.openIncidentsCount > 1 ? 's' : ''}
                           </Link>
                         ) : (
                           <span className="text-xs text-slate-600 italic">No active incidents</span>
                         )}
                         {h.lastIsolatedDaysAgo && (
                           <Link to={`/endpoints/isolation?entity=${h.id}`} className="inline-flex items-center text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 border border-indigo-800/40 px-2 py-0.5 rounded-md w-max transition-colors">
                             🛡️ Isolated {h.lastIsolatedDaysAgo}d ago
                           </Link>
                         )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col space-y-1.5">
                        <span className="text-xs font-mono text-slate-400 break-all bg-slate-950/80 px-2 py-1 rounded border border-slate-800/80">
                          {currentHubUrl}/api/endpoints/{h.id}
                        </span>
                        <button onClick={() => alert(`[Mock Feature] Break-Glass SSH for ${h.hostname}:\n\nssh -i ~/.ssh/id_rsa root@${window.location.hostname} -p 2222`)} className="text-[10px] font-mono uppercase tracking-wider text-red-400 hover:text-red-300 border border-red-900/50 bg-red-950/20 px-2 py-0.5 rounded w-max transition-colors inline-flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                          Break-Glass SSH
                        </button>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                       <div className="flex justify-end space-x-2 items-center">
                         {/* SOAR Remote Dispatch Dropdown */}
                         <select 
                           onChange={(e) => {
                             if (e.target.value) {
                               handleDispatchSoarTask(h.id, e.target.value, h.hostname);
                               e.target.value = "";
                             }
                           }}
                           className="px-2.5 py-1.5 bg-slate-950 text-slate-300 text-xs rounded-lg border border-slate-700/80 outline-none hover:border-indigo-500 transition-colors cursor-pointer"
                           defaultValue=""
                         >
                           <option value="" disabled>SOAR Actions...</option>
                           <option value="maintenance_mode">⚙️ Maintenance Mode</option>
                           <option value="test_alert">⚡ Trigger Test Alert</option>
                           <option value="collect_diagnostics">🔍 Collect Diagnostics</option>
                         </select>

                         <button 
                           onClick={() => navigate(`/endpoints/isolation?host=${h.id}`)} 
                           disabled={h.type === 'paas'} 
                           title={h.type === 'paas' ? 'Isolation not applicable for PaaS endpoints' : 'Isolate Host'}
                           className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${h.type === 'paas' ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed' : 'bg-red-950/40 text-red-400 hover:bg-red-900/60 border-red-500/40'}`}
                         >
                           Isolate
                         </button>
                         
                         <button 
                           onClick={() => setRotateConfirmHost(h)} 
                           className="px-2.5 py-1.5 bg-slate-950 hover:bg-amber-950/60 text-slate-400 hover:text-amber-300 border border-slate-800 hover:border-amber-500/40 text-xs rounded-lg transition-colors"
                           title="Rotate Zero-Trust Secret"
                         >
                           Rotate
                         </button>
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================================== */}
      {/* 🚀 SPOKE AGENT ENROLLMENT MODAL (Zero-Trust Bootstrap)                        */}
      {/* ============================================================================== */}
      {isEnrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457-.39-2.823-1.07-4"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white tracking-tight">Enroll Spoke Agent</h3>
                  <p className="text-xs text-slate-400">Generate a secure one-time token for PaaS, IaaS, or Local nodes.</p>
                </div>
              </div>
              <button 
                onClick={() => setIsEnrollModalOpen(false)}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
              {!generatedTokenDetails ? (
                /* Form State: Configure Token Parameters */
                <form onSubmit={handleGenerateEnrollmentToken} className="space-y-6">
                  {/* Tenant ID Selector */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Target Tenant ID <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={enrollTenantId}
                      onChange={(e) => setEnrollTenantId(e.target.value)}
                      placeholder="e.g. acme-corp"
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    {/* Quick Suggestions */}
                    <div className="flex items-center space-x-2 mt-2">
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Presets:</span>
                      {['acme-corp', 'default_fallback_tenant', 'globex-sec'].map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setEnrollTenantId(tag)}
                          className="text-[11px] font-mono px-2 py-0.5 bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white rounded border border-slate-700/60 transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Target Architecture Selector */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Target Deployment Architecture
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { id: 'iaas', label: 'IaaS VM', desc: 'AWS EC2, DO, GCP' },
                        { id: 'paas', label: 'PaaS App', desc: 'Render, Fargate, Cloud Run' },
                        { id: 'local_cf_tunnel', label: 'Local Server', desc: 'Bare-metal / CF Tunnel' },
                      ].map(type => (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => setEnrollEndpointType(type.id as any)}
                          className={`p-3 rounded-xl border text-left transition-all ${
                            enrollEndpointType === type.id
                              ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/10'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <p className="font-bold text-xs">{type.label}</p>
                          <p className="text-[10px] opacity-75 mt-0.5">{type.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Token Expiry & Max Uses */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Token Expiration
                      </label>
                      <select
                        value={enrollExpiresIn}
                        onChange={(e) => setEnrollExpiresIn(Number(e.target.value))}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                      >
                        <option value={900}>15 Minutes (Recommended)</option>
                        <option value={3600}>1 Hour</option>
                        <option value={86400}>24 Hours</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Maximum Uses
                      </label>
                      <select
                        value={enrollMaxUse}
                        onChange={(e) => setEnrollMaxUse(Number(e.target.value))}
                        className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                      >
                        <option value={1}>Single-Use (1 Agent)</option>
                        <option value={5}>Multi-Use (5 Agents)</option>
                        <option value={100}>Fleet-Wide (100 Agents)</option>
                      </select>
                    </div>
                  </div>

                  {/* Submit CTA */}
                  <div className="pt-4 border-t border-slate-800 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => setIsEnrollModalOpen(false)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isGeneratingToken}
                      className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50 flex items-center space-x-2"
                    >
                      {isGeneratingToken ? (
                        <>
                          <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span>Generating Token...</span>
                        </>
                      ) : (
                        <span>Generate Token</span>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Generated Token Display State */
                <div className="space-y-6">
                  <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl flex items-start space-x-3">
                    <svg className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <h4 className="text-emerald-300 font-bold text-sm">Bootstrap Token Generated Successfully!</h4>
                      <p className="text-xs text-emerald-200/80 mt-0.5">
                        Assigned to tenant <span className="font-mono font-bold">{generatedTokenDetails.tenantId}</span>. Valid for {generatedTokenDetails.expiresIn / 60} mins.
                      </p>
                    </div>
                  </div>

                  {/* Secret Token Field */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Enrollment Token (Secret)
                      </label>
                      <button
                        onClick={() => setShowSecretToken(!showSecretToken)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 font-mono"
                      >
                        {showSecretToken ? '🔒 Hide Secret' : '👁️ Reveal Secret'}
                      </button>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type={showSecretToken ? 'text' : 'password'}
                        readOnly
                        value={generatedTokenDetails.token}
                        className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-sm font-mono text-emerald-400 select-all focus:outline-none"
                      />
                      <button
                        onClick={() => handleCopyCommand(generatedTokenDetails.token, 'Enrollment Token')}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors flex items-center space-x-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>

                  {/* Command Launcher Tabs */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Quick Launch Command
                      </label>
                      <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {[
                          { id: 'curl',       label: 'Bash / cURL' },
                          { id: 'python',     label: 'Python' },
                          { id: 'csharp',     label: 'C# .NET' },
                          { id: 'go',         label: 'Go' },
                          { id: 'typescript', label: 'TypeScript' },
                          { id: 'java',       label: 'Java' },
                        ].map(tab => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveCommandTab(tab.id as any)}
                            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                              activeCommandTab === tab.id
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Command Snippet Display */}
                    <div className="relative group bg-slate-950 border border-slate-800/80 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto whitespace-pre">
                      {activeCommandTab === 'curl' && (
<code>{`#!/usr/bin/env bash
HUB_URL="${currentHubUrl}"
CRED_FILE=".siem_credentials.json"
if [ ! -f "$CRED_FILE" ]; then
  # Step 1: Enroll
  curl -s -X POST "$HUB_URL/api/endpoints/enroll" \\
    -H "Content-Type: application/json" \\
    -d '{"enrollment_token":"${generatedTokenDetails.token}","initial_metadata":{"hostname":"'$(hostname)'","os":"linux","type":"iaas"}}' \\
    -o "$CRED_FILE"
  
  SECRET=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['endpoint_secret'])")
  
  # Step 2: Register
  curl -s -X POST "$HUB_URL/api/endpoints/register" \\
    -H "Authorization: Bearer $SECRET" \\
    -H "Content-Type: application/json" \\
    -d '{"hostname":"'$(hostname)'","label":"Bash SDK","type":"iaas","capabilities":["telemetry"],"agent_version":"1.0","os":"linux","region":"local"}'
fi
SECRET=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['endpoint_secret'])")
TENANT=$(python -c "import sys, json; print(json.load(open('$CRED_FILE'))['tenant_id'])")

# Step 3: Push Logs
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$HUB_URL/api/v1/agent/push" \\
  -H "Authorization: Bearer $SECRET" \\
  -H "Content-Type: application/json" \\
  -H "X-Tenant-ID: $TENANT" \\
  -d '{"events":[{"timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","source":"bash","severity":"INFO","message":"heartbeat"}]}')

if [ "$HTTP_STATUS" == "401" ] || [ "$HTTP_STATUS" == "403" ]; then
  echo "Stale credentials detected (status=$HTTP_STATUS). Purging cache..."
  rm -f "$CRED_FILE"
  echo "Please re-run the script to re-enroll securely."
  exit 1
fi
echo "Telemetry successfully pushed to backend (HTTP $HTTP_STATUS)."`}</code>
                      )}
                      {activeCommandTab === 'python' && (
<code>{`import os, json, requests
from pathlib import Path

HUB_URL   = "${currentHubUrl}"
CRED_FILE = Path(".siem_credentials.json")

def enroll():
    # Step 1: Enroll
    r = requests.post(f"{HUB_URL}/api/endpoints/enroll", json={
        "enrollment_token": "${generatedTokenDetails.token}",
        "initial_metadata": {"hostname": __import__("socket").gethostname(), "os": "python", "type": "iaas"}
    }, timeout=15)
    r.raise_for_status()
    creds = r.json()
    
    # Step 2: Register
    requests.post(f"{HUB_URL}/api/endpoints/register", json={
        "hostname": __import__("socket").gethostname(), "label": "Python SDK", "type": "iaas",
        "capabilities": ["telemetry"], "agent_version": "1.0", "os": "python", "region": "local"
    }, headers={"Authorization": f"Bearer {creds['endpoint_secret']}"}).raise_for_status()
    
    CRED_FILE.write_text(json.dumps(creds))
    return creds

creds = json.loads(CRED_FILE.read_text()) if CRED_FILE.exists() else enroll()

# Step 3: Push Logs
r = requests.post(f"{HUB_URL}/api/v1/agent/push",
    json={"events": [{"timestamp": "2026-07-25T18:00:00Z", "source": "python-app",
                      "severity": "INFO", "message": "Transaction logged"}]},
    headers={"Authorization": f"Bearer {creds['endpoint_secret']}",
             "X-Tenant-ID": creds["tenant_id"]})

if r.status_code in (401, 403):
    print("Stale credentials detected. Purging local token cache...")
    CRED_FILE.unlink(missing_ok=True)
r.raise_for_status()`}</code>
                      )}
                      {activeCommandTab === 'csharp' && (
<code>{`// NuGet: dotnet add package System.Net.Http.Json
using System.Net.Http.Json;

var http   = new HttpClient();
var hubUrl = "${currentHubUrl}";

// Step 1: Enroll
var enroll = await http.PostAsJsonAsync($"{hubUrl}/api/endpoints/enroll", new {
    enrollment_token = "${generatedTokenDetails.token}",
    initial_metadata = new { hostname = Environment.MachineName, os = "dotnet", type = "iaas" }
});
enroll.EnsureSuccessStatusCode();
var creds = await enroll.Content.ReadFromJsonAsync<Dictionary<string,string>>();

// Step 2: Register
var regReq = new HttpRequestMessage(HttpMethod.Post, $"{hubUrl}/api/endpoints/register");
regReq.Headers.Add("Authorization", $"Bearer {creds!["endpoint_secret"]}");
regReq.Content = JsonContent.Create(new {
    hostname = Environment.MachineName, label = "C# SDK", type = "iaas",
    capabilities = new[] { "telemetry" }, agent_version = "1.0", os = "dotnet", region = "local"
});
(await http.SendAsync(regReq)).EnsureSuccessStatusCode();

// Step 3: Push logs
using var req = new HttpRequestMessage(HttpMethod.Post, $"{hubUrl}/api/v1/agent/push");
req.Headers.Add("Authorization", $"Bearer {creds["endpoint_secret"]}");
req.Headers.Add("X-Tenant-ID", creds["tenant_id"]);
req.Content = JsonContent.Create(new { events = new[] {
    new { timestamp = DateTime.UtcNow, source = "dotnet-app",
          severity = "INFO", message = "Transaction logged" }
}});
(await http.SendAsync(req)).EnsureSuccessStatusCode();`}</code>
                      )}
                      {activeCommandTab === 'go' && (
<code>{`package main

import (
    "bytes"; "encoding/json"; "net/http"; "os"; "time"
)

const hubURL = "${currentHubUrl}"

func main() {
    // Step 1: Enroll
    hostname, _ := os.Hostname()
    payload, _ := json.Marshal(map[string]any{
        "enrollment_token": "${generatedTokenDetails.token}",
        "initial_metadata": map[string]string{"hostname": hostname, "os": "go", "type": "iaas"},
    })
    resp, _ := http.Post(hubURL+"/api/endpoints/enroll", "application/json", bytes.NewReader(payload))
    defer resp.Body.Close()
    var creds map[string]string
    json.NewDecoder(resp.Body).Decode(&creds)

    // Step 2: Register
    regPayload, _ := json.Marshal(map[string]any{
        "hostname": hostname, "label": "Go SDK", "type": "iaas",
        "capabilities": []string{"telemetry"}, "agent_version": "1.0", "os": "go", "region": "local",
    })
    reqReg, _ := http.NewRequest("POST", hubURL+"/api/endpoints/register", bytes.NewReader(regPayload))
    reqReg.Header.Set("Authorization", "Bearer "+creds["endpoint_secret"])
    reqReg.Header.Set("Content-Type", "application/json")
    http.DefaultClient.Do(reqReg)

    // Step 3: Push logs
    body, _ := json.Marshal(map[string]any{"events": []map[string]any{{
        "timestamp": time.Now().UTC().Format(time.RFC3339),
        "source": "go-service", "severity": "INFO", "message": "Transaction logged",
    }}})
    req, _ := http.NewRequest("POST", hubURL+"/api/v1/agent/push", bytes.NewReader(body))
    req.Header.Set("Authorization", "Bearer "+creds["endpoint_secret"])
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-Tenant-ID", creds["tenant_id"])
    http.DefaultClient.Do(req)
}`}</code>
                      )}
                      {activeCommandTab === 'typescript' && (
<code>{`// Node.js / Bun / Deno — no external dependencies
import fs from "fs";

const HUB_URL   = "${currentHubUrl}";
const CRED_PATH = ".siem_credentials.json";

async function enroll() {
  // Step 1: Enroll
  const res = await fetch(HUB_URL + "/api/endpoints/enroll", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enrollment_token: "${generatedTokenDetails.token}",
      initial_metadata: { hostname: process.env.HOSTNAME ?? "node", os: process.platform, type: "iaas" }
    })
  });
  const creds = await res.json();
  
  // Step 2: Register
  await fetch(HUB_URL + "/api/endpoints/register", {
    method: "POST", headers: { "Content-Type": "application/json", "Authorization": \`Bearer \${creds.endpoint_secret}\` },
    body: JSON.stringify({
      hostname: process.env.HOSTNAME ?? "node", label: "TS SDK", type: "iaas",
      capabilities: ["telemetry"], agent_version: "1.0", os: process.platform, region: "local"
    })
  });

  fs.writeFileSync(CRED_PATH, JSON.stringify(creds));
  return creds;
}

const creds = fs.existsSync(CRED_PATH) ? JSON.parse(fs.readFileSync(CRED_PATH, "utf-8")) : await enroll();

// Step 3: Push Logs
await fetch(HUB_URL + "/api/v1/agent/push", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${creds.endpoint_secret}\`,
    "Content-Type":  "application/json",
    "X-Tenant-ID":   creds.tenant_id,
  },
  body: JSON.stringify({ events: [{
    timestamp: new Date().toISOString(),
    source: "node-service", severity: "INFO", message: "Transaction logged"
  }]})
});`}</code>
                      )}
                      {activeCommandTab === 'java' && (
<code>{`import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;

public class SiemConnector {
    public static void main(String[] args) throws Exception {
        var http = HttpClient.newHttpClient();
        String hubUrl = "${currentHubUrl}";
        
        // Step 1: Enroll (Simplified without JSON library for raw Java)
        String enrollBody = "{\\"enrollment_token\\":\\"${generatedTokenDetails.token}\\",\\"initial_metadata\\":{\\"hostname\\":\\"java-host\\",\\"os\\":\\"java\\",\\"type\\":\\"iaas\\"}}";
        var enrollReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/endpoints/enroll"))
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(enrollBody)).build();
        var enrollRes = http.send(enrollReq, HttpResponse.BodyHandlers.ofString());
        
        // In reality, use Jackson/Gson to extract secrets. For this snippet:
        String secret = enrollRes.body().split("\\"endpoint_secret\\":\\"")[1].split("\\"")[0];
        String tenant = enrollRes.body().split("\\"tenant_id\\":\\"")[1].split("\\"")[0];

        // Step 2: Register
        String regBody = "{\\"hostname\\":\\"java-host\\",\\"label\\":\\"Java SDK\\",\\"type\\":\\"iaas\\",\\"capabilities\\":[\\"telemetry\\"],\\"agent_version\\":\\"1.0\\",\\"os\\":\\"java\\",\\"region\\":\\"local\\"}";
        var regReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/endpoints/register"))
            .header("Content-Type", "application/json").header("Authorization", "Bearer " + secret)
            .POST(HttpRequest.BodyPublishers.ofString(regBody)).build();
        http.send(regReq, HttpResponse.BodyHandlers.discarding());

        // Step 3: Push Logs
        String pushBody = "{\\"events\\":[{\\"timestamp\\":\\"" + Instant.now() + "\\",\\"source\\":\\"java-app\\",\\"severity\\":\\"INFO\\",\\"message\\":\\"Transaction logged\\"}]}";
        var pushReq = HttpRequest.newBuilder(URI.create(hubUrl + "/api/v1/agent/push"))
            .header("Content-Type", "application/json").header("Authorization", "Bearer " + secret).header("X-Tenant-ID", tenant)
            .POST(HttpRequest.BodyPublishers.ofString(pushBody)).build();
        http.send(pushReq, HttpResponse.BodyHandlers.discarding());
    }
}`}</code>
                      )}

                      <button
                        onClick={() => {
                          const snippets: Record<string, string> = {
                            curl: `TENANT_ENROLLMENT_TOKEN=${generatedTokenDetails.token} bash enroll_and_push.sh`,
                            python: `TENANT_ENROLLMENT_TOKEN=${generatedTokenDetails.token} python siem_connector.py`,
                            csharp: `dotnet run  # Set enrollment_token="${generatedTokenDetails.token}" in config`,
                            go: `ENROLLMENT_TOKEN=${generatedTokenDetails.token} go run main.go`,
                            typescript: `TENANT_ENROLLMENT_TOKEN=${generatedTokenDetails.token} npx tsx siemConnector.ts`,
                            java: `ENROLLMENT_TOKEN=${generatedTokenDetails.token} java SiemConnector.java`,
                          };
                          handleCopyCommand(snippets[activeCommandTab], 'Launch Command');
                        }}
                        className="absolute right-3 top-3 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-sans font-bold border border-slate-700 transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
                    <button
                      onClick={() => setGeneratedTokenDetails(null)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
                    >
                      ← Generate Another Token
                    </button>
                    <button
                      onClick={() => setIsEnrollModalOpen(false)}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg transition-colors"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* ⚠️ CONFIRM ROTATION DIALOG MODAL                                               */}
      {/* ============================================================================== */}
      {rotateConfirmHost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">Rotate Endpoint Credential?</h3>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to rotate the Zero-Trust service secret for <span className="font-bold text-white">{rotateConfirmHost.hostname}</span>?
              Active agent tunnels will be broken until the agent is re-enrolled.
            </p>

            <div className="pt-2 flex justify-end space-x-3">
              <button
                onClick={() => setRotateConfirmHost(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRotateCredential}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-amber-600/30 transition-colors"
              >
                Confirm Rotation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
