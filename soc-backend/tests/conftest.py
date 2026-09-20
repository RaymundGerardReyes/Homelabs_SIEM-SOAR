import pytest
import sys
import os
from datetime import datetime

# Dynamically inject the parent directory into the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Suppress Protobuf Gencode/Runtime version check errors in test environment
try:
    import google.protobuf.runtime_version
    google.protobuf.runtime_version.ValidateProtobufRuntimeVersion = lambda *args, **kwargs: None
except Exception:
    pass

from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

from Interfaces.main import app
from Infrastructure.Http.Deps import get_db


@pytest.fixture
def mock_db():
    """Provide a mock async connection to avoid real DB hits"""
    mock_conn = AsyncMock()
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = {
        "total_endpoints": 5,
        "active_count": 3,
        "pending_count": 2,
        "last_seen": datetime(2026, 7, 25, 14, 0, 0)
    }
    return mock_conn

@pytest.fixture
def client(mock_db):
    """TestClient fixture with get_db dependency override for Interfaces.main.app"""
    async def override_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("JWT_PRIVATE_KEY", '"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----"')
    monkeypatch.setenv("AUTHORIZED_DOMAINS", "example.com")
    monkeypatch.setenv("AUTHORIZED_EMAILS", "admin@example.com")
