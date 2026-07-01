import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.lot import PropDevLot
from models.propdev.partner import PropDevPartner
from models.propdev.loan import PropDevLoan
from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.expense import PropDevExpense

router = APIRouter(prefix="/api/propdev", tags=["propdev"])


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
        self.distributions_received = float(partner.distributions_received)
        self.preferred_return = float(partner.preferred_return)
        self.status = partner.status

    def to_dict(self):
        return {
            'id': self.id, 'name': self.name, 'type': self.type,
            'share_percent': self.share_percent,
            'capital_contributed': self.capital_contributed,
            'distributions_received': self.distributions_received,
            'preferred_return': self.preferred_return, 'status': self.status,
        }


class LoanResponse:
    def __init__(self, loan: PropDevLoan):
        self.id = str(loan.id)
        self.bank = loan.bank
        self.loan_amount = float(loan.loan_amount)
        self.balance = float(loan.balance)
        self.interest_rate = float(loan.interest_rate)
        self.emi = float(loan.emi)
        self.maturity_date = loan.maturity_date.isoformat() if loan.maturity_date else None
        self.emi_day = int(loan.emi_day) if loan.emi_day else 15
        self.emi_status = loan.emi_status
        self.account_no = loan.account_no or ''
        self.lender_name = loan.lender_name or ''
        self.lender_email = loan.lender_email or ''
        self.lender_phone = loan.lender_phone or ''
        self.loan_date = loan.loan_date.isoformat() if loan.loan_date else None

    def to_dict(self):
        return {
            'id': self.id, 'bank': self.bank, 'loan_amount': self.loan_amount,
            'balance': self.balance, 'interest_rate': self.interest_rate,
            'emi': self.emi, 'maturity_date': self.maturity_date,
            'emi_day': self.emi_day, 'emi_status': self.emi_status,
            'account_no': self.account_no, 'lender_name': self.lender_name,
            'lender_email': self.lender_email, 'lender_phone': self.lender_phone,
            'loan_date': self.loan_date,
        }


class CompanyResponse:
    def __init__(self, company: PropDevCompany, lots: list = None, partners: list = None,
                 loans: list = None, capital_calls: list = None, expenses: list = None):
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
        self.yearly_pl = company.yearly_pl if hasattr(company, 'yearly_pl') else None
        self.yearly_bs = company.yearly_bs if hasattr(company, 'yearly_bs') else None
        self.yearly_cf = company.yearly_cf if hasattr(company, 'yearly_cf') else None
        self.lots = lots or []
        self.partners = partners or []
        self.loans = loans or []
        self.capital_calls = capital_calls or []
        self.expenses = expenses or []

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
            'yearly_pl': self.yearly_pl,
            'yearly_bs': self.yearly_bs,
            'yearly_cf': self.yearly_cf,
            'lots': self.lots, 'partners': self.partners,
            'loans': self.loans, 'capital_calls': self.capital_calls,
            'expenses': self.expenses,
        }


# ── Endpoints ──────────────────────────────────────────────────────────────────────

@router.get("/companies")
def list_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    companies = db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == current_user.tenant_id
    ).all()

    result = []
    for company in companies:
        lots = [LotResponse(lot).to_dict() for lot in company.lots]
        partners = [PartnerResponse(p).to_dict() for p in company.partners]
        loans = [LoanResponse(ln).to_dict() for ln in company.loans]

        capital_calls = []
        for cc in company.capital_calls:
            capital_calls.append({
                'id': str(cc.id),
                'partner_name': cc.partner.name if cc.partner else '',
                'share_percent': float(cc.share_percent),
                'total_call_amount': float(cc.total_call_amount),
                'partner_share': float(cc.partner_share),
                'amount_received': float(cc.amount_received),
                'status': cc.status,
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

        resp = CompanyResponse(company, lots, partners, loans, capital_calls, expenses)
        result.append(resp.to_dict())

    return {'companies': result}


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
    if "name" in body:
        company.name = body["name"]
    if "property_name" in body:
        company.property_name = body["property_name"]
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
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == cid,
        PropDevCompany.tenant_id == current_user.tenant_id
    ).first()

    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    lots = [LotResponse(lot).to_dict() for lot in company.lots]
    partners = [PartnerResponse(p).to_dict() for p in company.partners]
    loans = [LoanResponse(ln).to_dict() for ln in company.loans]

    capital_calls = []
    for cc in company.capital_calls:
        capital_calls.append({
            'id': str(cc.id),
            'partner_name': cc.partner.name if cc.partner else '',
            'share_percent': float(cc.share_percent),
            'total_call_amount': float(cc.total_call_amount),
            'partner_share': float(cc.partner_share),
            'amount_received': float(cc.amount_received),
            'status': cc.status,
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

    resp = CompanyResponse(company, lots, partners, loans, capital_calls, expenses)
    return resp.to_dict()
