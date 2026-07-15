#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# HARDENED PRODUCTION CERTBOT CRON WRAPPER 
# ───────────────────────────────────────────────────────────────
set -euo pipefail

# 1. FORCE EXPLICIT PATH INJECTIONS FOR HEADLESS CRON DAEMONS
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# 2. DEFINE SYSTEM ENGINE TRACKING VARIABLE LOCATIONS
PROJECT_ROOT="/opt/siem"
LOG_FILE="/var/log/soc_platform/certbot_renewal.log"

mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] 🔐 Commencing automated Let's Encrypt renewal loop..." >> "$LOG_FILE"

# Navigate to project location where the root Makefile lives
cd "$PROJECT_ROOT"

# ==============================================================================
# 1. 🌐 COMPONENT PLACEMENT & GLOBAL WORKFLOW TRACE
#    - Host OS Cron Layer: Executes outside of the Docker Swarm/Compose bridge.
#    - Upstream: Linux Cron Daemon | Downstream: Let's Encrypt API / Nginx Proxy
# 2. 🛡️ LOGICAL INTENT & SYSTEM RESPONSIBILITY
#    - Automates zero-downtime TLS rotation. This script wraps the Makefile to
#      ensure the environment variables are correctly inherited when running headless.
# 3. 🚨 INFRASTRUCTURE GUARDRAILS & RESOURCE CONSTRAINTS
#    - Dependencies: Assumes Nginx is currently routing `.well-known/acme-challenge`
#      properly. If the Nginx routing block is modified, the HTTP-01 challenge fails.
# 4. 🔗 CROSS-MODULE INTERFACE & CONTRACT BOUNDARIES
#    - Requires root permissions. Interfaces directly with the project `Makefile`.
# 5. ☣️ FAILURE DOMAINS & RESILIENCE STATE
#    - Failure Mode: Let's Encrypt rate-limits or DNS resolution failure.
#    - Fallback State: Force exits (exit 1), leaving the current certificate intact
#      until the cron loop tries again in 12 hours.
# ==============================================================================
# 3. TRIGGER MAKE RE-ROUTE PASSING HEADLESS OVERRIDES VIA STANDARD SHIELDS
if make certbot-renew >> "$LOG_FILE" 2>&1; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ✅ Zero-downtime certificate rotation successfully completed." >> "$LOG_FILE"
else
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] 🚨 CRITICAL: Certificate renewal pipeline failed! Check error streams." >> "$LOG_FILE"
    exit 1
fi
