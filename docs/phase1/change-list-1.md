# Phase 1 change list 1: T1.9, T1.10 and T1.6

Proposed 13 November 2026, not applied. Baseline: commit 314d49c, gate 386 passed, 0 failed. Each line is RETAIN, CORRECT, DELETE or ADD. Nothing in `world/`, `src/`, `registry/` or `scripts/` changes until the owner approves this list.

## Owner answers this list rests on (13 November)

- Handoff Q3, history scope: a closed prior period. History sits before the current period and is fully settled before any window the world reads today.
- Registry change list part 2 (P11): approved. P11's records go onto the world's existing live NetSuite order, PO-104912, and the screen moves onto them in Phase 4.
- Open question 4 (P7): the world wins. No world change; P7's screen takes the world's orders and OTIF charge in Phase 4 (T4.15).
- Open question 5 (partner records): none. No partner record enters the timeline; candidate partner nodes on P5 and P11 drop.

## How figures are treated

Every figure a check, golden question, scorecard or calendar row reads stays stable unless a line below marks it **re-baselined**. Where stability depends on a date window, the line names the window. Every "stable" claim is verified at build by rerunning the gate, the smoke test, the bots-grammars check and the affected golden questions; a figure that moves without a re-baseline line stops the commit.

Baseline figures at 314d49c, for the build to compare against:

| Reader | Value at baseline | After this list |
| --- | --- | --- |
| `p8.one_open_ashby_order` | 340 open orders, 24 suppliers at 8 Nov | Stable |
| `p8.engine_equal`, golden G8a, G8b, G8c | P8 engine at 8 Nov; G8b 7 invoices, G8c 10 orders over the 90 days from 10 Aug | Stable |
| `p5.kinross_shipments_48h` | 124 | Stable |
| `p10.health` | 3,412 documents, 41 failures, 30 days to 17 Nov | Stable |
| `p10.attention`, `p13.queue` | 17 and 18 Nov | Stable |
| `scorecard.cases`, `scorecard.failing` | 48,000 cases, 4,320 failing, 91.0% | Stable |
| Deductions, Ashby (D1, D2, N1) | 5 cases, $586.80 at 10 Dec | Stable, with S1 and reworded questions |
| NFD-1 replay (N4, `nf.replay.nfd1`) | 32 failing now, 525 with draft, Ashby only, 1,980 documents replayed | **Re-baselined** by C1 only |
| NFD-2 replay (N5) | Fails nothing | **Re-baselined** by C2 |
| Story calendar, P11 row | Test ship notice ASN-78214, 23 Nov | **Re-baselined** by A6 |
| Every other calendar row | — | Stable |

## A. T1.9: P11's records on the live NetSuite order

The world already holds event `erp.first_live_order` on 30 November: PO-104912, sales order SO-108955, item fulfillment IF-55498, ship notice ASN-78260, item AHP-8820, pack 6, "receiving advice matched". It has no order, no documents and no hold behind it. This adds them.

1. **ADD** the order PO-104912: Northfield's 850, Ashby's 855 within NF-1.4, Northfield's 997s, and the NetSuite sales order SO-108955. The order is received after 18 November and sits in the buyer-order stream, not DC replenishment, so the OTIF scorecard population does not change (D27).
   - PO-104912 keeps the number the world already uses, although every other Northfield PO is numbered NR-. It passes NF-4.10 (at most 22 characters). Alternative: renumber it to NR- and rename the event. Recommended: keep it, so P11's Phase 4 rebuild matches the screen's own PO style.
2. **ADD** the hold: before version 1 of ASN-78260 leaves NetSuite, an API check against Northfield's rules (D44, shown as direction) finds two failures, and a `tg.hold` event records both on IF-55498:
   - NF-4.3: one carton has no SSCC in the ship notice hierarchy. Warehouse operations fixes it by labelling and scanning the carton.
   - NF-4.7: the ship-to does not match the current PO, because of a stale NetSuite ship-to cross-reference. Master-data operations fixes it.
   - Version 1 never reaches Northfield, so it has no X12 file. The existing `tg.hold` on NR-450118 is the pattern followed.
   - Why these two: they are two of the three causes on the live screen, and each is fixed by a different owner inside NetSuite. The third cause (quantity 50 against an acknowledged 48) is left out, because Phase 0 found that it treats the acknowledgment as the commitment, against NF-1.1 and NF-1.5. Phase 4 consequence: P11's screen loses that cause.
