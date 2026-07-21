# Principal Engineer Enhancement Plan — SOC Frontend Pages (Next-Level Development)

This document builds directly on the "SOC Frontend Pages Analysis" and defines, per module, exactly what still needs to be developed to elevate each page from "functionally complete" to genuinely production-grade, analyst-trusted, and audit-ready. Each section includes a precise Principal Engineer prompt covering the gaps not yet addressed: deep analytics, resilience, accessibility, performance at scale, cross-page intelligence, and measurable SOC outcomes.

---

## 0. Cross-Cutting Gaps Observed Across All Six Domains

Before module-specific prompts, five structural gaps recur across every domain in the current analysis and must be solved once, centrally, rather than six times:

1. **No cross-page correlation layer** — Assets, Incidents, Detection, and Endpoints all reference each other (asset criticality feeds risk scoring; IOC search should pivot into investigations; vulnerabilities should link to incidents) but nothing formalizes this as a shared "entity graph" the UI can traverse.
2. **No unified audit trail UI** — Every `TwoKeyModal`-gated action (rule disable, host isolation, session revocation) writes an audit record server-side, but there is no dedicated page where a SOC Manager can review the full cross-domain audit log.
3. **No saved views / analyst personalization** — Filters, table sort states, and dashboard layouts reset on every visit; SOC analysts working 8-12 hour shifts need persistence.
4. **No performance budget defined for data-heavy pages** — `EdrLogsPage`, `AssetInventoryPage`, `HostManagementPage`, and `NetworkMapPage` all handle potentially massive datasets, but no explicit virtualization/pagination performance targets exist.
5. **No accessibility or keyboard-navigation strategy** — None of the six domains mention screen-reader support, focus management, or full keyboard operability, which matters for a 24/7 SOC where analysts may use assistive tech or work rapidly via keyboard shortcuts.

```text
You are a Principal Frontend Architect establishing the cross-cutting infrastructure that every SOC Frontend page domain must build on top of, before further domain-specific enhancement work begins.

Your tasks:
1. Design a shared "Entity Link" utility (e.g., shared/lib/entityLinks.ts) that standardizes cross-navigation between Asset <-> Vulnerability <-> Incident <-> Investigation <-> IOC, so any page can deep-link to a related entity with consistent URL query params (e.g., /assets/inventory?assetId=X, /incidents/active?relatedAssetId=X).
2. Build a dedicated AuditLogPage.tsx under pages/utilities/ that aggregates every TwoKeyModal-confirmed action platform-wide (host isolation, rule disable, session revocation, playbook execution approval) from a single GET /api/audit/events endpoint, filterable by actor, action type, and time range.
3. Implement a shared useSavedView(pageKey) hook that persists table filters, sort order, and column visibility per analyst per page (backed by GET/PATCH /api/users/me/views/{pageKey}, with localStorage as an offline fallback only, never as the source of truth).
4. Define and document explicit performance budgets: max initial render time, virtualization thresholds (e.g., any table >200 rows must use virtualized rendering), and WebSocket message batching windows (reuse the 250ms batching pattern from InvestigationGraph).
5. Establish a baseline accessibility standard: all interactive elements keyboard-reachable, ARIA roles on custom components (StatusDot, Badge, TwoKeyModal), and a documented keyboard shortcut scheme (e.g., "g" then "i" to jump to Incidents) for power-user analysts.

Return the shared utility implementations and a one-page accessibility/performance standards doc that all subsequent page work must comply with.
```

---

## 1. Dashboards Domain — Next-Level Development

### `ExecutiveDashboardPage.tsx`

**What's missing:** No drill-down from executive metrics into underlying incidents; no comparison against prior period/benchmark; no PDF/board-deck export; static snapshot rather than a trend-aware narrative.

