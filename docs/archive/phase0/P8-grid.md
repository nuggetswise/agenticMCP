# P8 Money in Motion: grid row evidence (T0.16), 13 November 2026

Source: the live page, version 1794576266-f6d7, loaded headless in both views (VP Finance and VP Merchandising). Log: `docs/phase0/walks/P8/`. Live answers came from the Northfield connection. Nothing on the prototype was changed.

## A1 Problem, turn and result against the Inventory ending
- Problem beat: no problem line. The first view states a goal, "See every dollar in motion and when it lands", and opens on the figures.
- Turn beat: present as a still view. Trading Grid places each open order's value at its stage from the documents exchanged, shown on the route map and the stage strip.
- Result beat: present and it matches the ending in Inventory. Finance sees what is due by window and what is billed above received; merchandising sees unfilled, unacknowledged and backordered value, and what could be released at acknowledgment.

## A4 A customer's own agent reaches the job through the tools
- Jordan's own assistant reaches it through the Northfield connection's read-only SQL and document tools. Asked for the order behind the screen's example rows, it returns the same values: NR-450118 ordered $24,552 and accepted $22,932, as the merchandising view shows; NR-449453 and NR-449607 exist with the values the lists start from.
- No single tool answers "open-order value by stage"; the assistant has to compose it. The gate's `p8.engine_equal` check confirms the screen's engine and the world agree.

## A5 The same fact repeated in one view
- Finance view: four figures appear twice ($10.37M, $8.91M, $9.7K, $8.1K) because the headline cards repeat the stage strip and the due windows.
- Merchandising view: the unfilled total appears three times; two stage totals appear twice.

## A6 The same job in more than one prototype
- "Billed above received" lists invoice NR-450118 billing 300 cases against 270 received. That is the invoice exception P6 corrects and the variance planned P14 investigates. P8 should show it as one row with its owner, not explain it.

## A8 Roles merged into one person
- No people are named. The two views are roles (VP Finance, VP Merchandising), matching the accepted task card's two readers. The registry says P8 is seen by Jordan Ellis; the screen never names him.

## Not applicable
A2, A3, A9 and A10: view only, no agent, nothing to walk and no clicks on the main path.

## Not covered here
C1: Partly. The three questions below ran five times (golden/t03, as G8a to G8c) and fail: the records do not carry P8's definitions. See RESULTS.md and open question 8.
- As of 8 November, how much open-order value sits at each stage from purchase order to payment?
- Which invoices are billed above received beyond the 0.5% tolerance, and by how much in total?
- How much unfilled value would return to budget if released at acknowledgment, over the last 90 days of closed orders?

## Findings for Phase 4, against the accepted task card
- Add a problem line; the goal line stands in for it.
- The VP Finance and VP Merchandising toggle and the "Reduced and rejected / Include backordered" tabs are pickers (R12), and the presenter has to click to change readers. One view with both readers' figures, or two still frames, fits R41.
- Cut the repeated headline figures (A5).
