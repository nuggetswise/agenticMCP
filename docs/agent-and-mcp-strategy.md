<!-- Snapshot of the working doc at revision 58, exported as text for the registry check. The working doc is the source. -->

# TG for Retail · Agent and MCP strategy for prototypes

·

## How to use this doc

This doc is the complete build input for adding agent behaviour and customer-agent access to TG for Retail prototypes. A builder reads the shared sections once, then one build brief, and can plan and build that prototype without opening anything else.

Read for every build: Position, Rules every build follows, Shared fixture world, and Fixture database and MCP server contract.

Then read one brief. Build order:

- P10 Trading Grid in the customer's AI
- P13 Silent order watch
- P6 Charge Resolution, evidence acquisition
- NetSuite ship notice exception, Test Agent

The section Changes to built prototypes lists what changes in every prototype already built. Those changes are made before any new prototype is built.

Build with the TG for Retail workspace prototype skill, from scratch, one prototype per brief. Fixtures come from the shared fixture database, so the same records appear in every prototype.

Done means three things.

- Every acceptance test in the brief passes in a headless run.
- Each changed-evidence record produces its stated next step from the same code, chosen by what the records show, not by a key or a separate script.
- The presenter-notes file is written from the brief's presenter notes.

## Position

Retail exposes trusted transaction context and approved Trading Grid actions so customer agents can investigate and resolve Retail exceptions where users already work. MCP is one technical route. It is not a Retail feature, an agent, or a substitute for a connector.

Evidence. Customer advisory board members want their existing agents and interfaces to consume Trading Grid data and capabilities through governed APIs and interoperable agent connections. They also asked for automated incident and work-order creation. The feedback did not name MCP and did not confirm any customer implementation. Microsoft Copilot Studio, SAP Joule and ServiceNow AI Agents all support MCP tool integration, so any of them could call Trading Grid tools.

Six layers do different jobs.

- The agent reasons and decides which tool to use. Examples: Copilot Studio, Joule, a ServiceNow agent, a Trading Grid agent.
- MCP is the standard way an agent discovers and calls tools.
- Agent-to-agent connections let one agent hand work to another.
- An API or connector performs the underlying system call.
- A workflow engine runs a defined multi-step process.
- The system of record holds authoritative state: Trading Grid for documents, the Supplier ERP for orders, invoices and receivables, the service desk for incidents.

MCP does not make an experience agentic. Agentic behaviour comes from a goal, reasoning over evidence, permissions, actions and a follow-up loop.

Each prototype answers three questions separately.

- Agency. Is there investigation or follow-up worth delegating beyond what a rule table handles?
- Customer-agent access. Is there a recurring job a customer's own agent does with Trading Grid context, even where the workflow underneath is rule-based?
- ERP placement. Does the supplier gain by seeing, deciding or approving the work on the Supplier ERP record?

## Rules every build follows

### Story and screens

- Show the problem and what the solution achieves, on screen.
- Show the full end-to-end journey; never stop at a feature boundary.
- Present the ideal state, with no conditional framing and no proposed tags.
- Show EDI and API in use on the route map. Settled route lines carry a small arrowhead.
- Keep screens minimal: little text, smooth motion, functional only, no guided tour.
- No product names on screen, including inside the Trading Grid box. Everything outside that box is labelled Trading Grid.
- No feature IDs, no dates, no durations beside buttons, no green ticks, no stage labels for detect, prioritize, act and verify.
- Use only OpenText TG Retail Design System colour tokens.
- No retailer customer data in fixtures.

### People

Each prototype names one person on each side and no one else.

- Priya Raman, Ashby Supplier. She does every supplier role: operations, finance, evidence owner and admin.
- Jordan Ellis, Northfield Retailer. He does every retailer role: buyer contact, claims reviewer, compliance, activation approval.
- Warehouse and carrier appear as companies only: Kinross Logistics and Lakeline Freight.

### Agents inside Trading Grid

- Each agent is named "<Name> Agent" and acts for Priya or for Jordan, never for both.
- Every agent screen has a manual option.
- Before the agent starts, the user opens and edits its agent rules. The goal is fixed; the user's rules are editable; the guardrails are locked.
- The agent visibly reads systems and compares records.
- It sends a task, document or message only with the user's approval or a standing policy the user set. Each send shows the authority, channel, target-system response and audit record.
- It never changes an authoritative record without permitted authority.
- User actions change what happens next; nothing is read-only.

### The six agentic tests

A prototype shows an agent only where it passes all six. Otherwise the behaviour is shown as rule-based automation, with no agent label.

- A named decision. Two materially different next steps, and the evidence that leads to each.
- A rule baseline. The simplest credible rule-based workflow runs on the same case, so the difference is visible.
- Changed evidence. A changed fixture produces a different next step with no new script.
- Authority. Who approves, where the approval happens, and the target system's response.
- A business confirmation. The outcome is confirmed by a business record, such as a receiving advice, a passed test or a repayment matched in receivables. A technical acknowledgment (997) only confirms the file was accepted.
- A failure case. A document that never arrives, a tool that fails, or a deadline that approaches.

### Customer-agent access

- The caller is the customer's own AI assistant in the customer's workspace. The assistant platform is not named on screen.
- Access is read-only at first release. Actions in Trading Grid go back to Trading Grid screens for approval.
- The customer's admin picks scopes before connecting. A question outside the scopes or outside Ashby's records returns a refusal, not a guess.
- Every answer cites the Trading Grid records it used.
- Every call is written to an access log: user, assistant, tool, scope, outcome and time.
- An incident or work order is created by the customer's assistant in the customer's own service desk. Trading Grid is not changed.

## One world behind every prototype

Every prototype reads one fictional quarter of trade between Ashby Supplier and Northfield Retailer. A prototype is a moment on that timeline seen by one person. There are no data sets to pick: a question finds records by order number, document reference or case number, at a point in time.

This section restates what a builder needs. The Shared Demo Database and MCP Server Plan owns the detail, and the repository file registry/registry.json is checked against both on every build.

### Companies, people and systems

Party | Role | Systems named on screen | 
Ashby Supplier | Supplier. Priya Raman does every supplier role. | Supplier ERP (NetSuite in the NetSuite journey), Ashby warehouse ASH-WH1 | 
Northfield Retailer | Retailer. Jordan Ellis does every retailer role. | Northfield ordering, receiving at DC 2 and DC 4, store 114, the deduction case | 
Kinross | Ashby's contract warehouse at Groveport and Joliet | Kinross warehouse system: 940 in, 945 out, load scans and tallies | 
Lakeline Freight | Carrier on prepaid freight | Bill of lading, delivery receipt, claims |

