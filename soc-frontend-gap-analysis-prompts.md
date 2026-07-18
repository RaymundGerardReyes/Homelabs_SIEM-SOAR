# Principal Engineer Prompt Pack — `soc-frontend/src` Gap Analysis & Completion Prompts

This file maps each component in `soc-frontend/src` against Functional Requirements (FR) and Non-Functional Requirements (NFR) for the Agentic SOC platform, flags exactly what is unfinished or mocked, and gives you one dedicated Principal Engineer prompt per component so you can complete each feature precisely.

---

## 0. Requirement Baseline Used for This Gap Analysis

**Functional Requirements (from your platform design)**
- FR1 — Log ingestion and normalized event display
- FR2 — Indexing, correlation, and alert generation
- FR3 — Agentic investigations (multi-agent triage/enrichment/investigation/response, live streaming)
- FR4 — Automation & extension (sandboxed Python playbooks, real execution, real output)
- FR5 — LLM agent API integration (triage, investigation session state, tool-calling)
- FR6 — Analyst console (dashboards, investigation timeline, workflow visualization, RBAC-aware UI)
- FR7 — Audit & governance (immutable logs, two-key approval for destructive actions, policy-gated execution)

**Non-Functional Requirements**
- NFR1 — Performance (60fps rendering even under high-volume streaming, batched state updates)
- NFR2 — Reliability (reconnect/backoff, graceful degradation, error boundaries)
- NFR3 — Security (no XSS-exposed tokens, RBAC enforcement, CSRF protection, secure WebSocket auth)
- NFR4 — Observability (loading/error states visible to analysts, traceable actions)
- NFR5 — Accessibility & UX (keyboard handling, focus management, confirmation clarity)

---

## 1. Component-by-Component Gap Findings

### 1.1 `Sidebar.tsx`
**Gap:** All sub-menu items (`Dashboards & Reports`, `Incident Response`, `Detection & Threat Intel`, `Assets`, `Endpoints`) render but call nothing — clicking any of them is not wired to routing. `handleUtilityClick` for Marketplace/Settings/Search/Notifications only shows a browser `alert()` placeholder. This violates FR6 (a real analyst console needs working navigation) and NFR5 (dead UI is a usability defect).

### 1.2 `CommandCenter-4.tsx`
**Gap:** KPI values (`2,404 ALERTS SCANNED`, `40 GB/24H`, `65 TB/24H`, `10` open incidents, `286.1K` prevented events) are hardcoded static JSX text, not sourced from any API, WebSocket, or props. This violates FR1/FR2 (real ingestion/correlation metrics) and NFR4 (observability must reflect real system state).

