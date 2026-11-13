# P9 Shelf Recovery: grid row evidence (T0.17), 13 November 2026

Source walked: the live page, version 1794451627-6daf, with `docs/phase0/walks/walk.mjs`. Logs: `docs/phase0/walks/P9/`. Live answers came from the Ashby connection. Nothing on the prototype was changed.

## A1 Problem, turn and result against the Inventory ending
- Problem beat: a goal line, "Turn Northfield's weekly sales report into a refilled shelf", not a problem line. The empty shelf at store 114 appears only as a row in the 40-store table.
- Turn beat: present. Priya reviews the two flagged stores, checks stock, sends the recommendation, creates the sales order and sends the ship notice.
- Result beat: present and it matches the ending in Inventory. The following week's report shows store 114 back in stock (31 sold, 9 on hand) and store 207 lower after the transfer.

## A2 Manual option on the same case
- The page has an agent switch, but the walk with it switched gives the same eight steps with the same wording ("2 stores flagged by Priya", "Causes confirmed by Priya"). Shelf Agent does not visibly do any of the work, against R17.

## A4 A customer's own agent reaches the job through the tools
- The Ashby connection returns the same two decisions the screen shows, from the same report: store 114 empty with nothing in transit and 980 pairs available, so recommend a new order of 40 pairs to Jordan; store 207 at 16 weeks of supply, so recommend a transfer of 24 pairs.
- It also computes a third decision the screen cannot show: store 114 later that day, with goods in transit, waits instead of reordering. The screen fixes "In transit" at zero.

## A6 The same job in more than one prototype
- The replenishment job is P9's alone. D27 keeps its scorecard separate from the buyer-order view.

## A8 Roles merged into one person
- The header reads "Priya · Account planner": a role label on screen (noted in Phase 0). Jordan is the buyer who receives the recommendation; no other people are named.

## A10 Click budget and click map (R42)
Eight actions, inside the budget.

| # | Click | What changes | Beat |
| --- | --- | --- | --- |
| 1 | Open store view | The 40-store weekly report | Problem |
| 2 | Review both stores | Stores 114 and 207 flagged | Evidence |
| 3 | Check Ashby stock | 980 pairs available | Evidence |
| 4 | Prepare recommendation | Refill for store 114, transfer from store 207 | Turn |
| 5 | Approve and send | The recommendation goes to Jordan | Turn |
| 6 | Create sales order | The sales order in Supplier ERP | Turn |
| 7 | Send ship notice | The ship notice to Northfield | Turn |
| 8 | Advance to next week | The following week's report | Result |

## Not covered here
C1 stays Partly: P9 has one golden question and needs two more under T0.3.

## Findings for Phase 4, against the accepted task card
- The recommendation text reads "Store 114 · replenish  pairs": the quantity is missing.
- The card says Jordan accepts the refill. The screen goes from Priya's send straight to "Create sales order"; Jordan's purchase order appears only as a tab.
- Shelf Agent is switched on but never visibly acts; the agent and manual paths are the same.
- Add a problem line; show the in-transit case the server already computes.
