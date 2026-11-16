# Real-model runs, one per agent (R44, D64)

Each file is one governance replay through the live connectors on the deployed server: the rule baseline and the agent on the same branch and facts, every proposal approved by a labelled test approver, outside parties answering by deterministic rules (synthetic). Each file holds the job id, the change-list trial, both session ids, both outcomes, the replay answer and the session views fetched from `/sessions/<id>`. Model: gemini-3.5-flash-lite on the primary route.

An agent passes when its outcome is better than the baseline's on the business result the prototype ends at. Where both take the same step, the step is automation (D61).

| Agent | Prototype | Facts | Baseline outcome | Agent outcome | Sessions (baseline · agent) | File | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scout Agent | P5 | `unforeseen_overpack_note` | 659 of 660 cartons; the buyer told of a short line | 660 of 660; Kinross overpacked the carton on its note; ship notice matched by the receipt | SC-4d9fb72de6 · SC-ff9c6158a6 | `scout.json` | Beats |
| Claim Agent | P6, Ashby | `december_28` | All three charges accepted; nothing recovered | Load scan, tally and delivery receipts requested from Kinross and Lakeline; two disputes; $193.60 recovered and matched; DC-41131 accepted | CL-086b13e6ac · CL-4636bf3fda | `claim.json` | Beats |
| Review Agent | P6, Northfield | `tally_count_only` | Reversed on the label "load tally"; $96.80 repaid | Read the tally, found no SSCCs, recorded not reviewed (NF-5.3, NF-7.5) | RV-522995f4e3 · RV-e5db35eee5 | `review.json` | Beats |
| Pace Agent | P7 | `canonical` | Both tasks drafted on the largest reason code; the split week drafted without asking Priya (a violation); nothing shared with Northfield | Quarter task drafted; Priya asked which site leads the split week; Groveport stock-count task drafted after her answer; explanation shared and accepted by Northfield; no violation | PC-7df777c4aa · PC-51352f5b3c | `pace.json` | Beats, after two fixes (`pace-failed-1.json`, `pace-failed-2.json`: the second shared the explanation but never asked) |
| Shelf Agent | P9 | `in_transit` | 40 more pairs ordered for store 114 while ASN-451207-1 was in transit (duplicate stock) | Waited for the goods in transit; nothing sent | SH-b6f172875f · SH-d2776e6072 | `shelf.json` | Beats |
| Watch Agent | P13 | `departure_scanned_46220`, the standard signal: Kinross's departure scan over its API, no 945 (the email-note preset is removed, D68) | Kinross asked; NR-46220 escalated to Priya at 09:17; 855 and 810 on time; both ship notices Late; 856 for NR-46220 built from the load scan when the 945 arrives at 11:40 | The same ten steps; escalated at 09:31, after the 09:30 deadline | WS-f58a0a7d12 · WS-b60783ad2d | `watch.json`; email-note runs kept as `watch-failed-1..3.json`, `watch-tie-1.json`, `watch-email-note-4.json` | Not passed: every step is automation (D68) |
| Match Agent | P14 | `ashby_free_text` | Decision table: request lines 1 and 2, match INV-7731C-S, short-pay line 2, propose lines 1 and 3 clear; Ashby's claim that line 2 came on a later truck left open | The same four steps (automation), plus a request for the later ship notice and the carrier's delivery receipt; Ashby withdraws the claim; no claim open | MS-c769ecc254 · MS-65a2e4860c | `match.json`, `match-tie-1.json` | Beats the decision table (the earlier run tied it) |
| Chase Agent | P19 | `mixed_trails` | Ship notices chased for six loads that never left (six violations) | Readiness failures recorded for the six; Lakeline asked about NR-46609; a correction asked for NR-46616; NR-46602 chased; no violation | CH-478a380690 · CH-3759ec0ba5 | `chase.json` | Beats, after a fix (first run: `chase-failed-1.json`) |
| Claim Agent | P20 | moment 6 January 2027 (promotions) | All five promotion deductions accepted, $3,452.70 | Two matched deductions accepted; three disputed for what the deal does not support; $677.20 recovered and matched | CL-160ecbe78a · CL-914ac4eb2c | `claim-promotions.json` | Beats, after a fix (first run: `claim-promotions-failed-1.json`) |

## What the failed runs found, and the fix

- **Model routes busy or a dropped connection** ended Chase and Watch mid-run (503 on both routes; then "fetch failed"). The model caller now retries, then goes round both routes up to three times with a wait.
- **Pace Agent** passed extra arguments and the wrong record to share_explanation and stopped after two refusals. Every runtime agent now starts from read_queue and uses its row ids; a refusal for argument shape no longer counts toward the two-refusal stop.
- **Claim Agent at the promotion moment** accepted all five deductions: its instruction led with the shortage evidence pack. The promotion moment now has its own instruction.
- **Watch Agent** read Kinross's note that the trailer had left and the load scan sat in Kinross's portal, then waited for the 945 as the fixed rule does. Its instruction now escalates such a note to Priya at once.
- **A replay outlasts a connector call** (about four minutes). Replays now answer with a job id; the result is read at `/jobs/<id>`.

## Open

- Watch Agent: an email note from Kinross is not standard practice (D68). A 3PL reports in the 945 and carriers and 3PLs in the 214; a note by email while a feed is down is a workaround. The note preset, the note fact and the escalate-on-note instruction are removed. P13's steps are automation until Watch has a step the rules cannot take on a standard record.

- Match Agent (D69): asks Ashby to prove a delivery its answer claims before Jordan short-pays; it beats the decision table on the supplier's free-text claim. Its other four steps are automation.
- Pace Agent (D71): the queue marks a split week as waiting for Priya's answer, and an agent that stops with that row open is told once; it now asks first and beats the baseline.
- Sessions live in memory: a server restart ends them. The files keep everything the screens need.
