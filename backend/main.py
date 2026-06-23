import traceback
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from database import Base, SessionLocal, engine
from routers import auth, tenant
from routers.real_estate import (
    ai_narrative,
    change_requests,
    construction,
    costs,
    daily_progress_photos,
    entities,
    executive_summary,
    expenses,
    financing,
    inspections,
    loans,
    pay_applications,
    permits,
    pipeline,
    projects,
    quality_checks,
    reit_rental,
    risk,
    work_log,
)
from routers.reit import cash_flow, financials as reit_financials, portfolio_summary as reit_portfolio, properties as reit_properties, units as reit_units
from services.bootstrap import ensure_local_demo
from services.schema_patches import apply_schema_patches

import models.tenancy  # noqa: F401
import models.audit_log  # noqa: F401
import models.real_estate.entity  # noqa: F401
import models.real_estate.permitting  # noqa: F401
import models.real_estate.construction_cost  # noqa: F401
import models.real_estate.construction_extended  # noqa: F401
import models.real_estate.work_log  # noqa: F401
import models.real_estate.quality_check  # noqa: F401
import models.real_estate.inspection  # noqa: F401
import models.real_estate.daily_progress_photo  # noqa: F401
import models.real_estate.unit  # noqa: F401
import models.real_estate.financing  # noqa: F401
import models.real_estate.reit_rental  # noqa: F401
import models.real_estate.pipeline  # noqa: F401
import models.real_estate.risk  # noqa: F401
import models.real_estate.pay_application  # noqa: F401
import models.real_estate.expense  # noqa: F401
import models.real_estate.loan  # noqa: F401
import models.reit.property  # noqa: F401
import models.reit.unit  # noqa: F401
import models.reit.financials  # noqa: F401
import models.rentals.models  # noqa: F401
import models.rentals.maintenance  # noqa: F401
import models.rentals.unit_inspection  # noqa: F401
import models.rentals.vendor  # noqa: F401
import models.rentals.ar_ap  # noqa: F401

app = FastAPI(title="EstateCFO API", version="1.0.0")


@app.exception_handler(Exception)
async def _debug_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    return JSONResponse(status_code=500, content={"detail": str(exc), "traceback": tb})


_cors_kwargs = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.effective_auth_mode == "local":
    # Vite may use 5173, 5174, 5175, etc. when ports are busy
    _cors_kwargs["allow_origin_regex"] = r"http://(localhost|127\.0\.0\.1):\d+"
else:
    _cors_kwargs["allow_origins"] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(CORSMiddleware, **_cors_kwargs)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "estatecfo-api",
        "auth_mode": settings.effective_auth_mode,
    }


app.include_router(auth.router)
app.include_router(tenant.router)
app.include_router(entities.router)
app.include_router(projects.router)
app.include_router(permits.router)
app.include_router(costs.router)
app.include_router(construction.router)
app.include_router(financing.router)
app.include_router(reit_rental.router)
app.include_router(reit_properties.router)
app.include_router(reit_units.router)
app.include_router(reit_financials.router)
app.include_router(cash_flow.router)
app.include_router(reit_portfolio.router)
app.include_router(pipeline.router)
app.include_router(risk.router)
app.include_router(executive_summary.router)
app.include_router(ai_narrative.router)
app.include_router(change_requests.router)
app.include_router(work_log.router)
app.include_router(quality_checks.router)
app.include_router(inspections.router)
app.include_router(daily_progress_photos.router)
app.include_router(pay_applications.router)
app.include_router(expenses.router)
app.include_router(loans.router)

from routers.rentals.router import router as rentals_router  # noqa: E402
from routers.rentals.maintenance import router as rentals_maintenance_router  # noqa: E402
from routers.lender_risk import router as lender_risk_router  # noqa: E402
from routers.rentals.ar_ap import router as rentals_arap_router  # noqa: E402
from routers.rentals.vendor_risk import router as rentals_vendor_risk_router  # noqa: E402
from routers.rentals.export import router as rentals_export_router  # noqa: E402
app.include_router(rentals_router)
app.include_router(rentals_maintenance_router)
app.include_router(lender_risk_router)
app.include_router(rentals_arap_router)
app.include_router(rentals_vendor_risk_router)
app.include_router(rentals_export_router)

from routers.propdev.deal_advisor import router as deal_advisor_router  # noqa: E402
app.include_router(deal_advisor_router)

# Serve uploaded files from local disk only when S3 is not configured (local dev).
# In production, files are served via S3 pre-signed URLs — no static mount needed.
if not settings.s3_bucket:
    _uploads_dir = Path(__file__).resolve().parent / "uploads"
    _uploads_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


@app.on_event("startup")
def startup():
    apply_schema_patches(engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_local_demo(db)
    finally:
        db.close()


@app.get("/api/routes")
def list_routes():
    routes = []
    for route in app.routes:
        if hasattr(route, "methods"):
            routes.append({"path": route.path, "methods": sorted(route.methods)})
    return sorted(routes, key=lambda r: r["path"])
