import psycopg2
import sys
sys.path.insert(0, '.')
from config import settings

url = settings.effective_database_url
print(f"Connecting to: {url[:50]}...")

conn = psycopg2.connect(url.replace('postgresql+psycopg2://', 'postgresql://'))
cur = conn.cursor()

print("\ntenant_users columns:")
cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tenant_users' ORDER BY ordinal_position")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]}")

print("\nUsers in tenant_users:")
cur.execute("SELECT email, role, status, password_hash IS NOT NULL as has_hash FROM tenant_users")
for row in cur.fetchall():
    print(f"  email={row[0]}, role={row[1]}, status={row[2]}, has_hash={row[3]}")

cur.execute("SELECT count(*) FROM tenants")
print(f"\nTenants count: {cur.fetchone()[0]}")

conn.close()
print("Done.")
