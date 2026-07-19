# Principal Engineer Redevelopment Plan — SOC Frontend (Feature-Sliced Design)

This document provides a precise, robust, Principal Engineer–level redevelopment plan for every feature and page described in the two architecture interpretation documents (`features/` domain UI and `pages/` routing layer). Each section includes a ready-to-use prompt structured for direct execution by an engineering agent or team, sequenced by dependency order so the platform is built on a stable foundation first.

---

## 0. Redevelopment Strategy & Sequencing

Before writing feature code, the build must proceed in the following dependency-safe order, because later features assume earlier infrastructure exists:

1. **Foundation layer** — shared API client, auth/token handling, shared types, shared UI primitives (buttons, tables, modals, loading/error states), theme tokens.
2. **Auth & Layouts** — `Login`, `ProtectedRoute`, `Sidebar` (gatekeeping and navigation must work before any feature page is reachable).
3. **Investigations domain** — `CommandCenter`, `InvestigationDashboard`, `InvestigationGraph`, `ThreatIntelPanel` (the mission-critical core).
4. **Playbooks domain** — `PlaybookSandbox` (depends on backend sandbox execution API).
5. **Pages layer** — all `pages/` routes, each composed from the features above plus new page-specific data.
6. **Platform utilities** — `Settings`, `Profile`, `Marketplace`, `NotFound`.

Each phase below includes a Principal Engineer prompt. Use them in order; do not skip the Foundation layer prompt, since every other prompt assumes shared primitives already exist.

---

## 1. Foundation Layer

```text
You are a Principal Frontend Engineer establishing the shared foundation for a Feature-Sliced Design (FSD) SOC platform in soc-frontend/src, before any feature-specific work begins.

Deliverables:
1. shared/api/apiClient.ts — a single Axios (or fetch-based) client with:
   - Base URL from environment config.
   - Request interceptor that attaches the auth token (via a shared getAuthToken() utility, not raw localStorage calls scattered across files).
   - Response interceptor that handles 401 (redirect to /login) and 403 (redirect to /unauthorized) globally.
   - AbortController support exposed per-call for cancellable requests.
2. shared/auth/tokenService.ts — centralizes token storage, expiry decoding (JWT exp claclaim check), and a documented migration path to HttpOnly cookies.
3. shared/types/ — canonical TypeScript interfaces for Alert, Investigation, ActionInfo, Playbook, Asset, Incident, ThreatIntelResult, SystemMetrics, User, and Role, used by every feature/page (no per-component duplicate type definitions).
4. shared/ui/ — a small design-system layer: LoadingSkeleton, ErrorState (with retry callback), EmptyState, DataTable (paginated/virtualized), ConfirmModal (base for TwoKeyModal), Badge (severity/risk/status color-coded), and StatusDot (health indicators).
5. shared/hooks/ — useAsyncState<T> (loading/error/data pattern), usePolling(url, intervalMs), and useWebSocketStream(url) with reconnect/exponential backoff built in once, for reuse by InvestigationGraph, EdrLogsPage, and WarRoomPage.
6. shared/theme/ — dark SOC visual theme tokens (colors for severity S1-S4, risk levels, status states) as a single source of truth so every feature applies consistent styling instead of ad hoc Tailwind classes per component.

Constraints:
- No feature-level component should implement its own token-fetching, WebSocket reconnect, or loading/error UI from scratch — all must consume these shared utilities.
- Provide full TypeScript typing; no implicit any.

Return the complete file structure and implementation for every file listed above.
```

---

## 2. Auth & Layouts

### 2.1 `Login.tsx`

