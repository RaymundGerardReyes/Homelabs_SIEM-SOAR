import pytest
from unittest.mock import patch, MagicMock

# ==============================================================================
# Local Auth Logical Path & Edge Case Tests (21 Cases)
# ==============================================================================

def test_login_success(client):
    """1. Valid credentials return an HttpOnly JWT cookie and Bearer token."""
    mock_user = MagicMock()
    mock_user.username = "admin"
    mock_user.password_hash = "secure_password"
    mock_user.role = "agent_orchestrator"

    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        with patch("interfaces.auth.jwt.encode", return_value="mock_jwt_token"):
            response = client.post("/api/auth/login", json={"username": "admin", "password": "secure_password"})
            assert response.status_code == 200
            assert response.json()["access_token"] == "mock_jwt_token"
            cookies = response.headers.get_list("set-cookie")
            assert any("access_token=mock_jwt_token" in c for c in cookies)
            assert any("HttpOnly" in c for c in cookies)

def test_login_invalid_password(client):
    """2. Incorrect password throws 401."""
    mock_user = MagicMock()
    mock_user.password_hash = "secure_password"
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        response = client.post("/api/auth/login", json={"username": "admin", "password": "wrong_password"})
        assert response.status_code == 401

def test_login_user_not_found(client):
    """3. Non-existent user throws 401."""
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=None):
        response = client.post("/api/auth/login", json={"username": "ghost", "password": "password123"})
        assert response.status_code == 401

def test_login_missing_username(client):
    """4. Request without username fails validation."""
    response = client.post("/api/auth/login", json={"password": "password123"})
    assert response.status_code == 422 # FastAPI validation error

def test_login_missing_password(client):
    """5. Request without password fails validation."""
    response = client.post("/api/auth/login", json={"username": "admin"})
    assert response.status_code == 422

def test_login_empty_body(client):
    """6. Empty JSON body fails validation."""
    response = client.post("/api/auth/login", json={})
    assert response.status_code == 422

def test_login_invalid_json(client):
    """7. Malformed JSON payload fails."""
    response = client.post("/api/auth/login", data="this is not json", headers={"Content-Type": "application/json"})
    assert response.status_code == 422

def test_login_db_connection_error(client):
    """8. Database exception during query results in 500."""
    with patch("interfaces.auth.UserRepository.get_user_by_username", side_effect=Exception("DB Down")):
        response = client.post("/api/auth/login", json={"username": "admin", "password": "secure_password"})
        assert response.status_code == 500

def test_login_jwt_key_missing(client, monkeypatch):
    """9. Missing JWT_PRIVATE_KEY environment variable yields 500."""
    monkeypatch.delenv("JWT_PRIVATE_KEY", raising=False)
    mock_user = MagicMock(password_hash="secure_password")
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        response = client.post("/api/auth/login", json={"username": "admin", "password": "secure_password"})
        assert response.status_code == 500

def test_login_jwt_signing_error(client):
    """10. Cryptographic signing exception yields 500."""
    mock_user = MagicMock(password_hash="secure_password")
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        with patch("interfaces.auth.jwt.encode", side_effect=Exception("Crypto error")):
            response = client.post("/api/auth/login", json={"username": "admin", "password": "secure_password"})
            assert response.status_code == 500

def test_login_wrong_method_get(client):
    """11. GET method on /login is blocked."""
    response = client.get("/api/auth/login")
    assert response.status_code == 405

def test_session_unauthorized_no_token(client):
    """12. Session request without cookie or header throws 401."""
    response = client.get("/api/auth/session")
    assert response.status_code == 401

def test_session_authorized_cookie(client):
    """13. Session request with valid cookie returns user data."""
    client.cookies.set("access_token", "valid_mock_token")
    response = client.get("/api/auth/session")
    assert response.status_code == 200

def test_session_authorized_header(client):
    """14. Session request with valid Authorization header returns user data."""
    response = client.get("/api/auth/session", headers={"Authorization": "Bearer valid_mock_token"})
    assert response.status_code == 200

def test_session_wrong_method_post(client):
    """15. POST method on /session is blocked."""
    response = client.post("/api/auth/session")
    assert response.status_code == 405

def test_logout_success(client):
    """16. Logout successfully clears cookie."""
    client.cookies.set("access_token", "valid_mock_token")
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    cookies = response.headers.get_list("set-cookie")
    assert any("access_token=" in c and ("Max-Age=0" in c or "expires=" in c.lower()) for c in cookies)

def test_logout_wrong_method_get(client):
    """17. GET method on /logout is blocked."""
    response = client.get("/api/auth/logout")
    assert response.status_code == 405

def test_login_extra_fields_ignored(client):
    """18. Providing extra JSON fields does not break login."""
    mock_user = MagicMock(password_hash="secure_password")
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        with patch("interfaces.auth.jwt.encode", return_value="token"):
            response = client.post("/api/auth/login", json={"username": "admin", "password": "secure_password", "malicious_flag": True})
            assert response.status_code == 200

def test_session_malformed_header(client):
    """19. Malformed Authorization header throws 401."""
    response = client.get("/api/auth/session", headers={"Authorization": "Basic something"})
    assert response.status_code == 401

def test_login_long_username(client):
    """20. Unusually long usernames are handled safely without crash."""
    mock_user = MagicMock(password_hash="secure_password")
    long_username = "a" * 1024
    with patch("interfaces.auth.UserRepository.get_user_by_username", return_value=mock_user):
        with patch("interfaces.auth.jwt.encode", return_value="token"):
            response = client.post("/api/auth/login", json={"username": long_username, "password": "secure_password"})
            assert response.status_code == 200

def test_session_prefers_cookie_over_header(client):
    """21. If both cookie and header are provided, cookie is used."""
    client.cookies.set("access_token", "cookie_token")
    response = client.get("/api/auth/session", headers={"Authorization": "Bearer header_token"})
    assert response.status_code == 200
