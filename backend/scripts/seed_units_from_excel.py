"""Insert units from Rent Receivable Sheet Excel into r_units table."""
import uuid
import psycopg2

DSN = "postgresql://estatecfo_master:Anilca6789@estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com:5432/estatecfo"
TENANT_ID = "85b50a59-f911-4038-a0f5-c0841e4e61ce"

# company_id → suite_id mapping from DB
COMPANY_SUITE = {
    "ed434914-5029-4e7d-a105-897b28c79af4": {   # ABC LLC
        "57155d20-b8e7-46e0-9336-ff72aaba4d1e": "ABC LLC Suite 123",
        "50807098-7b56-456b-a3a1-db5b42b46c99": "SUITE 456",
        "94c01191-d241-49b1-84c1-a85d8159ce62": "Suite 789",
    },
    "12635647-ed10-4c60-979e-317949a078a1": {   # TOWN Houses
        "381142ec-16b9-4b40-b244-6edf5b08f5a4": "TOWN HOMES",
    },
    "2ba9af6f-d0c8-40ca-a89d-55dd8ab94a07": {   # BNC LLC
        "1398c77c-522f-483f-8452-41ccbc9d0da6": "BNC LLC SUITE 123",
    },
    "c358b51b-628a-4053-af13-891f331b2c92": {   # DEC LLC
        "0380833f-0992-4df4-8954-53bb238b46d3": "DEC LLC SUITE 123",
    },
    "27664e74-002e-4213-9114-b4ad74ff9db4": {   # XYZ LLC
        "8a0f4d34-bec9-4e82-8ebd-ab4f56963a96": "XYZ LLC SUITE 123",
    },
    "a9eb08f4-e641-4206-930e-30e01dd65eb6": {   # ZYC LLC
        "4b193a6d-97b1-4e73-8a97-5e4dd7f8ad6c": "ZYC LLC",
    },
    "d3c84572-f4c9-417e-94ed-974b26efced3": {   # ACD LLC
        "d005ed0a-e636-4347-b5ef-e687be5bcb0b": "ACD LLC",
    },
    "c193727c-85e4-4a35-8868-25ba561c199f": {   # NHJ LLC
        "30d5d515-fc8d-4ec0-83e7-43d8033df5e6": "NHJ LLC",
    },
    "a9f99ae2-8458-4b81-aa4a-ba5b5d1fa2b2": {   # FJH LLC
        "6e11743c-0741-45a1-b995-e61678677aad": "FJH LLC",
    },
    "68def95e-430b-47e1-aeee-305032a00f9f": {   # KLI LLC
        "69de67db-3ec9-4417-a30e-038a14a5e034": "KLI LLC",
    },
}

