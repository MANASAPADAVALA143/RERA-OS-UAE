"""CA firm operator emails — Calculations Review access (not login gating)."""
from __future__ import annotations

from config import settings


def kpi_reviewer_email_set() -> set[str]:
    raw = settings.kpi_reviewer_emails or settings.primary_user_email or ""
    emails = {e.strip().lower() for e in raw.split(",") if e.strip()}
    if settings.primary_user_email:
        emails.add(settings.primary_user_email.strip().lower())
    return emails


def is_primary_app_user(email: str | None) -> bool:
    """True for configured CA firm reviewer emails (Calculations Review tools)."""
    if not email:
        return False
    return email.strip().lower() in kpi_reviewer_email_set()


def assert_primary_app_user(email: str | None) -> None:
    from fastapi import HTTPException, status

    if not is_primary_app_user(email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Calculations review is restricted to CA firm reviewer accounts.",
        )
