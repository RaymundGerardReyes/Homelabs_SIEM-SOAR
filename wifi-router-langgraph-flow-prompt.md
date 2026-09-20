# Principal Engineer Prompt — WiFi Router Flow & Site-Visit Tracking Integrated with LangGraph

## 1. Objective

Design and harden a **router-centric network telemetry pipeline** that:

- Works with an ordinary consumer WiFi router on your local LAN (no custom firmware).
- Tracks **inbound and outbound flows per client** (5‑tuple, bytes in/out, router decisions).
- Derives a **site/domain visit graph** from encrypted traffic using DNS + limited L7 hints.
- Feeds all telemetry into the existing **core-ingest → gRPC → Antigravity multi-agent → LangGraph UI** pipeline.
- Produces an **investigation graph** that clearly shows: client → router → domain/service → action.

The goal is not deep packet inspection of encrypted content, but **precise, explainable mapping** of which local hosts talked to which external domains, over which protocols and ports, and what the router did with those packets.

---

## 2. Constraints & Telemetry Sources

### 2.1 Physical & Firmware Constraints

1. The WiFi router runs locked consumer firmware (TP‑Link, Asus, ISP gateway, etc.):
   - No SSH shell, no Docker, no custom binaries on the router.
   - Only configurable knobs: **remote syslog**, **port forwarding**, **traffic stats**, sometimes **SNMP**.

2. The SIEM/AI stack runs on a separate machine(s) (your Local Gateway Bridge, core-ingest, soc-backend), **not** on the router.

### 2.2 Telemetry Sources You Can Reliably Extract

1. **Router Syslog (UDP 514) → Gateway Bridge**
   - Firewall events: `DROP` / `BLOCK` logs with SRC/DST, protocol, ports, length.
   - DHCP leases: `DHCPACK` entries mapping MAC → IP → hostname.
   - WiFi 6 association / deauth events: 802.11ax client join/leave.

2. **DNS Telemetry** (on the bridge, not on router):
   - Option A: run a local DNS forwarder (e.g., `dnsmasq`, `CoreDNS`, `Unbound`) on the **gateway bridge** and set the router’s **LAN DNS server** to that IP.
   - Option B: if router can emit DNS logs over syslog, normalize those in the same pipeline.

3. **Optional Flow Sensors** on the bridge:
   - Suricata/Zeek capturing **PCAP** on the bridge NIC; already supported in your network_adapter/CDM pipeline.

Encrypted HTTPS traffic remains opaque at the payload level, but **SNI (for non‑DoH/DoT)** and **DNS queries** give you domain names. Combined with IP/port and router decisions, you can build a precise site‑visit and flow graph.

---

## 3. Data Model Extensions

### 3.1 NetworkFlow

Extend or validate `NetworkFlow` in `network_adapter.go` / CDM so every flow includes:

- `src_ip`, `src_mac`, `src_hostname` (client station).
- `dst_ip`, `dst_port`, `dst_hostname` (resolved via DNS, if available).
- `protocol` (TCP/UDP/ICMP).
- `bytes_in`, `bytes_out`, `packet_count`.
- `router_action` (ALLOW, DROP, NAT, FORWARD).
- `router_interface` (e.g., `wan0`, `br0`).

Ensure router syslog parsing populates these fields consistently for:

- Firewall DROP/BLOCK entries.
- Allowed flows inferred from DHCP + Suricata/Zeek.

### 3.2 DNSEvent

Introduce a `DNSEvent` CDM entity, sourced from the gateway bridge DNS forwarder:

- `client_ip`, `client_mac`, `client_hostname`.
- `query_name` (domain), `query_type` (A/AAAA/CNAME), `response_ips`.
- `timestamp`, `resolver_ip`.

Link `DNSEvent` → `NetworkFlow` via:

- temporally (same client IP within a short window).
- IP match (flow.dst_ip in DNS response set).

This becomes the basis for **“site visited”** semantics.

### 3.3 RouterHost & RouterInterface

Ensure CDM has explicit entities for:

- `RouterHost` (your ordinary WiFi router, e.g., `192.168.0.1`).
- `RouterInterface` (LAN, WAN, WiFi radio).

Every `NetworkFlow` involving the router should be modeled as:

- `ClientHost` → `RouterHost` (LAN side).
- `RouterHost` → `ExternalService` (WAN side).

This gives LangGraph a clean way to draw the router as a central node for all flows.

---

## 4. Ingestion Pipeline Adjustments

### 4.1 Fluent Bit / Agent Template on Gateway Bridge

Update the `hybrid-siem-agent` telemetry template to:

1. Listen for **router syslog** on UDP 514:

   ```ini
   [INPUT]
       Name              syslog
       Tag               router.syslog
       Listen            0.0.0.0
       Port              514
       Mode              udp
       Parser            rfc3164
   ```

2. Listen for **DNS logs** from your local DNS forwarder or Suricata DNS events:

   ```ini
   [INPUT]
       Name          tail
       Tag           dns.log
       Path          /var/log/dns-queries.log
       Parser        dns_query
   ```

3. Forward both to the SIEM hub via your existing HTTP output:

   ```ini
   [OUTPUT]
       Name          http
       Match         *
       Host          ${HUB_HOST}
       URI           /ingest
       Format        json
       Header        X-Agent-Type    gateway_bridge
   ```

### 4.2 `network_adapter.go` Normalization

Extend `NormalizeNetworkFlow` to:

