"""Import partner ownership register Excel into Property Dev — same flow as Rentals ownership."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import engine, get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from services.ownership_excel_import import build_import_template_bytes
from services.propdev_partner_import import import_propdev_partners_from_excel
from services.schema_patches import apply_schema_patches

router = APIRouter(prefix="/api/propdev", tags=["propdev"])
_log = logging.getLogger(__name__)


@router.get("/import-partner-ownership-template")
def download_partner_ownership_template(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Same Asset Protection template as Rentals Ownership."""
    content = build_import_template_bytes()
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Ownership_Import_Template.xlsx"},
    )


@router.post("/import-partner-ownership")
async def import_partner_ownership(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Import Property Dev partners from the same workbook as Rentals Ownership.

    Reads all of: Personal Entities, Partnership Entities (Family), Partnership Entities.
    Only rows with Entity = Construction, Development, Holding, Prop Dev, or Partner are imported.
    Company names must match Property Dev Company Registry (no auto-create).
    Re-upload replaces all partner positions for the tenant.
    """
    if not file.filename:
        raise HTTPException(400, "No file received")

    lower = file.filename.lower()
    if lower.endswith(".xls") and not lower.endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            400,
            "Legacy .xls format is not supported. Save the file as .xlsx in Excel and upload again.",
        )
    if not lower.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload an Excel workbook (.xlsx)")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")

    try:
        apply_schema_patches(engine)
    except Exception as exc:
        _log.warning("schema patches before partner import: %s", exc)

    result = import_propdev_partners_from_excel(db, current_user.tenant_id, content)
    if result.get("error") == "no_rows":
        detail = result.get("errors", [result.get("message", "No rows imported")])
        if isinstance(detail, list):
            raise HTTPException(status_code=400, detail="; ".join(detail))
        raise HTTPException(status_code=400, detail=str(detail))
    return result