3. **ADD** the corrections on IF-55498, each with its owner, and Priya Raman's release of version 2 under AP-1.3 (a person releases, after every failure is fixed, as a new version).
4. **ADD** ASN-78260 version 2, sent within an hour of departure (NF-4.2), with Northfield's 997 (technical only, NF-1.5), Lakeline's delivery and Northfield's 861 receiving advice, which matches version 2 carton for carton (NF-4.5). This 861 is the ending record in Inventory.
5. **ADD** the invoice and payment under the world's normal rules. They sit beyond P11's ending.
6. **CORRECT** the story calendar's P11 row: the moment becomes a live ship notice held in NetSuite and corrected before it leaves, timed at the hold on 30 November, anchored on ASN-78260. **Re-baselined**: `get_story_calendar` answers differently for P11.
7. **RETAIN** the test events for ASN-78214 and ASN-78231 (`test.ship_notice`, `test.correction`) as P2's test history (D40: tests live in P2). They leave P11's registry entry under T2.7, not here.
8. **ADD** gate check `p11.held_then_matched`: version 1 is held on both rules, version 2 is released by Priya, and the 861 matches version 2.

Figures: none of the readers in the baseline table moves. The order is after 8 November (P8), outside the 30 days to 17 November (P10 health), after the P10 and P13 moments, outside P5's 48-hour window around 8 December, and outside the scorecard population. No deduction arises. Later Ashby exchange windows grow by one order's documents; no check reads them.

Unlocks: T2.7 (registry part 2, already approved), C1 on T0.18, and P11's golden questions under T0.3.

## B. T1.10: history, 29 March to 27 June 2026 (Northfield's prior-but-one quarter), closed

**Window.** The world holds nothing before 13 July: other suppliers start then, Ashby in September. History on Northfield's 13-week quarter of 29 March to 27 June sits before every window read today: the 30-day health window, the scorecard quarter (27 September to 26 December), G8c's 90 days from 10 August and P8's open orders at 8 November. Every history order is received, acknowledged, shipped, invoiced and paid, and every case decided, by 7 August, before G8c's window opens. Cost: Ashby shows no trade in July and August, which is already true today.

**Volume.** About 300 Ashby orders (about 23 a week) and about 150 across the other suppliers. Control numbers rise with time for each trading pair and the current period starts at 1001 (`world/log.js`). A history this size fits below 1001, so no current X12 file changes by a byte. At the full current rate, every Ashby X12 file would be renumbered, and the bots-grammars report, the record pages and any raw X12 panel would all move. Recommended: about 300.

Records, generated with a seed by the existing generator, not written by hand:

1. **ADD** B1, Ashby's trade in history: full chains of 850, 855, 997, 856, 861, 810 and 820. SSCCs come from a serial block of their own, so NF-4.1 (no reuse within 18 months) holds and P1's serials are untouched.
2. **ADD** B2, the lead signal for P5's T4 test, produced by a cause rather than a label. A backlog figure per Kinross site and week drives two things:
   - how long Ashby takes to acknowledge, kept under NF-1.4's 24 hours so no new failure arises;
   - the chance that the ship notice goes out more than an hour after departure (NF-4.2).
   The link is probabilistic. Any hit rate an agent later shows is measured from these records and includes its misses; none is set in the generator.
3. **ADD** B3, Ashby's history deduction cases with Northfield: AS02 from the late ship notices B2 produces, and SH01 shortages. Each case runs from opening through Priya's dispute or acceptance to Jordan Ellis's decision (NF-7.7). Outcomes follow the catalogue: reversed where an SSCC load scan or load tally is in the case (NF-7.4, NF-5.3), upheld otherwise, with receipts unchanged unless revised (NF-5.5) and reversals repaid on remittance. This is T2's material for Claim Agent.
4. **ADD** B4, other suppliers' history cases with Northfield: shortages across at least five suppliers. Among them is a cluster of Lakeline Freight deliveries whose seal Northfield records as broken or not matching at arrival (NF-5.2), the cross-company pattern only Northfield's view holds. This is T3's material for the retailer-side agent in P6. These records go into Northfield's copy only; `isolation.other_supplier` stays at 0 on Ashby's.
5. **ADD** B5, other suppliers' acknowledgment and ship-notice timings in history, following their current pattern (acknowledgment averages about 29 hours today).
6. Not added:
   - a published Q2 scorecard, which would join "files published so far" and move P7's answers and N9;
   - agent recommendation records. Each agent's track record (X1) is computed in Phase 2 by running the agent over history (T2.2), not stored here.

