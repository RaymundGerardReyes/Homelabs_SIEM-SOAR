# soc-backend/tests/test_api_routes.py
"""
Comprehensive Unit Test Suite for soc-backend/Interfaces/api_routes.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Coverage areas:
  1. Auth & Security dependency (verify_internal_auth)
  2. Endpoint management (hosts, isolation, release, health)
  3. Agent task queue & credential management
  4. Investigation workflow (REST + actions)
  5. Alert queries
  6. Playbook registry & execution
  7. Dashboard & compliance
  8. Threat-Intel enrichment
  9. Shift handoff
 10. Marketplace listings CRUD
 11. User settings PATCH/GET
 12. Asset inventory & network map
 13. Notification feed
 14. Metrics overview
 15. Enrollment token flow
 16. Edge / error / 40x path cases
"""

import sys
import os
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

# ── Path bootstrap ──────────────────────────────────────────────────────────
SOC_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.abspath(os.path.join(SOC_BACKEND, ".."))
for p in [SOC_BACKEND, REPO_ROOT]:
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    import google.protobuf.runtime_version
    google.protobuf.runtime_version.ValidateProtobufRuntimeVersion = lambda *args, **kwargs: None
except Exception:
    pass

# ── Stub heavy transitive dependencies before import ────────────────────────
import types

def _stub_module(name, **attrs):
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
    return mod

# Stub cryptography.fernet
fernet_mod = _stub_module("cryptography")
hazmat_mod = _stub_module("cryptography.hazmat")
sys.modules["cryptography.hazmat"] = hazmat_mod
fernet_cls = MagicMock()
fernet_cls.generate_key.return_value = b"A" * 32
fernet_instance = MagicMock()
fernet_instance.encrypt.return_value = b"enc-secret"
fernet_instance.decrypt.return_value = b"dec-secret"
fernet_cls.return_value = fernet_instance
fernet_mod2 = _stub_module("cryptography.fernet", Fernet=fernet_cls)

# Ensure sys.modules retains real package attributes for Infrastructure and Domain

# ── NOW safe to import ───────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from Interfaces.api_routes import router, verify_internal_auth, INTERNAL_SERVICE_KEY
from Interfaces.agent_routes import router as agent_router
from Infrastructure.Http.Deps import get_db

# ── Test app & fixtures ──────────────────────────────────────────────────────
app = FastAPI()
app.include_router(router)
app.include_router(router, prefix="/api")
app.include_router(agent_router)
app.include_router(agent_router, prefix="/api")

_FAKE_HOST_ROW = {
    "id": "ep-aaa",
    "hostname": "PROD-APP-01",
    "type": "iaas",
    "os": "Linux Ubuntu 22.04",
    "agentVersion": "1.3.0",
    "health": "active",
    "lastCheckIn": datetime(2026, 7, 25, 12, 0, 0),
    "tenant_id": "tenant-alpha",
    "region": "us-east-1",
    "label": "Production App"
}

_FAKE_ISO_ROW = {
    "id": "ep-bbb",
    "hostname": "FIN-WORKSTATION-05",
    "status": "isolated",
    "lastCheckIn": datetime(2026, 7, 25, 14, 30, 0),
    "tenant_id": "tenant-beta"
}


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.fetch.return_value = []
    db.fetchrow.return_value = {
        "total_endpoints": 5,
        "active_count": 3,
        "pending_count": 2,
        "last_seen": datetime(2026, 7, 25, 14, 0, 0)
    }
    return db


@pytest.fixture
def client(mock_db):
    async def override_get_db():
        yield mock_db

    from Interfaces.main import app as main_app
    main_app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False, headers={"X-Tenant-ID": "tenant-a"}) as c:
        yield c
    main_app.dependency_overrides.clear()
    app.dependency_overrides.clear()


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 – AUTHENTICATION & SECURITY
# ══════════════════════════════════════════════════════════════════════════════