```text
You are a Principal Frontend Engineer building Login.tsx for an enterprise SOC platform, consuming shared/api/apiClient.ts and shared/auth/tokenService.ts from the foundation layer.

Visual/UX requirements (from design spec):
- A premium, centralized authentication card with glassmorphism/glowing border styling consistent with the dark SOC theme.
- Fields: email/username, password, with inline validation (required, format check).
- Support for MFA/TOTP second-factor entry if the backend returns a "mfa_required" challenge on first login attempt.

Functional requirements:
1. POST credentials to /api/auth/login; on success, store the returned token via tokenService and redirect to the analyst's default landing page (respecting a "redirect" query param set by ProtectedRoute when it bounced an unauthenticated user).
2. Handle and display authentication errors (invalid credentials, account locked, MFA required) with specific, non-generic messaging.
3. Show a loading state on the submit button during the request, and disable the form to prevent double submission.
4. Include "Forgot password" link (stub route acceptable, but must not be dead — link to /auth/forgot-password with a placeholder page noted for future backend integration).
5. Fully keyboard-accessible (tab order, Enter submits form, focus on first invalid field on error).

Return the complete Login.tsx and any MFA sub-component required.
```

### 2.2 `ProtectedRoute.tsx`

```text
You are a Principal Application Security Engineer finalizing ProtectedRoute.tsx, building on the prior security remediation (JWT expiry check, RBAC via allowedRoles prop, documented HttpOnly cookie migration path).

Requirements:
1. Confirm ProtectedRoute wraps every authenticated route in the centralized router config (from the prior routing completion work), not just the Command Center.
2. Ensure ProtectedRoute captures the attempted path and appends it as a redirect query param when bouncing to /login, so Login.tsx can send the analyst back to their original destination after successful auth.
3. Add a silent session-refresh check on app mount (call a lightweight /api/auth/session endpoint) so a still-valid session is confirmed server-side, not just via client-side token expiry decoding.
4. Ensure allowedRoles-based denial renders a clear /unauthorized page (not a blank screen or silent redirect to Login) when a valid but insufficiently-privileged user hits a restricted route.

Return the complete ProtectedRoute.tsx plus the minimal UnauthorizedPage.tsx it depends on.
```

### 2.3 `Sidebar.tsx`

```text
You are a Principal Frontend Engineer finalizing Sidebar.tsx as the persistent master navigation drawer, building on the earlier routing-completion work (all 14 previously-missing routes now exist).

Visual/UX requirements:
- Vertical dark-glass panel locked to the left, with icons for Command Center, Playbook Sandbox, Detection, Assets, Endpoints, Incidents, Dashboards, Marketplace, Settings.
- A global search palette trigger (Cmd/Ctrl+K) that dims the background and opens a centered command palette (fuzzy-searchable across pages, recent alerts, and recent investigations).
- A user profile avatar at the bottom showing the analyst's display name and role/tier, with a dropdown for Profile, Settings, and Logout.

Functional requirements:
1. Implement the command palette using a lightweight fuzzy-search (e.g., a simple client-side filter over a static route+label list combined with a debounced API search for alerts/investigations).
2. Active-route highlighting must work for nested routes (e.g., /assets/inventory highlights the "Assets" parent and "Inventory" child simultaneously).
3. Logout must clear the token via tokenService, invalidate the session server-side (POST /api/auth/logout), and redirect to /login.
4. Ensure RBAC-aware rendering: hide or disable menu items the current user's role cannot access, using the same role claim already decoded in ProtectedRoute.

Return the complete Sidebar.tsx including the command palette sub-component.
```

---

## 3. Investigations Domain (`features/investigations/ui/`)

### 3.1 `CommandCenter.tsx`

```text
You are a Principal Frontend Engineer rebuilding CommandCenter.tsx as the SOC's real-time "birds-eye view," replacing all previously hardcoded KPI values with live data via the shared useAsyncState and usePolling hooks.

Visual requirements:
- Dark-themed dashboard with a glowing metric ring/orb showing total alerts scanned and GB ingested in the last 24h.
- Auto-updating grid/list of high-priority alerts with severity badges (S1-S4) using the shared Badge component.
- Clicking an alert routes the analyst into InvestigationDashboard for that alert's ID.

Functional requirements:
1. Fetch SystemMetrics from GET /api/metrics/overview on mount and refresh every 30s via usePolling; render the metric ring/orb driven by these real numbers with Intl.NumberFormat formatting.
2. Fetch the active alerts feed from GET /api/alerts?status=open&sort=severity, live-updating via useWebSocketStream for new incoming alerts without a full page refresh (new alerts animate into the top of the list).
3. Implement LoadingSkeleton for the KPI ring and alert list during initial load, and ErrorState with retry if either fetch fails.
4. Severity badge colors must map exactly to the shared theme tokens (S1=critical red, S2=high orange, S3=medium yellow, S4=low blue) for consistency across the whole app.
5. Support client-side filtering/sorting of the alert grid (by severity, alert type, time) without re-fetching.

Return the complete CommandCenter.tsx and the useSystemMetrics/useAlertsFeed hooks it depends on.
```

