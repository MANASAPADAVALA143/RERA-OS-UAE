"""
PropDev P&L expense-category resolver — same exact-match -> keyword-match ->
Needs Review algorithm as Construction's vendor categorizer
(services/construction_vendor_matrix.py: suggest_category/resolve_category/
build_or_merge_category_map), persisted to a real DB table
(models.propdev.expense_category_map.PropDevExpenseCategoryMap) instead of a
JSON file, and tenant-scoped.

Categories map directly to the Carrying Costs Tracker's columns:
Interest Paid | Property Tax | Improvements | Other -> Total Carrying Cost.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from models.propdev.expense_category_map import PropDevExpenseCategoryMap

CARRYING_COST_CATEGORIES = {"interest", "property_tax", "improvements", "other_carrying"}

_CATEGORY_RULES: list[tuple[str, list[str], float]] = [
    ("interest", ["interest expense", "interest paid", "interest on loan", "loan interest", " interest"], 0.9),
    ("property_tax", ["property tax", "real estate tax", "county tax", "tax assessment", "parcel tax", "ad valorem"], 0.92),
    ("improvements", [
        "improvement", "grading", "site work", "site development", "infrastructure", "earthwork",
        "utility installation", "road construction", "survey", "planning", "engineering", "design",
        "permission", "permit", "inspection", "site visit",
    ], 0.85),
    ("other_carrying", [
        "hoa", "homeowner", "carrying cost", "holding cost", "insurance", "property insurance",
        "title insurance", "repairs & maintenance", "repairs and maintenance", "maintenance",
    ], 0.8),
    ("debt_service", [
        "principal payment", "debt service", "mortgage payment", "loan principal", "loan payment",
        "loan processing", "processing fee", "origination", "originating",
    ], 0.85),
    ("capex", [
        "capital expenditure", "capex", "equipment purchase", "construction cost", "hard cost",
        "cost of land", "closing fee", "closing cost", "escrow", "title charge", "acquisition cost",
        "settlement charge", "settlement",
    ], 0.82),
    ("operating", [
        "salary", "payroll", "wages", "office", "marketing", "advertising", "management fee",
        "commission", "accounting", "bank fee", "bank charge", "software", "legal fee",
        "professional", "consulting", "travel", "meals", "utilities",
        "telephone", "internet", "contract expense", "subscription", "membership fee",
        "taxes & licenses", "taxes and licenses", "license", "miscellaneous", "misc ", "misc.",
        "other business expense", "other expense", "incorporation", "lease payment",
    ], 0.8),
]

_EXCLUDE_INTEREST_INCOME = ("interest income",)


def suggest_category(label: str) -> tuple[str, float, str]:
    """Return (category, confidence 0-1, reason). Low confidence -> Needs Review."""
    text = (label or "").strip().lower()
    if not text:
        return ("other", 0.35, "empty label")
    if any(x in text for x in _EXCLUDE_INTEREST_INCOME):
        return ("other", 0.4, "interest income, not an expense")

    best_cat = "other"
    best_score = 0.0
    best_reason = "no keyword match"
    for cat, kws, base in _CATEGORY_RULES:
        hits = [kw for kw in kws if kw.strip() in text]
        if not hits:
            continue
        score = min(0.98, base + 0.02 * (len(hits) - 1))
        if score > best_score:
            best_score = score
            best_cat = cat
            best_reason = f"matched: {', '.join(h.strip() for h in hits[:3])}"

    if best_score < 0.70:
        return ("other", best_score if best_score > 0 else 0.35, best_reason)
    return (best_cat, best_score, best_reason)


def load_category_map(db: Session, tenant_id: uuid.UUID) -> dict[str, PropDevExpenseCategoryMap]:
    rows = db.query(PropDevExpenseCategoryMap).filter(
        PropDevExpenseCategoryMap.tenant_id == tenant_id,
    ).all()
    return {r.label: r for r in rows}


def resolve_category(label: str, persisted: dict[str, PropDevExpenseCategoryMap]) -> tuple[str, float]:
    key = (label or "").strip()
    entry = persisted.get(key)
    if entry is not None:
        return (entry.expense_category, float(entry.confidence or 0))
    cat, conf, _ = suggest_category(key)
    return cat, conf


def build_or_merge_category_map(
    db: Session,
    tenant_id: uuid.UUID,
    labels: list[str],
) -> tuple[dict[str, PropDevExpenseCategoryMap], list[dict[str, Any]]]:
    """Suggest categories for every label not yet persisted (or not reviewed=true),
    upsert them, and return (full_map, needs_review_queue)."""
    persisted = load_category_map(db, tenant_id)
    needs_review: list[dict[str, Any]] = []

    for label in sorted({(lab or "").strip() for lab in labels if (lab or "").strip()}):
        existing = persisted.get(label)
        if existing is not None and existing.reviewed:
            continue
        cat, conf, reason = suggest_category(label)
        final_cat = cat if conf >= 0.70 else "other"
        if existing is not None:
            existing.expense_category = final_cat
            existing.confidence = round(conf, 2)
        else:
            existing = PropDevExpenseCategoryMap(
                tenant_id=tenant_id, label=label,
                expense_category=final_cat, confidence=round(conf, 2), reviewed=False,
            )
            db.add(existing)
            persisted[label] = existing
        if conf < 0.70:
            needs_review.append({"label": label, "suggested_category": cat, "confidence": round(conf, 2), "reason": reason})

    db.flush()
    return persisted, needs_review


def tag_pl_items(db: Session, tenant_id: uuid.UUID, pl_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mutates each P&L line-item dict in place, adding "expense_category".
    Skips totals/section headers/net-income rows -- categorization only applies
    to real detail lines, matching how Category-column parsing already treats them."""
    labels = [
        str(item.get("label") or "")
        for item in pl_items
        if not item.get("isTotal") and not item.get("isSectionHeader") and not item.get("isNetIncome")
    ]
    persisted, _ = build_or_merge_category_map(db, tenant_id, labels)
    for item in pl_items:
        if item.get("isTotal") or item.get("isSectionHeader") or item.get("isNetIncome"):
            continue
        cat, _ = resolve_category(str(item.get("label") or ""), persisted)
        item["expense_category"] = cat
    return pl_items
