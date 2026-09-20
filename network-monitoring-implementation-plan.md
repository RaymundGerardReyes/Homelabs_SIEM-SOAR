# Implementation Plan — Multi-System Network Monitoring, RAT/Exfil Detection & DDoS Defense

## 1. Purpose & Scope

This plan turns the previously discussed logic workflow (unified endpoint sensor fabric, RAT/data-exfil detection, container DDoS detection, router/gateway telemetry, LangGraph visualization) into a **phased, implementable engineering plan** for the existing Hybrid SIEM/SOAR platform (Go `core-ingest`, Python `soc-backend`, React `soc-frontend`, `hybrid-siem-agent`).

Goal: every device/system connected to the network — endpoints, Docker hosts/containers, the WiFi router/gateway bridge, and PaaS services — is monitored through one consistent telemetry, detection, and response pipeline, with results visualized in the existing LangGraph-based Network Map and Investigation Graph.

---

## 2. Guiding Principles

- Reuse the existing endpoint lifecycle (`enroll` → `register` → `push logs` → `tasks`) instead of building a parallel system.
- Treat every monitored thing (laptop, server, container, router, cloud app) as an `endpoint` with a `type` and `capabilities` list.
- Keep detection logic modular: one detector per threat class (RAT, exfiltration, DDoS, container abuse), all emitting a common `SecurityFinding` event shape.
- All destructive response actions stay behind the existing two-key/task-queue approval flow.
- Never modify router firmware directly; only the gateway bridge acts on the LAN (ARP-level containment).

---

## 3. Phased Roadmap

### Phase 0 — Foundations & Data Model (Week 1)

**Goal:** Extend the shared data model so every telemetry source can be represented consistently.

Tasks:
- [ ] Add `endpoint_type` enum values: `laptop`, `server`, `container_host`, `gateway_bridge`, `paas`, `router_syslog`.
- [ ] Add `capabilities` values: `telemetry`, `network`, `process`, `container`, `http_logs`.
- [ ] Extend CDM (Common Data Model) with entities: `Process`, `NetworkFlow`, `DNSEvent`, `Container`, `RouterInterface`.
- [ ] Define a common `SecurityFinding` schema used by all detectors:
  ```json
  {
    "finding_id": "uuid",
    "endpoint_id": "string",
    "tenant_id": "string",
    "category": "rat | exfiltration | ddos | container_abuse | network_anomaly",
    "score": 0-100,
    "evidence": { "...": "..." },
    "recommended_action": "isolate_host | throttle_container | isolate_lan_client | none",
    "created_at": "ISO8601"
  }
  ```
- [ ] Update PostgreSQL schema: add `security_findings` table; add `endpoint_type`/`capabilities` columns to `endpoint_inventory` if missing.
- [ ] Update ClickHouse schema: add `network_flows`, `dns_events`, `container_metrics` tables (or extend existing raw events table with typed columns).

Deliverable: schema migration scripts + updated CDM structs in Go and Python.

---

### Phase 1 — Endpoint Agent Telemetry (Weeks 2-3)

**Goal:** Collect process, file, and network telemetry from laptops/servers.

Tasks:
- [ ] Extend `hybrid-siem-agent` with an **endpoint telemetry module**:
  - Process start/stop events (via OS APIs: ETW on Windows, eBPF/auditd on Linux).
  - Per-process network connections (remote IP, port, protocol, bytes in/out).
  - File access events for a configurable watch list of sensitive paths.
- [ ] Batch and push these as `LogEvent`s to `/api/v1/agent/push`, tagging `source="endpoint-agent"` and including `metadata.process`, `metadata.network`, `metadata.file`.
- [ ] Add rate limiting/backpressure in the agent so telemetry bursts do not exceed the 500-event batch cap.
- [ ] Write unit tests for the telemetry serializer (Python or Go depending on agent language).

Deliverable: working endpoint agent module + test suite; sample telemetry captured from a real Windows/Linux dev machine.

---

### Phase 2 — Docker Host & Container Telemetry (Weeks 3-4)

**Goal:** Monitor containers for DDoS/abuse patterns.