### Timeline

The quarter runs from Sunday 27 September to Saturday 26 December 2026, with settlement to 6 January 2027. The story clock is Tuesday 17 November 2026 at 11:00 Eastern. Every question tool takes a time to answer as of.

Week | Moment | Seen by | Prototype | Anchor records | 
1 | First Wholesale order after the Marketplace invitation | Priya Raman | P4 | NR-449510 | 
1 | An emailed PDF order becomes EDI | Priya Raman | P1 | NR-449512, INV-7702 | 
3 | Drop-ship and warehouse readiness | Priya Raman | P2 | Programme records | 
5 | Store activity becomes a refill order | Priya Raman | P9 | Stores 114 and 207, NR-451207, ASN-451207-1 | 
6 to 7 | The order story: change, two shipments, one carton short | Priya Raman | No screen | NR-450118, ASN-450118-1, ASN-450118-2, RCV-DC2-77355 | 
7 | Open-order value from purchase order to payment | Jordan Ellis | P8 | 340 open orders across 24 suppliers | 
8 | Four questions and the six-PO email | Priya Raman | P10 | NR-46101 to NR-46156 | 
8 | Silent order watch | Priya Raman | P13 | NR-46210 to NR-46231, NR-46302 | 
9 | A test ship notice fails the pack rule | Priya Raman | NetSuite journey | ASN-78214, ASN-78231 | 
10 | Deductions and an invoice exception | Priya Raman, then Jordan Ellis | P6 | DC-40877, DC-40931, DC-41102, DC-41118, DC-41131, INV-7790C | 
11 | Six fulfilment risks before departure | Priya Raman | P5 | NR-460207 to NR-460274, NR-460288 | 
14 | Scorecard at 91.0% and the corrective plan | Priya Raman, then Jordan Ellis | P7 | 108 failing lines in 48,000 cases |

### Items

Item | Description | Pack | Price | 
ASH-MUG-12 | Stoneware mug 12 oz | Case of 12 | $54.00 a case | 
ASH-NAP-4 | Linen napkin 4-pack | Case of 24 | $38.40 a case | 
ASH-HNY-340 | Wildflower honey 340 g | Case of 12 | $46.80 a case | 
ASH-MUG-16 | Stoneware mug 16 oz, a substitute not on Northfield's item list | Case of 12 | $58.00 a case | 
ASH-TRL-09 | Trail runner, the P9 store item | Pair | $38.00 a pair | 
AHP-8820 | Pour-over coffee maker in the NetSuite journey | Case of 6 required by Northfield | $72.00 a case |

### Northfield rules 2026.2

The catalogue holds 53 rules. Seven are public, five are adapted from public guides and 41 are invented; each rule says which. The rules a builder meets most:

Rule | Statement | Basis | 
NF-1.4 | Order acknowledgment within 24 hours of the purchase order | Invented | 
NF-1.5 | Northfield answers an acknowledgment with a 997 only and sends no business acceptance | Invented | 
NF-4.2 | Ship notice within 1 hour of departure; a corrected ship notice before the shipment reaches the DC | Public | 
NF-4.9 | Units per case match Northfield's setup; $150 per ship notice that breaks it | Invented | 
NF-4.10 | The PO reference is the Northfield PO number, at most 22 characters | Public: X12 element 324 | 
NF-4.11 | Every item is on Northfield's item list; a substitute needs the buyer's approval first | Invented | 
NF-7.3 | One dispute per deduction, within 60 days of the remittance date | Adapted | 
NF-7.4 | Shortage evidence: bill of lading with seal, proof of delivery, and a load scan or load tally by SSCC | Invented | 
NF-7.9 | Invoice within 2 days of shipment | Adapted | 
SH01, AS02 | Shortage: invoice cost of each short carton plus $50. Ship notice mismatch: $150 plus $1 per carton. | Invented | 
Kinross agreement | Kinross returns the 945 within 24 hours of the 940 | Invented |

### Server contract in brief

One read-only server serves every prototype over MCP, with the same tools over REST. Each connection belongs to one company and carries the scopes its admin picked: orders, documents, errors, rules, deductions.

Tool | Job | 
orders_needing_attention | Start-of-day triage | 
explain_rejection | Rejection diagnosis | 
edi_health_summary | Periodic health review | 
check_deliveries | Escalation check for a list of POs | 
get_order, get_document | Record lookup and evidence, with the X12 text | 
lookup_retailer_rules | Requirement lookup with basis and source | 
list_deductions, get_deduction_case | Deduction triage | 
get_scorecard | Performance review | 
recommend_next_step | Exception investigation; the agent decisions below | 
get_story_calendar | The moments on the timeline | 
compare_with_other_suppliers | Refusal: "Not available to Ashby" | 
request_change | Write boundary: "Action not available", with the Trading Grid record to use | 
run_readonly_sql, get_access_log | Demo aid and audit |

Fixed wording: "Not available to Ashby", "Action not available", "Scope not granted" with the scope's name for a field outside the granted scopes. With writes on, request_change records a proposal that only Priya Raman's approval turns into an event; reset returns the world to its baseline.

## Task analysis: agency, customer-agent access and ERP placement

Each operator task gets three verdicts. Agency asks whether a decision is delegated: an agent is justified only where the same task has at least two different next steps, each with its own evidence on the timeline, and the simplest rule would pick wrongly. Customer-agent access asks which company's own assistant does a recurring job with Trading Grid's answers. ERP placement asks whether the action belongs on an ERP record.

