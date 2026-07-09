import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from config import settings

DEMO_EMAIL = settings.primary_user_email
DEMO_PASSWORD = "DemoRera2026!"
DEMO_COMPANY = "RERA OS Demo Portfolio"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "aud": "authenticated",
        "iss": "estatecfo-local",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.local_jwt_secret, algorithm="HS256")


def decode_local_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.local_jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
    )


def new_local_user_id() -> str:
    return str(uuid.uuid4())
