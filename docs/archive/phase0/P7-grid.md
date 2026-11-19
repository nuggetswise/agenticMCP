# P7 Northfield Performance Improvement: grid row evidence (T0.5, T0.15), 13 November 2026

Source walked: the live page, version 1794507905-7183, with `docs/phase0/walks/walk.mjs`. Logs: `docs/phase0/walks/P7/`. The live answer came from the Ashby connection. Nothing on the prototype was changed.

## T0.5 Manual pattern A by hand
- Not a defect. Two manual walks reach "Send result to Northfield" with no script errors: one taking the first option at each choice (pattern "Received below ship notice"), one taking the last (pattern "Short shipped, remainder cancelled", the pattern the earlier walk stalled on, with "No, write my own action").
- The earlier stall was a walker limit: that walker left the selects unset.

## A2 Manual option on the same case
- Both paths work the same scorecard. By hand it takes 13 actions; with Pace Agent the shortest run is about 11.
- The two paths end differently on the same pattern choice: the manual walk ends "Pattern improved, official result unchanged" and the agent walk ends "Improvement verified" with a higher Northfield score. The outcome should not depend on who clicked.

## A4 A customer's own agent reaches the job through the tools
- The Ashby connection, asked for the scorecard next step at P7's moment, returns the same dominant pattern the screen's agent path works (short shipments of one item at one warehouse) and proposes a corrective task for Priya to approve.
- It names its confirming record as Northfield's next published scorecard. The accepted task card no longer ends there.

## A5 The same fact repeated in one view
- The end view shows each headline figure once.

## A6 The same job in more than one prototype
- The scorecard job is P7's alone among the screens. The planned Northfield assistant job "supplier performance" reads the same scorecard from Jordan's side; with the accepted card the two tell one story from two seats and should share one set of figures.

## A8 Roles merged into one person
- Jordan asks for the plan and accepts it; Priya does everything on Ashby's side. No other first names remain on the live page.

## A9 Walked end to end
- Three walks complete with no script errors: two manual, one with the agent.

## A10 Click budget and click map (R42)
The manual path takes 13 actions against a budget of about eight.

| # | Click | What changes | Beat |
| --- | --- | --- | --- |
| 1 | Find what keeps failing | Failing lines grouped into patterns | Problem |
| 2 | Choose a pattern | The pattern's lines | Turn |
| 3 | Work this pattern | Opens the cause view | None: fold into click 2 |
| 4 | Group by failure or by DC | Regroups the lines | Evidence |
| 5 | Yes, target it | Sets the corrective action | Plan |
| 6 | Send plan to Northfield | The plan goes to Jordan | Plan |
| 7 | Accept plan | Jordan accepts | Plan |
| 8 | Continue to week 6 | Jumps ahead in time | Plan |
| 9 | Open the 3 lines | New short-shipped lines | Plan |
| 10 | After week 13, compare | Jumps to the next quarter | Plan |
| 11 | Open the next scorecard | The next score | Plan |
| 12 | Open the next scorecard, again | Same button a second time | None |
| 13 | Send result to Northfield | The result goes to Jordan | Result |

## Findings for Phase 4, against the accepted task card
- The screen tells the story the card removed. Its three steps are "Find what keeps failing", "Send Northfield a plan" and "Check next quarter's score"; clicks 5 to 12 are all corrective-plan and later-score steps.
- The card's story is Ashby's own figures, derived from the documents Trading Grid carries, shared with Northfield so both hold the same account. Clicks 1 to 4 and a share step cover it, which fits the budget.
- The screen does have a problem line: Northfield's score and the measure that missed its target. It can stay, reworded to the card's problem.
- P7 needs a rebuild in Phase 4, not a correction, and the server's scorecard job text follows it.