### 3.2 `InvestigationDashboard.tsx`

```text
You are a Principal Frontend Engineer rebuilding InvestigationDashboard.tsx as the split-pane investigation hub, integrating the previously-specified loading/error states and TwoKeyModal risk-gating.

Visual requirements:
- Split-pane layout: left pane is the immutable, auto-scrolling "Agent Log" (streaming AI reasoning/telemetry); right pane is "Proposed Actions" with aggressive red highlighting for high-risk actions.

Functional requirements:
1. On mount, fetch the investigation record via GET /api/investigations/{alertId}; show LoadingSkeleton while pending and ErrorState with retry on failure.
2. Stream new agent log entries via useWebSocketStream subscribed to /ws/investigations/{alertId}, appending to the immutable log with auto-scroll that respects the analyst's manual scroll position if they've scrolled up.
3. For each proposed action, branch on risk level: low/medium risk actions call handleActionApprove directly with an inline confirmation toast; high/critical risk actions open the shared TwoKeyModal (exact-match target confirmation) before calling handleActionApprove.
4. Wire the "Back to Command Center" control to clearSelection, and ensure it is visibly placed in the header, not just passed as an unused prop.
5. Each agent log entry with confidence below a configurable threshold (default 70%) must render a "Low Confidence" warning badge inline, matching the existing design intent.

Return the complete InvestigationDashboard.tsx with full state-machine handling (loading, streaming, error, action-approval) explicit in the code.
```

### 3.3 `InvestigationGraph.tsx`

```text
You are a Principal Frontend Engineer rebuilding InvestigationGraph.tsx as a true interactive node/edge graph, replacing the previous flat-list rendering.

Visual requirements:
- Interactive canvas with nodes (agents/steps) and edges (execution flow/provenance).
- Nodes pulse yellow while running, turn green on success, red on failure.
- Clicking a node opens a popover with exactly what that agent step accomplished (inputs, outputs, duration, confidence).

Functional requirements:
1. Use a force-directed or DAG graph rendering library (react-force-graph, reactflow, or a custom D3-force + SVG/Canvas implementation — pick one and justify briefly) to render nodes/edges from the investigation's execution trace data.
2. Subscribe to live updates via the shared useWebSocketStream hook (with built-in reconnect/backoff) so node status transitions (running -> success/failed) animate in real time without a full re-fetch.
3. Batch incoming WebSocket updates on a ~250ms throttle window to avoid render storms under high-frequency agent activity, preserving the previously-established batching pattern.
4. Validate the auth token's expiry before opening the WebSocket connection; if expired, redirect to re-authentication instead of silently sending a stale token.
5. Show a connection-status indicator ('connecting' | 'live' | 'reconnecting' | 'disconnected') replacing any static "LIVE" label, and a visible error banner with manual retry if the historical snapshot fetch fails.
6. Node click opens a side panel/popover (not a full navigation) showing structured step details, keeping the analyst's graph view context intact.

Return the complete InvestigationGraph.tsx, explicitly naming the graph-rendering library assumed, plus the node-detail popover sub-component.
```

### 3.4 `ThreatIntelPanel.tsx`

