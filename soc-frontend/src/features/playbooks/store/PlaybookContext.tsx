import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import apiClient from '@/shared/hooks/useAuthApi';
import type { Playbook } from '@/types';

interface PlaybookContextState {
  playbooks: Playbook[];
  selectedPlaybook: Playbook | null;
  playbookOutput: string | null;
  setSelectedPlaybook: (playbook: Playbook | null) => void;
  setPlaybookOutput: (output: string | null) => void;
  runPlaybook: (playbook: Playbook) => Promise<void>;
}

const PlaybookContext = createContext<PlaybookContextState | undefined>(undefined);

export function PlaybookProvider({ children }: { children: ReactNode }) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<Playbook | null>(null);
  const [playbookOutput, setPlaybookOutput] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get<Playbook[]>('/data/playbooks')
      .then(res => setPlaybooks(res.data))
      .catch(err => console.error('[App] Failed to load playbooks:', err));
  }, []);

  const runPlaybook = useCallback(async (playbook: Playbook) => {
    setPlaybookOutput(`[SANDBOX EXECUTION] Contacting backend for '${playbook.name}'...\n`);
    try {
      const res = await apiClient.post(`/data/playbooks/${playbook.id}/run`, {
        target:        'demo_target',
        justification: 'Manual execution from Frontend Dashboard',
      });
      setPlaybookOutput(
        `[SUCCESS]\n\nPlaybook: ${res.data.playbook_id}\nExecution Time: ${res.data.execution_time}\n\nLogs:\n` +
        res.data.logs.join('\n')
      );
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } }; message?: string })
        ?.response?.data?.detail ?? (err as { message?: string })?.message ?? 'Unknown error';
      setPlaybookOutput(`[FAILED] Playbook execution error:\n${detail}`);
    }
  }, []);

  return (
    <PlaybookContext.Provider
      value={{
        playbooks, selectedPlaybook, playbookOutput,
        setSelectedPlaybook, setPlaybookOutput, runPlaybook
      }}
    >
      {children}
    </PlaybookContext.Provider>
  );
}

export function usePlaybooks() {
  const ctx = useContext(PlaybookContext);
  if (ctx === undefined) {
    throw new Error('usePlaybooks must be used within a PlaybookProvider');
  }
  return ctx;
}
