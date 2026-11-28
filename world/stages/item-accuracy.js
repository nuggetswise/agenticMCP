// P25 Unknown item on a ship notice (20 November 2026, owner decision; spec: "TG for Retail · Prototype build prompts",
// section P25). Ashby publishes a shirt to the catalogue Northfield receives, Northfield orders shirts and trail runners,
// and the ship notice the Supplier ERP builds carries three item numbers Northfield cannot match. Trading Grid checks
// every line against Ashby's catalogue records and the order line before release, holds it, the owners fix the EDI map,
// the item mapping and the item master, the corrected ship notice passes, Priya Raman releases it, and Northfield's
// receiving advice matches it line for line. No item accuracy charge arises.
//
// Dates. Every record is dated from Monday 11 January 2027, after P22's moment (Saturday 9 January 17:00 ET), the last
// on the story calendar before this one, so no other prototype's moment sees any record this stage adds. P25 opens on
// Wednesday 13 January at 14:05 ET, when the hold is on screen.
//
// What is invented (marked so in the build prompts doc): the shirt, its price and pack, the orders, the three defects
// and their fixes. Public basis: the catalogue fields (NRF colour and size codes from the VICS EDI trade item
// identification guidelines), the GS1 length, check digit and company prefix rules, and the charge pattern (DXL Group
// vendor manual, p. 3: an incorrect ship notice is charged $100 per purchase order plus $1 per carton).
//
// Numbering. Documents take their own interchange range (870,000,000 up, world/log.js); events a sixth id range
// (5,000,001 up, world/build.js). Cartons take SSCC serials from 900,000,001, far above any in the world.
import { et, addH, gs1Check } from '../lib.js';
import { D, iso } from '../log.js';
import { ITEM, PARTY } from '../ref.js';
import { catalogueLine } from './catalogue.js';

const day = (d, hm) => et(d, hm);
const PRIYA = 'Priya Raman';
// Ship notice drafts reach Trading Grid as EDI 856 (round plan 26 November 2026: EDI first); every other event here is API.
const ev = (L, at, kind, po, system, party, data, channel = 'API') => L.event({ at, kind, po, system, party, channel, data });
const mk = (po, shipTo, lines, o) => ({ po, supplier: 'ASHBY', shipTo, site: 'ASH-WH1', stream: 'buyer', ...o, lines: lines.map(([sku, qty], i) => ({ line: i + 1, sku, qty, price: ITEM[sku].case_price })) });
const upcOf = (ref5) => { const b = `614141${ref5}`; return b + gs1Check(b); }; // 12-digit UPC under Ashby's prefix 0614141

// ---------- what Northfield receives: Ashby's catalogue records ----------
export const CATALOGUE_2027 = 'CAT-ASH-2027-01';
const PUBLISHED = { 'CAT-ASH-2026-01': '2026-02-23T19:00:00.000Z', [CATALOGUE_2027]: et('2027-01-11', '09:00').toISOString() };
const UPC = { 'ASH-TRL-09': upcOf('00016'), 'ASH-NAP-4': upcOf('00013'), 'ASH-SHT-M': upcOf('00019'), 'ASH-SHT-L': upcOf('00020'), 'ASH-SHT-XL': upcOf('00021') };
/** Fields follow the catalogue export: product, item number and type, description, NRF colour and size, brand line. */
export const CATALOGUE_RECORDS = [
  { sku: 'ASH-TRL-09', product: 'Trail runner', description: 'Trail runner', colour_code: '001', colour: 'Black', size_code: '50555', size: '11 Medium', message: CATALOGUE_2027 }, // NRF size code from the GS1 US size code table (23 November 2026)
  { sku: 'ASH-NAP-4', product: 'Linen napkin 4-pack', description: 'Linen napkin 4-pack', colour_code: '260', colour: 'Ivory', size_code: '30001', size: 'One size', message: CATALOGUE_2027 },
  { sku: 'ASH-SHT-M', product: 'Shirt', description: 'Shirt', colour_code: '410', colour: 'Navy', size_code: '10970', size: 'Medium', message: CATALOGUE_2027 },
  { sku: 'ASH-SHT-L', product: 'Shirt', description: 'Shirt', colour_code: '410', colour: 'Navy', size_code: '10975', size: 'Large', message: CATALOGUE_2027 },
].map((r) => ({ supplier_id: 'ASHBY', sku: r.sku, product: r.product, item_number: UPC[r.sku], item_type: 'UP', description: r.description, colour_code: r.colour_code, colour: r.colour,
  size_code: r.size_code, size: r.size, brand_line: 'Ashby', case_gtin: ITEM[r.sku].gtin, message: r.message, published_at: PUBLISHED[r.message], basis: 'Invented' }));

