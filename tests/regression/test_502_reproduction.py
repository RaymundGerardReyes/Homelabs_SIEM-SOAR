# tests/regression/test_502_reproduction.py
import requests

def test_cloudflare_tunnel_502_regression():
    """
    Regression Test: Ensures that hitting the health endpoint 
    rapidly does not cause a 502 Bad Gateway or TLS EOF.
    Validates fixes applied to Cloudflare tunnel cpulimits and Nginx retries.
    """
    for _ in range(10):
        response = requests.get("http://localhost/health")
        assert response.status_code != 502, "Regression: 502 Bad Gateway detected!"
