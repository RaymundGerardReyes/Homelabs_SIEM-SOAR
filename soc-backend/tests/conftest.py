import pytest
import sys
import os

# Dynamically inject the parent directory into the Python path
# This completely bypasses all Docker/Pytest sys.path resolution quirks
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from interfaces.main import app
from infra.http.deps import get_db


@pytest.fixture
def mock_db():
    # Provide a mock async connection to avoid real DB hits
    mock_conn = AsyncMock()
    return mock_conn

@pytest.fixture
def client(mock_db):
    def override_get_db():
        yield mock_db
        
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("JWT_PRIVATE_KEY", '"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----"')
    monkeypatch.setenv("AUTHORIZED_DOMAINS", "example.com")
    monkeypatch.setenv("AUTHORIZED_EMAILS", "admin@example.com")
