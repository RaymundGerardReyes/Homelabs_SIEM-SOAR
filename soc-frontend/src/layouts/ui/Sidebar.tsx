import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '@/shared/hooks/useAuthApi';
import { NotificationItem } from '@/types';
import { NAV_GROUPS } from '@/shared/config/navigation';
import { ROUTES } from '@/shared/config/routes';

interface SidebarProps {
  currentView: 'investigation' | 'playbooks';
  setCurrentView: (view: 'investigation' | 'playbooks') => void;
  resetAlertSelection: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setCurrentView, resetAlertSelection }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggleMenu = (menuName: string) => {
    setExpandedMenus(prev => ({ ...prev, [menuName]: !prev[menuName] }));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowSearch(false); setShowNotifs(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  const openNotifications = async () => {
    setShowNotifs(v => !v);
    if (!showNotifs) {
      setNotifsLoading(true);
      try {
        const res = await apiClient.get<NotificationItem[]>('/data/notifications');
        setNotifications(res.data);
      } catch {
        setNotifications([{
          id: 'err', message: 'Could not load notifications.', severity: 'info',
          timestamp: new Date().toISOString(), read: true,
        }]);
      } finally {
        setNotifsLoading(false);
      }
    }
  };

  const navToPath = (path: string) => {
    navigate(path);
    resetAlertSelection();
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="sidebar glass-panel-dark" role="navigation" aria-label="Main navigation">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon pulse-glow">◆</span>
          <span className="logo-text">CORTEX CLONE</span>
        </div>
      </div>

      <div className="sidebar-nav">
        <div
          className={`nav-item ${currentView === 'investigation' ? 'active glow-border' : ''}`}
          onClick={() => { setCurrentView('investigation'); resetAlertSelection(); }}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { setCurrentView('investigation'); resetAlertSelection(); } }}
          aria-current={currentView === 'investigation' ? 'page' : undefined}
        >
          <div className="nav-item-left"><div className="nav-icon cmd-icon" /> Command Center</div>
        </div>

        <div
          className={`nav-item ${currentView === 'playbooks' ? 'active glow-border' : ''}`}
          onClick={() => setCurrentView('playbooks')}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setCurrentView('playbooks'); }}
          aria-current={currentView === 'playbooks' ? 'page' : undefined}
        >
          <div className="nav-item-left"><div className="nav-icon pb-icon" /> Playbook Sandbox</div>
        </div>

        {NAV_GROUPS.map(({ label: menuName, items }) => {
          const isOpen = expandedMenus[menuName];
          const anyChildActive = items.some(i => isActive(i.path));
          return (
            <div key={menuName} className="nav-group">
              <div
                className={`nav-item ${anyChildActive ? 'active glow-border' : ''}`}
                onClick={() => toggleMenu(menuName)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleMenu(menuName); }}
                aria-expanded={isOpen}
              >
                <div className="nav-item-left"><div className="nav-icon" /> {menuName}</div>
                <div className={`nav-arrow ${isOpen ? 'open' : ''}`} aria-hidden="true">▼</div>
              </div>
              {isOpen && (
                <div className="sub-menu slide-down" role="group" aria-label={menuName}>
                  {items.map(item => (
                    <div
                      key={item.path}
                      className={`sub-menu-item hover-lift ${isActive(item.path) ? 'active' : ''}`}
                      onClick={() => navToPath(item.path)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navToPath(item.path); }}
                      aria-current={isActive(item.path) ? 'page' : undefined}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div
          className="nav-item"
          onClick={() => navToPath(ROUTES.marketplace)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navToPath(ROUTES.marketplace); }}
          aria-current={isActive(ROUTES.marketplace) ? 'page' : undefined}
        >
          <div className="nav-item-left"><div className="nav-icon" /> Marketplace</div>
        </div>
      </div>

      {showSearch && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(15,23,42,0.97)', border: '1px solid #334155', borderRadius: '12px',
          padding: '1.25rem', width: '480px', zIndex: 9999, boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
        }} role="dialog" aria-label="Global Search">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search alerts, playbooks, assets…"
            style={{
              width: '100%', background: '#1e293b', border: '1px solid #475569', borderRadius: '8px',
              padding: '10px 14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '14px',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ color: '#64748b', fontSize: '12px', marginTop: '8px', fontFamily: 'monospace' }}>
            {searchQuery ? `Searching for "${searchQuery}"… (backend integration pending)` : 'Type to search the platform.'}
          </div>
          <button onClick={() => setShowSearch(false)} style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px' }}>
            ESC to close
          </button>
        </div>
      )}

      {showNotifs && (
        <div style={{
          position: 'fixed', bottom: '80px', left: '220px', width: '320px',
          background: 'rgba(15,23,42,0.97)', border: '1px solid #334155', borderRadius: '10px',
          zIndex: 9999, boxShadow: '0 16px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
        }} role="dialog" aria-label="Notifications">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', color: '#e2e8f0', fontFamily: 'monospace', fontWeight: 700 }}>
            Notifications
          </div>
          {notifsLoading ? (
            <div style={{ padding: '1rem', color: '#64748b', fontFamily: 'monospace', fontSize: '13px' }}>Loading…</div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '1rem', color: '#64748b', fontFamily: 'monospace', fontSize: '13px' }}>No new notifications.</div>
          ) : (
            notifications.map(n => (
              <div key={n.id} style={{
                padding: '10px 16px', borderBottom: '1px solid #1e293b', fontFamily: 'monospace', fontSize: '12px',
                color: n.severity === 'critical' ? '#f87171' : n.severity === 'warning' ? '#fbbf24' : '#94a3b8',
              }}>
                {n.message}
                <div style={{ color: '#334155', fontSize: '10px', marginTop: '4px' }}>{new Date(n.timestamp).toLocaleTimeString()}</div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="sidebar-footer glass-panel-dark">
        <div
          className={`utility-item hover-lift ${isActive(ROUTES.settings) ? 'active' : ''}`}
          onClick={() => navToPath(ROUTES.settings)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') navToPath(ROUTES.settings); }}
          aria-label="Settings"
        >
          <div className="nav-icon rounded-icon" /> Settings
        </div>
        <div
          className="utility-item hover-lift"
          onClick={() => setShowSearch(v => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') setShowSearch(v => !v); }}
          aria-label="Open search palette"
          aria-expanded={showSearch}
        >
          <div className="nav-icon rounded-icon" /> Search
        </div>
        <div
          className="utility-item hover-lift"
          onClick={openNotifications}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') openNotifications(); }}
          aria-label="Open notifications"
          aria-expanded={showNotifs}
        >
          <div className="nav-icon rounded-icon" /> Notifications
        </div>

        <div
          className="user-profile interactive-card"
          onClick={() => navToPath(ROUTES.profile)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') navToPath(ROUTES.profile); }}
        >
          <div className="avatar glow-avatar">PA</div>
          <div className="user-info">
            <span className="user-name">Principal Analyst</span>
            <span className="user-role">Tier 3 / System Eng</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
