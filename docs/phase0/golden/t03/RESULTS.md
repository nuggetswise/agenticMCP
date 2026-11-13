# T0.3 golden questions, 13 November: P5, P8, P9

Five no-context runs, each answering all seven questions through the live connectors only (Ashby's SQL tool barred; Northfield's SQL tool allowed, since P8 lists it). Expected answers: `expected.json`, from the agent logic in `src/agents.js` on the built world and from P8's own engine, which check `p8.engine_equal` ties to the world. Graded by `grade.mjs`: codes and ids verbatim, money within 0.5%.

| Question | Prototype | Passed |
| --- | --- | --- |
| G5a: NR-460288, fulfilment posted but load not departed | P5 | 5 of 5 |
| G5b: NR-460219, invoice bills 180 against 176 shipped, NF-7.8 | P5 | 5 of 5 |
| G9a: store 114 at 17:30, wait for ASN-451207-1 | P9 | 5 of 5 |
| G9b: store 207, transfer 24 pairs | P9 | 5 of 5 |
| G8a: open-order value by stage | P8 | 0 of 5 |
| G8b: invoices billed above received beyond 0.5% | P8 | 0 of 5 |
| G8c: value released at acknowledgment | P8 | 2 of 5 |

With the one earlier question each, P5 and P9 now have three questions with five graded runs, all passing.

## Why P8 fails

Every run reproduced the first stage (ordered, not acknowledged, about $2.0M) and, read as a closed order is the final complete receipt, the release figure ($150,480.60 over 10 orders). The rest differ because the records alone do not say what the screen means:

- **Which orders are open.** Runs found about 540 open purchase orders; the screen and the story calendar count 340. The screen works on its own set of orders, which the records do not mark.
- **When an order closes.** No close field exists. Runs that took "closed" as paid found 2 orders and $23,986.60; runs that took it as the final complete receipt matched the screen.
- **Billed above received.** Runs found 9 to 11 invoices and $38,000 to $43,000 when only invoices with a receipt count, and over $2.1M when invoices still awaiting receipt count. The screen shows 7 invoices and $9,721.10. Its comparison basis (line or order, which receipts) is not stated anywhere a reader of the records can find.

This is a finding about the prototype, not the connector: P8's figures cannot be checked by Northfield's own assistant from the shared records. Fixing it is a choice for the owner: state P8's definitions on the screen and in the guide (open-order set, close, tolerance basis), or give Northfield's connection a tool that returns them. Either is a Phase 4 change.

Runs: `runs/run1.json` to `run5.json`; grades: `grade-report.json`.
