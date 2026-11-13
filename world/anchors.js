// The named records every prototype stands on: one order story, the charge cases, the store refill,
// the risk queue, the trade test and programme setup. Each sits at its moment on the story calendar.
import { et, addH, addD, etDay } from './lib.js';
import { D, iso } from './log.js';
import { ITEM, BUYER_FX } from './ref.js';

const day = (d, hm) => et(d, hm);
const ev = (L, at, kind, po, system, party, channel, data) => L.event({ at, kind, po, system, party, channel, data });
const mk = (po, lines, o) => ({ po, supplier: 'ASHBY', shipTo: 'DC2', site: 'ASH-WH1', stream: 'buyer', ...o, lines: lines.map(([sku, qty], i) => ({ line: i + 1, sku, qty, price: ITEM[sku].case_price })) });
const cartonsFor = (W, from, lines) => { const c = []; let s = from; for (const [line, n] of lines) for (let k = 0; k < n; k++) c.push({ sscc: W.sscc(s++), line, qty: 1 }); return c; };

/** A free buyer-order number just after the open order Northfield issued on or before a day offset from 8 Nov. */
function numberNear(d0, bump) { const p = [...BUYER_FX.pos].filter((x) => x.d0 <= d0).sort((a, b) => b.d0 - a.d0 || b.id.localeCompare(a.id))[0]; return `NR-${Number(p.id.slice(3)) + bump}`; }

