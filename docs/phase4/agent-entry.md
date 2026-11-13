# How agents start: evidence and Phase 4 tasks

13 November 2026. Owner decision D54 rewrites R15, R16 and R17: an agent starts on a business event, never on a button. This file holds the evidence for which built prototypes break that today and the specific change each one needs. Nothing on any prototype was changed; these items enter each prototype's Phase 4 change list (R32).

## Method and its limit

- Each built prototype's live version was read on 13 November and compared with the version Phase 0 walked. All six match, so the committed walk logs in `docs/phase0/walks/` describe the live pages as they stand.
- The logs record every click offered at each step. The first step shows whether the page waits for someone to start the agent.
- Limit: no new browser pass was run. This session can read a published page but cannot save its source to disk for the scripted walker. If a prototype is republished, its version changes and its row here must be rechecked.
- P1, P2 and P4 are held by the owner and were not opened. The registry marks all three rule-based, with no agent.

## What the walks show

| Prototype | Live version (same as walked) | Agent | First actions offered on load | Start button | Other entry finding |
| --- | --- | --- | --- | --- | --- |
| P5 Scout Shipment Watch | 1794507904-ed4a | Scout Agent | "Start Scout Agent" only | Yes | After the start, opening a shipment while the agent ranks leaves no action for 90 seconds (approved change 13) |
| P6 Northfield Charge Resolution | 1794576274-6525 | Claim Agent | "Start Claim Agent", "Work by hand" | Yes | The manual path is a second start button, not a takeover |
| P7 Northfield Performance Improvement | 1794507905-7183 | Pace Agent | "Start Pace Agent", "Find what keeps failing" | Yes | Same pattern as P6 |
| P9 Shelf Recovery | 1794451627-6daf | Shelf Agent | "Open store view" | No | Worse than a start button: an agent switch changes nothing, and Priya clicks through every step the agent should have done ("Review both stores", "Check Ashby stock", "Prepare recommendation") |
| P11 NetSuite Chargeback Avoidance | 1794576237-3b68 | None | "Route to Warehouse operations" | No | Already the target shape: the page opens on a ship notice the check has held, inside NetSuite |
| P8 Money in Motion | 1794576266-f6d7 | None | None; view only | No | Not affected |

Sources: `docs/phase0/walks/P5/agent-log.json`, `P6/walk-log.json`, `P7/agent-log.json`, `P9/walk-log.json` and `switch-log.json`, `P11/walk-log.json`, `P8/load-log.json`; `docs/phase0/P9-grid.md` for the switch.

Three of four agent prototypes wait for a start click, and the fourth has no visible agent work at all. The checkpoints after the start are already close to the target: each walk shows "Approve and send", "Edit", "Do it myself" and a reject or alternative at the approval step.

## What vendors ship (checked 13 November 2026)

