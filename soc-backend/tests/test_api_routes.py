import pytest

# ==============================================================================
# API Routes Logical Path Tests
# ==============================================================================

def test_path_1_execute_action_destructive_missing_token(client):
    """Path 1: High-risk action WITHOUT a Two-Key token is rejected with 403."""
    response = client.post(
        "/api/actions/execute",
        json={
            "action": "Isolate Host",
            "target": "WIN-DC-01",
            "justification": "Ransomware spread",
            "risk": "DESTRUCTIVE"
            # Missing twoKeyToken
        }
    )
    
    assert response.status_code == 403
    assert "Two-Key authorization required" in response.json()["detail"]

def test_path_2_execute_action_destructive_with_token(client):
    """Path 2: High-risk action WITH a Two-Key token is accepted."""
    response = client.post(
        "/api/actions/execute",
        json={
            "action": "Isolate Host",
            "target": "WIN-DC-01",
            "justification": "Ransomware spread",
            "risk": "DESTRUCTIVE",
            "twoKeyToken": "123456" # Valid token provided
        }
    )
    
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"

def test_path_3_execute_action_low_risk(client):
    """Path 3: Low-risk action does NOT require a Two-Key token."""
    response = client.post(
        "/api/actions/execute",
        json={
            "action": "Gather Logs",
            "target": "WIN-DC-01",
            "justification": "Routine check",
            "risk": "LOW"
            # Missing twoKeyToken is fine
        }
    )
    
    assert response.status_code == 200
    assert response.json()["status"] == "accepted"

def test_path_4_isolate_endpoint_missing_token(client):
    """Path 4: Dedicated isolation endpoint requires Two-Key token."""
    response = client.post(
        "/api/endpoints/h1/isolate",
        json={} # Missing twoKeyToken
    )
    
    assert response.status_code == 403
    assert "Two-Key token required" in response.json()["detail"]

def test_path_5_isolate_endpoint_with_token(client):
    """Path 5: Dedicated isolation endpoint succeeds with Two-Key token."""
    response = client.post(
        "/api/endpoints/h1/isolate",
        json={"twoKeyToken": "987654"}
    )
    
    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert "Host h1 isolated" in response.json()["message"]
