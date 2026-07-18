#!/usr/bin/env pwsh
# ==============================================================================
# SOC Platform — Docker Image Pre-Flight Pull Script
# ==============================================================================
# PURPOSE:
#   Pulls every base image used by the SOC platform Dockerfiles INDIVIDUALLY
#   before running `docker compose up --build`. This is the recommended permanent
#   resilience fix for Windows WSL2 TLS handshake timeouts that block multi-stage
#   builds. Pulling images one-at-a-time allows retries per-image without
#   failing the entire build pipeline.
#
# USAGE (from the deploy/ directory in PowerShell):
#   .\pre-pull-images.ps1
#   Then:
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build -d
# ==============================================================================

$ErrorActionPreference = "Stop"

$images = @(
    "node:20-alpine",
    "nginx:alpine",
    "golang:1.25-alpine",
    "python:3.11-slim",
    "postgres:16-alpine",
    "clickhouse/clickhouse-server:latest",
    "cloudflare/cloudflared:latest"
)

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SOC Platform — Docker Image Pre-Flight Checker" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify Docker Hub connectivity before attempting any pulls
Write-Host "[STEP 1] Testing connectivity to registry-1.docker.io..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "https://registry-1.docker.io/v2/" -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
    Write-Host "         [OK] Docker Hub is reachable." -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[FATAL] Cannot reach registry-1.docker.io. TLS handshake will fail." -ForegroundColor Red
    Write-Host "        Recommended fixes:" -ForegroundColor Red
    Write-Host "          1. Run in a NEW PowerShell window:  wsl --shutdown" -ForegroundColor Red
    Write-Host "          2. Restart Docker Desktop from the system tray." -ForegroundColor Red
    Write-Host "          3. Disconnect VPN / proxy if active." -ForegroundColor Red
    Write-Host "          4. Re-run this script after Docker Desktop is back online." -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "[STEP 2] Pre-pulling $($images.Count) base images individually..." -ForegroundColor Yellow
Write-Host ""

$failed = @()
foreach ($image in $images) {
    Write-Host "  --> Pulling: $image" -ForegroundColor White
    $attempt = 0
    $success = $false

    while ($attempt -lt 3 -and -not $success) {
        $attempt++
        try {
            docker pull $image 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "      [OK] $image pulled successfully." -ForegroundColor Green
                $success = $true
            } else {
                throw "docker pull exited with code $LASTEXITCODE"
            }
        } catch {
            if ($attempt -lt 3) {
                Write-Host "      [RETRY $attempt/3] Failed. Retrying in 5s..." -ForegroundColor Yellow
                Start-Sleep -Seconds 5
            } else {
                Write-Host "      [FAILED] $image could not be pulled after 3 attempts." -ForegroundColor Red
                $failed += $image
            }
        }
    }
    Write-Host ""
}

# Final Summary
Write-Host "============================================================" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "  [SUCCESS] All images pulled. Safe to run docker compose." -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Next command to run:" -ForegroundColor White
    Write-Host "  docker compose -f docker-compose.yml -f docker-compose.dev.yml --env-file .env.dev up --build -d" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "  [FAILED] The following images could NOT be pulled:" -ForegroundColor Red
    foreach ($img in $failed) {
        Write-Host "    - $img" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "  Do NOT run docker compose build until these are resolved." -ForegroundColor Red
    Write-Host "  Restart WSL2 (wsl --shutdown) and Docker Desktop, then retry." -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}
