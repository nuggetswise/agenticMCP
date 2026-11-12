<!-- Snapshot of the working doc at revision 132, exported as text for the registry check. The working doc is the source. -->

# TG for Retail · Prototype Plan

·

## Start here

This plan is the single source of truth for TG for Retail prototypes from 11 November 2026. It replaces the Prove Value Prototype Plan, which stays readable as the build record for P5, P6 and P7.

The build queue answers the SPS MAX and TrueCommerce AI capabilities that threaten deals, in threat order. Each new prototype gets its feature in the Feature Requirements document before it is built with the TG for Retail workspace prototype skill.

### Decisions recorded 11 November 2026

Question | Answer | Effect on this plan | 
Does any OpenText product check live ASNs and invoices against retailer rules before delivery? | Yes. Trading Grid Intelligence does, through Chargeback Avoidance. | Pre-chargeback detection is existing capability. P5 shows the agent layer on top; no new detection prototype. | 
What runs AI-assisted onboarding and map work? | Mapping AI Aviator | P2 and the NetSuite Ship Notice Exception already show it; no new prototype. | 
Do suppliers see errors while testing before go-live? | Yes. Compliance link returns errors during testing. | Validation before go-live is existing capability and is not prototyped. | 
Does Command Center Integration Monitor alert on missing, out-of-order or late documents? | No | P13 fills the gap for silent orders. | 
Does a Trading Grid Insights or Trading Grid Intelligence API exist for an MCP server? | No | MCP access is built and goes on the roadmap. P10 shows it; the API is its first engineering step. | 
Is an in-product question-and-answer assistant needed? | No | Ask Trading Grid is dropped. Its questions are answered through the customer's own AI in P10. |

## Prototype portfolio

Ten prototypes are built, one is on hold and two are queued: P10 first, then P13. The last column names the competitor capability each one answers.

# | Prototype | Status | What it shows | Competitor capability answered | 
P1 | Long-tail | Built | Emailed PDF order becomes an EDI 850 and a Supplier ERP sales order; acknowledgment, ship notice and invoice return as EDI | TrueCommerce AI-guided onboarding (non-EDI entry) | 
P2 | Programme Readiness | Built | Retailer requirements, attribute compliance, 3PL and drop-ship tests, separate approval and activation | SPS Onboarding Agent; TrueCommerce AI-guided onboarding | 
P3 | Trade | On hold | One Wholesale order from accepted position to invoice | None | 
P4 | Marketplace to Wholesale | Built | Marketplace demand drives a Wholesale invite, item conflict and inventory pulled by API | None | 
P5 | Scout Shipment Watch | Built | Scout Agent runs six fulfilment risks before departure | SPS MAX Monitor and pre-chargeback alerts; the transaction monitoring TrueCommerce users ask for | 
P6 | Charge Resolution | Built | Claim Agent and retailer-side Vet Agent resolve deductions and an invoice exception | SPS deduction investigation; SPS invoice failure detection | 
P7 | Performance Improvement | Built | Pace Agent traces an on-time, in-full pattern across two warehouses | SPS root cause across partners | 
P8 | Money in Motion | Built | Retailer view of open-order value from PO to payment | SPS Visibility Management; SPS cash flow detection (retailer side) | 
P9 | Shelf Recovery | Built | EDI 852 becomes a buyer recommendation, a PO and a measured refill | SPS Decision Intelligence; TrueCommerce ReplenishAI | 
— | NetSuite Ship Notice Exception | Built | Test ship notice fails a pack rule, is corrected in NetSuite and passes | TrueCommerce AI integration testing; SPS Validation Agent | 
P10 | Trading Grid in the customer's AI | Queued 1 | The customer's own AI assistant reads orders, documents, errors and rules through MCP | SPS MCP server and MAX Chat | 
P13 | Silent order watch | Queued 2 | Required documents that never arrived, caught before the deadline | SPS non-event alerts |

## Story calendar

Every prototype is a moment in one quarter of trade between Ashby Supplier and Northfield Retailer, from 27 September to 26 December 2026. Two people appear: Priya Raman at Ashby and Jordan Ellis at Northfield. This plan owns the calendar; the Shared Demo Database and MCP Server Plan owns the records behind it.