### 1.3 `InvestigationGraph-6.tsx`
**Gap:** No reconnect/backoff logic if the WebSocket drops mid-investigation (violates NFR2, despite the file's own comment claiming graceful fallback). No authentication token refresh — uses a raw `localStorage.getItem('token')` with no expiry handling (violates NFR3). No visual graph layout — nodes/edges are rendered as a linear list, not an actual force-directed/DAG graph despite being named `InvestigationGraph` (violates FR3/FR6). No error state shown to the analyst if the snapshot fetch fails (violates NFR4).

### 1.4 `TwoKeyModal-3.tsx`
**Gap:** No validation feedback when the typed input does not match `action.target` — the confirm button appears clickable regardless of correctness, only enforced logic is missing. No loading/disabled state while the approved action is in flight (risk of double-submission). No `Escape` key or focus-trap handling (violates NFR5, FR7 two-key control integrity).

### 1.5 `InvestigationDashboard-5.tsx`
**Gap:** No loading state while `investigation` is `null` and being fetched — UI just renders nothing. No error state if the investigation fetch fails. `clearSelection` prop is passed but not wired to any visible "Back/Close" control in the current JSX. High-risk proposed actions call `handleActionApprove` directly with no visible risk-gating — the `TwoKeyModal` two-key confirmation flow (FR7) is not actually invoked from this dashboard for high/critical risk actions.

### 1.6 `ThreatIntelPanel-2.tsx`
**Gap:** Entirely mocked — `useEffect` uses `setTimeout` and hardcoded fake JSON (`reputation: 85`, `malware_family: "Qakbot"`, etc.) instead of a real API call to the backend/SOAR threat-intel enrichment endpoint. This is a full FR3/FR5 stub, not a working feature.

### 1.7 `PlaybookSandbox-7.tsx`
**Gap:** No code editor for viewing/editing the actual Python playbook source (only playbook name/trigger metadata is shown). `runPlaybook` is a prop with no visible real-time log streaming — output appears to be set all-at-once rather than streamed, which won't reflect FR4's "sandboxed execution with live feedback." No execution status (running/success/failed/exit code) surfaced to the analyst (violates NFR4).

### 1.8 `ProtectedRoute-8.tsx`
**Gap:** Explicitly flagged in the file's own comments — token stored in `localStorage` (XSS-exposed, violates NFR3). No token expiry validation, no refresh-token flow, and no role/permission check (RBAC) despite the SOC console needing tiered analyst access (Tier 1/2/3, admin) per FR6/FR7.

---

## 2. Principal Engineer Completion Prompts (One Per Component)

### Prompt — Sidebar Navigation Completion

```text
You are a Principal Frontend Engineer completing the navigation logic in Sidebar.tsx for a production SOC analyst console (React + TypeScript + React Router).

Current state:
- SUB_MENUS renders "Dashboards & Reports", "Incident Response", "Detection & Threat Intel", "Assets", "Endpoints" with clickable sub-items, but none are wired to routing.
- handleUtilityClick for Marketplace, Settings, Search, and Notifications only fires a placeholder alert().

Requirements to satisfy:
- FR6: analyst console must provide real, working navigation to distinct views/routes.
- NFR5: no dead or placeholder UI in a production build.

Your task:
1. Wire each sub-menu item to a real React Router route (e.g., /incidents/active, /threat-intel/feeds, /assets/inventory) using useNavigate or Link, preserving the existing expand/collapse UI behavior.
2. Replace the alert()-based handleUtilityClick with real behavior: Settings should open a settings panel/route, Search should open a global search modal/command palette, Notifications should open a notification drawer backed by a real or stubbed API call structured for future integration.
3. Add active-route highlighting so the currently active menu item is visually distinct.
4. Ensure keyboard accessibility (tab order, Enter/Space to activate menu items).
5. Preserve existing prop contract (currentView, setCurrentView, resetAlertSelection) and extend only if necessary, documenting any new props.

Return the complete updated Sidebar.tsx with no omitted logic, plus a short list of any new routes that must be added to the router configuration.
```

---

### Prompt — CommandCenter Live Metrics Completion

```text
You are a Principal Frontend Engineer completing CommandCenter.tsx so it displays real, live platform metrics instead of hardcoded values.

Current state:
- "2,404 ALERTS SCANNED", "40 GB/24H", "65 TB/24H", "10" open incidents, and "286.1K" prevented events are static JSX text with no data source.

Requirements to satisfy:
- FR1/FR2: ingestion and correlation metrics must reflect real backend state.
- NFR4: observability — displayed numbers must be traceable to actual system telemetry.

Your task:
1. Define a typed metrics contract (e.g., interface SystemMetrics { alertsScanned: number; eventsIngestGB24h: number; dataIngestTB24h: number; openIncidents: number; preventedEvents: number; }).
2. Fetch this data from a backend metrics endpoint (e.g., GET /api/metrics/overview) on mount, and refresh it on an interval (e.g., every 30s) or via a WebSocket/SSE subscription if the backend supports live push.
3. Add loading skeleton states for each KPI card while data is being fetched, and an error state with retry if the fetch fails.
4. Replace all hardcoded numeric literals with values from the fetched SystemMetrics state, applying proper number formatting (e.g., Intl.NumberFormat) instead of manual string literals.
5. Keep the existing alerts list and viewInvestigation behavior unchanged, only replacing the static KPI section.

Return the complete updated CommandCenter.tsx including the metrics-fetching hook (as a separate useSystemMetrics custom hook if appropriate).
```

---

### Prompt — InvestigationGraph Reliability & Visualization Completion

```text
You are a Principal Frontend Engineer hardening InvestigationGraph.tsx for production reliability and completing its graph visualization.

Current state:
- WebSocket connects once with no reconnect/backoff logic if it drops mid-investigation.
- Auth uses a raw localStorage.getItem('token') with no expiry or refresh handling.
- Nodes/edges are rendered as a linear list, not an actual graph layout, despite the component name and header text implying a real investigation graph.
- No error state is shown to the analyst if the historical snapshot fetch fails.

Requirements to satisfy:
- NFR1: must sustain 60fps rendering under high-volume streaming (already partially addressed via the 250ms batch throttle — preserve this).
- NFR2: must reconnect automatically with exponential backoff on WebSocket disconnect, and clearly indicate connection status to the user.
- NFR3: token handling must not silently continue with an expired/invalid token.
- FR3/FR6: must render an actual node/edge graph layout (e.g., using a lightweight graph library such as react-force-graph, reactflow, or d3-force) instead of a flat list.

Your task:
1. Implement WebSocket reconnect logic: on ws.onclose or ws.onerror, retry with exponential backoff (e.g., 1s, 2s, 4s, capped at 30s), and expose a connectionStatus state ('connecting' | 'live' | 'reconnecting' | 'disconnected') rendered in the UI instead of the static "LIVE THROTTLED STREAM ACTIVE" label.
2. Wrap the token retrieval in a helper that checks expiry (if JWT) and triggers a redirect/refresh flow if expired, rather than silently sending an invalid token.
3. Replace the flat list rendering with an actual interactive graph visualization: nodes positioned by a force/DAG layout, edges drawn between source_id and target_id, node color/style driven by status ('success' | 'running' | 'failed'), and click-to-inspect node details in a side panel.
4. Add a visible error banner if the historical snapshot GET request fails, with a manual retry button.
5. Preserve the existing 250ms throttle batching mechanism for incoming WebSocket updates to avoid React re-render storms.

Return the complete updated InvestigationGraph.tsx, and name the exact graph-rendering library you are assuming is installed (or provide a pure SVG/Canvas fallback if no new dependency should be added).
```

---

### Prompt — TwoKeyModal Validation & Safety Completion

```text
You are a Principal Application Security Engineer and Frontend Engineer completing TwoKeyModal.tsx, the two-key confirmation control for destructive SOC actions.

Current state:
- The modal renders a text input asking the analyst to type the exact target name, but there is no visible enforcement preventing "EXECUTE ACTION" from being clicked if the input does not match action.target.
- No loading/disabled state exists while the confirmed action is being submitted to the backend.
- No Escape key handling or focus trap for accessibility and to prevent accidental dismissal during a critical decision.

Requirements to satisfy:
- FR7: destructive actions must require exact-match confirmation before execution; this is a governance control, not cosmetic UI.
- NFR3: prevent double-submission or bypass of the confirmation gate.
- NFR5: accessible modal behavior (focus trap, Escape to cancel, ARIA roles).

Your task:
1. Disable the "EXECUTE ACTION" button unless input.trim() === action.target exactly (case-sensitive), and show inline validation text (e.g., "Target name does not match") when the input is non-empty but incorrect.
2. Add an isSubmitting state: on confirm, disable both buttons, show a spinner/label change ("Executing..."), and only call onConfirm once per submission; re-enable controls only on error.
3. Add keyboard handling: Escape triggers onCancel, and trap focus within the modal while it is open (no tabbing to background elements).
4. Add appropriate ARIA attributes (role="alertdialog", aria-modal="true", aria-labelledby pointing to the "DANGER: DESTRUCTIVE ACTION" heading).
5. Ensure the input resets when the modal is closed and reopened for a different action (no stale input carried over between different action confirmations).

Return the complete updated TwoKeyModal.tsx with all validation, accessibility, and safety logic implemented precisely.
```

---

### Prompt — InvestigationDashboard State & Governance Completion

```text
You are a Principal Frontend Engineer completing InvestigationDashboard.tsx to correctly handle loading, error, and governance states.

Current state:
- When investigation is null (still loading), the dashboard renders nothing meaningful to the analyst.
- There is no error state if fetching the investigation fails.
- clearSelection is passed as a prop but has no wired "Back to Command Center" control visible in the current JSX.
- handleActionApprove is called directly from proposed action cards with no visible two-key confirmation gate for high/critical risk actions, even though a TwoKeyModal component already exists in the codebase.

Requirements to satisfy:
- FR3: investigation state (agent conversation log, proposed actions) must be clearly presented with real loading/error handling.
- FR7: any action classified as high or critical risk must route through the two-key confirmation modal before handleActionApprove is actually invoked.
- NFR4: analysts must always see accurate system state (loading, error, or loaded), never a blank or ambiguous screen.

Your task:
1. Add a distinct loading state (skeleton or spinner) shown while investigation is null and a fetch is in progress, and a distinct error state with a retry action if the fetch fails.
2. Wire clearSelection to a visible, clearly labeled "Back to Command Center" button in the header area.
3. Introduce a risk-gating layer: when an analyst clicks "Approve Action" on a proposed action with risk in ('high', 'critical'), open the existing TwoKeyModal component populated with that action instead of calling handleActionApprove directly; only call handleActionApprove after the modal's onConfirm fires with a validated exact-match input.
4. For low/medium risk actions, keep direct approval but still log a confirmation toast/snackbar so the analyst has clear feedback that the action was submitted.
5. Ensure the "Immutable Agent Log" section auto-scrolls to the latest entry as new conversation_log entries arrive, without disrupting the analyst's manual scroll position if they've scrolled up to review history.

Return the complete updated InvestigationDashboard.tsx, including the wiring to TwoKeyModal, with all state transitions explicit.
```

---

### Prompt — ThreatIntelPanel Real Backend Integration Completion

```text
You are a Principal Full-Stack Engineer replacing the mocked data in ThreatIntelPanel.tsx with a real backend integration.

Current state:
- useEffect uses setTimeout(..., 1500) and hardcoded fake data (alienvault_otx.reputation: 85, abuse_ch.malware_family: "Qakbot", overall_risk_score: 9.4) instead of any real API call.

Requirements to satisfy:
- FR3/FR5: threat intelligence enrichment must be sourced from real backend/SOAR integration (AlienVault OTX, Abuse.ch, MISP), not simulated.
- NFR2: must handle real network latency, timeouts, and partial data availability (not every feed will always return data).
- NFR4: must show accurate loading/error/partial-data states.

Your task:
1. Replace the setTimeout mock with a real API call, e.g., GET /api/threat-intel/enrich?ip={ipAddress}, using axios with proper Authorization header (reuse the existing token pattern from InvestigationGraph.tsx, but apply the token-expiry fix described for that component).
2. Handle partial failures gracefully: if AlienVault OTX succeeds but Abuse.ch times out, still render available data and mark the failed source as "Unavailable" rather than blocking the entire panel.
3. Add a distinct error state for total fetch failure (e.g., network error, 401, 500) with a retry button.
4. Add request cancellation (AbortController) so that if ipAddress changes rapidly (e.g., analyst clicking through multiple alerts), stale requests do not overwrite newer results.
5. Preserve the existing visual design (risk score badge, OTX panel, Abuse.ch/MISP panel) exactly, only replacing the data-fetching logic.

Return the complete updated ThreatIntelPanel.tsx with real fetch logic, partial-failure handling, and cancellation logic fully implemented.
```

---

### Prompt — PlaybookSandbox Real Execution & Streaming Completion

```text
You are a Principal Full-Stack Engineer completing PlaybookSandbox.tsx to support real sandboxed execution with live streaming output.

Current state:
- Playbooks are listed and selectable, but there is no code viewer/editor for the playbook's actual Python source.
- runPlaybook appears to produce output all at once rather than streaming logs live as the sandboxed container executes.
- No execution status (running, success, failed, exit code, duration) is surfaced to the analyst.

Requirements to satisfy:
- FR4: Python playbooks must execute in an isolated sandbox with live, real-time feedback to the analyst, not a single blocking result.
- NFR4: analysts must see clear execution state at every stage (queued, running, completed, failed).

Your task:
1. Add a read-only (or editable, if permissions allow) code viewer for the selected playbook's source using a lightweight syntax-highlighted component (e.g., Monaco Editor or a simpler highlight.js-based viewer), fetched from GET /api/playbooks/{id}/source.
2. Replace the single runPlaybook call-and-wait pattern with a streaming execution model: open a WebSocket or Server-Sent Events connection to /api/playbooks/{id}/execute/stream, append output lines to the terminal view as they arrive, and auto-scroll the output pane.
3. Add a visible execution status indicator (queued/running/success/failed) with elapsed time and, on completion, exit code and duration.
4. Disable the "Run in Sandbox" button while an execution is already in progress for the selected playbook, and show a "Stop Execution" control that calls a cancel endpoint if the backend supports it.
5. Persist the last execution's output and status per playbook (in local component state keyed by playbook id) so switching between playbooks and back does not lose the most recent run's results.

Return the complete updated PlaybookSandbox.tsx with the code viewer, streaming execution, and status indicator fully implemented.
```

---

### Prompt — ProtectedRoute Secure Auth & RBAC Completion

```text
You are a Principal Application Security Engineer completing ProtectedRoute.tsx to close the security gaps already flagged in the file's own inline comments.

Current state:
- Token is stored and read via localStorage.getItem('internal_access_token'), which is explicitly vulnerable to XSS as noted in the existing comments.
- No token expiry validation exists — any non-empty string in localStorage is treated as a valid session.
- No role-based access control (RBAC) exists, despite the platform requiring tiered analyst access (e.g., Tier 1/2/3 analyst, admin).

Requirements to satisfy:
- NFR3: authentication tokens must not be exposed to XSS-accessible storage in the target architecture; short-term mitigation and long-term migration path both required.
- FR7/FR6: certain routes/actions must be restricted by analyst role/tier.

Your task:
1. As an immediate mitigation (without a full backend rework), add JWT expiry validation: decode the token payload (without verifying signature client-side, since that must happen server-side) and check the exp claim; if expired, clear the token and redirect to /login exactly as the missing-token case does today.
2. Document and stub the migration path to HttpOnly, Secure, SameSite=Strict cookies issued by the backend on OAuth callback, replacing the localStorage pattern entirely — provide the exact backend response contract needed (e.g., Set-Cookie header pattern) as a comment block, since the actual cookie-setting must happen server-side.
3. Extend ProtectedRoute to accept an optional allowedRoles: string[] prop, decode the role/tier claim from the token, and render <Navigate to="/unauthorized" /> if the current user's role is not in allowedRoles, defaulting to allow-all when the prop is omitted for backward compatibility.
4. Ensure the OAuth callback token-interception logic (reading #access_token= from the URL hash) is not vulnerable to token leakage via browser history or referrer headers — confirm window.history.replaceState is called before any other logic that could trigger a re-render or redirect.
5. Add a session-expiry warning mechanism (e.g., check token expiry proactively every 60 seconds while the app is open, and prompt the analyst to re-authenticate before hard-redirecting) rather than only reacting on route change.

Return the complete updated ProtectedRoute.tsx with expiry validation, RBAC support, and the documented cookie-migration contract, clearly marking which parts require corresponding backend changes.
```

---

## 3. Cross-Cutting Completion Prompt (All Components Together)

```text
You are a Principal Frontend Engineer and Principal Application Security Engineer performing a final integration pass across Sidebar.tsx, CommandCenter.tsx, InvestigationGraph.tsx, TwoKeyModal.tsx, InvestigationDashboard.tsx, ThreatIntelPanel.tsx, PlaybookSandbox.tsx, and ProtectedRoute.tsx in soc-frontend/src, after each has been individually completed per its dedicated prompt.

Verify and fix:
1. Consistent authentication token handling and expiry logic across every component that makes an authenticated request (InvestigationGraph, ThreatIntelPanel, PlaybookSandbox) — extract a single shared useAuthToken or apiClient utility instead of duplicating localStorage logic in each file.
2. Consistent loading/error/empty-state UI patterns across CommandCenter, InvestigationDashboard, ThreatIntelPanel, and PlaybookSandbox so the analyst experience feels like one cohesive product, not eight disconnected components.
3. Consistent invocation of TwoKeyModal for every destructive or high-risk action across the app, not only from InvestigationDashboard, if other components (e.g., a future Endpoints/Isolation Controls view) also trigger destructive actions.
4. No component silently swallows fetch/WebSocket errors with only a console.error — every failure must surface to the analyst UI.
5. TypeScript strictness: eliminate any implicit any types introduced during completion, and ensure all new props/interfaces are fully typed and exported from a shared types.ts where appropriate.

Return a final consolidated list of shared utilities/hooks you introduced (e.g., useAuthToken, apiClient, useAsyncState) and confirm each of the eight components has been updated to use them consistently.
```

---

## 4. Requirement Traceability Summary

| Component | FR Covered | NFR Covered | Status Before | Status After Prompted Fix |
|---|---|---|---|---|
| Sidebar.tsx | FR6 | NFR5 | Dead navigation | Fully routed navigation |
| CommandCenter.tsx | FR1, FR2 | NFR4 | Static fake KPIs | Live metrics with loading/error states |
| InvestigationGraph.tsx | FR3, FR6 | NFR1, NFR2, NFR3 | No reconnect, flat list, no error state | Reconnect+backoff, real graph layout, token expiry check |
| TwoKeyModal.tsx | FR7 | NFR3, NFR5 | No enforced match, no a11y | Enforced validation, focus trap, submit lock |
| InvestigationDashboard.tsx | FR3, FR7 | NFR4 | No loading/error, no risk gating | Full state handling, TwoKeyModal wired for high risk |
| ThreatIntelPanel.tsx | FR3, FR5 | NFR2, NFR4 | Fully mocked | Real API, partial-failure handling, cancellation |
| PlaybookSandbox.tsx | FR4 | NFR4 | No code view, no streaming | Code viewer, streamed execution, status indicator |
| ProtectedRoute.tsx | FR6, FR7 | NFR3 | localStorage token, no RBAC, no expiry | Expiry check, RBAC support, cookie-migration path documented |
