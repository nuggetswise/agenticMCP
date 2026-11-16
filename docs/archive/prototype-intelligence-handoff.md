# Handoff: making TG for Retail prototype agents more intelligent

Prepared 13 November 2026; corrected the same day after review against the repository. For an agent that will place the items below into coming phases of the TG for Retail prototype work. The agent proposes; Mandip decides. Nothing is edited until he approves.

## 1. Your job

1. Read the sources in section 6.
2. Propose where each item in sections 3 and 4 belongs: which phase, which prototype, and whether it is a new build, a revision to a built prototype, a demo-world change or a plan note.
3. Before you decide anything, ask Mandip structured questions (section 7) using multiple-choice questions, with your recommended option first. Ask at most four questions at a time.
4. Return a phase allocation in the format in section 8. Do not edit the Prototype Plan, the Build Guide, the registry or any built prototype.

Phases are the Build Guide's: Phase 0 audit (read only); Phase 1 demo world; Phase 2 agent and customer-agent access, including changes to the live server; Phase 3 new prototypes; Phase 4 changes to built prototypes, one at a time against an approved change list. Do not invent phases.

## 2. Why this exists

A teardown of competitors on 13 November 2026 found that rule-based features are routinely marketed as AI. Example: Endless Commerce markets AI forecasting and 30-day supply-risk warnings, but its own documentation shows threshold arithmetic and a "shipments at risk" count of shipments already past their ETA. Its MCP server is marketed with write actions, but its 13 October 2026 changelog says the connection is read-only.

The prototypes should show what rules cannot do, and say which steps are rules and which are model judgement.

## 3. Decisions already made (do not reopen)

| # | Decision | Effect |
|---|---|---|
| D1 | Standing rule: every agent prototype passes at least one of the four intelligence tests (section 4.1). Agent prototype means one the registry marks with the agent verdict; P8 (no agent) and P15 (tool) are outside it unless Mandip decides otherwise (Q8). | Becomes a standing rule in the Prototype Plan once Mandip approves the wording. |
| D2 | Competitor columns are updated with: Endless Commerce's Pip agent, Crstl's Edison compliance agent, Logicbroker's MCP server. Pipe17 is a partner in scope, so its MCP server is recorded as documented partner capability, not in a competitor column. | Applies to the portfolio table and task-card notes. Check each against the evidence in section 5 before writing it; Crstl and Logicbroker stay labelled unverified until checked on their own sites. |
| D3 | The demo world needs history so learning and cross-company beats have something to work from: past disputes and how they were decided, including other suppliers' deduction cases with Northfield; and past acknowledgment and ship-notice timings, enough to test P5's lead signal. Today all five deduction cases in the world are Ashby's, so no cross-company test (T3) can pass anywhere and the learning test (T2) has five cases. | Phase 1 change to the demo world and registry; it gates every T2 and T3 beat. Scope to be decided (Q3). |

## 4. Items to place

### 4.1 The four intelligence tests

| Test | What counts | What does not count |
|---|---|---|
| T1 Unfamiliar case | The agent handles a case no rule covers: reads retailer guide text, reasons a fix, states confidence and what it does not know | A predefined workflow with a conversational front end |
| T2 Learning from outcomes | Past decisions and results change the next recommendation | A static threshold |
| T3 Cross-company signal | Evidence only the network holds: both sides of a trade, or patterns across many suppliers | Anything one company could compute from its own data |
| T4 Honest prediction | Flags risk before a deadline from lead signals and shows its own hit rate | Counting items already late |

### 4.2 Candidate upgrades per prototype

