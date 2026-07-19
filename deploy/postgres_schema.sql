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
    ('app_prod_01', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'clickhouse_db_01', 'sk-proj-mockopenai-key-01'),
    ('app_prod_02', 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', 'clickhouse_db_02', 'sk-proj-mockopenai-key-02'),
    ('app_prod_03', '9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba', 'clickhouse_db_03', 'sk-proj-mockopenai-key-03')
ON CONFLICT (tenant_id) DO NOTHING;

-- 🚨 INFRASTRUCTURE GUARDRAILS: DATABASE ROW LEVEL SECURITY (RLS) POLICY ENFORCEMENT
-- Enforces data isolation boundaries directly inside the storage engine tablesspace.
-- Ensures a query run within a specific tenant context can never return rows belonging to another space.
ALTER TABLE tenant_registry ENABLE ROW LEVEL SECURITY;

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
CREATE INDEX idx_audit_logs_correlation_id ON audit_logs(correlation_id);
