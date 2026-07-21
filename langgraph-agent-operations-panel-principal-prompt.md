# Principal Engineer Prompt — LangGraph/LangChain Agent Operations Panel Integration

This document elevates the proposed "Architecting the LangGraph & LangChain Agent Integration" plan into a precise, Principal Engineer–grade specification covering the full path: `LargeLanguageModelTriage.py` (LangGraph state machine) -> `api_routes.py` (WebSocket bridge) -> `CommandCenter.tsx` (Agent Operations Panel + AI Assistant Widget) -> resilience/fallback visibility -> verification and hardening.

The core architectural decision — autonomous live-feed vs. interactive chat — is resolved below as **both, layered**: a passive, always-on Live Agent Triage Feed for situational awareness, plus an opt-in Interactive AI Assistant Widget for direct querying, so analysts are never forced to context-switch out of monitoring mode to ask a question.

---

## 1. Resolving the Open Question: Autonomous Feed vs. Interactive Chat

```text
You are a Principal Product Engineer resolving the design ambiguity between an autonomous agent feed and an interactive chat terminal for the SOC Command Center.

Decision: Implement both, with clear separation of concerns:
1. Live Agent Triage Feed (always-on, passive): shows every LangGraph state transition for every telemetry event the agent processes, regardless of whether any analyst is actively watching. This is the system's "black box recorder" and must never depend on an analyst initiating anything.
2. Interactive AI Assistant Widget (opt-in, active): a separate WebSocket channel scoped to a specific analyst session, used to ask the LangChain agent direct questions (e.g., "Why was this alert scored high risk?", "Summarize investigation INV-2291"). This must be architecturally isolated from the autonomous triage pipeline so that a chat query can never accidentally inject into or alter live investigation state.

Your task:
1. Define two distinct backend WebSocket endpoints: `ws/agent/stream` (broadcast, read-only, one-to-many) for the passive feed, and `ws/agent/chat` (session-scoped, one-to-one) for interactive queries, ensuring the chat endpoint is strictly read/query-oriented and cannot trigger the same LangGraph nodes that execute real triage/response actions.
2. Confirm with the security/policy layer that chat-originated queries are routed through a "read-only" LangGraph subgraph or a constrained toolset (no isolate_host, no disable_rule tools available to chat), while the full-power triage graph remains reserved for real telemetry events only.
3. Document this separation explicitly in the architecture so future engineers do not merge the two channels for convenience, which would create a path for an analyst's casual chat message to accidentally trigger a destructive action.

Return the finalized channel separation design with a short rationale note for the ADR (architecture decision record).
```

---

## 2. Backend: LangGraph State Instrumentation (`LargeLanguageModelTriage.py`)

```text
You are a Principal Backend/ML Engineer instrumenting the LangGraph state machine in LargeLanguageModelTriage.py so every state transition is observable without altering the core triage logic.

Current known pipeline stages (approximate): Ingest -> Deobfuscation -> LLM Triage -> Action, with LiteLLM Router handling multi-provider fallback (OpenAI -> Anthropic -> Gemini -> local Ollama) and a deterministic static-ruleset as the final fallback tier.

Your tasks:
1. Wrap each LangGraph node with a lightweight, non-blocking event emitter (e.g., an async callback or LangGraph's built-in `on_node_start`/`on_node_end` hooks) that publishes a structured event to an internal pub/sub channel (e.g., an asyncio Queue, Redis pub/sub, or an in-process event bus) without adding meaningful latency to the triage path itself.
2. Define a strict JSON schema for every emitted event, e.g.:
   {
     "correlationId": "string",
     "investigationId": "string | null",
     "timestamp": "ISO8601",
     "node": "Ingest | Deobfuscation | LLMTriage | Action",
     "status": "started | completed | failed",
     "provider": "openai | anthropic | gemini | ollama | static_ruleset | null",
     "fallbackTriggered": "boolean",
     "fallbackReason": "string | null",
     "latencyMs": "number | null",
     "summary": "string | null"
   }
3. Instrument the LiteLLM Router call site specifically: emit a distinct event the moment a provider call fails and another the moment a fallback provider is attempted, so the frontend can render the exact failover sequence (e.g., OpenAI timeout -> Anthropic attempted -> Anthropic succeeded), not just a final "it fell back" summary.
4. Instrument the deterministic static-ruleset path as its own explicit terminal state: emit `FALLBACK_DETERMINISTIC_RULE_TRIGGERED` with the specific rule ID/name applied, when every configured LLM provider (including local Ollama) has failed.
5. Ensure event emission is fire-and-forget and fault-isolated: if the pub/sub publish call itself fails (e.g., Redis briefly unavailable), this must never raise or block the actual triage pipeline — wrap emission in a try/except that only logs locally.
6. Add a lightweight in-memory ring buffer (e.g., last 500 events) so a newly connecting WebSocket client can request recent history on connect, rather than only seeing events from the moment they connected.

Return the instrumented LargeLanguageModelTriage.py showing the event emitter integration points at each node boundary, and the finalized event schema.
```

