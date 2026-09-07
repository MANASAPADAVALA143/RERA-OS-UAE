import logging
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, defer, selectinload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.lot import PropDevLot
from models.propdev.partner import PropDevPartner
from models.propdev.loan import PropDevLoan
from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.expense import PropDevExpense
from models.propdev.property_improvement import PropDevPropertyImprovement
from models.propdev.alert_action import PropDevAlertAction

router = APIRouter(prefix="/api/propdev", tags=["propdev"])
_log = logging.getLogger(__name__)


# ── Response schemas ──────────────────────────────────────────────────────────────

class LotResponse:
    def __init__(self, lot: PropDevLot):
        self.id = str(lot.id)
        self.lot_no = lot.lot_no
        self.block = lot.block
        self.size_sqft = float(lot.size_sqft)
        self.list_price = float(lot.list_price)
        self.sale_price = float(lot.sale_price) if lot.sale_price else None
        self.status = lot.status
        self.buyer_name = lot.buyer_name
        self.contract_date = lot.contract_date.isoformat() if lot.contract_date else None
        self.close_date = lot.close_date.isoformat() if lot.close_date else None

    def to_dict(self):
        return {
            'id': self.id, 'lot_no': self.lot_no, 'block': self.block,
            'size_sqft': self.size_sqft, 'list_price': self.list_price,
            'sale_price': self.sale_price, 'status': self.status,
            'buyer_name': self.buyer_name, 'contract_date': self.contract_date,
            'close_date': self.close_date,
        }


class PartnerResponse:
    def __init__(self, partner: PropDevPartner):
        self.id = str(partner.id)
        self.name = partner.name
        self.type = partner.partner_type
        self.share_percent = float(partner.share_percent)
        self.capital_contributed = float(partner.capital_contributed)
        self.capital_contributed_estimated = bool(
            getattr(partner, "capital_contributed_estimated", False)
        )
        self.distributions_received = float(partner.distributions_received)
        self.preferred_return = float(partner.preferred_return)
        self.status = partner.status
        self.entity_name = getattr(partner, "entity_name", None)
        self.property_name = getattr(partner, "property_name", None)
        self.property_address = getattr(partner, "property_address", None)
        self.entity_line = getattr(partner, "entity_line", None)
        self.cost_basis = float(partner.cost_basis) if getattr(partner, "cost_basis", None) is not None else None
        self.book_value = float(partner.book_value) if getattr(partner, "book_value", None) is not None else None
        self.fair_market_value = (
            float(partner.fair_market_value)
            if getattr(partner, "fair_market_value", None) is not None
            else None
        )
        self.existing_debt = float(partner.existing_debt) if getattr(partner, "existing_debt", None) is not None else None

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'type': self.type,
            'share_percent': self.share_percent,
            'capital_contributed': self.capital_contributed,
            'capital_contributed_estimated': self.capital_contributed_estimated,
            'distributions_received': self.distributions_received,
            'preferred_return': self.preferred_return, 'status': self.status,
            'entity_name': self.entity_name,
            'property_name': self.property_name,
            'property_address': self.property_address,
            'entity_line': self.entity_line,
            'cost_basis': self.cost_basis,
            'book_value': self.book_value,
            'fair_market_value': self.fair_market_value,
            'existing_debt': self.existing_debt,
        }


class LoanResponse:
    def __init__(self, loan: PropDevLoan):
        self.id = str(loan.id)
        self.bank = loan.bank
        self.property_name = getattr(loan, "property_name", None) or ""
        self.loan_amount = float(loan.loan_amount)
        self.balance = float(loan.balance)
        rate = float(loan.interest_rate)
        # Normalize to decimal fraction (0.076) — imports may store 7.6 or 0.076.
        self.interest_rate = rate / 100.0 if rate > 1 else rate
        self.emi = float(loan.emi)
        self.maturity_date = loan.maturity_date.isoformat() if loan.maturity_date else None
        self.emi_day = int(loan.emi_day) if loan.emi_day else 15
        self.emi_status = loan.emi_status
        self.account_no = loan.account_no or ''
        self.lender_name = loan.lender_name or ''
        self.lender_email = loan.lender_email or ''
        self.lender_phone = loan.lender_phone or ''
        self.loan_date = loan.loan_date.isoformat() if loan.loan_date else None
        self.insurance_expiry_date = (
            loan.insurance_expiry_date.isoformat() if getattr(loan, 'insurance_expiry_date', None) else None
        )
        self.refinancing_status = getattr(loan, 'refinancing_status', None) or 'Not Started'
        self.refinancing_notes = getattr(loan, 'refinancing_notes', None)
        self.loan_purpose = getattr(loan, 'loan_purpose', None)
        self.maturity_checklist = getattr(loan, 'maturity_checklist', None)

    def to_dict(self):
        return {
            'id': self.id, 'bank': self.bank, 'property_name': self.property_name,
            'loan_amount': self.loan_amount,
            'balance': self.balance, 'interest_rate': self.interest_rate,
            'emi': self.emi, 'maturity_date': self.maturity_date,
            'emi_day': self.emi_day, 'emi_status': self.emi_status,
            'account_no': self.account_no, 'lender_name': self.lender_name,
            'lender_email': self.lender_email, 'lender_phone': self.lender_phone,
            'loan_date': self.loan_date,
            'insurance_expiry_date': self.insurance_expiry_date,
            'refinancing_status': self.refinancing_status,
            'refinancing_notes': self.refinancing_notes,
            'loan_purpose': self.loan_purpose,
            'maturity_checklist': self.maturity_checklist,
        }


