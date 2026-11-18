// Records added on 17 November 2026, before P5, P7, P13 and P20 are rebuilt (docs/build-log/CALLS.md, 111 onward).
// They are written as a stage so that nothing already in the world moves: the documents take interchange numbers from
// a range of their own (800,000,000 up; acknowledgments 900,000,000 up) and the other records take ids from 2,000,001 up.
//
//   1. NR-450118 (2 November): Northfield's order change 4 sets line 1 at 270, Ashby acknowledges it (865) and Northfield
//      returns its 997. They replace the outside confirmation by phone, which is withdrawn (world/anchors.js).
//   2. P5 (8 December, NR-460207): Kinross's scan reporting carton 006141410006005172 crushed, then its load scan at
//      660 of 660 with a replacement case, both before the seal (17:52 ET) and the 18:00 departure.
//   3. P13 (18 November 09:00): three orders on the morning check. NR-462410: fulfilment posted at 07:50, Kinross load scan,
//      no departure scan, ship notice held. NR-462411: ship notice rejected on an 824 for a substitute item, answered by
//      Ashby's 997, not yet corrected. NR-462412: Kinross's system does not answer the status read.
//   4. P20 (January 2027): Northfield's deduction cases for PD-2701-02, -04 and -05, Ashby's disputes, Jordan Ellis's
//      reversals, the remittance that repays $677.20 and the Supplier ERP receivables match.
//   5. Other suppliers' buyer orders (9 November to 3 December): a ship notice and a receiving advice for each of the 37
//      orders that were past their delivery dates with neither (world/data/buyer-shipments.json). Three arrive late and
//      three short; the four orders Northfield cancelled with an order change get nothing.
// No new X12 set and no new table: every row comes from the core derive and from the returns stage (deduction_repayments).
import { et, addH, addD, etDay } from '../lib.js';
import { D, iso } from '../log.js';
import { ITEM, PARTY, TED } from '../ref.js';
import { REPLACEMENT_SSCC } from '../anchors.js';
import { P5 } from '../p5-physical.js';
import { parseClaim } from './promotions.js';

const r2 = (x) => Math.round(x * 100) / 100;
const NF = PARTY.NORTHFIELD; const ASH = PARTY.ASHBY;

/** The three orders added to the 18 November 09:00 check, and the three promotion deduction cases. */
export const P13_ORDERS = { held: 'NR-462410', rejected: 'NR-462411', silent: 'NR-462412' };
export const P20_CASES = { 'PD-2701-02': 'PC-27102', 'PD-2701-04': 'PC-27104', 'PD-2701-05': 'PC-27105' };
export const P20_REPAYMENT = 'PMT-991307';

