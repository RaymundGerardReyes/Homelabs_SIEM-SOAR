#!/bin/bash
# monitor_resources.sh
# Logs docker stats and events to correlate with any future 502 occurrences.

LOG_FILE="resource_monitor.log"
echo "Starting resource monitor... Logging to $LOG_FILE"
echo "Timestamp,Container,CPU%,MemUsage,MemLimit,Mem%" > $LOG_FILE

while true; do
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  # Log docker stats
  docker stats --no-stream --format "$TIMESTAMP,{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}" soc-nginx-proxy soc-python-ai-backend soc-cloudflared-edge core-ingest >> $LOG_FILE
  
  sleep 10
done
