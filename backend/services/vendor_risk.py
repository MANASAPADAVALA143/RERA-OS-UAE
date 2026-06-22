"""
Rental vendor risk calculations.
Calls the shared vendor_concentration() from real_estate_calculations —
not a second copy of the same logic.
"""
from __future__ import annotations

from services.real_estate_calculations import vendor_concentration


def vendor_risk_summary(
    vendors: list[dict],
    ap_by_vendor: dict[str, float],
    maintenance_by_vendor: dict[str, dict],
    total_ap: float,
) -> list[dict]:
    """
    Combines AP exposure per vendor with maintenance volume/repeat-issue signals.
    A vendor with high AP exposure AND high repeat-issue maintenance requests is a
    compounding risk signal surfaced together, not on two separate pages.

    Returns list sorted by combined risk: concentration flag first, then repeat issues,
    then raw AP amount.
    """
    conc = vendor_concentration(ap_by_vendor, total_ap)
    pct_map = {item["vendor_name"]: item["pct"] for item in conc["breakdown"]}

    result = []
    for v in vendors:
        name = v["vendor_name"]
        ap_amount = ap_by_vendor.get(name, 0.0)
        pct = pct_map.get(name, 0.0)
        maint = maintenance_by_vendor.get(name, {"open_count": 0, "repeat_issues": False})
        result.append({
            "vendor_id": v["id"],
            "vendor_name": name,
            "vendor_category": v.get("vendor_category"),
            "total_ap_owed": round(ap_amount, 2),
            "pct_of_total_payable": round(pct, 4),
            "concentration_flag": pct > 0.25,
            "open_maintenance_requests": maint["open_count"],
            "repeat_issues_flag": maint["repeat_issues"],
            "last_payment_date": v.get("last_payment_date"),
        })

    result.sort(key=lambda x: (
        -int(x["concentration_flag"]),
        -int(x["repeat_issues_flag"]),
        -x["total_ap_owed"],
    ))
    return result