Tasks:
- [ ] Add a **container telemetry collector** (sidecar or agent on the Docker host) that reads:
  - Docker Engine API / containerd events for lifecycle (start, stop, restart).
  - `cgroup` stats for CPU/memory per container.
  - Per-container network stats (via `nsenter` + `/proc/net/dev` or `iptables` counters).
- [ ] Register the Docker host as `endpoint_type=container_host`, `capabilities=[telemetry, container]`.
- [ ] Push container events/metrics via `/api/v1/agent/push` with `metadata.container_id`, `metadata.image`, `metadata.cpu`, `metadata.mem`, `metadata.net`.
- [ ] Model each container as a child `Asset` node in CDM, linked to its host.

Deliverable: container telemetry collector running against your existing Docker Compose stack (`docker-compose.yml`), verified against `soc-nginx-proxy`, `core-ingest`, `soc-backend`, `clickhouse-server`, `postgres` containers as first test targets.

---

### Phase 3 — Router / Gateway Bridge Telemetry (Weeks 4-5)

**Goal:** Reuse the previously designed WiFi router logic (already scoped) and integrate it into this broader plan.

Tasks:
- [ ] Configure router: remote syslog → gateway bridge IP:514 (UDP); LAN DNS → gateway bridge DNS forwarder.
- [ ] Finish `network_adapter.go` router syslog parsing (`DROP`, `DHCPACK`, WiFi association) — carried over from prior implementation.
- [ ] Add DNS event collection on the bridge; join `DNSEvent` to `NetworkFlow` by client IP + time window.
- [ ] Push bridge telemetry as `endpoint_type=gateway_bridge`.

Deliverable: verified router→bridge→core-ingest pipeline with passing unit tests (`TestNormalizeNetworkFlow_RouterSyslog_*`).

---

### Phase 4 — Detection Logic (Weeks 5-7)

**Goal:** Implement the three detector classes as independent, testable modules in `soc-backend`.

#### 4.1 RAT & Remote-Access Detector
- [ ] Join process events with network flow events by `pid` + time window.
- [ ] Compute features: beacon interval/jitter, destination diversity, unknown binary + long-lived connection, GUI app spawning script engine.
- [ ] Score against threshold; emit `SecurityFinding(category="rat")`.

#### 4.2 Data Exfiltration Detector
- [ ] Compute per-host outbound byte totals to rare/unknown domains over rolling windows (5 min / 1 hr / 24 hr).
- [ ] Correlate large outbound transfers with recent sensitive file access events.
- [ ] Emit `SecurityFinding(category="exfiltration")` with `bytes_out`, `destination`, `matched_file_events`.

#### 4.3 DDoS / Container Abuse Detector
- [ ] Aggregate per-container/per-host: packets-per-second, unique destination count, bytes/interval.
- [ ] Compare against rolling baseline (e.g., z-score or percentile threshold).
- [ ] Emit `SecurityFinding(category="ddos"` or `"container_abuse")` with `pps`, `dest_count`, `baseline_deviation`.

#### 4.4 Common Wiring
- [ ] All three detectors subscribe to the same internal event bus (`AgentEventBus` / gRPC consumer) already used by `AntigravityTriageCoordinator`.
- [ ] `NetworkForensicsSubagent` consumes `SecurityFinding` events and adds context (asset criticality, threat intel enrichment).
- [ ] `PolicyGovernanceSubagent` validates any resulting action against safety invariants (never isolate default gateway; only client/container-level actions).

Deliverable: `tests/test_rat_detector.py`, `tests/test_exfil_detector.py`, `tests/test_ddos_detector.py`, all passing with synthetic fixtures.

---

### Phase 5 — SOAR Response Actions (Week 8)

**Goal:** Wire detector findings to safe, auditable response actions.

Tasks:
- [ ] Extend `agent_poller.py` (or equivalent) with actions:
  - `isolate_host` (endpoint-level network isolation).
  - `throttle_container_network` / `pause_container` (Docker host).
  - `isolate_lan_client` (ARP quarantine on gateway bridge).
- [ ] Route all `DESTRUCTIVE` actions through the existing two-key approval flow (`twoKeyToken`) before dispatch via `/admin/endpoints/{id}/tasks`.
- [ ] Log every action + outcome to `auditlogs` table.

Deliverable: end-to-end test — simulate a finding, confirm task queued, confirm two-key gate blocks/approves correctly, confirm audit log entry created.

