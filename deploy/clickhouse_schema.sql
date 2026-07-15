-- ==============================================================================
-- 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
--    - Columnar Big Data Sink: The High-Throughput SIEM storage engine.
--    - Upstream: Go Core Ingestion (gRPC/Kafka) | Downstream: LangGraph Analytics
-- 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
--    - Constructs highly optimized `MergeTree` engines to absorb millions of log
--      lines per second, enabling the GNN/LLM models to perform lightning-fast
--      Spatio-Temporal lookups across massive historical windows.
-- 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
--    - Cold Storage Eviction: Uses rigid Time-To-Live (TTL) mechanics (`INTERVAL 90 DAY`)
--      to automatically drop old partitions. This is a critical guardrail against
--      infinite storage leaks crashing the host OS SSD.
--    - Partition limits: Explicitly partitions by `toYYYYMMDD()` to avoid triggering
--      fatal ClickHouse "Too many parts" limit errors during high-speed ingestion.
-- 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
--    - Interfaces with the Go Core via Kafka streams or Native ClickHouse TCP.
-- 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
--    - Failure Mode: If ingestion outpaces SSD write IOPS, ClickHouse throttles.
--    - Fallback State: Go Core DLQ / Kafka broker queue backpressure engages.
-- ==============================================================================
-- CLICKHOUSE DATA WAREHOUSE SCHEMA FOR AGENTIC SIEM
-- Optimized for sub-millisecond lookups on stream fetching
-- =========================================================================

CREATE DATABASE IF NOT EXISTS soc;

-- Main Security Logs Table
CREATE TABLE IF NOT EXISTS soc.application_security_logs (
    event_id UUID,
    timestamp DateTime64(3, 'UTC'),
    application_name LowCardinality(String),
    environment LowCardinality(String),
    client_ip IPv4, -- Enforces native IP binary storage for lightning-fast range queries
    user_id String,
    api_endpoint String,
    action_executed LowCardinality(String),
    http_status UInt16,
    risk_score UInt8,
    raw_data String
) ENGINE = MergeTree()
-- 1. PRIMARY KEY: Optimized for Agentic Triage context lookups 
-- (Agents query by IP or User over recent time windows)
ORDER BY (client_ip, timestamp, event_id)
-- 2. PARTITIONING: Fixed the previous "Boot Crash Bug"
-- Partition by day to avoid "too many parts" errors during high-speed batch streaming
PARTITION BY toYYYYMMDD(timestamp)
-- 3. TTL: Automated Cold Storage Eviction
-- Drops raw event data older than 90 days to conserve SSD capacity
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

-- =========================================================================
-- SECONDARY DATA SKIPPING INDICES
-- =========================================================================
-- Accelerates LangGraph LLM free-text lookups when hunting for specific actions
ALTER TABLE soc.application_security_logs ADD INDEX IF NOT EXISTS 
    idx_action_executed (action_executed) TYPE set(0) GRANULARITY 2;

-- Accelerates JSON extract parsing if agents need deep payload introspection
ALTER TABLE soc.application_security_logs ADD INDEX IF NOT EXISTS 
    idx_raw_payload_bloom (raw_data) TYPE tokenbf_v1(10240, 2, 0) GRANULARITY 2;

-- =========================================================================
-- REMOTE AGENT INGESTION PARSING SCHEMAS
-- =========================================================================
-- Remote endpoints pushing directly into the HTTP Webhook
CREATE TABLE IF NOT EXISTS soc.remote_agent_telemetry (
    ingest_time DateTime64(3, 'UTC') DEFAULT now(),
    remote_host LowCardinality(String),
    agent_id UUID,
    os_type LowCardinality(String),
    process_name String,
    process_hash String,
    network_destination IPv4,
    network_port UInt16,
    threat_confidence UInt8
) ENGINE = MergeTree()
ORDER BY (remote_host, ingest_time, agent_id)
PARTITION BY toYYYYMMDD(ingest_time)
TTL toDateTime(ingest_time) + INTERVAL 30 DAY;

-- 1. Create the Explicit Destination Table for the Hot-Index (with Strict 14-Day TTL)
CREATE TABLE IF NOT EXISTS soc.high_risk_alerts_storage (
    ingest_time DateTime64(3, 'UTC') DEFAULT now(),
    remote_host LowCardinality(String),
    agent_id UUID,
    os_type LowCardinality(String),
    process_name String,
    process_hash String,
    network_destination IPv4,
    network_port UInt16,
    threat_confidence UInt8
) ENGINE = MergeTree()
ORDER BY (remote_host, ingest_time, agent_id)
PARTITION BY toYYYYMMDD(ingest_time)
TTL toDateTime(ingest_time) + INTERVAL 14 DAY; -- Prevents Infinite Storage Leaks

-- 2. Materialized View for Real-Time Alert Triage Acceleration
CREATE MATERIALIZED VIEW IF NOT EXISTS soc.mv_high_risk_remote_alerts
TO soc.high_risk_alerts_storage
AS
SELECT *
FROM soc.remote_agent_telemetry
WHERE threat_confidence >= 80;
