// P26 Lot data and recall reach (20 November 2026, owner decision; spec: "TG for Retail · Prototype build prompts",
// section P26). Northfield requires a lot and a best-before date on every food carton. Kinross records the lot at
// loading and the Supplier ERP builds the ship notice from it. On one honey order 12 of 60 cartons reach Trading Grid
// with no lot or date; Trading Grid holds the ship notice before release, Kinross records the lot on those cartons, the
// corrected ship notice passes, Priya Raman releases it and Northfield's receiving advice matches it. No lot charge
// arises. On Northfield's side, Ashby recalls one earlier lot (told by email, outside Trading Grid), and the lot reach
// read lists every ship notice and receiving advice that carried it, by DC.
//
// What this stage adds, and what it does not. The lot and best-before date on every honey carton already shipped, and
// on the matching receiving advice lines, come from world/lots.js through the ship notice and receiving advice writers
// (world/log.js, world/x12.js): they change the text of those documents and no quantity, order or charge. This stage
// adds the tables that hold them as read back from the X12, the lot rule in Northfield's guide, P26's own order with
// its hold, two open honey orders allocated from the same lot, and the recall notice.
//
// Dates. Every record this stage adds is dated from Friday 15 January 2027, after P25's last record (Thursday 14
// January), so no other prototype's moment sees it. P26 opens on Monday 18 January at 10:13 ET for both sides (owner, 27 November
// 2026): PO NR-47403's hold is on Priya Raman's screen and NR-47400 waits on its shipping advice, and the recall notice reached Jordan Ellis at 09:00 that morning.
//
// What is invented (marked so in the build prompts doc): the lot scheme, the lot rule's charge, the order, the missing
// lots, the recall. Public basis for the rule: grocery retailers' published requirement that a food ship notice carry
// lot and date at case level (see NF-4.17 in world/ref.js).
//
// No warehouse shipping order (940) is added for these orders (26 November 2026: their 945s are, at the existing times): the inventory advice that covers each
// Kinross pick wave is built by the planning stage before this one runs, and a wave it does not cover would fail its gate.
// Kinross's allocation, load scan and departure scan are the warehouse records here.
//
// Numbering. Documents take their own interchange range (880,000,000 up, world/log.js); events a seventh id range
// (6,000,001 up, world/build.js). Cartons take SSCC serials from 900,001,001.
import { et } from '../lib.js';
import { D } from '../log.js';
import { ITEM } from '../ref.js';
import { lotOf } from '../lots.js';
import { generateSecondHold } from './lot-hold.js';

const day = (d, hm) => et(d, hm);
const PRIYA = 'Priya Raman';
const addMin = (t, m) => new Date(t.getTime() + m * 60000);
const HONEY = 'ASH-HNY-340';
const ERP = ['Supplier ERP', 'ASHBY'], KIN = ['Kinross warehouse system', 'KINROSS'], TG = ['Trading Grid', 'ASHBY'];
const ev = (L, at, kind, po, [system, party], data) => L.event({ at, kind, po, system, party, channel: 'API', data });
const mk = (po, shipTo, cases, o) => ({ po, supplier: 'ASHBY', shipTo, site: 'KIN-JOL', stream: 'buyer', ...o, lines: [{ line: 1, sku: HONEY, qty: cases, price: ITEM[HONEY].case_price }] });

export const P26_PO = 'NR-47400';
export const LOT_RULE = 'NF-4.17';
export const LOT_CHARGE = { per_notice: 150, per_carton: 5 }; // Invented: $150 per ship notice plus $5 per carton with no lot or date
const AT = {
  po: day('2027-01-15', '09:20'), ack: day('2027-01-15', '10:05'), wso: day('2027-01-15', '10:30'),
  recall: day('2027-01-18', '09:00'),
  load: day('2027-01-18', '09:40'), draft: day('2027-01-18', '10:05'), hold: day('2027-01-18', '10:06'),
  rescan: day('2027-01-18', '10:40'), corrected: day('2027-01-18', '10:48'), recheck: day('2027-01-18', '10:49'), release: day('2027-01-18', '11:00'),
  departed: day('2027-01-18', '11:20'), wsa: day('2027-01-18', '11:28'), sent: day('2027-01-18', '11:32'), received: day('2027-01-19', '07:40'),
};
const ORDER = mk(P26_PO, 'DC2', 60, { requested: '2027-01-19', poDate: AT.po.toISOString() });
// Open at P26's moment: ordered and acknowledged, allocated at Kinross Joliet from the same lot, not yet shipped.
const OPEN = [
  { o: mk('NR-47407', 'DC4', 36, { requested: '2027-01-22', poDate: day('2027-01-15', '11:10').toISOString() }), po: day('2027-01-15', '11:10'), ack: day('2027-01-15', '12:00'), alloc: day('2027-01-15', '14:20') },
  { o: mk('NR-47414', 'DC2', 24, { requested: '2027-01-25', poDate: day('2027-01-18', '08:35').toISOString() }), po: day('2027-01-18', '08:35'), ack: day('2027-01-18', '09:15'), alloc: day('2027-01-18', '09:50') },
];
/** The lot P26's order ships from, and the earlier lot Ashby recalls: the one that shipped in the week of 14 December 2026. */
export const P26_LOT = lotOf(HONEY, AT.departed);
export const RECALLED = lotOf(HONEY, day('2026-12-14', '12:00'));
const NO_LOT = 12; // the second pallet layer: Kinross's scan read the carton label and not the lot label

