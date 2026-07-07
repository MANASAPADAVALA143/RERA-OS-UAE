"""Tests for primary-email KPI reviewer access (single-user mode)."""
import pytest
from fastapi import HTTPException

from config import settings
from middleware.auth import CurrentUser, is_kpi_reviewer, require_kpi_reviewer
from models.tenancy import UserRole

PRIMARY = settings.primary_user_email


def test_kpi_reviewer_primary_email_allowed():
    assert is_kpi_reviewer(UserRole.owner, PRIMARY)
    assert is_kpi_reviewer(UserRole.internal_reviewer, PRIMARY)
    assert is_kpi_reviewer(UserRole.client, PRIMARY)


def test_kpi_reviewer_platform_admin_always_allowed():
    assert is_kpi_reviewer(UserRole.platform_admin, "anyone@example.com")


def test_kpi_reviewer_other_emails_blocked():
    for role in (
        UserRole.owner,
        UserRole.internal_reviewer,
        UserRole.client,
        UserRole.admin,
    ):
        assert not is_kpi_reviewer(role, "other@example.com")


@pytest.mark.asyncio
async def test_require_kpi_reviewer_blocks_non_primary():
    user = CurrentUser("u1", "t1", UserRole.owner, "other@example.com")
    with pytest.raises(HTTPException) as exc:
        await require_kpi_reviewer(user)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_require_kpi_reviewer_allows_primary():
    user = CurrentUser("u2", "t1", UserRole.owner, PRIMARY)
    result = await require_kpi_reviewer(user)
    assert result.email == PRIMARY
