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
