import time
from prometheus_client import Counter, Histogram, Gauge

# Define Prometheus metrics for the SOC Backend
HTTP_REQUESTS_TOTAL = Counter(
    "soc_backend_http_requests_total",
    "Total HTTP requests to the SOC Backend",
    ["method", "endpoint", "status"]
)

HTTP_REQUEST_DURATION = Histogram(
    "soc_backend_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"]
)

# Leading indicator metric: Tracks requests exceeding 2000ms before they trigger 502 gateway timeouts
HIGH_LATENCY_REQUESTS_TOTAL = Counter(
    "soc_backend_high_latency_requests_total",
    "Total HTTP requests taking >2000ms (leading indicator for gateway timeouts)",
    ["method", "endpoint"]
)

AGENT_EXECUTION_DURATION = Histogram(
    "soc_backend_agent_execution_seconds",
    "Duration of LangGraph AI Agent executions",
    ["agent_name", "risk_level"]
)

PLAYBOOK_EXECUTIONS = Counter(
    "soc_backend_playbook_executions_total",
    "Total playbook sandbox executions",
    ["playbook_id", "status"]
)

# ==============================================================================
# PHASE 5: SRE AGENT FABRIC METRICS
# ==============================================================================

AGENT_ENROLLMENT_FAILURES_TOTAL = Counter(
    "soc_backend_agent_enrollment_failures_total",
    "Total agent enrollment failures (invalid tokens, expired, etc.)",
    ["reason", "tenant_id"]
)

AGENT_POLLING_FAILURES_TOTAL = Counter(
    "soc_backend_agent_polling_failures_total",
    "Total errors when agents attempt to poll or submit task results",
    ["endpoint_id", "error_type"]
)

INGEST_ERROR_RATE_TOTAL = Counter(
    "soc_backend_ingest_errors_total",
    "Total telemetry ingest parsing or auth errors",
    ["tenant_id", "status_code"]
)

def record_http_latency(method: str, endpoint: str, duration_seconds: float):
    """Records HTTP request duration and increments high-latency counter if >2.0s."""
    HTTP_REQUEST_DURATION.labels(method=method, endpoint=endpoint).observe(duration_seconds)
    if duration_seconds > 2.0:
        HIGH_LATENCY_REQUESTS_TOTAL.labels(method=method, endpoint=endpoint).inc()
