# Phase 1 change list 2 (approved 14 November under the owner's delegation, CALLS 79; point 1 applied 15 November)

Nothing in `world/`, `src/` or `scripts/` changes until the owner approves this list.

1. **CORRECT** NR-46215's receiving advice time (T3.1, P13). RCV-46215 moves from 18 November 08:30 ET to 18 November 11:30 ET, after ASN-46215 (09:30), so Northfield's receipt can match the ship notice Watch Agent drafts, as P13's journey ends.
   - The order is replenishment for DC 2, requested 18 November. The receipt stays on that date, so it stays on time and the scorecard population and its figures do not move.
   - The 861 keeps its control number through `numAt`, as in change list 1 point F1, so no other document is renumbered. Its 997 moves with it.
   - It is outside P10's 30-day health window to 17 November and after P8's 8 November snapshot.
   - A gate check is added: no receipt before its shipment's ship notice was sent, with no exceptions.
   - **Applied (15 November, T3.1).** `world/replen.js` sets RCV-46215 to 11:30 ET; its planned 08:30 is kept as `numAt`, so the 861 keeps ISA/GS 2154 and its 997 (FA-A1154) keeps 500001154 and moves to 11:37 ET. Lakeline's delivery receipt for SHP-46215, drawn 36 minutes before the receipt, moves from 07:54 to 10:54 ET, so seven event ids (4294 to 4300) shift by one place; no check, registry entry or doc cites them. Nothing else in the world changed: with the time reverted the X12 corpus hash is the earlier one. Gate check `time.receipt_after_ship_notice` added; `time.control_numbers_rise_with_time_except_p5_lead_acks` is renamed `..._and_rcv_46215` and lists the 861 and its 997.
   - Alternative: leave the world as it is and change P13's journey to say the goods were already received when the late ship notice went out. That is realistic, but it removes the receipt matching the ship notice from P13's ending.