// ---------- Ashby's own records: the Supplier ERP item master and item mapping, and Ashby's ship notice map ----------
// Dated rows, as the ERP holds them: a value from valid_from, closed at the correction that replaced it.
const AT = {
  catalogue: day('2027-01-11', '09:00'), accepted: day('2027-01-11', '14:00'),
  po: day('2027-01-12', '09:30'), ack: day('2027-01-12', '10:15'),
  draft: day('2027-01-13', '14:00'), hold: day('2027-01-13', '14:01'),
  fixMap: day('2027-01-13', '14:35'), fixMapping: day('2027-01-13', '14:50'), fixMaster: day('2027-01-13', '15:00'),
  corrected: day('2027-01-13', '15:10'), recheck: day('2027-01-13', '15:11'), release: day('2027-01-13', '15:20'),
  loaded: day('2027-01-13', '15:40'), departed: day('2027-01-13', '16:00'), sent: day('2027-01-13', '16:10'), received: day('2027-01-14', '07:30'),
};
const ISO = Object.fromEntries(Object.entries(AT).map(([k, v]) => [k, v.toISOString()]));
const SHIRT_FROM = '2027-01-08T14:00:00.000Z'; // the shirt set up in the Supplier ERP before Ashby published it
const R = (sku, record, field, value, valid_from, valid_to, note = null) => ({ supplier_id: 'ASHBY', sku, record, field, value, valid_from, valid_to, note, basis: 'Invented' });
export const SUPPLIER_ITEM_RECORDS = [
  R('ASH-SHT-M', 'Supplier ERP item master', 'UPC', UPC['ASH-SHT-M'], SHIRT_FROM, null),
  R('ASH-SHT-M', 'Ashby ship notice map', 'UPC sent on ship notice lines', `0${UPC['ASH-SHT-M']}`, SHIRT_FROM, ISO.fixMap, 'The map adds a leading digit to the UPC'),
  R('ASH-SHT-M', 'Ashby ship notice map', 'UPC sent on ship notice lines', UPC['ASH-SHT-M'], ISO.fixMap, null),
  R('ASH-SHT-L', 'Supplier ERP item master', 'UPC', UPC['ASH-SHT-L'], SHIRT_FROM, null),
  R('ASH-SHT-L', 'Supplier ERP item mapping', 'UPC for Northfield item 448141', UPC['ASH-SHT-XL'], SHIRT_FROM, ISO.fixMapping, 'Mapped to the X large'),
  R('ASH-SHT-L', 'Supplier ERP item mapping', 'UPC for Northfield item 448141', UPC['ASH-SHT-L'], ISO.fixMapping, null),
  R('ASH-SHT-XL', 'Supplier ERP item master', 'UPC', UPC['ASH-SHT-XL'], SHIRT_FROM, null, 'Shirt, Navy, X large: in the Supplier ERP only; never published to Northfield'),
  R('ASH-TRL-09', 'Supplier ERP item master', 'UPC', `${UPC['ASH-TRL-09'].slice(0, 11)}7`, '2026-03-01T05:00:00.000Z', ISO.fixMaster, 'Wrong check digit. No document to Northfield carried the UPC before this order'),
  R('ASH-TRL-09', 'Supplier ERP item master', 'UPC', UPC['ASH-TRL-09'], ISO.fixMaster, null),
];

