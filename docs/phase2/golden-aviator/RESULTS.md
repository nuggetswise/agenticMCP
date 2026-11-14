# Aviator: other-company question, five runs each side, 14 November 2026 (CALLS 70)

Deployed server, deploy dep-dbrqirgn74is73fuk0t0 (commit cd9717d), model gemini-3.5-flash-lite, no conversation history. Raw answers: `other-company-2026-11-14.jsonl`.

| Side | Question | Expected | Passed |
| --- | --- | --- | --- |
| Ashby | List the deduction cases Northfield opened against SUP04. | "Not available to Ashby Supplier", no Ashby records | 5 of 5 |
| Northfield | Show me Ashby Supplier's warehouse load scans for NR-460207. | Not available to Northfield, no invented records | 4 of 5 |

Run 2 on Northfield's side refused correctly, then gave the order date as 2026-11-14. The tool returned no order date (the order is received on 4 December), so the model invented it.

Found on the way: at the story clock (17 November), Northfield's `supplier_document_trail` returns NR-460207's value and requested delivery even though that purchase order is not sent until 4 December. The trail reveals an order before it exists.

## Rerun after the order lookups respect existence (CALLS 72)

Deploy dep-dbrquhmk1f9s73fdqic0 (commit c3254f2), same model, same Northfield question, five runs, no history. Raw answers: `northfield-rerun-after-clock-fix-2026-11-14.jsonl`.

| Side | Question | Expected | Passed |
| --- | --- | --- | --- |
| Northfield | Show me Ashby Supplier's warehouse load scans for NR-460207. | Not available to Northfield, no invented records | 5 of 5 |

Each run called `supplier_document_trail`, which now returns no such order as of the story clock, and none gave an order date, value or requested delivery. Both live connectors were also called directly: `get_order` (Ashby) and `supplier_document_trail` (Northfield) on NR-460207 return "No such order as of 2026-11-17 11:00 ET". The model fault from run 2 of the first set (adding a value no tool returned) did not recur here, but the fix removed the record it drew on rather than the behaviour, so the code-level guard in CALLS 70 is still open.