Prototype and task | Agency | Customer-agent access | ERP placement | 
P1: turn an emailed order into EDI and a sales order | Rule-based. Every step is a match against saved item and location mappings; an unmatched value stops for Priya. Reverses if layouts change so often that matching needs judgement on each order. | Supplier: order lookup after posting. Retailer: not applicable, Northfield receives ordinary EDI. | Approve and post on the Supplier ERP sales order | 
P2: reuse approved setup and track readiness for Drop-ship | Rule-based. Each readiness item is a sourced status; no evidence is weighed. Reverses if readiness sources disagree. | Not applicable: one-time setup with no recurring job. Reverses if a retailer runs programme status across many suppliers. | None | 
P4: carry setup from Marketplace to Wholesale; resolve the item conflict | Rule-based. The carry-forward classes and the GTIN check are fixed comparisons. Reverses if conflicts need a choice between plausible matches. | Supplier: order lookup across programmes. Retailer: inventory read by API, already in the journey. | Inventory stays in the Supplier ERP and is read, never sent | 
P5: find shipments about to break a rule and act before departure | Agent, Scout Agent. Seven records lead to seven different first moves, because the record that is wrong differs. The rule flags the breach and leaves Priya to find the wrong record. | Supplier: which shipments break a rule before their cutoff. Retailer: not applicable, pre-shipment records are Ashby's. | Invoice and sales-order corrections are approved on the Supplier ERP record | 
P6: recover or accept a deduction | Agent, Claim Agent. Where the proof sits decides the step: in the case, held by Kinross, replaceable by a tally, absent, or a carrier matter. The rule disputes only when proof is already in the case. | Supplier: deduction triage with proof present, proof missing and days left. Retailer: Vet Agent reads the evidence pack for Jordan and changes nothing. | Priya approves the dispute on the deduction item in the Supplier ERP; the repayment is matched there | 
P6: correct an invoice Northfield held | Rule-based. The 824 names the line and the quantity; one correction follows. | Supplier: rejection diagnosis. | The corrected invoice is posted from the Supplier ERP | 
P7: explain a falling scorecard and draft the corrective plan | Agent, Pace Agent. Short shipments either share one cause or split across warehouses; the split needs a question before any task. The rule drafts a task for the largest reason code. | Supplier: performance review by reason. Retailer: Jordan reads the same scorecard in Northfield's own tools. | None | 
P8: read open-order value from purchase order to payment | Not applicable. A populated view with no action taken from Trading Grid. Reverses if a decision is delegated from the view, such as chasing a supplier. | Retailer: open-order value by stage, once a retailer connection exists. Supplier: not applicable. | None | 
P9: turn store activity into a refill recommendation | Agent, Shelf Agent. An empty shelf leads to an order, a transfer or a wait, depending on goods in transit and stock elsewhere. The rule recommends a carton multiple for every empty shelf. | Supplier: which stores need a recommendation this week. Retailer: Jordan decides the order in Northfield's ordering system. | The sales order is created in the Supplier ERP | 
NetSuite journey: fix a failed test ship notice and activate | Agent, Test Agent. The same failure is a data defect or a mapping defect, and the fix lands on a different record. The rule always suggests changing the pack configuration. | Not applicable during testing: no live trade to ask about. Reverses once live exceptions are in scope. | The failure, the diagnosis and the approval sit on the NetSuite item fulfillment | 
P10: answer trading questions in Ashby's own assistant | Not applicable. Trading Grid has no agent here; the customer's assistant reasons and Trading Grid answers. | Supplier: start-of-day triage, rejection diagnosis, periodic health review, escalation check. Retailer: the same pattern from Northfield's side, later. | None | 
P13: chase a required document that never arrived | Agent, Watch Agent. A missing ship notice has four explanations in the source records, each with its own next step. The rule lists the missing document and its deadline. | Supplier: which required documents never arrived, and why. Retailer: not applicable, Northfield sees only what arrives. | Drafts are built from Supplier ERP orders, fulfilments and invoices |

### Agent decisions on the timeline

Each agent decision is one function over records. The records below already exist on the timeline; the same code returns a different next step for each, and the build fails if any of them changes. Ask the server with recommend_next_step, the record and the time.

Agent | Record | As of | What the records show | Next step | 
Watch | NR-46215 | 18 Nov 09:00 | Fulfilment posted, load scan 6 of 6, departure scanned, no ship notice | draft_ship_notice_from_load_scan | 
Watch | NR-46220 | 18 Nov 09:00 | 940 sent to Kinross, no 945, no load scan | ask_warehouse_for_status | 
Watch | NR-46302 | 19 Nov 16:00 | Fulfilment posted, but the Kinross load scan shows the trailer not departed | hold_draft_and_ask_warehouse | 
Watch | NR-46156 | 17 Nov 11:00 | Ship notice sent and rejected on an 824 for a substitute item | show_rejection_and_draft_correction | 
Claim | DC-40877 | 1 Dec 09:00 | Bill of lading, delivery receipt and load scan are in the case | dispute_now | 
Claim | DC-41102 | 28 Dec 10:00 | Load scan not in the case; Kinross holds it | request_load_scan_then_dispute | 
Claim | DC-41118 | 28 Dec 10:00 | No load scan; a load tally by SSCC exists | attach_load_tally_and_dispute | 
Claim | DC-41131 | 28 Dec 10:00 | No load scan or tally anywhere | recommend_accept | 
Claim | DC-40931 | 1 Dec 09:00 | Two cartons crushed in transit on prepaid freight | recommend_accept_and_file_carrier_claim | 
Test | ASN-78214 | 23 Nov 10:20 | NetSuite item pack is 12; Northfield requires 6 | propose_netsuite_item_change | 
Test | ASN-78231 | 24 Nov 09:40 | NetSuite item pack is already 6; the map sends the purchase unit | propose_map_correction | 
Test | ASN-78214 | 23 Nov 11:00 | Attempt 2 passed and was delivered | request_activation | 
Shelf | 114 | 26 Oct 08:07 | Empty shelf, nothing in transit, Ashby has stock | recommend_new_order | 
Shelf | 114 | 26 Oct 17:30 | Empty shelf, and ASN-451207-1 is in transit to the store | wait_for_goods_in_transit | 
Shelf | 207 | 26 Oct 08:07 | Slow sales with more than 12 weeks of supply | recommend_transfer | 
Scout | NR-460207 | 8 Dec 17:12 | One carton staged but not on the trailer | send_load_task_to_kinross | 
Scout | NR-460288 | 10 Dec 14:30 | Supplier ERP says shipped; the Kinross load scan says not departed | check_departure_scan_and_ask_kinross | 
Scout | NR-460219 | 8 Dec 17:12 | Invoice draft bills more than shipped | propose_invoice_correction_in_supplier_erp | 
Scout | NR-460241 | 8 Dec 17:12 | No routing request for collect freight | draft_routing_request | 
Scout | NR-460262 | 8 Dec 17:12 | Kinross has less stock than three orders need | ask_priya_which_order_ships_short | 
Scout | NR-460233 | 8 Dec 17:12 | Cartons carry SSCCs already used | send_relabel_task_to_kinross | 
Scout | NR-460274 | 8 Dec 17:12 | A quantity agreed by phone is not on an order change | ask_buyer_for_order_change | 
Pace | 2026-09-27 to 2026-12-26 | 28 Dec 09:00 | Short shipments across the quarter share one cause | draft_corrective_task | 
Pace | 2026-11-22 to 2026-11-28 | 28 Dec 09:00 | Short shipments split between Joliet and Groveport | ask_priya_before_drafting |

