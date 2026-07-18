import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import apiClient from '@/shared/hooks/useAuthApi';
import type { Alert, InvestigationData, ActionInfo } from '@/types';

interface InvestigationContextState {
  alerts: Alert[];
  alertsLoading: boolean;
  alertsError: string | null;
  selectedAlert: Alert | null;
  investigation: InvestigationData | null;
  twoKeyModal: { show: boolean; action: ActionInfo | null; input: string };
  fetchAlerts: () => Promise<void>;
  setSelectedAlert: (alert: Alert | null) => void;
  setTwoKeyModal: React.Dispatch<React.SetStateAction<{ show: boolean; action: ActionInfo | null; input: string }>>;
  viewInvestigation: (alert: Alert) => Promise<void>;
  handleActionApprove: (action: ActionInfo) => void;
  confirmTwoKeyAction: () => Promise<void>;
}

const InvestigationContext = createContext<InvestigationContextState | undefined>(undefined);

export function InvestigationProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState<boolean>(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationData | null>(null);
  const [twoKeyModal, setTwoKeyModal] = useState<{ show: boolean; action: ActionInfo | null; input: string }>(
    { show: false, action: null, input: '' }
  );

  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const res = await apiClient.get<Alert[]>('/data/alerts');
      setAlerts(res.data);
    } catch {
      setAlertsError('Failed to load alerts. The backend may be unreachable.');
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const viewInvestigation = useCallback(async (alert: Alert) => {
    setSelectedAlert(alert);
    setInvestigation(null);
    try {
      const res = await apiClient.get<InvestigationData>(`/data/investigation/${alert.id}`);
      setInvestigation(res.data);
    } catch (err) {
      console.error('[App] Failed to fetch investigation:', err);
    }
  }, []);

  const handleActionApprove = useCallback((action: ActionInfo) => {
    if (action.risk === 'DESTRUCTIVE' || action.risk === 'HIGH_IMPACT_WRITE') {
      setTwoKeyModal({ show: true, action, input: '' });
    } else {
      // Low-risk action approved
    }
  }, []);

  const confirmTwoKeyAction = useCallback(async () => {
    if (twoKeyModal.action && twoKeyModal.input.trim() === twoKeyModal.action.target) {
      try {
        await apiClient.post('/data/actions/execute', {
          action:        twoKeyModal.action.action,
          target:        twoKeyModal.action.target,
          justification: twoKeyModal.action.justification,
          risk:          twoKeyModal.action.risk,
        });
      } catch (err) {
        console.error('[App] Action execution failed:', err);
      } finally {
        setTwoKeyModal({ show: false, action: null, input: '' });
      }
    } else {
      console.warn('[TwoKey] Target mismatch — action aborted for safety.');
      setTwoKeyModal({ show: false, action: null, input: '' });
    }
  }, [twoKeyModal]);

  return (
    <InvestigationContext.Provider
      value={{
        alerts, alertsLoading, alertsError, selectedAlert, investigation, twoKeyModal,
        fetchAlerts, setSelectedAlert, setTwoKeyModal, viewInvestigation, handleActionApprove, confirmTwoKeyAction
      }}
    >
      {children}
    </InvestigationContext.Provider>
  );
}

export function useInvestigation() {
  const ctx = useContext(InvestigationContext);
  if (ctx === undefined) {
    throw new Error('useInvestigation must be used within an InvestigationProvider');
  }
  return ctx;
}
