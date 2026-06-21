"""
Seed demo data for a specific tenant. Requires explicit --tenant-id argument.

Usage:
  cd backend
  python scripts/seed_demo_tenant.py --tenant-id <uuid>
"""
import argparse
import random
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models.real_estate.construction_cost import CostTrade, TradeName
from models.real_estate.entity import BusinessLine, Entity, EntityType, Project, ProjectStatus, ProjectType
from models.real_estate.financing import DebtDrawdown, FacilityType, FinancingFacility, RateType
from models.real_estate.permitting import Permit, PermitStatus, PermitType
from models.real_estate.pipeline import LandParcel, LandParcelStatus, MarketComp
from models.real_estate.reit_rental import AssetClass, GreenCertification, Lease, PropertyType, ReitAsset, RentalProperty
from models.real_estate.risk import ClaimStatus, ClaimType, LitigationClaim, TaxEvent, TaxEventStatus, TaxEventType, VendorContractor, VendorType, re_vendor_project_link
from models.real_estate.unit import BuyerFinancingType, Unit, UnitStatus, UnitType
from models.tenancy import Tenant

TRADES = list(TradeName)
PERMIT_TYPES = list(PermitType)
PERMIT_STATUSES = list(PermitStatus)
US_AUTHORITIES = [
    "City of Austin Development Services",
    "Travis County Engineering",
    "Texas Commission on Environmental Quality",
    "Austin Fire Department",
    "City of Dallas Building Inspection",
]


def require_tenant(db, tenant_id: uuid.UUID) -> Tenant:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        print(f"ERROR: Tenant {tenant_id} not found. Register a tenant first via the UI.")
        sys.exit(1)
    return tenant