```text
You are a Principal Full-Stack Engineer rebuilding ThreatIntelPanel.tsx to replace all mocked data with real backend threat-intel enrichment.

Visual requirements:
- Structured dashboard-widget card with a prominent Global Risk Score badge (e.g., 9/10 in bright red for high risk).
- Sub-sections for AlienVault OTX (tags, reputation) and Abuse.ch (malware family/signatures).

Functional requirements:
1. Fetch enrichment data from GET /api/threat-intel/enrich?ip={ipAddress} using the shared apiClient (with auth and abort support already built in).
2. Handle partial source failures gracefully: if one feed (e.g., Abuse.ch) times out or errors while AlienVault OTX succeeds, render available data and mark the failed source as "Unavailable," never blocking the entire panel.
3. Cancel in-flight requests via AbortController when ipAddress changes rapidly (e.g., analyst clicking through multiple alerts in InvestigationDashboard).
4. Compute and display the Global Risk Score as a weighted aggregate of available source scores (define and document the weighting formula), color-coded via the shared Badge component (red >= 7, orange 4-6.9, green < 4).
5. Show a full-failure ErrorState with retry only when all sources fail; otherwise show partial data with per-source unavailability markers.

Return the complete ThreatIntelPanel.tsx with real fetch logic, partial-failure handling, cancellation, and the documented risk-score aggregation formula.
```

---

## 4. Playbooks Domain (`features/playbooks/ui/`)

### 4.1 `PlaybookSandbox.tsx`

```text
You are a Principal Full-Stack Engineer rebuilding PlaybookSandbox.tsx as a secure, IDE-like sandbox execution interface for Python SOAR playbooks.

Visual requirements:
- Left sidebar listing available playbooks.
- Central dark-themed, syntax-highlighted code viewer for the selected playbook's Python source.
- A "▶ Run in Sandbox" button that, when clicked, slides up a black terminal panel streaming live stdout as the script executes.

Functional requirements:
1. Fetch the playbook list from GET /api/playbooks and the selected playbook's source from GET /api/playbooks/{id}/source, rendering it in a syntax-highlighted viewer (Monaco Editor preferred for read-only display with Python highlighting; a lighter highlight.js-based viewer is an acceptable fallback — justify the choice).
2. Replace any single-shot "run and wait" execution with a streaming model: open a WebSocket/SSE connection to /api/playbooks/{id}/execute/stream and append output lines to the terminal in real time, auto-scrolling as new lines arrive.
3. Show explicit execution status (queued -> running -> success/failed) with elapsed time, and on completion, exit code and total duration.
4. Disable "Run in Sandbox" while an execution is in progress for the selected playbook; provide a "Stop Execution" control wired to a cancel endpoint if supported by the backend.
5. Persist the last execution's output/status per playbook in local component state (keyed by playbook id) so switching playbooks and back does not lose the most recent run's results.

Return the complete PlaybookSandbox.tsx including the code-viewer and streaming-terminal sub-components.
```

---

## 5. Pages Layer (`src/pages/`)

### 5.1 Dashboards — `ExecutiveDashboardPage.tsx` & `CompliancePage.tsx`

```text
You are a Principal Frontend Engineer building the two dashboard pages for leadership-level SOC reporting, composing shared/ui primitives rather than duplicating UI logic.

ExecutiveDashboardPage.tsx requirements:
1. Fetch from GET /api/dashboards/executive-summary: total incidents this month, MTTD, MTTR, risk trend over time, top 5 threat categories.
2. Render large, boardroom-ready charts (risk trend line chart, top-threats bar chart) using a chart library already available in the project (state which one; add Recharts or a similarly lightweight library if none exists).
3. Include loading skeletons, error state with retry, and an empty-state message for new tenants with no historical data yet.

CompliancePage.tsx requirements:
1. Fetch from GET /api/dashboards/compliance-status: per-framework (ISO 27001, SOC 2, NIST CSF, PCI-DSS) coverage percentages and per-control pass/fail/partial status.
2. Render framework-level progress indicators that expand into a per-control checklist (green check / red warning) on click.
3. Include an "Export Compliance Report" action calling a backend export endpoint and triggering a file download, with a loading state on the export button while the file is generated.

Return both complete page components plus any shared ChartCard or ComplianceChecklist sub-components they share.
```

### 5.2 Detection Engineering — `AlertRulesPage.tsx`, `IocSearchPage.tsx`, `ThreatFeedsPage.tsx`

