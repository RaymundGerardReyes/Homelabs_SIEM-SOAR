-- ==============================================================================
-- Phase 0 Migration — Multi-System Network Monitoring
-- security_findings table + endpoint_inventory type enum extension
-- Follows existing pattern: IF NOT EXISTS guards + RLS enforcement
-- ==============================================================================

-- ==============================================================================
-- 1. EXTEND endpoint_inventory WITH endpoint_type enum constraint
--    The existing `type` column is VARCHAR(64); we add a CHECK constraint
--    to enforce the canonical enum values from the implementation plan.
--    Uses ALTER COLUMN / ADD CONSTRAINT idiom compatible with Postgres 13+.
-- ==============================================================================
DO $$
BEGIN
    -- Only add the constraint if it doesn't already exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_endpoint_type_enum'
    ) THEN
        ALTER TABLE endpoint_inventory
            ADD CONSTRAINT chk_endpoint_type_enum
            CHECK (type IN (
                'laptop',
                'server',
                'container_host',
                'gateway_bridge',
                'paas',
                'router_syslog',
                'iaas'     -- legacy value used by existing test fixtures
            ));
    END IF;
END
$$;

-- ==============================================================================
-- 2. SECURITY FINDINGS TABLE
--    Central store for all detector outputs (RAT, exfil, DDoS, container abuse).
--    Linked to endpoint_inventory via endpoint_id (nullable FK for bridge-originated
--    findings that may not map to a single enrolled endpoint).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS security_findings (
    -- Identity
    finding_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    VARCHAR(64) NOT NULL REFERENCES tenant_registry(tenant_id),
    endpoint_id  UUID        REFERENCES endpoint_inventory(endpoint_id) ON DELETE SET NULL,

    -- Classification
    category     VARCHAR(64) NOT NULL
        CHECK (category IN (
            'rat',
            'exfiltration',
            'ddos',
            'container_abuse',
            'network_anomaly'
        )),
    score        SMALLINT    NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),

    -- Evidence blob — stores detector-specific fields as JSON
    evidence     JSONB       NOT NULL DEFAULT '{}'::jsonb,

    -- Recommended SOAR action
    recommended_action VARCHAR(128) NOT NULL DEFAULT 'none'
        CHECK (recommended_action IN (
            'isolate_host',
            'throttle_container',
            'isolate_lan_client',
            'none'
        )),

    -- Lifecycle
    status       VARCHAR(64) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'pending_approval', 'actioned', 'false_positive', 'closed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Optional: link back to an agent task that acted on this finding
    task_id      UUID REFERENCES agent_tasks(task_id) ON DELETE SET NULL
);

-- Optimized for: "give me all open high-score findings for this tenant"
CREATE INDEX IF NOT EXISTS idx_security_findings_tenant_score
    ON security_findings(tenant_id, score DESC, created_at DESC)
    WHERE status = 'open';

-- Optimized for: per-endpoint timeline view
CREATE INDEX IF NOT EXISTS idx_security_findings_endpoint
    ON security_findings(endpoint_id, created_at DESC)
    WHERE endpoint_id IS NOT NULL;

-- Optimized for: category-level analytics & dashboards
CREATE INDEX IF NOT EXISTS idx_security_findings_category
    ON security_findings(tenant_id, category, created_at DESC);

-- ==============================================================================
-- 3. ROW LEVEL SECURITY — Tenant Isolation
--    Mirrors the pattern used on audit_logs / endpoint_inventory.
-- ==============================================================================
ALTER TABLE security_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_findings_isolation ON security_findings;
CREATE POLICY security_findings_isolation ON security_findings
    FOR ALL
    USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true));

-- ==============================================================================
-- 4. AUTOMATED updated_at TRIGGER
--    Mirrors existing pattern used by tenant_registry.
-- ==============================================================================
CREATE OR REPLACE FUNCTION update_security_findings_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_security_findings_updated_at ON security_findings;
CREATE TRIGGER trg_security_findings_updated_at
    BEFORE UPDATE ON security_findings
    FOR EACH ROW EXECUTE FUNCTION update_security_findings_updated_at();