---

## 3. Backend: WebSocket Bridge (`api_routes.py`)

```text
You are a Principal Backend Engineer exposing the LangGraph event stream and a scoped chat interface via FastAPI WebSockets.

Your tasks:

### 3.1 Passive broadcast stream — `ws/agent/stream`
1. Implement a FastAPI WebSocket endpoint at `ws/agent/stream` that subscribes to the internal pub/sub channel from Section 2 and broadcasts every event to all connected clients.
2. On client connect, immediately replay the last N buffered events (from the ring buffer) so the UI is never blank on load, then continue streaming live events.
3. Enforce authentication on WebSocket connect (validate the HttpOnly session cookie via the existing `/api/auth/session` mechanism) — this endpoint must not be reachable by unauthenticated clients, since agent reasoning may include sensitive investigation context.
4. Implement backpressure handling: if a client's send buffer grows beyond a defined threshold (slow client), drop that specific client's oldest buffered messages rather than blocking the broadcast loop for all other clients.
5. Add reconnect-friendly semantics: support a `lastEventId` query param on connect so a reconnecting client can request only events since their last received event, avoiding duplicate or missed events during brief disconnects.

### 3.2 Interactive scoped chat — `ws/agent/chat`
1. Implement a separate FastAPI WebSocket endpoint at `ws/agent/chat` that is session-scoped per analyst (tied to their authenticated identity, not broadcast).
2. Each incoming chat message must be routed through a constrained LangChain agent configuration that only has access to read-only tools (query investigation history, summarize an alert, explain a risk score) — explicitly exclude any tool capable of triggering isolate_host, disable_rule, or playbook execution.
3. Stream the chat agent's response token-by-token (or chunk-by-chunk) back over the same WebSocket for a responsive typing-indicator experience, rather than waiting for the full completion.
4. Apply the same LiteLLM Router fallback chain to chat queries as the main triage pipeline, and emit the same fallback event schema so the frontend can show "this chat response was generated via Anthropic fallback" transparently.
5. Rate-limit chat messages per analyst session (e.g., max 10 messages per minute) to prevent runaway costs against paid LLM providers, returning a clear rate-limit error message over the WebSocket rather than silently dropping messages.
6. Log every chat query and response to the audit trail (referenced in the earlier Audit Log Page design) since analyst-AI conversations about live investigations are security-relevant records.

Return the complete FastAPI WebSocket route implementations for both endpoints, including auth enforcement, backpressure handling, and rate limiting.
```

---

## 4. Frontend: Agent Operations Panel (`CommandCenter.tsx`)

