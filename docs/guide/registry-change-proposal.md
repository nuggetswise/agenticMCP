# Registry change list, proposed and not applied

Proposed on 13 November 2026 from the owner's answers recorded in the Build Guide's Inventory (Job, and where it ends). Nothing here has been applied to `registry/registry.json`. Applying it changes repo behaviour (the gate reads the registry), so it needs the owner's approval and then runs as T2.7. Each line is RETAIN, CORRECT, DELETE or ADD.

## Every entry

- ADD a `job` sentence and an `ends_at` record to each prototype, copied from Inventory, and a gate check that fails when the guide and the registry disagree.

## P11

- CORRECT `name`: "P11 NetSuite Ship Notice Exception" becomes "P11 NetSuite Chargeback Avoidance" (D33; the live screen's title).
- CORRECT `agency`: verdict `agent`, agent `Test Agent`, job `trade_test` become verdict `rule-based`, agent none. The live screen has no agent (Phase 0 findings).
- CORRECT the job: a live ship notice that breaks a Northfield rule is held and corrected inside NetSuite before it leaves.
- DELETE the three Test Agent `decisions` (ASN-78214 twice, ASN-78231) and the acceptance check `agent.trade_test` from P11. Whether the test-ship-notice records stay in the world for P2 is a separate Phase 1 call.
- CORRECT `anchors`: `event:test.ship_notice` becomes the live order, its corrected ship notice and Northfield's receiving advice. The world holds one live NetSuite order whose receiving advice matched (event `erp.first_live_order`, PO-104912), but no live ship notice that was held and corrected, and the records on the live screen are not in the world. A Phase 1 change list has to add the held ship notice or move the screen onto PO-104912.
- CORRECT `customer_agent.supplier`: "Not applicable during testing" no longer fits a live order.
- RETAIN `erp_placement`: the hold, the correction and the approval sit on the NetSuite item fulfillment.

## P4

- RETAIN the job, the anchors and the acceptance check `p4.first_wholesale_order`: they already end at the first Wholesale order.
- ADD `ends_at`: the first Wholesale order as a sales order in Supplier ERP.

## P12

- ADD a retired entry (status Retired, no anchors, no tools) so the registry covers the Inventory row, or record the retirement in a `retired` list. The contract claims file also carries an empty P12 entry to remove.

## Endings the registry does not anchor yet

- P1: ADD the order acknowledgment (855) to `anchors`. RETAIN `document:INV-7702` and `p1.paid_before_money_in_motion` as world facts; they sit beyond P1's ending and P8 reads them.
- P5: ADD the receiving advice that matches the corrected shipment to `anchors`.
- P7: ADD Northfield's next scorecard to `anchors` once the world holds it. Checked on 13 November: the world's two scorecards are both published before the corrective plan falls due, so the ending record is missing (T1.8).
- P9: ADD the next store activity report to `anchors`; today they stop at the order and its ship notice. The world holds that report (store 114, the period ending 31 October).
- P2, P6 and P8: RETAIN. P2 anchors the activation event, P6 the repayment documents, and P8 creates no record.

## Names

- CORRECT `name` for P6 and P7 to carry "Northfield", as their gallery titles and the guide's Inventory do, or drop it in both places.

## Already in T2.7

- ADD entries for P10 Northfield, ART, FILM and P16.

## Not registry, and needing separate approval

- The Prototype Plan's story calendar and portfolio table still describe P11 as a test ship notice failing the pack rule, under its old name and with no number.
- The Prototype Plan has task cards for P10 and P13 only. Built prototypes have a portfolio row and nothing else, so T4.5 adds their cards.
- The Prototype Plan's Delivery list still tells builders to build from the Feature Requirements document and to cite requirement IDs; the Build Guide replaced both.
