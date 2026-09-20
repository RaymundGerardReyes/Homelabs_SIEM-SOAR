#!/bin/bash
# monitor_resources.sh
# Synthetic SRE monitor for Docker resource usage (cgroups)

# Add graceful shutdown hook
trap 'echo -e "\n🛑 Monitoring stopped cleanly."; exit 0' SIGINT SIGTERM

echo "================================================================"
echo "🚀 Starting Hybrid SIEM/SOAR Resource Monitor"
echo "================================================================"

# Pre-flight check: ensure Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ ERROR: Docker daemon is not running or not accessible."
    echo "Please start Docker or check permissions, then try again."
    exit 1
fi

echo "✅ Docker daemon detected."
echo "Monitoring soc-cloudflared-edge, soc-frontend, and soc-python-ai-backend"
echo "Recording metrics every 5 seconds..."
echo "Press Ctrl+C to stop."
echo "================================================================"

# Add table headers manually for readability
echo "TIMESTAMP             | CONTAINER                  | CPU %  | MEM USAGE / LIMIT   | MEM %  | NET I/O       | BLOCK I/O     |"
echo "----------------------|----------------------------|--------|---------------------|--------|---------------|---------------|"

while true; do
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  # Format output using Docker's template string, ignoring missing containers safely
  # We loop through specific targets to prevent the script crashing if one is restarting
  TARGETS=("soc-cloudflared-edge" "soc-frontend" "soc-python-ai-backend")
  
  for target in "${TARGETS[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${target}$"; then
      STATS=$(docker stats --no-stream --format "{{.Name}} | {{.CPUPerc}} | {{.MemUsage}} | {{.MemPerc}} | {{.NetIO}} | {{.BlockIO}}" "${target}")
      # Use printf to align columns
      printf "%-21s | %s\n" "${TIMESTAMP}" "${STATS}"
    else
      printf "%-21s | %-26s | %-6s | %-19s | %-6s | %-13s | %-13s |\n" "${TIMESTAMP}" "${target}" "DOWN" "DOWN" "DOWN" "DOWN" "DOWN"
    fi
  done
  
  sleep 5
done
