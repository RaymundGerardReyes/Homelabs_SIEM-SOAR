import React from 'react';
import { Alert, InvestigationData, ActionInfo } from '../types';

interface InvestigationDashboardProps {
  selectedAlert: Alert;
  investigation: InvestigationData | null;
  clearSelection: () => void;
  handleActionApprove: (action: ActionInfo) => void;
}

const InvestigationDashboard: React.FC<InvestigationDashboardProps> = ({ selectedAlert, investigation, clearSelection, handleActionApprove }) => {
  return (
    <div className="investigation-dashboard fadeIn">
      <div className="breadcrumb">
        <span className="breadcrumb-link" onClick={clearSelection}>Command Center</span> 
        <span className="breadcrumb-separator">/</span> 
        <span className="active-breadcrumb glow-text">{selectedAlert.type.replace(/_/g, ' ')} ({selectedAlert.id})</span>
      </div>
      
      {investigation && (
        <div className="investigation-grid">
          <div className="panel conversation-panel glass-panel">
            <h3 className="panel-title"><span className="icon">🛡️</span> Immutable Agent Log</h3>
            <div className="log-container">
              {investigation.details.conversation_log.map((log, idx) => (
                <div key={idx} className={`log-entry interactive-card ${log.confidence < 70 ? 'low-confidence' : ''}`}>
                  <div className="log-header">
                    <span className="agent-name">{log.agent}</span>
                    <div className="confidence-score">
                      {log.confidence < 70 && <span className="warning-icon">⚠️ Low Confidence</span>}
                      <span className="score-badge">{log.confidence}%</span>
                    </div>
                  </div>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel action-panel glass-panel">
            <h3 className="panel-title"><span className="icon">⚡</span> Proposed Actions</h3>
            <div className="action-list">
              {investigation.details.proposed_actions.map((action, idx) => (
                <div key={idx} className={`action-card interactive-card risk-${action.risk.toLowerCase()}`}>
                  <div className="action-header">
                    <span className="action-name">{action.action}</span>
                    <span className="risk-badge">{action.risk.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="action-target">Target: <code className="glass-code">{action.target}</code></div>
                  <div className="action-justification">"{action.justification}"</div>
                  <button className="approve-btn premium-btn hover-lift glow-on-hover" onClick={() => handleActionApprove(action)}>
                    Approve Action
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvestigationDashboard;