// ---------- the order, Ashby's other open orders for the same items, and what the Supplier ERP builds ----------
export const P25_PO = 'NR-47300';
const ORDER = mk(P25_PO, 'DC2', [['ASH-SHT-M', 24], ['ASH-SHT-L', 24], ['ASH-TRL-09', 12]], { requested: '2027-01-14', poDate: ISO.po });
// Open at P25's moment: ordered and acknowledged, not yet shipped. Built later, so they carry the same item numbers
// until the map, the mapping and the item master are fixed.
const OPEN = [
  { o: mk('NR-47304', 'DC4', [['ASH-SHT-M', 18], ['ASH-SHT-L', 18]], { requested: '2027-01-19', poDate: day('2027-01-12', '11:05').toISOString() }), po: day('2027-01-12', '11:05'), ack: day('2027-01-12', '12:20') },
  { o: mk('NR-47311', 'DC2', [['ASH-TRL-09', 30]], { requested: '2027-01-20', poDate: day('2027-01-12', '15:40').toISOString() }), po: day('2027-01-12', '15:40'), ack: day('2027-01-12', '16:30') },
  { o: mk('NR-47318', 'DC2', [['ASH-SHT-L', 24], ['ASH-TRL-09', 12]], { requested: '2027-01-21', poDate: day('2027-01-13', '09:10').toISOString() }), po: day('2027-01-13', '09:10'), ack: day('2027-01-13', '10:05') },
];

/** The UPC the Supplier ERP puts on a ship notice line for an item, as Ashby's records stand at `at`. */
export function upcSent(sku, at) {
  const t = iso(at); const inForce = (rec) => SUPPLIER_ITEM_RECORDS.find((r) => r.sku === sku && r.record === rec && r.valid_from <= t && (r.valid_to == null || r.valid_to > t));
  return (inForce('Ashby ship notice map') || inForce('Supplier ERP item mapping') || inForce('Supplier ERP item master'))?.value ?? null;
}
const SHIP_FROM = 'ASH-WH1';
const linesAt = (O, at) => O.lines.map((l) => ({ line: l.line, sku: l.sku, cases: l.qty, ordered_item: ITEM[l.sku].description, ordered_upc: UPC[l.sku], upc_sent: upcSent(l.sku, at) }));

/** The checks, in order, with the rule each reads (spec P25: length, check digit, company prefix, published to Northfield, ordered item). */
export function checkLine(l) {
  const v = String(l.upc_sent || ''); const held = new Map(CATALOGUE_RECORDS.map((r) => [r.item_number, r]));
  if (!/^\d{12}$/.test(v)) return { check: 'Length', rule: 'GS1-1', finding: `Line ${l.line} carries ${v}, ${v.length} digits where a UPC has 12` };
  if (gs1Check(v.slice(0, 11)) !== v[11]) return { check: 'Check digit', rule: 'GS1-1', finding: `Line ${l.line} carries ${v}; its check digit should be ${gs1Check(v.slice(0, 11))}` };
  if (!v.startsWith('614141')) return { check: 'Company prefix', rule: 'GS1-2', finding: `Line ${l.line} carries ${v}, which is not under Ashby’s company prefix` };
  if (!held.has(v)) return { check: 'Published to Northfield', rule: 'NF-4.16', finding: `Line ${l.line} carries ${v}, a valid Ashby UPC that Northfield does not hold` };
  if (held.get(v).sku !== l.sku) return { check: 'Ordered item', rule: 'NF-4.16', finding: `Line ${l.line} carries ${v}, which is not the item Northfield ordered` };
  return null;
}
const OWNER = { 'Ashby ship notice map': ['EDI operations', 'Ashby’s ship notice map'], 'Supplier ERP item mapping': ['Master-data operations', 'Supplier ERP item mapping'], 'Supplier ERP item master': ['Master-data operations', 'Supplier ERP item master'] };
const sourceOf = (sku, at) => { const t = iso(at); return ['Ashby ship notice map', 'Supplier ERP item mapping', 'Supplier ERP item master'].find((rec) => SUPPLIER_ITEM_RECORDS.some((r) => r.sku === sku && r.record === rec && r.valid_from <= t && (r.valid_to == null || r.valid_to > t))); };

