import json

import sys

from pathlib import Path



sys.path.insert(0, str(Path(__file__).resolve().parents[1]))



from services.real_estate_calculations import cost_overrun

from scripts.scottsdale_import import prepare_seed_from_raw, verify_seed_data



data = prepare_seed_from_raw()

checks = verify_seed_data(data)

divs = data["divisions"]

total_b = sum(d["budgeted_cost"] for d in divs)

total_a = sum(d["actual_cost_to_date"] for d in divs)

total_c = sum(d["committed_cost"] for d in divs)

ov = cost_overrun(total_b, total_a, total_c)

print(f"SOV Budget: ${total_b:,.0f}  Actual: ${total_a:,.0f}  Committed: ${total_c:,.0f}")

print(f"Variance: {ov['overrun_pct'] * 100:.2f}%  Status: {ov['status']}")

print(f"ROI: {checks['roi']:.1%}  MOIC: {checks['moic']:.2f}x")

for d in divs:

    o = cost_overrun(d["budgeted_cost"], d["actual_cost_to_date"], d["committed_cost"])

    if o["status"] != "on_track":

        print(f"  {o['status']:12} {d['csi_division_code']} {d['division_label']} {o['overrun_pct'] * 100:.1f}%")

