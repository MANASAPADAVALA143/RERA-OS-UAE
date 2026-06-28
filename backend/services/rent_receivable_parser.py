"""
Rent Receivable Excel Parser
Handles all 10 company sheet formats including:
- ABC LLC: Sl.No in col B, unit in col C, multiple suites per sheet
- TOWN Houses: LLC name in col B, unit in col C, direct month cols
- BNC LLC: Two blocks (2025 + 2026) in same sheet, Sl.No in col A
- XYZ LLC: Sl.No in col A, unit in col B, months may include 2025 dates
- All others: Standard format with Sl.No in col B, unit in col C
"""

import openpyxl
from datetime import datetime
from typing import Dict, List, Optional, Tuple


def count_physical_units(unit_name: str) -> int:
    """
    Count physical units from a combined row label.
    Examples:
      'Unit E, F, G'  -> 3
      'Unit J, K, L'  -> 3
      'Unit R & S'    -> 2
      'Unit J,L,M & S'-> 4
      'Unit E & F'    -> 2
      'Unit A'        -> 1
    """
    name = str(unit_name).strip()
    if ',' in name or '&' in name:
        parts = [p.strip() for p in name.replace('&', ',').split(',')]
        parts = [p for p in parts if p]
        return max(1, len(parts))
    return 1


def find_month_columns(rows: list) -> Dict[str, int]:
    """
    Scan all rows to find column indices for each YYYY-MM.
    Returns dict like {'2026-01': 3, '2026-02': 5, ...}
    Handles any column position.
    Prioritizes 2026 dates over 2025 dates for same month.
    """
    month_cols = {}
    for row in rows[:60]:
        for j, val in enumerate(row):
            if isinstance(val, datetime):
                key = val.strftime('%Y-%m')
                if key not in month_cols:
                    month_cols[key] = j
                elif val.year > datetime.strptime(key, '%Y-%m').year:
                    month_cols[key] = j
    return month_cols


def get_latest_available_month(month_cols: Dict[str, int]) -> Tuple[Optional[str], Optional[str]]:
    """
    Get the latest month with data and the one before it.
    Prefers 2026 months over 2025.
    """
    sorted_months = sorted(month_cols.keys())
    months_2026 = [m for m in sorted_months if m.startswith('2026')]

    if months_2026:
        latest = months_2026[-1]
        prev_idx = sorted_months.index(latest) - 1
        prev = sorted_months[prev_idx] if prev_idx >= 0 else None
        return latest, prev

    if sorted_months:
        latest = sorted_months[-1]
        prev_idx = sorted_months.index(latest) - 1
        prev = sorted_months[prev_idx] if prev_idx >= 0 else None
        return latest, prev

    return None, None


def is_unit_row(row: tuple, col_b_is_slno: bool = True) -> bool:
    """
    Detect if a row is a unit data row (not header, total, or blank).
    col_b_is_slno: True for most sheets where col B has Sl.No
                   False for TOWN Houses where col B has LLC name
    """
    if col_b_is_slno:
        b_val = row[1] if len(row) > 1 else None
        c_val = row[2] if len(row) > 2 else None
        if (b_val is not None and
                isinstance(b_val, (int, float)) and
                float(b_val) == int(float(b_val)) and
                1 <= int(float(b_val)) <= 50 and
                c_val is not None and
                str(c_val).strip() and
                len(str(c_val).strip()) >= 1):
            name = str(c_val).strip().lower()
            if any(x in name for x in ['sl.no', 'name of', 'particulars',
                                        'total', 'rent', 'sec dep', 'other work']):
                return False
            return True
    else:
        b_val = row[1] if len(row) > 1 else None
        c_val = row[2] if len(row) > 2 else None
        if (b_val is not None and str(b_val).strip() and
                c_val is not None and str(c_val).strip() and
                'unit' in str(c_val).strip().lower()):
            return True
    return False


def is_unit_row_col_a(row: tuple) -> bool:
    """For sheets where Sl.No is in col A (BNC LLC, XYZ LLC)."""
    a_val = row[0] if len(row) > 0 else None
    b_val = row[1] if len(row) > 1 else None
    if (a_val is not None and
            isinstance(a_val, (int, float)) and
            float(a_val) == int(float(a_val)) and
            1 <= int(float(a_val)) <= 50 and
            b_val is not None and
            str(b_val).strip() and
            len(str(b_val).strip()) >= 1):
        name = str(b_val).strip().lower()
        if any(x in name for x in ['name of', 'total', 'rent', 'sec dep']):
            return False
        return True
    return False