Week | Date | Moment | Seen by | Prototype | Anchor record | 
1 | 28 Sep | First Wholesale order after the Marketplace invitation | Priya Raman | P4 | NR-449510 | 
1 | 28 Sep | An emailed PDF order becomes EDI | Priya Raman | P1 | NR-449512 | 
3 | 12 Oct | Drop-ship and warehouse readiness | Priya Raman | P2 | Drop-ship programme | 
5 | 26 Oct | Store activity becomes a refill order | Priya Raman | P9 | NR-451207 | 
6 | 2 Nov | Order changed; 270 agreed by phone; two shipments follow | Priya Raman | No screen | NR-450118 | 
7 | 8 Nov | Open-order value from purchase order to payment | Jordan Ellis | P8 | 340 open orders | 
8 | 17 Nov | Four questions and the six-PO email | Priya Raman | P10 | NR-46101 to NR-46156 | 
8 | 18 Nov | Silent order watch | Priya Raman | P13 | NR-46210 to NR-46231 | 
9 | 23 Nov | A test ship notice fails the pack rule | Priya Raman | NetSuite Ship Notice Exception | ASN-78214 | 
10 | 1 Dec | Deductions and an invoice exception | Priya Raman, then Jordan Ellis | P6 | NR-450118, NR-450390, NR-450415 | 
11 | 8 Dec | Six fulfilment risks before departure | Priya Raman | P5 | NR-460207 to NR-460274 | 
14 | 28 Dec | Scorecard at 91.0% and the corrective plan | Priya Raman, then Jordan Ellis | P7 | 108 failing lines |

P10's fixed points: the four orders are NR-46151, NR-46142, NR-46156 and NR-46133; the rejection is ASN-46118 at 26 characters against 22; health is 3,412 documents with 41 failures; the six POs are NR-46101 to NR-46105 and NR-46108, five on time and NR-46108 one day late.

## Build queue

### 1. P10 Trading Grid in the customer's AI

Ashby's team asks Trading Grid questions from the AI assistant it already uses and gets answers with the records attached. MCP access is the first rollout and a roadmap item, because no built prototype covers it; this prototype shows its first release.

Field | Content | 
Problem on screen | Supplier teams now work in their own AI assistants, but Trading Grid's orders, documents and errors are not reachable from them, so teams copy data by hand. | 
Solution on screen | A Trading Grid connection for the customer's AI assistant reads the orders, documents, errors and retailer rules the company may see, with every answer linked to its records. | 
User | Priya Raman, in Ashby's AI assistant. Ashby's IT admin connects it and picks the scopes. | 
Route map | Ashby's AI assistant · Trading Grid · Northfield Retailer | 
Data | Order lifecycle for 850, 855, 856, 810, 861, 824 and 997; retailer rules; connection status | 
Access rules (editable before connecting) | Read-only scopes picked by the admin; Ashby's records only; every answer cites its records; actions go back to Trading Grid for approval. | 
Manual option | The same answers from Trading Grid screens |

Journey

- Ashby's IT admin connects Trading Grid to the company AI assistant and picks four read scopes: orders, documents, errors and retailer rules.
- Priya asks: "Which Northfield orders need attention today?" The assistant calls Trading Grid and returns four orders with the reason, the retailer rule and the time left; each links to its Trading Grid record.
- "Why did Northfield reject ASN-46118?" The PO reference is 26 characters against Northfield's 22-character limit, and the same field broke three later documents.
- "Summarize Northfield EDI health for the last 30 days." 3,412 documents by type, 41 failures and the top three causes.
- Jordan Ellis emails six PO numbers he says shipped late. The assistant combines Trading Grid ship notices and receiving advice with the email: five delivered on time, one late. It drafts a reply; Priya sends it from her own mail. No Trading Grid record changes.
- The admin opens the access log: every call, user, scope and time.

End state. Four answers with their records, one escalation closed, and every call in the access log.

Checks. Read-only at first release; scopes enforced; questions outside Ashby's records return "Not available to Ashby"; the access log is complete.

