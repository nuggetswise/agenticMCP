# World coverage: every stage of the one relationship

Owner direction, 14 November 2026 (D60). The world stays one relationship, Ashby Supplier and Northfield Retailer, with Kinross as Ashby's warehouse and Lakeline as carrier. It grows deeper, not wider: every stage of procure-to-pay and order-to-cash between them gets its documents, its master data and the evidence a dispute would need, so a future prototype finds its records already in place.

## Source order for every value

1. **Structure:** X12 004010 for segments and elements; GS1 standards for GTIN, GLN, SSCC, the packaging hierarchy and item data.
2. **Values and rules:** a retailer's own public EDI guide or supplier manual, linked (R01). A third-party summary is allowed only when the retailer's own guide sits behind a portal, and is marked so.
3. **Expertise:** fills what no public source states, marked invented in the EDI Review Pack with the reason.

Guides are cited and their values used; their text is not copied into the repo.

## Stage map

| Stage | Documents in the world today | Documents to add | Master data and evidence to add | Chargeback or dispute it supports |
| --- | --- | --- | --- | --- |
| Partner setup | none (locations hardcoded) | 816 organisational relationships | Ship-to and store list sent by Northfield, dated, with closures | Wrong or closed ship-to |
| Item and price setup | none | 832 price and item catalogue, 888 item maintenance, 879 price information | Packaging hierarchy (each, inner, case, pallet) with GTIN, dimensions and weight per level; cost and retail with start and end dates; item versions with the date Northfield accepted each | Pack quantity, case label GTIN, carton dimensions and weight, price difference |
| Promotions | none | 889 promotion announcement | Deals per item and period: off-invoice, bill-back, scan-based; deal price on 850 lines; allowances on 810 | Promotion deductions, unauthorised deductions, scan-based settlement differences |
| Planning and inventory | 852 store activity | 830 planning schedule, 846 inventory advice | Forecast versions; on-hand and available by site over time | Short-ship and fill-rate charges judged against what was forecast and available |
| Order and change | 850, 855, 860, 865 | 870 order status report | Order status history | Late-acknowledgment and cancellation charges |
| Transport | none | 753 routing request, 754 routing instructions, 204 load tender, 214 shipment status, 210 freight invoice | Routing windows, appointments, carrier milestones | Collect-ready, on-time and routing-compliance charges |
| Warehouse | 940, 945 | 943 stock transfer shipment, 944 stock transfer receipt | Kinross stock by site | Warehouse delay against the agreement |
| Ship and receive | 856, 861 | none | Carton-level receiving discrepancies tied to SSCC | Carton label, ASN accuracy and shortage charges |
| Billing and settlement | 810, 820 | 812 credit and debit adjustment | Deduction repayments matched to the original deduction | Invoice and deduction disputes, repayments |
| Returns | none | 180 return merchandise authorisation | Return authorisations and return-to-vendor shipments | Return-to-vendor deductions |
| Technical | 997, 824 | none | — | Document rejection and resend |

## Database changes that come with it

- Records now held as loose JSON in `events` (Supplier ERP postings, warehouse scans, item setup conflicts) move to typed tables when a stage above needs them.
- Every rule, price, deal and item attribute carries a start and end date, so a check reads the value in force on the date of the document it judges. Northfield's guide versions (rule sets) get dates the same way, which shows rule change inside the one relationship.
- Foreign keys are declared between documents, orders, items, locations and parties.

## Guards

- No figure a built prototype shows moves without the owner approving a re-baseline in a change list; the gate's fixed values stay as they are.
- Every new document passes both X12 checks (StAEDI and bots-grammars) before any prototype uses it.
- P2's records are not touched (D48).
- Each new stage carries at least one gate check that a dispute can be settled from the world's own records at the document date.