```text
You are a Principal Frontend Engineer building the Agent Operations Panel inside CommandCenter.tsx, consuming the two new WebSocket endpoints via the existing useWebSocketStream hook pattern established elsewhere in the codebase (e.g., EdrLogsPage live tail, InvestigationDashboard).

Your tasks:

### 4.1 Live Agent Triage Feed
1. Build a scrolling terminal-style component (e.g., AgentTriageFeed.tsx under features/investigations/ui/ or a new features/agent-ops/ slice) that renders each incoming event as a single line: timestamp, node name, status, and a state-transition arrow visualization (`[Ingest] -> [Deobfuscation] -> [LLM Triage] -> [Action]`), color-coded by status (in-progress amber, completed green, failed red).
2. Implement virtualized rendering for the feed (reuse the performance-budget standard from the cross-cutting infrastructure work — any list exceeding ~200 rows must virtualize) since this feed can grow very large during high-volume ingestion periods.
3. Add a pause/resume control so an analyst can freeze the feed to read a specific event without losing their place, while events continue buffering in the background (not being dropped) until resumed.
4. Add a filter bar (by node, by status, by correlationId) so an analyst investigating a specific alert can isolate just that alert's agent trace instead of the full firehose.
5. Clicking any event row with a non-null investigationId must deep-link to that investigation's detail view, using the shared Entity Link utility established in prior cross-cutting infrastructure work.

### 4.2 Resilience / Backup Logic Indicators
1. Build a persistent status indicator component (e.g., AgentResilienceStatus.tsx) showing the currently active LLM provider (OpenAI / Anthropic / Gemini / Ollama) as a labeled StatusDot, updating live as fallback events arrive.
2. When a fallback event is received, animate a clear visual transition (e.g., a brief highlighted banner: "Primary provider (OpenAI) failed — failover to Anthropic succeeded") that auto-dismisses after a few seconds but leaves a persistent log entry in the triage feed.
3. When `FALLBACK_DETERMINISTIC_RULE_TRIGGERED` is received, escalate the visual treatment significantly beyond a normal fallback notice: a prominent, non-dismissible-until-acknowledged banner (e.g., red, top of panel) stating that AI-based triage is fully degraded and static rules are handling detections, since this materially changes the trust level of automated triage decisions during that window.
4. Maintain a small historical strip showing provider uptime/fallback frequency over the current shift (e.g., "OpenAI: 94% of requests, Anthropic fallback: 5%, Static ruleset: 1%") to give analysts a sense of how reliable AI triage has been recently.
5. Ensure this component degrades gracefully if the `ws/agent/stream` connection itself drops — show a distinct "Agent telemetry connection lost" state (not to be confused with an LLM provider failure) with automatic reconnect and backoff, reusing the existing reconnect pattern from useWebSocketStream.

### 4.3 Interactive AI Assistant Widget
1. Build a floating, collapsible chat widget (e.g., AgentChatWidget.tsx) docked to a corner of CommandCenter.tsx, connected to `ws/agent/chat`, that does not obstruct the Live Agent Triage Feed or existing metric cards when collapsed.
2. Implement streaming token rendering with a typing indicator, and clearly label which LLM provider generated each response (surfaced from the fallback event schema) so analysts understand response provenance.
3. Display the rate-limit state explicitly if the analyst hits the message-per-minute cap, rather than a silent failure.
4. Explicitly label the widget's scope to set correct analyst expectations, e.g., a persistent subtitle: "Read-only assistant — cannot isolate hosts, disable rules, or execute playbooks," so analysts do not mistakenly assume chat commands can perform actions.
5. Allow "starting" a chat pre-scoped to a specific investigation (e.g., a "Ask AI about this" button on InvestigationDashboard that opens the widget with investigationId context pre-attached), improving relevance of responses without requiring the analyst to re-explain context.

Return the complete AgentTriageFeed.tsx, AgentResilienceStatus.tsx, and AgentChatWidget.tsx components, plus the modified CommandCenter.tsx integrating all three into the existing layout without displacing current metric cards.
```

---

## 5. Cross-Service Data Flow Clarification (Go `core-ingest` Involvement)

