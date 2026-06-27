"""Delete all r_properties (suites) and every dependent row in cascade order."""
import psycopg2

dsn = "postgresql://estatecfo_master:Anilca6789@estatecfo.c3ma0ssuch0u.us-west-1.rds.amazonaws.com:5432/estatecfo"

conn = psycopg2.connect(dsn)
conn.autocommit = False
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM r_properties")
total = cur.fetchone()[0]
print(f"Found {total} suites (r_properties rows)")

if total == 0:
    print("Nothing to delete.")
    cur.close(); conn.close(); exit(0)

cur.execute("SELECT id FROM r_properties")
prop_ids = [str(r[0]) for r in cur.fetchall()]

cur.execute("SELECT id FROM r_units WHERE property_id = ANY(%s::uuid[])", (prop_ids,))
unit_ids = [str(r[0]) for r in cur.fetchall()]
print(f"Units: {len(unit_ids)}")

if unit_ids:
    # maintenance requests reference both r_units and r_properties — delete first
    cur.execute("DELETE FROM r_maintenance_requests WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    print(f"  r_maintenance_requests: {cur.rowcount}")

    # unit inspection sub-tables
    cur.execute("SELECT id FROM r_unit_inspections WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    insp_ids = [str(r[0]) for r in cur.fetchall()]
    if insp_ids:
        cur.execute("DELETE FROM r_unit_inspection_photos WHERE inspection_id = ANY(%s::uuid[])", (insp_ids,))
        print(f"  r_unit_inspection_photos: {cur.rowcount}")
        cur.execute("DELETE FROM r_unit_inspection_checklist WHERE inspection_id = ANY(%s::uuid[])", (insp_ids,))
        print(f"  r_unit_inspection_checklist: {cur.rowcount}")
    cur.execute("DELETE FROM r_unit_inspections WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    print(f"  r_unit_inspections: {cur.rowcount}")

    # invoice chain
    cur.execute("SELECT id FROM r_invoices WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    inv_ids = [str(r[0]) for r in cur.fetchall()]
    if inv_ids:
        cur.execute("DELETE FROM r_collections WHERE invoice_id = ANY(%s::uuid[])", (inv_ids,))
        print(f"  r_collections: {cur.rowcount}")
    cur.execute("DELETE FROM r_invoices WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    print(f"  r_invoices: {cur.rowcount}")

    cur.execute("DELETE FROM r_leases WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    print(f"  r_leases: {cur.rowcount}")

    cur.execute("DELETE FROM r_tenants WHERE unit_id = ANY(%s::uuid[])", (unit_ids,))
    print(f"  r_tenants: {cur.rowcount}")

cur.execute("DELETE FROM r_expenses WHERE property_id = ANY(%s::uuid[])", (prop_ids,))
print(f"  r_expenses: {cur.rowcount}")

cur.execute("DELETE FROM r_units WHERE property_id = ANY(%s::uuid[])", (prop_ids,))
print(f"  r_units: {cur.rowcount}")

cur.execute("DELETE FROM r_properties")
print(f"  r_properties: {cur.rowcount}")

conn.commit()
print("\nAll suites deleted successfully.")
cur.close(); conn.close()
