#!/usr/bin/env bash
# ==============================================================================
# ZERO-TRUST STACK BOOTSTRAPPER (DOTENVX WRAPPER FOR BASH / GIT BASH)
# Automatically injects decrypted credentials into docker compose commands.
# Transparently maps container names (e.g. soc-postgres-state) to compose service names.
# ==============================================================================
args=()
for arg in "$@"; do
    case "$arg" in
        soc-postgres-state)         args+=("postgres") ;;
        soc-clickhouse-analytics)   args+=("clickhouse-server") ;;
        soc-go-ingest-core)         args+=("core-ingest") ;;
        soc-python-ai-backend)      args+=("soc-backend") ;;
        soc-nginx-proxy)            args+=("soc-frontend") ;;
        soc-cloudflared-edge)       args+=("cloudflared") ;;
        soc-node-exporter)          args+=("node-exporter") ;;
        *)                          args+=("$arg") ;;
    esac
done

echo "[SOC-ORCHESTRATOR] Decrypting environment and launching container stack..."
dotenvx run -- docker compose up -d "${args[@]}"
