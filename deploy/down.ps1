# ==============================================================================
# ZERO-TRUST STACK SHUTDOWN WRAPPER
# ==============================================================================
Write-Host "[SOC-ORCHESTRATOR] Stopping container stack..." -ForegroundColor Yellow
$extraArgs = $args -join " "
if ($extraArgs) {
    docker compose down $extraArgs
} else {
    docker compose down
}

