"""Property Dev financial uploads — same contract and shape as /api/rentals/financials."""
from __future__ import annotations

import logging
import threading
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db, engine
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.financial_upload import PropDevFinancialUpload
from services.propdev_expense_categorizer import tag_pl_items

router = APIRouter(prefix="/api/propdev", tags=["propdev-financials"])
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
            PropDevFinancialUpload.__table__.create(bind=bind, checkfirst=True)
            with bind.begin() as conn:
                for col, col_type in (
                    ("pl_filename", "VARCHAR(255)"),
                    ("bs_filename", "VARCHAR(255)"),
                    ("cf_filename", "VARCHAR(255)"),
                ):
                    conn.execute(text(
                        f"ALTER TABLE propdev_financial_uploads "
                        f"ADD COLUMN IF NOT EXISTS {col} {col_type}"
                    ))
            _table_ready = True
        except Exception:
            _log.exception("propdev_financial_uploads ensure failed")
            # Do not flip _table_ready — retry next call; still don't block forever on ALTER
            raise


def _row_to_payload(row: PropDevFinancialUpload) -> dict:
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
        # Schema ensure runs at startup / save — never on read path.
        rows = db.query(PropDevFinancialUpload).filter(
            PropDevFinancialUpload.tenant_id == current_user.tenant_id,
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
        try:
            cid = uuid.UUID(company_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid company_id") from exc

        # Schema ensure runs at startup / save — never on read path.
        row = db.query(PropDevFinancialUpload).filter(
            PropDevFinancialUpload.tenant_id == current_user.tenant_id,
            PropDevFinancialUpload.company_id == cid,
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
    """Upsert full PL/BS/CF payload — same semantics as rentals save."""
    try:
        _ensure_fin_uploads_table()
        company_id = uuid.UUID(body["company_id"])
        existing = db.query(PropDevFinancialUpload).filter(
            PropDevFinancialUpload.tenant_id == current_user.tenant_id,
            PropDevFinancialUpload.company_id == company_id,
        ).first()

        # Tag each P&L detail line with an expense_category (Carrying Costs Tracker) --
        # mutates in place, resolved/persisted against propdev_expense_category_map.
        pl_items = body.get("pl")
        if isinstance(pl_items, list):
            tag_pl_items(db, current_user.tenant_id, pl_items)

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
            row = PropDevFinancialUpload(
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


@router.get("/expense-categories/needs-review")
def get_expense_categories_needs_review(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Tenant-wide Needs Review queue for P&L expense-category tagging (Carrying
    Costs Tracker) -- same read-only surfacing pattern as Construction's vendor
    needs_review_queue (no separate confirm/override endpoint exists there
    either; the map self-corrects on next save/backfill as labels are added).
    """
    from models.propdev.expense_category_map import PropDevExpenseCategoryMap
    rows = db.query(PropDevExpenseCategoryMap).filter(
        PropDevExpenseCategoryMap.tenant_id == current_user.tenant_id,
        PropDevExpenseCategoryMap.confidence < 0.70,
        PropDevExpenseCategoryMap.reviewed.is_(False),
    ).order_by(PropDevExpenseCategoryMap.label).all()
    return {
        "count": len(rows),
        "items": [
            {"label": r.label, "expense_category": r.expense_category, "confidence": float(r.confidence or 0)}
            for r in rows
        ],
    }


@router.delete("/financials/{company_id}", status_code=204)
def delete_financials(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    try:
        _ensure_fin_uploads_table()
        row = db.query(PropDevFinancialUpload).filter(
            PropDevFinancialUpload.tenant_id == current_user.tenant_id,
            PropDevFinancialUpload.company_id == uuid.UUID(company_id),
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