```text
You are a Principal Frontend Engineer elevating ExecutiveDashboardPage.tsx beyond a static KPI display into a decision-support tool for leadership.

Develop:
1. Period-over-period comparison: each KPI card (Total Incidents, MTTD, MTTR) must show delta vs. the prior comparable period (e.g., "MTTD: 42min, -18% vs last month") sourced from GET /api/dashboards/executive-summary?compare=previous_period.
2. Drill-down interactivity: clicking the risk trend chart or top-threats bar chart navigates to a pre-filtered ActiveIncidentsPage/ClosedIncidentsPage view scoped to that time range/threat category, using the shared Entity Link utility.
3. Board-ready export: implement a "Generate Board Report" action that produces a branded PDF (via a backend export endpoint) combining the KPI summary, risk trend chart, and top threats, with a visible generation-progress state.
4. Benchmark context: where available, display an industry/tenant-tier benchmark comparison (e.g., "Your MTTD is in the top 25% for your industry") sourced from an aggregate backend endpoint, with a clear "insufficient data" fallback for new tenants.
5. Scheduled delivery: add a UI to configure automatic weekly/monthly email delivery of this dashboard snapshot to specified leadership recipients.

Return the complete enhanced ExecutiveDashboardPage.tsx and the export/scheduling sub-components.
```

### `CompliancePage.tsx`

**What's missing:** No remediation workflow tied to failed controls; no historical compliance trend; no mapping between a failed control and the specific incidents/vulnerabilities causing the failure.

```text
You are a Principal Frontend Engineer extending CompliancePage.tsx from a static status view into an actionable compliance management workflow.

Develop:
1. Control-to-evidence linking: each failed/partial control must link to the specific underlying evidence (e.g., unpatched CVEs from VulnerabilitiesPage, unresolved incidents) that caused the failure, using the shared Entity Link utility.
2. Remediation task assignment: allow a Compliance Officer to assign a failed control to an analyst with a due date, tracked via a lightweight task list embedded in the control detail view (backed by POST /api/dashboards/compliance-status/{controlId}/tasks).
3. Historical trend: add a compliance-over-time line chart per framework (e.g., "SOC 2 coverage: 78% -> 85% -> 91% over last 3 audits") sourced from GET /api/dashboards/compliance-status/history.
4. Framework mapping overlap view: show which controls are shared across multiple frameworks (e.g., a single access-control policy satisfying both ISO 27001 and SOC 2) to avoid duplicated remediation effort.
5. Audit-readiness mode: a toggle that generates an auditor-facing read-only export link with a time-limited access token, separate from the internal Export Compliance Report action.

Return the complete enhanced CompliancePage.tsx with the remediation task and historical trend sub-components.
```

### `OverviewPage.tsx`

**What's missing:** No personalization for the analyst's own assigned queue; no shift-handoff mechanism; no indication of SLA breach risk before it happens.

```text
You are a Principal Frontend Engineer building out OverviewPage.tsx into a true Tier 1 analyst command surface, not just a read-only snapshot.

Develop:
1. "My Queue" personalization: filter the active critical alerts section to prioritize alerts assigned to the logged-in analyst (via GET /api/alerts?assignedTo=me) with a toggle to view the full team queue.
2. SLA breach forecasting: for each open alert, compute and visually flag (amber before breach, red after) the time remaining before an SLA/TTR target is missed, using rules already established for MTTR calculation elsewhere in the platform.
3. Shift handoff summary: a one-click "Generate Handoff Note" action that compiles currently open, in-progress items assigned to the analyst into a structured summary for the incoming shift, persisted via POST /api/shifts/handoff.
4. System health micro-status: a compact strip showing core-ingest, soc-backend, and detection feed health (green/amber/red) so analysts immediately know if a system issue, not a lull in attacks, explains low alert volume.
5. Quick actions bar: one-click shortcuts to the 3-4 most common Tier 1 actions (start investigation, escalate, mark false positive) directly from the alert list, avoiding a full page navigation for routine triage.

Return the complete enhanced OverviewPage.tsx including the handoff-note and SLA-forecast sub-components.
```

---

## 2. Detection Engineering Domain — Next-Level Development

### `AlertRulesPage.tsx`

**What's missing:** No rule performance/noise metrics (false-positive rate per rule); no rule versioning/rollback; no simulation/dry-run before enabling a new rule against live data.

