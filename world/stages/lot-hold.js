// P26 Lot data and recall reach, the second hold (owner decision, 20 November 2026, second pass; spec: "TG for Retail ·
// Prototype build prompts", section P26). A mixed honey and napkin order to DC 4 whose ship notice reaches Trading Grid
// with the lot on every honey carton and no best-before date on any of them: Ashby's ship notice map, changed on Friday
// 15 January, leaves the date off food cartons on a ship notice that carries more than one item. Owner EDI operations,
// fixed in Ashby's ship notice map. Trading Grid holds it before release; after the map is fixed the corrected ship
// notice passes, Priya Raman releases it and Northfield's receiving advice matches it. No lot charge arises.
//
// Generated inside the lot-trace stage, so its documents and events take P26's ranges (880,000,000 up; events 6,000,001
// up) in time order with the first hold's: control numbers keep rising with time. P26's own later records renumber
// within that range (re-baselined in docs/archive/phase1/rebaseline.json). Cartons take SSCC serials from 900,002,001. Invented, as the first hold is: the order, the map change,
// the missing dates. No mixed honey order ships between that map change and this one.
import { et } from '../lib.js';
import { D } from '../log.js';
import { ITEM } from '../ref.js';
import { P26_LOT, LOT_RULE, LOT_CHARGE, missingLot, lotCharge } from './lot-trace.js';

const day = (d, hm) => et(d, hm);
const PRIYA = 'Priya Raman';
const HONEY = 'ASH-HNY-340';
const ERP = ['Supplier ERP', 'ASHBY'], KIN = ['Kinross warehouse system', 'KINROSS'], TG = ['Trading Grid', 'ASHBY'];
const ev = (L, at, kind, po, [system, party], data) => L.event({ at, kind, po, system, party, channel: 'API', data });

export const P26_SECOND = 'NR-47403';
const NAP = 'ASH-NAP-4';
const AT2 = {
  po: day('2027-01-15', '09:45'), ack: day('2027-01-15', '10:20'), wso: day('2027-01-15', '10:50'), mapChange: day('2027-01-15', '16:30'),
  load: day('2027-01-18', '09:55'), draft: day('2027-01-18', '10:12'), hold: day('2027-01-18', '10:13'),
  fix: day('2027-01-18', '11:10'), corrected: day('2027-01-18', '11:18'), recheck: day('2027-01-18', '11:19'), release: day('2027-01-18', '11:30'),
  departed: day('2027-01-18', '12:10'), sent: day('2027-01-18', '12:20'), received: day('2027-01-19', '14:30'),
};
const ORDER2 = { po: P26_SECOND, supplier: 'ASHBY', shipTo: 'DC4', site: 'KIN-JOL', stream: 'buyer', requested: '2027-01-20', poDate: AT2.po.toISOString(),
  lines: [{ line: 1, sku: HONEY, qty: 36, price: ITEM[HONEY].case_price }, { line: 2, sku: NAP, qty: 12, price: ITEM[NAP].case_price }] };