1. Parse `router.syslog` entries into `NetworkFlow` records.
2. Parse `dns.log` lines into `DNSEvent` records.
3. Associate flows and DNS events into a composite structure before writing to ClickHouse.

Unit tests to add:

- `TestNormalizeNetworkFlow_RouterSyslog_FirewallDrop_WithDNSMapping`.
- `TestNormalizeNetworkFlow_DNSEvent_Association_ToFlow`.

Goal: For a given client IP and timestamp range, the system can answer:

> "Which domains did this host resolve, and which of those domains saw actual TCP flows?".

### 4.3 `agent_poller.py` Enhancements

On the gateway bridge, extend `agent_poller.py` to:

1. Periodically emit **summary heartbeat events** about router state:
   - Connected client count.
   - Total bytes in/out per interval.
   - Top N domains by traffic.

2. Push these as `LogEvent` batches to `/api/v1/agent/push` under the existing endpoint identity.

This gives Antigravity and LangGraph richer context beyond raw flow events.

---

## 5. Antigravity Multi-Agent Logic for Site & Flow Tracking

### 5.1 Triage Coordinator Responsibilities

Ensure the `antigravity_triage_coordinator` in `Domain/Investigations/…`:\

- Ingests **NetworkFlow + DNSEvent + heartbeat summaries**.
- Constructs a per-incident view where:
  - Each **client host** is associated with a set of **domains visited**.
  - Each domain has aggregate metrics (bytes out, bytes in, connection count, router action distribution).

Example derived signals:

- High bytes_out/bytes_in ratio to a rare domain → "suspicious exfiltration" candidate.
- Many clients hitting the same domain right before firewall drops → possible blocked threat campaign.

### 5.2 Network Forensics Subagent

Extend the `NetworkForensicsSubagent` to:

1. Classify flows by **direction** and **role**:
   - Client → Router → External.
   - External → Router → Client.

2. Label domains by **category**, if threat intel is available (e.g., via Abuse.ch / OTX):
   - `cdn`, `login`, `banking`, `known_c2`, `malware_host`.

3. Emit structured findings back onto the Agent Event Bus:
   - `ClientSiteVisit` events: `{client, domain, first_seen, last_seen, bytes_out, bytes_in}`.
   - `SuspiciousFlow` events: `{client, domain, reason, score}`.

### 5.3 Policy Governance Subagent

Keep the existing safety invariant: **never isolate the router gateway itself**, only client stations.

Extend governance rules to:

- Block any automated action that would tamper with DNS or router configuration directly.
- Restrict actions to ARP‑level containment and local firewalling on the gateway bridge.

---

## 6. LangGraph / Investigation Graph Visualization

### 6.1 Node Types and Edges

In the LangGraph-backed `<ForceGraph2D />` investigation view:

Represent the following nodes:

- `ClientHost`: laptop, phone, IoT device (colored per risk or criticality).
- `RouterHost`: single node for the WiFi router.
- `ExternalDomain`: domains resolved/visited (`example.com`, `api.service.com`).
- `ExternalIP`: IPs when domain unavailable.
- `FlowEdge`: client ↔ router ↔ domain edges with attributes.

Edges:

- `ClientHost` → `RouterHost` (LAN flows).
- `RouterHost` → `ExternalDomain` / `ExternalIP` (WAN flows).
- Optional: `ClientHost` → `ExternalDomain` direct logical edge for readability.

### 6.2 Edge & Node Styling

- Color edges by **router_action** (ALLOW = green, DROP = red, NAT = blue).
- Thickness proportional to **bytes_out** or **connection count**.
- Use halos or glows for domains flagged by the Network Forensics Subagent.

Ensure LangGraph orchestration keeps the **router node in the center**, with clients around it and domains orbiting as per graph physics, so a single incident view immediately shows traffic topology.

### 6.3 LCP & Usability

Keep `warmupTicks` and `cooldownTicks` tuned so the graph stabilizes quickly without hurting LCP. Consider:

- `warmupTicks` ~ 50–80.
- `cooldownTicks` ~ 100–150.
- Only enable advanced label rendering after the layout cools.

---

## 7. Validation Checklist

Use this checklist to validate the full pipeline end-to-end:

1. **Router Configuration:**
   - Remote syslog target set to the gateway bridge IP.
   - LAN DNS server set to the gateway bridge DNS forwarder.

2. **Bridge Telemetry:**
   - Fluent Bit receiving syslog and DNS logs (verify with local log tail).
   - Agent pushing events to `/ingest` with `X-Agent-Type: gateway_bridge`.

3. **Core-Ingest Normalization:**
   - `network_adapter` correctly parses firewall drops, DHCP, WiFi 6 assoc logs into `NetworkFlow`.
   - DNS logs become `DNSEvent` records.
   - ClickHouse tables show joined `NetworkFlow` + `DNSEvent` with domain mapping.

4. **Antigravity & AI Triage:**
   - `test_antigravity_agent.py` extended with cases for:
     - Site visit classification.
     - Suspicious exfiltration detection.
   - All tests pass.

5. **LangGraph UI:**
   - Investigation graph shows router in center, clients and domains around it.
   - Selecting a client highlights all domains visited and flow attributes.

6. **Safety:**
   - Governance subagent prevents any action that touches router firmware/config.
   - Only client isolation and local firewall rules on gateway bridge are allowed.

Once all boxes are checked, you have a **validated, router-aware site‑visit and flow tracking pipeline** powered by your existing SIEM, core-ingest, Antigravity multi-agent fabric, and LangGraph visualization.
