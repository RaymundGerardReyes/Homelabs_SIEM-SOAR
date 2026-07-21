import React, { useEffect, useState, useRef } from 'react';
import { useAsyncState } from '../../../shared/hooks';
import { Playbook } from '../../../shared/types';
import { LoadingSkeleton, ErrorState, Badge } from '../../../shared/ui';
import apiClient from '../../../shared/api/apiClient';
import { tokenService } from '../../../shared/auth/tokenService';

interface ExecutionState {
  status: 'queued' | 'running' | 'success' | 'failed';
  output: string[];
  exitCode?: number;
  duration?: number;
}

export default function PlaybookSandbox() {
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [executionCache, setExecutionCache] = useState<Record<string, ExecutionState>>({});
  const activeWsRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const { data: playbooks, loading, error, execute } = useAsyncState<Playbook[]>(async () => {
    const res = await apiClient.get('/playbooks');
    return res.data || [];
  });

  useEffect(() => {
    execute();
  }, [execute]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [executionCache]);

  const runPlaybook = (playbookId: string) => {
    if (activeWsRef.current) activeWsRef.current.close();
    
    setExecutionCache(prev => ({
      ...prev,
      [playbookId]: { status: 'queued', output: ['> Initiating sandbox execution container...'] }
    }));

    const token = tokenService.getToken();
    const wsUrl = new URL(`/api/playbooks/${playbookId}/execute/stream`, window.location.origin);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    if (token) wsUrl.searchParams.append('token', token);

    const ws = new WebSocket(wsUrl.toString());
    activeWsRef.current = ws;

    ws.onopen = () => {
      setExecutionCache(prev => ({
        ...prev,
        [playbookId]: { ...prev[playbookId], status: 'running', output: [...prev[playbookId].output, '> Connected to sandbox stream...'] }
      }));
    };

    ws.onmessage = (event) => {
      let message = event.data;
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'END') {
          setExecutionCache(prev => ({
            ...prev,
            [playbookId]: { 
              ...prev[playbookId], 
              status: parsed.exitCode === 0 ? 'success' : 'failed',
              exitCode: parsed.exitCode,
              duration: parsed.duration
            }
          }));
          return;
        }
        if (parsed.output) message = parsed.output;
      } catch (e) {}

      setExecutionCache(prev => ({
        ...prev,
        [playbookId]: { ...prev[playbookId], output: [...prev[playbookId].output, message] }
      }));
    };

    ws.onclose = () => {
      activeWsRef.current = null;
    };
  };

  const stopExecution = (playbookId: string) => {
    if (activeWsRef.current) {
      activeWsRef.current.close();
      setExecutionCache(prev => ({
        ...prev,
        [playbookId]: { ...prev[playbookId], status: 'failed', output: [...prev[playbookId].output, '> Execution forcibly terminated by user.'] }
      }));
    }
  };

  const currentExec = selectedPlaybook ? executionCache[selectedPlaybook.id] : null;

  return (
    <div className="flex h-screen bg-slate-950 pt-16">
      <div className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col">
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-white font-bold text-sm uppercase tracking-wider">Playbooks</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <LoadingSkeleton lines={4} />}
          {error && <ErrorState message="Failed to load playbooks" onRetry={execute} />}
          {playbooks?.map(pb => (
            <button
              key={pb.id}
              onClick={() => setSelectedPlaybook(pb)}
              className={`w-full text-left p-3 rounded mb-1 text-sm transition-colors ${selectedPlaybook?.id === pb.id ? 'bg-blue-600/20 text-blue-400' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <div className="font-medium">{pb.name}</div>
              <div className="text-xs text-slate-500 mt-1 truncate">Trigger: {pb.trigger}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selectedPlaybook ? (
          <>
            <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedPlaybook.name}</h2>
                <p className="text-xs text-slate-400">Trigger: {selectedPlaybook.trigger}</p>
              </div>
              <div>
                {currentExec?.status === 'running' ? (
                  <button onClick={() => stopExecution(selectedPlaybook.id)} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-medium text-sm transition-colors">
                    Stop Execution
                  </button>
                ) : (
                  <button onClick={() => runPlaybook(selectedPlaybook.id)} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-medium text-sm transition-colors flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                    Run in Sandbox
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 p-4 bg-[#1e1e1e] overflow-y-auto">
              <pre className="text-sm font-mono text-[#d4d4d4]">
                {/* Fallback to simple pre since Monaco is not guaranteed to be installed yet */}
                <code>{selectedPlaybook.code || '# No source code available'}</code>
              </pre>
            </div>

            <div className={`h-1/3 flex flex-col border-t-4 transition-colors ${currentExec?.status === 'failed' ? 'border-red-500' : currentExec?.status === 'success' ? 'border-green-500' : currentExec?.status === 'running' ? 'border-blue-500' : 'border-slate-800'}`}>
              <div className="bg-black border-b border-slate-800 p-2 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400 uppercase">Sandbox Terminal</span>
                {currentExec && (
                  <div className="flex space-x-3">
                    {currentExec.duration && <span className="text-xs text-slate-500">{currentExec.duration}ms</span>}
                    {currentExec.exitCode !== undefined && <span className="text-xs text-slate-500">Exit: {currentExec.exitCode}</span>}
                    <Badge severity={currentExec.status === 'running' ? 'S4' : currentExec.status === 'success' ? 'S3' : 'S1'} className="text-[10px] py-0">{currentExec.status}</Badge>
                  </div>
                )}
              </div>
              <div className="flex-1 bg-black p-4 overflow-y-auto font-mono text-sm text-green-400">
                {currentExec ? (
                  currentExec.output.map((line, i) => <div key={i} className="mb-1">{line}</div>)
                ) : (
                  <div className="text-slate-600 italic">No output. Click 'Run in Sandbox' to execute.</div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            Select a playbook from the sidebar to view and execute.
          </div>
        )}
      </div>
    </div>
  );
}
