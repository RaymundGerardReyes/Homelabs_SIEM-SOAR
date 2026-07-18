# Principal Engineer Prompt Pack — "No Routes Matched" Router Gap Fix

This file documents the exact root cause of the `No routes matched location "..."` console warnings and provides Principal Engineer–level prompts to fully implement the missing routing logic in `soc-frontend/src`.

---

## 1. Root Cause Analysis

### What is actually happening

React Router's `<Routes>` component (via `useRoutes` internally) logs `No routes matched location "X"` whenever `navigate(x)` or a `<Link to={x}>` fires and `x` does not match **any** `<Route path="...">` currently registered in your router tree. This is a **routing configuration gap**, not a bug in React Router itself, and not a crash — the app stays on the previous screen silently while logging the warning.

### Why this happened

In the previous step, `Sidebar.tsx` was completed to call `navToPath(...)` / `navigate(...)` for every sub-menu item:

```text
/dashboard/executive
/dashboard/compliance
/detection/rules
/detection/ioc
/detection/feeds
/incidents/war-room
/assets/inventory
/assets/vulnerabilities
/assets/network-map
/endpoints/isolation
/endpoints/edr
/endpoints/hosts
/settings
/marketplace
```

However, **the corresponding `<Route>` entries and page components for these paths were never created** in your router configuration (typically `App.tsx`, `main.tsx`, or a dedicated `routes.tsx`). The navigation trigger (Sidebar) was finished, but the destination (Route + Page component) was not. This is exactly the kind of "half-wired" gap flagged in the earlier `soc-frontend` gap analysis — the sidebar link exists, but the actual page/feature it should open does not.

### Why it is not a hard crash

React Router intentionally does not throw when no route matches an internal `navigate()` call — it just renders nothing for that path change and warns to the console. This is why your app "works" but silently fails to show new content when clicking those Sidebar items.

### Full list of confirmed missing routes (from your log)

| Path | Intended Feature |
|---|---|
| `/dashboard/executive` | Executive Summary dashboard |
| `/dashboard/compliance` | Compliance dashboard |
| `/detection/rules` | Alert Rules management |
| `/detection/ioc` | IOC Search |
| `/detection/feeds` | Threat Feeds |
| `/incidents/war-room` | War Room (active major incident view) |
| `/assets/inventory` | Asset Inventory |
| `/assets/vulnerabilities` | Vulnerabilities view |
| `/assets/network-map` | Network Map |
| `/endpoints/isolation` | Isolation Controls |
| `/endpoints/edr` | EDR Logs |
| `/endpoints/hosts` | Host Management |
| `/settings` | Settings panel |
| `/marketplace` | Marketplace |

---

## 2. Master Prompt — Principal Frontend Engineer (Router Architecture Completion)

```text
You are a Principal Frontend Engineer completing the React Router configuration for a production SOC analyst console (React + TypeScript + react-router-dom v6+).

Current state:
- Sidebar.tsx already calls navigate() / <Link> for the following paths, but none of them have a matching <Route> registered anywhere in the app:
  /dashboard/executive
  /dashboard/compliance
  /detection/rules
  /detection/ioc
  /detection/feeds
  /incidents/war-room
  /assets/inventory
  /assets/vulnerabilities
  /assets/network-map
  /endpoints/isolation
  /endpoints/edr
  /endpoints/hosts
  /settings
  /marketplace
- This causes React Router to log "No routes matched location ..." for every one of these paths and silently render nothing.
- The existing working routes are only the Command Center (investigation dashboard) and Playbook Sandbox views, gated by ProtectedRoute.tsx.

Your task:
1. Design a complete, centralized route configuration (e.g., in App.tsx or a dedicated routes.tsx) that registers a <Route> for every path listed above, nested correctly under the existing ProtectedRoute wrapper so authentication/RBAC continues to apply.
2. For each route, create a minimal but structurally complete page component (e.g., ExecutiveDashboardPage, CompliancePage, AlertRulesPage, IocSearchPage, ThreatFeedsPage, WarRoomPage, AssetInventoryPage, VulnerabilitiesPage, NetworkMapPage, IsolationControlsPage, EdrLogsPage, HostManagementPage, SettingsPage, MarketplacePage) under a consistent folder structure (e.g., src/pages/<domain>/<PageName>.tsx).
3. Each page component must include, at minimum: a page header matching the Sidebar's label, a loading state, an empty/no-data state, and a clearly marked placeholder section indicating which backend endpoint it is expected to consume (e.g., "Data source: GET /api/assets/inventory") so future implementation is unambiguous.
4. Add a catch-all <Route path="*"> that renders a proper "404 / Not Found" page instead of allowing any future unmapped Sidebar link to silently fail with a console warning.
5. Ensure lazy-loading (React.lazy + Suspense) is used for these new page components so the initial bundle size does not balloon as more pages are added.
6. Verify that every path referenced in Sidebar.tsx has a 1:1 matching <Route path> entry — produce a checklist confirming this mapping explicitly.

Return the complete route configuration file, the folder/file structure for all new page components, and one representative fully-implemented page component (choose AssetInventoryPage) as a concrete example others should follow.
```