```text
You are a Principal Detection Engineer and Frontend Engineer extending AlertRulesPage.tsx into a full rule-lifecycle management console.

Develop:
1. Rule performance metrics: each rule row must display a computed noise/precision indicator (e.g., "False positive rate: 34% over last 30 days," "Triggered 212 times") sourced from GET /api/detection/rules/{id}/performance, helping engineers identify rules to tune or retire.
2. Rule versioning and rollback: every edit to a rule's DSL/JSON creates a new version; the UI must show a version history timeline per rule and support one-click rollback to a prior version, gated by the same optimistic-update pattern already in place.
3. Dry-run/simulation mode: before enabling a new or edited rule, allow the engineer to "simulate against last 7 days of data" (POST /api/detection/rules/{id}/simulate) and preview how many alerts it would have generated, without actually firing real alerts.
4. Rule dependency mapping: show which playbooks or automations are triggered by each rule, so disabling a rule surfaces a warning if downstream automations depend on it (cross-reference with PlaybookSandbox/Marketplace-installed playbooks).
5. Bulk operations: support multi-select to bulk-enable/disable or bulk-tag rules by category (e.g., "MITRE ATT&CK: Initial Access"), with TwoKeyModal confirmation required if any selected rule is high-impact.

Return the complete enhanced AlertRulesPage.tsx including the simulation and version-history sub-components.
```

### `IocSearchPage.tsx`

**What's missing:** No bulk/batch IOC lookup (only single-query implied); no export of search results; no automatic enrichment linking to ThreatIntelPanel's aggregated risk scoring formula.

```text
You are a Principal Frontend Engineer extending IocSearchPage.tsx from a single-query tool into a full threat-hunting workbench.

Develop:
1. Batch IOC lookup: support pasting a newline-separated list of IOCs (up to a defined limit, e.g., 100) and querying all of them in a single batched backend call, displaying results in a sortable table rather than one at a time.
2. Result export: allow exporting search results (single or batch) as CSV/JSON for offline reporting or sharing with external partners/law enforcement.
3. Unified risk scoring: apply the same Global Risk Score aggregation formula already defined for ThreatIntelPanel so IOC search results and the ThreatIntelPanel show consistent, non-contradictory risk scores for the same indicator.
4. Historical search analytics: show a small "searched X times across the org in the last 30 days" indicator per IOC, using aggregate backend search logs, to help identify indicators of organization-wide interest.
5. Saved watchlists: allow analysts to "Watch" an IOC, creating a standing alert if that indicator reappears anywhere in ingested telemetry (backed by POST /api/detection/watchlist), extending beyond the current client-side-only "last 10 searches" persistence.

Return the complete enhanced IocSearchPage.tsx including the batch-lookup and watchlist sub-components.
```

### `ThreatFeedsPage.tsx`

**What's missing:** No feed quality/signal-to-noise scoring; no per-feed cost/quota visibility for commercial feeds; no automated feed health alerting.

```text
You are a Principal Frontend Engineer extending ThreatFeedsPage.tsx into a feed-quality management console, not just a connection-status list.

Develop:
1. Feed quality scoring: alongside the 7-day ingestion sparkline, show a computed signal-to-noise ratio per feed (e.g., "12% of IOCs from this feed led to confirmed incidents") sourced from GET /api/detection/feeds/{id}/quality, to justify feed cost/retention decisions.
2. Quota and cost visibility: for commercial feeds with API rate limits, display current quota usage (e.g., "8,200 / 10,000 monthly queries used") with a warning threshold indicator.
3. Automated health alerting: allow configuring a notification (email/Slack via Marketplace integration) that fires if a feed goes "down" or "degraded" for longer than a configurable threshold, rather than requiring an analyst to notice manually.
4. Feed overlap analysis: show a Venn-style or tabular overlap of IOC coverage between feeds (e.g., "AlienVault OTX and Abuse.ch overlap on 34% of malware-family IOCs") to identify redundant feeds worth deprecating.
5. Feed-specific ingestion error log: a dedicated expandable log per feed showing the last N ingestion errors (malformed STIX/TAXII payloads, auth failures) for faster troubleshooting without needing backend log access.

Return the complete enhanced ThreatFeedsPage.tsx including the quality-scoring and overlap-analysis sub-components.
```

