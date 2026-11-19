# P6 Northfield Charge Resolution: grid row evidence (T0.14), 13 November 2026

Source walked: the live page, version 1794576274-6525, with `docs/phase0/walks/walk.mjs`. Log: `docs/phase0/walks/P6/`. Live answers came from the Ashby and Northfield connections. Nothing on the prototype was changed.

## A2 Manual option on the same case
- Both paths work case DC-40877. With Claim Agent it takes 10 actions to the outcome. By hand ("Do it myself") it takes 15: the dispute choice and its approval, four separate evidence shares and their approval, then the same Northfield review and repayment steps.

## A4 A customer's own agent reaches the job through the tools
- Ashby's connection, asked for the next step on DC-40877 at P6's moment, returns "dispute now" with the three evidence records in the case and the policy that lets Claim Agent dispute without asking. That matches the screen's first move.
- Northfield's connection returns the same case from Jordan's side: the charge withheld, the evidence required and present, Jordan's note and his decision to reverse the shortage.
- Two differences to carry into Phase 4 and the world:
  - The screen puts three charges on the event (shortage, ship notice, on time in full). The Northfield connection's case holds the shortage charge only.
  - The Ashby connection names its confirming record as the repayment matched in Ashby's receivables. P6's ending no longer rests on that match.

## A6 The same job in more than one prototype
- The deduction dispute is P6's alone.
- Its invoice-correction record overlaps the planned P14, which investigates a held invoice from Northfield's side. The Prototype specs tab already folds the quantity mismatch into both; P14 must not repeat P6's correction steps.
- P5 prevents the charge P6 resolves. They share no steps.

## A10 Click budget and click map (R42)
The agent path takes 10 actions against a budget of about eight.

| # | Click | What changes | Beat |
| --- | --- | --- | --- |
| 1 | Start Claim Agent | The agent reads the remittance, scans and case | Turn |
| 2 | Approve dispute | Priya approves the drafted dispute | Turn |
| 3 | Approve sharing | Priya consents to share her own evidence | None: Priya approving Priya |
| 4 | Continue to Northfield review | Switches to Jordan's side | None: could follow the send |
| 5 | Open evidence pack | Jordan sees the evidence | Evidence |
| 6 | Reverse or Uphold, first charge | Jordan decides | Turn |
| 7 | Reverse or Uphold, second charge | Jordan decides | Turn |
| 8 | Record decisions | The decisions are recorded | Turn |
| 9 | 14 days later: repayment | The repayment arrives | Result |
| 10 | View outcome | Withheld, repaid, net and unresolved amounts | Result |

Folding clicks 3 and 4 brings it to eight.

## Findings for Phase 4, against the accepted task card
- No problem line: the page opens inside one case, titled by the amount short-paid.
- The card's result is a reversal on Northfield's remittance. The screen ends on "Matched in Ashby receivables" and a locked guardrail says a reversal is never shown as resolved before that match.
- The card says Priya disputes. The screen says "Approve dispute".
- The card's agent for Jordan is Review Agent. The screen calls it Vet Agent; the server calls it Review Agent.
- Dispute volume: Jordan's queue lists twelve disputes sorted by date received, each "Not checked". Nothing ranks them or shows the agent clearing them, so the card's second problem is not yet told.
- Lakeline Freight still reads "collect freight" (approved item 4).
