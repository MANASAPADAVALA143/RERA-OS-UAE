"""Cross-tenant isolation for /api/reit/* endpoints."""
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import models.audit_log  # noqa: F401
import models.real_estate.construction_cost  # noqa: F401
import models.real_estate.construction_extended  # noqa: F401
import models.real_estate.entity  # noqa: F401
import models.real_estate.financing  # noqa: F401
import models.real_estate.permitting  # noqa: F401
import models.real_estate.pipeline  # noqa: F401
import models.real_estate.reit_rental  # noqa: F401
import models.real_estate.risk  # noqa: F401
import models.real_estate.unit  # noqa: F401
import models.reit.financials  # noqa: F401
import models.reit.property  # noqa: F401
import models.reit.unit  # noqa: F401
import models.tenancy  # noqa: F401
from database import Base, get_db
from main import app
from models.tenancy import Tenant, TenantUser, UserRole, UserStatus
from scripts.seed_reit_property import load_data, seed_property
from services.local_auth import create_access_token, hash_password, new_local_user_id


@pytest.fixture()
def reit_client(monkeypatch):
    # Prevent startup from seeding the real on-disk demo DB during API tests.
    monkeypatch.setattr("main.ensure_local_demo", lambda _db: None)
    monkeypatch.setattr("main.apply_schema_patches", lambda _engine: None)

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = Session()

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    tenant_a = Tenant(company_name="Tenant A REIT")
    tenant_b = Tenant(company_name="Tenant B Other")
    session.add_all([tenant_a, tenant_b])
    session.flush()

    user_a_id = new_local_user_id()
    user_b_id = new_local_user_id()
    session.add_all([
        TenantUser(
            tenant_id=tenant_a.id,
            supabase_user_id=user_a_id,
            email="tenant-a@test.com",
            password_hash=hash_password("password123"),
            role=UserRole.owner,
            status=UserStatus.active,
        ),
        TenantUser(
            tenant_id=tenant_b.id,
            supabase_user_id=user_b_id,
            email="tenant-b@test.com",
            password_hash=hash_password("password123"),
            role=UserRole.owner,
            status=UserStatus.active,
        ),
    ])
    session.commit()

    rp001 = seed_property(session, tenant_a.id, load_data(), replace=True)
    session.commit()

    token_a = create_access_token(user_a_id, "tenant-a@test.com")
    token_b = create_access_token(user_b_id, "tenant-b@test.com")

    yield {
        "client": client,
        "token_a": token_a,
        "token_b": token_b,
        "property_id": str(rp001.id),
        "tenant_a": tenant_a.id,
        "tenant_b": tenant_b.id,
    }

    app.dependency_overrides.clear()
    session.close()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_tenant_b_sees_no_reit_properties(reit_client):
    client = reit_client["client"]
    res = client.get("/api/reit/properties", headers=_auth(reit_client["token_b"]))
    assert res.status_code == 200
    assert res.json() == []


def test_tenant_b_cannot_access_tenant_a_property_detail(reit_client):
    client = reit_client["client"]
    pid = reit_client["property_id"]
    res = client.get(f"/api/reit/properties/{pid}", headers=_auth(reit_client["token_b"]))
    assert res.status_code == 404


def test_tenant_b_portfolio_summary_empty(reit_client):
    client = reit_client["client"]
    res = client.get("/api/reit/portfolio-summary", headers=_auth(reit_client["token_b"]))
    assert res.status_code == 200
    body = res.json()
    assert body["total_properties"] == 0
    assert body["properties_below_dscr_covenant"] == []


def test_tenant_a_sees_rp001_with_covenant_alert(reit_client):
    client = reit_client["client"]
    res = client.get("/api/reit/portfolio-summary", headers=_auth(reit_client["token_a"]))
    assert res.status_code == 200
    body = res.json()
    assert body["total_properties"] == 1
    assert len(body["properties_below_dscr_covenant"]) == 1
    assert body["properties_below_dscr_covenant"][0]["property_name"] == "Desert Vista Townhomes"
    assert body["by_property"][0]["dscr_status"] == "below_covenant"


def test_tenant_a_pl_summary_matches_rp001_targets(reit_client):
    client = reit_client["client"]
    pid = reit_client["property_id"]
    res = client.get(f"/api/reit/properties/{pid}/pl-summary", headers=_auth(reit_client["token_a"]))
    assert res.status_code == 200
    pl = res.json()
    assert pl["effective_gross_income"] == 8300
    assert pl["net_operating_income"] == 2182
    assert pl["cash_flow_after_debt_service"] == -1773
