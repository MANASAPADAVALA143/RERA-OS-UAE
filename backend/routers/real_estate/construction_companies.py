import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_company import ConstructionCompany

router = APIRouter(prefix="/api/real-estate/construction", tags=["real-estate"])


def _to_dict(c: ConstructionCompany) -> dict:
    return {
        "id": str(c.id),
        "company_name": c.company_name,
        "project_name": c.project_name,
        "project_type": c.project_type,
        "contract_value": float(c.contract_value) if c.contract_value else 0,
        "start_date": c.start_date.isoformat() if c.start_date else None,
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "status": c.status or "active",
    }


class ConstructionCompanyBody(BaseModel):
    company_name: str
    project_name: str | None = None
    project_type: str | None = None
    contract_value: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = "active"


@router.get("/companies")
def list_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    companies = db.query(ConstructionCompany).filter(
        ConstructionCompany.tenant_id == current_user.tenant_id
    ).order_by(ConstructionCompany.company_name).all()
    return [_to_dict(c) for c in companies]


@router.post("/companies", status_code=201)
def create_company(
    body: ConstructionCompanyBody,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    from datetime import date as date_type
    co = ConstructionCompany(
        tenant_id=current_user.tenant_id,
        company_name=body.company_name,
        project_name=body.project_name,
        project_type=body.project_type,
        contract_value=body.contract_value or 0,
        start_date=date_type.fromisoformat(body.start_date) if body.start_date else None,
        end_date=date_type.fromisoformat(body.end_date) if body.end_date else None,
        status=body.status or "active",
    )
    db.add(co)
    db.commit()
    db.refresh(co)
    return _to_dict(co)


@router.put("/companies/{company_id}")
def update_company(
    company_id: str,
    body: ConstructionCompanyBody,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    from datetime import date as date_type
    cid = uuid.UUID(company_id)
    co = db.query(ConstructionCompany).filter(
        ConstructionCompany.id == cid,
        ConstructionCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(status_code=404, detail="Company not found")
    co.company_name = body.company_name
    co.project_name = body.project_name
    co.project_type = body.project_type
    if body.contract_value is not None:
        co.contract_value = body.contract_value
    co.start_date = date_type.fromisoformat(body.start_date) if body.start_date else None
    co.end_date = date_type.fromisoformat(body.end_date) if body.end_date else None
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
    co = db.query(ConstructionCompany).filter(
        ConstructionCompany.id == cid,
        ConstructionCompany.tenant_id == current_user.tenant_id,
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
    co = db.query(ConstructionCompany).filter(
        ConstructionCompany.id == cid,
        ConstructionCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(status_code=404, detail="Company not found")
    db.delete(co)
    db.commit()
