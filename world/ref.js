// Reference data for the one Ashby and Northfield world. Every value is fictional.
// GS1 identifiers use the GS1 example company prefix 0614141.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gs1Check } from './lib.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BUYER_FX = JSON.parse(readFileSync(join(HERE, 'data', 'buyer-orders.json'), 'utf8'));

const gln = (n) => { const b = '0614141' + String(n).padStart(5, '0'); return b + gs1Check(b); };

/** The quarter: 13 Northfield weeks, Sunday to Saturday. */
export const QUARTER = { start: '2026-09-27', end: '2026-12-26', weeks: 13 };

export const parties = [
  { id: 'NORTHFIELD', name: 'Northfield Retailer', kind: 'Retailer', gln: '0614141000050', isa: 'NORTHFIELD' },
  { id: 'ASHBY', name: 'Ashby Supplier', kind: 'Supplier', gln: '0614141002085', isa: 'ASHBYSUP' },
  { id: 'KINROSS', name: 'Kinross Logistics', kind: '3PL warehouse', gln: '0614141003006', isa: 'KINROSS' },
  { id: 'LAKELINE', name: 'Lakeline Freight', kind: 'Carrier', gln: gln(3900), isa: null },
  { id: 'BROOKLINE', name: 'Brookline Goods', kind: 'Supplier', gln: '0614141004003', isa: 'BROOKLINE' },
  { id: 'CEDARPINE', name: 'Cedar & Pine Home', kind: 'Supplier', gln: '0614141005000', isa: 'CEDARPINE' },
  // The other suppliers in Northfield's open-order view (Money in Motion). Index matches the order fixtures.
  ...BUYER_FX.sup.slice(1).map((s, i) => ({ id: `SUP${String(i + 1).padStart(2, '0')}`, name: s.n, kind: 'Supplier', gln: gln(6001 + i), isa: `SUP${String(i + 1).padStart(2, '0')}`, category: s.cat, terms: s.terms })),
];
export const buyerSupplierId = (s) => (s === 0 ? 'ASHBY' : `SUP${String(s).padStart(2, '0')}`);

/** One person per side. Every other role is a company or a system. */
export const people = [
  { id: 'priya', name: 'Priya Raman', party_id: 'ASHBY', role: 'Every Ashby role: orders, shipping, receivables, deductions, administration', email: 'priya@ashby.example' },
  { id: 'jordan', name: 'Jordan Ellis', party_id: 'NORTHFIELD', role: 'Every Northfield role: buying, compliance, receiving, payables, claims, supplier programme', email: 'jordan.ellis@northfield.example' },
];

export const locations = [
  { id: 'DC2', party_id: 'NORTHFIELD', name: 'Northfield DC 2', gln: '0614141002061', active: 1, note: 'Dock window 06:00 to 14:00' },
  { id: 'DC4', party_id: 'NORTHFIELD', name: 'Northfield DC 4', gln: '0614141002115', active: 1, note: 'Dock window 07:00 to 15:00' },
  { id: 'STORE114', party_id: 'NORTHFIELD', name: 'Northfield Store 114', gln: '0614141002078', active: 1, note: null },
  { id: 'DC1-OLD', party_id: 'NORTHFIELD', name: 'Northfield DC 1 (closed)', gln: '0614141001996', active: 0, note: 'Closed; no longer a valid ship-to' },
  { id: 'ASH-WH1', party_id: 'ASHBY', name: 'Ashby warehouse ASH-WH1', gln: '0614141002122', active: 1, note: 'Ashby’s own warehouse' },
  { id: 'KIN-GRV', party_id: 'KINROSS', name: 'Kinross Groveport', gln: '0614141003013', active: 1, note: '3PL warehouse; code EX-WH1 in programme setup' },
  { id: 'KIN-JOL', party_id: 'KINROSS', name: 'Kinross Joliet', gln: gln(3020), active: 1, note: '3PL warehouse' },
];
export const locByGln = Object.fromEntries(locations.map((l) => [l.gln, l]));

