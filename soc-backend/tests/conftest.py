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

# Provide backwards-compatible module aliases for case-insensitive imports in tests
import Interfaces
sys.modules['interfaces'] = Interfaces
import Interfaces.auth_google
sys.modules['interfaces.auth_google'] = Interfaces.auth_google



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

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

_test_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_test_private_pem = _test_private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption()
).decode()
_test_public_pem = _test_private_key.public_key().public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
).decode()

@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("JWT_PRIVATE_KEY", _test_private_pem)
    monkeypatch.setenv("JWT_PUBLIC_KEY", _test_public_pem)
    monkeypatch.setenv("AUTHORIZED_DOMAINS", "example.com")
    monkeypatch.setenv("AUTHORIZED_EMAILS", "admin@example.com")
    monkeypatch.setenv("INTERNAL_SERVICE_KEY", "test-internal-service-key")
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "test-cf-client-id")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "test-cf-client-secret")
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", "test-ch-pass")