Failure of a source is not a record on the timeline. Each build shows it as a state of the screen: the source reads "Unknown", nothing is drafted, and the agent escalates to Priya with what is known.

## Build brief 1: P10 Trading Grid in the customer's AI

P10 proves that Ashby's own AI assistant can answer trading questions with Trading Grid records attached, and open an incident in Ashby's service desk, without anyone opening Trading Grid. Trading Grid has no agent in P10, and it is read-only.

Field | Content | 
Problem on screen | Ashby's team works in its own AI assistant, but Northfield orders, documents and rejections are not reachable from it, so Priya copies data by hand. | 
Solution on screen | A Trading Grid connection lets the assistant read the orders, documents, rejections and Northfield rules Ashby may see, with every answer linked to its records. | 
User | Priya, in Ashby's AI assistant. She also connects it and picks the scopes. | 
Route map | Ashby's AI assistant to Trading Grid by API; Trading Grid to Northfield Retailer by EDI; Ashby's AI assistant to Ashby service desk by API. | 
Screens | Connect screen with scopes; assistant conversation with each tool call shown in plain words; access log. The assistant is unbranded. | 
Manual option | The same answers from Trading Grid document search, one PO at a time. | 
Live demo | Claude connected to the agenticMCP server URL returns the same answers from the same fixtures. |

### Fixtures

Orders needing attention at the story clock, Tuesday 17 November 2026 at 11:00:

PO | Reason | Rule | Time left | 
NR-46151 | Ship notice not sent; the truck left at 10:40 | NF-4.2 | 40 minutes | 
NR-46142 | Order acknowledgment not sent | NF-1.4 | 5 hours | 
NR-46156 | Ship notice ASN-46156 rejected: item not on Northfield's item list | NF-4.11 | 19 hours, before the shipment reaches the DC | 
NR-46133 | Invoice INV-46133 rejected: PO reference longer than 22 characters | NF-4.10 | 1 day |

EDI health, last 30 days: 3,412 documents and 41 failures. Northfield reported 29 failures on an application advice (824) and 12 on a technical acknowledgment (997).

- Item not on Northfield's item list: 11
- Ship-to location not recognized: 6
- PO reference longer than 22 characters: 4
- Eight other causes: 20

The rejection: ASN-46118 carried the PO reference NR-46118-ASHBY-WHSL-REL-02, 26 characters against a limit of 22. The Supplier ERP adds a release suffix to orders released a second time. The same cause later broke ASN-46124, ASN-46129 and INV-46133.

Jordan's escalation: he emails six POs, NR-46101 to NR-46105 and NR-46108, saying they shipped late. Ship notices and receiving advice show five delivered on time and NR-46108 received one day late.

### Journey

- Priya opens the connect screen and picks four read scopes: orders, documents, errors and rules. She leaves deductions off.
- She asks: "Which Northfield orders need attention today?" The assistant calls orders_needing_attention and returns the four orders in time-left order, each with its rule and records.
- "Why did Northfield reject ASN-46118?" The assistant calls explain_rejection: the PO reference is 26 characters against a 22-character limit, and the same field broke three later documents.
- "Summarize Northfield EDI health for the last 30 days." The assistant calls edi_health_summary and returns the counts and the top three causes.
- "Open an incident for the PO reference problem." The assistant creates an incident in Ashby's service desk linking the four failed documents and rule NF-4.10. Trading Grid is unchanged.
- Priya pastes Jordan's email. The assistant calls check_deliveries with the six POs and answers: five on time, one late. It drafts a reply to Jordan; Priya sends it from her own mail.
- "Show me our Northfield deductions." The assistant returns "Scope not granted: deductions."
- Priya opens the access log: every call, with user, assistant, tool, scope and outcome, including the refusal.

End state. Four answers with their records, one incident opened in Ashby's service desk, one escalation answered, every call in the access log, no Trading Grid record changed.

### Changed evidence and failure

Record or state | What differs | Expected answer | 
The same question as of 18 November 09:00 | A day has passed on the timeline | Four different orders: NR-46215, NR-46220 (with the Kinross advice included), NR-46210 and NR-46226 | 
NR-447948, another supplier's order | Priya asks about an order that is not Ashby's | "Not available to Ashby." The order is not found on Ashby's connection. | 
The deductions scope switched off | Priya asks for Northfield deductions | The tool refuses and names the scope that is not granted | 
The server cannot reach the database | A failure state, not a record | "Trading Grid could not be reached." No partial answer. |

A shipment with a ship notice and no receiving advice is not on the timeline: by the end of the quarter every Ashby shipment has a receipt, and the delivery check reads the whole history. That case stays untested.

### Acceptance tests

- Step 2 returns exactly the four orders above, sorted by time left, each citing its records.
- Step 3 names the field, 26 characters, the 22-character limit, NF-4.10 and the three later documents.
- Step 4 totals reconcile: 3,412 documents; causes sum to 41.
- Step 5 creates one incident with four linked documents; no Trading Grid write appears in the access log.
- Step 6 returns five on time and NR-46108 one day late.
- Every refusal uses the exact wording in the contract.
- Each changed-evidence record returns its expected answer.

Measure. Trading Grid lookups Priya makes for Jordan's escalation: twelve in the manual option (a ship notice and a receipt for each PO), none with the assistant.

### Presenter notes

- No Trading Grid Intelligence or Trading Grid Insights API exists today. Building it is the first engineering step and the roadmap item. Owner unassigned; needs a leader and a quarter.
- Advisory board evidence: customers want their own agents to use Trading Grid through governed APIs and agent connections, and want automated incident creation. They did not name MCP.
- Customer platforms that can call these tools: Microsoft Copilot Studio, SAP Joule custom agents, ServiceNow AI Agents.
- Competitors: Crstl and ECGrid offer read-only MCP access today; SPS announced MAX Connect without a public tool list.