```text
You are a Principal Frontend Engineer building the three Detection Engineering pages, reusing the shared DataTable, Badge, and TwoKeyModal primitives.

AlertRulesPage.tsx requirements:
1. List detection rules from GET /api/detection/rules in the shared DataTable (paginated/virtualized), showing name, severity, enabled/disabled toggle, and last-triggered timestamp.
2. Toggling enabled/disabled calls PATCH /api/detection/rules/{id} with optimistic UI update and rollback on failure; disabling a rule flagged as high-impact (auto-response) requires TwoKeyModal confirmation first.
3. Support create/edit via a modal form or embedded code editor for rule DSL/JSON (define a minimal schema if the backend does not yet specify one).

IocSearchPage.tsx requirements:
1. Central search bar accepting IPs, domains, and hashes (MD5/SHA1/SHA256) with auto-detection of input type.
2. Query GET /api/detection/ioc-search?query={value}&type={type} reusing the same partial-failure and cancellation pattern established in ThreatIntelPanel.
3. Results table shows source feed, verdict, confidence score, last-seen date; malicious results support "Pivot to Investigation."
4. Persist the last 10 searches client-side for quick re-query.

ThreatFeedsPage.tsx requirements:
1. List feed sources from GET /api/detection/feeds with health status (healthy/degraded/down) via shared StatusDot, and last-sync timestamp.
2. Support manual re-sync (POST /api/detection/feeds/{id}/sync) with an in-progress state, and adding a new feed via a form that never displays credentials in plaintext after initial entry.
3. Show a 7-day IOC ingestion sparkline per feed, and clear, actionable error messaging for authentication failures (e.g., expired API key).

Return all three complete page components.
```

### 5.3 Endpoint Management — `HostManagementPage.tsx`, `IsolationControlsPage.tsx`, `EdrLogsPage.tsx`

```text
You are a Principal Application Security Engineer and Frontend Engineer building the three Endpoint Management pages.

HostManagementPage.tsx requirements:
1. Fetch fleet data from GET /api/endpoints/hosts (hostname, OS, agent version, health, last check-in) into the shared DataTable with search/filter.
2. Flag outdated agents or stale check-ins (>24h) with a clear warning indicator; support agent update/restart per host via standard (non-destructive) confirmation.
3. Cross-link each host row to its EDR logs and isolation status.

IsolationControlsPage.tsx requirements:
1. List isolation-eligible endpoints from GET /api/endpoints/isolation-candidates with current isolation status.
2. "Isolate Host" and "Release Isolation" MUST both route through TwoKeyModal exact-match confirmation before calling POST /api/endpoints/{id}/isolate or the release equivalent — no direct execution path is permitted for either action.
3. Persistent, unambiguous red banner for any endpoint currently isolated; full audit trail of isolate/release actions (who/what, when) visible per host.

EdrLogsPage.tsx requirements:
1. Fetch EDR telemetry from GET /api/endpoints/edr-logs with filters (host, event type, time range), virtualized/paginated for high volume.
2. Expandable raw/structured view per log entry; support "Pivot to Investigation" from a suspicious entry.
3. Live-tail toggle via the shared useWebSocketStream hook (reconnect/backoff already built in) for real-time per-host log streaming.

Return all three complete page components, explicitly confirming TwoKeyModal is wired for every destructive action in IsolationControlsPage.
```

### 5.4 Incident Response — `ActiveIncidentsPage.tsx`, `ClosedIncidentsPage.tsx`, `WarRoomPage.tsx`

