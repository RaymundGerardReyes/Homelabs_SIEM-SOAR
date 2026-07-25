# Principal Frontend Engineer Prompt — Fixing NetworkMapPage Rendering/Zoom & Polishing CommandCenter Core Logic

## Part 1: NetworkMapPage — Root Cause of "Not Visible, No Zoom/Pan"

### Confirmed Diagnosis From Source Code

```text
You are a Principal Frontend Engineer diagnosing why NetworkMapPage.tsx renders an almost-empty dark canvas with no visible nodes/edges and no zoom or pan capability, based on direct inspection of the component source.

Confirmed root causes found in the code:

1. NO POSITIONING SYSTEM EXISTS FOR NODES.
   The component maps over `data.nodes` and `data.edges` and renders them directly, but there is no visible logic anywhere in the file that assigns each node an (x, y) coordinate — no force-directed layout, no grid layout, no circular layout, and no reference to node.x/node.y being set before render. If the API response at /assets/network-map does not already include explicit x/y pixel coordinates per node, every node has undefined position, and browsers will render absolutely-positioned elements with undefined coordinates at effectively (0,0) or not at all — this alone explains why almost nothing is visible on screen.

2. NO ZOOM/PAN STATE OR EVENT HANDLERS EXIST.
   There is no useState for scale/zoom level, no useState for pan offset (translateX/translateY), and no onWheel, onMouseDown/onMouseMove/onMouseUp, or onTouchStart/onTouchMove handlers anywhere in the component. The container is a static div with no transform applied — this is why scrolling/pinching does nothing. Zoom/pan is not partially broken; it was never implemented in this component at all.

3. NO VIEWPORT/CANVAS SIZING LOGIC.
   The map container has no explicit width/height tied to actual content bounds, and no logic to fit all nodes within the visible viewport on initial load (no "fit to screen" / auto-center calculation). Even if node coordinates existed, there is nothing centering or scaling the graph to be visible within the container bounds shown in the screenshot.

4. THE MOCK DATA ENRICHMENT MASKS THE REAL ISSUE.
   The component adds riskScore, segment, and isNew via .map() immediately after the API call, which can create a false impression that the visualization layer is "wired up correctly" when in fact only the data enrichment layer works — the actual rendering/positioning/interaction layer beneath it was never built out.

Return this diagnosis confirmed against the actual NetworkMapPage.tsx source, citing the specific missing pieces (no coordinate assignment, no zoom/pan state, no viewport fitting) before any fix is applied.
```

### Redevelop NetworkMapPage With a Real Graph Rendering Library

```text
You are a Principal Frontend Engineer rebuilding NetworkMapPage.tsx with a proper interactive network graph, replacing the current hand-rolled absolutely-positioned div approach.

Your tasks:

1. Adopt a dedicated graph visualization library rather than continuing to hand-roll SVG/div positioning — recommended open-source options compatible with React:
   - react-force-graph (2D/3D force-directed layout, WebGL/Canvas rendering, built-in zoom/pan/drag out of the box) — best fit given this is a "network topology" visualization with lateral movement paths.
   - Alternatively, reactflow (React Flow) if more manual control over node/edge styling and interaction is preferred, also ships built-in zoom/pan/minimap support.
   - Do not continue building custom zoom/pan math manually — both libraries solve this problem correctly and are widely used in security/network visualization products.

2. Replace the current node/edge rendering block entirely:
   - Feed `data.nodes` and `data.edges` (already fetched via the existing useAsyncState/apiClient logic — keep this data-fetching layer as-is) into the chosen graph library's `graphData` prop.
   - Let the library's force simulation (or dagre/elk auto-layout for reactflow) calculate node positions automatically — do not attempt to manually compute or hardcode x/y coordinates from the backend.
   - Preserve all four existing overlay modes (standard, heat, segmentation, diff) by mapping them to the library's node/edge color and style accessor functions (e.g., react-force-graph's `nodeColor`, `linkColor`, `nodeVal` props) instead of the current inline Tailwind class branching logic — the existing overlay decision logic (risk thresholds, segment colors, violation dashing) can be preserved almost as-is, just relocated into these accessor functions.

3. Implement zoom/pan using the library's native support:
   - react-force-graph: zoom/pan/drag work out of the box via the underlying d3-force + canvas renderer; expose `zoomToFit()` on mount so the full graph is auto-centered and scaled to the container on initial load (this directly fixes "it wasn't visible" since the graph will always fit the viewport by default).
   - Add explicit zoom control buttons (+/-/reset) in a corner overlay calling the library's zoom API, in addition to scroll-wheel/pinch support, since analysts may not intuitively know scroll-to-zoom is available.

4. Preserve existing feature logic exactly, wiring it into the new rendering layer instead of discarding it:
   - Attack Path Simulation (BFS reachability + red highlight of reachable nodes/edges) — keep the existing `reachableNodes` useMemo logic, just apply its result through the new library's color accessor functions instead of Tailwind classes.
   - Node click → sidebar detail panel (asset ID, type, segment, risk score, blast radius simulation button) — keep this exactly as built, triggered via the library's `onNodeClick` callback instead of a raw div onClick.
   - Legend overlay — keep as-is, positioned as an absolute overlay on top of the graph canvas.
   - Export for Tabletop button — currently mocked with an alert(); implement it for real using html-to-image or the library's built-in canvas `toDataURL()`/screenshot export, since the button already exists and is user-facing.

5. Verify the fix directly against the reported symptom: after rebuild, confirm nodes are visible on initial page load without any interaction, confirm scroll-wheel zooms in/out smoothly, confirm click-drag pans the canvas, and confirm zoomToFit correctly re-centers when overlay mode changes (in case node visibility changes, e.g., diff mode showing fewer highlighted nodes).

Return the fully rewritten NetworkMapPage.tsx using react-force-graph (or reactflow, with justification for the final choice), preserving all existing overlay/simulation/sidebar logic, with working zoom/pan/fit-to-screen confirmed.
```