def _improvement_to_dict(imp: PropDevPropertyImprovement) -> dict:
    return {
        'id': str(imp.id),
        'company_id': str(imp.company_id),
        'improvement_type': imp.improvement_type,
        'improvement_cost': float(imp.improvement_cost) if imp.improvement_cost is not None else 0.0,
        'improvement_date': imp.improvement_date.isoformat() if imp.improvement_date else None,
        'contractor_name': imp.contractor_name,
        'notes': imp.notes,
    }


class CompanyResponse:
    def __init__(self, company: PropDevCompany, lots: list = None, partners: list = None,
                 loans: list = None, capital_calls: list = None, expenses: list = None,
                 property_improvements: list = None):
        self.id = str(company.id)
        self.name = company.name
        self.property_name = company.property_name
        self.address = company.address
        self.total_lots = company.total_lots
        self.total_acres = float(company.total_acres) if company.total_acres else None
        self.sale_consideration = float(company.sale_consideration)
        self.land_cost = float(company.land_cost)
        self.hard_cost = float(company.hard_cost)
        self.soft_cost = float(company.soft_cost)
        self.title_charges = float(company.title_charges)
        self.other_charges = float(company.other_charges)
        self.property_tax = float(company.property_tax)
        self.loan_processing = float(company.loan_processing)
        self.professional_charges = float(company.professional_charges)
        self.legal_fees = float(company.legal_fees)
        self.interest_on_loan = float(company.interest_on_loan)
        self.management_fee_rate = float(company.management_fee_rate)
        self.commission_rate = float(company.commission_rate)
        self.commission = float(company.commission) if company.commission else None
        self.cash_available = float(company.cash_available)
        self.interest_capitalised = float(company.interest_capitalised) if hasattr(company, 'interest_capitalised') and company.interest_capitalised else 0.0
        self.improvements = float(company.improvements) if hasattr(company, 'improvements') and company.improvements else 0.0
        self.city = getattr(company, 'city', None)
        self.state = getattr(company, 'state', None)
        self.zip_code = getattr(company, 'zip_code', None)
        self.county = getattr(company, 'county', None)
        self.legal_description = getattr(company, 'legal_description', None)
        self.land_use_type = getattr(company, 'land_use_type', None)
        self.zoning = getattr(company, 'zoning', None)
        self.current_status = getattr(company, 'current_status', None)
        self.previous_owner_name = getattr(company, 'previous_owner_name', None)
        self.previous_owner_entity = getattr(company, 'previous_owner_entity', None)
        self.acquisition_date = company.acquisition_date.isoformat() if getattr(company, 'acquisition_date', None) else None
        self.acquisition_price = float(company.acquisition_price) if getattr(company, 'acquisition_price', None) is not None else None
        self.acquisition_type = getattr(company, 'acquisition_type', None)
        self.title_company = getattr(company, 'title_company', None)
        self.deed_reference = getattr(company, 'deed_reference', None)
        self.tax_parcel_id = getattr(company, 'tax_parcel_id', None)
        self.property_tax_annual = float(company.property_tax_annual) if getattr(company, 'property_tax_annual', None) is not None else None
        self.tax_assessment_year = getattr(company, 'tax_assessment_year', None)
        self.tax_assessed_value = float(company.tax_assessed_value) if getattr(company, 'tax_assessed_value', None) is not None else None
        self.tax_exemptions = getattr(company, 'tax_exemptions', None)
        self.tax_due_date = company.tax_due_date.isoformat() if getattr(company, 'tax_due_date', None) else None
        self.yearly_pl = company.yearly_pl if hasattr(company, 'yearly_pl') else None
        self.yearly_bs = company.yearly_bs if hasattr(company, 'yearly_bs') else None
        self.yearly_cf = company.yearly_cf if hasattr(company, 'yearly_cf') else None
        self.lots = lots or []
        self.partners = partners or []
        self.loans = loans or []
        self.capital_calls = capital_calls or []
        self.expenses = expenses or []
        self.property_improvements = property_improvements or []

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'property_name': self.property_name,
            'address': self.address, 'total_lots': self.total_lots,
            'total_acres': self.total_acres, 'sale_consideration': self.sale_consideration,
            'land_cost': self.land_cost, 'hard_cost': self.hard_cost,
            'soft_cost': self.soft_cost, 'title_charges': self.title_charges,
            'other_charges': self.other_charges, 'property_tax': self.property_tax,
            'loan_processing': self.loan_processing,
            'professional_charges': self.professional_charges, 'legal_fees': self.legal_fees,
            'interest_on_loan': self.interest_on_loan,
            'management_fee_rate': self.management_fee_rate,
            'commission_rate': self.commission_rate, 'commission': self.commission,
            'cash_available': self.cash_available,
            'interest_capitalised': self.interest_capitalised,
            'improvements': self.improvements,
            'city': self.city, 'state': self.state, 'zip_code': self.zip_code,
            'county': self.county, 'legal_description': self.legal_description,
            'land_use_type': self.land_use_type, 'zoning': self.zoning,
            'current_status': self.current_status,
            'previous_owner_name': self.previous_owner_name,
            'previous_owner_entity': self.previous_owner_entity,
            'acquisition_date': self.acquisition_date,
            'acquisition_price': self.acquisition_price,
            'acquisition_type': self.acquisition_type,
            'title_company': self.title_company,
            'deed_reference': self.deed_reference,
            'tax_parcel_id': self.tax_parcel_id,
            'property_tax_annual': self.property_tax_annual,
            'tax_assessment_year': self.tax_assessment_year,
            'tax_assessed_value': self.tax_assessed_value,
            'tax_exemptions': self.tax_exemptions,
            'tax_due_date': self.tax_due_date,
            'yearly_pl': self.yearly_pl,
            'yearly_bs': self.yearly_bs,
            'yearly_cf': self.yearly_cf,
            'lots': self.lots, 'partners': self.partners,
            'loans': self.loans, 'capital_calls': self.capital_calls,
            'expenses': self.expenses,
            'property_improvements': self.property_improvements,
        }


