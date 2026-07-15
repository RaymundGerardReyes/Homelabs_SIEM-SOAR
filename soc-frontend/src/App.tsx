import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import CommandCenter from './components/CommandCenter';
import InvestigationDashboard from './components/InvestigationDashboard';
import PlaybookSandbox from './components/PlaybookSandbox';
import TwoKeyModal from './components/TwoKeyModal';
import { Alert, Playbook, InvestigationData, ActionInfo } from './types';
import { mockAlerts, mockPlaybooks, getMockInvestigation } from './data/mockData';

function Dashboard() {
  const [currentView, setCurrentView] = useState<"investigation" | "playbooks">("investigation");
  
  // Investigation State
  const [alerts] = useState<Alert[]>(mockAlerts);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationData | null>(null);
  const [twoKeyModal, setTwoKeyModal] = useState<{show: boolean, action: ActionInfo | null, input: string}>({show: false, action: null, input: ""});

  // Playbook State
  const [playbooks] = useState<Playbook[]>(mockPlaybooks);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [playbookOutput, setPlaybookOutput] = useState<string | null>(null);

  const viewInvestigation = (alert: Alert) => {
    setSelectedAlert(alert);
    setInvestigation(getMockInvestigation(alert));
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
      <Sidebar 
        currentView={currentView} 
        setCurrentView={setCurrentView} 
        resetAlertSelection={() => setSelectedAlert(null)} 
      />

      <div className="main-content">
        {currentView === 'investigation' ? (
          <>
            {!selectedAlert ? (
              <CommandCenter alerts={alerts} viewInvestigation={viewInvestigation} />
            ) : (
              <InvestigationDashboard 
                selectedAlert={selectedAlert} 
                investigation={investigation} 
                clearSelection={() => setSelectedAlert(null)} 
                handleActionApprove={handleActionApprove} 
              />
            )}
          </>
        ) : (
          <PlaybookSandbox 
            playbooks={playbooks} 
            selectedPlaybook={selectedPlaybook} 
            setSelectedPlaybook={setSelectedPlaybook} 
            playbookOutput={playbookOutput} 
            runPlaybook={runPlaybook} 
            setPlaybookOutput={setPlaybookOutput} 
          />
        )}
      </div>

      <TwoKeyModal 
        show={twoKeyModal.show} 
        action={twoKeyModal.action} 
        input={twoKeyModal.input} 
        setInput={(val) => setTwoKeyModal({...twoKeyModal, input: val})} 
        onCancel={() => setTwoKeyModal({show: false, action: null, input: ""})} 
        onConfirm={confirmTwoKeyAction} 
      />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        
        {/* Secure Dashboard Routes Protected by Authentication Guards */}
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
