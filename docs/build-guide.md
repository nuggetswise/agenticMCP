# TG for Retail · Build Guide

Nov 12, 2026 · @Mandip

Live doc: https://claude.ai/artifact/5fb2Z4j5jAZeTdMpjkQSvJ

## How to use this guide

This is the only doc a builder reads before working on TG for Retail prototypes, the demo world or the MCP server. Status in it is as of repo commit f9c8276.

- **Authority, highest first:**
  1. Owner decisions, recorded under Decisions.
  2. The live server and the repo ([nuggetswise/agenticMCP](https://github.com/nuggetswise/agenticMCP), branch main).
  3. The [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd), for rules.
  4. Prototype source code.
  5. Requirements v8, for feature behaviour.
  6. This guide.
  7. Every other doc.
- **When it conflicts:** where this guide disagrees with a higher source, this guide is wrong. Fix it here first.
- **What it replaces:** the single-thread prompt, plus the build rules, build queue and build briefs inside the Prototype Plan and the Agent and MCP strategy. Until those docs are edited, ignore those sections.
- **No copied values:** counts, amounts, dates and rule wording are read from the owners named under Where each fact lives. The only figures here are proof results, each tied to a commit.

## Build flow

[embedded content: build flow · five phases, one approval loop per prototype]

A prototype change starts only from an approved change list, and a rejected list goes back for revision. Status lives in the checklists, not in the figure, so the figure does not go stale.

## Rules every build follows

These rules hold in every phase.

- **People:** Priya Raman (Ashby Supplier) and Jordan Ellis (Northfield Retailer) are the only named people. Everyone else is a company or a function, such as the Kinross warehouse or Northfield receiving.
- **Data:** all data is fictional, with GS1 prefix 0614141. The companies are Northfield Retailer and Ashby Supplier everywhere.
- **Screens:**
  - No dates.
  - No OpenText product names outside the Trading Grid box on the route map.
  - No variant or scenario pickers.
- **Prototype changes:**
  - Changes happen in Phase 4 only, one prototype at a time.
  - Propose a RETAIN, CORRECT, DELETE, ADD list with requirement IDs.
  - Build only after the owner approves that list. Nothing is republished without that approval.
- **Skills, for every prototype task:** tg-retail-workspace-prototype, enterprise-product-writing and visual-treatment-planner, all loaded before any visible word changes.
- **Prototype skill checklist:** its steps that update the Prototype Plan .md, the Demonstration Inputs and the Presenter Notes are marked Not needed, because those files are retired.
- **Rules:**
  - The EDI Review Pack is the only rule catalogue. A rule shown on screen carries its catalogue statement, not a paraphrase.
  - Agents read their thresholds from the catalogue.
  - A threshold with no catalogue rule stays an agent setting and gets no new rule. That covers the Pace Agent's dominance threshold and the strategy doc's three timing numbers.
- **P8 Money in Motion:** read only. It carries no budget approval.
- **Other people's docs:** never overwrite a doc or artifact that another chat created, unless the owner asks.
- **Links:** never open internal OpenText links.
- **Evidence:** every proof and note is committed to the repo under docs/. A result that exists only in a scratchpad does not count as evidence.
- **Calls:** every call is logged in docs/build-log/CALLS.md with what would change it.
- **Words:**
  - Trading Grid Catalogue or TGC, never AC.
  - Supplier readiness.
  - Banned words follow the enterprise-product-writing skill.

## Where each fact lives

Each kind of fact has exactly one owner. This guide points to that owner and never restates its values.

| Fact | Owner | How to read it |
| --- | --- | --- |
| Counts, documents, orders, amounts, times | The world, `build/tg.db` | `npm run build`; live server tools |
| Rule wording, owner, basis, charges, thresholds | [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd) | Repo mirror `registry/catalogue-pack.json`; the gate fails if it differs from the world |
| Per prototype: calendar moment, agency verdict, anchor records, tools, status | `registry/registry.json` | Read the file |
| On-screen numbers each prototype claims | `contract/claims.json` | `npm run contract` |
| Builder calls and what would change them | `docs/build-log/CALLS.md` | Read the file |
| Owner decisions | This guide, under Decisions | — |
| Phase 0 evidence | `docs/phase0/` | Findings, walks, contract report, golden questions |
| Northfield scope evidence | `docs/phase2/` | Northfield golden questions |
| X12 validity | `validator/` | `npm run validate` |
| Partner capability | The partner's own documentation | Cited in `docs/phase0/FINDINGS.md` |
| Feature behaviour | Requirements v8 (TG\_for\_Retail\_Feature\_Requirements\_v8.docx, this project) | — |

**Role of every other doc once this guide exists**

| Doc | Role from now | Sections that stop governing |
| --- | --- | --- |
| [TG-Retail-Single-Thread-Prompt](https://claude.ai/artifact/LC3ehzTGLV8yNJ1JQRkVN9), plus two same-named copies in this project | Retired; this guide replaces it | All of it |
| [Prototype Plan](https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S) | Portfolio and story calendar, for peers | Start here decisions, Build queue, Revisions to built prototypes, Not building, Standing rules for every prototype, Retailer-side prototypes |
| [Shared Demo Database and MCP Server Plan](https://claude.ai/artifact/BH5yvtjF5thUSJhUjrSBun) | Absorbed into this guide and the repo; kept as a record | All of it |
| [Agent and MCP strategy](https://claude.ai/artifact/VXoARJoJoqyv4VmGRUjFtz) | Self-contained leadership read: position, agentic tests, task analysis | How to use this doc, Rules every build follows, One world behind every prototype, Build briefs |
| [SPS MAX and TrueCommerce AI: Threat Ranking](https://claude.ai/artifact/PFa9A3bMAn8aZUiNKFRQae) | Competitive reference | Not a build source |
| Prototype skill files: Prototype Plan .md, Demonstration Inputs, Presenter Notes | Retired | All of them |

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

- **Partners:**
  - In scope: Pipe17, Vividly, Kanmon, Salsify, ShipHawk.
  - Out: Insight Works and RetailPath. ShipHero is out as a separate partner because it reaches us through Pipe17.
  - Pipe17 is ecosystem only and shown on the warehouse side. Retailer EDI stays on Trading Grid.
  - Partner designs show only capability the partner documents today.
- **Rule NF-1.7** stays on the 855.
- **Non-Claude client test:** dropped.
- **Northfield's live connector** needs NF\_TOKEN on Render, and only for a live Northfield demo.
- **Retired October pages:** the owner unshares the eleven listed in `docs/phase0/HANDOFF.md`.
- **Salsify:** questions only Salsify can answer are kept as diligence notes. The owner is pursuing Salsify directly.

**Open questions for the owner**

1. Retire ERP-native Activation? It is not in the registry.
2. Requirements v8 names eight more people. Map each to Jordan Ellis or to a role name?
3. Requirements v8 says P3 Trade has no agents, while P5, P6 and P7 use agents. Which wins?
4. The Prototype Plan's gallery card still carries the Threat Ranking title. It has to be renamed in claude.ai.
5. Delete the three retired presenter-notes files from this project?
6. P7's charge on screen differs from the charge the world computes (`contract/claims.json`). Should the screen or the world change?
7. Which verified partner capabilities enter the timeline: Orderful's carton-level 945, ShipHawk's package data, or none?
8. Nine pages may be retired (listed in `docs/phase0/HANDOFF.md`). Keep or retire each?

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

The registry calls NetSuite a ship notice exception with an agent; the live screen has no agent. The registry is the drift item: Phase 2 corrects it.

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

The Pipe17 question that had to be settled first is settled. Three of the plan's partner checks are still open. Every verdict and source is in `docs/phase0/FINDINGS.md` under B.

| Check | Status | Evidence |
| --- | --- | --- |
| Pipe17 ShipHero connector carries carton and SSCC detail | Done: not documented | Pipe17 ShipHero help article, cited in FINDINGS |
| Orderful 3PL route | Done: the 945 carries one record per carton; the 3PL sends no 856 | Orderful 945 and 3PL pages, cited in FINDINGS turn 4 |
| Partner Map claims, verdict and source each | Done | FINDINGS, Partner Map claims table |
| Retail Direction section 9 claims | Done | FINDINGS turn 4, Partners |
| Partner briefs (Salsify, ShipHero, Vividly, Kanmon, Pipe17, RetailPath) | Not done | The briefs sit in this project and can now be read |
| Partner nodes on every prototype route map | Partly: P2 only | FINDINGS B |
| Alliances with SPS, TrueCommerce, Cleo | Done, one search per partner | FINDINGS, alliance checks |
| Questions only the partner can answer | Partly: Salsify only | FINDINGS, Salsify questions |
| Journey moment and what the customer gains over Trading Grid alone | Not done | — |

## Phase checklists

Phase 0 is approved but not closed. Phases 1 and 2 are partly done, and Phases 3 and 4 have not started. A task is ticked only when its evidence is committed.

### Phase 0 · Audit, read only

- [ ] Fill every Not done and Partly cell in the coverage grid

  Done when every cell reads Done or N/A. Evidence goes in `docs/phase0/` under the cell's check.
- [ ] Audit P10, the Northfield scope and the retailer catalogue connector as prototypes

  Done when their grid rows are complete and the connector's link is recorded in Inventory.
- [ ] Golden questions for P2, P8, NetSuite and ERP-native, and more for P1, P4, P5 and P9

  Done when each has at least three questions with five graded runs in `docs/phase0/golden/`.
- [ ] Restore the X12 check against bots-grammars as a committed script

  Done when the script and its report sit in `validator/` and it rejects each injected fault for the stated reason.
- [ ] Confirm P7 manual pattern A by hand

  Done when it is recorded in FINDINGS as a defect or as a walker limit.
- [ ] Read the partner briefs; add partner-only questions for Pipe17, ShipHawk, Kanmon and Vividly; record each partner's journey moment

  Done when the Partner checks table has no Not done or Partly row.
- [ ] Read the marketing deck's remaining slides and the film's frames

  Done when the FILM A7 cell reads Done.

### Phase 1 · World

- [x] World and server parts of approved items 1, 2 and 4, and AP-5.1

  Commit 0d3fb87; CALLS 3, 4, 6 and 7.
- [ ] Settle P7's week 6 orders and charge figure

  Done when the owner answers open question 6 and P7's contract check runs against the live page, not a working copy.
- [ ] Partner records in the timeline

  Done when the owner answers open question 7 and any added record traces to a cited partner document.
- [ ] Shipments without a receipt

  Done when the owner confirms CALLS 8: other suppliers' shipments with no receipt are P8's stuck value.
- [ ] Raw X12 panels on prototypes generated from the world

  Done when every prototype's raw X12 panel matches a document in `build/tg.db` byte for byte, checked by the contract test.

### Phase 2 · Agent and customer-agent access

- [x] Northfield scope: shared documents, private records, refusals, writes that follow the catalogue

  Commit 5dd3748. Northfield golden questions in `docs/phase2/golden-nf/`.
- [ ] Every agent decision on every prototype computed from its timeline records

  Done when the A3 column reads Done for every prototype with an agent.
- [ ] Replay a changed agent rule against the quarter before it goes live
- [ ] Shelf Agent reads averages; Watch Agent reads NF-4.2 from the catalogue
- [ ] Tool comparison includes Northfield's tools
- [ ] P15's registry anchors hold its draft rule record
- [ ] Registry covers every inventory row, and the build fails when a doc or the server disagrees with it

  Done when ERP-native (or its retirement), the Northfield scope, the narrative pages and the connector are in `registry/registry.json`, and a gate check reads it.
- [ ] Repo copies of docs become dated snapshots
- [ ] Live Northfield connector run, only if a live Northfield demo is wanted

### Phase 3 · New prototypes

- [ ] Reopen Requirements v8, close its not-verified list, and draft features for Invoice Variance, Rule Replay and any partner journey Phase 0 verified
- [ ] Rank them, place them on the story calendar, and build the top one after Phases 1 and 2 pass their proofs

### Phase 4 · Prototype changes, one at a time

- [ ] For each of P1, P2, P4, P5, P6, P7, P8, P9, NetSuite and ERP-native (unless retired), work through the loop in the Build flow figure

  Done for a prototype when it has an approved change list, a walk with no script errors and a passing contract test, and the call is logged.
- [ ] Portfolio entry page built from the story calendar
- [ ] Portfolio film, after the owner approves a storyboard
- [ ] Docs: Partner Map edits, Retail Direction section 9 change list, Prototype Briefs fixes, Agentic Retail Trade figures

## Proofs and drift control

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
| Property-based invariants on quantities, time order and money | — | Not built |
| Fresh agent answers ten builder questions from the docs | — | Not run |
| Viewer states each film chapter's problem and outcome | — | Not started |
| One-page review pack for an EDI practitioner | [EDI Review Pack](https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd) | Built |

**How this guide stays current**

- **Pointers, not values:** the guide holds decisions, status and pointers. Every value stays with its owner.
- **Status only in the checklists:** the figure carries no status, so it cannot go stale.
- **The check script:** `node scripts/guide-check.mjs` reads the guide's Markdown export at `docs/build-guide.md` and fails when any of these is true:
  1. The repo has changed behaviour since the commit the guide states.
  2. A commit, path, npm script, gate check, rule ID or CALLS number it names does not exist.
  3. A registry prototype is missing from Inventory, or an Inventory row is missing from the grid.
  4. A grid cell is blank or holds an unknown word.
  5. Inventory status disagrees with the registry.
  6. A money amount, percentage or large count appears.
  7. The proof counts above differ from a fresh run.
  8. A claude.ai link is not in `docs/guide/artifacts-verified.json`.
  9. Any eight-word passage appears twice.
- **Overlap report:** the script also reports passages shared with the repo copies of the Prototype Plan, the database plan and the strategy doc. Those passages leave those docs once the owner approves.
- **After every edit:**
  1. Change this guide first.
  2. Export it as Markdown to `docs/build-guide.md`.
  3. Run the check.
  4. Commit the export with `docs/guide/check-report.json`.
