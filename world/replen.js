// Replenishment orders: Northfield's daily DC orders to Ashby (five-digit PO numbers).
// Includes the records behind P10 (17 Nov 11:00) and P13 (18 Nov 09:00), each resolved later the same day.
import { rng, et, addH, addD, etDay } from './lib.js';
import { D, iso } from './log.js';
import { ITEM, QUARTER } from './ref.js';

export const CLOCK10 = et('2026-11-17', '11:00');
export const CLOCK13 = et('2026-11-18', '09:00');
const CORE = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'];
const GLN_CLOSED = '0614141001996';

/** First 15:00 or 18:00 Eastern truck at or after a time. */
function truckSlot(after) {
  for (let k = 0; k < 8; k++) { const day = etDay(addD(after, k)); for (const hm of ['15:00', '18:00']) { const t = et(day, hm); if (t >= after) return t; } }
  throw new Error('no truck slot');
}

export function replen(L, W, { nPre, jitter = 0 }) {
  const R = rng(20261117 + jitter); const U = (a, b) => a + (b - a) * R(); const pick = (a) => a[Math.floor(R() * a.length)];
  const START = et(QUARTER.start, '06:00'); const END = et(QUARTER.end, '20:00');
  const sp = {}; const S = (n, o) => { sp[n] = o; };
  const D0 = '2026-11-17';
  const day = (off, hm) => et(etDay(addD(et(D0, '12:00'), off)), hm);
  // Six-PO escalation: NR-46101 to NR-46110 shipped 13 Nov for 14 Nov. NR-46108 left a day late.
  for (let k = 0; k < 10; k++) { const n = 46101 + k; S(n, { r: addH(day(-6, '08:00'), k * 1.2), dep: day(-4, k % 2 ? '18:00' : '15:00'), late: n === 46108 ? 24 : 0, rcvHm: n === 46108 ? '09:40' : `0${7 + (k % 3)}:${['10', '35', '50'][k % 3]}`, site: 'ASH-WH1', shipTo: 'DC2' }); }
  // Supplier ERP adds a release suffix to the PO reference on orders released a second time.
  S(46118, { r: day(-5, '10:00'), dep: day(-3, '15:00'), poref: 'asn', site: 'ASH-WH1' });
  S(46124, { r: day(-5, '14:00'), dep: day(-3, '18:00'), poref: 'asn', site: 'ASH-WH1' });
  S(46129, { r: day(-4, '09:00'), dep: day(-2, '15:00'), poref: 'asn', site: 'ASH-WH1' });
  S(46133, { r: day(-3, '09:30'), dep: day(-1, '11:00'), poref: 'inv', invAt: day(-1, '11:40'), fixAt: day(0, '15:00'), site: 'ASH-WH1' });
  // P10 attention at 11:00.
  S(46142, { r: day(-1, '16:00'), ackAt: day(0, '13:00'), dep: day(1, '18:00'), site: 'ASH-WH1' });
  S(46151, { r: day(-1, '17:00'), dep: day(0, '10:40'), asnAt: day(0, '11:25'), site: 'ASH-WH1', shipTo: 'DC2' });
  S(46156, { r: day(-1, '18:00'), dep: day(0, '10:05'), substitute: true, asnAt: day(0, '10:12'), fixAt: day(0, '12:10'), site: 'ASH-WH1', shipTo: 'DC2', mug: true });
  // P13 queue at 09:00 on 18 Nov.
  S(46210, { r: day(0, '13:00'), ackAt: day(1, '09:20'), site: 'ASH-WH1', lines: [['ASH-MUG-12', 12], ['ASH-NAP-4', 4]] });
  S(46215, { r: day(-2, '10:00'), dep: day(0, '18:00'), asnAt: day(1, '09:30'), invAt: day(0, '18:30'), site: 'ASH-WH1', shipTo: 'DC2', lines: [['ASH-HNY-340', 6]] });
  S(46220, { r: day(-2, '15:00'), site: 'KIN-GRV', whAt: day(-1, '21:00'), dep: day(0, '18:00'), late: 17, whAdviceAt: day(1, '11:40'), shipTo: 'DC2', lines: [['ASH-MUG-12', 20]] });
  S(46226, { r: day(-3, '09:00'), dep: day(0, '09:00'), asnAt: day(0, '09:20'), invAt: day(1, '09:45'), site: 'ASH-WH1', shipTo: 'DC2', lines: [['ASH-NAP-4', 8], ['ASH-HNY-340', 4]] });
  S(46231, { r: day(-1, '09:00'), site: 'ASH-WH1', change: { at: day(0, '11:30'), ackAt: day(0, '15:00') }, lines: [['ASH-MUG-12', 15]] });
  // Watch Agent's conflict record: Supplier ERP says shipped, Kinross has not departed (19 Nov).
  S(46302, { r: day(0, '14:00'), site: 'KIN-JOL', dep: day(2, '18:00'), erpEarly: day(2, '14:10'), asnAt: day(2, '18:20'), shipTo: 'DC2', lines: [['ASH-MUG-12', 10]] });

  // ---------- arrival times ----------
  const arrivals = [];
  const preEnd = addH(CLOCK10, -1.5); const FIRST = 46157 - nPre + 1; const step = (preEnd - START) / nPre;
  for (let i = 0; i < nPre; i++) arrivals.push({ n: FIRST + i, r: new Date(START.getTime() + (i + 0.5) * step + U(-0.4, 0.4) * 3600000) });
  const rate = nPre / ((preEnd - START) / 86400000);
  let n = 46158; const taken = new Set(Object.keys(sp).map(Number));
  for (let d = et(etDay(CLOCK10), '12:00'); d <= END; d = addD(d, 1)) {
    const ds = etDay(d);
    const k = ds >= '2026-12-06' && ds <= '2026-12-12' ? 62 : (ds >= '2026-11-29' && ds <= '2026-12-19') ? 30 : Math.round(rate + U(-1.5, 1.5));
    const from = ds === etDay(CLOCK10) ? 11.2 : 6;
    for (let j = 0; j < k * (20 - from) / 14; j++) { while (taken.has(n)) n++; arrivals.push({ n: n++, r: new Date(et(ds, '00:00').getTime() + U(from, 20) * 3600000) }); }
  }
  for (const k of Object.keys(sp).map(Number)) if (!arrivals.some((a) => a.n === k)) arrivals.push({ n: k, r: sp[k].r });
  arrivals.sort((a, b) => a.n - b.n);

  // ---------- orders and their documents ----------
  const life = [];
  for (const a of arrivals) {
    const s = sp[a.n] || {}; const po = `NR-${a.n}`; const r = s.r || a.r;
    const nl = 1 + Math.floor(R() * 3);
    let skus = [...CORE].sort(() => R() - 0.5).slice(0, nl).sort();
    if (s.mug && !skus.includes('ASH-MUG-12')) skus[0] = 'ASH-MUG-12';
    let lines = skus.map((sku, j) => ({ line: j + 1, sku, qty: 2 + Math.floor(R() * 19), price: ITEM[sku].case_price }));
    if (s.lines) lines = s.lines.map(([sku, qty], j) => ({ line: j + 1, sku, qty, price: ITEM[sku].case_price }));
    const siteRoll = R(); const site = s.site || (siteRoll < 0.4 ? 'ASH-WH1' : siteRoll < 0.7 ? 'KIN-GRV' : 'KIN-JOL');
    const shipTo = s.shipTo || (R() < 0.3 ? 'DC4' : 'DC2');
    const ackAt = s.ackAt || addH(r, sp[a.n] ? 2 : U(0.5, 4));
    const dep = s.dep || truckSlot(addH(r, 40));
    const departed = addH(dep, s.late || 0);
    const O = { po, n: a.n, supplier: 'ASHBY', shipTo, site, lines, requested: etDay(addD(dep, 1)), poDate: iso(r), r, ackAt, dep, departed, s, stream: 'replenishment' };
    life.push(O);
  }
  W.replen = life;
  return { R, U, pick, life, sp, truckSlot, GLN_CLOSED };
}

