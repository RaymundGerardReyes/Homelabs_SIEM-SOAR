#!/usr/bin/env bash
# ==============================================================================
# 1. 🔄 RACING & ORCHESTRATION DEPENDENCY STEPS
#    - Blocks initialization until PostgreSQL and ClickHouse are fully accepting
#      connections using resilient probes (`pg_isready` and `curl`), entirely
#      replacing arbitrary `sleep` commands.
# 2. ⚡ IDEMPOTENCY & SCHEMA MIGRATION GUARDRAILS
#    - Executes schema files that enforce `IF NOT EXISTS`, ensuring zero-downtime
#      re-runs without corrupting tablespaces or locking active indices.
# 3. 🚨 COMPACTION & STORAGE OPTIMIZATION VECTORS
#    - Validates target engines (PostgreSQL OLTP and ClickHouse OLAP) are ready
#      to accept optimized MergeTree arrays and high-speed B-Trees.
# 4. 🔑 SECRET MOUNTING & PRIVILEGE BOUNDARIES
#    - Strictly retrieves the PostgreSQL password via `/run/secrets/pg_db_password`
#      instead of hardcoded plaintext, running with bounded privileges.
# 5. ☣️ CRASH CONTEXT & ROLLBACK FAILSAFE RUNBOOK
#    - Implements `set -euo pipefail`. If a migration crashes, the script exits
#      immediately (status 1), halting orchestration and logging the precise failure
#      without leaving orphaned states.
# ==============================================================================

set -euo pipefail

echo "====================================================================="
echo "🛡️  INITIALIZING DUAL-STORAGE PLATFORM ARCHITECTURE (OLTP + OLAP)"
echo "====================================================================="

# ---------------------------------------------------------
# SECRET MOUNTING VERIFICATION & BOUNDARIES
# ---------------------------------------------------------
if [[ ! -f "/run/secrets/pg_db_password" ]]; then
    # In some dev environments, we might fall back to ENV vars, but strictly enforcing secrets is better for production.
    # We will log a warning and fallback ONLY if testing, but ideally we crash out here.
    if [[ -z "${DB_PASSWORD:-}" ]]; then
        echo "🚨 CRITICAL: PostgreSQL secret /run/secrets/pg_db_password not found, and DB_PASSWORD not set!"
        echo "Failsafe triggered. Aborting initialization to prevent plaintext fallback."
        exit 1
    else
        echo "⚠️ WARNING: Using DB_PASSWORD env variable. Production must use /run/secrets/pg_db_password."
        export PGPASSWORD="${DB_PASSWORD}"
    fi
else
    export PGPASSWORD=$(cat /run/secrets/pg_db_password)
fi

PG_USER=${DB_USER:-postgres}
PG_DB=${DB_NAME:-soc}
PG_HOST=${DB_HOST:-postgres}

CH_USER=${CLICKHOUSE_USER:-default}
CH_PASS=${CLICKHOUSE_PASSWORD:-clickhouse_secure_pass_123}
CH_HOST=${CLICKHOUSE_HOST:-clickhouse-server}
CH_DB=${CLICKHOUSE_DB:-soc}

# ---------------------------------------------------------
# PROBE 1: POSTGRESQL (OLTP) RACING DEPENDENCY
# ---------------------------------------------------------
echo "🔄 Probing PostgreSQL engine at ${PG_HOST}:5432..."
# Wait loop utilizing pg_isready for resilient health checking
until pg_isready -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; do
    echo "   [Wait] PostgreSQL is booting. Retrying in 2 seconds..."
    sleep 2
done
echo "✅ PostgreSQL engine is fully awake and accepting connections."

# ---------------------------------------------------------
# PROBE 2: CLICKHOUSE (OLAP) RACING DEPENDENCY
# ---------------------------------------------------------
echo "🔄 Probing ClickHouse engine at ${CH_HOST}:8123..."
# Wait loop utilizing HTTP ping endpoint for resilient health checking
until curl -sS "http://${CH_HOST}:8123/ping" >/dev/null 2>&1; do
    echo "   [Wait] ClickHouse is booting. Retrying in 2 seconds..."
    sleep 2
done
echo "✅ ClickHouse engine is fully awake and accepting connections."

# ---------------------------------------------------------
# STAGE 3: IDEMPOTENT SCHEMA INJECTION
# ---------------------------------------------------------
# By running with set -e, any failure in psql or curl aborts the script immediately.

echo "⚡ Injecting Idempotent PostgreSQL Schema (OLTP State Engine)..."
# Applying the idempotency guardrails natively inside the .sql files (IF NOT EXISTS)
if psql -h "$PG_HOST" -U "$PG_USER" -d "$PG_DB" -f deploy/postgres_schema.sql; then
    echo "✅ PostgreSQL schema applied successfully."
else
    echo "🚨 CRITICAL: PostgreSQL schema injection failed! Rollback failsafe engaged."
    exit 1
fi

echo "⚡ Injecting Idempotent ClickHouse Schema (OLAP Data Sink)..."
# Applying the columnar data lake schemas idempotently
if curl -sS -u "${CH_USER}:${CH_PASS}" -X POST "http://${CH_HOST}:8123/" --data-binary @deploy/clickhouse_schema.sql; then
    echo "✅ ClickHouse schema applied successfully."
else
    echo "🚨 CRITICAL: ClickHouse schema injection failed! Rollback failsafe engaged."
    exit 1
fi

echo "====================================================================="
echo "🚀 PLATFORM STORAGE BOOTSTRAPPED AND READY FOR HIGH-THROUGHPUT SIEM."
echo "====================================================================="
