# Change list 4: retailer compliance rules from a real retailer's guide, as Northfield draft rules

Proposed 16 November 2026, not applied. Source: a table of one retailer's EDI compliance rules the owner supplied in chat. The retailer is not named here or anywhere in the world (R04); values are taken as published and marked "adapted from a retailer guide (owner-supplied)".

## Recommendation

Add the eight rules Northfield does not already have as **Northfield draft rules** (the `draft_rules` table P15 replays), not as rules in force. Reasons:

- Rules in force would re-charge every document already settled in the quarter and move every figure the screens show (world-diff, contract test). Drafts change nothing until Jordan publishes one after a replay.
- It gives P15 and P21 real material: Jordan replays each draft against the quarter, sees whose documents fail and the added exposure, then publishes, revises or keeps it.
- Scout, Watch and the P11 check read a rule only once it is published, so an agent gains a rule by the same route a retailer would use.
- For the four rules Northfield already has, adopt the retailer's charge where Northfield's catalogue has none (NF-4.11, NF-4.14), as drafts too.

## Mapping

| Retailer rule | Northfield today | Proposed | Agents that read it once published |
| --- | --- | --- | --- |
| 997 not received within 48 hours of the PO; $100 per functional acknowledgment | No rule on the supplier's 997 | Draft NFD-3: supplier's 997 to an 850 within 48 hours; $100 per FA | Watch Agent (a missing document) |
| PO ship-to does not match ASN location; $75 or $150 by PO amount | NF-4.7, AS03 $150 | Draft NFD-4: tier AS03 at $75 under a PO-amount threshold | Scout Agent; P11 check |
| ASN item does not match PO; $75 or $150 per ASN | NF-4.11, no charge | Draft NFD-5: charge on NF-4.11, tiered as NFD-4 | Scout Agent; P11 check |
| ASN quantity 105% or more of ordered | No rule | Draft NFD-6: over-shipment at 105%; charge to set (the source gives none) | Scout Agent |
| ASN under-shipment 3% or more; tiered | NF-2.1 (no backorders) and OT01 quarterly | Draft NFD-7: per-ASN under-shipment at 3%, tiers to set | Scout Agent; Pace Agent reads the effect on in full |
| Shipped after Ship-Not-After plus 10 business days; $500 per ASN | NF-8.1 measures arrival, not ship date | Draft NFD-8: late shipment; $500 per ASN | Watch Agent; Pace Agent |
| Shipped more than 7 days before Ship-Not-Before | No rule | Draft NFD-9: early shipment; charge to set | Scout Agent |
| ASN unit of measure differs from PO; $300 per ASN | NF-4.14 (cases), no charge | Draft NFD-10: $300 per ASN on NF-4.14 | Scout Agent; P11 check |
| Duplicate shipment identifier; $150 | No rule | Draft NFD-11: duplicate shipment id; $150 | P11 check |
| Container number reused; $150 | NF-4.1, LB01 $150 plus $1 per carton (SSCC not reused within 18 months) | Keep NF-4.1 | — |
| Mark-for location or quantity does not match PO | Northfield orders carry no mark-for | Leave out until an order carries a mark-for | — |
| Labels, cartons, pallets | NF-4.1, NF-4.3 | Keep | — |
| Shelf life | Left out (D30) | Leave out | — |
| Ticketing | Not modelled | Leave out | — |

## What the world needs

- Eight draft rows in `draft_rules`, with `basis` "adapted from a retailer guide (owner-supplied)" and the figures above; three charges are unset in the source and stay "to set" until the owner gives them.
- PO ship-not-before and ship-not-after dates on Northfield's 850s (DTM 037 and 038) for NFD-8 and NFD-9, read from the orders already generated: a world change to every 850, so it re-baselines X12 hashes. Without it, NFD-8 and NFD-9 stay out.
- Supplier 997s to 850s already exist with their times, so NFD-3 needs no new records.
- Gate checks: each draft replays deterministically; publishing still needs a replay (`nf.publish_needs_replay`).

## Would change

The owner wanting the rules in force for the whole quarter, which re-baselines every charge and every screen figure.
