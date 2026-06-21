from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import Base, SessionLocal, engine
from routers import auth, tenant
from routers.real_estate import (
    ai_narrative,
    construction,
    costs,
    entities,
    executive_summary,
    financing,
    permits,
    pipeline,
    projects,
    reit_rental,
    risk,
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
import models.real_estate.unit  # noqa: F401
import models.real_estate.financing  # noqa: F401
import models.real_estate.reit_rental  # noqa: F401
import models.real_estate.pipeline  # noqa: F401
import models.real_estate.risk  # noqa: F401
import models.reit.property  # noqa: F401
import models.reit.unit  # noqa: F401
import models.reit.financials  # noqa: F401

app = FastAPI(title="EstateCFO API", version="1.0.0")

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