## Build brief 2: P13 Silent order watch

P13 proves that Watch Agent can take over the investigation behind a document that never arrived: it checks whether the goods shipped, chooses the next step from what it finds, and confirms the outcome with Northfield's receiving advice.

Field | Content | 
Problem on screen | Monitoring shows documents that failed. A document that was never sent shows nothing until Northfield charges for it. | 
Solution on screen | Watch Agent compares every open order with the documents Northfield requires and their deadlines, finds out why each is missing, and drafts the fix from the source record. | 
User | Priya | 
Agent | Watch Agent, acting for Priya | 
Route map | Supplier ERP to Trading Grid by API; Kinross Logistics to Trading Grid by API for scans and EDI for 940 and 945; Trading Grid to Northfield Retailer by EDI for 850, 855, 856, 810, 824, 861 and 997. | 
Manual option | Priya filters open orders by missing document and checks each source herself. |

### Agent rules

Part | Content | 
Goal, fixed | Every document Northfield requires reaches it before its deadline under Northfield rules 2026.2 | 
Priya's rules, editable | Kinross 945 window: 48 hours (Priya changes it to 24 before starting). Drafts need her approval. Escalate to her when 2 hours are left. | 
Guardrails, locked | Never build a ship notice except from a load scan or fulfilment record. Never treat a 997 as business acceptance. A late document stays Late after it is sent. |

### The decision Watch Agent makes for a missing ship notice

It reads the Supplier ERP fulfilment, the Kinross 945, the Kinross load scan and departure, and the Trading Grid document trail, then picks one next step.

What the records show | Next step | 
Fulfilment posted, 945 received, departure scanned | Draft the 856 from the load scan for Priya's approval | 
No fulfilment, no 945, no departure | Send nothing to Northfield; ask Kinross for status; tell Priya the time left | 
Fulfilment posted, but no 945 and the load scan shows the trailer not departed | Hold the draft; ask Kinross for load status; draft from the load scan once departure is scanned; flag the fulfilment posted early on the Supplier ERP record | 
856 sent and rejected by an 824 | Show the rejection and the rule; draft the corrected 856 from the current PO revision | 
Kinross cannot be reached | Draft nothing; mark warehouse status Unknown; re-check; escalate to Priya at 2 hours left with what is known |

Rule baseline for comparison: the rule lists the missing document and its deadline. Priya investigates every source herself.

### Fixtures

Five open orders when Priya opens the queue.

PO | Expected document | State | What the agent finds | Next step | 
NR-46210 | 855 | Missing, 4 hours left | Sales order matches every line | Draft the 855; Priya approves; sent; 997 returned | 
NR-46215 | 856 | Late; the truck left 15 hours ago | Fulfilment, 945 and departure agree | Draft from the load scan; Priya approves; sent and recorded Late | 
NR-46220 | 945 from Kinross | Missing 36 hours after the 940 | No load scan for this PO | Draft an email to Kinross; Priya approves; status Unknown until the 945 arrives later in the run | 
NR-46226 | 810 | Missing, 1 day left | Shipped yesterday; no invoice in the Supplier ERP | Propose an invoice in the Supplier ERP from the shipped quantity; Priya approves; 810 sent | 
NR-46231 | Business acceptance of an 865 | Not expected | Northfield returns a 997 only | Nothing to chase |

### Journey

- Priya opens open orders. The problem line reads: four orders missing a required document.
- She opens Watch Agent's rules, changes the Kinross window from 48 to 24 hours, and starts it.
- Watch Agent reads Supplier ERP orders, Kinross events and Trading Grid document history; the route map shows each read.
- The five rows appear in deadline order, each with what the agent found and its proposed next step.
- Priya approves each draft. Each approval sends a real document; the row moves to its new state.
- Kinross returns the 945 for NR-46220; the row moves to Shipped and the agent drafts its 856.
- Northfield's receiving advice for NR-46215 arrives and matches the ship notice; the row closes.

End state. Two documents sent before their deadlines, one sent and recorded Late, one warehouse confirmation chased and received, one order correctly left alone.

### Changed evidence and failure

Record | What the records show | Expected next step | 
NR-46215, 18 November 09:00 | Fulfilment posted, load scan 6 of 6, departure scanned; the ship notice is 14 hours overdue | Drafts the ship notice from the load scan; it is sent and recorded Late | 
NR-46220, 18 November 09:00 | 940 sent on 16 November at 21:00; no 945 and no load scan | Sends nothing to Northfield; asks Kinross for status | 
NR-46302, 19 November 16:00 | Supplier ERP fulfilment posted; no 945; the Kinross load scan shows the trailer not departed | Holds the draft, asks Kinross, drafts after departure; flags the early fulfilment for Priya | 
NR-46156, 17 November 11:00 | Ship notice sent; an 824 rejects it because the substitute item is not on Northfield's list (NF-4.11) | Shows the 824 and the rule; drafts the corrected ship notice | 
Kinross cannot be reached | A failure state, not a record | Drafts nothing; shows Unknown; escalates to Priya at 2 hours left |

### Acceptance tests

- Base run ends in the stated end state, with every send carrying Priya's approval and a time.
- NR-46215 stays Late after sending.
- NR-46231 is never chased; no 997 is shown as business acceptance.
- Each changed-evidence record produces its stated next step from the same code.
- Editing the Kinross window changes which rows are flagged.
- A row closes only on the business confirmation it needs: a receiving advice for an 856, a 945 for a Kinross request.

Measure. Sources Priya checks herself per missing ship notice: three in the rule baseline (Supplier ERP, Kinross, document trail), none with Watch Agent.

### Presenter notes

- Command Center Integration Monitor does not alert on missing, out-of-order or late documents today. Owner unassigned; needs a leader and a quarter.
- Expected-document rules come from Trading Partner Kits; document history from Trading Grid Intelligence.
- Competitor: SPS shows alerts for missing, out-of-order and late documents on some connections; MAX Monitor flags and the user decides. Watch Agent goes further: it finds out why, drafts from the source record, follows up with the warehouse and confirms with the receiving advice.
- Customer-agent access: the same queue is available to Ashby's assistant through orders_needing_attention in P10.

## Build brief 3: P6 Charge Resolution, evidence acquisition