---

## 3. Individual Feature-Completion Prompts (One Per Missing Route)

### Prompt — Executive Dashboard (`/dashboard/executive`)

```text
You are a Principal Frontend Engineer implementing the Executive Summary dashboard page for a SOC analyst console at route /dashboard/executive.

This page must:
1. Fetch and display high-level, non-technical KPIs suited for leadership: total incidents this month, mean time to detect (MTTD), mean time to respond (MTTR), risk trend over time (chart), and top 5 threat categories.
2. Consume a backend endpoint such as GET /api/dashboards/executive-summary, with typed TypeScript interfaces for the response shape.
3. Include loading skeletons, an error state with retry, and empty-state messaging if no data exists yet for a new tenant.
4. Use a chart library already present in the project (or specify exactly which one to add) to render the risk trend line chart.
5. Be fully responsive and match the existing dark SOC console visual theme used in CommandCenter.tsx.

Return the complete ExecutiveDashboardPage.tsx component and its associated data-fetching hook.
```

### Prompt — Compliance Dashboard (`/dashboard/compliance`)

```text
You are a Principal Frontend Engineer implementing the Compliance dashboard page at route /dashboard/compliance.

This page must:
1. Display compliance framework coverage (e.g., ISO 27001, SOC 2, NIST CSF, PCI-DSS) as progress/coverage indicators.
2. Fetch data from a backend endpoint such as GET /api/dashboards/compliance-status, including per-control pass/fail/partial status.
3. Support drill-down: clicking a framework expands a list of individual controls with their current status and last-audit timestamp.
4. Include an "Export Compliance Report" action that calls a backend export endpoint and triggers a file download.
5. Include loading, error, and empty states consistent with the rest of the app.

Return the complete CompliancePage.tsx component.
```

### Prompt — Alert Rules (`/detection/rules`)

```text
You are a Principal Frontend Engineer implementing the Alert Rules management page at route /detection/rules.

This page must:
1. List all correlation/detection rules from the backend (GET /api/detection/rules), showing rule name, severity, status (enabled/disabled), and last-triggered timestamp.
2. Support toggling a rule's enabled/disabled state (PATCH /api/detection/rules/{id}) with optimistic UI update and rollback on failure.
3. Support creating and editing a rule via a form or code-editor modal (rule logic may be expressed as a DSL/JSON — define a minimal schema if none exists yet).
4. Require confirmation (reuse TwoKeyModal.tsx if the rule is flagged high-impact, e.g., auto-response rules) before disabling a rule that is actively suppressing a known threat category.
5. Include pagination or virtualization if the rule list can exceed 100 entries.

Return the complete AlertRulesPage.tsx component.
```

### Prompt — IOC Search (`/detection/ioc`)

```text
You are a Principal Frontend Engineer implementing the IOC (Indicator of Compromise) Search page at route /detection/ioc.

This page must:
1. Provide a search bar supporting IP addresses, domains, file hashes (MD5/SHA1/SHA256), and URLs, with clear input-type auto-detection or a type selector.
2. Query a backend endpoint such as GET /api/detection/ioc-search?query={value}&type={type}, reusing the same threat-intel aggregation pattern already implemented in ThreatIntelPanel.tsx (real API, partial-failure handling, request cancellation).
3. Display results in a structured table: source feed, verdict (malicious/suspicious/clean/unknown), confidence score, and last-seen date.
4. Support "Pivot to Investigation" — clicking a malicious result should be able to open or create a related investigation session.
5. Persist recent searches (client-side, e.g., last 10) for quick re-query.

Return the complete IocSearchPage.tsx component.
```

