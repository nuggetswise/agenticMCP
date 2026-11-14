# Phase 1 change list 2 (proposed 14 November, not applied)

Nothing in `world/`, `src/` or `scripts/` changes until the owner approves this list.

1. **CORRECT** NR-46215's receiving advice time (T3.1, P13). RCV-46215 moves from 18 November 08:30 ET to 18 November 11:30 ET, after ASN-46215 (09:30), so Northfield's receipt can match the ship notice Watch Agent drafts, as P13's journey ends.
   - The order is replenishment for DC 2, requested 18 November. The receipt stays on that date, so it stays on time and the scorecard population and its figures do not move.
   - The 861 keeps its control number through `numAt`, as in change list 1 point F1, so no other document is renumbered. Its 997 moves with it.
   - It is outside P10's 30-day health window to 17 November and after P8's 8 November snapshot.
   - A gate check is added: no receipt before its shipment's ship notice was sent, with no exceptions.
   - Alternative: leave the world as it is and change P13's journey to say the goods were already received when the late ship notice went out. That is realistic, but it removes the receipt matching the ship notice from P13's ending.
