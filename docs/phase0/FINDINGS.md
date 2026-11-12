# Phase 0 findings (working notes; read-only audit, nothing changed)

## State at start
- Live server https://tg-retail-demo-mcp.onrender.com is on 0.2.0 (healthz, openapi.json 200). Repo main = f2fef9c, clean.
- Connector tool list in this session is stale: 11 tools incl. list_scenarios; new tools not listed until reconnect.
- NetSuite artifact AhjjX49TBdZ7qbMiHkZpnx is now titled "NetSuite Chargeback Avoidance" (user's version on top of my 12 Nov publish). Do not overwrite.
- P6 live still has Tom Hale, Kim Adeyemi, Marcus Bell (edit prepared, unpublished). P1 live changed since my copy; edit unpublished.

## C3 X12 against schemas I did not write: DONE
- Grammars: bots-grammars (github.com/bots-edi/bots-grammars, x12/4010, commit 6c1d8a5, 2016). Walker script phase0/botscheck.py applies their structure + record definitions.
- 2,676 files / 24,130 interchanges: every clean document passes. 11 files (12 documents) fault: 4 N102 too long, 3 PRF01 too long, 1 BIG04 too long, 2 invalid dates, 2 SE counts.
- World has 15 rejections on a 997. The 3 not found are "Missing required segment" (855 without CTT). CTT is optional in the standard 855, so that rejection is a Northfield guide rule, not X12 syntax. FINDING: move those 3 to a segment that is mandatory in the standard, or to the 824.
- Injected faults: 9 of 10 rejected for the stated reason; the 855-without-CTT fault passes (same reason).

## NetSuite Chargeback Avoidance (user's version, read from live source 12 Nov, version 1794504796)
- Screen prototype. One person (Priya); owners are roles (Warehouse operations, Master-data operations). No agent, no manual toggle; six operator actions.
- A1 Problem line present, no number (no charge figure). Result: outcome card with times; no business confirmation beyond 997 (no receiving advice).
- Not in world: ASN-78452, ASN-78431, INV-55201, SO-109117, PO-105031, DC-104, DC-140. In world as test events only: PO-104728, SO-108842, IF-55410, AHP-8820, NF-44721. SSCCs ...0012/0029/0036/0043 have valid check digits but are not world cartons.
- "Acknowledged 48" is treated as the commitment (PO says 50). Contradicts NF-1.1 (current PO revision is the commitment) and NF-1.5 (a quantity change is accepted only on a matching order change). Stage 6 "Align sales order to 48" repeats it for PO-105031.
- 12 checks carry no rule ids; rules drawer cites "Northfield MIG" and "Northfield outbound compliance", not guide 2026.2 ids. Candidates: qty NF-4.x/NF-1.1, SSCC NF-4.3, ship-to NF-4.7.
- INV-55201 "Price variance 0.4%" shown Needs review; TG-TOL allows 0.5%, so 0.4% should pass.
- Raw X12 panel is hand-written and invalid as X12: BSN lacks date/time, PRF*PO-..., MAN*GM*~ empty; not generated from the world.
- Registry and strategy brief 4 still describe Test Agent on test ship notices ASN-78214/78231; the live screen is a live-order hold with no agent. Docs/registry are wrong per the authority order.
- Ship notice timing: screen shows "Truck departs 18:00"; consistent with NF-4.2 (no pre-departure wording).

## A. Headless walks (phase0/walk.js, screenshots in phase0/shots, end text in phase0/text). Local copies equal live for P2,P4,P5,P7 (my publishes), P6,P8,P9 (baseline=live), NS (user's version). P1 live not re-read; prepared copy walked.
- NS: 6 actions to outcome, no script errors. P4: 12 actions to outcome ("Remaining: Northfield receipt and payment for NR-449510"), no errors. P9: 8 actions to outcome, no errors. P8: view only, nothing to walk.
- P2: 7 supplier actions, stops at "Awaiting Jordan Ellis" (needs workspace switch; walker limit, not a break).
- P5, P6, P7, P1: generic walker stops at choice steps; NOT walked end to end. No script errors on load or first steps in manual or agent mode. Needs a scripted walk per prototype.
## A. Names (two-people rule) on live screens
- Third named person Theo Marsh (Kinross): P2 x2, P5 x57, P7 x7. Not caught by my contract test.
- P7 (republished): "Dana" first name x9 remains (note text "Dana, our largest In Full loss..."). P2 (republished): "Sam approved Drop-ship for Ashby by email." x1.
- P6 live (not republished): Tom Hale x82, Tom/Tom's x26, Kim Adeyemi x13, Kim x6, Marcus Bell x3.
## A7 contract on live copies
- Pass: P1 (prepared copy only), P2, P4, P5, P8, P9. Fail: P6 (ISA id ASHBYSUPPLY, names), P7 (NR-461182, NR-461207, NR-461233), NS (ASN-78452, INV-55201, ASN-78431, DC-104, DC-140).
- Limit: contract test checks record ids, names, rule ids and P8's 340 orders; it does not diff every amount on screen.
## A3 agency from source
- P5 Scout: one record path. Ranking recommendation = orderRec() returns by RULES.rank setting (a setting, not records). Short-carton branch set by user choice or scripted Kinross reply. No second record on screen (world has NR-460288). Verdict: fixed/flag.
- P6 Claim: meets(list) checks bol+pod+load in the attached/consented evidence, so dispute readiness is computed from the evidence list; but only one case on screen (DC-40877), so no record switch possible. Verdict: partly.
- P7 Pace: patterns from PAT fixture, WEEK6 constant rows, note text fixed. Verdict: fixed.
- P9 Shelf: no in-transit check in source; recommendation path fixed. Verdict: fixed.
- NS: no agent. P1, P2, P4, P8: no agent (rule-based or view).
- Server: all 24 decisions computed (mutation test in build gate).

## B. Partners (first-party pages fetched 12 Nov 2026)
### Pipe17 (settle-first question)
- ShipHero connector (support.pipe17.com/hc/en-us/articles/9866803420187-Connect-ShipHero-Fulfillment-to-Pipe17): products out, shipping requests out, fulfillment/tracking in, inventory in, arrivals out, receipts in, locations in. No mention of cartons, packages, SSCC, GS1-128, pallet, ASN, 856 or 945. VERDICT: carton/SSCC through ShipHero connector = NOT FOUND in documentation.
- Pipe17 fulfillment object (support.pipe17.com/hc/en-us/articles/42944413671963-Fulfillment-and-Shipping-Request-Objects): has ssccCode, ucc128, billOfLading fields at fulfillment level; no carton/package/pallet object; one fulfillment per package linked by groupId; no per-package line assignment. So the data model can carry one SSCC per fulfillment, but no connector doc says a 3PL fills it. DOCUMENTED (model), NOT FOUND (population by any 3PL connector).
- Pipe17 SPS connector (pipe17.com/integration/sps/): 850, 855, 856, 810, 846, 997; "Generate retailer-compliant ASNs with proper formatting, label data, and carton contents"; maintained by Pipe17; listed as pre-configured connector. MARKETING CLAIM for carton contents (no technical article read). CONFLICT: Pipe17 has a maintained SPS connector.
- Pipe17 managed EDI (pipe17.com/network/edi/): "With managed EDI, Pipe17 is your EDI provider, and you need no separate VAN contract"; not sold standalone; "Retail programs you run through SPS Commerce or another EDI provider stay in place"; documents 850/855/860/856/810/997/846/940/945. CONFLICT: overlapping product. Only SPS named.
- Orderful 3PL connector article (856 unsupported, 945 carton flattening): the first fetch was refused by the fetch allowlist; NOT RE-VERIFIED this session. The project brief records it as initial research only.
- Consequence for artifacts: any route map that shows a retailer ship notice with SSCC detail arriving through Pipe17 from a 3PL is unsupported by documentation. Warehouse-side records the docs support: shipping request (940-like), fulfillment/tracking (945-like at line level), inventory, receipts.
### ShipHawk
- blog.shiphawk.com/automating-edi-and-asns-with-shiphawks-sps-commerce-connector (2 Oct 2023): "ShipHawk does not generate ASNs or support EDI on its own." Connector writes package-level data (dimensions, weight, tracking, carton index, UCC Label ID, item quantities) to SPS Commerce custom records in NetSuite; SPS sends the ASN. Available. CONFLICT: named SPS connector, built with SPS.
- blog.shiphawk.com/edi-providers-and-shiphawk (30 Mar 2021): names SPS Commerce, TrueCommerce, B2B Gateway, MuleSoft, Dell Boomi; "does not directly integrate with any EDI providers"; ERP (NetSuite item fulfillment) is the hub. OpenText not named.
- Supported claim: ShipHawk supplies pack/carton data (incl. UCC label id) to the ERP for the EDI provider's ASN. DOCUMENTED (blog, first-party). SSCC/GS1-128 by name: NOT FOUND on these pages (blog "Are Your SSCC Labels In Compliance?" exists, not read).
### Kanmon
- kanmon.com/integration: REST API only ("single connection"), APIs for offer cards; ingests "orders, invoices, payments, job completions"; products "business loans, lines of credit, and advances"; "direct vendor payment for AP structures"; California DFPI licence cited. Invoice financing / PO financing by name: NOT FOUND. Lender of record, geography, eligibility: NOT STATED -> partner questions. API docs at kanmon.dev not read.
### Vividly
- govividly.com/deduction-scanner: PDF backup to spreadsheet; 50+ backup sources incl. UNFI, KeHE, Walmart, Target, McLane; direct ERP connections NetSuite, some Sage and QuickBooks; "internal deduction matcher that automates promotion matching"; separate "Auto Disputes" product. Retailer portals / EDI 820/812 as a source: NOT FOUND. No EDI provider named. A return feed to Trading Grid compliance tooling: NOT FOUND (target design only).
### Salsify
- salsify.com/pxm/gdsn: "Salsify's GDSN Data Pool is certified by GS1 GDSN". CONFLICT/OVERLAP: Salsify runs its own certified GDSN data pool and a Syndication Network and "Open Catalog", which overlap Trading Grid Catalogue's product data synchronisation. No EDI provider named on the page. API docs not read.
### Not done for partners
- Partner Map, Retail Direction section 9 and the partner briefs were NOT re-read this session, so claim-by-claim rows (B1) are not produced; findings above are capability facts to test those claims against.
- TrueCommerce and Cleo alliances not searched for any partner. kanmon.dev, developers.salsify.com, docs.shiphawk.com not read.

## C1 live golden questions (partial)
- 5 no-context agents, 10 questions each, through the LIVE server via the connected assistant tools; graded by phase0/grade.mjs against SQL on the same commit's build. See score line in the final report.
- Covered: P10 (4 questions), order story NR-450118, P1 anchor NR-449512, P4 anchor NR-449510, P9 anchor NR-451207, rule basis, isolation. NOT covered live: agent decisions (P5, P6, P7, P9, P13, NS), scorecard, deductions, as_of questions: the connector's tool list is stale and the REST token is not here.
- q1 expected value comes from the attention rule engine, not a single SQL query.
## C2: blocked on token.
## Mid-turn instruction (Phase 4 item 3, logged, not built: freeze until Phase 0 approval)
- Entry page as published artifact; cards named by business problem; week 9 "Ship notice held before it costs a charge"; retitle prototypes by business problem; Render address only on P10 card; share with organisation. Sharing cannot be done by me: it is set from each page's Share menu.

## TURN 3 INSTRUCTIONS (user, 12 Nov): finish Phase 0 before approval. APPLY NOW ONLY: (1) remove every name except Priya Raman/Jordan Ellis from P2,P5,P6,P7 + names check in contract test + list what contract test does not check; (2) move the three missing-CTT rejections off the 997; (3) October predecessors retired: list for unsharing, make sure nothing links to them.
THEN READ-ONLY: A1,A5,A6,A8 for every screen prototype using screenshots; ERP-native Activation in full; Agentic Retail Trade + TG for Retail in Two Minutes A7 only; drop older P4 Marketplace; scripted walks P1,P5,P6,P7 to the end; partner claim rows (Partner Map, Retail Direction s9, briefs, route maps) with verdict+source, plus TrueCommerce/Cleo alliance checks and Orderful 3PL article; golden questions: SQL-only expected answers, add agent/scorecard/deductions questions once token arrives. Return completed tables + one ranked change list, then stop.
PARTNER DECISIONS: Salsify two lanes (CPG/grocery: Salsify owns item readiness, TG carries trade; GM/apparel: Salsify is brand source system, Trading Grid Catalogue is a destination; Salsify data pool not shown as route to Northfield); audit vs Salsify docs; list 4 questions only Salsify can answer (destination support, status events, its view of overlap, shared brands). Partner designs show only capability documented today; remove undocumented claims (replaces "ideal state" rule). MCP/agentic for partners: propose from task analysis, do not assume.
- APPLIED 12 Nov: P2 v21, P5 v16, P7 v8, P6 v8 published with only Priya Raman / Jordan Ellis (Theo->Kinross, Dana/Sam->Jordan, Tom->Priya, Kim->Jordan, Marcus->Northfield receiving). Load-tested, no script errors. Local copies in scratchpad/edited/.
- APPLIED 12 Nov: commit on main "Missing CTT is a guide rule..." pushed. 3 missing-CTT rejections now 824 under new invented rule NF-1.7 (code TTL). 997 rejections = 12, all 12 faulted by bots grammars (10 files). Health channels now 31 on 824, 10 on 997 (docs still say 29/12: DOC EDIT PENDING, docs frozen). World retuned (nPre 539, jitter 2): 23,930 transaction sets, 2,676 files, 8,111 other records, 1,945 orders (docs say 24,130 / 8,115 / 1,946: DOC EDIT PENDING). Rules now 54. Gate 346/346, smoke 28/28, StAEDI passes, hash recorded. Names check added to scripts/contract.js (first-name list + cue words); negative control on October P6 fails as expected.
- Contract test on live copies after edits: PASS P1(prepared) P2 P4 P5 P6 P8 P9; FAIL P7 (3 week-6 orders), NS (5 records).

## Retired October predecessors (item 3) — list for unsharing
P4 Marketplace BKP1moSkyhJr77aMiFKyy5 · Northfield Drop-ship Readiness Px985kBmvG9y6aGTbp1K7g · Northfield Receipt Differences NoZBzVET4vkM1cwGXQ1zoK · Trade the Accepted Order 8JXbnRP2qTkWz3S3Gw2Pgf · Marketplace Channel Prototype VMyoHpK34WaF5y3CtnwZs5 · Find Relationship Loss SYDc298ZqBrweVqKHiRWop · Document Order Desk KXS2ohMoaGVSKvxUgAYgti · Pocket Scanner 4gHrpxakbzGmfsmknnZJKZ · Find Missing ASNs U8dX74pSN1eMAFy8yrtoy9 · Carton Accuracy Comparison 19WMcTHSPjc22vhstjciE6 · Apply Order Changes FFmiS1EjBfyjECKhW29YzQ.
Possibly also (reviews/studies, user to confirm): P2 Get Ready: Supplier Activation Review 8QM1yvUPdbJizzP2ryK4by · P1 Participate — Supplier Entry Audit 7emU9u11oJUrKM4MDy6QDw · P5 Motion Study JuPGgScsrnpYKVnXqN7DNP · P1 Motion Study V91GTxuN6Lemw3pFRvui7u · five "Untitled" pages from 20 and 29 Oct.
Link check: no link to any of these in the nine current screens, ERP-native Activation, Agentic Retail Trade, Partner Map, Retail Direction, the three docs (Plan links only to the nine current screens + the old Prove Value Prototype Plan doc RXZ2ZnhCFruXAvhNRgYRyd), server pages, README. NOT scanned: Prove Value Prototype Plan, Prototype Briefs, Field guide, decks, website pages.
## Other live sources fetched (scratchpad/phase0/live/): ERP.html, ART.html, PartnerMap.html (98KB), RetailDirection.html (190KB), P1.html (live = my baseline, so prepared P1 edit is still valid, unpublished).
- ERP-native Activation: Sam Whitaker x2 (names fail); uses NR-450118 + INV-7731 + ASN-450118-A (500 cartons) + $24,552.00 = the old one-shipment story (world: NR-449512 / INV-7702 / ASN-449512-A, same value); SO-118842 not in world; no Problem/Solution lines; no agent; generic walker could not drive it (not walked).
- Agentic Retail Trade: narrative, 611 words; no names, no record ids, no partners, no MCP mention; numbers 25,000 / 5,000 / 60% / 72.6% / 90% are not world numbers (context not extracted).
- TG for Retail in Two Minutes: page holds a video blob + 12 chapter titles; no names, no world numbers, no partner names in page text; "Shopper figures ... citations to follow" note; film frames NOT inspected.

## B. Partner Map claims (live Partner Map v1793923454, PARTNERS object) vs documentation
Rule now: show only what the partner documents today; remove the rest.
| Partner | Claim on the Partner Map | Verdict | Source |
| Pipe17 | status "Ecosystem today; embedded candidate" | WRONG per decision: ecosystem only | user decision 12 Nov |
| Pipe17 | contributes "Routing, inventory-state normalization and fulfilment exceptions" | Marketing claim (product pages); not checked in API docs | pipe17.com/network/edi, /integration/sps |
| Pipe17 | asset "Maintained B2B Integration Foundation connector to Pipe17, on the selling-channel pattern Pipe17 runs with SPS Commerce and Orderful" | SPS and Orderful connectors documented by Pipe17; an OpenText connector does not exist: REMOVE as a shown capability | pipe17.com/integration/sps; support.pipe17.com Orderful articles (not re-fetched) |
| Pipe17 | outcome "Multi-node suppliers meet retailer document requirements from one order flow" | NOT FOUND for carton/SSCC ship notices: ShipHero connector carries no carton detail | support.pipe17.com/hc/en-us/articles/9866803420187 |
| Pipe17 | flow nodes ShipHero WMS, Other WMS or 3PL | ShipHero connector documented (orders out, fulfilment/tracking, inventory, arrivals, receipts) | same |
| Pipe17 | note "850, 855, 860, 856, 810, 846 and 997 ... no separate VAN" | Documented on Pipe17's EDI page (also 940/945); this is the competing managed EDI: move to diligence notes | pipe17.com/network/edi |
| ShipHawk | contributes "Package, carton, tracking and weight data on the item fulfilment record" | Documented (package details, weight, tracking written to NetSuite item fulfillment; carton index and UCC Label ID in the SPS connector post) | blog.shiphawk.com/edi-providers-and-shiphawk; .../automating-edi-and-asns-with-shiphawks-sps-commerce-connector |
| ShipHawk | asset "Versioned ShipHawk field profile per supported ERP, starting with NetSuite" | OpenText-side asset, does not exist; ShipHawk documents NetSuite only on these pages | same |
| ShipHawk | outcome "Carton-level ASNs built from warehouse records with no rekeying" | Partly: ShipHawk supplies package data; "does not generate ASNs or support EDI on its own"; SSCC by name not found | same |
| ShipHawk | note "SPS reads the NetSuite package tab and sends the ASN" | Documented (2 Oct 2023), connector built with SPS: CONFLICT | same |
| Kanmon | "owns the financing product, underwriting, funding, servicing, and collections" | Partly documented: REST API, loans/lines/advances, ingests orders/invoices/payments. Underwriting/servicing/collections split, lender of record: not stated on integration page | kanmon.com/integration |
| Kanmon | first step "hosted referral from Supplier Hub ... then embedded entry" | Hosted link NOT FOUND (page documents REST API and offer-card APIs only) | kanmon.com/integration |
| Kanmon | note "Kanmon powers financing in Cleo's Web EDI ..." | Documented by Cleo: "Powered by Kanmon, Cleo InvoicePay"; inside Cleo WebEDI; no exclusivity wording: CONFLICT (Cleo) | cleo.com/blog/knowledge-base-webedi-invoice-financing |
| Vividly | contributes "Promotion terms, trade-spend logic and promotional deduction cases" | Documented (promotion matching, deduction scanner, Auto Disputes) | govividly.com/deduction-scanner |
| Vividly | asset "Two-way feed: Trading Grid evidence to Vividly; promotion terms and match results to TGI / Compliance Link" | NOT FOUND: sources are PDF backup and ERP connections (NetSuite, Sage, QuickBooks); no EDI/network feed in or out: REMOVE | same |
| Vividly | flow "Retailer and supplier documents > TGI / Compliance Link > Vividly > Supplier finance ERP" | ERP leg documented (NetSuite, some Sage/QuickBooks); the Trading Grid leg not found | same |
| Salsify | contributes "Cross-retailer readiness status, shared with brand authorization" | Partly: Readiness Reports "validate it meets requirements before sending" (pre-send validation). Retailer acceptance/publication status returned: NOT FOUND. Sharing status with a third party: NOT FOUND | salsify.com/pxm/syndication |
| Salsify | asset "Readiness status handoff into Partner Hub" | NOT FOUND: REMOVE as shown capability | same |
| Salsify | GM/apparel lane: Trading Grid Catalogue as a destination Salsify sends to | NOT FOUND: page names no third-party catalogue or data pool as a destination; "API and webhook guides" exist, whether a third party can become a destination is not stated | same |
| Salsify | own GDSN data pool | Documented, GS1 certified: overlap; per decision not shown as a route to Northfield | salsify.com/pxm/gdsn |
Alliance checks: Pipe17 names SPS only (managed EDI page); no TrueCommerce/Cleo connector found in one search. ShipHawk names SPS, TrueCommerce, B2B Gateway, MuleSoft, Dell Boomi as providers customers use (2021 post); connector only with SPS. Kanmon: Cleo (documented). Salsify: no EDI network named on its pages; a third-party agency page mentions a TrueCommerce-Salsify integration (not first-party, not verified). Vividly: none named.
Orderful 3PL article: NOT re-verified (fetch refused earlier; not retried).
Questions only Salsify can answer: (1) Can a third-party catalogue such as Trading Grid Catalogue be added as a syndication destination, and by what route? (2) Does Salsify emit publication/acceptance status events a partner can subscribe to? (3) How does Salsify see the overlap between its GDSN data pool / Open Catalog and Trading Grid Catalogue? (4) Which brands are shared customers, and may they be named?
NOT DONE for B: Retail Direction section 9 and the partner briefs (docx) not read; route maps inside prototypes: P2 names Pipe17 ("routes Drop-ship orders to Kinross and returns fulfilment, tracking and inventory. Trading Grid keeps Northfield EDI") = consistent with documented Pipe17 objects.

## Turn 3 progress (after applied items)
- Golden grader now SQL-only (q1 = union of three SQL conditions, graded as a set; order not graded). Re-graded the five live runs: see score. Agent/scorecard/deduction questions NOT added (token not arrived; connector tool list stale).
- ERP-native Activation walked to end: 8 actions, no script errors. P1: walker loops at the match-confirm step (Use/Change), NOT walked to end. P5, P6, P7 scripted walks NOT done.
- Screenshots reviewed (start frames): P5, P6 (October frame), P7, P9, P4, P1.
  - P5: title "Northfield shipments · next 48 h" is not a problem line; no problem/turn/result labels; "124" shown 4 times, "6 at risk" 3 times, "Northfield rules 2026.2" 4 times in the first view; first row "$451 est." is the number.
  - P6: "$88.40" shown 4 times, "22 days after receipt" twice; Lakeline shown as "Carrier · collect freight" while the shortage story and NF-10.2 treat the freight as prepaid (check).
  - P7: "91.0%" shown twice, plan-due chip twice; In Full 94.63% and charge estimate $3,483 are on screen but not contract-tested.
  - P9: goal line without a number; header reads "Priya · Account planner" (role label, first name only); 40 stores, 1,447 pairs, 980 available all match the world.
  - P4: has a "Main path" selector (a variant picker on screen); goal line without a number.
  - P1 (prepared copy): has a "One email / Sent twice" selector (variant picker); header shows product names "B2B Integration · Essentials"; shows dates "Received 2026-11-02 09:12 ET", "Acknowledgment due 2026-11-03", delivery date 2026-11-07 — these contradict the world (NR-449512 received 28 Sep, delivered 3 Oct). The prepared P1 edit is NOT fit to publish.
  - P6 amounts match world (PMT-990412: 22,843.60 of 22,932.00 on INV-7731C).

---

## Last report to Mandip, 12 Nov 2026 (verbatim)

Phase 0 is still not complete. The three changes you asked for are applied; the read-only work is about half done, and the list of what remains is at the end.

## Applied

- **Names:** P2, P5, P6 and P7 are republished with only Priya Raman and Jordan Ellis. Kinross and Northfield receiving are now named as companies or functions. All four load without script errors; I did not re-walk their flows.
- **Names check:** the contract test now fails on any other named person. It fails the October P6 as a negative control.
- **Missing CTT:** the three rejections now travel on an 824 under a new invented rule, NF-1.7. All twelve remaining 997 rejections are faults under the independent grammars.
- **Side effects of the CTT change:**
  - Health now splits 31 on the 824 and 10 on the 997; the docs still say 29 and 12.
  - The world was retuned to hold 3,412 and 41, so it now has 23,930 transaction sets and 1,945 orders; the docs still give the old counts.
  - The commit is pushed, but the live server was still serving the previous build when I last checked.
- **Retired pages to unshare:** P4 Marketplace, Northfield Drop-ship Readiness, Northfield Receipt Differences, Trade the Accepted Order, Marketplace Channel Prototype, Find Relationship Loss, Document Order Desk, Pocket Scanner, Find Missing ASNs, Carton Accuracy Comparison, Apply Order Changes.
- **Possibly retired, your call:** the two October review pages for P1 and P2, the two motion studies, and five untitled pages.
- **Links to retired pages:** none in the current screens, ERP-native Activation, Agentic Retail Trade, the Partner Map, Retail Direction, the three docs or the server. I did not scan the Prove Value Plan, Prototype Briefs, the field guide or the decks.

**What the contract test still does not check:** amounts, percentages and counts on screen (except the 340 Money in Motion records); dates and times; names outside its first-name list and cue words; rule wording; raw X12 panels; route-map labels and partner names; variant pickers; anything that appears only after interaction; the film.

## Screens

| Screen | A1 problem, turn, result | A5 repeats in first view | A7 world | A9 walk |
|---|---|---|---|---|
| P1 (prepared copy) | Goal line, no number | Not reviewed | Dates contradict the world (shows 2 Nov; order is 28 Sep) | Not finished: loops at match confirm |
| P2 | Not reviewed | Not reviewed | Passes | Supplier side only |
| P4 | Goal line, no number | Not reviewed | Passes | 12 steps, clean |
| P5 | Title is a queue name; $451 on first row | "124" four times, "6 at risk" three times, rule set name four times | Passes | Not done |
| P6 | Short-paid $88.40 in the title chip | "$88.40" four times (October frame) | Passes; shows Lakeline as collect freight, which the shortage story treats as prepaid | Not done |
| P7 | 91.0% in first card | "91.0%" twice | Fails: three week 6 orders; 94.63% and $3,483 untested | Not done |
| P8 | Not reviewed | Not reviewed | Passes | View only |
| P9 | Goal line, no number | Not reviewed | Passes; 40 stores, 1,447 pairs, 980 available match | 8 steps, clean |
| NetSuite | Problem line, no number | Not reviewed | Fails: five records | 6 steps, clean |
| ERP-native Activation | No problem or solution line | Not reviewed | Fails: Sam Whitaker twice; old one-shipment NR-450118 story; SO-118842 | 8 steps, clean |

- **Other screen findings:**
  - P1 and P4 each carry a variant selector on screen.
  - P1 shows product names in its header.
  - P9's header reads "Priya · Account planner".
  - The prepared P1 edit should not be published as it stands.
- **Agentic Retail Trade:** no names, records or partners; five figures (25,000, 5,000, 60%, 72.6%, 90%) are not world numbers.
- **Two Minutes:** the page text has no names, world numbers or partners; I did not inspect the film frames.

**Overlap across prototypes (A6), from source only:**
- P1, P4's wholesale leg and ERP-native Activation all walk Priya through order, acknowledgment, ship notice and invoice. Keep P1; cut P4 at the first order; give ERP-native its own order.
- NetSuite's quantity and ship-to checks repeat P5's lead risk. Make NetSuite the in-ERP version of one P5 risk.
- P2 and ERP-native both run tests, approval and activation with Jordan. Keep the tests in one.

**Collapsed roles (A8), proposals:**
- P6: evidence consent is now Priya asking Priya. Make consent a standing rule per evidence owner (Kinross scans, Lakeline documents); Priya approves only the dispute. Jordan decides the charge; a receipt correction arrives as a revised receiving advice.
- P4: Jordan now approves his own invitation. Make approval a programme record that closes when tests pass.
- P5: Kinross replies come from the warehouse system, not a person.

## Partner claims

| Partner | Claim on the Partner Map | Verdict | Source |
|---|---|---|---|
| Pipe17 | "Ecosystem today; embedded candidate" | Wrong per your decision | — |
| Pipe17 | Maintained OpenText connector on the SPS and Orderful pattern | Does not exist; remove | [SPS connector](https://pipe17.com/integration/sps/) |
| Pipe17 | Multi-node suppliers meet retailer document requirements | Not found for carton-level ship notices | [ShipHero connector](https://support.pipe17.com/hc/en-us/articles/9866803420187-Connect-ShipHero-Fulfillment-to-Pipe17) |
| Pipe17 | Managed EDI document list | Documented; move to diligence notes | [Managed EDI](https://pipe17.com/network/edi/) |
| ShipHawk | Package, carton, tracking and weight on the item fulfilment record | Documented | [EDI providers post](https://blog.shiphawk.com/edi-providers-and-shiphawk) |
| ShipHawk | Carton-level ASNs with no rekeying | Partly: supplies data, "does not generate ASNs" | [SPS connector post](https://blog.shiphawk.com/automating-edi-and-asns-with-shiphawks-sps-commerce-connector) |
| Kanmon | Hosted referral, then embedded entry | Hosted link not found; REST API only | [Integration](https://kanmon.com/integration/) |
| Kanmon | Financing inside Cleo's Web EDI | Documented by Cleo, no exclusivity wording | [Cleo](https://www.cleo.com/blog/knowledge-base-webedi-invoice-financing) |
| Vividly | Two-way feed with Trading Grid evidence | Not found; remove | [Deduction Scanner](https://www.govividly.com/deduction-scanner) |
| Salsify | Cross-retailer readiness status shared with a partner | Pre-send readiness reports documented; status back from the retailer and sharing not found | [Syndication](https://www.salsify.com/pxm/syndication) |
| Salsify | Trading Grid Catalogue as a destination | Not found | Same |

- **Alliances:** ShipHawk has a connector built with SPS; Pipe17 names only SPS; Kanmon is live with Cleo. One search found no TrueCommerce or Cleo connector for Pipe17, ShipHawk, Salsify or Vividly.
- **Questions only Salsify can answer:**
  1. Can a third-party catalogue be added as a destination, and how?
  2. Does it emit publication or acceptance events a partner can subscribe to?
  3. How does it see the overlap with its own data pool?
  4. Which brands are shared, and may they be named?

## Proofs

- **Golden questions:** the attention answer is now derived from three SQL conditions alone; the five live runs regrade at 50 of 50. Agent, scorecard and deduction questions are not added: no token yet.
- **X12:** the independent grammars pass every clean document and fault all twelve 997 rejections.

## Ranked changes

1. Docs: the 824 and 997 split, the world counts and the rule count.
2. P1: remove the variant selector, product names and wrong dates before publishing.
3. ERP-native Activation: names and its own order.
4. NetSuite: the five known findings plus world records.
5. P6: consent redesign; confirm prepaid against collect freight.
6. Partner Map: remove the four undocumented assets; Pipe17 to ecosystem only.
7. P7 week 6 orders; untested scorecard figures.
8. Compute agent decisions on P5, P7 and P9.
9. Cut repeated figures on P5 and P6.

## Still not done

- Scripted walks for P1, P5, P6 and P7.
- A1 and A5 beyond the first frame, and for P2, P8, NetSuite and ERP-native.
- Retail Direction section 9 and the partner briefs.
- The Orderful 3PL article.
- The non-Claude client and the remaining golden questions, both waiting on the token.

Notes are in `/tmp/claude-0/-home-claude/981b805a-7776-5e15-a493-e976e4d285e7/scratchpad/phase0/FINDINGS.md`.
