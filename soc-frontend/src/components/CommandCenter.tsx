import React from 'react';
import { Alert } from '../types';

interface CommandCenterProps {
  alerts: Alert[];
  viewInvestigation: (alert: Alert) => void;
}

const CommandCenter: React.FC<CommandCenterProps> = ({ alerts, viewInvestigation }) => {
  return (
    <div className="dashboard-home fadeIn">
      <div className="header">
        <h1>Good Evening, Analyst</h1>
        <p className="subtitle">System metrics and active investigations are operating nominally.</p>
      </div>

      {/* Central Data Flow Area */}
      <div className="visualization glass-panel">
          <div className="node-circle glowing-orb">
              <span className="node-count text-gradient-primary">2,404</span>
              <span className="node-label">ALERTS SCANNED</span>
          </div>
      </div>

      {/* Bottom KPI Metrics */}
      <div className="kpi-container">
          <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Events Ingestion</div>
              <div className="kpi-value text-gradient-info">40 <span className="kpi-unit">GB/24H</span></div>
          </div>
          <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Data Ingestion</div>
              <div className="kpi-value text-gradient-info">65 <span className="kpi-unit">TB/24H</span></div>
          </div>
          <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Total Open Incidents</div>
              <div className="kpi-value text-gradient-danger">10</div>
          </div>
          <div className="kpi-card glass-panel interactive-card hover-lift">
              <div className="kpi-label">Prevented Events</div>
              <div className="kpi-value text-gradient-success">286.1K</div>
          </div>
      </div>

      {/* Active Alerts Table/List embedded in Dashboard */}
      <div className="alerts-section glass-panel">
        <h3 className="section-title">Active High-Priority Alerts <span className="pulse-dot"></span></h3>
        <div className="alert-grid">
          {alerts.map((alert, index) => (
            <div 
              key={alert.id} 
              className="alert-list-item interactive-card slideInRight" 
              style={{animationDelay: `${index * 0.1}s`}}
              onClick={() => viewInvestigation(alert)}
            >
              <div className={`severity-indicator severity-${alert.severity}`}>S{alert.severity}</div>
              <div className="alert-details">
                <span className="alert-type">{alert.type.replace(/_/g, ' ')}</span>
                <span className="alert-id">{alert.id}</span>
              </div>
              <button className="investigate-btn premium-btn-small hover-lift">Investigate</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandCenter;