Presenter notes (not on screen). No Trading Grid Intelligence or Trading Grid Insights API exists today; building it is the first engineering step and the roadmap item. The Retailer MCP prototype shows the same pattern for Trading Grid Catalogue compliance. Owner unassigned; needs a leader and quarter. Competitor: SPS's Dev Center MCP server lets Claude or ChatGPT query Fulfillment transactions, order workflows, alerts and trading partners; MAX Chat is included in every SPS Fulfillment subscription.

Open questions. Which write actions, if any, go through MCP after the first release?

### 2. P13 Silent order watch

At 09:00 Ashby sees four required documents that never arrived and resolves all four by noon.

Field | Content | 
Problem on screen | Monitoring shows documents that failed; a document that was never sent shows nothing until the retailer charges for it. | 
Solution on screen | Watch Agent compares every open order with the documents its retailer requires and the deadline for each, and flags what is missing before the deadline passes. | 
User | Priya Raman, Ashby supplier admin | 
Route map | Supplier ERP · 3PL warehouse · Trading Grid · Northfield Retailer | 
Documents | 850, 855, 856 and 810 with Northfield; 940 and 945 with Kinross; 997. Supplier ERP orders, fulfilments and invoices read by API. | 
Agent | Watch Agent, acting for Priya | 
Agent rules (editable before start) | Northfield: 855 within 24 hours of the 850; 856 within 1 hour of departure; 810 within 2 days of shipment. Kinross: 945 within 24 hours of the 940. Draft every document from Supplier ERP; send nothing without approval. | 
Manual option | Priya filters open orders by missing document herself. |

Fixture: five open orders at 09:00

PO | Expected document | State | Action | 
NR-46210 | 855 acknowledgment | Missing · 4 hours left | Agent drafts the 855 from the Supplier ERP sales order; Priya approves; sent | 
NR-46215 | 856 ship notice | Late · truck left at 18:00 yesterday | Agent drafts the 856 from the fulfilment; Priya approves; sent late and recorded as late | 
NR-46220 | 945 from Kinross | Missing · 36 hours after the 940 | Agent drafts an email to Kinross with the order; Priya approves; warehouse status stays Unknown until the 945 arrives | 
NR-46226 | 810 invoice | Missing · shipped yesterday, 1 day left | Agent proposes creating the invoice in Supplier ERP; Priya approves; 810 sent | 
NR-46231 | Northfield business acceptance of the 865 | Not expected | Northfield returns a 997 only; nothing to chase |

Journey

- Priya opens open orders. The problem line reads: four orders missing a required document.
- She opens the agent rules, changes the Kinross window from 48 to 24 hours, and starts Watch Agent.
- The agent reads open orders from Supplier ERP and document history from Trading Grid; the route map shows each read.
- The five rows appear in deadline order. Priya works them from the table above; each approval sends a real document and the row moves to its new state.
- Kinross returns the 945 at 11:40; NR-46220 moves to Shipped.

End state. Two documents sent before their deadlines, one sent late and recorded as late, one warehouse confirmation chased and received, and one order correctly left alone.

Checks. Late stays Late after sending; the agent never treats a 997 as business acceptance; every send has an approver and a time.

Presenter notes (not on screen). Expected-document rules: Trading Partner Kits. Document history: Trading Grid Intelligence. Command Center Integration Monitor has no missing-document alerts today; owner unassigned; needs a leader and quarter. Competitor: SPS Fulfillment shows non-compliance alerts for missing, out-of-order and late documents, and SPS Visibility Management flags the silence that signals a problem.

Open questions. Which retailers publish a deadline per document in their message guide?

## Revisions to built prototypes

Fixture-only edits bring the built screens onto the one world: the two people, the two company names, the P1 and P4 order numbers, P5 dates on 8 December 2026 and the ship notice rule. No layout or flow changes. Two presenter-note files also change.

Prototype | Presenter-note change | 
P5 Scout Shipment Watch | Live checks of ship notices and invoices against retailer rules are existing capability in Trading Grid Intelligence through Chargeback Avoidance. P5 shows the agent working that queue for one named user. Add the side-by-side test below against MAX's "Which orders need attention today?" | 
P7 Performance Improvement | Position Pace Agent against SPS's claim of tracing an on-time, in-full decline to one shared mapping cause. P7 shows the pattern across two warehouses for one retailer; across retailers is not shown. |

