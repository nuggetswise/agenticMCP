<!-- Snapshot of the working doc at revision 10, exported for the registry check. The working doc is the source. -->

# TG for Retail · Shared Demo Database and MCP Server Plan

Nov 12, 2026 · @Mandip

One fictional quarter of trade between Ashby Supplier and Northfield Retailer sits behind every TG for Retail prototype. It is generated as X12 files, read back into one database, and served by one read-only MCP server with a REST twin.

This document owns the world, the database, the server, the tool list and the proofs. The Prototype Plan owns the story calendar and the build queue. The Agent and MCP strategy owns the task analysis and the agent decisions. The file registry/registry.json in the repository ties the three together, and the build fails when a document or the server disagrees with it.

## Status

| Item | State |
| --- | --- |
| Repository | nuggetswise/agenticMCP. Node 22, built-in SQLite, no other services. |
| World | Builds in about 9 seconds: 24,130 transaction sets in 2,676 X12 files, 8,115 other records, 1,946 orders. |
| Build gate | Invariants, fixed values, agent decision tests and the registry check run on every build. A failure stops the deploy. |
| Independent X12 check | StAEDI 1.26.7 reads every file. Its recorded report must match the files the build wrote. |
| Server | 16 tools over MCP, 14 of them also over REST, with an OpenAPI draft generated from the same list. |
| Writes | Off in this release. Approval-gated proposals and reset exist behind one setting for agentic prototypes. |

## The world

The world is one timeline, not a set of scenarios. A question finds records by order number, document reference or case number, at a point in time.

| Part | What it holds |
| --- | --- |
| Quarter | Sunday 27 September to Saturday 26 December 2026, with settlement to 6 January 2027 |
| People | Priya Raman at Ashby Supplier and Jordan Ellis at Northfield Retailer. No one else is named. |
| Companies | Ashby Supplier, Northfield Retailer, Kinross (warehouse), Lakeline Freight (carrier), and 23 other suppliers that exist only so isolation can be tested |
| Buyer orders | 351 six-digit orders. 340 of them are the open orders Money in Motion reads across 24 suppliers. |
| Replenishment orders | 1,594 five-digit Ashby orders: about 11 a day, 30 a day from 29 November to 19 December, 62 a day in the week of 6 December |
| EDI documents | 850, 855, 860, 865, 856, 810, 861, 824, 997, 820, 940, 945 and 852, version 004010, one transaction set per interchange |
| Other records | Supplier ERP postings, Kinross scans, Lakeline documents, deduction case entries, phone confirmations, emails and test runs, each with a time and a source system |
| Identifiers | Every GTIN, GLN and SSCC uses the GS1 example prefix 0614141 and carries a valid check digit |

### How a number gets into the database

1. The generator writes the quarter as X12 interchanges, one file per sender, receiver and day.
2. The same parser a prototype would use reads those files back.
3. Every order, shipment, carton, receipt, invoice, payment and rejection row is derived from the parsed documents. No row is typed in.
4. Records that never travel as EDI are stored as events beside the documents.
5. Each tool answers as of a time. The default is the story clock, Tuesday 17 November 2026 at 11:00 Eastern.

A record lookup returns the whole history of the record. A question about "now" returns only what had happened by the time asked.

### What changed from the first version

| Before | Now |
| --- | --- |
| Twelve isolated data sets, picked by a key on every row | One timeline. No keys. The same order answers every prototype that touches it. |
| Values typed into fixture files | Values derived from parsed X12 files |
| A tool that listed data sets | Removed. The story calendar lists moments on the one timeline. |
| PO NR-450118 in three versions | One order, two shipments: 350 cartons on 6 November and 120 on 8 November |

## Rules

The rule catalogue is the Northfield supplier guide 2026.2, plus the Ashby warehouse agreement with Kinross. It holds 42 rules. Each rule states its basis and its sources, and the rule lookup tool returns both.

| Basis | Rules | Meaning |
| --- | --- | --- |
| Public | 7 | The rule as written appears in a public retailer guide, a standard or a statute |
| Adapted | 5 | A public rule with a number or window changed to fit the story |
| Invented | 30 | Written for the demo. Marked as invented wherever it is shown. |