def test_auth_dev_mode_permits_missing_creds(monkeypatch):
    """Dev env must not block unauthenticated calls"""
    monkeypatch.setenv("ENVIRONMENT", "development")
    req = MagicMock()
    req.cookies.get.return_value = None
    req.headers.get.return_value = None
    assert verify_internal_auth(request=req) is True


def test_auth_prod_rejects_missing_creds(monkeypatch):
    """Production env must raise 401 on missing credentials"""
    monkeypatch.setenv("ENVIRONMENT", "production")
    req = MagicMock()
    req.cookies.get.return_value = None
    req.headers.get.return_value = None
    with pytest.raises(HTTPException) as exc:
        verify_internal_auth(request=req)
    assert exc.value.status_code == 401


def test_auth_valid_internal_service_key_accepted(monkeypatch):
    """Valid X-Internal-Service-Key must succeed in production"""
    monkeypatch.setenv("ENVIRONMENT", "production")
    req = MagicMock()
    req.cookies.get.return_value = None
    def _header(k, default=None):
        return os.environ.get("INTERNAL_SERVICE_KEY", "test-internal-service-key") if k == "X-Internal-Service-Key" else default
    req.headers.get.side_effect = _header
    assert verify_internal_auth(request=req) is True


def test_auth_wrong_internal_key_rejected(monkeypatch):
    """Wrong service key in production must raise 401"""
    monkeypatch.setenv("ENVIRONMENT", "production")
    req = MagicMock()
    req.cookies.get.return_value = None
    req.headers.get.return_value = "wrong-key-xyz"
    with pytest.raises(HTTPException) as exc:
        verify_internal_auth(request=req)
    assert exc.value.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 – ENDPOINTS / HOSTS (DB-backed)
# ══════════════════════════════════════════════════════════════════════════════

def test_get_hosts_returns_live_db_rows(client, mock_db):
    """GET /endpoints/hosts must return DB rows, not mock seed data"""
    mock_db.fetch.return_value = [_FAKE_HOST_ROW]
    res = client.get("/endpoints/hosts")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 1
    assert data[0]["hostname"] == "PROD-APP-01"
    assert data[0]["id"] == "ep-aaa"


def test_get_hosts_active_maps_to_healthy(client, mock_db):
    """DB status 'active' must map to frontend 'healthy'"""
    mock_db.fetch.return_value = [_FAKE_HOST_ROW]
    res = client.get("/endpoints/hosts")
    assert res.json()[0]["health"] == "healthy"


def test_get_hosts_pending_register_maps_to_stale(client, mock_db):
    """DB status 'pending_register' must map to frontend 'stale'"""
    row = {**_FAKE_HOST_ROW, "health": "pending_register"}
    mock_db.fetch.return_value = [row]
    res = client.get("/endpoints/hosts")
    assert res.json()[0]["health"] == "stale"


def test_get_hosts_unknown_status_maps_to_offline(client, mock_db):
    """Unrecognised DB status should fall back to 'offline'"""
    row = {**_FAKE_HOST_ROW, "health": "decommissioned"}
    mock_db.fetch.return_value = [row]
    res = client.get("/endpoints/hosts")
    assert res.json()[0]["health"] == "offline"


def test_get_hosts_empty_db_returns_empty_list(client, mock_db):
    """Empty DB returns empty array – no hardcoded seed injected"""
    mock_db.fetch.return_value = []
    res = client.get("/endpoints/hosts")
    assert res.status_code == 200
    assert res.json() == []


def test_get_hosts_null_checkin_handled(client, mock_db):
    """lastCheckIn = None must return empty string, not crash"""
    row = {**_FAKE_HOST_ROW, "lastCheckIn": None}
    mock_db.fetch.return_value = [row]
    res = client.get("/endpoints/hosts")
    assert res.json()[0]["lastCheckIn"] == ""


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 – ISOLATION CANDIDATES (DB-backed)
# ══════════════════════════════════════════════════════════════════════════════

