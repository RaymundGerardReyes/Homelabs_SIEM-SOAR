import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
import json

from soc_backend.Interfaces.main import app
from soc_backend.Infrastructure.Http.Deps import get_db

client = TestClient(app)

@pytest.fixture
def mock_db():
    db = AsyncMock()
    # Override the FastAPI dependency
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.pop(get_db, None)

def test_admin_assign_task_and_agent_poll(mock_db):
    """
    Test Phase 3: Control Plane Polling
    1. Admin assigns a task to an endpoint
    2. Agent polls for tasks
    3. Agent submits task result
    """
    # 1. Admin assigns a task
    # Mock finding the endpoint
    mock_db.fetchrow.return_value = {"tenant_id": "acme-corp"}
    # Mock inserting the task and returning task_id
    mock_db.fetchval.return_value = "task-1234"
    
    assign_resp = client.post(
        "/api/admin/endpoints/endpoint-777/tasks",
        headers={"X-Internal-Service-Key": "dev-internal-key-change-in-prod"},
        json={"action": "isolate_host", "params": {"reason": "malware detected"}}
    )
    
    assert assign_resp.status_code == 200
    assert assign_resp.json()["task_id"] == "task-1234"
    assert assign_resp.json()["status"] == "pending"
    
    # 2. Agent polls for tasks
    # Mock verifying the endpoint secret
    mock_endpoint_record = {"endpoint_id": "endpoint-777", "tenant_id": "acme-corp", "status": "active"}
    mock_db.fetchrow.side_effect = [
        mock_endpoint_record,  # 1st call for verify_endpoint_secret
    ]
    
    # Mock the pending tasks query
    mock_task_record = {
        "task_id": "task-1234",
        "action": "isolate_host",
        "params": json.dumps({"reason": "malware detected"}),
        "requested_at": "2026-07-25T10:00:00Z"
    }
    mock_db.fetch.return_value = [mock_task_record]
    
    poll_resp = client.get(
        "/api/agents/tasks",
        headers={"Authorization": "Bearer fake_endpoint_secret"}
    )
    
    assert poll_resp.status_code == 200
    tasks = poll_resp.json()
    assert len(tasks) == 1
    assert tasks[0]["task_id"] == "task-1234"
    
    # 3. Agent submits result
    mock_db.fetchrow.side_effect = [
        mock_endpoint_record,  # 1st call for verify_endpoint_secret
    ]
    mock_db.fetchval.return_value = "task-1234" # Return the task_id to indicate successful update
    
    result_resp = client.post(
        "/api/agents/tasks/task-1234/result",
        headers={"Authorization": "Bearer fake_endpoint_secret"},
        json={"status": "success", "details": {"action_taken": "iptables drop"}}
    )
    
    assert result_resp.status_code == 200
    assert result_resp.json()["status"] == "success"
