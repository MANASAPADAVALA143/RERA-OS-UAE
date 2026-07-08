"""Mirror of frontend periodWindow trailing-month helpers (logic parity check)."""


def month_key_from_parts(month: int, year: int) -> str:
    months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return f"{months[month - 1]} {year}"


def get_trailing_month_keys(end_month: int, end_year: int, count: int) -> list[str]:
    out = []
    for i in range(count):
        offset = count - 1 - i
        m = end_month - offset
        y = end_year
        while m < 1:
            m += 12
            y -= 1
        out.append(month_key_from_parts(m, y))
    return out


def trailing_months_with_data(end_month, end_year, count, data_months):
    ideal = get_trailing_month_keys(end_month, end_year, count)
    data_set = set(data_months)
    matched = [k for k in ideal if k in data_set]
    return matched if matched else ideal


def test_trailing_march_2026():
    keys = get_trailing_month_keys(3, 2026, 6)
    assert keys == [
        'Oct 2025', 'Nov 2025', 'Dec 2025',
        'Jan 2026', 'Feb 2026', 'Mar 2026',
    ]


def test_trailing_june_2026():
    keys = get_trailing_month_keys(6, 2026, 6)
    assert keys == [
        'Jan 2026', 'Feb 2026', 'Mar 2026',
        'Apr 2026', 'May 2026', 'Jun 2026',
    ]


def test_partial_data_early_range():
    data = ['Dec 2025', 'Jan 2026', 'Feb 2026']
    keys = trailing_months_with_data(2, 2026, 6, data)
    assert keys == ['Dec 2025', 'Jan 2026', 'Feb 2026']