---

### Phase 6 — LangGraph / Frontend Visualization (Weeks 8-9)

**Goal:** Extend `NetworkMapPage.tsx` and investigation graph to show the new entities.

Tasks:
- [ ] Add node types: `Container`, `RouterHost`, `ExternalDomain` to the graph renderer.
- [ ] Color/label edges by finding category (`rat` = purple, `exfiltration` = orange, `ddos` = red).
- [ ] Extend node sidebar panel to show linked `SecurityFinding` details and one-click response actions (respecting two-key gating).
- [ ] Tune `warmupTicks`/`cooldownTicks` for the larger graph (more node types) to preserve LCP performance.

Deliverable: updated `NetworkMapPage.tsx` + Storybook/demo screenshots showing a simulated RAT and DDoS incident.

---

### Phase 7 — Validation & Hardening (Weeks 9-10)

Tasks:
- [ ] Load-test telemetry ingestion at realistic volumes (simulate N endpoints + M containers).
- [ ] Run adversarial test cases: simulated RAT beacon, simulated exfil burst, simulated container DDoS.
- [ ] Confirm false-positive rate is acceptable on benign baseline traffic (DHCP renewals, normal browsing, normal container restarts).
- [ ] Document runbooks for each finding category (what an analyst should check first).
- [ ] Security review: confirm agents cannot escalate privileges beyond their declared capabilities; confirm gateway bridge cannot touch router firmware.

Deliverable: validation report + runbook markdown docs.

---

## 4. Priority Matrix

| Phase | Priority | Complexity | Depends On |
|---|---|---|---|
| Phase 0 — Data model | Critical | Low | — |
| Phase 1 — Endpoint telemetry | High | Medium | Phase 0 |
| Phase 2 — Container telemetry | High | Medium | Phase 0 |
| Phase 3 — Router/bridge telemetry | Medium | Medium | Phase 0 (mostly already scoped) |
| Phase 4 — Detection logic | Critical | High | Phases 1-3 |
| Phase 5 — SOAR actions | High | Medium | Phase 4 |
| Phase 6 — LangGraph visualization | Medium | Medium | Phase 4 |
| Phase 7 — Validation | Critical | Medium | All above |

---

## 5. Minimal Viable Slice (Fastest Path to a Demo)

If time is limited, implement this reduced path first:

1. Phase 0 (data model) — required for everything.
2. Phase 1, endpoint network+process telemetry only (skip file watch initially).
3. Phase 4.1 (RAT detector) and 4.2 (exfil detector) only — these give the most compelling thesis/demo value.
4. Phase 5, `isolate_host` action only.
5. Phase 6, minimal graph update (just add `Process`/`Domain` nodes to existing map).

This slice proves the full pipeline (telemetry → detection → SOAR action → graph) end-to-end before adding container/DDoS and router breadth.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Endpoint agent needs elevated OS privileges (ETW/eBPF) | Scope to a test VM first; document required permissions per OS. |
| False positives on RAT/exfil detectors | Start with conservative thresholds; tune using a labeled benign dataset before enabling auto-response. |
| Container telemetry adds overhead to Docker hosts | Sample metrics (e.g., every 10-15s) rather than continuous polling. |
| Two-key approval flow bypassed by automation bugs | Add a hard server-side check that rejects any `DESTRUCTIVE` task without a valid `twoKeyToken`, independent of client-side logic. |
| Router/bridge misconfiguration breaks LAN | Keep governance rule hard-coded to block any action targeting the default gateway IP. |

---

## 7. Definition of Done

The implementation is considered complete when:

- All endpoint types (laptop/server, container host, gateway bridge) can enroll, register, and push telemetry through the existing `/api/endpoints/*` and `/api/v1/agent/push` routes.
- RAT, exfiltration, and DDoS/container-abuse detectors each have passing unit tests and produce `SecurityFinding` records visible in ClickHouse/Postgres.
- The LangGraph-based Network Map/Investigation Graph displays clients, containers, router, and domains with findings overlaid.
- At least one end-to-end SOAR action (isolate_host or isolate_lan_client) can be triggered from a detected finding, gated by two-key approval, and logged to `auditlogs`.
- A validation report documents false-positive rate, detection latency, and known limitations.