## Not building

Capability | Competitor | Reason | 
Guided supplier onboarding | TrueCommerce AI-guided onboarding; SPS Onboarding Agent | Shown in P2 and the NetSuite Ship Notice Exception. | 
Supplier cash watch | SPS cash flow detection | Shown in P8 (retailer view by stage) and P6 (invoice exception, deduction). Not shown anywhere: a 3PL shipment whose status never reaches the supplier ERP, so no invoice is created. | 
In-product question-and-answer assistant | SPS MAX Chat | Not required; P10 answers the same questions through the customer's own AI. | 
Validation before go-live | SPS Validation Agent; TrueCommerce AI-supported testing | Existing capability: Compliance link returns errors during testing. | 
Stalled drop-ship order detection | SPS MAX | Drop-ship is 0.7% of net deduction dollars in the internal chargeback analysis. | 
Agentic trading partner mapping | TrueCommerce | Mapping AI Aviator gives parity; TrueCommerce uses its agent only inside its own implementation team. | 
Support assistant | TrueCommerce Truedi | Outside Retail scope | 
Demand forecasting in VMI | TrueCommerce ReplenishAI | Out of scope per the strategy guide; P9 is the EDI 852-only answer. |

## Standing rules for every prototype

Story

- Show the problem being solved and what the solution achieves, on screen.
- Show the full end-to-end customer journey; never stop at a feature boundary.
- Present the ideal state: no conditional framing and no "proposed" tags when the whole prototype is proposed direction.
- Show EDI and API in use on the route map.

Screens

- Minimal but functional: little text on the main screen, smooth motion, arrows, and a small arrowhead on settled route-map lines.
- No product names on screen, including inside the Trading Grid box; everything outside that box is labelled Trading Grid.
- No feature IDs, no stage labels for detect, prioritize, act and verify, and no durations beside buttons.
- Functional only: no guided tour.

Agents

- Name each agent "<Name> Agent"; it acts for one named business user, never for both parties.
- Every agent screen has a manual option. The user opens and edits the agent rules before the agent starts.
- The agent visibly reads systems and checks records; it does not read as business-rule application.
- It sends a task, document or message only with a named user's approval or a valid standing policy, showing authority, channel, target-system response and audit record.
- User actions change what happens; nothing is read-only.

Domain facts

- Most retailers return only a 997; no business acceptance is sent.
- Inventory is pulled by API in real time, not sent by the supplier.
- No retailer customer data in fixtures or analysis.

Delivery

- Build each new prototype from scratch with the TG for Retail workspace prototype skill, from its feature in the Feature Requirements document.
- Product ownership, competitor references and capability positions go in a separate presenter-notes file per prototype; owners without a confirmed leader are marked unowned until a leader and quarter are assigned.

## Competitive evidence

The build queue follows this ranking. Calls below reflect the decisions recorded on 11 November 2026.

### SPS MAX, ranked by deal threat

Weights come from the internal chargeback analysis in TG for Retail and CPG Latest, slide 32. EDI ASN and invoice data carry 72.6% of net deduction dollars, carton labeling 18.3% and drop-ship 0.7%. That is a selected vendor population, and the EDI dollars sit mostly with one retailer.