| Prototype | Candidate upgrade | Tests |
|---|---|---|
| P13 Silent order watch (queued) | Watch Agent infers a retailer's per-document deadline from past exchange where the guide is silent, shows confidence and asks Priya to confirm. Answers P13's open question on which retailers publish per-document deadlines. | T2, T1 |
| P11 NetSuite Chargeback Avoidance (built) | A never-seen 824 rejection: the agent reads the message guide, locates the field, proposes the fix in NetSuite, resends, and confirms by absence of a new 824 and a matching 861. Most retailers return only a 997, so it must not treat a 997 as acceptance. Waits for P11's records to enter the world (part 2 of the registry change list). | T1 |
| P5 Scout Shipment Watch (built) | Uses lead signals (slow 855s for this retailer preceding late 856s) to watch specific POs, and shows how often that signal was right. Not yet verified in the world that slow 855s precede late 856s; needs D3's history. | T4 |
| P6 Northfield Charge Resolution (built) | Claim Agent learns which evidence wins with this retailer. The retailer-side agent spots the same carrier seal failure across several suppliers, which only the retailer's view can see. Needs D3's other-supplier cases; the retailer-side agent's name (Vet Agent or Review Agent) must be settled first. | T2, T3 |
| P7 Northfield Performance Improvement (built) | Moves from cause to counterfactual: correct the stock figure for the mug item at Kinross Joliet (the dominant cause of short shipments in the world) and recompute the score, with both sides calculated by the server. On-time, in-full stays order-line based and derived from exchanged documents. | T4, T3 |
| P8 Money in Motion (built, no agent) | First, pass its golden questions: its open-order, closed-order and invoice-tolerance definitions must be stated so the figures can be checked against the records (Build Guide open question 7). Only then, and only if Mandip makes P8 an agent prototype (Q8): forecast when Northfield actually pays against its stated terms. | T2 |
| P14 Invoice Variance (new, retailer side) | Match Agent detects the same unit-of-measure mismatch recurring across POs and proposes a master-data fix, not only a settlement. | T2 |
| P15 Rule Replay (new, retailer side, tool) | Suggests the threshold that catches real failures with the fewest false fails, beyond replaying the draft as written. Only if Mandip makes P15 an agent prototype (Q8). | T4 |
| P10 Trading Grid in the customer's AI (live) | A Phase 2 change to the live server, not a new build. Two new question types: "why did Claim Agent recommend this?" answered from its decision record; and an honest limit that trade carried on another network is not covered. | Explainability (supports all tests) |
| P9 Shelf Recovery (built) | No upgrade proposed yet. Ask whether one is wanted. | Open |

### 4.3 Cross-cutting candidates

| Item | What it means | Source of the idea |
|---|---|---|
| X1 Graduated autonomy | Each agent action shows its approval threshold and the agent's track record under it, computed from the world's records (the world holds five deduction cases today, so any figure waits for D3). | Endless Commerce shows value thresholds on drafted POs |
| X2 Decision record | Every agent action records what it read, the rule it applied, the alternatives it rejected and why. P10 can query it. | Endless offers "why did Pip do that?" as a query |
| X3 Rule-versus-model marking | Each task card's notes say which steps are deterministic and which are model judgement. | Lesson from the Endless marketing-versus-documentation gap |

## 5. Evidence and its status

Verified from primary sources on 13 November 2026 unless marked otherwise.

| Claim | Status | Source |
|---|---|---|
| Endless MCP connection is read-only as shipped (changelog 13 Oct 2026); marketing page shows write tools | Verified | endlesscommerce.com/changelog; endlesscommerce.com/ai/mcp |
| Endless Pip agent operates across nine domains with approval thresholds | Vendor-presented examples only; no production traces | endlesscommerce.com/ai |
| Pipe17 ships an MCP server (orders, inventory, shipments; bulk updates; OAuth2 or API key). Recorded as partner capability, not competitor | Verified | pipe17.com/ai/mcp; support.pipe17.com article 40638840682011 |
| Crstl ships the Edison compliance agent and a Claude MCP server | Competitor's claim (from Endless's comparison page); not verified on Crstl's own site | endlesscommerce.com/integrations/crstl |
| Logicbroker offers an MCP layer with scopes, approvals and audit | Competitor's claim (from Endless's comparison page); not verified on Logicbroker's own site | endlesscommerce.com/compare/logicbroker |
| SPS Commerce offers an MCP server for Fulfillment | Verified on SPS Dev Center summary; details (auth, write scope, release status) not confirmed | developercenter.spscommerce.com |

