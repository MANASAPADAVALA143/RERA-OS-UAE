"""Consultancy & Outsourcing — client invoice upload for the Billing & Collections tab."""
from __future__ import annotations

import logging
import threading
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db, engine
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.consultancy.invoice import ConsultancyInvoice

router = APIRouter(prefix="/api/consultancy/billing", tags=["consultancy-billing"])
_log = logging.getLogger(__name__)

_table_ready = False
_table_lock = threading.Lock()


def _ensure_invoices_table(bind=None) -> None:
    global _table_ready
    if _table_ready:
        return
    with _table_lock:
        if _table_ready:
            return
        bind = bind or engine
        try:
            ConsultancyInvoice.__table__.create(bind=bind, checkfirst=True)
            _table_ready = True
        except Exception:
            _log.exception("consultancy_invoices ensure failed")
            raise


def _parse_date(v) -> date | None:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return datetime.fromisoformat(str(v)[:10]).date()
    except ValueError:
        return None


def _row_to_payload(row: ConsultancyInvoice) -> dict:
    return {
        "id": str(row.id),
        "client_name": row.client_name,
        "invoice_date": row.invoice_date.isoformat() if row.invoice_date else None,
        "amount": float(row.amount or 0),
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "collected_amount": float(row.collected_amount or 0),
        "collected_date": row.collected_date.isoformat() if row.collected_date else None,
        "standard_rate_amount": float(row.standard_rate_amount) if row.standard_rate_amount is not None else None,
    }


@router.get("/{company_id}")
def get_invoices(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        _ensure_invoices_table()
        try:
            cid = uuid.UUID(company_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid company_id") from exc

        rows = db.query(ConsultancyInvoice).filter(
            ConsultancyInvoice.tenant_id == current_user.tenant_id,
            ConsultancyInvoice.company_id == cid,
        ).order_by(ConsultancyInvoice.invoice_date).all()
        return {"company_id": company_id, "invoices": [_row_to_payload(r) for r in rows]}
    except HTTPException:
        raise
    except Exception as exc:
        _log.exception("get_invoices failed company_id=%s", company_id)
        raise HTTPException(status_code=500, detail=f"Failed to load invoices: {exc}") from exc


@router.post("/save")
def save_invoices(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Replaces all invoices for this company with the uploaded set (same
    re-upload-replaces semantics as /consultancy/financials/save)."""
    try:
        _ensure_invoices_table()
        company_id = uuid.UUID(body["company_id"])
        invoices = body.get("invoices", [])

        db.query(ConsultancyInvoice).filter(
            ConsultancyInvoice.tenant_id == current_user.tenant_id,
            ConsultancyInvoice.company_id == company_id,
        ).delete()

        for inv in invoices:
            invoice_date = _parse_date(inv.get("invoice_date"))
            if not invoice_date or not inv.get("client_name"):
                continue
            db.add(ConsultancyInvoice(
                tenant_id=current_user.tenant_id,
                company_id=company_id,
                client_name=str(inv["client_name"]).strip(),
                invoice_date=invoice_date,
                amount=inv.get("amount") or 0,
                due_date=_parse_date(inv.get("due_date")),
                collected_amount=inv.get("collected_amount") or 0,
                collected_date=_parse_date(inv.get("collected_date")),
                standard_rate_amount=inv.get("standard_rate_amount"),
                uploaded_by=current_user.email,
            ))

        db.commit()
        return {"status": "saved", "row_count": len(invoices)}
    except HTTPException:
        raise
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=f"Missing field: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        _log.exception("save_invoices failed company_id=%s", body.get("company_id"))
        raise HTTPException(status_code=500, detail=f"Failed to save invoices: {exc}") from exc


@router.delete("/{company_id}", status_code=204)
def delete_invoices(
    company_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    try:
        _ensure_invoices_table()
        db.query(ConsultancyInvoice).filter(
            ConsultancyInvoice.tenant_id == current_user.tenant_id,
            ConsultancyInvoice.company_id == uuid.UUID(company_id),
        ).delete()
        db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        _log.exception("delete_invoices failed company_id=%s", company_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete invoices: {exc}") from exc