# | Use case | What SPS shows or claims | Ours, screen level | Call | 
1 | Catch order, ASN and invoice errors before the chargeback | Claimed: $290K invoice failure from a wrong UPC; $200K saved in RIP-IT's first week; an 855 caught before the 856 ships (Austin Cutlery). Shown in product: an Orders at Risk tile and alerts for missing, out-of-order and late documents, on some connections only. | Shown. P5 Scout Agent runs six risks: phone-agreed 270 vs order 300, invoice 180 vs 176 shipped, reused barcodes, missing truck request, carton not on trailer, ATP shortfall. Specified in F2, F11, F16. | Existing capability: detection is existing capability in Trading Grid Intelligence through Chargeback Avoidance; P5 shows the agent layer | 
2 | Agentic onboarding and validation | Claimed: a deciding factor in multiple Q3 wins against ERP-integration competitors. A validation agent caught carrier codes and serial IDs across 21 integrations in two weeks. Hundreds of suppliers compliant within 24 hours. | Shown. P2 readiness covers 3PL and drop-ship tests. No validation-agent screen. Mapping AI Aviator runs AI-assisted onboarding; P12 shows it validating before go-live. | Reposition now on 500+ Trading Partner Kits, non-EDI live in under a week and TGI trade testing; build nothing new: P2 and the NetSuite Ship Notice Exception show it | 
3 | Supplier cash: failed invoices, shipment status not reaching the ERP | Claimed: 200+ Zevia–3PL status failures and up to $3M in delayed receivables. "Why haven't I been paid on my 5 shipments?" is a shipped prompt. | Partial. P6 has an invoice-exception flow; P8 shows the retailer view of money in motion. No supplier "why unpaid" view, no 3PL status-sync failure. | Build nothing new: P8 and P6 show it; the 3PL status gap is not shown | 
4 | Plain-language questions over transactions | Shipped: MAX Chat in Fulfillment and Fulfillment Monitor, with prompt groups for compliance and risk, daily operations, cash flow and automation | Absent | Build nothing in-product; P10 answers these questions through the customer's own AI | 
5 | MCP access from the customer's own AI | Shipped: a Dev Center MCP server lets Claude or ChatGPT query transactions, order workflows, alerts and trading partners | Retailer MCP prototype, Catalogue only, Later | Build; on the roadmap as P10; the Trading Grid Intelligence and Trading Grid Insights API comes first | 
6 | Requirements guidance inside the workflow | Shipped: an AI Workflow Guide plus SupplierWiki. SPS calls undocumented retailer rules its moat. | Trading Partner Kits and MIGs; governed retailer rule content Planned 27.1 | Reposition with the kits, build the governed content | 
7 | Retailer rejections explained in plain language | Shipped | Not specified | Build, small | 
8 | Root cause across partners (OTIF decline traced to one mapping issue) | Claimed | P7 Pace Agent finds a pattern across two warehouses for one retailer | Reposition | 
9 | Summaries and escalation triage (3,400 documents; 13 IDs found already resolved) | Claimed | Absent | Fold into #4 | 
10 | Stalled drop-ship orders (100 for an outdoor brand) | Claimed | P2 covers drop-ship readiness only | Ignore for now (0.7% of dollars) |

### Dates that matter

- MAX Agents are in co-development with about 20 customers, expanding to about 200 from Q4 2026 into Q1 2027. SPS will charge for them in 2027; MAX Chat stays in the standard subscription.
- Decision Intelligence AI is due in the first half of 2027, so P9 holds parity for now.

### TrueCommerce AI

TrueCommerce's AI threat is concentrated in onboarding; the transaction monitoring that makes MAX the top threat is the one capability TrueCommerce lacks and its users ask for.

# | Capability | What TrueCommerce shows or claims | Ours, screen level | Call | 
1 | AI-guided onboarding with retailer requirements | Available now. A 24/7 assistant with built-in Amazon, Walmart and Target requirements, plus project visibility and milestone tracking. Claims 50% faster partner setup. A non-AI Rapid onboarding model claims under 10 business days. | Shown. P2 Programme Readiness: sourced readiness by area, 3PL and drop-ship tests, separate approval and activation. P1 Long-tail joins a non-EDI supplier. No guided-assistant screen; Mapping AI Aviator runs AI-assisted onboarding. | Reposition now on 500+ Trading Partner Kits and non-EDI live in under a week; build nothing new: P2 shows it | 
2 | Agentic trading partner mapping | Available now. Builds and validates maps from partner specs, 50% faster than manual mapping. Runs inside TrueCommerce's own implementation team, built with L2Labs.ai. | No prototype. Map Analysis Assistant, Map Onboarding Assistant and Mapping Aviator for Professional Services. | Parity; ignore externally | 
3 | AI-supported integration testing | Coming in 2026. Flags issues before go-live and helps non-technical users validate. | Shown. NetSuite Ship Notice Exception: a test ship notice fails the 6-unit pack rule in trade testing, is held, corrected in NetSuite and passes on attempt 2. P2 shows programme test states. | Existing capability: Compliance link returns errors during testing; reposition it now | 
4 | Truedi support assistant | Available now in Foundry. Account-, ERP- and transaction-aware; resolved 91% of issues in 2025 and cut support cases 12%. | No prototype; outside Retail requirements | Ignore for Retail | 
5 | ReplenishAI demand forecasting in VMI | Since October 2024. Clusters items by demand pattern to set seasonal profiles. An anonymous CPG case claims $500K of captured demand in seven weeks. | Partial. P9 Shelf Recovery turns the 852 into a buyer recommendation, a PO and a measured refill; no forecast. | Stay out of forecasting; P9 is the 852-only answer | 
6 | Transaction error monitoring after the fact | Not offered. A G2 reviewer in April 2026 asked for AI that analyzes transactions and catches errors after the fact. | Shown. P5 Scout Shipment Watch runs six fulfilment risks; P6 Charge Resolution covers invoice exceptions and claim review. | Position P5 and P6 against TrueCommerce as the gap its users name |

