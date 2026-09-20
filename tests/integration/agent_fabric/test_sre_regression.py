import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
import json
import time

from soc_backend.Interfaces.main import app
from soc_backend.Infrastructure.Http.Deps import get_db

client = TestClient(app)

@pytest.fixture
def mock_db():
    db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.pop(get_db, None)

def test_regression_tenant_onboarding_db_conflict(mock_db):
    """
    SRE Incident Regression: Tenant Onboarding Bug
    Symptom: In the past, rapidly onboarding the same tenant resulted in 500 DB errors.
    Fix Validation: Ensure the onboarding API correctly catches or ignores ON CONFLICT
    conditions in PostgreSQL and returns a 200/201 instead of a 500.
    """
    # Simulate DB NOT throwing an exception for ON CONFLICT DO NOTHING
    mock_db.execute.return_value = "INSERT 0 0" # Indicates conflict handled
    
    resp = client.post(
        "/api/admin/tenants",
        headers={"X-Internal-Service-Key": "dev-internal-key-change-in-prod"},
        json={"tenant_id": "duplicate-tenant"}
    )
    
    # Must not 500
    assert resp.status_code == 200
    assert resp.json()["status"] == "provisioned"

@patch("soc_backend.Infrastructure.Metrics.record_http_latency")
def test_regression_high_latency_502_pattern(mock_metrics, mock_db):
    """
    SRE Incident Regression: 502 Bad Gateway Pattern
    Symptom: Endpoint tasks historically took >2s to write, causing Nginx 502s.
    Fix Validation: Ensure that if a DB query takes long, we correctly log the 
    high-latency metric so it triggers Prometheus paging before Nginx 502s.
    Note: Since we use asyncpg, actual blocking is non-blocking to the loop, 
    but the total request time might still trigger the metric in middleware.
    Since we can't easily mock the middleware time here, we explicitly test 
    that if we artificially delay, the metrics logic would record > 2s.
    """
    
    # This is a unit test of the metric boundary
    from soc_backend.Infrastructure.Metrics import HIGH_LATENCY_REQUESTS_TOTAL
    
    initial_count = HIGH_LATENCY_REQUESTS_TOTAL.labels(method="POST", endpoint="/api/test")._value.get()
    
    # Simulate the latency recorder being called with 2.1 seconds
    from soc_backend.Infrastructure.Metrics import record_http_latency
    record_http_latency("POST", "/api/test", 2.1)
    
    new_count = HIGH_LATENCY_REQUESTS_TOTAL.labels(method="POST", endpoint="/api/test")._value.get()
    
    # The count should increase by exactly 1
    assert new_count - initial_count == 1
    
    # Verify >2.0s triggers it, but 1.9s does not
    record_http_latency("POST", "/api/test", 1.9)
    final_count = HIGH_LATENCY_REQUESTS_TOTAL.labels(method="POST", endpoint="/api/test")._value.get()
    
    # Count should NOT increase for 1.9s
    assert final_count == new_count

def test_regression_agent_enrollment_exhaustion(mock_db):
    """
    SRE Incident Regression: Agent Enrollment Token Exhaustion
    Symptom: Attackers reused leaked enrollment tokens.
    Fix Validation: Ensure that if `uses` >= `max_use`, the API returns a 401
    and increments the AGENT_ENROLLMENT_FAILURES_TOTAL metric.
    """
    mock_db.fetchrow.return_value = {
        "tenant_id": "acme",
        "expires_at": "2030-01-01T00:00:00Z", # Mocked time parsing might fail if not object, 
                                              # but we mock it correctly as a datetime in actual execution.
        "max_use": 1,
        "uses": 1 # Exhausted
    }
    
    # For simplicity of mocking timezone comparison:
    from datetime import datetime, timezone
    mock_db.fetchrow.return_value["expires_at"] = datetime.now(timezone.utc)
    
    resp = client.post(
        "/api/endpoints/enroll",
        json={"enrollment_token": "exhausted-token"}
    )
    
    assert resp.status_code == 401
    assert "usage exceeded" in resp.json()["detail"]
    
    # Verify metric was incremented
    from soc_backend.Infrastructure.Metrics import AGENT_ENROLLMENT_FAILURES_TOTAL
    count = AGENT_ENROLLMENT_FAILURES_TOTAL.labels(reason="max_use_exceeded", tenant_id="acme")._value.get()
    assert count >= 1
