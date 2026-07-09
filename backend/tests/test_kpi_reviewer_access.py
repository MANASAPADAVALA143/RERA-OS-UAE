"""Tests for KPI reviewer access (role + primary operator email)."""
import pytest
from fastapi import HTTPException

from config import settings
from middleware.auth import CurrentUser, is_kpi_reviewer, require_kpi_reviewer
from models.tenancy import UserRole

PRIMARY = settings.primary_user_email


def test_kpi_reviewer_roles_allowed():
    assert is_kpi_reviewer(UserRole.platform_admin)
    assert is_kpi_reviewer(UserRole.internal_reviewer)


def test_kpi_reviewer_primary_email_allowed():
    assert is_kpi_reviewer(UserRole.owner, PRIMARY)
    assert is_kpi_reviewer(UserRole.owner, PRIMARY.upper())


def test_kpi_reviewer_roles_blocked():
    for role in (
        UserRole.owner,
        UserRole.admin,
        UserRole.client,
        UserRole.viewer,
    ):
        assert not is_kpi_reviewer(role, "other@example.com")


@pytest.mark.asyncio
async def test_require_kpi_reviewer_blocks_client():
    client_user = CurrentUser("u1", "t1", UserRole.client, "client@example.com")
    with pytest.raises(HTTPException) as exc:
        await require_kpi_reviewer(client_user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_kpi_reviewer_allows_primary_email():
    owner = CurrentUser("u2", "t1", UserRole.owner, PRIMARY)
    result = await require_kpi_reviewer(owner)
    assert result.email == PRIMARY


@pytest.mark.asyncio
async def test_require_kpi_reviewer_allows_internal_reviewer():
    reviewer = CurrentUser("u3", "t1", UserRole.internal_reviewer, "staff@cafirm.com")
    result = await require_kpi_reviewer(reviewer)
    assert result.role == UserRole.internal_reviewer
