#!/usr/bin/env bash
echo "[SOC-ORCHESTRATOR] Stopping container stack..."
docker compose down "$@"