### Prompt — Threat Feeds (`/detection/feeds`)

```text
You are a Principal Frontend Engineer implementing the Threat Feeds management page at route /detection/feeds.

This page must:
1. List configured threat intelligence feed sources (e.g., AlienVault OTX, Abuse.ch, MISP, custom STIX/TAXII feeds) with connection status (healthy/degraded/down) and last-sync timestamp.
2. Fetch feed status from GET /api/detection/feeds and support manually triggering a re-sync (POST /api/detection/feeds/{id}/sync) with a visible in-progress state.
3. Support adding a new feed source via a form (feed type, URL/API key, polling interval), with credentials never displayed in plaintext after initial entry.
4. Show recent IOC ingestion volume per feed (e.g., sparkline of IOCs/day for the last 7 days).
5. Include clear error states if a feed authentication fails, with actionable guidance (e.g., "API key expired — update credentials").

Return the complete ThreatFeedsPage.tsx component.
```

### Prompt — War Room (`/incidents/war-room`)

```text
You are a Principal Frontend Engineer implementing the Incident War Room page at route /incidents/war-room, for coordinating major/critical active incidents.

This page must:
1. Display all incidents currently flagged as "major" or "critical" severity in a live-updating list (poll or WebSocket-based), each showing assigned responders, current status, and elapsed time since declaration.
2. Provide a shared timeline/activity feed per incident where responders can post updates, reusing the "Immutable Agent Log" visual pattern from InvestigationDashboard.tsx but allowing human-authored entries alongside agent-authored ones.
3. Support declaring a new major incident (linking one or more existing alerts/investigations to it) and resolving/closing an incident with a mandatory post-incident summary field.
4. Show a responder roster with online/offline presence indicators if the backend supports presence data; otherwise stub this clearly as a future integration point.
5. Ensure this page updates in real time without requiring a manual refresh, using the same WebSocket reconnect/backoff pattern established in InvestigationGraph.tsx.

Return the complete WarRoomPage.tsx component.
```

### Prompt — Asset Inventory (`/assets/inventory`)

```text
You are a Principal Frontend Engineer implementing the Asset Inventory page at route /assets/inventory.

This page must:
1. Fetch and display all known assets (servers, workstations, cloud resources, network devices) from GET /api/assets/inventory, with columns for hostname/identifier, type, owner, criticality tier, and last-seen timestamp.
2. Support filtering by asset type, criticality, and search-by-name/IP.
3. Support pagination or virtualized scrolling for large inventories (assume potentially 10,000+ assets).
4. Clicking an asset opens a detail drawer/panel showing associated alerts, vulnerabilities, and recent activity for that asset (cross-linking to /assets/vulnerabilities and investigations where applicable).
5. Include loading, error, and empty states, and clearly mark this as the canonical source of truth for asset criticality used elsewhere in the platform (e.g., in TwoKeyModal risk assessment).

Return the complete AssetInventoryPage.tsx component in full, as this will also serve as the reference implementation pattern for the remaining page components.
```

### Prompt — Vulnerabilities (`/assets/vulnerabilities`)

```text
You are a Principal Frontend Engineer implementing the Vulnerabilities page at route /assets/vulnerabilities.

This page must:
1. Fetch vulnerability findings from GET /api/assets/vulnerabilities, showing CVE ID, affected asset, CVSS score, severity, patch status, and discovery date.
2. Support sorting/filtering by severity and patch status, with a clear visual distinction for critical unpatched vulnerabilities.
3. Support bulk-selecting vulnerabilities to generate a remediation ticket (integration stub if no ticketing backend exists yet — clearly mark as a future integration point).
4. Link each finding back to its affected asset (cross-link to /assets/inventory) and, if applicable, to any active exploitation alert.
5. Include loading, error, and empty states.

Return the complete VulnerabilitiesPage.tsx component.
```

