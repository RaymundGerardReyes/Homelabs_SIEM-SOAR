import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Outlet, Navigate } from 'react-router-dom';

// Auth & Foundation
import ProtectedRoute from './features/auth/ui/ProtectedRoute';
import Login from './features/auth/ui/Login';
import UnauthorizedPage from './features/auth/ui/UnauthorizedPage';
import Sidebar from './layouts/ui/Sidebar';
import { LoadingSkeleton } from './shared/ui';

// Domains
import { CommandCenter, InvestigationDashboard } from './features/investigations';
import { PlaybookSandbox } from './features/playbooks';

// Dashboards (Lazy)
const ExecutiveDashboardPage = React.lazy(() => import('./pages/dashboards/ExecutiveDashboardPage'));
const CompliancePage = React.lazy(() => import('./pages/dashboards/CompliancePage'));

// Detection (Lazy)
const AlertRulesPage = React.lazy(() => import('./pages/detection/AlertRulesPage'));
const IocSearchPage = React.lazy(() => import('./pages/detection/IocSearchPage'));
const ThreatFeedsPage = React.lazy(() => import('./pages/detection/ThreatFeedsPage'));

// Endpoints (Lazy)
const HostManagementPage = React.lazy(() => import('./pages/endpoints/HostManagementPage'));
const IsolationControlsPage = React.lazy(() => import('./pages/endpoints/IsolationControlsPage'));
const EdrLogsPage = React.lazy(() => import('./pages/endpoints/EdrLogsPage'));

// Incidents (Lazy)
const ActiveIncidentsPage = React.lazy(() => import('./pages/incidents/ActiveIncidentsPage'));
const ClosedIncidentsPage = React.lazy(() => import('./pages/incidents/ClosedIncidentsPage'));
const WarRoomPage = React.lazy(() => import('./pages/incidents/WarRoomPage'));

// Assets (Lazy)
const AssetInventoryPage = React.lazy(() => import('./pages/assets/AssetInventoryPage'));
const NetworkMapPage = React.lazy(() => import('./pages/assets/NetworkMapPage'));
const VulnerabilitiesPage = React.lazy(() => import('./pages/assets/VulnerabilitiesPage'));

// Utilities (Lazy)
const MarketplacePage = React.lazy(() => import('./pages/utilities/MarketplacePage'));
const SettingsPage = React.lazy(() => import('./pages/utilities/SettingsPage'));
const ProfilePage = React.lazy(() => import('./pages/utilities/ProfilePage'));
const NotFoundPage = React.lazy(() => import('./pages/utilities/NotFoundPage'));

// Main Application Layout Shell
function MainLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-300">
      <Sidebar />
      <div className="flex-1 overflow-auto relative">
        <Suspense fallback={<div className="p-8 ml-64 pt-24"><LoadingSkeleton lines={10} /></div>}>
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<UnauthorizedPage />} />

        {/* Global Protected Layout */}
        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          
          {/* Core App Routing */}
          <Route path="/" element={<CommandCenter />} />
          
          <Route path="/investigations" element={<Navigate to="/incidents/active" replace />} />
          <Route path="/investigations/:id" element={<InvestigationDashboard />} />
          <Route path="/playbooks" element={<PlaybookSandbox />} />
          
          <Route path="/dashboards/executive" element={<ExecutiveDashboardPage />} />
          <Route path="/dashboards/compliance" element={<CompliancePage />} />
          
          <Route path="/detection/rules" element={<AlertRulesPage />} />
          <Route path="/detection/ioc-search" element={<IocSearchPage />} />
          <Route path="/detection/feeds" element={<ThreatFeedsPage />} />
          
          <Route path="/endpoints/hosts" element={<HostManagementPage />} />
          <Route path="/endpoints/isolation" element={<IsolationControlsPage />} />
          <Route path="/endpoints/logs" element={<EdrLogsPage />} />
          
          <Route path="/incidents/active" element={<ActiveIncidentsPage />} />
          <Route path="/incidents/closed" element={<ClosedIncidentsPage />} />
          <Route path="/incidents/war-room/:id" element={<WarRoomPage />} />
          
          <Route path="/assets/inventory" element={<AssetInventoryPage />} />
          <Route path="/assets/network-map" element={<NetworkMapPage />} />
          <Route path="/assets/vulnerabilities" element={<VulnerabilitiesPage />} />
          
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<ProfilePage />} />

          {/* 404 Fallback */}
          <Route path="*" element={<NotFoundPage />} />
          
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