| Rule | Statement | Basis and source |
| --- | --- | --- |
| NF-4.2 | Send the ship notice within 1 hour of departure; a corrected ship notice must be received before the shipment reaches the DC | Public. A third-party summary of the Dick's Sporting Goods routing guide, the [Amazon vendor manual](https://images-na.ssl-images-amazon.com/images/I/A1CGEzPx85L.pdf) (30 minutes), the [Gordmans guide](https://mimage.opentext.com/alt_content/binary/businessnetwork/gordmans/Gordmans-Guide-2-14-18.pdf) and the [DXL vendor manual](https://images.dxl.com/is/content/CasualMale/PDF/Branded_Vendor_manual_032825.pdf) |
| NF-4.10 | The PO reference is the Northfield PO number, at most 22 characters | Public. ASC X12 004010 data element 324 is 1 to 22 characters. |
| NF-7.8 | The invoice bills the shipped quantity at the accepted price | Public. DXL vendor manual. |
| NF-10.2 | On prepaid freight the supplier files loss or damage claims with its carrier | Public. 49 U.S.C. 14706. |
| NF-7.3 | One dispute per deduction, within 60 days of the remittance date | Adapted. Gordmans guide. |
| NF-1.4 | Send the order acknowledgment within 24 hours of the purchase order | Invented |
| NF-1.5 | Northfield returns a 997 to an acknowledgment and sends no business acceptance | Invented |

**Ship notice timing, settled.** Every screen, tool and document uses "within 1 hour of departure". The earlier pre-departure wording in Requirements v8 is retired, because the public guides checked all set the deadline after departure. The P5 screen already showed the settled rule.

**Where a rejection travels.** A PO reference longer than 22 characters fails X12 syntax, so Northfield rejects it on the 997. Item, location, quantity and total errors are business errors and travel on the 824. The health summary reports the two channels separately.

## The server

One server serves every prototype. The tools were derived from the recurring jobs a customer's own assistant does, listed in the Agent and MCP strategy, before they were compared with other vendors' tool lists.

| Tool | Job it serves | Scopes it needs |
| --- | --- | --- |
| orders_needing_attention | Start-of-day triage | orders, documents |
| explain_rejection | Rejection diagnosis | documents, errors |
| edi_health_summary | Periodic health review | documents |
| check_deliveries | Escalation check for a list of POs | orders, documents |
| get_order | Order lookup, whole history | orders |
| get_document | Evidence retrieval, with the X12 text | documents |
| lookup_retailer_rules | Requirement lookup | rules |
| list_deductions | Deduction triage | deductions |
| get_deduction_case | Deduction triage, one case with its evidence | deductions |
| get_scorecard | Performance review | orders, documents |
| recommend_next_step | Exception investigation for six kinds of exception | orders, documents |
| get_story_calendar | Orientation: the moments on the timeline | none |
| compare_with_other_suppliers | Refusal. Always answers "Not available to Ashby". | none |
| request_change | The write boundary. Answers "Action not available" with the Trading Grid record to use. | none |
| run_readonly_sql | Demo aid: read-only queries on Ashby's own records | all granted |
| get_access_log | Audit: every call with user, tool, scopes and outcome | none |

| Element | Behaviour |
| --- | --- |
| Connection | One per company. Ashby's admin picks from five scopes: orders, documents, errors, rules, deductions. All five are on by default. |
| Scope off | A tool that needs the scope refuses. A field that needs it reads "Scope not granted" with the scope's name. |
| Isolation | The server opens a database that holds Ashby's records only. Another supplier's order is not found. |
| Time | Every question tool takes a time to answer as of. One setting moves the story clock. |
| REST twin | The same 14 tools at /api/<token>/v1, described by the OpenAPI draft at /openapi.json. Both are generated from one tool list. |
| Record pages | Each answer links to an order or document page that shows the record and its X12 text. |
| Writes as events | With writes on, request_change records a proposal. Nothing changes until Priya Raman approves it; approval appends one event to the log. Reset removes everything after the baseline. |
| URL | Carries a secret token. Suitable for fictional data, not production sign-in. |

### Compared with published tool lists