Server changes needed to keep figures stable. These touch `src/`, so the guide's as-of commit moves and `npm run smoke` runs.

7. **CORRECT** S1: `list_deductions` (Ashby) and `list_deduction_cases` (Northfield) default to the current quarter, and an optional `from` reaches history. Without this, D1, D2 and N1 move.
8. **CORRECT** S2: `replay_draft_rule` replays the quarter only, as its description already says. Today it reads every ship notice the world holds, including pre-quarter ones. Its failing figures do not change; its documents-replayed count falls. The check `nf.replay.nfd1` gets the same window.
9. **ADD** S3: `get_story_calendar` names the history span beside the quarter.
10. **ADD** S4: any other unbounded aggregate found at build gets the same quarter default, or is listed here as re-baselined before commit.
11. **CORRECT** golden questions D1, D2 and N1. They say "as of", and an assistant answering through SQL would count history cases. Each is reworded to "in the current quarter" and rerun five times; expected values stay 5 cases and $586.80.

## C. T1.6: records for P14 and P15

1. **CORRECT** C1, NFD-1's reach. About one in eight of the other suppliers' ship notices inside the current quarter moves from departure time to 31 to 59 minutes after it, spread across at least five suppliers. NF-4.2 still passes them; NFD-1 fails them. Departures within an hour of the end of 8 November (Eastern) are excluded, so P8 is stable. These ship notices are re-sent with new times, so their X12 bytes change; Ashby's do not. **Re-baselined**: N4 (more failing with the draft, several suppliers in the answer). `nf.replay.nfd1` recomputes itself. The count is measured at build.
2. **ADD** C2, P14's price rows, on new orders from two other suppliers received after 18 November:
   - a line priced 2% above the acknowledged price with no order change: held under NF-7.11;
   - a line priced 3% above, where an accepted order change (860 and 865) set that price before the invoice: cleared, because the current PO revision is the commitment (NF-1.1);
   - a line priced 0.4% above: inside NF-7.11's 0.5%, outside NFD-2's 0.25%. **Re-baselined**: N5 (NFD-2 now fails one line).
3. **ADD** C3, NF-7.10: one invoice whose total differs from the sum of its lines, rejected as a document fault on an 824.
4. **RETAIN** INV-7731 and INV-7731C for the rows "billed more than received" and "corrected invoice after the hold". The row "PO, receiving advice and invoice all disagree" is replayed against NR-450118 at build. If it does not replay, a record is added in the same commit.
5. **ADD** gate checks `nf.match.price_held`, `nf.match.price_cleared_by_change`, `nf.match.total_fault` and `nf.replay.nfd2`.

Figures: everything is after 8 November (G8 stable), in Northfield's copy and other suppliers' records only (Ashby's figures, `p6.invoice_exception` and Ashby's deductions untouched). Northfield's queue of held invoices grows; no check counts it.

## D. How the three interact

- B and C1 both reach the NFD-1 replay. S2 windows the replay to the quarter, so only C1 moves N4.
- B4, C1 and C2 add or change other suppliers' records in Northfield's copy only; Ashby's copy is untouched apart from A and B1 to B3.
- A, B and C share no date window. A is 30 November, B ends by 7 August, C is inside the quarter after 8 November (C1 excepted, which is spread across the quarter but avoids 8 November's last hour).

## E. Commits, one task each

1. This list and the owner's four answers: docs only.
2. T1.9 (A). Then T2.7 applies registry part 2 as its own commit.
3. T1.10 (B), with S1 to S4 and the golden rewording.
4. T1.6 (C).

Each commit runs `node scripts/guide-check.mjs` and `npm run build`. Commits 3 and 4 also run `npm run smoke`, `validator/botscheck.py` (new hash) and the golden questions they touch, five runs each. Push only on success.

## F. Points to settle with approval

1. P5's T4 beat needs a current order whose slow acknowledgment comes before the shipment the agent watches. History alone does not give one: Ashby's current acknowledgments average about 2 hours, and none takes 24. Recommended: slow the 855s on P5's own lead orders only (NR-460207 to NR-460274, all after 8 November, kept under 24 hours). This moves nothing counted, but it does touch the current quarter. Alternative: leave the quarter untouched, and the agent shows that the signal says nothing today.
2. History volume: about 300 Ashby orders (recommended, no current byte changes), or the full current rate (every Ashby X12 file renumbered).
3. Rewording D1, D2 and N1 to "in the current quarter".
4. PO-104912 keeps its number (recommended) or is renumbered to NR-.
