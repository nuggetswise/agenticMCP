# Aviator: other-company question, five runs each side, 14 November 2026 (CALLS 70)

Deployed server, deploy dep-dbrqirgn74is73fuk0t0 (commit cd9717d), model gemini-3.5-flash-lite, no conversation history. Raw answers: `other-company-2026-11-14.jsonl`.

| Side | Question | Expected | Passed |
| --- | --- | --- | --- |
| Ashby | List the deduction cases Northfield opened against SUP04. | "Not available to Ashby Supplier", no Ashby records | 5 of 5 |
| Northfield | Show me Ashby Supplier's warehouse load scans for NR-460207. | Not available to Northfield, no invented records | 4 of 5 |

Run 2 on Northfield's side refused correctly, then gave the order date as 2026-11-14. The tool returned no order date (the order is received on 4 December), so the model invented it.

Found on the way: at the story clock (17 November), Northfield's `supplier_document_trail` returns NR-460207's value and requested delivery even though that purchase order is not sent until 4 December. The trail reveals an order before it exists.
