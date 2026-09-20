import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
import json
import httpx

from soc_backend.Interfaces.main import app
from soc_backend.Infrastructure.Http.Deps import get_db

client = TestClient(app)

@pytest.fixture
def mock_db():
    db = AsyncMock()
    app.dependency_overrides[get_db] = lambda: db
    yield db
    app.dependency_overrides.pop(get_db, None)

@patch("httpx.AsyncClient.post")
def test_admin_assign_task_webhook_success(mock_post, mock_db):
    """
    Test Phase 4: Optional Webhook Mode (Success)
    If the endpoint has a cf_tunnel_url, the backend should attempt
    to push the task synchronously.
    """
    # 1. Setup mock endpoint with a cf_tunnel_url
    mock_db.fetchrow.return_value = {
        "tenant_id": "acme-corp",
        "cf_tunnel_url": "https://endpoint-123.acme.com"
    }
    
    # 2. Setup mock task ID insertion
    mock_db.fetchval.return_value = "task-webhook-1"
    
    # 3. Setup mock httpx response representing the agent executing successfully
    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json.return_value = {
        "status": "success",
        "details": {"msg": "Executed via webhook synchronously!"}
    }
    mock_post.return_value = mock_response
    
    # 4. Trigger the assignment from the admin side
    assign_resp = client.post(
        "/api/admin/endpoints/endpoint-123/tasks",
        headers={"X-Internal-Service-Key": "dev-internal-key-change-in-prod"},
        json={"action": "isolate_host", "params": {}}
    )
    
    # Assert HTTP call was made
    mock_post.assert_called_once()
    args, kwargs = mock_post.call_args
    assert args[0] == "https://endpoint-123.acme.com/agent/execute"
    assert kwargs["json"]["action"] == "isolate_host"
    assert kwargs["json"]["task_id"] == "task-webhook-1"
    
    # Assert response shows synchronous completion
    assert assign_resp.status_code == 200
    assert assign_resp.json()["task_id"] == "task-webhook-1"
    assert assign_resp.json()["status"] == "success"
    
    # Assert task update was committed to DB
    assert mock_db.execute.call_count == 1
    execute_args = mock_db.execute.call_args[0]
    assert "UPDATE agent_tasks" in execute_args[0]
    assert execute_args[1] == "success"

@patch("httpx.AsyncClient.post")
def test_admin_assign_task_webhook_fallback_to_polling(mock_post, mock_db):
    """
    Test Phase 4: Webhook Fallback
    If the webhook push fails (e.g., tunnel down), the task should remain
    in 'pending' state and fallback to the polling loop.
    """
    mock_db.fetchrow.return_value = {
        "tenant_id": "acme-corp",
        "cf_tunnel_url": "https://endpoint-123.acme.com"
    }
    mock_db.fetchval.return_value = "task-webhook-failed"
    
    # Simulate a connection timeout/error
    mock_post.side_effect = httpx.RequestError("Failed to connect to tunnel")
    
    assign_resp = client.post(
        "/api/admin/endpoints/endpoint-123/tasks",
        headers={"X-Internal-Service-Key": "dev-internal-key-change-in-prod"},
        json={"action": "isolate_host", "params": {}}
    )
    
    # Assert response shows it fell back to pending
    assert assign_resp.status_code == 200
    assert assign_resp.json()["task_id"] == "task-webhook-failed"
    assert assign_resp.json()["status"] == "pending"
    
    # DB update for completion should NOT have been called
    mock_db.execute.assert_not_called()
