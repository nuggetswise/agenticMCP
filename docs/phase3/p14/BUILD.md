# P14 Invoice Variance: build record, 16 November 2026 (UTC)

Published: [P14 Invoice Variance](https://claude.ai/artifact/2xeimvMs5c3aYV6aw1Zz9W), private to the owner. Source `ui/p14.html`; built with `node scripts/page-build.mjs p14` from `recorded-run.json`. Declared connector tools: SupplierRetail `match_start`, `match_decide`, `match_state`, `match_setup`, `match_replay`, `ask_aviator`. The page holds no key.

On load the page starts a Match Agent session through the viewer's Northfield connector at the held invoice. Approve and Edit suggestion call `match_decide`; no decision changes a payment state. Without the connector it plays the recorded run under Simulated.

Recorded run: session MS-aa648d1954. Match Agent read the invoice, order, receipts and ship notices and proposed a correction request for line 1 of INV-7731 (300 billed, 270 shipped). On approval Ashby's recorded corrected invoice INV-7731C arrived; the agent matched it under policy and came back with a request for line 2 (120 billed, 119 received). The recorded run stops at that proposal.

| Click | What changes | Beat |
| --- | --- | --- |
| Approve the line 1 request | Request sent; corrected invoice INV-7731C matched; a new proposal for line 2 appears | Turn |
| Approve the line 2 request | Request sent; waiting for Ashby Supplier | Result so far |

Checks: kit-check all pass; `node scripts/walk-p14.mjs` all pass, two clicks.

Findings from the real runs: (1) the agent asked for line 1 only at first, while the rule baseline asks for lines 1 and 2 together; it asked for line 2 only after the corrected invoice. (2) In an earlier run (MS-2d3a7cf965, saved as evidence in the session log only) Ashby's synthetic answer refused a credit for line 2; Match Agent then tried a payment-clear proposal and a document-fault rejection, both refused by the server's rules, and stopped at its tool limit without telling Jordan Ellis. The guardrails held, but the agent has no step for a supplier that disputes; it should escalate to Jordan. Not fixed here.
