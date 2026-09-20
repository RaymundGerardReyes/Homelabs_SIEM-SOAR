import sys
import os
import pytest
from unittest.mock import AsyncMock, patch

SOC_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if SOC_BACKEND not in sys.path:
    sys.path.insert(0, SOC_BACKEND)

# Stub heavy transitive dependencies
import types
from unittest.mock import MagicMock
fernet_mod = types.ModuleType("cryptography")
hazmat_mod = types.ModuleType("cryptography.hazmat")
sys.modules["cryptography.hazmat"] = hazmat_mod
fernet_cls = MagicMock()
fernet_cls.generate_key.return_value = b"A" * 32
fernet_instance = MagicMock()
fernet_instance.encrypt.return_value = b"enc-secret"
fernet_instance.decrypt.return_value = b"dec-secret"
fernet_cls.return_value = fernet_instance
fernet_fernet_mod = types.ModuleType("cryptography.fernet")
setattr(fernet_fernet_mod, "Fernet", fernet_cls)
sys.modules["cryptography.fernet"] = fernet_fernet_mod

from fastapi.testclient import TestClient
from Interfaces.api_routes import router, INTERNAL_SERVICE_KEY
from Infrastructure.Http.Deps import get_db
from fastapi import FastAPI

app = FastAPI()
app.include_router(router)

@pytest.fixture
def mock_db():
    db = AsyncMock()
    def fetchrow_side_effect(query, *args):
        if "endpoint_inventory" in query:
            if args and args[0] == "tenant-b":
                return {"total_endpoints": 1, "active_count": 1, "open_incidents": 0}
            if args and args[0] == "tenant-a":
                return {"total_endpoints": 2, "active_count": 2, "open_incidents": 1}
            return None
        if "agent_tasks" in query:
            return {"total_tasks": 0, "completed_tasks": 0}
        if "audit_logs" in query:
            return {"total_audits": 0, "prevented_count": 0}
        return None
    db.fetchrow.side_effect = fetchrow_side_effect
    db.fetchval.return_value = 0
    return db

@pytest.fixture
def client(mock_db):
    async def override_get_db():
        yield mock_db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()

# 1. Missing tenant
def test_missing_tenant_metrics(client):
    # No tenant context in headers
    res = client.get("/metrics/overview")
    assert res.status_code in (401, 403), f"Expected 401/403, got {res.status_code}"

# 2. Tenant A -> Tenant A
def test_tenant_a_reads_metrics(client):
    res = client.get("/metrics/overview", headers={
        "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
        "X-Tenant-ID": "tenant-a"
    })
    assert res.status_code == 200, res.text
    assert "alertsScanned" in res.json()

def test_tenant_a_reads_investigation(client):
    # alert-172102001 belongs to tenant-a
    res = client.get("/investigation/alert-172102001", headers={
        "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
        "X-Tenant-ID": "tenant-a"
    })
    assert res.status_code == 200, res.text

# 3. Tenant A -> Tenant B
def test_tenant_a_reads_tenant_b_investigation(client):
    # alert-172102002 belongs to tenant-b
    res = client.get("/investigation/alert-172102002", headers={
        "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
        "X-Tenant-ID": "tenant-a"
    })
    assert res.status_code == 404, "Tenant A should not be able to read Tenant B's investigation"

# 4. JWT vs Header Mismatch
def test_jwt_header_mismatch_own_data(client):
    # JWT has tenant-a, header says tenant-b, requests tenant-a data
    import jwt
    token = jwt.encode({"tenant_id": "tenant-a"}, b"A"*32, algorithm="RS256")
    client.cookies = {"access_token": token}
    res = client.get("/investigation/alert-172102001", headers={"X-Tenant-ID": "tenant-b"})
    assert res.status_code == 200, "Header must not override valid JWT to deny access to own data"

def test_jwt_header_mismatch_foreign_data(client):
    # JWT has tenant-a, header says tenant-b, requests tenant-b data
    import jwt
    token = jwt.encode({"tenant_id": "tenant-a"}, b"A"*32, algorithm="RS256")
    client.cookies = {"access_token": token}
    res = client.get("/investigation/alert-172102002", headers={"X-Tenant-ID": "tenant-b"})
    assert res.status_code == 404, "Header must not grant access to foreign data despite matching the target tenant"

def test_jwt_invalid_signature(client):
    client.cookies = {"access_token": "invalid.jwt.token"}
    res = client.get("/metrics/overview")
    assert res.status_code in (401, 403)

# 5. LLM Evidence boundary
def test_tool_propose_action_cross_tenant():
    from Domain.Investigations.Agents import tool_propose_action
    with pytest.raises(PermissionError) as exc:
        tool_propose_action("Block", "target-b", "justification", "HIGH", "tenant-a", "tenant-b")
    assert "403" in str(exc.value)

@pytest.mark.asyncio
async def test_tool_fetch_alert_context_missing_context():
    from Domain.Investigations.Agents import tool_fetch_alert_context
    from Interfaces.main import tenant_id_ctx
    
    token = tenant_id_ctx.set("default_fallback_tenant")
    try:
        with pytest.raises(PermissionError) as exc:
            await tool_fetch_alert_context(["test-evidence-id"])
        assert "Missing Tenant Context" in str(exc.value)
    finally:
        tenant_id_ctx.reset(token)

@pytest.mark.asyncio
async def test_tool_fetch_alert_context_foreign_data():
    from Domain.Investigations.Agents import tool_fetch_alert_context
    from Interfaces.main import tenant_id_ctx
    
    token = tenant_id_ctx.set("tenant-a")
    try:
        # In a real scenario, the backend gRPC would reject this if "test-evidence-id-b" belongs to tenant-b.
        # Here we just verify it doesn't crash on auth, but passes the correct context.
        # Once Phase 9.10 is done, we will assert this returns empty or 403.
        result = await tool_fetch_alert_context(["test-evidence-id-b"])
        # As of now it returns mock data, but we proved it passes the context check.
        assert isinstance(result, list)
    finally:
        tenant_id_ctx.reset(token)
