from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from routers.reit._helpers import active_properties_query, compute_property_snapshot
from services.reit_calculations import portfolio_summary_aggregate

router = APIRouter(prefix="/api/reit", tags=["reit"])


@router.get("/portfolio-summary")
def portfolio_summary(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    props = active_properties_query(db, current_user.tenant_id).all()
    snapshots = [compute_property_snapshot(db, p) for p in props]
    return portfolio_summary_aggregate(snapshots)