def get_amount(row: tuple, col: int) -> float:
    """Safely get numeric amount from row at column index."""
    try:
        if col < len(row) and row[col] is not None:
            val = row[col]
            if isinstance(val, str):
                val = val.replace('$', '').replace(',', '').strip()
                if '=' in val or 'SD' in val.upper():
                    return 0.0
            return float(val)
    except (ValueError, TypeError):
        pass
    return 0.0


def detect_sheet_format(rows: list) -> str:
    """
    Detect which format a sheet uses.
    Returns: 'standard' | 'town_houses' | 'col_a_slno'
    """
    for row in rows[:10]:
        if (len(row) > 2 and row[1] and
                isinstance(row[1], str) and
                'LLC' in str(row[1]).upper() and
                row[2] and 'unit' in str(row[2]).lower()):
            return 'town_houses'

        if (row[0] is not None and
                isinstance(row[0], (int, float)) and
                1 <= int(float(row[0])) <= 50 and
                row[1] and str(row[1]).strip() and
                'unit' in str(row[1]).lower()):
            return 'col_a_slno'

    return 'standard'


def parse_sheet(ws, sheet_name: str) -> Dict:
    """
    Parse a single company sheet and return unit data.
    Handles all format variants automatically.
    """
    rows = list(ws.iter_rows(values_only=True))
    co_name = sheet_name.strip()

    month_cols = find_month_columns(rows)

    if not month_cols:
        return {
            'company': co_name,
            'error': 'no month columns found',
            'units': [],
            'monthly_totals': {},
            'collected': 0,
            'vacant_count': 0,
            'occupied_count': 0,
            'total_physical_units': 0,
            'vacancy_loss': 0,
        }

    latest_month, prev_month = get_latest_available_month(month_cols)
    latest_col = month_cols.get(latest_month) if latest_month else None
    prev_col = month_cols.get(prev_month) if prev_month else None
    history_months = sorted([m for m in month_cols.keys() if '2026' in m])

    fmt = detect_sheet_format(rows)
    units = []

    if fmt == 'town_houses':
        for row in rows[3:]:
            if not row or len(row) < 3:
                continue
            if not row[1] or not row[2]:
                continue
            if not str(row[2]).strip():
                continue
            if 'unit' not in str(row[2]).lower():
                continue

            unit_name = str(row[2]).strip()
            llc_name = str(row[1]).strip()
            jun_amt = get_amount(row, latest_col) if latest_col is not None else 0
            prev_amt = get_amount(row, prev_col) if prev_col is not None else 0

            history = {}
            for m in history_months:
                history[m] = get_amount(row, month_cols[m])

            last_non_zero = 0
            for m in reversed(history_months[:-1]):
                v = history.get(m, 0)
                if v > 0:
                    last_non_zero = v
                    break

            phys = count_physical_units(unit_name)
            is_vacant = jun_amt == 0

            units.append({
                'name': unit_name,
                'sub_entity': llc_name,
                'physical_units': phys,
                'current_amount': jun_amt,
                'prev_amount': prev_amt,
                'is_vacant': is_vacant,
                'vacancy_loss': last_non_zero if is_vacant else 0,
                'history': history,
            })

    elif fmt == 'col_a_slno':
        block_2026_start = 0
        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                if isinstance(val, datetime) and val.year == 2026:
                    block_2026_start = i
                    break
            if block_2026_start > 0:
                break

        for row in rows[block_2026_start:]:
            if not is_unit_row_col_a(row):
                continue

            unit_name = str(row[1]).strip()
            jun_amt = get_amount(row, latest_col) if latest_col is not None else 0
            prev_amt = get_amount(row, prev_col) if prev_col is not None else 0

            history = {}
            for m in history_months:
                history[m] = get_amount(row, month_cols[m])

            last_non_zero = 0
            for m in reversed(history_months[:-1]):
                v = history.get(m, 0)
                if v > 0:
                    last_non_zero = v
                    break

            phys = count_physical_units(unit_name)
            is_vacant = jun_amt == 0

            units.append({
                'name': unit_name,
                'sub_entity': None,
                'physical_units': phys,
                'current_amount': jun_amt,
                'prev_amount': prev_amt,
                'is_vacant': is_vacant,
                'vacancy_loss': last_non_zero if is_vacant else 0,
                'history': history,
            })

    else:
        current_suite = co_name
        for row in rows:
            if len(row) < 3:
                continue

            if (row[1] is None and row[2] is None and
                    len(row) > 3 and row[3] is not None and
                    isinstance(row[3], str) and
                    len(str(row[3]).strip()) > 2 and
                    not isinstance(row[3], datetime)):
                current_suite = str(row[3]).strip()
                continue

            if not is_unit_row(row, col_b_is_slno=True):
                continue

            unit_name = str(row[2]).strip()
            jun_amt = get_amount(row, latest_col) if latest_col is not None else 0
            prev_amt = get_amount(row, prev_col) if prev_col is not None else 0

            history = {}
            for m in history_months:
                history[m] = get_amount(row, month_cols[m])

            last_non_zero = 0
            for m in reversed(history_months[:-1]):
                v = history.get(m, 0)
                if v > 0:
                    last_non_zero = v
                    break

            phys = count_physical_units(unit_name)
            is_vacant = jun_amt == 0

            units.append({
                'name': unit_name,
                'suite': current_suite,
                'physical_units': phys,
                'current_amount': jun_amt,
                'prev_amount': prev_amt,
                'is_vacant': is_vacant,
                'vacancy_loss': last_non_zero if is_vacant else 0,
                'history': history,
            })

    # Deduplicate units by name
    seen: Dict[str, bool] = {}
    unique_units = []
    for u in units:
        key = u['name']
        if key not in seen:
            seen[key] = True
            unique_units.append(u)

    total_physical = sum(u['physical_units'] for u in unique_units)
    occupied_physical = sum(u['physical_units'] for u in unique_units if not u['is_vacant'])
    vacant_physical = sum(u['physical_units'] for u in unique_units if u['is_vacant'])
    collected = sum(u['current_amount'] for u in unique_units)
    vacancy_loss = sum(u['vacancy_loss'] for u in unique_units)

    monthly_totals: Dict[str, float] = {}
    for m in history_months:
        monthly_totals[m] = sum(u['history'].get(m, 0) for u in unique_units)

    return {
        'company': co_name,
        'units': unique_units,
        'monthly_totals': monthly_totals,
        'current_month': latest_month,
        'collected': collected,
        'total_physical_units': total_physical,
        'occupied_count': occupied_physical,
        'vacant_count': vacant_physical,
        'occupancy_rate': round(occupied_physical / total_physical * 100, 1) if total_physical > 0 else 0,
        'vacancy_loss': vacancy_loss,
    }


