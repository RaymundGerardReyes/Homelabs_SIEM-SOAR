import React, { useState, useEffect, useRef } from 'react';
import { Playbook } from '@/types';
import apiClient from '@/shared/hooks/useAuthApi';

type ExecStatus = 'idle' | 'queued' | 'running' | 'success' | 'failed';

interface PlaybookExecState {
  status: ExecStatus;
  output: string;
  exitCode: number | null;
  durationMs: number | null;
}

interface PlaybookSandboxProps {
  playbooks: Playbook[];
  selectedPlaybook: Playbook | null;
  setSelectedPlaybook: (pb: Playbook | null) => void;
  playbookOutput: string | null;
  runPlaybook: (pb: Playbook) => void;
  setPlaybookOutput: (out: string | null) => void;
}

const statusColors: Record<ExecStatus, string> = {
  idle:    '#64748b',
  queued:  '#facc15',
  running: '#60a5fa',
  success: '#4ade80',
  failed:  '#f87171',
};

const statusLabels: Record<ExecStatus, string> = {
  idle:    '',
  queued:  '⏳ Queued…',
  running: '⟳ Running…',
  success: '✔ Success',
  failed:  '✕ Failed',
};

const PlaybookSandbox: React.FC<PlaybookSandboxProps> = ({
  playbooks,
  selectedPlaybook,
  setSelectedPlaybook,
  setPlaybookOutput,
}) => {
  const [execStates, setExecStates] = useState<Record<string, PlaybookExecState>>({});
  const outputRef = useRef<HTMLPreElement>(null);

  const getCurrentExec = (id: string): PlaybookExecState =>
    execStates[id] ?? { status: 'idle', output: '', exitCode: null, durationMs: null };

  const setExec = (id: string, update: Partial<PlaybookExecState>) => {
    setExecStates(prev => ({
      ...prev,
      [id]: { ...getCurrentExec(id), ...update },
    }));
  };

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [execStates]);

  const handleRun = async (pb: Playbook) => {
    const pbExec = getCurrentExec(pb.id);
    if (pbExec.status === 'running' || pbExec.status === 'queued') return;

    const startTs = Date.now();
    setExec(pb.id, { status: 'queued', output: `[QUEUED] Contacting sandbox for '${pb.name}'…\n`, exitCode: null, durationMs: null });

    const token = localStorage.getItem('internal_access_token') ?? '';
    const evtSrc = new EventSource(`/api/data/playbooks/${pb.id}/execute/stream?token=${encodeURIComponent(token)}`);

    setExec(pb.id, { status: 'running' });

    let hasData = false;
    let outputAccum = `[RUNNING] Executing '${pb.name}' in ephemeral sandbox…\n`;

    evtSrc.onmessage = (e) => {
      hasData = true;
      outputAccum += e.data + '\n';
      setExec(pb.id, { output: outputAccum });
    };

    evtSrc.addEventListener('done', (e) => {
      hasData = true;
      const payload = JSON.parse((e as MessageEvent).data ?? '{}');
      const code = payload.exit_code ?? 0;
      evtSrc.close();
      setExec(pb.id, {
        status: code === 0 ? 'success' : 'failed',
        output: outputAccum + `\n[COMPLETE] Exit code: ${code}`,
        exitCode: code,
        durationMs: Date.now() - startTs,
      });
    });

    evtSrc.onerror = async () => {
      evtSrc.close();
      if (hasData) return;

      try {
        const res = await apiClient.post(`/data/playbooks/${pb.id}/run`, {
          target: 'demo_target',
          justification: 'Manual execution from Frontend Dashboard',
        });
        const d = res.data;
        setExec(pb.id, {
          status: 'success',
          output: `[SUCCESS]\n\nPlaybook: ${d.playbook_id}\nExecution Time: ${d.execution_time}\n\nLogs:\n` + d.logs.join('\n'),
          exitCode: 0,
          durationMs: Date.now() - startTs,
        });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail ?? (err as { message?: string })?.message ?? 'Unknown error';
        setExec(pb.id, {
          status: 'failed',
          output: `[FAILED] ${msg}`,
          exitCode: 1,
          durationMs: Date.now() - startTs,
        });
      }
    };
  };

  const handleStop = (pb: Playbook) => {
    setExec(pb.id, { status: 'failed', output: getCurrentExec(pb.id).output + '\n[STOPPED] Execution cancelled by analyst.' });
  };

  const fmt = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;

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
            {playbooks.map(pb => {
              const exec = getCurrentExec(pb.id);
              return (
                <li
                  key={pb.id}
                  className={`list-item interactive-card hover-lift ${selectedPlaybook?.id === pb.id ? 'active glow-border' : ''}`}
                  onClick={() => { setSelectedPlaybook(pb); setPlaybookOutput(null); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') { setSelectedPlaybook(pb); setPlaybookOutput(null); } }}
                  aria-label={`Select playbook: ${pb.name}`}
                >
                  <span className="item-name">{pb.name}</span>
                  {exec.status !== 'idle' && (
                    <span style={{ fontSize: '11px', color: statusColors[exec.status], fontFamily: 'monospace' }}>
                      {statusLabels[exec.status]}
                    </span>
                  )}
                  <span className="item-arrow">→</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="playbook-editor-container glass-panel">
          {selectedPlaybook ? (() => {
            const exec = getCurrentExec(selectedPlaybook.id);
            const isActive = exec.status === 'running' || exec.status === 'queued';
            return (
              <div className="editor-content fadeIn">
                <div className="playbook-header">
                  <h2>{selectedPlaybook.name}</h2>
                  <div className="playbook-meta">
                    Trigger: <code className="glass-code text-warning">{selectedPlaybook.trigger}</code>
                  </div>
                </div>

                <div className="editor-wrapper">
                  <div className="editor-toolbar">
                    <span className="dot dot-red" /><span className="dot dot-yellow" /><span className="dot dot-green" />
                    <span className="editor-title">Python 3.11 — Read-Only Viewer</span>
                  </div>
                  <textarea
                    className="code-editor"
                    value={selectedPlaybook.code}
                    readOnly
                    aria-label={`Source code for playbook ${selectedPlaybook.name}`}
                  />
                </div>

                <div className="playbook-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <button
                    className="run-btn premium-btn hover-lift glow-on-hover"
                    onClick={() => handleRun(selectedPlaybook)}
                    disabled={isActive}
                    aria-busy={isActive}
                  >
                    <span className="btn-icon">{isActive ? '⟳' : '▶'}</span>
                    {isActive ? ' Running…' : ' Run in Sandbox'}
                  </button>
                  {isActive && (
                    <button
                      className="btn-secondary hover-lift"
                      onClick={() => handleStop(selectedPlaybook)}
                      style={{ color: '#f87171' }}
                    >
                      ✕ Stop
                    </button>
                  )}
                </div>

                {exec.status !== 'idle' && (
                  <div style={{
                    display: 'flex', gap: '1rem', alignItems: 'center',
                    padding: '6px 12px', background: 'rgba(15,23,42,0.6)',
                    borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', marginTop: '0.5rem',
                    border: `1px solid ${statusColors[exec.status]}44`,
                  }}>
                    <span style={{ color: statusColors[exec.status], fontWeight: 700 }}>
                      {statusLabels[exec.status] || exec.status.toUpperCase()}
                    </span>
                    {exec.exitCode !== null && <span style={{ color: '#64748b' }}>Exit: {exec.exitCode}</span>}
                    {exec.durationMs !== null && <span style={{ color: '#64748b' }}>Duration: {fmt(exec.durationMs)}</span>}
                  </div>
                )}

                {exec.output && (
                  <div className="playbook-output slideUp">
                    <h3>Execution Output</h3>
                    <pre
                      ref={outputRef}
                      style={{ maxHeight: '200px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}
                    >
                      {exec.output}
                    </pre>
                  </div>
                )}
              </div>
            );
          })() : (
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
