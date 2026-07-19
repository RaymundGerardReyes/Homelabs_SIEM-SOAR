import pytest
from unittest.mock import patch, MagicMock

# ==============================================================================
# Google Auth Logical Path & Edge Case Tests (20 Cases)
# ==============================================================================

def test_login_redirects(client):
    """1. /login creates state token and redirects to Google."""
    with patch("interfaces.auth_google.UserRepository.create_oauth_state") as mock_create_state:
        response = client.get("/api/auth/google/login", follow_redirects=False)
        assert response.status_code == 307
        assert "state=" in response.headers["location"]
        mock_create_state.assert_called_once()

def test_login_embeds_redirect(client):
    """2. /login embeds query redirect parameter into the state."""
    with patch("interfaces.auth_google.UserRepository.create_oauth_state"):
        response = client.get("/api/auth/google/login?redirect=/dashboard", follow_redirects=False)
        assert "%3A%3A%2Fdashboard" in response.headers["location"] or "::/dashboard" in response.headers["location"]

def test_login_db_error_on_create_state(client):
    """3. Database failure during state creation yields 500."""
    with patch("interfaces.auth_google.UserRepository.create_oauth_state", side_effect=Exception("DB Down")):
        response = client.get("/api/auth/google/login", follow_redirects=False)
        assert response.status_code == 500

def test_login_wrong_method_post(client):
    """4. POST method on /login is blocked."""
    response = client.post("/api/auth/google/login")
    assert response.status_code == 405

@patch("interfaces.auth_google.jwt.encode")
def test_callback_success_admin(mock_jwt_encode, client):
    """5. Callback success assigns agent_orchestrator to allowed emails."""
    mock_jwt_encode.return_value = "admin_jwt"
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "admin@example.com", "name": "Admin"})
            
            response = client.get("/api/auth/google/callback?code=abc&state=xyz::/home", follow_redirects=False)
            assert response.status_code == 307
            assert response.headers["location"] == "/home"
            # Since admin@example.com is in AUTHORIZED_EMAILS, role should be agent_orchestrator
            args, _ = mock_jwt_encode.call_args
            assert args[0]["role"] == "agent_orchestrator"

@patch("interfaces.auth_google.jwt.encode")
def test_callback_success_analyst(mock_jwt_encode, client):
    """6. Callback success assigns tier_1_analyst to general domain emails."""
    mock_jwt_encode.return_value = "analyst_jwt"
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "user@example.com", "name": "User"})
            
            response = client.get("/api/auth/google/callback?code=abc&state=xyz", follow_redirects=False)
            assert response.status_code == 307
            args, _ = mock_jwt_encode.call_args
            assert args[0]["role"] == "tier_1_analyst"

def test_callback_missing_state(client):
    """7. Missing state parameter fails validation."""
    response = client.get("/api/auth/google/callback?code=abc")
    assert response.status_code == 422

def test_callback_missing_code(client):
    """8. Missing code parameter fails validation."""
    response = client.get("/api/auth/google/callback?state=xyz")
    assert response.status_code == 422

def test_callback_invalid_state(client):
    """9. Invalid state token throws 400 Bad Request."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=False):
        response = client.get("/api/auth/google/callback?code=abc&state=bad")
        assert response.status_code == 400

def test_callback_google_token_api_fails(client):
    """10. Google Token API returning 400 throws HTTPException."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post:
            mock_post.return_value = MagicMock(status_code=400)
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 400
            assert "Failed to retrieve token" in response.json()["detail"]

def test_callback_google_token_api_timeout(client):
    """11. Google Token API network timeout yields 500."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post", side_effect=Exception("Timeout")):
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 500

def test_callback_google_userinfo_api_fails(client):
    """12. Google UserInfo API returning 400 throws HTTPException."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=400)
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 400
            assert "Failed to fetch user data" in response.json()["detail"]

def test_callback_google_userinfo_api_timeout(client):
    """13. Google UserInfo API network timeout yields 500."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get", side_effect=Exception("Timeout")):
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 500

def test_callback_google_userinfo_missing_email(client):
    """14. UserInfo returning empty email defaults securely and fails allowlist."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {})
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 403
            assert "Unauthorized" in response.json()["detail"]

def test_callback_unauthorized_domain(client):
    """15. Unauthorized email domain throws 403 Forbidden."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "hacker@evil.com"})
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 403

def test_callback_authorized_domain_case_insensitive(client):
    """16. Domain allowlist check is case-insensitive."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            with patch("interfaces.auth_google.jwt.encode", return_value="jwt"):
                mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
                mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "USER@EXAMPLE.COM"})
                response = client.get("/api/auth/google/callback?code=abc&state=xyz", follow_redirects=False)
                assert response.status_code == 307

def test_callback_jwt_signing_fails(client):
    """17. JWT cryptographic failure during issuance yields 500."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            with patch("interfaces.auth_google.jwt.encode", side_effect=Exception("Crypto")):
                mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
                mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "admin@example.com"})
                response = client.get("/api/auth/google/callback?code=abc&state=xyz")
                assert response.status_code == 500

def test_callback_jwt_private_key_missing(client, monkeypatch):
    """18. Missing JWT_PRIVATE_KEY throws 500."""
    monkeypatch.delenv("JWT_PRIVATE_KEY", raising=False)
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "admin@example.com"})
            response = client.get("/api/auth/google/callback?code=abc&state=xyz")
            assert response.status_code == 500

def test_callback_redirects_to_root_if_no_embedded_path(client):
    """19. State token without '::' embedded path defaults to '/'."""
    with patch("interfaces.auth_google.UserRepository.verify_oauth_state", return_value=True):
        with patch("requests.post") as mock_post, patch("requests.get") as mock_get:
            with patch("interfaces.auth_google.jwt.encode", return_value="jwt"):
                mock_post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "token"})
                mock_get.return_value = MagicMock(status_code=200, json=lambda: {"email": "admin@example.com"})
                response = client.get("/api/auth/google/callback?code=abc&state=pure_state", follow_redirects=False)
                assert response.status_code == 307
                assert response.headers["location"] == "/"

def test_callback_wrong_method_post(client):
    """20. POST method on /callback is blocked."""
    response = client.post("/api/auth/google/callback?code=abc&state=xyz")
    assert response.status_code == 405
