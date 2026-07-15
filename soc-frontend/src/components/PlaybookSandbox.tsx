import React from 'react';
import { Playbook } from '../types';

interface PlaybookSandboxProps {
  playbooks: Playbook[];
  selectedPlaybook: Playbook | null;
  setSelectedPlaybook: (pb: Playbook | null) => void;
  playbookOutput: string | null;
  runPlaybook: (pb: Playbook) => void;
  setPlaybookOutput: (out: string | null) => void;
}

const PlaybookSandbox: React.FC<PlaybookSandboxProps> = ({ 
  playbooks, 
  selectedPlaybook, 
  setSelectedPlaybook, 
  playbookOutput, 
  runPlaybook,
  setPlaybookOutput
}) => {
  return (
    <div className="playbook-view-wrapper fadeIn">
      <div className="header">
        <h1>Playbook Sandbox</h1>
        <p className="subtitle">Manage and orchestrate secure containerized automation scripts.</p>
      </div>
      
      <div className="playbook-layout">
        <div className="playbook-sidebar glass-panel">
          <h3 className="section-title">Available Playbooks</h3>
          <ul>
            {playbooks.map(pb => (
              <li 
                key={pb.id} 
                className={`list-item interactive-card hover-lift ${selectedPlaybook?.id === pb.id ? 'active glow-border' : ''}`} 
                onClick={() => { setSelectedPlaybook(pb); setPlaybookOutput(null); }}
              >
                <span className="item-name">{pb.name}</span>
                <span className="item-arrow">→</span>
              </li>
            ))}
          </ul>
        </div>
        
        <div className="playbook-editor-container glass-panel">
          {selectedPlaybook ? (
            <div className="editor-content fadeIn">
              <div className="playbook-header">
                <h2>{selectedPlaybook.name}</h2>
                <div className="playbook-meta">Trigger: <code className="glass-code text-warning">{selectedPlaybook.trigger}</code></div>
              </div>
              
              <div className="editor-wrapper">
                <div className="editor-toolbar">
                  <span className="dot dot-red"></span>
                  <span className="dot dot-yellow"></span>
                  <span className="dot dot-green"></span>
                  <span className="editor-title">Python 3.11</span>
                </div>
                <textarea 
                  className="code-editor" 
                  value={selectedPlaybook.code} 
                  readOnly 
                />
              </div>
              
              <div className="playbook-actions">
                <button className="run-btn premium-btn hover-lift glow-on-hover" onClick={() => runPlaybook(selectedPlaybook)}>
                  <span className="btn-icon">▶</span> Run in Sandbox
                </button>
              </div>
              
              {playbookOutput && (
                <div className="playbook-output slideUp">
                  <h3>Execution Output</h3>
                  <pre>{playbookOutput}</pre>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon pulse-glow">⚙️</div>
              <p>Select a playbook to edit or run in the isolated sandbox.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlaybookSandbox;
