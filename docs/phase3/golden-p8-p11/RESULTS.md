# Graded runs for P8 and P11, 15 November 2026

Five no-context runs, each answering through the live connectors only: Northfield's for P8 (its SQL tool allowed), Ashby's for P11 (its SQL tool barred). Questions: `questions.json`; expected answers: `expected.json` (P8 from P8's own engine, P11 from the built world); grader: `grade.mjs`.

| Question | Prototype | Passed |
| --- | --- | --- |
| G8a: open-order value by stage | P8 | 5 of 5, after the fourth definition was stated (0 of 5 without it) |
| G8b: invoices billed above received | P8 | 4 of 5 |
| G8c: value released at acknowledgment | P8 | 5 of 5 |
| G11a: what the check found on ASN-78260, rule and owner per finding | P11 | 5 of 5 |
| G11b: who released version 2, under which rule, when it was sent | P11 | 5 of 5 |
| G11c: receipt matched, cartons, no charge, amount paid | P11 | 5 of 5 |

## P8 needs a fourth definition on screen

With the three definitions stated, every run reproduced ordered, received and the release figure, and every run put $16.8M to $18.5M in the wrong stage in the same way. P8's engine places units by where the goods are, not by the paperwork: units shipped and not yet received stay "shipped, not received" even when invoiced; the invoiced stage holds only received units; for suppliers delivering straight to stores, shipped units stay in transit until paid. Stated in the question, five runs of five matched all five stage values. P8's rework (its Phase 4 row) must show this rule beside the stage strip with the other three.

Also seen in every run: "confirmed, not shipped" comes out $14,917.20 (0.34%) above the engine. It passes the 0.5% tolerance but is not explained; and runs count 200 open orders where the story calendar anchor says 340, already listed as a P8 fault.

Runs: `runs-first/` (all six questions, three P8 definitions), `runs-g8a/` (G8a with the fourth), `runs/` (the graded set: G8a from `runs-g8a`, the rest from `runs-first`).