# ── Endpoints ──────────────────────────────────────────────────────────────────────

def _query_companies_eager(db: Session, tenant_id: uuid.UUID, *, include_financials: bool = True):
    """Single round-trip per relation — avoids N+1 lazy loads on list_companies."""
    opts = [
        selectinload(PropDevCompany.lots),
        selectinload(PropDevCompany.partners),
        selectinload(PropDevCompany.loans),
        selectinload(PropDevCompany.capital_calls).selectinload(PropDevCapitalCall.partner),
        selectinload(PropDevCompany.expenses),
        selectinload(PropDevCompany.property_improvements),
    ]
    if not include_financials:
        opts.extend([
            defer(PropDevCompany.yearly_pl),
            defer(PropDevCompany.yearly_bs),
            defer(PropDevCompany.yearly_cf),
        ])
    return (
        db.query(PropDevCompany)
        .filter(PropDevCompany.tenant_id == tenant_id)
        .options(*opts)
    )


def _serialize_company(company: PropDevCompany, *, include_financials: bool = True) -> dict:
    lots = [LotResponse(lot).to_dict() for lot in company.lots]
    partners = [PartnerResponse(p).to_dict() for p in company.partners]
    loans = [LoanResponse(ln).to_dict() for ln in company.loans]

    capital_calls = []
    for cc in company.capital_calls:
        capital_calls.append({
            'id': str(cc.id),
            'partner_id': str(cc.partner_id),
            'partner_name': cc.partner.name if cc.partner else '',
            'period': cc.period,
            'share_percent': float(cc.share_percent),
            'total_call_amount': float(cc.total_call_amount),
            'partner_share': float(cc.partner_share),
            'old_dues': float(cc.old_dues),
            'total_due': float(cc.total_due),
            'amount_received': float(cc.amount_received),
            'received_date': cc.received_date.isoformat() if cc.received_date else None,
            'due_date': cc.due_date.isoformat() if cc.due_date else None,
            'status': cc.status,
            'source_type': cc.source_type,
            'source_id': str(cc.source_id) if cc.source_id else None,
            'reason': cc.reason,
        })

    expenses = []
    for exp in company.expenses:
        expenses.append({
            'id': str(exp.id),
            'expense_type': exp.expense_type,
            'category': exp.category,
            'vendor': exp.vendor,
            'amount': float(exp.amount),
            'status': exp.status,
        })

    property_improvements = [_improvement_to_dict(imp) for imp in company.property_improvements]

    payload = CompanyResponse(
        company, lots, partners, loans, capital_calls, expenses, property_improvements,
    ).to_dict()
    if not include_financials:
        payload.pop("yearly_pl", None)
        payload.pop("yearly_bs", None)
        payload.pop("yearly_cf", None)
    return payload