# suite_id → list of (unit_number, monthly_rent)
# rent=0 → vacant, rent>0 → occupied
UNITS = {
    # ── ABC LLC Suite 123 ───────────────────────────────────────────────────
    "57155d20-b8e7-46e0-9336-ff72aaba4d1e": [
        ("Unit A",        850.00),
        ("Unit B",        700.00),
        ("Unit C",        925.00),
        ("Unit D",          0.00),
        ("Unit E, F, G", 3100.00),
    ],
    # ── SUITE 456 ───────────────────────────────────────────────────────────
    "50807098-7b56-456b-a3a1-db5b42b46c99": [
        ("Unit 401",    4100.33),
        ("Unit 402",       0.00),
    ],
    # ── Suite 789 ───────────────────────────────────────────────────────────
    "94c01191-d241-49b1-84c1-a85d8159ce62": [
        ("Unit A, B, C",  2050.00),
        ("Unit D, E, F",  1725.00),
        ("Unit G",         775.00),
        ("Unit H",         800.00),
        ("Unit I",           0.00),
        ("Unit J, K, L",  1675.00),
        ("Unit M",        1750.00),
        ("Unit N",           0.00),
        ("Unit O",           0.00),
        ("Unit P",         800.00),
        ("Unit Q",         730.00),
        ("Unit T",         800.00),
        ("Unit U",         700.00),
        ("Unit V",         800.00),
        ("Unit W",         400.00),
        ("Unit R & S",    1800.00),
    ],
    # ── TOWN HOMES ──────────────────────────────────────────────────────────
    "381142ec-16b9-4b40-b244-6edf5b08f5a4": [
        ("Unit A",       0.00),
        ("Unit B",    2401.70),
        ("Unit C",    2000.00),
        ("Unit D",    6500.00),
        ("Unit E",    2791.70),
        ("Unit F",    1750.00),
        ("Unit G",    1875.00),
        ("Unit H",    4000.00),
        ("Unit I",    7140.00),
        ("Unit J",    3500.00),
        ("Unit K",    3200.00),
        ("Unit L",       0.00),
    ],
    # ── BNC LLC SUITE 123 ───────────────────────────────────────────────────
    "1398c77c-522f-483f-8452-41ccbc9d0da6": [
        ("Unit A",       800.00),
        ("Unit B, C",      0.00),
        ("Unit D",       730.00),
        ("Unit E & F",  1575.00),
        ("Unit G",       875.00),
        ("Unit H",       800.00),
        ("Unit I",       800.00),
        ("Unit J",       825.00),
        ("Unit K & L",  1100.00),
        ("Unit M",       875.00),
    ],
    # ── DEC LLC SUITE 123 ───────────────────────────────────────────────────
    "0380833f-0992-4df4-8954-53bb238b46d3": [
        ("Unit A",     800.00),
        ("Unit B",       0.00),
        ("Unit C",     900.00),
        ("Unit D",     800.00),
        ("Unit E",     825.00),
        ("Unit F",     850.00),
        ("Unit G",     800.00),
        ("Unit H",     900.00),
        ("Unit I",     800.00),
        ("Unit J",       0.00),
        ("Unit K",    1950.00),
        ("Unit L",       0.00),
        ("Unit M",       0.00),
        ("Unit N",       0.00),
        ("Unit O",    2150.00),
        ("Unit P",       0.00),
        ("Unit Q",    1800.00),
        ("Unit R",       0.00),
        ("Unit S",     700.00),
    ],
    # ── XYZ LLC SUITE 123 ───────────────────────────────────────────────────
    "8a0f4d34-bec9-4e82-8ebd-ab4f56963a96": [
        ("Unit A",   600.00),
        ("Unit B",   775.00),
        ("Unit C",   450.00),
        ("Unit D",   800.00),
        ("Unit E",   775.00),
        ("Unit F",   800.00),
    ],
    # ── ZYC LLC ─────────────────────────────────────────────────────────────
    "4b193a6d-97b1-4e73-8a97-5e4dd7f8ad6c": [
        ("Unit A",   900.00),
        ("Unit B",   875.00),
        ("Unit C",   825.00),
        ("Unit D",   925.00),
        ("Unit E",   800.00),
        ("Unit F",   750.00),
        ("Unit G",   875.00),
        ("Unit H",   925.00),
        ("Unit I",   800.00),
        ("Unit J",   775.00),
        ("Unit K",   750.00),
        ("Unit L",   825.00),
        ("Unit M",   900.00),
        ("Unit N",   850.00),
        ("Unit O",     0.00),
        ("Unit P",   800.00),
        ("Unit Q",   850.00),
        ("Unit R",   825.00),
        ("Unit S",   775.00),
        ("Unit T",   825.00),
    ],
    # ── ACD LLC ─────────────────────────────────────────────────────────────
    "d005ed0a-e636-4347-b5ef-e687be5bcb0b": [
        ("Unit A",  1050.00),
        ("Unit B",   800.00),
        ("Unit C",     0.00),
        ("Unit D",   900.00),
        ("Unit E",   775.00),
        ("Unit F",   650.00),
        ("Unit G",   600.00),
        ("Unit H",   775.00),
        ("Unit I",   775.00),
        ("Unit J",     0.00),
        ("Unit K",   850.00),
        ("Unit L",  1350.00),
        ("Unit M",     0.00),
        ("Unit N",   900.00),
    ],
    # ── NHJ LLC ─────────────────────────────────────────────────────────────
    "30d5d515-fc8d-4ec0-83e7-43d8033df5e6": [
        ("Unit A, B, C, G",  2700.00),
        ("Unit H",            800.00),
        ("Unit D",            850.00),
        ("Unit F",            850.00),
        ("Unit E",            800.00),
    ],
    # ── FJH LLC ─────────────────────────────────────────────────────────────
    "6e11743c-0741-45a1-b995-e61678677aad": [
        ("Unit A",      400.00),
        ("Unit B",     1400.00),
        ("Unit C",        0.00),
        ("Unit D",      825.00),
        ("Unit E",     1600.00),
        ("Unit F",        0.00),
        ("Unit G",      400.00),
        ("REAR unit",  2850.00),
    ],
    # ── KLI LLC ─────────────────────────────────────────────────────────────
    "69de67db-3ec9-4417-a30e-038a14a5e034": [
        ("Unit A",     800.00),
        ("Unit B",     800.00),
        ("Unit C",       0.00),
        ("Unit D",     800.00),
        ("Unit E",     800.00),
        ("Unit F",     725.00),
        ("Unit G",       0.00),
        ("Unit H",     825.00),
        ("Unit I",     900.00),
        ("Unit J",     775.00),
        ("Unit K",     800.00),
        ("Unit L",     850.00),
        ("Unit M",       0.00),
        ("Unit N",    1800.00),
        ("Unit O",    2100.00),
    ],
}

conn = psycopg2.connect(DSN)
conn.autocommit = False
cur = conn.cursor()

total = 0
for company_id, suites in COMPANY_SUITE.items():
    for suite_id, suite_name in suites.items():
        units = UNITS.get(suite_id, [])
        if not units:
            print(f"  SKIP (no units defined): {suite_name}")
            continue
        print(f"\n  {suite_name} — {len(units)} units")
        for unit_number, monthly_rent in units:
            status = "occupied" if monthly_rent > 0 else "vacant"
            cur.execute("""
                INSERT INTO r_units (id, tenant_id, property_id, company_id,
                                     unit_number, status, monthly_rent)
                VALUES (%s, %s, %s, %s, %s, %s::rental_unit_status, %s)
            """, (
                str(uuid.uuid4()),
                TENANT_ID,
                suite_id,
                company_id,
                unit_number,
                status,
                monthly_rent,
            ))
            print(f"    + {unit_number} ({status}, ${monthly_rent:,.2f})")
            total += 1

conn.commit()
print(f"\nDone — {total} units inserted.")
cur.close(); conn.close()
