-- ==============================================================================
-- Phase 0 ClickHouse Migration — Multi-System Network Monitoring
-- New tables: network_flows, dns_events, container_metrics
-- Follows existing MergeTree + TTL + Partition-by-day pattern.
-- ==============================================================================

-- ==============================================================================
-- 1. NETWORK FLOWS TABLE
--    Stores canonical NetworkFlow records from all endpoint types.
--    Ordered by (tenant_id, src_ip, timestamp) for rapid per-host forensics.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS soc.network_flows (
    -- Partitioning & Ordering
    tenant_id        UUID,
    timestamp        DateTime64(3, 'UTC'),
    event_id         UUID,

    -- Identity
    endpoint_id      String,
    endpoint_type    LowCardinality(String),   -- laptop, server, container_host, gateway_bridge, paas
    flow_id          String,

    -- Network 5-tuple
    src_ip           String,                   -- Use String not IPv4 to support IPv6 + partial data
    src_port         UInt16,
    dst_ip           String,
    dst_port         UInt16,
    protocol         LowCardinality(String),   -- TCP, UDP, ICMP, ...

    -- Layer-7 / Application
    application      String,
    dst_hostname     String,                   -- resolved domain if available
    src_mac          String,                   -- WiFi 6 / ARP-sourced MAC address
    src_hostname     String,                   -- reverse-DNS or DHCP hostname

    -- Byte Metrics
    bytes_out        UInt64,
    bytes_in         UInt64,
    packets_out      UInt64,
    packets_in       UInt64,
    flow_duration_ms Float64,

    -- Router / Gateway Metadata
    router_action    LowCardinality(String),   -- ALLOW, DROP, NAT, FORWARD
    router_interface String,                   -- e.g. eth0, wlan0

    -- Process Context (from endpoint agent)
    pid              UInt32,
    process_name     String,
    process_hash     String,

    -- Container Context
    container_id     String,
    container_image  String,

    -- Enrichment
    threat_score     UInt8,                    -- 0-100; filled by detection layer
    finding_category LowCardinality(String)    -- rat, exfiltration, ddos, container_abuse, network_anomaly, ''

) ENGINE = MergeTree()
ORDER BY   (tenant_id, src_ip, timestamp, event_id)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 45 DAY;

-- Data-skipping index for router_action pattern queries (e.g. all DROPs)
ALTER TABLE soc.network_flows ADD INDEX IF NOT EXISTS
    idx_nf_router_action (router_action) TYPE set(0) GRANULARITY 4;

-- Data-skipping index for threat score hot-path
ALTER TABLE soc.network_flows ADD INDEX IF NOT EXISTS
    idx_nf_threat_score (threat_score) TYPE minmax GRANULARITY 4;

-- Data-skipping index for process name hunting
ALTER TABLE soc.network_flows ADD INDEX IF NOT EXISTS
    idx_nf_process_name (process_name) TYPE bloom_filter() GRANULARITY 2;

-- ==============================================================================
-- 2. DNS EVENTS TABLE
--    Stores DNSEvent records from the gateway bridge dnsmasq forwarder.
--    Primary key: (tenant_id, client_ip, timestamp) for per-host domain timeline.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS soc.dns_events (
    tenant_id        UUID,
    timestamp        DateTime64(3, 'UTC'),
    event_id         UUID,

    endpoint_id      String,
    client_ip        String,
    client_mac       String,
    client_hostname  String,

    query_name       String,                   -- The FQDN queried
    query_type       LowCardinality(String),   -- A, AAAA, CNAME, MX, TXT, ...
    response_ips     Array(String),            -- All resolved IPs
    resolver_ip      String,                   -- Upstream resolver

    -- Enrichment
    domain_category  LowCardinality(String),   -- cdn, banking, login, known_c2, malware_host, general
    is_suspicious    UInt8                     -- 0/1 boolean flag

) ENGINE = MergeTree()
ORDER BY   (tenant_id, client_ip, timestamp, event_id)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY;

