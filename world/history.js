// History before the current period (Phase 1 change list 1, section B): Northfield's quarter of 29 March to 27 June 2026,
// closed. Every order is received, acknowledged, shipped, received, invoiced and paid, and every deduction case decided,
// before anything the current period reads. Generated from one seed; nothing here is written by hand.
//
// The lead signal is produced by a cause, not a label: each site carries a backlog figure per week, and the backlog
// drives both how long Ashby takes to acknowledge an order and how likely its ship notice is to go out late (NF-4.2).
import { rng, et, addH, addD, etDay } from './lib.js';
import { D, iso } from './log.js';
import { ITEM, PARTY } from './ref.js';

export const HISTORY = { start: '2026-03-29', end: '2026-06-27', lastOrder: '2026-06-12', settledBy: '2026-08-07' };
const CORE = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'];
const money = (n) => Math.round(n * 100) / 100;
function truckSlot(after) { for (let k = 0; k < 8; k++) { const day = etDay(addD(after, k)); for (const hm of ['15:00', '18:00']) { const t = et(day, hm); if (t >= after) return t; } } throw new Error('no truck slot'); }

export function history(L, W, { ashbyOrders = 300, otherOrders = 150 } = {}) {
  const R = rng(20260329); const U = (a, b) => a + (b - a) * R(); const pick = (a) => a[Math.floor(R() * a.length)];
  const START = et(HISTORY.start, '06:00'), LAST = et(HISTORY.lastOrder, '18:00'); const WEEK = 7 * 24 * 3600000;
  const weeks = Math.ceil((LAST - START) / WEEK);
  // Backlog per site and week, 0 (clear) to 1 (heavy). Kinross sites have a few heavy weeks; Ashby's own warehouse stays light.
  const backlog = { 'ASH-WH1': [], 'KIN-GRV': [], 'KIN-JOL': [] };
  for (let w = 0; w < weeks; w++) { backlog['ASH-WH1'].push(U(0, 0.18)); backlog['KIN-GRV'].push(R() < 0.25 ? U(0.6, 1) : U(0.05, 0.35)); backlog['KIN-JOL'].push(R() < 0.3 ? U(0.6, 1) : U(0.05, 0.4)); }
  const ev = (at, kind, po, system, party, channel, data) => L.event({ at, kind, po, system, party, channel, data });
  const payDays = new Map(); const pay = (at, item) => { const k = etDay(at); (payDays.get(k) || payDays.set(k, []).get(k)).push(item); };
  const stats = { ashby: 0, late: 0, cases: 0, other: 0, otherCases: 0, sealCluster: 0 };
  let serial = 7000000, caseNo = 30001, dmNo = 41001;

  // ---------- Ashby: about 23 orders a week ----------
  const cases = [];
  for (let i = 0; i < ashbyOrders; i++) {
    const r = new Date(START.getTime() + (i + 0.5) * (LAST - START) / ashbyOrders + U(-3, 3) * 3600000);
    const n = 41001 + i; const po = `NR-${n}`; const w = Math.min(weeks - 1, Math.floor((r - START) / WEEK));
    const roll = R(); const site = roll < 0.4 ? 'ASH-WH1' : roll < 0.7 ? 'KIN-GRV' : 'KIN-JOL'; const b = backlog[site][w]; const isKin = site.startsWith('KIN');
    const skus = [...CORE].sort(() => R() - 0.5).slice(0, 1 + Math.floor(R() * 3)).sort();
    const lines = skus.map((sku, j) => ({ line: j + 1, sku, qty: 3 + Math.floor(R() * 18), price: ITEM[sku].case_price }));
    const ackAt = addH(r, Math.min(23, 0.6 + 20 * b * U(0.7, 1.1) + U(0, 1.5)));
    const dep = truckSlot(addH(r, 40)); const late = R() < 0.03 + 0.75 * b * b;
    const asnAt = addH(dep, (late ? U(65, 170) : U(3, 40)) / 60);
    const O = { po, supplier: 'ASHBY', shipTo: R() < 0.3 ? 'DC4' : 'DC2', site, lines, requested: etDay(addD(dep, 1)), poDate: iso(r), stream: 'replenishment' };
    D.po(L, O, r); D.ack(L, O, ackAt);
    const ship = Object.fromEntries(lines.map((l) => [l.line, l.qty])); const cartons = [];
    for (const l of lines) for (let k = 0; k < l.qty; k++) cartons.push({ sscc: W.sscc(serial++), line: l.line, qty: 1 });
    const shipId = `SHP-${n}`, asnRef = `ASN-${n}`, invRef = `INV-${n}`; const sys = isKin ? 'Kinross warehouse system' : 'Supplier ERP', who = isKin ? 'KINROSS' : 'ASHBY';
    ev(ackAt, 'erp.shipment_planned', po, 'Supplier ERP', 'ASHBY', 'API', { shipment: shipId, planned_departure: iso(dep), site, carrier: 'Lakeline Freight', cartons: cartons.length, site_backlog: Math.round(b * 100) / 100 });
    // A short receipt becomes a deduction case; what evidence exists decides how it ends.
    const short = lines[0].qty > 4 && R() < 0.085 ? 1 + (R() < 0.25 ? 1 : 0) : 0;
    const c = short ? { case: `DC-${caseNo++}`, dm: `DM-${dmNo++}`, cartons: short, amount: money(short * (lines[0].price + 50)), state: (() => { const x = R(); return x < 0.45 ? 'scan' : x < 0.65 ? 'tally' : x < 0.85 && isKin ? 'held' : 'none'; })() } : null;
    const tag = c ? { in_case: c.case } : {};
    if (!c || c.state === 'scan' || c.state === 'held') ev(addH(dep, -0.45), 'wms.load_scan', po, sys, who, 'API', { shipment: shipId, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true, ...(c && c.state === 'scan' ? tag : {}) });
    if (c && c.state === 'tally') ev(addH(dep, -0.4), 'wms.load_tally', po, sys, who, 'API', { shipment: shipId, cartons_loaded: cartons.length, by_sscc: true, signed: true, ...tag });
    if (c) ev(addH(dep, -0.3), 'carrier.bill_of_lading', po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { bol: `BOL-${n}`, seal: `SL-${n}41`, ...tag });
    ev(dep, 'wms.departure_scan', po, sys, who, 'API', { shipment: shipId, carrier: 'Lakeline Freight' });
    D.asn(L, O, asnAt, { ref: asnRef, shippedAt: dep, deliveryDate: O.requested, cartons, qty: ship });
    if (late) { ev(asnAt, 'tg.late_document', po, 'Trading Grid', 'ASHBY', 'API', { document: asnRef, rule: 'NF-4.2', state: 'Late' }); stats.late++; }
    const invAt = addH(dep, U(0.5, 2)); D.invoice(L, O, invAt, { ref: invRef, qty: ship });
    const total = money(lines.reduce((a, l) => a + l.qty * l.price, 0));
    const rcvAt = et(etDay(addD(dep, 1)), `0${7 + Math.floor(R() * 3)}:${String(Math.floor(R() * 6) * 10).padStart(2, '0')}`);
    ev(addH(rcvAt, -0.6), 'carrier.delivery_receipt', po, 'Lakeline Freight', 'LAKELINE', 'Scanned document', { shipment: shipId, delivered: cartons.length, exceptions: 'None', seal: 'Intact', ...tag });
    const qty = { ...ship }, sh = {}, ns = {};
    if (c) { qty[1] = ship[1] - short; sh[1] = short; ns[1] = cartons.filter((x) => x.line === 1).slice(-short).map((x) => x.sscc); }
    D.receipt(L, O, rcvAt, { ref: `RCV-${n}`, asnRef, qty, short: sh, notScanned: ns });
    const item = { invoice: invRef, po, paid: total, invoice_amount: total, adjustments: [] };
    if (c) { item.paid = money(total - c.amount); item.adjustments = [{ amount: -c.amount, reason: '04', ref: c.dm, note: `SH01 shortage, PO ${po} line 1, ${short} carton${short > 1 ? 's' : ''}, case ${c.case}` }]; cases.push({ ...c, po, rcvAt, invRef }); }
    pay(addD(invAt, 30), item); stats.ashby++;
  }
  // Each case: Northfield opens it, Priya disputes or accepts, Jordan decides (NF-7.7). Evidence in the case wins (NF-7.4, NF-5.3).
  const lastPay = [...payDays.keys()].sort().pop(); const repay = [];
  for (const c of cases) {
    const base = { case: c.case, charge: 'SH01', amount: c.amount }; const nf = (at, kind, party, data) => ev(at, kind, c.po, 'Northfield deduction case', party, 'API', data);
    const opened = addD(c.rcvAt, 7); nf(opened, 'case.opened', 'NORTHFIELD', { ...base, line: 1, cartons: c.cartons, deduction: c.dm, evidence_state: { scan: 'in_case', tally: 'tally_only', held: 'held_by_warehouse', none: 'none' }[c.state] });
    const act = addD(opened, U(3, 8)); const proof = c.state === 'tally' ? 'Load tally by SSCC' : 'Load scan by SSCC';
    let outcome;
    if (c.state === 'scan' || c.state === 'tally' || (c.state === 'held' && R() < 0.5)) {
      if (c.state === 'held') ev(addH(act, -4), 'wms.load_scan', c.po, 'Kinross warehouse system', 'KINROSS', 'API', { shipment: `SHP-${c.po.slice(3)}`, by_sscc: true, shared_by: 'Kinross Logistics', requested_by: 'Priya Raman', in_case: c.case });
      nf(act, 'case.dispute', 'ASHBY', { ...base, approved_by: 'Priya Raman', evidence: ['Bill of lading with seal', 'Proof of delivery', proof] });
      outcome = 'Reversed';
      nf(addD(act, U(2, 6)), 'case.decision', 'NORTHFIELD', { ...base, decision: 'Reversed', decided_by: 'Jordan Ellis', reason: `${proof} shows the carton loaded before the seal (NF-5.3)` });
      repay.push({ c, at: addD(act, 7) });
    } else if (c.state === 'none' && R() < 0.35) {
      nf(act, 'case.dispute', 'ASHBY', { ...base, approved_by: 'Priya Raman', evidence: ['Bill of lading with seal', 'Proof of delivery'] });
      outcome = 'Upheld';
      nf(addD(act, U(2, 6)), 'case.decision', 'NORTHFIELD', { ...base, decision: 'Upheld', decided_by: 'Jordan Ellis', reason: 'No load scan or load tally by SSCC in the case; the receiving count stands (NF-7.4, NF-5.3)' });
    } else { outcome = 'Accepted'; nf(act, 'case.accepted', 'ASHBY', { ...base, approved_by: 'Priya Raman', reason: c.state === 'held' ? 'Written off; the load scan was not requested from the warehouse' : 'Written off; no load scan or load tally exists' }); }
    c.outcome = outcome; stats.cases++;
  }
  for (const { c, at } of repay) { const day = [...payDays.keys()].sort().find((k) => k >= etDay(at)) || lastPay; const items = payDays.get(day); const it = items.reduce((a, b) => (b.paid > a.paid ? b : a)); it.adjustments = [...it.adjustments, { amount: c.amount, reason: '04', ref: c.dm, note: `Reversal of SH01, case ${c.case}` }]; it.paid = money(it.paid + c.amount); }
  let pm = 980001; for (const k of [...payDays.keys()].sort()) D.remit(L, 'ASHBY', et(k, '08:00'), `PMT-${pm++}`, payDays.get(k).sort((a, b) => b.paid - a.paid));

  // ---------- Other suppliers: ten of Northfield's suppliers, with their own shortage cases ----------
  // Among them, a run of Lakeline Freight deliveries into DC 4 whose seal Northfield recorded as broken at arrival (NF-5.2).
  const clusterFrom = et('2026-05-04', '00:00'), clusterTo = et('2026-05-24', '00:00'); let oc = 35001, od = 46001;
  for (let i = 0; i < otherOrders; i++) {
    const s = 1 + (i % 10); const supplier = `SUP${String(s).padStart(2, '0')}`; const sup = PARTY[supplier];
    const r = new Date(START.getTime() + (i + 0.5) * (LAST - START) / otherOrders + U(-6, 6) * 3600000); const po = `NR-${390001 + i}`;
    const lines = Array.from({ length: 1 + Math.floor(R() * 2) }, (_, j) => ({ line: j + 1, k: `H${j + 1}`, sku: `${supplier}-H${j + 1}`, nf_item: `5${String(s).padStart(2, '0')}${800 + j}`, gtin: null, qty: 24 * (1 + Math.floor(R() * 8)), price: money(U(4, 30)), uom: 'EA' }));
    const dep = et(etDay(addD(r, 3 + Math.floor(R() * 4))), pick(['09:00', '13:00', '16:00'])); const rcvAt = et(etDay(addD(dep, 2 + Math.floor(R() * 2))), '08:30');
    const inCluster = rcvAt >= clusterFrom && rcvAt < clusterTo; const shipTo = inCluster && R() < 0.75 ? 'DC4' : (R() < 0.4 ? 'DC4' : 'DC2');
    const O = { po, supplier, shipTo, site: null, programme: 'WHSL', stream: 'buyer', requested: etDay(rcvAt), poDate: iso(r), lines };
    D.po(L, O, r); D.ack(L, O, addH(r, U(6, 60)), { ref: `ACK-${po.slice(3)}` });
    const ship = Object.fromEntries(lines.map((l) => [l.line, l.qty])); const asnRef = `ASN-H${po.slice(3)}`;
    D.asn(L, O, dep, { ref: asnRef, shippedAt: dep, deliveryDate: etDay(rcvAt), lines: lines.map((l) => ({ line: l.line, sku: l.sku, qty: l.qty, uom: 'EA' })), cartonCount: Math.max(1, Math.ceil(lines.reduce((a, l) => a + l.qty, 0) / 24)), shipFrom: { name: sup.name, gln: sup.gln }, scac: 'LKLF', seal: `SL-H${po.slice(5)}` });
    const sealBroken = inCluster && shipTo === 'DC4' && R() < 0.7; const short = sealBroken || R() < 0.09 ? 24 : 0;
    ev(addH(rcvAt, -0.2), 'receiving.seal_check', po, 'Northfield receiving', 'NORTHFIELD', 'API', { receipt: `RCV-H${po.slice(3)}`, carrier: 'Lakeline Freight', seal: sealBroken ? 'Broken at arrival' : 'Intact', rule: 'NF-5.2', location: shipTo === 'DC4' ? 'DC 4' : 'DC 2' });
    const qty = { ...ship }, sh = {}; if (short) { qty[1] = ship[1] - short; sh[1] = short; }
    D.receipt(L, O, rcvAt, { ref: `RCV-H${po.slice(3)}`, asnRef, qty, short: sh });
    const invRef = `INV-H${po.slice(3)}`; D.invoice(L, O, addH(dep, 3), { ref: invRef, qty: ship });
    const total = money(lines.reduce((a, l) => a + l.qty * l.price, 0)); const item = { invoice: invRef, po, paid: total, invoice_amount: total, adjustments: [] };
    if (short) {
      const c = { case: `DC-${oc++}`, dm: `DM-${od++}`, amount: money(short * lines[0].price + 50) }; const base = { case: c.case, charge: 'SH01', amount: c.amount };
      item.paid = money(total - c.amount); item.adjustments = [{ amount: -c.amount, reason: '04', ref: c.dm, note: `SH01 shortage, PO ${po} line 1, case ${c.case}` }];
      const nf = (at, kind, party, data) => ev(at, kind, po, 'Northfield deduction case', party, 'API', data);
      const opened = addD(rcvAt, 7); nf(opened, 'case.opened', 'NORTHFIELD', { ...base, line: 1, units: short, deduction: c.dm, seal_at_arrival: sealBroken ? 'Broken' : 'Intact' });
      const act = addD(opened, U(3, 8)); const hasScan = R() < (sealBroken ? 0.8 : 0.5);
      if (hasScan || sealBroken) {
        nf(act, 'case.dispute', supplier, { ...base, evidence: hasScan ? ['Bill of lading with seal', 'Proof of delivery', 'Load scan by SSCC'] : ['Bill of lading with seal', 'Proof of delivery'] });
        const rev = hasScan; nf(addD(act, U(2, 6)), 'case.decision', 'NORTHFIELD', { ...base, decision: rev ? 'Reversed' : 'Upheld', decided_by: 'Jordan Ellis', reason: rev ? 'Load scan by SSCC shows the units loaded before the seal (NF-5.3)' : 'No load scan or load tally by SSCC in the case; the receiving count stands (NF-7.4, NF-5.3)' });
      } else nf(act, 'case.accepted', supplier, { ...base, reason: 'Not disputed' });
      stats.otherCases++; if (sealBroken) stats.sealCluster++;
    }
    D.remit(L, supplier, et(etDay(addD(dep, 20)), '08:00'), `PMT-H${po.slice(3)}`, [item]); stats.other++;
  }
  W.history = { ...HISTORY, ...stats };
}