export const items = [
  { sku: 'ASH-MUG-12', supplier_id: 'ASHBY', description: 'Stoneware mug 12 oz', gtin: '10614141000125', pack: 'Case of 12', case_price: 54.0, northfield_item: '448120', on_northfield_list: 1 },
  { sku: 'ASH-NAP-4', supplier_id: 'ASHBY', description: 'Linen napkin 4-pack', gtin: '10614141000132', pack: 'Case of 24', case_price: 38.4, northfield_item: '448121', on_northfield_list: 1 },
  { sku: 'ASH-HNY-340', supplier_id: 'ASHBY', description: 'Wildflower honey 340 g', gtin: '10614141000149', pack: 'Case of 12', case_price: 46.8, northfield_item: '448122', on_northfield_list: 1 },
  { sku: 'ASH-MUG-16', supplier_id: 'ASHBY', description: 'Stoneware mug 16 oz', gtin: '10614141000170', pack: 'Case of 12', case_price: 58.0, northfield_item: '448190', on_northfield_list: 0 },
  { sku: 'ASH-TRL-09', supplier_id: 'ASHBY', description: 'Trail runner', gtin: '10614141000163', pack: 'Pair', case_price: 38.0, northfield_item: '448130', on_northfield_list: 1 },
  { sku: 'AHP-8820', supplier_id: 'ASHBY', description: 'Pour-over coffee maker', gtin: '1061414100018' + gs1Check('1061414100018'), pack: 'Case of 6 required by Northfield', case_price: 72.0, northfield_item: 'NF-44721', on_northfield_list: 1 },
  { sku: 'BRK-TWL-2', supplier_id: 'BROOKLINE', description: 'Cotton towel 2-pack', gtin: '10614141004017', pack: 'Case of 12', case_price: 41.0, northfield_item: '451010', on_northfield_list: 1 },
  { sku: 'CDP-CND-8', supplier_id: 'CEDARPINE', description: 'Soy candle 8 oz', gtin: '10614141005014', pack: 'Case of 24', case_price: 62.4, northfield_item: '452020', on_northfield_list: 1 },
];
export const ITEM = Object.fromEntries(items.map((i) => [i.sku, i]));
export const ITEM_BY_NF = Object.fromEntries(items.map((i) => [i.northfield_item, i]));

// ---------- Northfield rule catalogue ----------
// basis: 'public' the requirement and its value appear in a public guide; 'adapted' the pattern is public and the
// value is set for this world; 'invented' no public source was found. Public sources were opened on 12 Nov 2026.
const SRC = {
  amazon: { title: 'Amazon North American Vendor Shipment Preparation and Transportation Manual, 2016 Q2', url: 'https://images-na.ssl-images-amazon.com/images/I/A1CGEzPx85L.pdf', kind: 'Retailer manual' },
  dxl: { title: 'DXL Group Branded and Footwear Vendor Manual, 28 March 2025', url: 'https://images.dxl.com/is/content/CasualMale/PDF/Branded_Vendor_manual_032825.pdf', kind: 'Retailer manual' },
  gordmans: { title: 'Specialty Retailers (Gordmans) Vendor Routing and Compliance Manual, effective 1 March 2018', url: 'https://mimage.opentext.com/alt_content/binary/businessnetwork/gordmans/Gordmans-Guide-2-14-18.pdf', kind: 'Retailer manual' },
  nfm: { title: 'Nebraska Furniture Mart Routing Guide 1.06, April 2024', url: 'https://www.nfm.com/on/demandware.static/-/Library-Sites-NFMSharedLibrary/default/dw5f10b09e/pdfs/vendor/Routing%20Guide.pdf', kind: 'Retailer manual' },
  dsg: { title: 'Summary of the Dick’s Sporting Goods Domestic Vendor Routing and Supply Chain Guide (February 2025)', url: 'https://getproductiv.com/dicks-sporting-goods-compliance', kind: 'Third-party summary' },
  walmart: { title: 'Summary of Walmart supplier compliance and OTIF rules', url: 'https://www.shipcalm.com/blog/walmart-vendor-compliance-guide/', kind: 'Third-party summary' },
  x12: { title: 'ASC X12 004010 data element 324, Purchase Order Number, AN 1/22', url: null, kind: 'Standard' },
  carmack: { title: '49 U.S.C. 14706 (Carmack Amendment): minimum periods for filing claims and bringing suit', url: 'https://www.law.cornell.edu/uscode/text/49/14706', kind: 'Statute' },
};
const pub = (k, says) => ({ ...SRC[k], says });
const R = (id, topic, doc_type, statement, o = {}) => ({ id, owner: o.owner || 'Northfield', implements: null, params: o.params || null, rule_set: 'northfield-2026.2', topic, doc_type, statement, window_hours: o.window ?? null, limit_value: o.limit ?? null, charge_code: o.code ?? null, charge: o.charge ?? null, check: o.check ?? null, source: `Northfield supplier guide 2026.2, rule ${id}`, basis: o.basis || 'invented', public_sources: o.pub || [] });

