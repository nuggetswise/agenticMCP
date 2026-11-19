# P8 Money in Motion: the three definitions (open question 7, CALLS 66), 13 November 2026

## Call

P8 states its three definitions on screen, each beside the figures it governs. No new tool on Northfield's connection.

## Evidence

`docs/phase0/walks/P8/definitions-check.mjs` runs the page's own engine (copied from live version 1794576266-f6d7 into `mim-engine.js`) twice: on the page's order records, and on orders picked from the built world by a stated rule and rebuilt from the shared documents. Output: `docs/phase0/walks/P8/definitions-check.txt`.

Verified:

- The page's order records equal `world/data/buyer-orders.json` byte for byte.
- Picking **buyer orders** from the world by rule, with no list of order numbers, reproduces every figure the screen shows: all five stage values, billed above received (7 rows, $9,721.10) and the release figure ($150,480.60 over 10 orders, 21.5 days). A start date is not needed: every buyer order to 8 November gives the same figures as buyer orders placed from 13 July, because older ones are paid.
- Adding replenishment orders is what broke the golden runs: 537 open orders instead of 200, and about $444,500 more open value (ordered, confirmed, in transit and invoiced all move; received does not).
- So the records do carry P8's figures once three things are said. The golden failures (G8a 0 of 5, G8b 0 of 5, G8c 2 of 5) were three unstated definitions, not missing data, and a tool would only hide the definitions inside the server instead of the screen.

Not verified: that an assistant given the definitions in the question passes five graded runs. That is the P8 part of T0.3.

## The definitions, as the engine applies them

| Definition | What the engine does | Screen wording to use | Sits beside |
| --- | --- | --- | --- |
| Which orders count | Buyer purchase orders only. An order is open while any unit sits in a stage from ordered to invoiced and unpaid. Replenishment orders are outside the view. | Buyer purchase orders. Replenishment orders are not counted. An order is open until every unit is paid or unfilled. | The order count and the stage strip |
| When an order closes | A ship notice marked complete closes the order: confirmed units not shipped by then are unfilled. For the release replay the order must also have every shipment received; its close date is the last receipt (the completing ship notice for direct store delivery). | An order closes when its ship notice is marked complete and every shipment is received. Confirmed units not shipped by then are unfilled. | Unfilled commitment and Release at acknowledgment |
| Billed above received | Per order line: units billed and unpaid, less units received and unpaid, less units shipped and not yet received, at the order price. Listed when the excess is above 0.5% of the line's billed value. An invoice whose goods are still in transit is "invoiced ahead of receipt", not billed above received. | Compared by order line at the order price. Units still in transit are not counted as billed above received. Listed above 0.5% of the line's billed value. | Billed above received |

## Faults found on the way, for T4.16

1. **Order count.** The engine counts 200 open orders out of 340 in its set. The story calendar's P8 anchor reads "340 open orders" (`world/build.js`), and `docs/phase0/golden/t03/RESULTS.md` repeats 340 as the open count. 340 is the size of the set; 200 are open. The calendar anchor is a world value and was not changed here.
2. **"7 invoices".** The Billed above received list has one row per order, and the screen labels the count as invoices. Whether the seven orders are also exactly seven invoices was not checked.