This upgrade proves that Claim Agent recovers money a rule would give up: when the proof is not in the case, it goes and gets it, uses permitted substitute evidence, and recommends accepting only when no proof exists. The case closes only when the repayment matches in Ashby's receivables.

Field | Content | 
Problem on screen | Northfield withholds money for a missing carton. The proof that it was loaded sits with the warehouse, so Ashby accepts charges it could win. | 
Solution on screen | Claim Agent checks Northfield's evidence rule, obtains the missing proof, disputes with a complete pack, and confirms the repayment in receivables. | 
User | Priya | 
Agent | Claim Agent, acting for Priya. Northfield's side: Vet Agent, acting for Jordan, reads and reports only. | 
Route map | Supplier ERP to Trading Grid by API for scans and receivables; Kinross Logistics to Trading Grid by API for load scans and tallies; Lakeline Freight to Trading Grid by scanned documents; Northfield Retailer to Trading Grid by EDI for the 820 and 861, and by API for the deduction case. | 
ERP placement | Priya approves the dispute or the acceptance on the deduction item in the Supplier ERP; the repayment is matched there. | 
Manual option | Priya gathers the evidence and files the dispute herself. |

### Agent rules

Part | Content | 
Goal, fixed | Resolve each charge on Northfield's evidence rules 2026.2 | 
Priya's rules, editable | Disputes need my approval, or are sent without asking when proof meets NF-7.4 and the charge is under $250. Rank by amount, deadline and proof present. | 
Guardrails, locked | Never decide a charge. Never dispute without NF-7.4 evidence. Never show a reversal as resolved before it matches in receivables. Never report a first difference as the cause. |

### The decision Claim Agent makes

What the evidence shows | Next step | 
Load scan by SSCC is in the case | Dispute SH01 now and AS02 when billed | 
Load scan is not in the case, and Kinross has it | Request it from Kinross, attach it, dispute | 
No load scan, but Kinross has a load tally by SSCC | Attach the tally, which NF-5.3 accepts, and dispute | 
No load scan or tally anywhere | Recommend accepting both charges; a dispute would draw ID01 $150 and no review | 
Kinross cannot be reached | Retry; tell Priya what is outstanding and the days left; recommend accepting at 10 days left if no proof has arrived |

Rule baseline for comparison: proof in the case means dispute; anything else means accept.

### Fixtures

Record | Value | 
Shipment | PO NR-450118 line 2, 120 cartons on a sealed trailer, seal SL-3302918 | 
Delivery receipt | Seal intact at DC 2; 120 delivered, no exceptions | 
Receiving advice | 119 of 120; carton SSCC 006141410000003006 not scanned | 
Remittance | PMT-990412 withholds $88.40, charge SH01, deduction DM-55102, case DC-40877 | 
Dispute window | 59 days left | 
Expected charges | AS02 $151.00 on the monthly compliance invoice (ship notice 120, receipt 119); OT01 $1.15 projected; all from one carton, counted once | 
Evidence in the case | Bill of lading with seal, delivery receipt, pack scan, load scan showing all 120 loaded before the seal | 
Repayment | PMT-991204 repays $88.40 referencing DM-55102 |

### Journey

- The remittance arrives with $88.40 withheld; the case opens with the problem line.
- Priya opens Claim Agent's rules and starts it.
- Claim Agent reads the case, the receiving advice, the scans, the bill of lading and the delivery receipt. The first difference is at DC 2 receiving.
- It links SH01, AS02 and OT01 to the one carton and counts them once.
- It checks the evidence against NF-7.4 and picks its next step from the table above.
- Priya approves the dispute on the deduction item in the Supplier ERP.
- Claim Agent submits the dispute with the evidence pack to Northfield's deduction case.
- Jordan opens the case. Vet Agent reports the evidence complete. Jordan reverses SH01 and upholds AS02.
- The repayment arrives on a later remittance. Claim Agent matches it to DM-55102 in receivables and closes the case.

End state. $88.40 recovered and matched, $151.00 upheld, the receipt unchanged unless Northfield revises it.

### Changed evidence and failure

Record | What the evidence shows | Expected next step | Rule baseline | 
DC-40877, 1 December | Bill of lading, delivery receipt and load scan are in the case | Disputes SH01 now | Disputes | 
DC-41102, 28 December | Load scan missing from the case; Kinross holds it | Requests it, attaches it, disputes | Accepts | 
DC-41118, 28 December | No load scan; a load tally by SSCC exists | Attaches the tally, disputes | Accepts | 
DC-41131, 28 December | No load scan or tally anywhere | Recommends accepting | Accepts | 
DC-40931, 1 December | Two cartons crushed in transit on prepaid freight | Recommends accepting and filing the carrier claim | Accepts, files nothing | 
Kinross cannot be reached | A failure state, not a record | Retries, tells Priya what is outstanding, recommends accepting at 10 days left | Accepts |

### Acceptance tests

- The base run ends in the stated end state.
- For DC-41102 and DC-41118, the dispute goes out with a complete pack, from the same code as the base run.
- For DC-41131, no dispute is sent.
- The case closes only after the repayment matches in receivables.
- Switching Priya's dispute rule to without asking sends the dispute in the base run without an approval step, and the audit record says so.
- Vet Agent changes no record.

Measure. Dollars disputed with complete proof on cases the rule baseline accepts: $239.40 on each of DC-41102 and DC-41118.

### Presenter notes

- The deductions tool exists: Northfield sets the rules and enters charges; Ashby sees its own deductions, takes part in disputes and submits evidence. Ashby has a separate login per retailer. API access for an agent is unverified.
- The retailer-side Vet Agent is a retailer extension of the deductions tool Northfield already pays for.
- Competitor: SPS Revenue Recovery is described as automation plus deduction expertise; its MAX rollout is still to come.
- Customer-agent access later: get_deduction_case lets Ashby's finance assistant see proof present and missing across retailers.

## Build brief 4: NetSuite ship notice exception, Test Agent

This upgrade proves that Test Agent can diagnose a failed trade test as either a data defect or a mapping defect, propose the fix on the right record, and confirm it with a passed retest. Live ship notice exceptions in this journey stay rule-based; missing and late documents in live trade belong to P13.