```text
You are a Principal Frontend Engineer building the Incident Response pages as the SOC's ticketing and crisis-coordination system.

ActiveIncidentsPage.tsx & ClosedIncidentsPage.tsx requirements:
1. Fetch from GET /api/incidents?status=active or ?status=closed; render as a Kanban board (grouped by severity or assigned analyst) or a sortable list view (support toggling between the two views).
2. Each incident card shows severity, assigned analyst, time-to-resolution (TTR) for closed incidents, and elapsed time for active ones.
3. ClosedIncidentsPage must support filtering by resolution date range and exporting a summary CSV.

WarRoomPage.tsx requirements:
1. Live-updating list of major/critical incidents (poll or WebSocket) with assigned responders and elapsed time since declaration.
2. Shared timeline/activity feed per incident allowing human-authored updates alongside AI-agent-authored entries, visually distinguished (e.g., avatar vs. agent icon) but sharing the same immutable-log pattern as InvestigationDashboard.
3. Support declaring a new major incident (linking existing alerts/investigations) and resolving one with a mandatory post-incident summary field.
4. Responder presence indicators (online/offline) if the backend supports it; otherwise clearly stub this as a future integration point rather than fabricating fake presence data.

Return all three complete page components, and confirm WarRoomPage reuses the shared useWebSocketStream reconnect/backoff hook.
```

### 5.5 Asset Intelligence — `AssetInventoryPage.tsx`, `NetworkMapPage.tsx`, `VulnerabilitiesPage.tsx`

```text
You are a Principal Frontend Engineer building the Asset Intelligence pages, treating AssetInventoryPage as the canonical source of truth for asset criticality used elsewhere (e.g., TwoKeyModal risk context).

AssetInventoryPage.tsx requirements:
1. Fetch from GET /api/assets/inventory into a virtualized/paginated DataTable (hostname/identifier, type, owner, criticality tier, last-seen).
2. Filter by type/criticality and search by name/IP; clicking an asset opens a detail drawer showing associated alerts, vulnerabilities, and recent activity.

NetworkMapPage.tsx requirements:
1. Visualize topology from GET /api/assets/network-map reusing the same graph-rendering approach chosen for InvestigationGraph.tsx for visual and technical consistency.
2. Support zoom/pan, clustering by subnet/criticality, and color-coding nodes by active-alert risk status.
3. Clicking a node opens the same asset detail drawer used in AssetInventoryPage; show a graceful fallback if topology data fails to load (never a blank canvas).

VulnerabilitiesPage.tsx requirements:
1. Fetch from GET /api/assets/vulnerabilities (CVE ID, affected asset, CVSS score, severity, patch status, discovery date) into the shared DataTable with severity-based color coding (0.0-10.0 CVSS badge).
2. Support bulk-selecting findings to generate a remediation ticket (clearly stub as a future integration point if no ticketing backend exists).
3. Cross-link findings to the affected asset in AssetInventoryPage and to any active exploitation alert.

Return all three complete page components, and confirm NetworkMapPage explicitly reuses the InvestigationGraph rendering utility rather than duplicating graph logic.
```

### 5.6 Platform Utilities — `MarketplacePage.tsx`, `SettingsPage.tsx`, `ProfilePage.tsx`, `NotFoundPage.tsx`

```text
You are a Principal Frontend Engineer building the remaining Platform Utility pages.

MarketplacePage.tsx requirements:
1. Fetch integration/playbook-template listings from GET /api/marketplace/listings, browsable by category and searchable by name/tag, each showing name, description, publisher, and installed status.
2. Support Install/Uninstall (POST /api/marketplace/listings/{id}/install) with clear success/failure feedback; playbook-template listings preview their source via the same code-viewer component built for PlaybookSandbox.
3. Clearly mark listings requiring elevated permissions to install, gated by the RBAC role check already established in ProtectedRoute.

SettingsPage.tsx requirements:
1. Sections: profile, notification preferences, API key/token management (masked keys, revoke/regenerate), and platform preferences (theme, timezone, default dashboard view).
2. Fetch/persist via GET/PATCH /api/settings with save/discard states; restrict API-key and platform-wide sections by role using allowedRoles.
3. Include a "Danger Zone" (e.g., revoke all sessions) requiring TwoKeyModal-style exact-match confirmation.

ProfilePage.tsx requirements:
1. Display and allow editing of the analyst's own display name, avatar, and contact info; show read-only role/tier and account creation date.
2. Include a "Change Password" flow with current-password verification before allowing a new password to be set.

NotFoundPage.tsx requirements:
1. Custom 404 themed with cybersecurity visual language (e.g., "Resource encrypted or lost in the void"), with a clear "Return to Command Center" call-to-action link.
2. Must be registered as the catch-all <Route path="*"> in the centralized router so no future unmapped Sidebar link silently fails again.

Return all four complete page components.
```

