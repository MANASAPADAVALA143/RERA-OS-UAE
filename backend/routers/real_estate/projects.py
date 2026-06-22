import uuid
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_cost import CostTrade
from models.real_estate.entity import Project, ProjectStatus, ProjectType
from models.real_estate.financing import FinancingFacility
from models.real_estate.permitting import Permit
from models.real_estate.unit import Unit
from services.real_estate_calculations import cost_overrun, permit_days_pending, unit_economics

router = APIRouter(prefix="/api/real-estate/projects", tags=["real-estate"])


class ProjectCreate(BaseModel):
    entity_id: str
    project_name: str
    project_type: str
    status: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    total_units: int | None = None
    total_saleable_sqft: float | None = None


def _project_dict(p: Project):
    return {
        "id": str(p.id),
        "entity_id": str(p.entity_id),
        "project_name": p.project_name,
        "project_type": p.project_type.value,
        "status": p.status.value,
        "address": p.address,
        "city": p.city,
        "state": p.state,
        "zip_code": p.zip_code,
        "total_units": p.total_units,
        "total_saleable_sqft": float(p.total_saleable_sqft) if p.total_saleable_sqft else None,
        "project_code": p.project_code,
        "contract_value": float(p.contract_value) if p.contract_value else None,
        "total_project_cost": float(p.total_project_cost) if p.total_project_cost else None,
        "start_date": p.start_date.isoformat() if p.start_date else None,
        "target_completion_date": p.target_completion_date.isoformat() if p.target_completion_date else None,
        "flood_zone": p.flood_zone,
        "wildfire_risk_zone": p.wildfire_risk_zone,
        "hurricane_zone": p.hurricane_zone,
        "description": p.description,
        "creator_role": p.creator_role,
        "working_days": p.working_days,
        "created_by": p.created_by,
    }


@router.get("")
def list_projects(
    status: str | None = None,
    project_type: str | None = None,
    entity_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Project).filter(Project.tenant_id == current_user.tenant_id)
    if status:
        q = q.filter(Project.status == ProjectStatus(status))
    if project_type:
        q = q.filter(Project.project_type == ProjectType(project_type))
    if entity_id:
        q = q.filter(Project.entity_id == uuid.UUID(entity_id))
    return [_project_dict(p) for p in q.order_by(Project.project_name).all()]


@router.get("/{project_id}")
def get_project_detail(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    permits = db.query(Permit).filter(Permit.project_id == project.id).all()
    trades = db.query(CostTrade).filter(CostTrade.project_id == project.id).all()
    units = db.query(Unit).filter(Unit.project_id == project.id).all()
    facilities = db.query(FinancingFacility).filter(FinancingFacility.project_id == project.id).all()

    permit_rows = []
    for p in permits:
        computed = permit_days_pending(p.application_date, p.target_approval_date, p.actual_approval_date)
        permit_rows.append({
            "id": str(p.id),
            "permit_type": p.permit_type.value,
            "status": p.status.value,
            "is_blocking": p.is_blocking,
            **computed,
        })

    trade_rows = []
    for t in trades:
        overrun = cost_overrun(t.budgeted_cost, t.actual_cost_to_date, t.committed_cost)
        trade_rows.append({
            "id": str(t.id),
            "trade_name": t.trade_name.value,
            "budgeted_cost": float(t.budgeted_cost),
            "actual_cost_to_date": float(t.actual_cost_to_date),
            "committed_cost": float(t.committed_cost),
            "pct_complete": float(t.pct_complete),
            **overrun,
        })

    unit_counts = Counter(u.status.value for u in units)

    return {
        **_project_dict(project),
        "permits": permit_rows,
        "cost_trades": trade_rows,
        "unit_summary": dict(unit_counts),
        "financing_facilities": [
            {
                "id": str(f.id),
                "facility_type": f.facility_type.value,
                "lender_or_investor_name": f.lender_or_investor_name,
                "committed_amount": float(f.committed_amount),
                "drawn_amount": float(f.drawn_amount),
            }
            for f in facilities
        ],
    }


@router.get("/{project_id}/units")
def list_project_units(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    units = db.query(Unit).filter(Unit.project_id == project.id).all()
    result = []
    for u in units:
        econ = unit_economics(
            u.allocated_land_cost, u.allocated_construction_cost, u.allocated_soft_cost,
            u.list_price, u.achieved_sale_price,
        )
        result.append({
            "id": str(u.id),
            "unit_number": u.unit_number,
            "unit_type": u.unit_type.value,
            "sqft": float(u.sqft) if u.sqft else None,
            "status": u.status.value,
            "list_price": float(u.list_price),
            "achieved_sale_price": float(u.achieved_sale_price) if u.achieved_sale_price else None,
            "days_on_market": u.days_on_market,
            **econ,
        })
    return result


@router.post("")
def create_project(
    body: ProjectCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    project = Project(
        tenant_id=current_user.tenant_id,
        entity_id=uuid.UUID(body.entity_id),
        project_name=body.project_name,
        project_type=ProjectType(body.project_type),
        status=ProjectStatus(body.status),
        address=body.address,
        city=body.city,
        state=body.state,
        zip_code=body.zip_code,
        total_units=body.total_units,
        total_saleable_sqft=body.total_saleable_sqft,
        created_by=current_user.user_id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _project_dict(project)
