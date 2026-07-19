import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '../../shared/api/apiClient';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch (err) {
      console.error(err);
    } finally {
      navigate('/login');
    }
  };

  const navItems = [
    { label: 'Command Center', path: '/' },
    { label: 'Playbooks', path: '/playbooks' },
    { label: 'Endpoints', path: '/endpoints/hosts' },
    { label: 'Assets', path: '/assets/inventory' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <>
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen fixed left-0 top-0">
        <div className="p-4 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white tracking-wider">AGENTIC SOC</h1>
        </div>
        
        <div className="p-4">
          <button 
            onClick={() => setSearchOpen(true)}
            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 text-sm py-2 px-3 rounded flex items-center justify-between transition-colors"
          >
            <span>Search...</span>
            <span className="text-xs bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">Cmd K</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {navItems.map(item => {
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${isActive ? 'bg-blue-600/20 text-blue-400 font-medium' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                A
              </div>
              <div className="text-sm">
                <p className="text-white font-medium">Analyst</p>
                <p className="text-slate-500 text-xs">Tier 2</p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-slate-500 hover:text-red-400 transition-colors" title="Logout">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </div>

      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/60 backdrop-blur-sm" onClick={() => setSearchOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <input 
              type="text" 
              autoFocus
              placeholder="Search across pages, alerts, and assets..."
              className="w-full bg-transparent text-white p-4 border-b border-slate-800 focus:outline-none text-lg"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <div className="p-4 text-center text-slate-500">
              {searchQuery ? `Searching for "${searchQuery}"... (API not connected)` : 'Type to start searching...'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
