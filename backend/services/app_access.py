"""Single primary operator — full app access for one CA firm email only."""
from __future__ import annotations

from config import settings


def normalized_primary_email() -> str:
    return (settings.primary_user_email or "").strip().lower()


def is_primary_app_user(email: str | None) -> bool:
    """True only for the configured primary operator (e.g. consulting.akk@gmail.com)."""
    primary = normalized_primary_email()
    if not primary or not email:
        return False
    return email.strip().lower() == primary


def assert_primary_app_user(email: str | None) -> None:
    from fastapi import HTTPException, status

    if not is_primary_app_user(email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"This application is restricted to {settings.primary_user_email}. "
                "No additional user accounts are enabled."
            ),
        )
