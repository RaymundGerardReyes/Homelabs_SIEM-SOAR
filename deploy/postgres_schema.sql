-- ==============================================================================
-- 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
--    - Relational Configuration Registry: Houses core access keys and secrets.
--    - Upstream: Supabase Database Ingress | Downstream: core-ingest/tenant_registry.go
-- 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
--    - Provisions a secure lookup registry to manage external tenants, decoupling 
--      credentials from environment files and ensuring dynamic onboarding capabilities.
-- 3. 🚨 CLOUD GUARDRAILS, INFRASTRUCTURE CONSTRAINTS & PARITY
--    - Employs strict Row Level Security to prevent cross-tenant credential leakage.
-- 4. 🔗 DATA LAKE SCHEMAS & CROSS-MODULE PROTOCOL CONTRACTS
--    - Used directly by MemoryRegistry to instantiate Go TenantConfig struct.
-- 5. ☣️ CASCADING FAILURE MODE & PLATFORM RESILIENCE STATE
--    - Enforces fail-closed rules if querying tenant credentials without proper JWT context.
-- ==============================================================================

-- Core Tenant Configuration Map Registry
CREATE TABLE IF NOT EXISTS tenant_registry (
    tenant_id VARCHAR(64) PRIMARY KEY,
    webhook_secret VARCHAR(64) NOT NULL, -- Hex-encoded cryptographic signature token
    clickhouse_db VARCHAR(64) NOT NULL DEFAULT 'soc_default',
    llm_key TEXT NOT NULL,                -- Encrypted provider routing key
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert sample multi-tenant configuration mappings for testing parity
INSERT INTO tenant_registry (tenant_id, webhook_secret, clickhouse_db, llm_key)
VALUES 
    ('acme-corp', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'clickhouse_db_acme', 'sk-proj-mockopenai-key-acme'),
    ('app_prod_01', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'clickhouse_db_01', 'sk-proj-mockopenai-key-01'),
    ('app_prod_02', 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', 'clickhouse_db_02', 'sk-proj-mockopenai-key-02'),
    ('app_prod_03', '9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba', 'clickhouse_db_03', 'sk-proj-mockopenai-key-03')
ON CONFLICT (tenant_id) DO NOTHING;

-- 🚨 INFRASTRUCTURE GUARDRAILS: DATABASE ROW LEVEL SECURITY (RLS) POLICY ENFORCEMENT
-- Enforces data isolation boundaries directly inside the storage engine tablesspace.
-- Ensures a query run within a specific tenant context can never return rows belonging to another space.
ALTER TABLE tenant_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_boundary ON tenant_registry;
CREATE POLICY tenant_isolation_boundary ON tenant_registry
    FOR ALL
    USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true));

-- ==============================================================================
-- 6. OBSERVABILITY & GOVERNANCE: AUDIT LEDGER
-- ==============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id VARCHAR(64) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    agent VARCHAR(128) NOT NULL,
    action VARCHAR(128) NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    risk_level VARCHAR(64) NOT NULL,
    policy_decision VARCHAR(64) NOT NULL
);

-- Optimization for tracing incidents by correlation ID
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);

-- ==============================================================================
-- 7. AUTHENTICATION & SECURITY: OAUTH STATE STORE
-- ==============================================================================
-- Temporary store for OAuth anti-CSRF state tokens to prevent replay attacks.
CREATE TABLE IF NOT EXISTS oauth_states (
    token VARCHAR(255) PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ==============================================================================
-- 8. AGENT FABRIC: IDENTITY & ENROLLMENT (PHASE 1)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenant_registry(tenant_id),
    expires_at TIMESTAMPTZ NOT NULL,
    max_use INT NOT NULL DEFAULT 1,
    uses INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS endpoint_inventory (
    endpoint_id UUID PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenant_registry(tenant_id),
    endpoint_secret VARCHAR(128) NOT NULL,
    hostname VARCHAR(255),
    label VARCHAR(255),
    type VARCHAR(64),
    cf_tunnel_url VARCHAR(255),
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_version VARCHAR(64),
    os VARCHAR(64),
    region VARCHAR(64),
    ip_address VARCHAR(64),
    status VARCHAR(64) NOT NULL DEFAULT 'pending_register',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on endpoint_inventory
ALTER TABLE endpoint_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS endpoint_isolation_boundary ON endpoint_inventory;
CREATE POLICY endpoint_isolation_boundary ON endpoint_inventory
    FOR ALL
    USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true));

-- ==============================================================================
-- 9. CONTROL PLANE: SOAR TASKS (PHASE 3)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS agent_tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES endpoint_inventory(endpoint_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenant_registry(tenant_id),
    action VARCHAR(128) NOT NULL,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(64) NOT NULL DEFAULT 'pending',
    result_details JSONB,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_pending ON agent_tasks(endpoint_id, status) WHERE status = 'pending';

-- ==============================================================================
-- 10. THREAT INTELLIGENCE & MARKETPLACE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS threat_feeds (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(64) NOT NULL,
    health VARCHAR(64) NOT NULL DEFAULT 'healthy',
    last_sync TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO threat_feeds (id, name, type, health, last_sync)
VALUES
    ('feed-alienvault-otx', 'AlienVault OTX Threat Intelligence', 'AlienVault OTX', 'healthy', NOW()),
    ('feed-abuse-ch', 'Abuse.ch Malware Bazaar Feed', 'Abuse.ch', 'healthy', NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS marketplace_listings (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    publisher VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    status VARCHAR(64) NOT NULL DEFAULT 'not_installed',
    requires_elevated BOOLEAN NOT NULL DEFAULT false,
    playbook_preview TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    description TEXT NOT NULL
);

INSERT INTO marketplace_listings (id, name, publisher, category, status, requires_elevated, playbook_preview, tags, description)
VALUES
    ('ml-1', 'AlienVault OTX Connector', 'AT&T Cybersecurity', 'threat-intel', 'installed', false, NULL, '["threat-intel", "feeds"]'::jsonb, 'Integrates AlienVault OTX threat feed for IP, domain, and hash reputation.'),
    ('ml-2', 'Abuse.ch URLhaus Feed', 'Abuse.ch', 'threat-intel', 'not_installed', false, NULL, '["threat-intel", "urls"]'::jsonb, 'Real-time feed of malicious URLs from the Abuse.ch URLhaus project.'),
    ('ml-3', 'Ransomware Auto-Contain Playbook', 'Cortex Labs', 'soar-playbook', 'installed', true, '# Ransomware Auto-Contain\n# Trigger: Malware_Detected severity=CRITICAL\n\ndef run(context):\n    target = context[''target_host'']\n    sdk.isolate_host(target)\n    sdk.tag_alert(context[''alert_id''], [''auto-contained'', ''ransomware''])\n    return f''[SUCCESS] Host {target} isolated and alert tagged.''\n', '["soar", "ransomware", "auto-response"]'::jsonb, 'Automatically isolates hosts with confirmed ransomware activity and tags the associated alert.'),
    ('ml-4', 'MITRE ATT&CK Detection Pack', 'Community', 'detection-pack', 'not_installed', true, NULL, '["detection", "mitre"]'::jsonb, '75 detection rules mapped to the MITRE ATT&CK framework covering Tactics T1059–T1190.'),
    ('ml-5', 'PagerDuty Incident Integration', 'PagerDuty', 'integration', 'not_installed', false, NULL, '["pagerduty", "alerting"]'::jsonb, 'Routes critical incidents to PagerDuty on-call schedules automatically.')
ON CONFLICT (id) DO NOTHING;
