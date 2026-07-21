import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/shared/config/routes';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isQuerying, setIsQuerying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Default commands shown when query is empty
  const defaultCommands: CommandItem[] = [
    { id: 'c1', label: 'Go to Playbooks', icon: '⚡', shortcut: 'G P', action: () => { navigate('/playbooks'); onClose(); } },
    { id: 'c2', label: 'View Active Incidents', icon: '🚨', shortcut: 'G I', action: () => { navigate(ROUTES.incidents.active); onClose(); } },
    { id: 'c3', label: 'Asset Inventory', icon: '💻', shortcut: 'G A', action: () => { navigate(ROUTES.assets.inventory); onClose(); } },
    { id: 'c4', label: 'Threat Feeds', icon: '🛡️', shortcut: 'G T', action: () => { navigate(ROUTES.detection.feeds); onClose(); } },
    { id: 'c5', label: 'System Settings', icon: '⚙️', shortcut: 'G S', action: () => { navigate(ROUTES.settings); onClose(); } },
  ];

  // Mock search results when typing
  const searchResults: CommandItem[] = [
    { id: 's1', label: `Search AI Index for "${query}"`, icon: '🧠', action: () => { onClose(); } },
    { id: 's2', label: `Filter Alerts by "${query}"`, icon: '🔍', action: () => { navigate(ROUTES.incidents.active); onClose(); } },
  ];

  const displayedItems = query ? searchResults : defaultCommands;

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    // Reset active index when query changes
    setActiveIndex(0);
    if (query) {
      setIsQuerying(true);
      const timer = setTimeout(() => setIsQuerying(false), 600);
      return () => clearTimeout(timer);
    }
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => (prev + 1) % displayedItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => (prev - 1 + displayedItems.length) % displayedItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        displayedItems[activeIndex]?.action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, displayedItems, activeIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-md transition-opacity animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-slate-900/95 glass-panel-dark border border-slate-700/50 shadow-[0_30px_100px_-15px_rgba(0,0,0,0.8),0_0_50px_rgba(59,130,246,0.15)] flex flex-col"
        role="dialog" 
        aria-modal="true"
      >
        {/* Header / Input */}
        <div className="flex items-center px-4 py-4 border-b border-slate-800/80">
          <span className="text-slate-500 text-xl mr-3">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search alerts, assets, playbooks... or type a command"
            className="flex-1 bg-transparent border-none text-slate-200 text-lg font-sans focus:outline-none focus:ring-0 placeholder-slate-600"
            aria-label="Command Palette Search"
          />
          <div className="flex items-center space-x-2 ml-4">
            <kbd className="hidden sm:inline-flex items-center justify-center rounded border border-slate-700 bg-slate-800/50 px-2 text-xs font-medium text-slate-400">ESC</kbd>
          </div>
        </div>

        {/* Content Area */}
        <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
          {isQuerying ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <div className="w-6 h-6 border-2 border-blue-500/50 border-t-blue-400 rounded-full animate-spin mb-4" />
              <span className="text-sm font-medium animate-pulse">Analyzing intent via Semantic Index...</span>
            </div>
          ) : (
            <div className="flex flex-col space-y-1">
              {displayedItems.length === 0 ? (
                <div className="py-10 text-center text-slate-500 text-sm">
                  No results found for "{query}"
                </div>
              ) : (
                <>
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {query ? 'Search Results' : 'Suggested Actions'}
                  </div>
                  {displayedItems.map((item, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <button
                        key={item.id}
                        onClick={() => item.action()}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-100 ${isActive ? 'bg-blue-600/20 text-blue-100' : 'text-slate-300 hover:bg-slate-800/50 hover:text-slate-200'}`}
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-lg">{item.icon}</span>
                          <span className={`font-medium ${isActive ? 'text-blue-100' : 'text-slate-300'}`}>{item.label}</span>
                        </div>
                        {item.shortcut && (
                          <div className="flex space-x-1">
                            {item.shortcut.split(' ').map((key, i) => (
                              <kbd key={i} className={`inline-flex items-center justify-center rounded border ${isActive ? 'border-blue-500/30 bg-blue-500/20 text-blue-300' : 'border-slate-700 bg-slate-800/50 text-slate-500'} px-1.5 py-0.5 text-[10px] font-medium uppercase`}>
                                {key}
                              </kbd>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-t border-slate-800/80 text-xs text-slate-500">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5">
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-sans font-medium text-[10px]">↑</kbd>
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-sans font-medium text-[10px]">↓</kbd>
              <span>to navigate</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-sans font-medium text-[10px]">↵</kbd>
              <span>to select</span>
            </div>
          </div>
          <div>
            <span className="text-slate-600">SOC OS v2.4</span>
          </div>
        </div>
      </div>
    </div>
  );
};
