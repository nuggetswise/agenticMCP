# T0.3 and T0.18, second round (14 November): set up, not yet run

Questions: `questions.json` (D1, D2, N1, N4, N5 as reworded; P11a to P11c, P11's golden set; G8a to G8c with P8's three definitions in the question, wording from `docs/phase0/P8-definitions.md`). Expected answers: `expected.json`, each with its source. Grader: `grade.mjs` (codes and ids verbatim, money within 0.5%, counts as numbers; P11c passes only if ASN-78260 is absent and the answer says the order did not yet exist).

## Attempt 1: blocked, nothing graded

Five fresh subagents, no context, the eleven questions each, connectors only (Ashby's SQL tool barred, write tools barred). Every run stopped at its first connector call: each call asked the owner for permission, nobody was there to answer, and the runs made no further calls. No run returned a figure, so nothing is graded and `runs/` is empty. The five replies are kept in `blocked/` as the record.

To run unattended, the read tools of both connectors (Ashby's RetailStrategy and Northfield's SupplierRetail) need "always allow" in the owner's connector settings, or the owner present to approve each call. Reading tools only: the runs never call request_change, submit_dispute, release_ship_notice, decide_charge or publish_rule.

Harness note given to each run: the connectors' cached tool lists can be out of date, and reading tools accept `as_of` even where a cached schema does not list it (the Ashby connector's cached `get_order` predates CALLS 72).
