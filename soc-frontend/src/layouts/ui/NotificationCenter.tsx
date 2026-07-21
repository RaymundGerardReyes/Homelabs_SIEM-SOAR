import React from 'react';
import { NotificationItem } from '@/types';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  loading: boolean;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ isOpen, onClose, notifications, loading }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed bottom-6 left-[270px] w-96 max-h-[80vh] flex flex-col bg-slate-900/95 glass-panel-dark border border-slate-700/60 rounded-2xl z-[9999] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7),0_0_30px_rgba(59,130,246,0.1)] overflow-hidden animate-in fade-in slide-in-from-bottom-8 duration-300"
      role="dialog" 
      aria-label="Notification Center"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <h3 className="text-slate-100 font-bold tracking-wide text-sm">Notifications</h3>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="text-[10px] font-bold text-blue-400">LIVE</span>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors p-1"
          aria-label="Close notifications"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      {/* Toolbar */}
      <div className="px-5 py-2 bg-slate-900/50 border-b border-slate-800/50 flex justify-between items-center">
        <span className="text-xs font-medium text-slate-500">{notifications.length} Unread</span>
        <button className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors">
          Mark all as read
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {loading ? (
          <div className="p-8 flex flex-col items-center justify-center space-y-4">
            <div className="w-6 h-6 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
            <span className="text-xs text-slate-500 font-medium tracking-wide uppercase">Syncing Streams...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
              <span className="text-2xl">✨</span>
            </div>
            <h4 className="text-sm font-medium text-slate-300 mb-1">All caught up!</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              No new alerts or critical events detected in your environment.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {notifications.map(n => {
              const isCrit = n.severity === 'critical';
              const isWarn = n.severity === 'warning';
              
              return (
                <div 
                  key={n.id} 
                  className="group relative p-4 border-b border-slate-800/40 hover:bg-slate-800/60 transition-all cursor-pointer flex items-start space-x-4"
                >
                  {/* Read indicator / Severity Line */}
                  <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${
                    isCrit ? 'bg-red-500' : isWarn ? 'bg-yellow-500' : 'bg-blue-500'
                  } opacity-0 group-hover:opacity-100 transition-opacity`} />

                  {/* Icon */}
                  <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    isCrit ? 'bg-red-500/10 text-red-400' : isWarn ? 'bg-yellow-500/10 text-yellow-400' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {isCrit ? '🔥' : isWarn ? '⚠️' : 'ℹ️'}
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-xs font-bold uppercase tracking-wider ${
                        isCrit ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-blue-400'
                      }`}>
                        {n.severity}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-sm font-medium leading-snug ${
                      isCrit ? 'text-red-100' : isWarn ? 'text-yellow-100' : 'text-slate-200'
                    }`}>
                      {n.message}
                    </p>
                    
                    {/* Hover Actions */}
                    <div className="mt-3 flex space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="text-xs font-medium text-slate-400 hover:text-white transition-colors">
                        View Details
                      </button>
                      <button className="text-xs font-medium text-slate-400 hover:text-white transition-colors">
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