---

## 3. Endpoint Management Domain — Next-Level Development

### `HostManagementPage.tsx`

**What's missing:** No fleet-wide compliance/patch-baseline view; no bulk agent operations; no correlation between agent health and recent incident involvement.

```text
You are a Principal Frontend Engineer extending HostManagementPage.tsx into a proactive fleet-health management console.

Develop:
1. Fleet compliance baseline: show the percentage of the fleet on the current-approved agent version and OS patch baseline, with a dedicated filtered view for out-of-compliance hosts.
2. Bulk operations: support multi-select for bulk agent restart/update actions across many hosts at once, with a progress tracker showing per-host success/failure as the bulk job executes.
3. Incident correlation: display a small badge per host indicating "Involved in 2 open incidents" or "Last isolated 14 days ago," linking to those incidents/isolation events via the shared Entity Link utility.
4. Predictive stale-agent alerting: rather than only flagging hosts already stale >24h, surface a "trending toward stale" warning (e.g., last check-in interval increasing) to catch degrading connectivity before it becomes a full outage.
5. Asset criticality overlay: cross-reference each host against AssetInventoryPage's criticality tier so Tier-1-critical hosts with agent issues are visually prioritized above lower-criticality hosts with the same issue.

Return the complete enhanced HostManagementPage.tsx including the bulk-operations and incident-correlation sub-components.
```

### `IsolationControlsPage.tsx`

**What's missing:** No automatic isolation recommendation based on active investigation severity; no scheduled/temporary isolation with auto-release; no network segment impact preview before isolating.

```text
You are a Principal Application Security Engineer extending IsolationControlsPage.tsx into a smarter, context-aware containment console, while preserving all existing TwoKeyModal governance.

Develop:
1. AI-recommended isolation: when an active investigation reaches high confidence on a compromised host, surface a recommended isolation action directly on this page (sourced from the investigation's proposed_actions), still requiring the same TwoKeyModal confirmation before execution.
2. Temporary/scheduled isolation: allow specifying an auto-release time when isolating a host (e.g., "isolate for 4 hours pending forensic review"), with a visible countdown and automatic release logic, still logged in the audit trail.
3. Blast-radius preview: before confirming isolation, show a preview of what services/dependencies run on that host (pulled from AssetInventoryPage/NetworkMapPage data) so the analyst understands operational impact before committing.
4. Isolation history analytics: a summary view showing isolation frequency by host/team over time, useful for identifying chronically compromised endpoints needing deeper remediation rather than repeated isolation.
5. Post-isolation checklist: after isolating a host, present a structured next-steps checklist (forensic image capture, credential rotation, stakeholder notification) to standardize incident containment procedure.

Return the complete enhanced IsolationControlsPage.tsx, explicitly confirming every new action (including scheduled auto-release configuration) still routes through TwoKeyModal where destructive.
```

### `EdrLogsPage.tsx`

**What's missing:** No saved query/filter templates for recurring hunts; no anomaly highlighting within the raw telemetry stream; no cross-host correlated view (only single-host live tail implied).

```text
You are a Principal Frontend Engineer extending EdrLogsPage.tsx into a forensic-grade telemetry analysis tool.

Develop:
1. Saved hunt templates: allow analysts to save a named filter combination (host, event type, time range, keyword) for reuse, using the shared useSavedView hook, so recurring threat-hunting queries do not need to be rebuilt each time.
2. Inline anomaly highlighting: visually flag log lines that match known suspicious patterns (e.g., LOLBins usage, unusual parent-child process chains) using a lightweight client-side rule set or backend-flagged anomaly field, distinct from full detection-rule matches.
3. Multi-host correlated live tail: extend the existing single-host live-tail capability to support tailing multiple selected hosts simultaneously in an interleaved, timestamp-sorted view, useful during a multi-host incident.
4. Process tree visualization: for a selected process-execution event, render its parent-child process tree (reusing the graph rendering approach from InvestigationGraph/NetworkMapPage) rather than only a flat JSON detail view.
5. One-click pivot to isolation: from a clearly malicious log entry, provide a direct action to jump to IsolationControlsPage pre-filtered to that host, shortening analyst response time.

Return the complete enhanced EdrLogsPage.tsx including the saved-hunt-template and process-tree sub-components.
```

