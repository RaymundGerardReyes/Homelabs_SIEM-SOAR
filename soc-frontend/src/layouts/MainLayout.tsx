import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './ui/Sidebar';
import { LoadingSkeleton } from '../shared/ui';

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="flex w-full h-screen overflow-hidden bg-slate-950 text-slate-300 relative">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — drawer on mobile (< md), persistent flex sidebar on desktop (>= md) */}
      <div
        className={`
          fixed md:relative inset-y-0 left-0 z-50
          transform transition-transform duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:flex md:flex-shrink-0
        `}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full">
        {/* Mobile header bar with hamburger */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur md:hidden z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-slate-300 hover:text-white p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 transition-colors"
              aria-label="Open navigation menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="text-white font-bold text-sm tracking-wide flex items-center gap-1.5">
              <span className="text-indigo-500">◆</span> CORTEX CLONE
            </span>
          </div>
          <span className="text-[10px] font-mono uppercase bg-indigo-950/60 text-indigo-400 border border-indigo-800/50 px-2 py-0.5 rounded">
            SOC CORE
          </span>
        </div>

        {/* Scrollable Viewport Outlet */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <Suspense fallback={<div className="p-4 sm:p-8 pt-16 sm:pt-24"><LoadingSkeleton lines={10} /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
