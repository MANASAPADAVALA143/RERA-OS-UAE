"""Tests for single primary-user app access gate."""
import pytest
from fastapi import HTTPException

from config import settings
from services.app_access import assert_primary_app_user, is_primary_app_user

PRIMARY = settings.primary_user_email


def test_is_primary_app_user():
    assert is_primary_app_user(PRIMARY)
    assert is_primary_app_user(PRIMARY.upper())
    assert not is_primary_app_user("other@example.com")
    assert not is_primary_app_user(None)


def test_assert_primary_app_user_blocks_others():
    with pytest.raises(HTTPException) as exc:
        assert_primary_app_user("stranger@example.com")
    assert exc.value.status_code == 403
