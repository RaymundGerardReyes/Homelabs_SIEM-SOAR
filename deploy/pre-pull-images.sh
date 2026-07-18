#!/usr/bin/env bash
# ==============================================================================
# SOC Platform — Docker Image Pre-Flight Pull Script (Git Bash / WSL2 / Linux)
# ==============================================================================
# PURPOSE:
#   Pulls every base image used by the SOC platform Dockerfiles INDIVIDUALLY
#   before running `docker compose up --build`. This is the recommended permanent
#   resilience fix for Windows WSL2 TLS handshake timeouts that block multi-stage
#   builds. Pulling images one-at-a-time with retries prevents the entire build
#   pipeline from crashing due to a single transient registry timeout.
#
# USAGE (from the deploy/ directory in Git Bash):
#   bash pre-pull-images.sh
#   Then:
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build -d
# ==============================================================================

set -euo pipefail

IMAGES=(
  "node:20-alpine"
  "nginx:alpine"
  "golang:1.25-alpine"
  "python:3.11-slim"
  "postgres:16-alpine"
  "clickhouse/clickhouse-server:latest"
  "cloudflare/cloudflared:latest"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}  SOC Platform — Docker Image Pre-Flight Checker${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# ─── STEP 1: Verify Docker Hub Connectivity ───────────────────────────────────
echo -e "${YELLOW}[STEP 1] Testing connectivity to registry-1.docker.io...${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://registry-1.docker.io/v2/" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "401" ]]; then
  # 401 is expected — it means the registry is up but requires auth (normal for anonymous probe)
  echo -e "         ${GREEN}[OK] Docker Hub is reachable (HTTP $HTTP_CODE).${NC}"
else
  echo ""
  echo -e "${RED}[FATAL] Cannot reach registry-1.docker.io (HTTP $HTTP_CODE).${NC}"
  echo -e "${RED}        TLS handshake will fail on docker compose build.${NC}"
  echo ""
  echo -e "${YELLOW}  Recommended fixes:${NC}"
  echo -e "${YELLOW}    1. Open a native Windows PowerShell and run:  wsl --shutdown${NC}"
  echo -e "${YELLOW}    2. Restart Docker Desktop from the system tray.${NC}"
  echo -e "${YELLOW}    3. Disconnect VPN/proxy if active.${NC}"
  echo -e "${YELLOW}    4. Re-run this script after Docker Desktop is back online.${NC}"
  echo ""
  exit 1
fi

echo ""

# ─── STEP 2: Pull images one-by-one with 3 retries ────────────────────────────
echo -e "${YELLOW}[STEP 2] Pre-pulling ${#IMAGES[@]} base images individually...${NC}"
echo ""

FAILED=()

for IMAGE in "${IMAGES[@]}"; do
  echo -e "${WHITE}  --> Pulling: ${IMAGE}${NC}"
  SUCCESS=false

  for ATTEMPT in 1 2 3; do
    if docker pull "$IMAGE" > /dev/null 2>&1; then
      echo -e "      ${GREEN}[OK] ${IMAGE} pulled successfully.${NC}"
      SUCCESS=true
      break
    else
      if [[ $ATTEMPT -lt 3 ]]; then
        echo -e "      ${YELLOW}[RETRY ${ATTEMPT}/3] Failed. Retrying in 5s...${NC}"
        sleep 5
      else
        echo -e "      ${RED}[FAILED] ${IMAGE} could not be pulled after 3 attempts.${NC}"
        FAILED+=("$IMAGE")
      fi
    fi
  done
  echo ""
done

# ─── Final Summary ─────────────────────────────────────────────────────────────
echo -e "${CYAN}============================================================${NC}"
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo -e "${GREEN}  [SUCCESS] All images pulled. Safe to run docker compose.${NC}"
  echo -e "${CYAN}============================================================${NC}"
  echo ""
  echo -e "${WHITE}  Next command to run:${NC}"
  echo -e "${CYAN}  docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build -d${NC}"
  echo ""
else
  echo -e "${RED}  [FAILED] The following images could NOT be pulled:${NC}"
  for IMG in "${FAILED[@]}"; do
    echo -e "    ${RED}- ${IMG}${NC}"
  done
  echo ""
  echo -e "${RED}  Do NOT run docker compose build until these are resolved.${NC}"
  echo -e "${YELLOW}  Restart WSL2 (wsl --shutdown) then Docker Desktop, and retry.${NC}"
  echo -e "${CYAN}============================================================${NC}"
  echo ""
  exit 1
fi
