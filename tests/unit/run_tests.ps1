#!/usr/bin/env pwsh
# Run from repo root: .\tests\unit\run_tests.ps1

$ErrorActionPreference = "Stop"

Write-Host "`n=== SOC-Backend Unit Test Runner ===" -ForegroundColor Cyan

# Navigate to soc-backend so relative imports work
$backendPath = Join-Path $PSScriptRoot "..\..\soc-backend"
$testFile = Join-Path $PSScriptRoot "test_api_routes.py"

Push-Location $backendPath

try {
    Write-Host "Backend path: $backendPath" -ForegroundColor DarkGray
    Write-Host "Test file:    $testFile`n"

    # Install test dependencies if missing
    python -m pip install pytest pytest-asyncio httpx fastapi --quiet

    # Run the test suite
    python -m pytest $testFile -v --tb=short --color=yes

    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ All tests passed!" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Some tests failed. See output above." -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