// Ashby's own policies and agreements (owner Ashby, Ashby agreement). Suppliers publish no policies, so none is Public.
// Mirrored from the EDI Review Pack (registry/catalogue-pack.json), which is the source of truth for rule wording,
// owner, basis and sources. Thresholds the agents read sit in params.
const PACK = JSON.parse(readFileSync(new URL('../registry/catalogue-pack.json', import.meta.url), 'utf8'));
const ASHBY_PARAMS = { 'AP-4.1': { max_amount: 250 }, 'AP-6.1': { min_weekly_avg: 1 }, 'AP-6.2': { min_weeks_supply: 12, pct_of_median: 50 }, 'AP-6.3': { keep_weeks: 8 }, 'AP-6.4': { carton: 40, avg_weeks: 4 }, 'AM-1': { business_days: 2 } };
const ASHBY_RULES = PACK.rules.filter((r) => /^A[PM]-/.test(r.id)).map((r) => ({ id: r.id, owner: r.owner, implements: r.implements.length ? r.implements.join(',') : null, params: ASHBY_PARAMS[r.id] || null, rule_set: r.owner === 'Ashby' ? 'ashby-policy' : 'ashby-agreement', topic: 'policy', doc_type: null, statement: r.statement, window_hours: null, limit_value: null, charge_code: null, charge: null, check: null, source: r.source, basis: r.basis.split(',')[0].toLowerCase(), public_sources: r.links.map((l) => ({ title: l.title, url: l.url, kind: 'Published practice' })) }));

/** Who owns a rule, and which one wins (EDI Review Pack). */
export const PRECEDENCE = 'Industry standards bind both sides. On a Northfield order, Northfield’s rule governs; a signed vendor agreement overrides the guide where it speaks. Ashby’s policy applies where Northfield is silent, and may be stricter than Northfield but never looser. An Ashby agreement with Kinross or the marketplace binds Ashby, but is no defence against a Northfield charge (NF-10.1). Most Ashby rules exist to meet a Northfield rule; the Implements column names it.';

