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

## A2 Manual option on the same case
- Both paths work the same lead shipment, PO NR-460207. By hand it takes 11 actions (click map above). With Scout Agent it takes 9 after the agent is switched on and started: two "Continue" steps, the recommended fix order and its confirm, three approvals and the receipt (agent-after-ranking-log.json). "Take over · work it myself" returns the same case to the manual path part-way.
- Finding for Phase 4: the agent path saves two clicks, not most of them; three of its nine are "Continue" or "Confirm" steps that serve no beat.

## A3 Agency: does the next step change when the record changes?
- On screen: no. The lead case follows one path. The next steps change only through two replay buttons ("carton loaded", "carton misses the trailer") and Priya's own choices; the second record the registry lists, PO NR-460288, is not on the screen.
- On the server: yes. The live Ashby connection returns "send the load task to Kinross" for NR-460207 and "check the departure scan and ask Kinross" for NR-460288, each from its own records.
- Finding: the screen's agency is scripted while the server's is computed. Making the screen read the computed decision is T2.2.

## A4 A customer's own agent reaches the job through the tools
- Method (owner, 13 November): the owner shows this by opening his own assistant beside the prototype, so the check is whether the live connection gives the same answer the screen shows.
- Result: it does. Asked for the next step on NR-460207 as of the P5 moment, the Ashby connection returned one carton staged and not loaded (659 of 660), the trailer sealing in 40 minutes, the same three rules and the same exposure estimate the screen's first row shows, with Priya's approval required and nothing changed. The answer names its confirming record as Northfield's receiving advice.

## Not covered here
C1: P5 has one golden question with five graded runs; T0.3 asks for three. The other two are drafted below and still need their five runs.
- As of the P5 moment, what should Ashby do about PO NR-460288, and which two records disagree?
- How many Northfield shipments leave Kinross in the next 48 hours, and how many break a rule unless fixed?