| Vendor | How an agent starts | Where the person meets it | Source |
| --- | --- | --- | --- |
| Salesforce Agentforce | Triggered by a data change or platform event; runs in the background | In the flow of work, with approval kept for higher-risk actions | [Agentforce 2dx announcement](https://investor.salesforce.com/news/news-details/2025/Salesforce-Launches-Agentforce-2dx-with-New-Capabilities-to-Embed-Proactive-Agentic-AI-into-Any-Workflow-Create-Multimodal-Experiences-and-Extend-Digital-Labor-Throughout-the-Enterprise/default.aspx) |
| ServiceNow | A trigger on a record; autonomous or supervised is chosen at design time | On the record: the workflow pauses at checkpoints for input or approval, and a notification brings the user back | [In-product experience for agentic workflows](https://www.servicenow.com/community/now-assist-articles/in-product-experience-for-agentic-workflows/ta-p/3507831) |
| SAP Joule | Two kinds, named by SAP: conversational agents, started by what the user asks Joule, and autonomous agents, started by business events, API calls or schedules | Human in the loop is on by default; a decision that needs a person arrives as a task in SAP Task Center, a cross-application inbox; the agent runs with the calling user's permissions | [Joule Studio](https://www.sap.com/sea/products/artificial-intelligence/joule-studio.html); [Joule Studio questions and answers](https://community.sap.com/t5/technology-blog-posts-by-sap/joule-studio-goes-live-answers-to-your-top-questions/ba-p/14152403); [Joule Work reference architecture](https://architecture.learning.sap.com/docs/ref-arch/bc7811) |
| Oracle NetSuite | Triggers and execution roles set in SuiteAgent Studio before activation | Exceptions to review and approve; a management workspace for oversight | [NetSuite AI tools, November 2026](https://itbrief.com.au/story/oracle-netsuite-unveils-new-ai-tools-for-cloud-erp) |

Vendor pages describe intent as well as shipped behaviour; these four are cited for the pattern, not as proof of what each customer sees. SAP listed system-triggered agents as roadmap for the first half of 2026 and describes them as available in a post of late October 2026; release status in a given SAP product was not checked. The owner's two SAP pages (Joule Studio agentic workflows and custom AI agents, sap.com/canada) refused this session's fetch, so the SAP row rests on SAP's other Joule Studio pages.

What SAP adds to the pattern: the conversational start is legitimate, as a request in the user's words and not a start button, so R16 allows it through the customer's own assistant (P10). SAP also splits skills (fixed, rule-based steps) from agents (reasoning), which is the rule-versus-model marking the intelligence handoff asks for (X3).

## The target pattern

1. **Set once.** Priya or Jordan sets the agent's rules in agent settings: the goal fixed, their rules editable, the guardrails locked. This is not a step in the journey.
2. **An event starts the run.** A document arrives, a rule fails, a deadline nears, a case opens. No one presses start.
3. **The page opens on finished work.** The first frame is the worklist item or the record, with the agent's proposal ready: what it read, what it compared, the rule it applied and what it proposes (R17).
4. **One checkpoint.** Approve, edit, take over, or reject. A standing policy the user set can skip the checkpoint (R18), and the page then opens on what was sent and the response.
5. **Oversight elsewhere.** Authority limits, pause, override and audit sit in the governance view (T2.3), not on the journey.

## What the owner's reference adds (D55)

Source: the owner's research file, SAP Joule Studio Agent UX Reference for Retail Prototype, 13 November. Builders do not open it; this section carries what they need. Whether a SAP feature is live or pre-release does not matter here, because the file is used for interaction patterns only. Its workflow canvas, agent builder and n8n material are out of scope.

**The proposal, as the first frame.** Business record first, agent second:

| Part | What it holds | Rule |
| --- | --- | --- |
| Record | The order, shipment, invoice or case affected, and its deadline | R16 |
| Problem | One line | R05 |
| Evidence | The records read, each named and openable | R17 |
| Finding and proposal | What the agent found, what it proposes, and what it does not know | R17, R21 |
| Steps | Each step with who did it: rule, agent, person or system | R17 |
| Actions | Approve, edit, take over, reject or ask for another | R15 |
| Latest state | The furthest state a record supports | R18 |

**Who did each step.** Four markers, shown on the evidence:

| Marker | Example in this world |
| --- | --- |
| Rule | A ship notice checked against NF-4.2; a case opened because a deadline passed |
| Agent | Choosing which record to read next when two disagree; the recommendation |
| Person | Priya approves a release; Jordan decides a charge |
| System | Northfield's 997; Northfield's receiving advice; a remittance |

**States.** Five, never merged: proposed, approved, sent, technically acknowledged (997), settled (the business record Inventory names as the ending). A sent document with no receiving advice yet reads as sent and waiting, not as resolved. These are states of records, not stage labels across the page, which R11 still bars.

**Design checks added to each Phase 4 walk.** The reference lists eight; five are already rules here (changed evidence is R21 test 3, authority is R18 and R19, a 997 is not acceptance under R29, two people on one case is P6's shared case, and the ending record is Inventory). Three are new:

1. The job can be finished without opening a chat.
2. A reader can tell at a glance whether the proposal is pending or applied.
3. One decision can be traced from the record read, to the step taken, to the document sent, to the record that settles it.

**Not taken from the reference.** A run number, version and step timings on screen (R11 bars durations); an "ask" box inside Trading Grid (D16 sends questions to the customer's own assistant); an inbox of counts as a prototype's home (each prototype shows one job, and any count would have to pass the contract test); its sample order number, which is not in the world.

## How the manual option works (R15)

The manual option stays on every agent screen. It moves from the front of the journey to the checkpoint, in three forms:

| Form | What the user does | What the agent does | What is recorded |
| --- | --- | --- | --- |
| Take over this case | Chooses "Take over" on the proposal and works the same case by hand: reads the records, picks the fix, sends it | Stops proposing on that case; the evidence it gathered stays readable | An override, with who made it (governance story 2) |
| Change the proposal | Chooses "Edit", changes the fix, quantity or wording, then approves | Sends the user's version | The edit and the approval |
| Agent paused or off | Opens the same event as a plain task: the rule that failed and the records, with no proposal | Nothing | That the case was worked without the agent |

The third form is the rule baseline R21 already requires, so the comparison between agent and no agent stays showable on the same case (coverage check A2). What goes is the choice at the door: "Start Claim Agent" beside "Work by hand".

## Phase 4 items, by prototype

Each item goes into that prototype's change list as a CORRECT or DELETE line. Event records are in the world today unless marked.

**Every agent prototype: P5, P6, P7, P9**
- AE-ALL-1: CORRECT the first frame to the proposal layout above.
- AE-ALL-2: ADD who did each step to the evidence (rule, agent, person, system). Steps a rule did lose any agent wording.
- AE-ALL-3: CORRECT state labels to the five states; DELETE any "resolved" or "done" shown before the settling record.
- AE-ALL-4: ADD reject and "another option" at the checkpoint where they are missing.
- AE-ALL-5: Walk the three new design checks and record the result in the prototype's grid file.

**P5 Scout Shipment Watch (T4.13)**
- AE-P5-1: DELETE "Start Scout Agent". The page opens on Scout Agent's ranked list of six shipments, already ranked, with the lead shipment's proposal ready. Event: a shipment planned inside the watch window fails a Northfield rule check before departure (anchors NR-460207 to NR-460274).
- AE-P5-2: CORRECT the ranking wait. With the list ranked on load, the dead state of approved change 13 cannot occur; remove the ranking animation as a blocking step.
- AE-P5-3: CORRECT the manual path. "Take over · work it myself" and "Do it myself" stay at the checkpoint; the separate manual entry is removed.
- AE-P5-4: CORRECT the rules step. Scout Agent's rules move to a settings link on the proposal ("Rules applied"), not a step before the run.

**P6 Northfield Charge Resolution (T4.14)**
- AE-P6-1: DELETE "Start Claim Agent" and "Work by hand". The page opens on the deduction case with Claim Agent's recommendation ready. Event: Northfield opens the case (event `case.opened`, DC-40877).
- AE-P6-2: CORRECT the Northfield half the same way: Jordan opens the case with Review Agent's recommendation ready after Ashby's dispute arrives (event `case.dispute`). The retailer-side agent's name must be settled first (handoff constraint).
- AE-P6-3: CORRECT the first checkpoint to carry take over beside "Approve dispute", "Edit" and "Reject"; "Do it myself" is already there.
- AE-P6-4: CORRECT for AP-4.1: where the evidence is on hand and the amount is under the rule's limit, the standing policy applies and the page shows the dispute as sent, with the authority named (R18).

**P7 Northfield Performance Improvement (T4.15)**
- AE-P7-1: DELETE "Start Pace Agent" and "Find what keeps failing". The page opens on Pace Agent's finding: the dominant pattern among short shipments, with the evidence. Event: Northfield publishes a scorecard file (event `scorecard.published`).
- AE-P7-2: CORRECT the manual path to a takeover from the finding: Priya groups the failing lines herself (the existing Failure, Item, Ships from, DC grouping).
- AE-P7-3: Done together with the rebuild the grid already calls for (the corrective-plan story the task card removed) and with D51's figures.

**P9 Shelf Recovery (T4.17)**
- AE-P9-1: DELETE the agent switch.
- AE-P9-2: CORRECT the journey so Shelf Agent has done the reading: the page opens on its recommendation for store 114 and store 207, with the store activity report, the goods in transit and Ashby's stock read shown as evidence. Event: a store activity report (852) arrives showing the shelf empty. The clicks "Open store view", "Review both stores", "Check Ashby stock" and "Prepare recommendation" become evidence, not steps.
- AE-P9-3: ADD the checkpoint the grid found missing: Priya approves the recommendation, and Jordan's acceptance is visible.
- AE-P9-4: ADD the third decision the connection returns and the screen cannot show: wait for goods in transit.

**P11 NetSuite Chargeback Avoidance (T4.18)**
- AE-P11-1: RETAIN the entry. It has no agent and opens on the held ship notice; it is the reference for the others.
- AE-P11-2: ADD who did each step: the check is a rule, the corrections and the release are people, the 997 and the receiving advice are systems. No step is the agent's.
- AE-P11-3: CORRECT the ending state: it stops at the technical acknowledgment today; the settled state is Northfield's receiving advice (records from T1.9).

**P8 Money in Motion (T4.16)**
- No item. View only, no agent.

**P1, P2, P4 (T4.10 to T4.12)**
- AE-HELD-1: when the owner releases them, check each first frame the same way. None has an agent, so the check is only that no page waits for a "start" click before showing its event.

**Planned prototypes**
- AE-P13-1: Watch Agent's spec (build brief 2 in the Agent and MCP strategy) is read against R16 before T3.2 builds it: the queue opens with silent orders already found.
- AE-P14-1: Match Agent runs when an invoice is held under NF-7.8, NF-7.10 or NF-7.11; Jordan opens the held invoice with the proposal ready. Added to the P14 spec.

**Skill**
- AE-SKILL-1: the tg-retail-workspace-prototype skill is loaded before every prototype task (R33). Before the first Phase 4 build, check whether it prescribes a start button or a rules step before the run, and propose an edit to the owner if it does. Not checked in this session.

## Effect on other rules

- R42, click budget: each agent path loses one or two clicks (the start, the rules step). P5's lead shipment took 11 actions against about eight.
- R21 test 3, changed evidence: unchanged. A changed record still has to produce a different opening proposal with no new script; T2.2 carries it.
- R20: user actions still change what happens next, at the checkpoint.
