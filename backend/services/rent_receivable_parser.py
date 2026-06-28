"""
Rent Receivable Excel Parser
Handles all 10 company sheet formats:
- ABC LLC: Sl.No in col B, unit in col C, multiple suites per sheet
- TOWN Houses: LLC name in col B, unit in col C, direct month cols
- BNC LLC: Two blocks (2025+2026) in same sheet, Sl.No in col A
- XYZ LLC: Sl.No in col A, unit in col B
- All others: Standard format with Sl.No in col B, unit in col C

Vacancy logic:
  target_month column = $0  →  VACANT
    look back through all prior months in the file
    first prior month with $ > 0  →  vacancy_loss = that amount
    if all prior months = $0  →  vacancy_loss = suite average of occupied units
"""

import openpyxl
from datetime import datetime
from typing import Dict, List, Optional, Tuple


def count_physical_units(unit_name: str) -> int:
    """'Unit E, F, G' → 3;  'Unit E & F' → 2;  'Unit A' → 1"""
    name = str(unit_name).strip()
    if ',' in name or '&' in name:
        parts = [p.strip() for p in name.replace('&', ',').split(',')]
        parts = [p for p in parts if p]
        return max(1, len(parts))
    return 1


def find_month_columns(rows: list) -> Dict[str, int]:
    """
    Scan first 60 rows and return {YYYY-MM: col_index}.
    When the same YYYY-MM appears more than once (e.g. 2026-06 in both a
    2025 block and a 2026 block) keep the later year's column.
    """
    month_cols: Dict[str, int] = {}
    for row in rows[:60]:
        for j, val in enumerate(row):
            if isinstance(val, datetime):
                key = val.strftime('%Y-%m')
                if key not in month_cols:
                    month_cols[key] = j
                elif val.year > datetime.strptime(key, '%Y-%m').year:
                    month_cols[key] = j
    return month_cols


def is_unit_row(row: tuple, col_b_is_slno: bool = True) -> bool:
    if col_b_is_slno:
        b_val = row[1] if len(row) > 1 else None
        c_val = row[2] if len(row) > 2 else None
        if (b_val is not None and
                isinstance(b_val, (int, float)) and
                float(b_val) == int(float(b_val)) and
                1 <= int(float(b_val)) <= 50 and
                c_val is not None and str(c_val).strip()):
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
    a_val = row[0] if len(row) > 0 else None
    b_val = row[1] if len(row) > 1 else None
    if (a_val is not None and
            isinstance(a_val, (int, float)) and
            float(a_val) == int(float(a_val)) and
            1 <= int(float(a_val)) <= 50 and
            b_val is not None and str(b_val).strip()):
        name = str(b_val).strip().lower()
        if any(x in name for x in ['name of', 'total', 'rent', 'sec dep']):
            return False
        return True
    return False


def get_amount(row: tuple, col: int) -> float:
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
    for row in rows[:10]:
        if (len(row) > 2 and row[1] and
                isinstance(row[1], str) and 'LLC' in str(row[1]).upper() and
                row[2] and 'unit' in str(row[2]).lower()):
            return 'town_houses'
        if (row[0] is not None and
                isinstance(row[0], (int, float)) and
                1 <= int(float(row[0])) <= 50 and
                row[1] and str(row[1]).strip() and
                'unit' in str(row[1]).lower()):
            return 'col_a_slno'
    return 'standard'


def _vacancy_loss_lookback(row: tuple, prev_months: List[str],
                            month_cols: Dict[str, int]) -> float:
    """Walk backwards through prev_months; return first non-zero amount found."""
    for m in reversed(prev_months):
        col = month_cols.get(m)
        if col is None:
            continue
        amt = get_amount(row, col)
        if amt > 0:
            return amt
    return 0.0


