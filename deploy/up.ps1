# ==============================================================================
# ZERO-TRUST STACK BOOTSTRAPPER (DOTENVX WRAPPER FOR POWERSHELL)
# Automatically injects decrypted credentials into docker compose commands.
# Transparently maps container names (e.g. soc-postgres-state) to compose service names.
# ==============================================================================
Write-Host "[SOC-ORCHESTRATOR] Decrypting environment and launching container stack..." -ForegroundColor Cyan

$aliasMap = @{
    "soc-postgres-state"       = "postgres"
    "soc-clickhouse-analytics" = "clickhouse-server"
    "soc-go-ingest-core"       = "core-ingest"
    "soc-python-ai-backend"    = "soc-backend"
    "soc-nginx-proxy"          = "soc-frontend"
    "soc-cloudflared-edge"     = "cloudflared"
    "soc-node-exporter"        = "node-exporter"
}

$processedArgs = @()
foreach ($arg in $args) {
    if ($aliasMap.ContainsKey($arg)) {
        $processedArgs += $aliasMap[$arg]
    } else {
        $processedArgs += $arg
    }
}

$argString = $processedArgs -join " "
if ($argString) {
    cmd /c "dotenvx run -- docker compose up -d $argString"
} else {
    cmd /c "dotenvx run -- docker compose up -d"
}