def test_get_isolation_candidates_live_db(client, mock_db):
    """GET /endpoints/isolation-candidates must reflect DB, not WIN-FIN-03 seed"""
    mock_db.fetch.return_value = [_FAKE_ISO_ROW]
    res = client.get("/endpoints/isolation-candidates")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["hostname"] == "FIN-WORKSTATION-05"
    assert data[0]["isIsolated"] is True


def test_get_isolation_candidates_empty_db(client, mock_db):
    """Empty DB returns empty list – no hardcoded WIN-FIN-03"""
    mock_db.fetch.return_value = []
    res = client.get("/endpoints/isolation-candidates")
    assert res.status_code == 200
    assert res.json() == []


def test_get_isolation_candidates_non_isolated_host(client, mock_db):
    """Non-isolated host must have isIsolated=False"""
    row = {**_FAKE_ISO_ROW, "status": "active"}
    mock_db.fetch.return_value = [row]
    res = client.get("/endpoints/isolation-candidates")
    data = res.json()
    assert data[0]["isIsolated"] is False
    assert data[0]["isolatedAt"] is None


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 – HOST ISOLATION / RELEASE (Two-Key)
# ══════════════════════════════════════════════════════════════════════════════

def test_isolate_host_missing_token_returns_403(client):
    res = client.post("/endpoints/host-001/isolate", json={})
    assert res.status_code == 403
    assert "Two-Key" in res.json()["detail"]


def test_isolate_host_null_body_returns_403(client):
    res = client.post("/endpoints/host-001/isolate")
    assert res.status_code in (403, 422)


def test_isolate_host_valid_token_succeeds(client):
    res = client.post("/endpoints/host-001/isolate", json={"twoKeyToken": "TK-VALID"})
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_release_host_missing_token_returns_403(client):
    res = client.post("/endpoints/host-001/release", json={})
    assert res.status_code == 403


def test_release_host_valid_token_succeeds(client):
    res = client.post("/endpoints/host-001/release", json={"twoKeyToken": "TK-VALID"})
    assert res.status_code == 200
    assert res.json()["status"] == "success"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 – AGENT TASK QUEUE & CREDENTIAL MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

def test_get_agent_tasks_missing_cf_header_returns_403(client):
    """Missing auth or zero-trust header must return 401 or 403 status code"""
    res = client.get("/api/agents/tasks?endpoint_id=ep-test")
    assert res.status_code in (401, 403)


def test_get_agent_tasks_with_cf_header_returns_tasks(client, mock_db):
    mock_db.fetchrow.return_value = {"endpoint_id": "ep-unknown", "tenant_id": "t-1", "status": "active"}
    mock_db.fetch.return_value = []
    res = client.get(
        "/api/agents/tasks?endpoint_id=ep-unknown",
        headers={"Authorization": "Bearer test-secret", "CF-Access-Client-Id": "test-client-id"}
    )
    assert res.status_code == 200
    assert "tasks" in res.json()
    assert isinstance(res.json()["tasks"], list)


def test_rotate_credential_unknown_endpoint_returns_404(client):
    res = client.post("/endpoints/ep-does-not-exist/rotate")
    assert res.status_code == 404


def test_rotate_credential_known_endpoint_succeeds(client):
    """Seed a known endpoint then rotate its credentials"""
    from Interfaces.api_routes import ENDPOINT_REGISTRY
    ENDPOINT_REGISTRY["ep-seed-test"] = {
        "hostname": "TEST-HOST",
        "cf_client_id": "old-id",
        "cf_client_secret": "old-secret"
    }
    res = client.post("/endpoints/ep-seed-test/rotate")
    assert res.status_code == 200
    assert res.json()["status"] == "success"
    assert "new_cf_client_id" in res.json()


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 – INVESTIGATION ENGINE
# ══════════════════════════════════════════════════════════════════════════════

def test_get_investigation_by_id(client):
    res = client.get("/investigations/inv-x100")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "inv-x100"
    assert "nodes" in data
    assert "details" in data