/** Called from the lot-trace stage's generate, so these records share P26's numbering and keep control numbers rising with time. */
export function generateSecondHold(L, ctx) {
  let serial = 900002001;
  // The second hold. Ashby's ship notice map changes on Friday 15 January; on Monday the mixed order's ship notice reaches
  // Trading Grid with the lot on every honey carton and no best-before date on any of them.
  const doc2 = `ASN-${P26_SECOND.slice(3)}`, shipment2 = `SHP-${P26_SECOND.slice(3)}`;
  D.po(L, ORDER2, AT2.po); D.ack(L, ORDER2, AT2.ack);
  ev(L, AT2.wso, 'wms.lot_allocation', P26_SECOND, KIN, { warehouse_order: `WSO-${P26_SECOND.slice(3)}`, sku: HONEY, cases: 36, ...P26_LOT });
  ev(L, AT2.mapChange, 'erp.map_change', null, ERP, { map: 'Ashby ship notice map to Northfield', changed_by: 'EDI operations', change: 'Carton loop for ship notices that carry more than one item rebuilt', note: 'The rebuilt loop leaves the best-before date off food cartons' });
  const cartons2 = [...Array.from({ length: 36 }, () => ({ sscc: ctx.W.sscc(serial++), line: 1, qty: 1 })), ...Array.from({ length: 12 }, () => ({ sscc: ctx.W.sscc(serial++), line: 2, qty: 1 }))];
  const sent2 = cartons2.filter((c) => c.line === 1).map((c) => ({ sscc: c.sscc, line: 1, sku: HONEY, cases: 1, lot: P26_LOT.lot, best_before: null }));
  ev(L, AT2.load, 'wms.load_scan', P26_SECOND, KIN, { shipment: shipment2, cartons_loaded: 48, cartons_expected: 48, by_sscc: true, lot_recorded_on: 36, lot_not_recorded_on: 0 });
  ev(L, AT2.draft, 'erp.ship_notice', P26_SECOND, ERP, { document: doc2, version: 1, sent_to: 'Trading Grid', cartons: 48, built_from: 'Kinross load scan', carton_lots: sent2 });
  const missing2 = missingLot(sent2);
  if (missing2.length !== 36) throw new Error(`lot-trace: expected 36 honey cartons with no best-before date, found ${missing2.length}`);
  ev(L, AT2.hold, 'tg.hold', P26_SECOND, TG, { document: doc2, version: 1, state: 'Held', checked_by: 'Trading Grid lot check before release', sent_to_northfield: false, release_rule: 'AP-1.3',
    findings: [{ line: 1, rule: LOT_RULE, check: 'Lot and best-before date on every carton', finding: `${missing2.length} of ${missing2.length} honey cartons carry a lot and no best-before date`, cartons: missing2.map((c) => c.sscc), cartons_checked: 36,
      owner: 'EDI operations', fix_in: 'Ashby’s ship notice map', cause: 'Since the map change, the carton loop for ship notices with more than one item leaves the best-before date off food cartons', exposure_estimate: lotCharge(missing2.length), charge: `$${LOT_CHARGE.per_notice} per ship notice plus $${LOT_CHARGE.per_carton} per carton` }] });
  ev(L, AT2.fix, 'erp.correction', P26_SECOND, ERP, { document: doc2, line: 1, rule: LOT_RULE, owner: 'EDI operations', record: 'Ashby ship notice map to Northfield', change: 'Best-before date mapped on every food carton of a ship notice with more than one item', cartons: missing2.map((c) => c.sscc) });
  const corrected2 = sent2.map((c) => ({ ...c, ...P26_LOT }));
  if (missingLot(corrected2).length) throw new Error('lot-hold: the second corrected ship notice still has cartons with no date');
  ev(L, AT2.corrected, 'erp.ship_notice', P26_SECOND, ERP, { document: doc2, version: 2, sent_to: 'Trading Grid', cartons: 48, built_from: 'Kinross load scan', carton_lots: corrected2 });
  ev(L, AT2.recheck, 'tg.check', P26_SECOND, TG, { document: doc2, version: 2, result: 'Every carton carries a lot and a best-before date', cartons_checked: 36, rules: [LOT_RULE] });
  ev(L, AT2.release, 'approval', P26_SECOND, TG, { document: doc2, approved_by: PRIYA, what: `Release ship notice ${doc2} version 2 after every carton carried a lot and a best-before date`, rule: 'AP-1.3', version: 2 });
  ev(L, AT2.departed, 'wms.departure_scan', P26_SECOND, KIN, { shipment: shipment2, carrier: 'Lakeline Freight' });
  D.asn(L, ORDER2, AT2.sent, { ref: doc2, shippedAt: AT2.departed, deliveryDate: '2027-01-19', site: 'KIN-JOL', cartons: cartons2 });
  D.receipt(L, ORDER2, AT2.received, { ref: `RCV-DC4-${P26_SECOND.slice(3)}`, asnRef: doc2, qty: { 1: 36, 2: 12 } });
}