function generate(L, ctx) {
  const ash = PARTY.ASHBY, nf = PARTY.NORTHFIELD;
  // The catalogue Northfield pulls: Ashby's shirt, Medium and Large, with case GTIN and UPC; Northfield accepts both.
  L.doc({ type: '832', from: 'ASHBY', to: 'NORTHFIELD', at: AT.catalogue, ref: CATALOGUE_2027, effective: '2027-01-11', vendor_name: ash.name, vendor_gln: ash.gln, buyer_name: nf.name, buyer_gln: nf.gln,
    // P25 (26 November 2026): the trail runner and napkin join the shirts, every item with its NRF colour and size codes.
    items: ['ASH-SHT-M', 'ASH-SHT-L', 'ASH-TRL-09', 'ASH-NAP-4'].map((sku, i) => { const c = CATALOGUE_RECORDS.find((r) => r.sku === sku); return { ...catalogueLine(sku, '2027-01-11', i + 1, '2027-01-11'), nrf: { colour: c.colour_code, size: c.size_code } }; }) });
  L.event({ at: AT.accepted, kind: 'catalogue.decision', po: null, system: 'Northfield item setup', party: 'NORTHFIELD', channel: 'Trading Grid', data: { message: CATALOGUE_2027, doc_type: '832', lines: [...['ASH-SHT-M', 'ASH-SHT-L'].map((sku) => ({ sku, decision: 'Accepted', item_version: 1 })), ...['ASH-TRL-09', 'ASH-NAP-4'].map((sku) => ({ sku, decision: 'Accepted', item_version: 1 }))] } });

  // The order and the other open orders.
  D.po(L, ORDER, AT.po); D.ack(L, ORDER, AT.ack);
  for (const x of OPEN) { D.po(L, x.o, x.po); D.ack(L, x.o, x.ack); }

  // The Supplier ERP sends the ship notice to Trading Grid; the rules read it at once and hold it on three lines.
  const draft = linesAt(ORDER, AT.draft);
  const doc = `ASN-${P25_PO.slice(3)}`;
  ev(L, AT.draft, 'erp.ship_notice', P25_PO, 'Supplier ERP', 'ASHBY', { document: doc, version: 1, sent_to: 'Trading Grid', cartons: 60, lines: draft }, 'EDI 856');
  const findings = draft.map((l) => ({ l, f: checkLine(l) })).filter((x) => x.f).map(({ l, f }) => {
    const [owner, fixIn] = OWNER[sourceOf(l.sku, AT.draft)];
    return { line: l.line, rule: f.rule, check: f.check, sent: l.upc_sent, ordered_item: l.ordered_item, ordered_upc: l.ordered_upc, finding: f.finding, owner, fix_in: fixIn, exposure_estimate: Math.round(l.cases * ITEM[l.sku].case_price * 100) / 100 };
  });
  if (findings.length !== 3) throw new Error(`item-accuracy: expected three failing lines, found ${findings.length}`);
  ev(L, AT.hold, 'tg.hold', P25_PO, 'Trading Grid', 'ASHBY', { document: doc, version: 1, state: 'Held', checked_by: 'Trading Grid item check before release', sent_to_northfield: false, release_rule: 'AP-1.3', findings });

  // Each owner fixes its own record. The item mapping change takes effect only once Priya Raman confirms it (AP-2.3).
  const fix = (at, line, extra) => ev(L, at, 'erp.correction', P25_PO, 'Supplier ERP', 'ASHBY', { document: doc, line, rule: findings.find((x) => x.line === line).rule, owner: findings.find((x) => x.line === line).owner, ...extra });
  fix(AT.fixMap, 1, { record: 'Ashby ship notice map to Northfield', change: `UPC sent as ${UPC['ASH-SHT-M']}; the added leading digit is removed` });
  fix(AT.fixMapping, 2, { record: 'Supplier ERP item mapping, Northfield item 448141', change: `Shirt, Navy, Large maps to ${UPC['ASH-SHT-L']} (was ${UPC['ASH-SHT-XL']}, the X large)`, confirmed_by: PRIYA, confirm_rule: 'AP-2.3' });
  fix(AT.fixMaster, 3, { record: 'Supplier ERP item master ASH-TRL-09', change: `UPC ${UPC['ASH-TRL-09']} (was ${UPC['ASH-TRL-09'].slice(0, 11)}7, wrong check digit)` });

  // The corrected ship notice from the Supplier ERP is the record of the fix; the rules run again and every line matches.
  const corrected = linesAt(ORDER, AT.corrected);
  if (corrected.some(checkLine)) throw new Error('item-accuracy: the corrected ship notice still fails');
  ev(L, AT.corrected, 'erp.ship_notice', P25_PO, 'Supplier ERP', 'ASHBY', { document: doc, version: 2, sent_to: 'Trading Grid', cartons: 60, lines: corrected }, 'EDI 856');
  ev(L, AT.recheck, 'tg.check', P25_PO, 'Trading Grid', 'ASHBY', { document: doc, version: 2, result: 'Every line matches', lines_checked: corrected.length, rules: ['GS1-1', 'GS1-2', 'NF-4.16'] });
  ev(L, AT.release, 'approval', P25_PO, 'Trading Grid', 'ASHBY', { document: doc, approved_by: PRIYA, what: `Release ship notice ${doc} version 2 after every line matched`, rule: 'AP-1.3', version: 2 });

  // Loaded, departed, sent within the hour (NF-4.2), received line for line.
  const shipment = `SHP-${P25_PO.slice(3)}`; let serial = 900000001;
  const cartons = ORDER.lines.flatMap((l) => Array.from({ length: l.qty }, () => ({ sscc: ctx.W.sscc(serial++), line: l.line, qty: 1 })));
  ev(L, AT.loaded, 'wms.load_scan', P25_PO, 'Supplier ERP', 'ASHBY', { shipment, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true });
  ev(L, AT.departed, 'wms.departure_scan', P25_PO, 'Supplier ERP', 'ASHBY', { shipment, carrier: 'Lakeline Freight' });
  D.asn(L, ORDER, AT.sent, { ref: doc, shippedAt: AT.departed, deliveryDate: '2027-01-14', site: SHIP_FROM, cartons,
    lines: corrected.map((l) => ({ line: l.line, sku: l.sku, qty: l.cases, upc: l.upc_sent })) });
  D.receipt(L, ORDER, AT.received, { ref: `RCV-DC2-${P25_PO.slice(3)}`, asnRef: doc, qty: Object.fromEntries(ORDER.lines.map((l) => [l.line, l.qty])) });
}

