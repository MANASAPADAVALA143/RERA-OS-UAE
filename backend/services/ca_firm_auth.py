"""CA firm workspace — only @cafirm-domain emails may register and review calculations."""
from __future__ import annotations

from config import settings
from models.tenancy import UserRole


def ca_firm_email_domains() -> set[str]:
    raw = settings.ca_firm_email_domains or "estatecfo.com"
    return {d.strip().lower() for d in raw.split(",") if d.strip()}


def is_ca_firm_email(email: str | None) -> bool:
    if not email or "@" not in email:
        return False
    return email.split("@")[-1].lower() in ca_firm_email_domains()


def can_use_kpi_review(role: UserRole, email: str | None) -> bool:
    """Calculations Review — internal_reviewer on a CA firm email only."""
    return role == UserRole.internal_reviewer and is_ca_firm_email(email)


def assert_ca_firm_email(email: str) -> None:
    if not is_ca_firm_email(email):
        domains = ", ".join(sorted(ca_firm_email_domains()))
        raise ValueError(
            f"This workspace is for CA firm staff only. Use an email @{domains}."
        )