def parse_rent_receivable_file(file_path: str) -> Dict:
    """
    Main entry point. Parse entire Rent Receivable Excel file.
    Returns dict with all company data + portfolio summary.
    """
    wb = openpyxl.load_workbook(file_path, read_only=False, data_only=True)

    results: Dict[str, Dict] = {}
    skipped: List[str] = []

    for sheet_name in wb.sheetnames:
        co_name = sheet_name.strip()

        if co_name.startswith('Sheet') or co_name == '12':
            skipped.append(sheet_name)
            continue

        ws = wb[sheet_name]
        data = parse_sheet(ws, sheet_name)

        if 'error' not in data and data['total_physical_units'] > 0:
            results[co_name] = data
        elif 'error' in data:
            skipped.append(f"{sheet_name}: {data['error']}")

    portfolio = {
        'total_units': sum(d['total_physical_units'] for d in results.values()),
        'occupied': sum(d['occupied_count'] for d in results.values()),
        'vacant': sum(d['vacant_count'] for d in results.values()),
        'total_collected': sum(d['collected'] for d in results.values()),
        'total_vacancy_loss': sum(d['vacancy_loss'] for d in results.values()),
        'companies_parsed': len(results),
        'skipped': skipped,
    }

    if portfolio['total_units'] > 0:
        portfolio['occupancy_rate'] = round(
            portfolio['occupied'] / portfolio['total_units'] * 100, 1
        )
    else:
        portfolio['occupancy_rate'] = 0

    return {
        'companies': results,
        'portfolio': portfolio,
    }
