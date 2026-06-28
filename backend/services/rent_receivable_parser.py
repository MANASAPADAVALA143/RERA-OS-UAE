"""
Standardized Rent Receivable Parser
Reads EstateCFO_Rent_Template_ByCompany.xlsx
Simple, reliable — no format detection needed.

Sheet structure (fixed, never changes):
  Row 1: Title
  Row 2: Instructions
  Row 3: Headers → "Unit Name" | "Jan-2026" | ... | "Dec-2026" | "Jun Total"
  Row 4+: Unit rows
  Last row: "TOTAL" (skipped)
"""

import openpyxl
from typing import Dict, List, Optional

MONTHS = [
    'Jan-2026', 'Feb-2026', 'Mar-2026', 'Apr-2026',
    'May-2026', 'Jun-2026', 'Jul-2026', 'Aug-2026',
    'Sep-2026', 'Oct-2026', 'Nov-2026', 'Dec-2026',
]


def count_physical_units(unit_name: str) -> int:
    """'Unit E,F,G' → 3;  'Unit R & S' → 2;  'Unit A' → 1"""
    name = str(unit_name)
    if ',' in name or '&' in name:
        parts = [p.strip() for p in name.replace('&', ',').split(',') if p.strip()]
        return max(1, len(parts))
    return 1


def safe_float(val) -> float:
    if val is None:
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def is_unit_row(row) -> bool:
    """Skip TOTAL, stats rows, blank rows, and the header row."""
    if not row[0]:
        return False
    name = str(row[0]).strip()
    if not name:
        return False
    if name.upper() == 'TOTAL':
        return False
    if name == 'Unit Name':
        return False
    # Skip stats summary rows like "Jun 2026 — Occupied: 19..."
    if '—' in name or '–' in name or 'Occupied' in name or 'Collected' in name:
        return False
    return True


def parse_sheet(ws, sheet_name: str, target_month: str) -> Dict:
    """Parse one company sheet. target_month e.g. 'Jun-2026'."""
    rows = list(ws.iter_rows(values_only=True))
    co_name = sheet_name.strip()

    # Find header row: col A = "Unit Name"
    hdr_row_idx: Optional[int] = None
    for i, row in enumerate(rows[:6]):
        if row[0] == 'Unit Name':
            hdr_row_idx = i
            break

    if hdr_row_idx is None:
        return {
            'company': co_name, 'error': 'header not found',
            'units': [], 'monthly_totals': {}, 'collected': 0,
            'gross_potential': 0, 'total_physical_units': 0,
            'occupied_count': 0, 'vacant_count': 0,
            'occupancy_rate': 0, 'vacancy_loss': 0, 'vacant_units': [],
        }

    # Map month label → column index
    hdr = rows[hdr_row_idx]
    month_col_map: Dict[str, int] = {}
    for j, val in enumerate(hdr):
        if val and str(val).strip() in MONTHS:
            month_col_map[str(val).strip()] = j

    if not month_col_map:
        return {
            'company': co_name, 'error': 'no month columns found',
            'units': [], 'monthly_totals': {}, 'collected': 0,
            'gross_potential': 0, 'total_physical_units': 0,
            'occupied_count': 0, 'vacant_count': 0,
            'occupancy_rate': 0, 'vacancy_loss': 0, 'vacant_units': [],
        }

    # Resolve target column
    tgt = target_month
    if tgt not in month_col_map:
        available = sorted(month_col_map.keys(), key=lambda m: MONTHS.index(m) if m in MONTHS else 99)
        tgt = available[-1] if available else None

    target_col = month_col_map.get(tgt) if tgt else None

    # Sorted months for vacancy-loss lookback
    sorted_months = sorted(month_col_map.keys(), key=lambda m: MONTHS.index(m) if m in MONTHS else 99)

    # Parse unit rows
    units: List[Dict] = []
    for row in rows[hdr_row_idx + 1:]:
        if not is_unit_row(row):
            continue

        unit_name = str(row[0]).strip()
        current_amt = safe_float(row[target_col]) if target_col is not None else 0.0
        is_vacant = current_amt == 0

        history = {m: safe_float(row[col]) for m, col in month_col_map.items()}

        vacancy_loss = 0.0
        if is_vacant and tgt and tgt in sorted_months:
            target_idx = sorted_months.index(tgt)
            for prev_m in reversed(sorted_months[:target_idx]):
                prev_amt = history.get(prev_m, 0)
                if prev_amt > 0:
                    vacancy_loss = prev_amt
                    break

        units.append({
            'name': unit_name,
            'physical_units': count_physical_units(unit_name),
            'current_amount': current_amt,
            'is_vacant': is_vacant,
            'vacancy_loss': vacancy_loss,
            'history': history,
        })

    # Fill vacancy_loss = 0 gaps with suite average of occupied units
    occupied_units = [u for u in units if not u['is_vacant']]
    if occupied_units:
        suite_avg = sum(u['current_amount'] for u in occupied_units) / len(occupied_units)
        for u in units:
            if u['is_vacant'] and u['vacancy_loss'] == 0:
                u['vacancy_loss'] = round(suite_avg)

    total_physical = sum(u['physical_units'] for u in units)
    occupied_physical = sum(u['physical_units'] for u in units if not u['is_vacant'])
    vacant_physical = sum(u['physical_units'] for u in units if u['is_vacant'])
    collected = sum(u['current_amount'] for u in units)
    vacancy_loss_total = sum(u['vacancy_loss'] for u in units)

    monthly_totals = {m: sum(u['history'].get(m, 0) for u in units) for m in sorted_months}
    gross_potential = max(monthly_totals.values()) if monthly_totals else collected

    return {
        'company': co_name,
        'units': units,
        'monthly_totals': monthly_totals,
        'target_month': tgt,
        'collected': collected,
        'gross_potential': gross_potential,
        'total_physical_units': total_physical,
        'occupied_count': occupied_physical,
        'vacant_count': vacant_physical,
        'occupancy_rate': round(occupied_physical / total_physical * 100, 1) if total_physical > 0 else 0,
        'vacancy_loss': vacancy_loss_total,
        'vacant_units': [u['name'] for u in units if u['is_vacant']],
    }