export const rules = [
  R('NF-1.1', 'orders', '850,860', 'The current PO revision is the commitment; a change counts only on an order change'),
  R('NF-1.4', 'acknowledgment', '855', 'Send the order acknowledgment within 24 hours of the purchase order', { window: 24 }),
  R('NF-1.7', 'acknowledgment', '855', 'The order acknowledgment carries the transaction totals segment (CTT) with the number of lines; the X12 standard leaves it optional'),
  R('NF-1.5', 'acceptance', '997', 'Northfield returns a technical acknowledgment (997) to an acknowledgment or change response and sends no business acceptance; a quantity change is accepted only on a matching order change'),
  R('NF-1.6', 'orders', '860,865', 'Change requests go to the buyer, who issues the order change; answer an order change within 24 hours of the latest change', { window: 24 }),
  R('NF-2.1', 'fulfilment', '856', 'No backorders: a short line is cancelled and the shipped quantity reported', { code: 'OT01', charge: '3% of cost of goods, quarterly; months under $1,000 waived', basis: 'public', pub: [pub('walmart', 'In-full misses are charged about 3% of the cost of goods on the affected portion')] }),
  R('NF-2.2', 'fulfilment', '856', 'One PO ships from one location'),
  R('NF-3.2', 'routing', null, 'Collect freight: routing request by 11:00 DC local time, two business days before the ready date', { code: 'RT01', charge: '$150', basis: 'adapted', pub: [pub('dsg', 'Collect shipments are routed at least 2 business days before the ship date'), pub('dxl', 'Routing requested at least 2 full business days before ready-to-ship; less notice is charged incremental freight, minimum $100'), pub('gordmans', 'Routing requests at least 2 days before the cancel date, by 1:00 p.m. Central')] }),
  R('NF-3.3', 'routing', null, 'Northfield returns routing instructions with the carrier and pickup window'),
  R('NF-3.4', 'routing', null, 'Collect readiness is measured at the assigned pickup'),
  R('NF-4.1', 'labels', '856', 'GS1-128 label on every carton; an SSCC is not reused within 18 months', { code: 'LB01', charge: '$150 plus $1 per carton', check: 'sscc_reuse', basis: 'adapted', pub: [pub('amazon', 'An SSCC is not reused for at least 12 months (3.3.2.1.4)'), pub('walmart', 'Label failures: $200 administration fee plus $1 per affected unit')] }),
  R('NF-4.2', 'ship notice', '856', 'Send the ship notice within 1 hour of departure; a corrected ship notice must be received before the shipment reaches the DC', { window: 1, check: 'asn_timing', basis: 'public', pub: [pub('dsg', 'EDI 856 and 810 within 1 hour of the shipment leaving the facility'), pub('amazon', 'ASN within 30 minutes of the trailer leaving, or 6 hours before the appointment (5.2)'), pub('gordmans', 'A usable ASN no later than release to the carrier, and received before the shipment arrives (p. 12)'), pub('dxl', 'An 856 not received before the shipment reaches the DC is chargeable')] }),
  R('NF-4.3', 'labels', '856', 'SSCC on every carton, reported in the ship notice hierarchy', { check: 'sscc_present', basis: 'public', pub: [pub('amazon', 'Each carton carries a unique SSCC, reported at carton level in the 856 MAN segment (3.3.2.1)'), pub('dsg', 'UCC-128 (SSCC-18) label on every carton shipping to a DC')] }),
  R('NF-4.5', 'ship notice', '856', 'The ship notice matches the shipment carton for carton', { code: 'AS02', charge: '$150 plus $1 per carton', basis: 'adapted', pub: [pub('dxl', 'ASN non-compliance charged $100 per PO plus $1 per carton')] }),
  R('NF-4.7', 'ship notice', '856', 'Ship-to matches the current PO', { code: 'AS03', charge: '$150' }),
  R('NF-4.8', 'ship notice', '856', 'Line numbers match the current PO', { code: 'AS04', charge: '$150' }),
  R('NF-4.9', 'item', '856', 'Units per case match Northfield’s item setup', { charge: '$150 per ship notice' }),
  R('NF-4.10', 'reference', '856,810', 'The PO reference (ship notice PRF01, invoice BIG04) is the Northfield PO number, at most 22 characters', { owner: 'Industry standard', limit: '22 characters', check: 'po_reference', basis: 'public', pub: [pub('x12', 'Element 324 is at most 22 characters, so a longer value fails syntax and is rejected on the 997')] }),
  R('NF-4.11', 'item', '856,810', 'Every item is on Northfield’s item list for the supplier; a substitute needs the buyer’s approval first', { check: 'item_on_list' }),
  R('NF-4.12', 'location', '856', 'The ship-to GLN is an active Northfield location', { check: 'ship_to_active' }),
  R('NF-4.13', 'ship notice', '856', 'The carton count in the ship notice equals the cartons listed under it', { check: 'carton_count' }),
  R('NF-4.14', 'item', '856', 'Quantities are in cases (CA)', { limit: 'CA', check: 'uom_cases' }),
  R('NF-4.15', 'ship notice', '856', 'The ship date is on or before the delivery date', { check: 'ship_before_delivery' }),
  R('NF-5.1', 'receiving', null, 'Full truckloads are shipper load and count, sealed at origin'),
  R('NF-5.2', 'receiving', '861', 'Northfield records the seal number and its condition at arrival'),
  R('NF-5.3', 'receiving', '861', 'On a sealed trailer the receiving count stands unless the supplier proves the carton was loaded with a load scan or a load tally by SSCC; the delivery receipt proves the seal, not the count'),
  R('NF-5.5', 'receiving', '861', 'A receipt changes only through a revised receiving advice; a deduction reversal alone does not change it'),
  R('NF-7.1', 'deductions', '820', 'Deductions are taken on the remittance with a reason code and deduction reference; detail sits in the deduction case'),
  R('NF-7.3', 'deductions', '820', 'Dispute once per deduction, within 60 days of the remittance date, in the deduction case', { window: 60 * 24, params: { days: 60 }, basis: 'adapted', pub: [pub('gordmans', 'Disputes older than 6 months are not reviewed (p. 8)'), pub('walmart', 'Disputes are filed within 15 to 30 days of the deduction')] }),
  R('NF-7.4', 'deductions', null, 'Shortage evidence: bill of lading with seal, proof of delivery, and a load scan or load tally by SSCC'),
  R('NF-7.5', 'deductions', null, 'A dispute without the required evidence is not reviewed', { code: 'ID01', charge: '$150', params: { charge: 150 } }),
  R('NF-7.6', 'deductions', '820', 'A reversed deduction is repaid on a later remittance, referencing the original deduction'),
  R('NF-7.8', 'invoice', '810', 'The invoice bills the shipped quantity at the accepted PO price; an invoice that bills more is held', { code: 'IV01', charge: '$100', check: 'invoice_quantity', basis: 'public', pub: [pub('dxl', 'An 810 transmitted with errors is charged $100 per invoice')] }),
  R('NF-7.9', 'invoice', '810', 'Send the invoice within 2 days of shipment', { window: 48, basis: 'adapted', pub: [pub('gordmans', '810 within 24 hours of pickup (p. 10)'), pub('dsg', 'EDI 810 within 1 hour of the shipment leaving')] }),
  R('NF-7.10', 'invoice', '810', 'The invoice total equals the sum of its line amounts', { check: 'invoice_total' }),
  R('NF-8.2', 'scorecard', null, 'In full: cases received against cases ordered per PO line, on the PO revision current at shipment; a cancelled remainder counts as not received'),
  R('NF-8.4', 'scorecard', null, 'Targets: prepaid on time 90%, collect ready 98%, in full 95%', { params: { on_time: 0.9, collect_ready: 0.98, in_full: 0.95 }, basis: 'public', pub: [pub('walmart', 'Prepaid suppliers: 90% on time, 95% in full, 98% collect ready')] }),
  R('NF-8.6', 'scorecard', null, 'Measured monthly on a rolling 13-week scorecard; OT01 and OT02 are billed quarterly'),
  R('NF-7.2', 'deductions', null, "Northfield sends no debit memos; supplier corrections travel as a credit memo or corrected invoice"),
  R('NF-7.7', 'deductions', null, "Northfield’s claims reviewer decides each charge in the case; settlement and write-off are the supplier’s own authorities"),
  R('NF-8.1', 'scorecard', null, "On time. Prepaid: DC arrival inside the must-arrive-by window. Collect: freight ready by the assigned pickup"),
  R('NF-8.3', 'scorecard', null, "Counting unit: cases. Score is compliant cases over all cases in the period"),
  R('NF-8.5', 'scorecard', null, "Exclusions: Northfield’s routed carrier late on collect freight; DC refusal or closure; a PO changed after the routing request"),
  R('NF-9.1', 'scorecard', null, "Scorecard published monthly as a file, with definition version, period and counting unit"),
  R('NF-9.3', 'scorecard', null, "The supplier’s plan states the cause, actions with owners and timing, baseline, definition, comparison population, minimum observations and required evidence. Northfield accepts it and keeps it with the scorecard"),
  R('NF-9.4', 'scorecard', null, "Minimum observations: 30 baseline failing PO lines and an equal comparison period on the same DC set"),
  R('NF-10.1', 'claims', null, "Northfield charges the supplier for shortage and compliance, whoever handled the freight"),
  R('NF-10.3', 'claims', null, "The claimant shows good condition at origin, loss or damage at delivery, and the amount"),
  R('NF-3.6', 'routing', null, 'A collect shipment not ready at the assigned pickup is charged RT01', { code: 'RT01', charge: '$150' }),
  R('NF-9.2', 'scorecard', null, 'Below a target two months running: agree a corrective action plan within 30 days'),
  R('NF-10.2', 'claims', null, 'On prepaid freight the supplier files loss or damage claims with its carrier: at least 9 months to file and 2 years to sue', { owner: 'US law', basis: 'public', pub: [pub('carmack', 'A carrier may not set less than 9 months to file a claim or 2 years to bring suit')] }),
  R('SH01', 'charges', '861,820', 'Shortage: invoice cost of each short carton plus $50', { code: 'SH01', charge: 'Carton cost plus $50' }),
  { id: 'KX-945', owner: 'Ashby agreement', implements: null, params: { hours: 24 }, rule_set: 'kinross', topic: 'warehouse', doc_type: '945', statement: "Kinross returns the warehouse shipping advice (945) within 24 hours of Ashby’s warehouse shipping order (940). Agreement between Ashby and its warehouse, Kinross", window_hours: 24, limit_value: null, charge_code: null, charge: null, check: null, source: 'Ashby warehouse agreement with Kinross. Searched; no standard 945 turnaround is published. SPS Commerce, 3PL selection checklist, Sep 2026 (get a written service level; no standard turnaround)', basis: 'invented', public_sources: [] },
  R('NF-7.11', 'invoice', '810', "Invoice line prices within 0.5% of the acknowledged order price are paid without review; beyond that the line is held", { limit: '0.5%', params: { tolerance: 0.005 } }),
  ...ASHBY_RULES,
];
export const RULE = Object.fromEntries(rules.map((r) => [r.id, r]));