Before writing D2 into the plan, verify the Crstl and Logicbroker claims on their own sites, or label them as unverified.

## 6. Sources to read

- TG for Retail Prototype Plan (Claude doc): https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S . Read its Standing rules, Build queue, Task cards and Retailer-side prototypes sections. Its portfolio table is stale on status (it still lists P10 as queued); the registry and the Build Guide win where they differ.
- Demo world and MCP server repository: github.com/nuggetswise/agenticMCP. Read README.md, registry/registry.json, docs/ (Build Guide copies) and world/. Pull request #1 (an as-of time on the scorecard tools; the retailer side's "Delivery receipt" renamed "Proof of delivery") is merged.
- Live demo server: tg-retail-demo-mcp on Render. Supplier connection (Ashby) and retailer connection (Northfield) both work; tokens are in the Render service environment, not in this document.
- Project docs: TG_for_Retail_Feature_Requirements_v8.docx, Retail Research Framework Investigation.docx.

## 7. Questions to ask Mandip (structured, before deciding)

Ask as multiple-choice, recommended option first, at most four per round.

1. Q1 Phase for the standing rule (D1): apply to queued prototypes only, or also as revisions to built ones?
2. Q2 Where does each upgrade go: a Phase 2 change to the live server (P10's decision-record questions), a Phase 3 build (P13), or a Phase 4 revision of a built prototype?
3. Q3 Demo-world history scope (D3): backfill a prior quarter, use weeks 1 to 7 of the current quarter as history, or both? It must include other suppliers' deduction cases. Adding them changes Northfield's own records, so P8's figures, its golden questions and the build checks that count Northfield's orders all move: the design either keeps those numbers stable or re-baselines them on purpose. Ask this first; Phase 1 gates the rest.
4. Q4 Does P10's first release include decision-record questions (X2), or stay with the read-only answers already planned?
5. Q5 Is graduated autonomy (X1) shown on screen, or only in task-card notes?
6. Q6 Is rule-versus-model marking (X3) task-card notes only (recommended), or visible on screen?
7. Q7 Does P9 Shelf Recovery get an upgrade?
8. Q8 Should P8 (no agent today) or P15 (a tool) become agent prototypes, which would bring them under D1?

## 8. Output format

Return one table and a short list.

| Item | Phase | Prototype | Change type (new build / revision / demo world / plan note) | Test(s) | Depends on | Open question |
|---|---|---|---|---|---|---|

Then: demo-world history required (records, time span, which prototypes use it); registry changes implied; risks.

## 9. Constraints

- Brainstorm and propose only. Mandip approves a change list (retain, correct, delete, add) with the rule IDs and registry anchors each item rests on before anything changes or is republished.
- Every prototype build, revision, review or fix invokes three skills first: TG for Retail workspace prototype, enterprise product writing, and visual treatment planner.
- Records, values and rules come from the shared demo world; rule wording from the EDI Review Pack's rule catalogue.
- Domain facts: most retailers return only a 997, with no business acceptance; inventory is pulled by API, not sent by the supplier; no retailer customer data in fixtures.
- Screens: no product names, no feature IDs; each agent acts for one named user and has a manual option.
- Competitor names belong in task-card notes, not on screens.
- Do not name OpenText colleagues in any document; cite internal evidence by document title.
- Always write "Trading Grid Catalogue" or "TGC", never "AC".
- Any autonomy, track-record or hit-rate figure is computed from the world's records, never illustrative.
- P11's upgrade waits on part 2 of the registry change list (P11's records in the world).
- No P6 change until the retailer-side agent's name (Vet Agent or Review Agent) is settled.
- The Prototype Plan is edited only on an approved change list; its stale P10 status goes on the next one.