### Prompt — Network Map (`/assets/network-map`)

```text
You are a Principal Frontend Engineer implementing the Network Map page at route /assets/network-map.

This page must:
1. Visualize network topology (assets and their connections/subnets) fetched from GET /api/assets/network-map, using a graph visualization approach consistent with the one specified for InvestigationGraph.tsx (reuse the same graph library/approach for consistency).
2. Support zoom/pan and node clustering by subnet or asset criticality to remain usable at scale.
3. Color-code nodes by current risk/alert status (e.g., red for assets with active critical alerts).
4. Clicking a node opens the same asset detail drawer pattern used in AssetInventoryPage.tsx.
5. Include a graceful fallback/error state if topology data is unavailable, rather than rendering a blank canvas.

Return the complete NetworkMapPage.tsx component, explicitly noting the shared graph-rendering utility it should reuse from InvestigationGraph.tsx.
```

### Prompt — Isolation Controls (`/endpoints/isolation`)

```text
You are a Principal Application Security Engineer and Frontend Engineer implementing the Endpoint Isolation Controls page at route /endpoints/isolation.

This page must:
1. List endpoints eligible for network isolation, fetched from GET /api/endpoints/isolation-candidates, with current isolation status (isolated/not isolated) per host.
2. Treat "Isolate Host" as a destructive, high-risk action: it MUST route through the existing TwoKeyModal.tsx exact-match confirmation flow before calling the isolation API (POST /api/endpoints/{id}/isolate), consistent with the governance pattern established in InvestigationDashboard.tsx.
3. Provide a "Release Isolation" action, also gated by TwoKeyModal since restoring network access to a potentially still-compromised host is equally risky.
4. Show an audit trail of isolation/release actions per host, including who/what triggered each action and when.
5. Include clear, unambiguous status indicators (e.g., a persistent red banner) for any endpoint currently isolated, so analysts never lose track of active isolations.

Return the complete IsolationControlsPage.tsx component with TwoKeyModal wiring fully implemented.
```

### Prompt — EDR Logs (`/endpoints/edr`)

```text
You are a Principal Frontend Engineer implementing the EDR Logs page at route /endpoints/edr.

This page must:
1. Fetch and display endpoint detection and response event logs from GET /api/endpoints/edr-logs, with filters for host, event type (process execution, file modification, registry change, network connection), and time range.
2. Support virtualized/paginated rendering for high-volume log data (assume high EPS similar to the ingestion core's throughput expectations).
3. Allow clicking a log entry to expand full event details (raw JSON or structured key-value view).
4. Support pivoting from a suspicious log entry directly into a new or existing investigation (reusing the investigation session creation flow).
5. Include loading, error, and empty states, and a live-tail toggle (WebSocket-based) for real-time log streaming per host, reusing the reconnect/backoff pattern from InvestigationGraph.tsx.

Return the complete EdrLogsPage.tsx component.
```

### Prompt — Host Management (`/endpoints/hosts`)

```text
You are a Principal Frontend Engineer implementing the Host Management page at route /endpoints/hosts.

This page must:
1. Fetch and display all managed endpoint hosts from GET /api/endpoints/hosts, showing hostname, OS, agent version, agent health status, and last check-in time.
2. Flag hosts with outdated agent versions or stale check-ins (e.g., no check-in in 24h) with a clear warning indicator.
3. Support triggering an agent update/restart action per host, gated by standard (non-destructive) confirmation, not the full TwoKeyModal (since this is operational, not destructive).
4. Cross-link each host to its EDR logs (/endpoints/edr filtered by host) and isolation status (/endpoints/isolation).
5. Include loading, error, and empty states, plus search/filter by hostname, OS, or health status.

Return the complete HostManagementPage.tsx component.
```

### Prompt — Settings (`/settings`)