Field | Content | 
Problem on screen | A test ship notice fails a Northfield rule. Ashby cannot tell whether its NetSuite setup or the map is wrong, so the fix waits on back-and-forth. | 
Solution on screen | Test Agent compares the NetSuite record, the ship notice and Northfield's rule, names the defect, proposes the fix where it belongs and reruns the test. | 
User | Priya, in NetSuite | 
Agent | Test Agent, acting for Priya | 
Route map | NetSuite to Trading Grid by API; Trading Grid to Northfield Retailer by EDI. | 
ERP placement | The failure, the diagnosis and the approval sit on the NetSuite item fulfillment. | 
Manual option | Priya reads the failure and decides the fix herself. |

### Agent rules

Part | Content | 
Goal, fixed | Every test document passes Northfield rules 2026.2 before activation | 
Priya's rules, editable | NetSuite record changes need my approval. Map changes need my approval. | 
Guardrails, locked | Never deliver a failed test document to Northfield. Never request activation before every test passes. Keep every failed attempt on record. |

### The decision Test Agent makes

What the records show | Diagnosis | Next step | 
NetSuite item uses a case of 12; the ship notice says 12; Northfield requires 6 | Data defect in the NetSuite item setup | Propose switching AHP-8820 to case configuration AHP-8820-C6 on the NetSuite record; reprocess; retest | 
NetSuite item uses a case of 6; the ship notice still says 12 | Mapping defect: the map sends the wrong pack field | Propose the map correction to Trading Grid; NetSuite unchanged; retest | 
The retest cannot run | Unknown | Hold; tell Priya; retry; no activation request |

Rule baseline for comparison: the rule shows "Pack 12 submitted, 6 expected" and one fixed suggestion, change the pack configuration. Priya works out which record is wrong.

### Fixtures

Record | Value | 
Test order | PO-104728 becomes NetSuite sales order SO-108842 on Priya's approval | 
Item | AHP-8820 pour-over coffee maker, Northfield NF-44721; NetSuite configuration AHP-8820-C12, case of 12 | 
Test ship notice | ASN-78214 from item fulfillment IF-55410, 120 cases of 12 | 
Rule | NF-4.9: units per case match Northfield's setup, a case of 6; $150 per ship notice that breaks it | 
Live order after activation | PO-104912, sales order SO-108955, item fulfillment IF-55498, ship notice ASN-78260 with a case of 6 |

### Journey

- The test order arrives; Priya approves the sales order in NetSuite.
- She sends the test ship notice. Trading Grid holds it: the pack rule fails and nothing is delivered to Northfield.
- The failure, with its $150 exposure, appears on the NetSuite item fulfillment.
- Priya opens Test Agent's rules and starts it.
- Test Agent reads the NetSuite item, the ship notice and the rule, and names a data defect.
- It proposes switching to the case of 6. Priya approves on the NetSuite record.
- The ship notice is reprocessed. Attempt 2 passes, is delivered and returns a 997. Attempt 1 stays on record.
- Test Agent requests activation. Jordan approves.
- The first live order ships with the case of 6 applied before the ship notice is built. Northfield's receiving advice matches.

End state. Ashby is active with Northfield; one failed attempt on record and never delivered; the first live ship notice matched by the receiving advice.

### Changed evidence and failure

Record | What the records show | Expected next step | 
ASN-78214, 23 November 10:20 | NetSuite item pack is 12; the ship notice says 12; Northfield requires 6 | Names a data defect; proposes the NetSuite item change | 
ASN-78231, 24 November 09:40 | NetSuite item pack is already 6; the map sends the purchase unit | Names a mapping defect; proposes the map correction; NetSuite unchanged | 
ASN-78214, 23 November 11:00 | Attempt 2 passed and was delivered | Requests activation; only Jordan approves it | 
The retest cannot run | A failure state, not a record | Holds; tells Priya; no activation request |

### Acceptance tests

- The base run ends in the stated end state.
- For ASN-78231, no NetSuite record changes, and the map correction is proposed instead, from the same code.
- A failed attempt is never delivered to Northfield.
- Activation is requested only after every test passes, and only Jordan approves it.
- A 997 alone never closes the journey; the receiving advice on the first live shipment does.

Measure. Diagnosis steps Priya does herself after a failed test: two in the rule baseline (check the NetSuite item, check the ship notice), none with Test Agent.

### Presenter notes

- Holding a document before delivery during trade testing: Compliance link returns errors during testing. A hold in live trade is not publicly confirmed.
- Writing the failure onto the NetSuite record is proposed; owner unassigned.
- Map correction runs through Mapping AI Aviator.
- Competitor: SPS Validation Agent recommends fixes for setup errors; SPS consultants approve each one; SPS reports 29% faster resolution, measured in testing. Test Agent works for the supplier, in the supplier's ERP, and confirms with a passed retest.

## Changes to built prototypes

Every built prototype changes to one person per side: Priya for Ashby, Jordan for Northfield, and company names only for Kinross and Lakeline. The table lists the other changes. Agent decisions in P5, P6 and P7 are fixed text today, chosen by a flag or a setting, so those three are rebuilt to compute their decisions from the fixtures.

Prototype | Approach | Change | 
P1 Long-tail | Strengthen rule-based automation | Add a standing policy: when every line matches a saved item mapping, the acknowledgment, ship notice and invoice go out without asking. An unmatched line stops for Priya. Measure: operator actions per clean order, from six to none. | 
P2 Programme Readiness | Keep | People only. The reuse check stays rule-based, with no agent label. | 
P4 Marketplace to Wholesale | Keep | People only. | 
P5 Scout Shipment Watch | Make Scout Agent's decisions evidence-driven | Compute each finding by comparing the load scan, the Supplier ERP order and the current PO. The second record is NR-460288: the Supplier ERP says shipped and the Kinross load scan says not departed, so Scout checks the departure scan and asks Kinross before anything else. Drive the short-carton path from Kinross's reply, not from a replay flag. | 
P6 Charge Resolution | Add evidence acquisition | Build brief 3. | 
P7 Performance Improvement | Make Pace Agent's finding evidence-driven | Compute the week 6 finding from the week 6 lines. The second record is the week of 22 to 28 November: short shipments split between Joliet and Groveport, so Pace reads both warehouses' pick records. If the cause stays uncertain, Pace says so, names the record that would decide it, and asks Priya before drafting any task. | 
P8 Money in Motion | Keep | Read-only view for Jordan. People only. | 
P9 Shelf Recovery | Give Shelf Agent a real decision | For an empty shelf, Shelf Agent reads in-transit ship notices, Ashby's stock and overstocked stores, then picks one: recommend a new order, recommend a transfer, or wait for goods already in transit. The second record is store 114 at 17:30 on 26 October: a ship notice to store 114 is already in transit, so no order is recommended. | 
NetSuite ship notice exception | Add Test Agent | Build brief 4. Live exceptions stay rule-based. | 
ERP-native Activation | Keep | People only. | 
Agentic Retail Trade | Keep | A narrative page, not a workflow. | 
Retailer catalogue connector | Keep | The working pattern for the MCP server contract. |