---

## 4. Incident Response Domain — Next-Level Development

### `ActiveIncidentsPage.tsx` & `ClosedIncidentsPage.tsx`

**What's missing:** No SLA/TTR breach analytics aggregated across the team; no root-cause tagging/taxonomy for closed incidents; no bulk reassignment for load balancing.

```text
You are a Principal Frontend Engineer extending the Incident lifecycle pages into a full incident-management and post-incident-learning system.

Develop:
1. Team-level SLA analytics on ActiveIncidentsPage: a summary strip showing "3 incidents approaching SLA breach," "Average current TTR: 2.4h," updating live as incidents progress.
2. Root-cause taxonomy on ClosedIncidentsPage: require a structured root-cause tag (e.g., phishing, misconfiguration, insider, third-party) upon closure, feeding a "Top Root Causes This Quarter" analytics view for pattern recognition.
3. Bulk reassignment and load balancing: allow a SOC Manager to view analyst workload (open incident count per analyst) directly in ActiveIncidentsPage and bulk-reassign incidents to balance load.
4. Incident-to-detection-rule feedback loop: on closure, allow tagging "this incident should have been caught earlier" and linking to a specific detection rule gap, feeding directly into AlertRulesPage's backlog for new/tuned rules.
5. Post-incident review scheduling: for Major/Critical closed incidents, prompt scheduling of a formal post-incident review (calendar integration) and track completion status of that review.

Return the complete enhanced ActiveIncidentsPage.tsx and ClosedIncidentsPage.tsx including the SLA-analytics and root-cause-taxonomy sub-components.
```

### `WarRoomPage.tsx`

**What's missing:** No integrated communication channel beyond the timeline (e.g., no voice/video bridge link); no automatic status-page/stakeholder update generation; no post-mortem draft auto-generation from the timeline.

```text
You are a Principal Frontend Engineer extending WarRoomPage.tsx into a complete crisis-coordination hub.

Develop:
1. External bridge integration: allow attaching a live voice/video bridge link (e.g., Zoom/Teams/Google Meet) to the War Room session, displayed prominently for responders joining mid-incident.
2. Stakeholder status broadcast: a "Post Status Update" action that, separate from the internal timeline, drafts and sends a simplified, non-technical status update to a predefined stakeholder distribution list (via Marketplace-integrated Slack/email), with an editable preview before sending.
3. Auto-drafted post-mortem: upon incident resolution, automatically generate a draft post-mortem document pre-populated from the immutable timeline (key events, responders involved, actions taken, mandatory summary field), which the lead responder then edits and finalizes rather than starting from a blank page.
4. Responder role assignment: beyond presence indicators, allow explicitly assigning incident roles (Incident Commander, Communications Lead, Technical Lead) visible to all participants, clarifying decision authority during the crisis.
5. Real-time decision log: a distinct, explicitly-tagged sub-feed within the timeline for "Decisions Made" (vs. general updates), making the post-mortem and audit review significantly faster to compile.

Return the complete enhanced WarRoomPage.tsx including the bridge-integration, stakeholder-broadcast, and auto-drafted-post-mortem sub-components.
```

---

## 5. Asset Intelligence Domain — Next-Level Development

### `AssetInventoryPage.tsx`

**What's missing:** No asset discovery gap detection (unknown/rogue assets); no ownership accountability workflow; no criticality re-scoring triggered by business context changes.