---

## Part 2: CommandCenter — Missing Core Logic Audit

### Confirmed Gaps Found in Source Code

```text
You are a Principal Frontend Engineer auditing CommandCenter.tsx for missing or incomplete core logic, based on direct inspection of the current implementation.

Confirmed gaps found in the code:

1. AgentResilienceStatus IS IMPORTED BUT NEVER RENDERED.
   The component imports AgentResilienceStatus and computes all the data it would need (isDegraded, fallbackRuleTriggered, activeProvider, isConnected) — but there is no JSX anywhere in the returned markup that actually renders <AgentResilienceStatus .../> with these computed props. The computation is dead code as currently wired — analysts have no visible indicator of which LLM provider is active or whether a fallback has occurred, despite the backend work already done to detect this (per the earlier LangGraph instrumentation task).

2. isConnected FROM THE AGENT STREAM WEBSOCKET IS COMPUTED BUT NEVER SURFACED.
   The destructured `isConnected` value from useWebSocketStream('/api/ws/agent/stream', ...) is never displayed anywhere in the UI. If the agent event stream silently disconnects, there is currently no visual indicator on the Command Center telling the analyst that live agent telemetry has stopped — this directly undermines trust in the dashboard, since a frozen feed looks identical to "no new events occurred."

3. NO RENDERING OF AgentTriageFeed IN THE VISIBLE RETURN BLOCK.
   AgentTriageFeed is imported but, based on the visible JSX, is not clearly placed/rendered in the main layout — if it is omitted, the live LangGraph pipeline feed described in the earlier "Agent Operations Panel" implementation has no visible home on this page, which was the entire point of building it.

4. NO EMPTY/ERROR STATE FOR METRICS BEYOND A LITERAL "...".
   `usePolling('/metrics/overview', 30000, setMetrics, (err) => console.error(err.message))` only logs polling errors to the console — there is no user-visible error state if metrics polling fails repeatedly. An analyst watching the dashboard would see KPI tiles stuck at "..." indefinitely with no indication that this is a connectivity problem rather than "no data yet."

5. NO WEBSOCKET RECONNECTION/ERROR STATE FOR ALERTS STREAM.
   The alerts WebSocket (`/api/ws/alerts`) has no visible connection-status handling at all (unlike the agent stream, which at least computes isConnected even if unused) — there is no way for an analyst to know if the live alert feed has silently died versus genuinely having zero new alerts.

6. NO VISUAL DISTINCTION FOR isNew AGENT EVENTS OR STALE FALLBACK STATE.
   `latestFallbackEvent` is found via reverse().find(), but there's no expiry/staleness check — if a fallback occurred hours ago and the system has since recovered to the primary provider, does a new agentEvent get pushed to clear the degraded state, or does the UI keep showing "Static Ruleset" indefinitely until the next fallback-related event? This needs explicit resolution-event handling, not just a search for the most recent fallback event ever seen.

7. NO GLOBAL SYSTEM HEALTH ROLLUP.
   Given this is the "Command Center" — the primary landing view for an analyst — there is no single unified system-health indicator combining: agent stream connection, alerts stream connection, active LLM provider status, and metrics polling health, into one glanceable state. Currently these four signals exist in silos (some computed, some not even rendered).

8. NO ACKNOWLEDGE/DISMISS OR TRIAGE ACTION ON THE ALERTS LIST ITSELF.
   Each alert row navigates to the investigation page on click, but there is no quick-triage action directly from the Command Center (e.g., acknowledge, assign to self, snooze) — every single alert requires a full page navigation even for a trivial first-glance triage decision, adding friction for a page whose entire purpose is rapid situational awareness.

Return this list as a confirmed gap audit, each gap tied to the specific line/pattern found (or absent) in CommandCenter.tsx, before any fix is implemented.
```

