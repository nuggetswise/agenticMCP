# P5 Scout Shipment Watch: grid row evidence (T0.13), 13 November 2026

Source walked: the live page, version 1794507904-ed4a, with `docs/phase0/walks/walk.mjs` (headless Chrome, reduced motion). Logs: `docs/phase0/walks/P5/`. Nothing on the prototype was changed.

## A1 Problem, turn and result against the Inventory ending
- Problem beat: no single problem line. The first view is titled as a queue ("Northfield shipments · next 48 h") and states a goal ("Every Northfield shipment meets Northfield rules 2026.2 before its cutoff"). The problem appears only per row, as "If nothing changes" text.
- Turn beat: present. Priya, or Scout Agent for her, corrects the order, sends the warehouse task, rebuilds the ship notice from the load scan and sends it.
- Result beat: present and it matches the ending in Inventory. The end frame reads "Receipt matched" with Northfield's receiving advice for the load.
- Finding for Phase 4: add one problem line; the title names a queue, not the problem.

## A9 Walked end to end
- Manual path: all six queue items reached, no script errors (manual-log.json).
- Agent path: the dead state is reproduced by script. Start Scout Agent, open the first shipment while it is still ranking, and no action is available for the 90 seconds the walker waits (agent-log.json). This is approved change 13.

## A10 Click budget and click map (R42)
The lead shipment takes 11 actions by hand from opening it to the result, against a budget of about eight. The whole manual walk, with both replays and all six items, is 122 actions.

| # | Click | What changes | Beat |
| --- | --- | --- | --- |
| 1 | Open the shipment | The load, the order and the three rule breaks appear | Problem |
| 2 | Correct to match | Ship-to and lines follow the current order change | Turn |
| 3 | Carton, then order | Chooses what to fix first | Turn |
| 4 | Confirm | Confirms click 3 | None: fold into click 3 |
| 5 | Send to Kinross | The load task goes to the warehouse | Turn |
| 6 | Check the load scan | The scan shows what was loaded | Evidence: could arrive on its own |
| 7 | Write to Supplier ERP | The corrected order is written | Turn |
| 8 | After departure, re-read load and order | Re-reads both records | Evidence: could arrive on its own |
| 9 | Build ship notice from the load | The ship notice is rebuilt from the scan | Turn |
| 10 | Send to Northfield | The ship notice is sent | Turn |
| 11 | At DC 2, read the receipt | Northfield's receiving advice matches | Result |

Folding click 4 and making clicks 6 and 8 automatic brings the lead path to eight. The other five items and the two replays are evidence paths; R42 puts them behind more detail.

## Not covered here
A2 on the same case, A3 (waits for T2.2), A4 (no method yet for a screen prototype) and C1 (needs the server token).
