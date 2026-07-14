import React, { useState } from 'react';
import './App.css';

interface Alert {
  id: string;
  type: string;
  severity: number;
}

interface ActionInfo {
  action: string;
  target: string;
  justification: string;
  risk: "READ_ONLY" | "LOW_IMPACT_WRITE" | "HIGH_IMPACT_WRITE" | "DESTRUCTIVE";
}

interface LogEntry {
  agent: string;
  message: string;
  confidence: number;
}

interface InvestigationData {
  nodes: any[];
  edges: any[];
  details: {
    conversation_log: LogEntry[];
    proposed_actions: ActionInfo[];
  };
}

interface Playbook {
  id: string;
  name: string;
  trigger: string;
  code: string;
}

function App() {
  const [currentView, setCurrentView] = useState<"investigation" | "playbooks">("investigation");
  
  // Investigation State
  const [alerts] = useState<Alert[]>([
    { id: 'alert-172102001', type: 'Brute_Force_Attack', severity: 3 },
    { id: 'alert-172102002', type: 'Impossible_Travel', severity: 2 },
  ]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationData | null>(null);
  const [twoKeyModal, setTwoKeyModal] = useState<{show: boolean, action: ActionInfo | null, input: string}>({show: false, action: null, input: ""});

  // Playbook State
  const [playbooks] = useState<Playbook[]>([
    {
      id: "pb-1",
      name: "Auto-Isolate Malware",
      trigger: "Malware_Detected",
      code: "def run(alert):\n    soc_sdk.isolate_host(alert.entities[0])\n    return 'Success'"
    },
    {
      id: "pb-2",
      name: "Enrich IP Address",
      trigger: "New_IP_Seen",
      code: "def run(alert):\n    data = soc_sdk.query_threat_intel(alert.source_ip)\n    return data"
    }
  ]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [playbookOutput, setPlaybookOutput] = useState<string | null>(null);

  const viewInvestigation = (alert: Alert) => {
    setSelectedAlert(alert);
    setInvestigation({
      nodes: [],
      edges: [],
      details: {
        conversation_log: [
          { agent: "TriageAgent", message: `Assessed alert severity as ${alert.severity}. Classification: True Positive`, confidence: 85.0 },
          { agent: "TriageAgent", message: "Found anomalies in source IP geo-location.", confidence: 65.0 },
          { agent: "ResponseProposer", message: "Generated proposed actions for containment.", confidence: 95.0 }
        ],
        proposed_actions: [
          { action: "Tag Alert", target: alert.id, justification: "Marked as confirmed by AI", risk: "LOW_IMPACT_WRITE" },
          { action: "Block IP", target: "198.51.100.42", justification: "Brute force source identified", risk: "HIGH_IMPACT_WRITE" },
          { action: "Isolate Host", target: "target_server_01", justification: "Prevent lateral movement", risk: "DESTRUCTIVE" }
        ]
      }
    });
  };

  const handleActionApprove = (action: ActionInfo) => {
    if (action.risk === "DESTRUCTIVE") {
      setTwoKeyModal({ show: true, action, input: "" });
    } else {
      alert(`[POLICY ENGINE] Approved Action: ${action.action} on ${action.target}`);
    }
  };

  const confirmTwoKeyAction = () => {
    if (twoKeyModal.action && twoKeyModal.input === twoKeyModal.action.target) {
      alert(`[POLICY ENGINE] DESTRUCTIVE ACTION EXECUTED: ${twoKeyModal.action.action} on ${twoKeyModal.action.target}`);
      setTwoKeyModal({ show: false, action: null, input: "" });
    } else {
      alert("Target name mismatch. Action aborted for safety.");
    }
  };

  const runPlaybook = (playbook: Playbook) => {
    setPlaybookOutput(`[SANDBOX EXECUTION] Running playbook '${playbook.name}' in restricted container...\n\nLogs:\n- Triggered manually by Principal Analyst\n- Initializing isolated Python 3.11 environment...\n- Executing code...\n- Completed successfully.\n\nActions Taken:\n- Executed logic for ${playbook.trigger}`);
  };

  return (
    <div className="app-container">
      
      {/* Massive Sidebar Navigation (Cortex XSIAM Style) */}
      <div className="sidebar">
        
        {/* Header / Logo */}
        <div className="sidebar-header">
            <div className="sidebar-logo">
                <span className="logo-icon">◆</span> CORTEX CLONE
            </div>
        </div>

        {/* Main Scrollable Menu */}
        <div className="sidebar-nav">
            <div 
              className={`nav-item ${currentView === 'investigation' ? 'active' : ''}`} 
              onClick={() => { setCurrentView('investigation'); setSelectedAlert(null); }}
            >
                <div className="nav-item-left"><div className="nav-icon"></div> Command Center</div>
            </div>
            
            <div 
              className={`nav-item ${currentView === 'playbooks' ? 'active' : ''}`} 
              onClick={() => setCurrentView('playbooks')}
            >
                <div className="nav-item-left"><div className="nav-icon"></div> Playbook Sandbox</div>
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
        <div className="sidebar-footer">
            <div className="utility-item">
                <div className="nav-icon" style={{borderRadius: '50%'}}></div> Settings
            </div>
            <div className="utility-item">
                <div className="nav-icon" style={{borderRadius: '50%'}}></div> Search in Quick Launcher
            </div>
            <div className="utility-item">
                <div className="nav-icon" style={{borderRadius: '50%'}}></div> Notifications
            </div>
            <div className="utility-item">
                <div className="nav-icon" style={{borderRadius: '50%'}}></div> Help
            </div>

            {/* User Profile Card */}
            <div className="user-profile">
                <div className="avatar">PA</div>
                <div className="user-info">
                    <span className="user-name">Principal Analyst</span>
                    <span className="user-role">Tier 3 / System Eng</span>
                </div>
            </div>
        </div>
      </div>

      {/* Main Content Section */}
      <div className="main-content">
        
        {currentView === 'investigation' ? (
          <>
            <div className="header">
              <h1>Good Evening, Analyst</h1>
              <p style={{color: '#9ca3af', marginTop: '10px'}}>System metrics and active investigations are operating nominally.</p>
            </div>

            {!selectedAlert ? (
              // Default Command Center Dashboard View
              <div className="dashboard-home">
                {/* Central Data Flow Area */}
                <div className="visualization">
                    <div className="node-circle">
                        <span style={{fontSize: '2.5rem', fontWeight: 'bold', color: '#fff'}}>2,404</span>
                        <span style={{color: '#10b981', fontSize: '1rem', marginTop: '5px', letterSpacing: '2px'}}>ALERTS</span>
                    </div>
                </div>

                {/* Bottom KPI Metrics */}
                <div className="kpi-container">
                    <div className="kpi-card">
                        <div className="kpi-label">Events Ingestion</div>
                        <div className="kpi-value">40 <span style={{fontSize: '1rem', color:'#9ca3af'}}>GB/24H</span></div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-label">Data Ingestion</div>
                        <div className="kpi-value">65 <span style={{fontSize: '1rem', color:'#9ca3af'}}>TB/24H</span></div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-label">Total Open Incidents</div>
                        <div className="kpi-value" style={{color: '#ef4444'}}>10</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-label">Prevented Events</div>
                        <div className="kpi-value" style={{color: '#10b981'}}>286.1K</div>
                    </div>
                </div>

                {/* Active Alerts Table/List embedded in Dashboard */}
                <div className="alerts-section">
                  <h3 className="section-title">Active High-Priority Alerts (Requires Attention)</h3>
                  <div className="alert-grid">
                    {alerts.map(alert => (
                      <div key={alert.id} className="alert-list-item" onClick={() => viewInvestigation(alert)}>
                        <div className={`severity-indicator severity-${alert.severity}`}>S{alert.severity}</div>
                        <div className="alert-details">
                          <span className="alert-type">{alert.type}</span>
                          <span className="alert-id">{alert.id}</span>
                        </div>
                        <button className="investigate-btn">Investigate</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              // Investigation View for a specific alert
              <div className="investigation-dashboard">
                <div className="breadcrumb">
                  <span onClick={() => setSelectedAlert(null)}>Command Center</span> / 
                  <span className="active-breadcrumb">{selectedAlert.type} ({selectedAlert.id})</span>
                </div>
                
                {investigation && (
                  <div className="investigation-grid">
                    <div className="panel conversation-panel">
                      <h3>Immutable Agent Log</h3>
                      <div className="log-container">
                        {investigation.details.conversation_log.map((log, idx) => (
                          <div key={idx} className={`log-entry ${log.confidence < 70 ? 'low-confidence' : ''}`}>
                            <span className="agent-name">{log.agent}</span>
                            <p>{log.message}</p>
                            <div className="confidence-score">
                              {log.confidence < 70 && "⚠️ Low Confidence: Verify logs "}
                              Score: {log.confidence}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="panel action-panel">
                      <h3>Proposed Actions</h3>
                      <div className="action-list">
                        {investigation.details.proposed_actions.map((action, idx) => (
                          <div key={idx} className={`action-card risk-${action.risk.toLowerCase()}`}>
                            <div className="action-header">
                              <span className="action-name">{action.action}</span>
                              <span className="risk-badge">{action.risk.replace(/_/g, ' ')}</span>
                            </div>
                            <div className="action-target">Target: <code>{action.target}</code></div>
                            <div className="action-justification">"{action.justification}"</div>
                            <button className="approve-btn" onClick={() => handleActionApprove(action)}>
                              Approve Action
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          // Playbook Sandbox View
          <div className="playbook-view-wrapper">
             <div className="header">
              <h1>Playbook Sandbox</h1>
              <p style={{color: '#9ca3af', marginTop: '10px'}}>Manage and orchestrate secure containerized automation scripts.</p>
            </div>
            <div className="playbook-layout">
              <div className="playbook-sidebar">
                <h3 className="section-title">Available Playbooks</h3>
                <ul>
                  {playbooks.map(pb => (
                    <li key={pb.id} className={`list-item ${selectedPlaybook?.id === pb.id ? 'active' : ''}`} onClick={() => { setSelectedPlaybook(pb); setPlaybookOutput(null); }}>
                      <span className="item-name">{pb.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
              
              <div className="playbook-editor-container">
                {selectedPlaybook ? (
                  <>
                    <div className="playbook-header">
                      <h2>Editing: {selectedPlaybook.name}</h2>
                      <div className="playbook-meta">Trigger: <code>{selectedPlaybook.trigger}</code></div>
                    </div>
                    
                    <div className="editor-wrapper">
                      <textarea 
                        className="code-editor" 
                        value={selectedPlaybook.code} 
                        readOnly 
                      />
                    </div>
                    
                    <div className="playbook-actions">
                      <button className="run-btn" onClick={() => runPlaybook(selectedPlaybook)}>▶ Run in Sandbox</button>
                    </div>
                    
                    {playbookOutput && (
                      <div className="playbook-output">
                        <h3>Execution Output</h3>
                        <pre>{playbookOutput}</pre>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state">Select a playbook to edit or run.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Two-Key Turn Modal */}
      {twoKeyModal.show && twoKeyModal.action && (
        <div className="modal-overlay">
          <div className="modal-content two-key-modal">
            <h2>⚠️ DANGER: DESTRUCTIVE ACTION</h2>
            <p>You are about to execute: <strong>{twoKeyModal.action.action}</strong> on <strong>{twoKeyModal.action.target}</strong>.</p>
            <p>Please type the exact target name (<code>{twoKeyModal.action.target}</code>) to confirm.</p>
            <input 
              type="text" 
              value={twoKeyModal.input} 
              onChange={e => setTwoKeyModal({...twoKeyModal, input: e.target.value})}
              placeholder="Type target name here"
            />
            <div className="modal-actions">
              <button onClick={() => setTwoKeyModal({show: false, action: null, input: ""})}>Cancel</button>
              <button 
                className="confirm-danger-btn" 
                onClick={confirmTwoKeyAction}
                disabled={twoKeyModal.input !== twoKeyModal.action.target}
              >
                EXECUTE ACTION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
