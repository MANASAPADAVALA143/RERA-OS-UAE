"""Consultancy & Outsourcing financial uploads — same contract and shape as /api/propdev/financials."""
from __future__ import annotations

import logging
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db, engine, is_sqlite
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.consultancy.financial_upload import ConsultancyFinancialUpload

router = APIRouter(prefix="/api/consultancy", tags=["consultancy-financials"])
_log = logging.getLogger(__name__)

_table_ready = False
_table_lock = threading.Lock()


def _ensure_fin_uploads_table(bind=None) -> None:
    """Create + light column patches — once per process (never ALTER on every GET)."""
    global _table_ready
    if _table_ready:
        return
    with _table_lock:
        if _table_ready:
            return
        bind = bind or engine
        try:
            ConsultancyFinancialUpload.__table__.create(bind=bind, checkfirst=True)
            json_type = "TEXT" if is_sqlite else "JSONB"
            with bind.begin() as conn:
                for col, col_type in (
                    ("pl_filename", "VARCHAR(255)"),
                    ("bs_filename", "VARCHAR(255)"),
                    ("cf_filename", "VARCHAR(255)"),
                    ("cf_data", json_type),
                ):
                    if is_sqlite:
                        # SQLite has no IF NOT EXISTS for ADD COLUMN on older versions — ignore duplicate
                        try:
                            conn.execute(text(
                                f"ALTER TABLE consultancy_financial_uploads ADD COLUMN {col} {col_type}"
                            ))
                        except Exception:
                            pass
                    else:
                        conn.execute(text(
                            f"ALTER TABLE consultancy_financial_uploads "
                            f"ADD COLUMN IF NOT EXISTS {col} {col_type}"
                        ))
            _table_ready = True
        except Exception:
            _log.exception("consultancy_financial_uploads ensure failed")
            # Do not flip _table_ready — retry next call; still don't block forever on ALTER
            raise


def _row_to_payload(row: ConsultancyFinancialUpload) -> dict:
    return {
        "company_id": str(row.company_id),
        "company_name": row.company_name,
        "filename": row.filename,
        "pl_filename": getattr(row, "pl_filename", None),
        "bs_filename": getattr(row, "bs_filename", None),
        "cf_filename": getattr(row, "cf_filename", None),
        "date_range": row.date_range,
        "years": row.years or [],
        "periods": row.periods or [],
        "pl": row.pl_data or [],
        "bs": row.bs_data or [],
        "cf": row.cf_data or [],
        "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else None,
    }


@router.get("/financials")
def list_financials(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        rows = db.query(ConsultancyFinancialUpload).filter(
            ConsultancyFinancialUpload.tenant_id == current_user.tenant_id,
        ).all()
        return [
            {
                "company_id": str(r.company_id),
                "company_name": r.company_name,
                "filename": r.filename,
                "years": r.years or [],
                "uploaded_at": r.uploaded_at.isoformat() if r.uploaded_at else None,
            }
            for r in rows
        ]
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("list_financials failed tenant=%s", current_user.tenant_id)
        raise HTTPException(status_code=500, detail=f"Failed to list financials: {exc}") from exc


@router.get("/financials/{company_id}")
def get_financials(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _ensure_fin_uploads_table()
        try:
            cid = uuid.UUID(company_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid company_id") from exc

        row = db.query(ConsultancyFinancialUpload).filter(
            ConsultancyFinancialUpload.tenant_id == current_user.tenant_id,
            ConsultancyFinancialUpload.company_id == cid,
        ).first()
        if not row:
            raise HTTPException(status_code=404, detail="No financials for this company")
        return _row_to_payload(row)
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception(
            "get_financials failed company_id=%s tenant=%s",
            company_id, current_user.tenant_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load financials for this company: {exc}",
        ) from exc


@router.post("/financials/save")
def save_financials(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Upsert full PL/BS/CF payload — same semantics as propdev/rentals save."""
    try:
        _ensure_fin_uploads_table()
        company_id = uuid.UUID(body["company_id"])
        existing = db.query(ConsultancyFinancialUpload).filter(
            ConsultancyFinancialUpload.tenant_id == current_user.tenant_id,
            ConsultancyFinancialUpload.company_id == company_id,
        ).first()

        if existing:
            existing.company_name = body.get("company_name", existing.company_name)
            existing.filename = body.get("filename", existing.filename)
            if "pl_filename" in body:
                existing.pl_filename = body.get("pl_filename")
            if "bs_filename" in body:
                existing.bs_filename = body.get("bs_filename")
            if "cf_filename" in body:
                existing.cf_filename = body.get("cf_filename")
            existing.date_range = body.get("date_range", existing.date_range)
            existing.years = body.get("years", existing.years)
            existing.periods = body.get("periods", existing.periods)
            existing.pl_data = body.get("pl", existing.pl_data)
            existing.bs_data = body.get("bs", existing.bs_data)
            existing.cf_data = body.get("cf", existing.cf_data)
            existing.uploaded_by = current_user.email
        else:
            row = ConsultancyFinancialUpload(
                tenant_id=current_user.tenant_id,
                company_id=company_id,
                company_name=body.get("company_name", ""),
                filename=body.get("filename", ""),
                pl_filename=body.get("pl_filename"),
                bs_filename=body.get("bs_filename"),
                cf_filename=body.get("cf_filename"),
                date_range=body.get("date_range", ""),
                years=body.get("years", []),
                periods=body.get("periods", []),
                pl_data=body.get("pl", []),
                bs_data=body.get("bs", []),
                cf_data=body.get("cf", []),
                uploaded_by=current_user.email,
            )
            db.add(row)

        db.commit()
        return {
            "status": "saved",
            "years": body.get("years", []),
            "pl_rows": len(body.get("pl", [])),
            "bs_rows": len(body.get("bs", [])),
            "cf_rows": len(body.get("cf", [])),
        }
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Missing field: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        _log.exception("save_financials failed company_id=%s", body.get("company_id"))
        raise HTTPException(status_code=500, detail=f"Failed to save financials: {exc}") from exc


@router.delete("/financials/{company_id}", status_code=204)
def delete_financials(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    try:
        _ensure_fin_uploads_table()
        row = db.query(ConsultancyFinancialUpload).filter(
            ConsultancyFinancialUpload.tenant_id == current_user.tenant_id,
            ConsultancyFinancialUpload.company_id == uuid.UUID(company_id),
        ).first()
        if row:
            db.delete(row)
            db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        _log.exception("delete_financials failed company_id=%s", company_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete financials: {exc}") from exc