/** The lot check before release: every food carton carries a lot and a best-before date (NF-4.17). */
export const missingLot = (cartons) => cartons.filter((c) => !c.lot || !c.best_before);
export const lotCharge = (n) => LOT_CHARGE.per_notice + LOT_CHARGE.per_carton * n;

function generate(L, ctx) {
  // The recall notice. Ashby tells Northfield by email, outside Trading Grid; Northfield's quality team records it.
  L.event({ at: AT.recall, kind: 'recall.notice', po: null, system: 'Northfield quality records', party: 'NORTHFIELD', channel: 'Email',
    data: { supplier: 'ASHBY', sku: HONEY, item: ITEM[HONEY].description, lot: RECALLED.lot, best_before: RECALLED.best_before, told_by: 'Ashby Supplier', received_as: 'Email, outside Trading Grid', scope: 'One lot; every other lot stays on sale' } });

  // The order and the two open orders, each allocated from the same lot at Kinross Joliet.
  D.po(L, ORDER, AT.po); D.ack(L, ORDER, AT.ack);
  ev(L, AT.wso, 'wms.lot_allocation', P26_PO, KIN, { warehouse_order: `WSO-${P26_PO.slice(3)}`, sku: HONEY, cases: 60, ...P26_LOT });
  for (const x of OPEN) {
    D.po(L, x.o, x.po); D.ack(L, x.o, x.ack);
    ev(L, x.alloc, 'wms.lot_allocation', x.o.po, KIN, { warehouse_order: `WSO-${x.o.po.slice(3)}`, sku: HONEY, cases: x.o.lines[0].qty, ...P26_LOT });
  }

  // Kinross loads 60 cartons and records the lot on 48; the Supplier ERP builds the ship notice from that scan.
  const doc = `ASN-${P26_PO.slice(3)}`, shipment = `SHP-${P26_PO.slice(3)}`; let serial = 900001001;
  const cartons = Array.from({ length: 60 }, () => ({ sscc: ctx.W.sscc(serial++), line: 1, qty: 1 }));
  const asScanned = cartons.map((c, i) => ({ sscc: c.sscc, line: 1, sku: HONEY, cases: 1, lot: i < 60 - NO_LOT ? P26_LOT.lot : null, best_before: i < 60 - NO_LOT ? P26_LOT.best_before : null }));
  ev(L, AT.load, 'wms.load_scan', P26_PO, KIN, { shipment, cartons_loaded: 60, cartons_expected: 60, by_sscc: true, lot_recorded_on: 60 - NO_LOT, lot_not_recorded_on: NO_LOT, note: 'Second pallet layer: carton label read, lot label not read' });
  ev(L, AT.draft, 'erp.ship_notice', P26_PO, ERP, { document: doc, version: 1, sent_to: 'Trading Grid', cartons: 60, built_from: 'Kinross load scan', carton_lots: asScanned });
  const missing = missingLot(asScanned);
  if (missing.length !== NO_LOT) throw new Error(`lot-trace: expected ${NO_LOT} cartons with no lot, found ${missing.length}`);
  ev(L, AT.hold, 'tg.hold', P26_PO, TG, { document: doc, version: 1, state: 'Held', checked_by: 'Trading Grid lot check before release', sent_to_northfield: false, release_rule: 'AP-1.3',
    findings: [{ line: 1, rule: LOT_RULE, check: 'Lot and best-before date on every carton', finding: `${missing.length} of 60 cartons carry no lot or best-before date`, cartons: missing.map((c) => c.sscc), cartons_checked: 60,
      owner: 'Kinross Logistics', fix_in: 'Kinross load scan', exposure_estimate: lotCharge(missing.length), charge: `$${LOT_CHARGE.per_notice} per ship notice plus $${LOT_CHARGE.per_carton} per carton` }] });

  // Kinross records the lot on the 12 cartons; the corrected ship notice from the Supplier ERP is the record of the fix.
  ev(L, AT.rescan, 'erp.correction', P26_PO, KIN, { document: doc, line: 1, rule: LOT_RULE, owner: 'Kinross Logistics', record: `Kinross load scan, ${shipment}`, change: `Lot ${P26_LOT.lot}, best before ${P26_LOT.best_before}, recorded on ${NO_LOT} cartons`, cartons: missing.map((c) => c.sscc) });
  const corrected = asScanned.map((c) => ({ ...c, ...P26_LOT }));
  if (missingLot(corrected).length) throw new Error('lot-trace: the corrected ship notice still has cartons with no lot');
  ev(L, AT.corrected, 'erp.ship_notice', P26_PO, ERP, { document: doc, version: 2, sent_to: 'Trading Grid', cartons: 60, built_from: 'Kinross load scan', carton_lots: corrected });
  ev(L, AT.recheck, 'tg.check', P26_PO, TG, { document: doc, version: 2, result: 'Every carton carries a lot and a best-before date', cartons_checked: 60, rules: [LOT_RULE] });
  ev(L, AT.release, 'approval', P26_PO, TG, { document: doc, approved_by: PRIYA, what: `Release ship notice ${doc} version 2 after every carton carried a lot and a best-before date`, rule: 'AP-1.3', version: 2 });

  // Departed, sent within the hour (NF-4.2), received case for case.
  ev(L, AT.departed, 'wms.departure_scan', P26_PO, KIN, { shipment, carrier: 'Lakeline Freight' });
  // Round plan, 26 November 2026 (owner: keep the times, add the 945s): Kinross's 945 at 11:28 carries each carton's lot as
  // first recorded, 12 of 60 without one; the corrected 945 follows at 11:30, and the ship notice at 11:32 matches it.
  D.whOrder(L, ORDER, AT.wso, `WSO-${P26_PO.slice(3)}`, { shipDate: '2027-01-18', qty: { 1: 60 } });
  D.whAdvice(L, ORDER, AT.wsa, `WSA-${P26_PO.slice(3)}`, { shipmentId: shipment, shippedAt: AT.departed, cartons: asScanned, noLedger: true });
  D.whAdvice(L, ORDER, addMin(AT.wsa, 2), `WSA-${P26_PO.slice(3)}-C`, { shipmentId: shipment, shippedAt: AT.departed, cartons: corrected, noLedger: true });
  D.asn(L, ORDER, AT.sent, { ref: doc, shippedAt: AT.departed, deliveryDate: '2027-01-19', site: 'KIN-JOL', cartons });
  D.receipt(L, ORDER, AT.received, { ref: `RCV-DC2-${P26_PO.slice(3)}`, asnRef: doc, qty: { 1: 60 } });

  // The second hold (owner decision, 20 November 2026, second pass): world/stages/lot-hold.js.
  generateSecondHold(L, ctx);
}

