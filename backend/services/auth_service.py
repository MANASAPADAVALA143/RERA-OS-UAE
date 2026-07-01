from fastapi import Depends
from middleware.auth import CurrentUser, get_current_user


async def get_current_tenant(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return tenant/user info as a plain dict (used by AI chat endpoint)."""
    return {
        "tenant_id": str(current_user.tenant_id),
        "user_id": str(current_user.user_id),
        "email": current_user.email,
        "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
    }