export function anchors(L, W) {
  const A = W.anchor = {};

  // ---------- Week 1: Marketplace seller invited to Wholesale; first Wholesale order (P4) ----------
  {
    const po = A.p4 = numberNear(-41, 1); const O = mk(po, [['ASH-MUG-12', 120], ['ASH-NAP-4', 48]], { requested: '2026-10-02', poDate: iso(day('2026-09-28', '08:05')) });
    ev(L, day('2026-09-27', '10:00'), 'programme.invited', null, 'Northfield supplier programme', 'NORTHFIELD', 'API', { programme: 'Wholesale', supplier: 'Ashby Supplier', by: 'Jordan Ellis', basis: 'Marketplace demand', marketplace_state: 'Active, unchanged' });
    ev(L, day('2026-09-27', '11:30'), 'catalogue.item_conflict', null, 'Trading Grid', 'ASHBY', 'API', { sku: 'ASH-NAP-4', marketplace_gtin: '10614142000131', wholesale_gtin: ITEM['ASH-NAP-4'].gtin, resolution: 'Wholesale item setup accepted on Trading Grid; Marketplace listing unchanged' });
    ev(L, day('2026-09-27', '15:00'), 'programme.activated', null, 'Northfield supplier programme', 'NORTHFIELD', 'API', { programme: 'Wholesale', approved_by: 'Jordan Ellis', tests: 'Passed' });
    ev(L, day('2026-09-28', '07:40'), 'marketplace.order', 'MKT-20931', 'Marketplace platform', 'NORTHFIELD', 'API', { programme: 'Marketplace', sku: 'ASH-MUG-12', cases: 2, status: 'Shipped with tracking' });
    ev(L, day('2026-09-28', '08:00'), 'erp.inventory_read', null, 'Supplier ERP', 'ASHBY', 'API', { sku: 'ASH-MUG-12', on_hand: 410, meaning: 'On hand', read_by: 'Northfield, read only' });
    D.po(L, O, day('2026-09-28', '08:05')); D.ack(L, O, day('2026-09-28', '08:50'));
    const dep = day('2026-10-01', '15:00'); const c = cartonsFor(W, 2001, [[1, 120], [2, 48]]);
    ev(L, dep, 'wms.departure_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: `SHP-${po.slice(3)}`, carrier: 'Lakeline Freight' });
    D.asn(L, O, addH(dep, 0.2), { ref: `ASN-${po.slice(3)}`, shippedAt: dep, deliveryDate: '2026-10-02', cartons: c });
    D.invoice(L, O, addH(dep, 1), { ref: `INV-${po.slice(3)}` });
    D.receipt(L, O, day('2026-10-02', '07:30'), { ref: `RCV-DC2-${po.slice(5)}0`, asnRef: `ASN-${po.slice(3)}`, qty: { 1: 120, 2: 48 } });
    W.pay.push({ O, invRef: `INV-${po.slice(3)}`, amount: 8323.2, at: day('2026-10-31', '08:00') });
  }

  // ---------- Week 1: an emailed PDF order becomes EDI (P1) ----------
  {
    const po = A.p1 = numberNear(-41, 3); const O = mk(po, [['ASH-MUG-12', 300], ['ASH-NAP-4', 120], ['ASH-HNY-340', 80]], { requested: '2026-10-03', poDate: iso(day('2026-09-28', '09:12')) });
    ev(L, day('2026-09-28', '09:12'), 'intake.email', po, 'Trading Grid', 'NORTHFIELD', 'Email', { from: 'buying@northfield.example', attachment: 'PDF purchase order', result: 'Read, matched and approved by Priya Raman; purchase order created as EDI 850 and posted to the Supplier ERP as a sales order' });
    ev(L, day('2026-09-28', '09:40'), 'intake.duplicate', po, 'Trading Grid', 'NORTHFIELD', 'Email', { note: 'The same order emailed again; linked to the first, nothing applied twice' });
    D.po(L, O, day('2026-09-28', '09:12')); D.ack(L, O, day('2026-09-28', '10:05'));
    const dep = day('2026-10-02', '18:00'); const c = cartonsFor(W, 1001, [[1, 300], [2, 120], [3, 80]]);
    ev(L, dep, 'wms.departure_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: `SHP-${po.slice(3)}`, carrier: 'Lakeline Freight' });
    D.asn(L, O, addH(dep, 0.15), { ref: `ASN-${po.slice(3)}-A`, shippedAt: dep, deliveryDate: '2026-10-03', cartons: c });
    D.invoice(L, O, addH(dep, 1), { ref: 'INV-7702' });
    D.receipt(L, O, day('2026-10-03', '07:30'), { ref: `RCV-DC2-${po.slice(5)}1`, asnRef: `ASN-${po.slice(3)}-A`, qty: { 1: 300, 2: 120, 3: 80 } });
    W.pay.push({ O, invRef: 'INV-7702', amount: 24552, at: day('2026-11-02', '08:00') });
  }

  // ---------- Week 3: Drop-ship and warehouse readiness (P2) ----------
  ev(L, day('2026-10-12', '09:00'), 'programme.agreed', null, 'Northfield supplier programme', 'NORTHFIELD', 'API', { programme: 'Drop-ship', supplier: 'Ashby Supplier', wholesale_state: 'Live, unchanged' });
  ev(L, day('2026-10-13', '14:00'), 'programme.test', null, 'Trading Grid', 'KINROSS', 'API', { programme: 'Drop-ship', test: 'Shipment status from Kinross Groveport', result: 'Passed', documents: '850, 855, 856, 846' });
  ev(L, day('2026-10-15', '10:00'), 'programme.approved', null, 'Northfield supplier programme', 'NORTHFIELD', 'API', { programme: 'Drop-ship', approved_by: 'Jordan Ellis' });
  ev(L, day('2026-10-15', '16:00'), 'programme.activated', null, 'Northfield supplier programme', 'NORTHFIELD', 'API', { programme: 'Drop-ship', activated_by: 'Priya Raman' });

  // ---------- Weeks 4 and 5: store activity to a refill order (P9) ----------
  {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const stores = []; for (let i = 101; i <= 124; i++) stores.push(i); for (let i = 201; i <= 216; i++) stores.push(i);
    const w1 = stores.map((n) => { if (n === 114) return { n, sold: 12, oh: 0, avg: 42 }; if (n === 207) return { n, sold: 3, oh: 48, avg: 3 }; const avg = Math.round(26 + rnd() * 24); const sold = Math.max(8, Math.round(avg + (rnd() - 0.5) * 10)); const oh = Math.round(avg * (3 + rnd() * 3.6)); return { n, sold, oh, avg }; });
    const w2 = w1.map((r) => { if (r.n === 114) return { ...r, sold: 31, oh: 9, avg: 38 }; if (r.n === 207) return { ...r, sold: 2, oh: 22 }; if (r.n === 118) return { ...r, oh: Math.max(0, r.oh + 24 - r.sold) }; return { ...r, oh: Math.max(0, r.oh - r.sold + Math.round(r.avg * 0.9)) }; });
    const act = (at, s, e, rows) => L.doc({ type: '852', from: 'NORTHFIELD', to: 'ASHBY', at, period_start: s, period_end: e, buyer_name: 'Northfield Retailer', buyer_gln: '0614141000050', vendor_name: 'Ashby Supplier', vendor_gln: '0614141002085', items: [{ upc: '614141000166', sku: 'ASH-TRL-09', uom: 'EA', stores: rows.map((r) => ({ store: String(r.n), sold: r.sold, on_hand: r.oh })) }] });
    act(day('2026-10-25', '06:10'), '2026-10-18', '2026-10-24', w1); act(day('2026-11-01', '06:10'), '2026-10-25', '2026-10-31', w2);
    W.storeWeeks = { w1, w2 };
    ev(L, day('2026-10-26', '08:05'), 'erp.inventory_read', null, 'Supplier ERP', 'ASHBY', 'API', { sku: 'ASH-TRL-09', available: 980, unit: 'Pairs', meaning: 'Available' });
    ev(L, day('2026-10-26', '08:07'), 'agent.recommendation', null, 'Trading Grid', 'ASHBY', 'API', { agent: 'Shelf Agent', acting_for: 'Priya Raman', store: 114, finding: 'Empty shelf', recommend: 'New order', pairs: 40, also: { store: 207, finding: 'Slow sell-through', recommend: 'Transfer 24 pairs to store 118' }, approved_by: 'Priya Raman', sent_to: 'Jordan Ellis' });
    const po = A.p9 = 'NR-451207'; const O = { po, supplier: 'ASHBY', shipTo: 'STORE114', site: 'ASH-WH1', programme: 'STORE', requested: '2026-10-27', poDate: iso(day('2026-10-26', '10:20')), stream: 'store', lines: [{ line: 1, sku: 'ASH-TRL-09', qty: 40, price: 38, uom: 'PR' }] };
    D.po(L, O, day('2026-10-26', '10:20')); D.ack(L, O, day('2026-10-26', '10:50'));
    const dep = day('2026-10-26', '16:00');
    ev(L, dep, 'wms.departure_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-451207-1', carrier: 'Lakeline Freight' });
    D.asn(L, O, day('2026-10-26', '16:05'), { ref: 'ASN-451207-1', shippedAt: dep, deliveryDate: '2026-10-27', cartons: [{ sscc: W.sscc(471), line: 1, qty: 40 }], lines: [{ line: 1, sku: 'ASH-TRL-09', qty: 40, uom: 'PR' }] });
    D.invoice(L, O, day('2026-10-26', '17:00'), { ref: 'INV-451207' });
    D.receipt(L, O, day('2026-10-27', '09:10'), { ref: 'RCV-S114-51207', asnRef: 'ASN-451207-1', qty: { 1: 40 } });
    W.pay.push({ O, invRef: 'INV-451207', amount: 1520, at: day('2026-11-25', '08:00') });
    // Shelf Agent's other two decisions later in the quarter: goods already in transit, and a transfer.
    ev(L, day('2026-11-02', '08:07'), 'agent.recommendation', null, 'Trading Grid', 'ASHBY', 'API', { agent: 'Shelf Agent', acting_for: 'Priya Raman', store: 207, finding: 'Slow sell-through', recommend: 'Transfer', pairs: 24, to_store: 118 });
  }

  // ---------- Week 6: the order story, PO NR-450118 ----------
  {
    const po = 'NR-450118'; const O = A.story = mk(po, [['ASH-MUG-12', 300], ['ASH-NAP-4', 120], ['ASH-HNY-340', 80]], { requested: '2026-11-07', poDate: iso(day('2026-11-02', '09:12')) });
    D.po(L, O, day('2026-11-02', '09:12'));
    D.change(L, O, day('2026-11-02', '10:40'), 2, [{ line: 1, code: 'QD', qty: 250, qty_left: 250 }]);
    D.change(L, O, day('2026-11-02', '13:05'), 3, [{ line: 1, code: 'QI', qty: 300, qty_left: 300 }, { line: 2, code: 'RS', qty: 120, qty_left: 120, date: '2026-11-09' }]);
    ev(L, day('2026-11-02', '15:30'), 'erp.inventory_read', po, 'Supplier ERP', 'ASHBY', 'API', { sku: 'ASH-MUG-12', on_hand: 410, committed: 140, available: 270, meaning: 'On hand', site: 'ASH-WH1' });
    ev(L, day('2026-11-02', '15:52'), 'erp.inventory_read', po, 'Supplier ERP', 'ASHBY', 'API', { sku: 'ASH-HNY-340', on_hand: 96, meaning: 'On hand', note: 'Earlier reading was 31 hours old and stale' });
    ev(L, day('2026-11-02', '16:10'), 'approval', po, 'Trading Grid', 'ASHBY', 'API', { approved_by: 'Priya Raman', what: 'Change response: line 1 270 cases, line 2 120 cases on 9 Nov, line 3 80 cases' });
    D.changeAck(L, O, day('2026-11-02', '16:12'), 3, 'CHA-450118', [{ line: 1, code: 'IQ', qty: 270 }, { line: 2, code: 'IA', qty: 120, date: '2026-11-09' }, { line: 3, code: 'IA', qty: 80 }]);
    ev(L, day('2026-11-02', '16:40'), 'outside_confirmation', po, 'Trading Grid', 'NORTHFIELD', 'Phone', { confirmed_by: 'Jordan Ellis', recorded_by: 'Priya Raman', scope: 'Business acceptance of the change response: line 1 270, line 2 120 on 9 Nov, line 3 80', accepted_value: 22932 });
    // Shipment 1: lines 1 and 3, 350 cartons. The first ship notice draft carried line 1 at 300 and was held.
    const c1 = [...cartonsFor(W, 1, [[1, 270]]), ...cartonsFor(W, 391, [[3, 80]])];
    ev(L, day('2026-11-06', '11:00'), 'tg.hold', po, 'Trading Grid', 'ASHBY', 'API', { document: 'ASN-450118-1 draft', rule: 'NF-4.5', finding: 'Line 1 ship notice 300 against 270 accepted', exposure_estimate: 150, corrected_by: 'Priya Raman', approved_by: 'Jordan Ellis', approved_at: iso(day('2026-11-06', '11:20')), released_at: iso(day('2026-11-06', '11:25')) });
    const dep1 = day('2026-11-06', '18:00');
    ev(L, addH(dep1, -0.5), 'wms.load_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450118-1', cartons_loaded: 350, cartons_expected: 350, by_sscc: true });
    ev(L, dep1, 'wms.departure_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450118-1', carrier: 'Lakeline Freight' });
    D.asn(L, O, day('2026-11-06', '11:25'), { ref: 'ASN-450118-1', shippedAt: dep1, deliveryDate: '2026-11-07', cartons: c1, qty: { 1: 270, 2: 0, 3: 80 }, bol: 'BOL-88190', seal: 'SL-3302871', status: 'BP' });
    D.receipt(L, O, day('2026-11-07', '07:20'), { ref: 'RCV-DC2-77290', asnRef: 'ASN-450118-1', qty: { 1: 270, 3: 80 } });
    // Shipment 2: line 2, 120 cartons, sealed trailer.
    const c2 = cartonsFor(W, 271, [[2, 120]]); const dep2 = day('2026-11-08', '18:00');
    ev(L, day('2026-11-08', '14:05'), 'wms.pack_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450118-2', cartons_packed: 120 });
    ev(L, day('2026-11-08', '17:21'), 'wms.load_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450118-2', cartons_loaded: 120, cartons_expected: 120, by_sscc: true, includes: '006141410000003006', in_case: 'DC-40877' });
    ev(L, day('2026-11-08', '17:48'), 'carrier.bill_of_lading', po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { bol: 'BOL-88229', trailer: 'LKL-53-0612', terms: 'Collect; loaded and counted by shipper', seal: 'SL-3302918', in_case: 'DC-40877' });
    ev(L, dep2, 'wms.departure_scan', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450118-2', carrier: 'Lakeline Freight' });
    D.asn(L, O, day('2026-11-08', '18:06'), { ref: 'ASN-450118-2', shippedAt: dep2, deliveryDate: '2026-11-09', cartons: c2, qty: { 1: 0, 2: 120, 3: 0 }, bol: 'BOL-88229', seal: 'SL-3302918' });
    const inv = D.invoice(L, O, day('2026-11-08', '10:00'), { ref: 'INV-7731', qty: { 1: 300, 2: 120, 3: 80 } });
    D.advice(L, inv, day('2026-11-08', '10:20'), { action: 'TE', errors: [{ code: 'QTY', cause: W.TED.QTY.cause, seg: 'IT1', elem: 2, bad: '300', allowed: '270 accepted on line 1; held value $1,620.00' }] });
    ev(L, day('2026-11-09', '06:35'), 'carrier.delivery_receipt', po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { shipment: 'SHP-450118-2', delivered: 120, exceptions: 'None', seal: 'SL-3302918 intact', in_case: 'DC-40877' });
    D.receipt(L, O, day('2026-11-09', '07:20'), { ref: 'RCV-DC2-77355', asnRef: 'ASN-450118-2', qty: { 2: 119 }, short: { 2: 1 }, notScanned: { 2: ['006141410000003006'] } });
    D.invoice(L, O, day('2026-11-10', '15:30'), { ref: 'INV-7731C', replaces: 'INV-7731', qty: { 1: 270, 2: 120, 3: 80 } });
    ev(L, day('2026-11-20', '09:00'), 'case.opened', po, 'Northfield deduction case', 'NORTHFIELD', 'API', { case: 'DC-40877', charge: 'SH01', amount: 88.4, line: 2, cartons: 1, deduction: 'DM-55102', dispute_deadline: '2027-01-30' });
    ev(L, day('2026-12-02', '10:15'), 'case.dispute', po, 'Northfield deduction case', 'ASHBY', 'API', { case: 'DC-40877', charge: 'SH01', amount: 88.4, approved_by: 'Priya Raman', evidence: ['Bill of lading with seal', 'Proof of delivery', 'Load scan by SSCC'] });
    ev(L, day('2026-12-05', '10:00'), 'case.decision', po, 'Northfield deduction case', 'NORTHFIELD', 'API', { case: 'DC-40877', charge: 'SH01', amount: 88.4, decision: 'Reversed', decided_by: 'Jordan Ellis', reason: 'Load scan shows carton 006141410000003006 loaded before the seal' });
    ev(L, day('2026-12-16', '11:00'), 'case.dispute', po, 'Northfield deduction case', 'ASHBY', 'API', { case: 'DC-40877', charge: 'AS02', amount: 151, approved_by: 'Priya Raman', evidence: ['Ship notice transmission time', 'Load scan by SSCC'] });
    ev(L, day('2026-12-21', '14:00'), 'case.decision', po, 'Northfield deduction case', 'NORTHFIELD', 'API', { case: 'DC-40877', charge: 'AS02', amount: 151, decision: 'Upheld', decided_by: 'Jordan Ellis', reason: 'The receiving advice stands at 119 until revised (NF-5.5)' });
    ev(L, day('2027-01-06', '09:00'), 'erp.receivables_match', po, 'Supplier ERP', 'ASHBY', 'API', { payment: 'PMT-991204', matched_to: 'DM-55102', amount: 88.4 });
    ev(L, day('2026-11-30', '09:00'), 'scorecard.published', null, 'Northfield scorecard file', 'NORTHFIELD', 'API', { period: 'November 2026', metric: 'OTIF', official: 0.91, note: 'Counts PO NR-450118 line 2 one carton short' });
  }

  // ---------- Weeks 7 and 8: the other two charge cases (P6) ----------
  {
    const O = A.inv = mk('NR-450390', [['ASH-MUG-12', 264]], { requested: '2026-11-18', poDate: iso(day('2026-11-11', '10:00')) });
    D.po(L, O, day('2026-11-11', '10:00')); D.ack(L, O, day('2026-11-11', '13:00'), { codes: { 1: 'IQ' }, qty: { 1: 240 } });
    const dep = day('2026-11-17', '15:00');
    ev(L, dep, 'wms.departure_scan', O.po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450390', carrier: 'Lakeline Freight' });
    D.asn(L, O, addH(dep, 0.3), { ref: 'ASN-450390', shippedAt: dep, deliveryDate: '2026-11-18', cartons: cartonsFor(W, 3001, [[1, 240]]), qty: { 1: 240 } });
    D.receipt(L, O, day('2026-11-18', '08:10'), { ref: 'RCV-DC2-77702', asnRef: 'ASN-450390', qty: { 1: 240 } });
    const inv = D.invoice(L, O, day('2026-11-18', '09:30'), { ref: 'INV-7790', qty: { 1: 264 } });
    D.advice(L, inv, day('2026-11-19', '08:15'), { action: 'TE', errors: [{ code: 'QTY', cause: W.TED.QTY.cause, seg: 'IT1', elem: 2, bad: '264', allowed: '240 accepted and received; held value $1,296.00' }] });
    D.invoice(L, O, day('2026-11-19', '14:00'), { ref: 'INV-7790C', replaces: 'INV-7790', qty: { 1: 240 } });
    W.pay.push({ O, invRef: 'INV-7790C', amount: 12960, at: day('2026-12-18', '08:00') });
  }
  {
    const O = A.car = mk('NR-450415', [['ASH-MUG-12', 60]], { requested: '2026-11-14', poDate: iso(day('2026-11-11', '15:00')) });
    D.po(L, O, day('2026-11-11', '15:00')); D.ack(L, O, day('2026-11-11', '16:30'));
    const dep = day('2026-11-13', '15:00'); const c = cartonsFor(W, 3301, [[1, 60]]);
    ev(L, addH(dep, -0.2), 'carrier.bill_of_lading', O.po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { bol: 'BOL-88412', terms: 'Prepaid; tendered by Ashby', condition: 'Clean', in_case: 'DC-40931' });
    ev(L, dep, 'wms.departure_scan', O.po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-450415', carrier: 'Lakeline Freight' });
    D.asn(L, O, addH(dep, 0.3), { ref: 'ASN-450415', shippedAt: dep, deliveryDate: '2026-11-14', cartons: c });
    D.invoice(L, O, addH(dep, 1.2), { ref: 'INV-7768' });
    ev(L, day('2026-11-14', '07:05'), 'carrier.delivery_receipt', O.po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { shipment: 'SHP-450415', delivered: 60, exceptions: '2 cartons crushed', in_case: 'DC-40931' });
    D.receipt(L, O, day('2026-11-14', '07:40'), { ref: 'RCV-DC2-77590', asnRef: 'ASN-450415', qty: { 1: 58 }, short: { 1: 2 }, notScanned: { 1: c.slice(-2).map((x) => x.sscc) } });
    ev(L, day('2026-11-21', '09:00'), 'case.opened', O.po, 'Northfield deduction case', 'NORTHFIELD', 'API', { case: 'DC-40931', charge: 'SH01', amount: 208, line: 1, cartons: 2, deduction: 'DM-55140', dispute_deadline: '2027-01-30' });
    ev(L, day('2026-12-02', '11:00'), 'case.accepted', O.po, 'Northfield deduction case', 'ASHBY', 'API', { case: 'DC-40931', charge: 'SH01', amount: 208, approved_by: 'Priya Raman', reason: 'Damage in transit on prepaid freight; Northfield charges the supplier (NF-10.2)' });
    ev(L, day('2026-12-03', '09:30'), 'carrier.claim_filed', O.po, 'Lakeline Freight', 'ASHBY', 'API', { claim: 'CR-2026-031', amount: 108, basis: 'Goods cost of 2 cartons' });
  }
  // Remittances that carry the charges.
  W.remit.push({ at: day('2026-12-01', '08:00'), ref: 'PMT-990412', items: [
    { invoice: 'INV-7731C', po: 'NR-450118', paid: 22843.6, invoice_amount: 22932, adjustments: [{ amount: -88.4, reason: '04', ref: 'DM-55102', note: 'SH01 shortage, PO NR-450118 line 2, 1 carton, case DC-40877' }] },
    { invoice: 'INV-7768', po: 'NR-450415', paid: 3032, invoice_amount: 3240, adjustments: [{ amount: -208, reason: '04', ref: 'DM-55140', note: 'SH01 shortage, PO NR-450415 line 1, 2 cartons, case DC-40931' }] },
  ] });
  W.compliance = [{ amount: -151, reason: '06', ref: 'CI-NF-2611-0418', note: 'AS02 ship notice does not match receipt, PO NR-450118, case DC-40877' }, { amount: -100, reason: '06', ref: 'CI-NF-2611-0418', note: 'IV01 invoice above shipped quantity, PO NR-450390, INV-7790' }];
  W.repay = { at: day('2027-01-05', '08:00'), ref: 'PMT-991204', adjustments: [{ amount: 88.4, reason: '04', ref: 'DM-55102', note: 'Reversal of SH01, case DC-40877' }] };

  // ---------- Week 9: trade test for a new item in NetSuite ----------
  {
    const t = (at, kind, data) => ev(L, at, kind, data.po || null, data.system || 'Trading Grid trade testing', data.party || 'ASHBY', 'API', data);
    t(day('2026-11-23', '09:00'), 'test.order', { po: 'PO-104728', system: 'Supplier ERP (NetSuite)', sales_order: 'SO-108842', item: 'AHP-8820', northfield_item: 'NF-44721', cases: 120, approved_by: 'Priya Raman' });
    t(day('2026-11-23', '10:10'), 'test.ship_notice', { po: 'PO-104728', document: 'ASN-78214', item_fulfillment: 'IF-55410', attempt: 1, pack_sent: 12, pack_required: 6, netsuite_item_pack: 12, map_field: 'Item pack quantity', result: 'Failed', rule: 'NF-4.9', exposure_estimate: 150, delivered_to_northfield: false });
    t(day('2026-11-23', '10:40'), 'test.correction', { po: 'PO-104728', record: 'NetSuite item AHP-8820', change: 'Case configuration AHP-8820-C12 to AHP-8820-C6', approved_by: 'Priya Raman' });
    t(day('2026-11-23', '10:55'), 'test.ship_notice', { po: 'PO-104728', document: 'ASN-78214', item_fulfillment: 'IF-55410', attempt: 2, pack_sent: 6, pack_required: 6, netsuite_item_pack: 6, map_field: 'Item pack quantity', result: 'Passed', delivered_to_northfield: true });
    // A second test where NetSuite is right and the map is wrong.
    t(day('2026-11-24', '09:30'), 'test.ship_notice', { po: 'PO-104731', document: 'ASN-78231', item_fulfillment: 'IF-55432', attempt: 1, item: 'AHP-8830', pack_sent: 12, pack_required: 6, netsuite_item_pack: 6, map_field: 'Purchase unit, not item pack quantity', result: 'Failed', rule: 'NF-4.9', exposure_estimate: 150, delivered_to_northfield: false });
    t(day('2026-11-24', '11:20'), 'test.correction', { po: 'PO-104731', record: 'Ship notice map', change: 'Read item pack quantity instead of purchase unit', approved_by: 'Priya Raman' });
    t(day('2026-11-24', '11:45'), 'test.ship_notice', { po: 'PO-104731', document: 'ASN-78231', item_fulfillment: 'IF-55432', attempt: 2, item: 'AHP-8830', pack_sent: 6, pack_required: 6, netsuite_item_pack: 6, map_field: 'Item pack quantity', result: 'Passed', delivered_to_northfield: true });
    t(day('2026-11-24', '15:00'), 'programme.activated', { system: 'Northfield supplier programme', party: 'NORTHFIELD', programme: 'Wholesale, item AHP-8820', approved_by: 'Jordan Ellis', tests: 'Passed' });
    t(day('2026-11-30', '10:15'), 'erp.first_live_order', { po: 'PO-104912', system: 'Supplier ERP (NetSuite)', sales_order: 'SO-108955', item_fulfillment: 'IF-55498', document: 'ASN-78260', item: 'AHP-8820', pack_sent: 6, pack_required: 6, result: 'Delivered; receiving advice matched' });
  }

  // ---------- Week 11: six fulfilment risks before the truck leaves (P5), Tuesday 8 December 17:12 ----------
  {
    const risk = (po, lines, o) => { const O = mk(po, lines, { stream: 'risk', poDate: iso(o.recv), ...o }); D.po(L, O, o.recv); D.ack(L, O, addH(o.recv, 1.5), o.ack || {}); return O; };
    const t0 = day('2026-12-08', '17:12');
    const hero = A.hero = risk('NR-460207', [['ASH-MUG-12', 400], ['ASH-NAP-4', 260]], { recv: day('2026-12-04', '09:00'), shipTo: 'DC4', site: 'KIN-GRV', requested: '2026-12-09' });
    D.change(L, hero, day('2026-12-07', '14:00'), 1, [{ line: 1, code: 'RS', qty: 400, qty_left: 400 }, { line: 2, code: 'RS', qty: 260, qty_left: 260 }]);
    ev(L, day('2026-12-07', '14:00'), 'order.ship_to_changed', hero.po, 'Northfield ordering', 'NORTHFIELD', 'EDI', { change: 1, ship_to: 'DC 2', previous: 'DC 4', note: 'Supplier ERP sales order still shows DC 4 and the old line numbers' });
    ev(L, addH(t0, -0.4), 'wms.load_scan', hero.po, 'Kinross warehouse system', 'KINROSS', 'API', { shipment: 'SHP-460207', cartons_loaded: 659, cartons_expected: 660, by_sscc: true, missing: '006141410006005172', missing_state: 'Staged, not loaded', bol: 'BOL-91407', seal: 'SL-4471026', seals_in_minutes: 40 });
    const inv = A.riskInv = risk('NR-460219', [['ASH-MUG-12', 90], ['ASH-NAP-4', 180]], { recv: day('2026-12-05', '10:00'), site: 'KIN-GRV', requested: '2026-12-10' });
    ev(L, addH(t0, -2), 'erp.invoice_draft', inv.po, 'Supplier ERP', 'ASHBY', 'API', { invoice: 'INV-8012', line: 2, billed: 180, shipped: 176, over_value: 153.6, batch_sends_in_minutes: 168 });
    const route = A.riskRoute = risk('NR-460241', [['ASH-MUG-12', 220]], { recv: day('2026-12-07', '11:00'), site: 'KIN-JOL', requested: '2026-12-11' });
    ev(L, addH(t0, -1), 'routing.request', route.po, 'Northfield transportation', 'ASHBY', 'EDI', { state: 'Missing', freight: 'Collect', cases: 220, due_in_minutes: 1068, rule: 'NF-3.2' });
    const alloc = A.riskAlloc = risk('NR-460262', [['ASH-MUG-12', 300]], { recv: day('2026-12-07', '15:00'), site: 'KIN-GRV', requested: '2026-12-11' });
    ev(L, addH(t0, -0.5), 'wms.inventory', alloc.po, 'Kinross warehouse system', 'KINROSS', 'API', { sku: 'ASH-MUG-12', site: 'Kinross Groveport', available: 520, ordered_across_orders: 640, orders: 3, change_cutoff_in_minutes: 1248 });
    const lab = A.riskLab = risk('NR-460233', [['ASH-HNY-340', 96]], { recv: day('2026-12-06', '09:00'), site: 'KIN-JOL', requested: '2026-12-10' });
    ev(L, addH(t0, -0.7), 'wms.label_scan', lab.po, 'Kinross warehouse system', 'KINROSS', 'API', { cartons: 96, reused_sscc: 12, first_used_on: W.anchor.p1, rule: 'NF-4.1', loading_starts_in_minutes: 1368 });
    const off = A.riskOff = risk('NR-460274', [['ASH-MUG-12', 300]], { recv: day('2026-12-08', '09:30'), site: 'KIN-GRV', requested: '2026-12-11' });
    ev(L, day('2026-12-08', '13:10'), 'outside_confirmation', off.po, 'Trading Grid', 'NORTHFIELD', 'Phone', { confirmed_by: 'Jordan Ellis', recorded_by: 'Priya Raman', scope: '270 cases agreed by phone; the PO still reads 300', order_change_received: false, loading_starts_in_minutes: 1488 });
    // Scout Agent's conflict record: the Supplier ERP says shipped and Kinross has not departed.
    const conf = A.riskConflict = risk('NR-460288', [['ASH-NAP-4', 140]], { recv: day('2026-12-08', '10:00'), site: 'KIN-JOL', requested: '2026-12-11' });
    ev(L, day('2026-12-10', '14:05'), 'erp.fulfilment_posted', conf.po, 'Supplier ERP', 'ASHBY', 'API', { shipment: 'SHP-460288', cartons: 140 });
    ev(L, day('2026-12-10', '14:20'), 'wms.load_scan', conf.po, 'Kinross warehouse system', 'KINROSS', 'API', { shipment: 'SHP-460288', cartons_loaded: 140, cartons_expected: 140, by_sscc: true, trailer_state: 'At door 7, not departed' });
    W.riskOrders = [hero, inv, route, alloc, lab, off, conf];
  }

  // ---------- Claim Agent's other evidence states (Kinross shipments, December remittances) ----------
  W.claimCases = [
    { case: 'DC-41102', dm: 'DM-55640', evidence: 'held_by_warehouse' },   // load scan exists at Kinross, not in the case
    { case: 'DC-41118', dm: 'DM-55655', evidence: 'tally_only' },          // no load scan; Kinross has a load tally by SSCC
    { case: 'DC-41131', dm: 'DM-55671', evidence: 'none' },                // no load scan or tally anywhere
  ];
}

/** Finishes the risk orders after the moment: the ideal state, each fixed with Priya's approval. */
export function finishRisks(L, W) {
  let serial = 601000;
  for (const O of W.riskOrders) {
    if (O.po === 'NR-460207') O.shipTo = 'DC2';
    const n = O.po.slice(3); const dep = O.po === 'NR-460207' ? et('2026-12-08', '18:00') : et(O.po === 'NR-460219' ? '2026-12-09' : '2026-12-10', O.po === 'NR-460288' ? '18:00' : '15:00');
    const ship = Object.fromEntries(O.lines.map((l) => [l.line, l.qty]));
    if (O.po === 'NR-460262') ship[1] = 270; if (O.po === 'NR-460274') ship[1] = 270; if (O.po === 'NR-460219') ship[2] = 176;
    if (O.po === 'NR-460274') { D.change(L, O, et('2026-12-08', '18:20'), 1, [{ line: 1, code: 'QD', qty: 270, qty_left: 270 }]); D.changeAck(L, O, et('2026-12-08', '18:50'), 1, 'CHA-460274', [{ line: 1, code: 'IA', qty: 270 }]); O.lines[0].qty = 270; }
    if (O.po === 'NR-460262') { D.change(L, O, et('2026-12-09', '09:20'), 1, [{ line: 1, code: 'QD', qty: 270, qty_left: 270 }]); D.changeAck(L, O, et('2026-12-09', '09:50'), 1, 'CHA-460262', [{ line: 1, code: 'IA', qty: 270 }]); O.lines[0].qty = 270; }
    const cartons = []; for (const l of O.lines) for (let k = 0; k < ship[l.line]; k++) cartons.push({ sscc: O.po === 'NR-460207' && l.line === 1 && k === 172 ? '006141410006005172' : W.sscc(serial++), line: l.line, qty: 1 });
    D.whOrder(L, O, addH(dep, -20), `WSO-${n}`, { shipDate: etDay(dep), qty: ship });
    L.event({ at: dep, kind: 'wms.departure_scan', po: O.po, system: 'Kinross warehouse system', party: 'KINROSS', channel: 'API', data: { shipment: `SHP-${n}`, carrier: 'Lakeline Freight' } });
    D.whAdvice(L, O, addH(dep, 0.2), `WSA-${n}`, { shipmentId: `SHP-${n}`, shippedAt: dep, ordered: ship, shipped: ship });
    D.asn(L, O, addH(dep, 0.1), { ref: `ASN-${n}`, shippedAt: dep, deliveryDate: etDay(addD(dep, 1)), cartons, qty: ship, shipTo: 'DC2', ...(O.po === 'NR-460207' ? { bol: 'BOL-91407', seal: 'SL-4471026' } : {}) });
    D.invoice(L, O, addH(dep, 1.5), { ref: O.po === 'NR-460219' ? 'INV-8012' : `INV-${n}`, qty: ship });
    D.receipt(L, O, et(etDay(addD(dep, 1)), '08:20'), { ref: O.po === 'NR-460207' ? 'RCV-DC2-81420' : `RCV-DC2-${n}`, asnRef: `ASN-${n}`, qty: ship });
    O.shipped = ship; O.departed = dep;
  }
}
