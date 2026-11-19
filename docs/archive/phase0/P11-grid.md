# P11 NetSuite Chargeback Avoidance: grid row evidence (T0.18), 13 November 2026

Source walked: the live page, version 1794576237-3b68 (the owner's own version), with `docs/phase0/walks/walk.mjs`. Log: `docs/phase0/walks/P11/`. Live answers came from the Ashby connection. Nothing on the prototype was changed.

## A1 Problem, turn and result against the Inventory ending
- Problem beat: present, a single line ("A ship notice that breaks a Northfield rule reaches Northfield, and the cause surfaces later, outside NetSuite.").
- Turn beat: present and it matches the accepted card. The route map shows "Check result · API" between NetSuite and Trading Grid; the ship notice is held, each cause is routed to its owner in NetSuite, and version 2 is released.
- Result beat: present, but it ends on "Technically acknowledged" and "Ship notice received". The ending in Inventory is Northfield receiving the load as the corrected ship notice describes it; a 997 does not show that.

## A2 Manual option on the same case
- Not applicable: there is no agent, so every path is the manual one.

## A4 A customer's own agent reaches the job through the tools
- It cannot. None of the screen's records are in the world: ship notice ASN-78452, PO-104728 and PO-105031 return no documents on the Ashby connection.
- What the connection does hold is the earlier story: a test ship notice, ASN-78214, failing the pack rule, with a Test Agent decision. That is the registry's held part 2 (T2.7).

## A8 Roles merged into one person
- Priya is the only person named. Warehouse operations and Master-data operations are roles inside Ashby, which fits R02 and R03.

## A10 Click budget and click map (R42)
Six actions, inside the budget.

| # | Click | What changes | Beat |
| --- | --- | --- | --- |
| 1 | Route to Warehouse operations, quantity | Item fulfillment corrected from 50 to 48 | Turn |
| 2 | Route to Warehouse operations, labels | Cartons labelled and scanned | Turn |
| 3 | Route to Master-data operations | Ship-to cross-reference corrected | Turn |
| 4 | Generate version 2 | The corrected ship notice is built and passes the checks | Turn |
| 5 | Release corrected version | Version 2 goes to Northfield | Result |
| 6 | Align sales order to 48 | The next order follows the acknowledged quantity | Evidence: could follow the release |

## Not covered here
C1: P11 has no golden questions, and none can be graded until its records are in the world.

## Findings for Phase 4, against the accepted task card
- End on Northfield's receiving advice, not the technical acknowledgment.
- Its records are not in the world; the world's one live NetSuite order with a matched receiving advice is PO-104912 (event `erp.first_live_order`). A Phase 1 change list either adds the screen's held ship notice or moves the screen onto PO-104912.
- "Acknowledged 48" is treated as the commitment while the purchase order says 50, which the Phase 0 findings flagged against NF-1.1 and NF-1.5.
- The header shows a clock ("now 11:00", "Truck departs 18:00"), against R11.
