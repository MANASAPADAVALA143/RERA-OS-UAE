"""Update the demo account email + password in RDS.
Run from backend/: python scripts/set_account_password.py <new_email> <new_password>
Example: python scripts/set_account_password.py you@company.com MyStr0ng#Pass
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL, hash_password

if len(sys.argv) < 3:
    print("Usage: python scripts/set_account_password.py <email> <password>")
    sys.exit(1)

new_email = sys.argv[1].strip()
new_password = sys.argv[2].strip()

if len(new_password) < 10:
    print("Password must be at least 10 characters.")
    sys.exit(1)

db = SessionLocal()
try:
    user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
    if not user:
        print(f"Account '{DEMO_EMAIL}' not found.")
        sys.exit(1)

    user.email = new_email
    user.password_hash = hash_password(new_password)
    db.commit()
    print(f"Account updated -> email: {new_email}")
    print("Password set successfully.")
finally:
    db.close()