Table sources: TrueCommerce AI page (German), onboarding help article, ReplenishAI launch, agentic mapping blog. All TrueCommerce figures are vendor-reported.

TrueCommerce gets fewer rows than MAX because it publishes less, not because the search stopped. It holds no public earnings calls with customer examples, its AI page lists four features, and its help center documents Truedi only as a support chatbot. SPS publishes prompt lists, release notes, an MCP server and a dozen named outcomes.

### What could not be verified

- No deal evidence. No win/loss or call record was reviewed for any row. Only #2 carries deal impact, and that is SPS's own claim.
- MCP tool list. The Dev Center page renders by JavaScript, so its tools could not be read.
- Demos. The MAX demo videos and webinar were not watched.
- Case studies. The RIP-IT and Ecentria pages refused fetch.
- Transcripts. These are Motley Fool's AI-assisted versions, not SPS audio.
- SPS figures. Every SPS number is vendor-reported.

### Side-by-side scenario to run

Take the Austin Cutlery case: an 855 corrected before the 856 goes out. Run it through P5's "buyer agreed 270 by phone, order still says 300" risk, beside SPS's MAX chat animation for the prompt "Which orders need attention today?"

Compare detection, the explanation, who approves and the evidence kept. P5 should win on approval and evidence. MAX will win on reach, because it runs on every Fulfillment customer today.

## Sources

- SPS Q3 2026 earnings call transcript
- SPS Q2 2026 earnings call transcript
- Introducing MAX, SPS Fulfillment help center
- Fulfillment Workflow and Insight Enhancements, SPS help center
- SPS Dev Center
- SPS MAX product page
- SPS press release, 15 September 2026
- SPS AI engineer job posting
- TrueCommerce AI page
- TrueCommerce press release, 7 April 2026
- TrueCommerce help: elearning resources
- TechIntelPro on TrueCommerce agentic mapping
- G2 TrueCommerce reviews
- Internal: TG for Retail and CPG Latest (slides 32 and 37); TG for Retail Feature Requirements v8; prototypes P1, P2, P5, P6, P7, Money in Motion and Agentic Retail Trade, read from their published pages
## Retailer-side prototypes on Northfield's connection

Two new prototypes run on Northfield's connection for Jordan Ellis and follow the three beats.

| Prototype | Week | Problem | Turn | Result |
| --- | --- | --- | --- | --- |
| P14 Invoice Variance | 7 | INV-7731 bills 300 cases on a line where 270 shipped | Match Agent finds the origin and fetches the record that settles it | The corrected invoice INV-7731C is matched; payment approval stays in accounts payable |
| P15 Rule Replay | 14 | Draft rule NFD-1 (ship notice within 30 minutes) would change 493 ship notices from passing to failing | The draft is replayed against the quarter's X12 before publishing | Jordan Ellis publishes, revises or drops it with the exposure in front of him |

P6 now runs on both connections: Claim Agent for Priya Raman and Review Agent for Jordan Ellis on the same case.