/** Application advice (824) error codes Northfield uses, each tied to one rule. */
export const TED = {
  TTL: { rule: 'NF-1.7', cause: 'Transaction totals segment missing' },
  IID: { rule: 'NF-4.11', cause: 'Item not on Northfield item list' },
  LOC: { rule: 'NF-4.12', cause: 'Ship-to location not recognized' },
  CTN: { rule: 'NF-4.13', cause: 'Carton count does not match cartons listed' },
  TOT: { rule: 'NF-7.10', cause: 'Invoice total does not match line amounts' },
  UOM: { rule: 'NF-4.14', cause: 'Quantity not in cases' },
  DTE: { rule: 'NF-4.15', cause: 'Ship date after delivery date' },
  QTY: { rule: 'NF-7.8', cause: 'Invoice quantity above accepted quantity' },
  PRC: { rule: 'NF-7.11', cause: 'Line price beyond tolerance of the order price' },
  STO: { rule: 'NF-4.7', cause: 'Ship-to differs from the current PO' },
  PCK: { rule: 'NF-4.9', cause: 'Units per case differ from Northfield item setup' },
};
/** 997 syntax error codes (AK3 segment, AK4 element) and how they read. */
export const SYNTAX = {
  'AK3:3': 'Missing required segment', 'AK4:8': 'Invalid date format', 'AK4:5': 'Element longer than allowed', 'AK5:4': 'Segment count does not match',
};

export const docNames = {
  850: 'Purchase order', 855: 'Order acknowledgment', 856: 'Ship notice', 810: 'Invoice', 860: 'Order change',
  865: 'Change acknowledgment', 861: 'Receiving advice', 824: 'Application advice', 997: 'Technical acknowledgment',
  820: 'Remittance advice', 940: 'Warehouse shipping order', 945: 'Warehouse shipping advice', 852: 'Product activity',
};
export const partyByIsa = Object.fromEntries(parties.filter((p) => p.isa).map((p) => [p.isa, p]));
export const PARTY = Object.fromEntries(parties.map((p) => [p.id, p]));