/** Writes each replenishment order's documents. Called after quantities are final. */
export function replenDocs(L, W, G) {
  const { U, life } = G; const R = G.R;
  let serial = 100000;
  const sscc = W.sscc;
  // Planned failures: 41 inside the 30 days before P10's clock, and a thin scatter elsewhere.
  const winStart = addD(CLOCK10, -30);
  const normal = life.filter((O) => !G.sp[O.n]);
  const inWin = normal.filter((O) => O.departed > addH(winStart, 8) && O.departed < addH(CLOCK10, -30));
  const out = normal.filter((O) => !O.pattern && (O.departed < addH(winStart, -80) || O.r > addD(CLOCK10, 1)) && O.departed < et(QUARTER.end, '12:00'));
  const used = new Set(); const take = (pool) => { let O; do { O = pool[Math.floor(R() * pool.length)]; } while (used.has(O.n)); used.add(O.n); return O; };
  const plan = [
    ...Array(6).fill(['asn', 'IID']), ...Array(4).fill(['inv', 'IID']), ...Array(6).fill(['asn', 'LOC']),
    ...Array(3).fill(['asn', 'CTN']), ...Array(3).fill(['inv', 'TOT']), ...Array(3).fill(['asn', 'UOM']), ...Array(3).fill(['asn', 'DTE']),
    ['ack', 'missing_segment'], ['ack', 'missing_segment'], ['asn', 'invalid_date'], ['asn', 'invalid_date'], ['asn', 'se_count'], ['inv', 'se_count'], ['asn', 'too_long'], ['asn', 'too_long'],
  ];
  const failOf = new Map();
  for (const f of plan) failOf.set(take(inWin).n, f);
  for (let i = 0; i < Math.floor(out.length / 85); i++) failOf.set(take(out).n, plan[(i * 7) % plan.length]);
  W.plannedFailures = { window: plan.length, scatter: Math.floor(out.length / 85) };

  const reject824 = (target, code, { seg, elem, bad, allowed }, at) => D.advice(L, target, at, { action: 'TR', errors: [{ code, cause: W.TED[code].cause, seg, elem, bad, allowed }] });

  for (const O of life) {
    const s = O.s; const fail = failOf.get(O.n); const id = O.n;
    const p850 = D.po(L, O, O.r); O.docs = { po: p850 };
    const isKin = O.site.startsWith('KIN');
    // P13: no acknowledgment until Priya approves the draft.
    const ackFault = fail && fail[0] === 'ack' ? fail[1] : null;
    let ship = Object.fromEntries(O.lines.map((l) => [l.line, O.shipQty?.[l.line] ?? l.qty]));
    const ackOpt = O.allocCut ? { codes: Object.fromEntries(O.lines.map((l) => [l.line, ship[l.line] < l.qty ? 'IQ' : 'IA'])), qty: ship } : {};
    const ack = D.ack(L, O, O.ackAt, ackOpt); if (ackFault) { ack.fault = ackFault; D.ack(L, O, addH(O.ackAt, U(0.5, 1.2)), ackOpt); }
    if (s.change) {
      D.change(L, O, s.change.at, 1, [{ line: 1, code: 'QD', qty: 12, qty_left: 12 }]);
      D.changeAck(L, O, s.change.ackAt, 1, `CHA-${id}`, [{ line: 1, code: 'IA', qty: 12 }]);
      O.lines[0] = { ...O.lines[0], qty: 12 }; O.changed = true;
    }
    if (s.change) ship = Object.fromEntries(O.lines.map((l) => [l.line, l.qty]));
    if (!O.dep) continue;
    const cartons = []; for (const l of O.lines) for (let k = 0; k < ship[l.line]; k++) cartons.push({ sscc: sscc(serial++), line: l.line, qty: 1 });
    if (O.pattern === 'A') L.event({ at: addH(O.departed, -3), kind: 'wms.short_pick', po: O.po, system: 'Kinross warehouse system', party: 'KINROSS', channel: 'API', data: { line: 1, sku: O.lines[0].sku, ordered: O.lines[0].qty, picked: ship[1], site: O.site, note: 'Stock below the available-to-promise figure; remainder cancelled' } });
    if (O.pattern === 'C') L.event({ at: O.dep, kind: 'carrier.pickup_missed', po: O.po, system: 'Lakeline Freight', party: 'LAKELINE', channel: 'Scanned document', data: { assigned_pickup: iso(O.dep), note: 'Collect freight not ready at the assigned pickup' } });
    if (O.pattern === 'D') L.event({ at: O.ackAt, kind: 'erp.allocation', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { line: 1, ordered: O.lines[0].qty, allocated: ship[1], policy: 'Peak allocation policy' } });
    const shipId = `SHP-${id}`; const asnRef = `ASN-${id}`;
    L.event({ at: O.ackAt, kind: 'erp.shipment_planned', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { shipment: shipId, planned_departure: iso(O.dep), site: O.site, carrier: 'Lakeline Freight', cartons: cartons.length } });
    if (isKin) {
      const whAt = s.whAt || addH(O.dep, -U(6, 20));
      D.whOrder(L, O, whAt, `WSO-${id}`, { shipDate: etDay(O.dep) });
      if (s.whAdviceAt) D.whAdvice(L, O, s.whAdviceAt, `WSA-${id}`, { shipmentId: shipId, shippedAt: O.departed });
    }
    const fulfilAt = s.erpEarly || addH(O.departed, -U(0.2, 0.8));
    L.event({ at: fulfilAt, kind: 'erp.fulfilment_posted', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { shipment: shipId, cartons: cartons.length } });
    if (!O.noLoadScan) L.event({ at: addH(O.departed, -0.45), kind: 'wms.load_scan', po: O.po, system: isKin ? 'Kinross warehouse system' : 'Supplier ERP', party: isKin ? 'KINROSS' : 'ASHBY', channel: 'API', data: { shipment: shipId, cartons_loaded: cartons.length, cartons_expected: cartons.length, by_sscc: true } });
    L.event({ at: O.departed, kind: 'wms.departure_scan', po: O.po, system: isKin ? 'Kinross warehouse system' : 'Supplier ERP', party: isKin ? 'KINROSS' : 'ASHBY', channel: 'API', data: { shipment: shipId, carrier: 'Lakeline Freight' } });
    if (isKin && !s.whAdviceAt) D.whAdvice(L, O, addH(O.departed, U(0.1, 0.5)), `WSA-${id}`, { shipmentId: shipId, shippedAt: O.departed });

    // Ship notice: within 1 hour of departure (NF-4.2).
    const asnAt = s.asnAt || addH(O.departed, U(0.05, 0.7));
    const base = { ref: asnRef, shippedAt: O.departed, deliveryDate: O.requested, cartons, qty: ship };
    let asn;
    const asnFail = fail && fail[0] === 'asn' ? fail[1] : null;
    if (s.substitute || asnFail === 'IID') {
      const l1 = O.lines.find((l) => l.sku === 'ASH-MUG-12') || O.lines[0];
      const sub = O.lines.map((l) => (l === l1 ? { line: l.line, sku: 'ASH-MUG-16', qty: ship[l.line], price: ITEM['ASH-MUG-16'].case_price, nf_item: '448190', gtin: ITEM['ASH-MUG-16'].gtin } : { line: l.line, sku: l.sku, qty: ship[l.line] }));
      asn = D.asn(L, O, asnAt, { ...base, lines: sub });
      reject824(asn, 'IID', { seg: 'LIN', elem: 3, bad: '448190', allowed: 'Items on Ashby’s Northfield item list' }, addH(asnAt, 8 / 60));
      L.event({ at: asnAt, kind: 'erp.substitution', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { line: l1.line, ordered: l1.sku, shipped_as: 'ASH-MUG-16', note: 'Supplier ERP substituted ASH-MUG-16 (Northfield item 448190), which is not on Ashby’s Northfield item list' } });
      D.asn(L, O, s.fixAt || addH(asnAt, U(0.5, 1.4)), { ...base, resend: true });
    } else if (s.poref === 'asn' || asnFail) {
      const bad = { ...base };
      if (s.poref === 'asn') { bad.poRef = `${O.po}-ASHBY-WHSL-REL-02`; bad.fault = 'po_ref_long'; }
      else if (asnFail === 'LOC') bad.shipToGln = GLN(G);
      else if (asnFail === 'CTN') bad.cartonCount = cartons.length + 1;
      else if (asnFail === 'UOM') bad.lines = O.lines.map((l) => ({ line: l.line, sku: l.sku, qty: ship[l.line], uom: 'EA' }));
      else if (asnFail === 'DTE') bad.deliveryDate = etDay(addD(O.departed, -1));
      else bad.fault = asnFail;
      asn = D.asn(L, O, asnAt, bad);
      if (asnFail === 'LOC') reject824(asn, 'LOC', { seg: 'N1', elem: 4, bad: G.GLN_CLOSED, allowed: 'An active Northfield location GLN' }, addH(asnAt, 0.25));
      if (asnFail === 'CTN') reject824(asn, 'CTN', { seg: 'TD1', elem: 2, bad: String(cartons.length + 1), allowed: `${cartons.length} cartons listed` }, addH(asnAt, 0.25));
      if (asnFail === 'UOM') reject824(asn, 'UOM', { seg: 'SN1', elem: 3, bad: 'EA', allowed: 'CA' }, addH(asnAt, 0.25));
      if (asnFail === 'DTE') reject824(asn, 'DTE', { seg: 'DTM', elem: 2, bad: bad.deliveryDate, allowed: 'Delivery date on or after the ship date' }, addH(asnAt, 0.25));
      if (s.poref === 'asn') L.event({ at: asnAt, kind: 'erp.setting', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { setting: 'Release suffix on re-released orders', value: '-ASHBY-WHSL-REL-02', note: 'Supplier ERP adds the release suffix to the PO number on orders released a second time. Each document was corrected and resent by hand; the setting is unchanged.' } });
      D.asn(L, O, addH(asnAt, U(0.6, 1.3)), { ...base, resend: true });
    } else asn = D.asn(L, O, asnAt, base);
    if (asnAt > addH(O.departed, 1)) L.event({ at: asnAt, kind: 'tg.late_document', po: O.po, system: 'Trading Grid', party: 'ASHBY', channel: 'API', data: { document: asnRef, rule: 'NF-4.2', state: 'Late' } });

    // Invoice: Supplier ERP sends it after departure.
    const invAt = s.invAt || addH(O.departed, U(0.5, 2)); const invRef = `INV-${id}`;
    const invFail = fail && fail[0] === 'inv' ? fail[1] : null;
    if (s.poref === 'inv') {
      D.invoice(L, O, invAt, { ref: invRef, qty: ship, poRef: `${O.po}-ASHBY-WHSL-REL-02`, fault: 'po_ref_long' });
      L.event({ at: invAt, kind: 'erp.setting', po: O.po, system: 'Supplier ERP', party: 'ASHBY', channel: 'API', data: { setting: 'Release suffix on re-released orders', value: '-ASHBY-WHSL-REL-02', note: 'Same Supplier ERP setting as ASN-46118: the release suffix is added to the PO number on orders released a second time.' } });
      D.invoice(L, O, s.fixAt, { ref: invRef, qty: ship });
    } else if (invFail === 'IID') {
      const l1 = O.lines[0];
      const inv = D.invoice(L, O, invAt, { ref: invRef, qty: ship, items: { [l1.line]: { sku: 'ASH-MUG-16', nf_item: '448190', gtin: ITEM['ASH-MUG-16'].gtin, price: l1.price } } });
      reject824(inv, 'IID', { seg: 'IT1', elem: 7, bad: '448190', allowed: 'Items on Ashby’s Northfield item list' }, addH(invAt, 0.25));
      D.invoice(L, O, addH(invAt, U(0.6, 1.4)), { ref: invRef, qty: ship });
    } else if (invFail === 'TOT') {
      const inv = D.invoice(L, O, invAt, { ref: invRef, qty: ship }); inv.total = Math.round((inv.total + 10) * 100) / 100;
      reject824(inv, 'TOT', { seg: 'TDS', elem: 1, bad: String(Math.round(inv.total * 100)), allowed: 'The sum of the line amounts' }, addH(invAt, 0.25));
      D.invoice(L, O, addH(invAt, U(0.6, 1.4)), { ref: invRef, qty: ship });
    } else if (invFail) {
      D.invoice(L, O, invAt, { ref: invRef, qty: ship, fault: invFail }); D.invoice(L, O, addH(invAt, U(0.6, 1.4)), { ref: invRef, qty: ship });
    } else D.invoice(L, O, invAt, { ref: invRef, qty: ship });
    O.invAt = invAt; O.invRef = invRef; O.invTotal = Math.round(O.lines.reduce((a, l) => a + ship[l.line] * l.price, 0) * 100) / 100;

    // Receipt at the DC the morning after departure.
    const rcvDay = etDay(addD(O.departed, 1));
    const rcvAt = et(rcvDay, s.rcvHm || (O.pattern === 'E' ? '16:40' : `0${7 + Math.floor(R() * 3)}:${String(Math.floor(R() * 6) * 10).padStart(2, '0')}`));
    const qty = { ...ship }; const short = {}; const ns = {};
    for (const k of Object.keys(qty)) if (!qty[k]) delete qty[k];
    if (O.shortRcv) { const l = O.lines[0]; qty[l.line] = ship[l.line] - O.shortRcv; short[l.line] = O.shortRcv; ns[l.line] = cartons.filter((c) => c.line === l.line).slice(-O.shortRcv).map((c) => c.sscc); }
    L.event({ at: addH(rcvAt, -0.6), kind: 'carrier.delivery_receipt', po: O.po, system: 'Lakeline Freight', party: 'LAKELINE', channel: 'Scanned document', data: { shipment: shipId, delivered: cartons.length, exceptions: 'None', seal: 'Intact' } });
    D.receipt(L, O, rcvAt, { ref: `RCV-${id}`, asnRef, qty, short, notScanned: ns });
    O.rcvAt = rcvAt; O.cartons = cartons;
  }
}
const GLN = (G) => G.GLN_CLOSED;
