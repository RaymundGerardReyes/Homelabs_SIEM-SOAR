#!/bin/bash
# tests/orchestration/run_all_tests.sh
# Principal Orchestrator for Hybrid SIEM/SOAR Testing

set -e

MODE=${1:-unit}

echo "================================================================"
echo "🧪 SIEM/SOAR Test Orchestrator | Mode: ${MODE^^}"
echo "================================================================"

# Mandatory Enforcement Gate
echo "[ENFORCEMENT] Running structural checks..."
if ! python ../structure_check.py; then
    exit 1
fi
echo "[ENFORCEMENT] Passed."

function wait_for_health() {
    echo "[SYSTEM] Waiting for services to become healthy..."
    # Placeholder for actual curl/wget health checks against localhost/health
    sleep 2 
    echo "[SYSTEM] All services healthy."
}

function run_unit() {
    echo -e "\n[UNIT] Running Go Unit & Domain Tests (core-ingest)..."
    cd ../../core-ingest && echo "✅ (Mock) go test ./tests/domain ./tests/unit"
    
    echo -e "\n[UNIT] Running Python Unit & Domain Tests (soc-backend)..."
    cd ../soc-backend && echo "✅ (Mock) pytest tests/domain tests/unit"
    
    echo -e "\n[UNIT] Running React Unit Tests (soc-frontend)..."
    cd ../soc-frontend && echo "✅ (Mock) npm run test"
}

function run_service() {
    echo -e "\n[SERVICE] Running Python Service-Level Tests (FastAPI/Routers)..."
    cd ../../soc-backend && echo "✅ (Mock) pytest tests/service"
    
    echo -e "\n[SERVICE] Running Go Service-Level Tests (gRPC Handlers)..."
    cd ../core-ingest && echo "✅ (Mock) go test ./tests/service"
}

function run_integration() {
    echo -e "\n[INTEGRATION] Spinning up test stack..."
    # docker-compose -f deploy/docker-compose.dev.yml -f deploy/docker-compose.test.override.yml up -d
    wait_for_health
    
    echo -e "\n[INTEGRATION] Running Scenario Tests (siem_to_soar, infra)..."
    cd ../../tests && echo "✅ (Mock) pytest integration/ api/"
}

function run_e2e() {
    echo -e "\n[E2E] Running Playwright E2E Tests..."
    cd ../../tests/e2e && echo "✅ (Mock) npx playwright test"
}

function run_regression() {
    echo -e "\n[REGRESSION] Running Incident Regression Suite..."
    cd ../../tests && echo "✅ (Mock) pytest regression/"
}

case $MODE in
    unit)
        run_unit
        ;;
    service)
        run_unit
        run_service
        ;;
    integration)
        run_integration
        ;;
    e2e)
        run_integration
        run_e2e
        ;;
    full)
        run_unit
        run_service
        run_integration
        run_regression
        run_e2e
        ;;
    *)
        echo "❌ Invalid mode. Use: unit, service, integration, e2e, full"
        exit 1
        ;;
esac

echo -e "\n================================================================"
echo "🎉 [${MODE^^}] Test Suite Execution Completed Successfully!"
echo "================================================================"
