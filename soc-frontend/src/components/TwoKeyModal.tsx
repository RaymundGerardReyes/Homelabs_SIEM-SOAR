import React from 'react';
import { ActionInfo } from '../types';

interface TwoKeyModalProps {
  show: boolean;
  action: ActionInfo | null;
  input: string;
  setInput: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const TwoKeyModal: React.FC<TwoKeyModalProps> = ({ show, action, input, setInput, onCancel, onConfirm }) => {
  if (!show || !action) return null;

  return (
    <div className="modal-overlay glass-overlay fadeIn">
      <div className="modal-content two-key-modal popIn">
        <div className="modal-warning-header">
            <span className="warning-icon pulse-glow">⚠️</span>
            <h2>DANGER: DESTRUCTIVE ACTION</h2>
        </div>
        <div className="modal-body">
            <p>You are about to execute: <strong className="highlight-red">{action.action}</strong> on <strong className="highlight-red">{action.target}</strong>.</p>
            <p>Please type the exact target name (<code className="code-block">{action.target}</code>) to confirm this action.</p>
            <input 
            type="text" 
            className="danger-input glass-input"
            value={input} 
            onChange={e => setInput(e.target.value)}
            placeholder="Type target name here"
            />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary hover-lift" onClick={onCancel}>Cancel</button>
          <button 
            className="confirm-danger-btn hover-lift glow-on-hover" 
            onClick={onConfirm}
            disabled={input !== action.target}
          >
            EXECUTE ACTION
          </button>
        </div>
      </div>
    </div>
  );
};

export default TwoKeyModal;
