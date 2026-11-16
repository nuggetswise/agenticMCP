# Real-model runs, one per agent (R44, D64)

Each file is one governance replay through the live connectors on the deployed server: the rule baseline and the agent on the same branch and facts, every proposal approved by a labelled test approver, outside parties answering by deterministic rules (synthetic). Each file holds the job id, the change-list trial, both session ids, both outcomes, the replay answer and the session views fetched from `/sessions/<id>`. Model: gemini-3.5-flash-lite on the primary route.

An agent passes when its outcome is better than the baseline's on the business result the prototype ends at. Where both take the same step, the step is automation (D61).

| Agent | Prototype | Facts | Baseline outcome | Agent outcome | Sessions (baseline · agent) | File | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scout Agent | P5 | `unforeseen_overpack_note` | 659 of 660 cartons; the buyer told of a short line | 660 of 660; Kinross overpacked the carton on its note; ship notice matched by the receipt | SC-4d9fb72de6 · SC-ff9c6158a6 | `scout.json` | Beats |
| Claim Agent | P6, Ashby | `december_28` | All three charges accepted; nothing recovered | Load scan, tally and delivery receipts requested from Kinross and Lakeline; two disputes; $193.60 recovered and matched; DC-41131 accepted | CL-086b13e6ac · CL-4636bf3fda | `claim.json` | Beats |
| Review Agent | P6, Northfield | `tally_count_only` | Reversed on the label "load tally"; $96.80 repaid | Read the tally, found no SSCCs, recorded not reviewed (NF-5.3, NF-7.5) | RV-522995f4e3 · RV-e5db35eee5 | `review.json` | Beats |
| Pace Agent | P7 | `canonical` | Task drafted for the split week without asking Priya (a violation); nothing shared with Northfield | One task for the supported cause; explanation shared and accepted by Northfield; no violation | PC-4f54e95941 · PC-665ac325d4 | `pace.json` | Beats, after a fix (first run: `pace-failed-1.json`) |
| Shelf Agent | P9 | `in_transit` | 40 more pairs ordered for store 114 while ASN-451207-1 was in transit (duplicate stock) | Waited for the goods in transit; nothing sent | SH-b6f172875f · SH-d2776e6072 | `shelf.json` | Beats |
| Watch Agent | P13 | `unforeseen_kinross_note` | Every document sent; NR-46220's ship notice waits for the 945 at 11:40 | Run 3 (`watch-failed-3.json`): escalated Kinross's note to Priya at once, then stopped at its turn limit with the 855 and 810 unsent. Run 4: the same nine steps as the baseline; the note was read and not acted on | WS-7dc4d764c8 · WS-244635fcee | `watch.json`, `watch-failed-3.json` | Not passed: ties the baseline; the step that beats it appeared in one of two runs |
| Match Agent | P14 | `ashby_free_text` | Decision table: request lines 1 and 2, match INV-7731C-S, short-pay line 2, propose lines 1 and 3 clear | The same four steps | MS-e05a14709c · MS-180ae1806e | `match.json`, `match-canonical.json` | Beats the spec's baseline (Held, Jordan fetches every record); ties the decision table on every step |
| Chase Agent | P19 | `mixed_trails` | Ship notices chased for six loads that never left (six violations) | Readiness failures recorded for the six; Lakeline asked about NR-46609; a correction asked for NR-46616; NR-46602 chased; no violation | CH-478a380690 · CH-3759ec0ba5 | `chase.json` | Beats, after a fix (first run: `chase-failed-1.json`) |
| Claim Agent | P20 | moment 6 January 2027 (promotions) | All five promotion deductions accepted, $3,452.70 | Two matched deductions accepted; three disputed for what the deal does not support; $677.20 recovered and matched | CL-160ecbe78a · CL-914ac4eb2c | `claim-promotions.json` | Beats, after a fix (first run: `claim-promotions-failed-1.json`) |

## What the failed runs found, and the fix

- **Model routes busy or a dropped connection** ended Chase and Watch mid-run (503 on both routes; then "fetch failed"). The model caller now retries, then goes round both routes up to three times with a wait.
- **Pace Agent** passed extra arguments and the wrong record to share_explanation and stopped after two refusals. Every runtime agent now starts from read_queue and uses its row ids; a refusal for argument shape no longer counts toward the two-refusal stop.
- **Claim Agent at the promotion moment** accepted all five deductions: its instruction led with the shortage evidence pack. The promotion moment now has its own instruction.
- **Watch Agent** read Kinross's note that the trailer had left and the load scan sat in Kinross's portal, then waited for the 945 as the fixed rule does. Its instruction now escalates such a note to Priya at once.
- **A replay outlasts a connector call** (about four minutes). Replays now answer with a job id; the result is read at `/jobs/<id>`.

## Open

- Watch Agent does not yet pass R44. The fix that adds its winning step (escalate a Kinross note the rules cannot act on) took in one run of two. Recommendation: make the escalation a rule-engine finding the agent must answer (a note that contradicts its status is surfaced as a finding, as Scout's rule findings are), rather than leave it to the model's reading. P13 stays on its recorded run until then.

- Match Agent ties P14's decision table in every variation tried (canonical and the supplier's free-text claim): the table already reads every record the agent reads. Against P14's specified baseline it beats it; against the table each step is automation. Recommendation: present P14's steps as automation with the agent credited for the trace and the fetch, or give the agent a step the table cannot take (asking the supplier for proof of the delivery its note claims).
- Pace Agent shared the explanation and drafted the supported task but did not ask Priya which site leads the split week; the baseline drafted it without asking. P7's screen needs the question, so the instruction for the split week is the next fix.
- Sessions live in memory: a server restart ends them. The files keep everything the screens need.