```text
You are a Principal Frontend Engineer extending AssetInventoryPage.tsx from a static catalog into an active asset-governance system.

Develop:
1. Rogue/unmanaged asset detection: surface assets discovered via network scanning or EDR telemetry that have no registered owner or criticality tier yet, flagged distinctly ("Unclassified — 14 assets") to close visibility gaps.
2. Ownership accountability workflow: require every asset to have an assigned business owner; allow bulk-assignment and send automated reminders to owners for assets missing criticality classification for more than a defined period.
3. Criticality re-scoring workflow: allow a structured re-scoring request (e.g., "this server now hosts a new production database") that routes through an approval step before the criticality tier changes, since this tier feeds risk-scoring elsewhere in the platform.
4. Asset lifecycle status: track and display decommissioning status (active, scheduled for decommission, decommissioned) so stale entries do not pollute investigation and risk-scoring context.
5. Change history timeline: per asset, show a timeline of criticality changes, ownership changes, and major incidents/vulnerabilities associated with it over its lifetime.

Return the complete enhanced AssetInventoryPage.tsx including the rogue-asset-detection and ownership-workflow sub-components.
```

### `NetworkMapPage.tsx`

**What's missing:** No attack-path simulation (e.g., "if this asset is compromised, what can it reach"); no historical topology diffing to detect unauthorized network changes; no segmentation-policy visualization.

```text
You are a Principal Frontend Engineer extending NetworkMapPage.tsx from a static topology view into an attack-surface reasoning tool.

Develop:
1. Attack-path simulation: allow selecting a node and visualizing all reachable downstream nodes (potential lateral-movement paths), highlighting the shortest path to your most critical assets, to support proactive segmentation decisions.
2. Topology diffing: compare the current network map against a snapshot from N days ago and highlight new/removed nodes or connections, surfacing potentially unauthorized network changes for review.
3. Segmentation policy overlay: visually indicate which network segments are properly isolated per policy vs. which have unexpected cross-segment connectivity, cross-referencing firewall/segmentation rules if available from the backend.
4. Asset-risk heat overlay: beyond simple alert-status coloring, support toggling a heat-map view driven by aggregate risk score (combining criticality, open vulnerabilities, and active alerts) per node.
5. Export for tabletop exercises: allow exporting the current topology view (with or without the attack-path overlay) as an image/PDF for use in tabletop incident-response exercises and audits.

Return the complete enhanced NetworkMapPage.tsx including the attack-path-simulation and topology-diffing sub-components.
```

### `VulnerabilitiesPage.tsx`

**What's missing:** No exploitability/EPSS-based prioritization beyond raw CVSS; no remediation SLA tracking; no linkage showing whether a vulnerability is actively being exploited in the wild against this environment.

```text
You are a Principal Frontend Engineer extending VulnerabilitiesPage.tsx from a CVSS-sorted list into a risk-prioritized remediation system.

Develop:
1. EPSS/exploit-probability prioritization: alongside raw CVSS score, display an Exploit Prediction Scoring System (EPSS) or equivalent likelihood-of-exploitation score, and allow sorting/filtering by a combined risk score (CVSS x EPSS x asset criticality) rather than CVSS alone.
2. Active-exploitation flagging: cross-reference vulnerability findings against active alerts/investigations and threat-intel feeds to flag "actively exploited in your environment" or "actively exploited in the wild (CISA KEV)" distinctly and urgently.
3. Remediation SLA tracking: define SLA targets per severity tier (e.g., Critical: patch within 7 days) and track time-to-remediation against these targets, with an overdue-items dashboard.
4. Compensating-control tracking: allow marking a vulnerability as "risk accepted with compensating control" (e.g., WAF rule, network segmentation) with required justification and expiry/review date, rather than only "open" or "remediated" states.
5. Remediation ticket status sync: if integrated with a ticketing system (via Marketplace), show live ticket status (open/in-progress/done) directly in the vulnerability row instead of only "ticket generated."

Return the complete enhanced VulnerabilitiesPage.tsx including the EPSS-prioritization and active-exploitation-flagging sub-components.
```

---

## 6. Platform Utilities Domain — Next-Level Development

### `MarketplacePage.tsx`

**What's missing:** No usage analytics per installed integration; no sandboxed "try before you install" preview beyond playbook source view; no dependency conflict detection between integrations.

