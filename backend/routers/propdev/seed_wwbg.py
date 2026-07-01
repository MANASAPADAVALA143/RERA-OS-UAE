"""
One-time seeding endpoint for WWBG land-dev company.
POST /api/propdev/seed-wwbg   (requires write access)

All data is parsed from the 4 Excel files offline and embedded here.
Run once after deploy — idempotent (upserts, not duplicates).
"""
import uuid
import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.loan import PropDevLoan
from models.propdev.partner import PropDevPartner
router = APIRouter(prefix="/api/propdev", tags=["propdev"])


# ── Parsed data ────────────────────────────────────────────────────────────────

YEARS = ["2021", "2022", "2023", "2024", "2025", "2026"]

YEARLY_BS = {
    "2021": {"cash": 133299.90, "land": 3338438.40, "improvements": 0.0,      "interest_capitalised": 0.0,      "total_assets": 3512238.30, "loan_balance": 2307784.36, "total_liabilities": 2307784.36},
    "2022": {"cash":  46309.00, "land": 3338438.40, "improvements": 227311.84, "interest_capitalised": 0.0,      "total_assets": 3652559.24, "loan_balance": 2245648.64, "total_liabilities": 2365185.62},
    "2023": {"cash":  89852.30, "land": 3338438.40, "improvements": 434302.24, "interest_capitalised": 0.0,      "total_assets": 3903092.94, "loan_balance": 2187418.83, "total_liabilities": 2326073.56},
    "2024": {"cash":  30370.29, "land": 3338438.40, "improvements": 330799.34, "interest_capitalised": 94541.26,  "total_assets": 3833495.36, "loan_balance": 1949067.38, "total_liabilities": 1949067.38},
    "2025": {"cash":   3166.95, "land": 3338438.40, "improvements": 389072.24, "interest_capitalised": 165225.36, "total_assets": 3935249.02, "loan_balance": 1843297.78, "total_liabilities": 1844797.78},
    "2026": {"cash":  18558.90, "land": 3338438.40, "improvements": 389072.24, "interest_capitalised": 165225.36, "total_assets": 3950640.97, "loan_balance": 1787411.59, "total_liabilities": 1788911.59},
}

YEARLY_PL = {
    "2021": {"net_income": -247886.34, "total_expenses": 247886.34, "revenue": 0.0, "other_income": 0.0},
    "2022": {"net_income":   -1080.32, "total_expenses":   1080.32, "revenue": 0.0, "other_income": 0.0},
    "2023": {"net_income":       0.00, "total_expenses":      0.00, "revenue": 0.0, "other_income": 0.0},
    "2024": {"net_income":   79583.83, "total_expenses":   5416.17, "revenue": 0.0, "other_income": 85000.0},
    "2025": {"net_income":   -3976.44, "total_expenses":   3976.44, "revenue": 0.0, "other_income": 0.0},
    "2026": {"net_income":  -60446.91, "total_expenses":  60446.91, "revenue": 0.0, "other_income": 0.0},
}

YEARLY_CF = {
    "2021": {"operating": -247886.34, "investing": -3378938.40, "financing": 3760124.64, "net_change": 133299.90, "partner_investments": 1001669.94},
    "2022": {"operating":  118456.66, "investing":  -227311.84, "financing":   21864.28,  "net_change": -86990.90, "partner_investments": 84323.68},
    "2023": {"operating":   19117.75, "investing":  -206990.40, "financing":  231415.95,  "net_change":  43543.30, "partner_investments": 290707.31},
    "2024": {"operating":  -59070.90, "investing":    10115.57, "financing":  -10526.68,  "net_change": -59482.01, "partner_investments": 228972.27},
    "2025": {"operating":   -2476.44, "investing":  -128957.00, "financing":  104230.10,  "net_change": -27203.34, "partner_investments": 204244.98},
    "2026": {"operating":  -60446.91, "investing":        0.00, "financing":   75838.86,  "net_change":  15391.95, "partner_investments": 90819.03},
}

PARTNERS = [
    {"name": "B P",          "capital": 112502.59},
    {"name": "CSP",          "capital":  41039.12},
    {"name": "EV",           "capital": 211713.00},
    {"name": "HC",           "capital": 119440.47},
    {"name": "KV",           "capital": 102576.44},
    {"name": "MC @ CA",      "capital": 104576.14},
    {"name": "R M",          "capital":   2971.50},
    {"name": "N B",          "capital": 109474.44},
    {"name": "R Family Ltd", "capital": 238660.23},
    {"name": "RVDR",         "capital": 119494.79},
    {"name": "RSS",          "capital": 225535.81},
    {"name": "S PSIR",       "capital": 225592.16},
    {"name": "SV",           "capital": 109474.14},
    {"name": "SCIP",         "capital": 119399.47},
    {"name": "VM",           "capital": 109474.00},
    {"name": "VRE",          "capital": 230717.48},
    {"name": "Y B",          "capital":  41035.12},
]

