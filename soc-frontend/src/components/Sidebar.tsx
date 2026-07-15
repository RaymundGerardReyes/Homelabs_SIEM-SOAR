import React from 'react';

interface SidebarProps {
  currentView: "investigation" | "playbooks";
  setCurrentView: (view: "investigation" | "playbooks") => void;
  resetAlertSelection: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setCurrentView, resetAlertSelection }) => {
  return (
    <div className="sidebar glass-panel-dark">
      {/* Header / Logo */}
      <div className="sidebar-header">
          <div className="sidebar-logo">
              <span className="logo-icon pulse-glow">◆</span> 
              <span className="logo-text">CORTEX CLONE</span>
          </div>
      </div>

      {/* Main Scrollable Menu */}
      <div className="sidebar-nav">
          <div 
            className={`nav-item ${currentView === 'investigation' ? 'active glow-border' : ''}`} 
            onClick={() => { setCurrentView('investigation'); resetAlertSelection(); }}
          >
              <div className="nav-item-left"><div className="nav-icon cmd-icon"></div> Command Center</div>
          </div>
          
          <div 
            className={`nav-item ${currentView === 'playbooks' ? 'active glow-border' : ''}`} 
            onClick={() => setCurrentView('playbooks')}
          >
              <div className="nav-item-left"><div className="nav-icon pb-icon"></div> Playbook Sandbox</div>
          </div>
          
          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Dashboards & Reports</div>
              <div className="nav-arrow">▼</div>
          </div>
          
          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Incident Response</div>
              <div className="nav-arrow">▼</div>
          </div>
          
          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Detection & Threat Intel</div>
              <div className="nav-arrow">▼</div>
          </div>
          
          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Assets</div>
              <div className="nav-arrow">▼</div>
          </div>
          
          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Endpoints</div>
              <div className="nav-arrow">▼</div>
          </div>

          <div className="nav-item">
              <div className="nav-item-left"><div className="nav-icon"></div> Marketplace</div>
          </div>
      </div>

      {/* Bottom Utility Footer */}
      <div className="sidebar-footer glass-panel-dark">
          <div className="utility-item hover-lift">
              <div className="nav-icon rounded-icon"></div> Settings
          </div>
          <div className="utility-item hover-lift">
              <div className="nav-icon rounded-icon"></div> Search
          </div>
          <div className="utility-item hover-lift">
              <div className="nav-icon rounded-icon"></div> Notifications
          </div>
          
          {/* User Profile Card */}
          <div className="user-profile interactive-card">
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