export default {
  id: 'item-accuracy',
  docs: {},
  origins: [],
  prev: () => [],
  schema: `
-- Ashby's catalogue records as Northfield receives them (P25): item number and type, NRF colour and size, brand line.
CREATE TABLE catalogue_records (supplier_id TEXT NOT NULL REFERENCES parties(id), sku TEXT NOT NULL REFERENCES items(sku), product TEXT NOT NULL, item_number TEXT NOT NULL, item_type TEXT NOT NULL,
  description TEXT NOT NULL, colour_code TEXT, colour TEXT, size_code TEXT, size TEXT, brand_line TEXT, case_gtin TEXT, message TEXT NOT NULL, published_at TEXT NOT NULL, basis TEXT NOT NULL,
  PRIMARY KEY (supplier_id, item_number));
-- Ashby's own item records outside the catalogue (P25): the Supplier ERP item master and item mapping, and Ashby's ship
-- notice map, dated as each value held. Ashby's view only.
CREATE TABLE supplier_item_records (supplier_id TEXT NOT NULL REFERENCES parties(id), sku TEXT NOT NULL, record TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, note TEXT, basis TEXT NOT NULL);`,
  masters: () => ({ catalogue_records: CATALOGUE_RECORDS, supplier_item_records: SUPPLIER_ITEM_RECORDS }),
  generate,
  derive: () => {},
  views: {
    ashby: ['INSERT INTO catalogue_records SELECT * FROM m.catalogue_records WHERE supplier_id = \'ASHBY\'', 'INSERT INTO supplier_item_records SELECT * FROM m.supplier_item_records WHERE supplier_id = \'ASHBY\''],
    northfield: ['INSERT INTO catalogue_records SELECT * FROM m.catalogue_records'],
  },
};