```text
You are a Principal Frontend Engineer extending MarketplacePage.tsx into a governed integration lifecycle manager.

Develop:
1. Installed-integration usage analytics: for each installed integration/playbook, show usage frequency and last-used date, helping identify unused installs that increase attack surface unnecessarily and should be reviewed for removal.
2. Dependency and conflict detection: before installing, check for conflicts with already-installed integrations (e.g., two SMS gateway integrations both claiming a default channel) and warn the analyst before proceeding.
3. Staged rollout for playbooks: allow installing a playbook in "dry-run only" mode first (never executes real actions, only logs what it would do) before promoting it to full production capability.
4. Review/rating system: allow internal teams to leave short reviews/ratings on marketplace listings to help other analysts/tenants (if multi-tenant) choose reliable integrations.
5. License/cost visibility: for paid integrations, surface licensing cost and renewal date directly in the listing detail to support budget planning.

Return the complete enhanced MarketplacePage.tsx including the usage-analytics and dependency-conflict sub-components.
```

### `SettingsPage.tsx`

**What's missing:** No granular API key scoping (all-or-nothing keys implied); no configurable notification routing rules; no data-retention policy configuration.

```text
You are a Principal Frontend Engineer and Security Engineer extending SettingsPage.tsx into a governance-grade configuration console.

Develop:
1. Scoped API keys: allow generating API keys with specific scopes/permissions (e.g., read-only alerts, write-only playbook triggers) rather than a single all-access token, each independently revocable.
2. Notification routing rules: allow configuring which alert severities/types route to which channels (email, Slack, SMS via PhilSMS/Twilio/MoceanAPI integrations) and to whom, rather than a single global notification toggle.
3. Data retention configuration: expose configurable retention periods per data type (raw EDR logs, alert history, audit logs) within compliance-mandated minimums, with a clear warning before reducing retention below any active compliance framework's requirement (cross-reference CompliancePage).
4. Session and device management: show all currently active sessions/devices for the tenant's users (not just the current user), with the ability for an admin to force-revoke any specific session, extending the existing "revoke all sessions" danger-zone action into a granular per-session view.
5. Change audit trail for settings themselves: every settings change should itself be logged to the AuditLogPage (defined in the cross-cutting section) since settings changes (e.g., reducing retention, changing notification routing) are security-relevant events.

Return the complete enhanced SettingsPage.tsx including the scoped-API-key and notification-routing sub-components.
```

### `ProfilePage.tsx`

**What's missing:** No personal productivity/performance stats for the analyst; no notification preference granularity at the individual level; no session activity visibility for the user's own account.

```text
You are a Principal Frontend Engineer extending ProfilePage.tsx from a basic account-settings form into a personal analyst dashboard.

Develop:
1. Personal performance stats: show the analyst's own metrics (incidents resolved this month, average TTR, current open queue count) sourced from GET /api/users/me/stats, giving individual visibility into their own contribution and workload.
2. Individual notification preferences: allow the analyst to configure their own notification channels/quiet hours (e.g., no SMS pings between 10pm-6am unless Critical severity), layered on top of the tenant-wide routing rules defined in SettingsPage.
3. Personal session visibility: show the analyst their own active login sessions/devices with the ability to self-revoke a session (e.g., "I forgot to log out on a shared machine"), independent of admin-level session management.
4. Skill/certification tracking: optionally allow analysts to log relevant certifications (e.g., GCIH, OSCP) visible to SOC Managers for staffing and escalation-routing decisions.
5. Two-factor authentication enrollment: if not already covered elsewhere, allow the analyst to enroll/manage MFA (TOTP app, hardware key) directly from their profile, with backup codes generation.

Return the complete enhanced ProfilePage.tsx including the personal-stats and MFA-enrollment sub-components.
```

### `NotFoundPage.tsx`

**What's missing:** No telemetry on which broken links are actually being hit (so dead Sidebar entries can be caught proactively); no contextual "did you mean" suggestion based on the attempted path.

