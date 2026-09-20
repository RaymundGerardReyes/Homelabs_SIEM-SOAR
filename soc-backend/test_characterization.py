import pytest
import asyncio
from fastapi import HTTPException
from fastapi.testclient import TestClient

from Interfaces.api_routes import router, get_investigation
from Domain.Investigations.Agents import tool_fetch_alert_context
from pydantic import BaseModel

# ==============================================================================
# TEST AREA 6 — PYTHON INVESTIGATION (get_investigation endpoint)
# ==============================================================================
@pytest.mark.asyncio
async def test_characterize_investigation_endpoint():
    """
    TEST PURPOSE: Characterize GET /investigation/{alert_id}
    CURRENT BEHAVIOR: Returns a NameError because MOCK_ALERTS does not exist.
    EXPECTED CURRENT DEFECT: The endpoint is fatally broken.
    """
    try:
        # Mocking the asyncpg connection is difficult here, so we will pass None
        # But this will result in AttributeError (NoneType object has no attribute fetchrow)
        # However, to properly test this we should mock the db or expect the dependency injection.
        # For this characterization, if it attempts to use db.fetchrow, we know it's not returning MOCK_ALERTS.
        await get_investigation("mock-alert-id", db=None)
        pytest.fail("Endpoint succeeded unexpectedly.")
    except AttributeError as e:
        assert "fetchrow" in str(e) or "NoneType" in str(e)

# ==============================================================================
# TEST AREA 7 — LLM CONTEXT (tool_fetch_alert_context)
# ==============================================================================
@pytest.mark.asyncio
async def test_characterize_tool_fetch_alert_context():
    """
    TEST PURPOSE: Characterize tool_fetch_alert_context data retrieval
    CURRENT BEHAVIOR: Ignores the gRPC stub and returns a hardcoded mock.
    EXPECTED CURRENT DEFECT: The LLM context is fully mocked and cannot retrieve real data.
    """
    try:
        # Note: the actual code calls get_grpc_stub() which may raise RuntimeError if not in context
        # We simulate the exact behavior
        result = await tool_fetch_alert_context(["test-evidence-id"])
        pytest.fail("Expected RuntimeError for missing gRPC stub context")
    except RuntimeError as e:
        # Expected contextvars failure in test environment without FastAPI lifespan
        assert "gRPC stub not initialized" in str(e)
    except PermissionError as e:
        # If tenant context is missing
        assert "Missing Tenant Context" in str(e)

# ==============================================================================
# TEST AREA 8 — SOAR AUTHORIZATION (Execute Action)
# ==============================================================================
from Interfaces.api_routes import execute_action, ActionExecuteRequest

@pytest.mark.asyncio
async def test_characterize_soar_authorization_destructive():
    """
    TEST PURPOSE: Characterize SOAR authorization for DESTRUCTIVE actions.
    CURRENT BEHAVIOR: Requires a TwoKeyToken, otherwise raises 403 Forbidden.
    """
    req = ActionExecuteRequest(
        action="Isolate Host",
        target="ep-1",
        justification="Test",
        risk="DESTRUCTIVE",
        twoKeyToken=None
    )
    
    try:
        await execute_action(req)
        pytest.fail("Action should have been blocked without TwoKeyToken")
    except HTTPException as e:
        assert e.status_code == 403
        assert "Two-Key authorization required" in e.detail

@pytest.mark.asyncio
async def test_characterize_soar_authorization_permitted():
    """
    TEST PURPOSE: Characterize SOAR authorization for low impact actions.
    CURRENT BEHAVIOR: Succeeds without a TwoKeyToken.
    """
    req = ActionExecuteRequest(
        action="Tag Alert",
        target="alert-1",
        justification="Test",
        risk="LOW_IMPACT_WRITE",
        twoKeyToken=None
    )
    
    resp = await execute_action(req)
    assert resp["status"] == "accepted"
    assert resp["action"] == "Tag Alert"

# ==============================================================================
# PHASE 9.26+ NEW CONTRACT TESTS (SECURITY ARCHITECTURE GUARANTEES)
# ==============================================================================
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_contract_retrieval_empty_evidence():
    """
    I4: Empty evidence produces an explicit empty result.
    """
    with patch('Domain.Investigations.Agents.tenant_id_ctx') as mock_ctx, \
         patch('Domain.Investigations.Agents.get_grpc_stub') as mock_stub:
        
        mock_ctx.get.return_value = "tenant-a"
        mock_stub_instance = AsyncMock()
        mock_stub.return_value = mock_stub_instance
        
        # Simulate empty response from gRPC
        async def mock_fetch(*args, **kwargs):
            return
            yield
        
        mock_stub_instance.FetchAlertContext = mock_fetch
        
        result = await tool_fetch_alert_context(["non-existent-id"])
        assert result == [], "Unknown evidence must return empty array, not None or hallucination"

@pytest.mark.asyncio
async def test_contract_tenant_isolation_firewall():
    """
    I1 & I3: Returned evidence belongs to requested tenant, unknown IDs never produce synthetic evidence.
    Evidence Firewall validation.
    """
    from pb.soc_service_pb2 import LogContextResponse, SecurityEventDetail
    with patch('Domain.Investigations.Agents.tenant_id_ctx') as mock_ctx, \
         patch('Domain.Investigations.Agents.get_grpc_stub') as mock_stub:
        
        mock_ctx.get.return_value = "tenant-a"
        mock_stub_instance = AsyncMock()
        mock_stub.return_value = mock_stub_instance
        
        # Simulate gRPC returning E-B1 despite requesting E-A1 (Testing the firewall)
        async def mock_fetch(*args, **kwargs):
            yield LogContextResponse(
                events=[SecurityEventDetail(event_id="E-B1", action_executed="Read")]
            )
        
        mock_stub_instance.FetchAlertContext = mock_fetch
        
        # We request E-A1, but backend returns E-B1 (simulating cross-tenant contamination)
        result = await tool_fetch_alert_context(["E-A1"])
        
        # Evidence firewall should reject E-B1 since it wasn't requested
        assert len(result) == 0, "Evidence firewall failed to drop unrequested cross-tenant evidence"

@pytest.mark.asyncio
async def test_contract_retrieval_failure_propagation():
    """
    I6: Database failure does not become an empty successful response.
    """
    with patch('Domain.Investigations.Agents.tenant_id_ctx') as mock_ctx, \
         patch('Domain.Investigations.Agents.get_grpc_stub') as mock_stub:
        
        mock_ctx.get.return_value = "tenant-a"
        mock_stub_instance = AsyncMock()
        mock_stub.return_value = mock_stub_instance
        
        # Simulate gRPC/DB failure
        async def mock_fetch(*args, **kwargs):
            raise Exception("ClickHouse unavailable")
            yield
        
        mock_stub_instance.FetchAlertContext = mock_fetch
        
        try:
            await tool_fetch_alert_context(["E-A1"])
            pytest.fail("Database failure must raise error, cannot return empty success")
        except RuntimeError as e:
            assert "ClickHouse unavailable" in str(e), "Failure cause must propagate"