def test_get_investigation_has_proposed_actions(client):
    res = client.get("/investigations/inv-x200")
    assert len(res.json()["details"]["proposed_actions"]) >= 1


def test_get_investigation_has_conversation_log(client):
    res = client.get("/investigations/inv-x300")
    assert len(res.json()["details"]["conversation_log"]) >= 1


def test_execute_investigation_action_success(client):
    payload = {"action": "Isolate Endpoint", "target": "WIN-FIN-03"}
    res = client.post("/investigations/inv-x400/actions", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_legacy_investigation_alert_not_found(client):
    """GET /investigation/{alert_id} with bad ID must 404"""
    res = client.get("/investigation/alert-not-real-99999")
    assert res.status_code == 404


def test_legacy_investigation_known_alert(client):
    """GET /investigation/{alert_id} with seeded ID must return node graph"""
    res = client.get("/investigation/alert-172102001")
    assert res.status_code == 200
    assert "details" in res.json()


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 – ALERTS & THREAT INTEL
# ══════════════════════════════════════════════════════════════════════════════

def test_get_alerts_returns_list(client):
    res = client.get("/alerts")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_get_alerts_have_required_fields(client):
    for alert in client.get("/alerts").json():
        assert "id" in alert
        assert "severity" in alert


def test_threat_intel_enrich_valid_ip(client):
    res = client.get("/threat-intel/enrich?ip=185.220.101.5")
    assert res.status_code == 200
    data = res.json()
    assert "overall_risk_score" in data
    assert data["source_ip"] == "185.220.101.5"


def test_threat_intel_enrich_missing_ip_returns_400(client):
    res = client.get("/threat-intel/enrich")
    assert res.status_code in (400, 422)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 – PLAYBOOKS
# ══════════════════════════════════════════════════════════════════════════════

def test_get_playbooks_returns_list(client):
    res = client.get("/playbooks")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_run_playbook_local_sandbox(client):
    payload = {"target": "test-server", "justification": "Unit test"}
    with patch("Interfaces.api_routes.execute_playbook_in_sandbox", return_value={"status": "success", "logs": ["done"]}):
        res = client.post("/api/playbooks/pb-1/run", json=payload)
        assert res.status_code == 200
        assert res.json().get("status") == "success"


def test_run_playbook_missing_target_returns_422(client):
    res = client.post("/playbooks/isolate_host/run", json={})
    assert res.status_code == 422


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9 – DASHBOARDS & COMPLIANCE
# ══════════════════════════════════════════════════════════════════════════════

def test_get_executive_summary(client):
    res = client.get("/dashboards/executive-summary")
    assert res.status_code == 200
    data = res.json()
    assert "totalIncidents" in data
    assert "complianceScore" in data


def test_export_executive_summary_returns_pdf(client):
    res = client.post("/dashboards/executive-summary/export")
    assert res.status_code == 200
    assert "pdf" in res.headers["content-type"]


def test_schedule_executive_report(client):
    payload = {"email": "ciso@corp.com", "frequency": "weekly"}
    res = client.post("/dashboards/executive-summary/schedule", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_get_compliance_status(client):
    res = client.get("/dashboards/compliance-status")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 2
    for fw in data:
        assert "controls" in fw


def test_assign_compliance_task(client):
    payload = {"assignee": "alice@soc.dev", "dueDate": "2026-08-01"}
    res = client.post("/dashboards/compliance-status/SOC2-CC-02/tasks", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "success"
    assert res.json()["task"]["controlId"] == "SOC2-CC-02"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 10 – SHIFT HANDOFF
# ══════════════════════════════════════════════════════════════════════════════

def test_shift_handoff_personal_queue(client):
    res = client.post("/shifts/handoff", json={"queue": "me"})
    assert res.status_code == 200
    assert res.json()["scope"] == "personal"


def test_shift_handoff_team_queue(client):
    res = client.post("/shifts/handoff", json={"queue": "all"})
    assert res.status_code == 200
    assert res.json()["scope"] == "team-wide"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 11 – MARKETPLACE CRUD
# ══════════════════════════════════════════════════════════════════════════════

def test_marketplace_listings_returns_all(client):
    res = client.get("/data/marketplace/listings")
    assert res.status_code == 200
    assert len(res.json()) >= 3


def test_marketplace_install_listing(client):
    res = client.post("/data/marketplace/listings/ml-1/install")
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_marketplace_uninstall_listing(client):
    res = client.delete("/data/marketplace/listings/ml-1/install")
    assert res.status_code == 200
    assert res.json()["status"] == "success"


def test_marketplace_install_unknown_listing_returns_404(client):
    res = client.post("/data/marketplace/listings/ml-NONEXIST/install")
    assert res.status_code == 404


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 12 – USER SETTINGS & SESSION MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

def test_get_settings_returns_profile(client):
    res = client.get("/data/settings")
    assert res.status_code == 200
    assert "email" in res.json()
    assert "role" in res.json()


def test_update_settings_partial_patch(client):
    res = client.patch("/data/settings", json={"name": "Lead Analyst", "timezone": "PST"})
    assert res.status_code == 200
    assert res.json()["updated"]["name"] == "Lead Analyst"


def test_update_settings_empty_patch(client):
    res = client.patch("/data/settings", json={})
    assert res.status_code == 200


def test_revoke_all_sessions(client):
    res = client.post("/data/auth/revoke-all-sessions")
    assert res.status_code == 200
    assert res.json()["status"] == "success"


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 13 – ASSETS & NETWORK MAP
# ══════════════════════════════════════════════════════════════════════════════

def test_get_asset_inventory(client):
    res = client.get("/assets/inventory")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    for asset in data:
        assert "hostname" in asset
        assert "criticality" in asset


def test_get_network_map_structure(client):
    res = client.get("/assets/network-map")
    assert res.status_code == 200
    data = res.json()
    assert "nodes" in data
    assert "edges" in data
    assert isinstance(data["nodes"], list)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 14 – NOTIFICATIONS & METRICS
# ══════════════════════════════════════════════════════════════════════════════

def test_get_notifications(client):
    res = client.get("/notifications")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    for n in data:
        assert "message" in n
        assert "severity" in n


def test_get_metrics_overview(client):
    res = client.get("/metrics/overview")
    assert res.status_code == 200
    data = res.json()
    assert "alertsScanned" in data
    assert "openIncidents" in data


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 15 – ACTIONS EXECUTE (HIGH-RISK)
# ══════════════════════════════════════════════════════════════════════════════

def test_execute_action_destructive_without_two_key_returns_403(client):
    payload = {
        "action": "block_ip",
        "target": "10.0.0.99",
        "justification": "Detected C2",
        "risk": "DESTRUCTIVE"
    }
    res = client.post("/actions/execute", json=payload)
    assert res.status_code == 403


def test_execute_action_destructive_with_two_key_succeeds(client):
    payload = {
        "action": "block_ip",
        "target": "10.0.0.99",
        "justification": "Detected C2",
        "risk": "DESTRUCTIVE",
        "twoKeyToken": "TK-ADMIN-001"
    }
    res = client.post("/actions/execute", json=payload)
    assert res.status_code == 200
    assert res.json()["status"] == "accepted"


def test_execute_action_low_risk_no_token_succeeds(client):
    payload = {
        "action": "fetch_logs",
        "target": "prod-syslog",
        "justification": "Routine audit",
        "risk": "READ_ONLY"
    }
    res = client.post("/actions/execute", json=payload)
    assert res.status_code == 200


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 16 – INCIDENTS
# ══════════════════════════════════════════════════════════════════════════════

def test_get_active_incidents(client):
    res = client.get("/incidents/active")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    for inc in data:
        assert "severity" in inc
        assert "status" in inc
