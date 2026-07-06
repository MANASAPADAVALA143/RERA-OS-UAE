"""
QuickBooks AP Aging Detail by Vendor — parser.

QB AP Aging exports follow the same hierarchical structure as AR Aging:
  Vendor header rows (sometimes nested under company groupings)
    Vendor detail rows  ← leaf rows we collect
    Total for [Vendor]  ← SKIP (subtotal)
  Grand Total           ← SKIP

AP bucket structure: Current / 1-30 / 31-60 / 61-90 and over (sometimes merged as 60+)
We store as: current / days_1_30 / days_31_60 / days_60_plus

Negative values = credit balances, flagged with has_credit=True.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

import openpyxl

# ── Column header regex ────────────────────────────────────────────────────────
_CURRENT_RE = re.compile(r'current', re.I)
_1_30_RE    = re.compile(r'1\s*[-–]\s*30', re.I)
_31_60_RE   = re.compile(r'31\s*[-–]\s*60', re.I)
# AP often merges 61-90 and 91+ into a single "61 and over" or "60 and over" bucket
_60P_RE     = re.compile(r'(6[01]\s*(and\s*(over|above)|plus|\+)|61\s*[-–]\s*90)', re.I)
_TOTAL_RE   = re.compile(r'^total', re.I)

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
            elif _60P_RE.search(n):
                cols['60_plus'] = j
            elif _TOTAL_RE.match(n) and 'total' not in cols and j > 0:
                cols['total'] = j
        if 'current' in cols and len(cols) >= 3:
            return (i, cols)
    return None


def _is_subtotal(label: str) -> bool:
    return bool(_SUBTOTAL_LABEL.match(label.strip()))


def parse_qb_ap_aging(file_path: str) -> Dict:
    """
    Parse a QB AP Aging Detail by Vendor Excel file.

    Returns:
        {
          "rows": [
              {
                "vendor_name": str,
                "current": float,
                "days_1_30": float,
                "days_31_60": float,
                "days_60_plus": float,
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
    skipped = 0

    for row in data_rows:
        label = _norm(row[0]) if len(row) > 0 else ''
        label_raw = str(row[0]).strip() if (len(row) > 0 and row[0] is not None) else ''

        if not label and len(row) > 1 and row[1] is not None:
            label = _norm(row[1])
            label_raw = str(row[1]).strip()

        if not label:
            continue

        if _is_subtotal(label_raw):
            skipped += 1
            continue

        def gcol(k: str) -> float:
            c = col_map.get(k)
            if c is None or c >= len(row):
                return 0.0
            return _safe_float(row[c])

        cur   = gcol('current')
        d130  = gcol('1_30')
        d3160 = gcol('31_60')
        d60p  = gcol('60_plus')
        tot   = gcol('total') if 'total' in col_map else cur + d130 + d3160 + d60p

        all_zero = cur == 0 and d130 == 0 and d3160 == 0 and d60p == 0
        if all_zero:
            continue  # header/grouping row — skip

        has_credit = any(v < 0 for v in [cur, d130, d3160, d60p])

        results.append({
            "vendor_name":  label_raw,
            "current":      cur,
            "days_1_30":    d130,
            "days_31_60":   d3160,
            "days_60_plus": d60p,
            "total":        tot,
            "has_credit":   has_credit,
        })

    return {
        "rows": results,
        "skipped_subtotals": skipped,
        "error": None,
    }


def normalize_vendor_name(name: str) -> str:
    """Normalize vendor name for matching — same discipline as unit matching."""
    return re.sub(r'\s+', ' ', name.strip().lower())


def match_vendor(vendor_name: str, existing_vendors: List[Dict]) -> Optional[str]:
    """
    Try to match a parsed vendor name to an existing r_vendors record.
    Returns vendor_id (str) or None.
    existing_vendors: [{"id": str, "vendor_name": str}]
    """
    norm = normalize_vendor_name(vendor_name)
    for v in existing_vendors:
        if normalize_vendor_name(v["vendor_name"]) == norm:
            return v["id"]
    # Partial/contains match as fallback
    for v in existing_vendors:
        vn = normalize_vendor_name(v["vendor_name"])
        if vn and (vn in norm or norm in vn):
            return v["id"]
    return None