### Polish and Complete the Missing CommandCenter Logic

```text
You are a Principal Frontend Engineer completing the missing core logic identified in the gap audit for CommandCenter.tsx.

Your tasks:

1. Render AgentResilienceStatus with its already-computed props:
   Add <AgentResilienceStatus isConnected={isConnected} isDegraded={isDegraded} fallbackRuleTriggered={fallbackRuleTriggered} activeProvider={activeProvider} /> near the top of the Command Center layout (above or beside the KPI tiles), since this is the most important glanceable AI-health indicator and the data is already computed but currently thrown away.

2. Render AgentTriageFeed in a clearly visible panel:
   Place <AgentTriageFeed events={agentEvents} /> in a dedicated column/panel of the Command Center layout (e.g., a right-hand sidebar or a collapsible panel), not buried or omitted — this is the live LangGraph pipeline visualization this entire feature was built for.

3. Add explicit connection-health surfacing for both WebSocket streams:
   - Destructure and render isConnected from the alerts WebSocket exactly as already done for the agent stream, and show a small status dot (green connected / red disconnected / amber reconnecting) next to "Active High-Priority Alerts" and next to the Agent Triage Feed header.
   - If either stream disconnects, show an inline banner: "Live [alerts/agent] feed disconnected — showing last known data as of [timestamp]" so analysts are never misled into thinking silence means "all clear."

4. Add a visible error state for metrics polling:
   Extend usePolling's error callback to set a metricsError state (not just console.error), and render a small warning indicator on the KPI tile row: "Metrics unavailable — retrying..." instead of leaving tiles at "..." indefinitely with no explanation.

5. Fix fallback-state staleness:
   Define an explicit resolution signal from the backend (e.g., a `fallbackResolved: true` event pushed when the primary provider recovers) rather than only ever searching for the most recent fallbackTriggered event. Until the backend emits this, treat any fallback event older than a defined staleness window (e.g., 10 minutes) as expired in the frontend calculation, and default back to the primary provider display rather than showing a stale "Static Ruleset" state indefinitely.

6. Add a single System Health rollup component:
   Create a compact `<SystemHealthBar />` combining: agent stream status, alerts stream status, active LLM provider, and metrics polling health into one row of colored indicators at the very top of the Command Center — giving analysts one glance to confirm "is everything actually working right now" before they even look at KPIs or alerts.

7. Add quick-triage actions directly on each alert row:
   Add an inline "Acknowledge" button (calling a new PATCH /api/alerts/{id}/acknowledge endpoint) and an "Assign to me" action directly in the alert list, so trivial triage decisions do not require a full navigation to the Investigation page — reserve the "Investigate" button/navigation for alerts that genuinely need deeper analysis.

8. Confirm no dead computed values remain:
   Audit the final component to ensure every piece of state and every destructured hook value (isConnected, isDegraded, fallbackRuleTriggered, activeProvider, and the new metricsError/alertsConnected) is actually rendered somewhere in the JSX — no silently computed-but-unused values should remain.

Return the fully polished CommandCenter.tsx with all eight gaps resolved, and a brief before/after summary confirming each computed value now has a corresponding visible UI element.
```

---

## Summary of Fixes

| Component | Core Problem | Fix |
|---|---|---|
| NetworkMapPage | No node coordinate assignment; nodes render at undefined position | Adopt react-force-graph/reactflow for auto-layout |
| NetworkMapPage | No zoom/pan state or handlers exist at all | Use library's native zoom/pan/drag + zoomToFit() |
| NetworkMapPage | No viewport fitting on load | zoomToFit() on mount and on overlay mode change |
| CommandCenter | AgentResilienceStatus computed but never rendered | Render with existing computed props |
| CommandCenter | Agent stream isConnected never surfaced | Add status dot + disconnect banner |
| CommandCenter | Alerts stream has no connection state at all | Destructure isConnected, add status dot |
| CommandCenter | Metrics errors only logged to console | Add visible metricsError state + banner |
| CommandCenter | Fallback state never expires/resolves | Add fallbackResolved event or staleness window |
| CommandCenter | No unified health view | Add SystemHealthBar rollup component |
| CommandCenter | No quick triage actions on alerts | Add Acknowledge/Assign-to-me inline actions |

---

## Recommended Immediate Next Step

Fix NetworkMapPage first, since it is currently non-functional (not a polish issue, a broken-feature issue) — adopt react-force-graph, wire the existing data-fetch and overlay logic into its accessor props, and confirm zoomToFit resolves the visibility problem before touching CommandCenter. Once the map renders correctly, apply the eight CommandCenter fixes in the order listed, starting with rendering the already-computed AgentResilienceStatus and AgentTriageFeed components since those are the fastest, highest-impact fixes (data already exists, just needs to be rendered).
