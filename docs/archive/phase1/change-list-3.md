# Phase 1 change list 3 (withdrawn 15 November: the owner chose to skip it)

Nothing in `world/`, `src/` or `scripts/` changes until the owner approves this list.

1. **ADD** one Northfield deduction case on an Ashby order that Claim Agent may dispute without asking under AP-4.1.
   - Why: every Ashby case that meets AP-4.1 in the recorded quarter is already disputed, so the server cannot show Claim Agent acting alone, or show that a paused Claim Agent stops acting alone (T2.3 story 2, CALLS 86). Today that is proven at function level only.
   - What: one shortage charge (SH01) below the AP-4.1 limit, with the NF-7.4 evidence already in the case (bill of lading with seal, proof of delivery, load scan by SSCC) and no dispute event.
   - When: opened after P6's moment (1 December) and after P7's scorecard (28 December), inside the settlement window to 6 January 2027, so no P6, P7 or P8 figure moves. The gate must show every existing figure unchanged.
   - Checks added: active Claim Agent returns "dispute without asking" for the case; paused, the same case arrives as a plain task and `submit_dispute` records a proposal from Priya Raman's assistant.
   - Alternative: leave the world as it is and accept function-level proof.