| Vendor | What is published | How this surface differs |
| --- | --- | --- |
| NetSuite | [MCP Standard Tools](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0902023508.html): 25 generic tools for records, SuiteQL, reports and saved searches | NetSuite exposes the data model and leaves the question to the assistant. This surface answers trading questions and cites the rule. The read-only SQL tool is the nearest equivalent. |
| Salesforce | [Hosted MCP server for record reads](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html): schema, SOQL query, search, recent and related records. Writes sit on separate servers. | Same separation of reads from writes. This surface adds point-in-time answers and a refusal for other companies' records. |
| SPS Commerce | A [press release](https://www.spscommerce.com/press/max-ai-fulfillment-edi/) says MAX Connect supports MCP. No tool list or schema is public. | Not comparable. The developer centre page could not be read without a browser session. |

Two changes came from the comparison: record lookups by number (get_order, get_document) sit beside the question tools, as both vendors do, and every tool declares itself read-only in its annotations.

## Proofs

Each proof is a program or an outside reader, not a judgement. The table says what each one proves and what it does not.

| Proof | Result | What it does not prove |
| --- | --- | --- |
| Independent X12 check: StAEDI 1.26.7, published 8 November 2026, reads all 2,676 files | The only files it faults are the 14 that carry the 15 rejections Northfield made on a 997, each for the stated reason. Ten faults injected into clean files are each rejected for the stated reason. | The validator is independent; the schemas are not. Element types and lengths follow X12 004010, but which segments are mandatory was written here for the invented Northfield guide. |
| Invariants over every record, on every build | 30 properties hold: quantities (shipped, received, invoiced, cartons), time order (order, acknowledgment, departure, ship notice, receipt, invoice, payment, 997 timing, control numbers), money (order values, invoice totals, remittance arithmetic) and rule citations | Properties are checked on the one generated quarter, not on random worlds |
| Fixed values | P10's four orders and time left, the rejection, 3,412 documents and 41 failures, five of six on time; P13's queue; the scorecard at 48,000 cases, 4,320 failing, 91.0%, 108 lines | — |
| Agent decision tests | 24 records across six agents return their stated next step from the same code, and no record number appears in the decision code | Failure states, such as a warehouse that cannot be reached, are not records and are not tested here |
| Money in Motion round trip | The 340 order records, written as X12, read back and rebuilt, equal the records the screen computes from | 18 ship notice numbers the screen reuses across orders are renamed in the world, so numbers are compared and those identifiers are not |
| Contract test against built screens | P2, P4, P5, P8, P9 and the NetSuite journey pass. P7 fails: its three week 6 orders are not in the world. P1 and P6 pass on the edited copies, which are not yet published. | It checks record numbers, names, rules and the Money in Motion records. It does not read every amount on every screen. |
| Registry check | The build fails when the registry, the server's tool list or a committed copy of the three documents disagree | The copies are exported by hand after a document edit |
| Smoke test | 28 checks through an MCP client: tools, REST twin, scopes, isolation, read-only boundary, proposal, approval and reset | — |

The build gate caught four real defects while it was being written: 997 control numbers out of time order, 18 ship notice numbers shared between orders, receipts that did not state their shortage, and a ship notice count that the screen read as planned and the world as actual.

## Hosting

Render deploys from the repository on the free tier. The service spins down after 15 minutes without traffic and takes about a minute to wake, and its filesystem resets on restart, so the access log and any proposals clear ([Render](https://render.com/docs/free)). Open the URL a few minutes before presenting. The Java validator does not run on Render: its report is recorded in the repository with a hash of the X12 files, and the build fails if the files it builds do not match that hash.

## Not verified

- No EDI practitioner has reviewed the documents or the rule catalogue. A one-page review pack exists for that.
- SPS Commerce publishes no MCP tool list, so that comparison could not be made.
- The Dick's Sporting Goods ship notice rule is cited from a third-party summary, not the guide itself.
- A shipment with a ship notice and no receipt is not on the timeline.
- Whether a published prototype can read the server live was not tested; prototypes carry their fixtures inline.
- Raw X12 panels inside built screens were not regenerated from the world's files.

## Decisions taken

| Decision | What would change it |
| --- | --- |
| Ship notice rule is within 1 hour of departure, on every screen | A named retailer guide a demo must match |
| PO reference rejections travel on the 997; business errors on the 824 | A retailer guide that applies the limit as a business rule |
| Five scopes on by default; the P10 journey shows the admin switching deductions off | A demo that must open with four |
| Existing tool names are kept so the connected assistant keeps working | A naming standard for the product API |
| The replenishment scorecard and the buyer-order view are separate populations | A single scorecard across both order streams |
| Jordan reverses the shortage charge and upholds the ship notice charge | — |
| The world follows built screens for rule wording and record numbers where they already agree with each other | A screen rebuilt from the world |

## Sources

- [Render: Deploy for Free](https://render.com/docs/free)
- [StAEDI on Maven Central](https://repo1.maven.org/maven2/io/xlate/staedi/maven-metadata.xml)
- [NetSuite MCP Standard Tools](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0902023508.html)
- [Salesforce hosted MCP servers: record reads](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html)
- [SPS Commerce press release, 10 February 2026](https://www.spscommerce.com/press/max-ai-fulfillment-edi/)
- [Amazon vendor shipment manual](https://images-na.ssl-images-amazon.com/images/I/A1CGEzPx85L.pdf), [Gordmans guide](https://mimage.opentext.com/alt_content/binary/businessnetwork/gordmans/Gordmans-Guide-2-14-18.pdf), [DXL vendor manual](https://images.dxl.com/is/content/CasualMale/PDF/Branded_Vendor_manual_032825.pdf)
- [TG for Retail · Prototype Plan](https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S)
- Internal: TG for Retail Feature Requirements v8; the nine built prototypes, read from their published pages
