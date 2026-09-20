-- Phase 9.9.3 ClickHouse Migration Dry Run & Cutover Validation Script
-- =========================================================================

-- 1. CREATE V2 TABLES WITH MULTI-TENANT ISOLATION
-- =========================================================================
CREATE TABLE IF NOT EXISTS soc.application_security_logs_v2 (
    tenant_id UUID,
    event_id UUID,
    timestamp DateTime64(3, 'UTC'),
    application_name LowCardinality(String),
    environment LowCardinality(String),
    client_ip IPv4,
    user_id String,
    api_endpoint String,
    action_executed LowCardinality(String),
    http_status UInt16,
    risk_score UInt8,
    raw_data String
) ENGINE = MergeTree()
ORDER BY (tenant_id, client_ip, timestamp, event_id)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS soc.remote_agent_telemetry_v2 (
    tenant_id UUID,
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
ORDER BY (tenant_id, remote_host, ingest_time, agent_id)
PARTITION BY toYYYYMMDD(ingest_time)
TTL toDateTime(ingest_time) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS soc.high_risk_alerts_storage_v2 (
    tenant_id UUID,
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
ORDER BY (tenant_id, remote_host, ingest_time, agent_id)
PARTITION BY toYYYYMMDD(ingest_time)
TTL toDateTime(ingest_time) + INTERVAL 14 DAY;

CREATE TABLE IF NOT EXISTS soc.cdm_events_v2 (
    tenant_id UUID,
    timestamp DateTime64(3, 'UTC') DEFAULT now(),
    cf_ray_id String,
    client_ip String,
    endpoint_id String,
    endpoint_type LowCardinality(String),
    http_path String,
    user_agent String,
    tls_fingerprint String,
    raw_payload String
) ENGINE = MergeTree()
ORDER BY (tenant_id, client_ip, cf_ray_id, timestamp)
PARTITION BY toYYYYMMDD(timestamp)
TTL toDateTime(timestamp) + INTERVAL 45 DAY;

-- 2. UNBIND MATERIALIZED VIEWS
-- =========================================================================
-- We must drop the views to prevent them from locking the tables or writing 
-- mismatched schemas during the atomic swap.
DROP VIEW IF EXISTS soc.mv_high_risk_remote_alerts;
DROP VIEW IF EXISTS soc.view_cross_environment_pivots;

-- 3. BACKFILL DATA (DRY RUN ONLY / OPTIONAL)
-- =========================================================================
-- Strategy: We only backfill rows where we can definitively resolve a tenant.
-- Ambiguous rows are abandoned in the old tables to naturally TTL out, preventing
-- cross-tenant pollution.
-- Note: Requires `postgresql` ClickHouse function enabled, pointing to our Postgres DB.
/*
INSERT INTO soc.remote_agent_telemetry_v2
SELECT 
    pg.tenant_id, 
    rat.ingest_time, 
    rat.remote_host, 
    rat.agent_id, 
    rat.os_type, 
    rat.process_name, 
    rat.process_hash, 
    rat.network_destination, 
    rat.network_port, 
    rat.threat_confidence
FROM soc.remote_agent_telemetry AS rat
JOIN postgresql('postgres_host:5432', 'public', 'endpoint_inventory', 'postgres_user', 'postgres_pass') AS pg 
  ON rat.agent_id = pg.id;
*/

-- 4. ATOMIC TABLE EXCHANGE
-- =========================================================================
-- This instantly flips the `_v2` schema into production and archives the old data 
-- into the `_v2` named tables. Since the ClickHouse engine is Atomic, no downtime occurs.
EXCHANGE TABLES soc.application_security_logs AND soc.application_security_logs_v2;
EXCHANGE TABLES soc.remote_agent_telemetry AND soc.remote_agent_telemetry_v2;
EXCHANGE TABLES soc.high_risk_alerts_storage AND soc.high_risk_alerts_storage_v2;
EXCHANGE TABLES soc.cdm_events AND soc.cdm_events_v2;

-- 5. RE-BIND MATERIALIZED VIEWS & SECONDARY INDICES
-- =========================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS soc.mv_high_risk_remote_alerts
TO soc.high_risk_alerts_storage
AS
SELECT *
FROM soc.remote_agent_telemetry
WHERE threat_confidence >= 80;

CREATE VIEW IF NOT EXISTS soc.view_cross_environment_pivots AS
SELECT 
    tenant_id,
    client_ip, 
    cf_ray_id,
    groupArray(endpoint_id) AS endpoints_touched,
    groupUniqArray(endpoint_type) AS endpoint_types,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen
FROM soc.cdm_events
WHERE timestamp > now() - INTERVAL 15 MINUTE
GROUP BY tenant_id, client_ip, cf_ray_id
HAVING length(endpoint_types) > 1
   AND has(endpoint_types, 'paas')
   AND has(endpoint_types, 'local_cf_tunnel');

-- Re-apply Data Skipping Indices for LangGraph Search Acceleration
ALTER TABLE soc.application_security_logs ADD INDEX IF NOT EXISTS 
    idx_action_executed (action_executed) TYPE set(0) GRANULARITY 2;

ALTER TABLE soc.application_security_logs ADD INDEX IF NOT EXISTS 
    idx_raw_payload_bloom (raw_data) TYPE tokenbf_v1(10240, 2, 0) GRANULARITY 2;
