# TG for Retail · Build Guide

Working copy: `docs/build-guide.md` in the repo. Reading copy: the Claude doc at https://claude.ai/artifact/5fb2Z4j5jAZeTdMpjkQSvJ, refreshed from this file after every commit.

## How to use this guide

This is the only plan a builder reads before working on TG for Retail prototypes, the demo world or the MCP server. Status in it is as of repo commit f9c8276.

- **Authority, highest first:**
  1. Owner decisions, recorded under Decisions.
  2. The live server and the repo ([nuggetswise/agenticMCP](https://github.com/nuggetswise/agenticMCP), branch main).
  3. The [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd), for rules.
  4. Prototype source code.
  5. The Prototype specs tab, for prototypes not yet built.
  6. This guide.
  7. Every other doc.
- **When it conflicts:** where this guide disagrees with a higher source, this guide is wrong. Fix it here first.
- **No copied values:** counts, amounts, dates and rule wording are read from the owners named under Where each fact lives. The only figures here are proof results, each tied to a commit.
- **Changing this guide:** edit this file, run `node scripts/guide-check.mjs`, commit and push, then refresh the Claude doc's three tabs from this file. The check also fails when a rule from a retired governing section has no home here (`docs/guide/coverage.json`).

## Build flow

<!-- figure: build-flow -->

1. Phase 0 audits every prototype against every check, read only.
2. The owner approves a change list.
3. Phase 1 applies approved world changes and closes world gaps.
4. Phase 2 makes every agent decision come from records, on both companies' connections.
5. Once Phases 1 and 2 pass their proofs, Phase 3 builds new prototypes from the Prototype specs tab.
6. Phase 4 changes one built prototype at a time: propose a change list, wait for approval, build with the three skills, walk it and pass the contract test, then publish and log the call. A rejected list goes back for revision.

Status lives in the task lists, not in the figure, so the figure does not go stale.

## Rules every build follows

Each rule has one home, here. Its ID is how `docs/guide/coverage.json` maps the retired sources to it.

**Sources**

- **R01** Builders open only Claude docs, the repo, the live server, prototype source and, for partner checks only, partner websites. They never open files uploaded to the project or internal OpenText links. A missing fact goes into a Claude doc first, normally a tab of this guide.

**People and data**

- **R02** Two people are named and no one else. Priya Raman (Ashby Supplier) does every supplier role: operations, finance, evidence owner and admin. Jordan Ellis (Northfield Retailer) does every retailer role: buyer contact, claims reviewer, compliance and activation approval.
- **R03** The warehouse and the carrier appear as companies only, Kinross and Lakeline Freight. Any other actor is a function, such as Northfield receiving.
- **R04** All data is fictional, with GS1 prefix 0614141, and the companies are Northfield Retailer and Ashby Supplier everywhere. No retailer customer data goes into fixtures or analysis.

**Story**

- **R05** Each prototype shows three beats on screen: the problem in one line with one number from the world, the turn where the solution acts, and the result as the confirming business record and its measure.
- **R06** Show the whole journey, end to end; a feature boundary never ends it.
- **R07** Present the ideal state: no conditional framing and no "proposed" tags.
- **R08** Show EDI and API in use on the route map. Settled route lines carry a small arrowhead.

**Screens**

- **R09** Minimal and functional: little text, smooth motion, no guided tour.
- **R10** No OpenText product names anywhere on screen, including inside the Trading Grid box. Everything Trading Grid does is labelled Trading Grid. (Owner decision, 13 November.)
- **R11** No dates, feature IDs, durations beside buttons, green ticks, or stage labels such as detect, prioritize, act and verify.
- **R12** No variant or scenario pickers.
- **R13** Colours come only from the OpenText TG Retail Design System tokens.

**Agents**

- **R14** Each agent is named "[Name] Agent", such as Claim Agent, and acts for Priya or for Jordan, never for both.
- **R15** Every agent screen has a manual option.
- **R16** Before the agent starts, the user opens and edits its rules. The goal is fixed, the user's rules are editable and the guardrails are locked.
- **R17** The agent visibly reads systems and compares records; it never reads as a rule being applied.
- **R18** The agent sends a task, document or message only with the user's approval or a standing policy the user set. Each send shows the authority, channel, target-system response and audit record.
- **R19** The agent never changes an authoritative record without permitted authority.
- **R20** User actions change what happens next. P8 is the one exception: it is read only and carries no budget approval.
- **R21** An agent appears only where all six tests pass; otherwise the behaviour is shown as rule-based automation with no agent label.
  1. A named decision: two materially different next steps, and the evidence that leads to each.
  2. A rule baseline: the simplest credible rule-based workflow runs on the same case.
  3. Changed evidence: a changed record produces a different next step with no new script.
  4. Authority: who approves, where, and the target system's response.
  5. A business confirmation: a business record such as a receiving advice, a passed test or a matched repayment. A 997 confirms only that a file was accepted.
  6. A failure case: a document that never arrives, a tool that fails, or a deadline that approaches.
- **R22** Agents read thresholds from the rule catalogue. A threshold with no catalogue rule stays an agent setting and gets no new rule; that covers the Pace Agent's dominance threshold and the strategy doc's three timing numbers.

**Customer-agent access**

- **R23** The caller is the customer's own AI assistant in the customer's workspace. The assistant platform is never named on screen.
- **R24** Access is read-only at first release. Actions go back to Trading Grid screens for approval.
- **R25** The customer's admin picks scopes before connecting. A question outside the scopes, or about another company's records, gets a refusal, not a guess.
- **R26** Every answer cites the Trading Grid records it used.
- **R27** Every call is written to an access log: user, assistant, tool, scope, outcome and time.
- **R28** An incident or work order is created by the customer's assistant in the customer's own service desk. Trading Grid is not changed.

**Domain facts**

- **R29** Most retailers return only a 997 and send no business acceptance; Northfield follows NF-1.5.
- **R30** Inventory is pulled by API in real time, not sent by the supplier.
- **R31** The EDI Review Pack is the only rule catalogue. A rule shown on screen carries its catalogue statement, not a paraphrase.

**Building and changing prototypes**

- **R32** Changes to built prototypes happen in Phase 4 only, one prototype at a time. Propose a RETAIN, CORRECT, DELETE, ADD list citing rule IDs and registry anchors, and build only after the owner approves it. Nothing is republished without that approval.
- **R33** A new prototype is built from scratch from its Prototype specs entry. For every prototype task, tg-retail-workspace-prototype, enterprise-product-writing and visual-treatment-planner are loaded before any visible word changes.

**Working rules**

- **R34** Never overwrite a doc or artifact another chat created unless the owner asks.
- **R35** Every proof and note is committed to the repo under docs/. A result that exists only in a scratchpad is not evidence.
- **R36** Every call is logged in docs/build-log/CALLS.md with what would change it.
- **R37** Words: Trading Grid Catalogue or TGC, never AC; Supplier readiness; banned words follow the enterprise-product-writing skill.

## Where each fact lives

Each kind of fact has exactly one owner. This guide points to that owner and never restates its values.

| Fact | Owner | How to read it |
| --- | --- | --- |
| Counts, documents, orders, amounts, times | The world, `build/tg.db` | `npm run build`; live server tools |
| Rule wording, owner, basis, charges, thresholds | [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd) | Repo mirror `registry/catalogue-pack.json`; the gate fails if it differs from the world |
| Per prototype: calendar moment, agency verdict, anchor records, tools, status | `registry/registry.json` | Read the file |
| Tool list for both connections | `src/tools.js` | Read the file; `/openapi.json` for REST |
| On-screen numbers each prototype claims | `contract/claims.json` | `npm run contract` |
| Builder calls and what would change them | `docs/build-log/CALLS.md` | Read the file |
| Owner decisions | This guide, under Decisions | — |
| Phase 0 evidence | `docs/phase0/` | Findings, walks, contract report, golden questions |
| Northfield scope evidence | `docs/phase2/` | Northfield golden questions |
| X12 validity | `validator/` | `npm run validate` |
| Partner capability | The partner's own documentation | Cited in `docs/phase0/FINDINGS.md`; moments and questions in the Partner diligence tab |
| Feature behaviour | Prototype source, or its Prototype specs entry if unbuilt | — |

**Role of every other doc**

| Doc | Role from now | Sections that stop governing |
| --- | --- | --- |
| [TG-Retail-Single-Thread-Prompt](https://claude.ai/artifact/LC3ehzTGLV8yNJ1JQRkVN9), plus two same-named copies in this project | Retired; this guide replaces it | All of it |
| [Prototype Plan](https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S) | Portfolio and story calendar, for peers | Start here and its decisions, Build queue, Revisions to built prototypes, Not building, Standing rules for every prototype, Retailer-side prototypes |
| [Shared Demo Database and MCP Server Plan](https://claude.ai/artifact/BH5yvtjF5thUSJhUjrSBun) | Kept as a record; its decisions, open items, server behaviour and hosting notes now live here | All of it |
| [Agent and MCP strategy](https://claude.ai/artifact/VXoARJoJoqyv4VmGRUjFtz) | Self-contained leadership read: position, agentic tests, task analysis. Its four build briefs stay the specs for P10, P13, P6 and the NetSuite journey. | How to use this doc, Rules every build follows, One world behind every prototype |
| [SPS MAX and TrueCommerce AI: Threat Ranking](https://claude.ai/artifact/PFa9A3bMAn8aZUiNKFRQae) | Competitive reference | Not a build source |
| Project uploads: Requirements v8, the partner briefs, the Northstar teardown and prototype, and the prototype skill's Plan .md, Demonstration Inputs and Presenter Notes | Not opened by builders. What builders need from them is in the Prototype specs and Partner diligence tabs. | All of them |

None of these docs has been edited yet. Their governing sections come out only after the owner approves each change.

## Decisions

The owner approved change items 1 to 14 on 12 November. Two are done, four are partly done and eight have not started. Three of the eight were applied and then withdrawn on 12 November, until their Phase 4 change lists are approved.

| # | Approved change | Phase | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Rule catalogue mirrors the EDI Review Pack; agents read thresholds from it; screen wording of P5, P6, P7 matches the catalogue | 1, then 4 | World done; screen wording not started | Commit 0d3fb87; gate checks `rules.catalogue_equals_review_pack` and `agents.thresholds_come_from_catalogue` |
| 2 | Deduction case as of; deductions total; SQL tool description | 1 | Done | CALLS 6 and 7 |
| 3 | P1: remove dates, selector, product names; P4 selector | 4 | Withdrawn, not started | CALLS 21, 22, 25 |
| 4 | AP-4.1 evidence-on-hand rule; P6 consent redesign, Lakeline prepaid, NF-5.5 meaning | 1, then 4 | Rule done; screen not started | CALLS 3 |
| 5 | AP-5.1 share of prior volume; P7 week 6 orders; P7 In Full and charge figures tested | 1, then 4 | Rule done; week 6 orders absent from the world; charge conflict open | CALLS 4; `contract/claims.json` |
| 6 | ERP-native Activation: names, its own order, tests in P2 only | 4 | Withdrawn, not started | CALLS 23, 25 |
| 7 | NetSuite: its records in the world, earlier findings, keep one P5 risk | 4 | Withdrawn, not started | CALLS 24, 25 |
| 8 | Partner Map edits; list of Retail Direction section 9 changes | Docs | Not started | — |
| 9 | Agentic Retail Trade figures from the world or removed | 4 | Not started | — |
| 10 | Prototype Briefs: retired P4 link, old names, P7 placeholder | Docs | Not started | — |
| 11 | Cut repeated figures; add a confirming business record to P1, ERP-native, P2, NetSuite | 4 | Not started | — |
| 12 | Overlap and role proposals from the Phase 0 report | 4 | Not started | — |
| 13 | P5: a shipment opens at once while ranking finishes behind it | 4 | Fixed only in an unpublished working copy | — |
| 14 | Northfield scope on the same world | 2 | Done; live Northfield connector not run | Commit 5dd3748; CALLS 10 to 17 |

**Standing decisions**

| ID | Decision | What would change it |
| --- | --- | --- |
| D01 | Partners in scope: Pipe17, Vividly, Kanmon, Salsify, ShipHawk. Out: Insight Works, RetailPath, and ShipHero as a separate partner (it reaches us through Pipe17). | — |
| D02 | Pipe17 is ecosystem only, shown on the warehouse side; retailer EDI stays on Trading Grid | — |
| D03 | Partner designs show only capability the partner documents today | — |
| D04 | Salsify's partner-only questions stay diligence notes; the owner pursues Salsify directly | — |
| D05 | Rule NF-1.7 stays on the 855 | — |
| D06 | The non-Claude client test is dropped | — |
| D07 | The eleven retired October pages listed in `docs/phase0/HANDOFF.md` are unshared by the owner | — |
| D08 | Builders use Claude docs only (R01); Requirements v8 is not a source | — |
| D09 | No product names anywhere on screen (R10) | — |
| D10 | This repo file is the working copy; the Claude doc is refreshed from it | — |
| D11 | Live checks of ship notices and invoices against retailer rules are existing capability: Trading Grid Intelligence, through Chargeback Avoidance. P5 shows the agent layer on top; no new detection prototype. | — |
| D12 | AI-assisted onboarding and map work run on Mapping AI Aviator, shown in P2 and the NetSuite journey; no new prototype | — |
| D13 | Suppliers see errors while testing before go-live through the compliance link; validation before go-live is not prototyped | — |
| D14 | Command Center Integration Monitor does not alert on missing, out-of-order or late documents; P13 fills that gap | — |
| D15 | No Trading Grid Insights or Trading Grid Intelligence API exists for an MCP server; MCP access goes on the roadmap, P10 shows it, and the API is its first engineering step | — |
| D16 | No in-product question-and-answer assistant; its questions are answered through the customer's own AI in P10 | — |
| D17 | Not building guided supplier onboarding (shown in P2 and the NetSuite journey) | — |
| D18 | Not building supplier cash watch: P8 and P6 cover it. Still unshown: a 3PL shipment whose status never reaches Supplier ERP, so no invoice is created. | — |
| D19 | Not building stalled drop-ship order detection: drop-ship is a small share of net deduction dollars in the internal chargeback analysis | — |
| D20 | Not building agentic trading partner mapping: Mapping AI Aviator gives parity | — |
| D21 | Not building a support assistant: outside Retail scope | — |
| D22 | Not building demand forecasting in VMI: out of scope; P9 is the 852-only answer | — |
| D23 | The ship notice rule is within 1 hour of departure on every screen (NF-4.2) | A named retailer guide a demo must match |
| D24 | PO reference rejections travel on the 997; business errors on the 824 | A retailer guide that applies the limit as a business rule |
| D25 | Five scopes are on by default; the P10 journey shows the admin switching deductions off | A demo that must open with four |
| D26 | Existing tool names are kept so connected assistants keep working | A naming standard for the product API |
| D27 | The replenishment scorecard and the buyer-order view are separate populations | A single scorecard across both order streams |
| D28 | Jordan reverses the shortage charge and upholds the ship notice charge | — |
| D29 | The world follows built screens for rule wording and record numbers where the screens already agree with each other | A screen rebuilt from the world |
| D30 | Retailer jobs with no Trading Grid evidence stay out of prototypes: docks, carrier diversion, stores and shelves, forecasting and replenishment, shelf life, packaging, emissions, peak planning, distribution-centre stock | Trading Grid evidence for the job |

**Open questions for the owner**

1. Retire ERP-native Activation? It is not in the registry.
2. The Prototype Plan's gallery card still carries the Threat Ranking title. It has to be renamed in claude.ai.
3. Delete the three retired presenter-notes files from this project?
4. P7's charge on screen differs from the charge the world computes (`contract/claims.json`). Should the screen or the world change?
5. Which verified partner capabilities enter the timeline: Orderful's carton-level 945, ShipHawk's package data, or none?
6. Nine pages may be retired (listed in `docs/phase0/HANDOFF.md`). Keep or retire each?
7. Supplier vetting (identity, bank details, signed terms) is left out because Trading Grid holds no such records. Confirm?
8. Product ownership and competitor positions per prototype lived in presenter-notes files, now retired. Should they move to the Prototype Plan's portfolio table, or be dropped?

## Inventory

The inventory has eighteen items: ten screen prototypes, two server scopes, three planned prototypes, two narrative pages and one connector never audited. Registry status comes from `registry/registry.json`. Each link was checked live on 12 November.

| ID | Prototype | Class | Registry status | Link |
| --- | --- | --- | --- | --- |
| P1 | Long-tail | Screen | Built | [P1](https://claude.ai/artifact/N5Ly5kZWYqop1urPyH7WDp) |
| P2 | Programme Readiness | Screen | Built | [P2](https://claude.ai/artifact/CM4B561qshaXjHkzWNtdi8) |
| P4 | Marketplace to Wholesale | Screen | Built | [P4](https://claude.ai/artifact/FLWwR1dFDG4tposZcw2Q85) |
| P5 | Scout Shipment Watch | Screen | Built | [P5](https://claude.ai/artifact/2Erv5An571ZHnR3WoUY5sf) |
| P6 | Northfield Charge Resolution | Screen | Built | [P6](https://claude.ai/artifact/3r1Xy87Vk4rDHDYSaKcQxo) |
| P7 | Northfield Performance Improvement | Screen | Built | [P7](https://claude.ai/artifact/9F1PiXsrUJ54AJq1dSJMbu) |
| P8 | Money in Motion | Screen, view only | Built | [P8](https://claude.ai/artifact/RB5p54UuQ9GFGDPxhGzU3a) |
| P9 | Shelf Recovery | Screen | Built | [P9](https://claude.ai/artifact/3D2tsVjwvnmMtPEoRKSpVe) |
| NS | NetSuite Chargeback Avoidance | Screen | Built | [NetSuite](https://claude.ai/artifact/AhjjX49TBdZ7qbMiHkZpnx) |
| ERP | ERP-native Activation | Screen | Not in registry | [ERP-native](https://claude.ai/artifact/NKh7WnRwiPQSqa7vz61zYj) |
| P10 | Trading Grid in the customer's AI, Ashby scope | Server | Live | [Server](https://tg-retail-demo-mcp.onrender.com) |
| NF | Northfield scope on the same server | Server | Not in registry | Same server, Northfield key |
| P13 | Silent order watch | Planned | Queued | — |
| P14 | Invoice Variance | Planned | Planned | — |
| P15 | Rule Replay | Planned | Planned | — |
| ART | Agentic Retail Trade | Narrative | Not in registry | [Agentic Retail Trade](https://claude.ai/artifact/P6KTkzJp8rVcY5wNUvrcwS) |
| FILM | TG for Retail in Two Minutes | Narrative | Not in registry | [Film](https://claude.ai/artifact/RQbZQsmz433BjJCaEbU1BL) |
| CAT | Retailer catalogue connector | Connector | Not in registry | Not recorded |

The registry calls NetSuite a ship notice exception with an agent; the live screen has no agent. The registry is the drift item: T2.7 corrects it.

## Coverage grid

Phase 0 is closed only when no cell reads Not done or Partly. A cell records whether the check was done. What the check found is the Phase 4 work.

- **A1** Problem, turn and result, each with a number from the world
- **A2** A manual option on the same case
- **A3** Agency: the next step changes when the record changes
- **A4** A customer's own agent reaches the job through the tools
- **A5** The same fact repeated in one view
- **A6** The same job in more than one prototype
- **A7** On-screen values checked against the world
- **A8** Roles merged into one person after renaming
- **A9** Walked end to end
- **C1** Golden questions, five runs, graded against SQL

| ID | A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | C1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | Partly | Not done | N/A | Not done | Not done | Done | Done | Not done | Done | Partly |
| P2 | Partly | Not done | N/A | Not done | Partly | Done | Done | Not done | Done | Not done |
| P4 | Partly | Not done | N/A | Not done | Done | Done | Done | Done | Done | Partly |
| P5 | Partly | Partly | Partly | Not done | Done | Done | Done | Done | Partly | Partly |
| P6 | Done | Partly | Done | Not done | Done | Not done | Done | Done | Done | Done |
| P7 | Done | Partly | Done | Not done | Partly | Not done | Done | Not done | Partly | Done |
| P8 | Not done | N/A | N/A | Not done | Not done | Not done | Done | Not done | N/A | Not done |
| P9 | Partly | Not done | Done | Not done | Done | Not done | Done | Not done | Done | Partly |
| NS | Partly | Not done | N/A | Not done | Done | Done | Done | Not done | Done | Not done |
| ERP | Not done | Not done | N/A | Not done | Partly | Done | Done | Not done | Done | Not done |
| P10 | Not done | Not done | Done | Done | N/A | Not done | N/A | Not done | Done | Done |
| NF | Not done | Not done | Not done | Done | N/A | Not done | N/A | Not done | Done | Done |
| P13, P14, P15 | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| ART | N/A | N/A | N/A | N/A | N/A | N/A | Done | N/A | N/A | N/A |
| FILM | N/A | N/A | N/A | N/A | N/A | N/A | Partly | N/A | N/A | N/A |
| CAT | Not done | Not done | Not done | Not done | Not done | Not done | Not done | Not done | Not done | Not done |

**Why a cell is N/A**

- **A3 on P1, P2, P4, ERP and NS:** none of these screens has an agent.
- **P8:** view only. Nothing to walk, and no manual or agent path.
- **A5 and A7 on the two server scopes:** a server has no screen, and its values are the world itself.
- **P13, P14 and P15:** not built. Every check applies once they are.
- **ART and FILM:** owner decision of 12 November, A7 only.

**Evidence behind each column**

| Check | Evidence |
| --- | --- |
| A1, A5 | `docs/phase0/FINDINGS.md`: turn 3 screen table; turn 4 sections A1 result beat and A5 repeats |
| A2 | Manual paths walked for P5, P6, P7 (FINDINGS, turn 4 scripted walks). Same-case not assessed; no other prototype assessed. |
| A3 | FINDINGS: A3 agency from source, and turn 4 A3 agency on the prototypes. Server: gate mutation test. |
| A4 | None in Phase 0. Server rows come from the golden runs, which call the tools. |
| A6, A8 | Turn 3 report in FINDINGS: overlap across prototypes; collapsed roles |
| A7 | `docs/phase0/contract-report-turn4.json`; narrative pages in FINDINGS, other live sources. Film frames not inspected. |
| A9 | `docs/phase0/walks/` and FINDINGS turn 4. P5 dead state found; P7 manual pattern A not confirmed by hand. Server and Northfield: `npm run smoke`. |
| C1 | `docs/phase0/golden/` (Ashby) and `docs/phase2/golden-nf/` (Northfield) |

## Partner checks

The Pipe17 question that had to be settled first is settled. Two partner checks are still open: partner nodes on the route maps beyond P2, and ShipHawk's questions and journey moment. Verdicts and sources are in `docs/phase0/FINDINGS.md` under B.

| Check | Status | Evidence |
| --- | --- | --- |
| Pipe17 ShipHero connector carries carton and SSCC detail | Done: not documented | Pipe17 ShipHero help article, cited in FINDINGS |
| Orderful 3PL route | Done: the 945 carries one record per carton; the 3PL sends no 856 | Orderful 945 and 3PL pages, cited in FINDINGS turn 4 |
| Partner Map claims, verdict and source each | Done | FINDINGS, Partner Map claims table |
| Retail Direction section 9 claims | Done | FINDINGS turn 4, Partners |
| Partner briefs: moment, division of labour, stop conditions | Done for Pipe17, Kanmon, Vividly and Salsify | Partner diligence tab |
| Partner nodes on every prototype route map | Partly: P2 only | FINDINGS B |
| Alliances with SPS, TrueCommerce, Cleo | Done, one search per partner | FINDINGS, alliance checks |
| Questions only the partner can answer | Partly: all but ShipHawk | Partner diligence tab |
| Journey moment and what the customer gains over Trading Grid alone | Partly: all but ShipHawk | Partner diligence tab |

## Tasks

Phase 0 is approved but not closed. Phases 1 and 2 are partly done, and Phases 3 and 4 have not started. A task is ticked only when its evidence is committed. Cite the task ID in the commit message and the CALLS entry.

### Phase 0 · Audit, read only

- [ ] **T0.1** Fill every Not done and Partly cell in the coverage grid.
  Done when every cell reads Done or N/A. Evidence: `docs/phase0/`, under the cell's check.
- [ ] **T0.2** Audit P10, the Northfield scope and the retailer catalogue connector as prototypes.
  Done when their grid rows are complete and the connector's link is recorded in Inventory.
- [ ] **T0.3** Golden questions for P2, P8, NetSuite and ERP-native, and more for P1, P4, P5 and P9.
  Done when each has at least three questions with five graded runs. Evidence: `docs/phase0/golden/`.
- [ ] **T0.4** Restore the X12 check against bots-grammars as a committed script.
  Done when the script and its report sit in `validator/` and it rejects each injected fault for the stated reason.
- [ ] **T0.5** Confirm P7 manual pattern A by hand.
  Done when FINDINGS records it as a defect or as a walker limit.
- [ ] **T0.6** Add ShipHawk's partner-only questions and journey moment from ShipHawk's own documentation, and partner nodes on every prototype route map.
  Done when the Partner checks table has no Not done or Partly row.
- [ ] **T0.7** Read the film's frames.
  Done when the FILM A7 cell reads Done.

### Phase 1 · World

- [x] **T1.1** World and server parts of approved items 1, 2 and 4, and AP-5.1.
  Evidence: commit 0d3fb87; CALLS 3, 4, 6 and 7.
- [ ] **T1.2** Settle P7's week 6 orders and charge figure.
  Done when the owner answers open question 4 and P7's contract check runs against the live page, not a working copy.
- [ ] **T1.3** Partner records in the timeline.
  Done when the owner answers open question 5 and any added record traces to a cited partner document.
- [ ] **T1.4** Shipments without a receipt.
  Done when the owner confirms CALLS 8: other suppliers' shipments with no receipt are P8's stuck value.
- [ ] **T1.5** Raw X12 panels on prototypes generated from the world.
  Done when every prototype's raw X12 panel matches a document in `build/tg.db` byte for byte, checked by the contract test.
- [ ] **T1.6** World records for every Prototype specs decision row: a price variance under NF-7.11, and other suppliers' ship notices that NFD-1 would fail.
  Done when the replay of each draft rule and each P14 decision row returns at least one record, proposed first as a Phase 1 change list.

### Phase 2 · Agent and customer-agent access

- [x] **T2.1** Northfield scope: shared documents, private records, refusals, writes that follow the catalogue.
  Evidence: commit 5dd3748; `docs/phase2/golden-nf/`.
- [ ] **T2.2** Every agent decision on every prototype computed from its timeline records.
  Done when the A3 column reads Done for every prototype with an agent.
- [ ] **T2.3** Agent governance, from the Agent governance entry in Prototype specs: authority limits, override, pause, audit, and replay of a changed agent rule before it goes live.
  Done when a gate check replays a changed agent rule and the governance golden questions pass.
- [ ] **T2.4** Shelf Agent reads averages; Watch Agent reads NF-4.2 from the catalogue.
  Done when `agents.thresholds_come_from_catalogue` covers both agents.
- [ ] **T2.5** Tool comparison includes Northfield's tools.
  Done when the comparison table in this guide's Server reference lists both connections' tools against the published NetSuite and Salesforce schemas.
- [ ] **T2.6** P15's registry anchors hold its draft rule record.
  Done when `registry/registry.json` names NFD-1 under P15 and the registry check passes.
- [ ] **T2.7** Registry covers every inventory row, and the build fails when a doc or the server disagrees with it.
  Done when ERP-native (or its retirement), the Northfield scope, the narrative pages and the connector are in `registry/registry.json`, and a gate check reads it.
- [ ] **T2.8** Repo copies of the other docs become dated snapshots.
  Done when each copy under docs/ carries its export date and the registry check no longer treats them as current.
- [ ] **T2.9** Live Northfield connector run, only if a live Northfield demo is wanted.
  Done when one Northfield golden question is answered through the live URL with the Northfield key.

### Phase 3 · New prototypes

- [ ] **T3.1** Check each spec in the Prototype specs tab against the world.
  Done when every record each spec needs exists, or a Phase 1 change list adds it.
- [ ] **T3.2** Rank the specs, place them on the story calendar, and build the top one after Phases 1 and 2 pass their proofs.
  Done when the owner approves the ranking and the first new prototype passes its acceptance tests, walk and contract test.

### Phase 4 · Prototype changes, one at a time

- [ ] **T4.1** For each of P1, P2, P4, P5, P6, P7, P8, P9, NetSuite and ERP-native (unless retired), work through the Phase 4 loop under Build flow.
  Done for a prototype when it has an approved change list, a walk with no script errors and a passing contract test, and the call is logged.
- [ ] **T4.2** Portfolio entry page built from the story calendar.
  Done when the owner approves it and every link on it opens a live prototype.
- [ ] **T4.3** Portfolio film, after the owner approves a storyboard.
  Done when every chapter's numbers pass the contract test and a viewer states each chapter's problem and outcome.
- [ ] **T4.4** Docs: Partner Map edits, Retail Direction section 9 change list, Prototype Briefs fixes, Agentic Retail Trade figures.
  Done when each change list is approved and applied, with its CALLS entry.

## Server reference

**Connections**

| Element | Behaviour |
| --- | --- |
| Connection | One per company, each on its own token: Ashby at `/mcp/<MCP_TOKEN>`, Northfield at `/mcp/<NF_TOKEN>`. Both tokens are generated by Render (`render.yaml`); copy a value from the Render dashboard to connect. |
| Scopes | Orders, documents, errors, rules and deductions, picked by the company's admin. A tool that needs a scope that is off refuses; a field that needs it reads "Scope not granted" with the scope's name. |
| Isolation | Each connection opens a database that holds only what its company may see. Ashby's warehouse, ERP and agent records, the 940 and 945, and Ashby's policies stay off Northfield's copy. Northfield's accounts payable match, draft rules and reviewer notes stay off Ashby's. |
| Refusals | "Not available to Ashby" and "Not available to Northfield"; every refusal is written to that connection's access log. |
| Time | Every question tool takes a time to answer as of. The default is the story clock (`STORY_CLOCK`). |
| REST twin | The same tools over REST, described by `/openapi.json`, generated from the one tool list. |
| Record pages | Each answer links to an order or document page with the record and its X12 text. |
| Writes | A write records a proposal; nothing changes until the connection's person approves it, and approval appends the record to the shared case and both access logs. Reset returns both connections to baseline. `WRITES=off` makes both read-only. |
| URL | Carries a secret token; suitable for fictional data only, not production sign-in. |

**Writes follow the rule catalogue**

| Write | Drafted by | Approved by | Rule |
| --- | --- | --- | --- |
| submit_dispute | Claim Agent | Priya Raman; without asking only under AP-4.1 | AP-3.2, AP-4.1 |
| release_ship_notice | Priya's assistant | Always Priya Raman | AP-1.3 |
| decide_charge | Jordan's assistant, with Review Agent's recommendation | Always Jordan Ellis | NF-7.7 |
| publish_rule | Jordan's assistant | Jordan Ellis, only after a replay of that draft | `nf.publish_needs_replay` |
| request_change | Either assistant | The connection's person | AP-3.2 |

**Hosting**

- Render's free tier deploys from main. The service sleeps after a spell without traffic and takes about a minute to wake, so open the URL a few minutes before presenting ([Render](https://render.com/docs/free)).
- Its filesystem resets on restart, which clears the access log and any proposals.
- The Java validator does not run on Render. Its report is committed with a hash of the X12 files, and the build fails if the built files do not match that hash.
- `/healthz` reports the same version for every commit, so it cannot show which commit is deployed.
- The live server reports writes off, while `render.yaml` sets no `WRITES`. The setting is presumably made in the Render dashboard; not verified.

**Compared with published tool lists**

| Vendor | What is published | How this surface differs |
| --- | --- | --- |
| NetSuite | [MCP Standard Tools](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0902023508.html): generic tools for records, SuiteQL, reports and saved searches | NetSuite exposes the data model; this surface answers trading questions and cites the rule. The read-only SQL tool is the nearest equivalent. |
| Salesforce | [Hosted MCP server for record reads](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html): schema, query, search, recent and related records; writes on separate servers | Same split of reads from writes; this surface adds point-in-time answers and refusals for other companies' records |
| SPS Commerce | A [press release](https://www.spscommerce.com/press/max-ai-fulfillment-edi/) says MAX Connect supports MCP; no tool list or schema is public | Not comparable |

## Proofs, open items and drift control

The gate and smoke tests pass at commit f9c8276. Four of the plan's proofs have not been built or run.

| Proof | Command or location | Result |
| --- | --- | --- |
| World gate: invariants, catalogue equals the pack, thresholds from the catalogue | `npm run build` | 385 passed, 0 failed |
| Server smoke: both scopes, refusals, the shared deduction case | `npm run smoke` | 54 passed, 0 failed |
| X12 validation | `npm run validate` | Passes, but its schemas were generated in this repo, so it does not meet the independent-schema test |
| Contract test of on-screen values | `npm run contract` | Last full report is `docs/phase0/contract-report-turn4.json`. The P7 claim was checked against a working copy, not the live page. |
| Golden questions, Ashby agents, scorecard and deductions | `docs/phase0/golden/grade-report.json` | 49 of 50. The earlier set's grader was never committed. |
| Golden questions, Northfield | `docs/phase2/golden-nf/grade-report.json` | 50 of 50 |
| Live server | /healthz | ok, version 0.2.0, writes off |
| Property-based invariants on quantities, time order and money | — | Not built; the gate checks invariants on the one generated quarter only |
| Fresh agent answers ten builder questions from the docs | — | Not run |
| Viewer states each film chapter's problem and outcome | — | Not started |
| One-page review pack for an EDI practitioner | [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd) | Built, but no EDI practitioner has reviewed it |

**Not verified**

- No EDI practitioner has reviewed the documents or the rule catalogue.
- SPS Commerce publishes no MCP tool list.
- The ship notice timing rule is cited from a third-party summary of a retailer guide, not the guide itself.
- Whether a published prototype can read the server live was never tested; prototypes carry their fixtures inline.
- A shipment with a ship notice and no receipt exists only for other suppliers (T1.4).
- Raw X12 panels inside built screens are not generated from the world (T1.5).

**How this guide stays current**

- **Pointers, not values:** the guide holds rules, decisions, status and pointers. Every value stays with its owner.
- **The check script:** `node scripts/guide-check.mjs` fails when any of these is true:
  1. The repo has changed behaviour since the commit the guide states.
  2. A commit, path, npm script, gate check, tool, rule ID or CALLS number it names does not exist.
  3. A registry prototype is missing from Inventory, or an Inventory row is missing from the grid.
  4. A grid cell is blank or holds an unknown word, or Inventory status disagrees with the registry.
  5. A money amount, percentage or large count appears.
  6. The proof counts above differ from a fresh run.
  7. A claude.ai link is not in `docs/guide/artifacts-verified.json`.
  8. Any eight-word passage appears twice.
  9. An item in a retired governing section has no home in this guide, per `docs/guide/coverage.json`.
  10. A task has no ID or no done-when line.
- **Overlap report:** the script also reports passages shared with the repo copies of the Prototype Plan, the database plan and the strategy doc.

---

<!-- Tab: Prototype specs -->

# Prototype specs

These specs are the requirements for TG for Retail prototypes and jobs not yet built. They were drawn once, on 12 and 13 November, from the Northstar retailer prototype and its teardown, which builders do not open. A built prototype takes its requirements from its own source. Northstar is drawn with sample data: it is evidence of a design, not of demand.

## Where each Northstar flow went

Northstar presents 40 business flows across 17 views. Every flow has one disposition.

| Northstar view | Business problem it presents | Disposition |
| --- | --- | --- |
| Overview | Leaders cannot see where orders, suppliers or sites need intervention | Fold into P8, Money in Motion |
| Overview | A buyer's urgent decisions sit in separate queues | Northfield assistant job: daily queue |
| Overview | Order changes need an accountable answer before the supplier ships against stale terms | Fold into the Northfield scope as a timeline record under NF-1.6 |
| Overview | Receiving cannot anticipate late loads or loads with no ship notice | Left out (D30: docks) |
| Exceptions | Too many issues compete for attention and ownership | Northfield assistant job: daily queue |
| Exceptions | Ordered, shipped and received quantity differ | Fold into P6's shortage case and P14's first decision row |
| Exceptions | A shipment may arrive with no ship notice or a disputed carrier trail | Retailer ship notice chase |
| Exceptions | Paying the wrong invoice leaks money or blocks settlement | P14 |
| Exceptions | Short-dated goods raise spoilage risk | Left out (D30: shelf life) |
| Orders | No shared account of what was ordered, shipped, received and invoiced | Northfield assistant job: order trace |
| Suppliers | Poor delivery is hard to attribute to a supplier | Northfield assistant job: supplier performance |
| Products | Low cover and uneven site stock | Left out (D30: replenishment) |
| Network | Uneven distribution-centre stock and inbound load | Left out (D30: distribution-centre stock) |
| Store | Missed store deliveries and empty shelves (two flows) | Left out (D30: stores and shelves) |
| Rules | Requirements need consistent enforcement across suppliers | P15 |
| Rules | A changed rule can create false rejections or payment holds | P15 |
| Supplier compliance | Repeat breaches and inconsistent follow-up | Fold into P7, as the Northfield request that opens it |
| Onboarding | Unverified identity, bank details or unsigned terms | Left out, pending open question 7 |
| Onboarding | A supplier fails testing, the first acknowledgment or ramp-up | Fold into P2 |
| Packaging and emissions | Packaging data, fees and emission hotspots (three flows) | Left out (D30) |
| Agents | Replenishment, forecast critique, shelf-life triage, carrier diversion (five flows) | Left out (D30) |
| Agents | Ship notice reminders and escalation | Retailer ship notice chase |
| Agents | Minor invoice discrepancies queue while material ones need review | P14 |
| Agents | Repeat breaches need a reviewed improvement plan | Fold into P7 |
| Agents | Operators need authority limits, oversight and intervention | Agent governance (T2.3) |
| Simulations | A change can raise risk unless replayed and approved first | Agent governance (T2.3) and P15 |
| Simulations | Results that look good in replay can fail in live operation | Agent governance (T2.3) |
| Simulations | Teams need to track changes at different stages | Agent governance (T2.3) |
| Peak | Demand spikes beyond capacity; plans fail when assumptions change (two flows) | Left out (D30: peak planning) |
| Network health | Broken connections interrupt orders and confirmations | Northfield assistant job: connection health |
| Document flow | Missing acknowledgments and stuck documents stall trade | Northfield assistant job: order trace |
| Navigation | Users need a role-based starting point | Not a business job |

## P13 Silent order watch

Build brief 2 in the [Agent and MCP strategy](https://claude.ai/artifact/VXoARJoJoqyv4VmGRUjFtz) stays P13's spec until P13 is built. It is supplier-side and already complete: decision table, fixtures, journey, changed evidence and acceptance tests.

## P14 Invoice variance investigation

One held invoice can trace to a short receipt, a price beyond tolerance, a total that does not add up, or a correction already sent. Each needs a different record to settle it.

- **Seen by:** Jordan Ellis, Northfield accounts payable.
- **Agent:** Match Agent, on Northfield's connection.
- **Payment:** release stays in Northfield accounts payable.
- **Tools:** `three_way_match`, `supplier_document_trail`, `get_document`, `request_change`.
- **Anchor:** INV-7731 and its corrected invoice, as `registry/registry.json` records.

**User stories**

1. As Jordan, I see each held invoice with the rule that held it and the three documents compared, so I know what settles it.
   - Accepted when each hold names its rule (NF-7.8, NF-7.10 or NF-7.11) and links the PO, receiving advice and invoice.
2. As Jordan, I want Match Agent to fetch the settling record before I decide, so I do not search three systems.
   - Accepted when the next step changes as the records change, following the decision table. The mutation test switches between two records.
3. As Jordan, I approve or reject Match Agent's proposal.
   - Accepted when the approval names the person and the record, and no payment state changes on screen.
4. As Priya Raman, I see the hold and any correction request on the shared documents only.
   - Accepted when Ashby's scope refuses Northfield's notes and accounts payable records with its own refusal text.

**Decision table**

| What the records show | Next step | Rule |
| --- | --- | --- |
| Invoice bills more than the receiving advice shows | Hold; ask Ashby for a credit memo or corrected invoice | NF-7.8, NF-7.2 |
| A line price sits beyond tolerance of the acknowledged price | Hold the line; read the order change history; clear it if an accepted change set that price | NF-7.11, NF-1.1 |
| Invoice total differs from the sum of its lines | Reject as a document fault | NF-7.10 |
| A corrected invoice arrived after the hold | Match the corrected invoice; the original stays replaced | NF-7.2 |
| PO, receiving advice and invoice all disagree | Read the receiving advice first, then the invoice lines; propose the record that settles each line | NF-5.5, NF-7.8 |

- **Simplest rule baseline:** the match shows Held with the failing rule, and Jordan fetches every record himself.
- **World gap:** no invoice line in the world varies on price, so the price row has no record yet (T1.6).
- **Not modelled:** promotion and tax variances. The catalogue has no rule for either, so adding them needs an owner decision and a new rule.
- **Northstar sources:** invoice reconciliation, match resolution, and the triple-mismatch case, which is the plan's mutation case.

## P15 Rule replay before publishing

When a retailer changes a supplier rule, it cannot see beforehand whose documents will start failing or what charges follow. Suppliers then take charges for a window they could not meet, and the cost returns to Northfield as disputes, claims review and scorecard swings. Trading Grid already lets retailers define chargeback rules; P15 adds a replay before a change goes live.

- **Seen by:** Jordan Ellis, Northfield compliance.
- **Agent:** none. Replay is a computation, so this is a tool (registry verdict).
- **Anchor:** draft rule NFD-1, which shortens the NF-4.2 ship notice window. Its replay shows the added failures and charge exposure.
- **Tools:** `list_draft_rules`, `replay_draft_rule`, `publish_rule`, `lookup_rules`.
- **Gate checks:** `nf.replay.nfd1` and `nf.publish_needs_replay`.

**User stories**

1. As Jordan, I draft a rule: the document it checks, the condition, the action and any charge.
   - Accepted when the draft is stored as a draft rule and no live document is affected.
2. As Jordan, I replay the draft against the quarter and see which suppliers' documents would fail, how many, and the charge exposure.
   - Accepted when every figure comes from `replay_draft_rule` over the world, and the same draft always gives the same result.
3. As Jordan, I publish only after a replay is on record.
   - Accepted when `publish_rule` refuses a draft with no replay.
4. As Priya Raman, I see a rule only once it is published.
   - Accepted when Ashby's scope never shows a draft.

- **World gaps:** every ship notice NFD-1 newly fails is Ashby's, although the other suppliers send ship notices too, so the replay shows one supplier. Draft NFD-2, on price tolerance, fails nothing. Both go to T1.6.
- **Northstar sources:** rules library, rule authoring tested against recent receipts, and change replay with approval.

## Retailer ship notice chase

This job belongs to Jordan's own assistant on Northfield's connection. No new screen is needed; it is the retailer-side moment of P10.

**User stories**

1. As Jordan, I ask which inbound orders lack a ship notice.
   - Accepted when the answer names each order, its NF-4.2 window and what Northfield's own records show.
2. When the ship notice and the carrier record disagree, the assistant says which source to read next and why. It does not chase on the deadline alone.
   - Accepted when two records with different trails give two different next steps. This is the plan's mutation case: dispatch confirmed while the carrier and ship notice trails disagree.
3. A chase is a proposal through `request_change`. Nothing reaches Ashby without Jordan.
   - Accepted when the proposal appears in both access logs.
4. Ashby's warehouse and ERP records stay private.
   - Accepted when the assistant gives Northfield's refusal text.

- **Northstar sources:** missing or late shipment notice, and the ship notice chase agent.

## Northfield assistant jobs

These jobs run through Jordan's own assistant on Northfield's connection. Each needs golden questions graded against SQL before it counts as done.

| Job | User story | Tool today | Gap |
| --- | --- | --- | --- |
| Order trace | As Jordan, I ask where one order stands from PO to remittance, and which document is stuck and why | `supplier_document_trail` | Golden question needed |
| Supplier performance | As Jordan, I ask which suppliers miss on time and in full, and which documents drive the miss | `supplier_scorecard` | Golden question needed |
| Daily queue | As Jordan, I ask what needs Northfield's attention today across ship notices, invoices and deductions, ranked by money at risk and age | None | A new tool, built only if the owner ranks it in T3.2 |
| Connection health | As Jordan, I ask which suppliers' exchanges are failing and on which channel | `supplier_document_trail` over a period | Golden question needed; channel detail to confirm |

## Agent governance

Operators need to see and limit what agents do, and to try a change safely before it goes live. This is Phase 2 work (T2.3), on both connections.

1. As Priya or Jordan, I see each agent's authority limit and every action it took, with the record and the outcome.
   - Accepted when the access log and the case history show agent, authority, approver and outcome for every write.
2. As the user, I can pause an agent, and take over or override its proposal.
   - Accepted when a paused agent proposes nothing and an override is recorded with who made it.
3. A changed agent rule is replayed against the quarter before it goes live, with its effect shown beside the current rule.
   - Accepted when a gate check replays one changed agent rule and the result differs from the current rule's.
4. A change that looks good in replay can still fail live, so it runs for a trial period with drift watched and a way back.
   - Accepted when the change list records the trial, the drift measure and the rollback path. A live trial is not prototyped.

- **Northstar sources:** agent control plane (authority, audit, override, pause, kill) and the scenario workbench (replay, approval, trial, drift, rollback).

## Partner journeys

Kanmon supplier cash and a Vividly promotional deduction are not specified. Phase 0 found neither route in the partner's own documentation: no hosted referral for Kanmon and no Trading Grid evidence feed for Vividly. They return when a partner documents the route.

---

<!-- Tab: Partner diligence -->

# Partner diligence

The Partner Map carries each partner's role, flows and value. It does not carry what the partner briefs add: where the partner sits in the journey, the questions only the partner can answer, and when to stop. Those were copied once, on 12 November, from the four in-scope briefs, so builders do not open the briefs. ShipHawk has no brief, and the ShipHero and RetailPath briefs are out of scope.

| Partner | Moment in the journey | Division of labour | Stop if |
| --- | --- | --- | --- |
| Pipe17 | Activate: between the supplier's order system and several warehouses | Trading Grid keeps retailer EDI; Supplier ERP stays the order authority; Pipe17 routes orders and returns warehouse facts | Pipe17 expects to replace Trading Grid EDI; the ship notice or label fields are unavailable; the customer's systems already suffice; delivery cost exceeds the benefit |
| Kanmon | Extend: after a receivable exists, before the retailer's payment date | Kanmon underwrites, funds, services and collects; the first option is a partner-hosted link that carries no Trading Grid data | No referral-only option and no approved integration economics; no authorized placement; poor borrower terms; regulatory or brand risk |
| Vividly | Activate and Optimize: terms are set before the order; matching happens when invoices, remittances and promotional deductions are reconciled | Vividly owns promotion terms and matching; Trading Grid supplies invoice and remittance evidence only where those routes run; finance ERP settles | Trading Grid does not improve the outcome; promotion-term permissions fail; case ownership duplicates; no buying sponsor |
| Salsify | Connect: before the first order, while item content is validated and accepted | Salsify owns attributes, retailer validation and syndication; the retailer approves items; Trading Grid carries the trade once the route is set up; Trading Grid Catalogue stays out | No new supplier access; no status or feedback interface; data rights fail; no recurring network value for Trading Grid |

## Questions only the partner can answer

**Pipe17**

1. Can Pipe17 coexist with Trading Grid EDI, commercially and technically? Who owns the retailer relationship when Pipe17 also sells managed EDI?
2. For one customer flow with two warehouses, which component routes a split order, and which returns the shipment facts?
3. Is the handoff an existing ERP or OMS connector or a new interface? Who owns, specifies and supports it?
4. Does Pipe17's output carry the carton, SSCC and label detail that one retailer programme's ship notice needs?

**Kanmon**

1. Which retail suppliers face recurring financing demand, and in which countries and revenue bands?
2. Can a customer-initiated introduction that carries no data and needs no build qualify commercially?
3. If not, what is the smallest supported API or white-label design, and what does it cost to maintain?
4. What does underwriting need? Does EDI evidence add anything? What are the approval rates, borrower cost and licensing geography?

**Vividly**

1. Where do deployments stall today, and would Trading Grid evidence change onboarding cost, matching accuracy or recovery?
2. Which two or three accounts overlap, each with a sponsor and an authorized data owner?
3. Who owns integration and support before anything is priced?

**Salsify**

1. Can a third-party catalogue be added as a syndication destination, and by what route?
2. Which retailer requirements, validation errors and publication statuses are exposed to authorized systems?
3. Does Salsify emit publication or acceptance events that a partner can subscribe to?
4. How does Salsify see the overlap between its own data pool and Trading Grid Catalogue?
5. Which brands are shared customers, and may they be named?

## Where a brief and the Partner Map disagree

- **Kanmon:** the brief's first option carries no Trading Grid data. The Partner Map's flow sends consented trading history from Trading Grid to Kanmon. Builders take the brief's posture, and the Partner Map is corrected under approved change 8.
- **Pipe17:** the brief's flow returns carton facts from the warehouse. Phase 0 found no carton or SSCC detail in Pipe17's ShipHero connector, so that return stays unshown until Pipe17 documents it.