export default {
  id: 'lot-trace',
  docs: {},
  origins: [],
  prev: () => [],
  schema: `
-- Lot and best-before date as each food carton carries them on its ship notice (P26), read back from the X12.
CREATE TABLE carton_lots (sscc TEXT NOT NULL, shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id), po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT REFERENCES items(sku), qty INTEGER NOT NULL, lot TEXT NOT NULL, best_before TEXT);
-- Lot and best-before date on each receiving advice line for a food item (P26), read back from the X12.
CREATE TABLE receipt_lots (receipt TEXT NOT NULL, po TEXT NOT NULL, shipment_id TEXT, received_at TEXT NOT NULL, location TEXT REFERENCES locations(id), line INTEGER NOT NULL, sku TEXT REFERENCES items(sku), qty INTEGER NOT NULL, lot TEXT NOT NULL, best_before TEXT);
CREATE INDEX ix_carton_lots_lot ON carton_lots(lot); CREATE INDEX ix_carton_lots_ship ON carton_lots(shipment_id); CREATE INDEX ix_receipt_lots_lot ON receipt_lots(lot);`,
  generate,
  derive: () => {},
  // Shared documents: each company sees the lots on the ship notices and receiving advices it exchanged.
  views: {
    ashby: ["INSERT INTO carton_lots SELECT c.* FROM m.carton_lots c JOIN m.orders o ON o.po = c.po WHERE o.supplier_id = 'ASHBY'", "INSERT INTO receipt_lots SELECT r.* FROM m.receipt_lots r JOIN m.orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY'"],
    northfield: ['INSERT INTO carton_lots SELECT * FROM m.carton_lots', 'INSERT INTO receipt_lots SELECT * FROM m.receipt_lots'],
  },
};