```text
You are a Principal Frontend Engineer extending NotFoundPage.tsx from a themed dead-end into a self-healing navigation signal.

Develop:
1. 404 telemetry logging: on render, silently POST the attempted path to a lightweight backend logging endpoint (e.g., POST /api/telemetry/404) so engineering can proactively identify and fix broken Sidebar links or stale bookmarks without waiting for analyst complaints.
2. "Did you mean" suggestions: perform a simple fuzzy match of the attempted path against the known route list (from shared/config/routes.ts) and suggest the closest valid route(s) as clickable links.
3. Context-aware return action: if the attempted path partially matches a known domain (e.g., /assets/xyz), the "Return" button should route to the closest valid parent page (/assets/inventory) rather than always defaulting to the Command Center.

Return the complete enhanced NotFoundPage.tsx including the 404-telemetry logging call and did-you-mean suggestion logic.
```

---

## 7. Final Integration & Prioritization Prompt

```text
You are a Principal Engineer performing final prioritization and integration planning across all enhancement prompts defined above for the six SOC Frontend domains.

Your tasks:
1. Rank all proposed enhancements into three tiers: Tier A (directly reduces MTTD/MTTR or closes a security gap — e.g., AI-recommended isolation, EPSS-based vulnerability prioritization, audit log page), Tier B (materially improves analyst efficiency — e.g., saved views, bulk operations, batch IOC lookup), Tier C (nice-to-have polish — e.g., ratings/reviews, skill tracking).
2. Identify which enhancements share underlying infrastructure (e.g., Entity Link utility benefits at least 6 pages; useSavedView hook benefits at least 5 pages) and sequence those shared-infrastructure items first regardless of tier.
3. For each Tier A item, confirm it has a corresponding backend endpoint requirement documented (many of these are new: /api/detection/rules/{id}/simulate, /api/detection/rules/{id}/performance, /api/audit/events, /api/assets/network-map with diffing support) and flag these for backend team scoping before frontend implementation begins.
4. Produce a phased delivery roadmap (Phase A: shared infrastructure, Phase B: Tier A enhancements, Phase C: Tier B, Phase D: Tier C) with a brief note on estimated backend dependency risk per phase.

Return the finalized tiered roadmap as a markdown table: Enhancement | Page | Tier | Shared Infra Dependency | New Backend Endpoint Required.
```

---

## 8. Summary Roadmap Table

| Enhancement | Page | Tier | Shared Infra Dependency | New Backend Endpoint Required |
|---|---|---|---|---|
| Entity Link cross-navigation | All domains | A | Core (build first) | None (client-side utility) |
| Audit Log Page | Utilities | A | Entity Link | GET /api/audit/events |
| Saved views/filters | Most pages | B | New (build early) | GET/PATCH /api/users/me/views/{pageKey} |
| SLA breach forecasting | Overview, Incidents | A | None | Derived client-side from existing data |
| Rule performance metrics + dry-run simulation | AlertRulesPage | A | None | GET /api/detection/rules/{id}/performance, POST .../simulate |
| Batch IOC lookup + watchlist | IocSearchPage | B | None | Batch search endpoint, POST /api/detection/watchlist |
| Feed quality scoring | ThreatFeedsPage | B | None | GET /api/detection/feeds/{id}/quality |
| Bulk host operations | HostManagementPage | B | None | Bulk action endpoint |
| AI-recommended + scheduled isolation | IsolationControlsPage | A | None | Extend proposed_actions, auto-release scheduler |
| Multi-host live tail + process tree | EdrLogsPage | B | Graph reuse | Multi-host stream support |
| Root-cause taxonomy + SLA analytics | Incidents pages | A | None | Closure schema extension |
| Post-mortem auto-draft | WarRoomPage | A | None | Timeline-to-document generation endpoint |
| Rogue asset detection + ownership workflow | AssetInventoryPage | A | Entity Link | Discovery/ownership endpoints |
| Attack-path simulation + topology diffing | NetworkMapPage | A | Graph reuse | Path/diff computation endpoint |
| EPSS prioritization + active-exploitation flag | VulnerabilitiesPage | A | Entity Link | EPSS data source integration |
| Scoped API keys + notification routing | SettingsPage | A | Audit Log Page | Key scoping, routing rules endpoints |
| Personal analyst stats + MFA enrollment | ProfilePage | B | None | GET /api/users/me/stats |
| 404 telemetry + did-you-mean | NotFoundPage | C | None | POST /api/telemetry/404 |