```text
You are a Principal Frontend Engineer implementing the Settings page at route /settings, replacing the current placeholder alert() triggered from Sidebar.tsx.

This page must:
1. Provide sections for: user profile (name, role/tier, email), notification preferences, API key/token management (view masked keys, revoke, regenerate), and platform-level preferences (theme, timezone, default dashboard view).
2. Fetch current settings from GET /api/settings and persist changes via PATCH /api/settings, with clear save/discard states and optimistic UI feedback.
3. Restrict certain sections (e.g., API key management, platform-wide preferences) to specific roles/tiers, reusing the RBAC pattern established in ProtectedRoute.tsx's allowedRoles prop.
4. Include field-level validation (e.g., valid email format, timezone selection from a known list) with inline error messaging.
5. Include a clear "Danger Zone" section (e.g., revoke all sessions) requiring the same TwoKeyModal-style exact-match confirmation used elsewhere for destructive actions.

Return the complete SettingsPage.tsx component.
```

### Prompt — Marketplace (`/marketplace`)

```text
You are a Principal Frontend Engineer implementing the Marketplace page at route /marketplace, replacing the current placeholder alert() triggered from Sidebar.tsx.

This page must:
1. Display a catalog of installable/available integrations and playbook templates (e.g., additional threat-intel feed connectors, prebuilt SOAR playbooks, detection rule packs), fetched from GET /api/marketplace/listings.
2. Support browsing by category and searching by name/tag, with each listing showing name, description, publisher, and installation status (installed/not installed).
3. Support "Install" / "Uninstall" actions per listing (POST /api/marketplace/listings/{id}/install), with clear success/failure feedback.
4. For playbook template listings specifically, support a preview of the playbook source before installation, reusing the code-viewer component built for PlaybookSandbox.tsx.
5. Include loading, error, and empty states, and clearly mark any listing that requires elevated permissions to install.

Return the complete MarketplacePage.tsx component.
```

---

## 4. Cross-Cutting Verification Prompt

```text
You are a Principal Frontend Engineer performing final verification that every Sidebar.tsx navigation target now resolves to a real, rendering route with no "No routes matched" console warnings remaining.

Your task:
1. Enumerate every path referenced anywhere in Sidebar.tsx (via navigate() calls or <Link to> props).
2. Cross-reference each path against the centralized route configuration (App.tsx / routes.tsx) and confirm a 1:1 match, including exact casing and leading slashes.
3. For any path found in Sidebar.tsx with no matching route, either add the missing <Route> and page component, or correct the Sidebar path if it was simply a typo/mismatch against an already-existing route.
4. Confirm the catch-all <Route path="*"> "Not Found" page renders correctly for any deliberately invalid test path (e.g., /this-does-not-exist).
5. Produce a final verification table listing every Sidebar path, its matched route status (MATCHED / FIXED / ADDED), and the corresponding page component file.

Return the verification table and confirm zero "No routes matched" warnings remain when every Sidebar item is clicked in sequence.
```

---

## 5. Requirement Traceability Summary

| Route | Feature | Governance Needed | Status Before | Status After Prompted Fix |
|---|---|---|---|---|
| /dashboard/executive | Executive Summary | None | Missing route | Implemented with KPIs + chart |
| /dashboard/compliance | Compliance | None | Missing route | Implemented with drill-down + export |
| /detection/rules | Alert Rules | TwoKeyModal for high-impact rules | Missing route | Implemented with toggle + editor |
| /detection/ioc | IOC Search | None | Missing route | Implemented with pivot-to-investigation |
| /detection/feeds | Threat Feeds | None | Missing route | Implemented with sync + health status |
| /incidents/war-room | War Room | None | Missing route | Implemented with live timeline |
| /assets/inventory | Asset Inventory | None | Missing route | Implemented (reference pattern) |
| /assets/vulnerabilities | Vulnerabilities | None | Missing route | Implemented with remediation stub |
| /assets/network-map | Network Map | None | Missing route | Implemented with graph reuse |
| /endpoints/isolation | Isolation Controls | TwoKeyModal mandatory | Missing route | Implemented with full governance |
| /endpoints/edr | EDR Logs | None | Missing route | Implemented with live-tail |
| /endpoints/hosts | Host Management | Standard confirm | Missing route | Implemented with health flags |
| /settings | Settings | RBAC + TwoKeyModal for danger zone | Placeholder alert() | Implemented full settings page |
| /marketplace | Marketplace | Permission-gated installs | Placeholder alert() | Implemented full catalog page |
