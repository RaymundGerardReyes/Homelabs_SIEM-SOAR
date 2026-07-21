import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import apiClient from '@/shared/api/apiClient';
import { NotificationItem } from '@/types';
import { NAV_GROUPS } from '@/shared/config/navigation';
import { ROUTES } from '@/shared/config/routes';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);

  const toggleMenu = (menuName: string) => {
    setExpandedMenus(prev => ({ ...prev, [menuName]: !prev[menuName] }));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { 
        setShowSearch(false); 
        setShowNotifs(false); 
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openNotifications = async () => {
    setShowNotifs(v => !v);
    if (!showNotifs) {
      setNotifsLoading(true);
      try {
        const res = await apiClient.get<NotificationItem[]>('/notifications');
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
  };

  const isActive = (path: string) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path));

  return (
    <div className="sidebar glass-panel-dark z-50" role="navigation" aria-label="Main navigation">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="logo-icon pulse-glow">◆</span>
          <span className="logo-text">CORTEX CLONE</span>
        </div>
      </div>

      <div className="sidebar-nav">
        <div
          className={`nav-item ${isActive('/') ? 'active glow-border' : ''}`}
          onClick={() => navToPath('/')}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navToPath('/'); }}
          aria-current={isActive('/') ? 'page' : undefined}
        >
          <div className="nav-item-left"><div className="nav-icon cmd-icon" /> Command Center</div>
        </div>

        <div
          className={`nav-item ${isActive('/playbooks') ? 'active glow-border' : ''}`}
          onClick={() => navToPath('/playbooks')}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navToPath('/playbooks'); }}
          aria-current={isActive('/playbooks') ? 'page' : undefined}
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

      <CommandPalette isOpen={showSearch} onClose={() => setShowSearch(false)} />
      <NotificationCenter isOpen={showNotifs} onClose={() => setShowNotifs(false)} notifications={notifications} loading={notifsLoading} />

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
