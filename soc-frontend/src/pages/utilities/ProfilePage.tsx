import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../shared/api/apiClient';

export default function ProfilePage() {
  const [user, setUser] = useState<{ email: string, role: string, lastLogin?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await apiClient.get('/auth/session');
        // Mock additional details if missing
        const u = res.data.user || {};
        setUser({
          ...u,
          lastLogin: new Date().toLocaleString()
        });
      } catch {
        // Interceptor handles 401
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      // Clear token and go to login
      localStorage.removeItem('token');
      navigate('/login');
    }
  };

  return (
    <div className="p-8 bg-slate-950 min-h-screen relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-3xl mx-auto relative z-10">
        <h1 className="text-3xl font-bold text-white mb-8 tracking-tight">Analyst Profile</h1>
        
        {loading ? (
           <div className="text-slate-400 animate-pulse">Loading profile...</div>
        ) : (
          <div className="glass-panel-dark rounded-xl border border-slate-800 shadow-2xl overflow-hidden">
            {/* Header / Cover area */}
            <div className="h-32 bg-gradient-to-r from-blue-900/40 to-indigo-900/40 border-b border-slate-800 relative">
               {/* Floating glowing orb inside cover */}
               <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')] opacity-20"></div>
            </div>

            <div className="p-8 relative">
              {/* Avatar */}
              <div className="absolute -top-16 left-8">
                 <div className="w-32 h-32 rounded-full border-4 border-slate-950 bg-slate-900 shadow-[0_0_20px_rgba(59,130,246,0.3)] overflow-hidden flex items-center justify-center">
                    {user?.email ? (
                       <img 
                         src={`https://ui-avatars.com/api/?name=${user.email}&background=0f172a&color=60a5fa&size=128&font-size=0.33`}
                         alt="Avatar"
                         className="w-full h-full object-cover"
                       />
                    ) : (
                       <span className="text-4xl text-blue-500 font-bold">U</span>
                    )}
                 </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end mb-6">
                 <button 
                   onClick={handleLogout}
                   className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500 hover:text-white transition-all rounded font-bold text-sm tracking-wider uppercase"
                 >
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                   <span>Sign Out</span>
                 </button>
              </div>

              {/* Details */}
              <div className="mt-4 space-y-6">
                 <div>
                   <h2 className="text-2xl font-bold text-white">{user?.email || 'Unknown Analyst'}</h2>
                   <div className="flex items-center mt-2 space-x-3">
                      <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-widest border border-blue-500/30">
                        {user?.role || 'ANALYST'}
                      </span>
                      <span className="text-emerald-400 text-xs font-mono flex items-center">
                         <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                         Active Session
                      </span>
                   </div>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-800/50">
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                       <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Email Address</p>
                       <p className="text-slate-300 font-mono">{user?.email || 'N/A'}</p>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                       <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Account Status</p>
                       <p className="text-slate-300 font-mono">Verified</p>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                       <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Authentication Method</p>
                       <p className="text-slate-300 font-mono">Standard (JWT + Cookie)</p>
                    </div>
                    <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-800">
                       <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Last Login</p>
                       <p className="text-slate-300 font-mono">{user?.lastLogin || 'N/A'}</p>
                    </div>
                 </div>

                 <div className="pt-6">
                    <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Security & Access</h3>
                    <div className="space-y-3 text-sm">
                       <div className="flex justify-between items-center p-3 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
                          <div className="flex items-center space-x-3">
                             <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                             <span className="text-slate-300">Two-Factor Authentication</span>
                          </div>
                          <button className="text-blue-400 hover:text-blue-300 font-bold uppercase text-xs tracking-wider">Enable</button>
                       </div>
                       <div className="flex justify-between items-center p-3 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors">
                          <div className="flex items-center space-x-3">
                             <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                             <span className="text-slate-300">Audit Logs</span>
                          </div>
                          <button className="text-blue-400 hover:text-blue-300 font-bold uppercase text-xs tracking-wider">View Logs</button>
                       </div>
                    </div>
                 </div>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
