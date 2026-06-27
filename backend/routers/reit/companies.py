import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.reit.company import ReitCompany

router = APIRouter(prefix="/api/reit", tags=["reit"])


def _to_dict(c: ReitCompany) -> dict:
    return {
        "id": str(c.id),
        "company_name": c.company_name,
        "fund_name": c.fund_name,
        "asset_class": c.asset_class,
        "aum": float(c.aum) if c.aum else 0,
        "status": c.status or "active",
    }


class ReitCompanyBody(BaseModel):
    company_name: str
    fund_name: str | None = None
    asset_class: str | None = None
    aum: float | None = None
    status: str | None = "active"


@router.get("/companies/count")
def count_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.query(ReitCompany).filter(ReitCompany.tenant_id == current_user.tenant_id).count()
    return {"count": n}


@router.get("/companies")
def list_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    companies = db.query(ReitCompany).filter(
        ReitCompany.tenant_id == current_user.tenant_id
    ).order_by(ReitCompany.company_name).all()
    return [_to_dict(c) for c in companies]


@router.post("/companies", status_code=201)
def create_company(
    body: ReitCompanyBody,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = ReitCompany(
        tenant_id=current_user.tenant_id,
        company_name=body.company_name,
        fund_name=body.fund_name,
        asset_class=body.asset_class,
        aum=body.aum or 0,
        status=body.status or "active",
    )
    db.add(co)
    db.commit()
    db.refresh(co)
    return _to_dict(co)


@router.put("/companies/{company_id}")
def update_company(
    company_id: str,
    body: ReitCompanyBody,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    co = db.query(ReitCompany).filter(
        ReitCompany.id == cid,
        ReitCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(status_code=404, detail="Company not found")
    co.company_name = body.company_name
    co.fund_name = body.fund_name
    co.asset_class = body.asset_class
    if body.aum is not None:
        co.aum = body.aum
    if body.status:
        co.status = body.status
    db.commit()
    db.refresh(co)
    return _to_dict(co)


@router.patch("/companies/{company_id}/status")
def toggle_status(
    company_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    co = db.query(ReitCompany).filter(
        ReitCompany.id == cid,
        ReitCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(status_code=404, detail="Company not found")
    co.status = body.get("status", "active")
    db.commit()
    return {"id": str(co.id), "status": co.status}


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(company_id)
    co = db.query(ReitCompany).filter(
        ReitCompany.id == cid,
        ReitCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(co)
    db.commit()