@router.get("/companies")
def list_companies(
    include_financials: bool = Query(
        False,
        description="Include yearly_pl/bs/cf JSON (large). Default false for fast list loads.",
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.perf_counter()
    companies = _query_companies_eager(
        db, current_user.tenant_id, include_financials=include_financials,
    ).all()
    result = [
        _serialize_company(company, include_financials=include_financials)
        for company in companies
    ]
    elapsed = time.perf_counter() - t0
    _log.info(
        "list_companies tenant=%s companies=%d financials=%s elapsed=%.3fs",
        current_user.tenant_id, len(companies), include_financials, elapsed,
    )
    return {'companies': result}


@router.get("/companies/{company_id}/yearly")
def get_company_yearly(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Yearly P&L / BS / CF only — avoids loading multi-MB JSON on the list endpoint."""
    cid = uuid.UUID(company_id)
    row = (
        db.query(
            PropDevCompany.id,
            PropDevCompany.yearly_pl,
            PropDevCompany.yearly_bs,
            PropDevCompany.yearly_cf,
        )
        .filter(
            PropDevCompany.id == cid,
            PropDevCompany.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    return {
        "id": str(row.id),
        "yearly_pl": row.yearly_pl,
        "yearly_bs": row.yearly_bs,
        "yearly_cf": row.yearly_cf,
    }


class CreateCompanyRequest(BaseModel):
    name: str
    property_name: str = ''


@router.post("/companies")
def create_company(
    req: CreateCompanyRequest,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    existing = db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == current_user.tenant_id,
        PropDevCompany.name == req.name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Company '{req.name}' already exists")

    company = PropDevCompany(
        tenant_id=current_user.tenant_id,
        name=req.name,
        property_name=req.property_name,
        address='',
        total_lots=0,
        sale_consideration=0,
        land_cost=0, hard_cost=0, soft_cost=0,
        title_charges=0, other_charges=0, property_tax=0,
        loan_processing=0, professional_charges=0, legal_fees=0,
        interest_on_loan=0, cash_available=0,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return {'id': str(company.id), 'name': company.name, 'property_name': company.property_name}


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == cid,
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
    return {'status': 'deleted'}


@router.patch("/companies/{company_id}/status")
def toggle_company_status(
    company_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == cid,
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    company.status = body.get("status", "active")
    db.commit()
    return {'id': str(company.id), 'status': company.status}


@router.put("/companies/{company_id}")
def update_company(
    company_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == cid,
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    numeric_fields = (
        "sale_consideration", "land_cost", "hard_cost", "soft_cost", "title_charges",
        "other_charges", "property_tax", "loan_processing", "professional_charges",
        "legal_fees", "interest_on_loan", "cash_available", "interest_capitalised",
        "improvements", "commission", "total_acres",
        "acquisition_price", "property_tax_annual", "tax_assessed_value",
    )
    text_fields = (
        "name", "property_name", "address", "status",
        "city", "state", "zip_code", "county", "legal_description",
        "land_use_type", "zoning", "current_status",
        "previous_owner_name", "previous_owner_entity", "acquisition_type",
        "title_company", "deed_reference", "tax_parcel_id", "tax_exemptions",
    )
    date_fields = ("acquisition_date", "tax_due_date")
    for key in text_fields:
        if key in body:
            setattr(company, key, body[key])
    if "total_lots" in body:
        company.total_lots = int(body["total_lots"] or 0)
    if "tax_assessment_year" in body:
        company.tax_assessment_year = int(body["tax_assessment_year"]) if body["tax_assessment_year"] is not None else None
    for key in numeric_fields:
        if key in body and body[key] is not None:
            setattr(company, key, float(body[key]))
    for key in date_fields:
        if key in body:
            raw = body[key]
            setattr(company, key, datetime.fromisoformat(raw).date() if raw else None)
    if "management_fee_rate" in body and body["management_fee_rate"] is not None:
        company.management_fee_rate = float(body["management_fee_rate"])
    if "commission_rate" in body and body["commission_rate"] is not None:
        company.commission_rate = float(body["commission_rate"])
    db.commit()
    db.refresh(company)
    return {'id': str(company.id), 'name': company.name, 'property_name': company.property_name}


@router.get("/companies/count")
def count_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.query(PropDevCompany).filter(PropDevCompany.tenant_id == current_user.tenant_id).count()
    return {"count": n}


@router.get("/companies/{company_id}")
def get_company(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = _query_companies_eager(
        db, current_user.tenant_id, include_financials=True,
    ).filter(
        PropDevCompany.id == cid,
    ).first()

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    return _serialize_company(company, include_financials=True)


# ── Property improvements ─────────────────────────────────────────────────────────

@router.get("/companies/{company_id}/improvements")
def list_improvements(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    rows = (
        db.query(PropDevPropertyImprovement)
        .filter(
            PropDevPropertyImprovement.company_id == cid,
            PropDevPropertyImprovement.tenant_id == current_user.tenant_id,
        )
        .order_by(PropDevPropertyImprovement.improvement_date.desc().nullslast())
        .all()
    )
    return {"improvements": [_improvement_to_dict(r) for r in rows]}


@router.post("/companies/{company_id}/improvements")
def create_improvement(
    company_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == cid,
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if not body.get("improvement_type"):
        raise HTTPException(status_code=400, detail="improvement_type is required")

    imp = PropDevPropertyImprovement(
        tenant_id=current_user.tenant_id,
        company_id=cid,
        improvement_type=body["improvement_type"],
        improvement_cost=float(body["improvement_cost"]) if body.get("improvement_cost") is not None else 0,
        improvement_date=(
            datetime.fromisoformat(body["improvement_date"]).date() if body.get("improvement_date") else None
        ),
        contractor_name=body.get("contractor_name"),
        notes=body.get("notes"),
    )
    db.add(imp)
    db.commit()
    db.refresh(imp)
    return _improvement_to_dict(imp)


@router.put("/improvements/{improvement_id}")
def update_improvement(
    improvement_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    iid = uuid.UUID(improvement_id)
    imp = db.query(PropDevPropertyImprovement).filter(
        PropDevPropertyImprovement.id == iid,
        PropDevPropertyImprovement.tenant_id == current_user.tenant_id,
    ).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Improvement not found")
    if "improvement_type" in body and body["improvement_type"]:
        imp.improvement_type = body["improvement_type"]
    if "improvement_cost" in body and body["improvement_cost"] is not None:
        imp.improvement_cost = float(body["improvement_cost"])
    if "improvement_date" in body:
        raw = body["improvement_date"]
        imp.improvement_date = datetime.fromisoformat(raw).date() if raw else None
    if "contractor_name" in body:
        imp.contractor_name = body["contractor_name"]
    if "notes" in body:
        imp.notes = body["notes"]
    db.commit()
    db.refresh(imp)
    return _improvement_to_dict(imp)


@router.delete("/improvements/{improvement_id}")
def delete_improvement(
    improvement_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    iid = uuid.UUID(improvement_id)
    imp = db.query(PropDevPropertyImprovement).filter(
        PropDevPropertyImprovement.id == iid,
        PropDevPropertyImprovement.tenant_id == current_user.tenant_id,
    ).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Improvement not found")
    db.delete(imp)
    db.commit()


# ── Executive Summary Action Plan ──────────────────────────────────────────

@router.get("/actions/done")
def list_done_actions(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Distinct action_ids already marked done, so completed cards stay dismissed after reload."""
    rows = db.query(PropDevAlertAction).filter(
        PropDevAlertAction.tenant_id == current_user.tenant_id,
    ).all()
    return sorted({r.action_id for r in rows})


@router.post("/actions/{action_id}/done")
def mark_action_done(
    action_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    action = PropDevAlertAction(
        tenant_id=current_user.tenant_id,
        action_id=action_id,
        action_type=body.get("action_type"),
        entity_id=body.get("entity_id"),
        note=body.get("note"),
    )
    db.add(action)
    db.commit()
    return {"success": True, "timestamp": action.created_at.isoformat() if action.created_at else datetime.utcnow().isoformat()}
    return {"status": "deleted"}