def parse_rent_receivable_file(file_path: str, target_month: str = 'Jun-2026') -> Dict:
    """
    Main entry point.
    target_month: 'Mon-YYYY' matching the template header (e.g. 'Jun-2026').
    """
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)

    results: Dict[str, Dict] = {}
    skipped: List[str] = []

    for sheet_name in wb.sheetnames:
        co_name = sheet_name.strip()
        if co_name == 'SUMMARY':
            continue

        ws = wb[sheet_name]
        data = parse_sheet(ws, sheet_name, target_month)

        if 'error' in data:
            skipped.append(f"{co_name}: {data['error']}")
        elif data['total_physical_units'] > 0:
            results[co_name] = data
        else:
            skipped.append(f"{co_name}: no units found")

    total_units = sum(d['total_physical_units'] for d in results.values())
    total_occupied = sum(d['occupied_count'] for d in results.values())
    total_vacant = sum(d['vacant_count'] for d in results.values())
    total_collected = sum(d['collected'] for d in results.values())
    total_gross = sum(d['gross_potential'] for d in results.values())
    total_vacancy_loss = sum(d['vacancy_loss'] for d in results.values())

    portfolio_monthly = {
        m: sum(d['monthly_totals'].get(m, 0) for d in results.values())
        for m in MONTHS
    }

    portfolio = {
        'target_month': target_month,
        'total_units': total_units,
        'occupied': total_occupied,
        'vacant': total_vacant,
        'total_collected': total_collected,
        'gross_potential': total_gross,
        'total_vacancy_loss': total_vacancy_loss,
        'collection_rate': round(total_collected / total_gross * 100, 1) if total_gross > 0 else 0,
        'occupancy_rate': round(total_occupied / total_units * 100, 1) if total_units > 0 else 0,
        'monthly_totals': portfolio_monthly,
        'companies_parsed': len(results),
        'skipped': skipped,
    }

    return {'companies': results, 'portfolio': portfolio}
