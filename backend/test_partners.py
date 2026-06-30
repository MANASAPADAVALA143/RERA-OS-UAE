#!/usr/bin/env python3
import sys
sys.path.insert(0, '.')
from database import SessionLocal
from models.rentals.models import RentalOwnership

db = SessionLocal()
partners = db.query(RentalOwnership).all()
print(f"✅ Total partner records in database: {len(partners)}")
if partners:
    print("\nPartner Details:")
    for p in partners[:10]:
        print(f"  • {p.partner_name} - Company: {p.company_id} - {p.ownership_pct}% ownership - Role: {p.role}")
else:
    print("❌ NO PARTNERS FOUND - Database is empty!")
    print("\nNext steps:")
    print("1. Go to http://allinone-mis.onrender.com/rental")
    print("2. Click 'Ownership' in sidebar")
    print("3. Select 'ABC LLC' from Company dropdown")
    print("4. Click 'Import Partners' button")
    print("5. Select ABC_LLC_Partners_Sample.xlsx file")
db.close()