def parse_sheet(ws, sheet_name: str, target_month: Optional[str] = None) -> Dict:
    rows = list(ws.iter_rows(values_only=True))
    co_name = sheet_name.strip()

    month_cols = find_month_columns(rows)
    if not month_cols:
        return {
            'company': co_name, 'error': 'no month columns found',
            'units': [], 'monthly_totals': {}, 'collected': 0,
            'vacant_count': 0, 'occupied_count': 0,
            'total_physical_units': 0, 'vacancy_loss': 0,
        }

    all_months_sorted = sorted(month_cols.keys())

    # Resolve the target column
    if target_month and target_month in month_cols:
        current_month = target_month
        target_col = month_cols[target_month]
    else:
        # Fallback: latest 2026 month, then latest any month
        months_2026 = [m for m in all_months_sorted if m.startswith('2026')]
        current_month = months_2026[-1] if months_2026 else all_months_sorted[-1]
        target_col = month_cols[current_month]

    # All months BEFORE the target (for vacancy-loss lookback)
    target_idx = all_months_sorted.index(current_month) if current_month in all_months_sorted else -1
    prev_months = all_months_sorted[:target_idx] if target_idx > 0 else []

    fmt = detect_sheet_format(rows)
    units: List[Dict] = []

    # ── TOWN Houses format ────────────────────────────────────────────────────
    if fmt == 'town_houses':
        for row in rows[3:]:
            if not row or len(row) < 3:
                continue
            if not row[2] or not str(row[2]).strip():
                continue
            if 'unit' not in str(row[2]).lower():
                continue

            unit_name = str(row[2]).strip()
            current_amt = get_amount(row, target_col)
            is_vacant = current_amt == 0

            vac_loss = 0.0
            if is_vacant:
                vac_loss = _vacancy_loss_lookback(row, prev_months, month_cols)

            history = {m: get_amount(row, col) for m, col in month_cols.items()}

            units.append({
                'name': unit_name,
                'sub_entity': str(row[1]).strip() if row[1] else None,
                'physical_units': count_physical_units(unit_name),
                'current_amount': current_amt,
                'is_vacant': is_vacant,
                'vacancy_loss': vac_loss,
                'history': history,
            })

    # ── Col-A Sl.No format (BNC LLC, XYZ LLC) ────────────────────────────────
    # BNC LLC has TWO property blocks in one sheet. Only use the block whose
    # header row contains the target month column.
    elif fmt == 'col_a_slno':
        # Step 1: find every header row that contains the target month date
        candidate_blocks: List[Dict] = []
        for i, row in enumerate(rows):
            for j, val in enumerate(row):
                if isinstance(val, datetime) and val.strftime('%Y-%m') == (target_month or current_month):
                    candidate_blocks.append({'row': i, 'target_col': j})
                    break

        # Fallback: if target month not found in any header, use the first
        # header row that has any 2026 date (original behaviour)
        if not candidate_blocks:
            for i, row in enumerate(rows):
                for j, val in enumerate(row):
                    if isinstance(val, datetime) and val.year == 2026:
                        candidate_blocks.append({'row': i, 'target_col': j})
                        break
                if candidate_blocks:
                    break

        if not candidate_blocks:
            # No usable block found — return empty
            pass
        else:
            best = candidate_blocks[0]
            block_header_row: int = best['row']
            block_target_col: int = best['target_col']

            # Build month_cols from THIS block's header row only
            block_month_cols: Dict[str, int] = {}
            for j, val in enumerate(rows[block_header_row]):
                if isinstance(val, datetime):
                    block_month_cols[val.strftime('%Y-%m')] = j

            # Previous months within this block for vacancy-loss lookback
            bm_sorted = sorted(block_month_cols.keys())
            t_key = target_month or current_month
            b_target_idx = bm_sorted.index(t_key) if t_key in bm_sorted else -1
            block_prev_months = bm_sorted[:b_target_idx] if b_target_idx > 0 else []

            # Find end of this block: stop at TOTAL/RENT summary or next block header
            block_end = len(rows)
            for i in range(block_header_row + 1, len(rows)):
                row = rows[i]
                # Row has a datetime in it → next block header
                if any(isinstance(v, datetime) for v in row if v is not None):
                    block_end = i
                    break
                # Non-unit row with a non-numeric label in col B → property name row
                b = row[1] if len(row) > 1 else None
                if (b is not None and not isinstance(b, (int, float)) and
                        str(b).strip() and
                        'unit' not in str(b).strip().lower() and
                        str(b).strip().lower() not in ('sl.no', 'slno', 'sl no') and
                        i > block_header_row + 8):
                    block_end = i
                    break

            # Parse unit rows in this block only
            for row in rows[block_header_row + 1: block_end]:
                if not is_unit_row_col_a(row):
                    continue
                unit_name = str(row[1]).strip()
                current_amt = get_amount(row, block_target_col)
                is_vacant = current_amt == 0

                vac_loss = 0.0
                if is_vacant:
                    vac_loss = _vacancy_loss_lookback(row, block_prev_months, block_month_cols)

                history = {m: get_amount(row, col) for m, col in block_month_cols.items()}

                units.append({
                    'name': unit_name,
                    'physical_units': count_physical_units(unit_name),
                    'current_amount': current_amt,
                    'is_vacant': is_vacant,
                    'vacancy_loss': vac_loss,
                    'history': history,
                })

    # ── Standard format (ABC LLC, DEC LLC, ZYC LLC, etc.) ────────────────────
    else:
        for row in rows:
            if len(row) < 3:
                continue
            if not is_unit_row(row, col_b_is_slno=True):
                continue
            unit_name = str(row[2]).strip()
            current_amt = get_amount(row, target_col)
            is_vacant = current_amt == 0

            vac_loss = 0.0
            if is_vacant:
                vac_loss = _vacancy_loss_lookback(row, prev_months, month_cols)

            history = {m: get_amount(row, col) for m, col in month_cols.items()}

            units.append({
                'name': unit_name,
                'physical_units': count_physical_units(unit_name),
                'current_amount': current_amt,
                'is_vacant': is_vacant,
                'vacancy_loss': vac_loss,
                'history': history,
            })

    # ── Post-processing ───────────────────────────────────────────────────────

    # Deduplicate by name
    seen: set = set()
    unique_units = []
    for u in units:
        if u['name'] not in seen:
            seen.add(u['name'])
            unique_units.append(u)

    # Fill vacancy loss = 0 gaps with suite average of occupied units
    occupied_units = [u for u in unique_units if not u['is_vacant']]
    if occupied_units:
        suite_avg = round(
            sum(u['current_amount'] for u in occupied_units) / len(occupied_units)
        )
        for u in unique_units:
            if u['is_vacant'] and u['vacancy_loss'] == 0:
                u['vacancy_loss'] = suite_avg

    # Aggregate
    total_physical = sum(u['physical_units'] for u in unique_units)
    occupied_physical = sum(u['physical_units'] for u in unique_units if not u['is_vacant'])
    vacant_physical = sum(u['physical_units'] for u in unique_units if u['is_vacant'])
    collected = sum(u['current_amount'] for u in unique_units)
    vacancy_loss_total = sum(u['vacancy_loss'] for u in unique_units)

    monthly_totals = {
        m: sum(u['history'].get(m, 0) for u in unique_units)
        for m in month_cols
    }

    return {
        'company': co_name,
        'units': unique_units,
        'monthly_totals': monthly_totals,
        'current_month': current_month,
        'collected': collected,
        'total_physical_units': total_physical,
        'occupied_count': occupied_physical,
        'vacant_count': vacant_physical,
        'occupancy_rate': (
            round(occupied_physical / total_physical * 100, 1)
            if total_physical > 0 else 0
        ),
        'vacancy_loss': vacancy_loss_total,
    }


def parse_rent_receivable_file(file_path: str,
                                target_month: Optional[str] = None) -> Dict:
    """
    Main entry point.
    target_month: 'YYYY-MM' (e.g. '2026-06') — determines vacancy status.
    All months in the file are used for vacancy-loss lookback.
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
        data = parse_sheet(ws, sheet_name, target_month=target_month)

        if 'error' not in data and data.get('total_physical_units', 0) > 0:
            results[co_name] = data
        else:
            skipped.append(f"{sheet_name}: {data.get('error', 'no units found')}")

    portfolio: Dict = {
        'total_units': sum(d['total_physical_units'] for d in results.values()),
        'occupied': sum(d['occupied_count'] for d in results.values()),
        'vacant': sum(d['vacant_count'] for d in results.values()),
        'total_collected': sum(d['collected'] for d in results.values()),
        'total_vacancy_loss': sum(d['vacancy_loss'] for d in results.values()),
        'companies_parsed': len(results),
        'skipped': skipped,
        'target_month': target_month,
    }

    portfolio['occupancy_rate'] = (
        round(portfolio['occupied'] / portfolio['total_units'] * 100, 1)
        if portfolio['total_units'] > 0 else 0
    )

    return {'companies': results, 'portfolio': portfolio}