LOAN = {
    "bank":          "Greater Plains Bank",
    "account_no":    "8358885226",
    "loan_amount":   2336000.00,
    "balance":       1787411.59,
    "interest_rate": 0.0425,
    "emi":           17645.37,
    "loan_date":     datetime.date(2021, 9, 30),
    "maturity_date": datetime.date(2036, 9, 30),
    "emi_day":       10,
}


@router.post("/seed-wwbg")
def seed_wwbg(
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Idempotent: upserts WWBG land-dev company from pre-parsed Excel data."""

    # ── 1. Add new columns if missing (PostgreSQL IF NOT EXISTS) ──────────────
    ddls = [
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS interest_capitalised NUMERIC(16,2) DEFAULT 0 NOT NULL",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS improvements NUMERIC(16,2) DEFAULT 0 NOT NULL",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_pl JSONB",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_bs JSONB",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_cf JSONB",
    ]
    for ddl in ddls:
        try:
            db.execute(text(ddl))
            db.commit()
        except Exception:
            db.rollback()

    # ── 2. Upsert company ─────────────────────────────────────────────────────
    company = db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == current_user.tenant_id,
        PropDevCompany.name.ilike('%WWBG%'),
    ).first()

    fields = dict(
        property_name        = "WWBL",
        address              = "",
        total_lots           = 1,
        sale_consideration   = 0.0,
        land_cost            = 3338438.40,
        hard_cost            = 389072.24,
        soft_cost            = 0.0,
        title_charges        = 0.0,
        other_charges        = 200306.00,
        property_tax         = 6230.70,
        loan_processing      = 3051.10,
        professional_charges = 11235.00,
        legal_fees           = 0.0,
        interest_on_loan     = 57061.13,
        cash_available       = 18558.90,
        interest_capitalised = 165225.36,
        improvements         = 389072.24,
        yearly_pl            = YEARLY_PL,
        yearly_bs            = YEARLY_BS,
        yearly_cf            = YEARLY_CF,
    )

    if company:
        for k, v in fields.items():
            setattr(company, k, v)
    else:
        company = PropDevCompany(
            tenant_id=current_user.tenant_id,
            name="WWBG",
            **fields,
        )
        db.add(company)

    db.flush()
    cid = company.id

    # ── 3. Clear + re-add loan ────────────────────────────────────────────────
    for ln in company.loans:
        db.delete(ln)
    db.flush()

    db.add(PropDevLoan(
        tenant_id    = current_user.tenant_id,
        company_id   = cid,
        bank         = LOAN["bank"],
        account_no   = LOAN["account_no"],
        loan_amount  = LOAN["loan_amount"],
        balance      = LOAN["balance"],
        interest_rate= LOAN["interest_rate"],
        emi          = LOAN["emi"],
        loan_date    = LOAN["loan_date"],
        maturity_date= LOAN["maturity_date"],
        emi_day      = LOAN["emi_day"],
        lender_name  = LOAN["bank"],
        emi_status   = "Current",
    ))

    # ── 4. Clear + re-add partners ────────────────────────────────────────────
    for p in company.partners:
        db.delete(p)
    db.flush()

    total_cap = sum(p["capital"] for p in PARTNERS if p["capital"] > 0) or 1.0
    for p in PARTNERS:
        cap = p["capital"]
        if cap <= 0:
            continue
        db.add(PropDevPartner(
            tenant_id            = current_user.tenant_id,
            company_id           = cid,
            name                 = p["name"],
            partner_type         = "Class A",
            share_percent        = round(cap / total_cap * 100, 4),
            capital_contributed  = cap,
            distributions_received = 0.0,
            preferred_return     = 8.0,
            status               = "Active",
        ))

    db.commit()

    total_invested = 3338438.40 + 389072.24 + 165225.36
    return {
        "status":           "seeded",
        "company":          "WWBG",
        "property":         "WWBL",
        "land_cost":        3338438.40,
        "improvements":     389072.24,
        "interest_capitalised": 165225.36,
        "total_invested":   total_invested,
        "loan_balance":     LOAN["balance"],
        "ltv_pct":          round(LOAN["balance"] / 3338438.40 * 100, 1),
        "cash":             18558.90,
        "partners_added":   len(PARTNERS),
    }
