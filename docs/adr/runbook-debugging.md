# Incident Debugging Runbook

## Overview
This platform employs a unified `X-Correlation-ID` strategy. This UUID bounds a single user action (like clicking "Isolate Host" or a telemetry webhook ingress) across the React frontend, Nginx reverse proxy, Python Backend, Go Core Ingest, and PostgreSQL.

## How to Trace an Issue

### 1. Identify the Correlation ID
If a UI action fails (e.g. 500 error), open the browser Developer Tools -> Network Tab. Look at the outgoing API request headers and copy the `X-Correlation-ID`.

### 2. Search Nginx Logs
Ensure the traffic reached the system:
```bash
docker logs soc-nginx-proxy | grep <correlation-id>
```
Look for HTTP 502 (Backend down) or 429 (Rate limited).

### 3. Search Python Backend Logs
If Nginx returned a 500, check the AI backend:
```bash
docker logs soc-python-ai-backend | grep <correlation-id>
```
You will see explicit Pydantic validation errors or Postgres connection timeouts associated with the Trace ID.

### 4. Search Go Core Ingestion Logs
For telemetry issues or gRPC failures:
```bash
docker logs soc-go-ingest-core | grep <correlation-id>
```
Look for `✅ [HTTP] Accepted PaaS Event Log` to confirm parsing succeeded.

### 5. Review the Audit Ledger (Database)
If the action involved an Agent Tool (like blocking an IP), verify the audit logs:
```sql
SELECT timestamp, agent, action, risk_level, policy_decision 
FROM audit_logs 
WHERE correlation_id = '<correlation-id>';
```
