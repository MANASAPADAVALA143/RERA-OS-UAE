"""
QuickBooks AR Aging Detail by Customer — parser.

Handles the hierarchical Excel layout:
  Building/Property header rows
    Tenant/customer detail rows   ← these are the leaf rows we collect
    [optional company sub-header]
      Tenant detail rows
    Total for [Building/Company]  ← SKIP (subtotal, causes double-counting)
  Grand Total                     ← SKIP

Returns a list of detail rows only (leaf-only summation).
Negative bucket values are flagged as credit balances.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl

# ── Column header variants seen in QB exports ─────────────────────────────────
_CURRENT_RE = re.compile(r'current', re.I)
_1_30_RE    = re.compile(r'1\s*[-–]\s*30', re.I)
_31_60_RE   = re.compile(r'31\s*[-–]\s*60', re.I)
_61_90_RE   = re.compile(r'61\s*[-–]\s*90', re.I)
_91P_RE     = re.compile(r'91\s*(and\s*over|plus|\+)', re.I)
_TOTAL_RE   = re.compile(r'^total', re.I)

# Patterns that mark a subtotal / summary row — never a real customer row
_SUBTOTAL_LABEL = re.compile(
    r'^(total\s+for|grand\s+total|total|subtotal)',
    re.I,
)


def _safe_float(val: Any) -> float:
    if val is None:
        return 0.0
    try:
        return float(str(val).replace(',', '').replace('$', '').strip())
    except (ValueError, TypeError):
        return 0.0


def _norm(val: Any) -> str:
    if val is None:
        return ''
    return ' '.join(str(val).split()).lower()


def _find_header_row(rows: list) -> Optional[Tuple[int, Dict[str, int]]]:
    """
    Scan for the row that contains 'Current' and the aging-bucket headers.
    Returns (row_index, {bucket_name: col_index}).
    """
    for i, row in enumerate(rows[:30]):
        cols: Dict[str, int] = {}
        for j, cell in enumerate(row):
            n = _norm(cell)
            if _CURRENT_RE.match(n):
                cols['current'] = j
            elif _1_30_RE.search(n):
                cols['1_30'] = j
            elif _31_60_RE.search(n):
                cols['31_60'] = j
            elif _61_90_RE.search(n):
                cols['61_90'] = j
            elif _91P_RE.search(n):
                cols['91_plus'] = j
            elif _TOTAL_RE.match(n) and 'total' not in cols and j > 0:
                cols['total'] = j

        # Must have at least current + two other buckets to be the header
        if 'current' in cols and len(cols) >= 3:
            return (i, cols)
    return None


def _is_subtotal(label: str) -> bool:
    return bool(_SUBTOTAL_LABEL.match(label.strip()))


def _looks_like_building_header(row: list, col_map: Dict[str, int]) -> bool:
    """A building/property header has text in col 0 but all $ cols are empty."""
    all_empty = all(
        _safe_float(row[c]) == 0.0
        for c in col_map.values()
        if c < len(row)
    )
    has_label = bool(_norm(row[0]))
    return has_label and all_empty


def parse_qb_ar_aging(file_path: str) -> Dict:
    """
    Parse a QB AR Aging Detail by Customer Excel file.

    Returns:
        {
          "rows": [
              {
                "building": str,
                "customer": str,
                "unit_ref": str | None,
                "current": float,
                "days_1_30": float,
                "days_31_60": float,
                "days_61_90": float,
                "days_91_plus": float,
                "total": float,
                "has_credit": bool,
              },
              ...
          ],
          "skipped_subtotals": int,
          "error": str | None,
        }
    """
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    all_rows = [
        [cell for cell in row]
        for row in ws.iter_rows(values_only=True)
    ]

    found = _find_header_row(all_rows)
    if found is None:
        return {
            "rows": [], "skipped_subtotals": 0,
            "error": "Header row not found — could not locate 'Current' / '1-30' / '31-60' columns",
        }

    hdr_idx, col_map = found
    data_rows = all_rows[hdr_idx + 1:]

    results: List[Dict] = []
    current_building = ""
    skipped = 0

    for row in data_rows:
        # Get label from first non-empty cell in row (col 0 or col 1)
        label = _norm(row[0]) if len(row) > 0 else ''
        label_raw = str(row[0]).strip() if (len(row) > 0 and row[0] is not None) else ''

        # If label_raw is empty, try col 1 (some exports indent tenant name)
        if not label and len(row) > 1 and row[1] is not None:
            label = _norm(row[1])
            label_raw = str(row[1]).strip()

        if not label:
            continue

        # Skip subtotal / total rows (leaf-only summation)
        if _is_subtotal(label_raw):
            skipped += 1
            continue

        # Extract bucket values
        def gcol(k: str) -> float:
            c = col_map.get(k)
            if c is None or c >= len(row):
                return 0.0
            return _safe_float(row[c])

        cur   = gcol('current')
        d130  = gcol('1_30')
        d3160 = gcol('31_60')
        d6190 = gcol('61_90')
        d91p  = gcol('91_plus')
        tot   = gcol('total') if 'total' in col_map else cur + d130 + d3160 + d6190 + d91p

        all_zero = cur == 0 and d130 == 0 and d3160 == 0 and d6190 == 0 and d91p == 0

        if all_zero:
            # Building / property header row — update context
            current_building = label_raw
            continue

        # Real tenant/customer row
        has_credit = any(v < 0 for v in [cur, d130, d3160, d6190, d91p])

        # Try to extract a unit reference from the customer label
        # QB often formats as "Tenant Name / Property / Suit-410-Unit-J,K&L"
        unit_ref = _extract_unit_ref(label_raw)

        results.append({
            "building":    current_building,
            "customer":    label_raw,
            "unit_ref":    unit_ref,
            "current":     cur,
            "days_1_30":   d130,
            "days_31_60":  d3160,
            "days_61_90":  d6190,
            "days_91_plus": d91p,
            "total":       tot,
            "has_credit":  has_credit,
        })

    return {
        "rows": results,
        "skipped_subtotals": skipped,
        "error": None,
    }


# ── Unit reference extractor ──────────────────────────────────────────────────

# Patterns like "Suit-410-Unit-J,K&L", "Unit-J,K&L", "Suite 112 Unit A"
_UNIT_HINT = re.compile(
    r'(?:suit|suite|unit)[^\w]*(\S[\w,&\s\-]*)',
    re.I,
)
_SLASH_PARTS = re.compile(r'\s*/\s*')


def _extract_unit_ref(customer: str) -> Optional[str]:
    """
    Try to pull a unit reference from the QB customer field.
    Returns the best match or None.
    """
    # If slash-delimited, check the last segment
    parts = _SLASH_PARTS.split(customer)
    for part in reversed(parts):
        m = _UNIT_HINT.search(part)
        if m:
            return part.strip()
    # Whole string
    m = _UNIT_HINT.search(customer)
    if m:
        return customer.strip()
    return None


# ── Unit matching (reuse normalized label logic from rent receivable) ─────────

def _norm_unit(s: str) -> str:
    """Normalize a unit label for comparison."""
    return re.sub(r'\s+', ' ', s.strip().lower())


def match_row_to_unit(
    row: Dict,
    units_by_company: Dict[str, List],   # company_id → list of {id, unit_number, company_id}
    companies: List[Dict],               # [{id, company_name}]
) -> Tuple[Optional[str], Optional[str]]:
    """
    Try to match a QB row to a RentalUnit.
    Returns (matched_unit_id, matched_company_id) or (None, None).
    """
    # Extract candidate unit labels from customer + unit_ref
    candidates: List[str] = []
    if row.get("unit_ref"):
        candidates.append(row["unit_ref"])
    candidates.append(row["customer"])

    for co in companies:
        cid = co["id"]
        co_units = units_by_company.get(cid, [])
        for u in co_units:
            u_norm = _norm_unit(u["unit_number"])
            for cand in candidates:
                cand_norm = _norm_unit(cand)
                # Exact match
                if cand_norm == u_norm:
                    return (u["id"], cid)
                # Contains match (unit label appears somewhere in the customer string)
                if u_norm and u_norm in cand_norm:
                    return (u["id"], cid)
                # Building context match — check building name against company name
                bldg = _norm_unit(row.get("building", ""))
                co_norm = _norm_unit(co["company_name"])
                if bldg and (bldg in co_norm or co_norm in bldg):
                    if u_norm and u_norm in cand_norm:
                        return (u["id"], cid)
    return (None, None)
