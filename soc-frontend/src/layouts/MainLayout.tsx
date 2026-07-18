import React, { useState, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { Sidebar } from '@/layouts';
import { CommandCenter, InvestigationDashboard } from '@/features/investigations';
import { PlaybookSandbox } from '@/features/playbooks';
import TwoKeyModal from '@/shared/ui/TwoKeyModal';

import { useInvestigation } from '@/features/investigations';
import { usePlaybooks } from '@/features/playbooks';

// ─── Lazy Loaded Pages ────────────────────────────────────────────────────────
const ExecutiveDashboardPage = React.lazy(() => import('@/pages/dashboards/ExecutiveDashboardPage'));
const CompliancePage         = React.lazy(() => import('@/pages/dashboards/CompliancePage'));
const AlertRulesPage         = React.lazy(() => import('@/pages/detection/AlertRulesPage'));
const IocSearchPage          = React.lazy(() => import('@/pages/detection/IocSearchPage'));
const ThreatFeedsPage        = React.lazy(() => import('@/pages/detection/ThreatFeedsPage'));
const ActiveIncidentsPage    = React.lazy(() => import('@/pages/incidents/ActiveIncidentsPage'));
const ClosedIncidentsPage    = React.lazy(() => import('@/pages/incidents/ClosedIncidentsPage'));
const WarRoomPage            = React.lazy(() => import('@/pages/incidents/WarRoomPage'));
const AssetInventoryPage     = React.lazy(() => import('@/pages/assets/AssetInventoryPage'));
const VulnerabilitiesPage    = React.lazy(() => import('@/pages/assets/VulnerabilitiesPage'));
const NetworkMapPage         = React.lazy(() => import('@/pages/assets/NetworkMapPage'));
const IsolationControlsPage  = React.lazy(() => import('@/pages/endpoints/IsolationControlsPage'));
const EdrLogsPage            = React.lazy(() => import('@/pages/endpoints/EdrLogsPage'));
const HostManagementPage     = React.lazy(() => import('@/pages/endpoints/HostManagementPage'));
const SettingsPage           = React.lazy(() => import('@/pages/settings/SettingsPage'));
const MarketplacePage        = React.lazy(() => import('@/pages/marketplace/MarketplacePage'));
const ProfilePage            = React.lazy(() => import('@/pages/profile/ProfilePage'));
const NotFoundPage           = React.lazy(() => import('@/pages/NotFoundPage'));

export function MainLayout() {
  const [currentView, setCurrentView] = useState<'investigation' | 'playbooks'>('investigation');

  const {
    alerts, alertsLoading, alertsError, fetchAlerts,
    selectedAlert, setSelectedAlert,
    investigation, viewInvestigation,
    twoKeyModal, setTwoKeyModal, handleActionApprove, confirmTwoKeyAction
  } = useInvestigation();

  const {
    playbooks, selectedPlaybook, setSelectedPlaybook,
    playbookOutput, setPlaybookOutput, runPlaybook
  } = usePlaybooks();

  // Main legacy "Dashboard" component logic isolated for the root route
  const LegacyDashboardNode = currentView === 'investigation' ? (
    <>
      {!selectedAlert ? (
        <CommandCenter
          alerts={alerts}
          alertsLoading={alertsLoading}
          alertsError={alertsError}
          onRetryAlerts={fetchAlerts}
          viewInvestigation={viewInvestigation}
        />
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
  );

  return (
    <div className="app-container">
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        resetAlertSelection={() => setSelectedAlert(null)}
      />

      <div className="main-content">
        <Suspense fallback={<div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading Module...</div>}>
          <Routes>
            {/* Legacy Dashboard Route */}
            <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
            <Route path="/" element={LegacyDashboardNode} />
            
            {/* New Sub-Routes resolving "No routes matched" */}
            <Route path="/dashboard/overview" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard/executive" element={<ExecutiveDashboardPage />} />
            <Route path="/dashboard/compliance" element={<CompliancePage />} />
            
            <Route path="/detection/rules" element={<AlertRulesPage />} />
            <Route path="/detection/ioc" element={<IocSearchPage />} />
            <Route path="/detection/feeds" element={<ThreatFeedsPage />} />
            
            <Route path="/incidents/active" element={<ActiveIncidentsPage />} />
            <Route path="/incidents/closed" element={<ClosedIncidentsPage />} />
            <Route path="/incidents/war-room" element={<WarRoomPage />} />
            
            <Route path="/assets/inventory" element={<AssetInventoryPage />} />
            <Route path="/assets/vulnerabilities" element={<VulnerabilitiesPage />} />
            <Route path="/assets/network-map" element={<NetworkMapPage />} />
            
            <Route path="/endpoints/isolation" element={<IsolationControlsPage />} />
            <Route path="/endpoints/edr" element={<EdrLogsPage />} />
            <Route path="/endpoints/hosts" element={<HostManagementPage />} />
            
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            
            {/* Catch-all Not Found Route */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </div>

      <TwoKeyModal
        show={twoKeyModal.show}
        action={twoKeyModal.action}
        input={twoKeyModal.input}
        setInput={(val) => setTwoKeyModal(s => ({ ...s, input: val }))}
        onCancel={() => setTwoKeyModal({ show: false, action: null, input: '' })}
        onConfirm={confirmTwoKeyAction}
      />
    </div>
  );
}

export default MainLayout;
