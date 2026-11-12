# Calls log, Phases 1 to 4 (from 12 Nov 2026, after Phase 0 approval)

Each call: what I decided, why, and what would change it.

## Phase 1

1. **Catalogue source.** The world reads Ashby rules (AP-*, AM-1) from `registry/catalogue-pack.json`, a snapshot of the EDI Review Pack; Northfield rules stay written in `world/ref.js`. The gate fails if any rule's wording, owner, basis or Implements differs from the pack, or the counts differ. *Would change:* if the pack moved into the repo as its own source, the snapshot would be generated from it instead.
2. **TG-TOL is NF-7.11**, owner Northfield, pack wording ("paid without review; beyond that the line is held"). KX-945 takes the pack wording.
3. **AP-4.1** (pack and world): "Dispute a deduction without asking only when the NF-7.4 evidence is already on hand and the amount is under $250; otherwise Priya Raman decides between dispute and write-off". *On hand* means the evidence is already in the deduction case; evidence held by Kinross or the carrier is not on hand. *Would change:* if Mandip counts Ashby's own systems as on hand.
4. **AP-5.1** becomes Adapted (HIDA share of prior volume). Basis totals are now 7 public, 18 adapted, 49 invented; 74 rules. Pack, world and docs agree.
5. **Thresholds from the catalogue.** Rules carry `params`; agents read AP-4.1, AP-6.1 to AP-6.4 and the charge amounts (AS02, AS03, AS04, IV01, RT01, LB01) from the catalogue. A gate check fails on numeric thresholds written into `src/agents.js`. Pace Agent's "one cause carries 70% of at least 4 lines" has no catalogue rule; it stays a setting and is flagged. *Would change:* a pack rule for pattern dominance.
6. **Deduction case as of.** `get_deduction_case` now hides events, adjustments and the case itself after `as_of`. `list_deductions` returns count and total.
7. **run_readonly_sql description.** The server's description was already right (no scenario tables); the Claude connector was showing a cached old one. No code change; reconnecting the connector refreshes it.
8. **Shipments without receipts.** None for Ashby. 30 belong to other suppliers in P8's snapshot (in transit at 8 Nov), including 6 from SUP13 dated July. Left as is: P8's fixture equals the world and its at-risk value depends on them. *Would change:* if P8 does not mean those as stuck value.
9. **Rule visibility.** Ashby's policies and agreements are Ashby's records: the Northfield scope will not see them (Phase 2).
