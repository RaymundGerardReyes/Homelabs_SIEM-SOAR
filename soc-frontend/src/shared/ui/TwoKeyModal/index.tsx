import React, { useState, useEffect, useRef } from 'react';
import { ActionInfo } from '@/types';

interface TwoKeyModalProps {
  show: boolean;
  action: ActionInfo | null;
  input: string;
  setInput: (val: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const TwoKeyModal: React.FC<TwoKeyModalProps> = ({
  show, action, input, setInput, onCancel, onConfirm,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const isMatch = action ? input.trim() === action.target : false;
  const isNonEmptyMismatch = input.trim().length > 0 && !isMatch;

  // Reset state whenever the modal opens with a new action
  useEffect(() => {
    if (show) {
      setIsSubmitting(false);
      // Focus input on open
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [show, action?.target]);

  // Escape key to cancel + focus trap
  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      // Focus trap: tab cycling between input and buttons
      if (e.key === 'Tab') {
        const focusableEls = document.querySelectorAll<HTMLElement>(
          '#two-key-modal [tabindex]:not([tabindex="-1"]), #two-key-modal button, #two-key-modal input'
        );
        const arr = Array.from(focusableEls);
        const first = arr[0];
        const last = arr[arr.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onCancel]);

  if (!show || !action) return null;

  const handleConfirm = async () => {
    if (!isMatch || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay glass-overlay fadeIn"
      role="presentation"
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        id="two-key-modal"
        className="modal-content two-key-modal popIn"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="two-key-title"
        aria-describedby="two-key-desc"
      >
        <div className="modal-warning-header">
          <span className="warning-icon pulse-glow" aria-hidden="true">⚠️</span>
          <h2 id="two-key-title">DANGER: DESTRUCTIVE ACTION</h2>
        </div>

        <div className="modal-body">
          <p id="two-key-desc">
            You are about to execute:{' '}
            <strong className="highlight-red">{action.action}</strong> on{' '}
            <strong className="highlight-red">{action.target}</strong>.
          </p>
          <p>
            Please type the exact target name (
            <code className="code-block">{action.target}</code>) to confirm:
          </p>
          <input
            ref={inputRef}
            type="text"
            className={`danger-input glass-input ${isNonEmptyMismatch ? 'input-error' : ''}`}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type exact target name here"
            disabled={isSubmitting}
            aria-invalid={isNonEmptyMismatch}
            aria-describedby="input-validation"
            autoComplete="off"
          />
          {isNonEmptyMismatch && (
            <p
              id="input-validation"
              role="alert"
              style={{ color: '#f87171', fontSize: '12px', marginTop: '4px', fontFamily: 'monospace' }}
            >
              ✖ Target name does not match — type exactly: <code>{action.target}</code>
            </p>
          )}
          {isMatch && (
            <p style={{ color: '#4ade80', fontSize: '12px', marginTop: '4px', fontFamily: 'monospace' }}>
              ✔ Target confirmed
            </p>
          )}
        </div>

        <div className="modal-actions">
          <button
            ref={cancelRef}
            className="btn-secondary hover-lift"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className="confirm-danger-btn hover-lift glow-on-hover"
            onClick={handleConfirm}
            disabled={!isMatch || isSubmitting}
            aria-disabled={!isMatch || isSubmitting}
          >
            {isSubmitting ? '⏳ Executing…' : 'EXECUTE ACTION'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TwoKeyModal;
