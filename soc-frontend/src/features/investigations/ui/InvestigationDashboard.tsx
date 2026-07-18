import React, { useState, useEffect, useRef } from 'react';
import { Alert, InvestigationData, ActionInfo } from '@/types';
import TwoKeyModal from '@/shared/ui/TwoKeyModal';
import { InvestigationGraph } from './InvestigationGraph';
import { ThreatIntelPanel } from './ThreatIntelPanel';
import { useInvestigationStream } from '../hooks/useInvestigationStream';

type FetchStatus = 'loading' | 'error' | 'loaded';

const HIGH_RISK_LEVELS: ActionInfo['risk'][] = ['HIGH_IMPACT_WRITE', 'DESTRUCTIVE'];

const InvestigationDashboard: React.FC<{
  selectedAlert: Alert;
  investigation: InvestigationData | null;
  clearSelection: () => void;
  handleActionApprove: (action: ActionInfo) => void;
}> = ({
  selectedAlert,
  investigation,
  clearSelection,
  handleActionApprove,
}) => {
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>(
    investigation ? 'loaded' : 'loading'
  );
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [twoKeyState, setTwoKeyState] = useState<{
    show: boolean; action: ActionInfo | null; input: string;
  }>({ show: false, action: null, input: '' });
  const logContainerRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const { logs: streamLogs, isConnected: streamConnected } = useInvestigationStream(selectedAlert.id);

  useEffect(() => {
    if (investigation) {
      setFetchStatus('loaded');
    }
  }, [investigation]);

  useEffect(() => {
    if (!userScrolled && logContainerRef.current && investigation) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [investigation, userScrolled]);

  useEffect(() => {
    if (streamContainerRef.current) {
      streamContainerRef.current.scrollTop = streamContainerRef.current.scrollHeight;
    }
  }, [streamLogs]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    setUserScrolled(scrollHeight - scrollTop - clientHeight > 40);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleActionClick = (action: ActionInfo) => {
    if (HIGH_RISK_LEVELS.includes(action.risk)) {
      setTwoKeyState({ show: true, action, input: '' });
    } else {
      handleActionApprove(action);
      showToast(`✔ Action "${action.action}" submitted for ${action.target}`);
    }
  };

  const confirmTwoKey = () => {
    if (twoKeyState.action) {
      handleActionApprove(twoKeyState.action);
      setTwoKeyState({ show: false, action: null, input: '' });
      showToast(`🔐 Destructive action "${twoKeyState.action.action}" executed.`);
    }
  };

  return (
    <div className="investigation-dashboard fadeIn">
      <div className="breadcrumb">
        <button
          className="breadcrumb-link"
          onClick={clearSelection}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label="Back to Command Center"
        >
          ← Back to Command Center
        </button>
        <span className="breadcrumb-separator">/</span>
        <span className="active-breadcrumb glow-text">
          {selectedAlert.type.replace(/_/g, ' ')} ({selectedAlert.id})
        </span>
        <span style={{
          marginLeft: 'auto',
          padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
          fontFamily: 'monospace',
          background: streamConnected ? 'rgba(74,222,128,0.12)' : 'rgba(100,116,139,0.12)',
          color:      streamConnected ? '#4ade80'               : '#64748b',
          border:     `1px solid ${streamConnected ? '#4ade8044' : '#33415544'}`,
        }}>
          {streamConnected ? '● LIVE STREAM' : '○ STREAM IDLE'}
        </span>
      </div>

      {fetchStatus === 'loading' && (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', marginTop: '1rem' }}>
          <div className="pulse-glow" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
          <p style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
            Fetching AI investigation context…
          </p>
        </div>
      )}

      {fetchStatus === 'error' && (
        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', marginTop: '1rem', borderColor: '#ef4444' }}>
          <p style={{ color: '#f87171', fontFamily: 'monospace' }}>
            ⚠ Failed to load investigation data.
          </p>
          <button
            className="btn-secondary hover-lift"
            style={{ marginTop: '1rem' }}
            onClick={() => setFetchStatus('loading')}
          >
            Retry
          </button>
        </div>
      )}

      {fetchStatus === 'loaded' && investigation && (
        <>
          <div className="investigation-grid">
            <div className="panel conversation-panel glass-panel">
              <h3 className="panel-title">
                <span className="icon">🛡️</span> Immutable Agent Log
              </h3>
              <div
                ref={logContainerRef}
                className="log-container"
                onScroll={handleScroll}
                style={{ overflowY: 'auto', maxHeight: '340px' }}
              >
                {investigation.details.conversation_log.map((log, idx) => (
                  <div
                    key={idx}
                    className={`log-entry interactive-card ${log.confidence < 70 ? 'low-confidence' : ''}`}
                  >
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

              {streamLogs.length > 0 && (
                <div style={{
                  marginTop: '0.75rem', borderTop: '1px solid #1e293b', paddingTop: '0.75rem',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '6px',
                  }}>
                    <span style={{
                      fontFamily: 'monospace', fontSize: '10px', fontWeight: 700,
                      textTransform: 'uppercase', letterSpacing: '2px', color: '#4ade80',
                    }}>
                      ● Live Telemetry Feed
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#334155' }}>
                      {streamLogs.length} events (last 25 shown)
                    </span>
                  </div>
                  <div
                    ref={streamContainerRef}
                    style={{
                      maxHeight: '120px', overflowY: 'auto', background: 'rgba(0,0,0,0.25)',
                      borderRadius: '6px', padding: '6px 10px', border: '1px solid #1e293b',
                    }}
                  >
                    {streamLogs.slice(-25).map((line, i) => (
                      <div key={i} style={{
                        fontFamily: 'monospace', fontSize: '11px', color: '#475569',
                        padding: '1px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                      }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="panel action-panel glass-panel">
              <h3 className="panel-title">
                <span className="icon">⚡</span> Proposed Actions
              </h3>
              <div className="action-list">
                {investigation.details.proposed_actions.map((action, idx) => (
                  <div
                    key={idx}
                    className={`action-card interactive-card risk-${action.risk.toLowerCase()}`}
                  >
                    <div className="action-header">
                      <span className="action-name">{action.action}</span>
                      <span className="risk-badge">{action.risk.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="action-target">
                      Target: <code className="glass-code">{action.target}</code>
                    </div>
                    <div className="action-justification">"{action.justification}"</div>
                    <button
                      className={`approve-btn premium-btn hover-lift glow-on-hover ${
                        HIGH_RISK_LEVELS.includes(action.risk) ? 'btn-danger' : ''
                      }`}
                      onClick={() => handleActionClick(action)}
                      aria-label={`Approve action: ${action.action} on ${action.target}`}
                    >
                      {HIGH_RISK_LEVELS.includes(action.risk) ? '🔐 Approve (Two-Key)' : 'Approve Action'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel glass-panel" style={{ marginTop: '1.25rem' }}>
            <h3 className="panel-title" style={{ marginBottom: '0.75rem' }}>
              <span className="icon">🕸️</span> Agent Execution Graph
            </h3>
            <InvestigationGraph sessionId={selectedAlert.id} />
          </div>

          {investigation.source_ip && (
            <div style={{ marginTop: '0.5rem' }}>
              <ThreatIntelPanel ipAddress={investigation.source_ip} />
            </div>
          )}
        </>
      )}

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', bottom: '1.5rem', right: '1.5rem',
            background: 'rgba(30,41,59,0.95)', border: '1px solid #334155',
            borderRadius: '8px', padding: '0.75rem 1.25rem',
            color: '#e2e8f0', fontFamily: 'monospace', fontSize: '14px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)', zIndex: 9999,
          }}
        >
          {toastMsg}
        </div>
      )}

      <TwoKeyModal
        show={twoKeyState.show}
        action={twoKeyState.action}
        input={twoKeyState.input}
        setInput={val => setTwoKeyState(s => ({ ...s, input: val }))}
        onCancel={() => setTwoKeyState({ show: false, action: null, input: '' })}
        onConfirm={confirmTwoKey}
      />
    </div>
  );
};

export default InvestigationDashboard;
