# tests/api/test_health.py
import requests

def test_backend_health():
    """Contract test: verifies the Python backend /api/health endpoint via Nginx."""
    response = requests.get("http://localhost/api/health")
    assert response.status_code == 200
    assert "status" in response.json()
