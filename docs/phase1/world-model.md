# World model: how records are shaped, and what was borrowed from ERPs

Owner direction, 15 November 2026: before the world-coverage tables are designed, study how ERPs model each record and follow their practice. This file records what was borrowed, from where, and how each stage (T1.11 to T1.18) applies it. It is the design every stage module in `world/stages/` follows.

## Practices borrowed

| Practice | ERPNext | SAP | NetSuite | How the world applies it |
| --- | --- | --- | --- | --- |
| One master per thing | Item, Customer, Supplier, Address are doctypes; transactions link to them | Material master, customer and vendor master | Item, customer, vendor and location records | `parties`, `locations`, `items` are the masters. Every store in product activity, every supplier ship-from point and every other supplier's item now has a row, so every reference has a row to point at. |
| Transactions reference masters | Link fields on every transaction row (Sales Order Item to Item) | Document items carry the material number | Transaction lines reference item records | Keys are declared with `REFERENCES` and enforced when the main database commits: the build fails if one has no row. |
| Dated prices | Item Price carries Valid From and Valid Upto ([Item Price](https://docs.frappe.io/erpnext/user/manual/en/item-price)); Pricing Rule carries Valid From and Valid Up To, blank meaning open ([Pricing Rule](https://docs.frappe.io/erpnext/pricing-rule)) | Condition records carry a validity start (DATAB) and end (DATBI) ([KONH fields](https://leanx.eu/sap/table/konh/)) | Price levels and date-effective pricing | `item_prices`: one row per item, price list and validity; `valid_to` is exclusive and null is open. Read with `priceAt`. |
| Dated pack and item attributes | UOM Conversion Detail per item (conversion factor per unit) ([UOM](https://docs.frappe.io/erpnext/purchasing-in-different-unit)) | Alternative units of measure on the material master | Units type and item record | `item_versions`: description, pack and units per case per version, with the date Northfield accepted each. T1.12 adds the GS1 level per GTIN. |
| Dated rules | — | Condition validity per condition record | — | `rule_sets` (Northfield guide 2026.1, then 2026.2 from 1 August) and `rule_versions`, read with `ruleAt` and `paramAt` by the date of the document judged. |
| Document status | Draft, submitted and cancelled; Sales Invoice status such as Paid, Credit Note Issued, Return ([Sales Invoice](https://docs.frappe.io/erpnext/sales-invoice)) | Header and item status (VBUK, VBUP) | Status per transaction (Pending Fulfillment, Pending Receipt, Received) | `documents.status` (Sent, Delivered, Rejected, Held, Corrected and resent, Superseded) as before; each stage table keeps the status its document carries, such as a return authorisation's or a transfer's. |
| A link from every document to the one before it | Delivery Note keeps `against_sales_order` and `so_detail` ([pull request 40489](https://github.com/frappe/erpnext/pull/40489)); a return keeps Return Against ([Sales Return](https://docs.frappe.io/erpnext/sales-return-use-cases)) | Document flow table VBFA: preceding document VBELV, subsequent VBELN, with categories ([VBFA](https://www.se80.co.uk/sap-tables/?name=vbfa)) | Item receipt links to its transfer order, purchase order or return authorisation ([Item Receipts](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3681685.html)) | `document_links`: each document names the documents it was created from, with the kind of link. Read with `documentFlow`. |
| Returns and credits reference the original | Credit Note is a return Sales Invoice against the original ([Credit Note](https://docs.frappe.io/erpnext/credit-note)) | Credit memo follows its billing document in VBFA | Return authorisation created from the sales order or invoice | T1.17: every repayment and return names the deduction or invoice it reverses. |
| A packaging hierarchy with a GTIN per level | — | — | — | GS1: each level (each, inner, case, pallet) has its own GTIN, dimensions and weight ([GS1 Global Data Model](https://www.gs1.org/standards/gs1-global-data-model-attribute-implementation-guide/14); [GS1 Sweden on hierarchy levels](https://gs1.se/en/support/what-are-trade-item-hierarchies-and-trade-item-levels-2/)). T1.12. |

## The document flow

| Document | Created from | Link kind |
| --- | --- | --- |
| 850 purchase order | Origin | — |
| 855 order acknowledgment | 850 | acknowledges |
| 860 order change | 850, or the previous 860 | changes |
| 865 change acknowledgment | 860 of the same sequence | answers change |
| 940 warehouse shipping order | 850 | fulfils |
| 945 warehouse shipping advice | 940 | confirms |
| 856 ship notice | 945 when Kinross shipped, else 855, else 850; a resend names the one it corrects | ships, corrects |
| 861 receiving advice | 856 it names (REF SI) | receives |
| 810 invoice | 856, else 850; a replacement names the invoice it replaces | bills, replaces |
| 820 remittance | each 810 it pays | pays |
| 997, 824 | the document they answer | answers |
| 852 product activity | Origin: a periodic report | — |

Each stage adds its own rows here through its module's `prev()`.

## Rules every stage module follows

1. **Nothing existing moves.** A stage runs after every existing stream, inside `L.aside`, with its own seeded random numbers; its events take ids from 1,000,001 up. `node scripts/world-diff.mjs` builds the world at e8f0e93 and fails if any row there is missing or changed now, unless `docs/phase1/rebaseline.json` names the table with its reason.
2. **P10's window stays as it is.** No stage document between Ashby and Northfield is dated in the 30 days before P10's clock (18 October to 17 November, 11:00 ET); the build refuses one. Cadences are chosen to fit: item and price setup at the start of the history period, planning schedules at the start of each period, and so on.
3. **Masters before transactions.** A stage's reference data goes in `masters()`; its documents reference those rows by declared keys.
4. **Every value has a source.** Structure from X12 004010 and GS1; values from a retailer's public guide where one states them, linked in the EDI Review Pack; otherwise invented and marked so.
5. **Both X12 checks.** StAEDI with a schema per new set (`validator/make-schemas.js`) and bots-grammars (`validator/botscheck.py`) accept every new document.
6. **Scoped copies.** Each stage says which of its tables each company sees (`views`). Ashby never sees another supplier's records; Northfield never sees Ashby's warehouse, carrier or ERP records unless shared into a case.
7. **A gate check per stage** settles at least one dispute from the world's own records as of the document date.

## Stage designs

| Task | Documents | Tables (masters first) | Dispute the gate settles |
| --- | --- | --- | --- |
| T1.12 Catalogue | 832 item and price catalogue, 888 item maintenance, 879 price information; Ashby to Northfield | `packaging_levels` (sku, level, GTIN, quantity of the level below, dimensions, gross weight, valid dates); `item_versions` and `item_prices` gain rows; `item_setup_messages` with Northfield's acceptance | A pack, case label or price charge judged against the catalogue at the ship date |
| T1.13 Promotions | 889 promotion announcement | `deals` (deal, sku, kind: off-invoice, bill-back, scan-based; rate; period); deal price on order lines; allowance on invoices; `deal_settlements` | Each promotion deduction matched to its deal, or shown unauthorised |
| T1.14 Planning and inventory | 830 planning schedule, 846 inventory advice (Kinross to Ashby, R30), 870 order status report | `forecasts`, `forecast_lines`; `stock_positions` by site and date; `order_status` history | A short-ship charge judged against the forecast and the stock available |
| T1.15 Transport | 753 routing request, 754 routing instructions, 204 load tender, 214 shipment status, 210 freight invoice | `routing_requests`, `loads`, `shipment_status`, `freight_invoices`; Lakeline gets an interchange id | An on-time or routing charge decided from carrier milestones |
| T1.16 Warehouse and receiving | 943 stock transfer shipment, 944 stock transfer receipt | `stock_transfers`, `transfer_lines`; `receiving_discrepancies` per SSCC from the 861 | Every discrepancy names its SSCC |
| T1.17 Adjustments and returns | 812 credit or debit adjustment, 180 return authorisation | `credit_debit_adjustments`, `return_authorisations`, `return_lines`; repayments link to the deduction they reverse | Every repayment points to the deduction it reverses |
| T1.18 Partner setup | 816 organisational relationships, Northfield to Ashby | `locations` read from the 816, with dated closures (`location_versions`) | The closed ship-to check still fires, reading the location as of the ship date |