def seed(tenant_id: uuid.UUID, skip_if_seeded: bool = False):
    db = SessionLocal()
    try:
        from models.real_estate.entity import Project

        if skip_if_seeded and db.query(Project).filter(Project.tenant_id == tenant_id).first():
            return

        tenant = require_tenant(db, tenant_id)
        print(f"Seeding tenant: {tenant.company_name} ({tenant_id})")

        holding = Entity(
            tenant_id=tenant_id, entity_name="Summit Holdings LLC", entity_type=EntityType.Parent,
            business_line=BusinessLine.holding, formation_state="DE", is_active=True,
        )
        db.add(holding)
        db.flush()

        entities = []
        for name, bl, et in [
            ("Summit Construction TX LLC", BusinessLine.construction, EntityType.LLC),
            ("Summit Development Austin LLC", BusinessLine.development, EntityType.LLC),
            ("Summit REIT Trust", BusinessLine.reit, EntityType.REIT_Trust),
        ]:
            e = Entity(
                tenant_id=tenant_id, entity_name=name, entity_type=et, business_line=bl,
                parent_entity_id=holding.id, formation_state="TX", is_active=True,
            )
            db.add(e)
            entities.append(e)
        db.flush()

        proj1 = Project(
            tenant_id=tenant_id, entity_id=entities[1].id, project_name="Eastside Lofts",
            project_type=ProjectType.mixed_use, address="1200 E 6th St", city="Austin", state="TX",
            zip_code="78702", county="Travis", total_units=48, total_saleable_sqft=62000,
            status=ProjectStatus.under_construction, start_date=date(2024, 3, 1),
            target_completion_date=date(2026, 6, 30), flood_zone=False, wildfire_risk_zone=False,
            insurance_coverage_amount=2500000, insurance_renewal_date=date.today() + timedelta(days=45),
        )
        proj2 = Project(
            tenant_id=tenant_id, entity_id=entities[1].id, project_name="Riverfront Residences",
            project_type=ProjectType.residential_for_sale, address="450 River Rd", city="Dallas", state="TX",
            zip_code="75207", county="Dallas", total_units=32, total_saleable_sqft=48000,
            status=ProjectStatus.selling, start_date=date(2023, 1, 15),
            actual_completion_date=date(2025, 11, 1), flood_zone=True,
            insurance_coverage_amount=1800000, insurance_renewal_date=date.today() + timedelta(days=120),
        )
        db.add_all([proj1, proj2])
        db.flush()

        for project in [proj1, proj2]:
            for i, pt in enumerate(random.sample(PERMIT_TYPES, min(10, len(PERMIT_TYPES)))):
                status = random.choice(PERMIT_STATUSES)
                app_date = date.today() - timedelta(days=random.randint(10, 90))
                db.add(Permit(
                    tenant_id=tenant_id, project_id=project.id, permit_type=pt,
                    issuing_authority=random.choice(US_AUTHORITIES),
                    budgeted_cost=random.randint(5000, 75000), actual_cost=random.randint(3000, 80000),
                    status=status, is_blocking=status not in (PermitStatus.approved, PermitStatus.not_started),
                    application_date=app_date if status != PermitStatus.not_started else None,
                    target_approval_date=app_date + timedelta(days=45) if app_date else None,
                    actual_approval_date=date.today() - timedelta(days=5) if status == PermitStatus.approved else None,
                ))

        for project in [proj1, proj2]:
            for trade in TRADES:
                budget = random.randint(100000, 800000)
                actual = budget * random.uniform(0.7, 1.15)
                committed = budget * random.uniform(0.05, 0.2)
                db.add(CostTrade(
                    tenant_id=tenant_id, project_id=project.id, trade_name=trade,
                    budgeted_cost=budget, actual_cost_to_date=actual, committed_cost=committed,
                    pct_complete=random.uniform(0.3, 0.95), prior_period_actual_cost=actual * 0.85,
                    comparable_project_id=proj2.id if project.id == proj1.id else proj1.id,
                    comparable_project_actual_cost=actual * random.uniform(0.9, 1.1),
                    last_updated_date=date.today(),
                ))

        unit_types = list(UnitType)[:7]
        for project in [proj1, proj2]:
            for i in range(18):
                status = random.choice(list(UnitStatus))
                sqft = random.randint(650, 2200)
                land = sqft * 85
                construction = sqft * 210
                soft = sqft * 35
                list_price = land + construction + soft + random.randint(20000, 80000)
                db.add(Unit(
                    tenant_id=tenant_id, project_id=project.id,
                    unit_number=f"Bldg {(i // 6) + 1} - Unit {100 + i}",
                    unit_type=random.choice(unit_types), floor_number=(i // 6) + 1, sqft=sqft,
                    allocated_land_cost=land, allocated_construction_cost=construction, allocated_soft_cost=soft,
                    list_price=list_price,
                    achieved_sale_price=list_price * random.uniform(0.95, 1.05) if status == UnitStatus.closed else None,
                    status=status, days_on_market=random.randint(5, 120) if status == UnitStatus.available else None,
                    buyer_financing_type=BuyerFinancingType.conventional_mortgage if status == UnitStatus.closed else None,
                ))

        fac1 = FinancingFacility(
            tenant_id=tenant_id, entity_id=entities[0].id, project_id=proj1.id,
            facility_type=FacilityType.construction_loan, lender_or_investor_name="First National Bank of Texas",
            committed_amount=28500000, drawn_amount=18200000, undrawn_available=10300000,
            interest_rate_annual=7.75, rate_type=RateType.floating,
            origination_date=date(2024, 2, 15), maturity_date=date(2026, 2, 15),
            ltv_covenant_pct=65, dscr_covenant_min=1.25, ltv_current_pct=58, dscr_current=1.42,
            moratorium_end_date=date(2025, 8, 15),
        )
        fac2 = FinancingFacility(
            tenant_id=tenant_id, entity_id=entities[0].id, project_id=proj2.id,
            facility_type=FacilityType.construction_loan, lender_or_investor_name="Texas Capital Bank",
            committed_amount=15200000, drawn_amount=14100000, undrawn_available=1100000,
            interest_rate_annual=7.50, rate_type=RateType.floating,
            origination_date=date(2023, 1, 1), maturity_date=date(2026, 3, 1),
            ltv_covenant_pct=65, ltv_current_pct=62, dscr_current=1.18, dscr_covenant_min=1.20,
        )
        db.add_all([fac1, fac2])
        db.flush()

        cumulative = 0
        for i, amt in enumerate([5000000, 4200000, 3800000, 5200000]):
            cumulative += amt
            db.add(DebtDrawdown(
                tenant_id=tenant_id, facility_id=fac1.id,
                draw_date=date(2024, 4, 1) + timedelta(days=90 * i),
                draw_amount=amt, purpose=f"Construction draw #{i+1}",
                cumulative_drawn_after=cumulative,
            ))

        reit_data = [
            ("Summit Office Tower", AssetClass.office, "Austin", 42000000, 0.92, 5.2),
            ("Lakeline Retail Center", AssetClass.retail, "Cedar Park", 18500000, 0.88, 4.8),
            ("DFW Industrial Park", AssetClass.industrial, "Irving", 31000000, 0.95, 6.1),
        ]
        reit_assets = []
        for name, ac, city, cost, occ, cap in reit_data:
            sqft = random.randint(80000, 200000)
            a = ReitAsset(
                tenant_id=tenant_id, entity_id=entities[2].id, asset_name=name,
                city=city, state="TX", asset_class=ac, acquisition_date=date(2021, 6, 1),
                acquisition_cost=cost, current_book_value=cost * 0.95, current_market_value=cost * 1.05,
                total_rentable_sqft=sqft, occupied_sqft=int(sqft * occ),
                annual_rental_income=cost * cap / 100, annual_operating_expenses=cost * 0.025,
                ltv_pct=55, cap_rate=cap, wale_years=random.uniform(3, 8),
                green_certification=GreenCertification.leed_gold,
                insurance_coverage_amount=cost * 0.8, insurance_renewal_date=date.today() + timedelta(days=20),
            )
            db.add(a)
            reit_assets.append(a)
        db.flush()

        for asset in reit_assets:
            for tn, rent in [("Acme Corp", 450000), ("TechStart Inc", 280000), ("Regional Bank", 195000)]:
                db.add(Lease(
                    tenant_id=tenant_id, reit_asset_id=asset.id, tenant_name=tn,
                    leased_sqft=random.randint(5000, 15000), annual_rent=rent,
                    lease_start_date=date(2022, 1, 1), lease_end_date=date(2027, 12, 31),
                    escalation_pct_annual=0.03, tenant_industry=random.choice(["Technology", "Finance", "Retail"]),
                ))

        for name, ptype, units in [("Mueller Flats", PropertyType.multifamily, 24), ("Oak Hill Duplexes", PropertyType.single_family, 8)]:
            occ = random.randint(int(units * 0.8), units)
            billed = units * random.randint(1400, 2200)
            db.add(RentalProperty(
                tenant_id=tenant_id, entity_id=entities[2].id, property_name=name,
                city="Austin", state="TX", property_type=ptype, total_units=units, occupied_units=occ,
                monthly_rent_billed=billed, monthly_rent_collected=billed * random.uniform(0.88, 0.98),
                monthly_maintenance_cost=random.randint(3000, 8000),
                avg_dso_days=random.uniform(15, 55),
            ))

        for name, status in [("Bastrop East Parcel", LandParcelStatus.due_diligence), ("Round Rock North", LandParcelStatus.under_contract)]:
            db.add(LandParcel(
                tenant_id=tenant_id, entity_id=entities[1].id, parcel_name=name,
                city="Bastrop" if "Bastrop" in name else "Round Rock", state="TX",
                acres=random.uniform(8, 25), status=status,
                projected_acquisition_cost=random.randint(2000000, 8000000),
                projected_units_or_sqft=random.randint(80, 200) * 1000,
                projected_project_irr=random.uniform(0.12, 0.22),
                target_close_date=date.today() + timedelta(days=random.randint(30, 120)),
            ))

        for area, comp in [
            ("Austin, TX - East Side", "Compass East Village"),
            ("Austin, TX - East Side", "Sixth Street Lofts"),
            ("Dallas, TX - Design District", "Design District Residences"),
        ]:
            db.add(MarketComp(
                tenant_id=tenant_id, market_area=area, comp_name=comp,
                comp_price_per_sqft=random.uniform(380, 520),
                comp_absorption_units_per_month=random.uniform(2, 8),
                prevailing_mortgage_rate_pct=0.0675, prevailing_cap_rate_pct=0.055,
                data_as_of_date=date.today(), source_note="Manual entry — broker report Q1 2026",
            ))

        vendor = VendorContractor(
            tenant_id=tenant_id, vendor_name="Lone Star General Contractors",
            vendor_type=VendorType.general_contractor,
        )
        db.add(vendor)
        db.flush()
        db.execute(re_vendor_project_link.insert(), [
            {"vendor_id": vendor.id, "project_id": proj1.id, "tenant_id": tenant_id},
            {"vendor_id": vendor.id, "project_id": proj2.id, "tenant_id": tenant_id},
        ])

        db.add(LitigationClaim(
            tenant_id=tenant_id, entity_id=entities[0].id, project_id=proj1.id,
            claim_description="Water intrusion defect claim — Building B units 201-205",
            claim_type=ClaimType.construction_defect, claimant_name="HOA Representative",
            filed_date=date(2025, 9, 15), exposure_amount=850000, probability_weighted_reserve=340000,
            status=ClaimStatus.in_litigation,
        ))

        db.add(TaxEvent(
            tenant_id=tenant_id, entity_id=entities[2].id,
            event_type=TaxEventType.exchange_1031_deadline_45day,
            related_reit_asset_id=reit_assets[0].id, event_date=date.today(),
            deadline_date=date.today() + timedelta(days=35), status=TaxEventStatus.pending,
            notes="1031 exchange identification deadline for Lakeline disposition",
        ))

        db.commit()

        try:
            from scripts.seed_scottsdale_project import seed_scottsdale
            seed_scottsdale(tenant_id, replace=False)
        except Exception as exc:
            print(f"Note: Scottsdale project seed skipped: {exc}")

        try:
            from scripts.seed_reit_property import seed_property as seed_reit, load_data
            data = load_data()
            seed_reit(db, tenant_id, data, replace=False)
            print("RP001 Desert Vista Townhomes seeded.")
        except Exception as exc:
            print(f"Note: REIT RP001 seed skipped: {exc}")

        tables = [
            "entities", "projects", "permits", "cost_trades", "units",
            "financing_facilities", "debt_drawdowns", "reit_assets", "leases",
            "rental_properties", "land_parcels", "market_comps", "vendor_contractors",
            "litigation_claims", "tax_events", "change_orders", "schedule_tasks",
            "compliance_docs", "project_financial_snapshots", "project_roi_assumptions",
        ]
        print("\nRow counts:")
        from sqlalchemy import text
        for t in tables:
            count = db.execute(text(f"SELECT COUNT(*) FROM {t} WHERE tenant_id = :tid"), {"tid": str(tenant_id)}).scalar()
            print(f"  {t}: {count}")
        print("\nSeed complete.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed demo data for EstateCFO tenant")
    parser.add_argument("--tenant-id", required=True, help="UUID of tenant to seed (required)")
    args = parser.parse_args()
    try:
        tid = uuid.UUID(args.tenant_id)
    except ValueError:
        print("ERROR: --tenant-id must be a valid UUID")
        sys.exit(1)
    seed(tid)