function generate(L, { W, buyerShipments }) {
  const ev = (at, kind, po, system, party, data) => L.event({ at, kind, po, system, party, channel: 'API', data });
  const KIN = ['Kinross warehouse system', 'KINROSS']; const ERP = ['Supplier ERP', 'ASHBY']; const TG = ['Trading Grid', 'ASHBY']; const CASE = ['Northfield deduction case'];

  // ---------- 1. NR-450118: line 1 at 270 on an order change ----------
  {
    const O = W.anchor.story;
    D.change(L, O, et('2026-11-02', '16:40'), 4, [{ line: 1, code: 'QD', qty: 270, qty_left: 270 }]);
    D.changeAck(L, O, et('2026-11-02', '16:54'), 4, 'CHA-450118-4', [{ line: 1, code: 'IA', qty: 270, qty_ordered: 270 }]);
  }

  // ---------- 2. P5: the crushed carton and the load at 660 of 660 ----------
  {
    const po = P5.po; const crushed = P5.carton.sscc; const repl = REPLACEMENT_SSCC(W);
    ev(et('2026-12-08', '17:21'), 'wms.damage_scan', po, ...KIN, { shipment: 'SHP-460207', sscc: crushed, line: 1, sku: P5.carton.sku, condition: 'Crushed', contents: 'Damaged', state: 'Cannot be loaded',
      cartons_loaded: 659, cartons_expected: 660, by_sscc: true, note: `Carton ${crushed} crushed at staging, contents damaged; the order ships 659 of 660 unless a replacement case is loaded` });
    ev(et('2026-12-08', '17:46'), 'wms.load_scan', po, ...KIN, { shipment: 'SHP-460207', cartons_loaded: 660, cartons_expected: 660, by_sscc: true,
      replacement: { sscc: repl, replaces: crushed, sku: P5.carton.sku, from: 'Cases Kinross holds back for damage replacement at Groveport; not counted in the 610 free' },
      bol: 'BOL-91407', seal: 'SL-4471026', seals_in_minutes: 6 });
  }

  // ---------- 3. P13: three more orders on the 18 November 09:00 check ----------
  {
    let serial = 910001;
    const order = (po, site, lines, recv) => ({ po, supplier: 'ASHBY', shipTo: 'DC2', site, stream: 'watch', requested: '2026-11-19', poDate: iso(recv), r: recv,
      lines: lines.map(([sku, qty], i) => ({ line: i + 1, sku, qty, price: ITEM[sku].case_price })) });
    const cartonsOf = (O) => { const c = []; for (const l of O.lines) for (let k = 0; k < l.qty; k++) c.push({ sscc: W.sscc(serial++), line: l.line, qty: 1 }); return c; };
    const n = (O) => O.po.slice(3);
    const start = (O, ackAt, dep) => { D.po(L, O, O.r); D.ack(L, O, ackAt); const cartons = cartonsOf(O);
      ev(ackAt, 'erp.shipment_planned', O.po, ...ERP, { shipment: `SHP-${n(O)}`, planned_departure: iso(dep), site: O.site, carrier: 'Lakeline Freight', cartons: cartons.length }); return cartons; };
    const finish = (O, cartons, dep, invAt, rcvHm) => {
      D.invoice(L, O, invAt, { ref: `INV-${n(O)}` });
      const rcvAt = et('2026-11-19', rcvHm);
      L.event({ at: addH(rcvAt, -0.6), kind: 'carrier.delivery_receipt', po: O.po, system: 'Lakeline Freight', party: 'LAKELINE', channel: 'Portal API, image', data: { shipment: `SHP-${n(O)}`, delivered: cartons.length, exceptions: 'None', seal: 'Intact' } });
      D.receipt(L, O, rcvAt, { ref: `RCV-${n(O)}`, asnRef: `ASN-${n(O)}`, qty: Object.fromEntries(O.lines.map((l) => [l.line, l.qty])) });
    };
    const asnBase = (O, cartons, dep) => ({ ref: `ASN-${n(O)}`, shippedAt: dep, deliveryDate: O.requested, cartons, qty: Object.fromEntries(O.lines.map((l) => [l.line, l.qty])) });

    // (a) Supplier ERP fulfilment posted and Kinross's load scan present, no departure scan: the ship notice is held.
    {
      const O = order(P13_ORDERS.held, 'KIN-JOL', [['ASH-MUG-12', 18]], et('2026-11-17', '11:30')); const dep = et('2026-11-18', '15:00');
      const cartons = start(O, et('2026-11-17', '13:05'), dep);
      D.whOrder(L, O, et('2026-11-17', '15:30'), `WSO-${n(O)}`, { shipDate: etDay(dep) });
      ev(et('2026-11-18', '07:50'), 'erp.fulfilment_posted', O.po, ...ERP, { shipment: `SHP-${n(O)}`, cartons: cartons.length });
      ev(et('2026-11-18', '07:58'), 'wms.load_scan', O.po, ...KIN, { shipment: `SHP-${n(O)}`, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true, trailer_state: 'At door 3, not departed' });
      // An hour after the fulfilment posting with no departure scan, Trading Grid holds the ship notice (NF-4.2: it follows the departure).
      ev(et('2026-11-18', '08:50'), 'tg.hold', O.po, ...TG, { document: `ASN-${n(O)} draft`, state: 'Held', rule: 'NF-4.2', finding: 'Supplier ERP fulfilment posted at 07:50; Kinross load scan at 07:58 shows the trailer at door 3, not departed; no departure scan',
        owner: 'Kinross Logistics', fix_in: 'Kinross warehouse system', closes_on: 'Kinross departure scan' });
      ev(dep, 'wms.departure_scan', O.po, ...KIN, { shipment: `SHP-${n(O)}`, carrier: 'Lakeline Freight' });
      D.whAdvice(L, O, addH(dep, 0.17), `WSA-${n(O)}`, { shipmentId: `SHP-${n(O)}`, shippedAt: dep });
      ev(addH(dep, 0.23), 'tg.release', O.po, ...TG, { document: `ASN-${n(O)}`, state: 'Released', rule: 'AP-1.3', released_by: 'Priya Raman', basis: 'Kinross departure scan at 15:00 and warehouse shipping advice' });
      D.asn(L, O, addH(dep, 0.27), asnBase(O, cartons, dep));
      finish(O, cartons, dep, addH(dep, 1.5), '07:40');
    }

    // (b) A ship notice rejected on an 824 for a substitute item (NF-4.11), answered by Ashby's 997, not yet corrected at 09:00.
    {
      const O = order(P13_ORDERS.rejected, 'ASH-WH1', [['ASH-MUG-12', 14], ['ASH-HNY-340', 6]], et('2026-11-17', '11:40')); const dep = et('2026-11-18', '08:00');
      const cartons = start(O, et('2026-11-17', '13:20'), dep);
      ev(et('2026-11-18', '07:33'), 'wms.load_scan', O.po, ...ERP, { shipment: `SHP-${n(O)}`, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true });
      ev(et('2026-11-18', '07:35'), 'erp.fulfilment_posted', O.po, ...ERP, { shipment: `SHP-${n(O)}`, cartons: cartons.length });
      ev(dep, 'wms.departure_scan', O.po, ...ERP, { shipment: `SHP-${n(O)}`, carrier: 'Lakeline Freight' });
      const base = asnBase(O, cartons, dep); const asnAt = et('2026-11-18', '08:12'); const sub = ITEM['ASH-MUG-16'];
      const asn = D.asn(L, O, asnAt, { ...base, lines: O.lines.map((l) => (l.sku === 'ASH-MUG-12' ? { line: l.line, sku: 'ASH-MUG-16', qty: l.qty, price: sub.case_price, nf_item: '448190', gtin: sub.gtin } : { line: l.line, sku: l.sku, qty: l.qty })) });
      ev(asnAt, 'erp.substitution', O.po, ...ERP, { line: 1, ordered: 'ASH-MUG-12', shipped_as: 'ASH-MUG-16', note: 'Supplier ERP substituted ASH-MUG-16 (Northfield item 448190), which is not on Ashby’s Northfield item list' });
      D.advice(L, asn, et('2026-11-18', '08:20'), { action: 'TR', errors: [{ code: 'IID', cause: TED.IID.cause, seg: 'LIN', elem: 3, bad: '448190', allowed: 'Items on Ashby’s Northfield item list' }] });
      ev(et('2026-11-18', '10:35'), 'approval', O.po, ...TG, { approved_by: 'Priya Raman', what: `Corrected ship notice ASN-${n(O)}: line 1 ASH-MUG-12, 14 cases, as loaded` });
      D.asn(L, O, et('2026-11-18', '10:40'), { ...base, resend: true });
      finish(O, cartons, dep, et('2026-11-18', '09:10'), '07:20');
    }

    // (c) A Kinross order where Kinross's system does not answer the status read: warehouse status Unknown, nothing drafted.
    {
      const O = order(P13_ORDERS.silent, 'KIN-GRV', [['ASH-HNY-340', 10]], et('2026-11-17', '09:10')); const dep = et('2026-11-18', '15:00');
      const cartons = start(O, et('2026-11-17', '10:20'), dep);
      D.whOrder(L, O, et('2026-11-17', '11:00'), `WSO-${n(O)}`, { shipDate: etDay(dep) });
      ev(et('2026-11-18', '08:58'), 'tg.status_read', O.po, ...TG, { read: 'Warehouse order status', target: 'Kinross warehouse system', warehouse_order: `WSO-${n(O)}`, response: 'No response', attempts: 3, warehouse_status: 'Unknown', drafted: 'Nothing' });
      ev(et('2026-11-18', '14:33'), 'wms.load_scan', O.po, ...KIN, { shipment: `SHP-${n(O)}`, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true });
      ev(et('2026-11-18', '14:40'), 'erp.fulfilment_posted', O.po, ...ERP, { shipment: `SHP-${n(O)}`, cartons: cartons.length });
      ev(dep, 'wms.departure_scan', O.po, ...KIN, { shipment: `SHP-${n(O)}`, carrier: 'Lakeline Freight' });
      D.whAdvice(L, O, addH(dep, 0.23), `WSA-${n(O)}`, { shipmentId: `SHP-${n(O)}`, shippedAt: dep });
      D.asn(L, O, addH(dep, 0.37), asnBase(O, cartons, dep));
      finish(O, cartons, dep, addH(dep, 1.67), '08:10');
    }
  }

  // ---------- 4. P20: the three disputed promotion deductions, decided and repaid ----------
  {
    const pay = L.docs.find((d) => d.type === '820' && d.ref === 'PMT-990168'); if (!pay) throw new Error('records: remittance PMT-990168 is not in the world');
    const rate = (deal) => { const a = L.docs.find((d) => d.type === '889' && d.ref === deal); if (!a) throw new Error(`records: no promotion announcement ${deal}`); return a.lines[0].rate; };
    const taken = (ref) => { for (const i of pay.items) for (const a of i.adjustments) if (a.ref === ref) return { i, a, c: parseClaim({ note: a.note, amount: a.amount }) }; throw new Error(`records: ${ref} is not on PMT-990168`); };
    const cases = [
      { ref: 'PD-2701-04', why: (c) => `Claimed at $${c.rate.toFixed(2)} a case; the promotion announcement agrees $${rate(c.deal_id).toFixed(2)}`, match: 'Rate above the deal',
        unsupported: (c) => r2(c.amount - r2(c.qty * rate(c.deal_id))), evidence: (c) => [`Promotion announcement (889) ${c.deal_id}: $${rate(c.deal_id).toFixed(2)} a case`, `Ship notices (856): ${c.qty.toLocaleString('en-US')} cases shipped ${c.from} to ${c.to}`] },
      { ref: 'PD-2701-02', why: (c) => `No store activity report (852) covers ${c.from} to ${c.to}`, match: 'No store activity report for the claimed period',
        unsupported: (c) => c.amount, evidence: (c) => [`Promotion announcement (889) ${c.deal_id}`, `Store activity (852): no report for ${c.from} to ${c.to}`] },
      { ref: 'PD-2701-05', why: () => 'The order was placed outside the deal’s order window, February 2027', match: 'Outside the deal’s order window',
        unsupported: (c) => c.amount, evidence: (c, x) => [`Promotion announcement (889) ${c.deal_id}: orders in February 2027`, `Invoice (810) ${x.i.invoice} for order ${x.i.po}`] },
    ];
    const paidAt = new Date(pay.at); const items = []; let total = 0;
    cases.forEach((k, idx) => {
      const x = taken(k.ref); const c = x.c; const id = P20_CASES[k.ref]; const amount = k.unsupported(c); total = r2(total + amount);
      ev(paidAt, 'case.opened', x.i.po, ...CASE, 'NORTHFIELD', { case: id, charge: 'PROMO', kind: 'Promotion deduction', amount: c.amount, deduction: k.ref, deal: c.deal_id, payment: pay.ref, invoice: x.i.invoice, dispute_deadline: etDay(addD(paidAt, 60)) });
      ev(et('2027-01-06', ['09:20', '09:28', '09:36'][idx]), 'case.dispute', x.i.po, ...CASE, 'ASHBY', { case: id, charge: 'PROMO', amount, deduction: k.ref, deal: c.deal_id, stands: r2(c.amount - amount), vividly_match: k.match,
        evidence: k.evidence(c, x), drafted_by: 'Ashby’s promotion deduction rules', approved_by: 'Priya Raman' });
      ev(et('2027-01-07', ['10:00', '10:10', '10:20'][idx]), 'case.decision', x.i.po, ...CASE, 'NORTHFIELD', { case: id, charge: 'PROMO', amount, deduction: k.ref, decision: 'Reversed', decided_by: 'Jordan Ellis', reason: k.why(c),
        reviewer_note: `${k.why(c)}. Reverse $${amount.toFixed(2)}${c.amount > amount ? `; $${r2(c.amount - amount).toFixed(2)} stands` : ''}.` });
      items.push({ invoice: x.i.invoice, po: x.i.po, paid: amount, invoice_amount: 0, adjustments: [{ amount, reason: x.a.reason, ref: k.ref, note: `Reversal of promotion deduction ${k.ref}, case ${id}` }] });
      ev(et('2027-01-08', '09:00'), 'erp.receivables_match', x.i.po, ...ERP, { payment: P20_REPAYMENT, matched_to: k.ref, case: id, amount });
    });
    if (total !== 677.2) throw new Error(`records: the three disputed promotion amounts add to ${total}, expected 677.20`);
    // NF-7.6: repaid on the next remittance after the decision. A reversal-only remittance the afternoon of 7 January,
    // after Jordan Ellis's decisions and before the 8 January payment run (PMT-990170).
    L.doc({ type: '820', from: 'NORTHFIELD', to: 'ASHBY', at: et('2027-01-07', '16:00'), ref: P20_REPAYMENT, amount: total, payer_name: NF.name, payer_gln: NF.gln, payee_name: ASH.name, payee_gln: ASH.gln, items });
  }
  // ---------- 5. Other suppliers' buyer orders: the ship notices and receiving advice that were missing ----------
  // 37 orders from 17 suppliers were past their delivery dates with neither (P24, P7). Last, so nothing above moves.
  buyerShipments(L, W);
}

export default {
  id: 'records',
  docs: {},
  origins: [],
  generate,
};
