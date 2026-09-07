import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.consultancy.company import ConsultancyCompany

router = APIRouter(prefix="/api/consultancy", tags=["consultancy"])


def _serialize_company(company: ConsultancyCompany) -> dict:
    return {
        "id": str(company.id),
        "name": company.name,
        "cash_available": float(company.cash_available),
        "status": company.status,
    }


@router.get("/companies")
def list_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    companies = db.query(ConsultancyCompany).filter(
        ConsultancyCompany.tenant_id == current_user.tenant_id,
    ).all()
    return {"companies": [_serialize_company(c) for c in companies]}


class CreateCompanyRequest(BaseModel):
    name: str
    cash_available: float | None = None


@router.post("/companies")
def create_company(
    req: CreateCompanyRequest,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    existing = db.query(ConsultancyCompany).filter(
        ConsultancyCompany.tenant_id == current_user.tenant_id,
        ConsultancyCompany.name == req.name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Company '{req.name}' already exists")

    company = ConsultancyCompany(
        tenant_id=current_user.tenant_id,
        name=req.name,
        cash_available=req.cash_available or 0,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return _serialize_company(company)


@router.get("/companies/{company_id}")
def get_company(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(ConsultancyCompany).filter(
        ConsultancyCompany.id == cid,
        ConsultancyCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return _serialize_company(company)


@router.put("/companies/{company_id}")
def update_company(
    company_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(ConsultancyCompany).filter(
        ConsultancyCompany.id == cid,
        ConsultancyCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if "name" in body:
        company.name = body["name"]
    if "status" in body:
        company.status = body["status"]
    if "cash_available" in body and body["cash_available"] is not None:
        company.cash_available = float(body["cash_available"])
    db.commit()
    db.refresh(company)
    return _serialize_company(company)


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    company = db.query(ConsultancyCompany).filter(
        ConsultancyCompany.id == cid,
        ConsultancyCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(company)
    db.commit()
    return {"status": "deleted"}