---

## 6. Final Cross-Cutting Integration & QA Prompt

```text
You are a Principal Frontend Engineer and QA Lead performing final integration verification across the entire redeveloped soc-frontend/src FSD codebase (foundation layer, auth/layouts, investigations domain, playbooks domain, and all pages).

Verify and fix:
1. Every feature and page consumes the shared foundation utilities (apiClient, tokenService, useAsyncState, usePolling, useWebSocketStream, shared/ui primitives) — no component reimplements loading/error/auth/WebSocket logic independently.
2. Every destructive or high-risk action across the entire app (InvestigationDashboard actions, IsolationControlsPage, AlertRulesPage rule-disable, SettingsPage danger zone) routes through the shared TwoKeyModal with exact-match confirmation — audit and list every call site.
3. Every route referenced in Sidebar.tsx and the command palette has a matching, fully-implemented page component with no remaining placeholder/mocked data anywhere in the codebase.
4. Consistent dark SOC visual theme (severity/risk color tokens) is applied identically across CommandCenter, InvestigationDashboard, AlertRulesPage, VulnerabilitiesPage, and IsolationControlsPage.
5. TypeScript strictness: zero implicit any, all shared types imported from shared/types rather than redefined per component.
6. Produce a final feature-completion matrix (feature/page name, backend endpoint(s) consumed, governance control applied if any, and current implementation status) confirming the platform is fully wired end-to-end with no dead UI or mocked responses remaining.

Return the final feature-completion matrix as a markdown table.
```

---

## 7. Redevelopment Traceability Matrix

| Layer | Component/Page | Key Backend Endpoint(s) | Governance Control | Shared Utility Reuse |
|---|---|---|---|---|
| Foundation | apiClient, tokenService, shared/ui, shared/hooks | N/A | N/A | Base for all below |
| Auth/Layouts | Login.tsx | POST /api/auth/login | MFA challenge | apiClient, tokenService |
| Auth/Layouts | ProtectedRoute.tsx | GET /api/auth/session | RBAC allowedRoles | tokenService |
| Auth/Layouts | Sidebar.tsx | Search API (palette) | RBAC-aware rendering | apiClient |
| Investigations | CommandCenter.tsx | GET /api/metrics/overview, /api/alerts | None | usePolling, useWebSocketStream |
| Investigations | InvestigationDashboard.tsx | GET /api/investigations/{id} | TwoKeyModal (high/critical) | useWebSocketStream |
| Investigations | InvestigationGraph.tsx | WS /ws/investigations/{id} | Token expiry check | useWebSocketStream |
| Investigations | ThreatIntelPanel.tsx | GET /api/threat-intel/enrich | None | apiClient, AbortController |
| Playbooks | PlaybookSandbox.tsx | GET/POST /api/playbooks/* | None | apiClient, streaming hook |
| Pages/Dashboards | ExecutiveDashboardPage, CompliancePage | /api/dashboards/* | None | shared/ui charts |
| Pages/Detection | AlertRulesPage, IocSearchPage, ThreatFeedsPage | /api/detection/* | TwoKeyModal (rule disable) | DataTable |
| Pages/Endpoints | HostManagementPage, IsolationControlsPage, EdrLogsPage | /api/endpoints/* | TwoKeyModal (isolation, mandatory) | useWebSocketStream |
| Pages/Incidents | ActiveIncidentsPage, ClosedIncidentsPage, WarRoomPage | /api/incidents/* | None (Kanban/list) | useWebSocketStream |
| Pages/Assets | AssetInventoryPage, NetworkMapPage, VulnerabilitiesPage | /api/assets/* | None | Graph reuse from InvestigationGraph |
| Platform | MarketplacePage, SettingsPage, ProfilePage, NotFoundPage | /api/marketplace, /api/settings | TwoKeyModal (danger zone) | RBAC, code viewer reuse |