ALTER TABLE soc.dns_events ADD INDEX IF NOT EXISTS
    idx_dns_query_name (query_name) TYPE bloom_filter() GRANULARITY 2;

ALTER TABLE soc.dns_events ADD INDEX IF NOT EXISTS
    idx_dns_suspicious (is_suspicious) TYPE set(0) GRANULARITY 4;

-- ==============================================================================
-- 3. CONTAINER METRICS TABLE
--    Stores per-container CPU/memory/network telemetry from Docker host agents.
--    Ordered by (tenant_id, container_id, timestamp) for baseline/drift queries.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS soc.container_metrics (
    tenant_id        UUID,
    timestamp        DateTime64(3, 'UTC'),
    event_id         UUID,

    endpoint_id      String,                   -- Docker host endpoint_id
    container_id     String,                   -- Full Docker container ID
    container_name   String,                   -- Human-readable name
    container_image  LowCardinality(String),   -- Image name:tag

    -- Lifecycle
    lifecycle_event  LowCardinality(String),   -- start, stop, restart, die, oom
    status           LowCardinality(String),   -- running, exited, paused

    -- Resource Metrics (sampled)
    cpu_pct          Float32,                  -- CPU usage percentage
    mem_used_bytes   UInt64,
    mem_limit_bytes  UInt64,
    mem_pct          Float32,

    -- Network (per-container interface)
    net_rx_bytes     UInt64,
    net_tx_bytes     UInt64,
    net_rx_packets   UInt64,
    net_tx_packets   UInt64,
    net_rx_errors    UInt32,
    net_tx_errors    UInt32,

    -- DDoS / Abuse Signal
    pps_rx           Float32,                  -- Packets per second inbound
    pps_tx           Float32,                  -- Packets per second outbound
    unique_dst_count UInt32,                   -- Unique destination IPs in window
    baseline_dev     Float32,                  -- Z-score deviation from rolling baseline

    -- Enrichment
    finding_category LowCardinality(String),   -- ddos, container_abuse, ''
    threat_score     UInt8

) ENGINE = MergeTree()
ORDER BY   (tenant_id, container_id, timestamp, event_id)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY;

ALTER TABLE soc.container_metrics ADD INDEX IF NOT EXISTS
    idx_cm_threat (threat_score) TYPE minmax GRANULARITY 4;

-- ==============================================================================
-- 4. MATERIALIZED VIEW — Suspicious DNS Events Hot Path
--    Real-time fan-out of known_c2 and malware_host DNS queries to a 14-day
--    hot-index for immediate analyst triage.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS soc.suspicious_dns_hot (
    tenant_id       UUID,
    timestamp       DateTime64(3, 'UTC'),
    event_id        UUID,
    client_ip       String,
    query_name      String,
    domain_category LowCardinality(String),
    response_ips    Array(String)
) ENGINE = MergeTree()
ORDER BY   (tenant_id, client_ip, timestamp)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 14 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS soc.mv_suspicious_dns
TO soc.suspicious_dns_hot
AS
SELECT
    tenant_id, timestamp, event_id, client_ip, query_name, domain_category, response_ips
FROM soc.dns_events
WHERE domain_category IN ('known_c2', 'malware_host') OR is_suspicious = 1;

-- ==============================================================================
-- 5. MATERIALIZED VIEW — High-PPS Container Abuse Alert Hot Path
-- ==============================================================================
CREATE TABLE IF NOT EXISTS soc.container_abuse_hot (
    tenant_id       UUID,
    timestamp       DateTime64(3, 'UTC'),
    event_id        UUID,
    container_id    String,
    container_name  String,
    pps_tx          Float32,
    unique_dst_count UInt32,
    baseline_dev    Float32,
    threat_score    UInt8
) ENGINE = MergeTree()
ORDER BY   (tenant_id, container_id, timestamp)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 14 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS soc.mv_container_abuse_hot
TO soc.container_abuse_hot
AS
SELECT
    tenant_id, timestamp, event_id, container_id, container_name,
    pps_tx, unique_dst_count, baseline_dev, threat_score
FROM soc.container_metrics
WHERE threat_score >= 70;