## Competitor and platform facts

These facts were checked against vendor pages on 12 November 2026. They are stated here in full; the sources at the end are for audit only.

### Competitors

No competitor shows an agent that obtains missing evidence and acts on it. Only one documents an external agent sending a document.

Vendor and capability | What it does | Authority | Status and evidence | 
SPS MAX Chat | Answers questions on orders, errors and partner requirements, with a suggested next step | Advises only | In the Fulfillment product; SPS gives no usage figures for it | 
SPS MAX Monitor | Watches orders, shipments and invoices; flags missing documents, unacknowledged orders and rejection patterns | Flags; the user decides | Available to every SPS customer from September 2026 | 
SPS Validation Agent | Recommends fixes for setup errors | SPS consultants approve each one | 29% faster error resolution, measured in testing | 
SPS Onboarding Agent | Moves customers to supplier readiness | Not described | More than 300 customers; period and steps not stated | 
SPS Visibility Management | Ranks order exceptions by revenue at risk; notifies suppliers | Notifies automatically | Announced; one unnamed retailer reported $38.2M recovered | 
SPS MAX Connect | External agents use SPS data through MCP | Unclear | Announced February 2026; no public tool list; no adoption evidence | 
Crstl MCP | Read-only queries over purchase orders, invoices, ship notices and 30+ other document types | Read only | Early access; scoped to the customer's organisation | 
ECGrid MCP | More than 40 tools for network, mailbox and delivery checks | Read only; write tools on its roadmap | Live | 
Tediware MCP | 36 tools, including resend and submit of EDI documents | Write, hidden from read-only keys | Documented | 
Pipe17 | Routes orders to a location automatically; its assistant can rerun routing and resolve exceptions | Admin switch per capability | No figures published | 
TrueCommerce | Guided onboarding; agentic map building for its own implementation team | Guidance; internal use | Claims 50% faster partner setup; method not given |

Adoption of MAX, repeat use of MAX Chat and adoption of MAX Connect are separate claims. SPS publishes evidence only for the first: hundreds of thousands of interactions during early access. The Prototype Plan's statement that SPS ships a Dev Center MCP server could not be confirmed here.

### Customer agent platforms

All three platforms customers named can call MCP tools, so any of them could use the P10 tools.

Platform | What it supports | Conditions | 
Microsoft Copilot Studio | An agent uses tools and resources from an external MCP server. Generally available since 29 May 2025. | Generative orchestration on; prompts not supported | 
SAP Joule | Custom Joule agents use MCP to reach SAP and non-SAP applications, pause for human approval, and call other Joule agents | Joule agents can also use Joule skills, so an SAP agent is not always an MCP agent | 
ServiceNow AI Agents | Call tools on external MCP servers; expose ServiceNow skills to external agents through an MCP server; agent-to-agent in both directions | The server side needs Zurich Patch 9 or Australia Patch 2, a Now Assist entitlement and an OAuth client |

## Dependencies, decisions and sources

### Dependencies to verify with product

The prototypes show the intended experience. Each item below is unverified in the live product and decides how presenter notes describe current capability.

Dependency | Needed by | Position today | 
An API for trading document state and evidence | P10, P13 | No Trading Grid Insights or Trading Grid Intelligence API exists today | 
Alerts on missing or late documents | P13 | Command Center Integration Monitor does not alert on them | 
A hold before delivery in live trade | NetSuite journey | Errors are returned during testing; a live hold is not publicly confirmed | 
Write-back to the NetSuite record | NetSuite journey, P13 | Proposed; no owner | 
Receiving advice from the retailer | P13, P5, NetSuite journey | Depends on each retailer; many return only a 997 | 
Agent access to deduction cases and dispute submission | P6 | Suppliers use the deductions tool by login, one per retailer; API access unverified | 
Warehouse scan and tally retrieval | P6, P5, P13 | Through the warehouse link; coverage across typical suppliers unverified | 
Fixture database and MCP server | Every build | Built in the agenticMCP repository; one world, one server |

### Decisions log

Each decision was taken by default and can be overturned.

Decision | What would change it | 
One person per side: Priya for Ashby, Jordan for Northfield | — | 
The proposal is customer-agent access to Retail context and actions; MCP is one route | A named customer requirement for a specific protocol | 
P10 is read-only; the customer's assistant creates the incident in its own service desk | Customers preferring Trading Grid to create it through a connector | 
Build order: changes to built prototypes, then P10, P13, P6 upgrade, NetSuite Test Agent | Customer evidence that deduction recovery outranks agent access | 
P13 is the home of the missing ship notice case; live NetSuite exceptions stay rule-based | Evidence that conflicts are frequent in live NetSuite exceptions | 
An agent label appears only where all six agentic tests pass | — | 
The customer's assistant platform is not named on screen | A demo for a specific platform's customers | 
The world in the repository is the source for every fixture; the registry check stops the build when a document or the server disagrees with it | The Prototype Plan updated to match |

### Sources

- Internal summary of customer advisory board feedback, November 2026
- TG for Retail Prototype Plan (P10 and P13 entries), 11 November 2026
- Prototype runs and changed-evidence variations on isolated copies, 12 November 2026
- Microsoft Learn: extend your agent with Model Context Protocol; Microsoft Copilot blog, 29 May 2025
- SAP Learning: tools and Model Context Protocol for custom Joule agents
- ServiceNow Community: MCP server, MCP client and agent-to-agent explained, June 2026
- SPS Commerce: MAX product page; press releases of 10 February and 15 September 2026; Introducing MAX help article; Q2 2026 earnings call
- Crstl: Crstl MCP announcement
- ECGrid: AI and B2B (MCP) page
- Tediware: MCP documentation
- Pipe17: AI page
- TrueCommerce: press release of 7 April 2026