```text
You are a Principal System Designer clarifying exactly how core-ingest (Go) participates in this agent visualization pipeline, since the original proposal references it without specifying the boundary.

Your tasks:
1. Confirm and document explicitly: core-ingest ingests and correlates raw telemetry, then hands qualified events to soc-backend (Python) via gRPC (soc_service.proto) for LangGraph triage — core-ingest itself does not participate in or emit LangGraph state events, since the LLM triage pipeline lives entirely in soc-backend.
2. Ensure the correlationId generated at ingestion time in core-ingest is passed through unchanged into soc-backend's gRPC call and subsequently into every LangGraph event emitted for that event, so the frontend can trace a single alert from raw ingestion through final triage/action in one consistent ID across Go logs, Python logs, and the Agent Operations Panel.
3. Explicitly rule out any direct WebSocket connection between the frontend and core-ingest for this feature — all agent visualization data flows exclusively through soc-backend's ws/agent/stream, keeping core-ingest's responsibility strictly to ingestion/correlation as defined in the earlier system design work.

Return a short data-flow diagram description (core-ingest -> gRPC -> soc-backend LangGraph -> ws/agent/stream -> CommandCenter.tsx) confirming correlationId propagation end-to-end.
```

---

## 6. Verification Plan

```text
You are a Principal QA/Reliability Engineer verifying the complete Agent Operations Panel feature end-to-end.

Test cases:
1. Cold load: open CommandCenter.tsx fresh — confirm the Live Agent Triage Feed immediately populates with recent buffered history (not blank) and the Resilience indicator shows the current active provider correctly.
2. Live event flow: send a test telemetry event through core-ingest and confirm the full node sequence (Ingest -> Deobfuscation -> LLMTriage -> Action) renders in the feed in correct order with accurate latencyMs values, and that clicking the event navigates to the correct investigation.
3. Primary provider failure simulation: invalidate the OpenAI API key and confirm: (a) a fallback event fires, (b) the Resilience indicator transitions to Anthropic with the animated banner, (c) the triage feed logs the failure and fallback explicitly.
4. Full cascade failure simulation: invalidate all cloud provider keys and stop the local Ollama container; confirm the FALLBACK_DETERMINISTIC_RULE_TRIGGERED banner appears prominently and requires explicit analyst acknowledgment to dismiss.
5. Chat isolation test: from the AgentChatWidget, attempt to phrase a message that requests a destructive action (e.g., "isolate host X now") and confirm the constrained chat agent cannot and does not invoke isolate_host — it must respond only with information or redirect the analyst to IsolationControlsPage.
6. Rate-limit test: send more than the allowed messages per minute from the chat widget and confirm the UI surfaces the rate-limit state clearly rather than silently failing.
7. Reconnect resilience test: kill the soc-backend container briefly during an active session; confirm both ws/agent/stream and ws/agent/chat show a distinct "connection lost" state, auto-reconnect on recovery, and the triage feed backfills any missed events via lastEventId rather than showing a gap silently.
8. Load test: simulate a high-volume burst of telemetry events (e.g., 500 events/minute) and confirm the virtualized feed remains responsive without dropping the UI framerate, and that backpressure handling prevents slow clients from stalling the broadcast for other connected analysts.
9. Audit trail confirmation: verify every chat interaction and every FALLBACK_DETERMINISTIC_RULE_TRIGGERED event is present in the Audit Log Page with correct timestamps and correlationId.

Return a pass/fail report per test case with reproduction steps for any failures found, plus explicit confirmation that the chat channel cannot trigger any destructive backend action under any tested input.
```

---

## 7. Recommended Build Sequence

1. Instrument `LargeLanguageModelTriage.py` with the event emitter and ring buffer (Section 2) — this has zero frontend dependency and can be verified standalone via backend logs first.
2. Build `ws/agent/stream` (Section 3.1) and confirm it broadcasts correctly using a WebSocket test client before touching the frontend.
3. Build `AgentTriageFeed.tsx` and `AgentResilienceStatus.tsx` (Section 4.1-4.2) against the live stream.
4. Build the constrained-tool chat subgraph and `ws/agent/chat` (Section 3.2), explicitly verifying tool restriction before exposing it to the frontend.
5. Build `AgentChatWidget.tsx` (Section 4.3) last, since it depends on the constrained chat backend being provably safe first.
6. Run the full verification plan (Section 6) before merging into the main CommandCenter.tsx layout.
