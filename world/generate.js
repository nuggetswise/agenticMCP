// Builds the event log for the quarter: replenishment, buyer orders across Northfield's suppliers, and the named records.
import { et, addH, addD, etDay, sscc } from './lib.js';
import { Log, D, iso } from './log.js';
import { replen, replenDocs, CLOCK10 } from './replen.js';
import { anchors, finishRisks } from './anchors.js';
import { history } from './history.js';
import { variance } from './variance.js';
import { BUYER_FX, buyerSupplierId, PARTY, TED, QUARTER, ITEM } from './ref.js';

export const T8 = '2026-11-08'; // Money in Motion's day 0
const dayAt = (off, hm) => et(etDay(addD(et(T8, '12:00'), off)), hm);
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** The 108 failing lines on Northfield's 13-week scorecard, from the Performance Improvement fixtures (same seed, same order). */
export function scorecardSlots() {
  const rng = (s) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const split = (total, k, r, lo) => { const w = Array.from({ length: k }, () => lo + r()); const sw = w.reduce((a, b) => a + b, 0); const v = w.map((x) => Math.max(1, Math.round((x / sw) * total))); let d = total - v.reduce((a, b) => a + b, 0); for (let i = 0; d !== 0; i = (i + 1) % k) { if (d > 0) { v[i]++; d--; } else if (v[i] > 1) { v[i]--; d++; } } return v; };
  const r = rng(20270405), out = []; let po = 450200;
  const add = (pat, item, site, dc, cases) => { po += 1 + Math.floor(r() * 6); out.push({ pat, proto_po: 'NR-' + po, ln: 1 + Math.floor(r() * 3), item, site, dc, cases }); };
  const A = [['ASH-MUG-12', 'Kinross Joliet', 24], ['ASH-MUG-12', 'Kinross Groveport', 3], ['ASH-NAP-4', 'Kinross Groveport', 2], ['ASH-HNY-340', 'Kinross Joliet', 2]];
  const av = split(1794, 31, r, 0.6); let i = 0; A.forEach(([it, si, k]) => { for (let j = 0; j < k; j++) add('A', it, si, r() < 0.58 ? 'DC 2' : 'DC 4', av[i++]); });
  const bv = split(66, 44, r, 0.2); i = 0; [['DC 4', 31], ['DC 2', 13]].forEach(([dc, k]) => { for (let j = 0; j < k; j++) add('B', ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'][Math.floor(r() * 3)], r() < 0.5 ? 'Kinross Joliet' : 'Kinross Groveport', dc, bv[i++]); });
  [['C', 18, 1260], ['D', 9, 720], ['E', 6, 480]].forEach(([p, k, t]) => { const v = split(t, k, r, 0.7); for (let j = 0; j < k; j++) add(p, ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'][Math.floor(r() * 3)], r() < 0.5 ? 'Kinross Joliet' : 'Kinross Groveport', r() < 0.58 ? 'DC 2' : 'DC 4', v[j]); });
  return out;
}
const SITE = { 'Kinross Joliet': 'KIN-JOL', 'Kinross Groveport': 'KIN-GRV' }; const DCID = { 'DC 2': 'DC2', 'DC 4': 'DC4' };

/** Buyer orders: every open Northfield order across its suppliers on 8 Nov, from the Money in Motion fixtures. */
const asnOwner = new Map(); const asnQty = new Map();
function buyerOrders(L, W) {
  W.buyer = [];
  BUYER_FX.pos.forEach((p, idx) => {
    if (p.id === 'NR-450118') return; // written in full by the order story
    const supplier = buyerSupplierId(p.s); const fx = BUYER_FX.sup[p.s];
    const O = { po: p.id, supplier, shipTo: fx.dsd ? 'STORE114' : (idx % 3 === 0 ? 'DC4' : 'DC2'), site: null, programme: fx.dsd ? 'DSD' : 'WHSL', stream: 'buyer', requested: etDay(dayAt(p.d0 + fx.lead + fx.transit, '12:00')), poDate: iso(dayAt(p.d0, '08:00')),
      lines: p.lines.map((l, i) => ({ line: i + 1, k: l.k, sku: `${supplier}-${l.k}`, nf_item: `5${String(p.s).padStart(2, '0')}${String(idx % 900 + 100)}`, gtin: null, qty: l.q, price: l.p / 100, uom: 'EA' })) };
    W.buyer.push(O);
    const base = 8 * 60 + (idx % 7) * 11; let slot = 0; const t = (d) => dayAt(d, hm(base + 40 * slot++));
    const ln = (k) => O.lines.find((l) => l.k === k);
    D.po(L, O, t(p.d0)); let seq = 0; let lastDay = p.d0;
    for (const e0 of p.ev) {
      // The Money in Motion fixture reuses 18 ship notice numbers across orders; the world keeps each number to one order.
      let e = e0; if (e[0] === 'asn' || e[0] === 'rcv') { const own = asnOwner.get(e[2]) ?? asnOwner.set(e[2], p.id).get(e[2]); if (own !== p.id) { e = [...e]; e[2] = `${e[2]}-${p.id.slice(3)}`; } }
      if (e[1] !== lastDay) { slot = 0; lastDay = e[1]; }
      const at = t(e[1]);
      if (e[0] === 'chg') D.change(L, O, at, ++seq, Object.entries(e[2]).map(([k, q]) => ({ line: ln(k).line, code: q === 0 ? 'DI' : q < ln(k).qty ? 'QD' : 'QI', qty: q, qty_left: q })));
      else if (e[0] === 'ack') D.ack(L, O, at, { ref: `ACK-${p.id.slice(3)}`, codes: Object.fromEntries(Object.entries(e[2]).map(([k, a]) => [ln(k).line, a[1]])), qty: Object.fromEntries(Object.entries(e[2]).map(([k, a]) => [ln(k).line, a[0]])), backorder: Object.fromEntries(Object.entries(e[2]).filter(([, a]) => a[2]).map(([k, a]) => [ln(k).line, a[2]])) });
      else if (e[0] === 'asn' && asnQty.set(e[2], e[3])) D.asn(L, O, supplier !== 'ASHBY' && idx % 8 === 3 && at >= et('2026-09-27', '00:00') ? new Date(at.getTime() + (31 + idx % 8) * 60000) : at, { ref: e[2], shippedAt: at, deliveryDate: etDay(dayAt(e[1] + fx.transit, '12:00')), lines: Object.entries(e[3]).map(([k, q]) => ({ line: ln(k).line, sku: ln(k).sku, qty: q, uom: 'EA' })), cartonCount: Math.max(1, Math.ceil(Object.values(e[3]).reduce((a, b) => a + b, 0) / 24)), status: e[4] ? 'CC' : 'BP', shipFrom: { name: PARTY[supplier].name, gln: PARTY[supplier].gln }, scac: 'LKLF' });
      else if (e[0] === 'rcv') D.receipt(L, O, at, { ref: `RCV-${e[2]}`, asnRef: e[2], qty: Object.fromEntries(Object.entries(e[3]).map(([k, q]) => [ln(k).line, q])), short: Object.fromEntries(Object.entries(e[3]).map(([k, q]) => [ln(k).line, Math.max(0, (asnQty.get(e[2])?.[k] ?? q) - q)])) });
      else if (e[0] === 'inv') D.invoice(L, O, at, { ref: e[2], qty: Object.fromEntries(O.lines.map((l) => [l.line, e[3][l.k] || 0])), terms: fx.terms });
      else if (e[0] === 'pay') W.remit.push({ at, to: supplier, ref: `PMT-${p.id.slice(3)}-${e[2].slice(-3)}`, items: [{ invoice: e[2], po: p.id, paid: e[3] / 100, invoice_amount: (e[3] + e[4]) / 100, adjustments: e[4] ? [{ amount: -e[4] / 100, reason: '04', ref: `DM-${p.id.slice(3)}`, note: 'Deduction taken on remittance' }] : [] }] });
      else if (e[0] === 'rev') L.event({ at, kind: 'case.decision', po: p.id, system: 'Northfield deduction case', party: 'NORTHFIELD', channel: 'API', data: { decision: 'Reversed', amount: e[2] / 100 } });
    }
  });
}

export function build(nPre, jitter) {
  const L = new Log(); const W = { sscc, TED, pay: [], remit: [], slots: scorecardSlots(), price: (sku) => ITEM[sku].case_price };
  const G = replen(L, W, { nPre, jitter });
  anchors(L, W);

  // ---------- scorecard patterns on replenishment lines ----------
  const special = (O) => !!G.sp[O.n];
  const inQ = (O) => O.requested >= QUARTER.start && O.requested <= QUARTER.end;
  const free = G.life.filter((O) => !special(O) && inQ(O) && (O.r < addD(CLOCK10, -34) || O.r > addD(CLOCK10, 2)));
  let fi = 0; const takeFree = () => free[(fi += 7) % free.length];
  const usedN = new Set();
  const eSlots = W.slots.filter((s) => s.pat === 'E' && s.dc === 'DC 2');
  if (eSlots.length < 2) throw new Error('Scorecard fixture has fewer than two DC 2 arrival-window lines');
  for (const s of W.slots) {
    let O;
    if (s === eSlots[0]) O = G.life.find((x) => x.n === 46108); else if (s === eSlots[1]) O = G.life.find((x) => x.n === 46220);
    else { do { O = takeFree(); } while (usedN.has(O.n)); }
    usedN.add(O.n); O.pattern = s.pat; s.po = O.po; O.site = SITE[s.site]; O.shipTo = DCID[s.dc];
    const price = O.lines[0].price;
    if (s.pat === 'B') { O.shortRcv = s.cases; O.lines = [{ line: 1, sku: s.item, qty: Math.max(O.lines[0].qty, s.cases + 3), price: W.price(s.item) }]; }
    else if (s.pat === 'A') { const shipped = 8 + (O.n % 30); O.lines = [{ line: 1, sku: s.item, qty: s.cases + shipped, price: W.price(s.item) }]; O.shipQty = { 1: shipped }; }
    else if (s.pat === 'D') { const shipped = 20 + (O.n % 40); O.lines = [{ line: 1, sku: s.item, qty: s.cases + shipped, price: W.price(s.item) }]; O.shipQty = { 1: shipped }; O.allocCut = true; }
    else { O.lines = [{ line: 1, sku: s.item, qty: s.cases, price: W.price(s.item) }]; if (s.pat === 'C') { O.s = { ...O.s, late: 24 }; O.departed = addH(O.dep, 24); } }
    void price;
  }
  // ---------- total ordered cases on the scorecard: 48,000 ----------
  const pop = G.life.filter(inQ); const fixed = pop.filter((O) => special(O) || O.pattern);
  const flex = pop.filter((O) => !special(O) && !O.pattern);
  const sum = (a) => a.reduce((t, O) => t + (O.s && O.s.change ? 12 : O.lines.reduce((x, l) => x + l.qty, 0)), 0);
  const target = 48000 - sum(fixed); const f = target / sum(flex);
  for (const O of flex) for (const l of O.lines) l.qty = Math.max(1, Math.round(l.qty * f));
  let diff = target - sum(flex);
  for (let i = 0; diff !== 0; i = (i + 1) % flex.length) { const l = flex[i].lines[0]; if (diff > 0) { l.qty++; diff--; } else if (l.qty > 1) { l.qty--; diff++; } }
  W.scorecard = { ordered: 48000, failing: W.slots.reduce((a, s) => a + s.cases, 0), lines: W.slots.length };

  // ---------- Claim Agent evidence states: three one-carton receipt shortages on Kinross shipments ----------
  const claimPool = G.life.filter((O) => O.pattern === 'B' && O.shortRcv === 1 && O.r > et('2026-11-19', '00:00') && O.r < et('2026-12-01', '00:00'));
  if (claimPool.length < 3) throw new Error(`Only ${claimPool.length} one-carton receipt shortages fall in the claim window`);
  W.claimCases.forEach((c, i) => { const O = claimPool[i]; O.claim = c; c.po = O.po; O.noLoadScan = c.evidence !== 'held_by_warehouse'; });

  // ---------- P5: 124 Kinross shipments in the 48 hours after Tuesday 8 December 17:12 ----------
  const t0 = et('2026-12-08', '17:12'), t1 = addH(t0, 48);
  const inSpan = G.life.filter((O) => O.dep > t0 && O.dep <= t1);
  const kin = () => inSpan.filter((O) => O.site.startsWith('KIN')).length + 6;
  const movable = inSpan.filter((O) => !special(O) && !O.pattern);
  for (let i = 0; kin() !== 124 && i < movable.length; i++) { const O = movable[i]; if (kin() > 124 && O.site.startsWith('KIN')) O.site = 'ASH-WH1'; else if (kin() < 124 && !O.site.startsWith('KIN')) O.site = i % 2 ? 'KIN-GRV' : 'KIN-JOL'; }
  if (kin() !== 124) throw new Error(`Kinross shipments in the 48 hours after 8 Dec 17:12: ${kin()}, expected 124`);

  replenDocs(L, W, G);
  finishRisks(L, W);
  buyerOrders(L, W);
  remittances(L, W, G);
  L.asideHist = true; L.aside(() => history(L, W)); L.asideHist = false;
  L.aside(() => variance(L, W));
  L.event({ at: et('2026-12-28', '09:00'), kind: 'scorecard.published', po: null, system: 'Northfield scorecard file', party: 'NORTHFIELD', channel: 'API', data: { period: '13 weeks to 26 Dec 2026', definition: 'OTIF-2026.2, cases per order line', official: 0.91, compliant_cases: 43680, cases: 48000, failing_lines: 108, network_view: 0.924, plan_rule: 'NF-9.2', plan_due_days: 30 } });
  return { L, W, G };
}

/** Remittances: Northfield pays each Ashby invoice 30 days after it was sent, one remittance per payment day. */
function remittances(L, W, G) {
  const byDay = new Map(); const add = (at, item) => { const k = etDay(at); (byDay.get(k) || byDay.set(k, []).get(k)).push(item); };
  for (const O of G.life) if (O.invAt) { const at = addD(O.invAt, 30); if (at <= et('2027-01-06', '00:00')) add(at, { invoice: O.invRef, po: O.po, paid: O.invTotal, invoice_amount: O.invTotal, adjustments: [], O }); }
  for (const p of W.pay) add(p.at, { invoice: p.invRef, po: p.O.po, paid: p.amount, invoice_amount: p.amount, adjustments: [] });
  // Claim cases: the shortage is withheld when the invoice is paid.
  let seq = 990100;
  for (const [k, items] of [...byDay.entries()].sort()) {
    for (const it of items) if (it.O?.claim) { const cost = it.O.lines[0].price; const amt = Math.round((cost + 50) * 100) / 100; it.paid = Math.round((it.invoice_amount - amt) * 100) / 100; it.adjustments = [{ amount: -amt, reason: '04', ref: it.O.claim.dm, note: `SH01 shortage, PO ${it.O.po} line 1, 1 carton, case ${it.O.claim.case}` }]; it.O.claim.amount = amt; it.O.claim.payAt = iso(et(k, '08:00')); }
    const ref = k === '2026-12-15' ? 'PMT-990877' : `PMT-${seq++}`;
    const clean = items.map(({ O, ...x }) => x).sort((a, b) => b.paid - a.paid);
    if (k === '2026-12-15') { clean[0].adjustments = [...clean[0].adjustments, ...W.compliance]; clean[0].paid = Math.round((clean[0].paid - 251) * 100) / 100; }
    if (k === '2027-01-05') { clean[0].adjustments = [...clean[0].adjustments, ...W.repay.adjustments]; clean[0].paid = Math.round((clean[0].paid + 88.4) * 100) / 100; }
    D.remit(L, 'ASHBY', et(k, '08:00'), k === '2027-01-05' ? W.repay.ref : ref, clean);
  }
  for (const r of W.remit) D.remit(L, r.to || 'ASHBY', r.at, r.ref, r.items);
  for (const c of W.claimCases) {
    const O = G.life.find((x) => x.po === c.po); const opened = addD(O.rcvAt, 9);
    L.event({ at: opened, kind: 'case.opened', po: O.po, system: 'Northfield deduction case', party: 'NORTHFIELD', channel: 'API', data: { case: c.case, charge: 'SH01', amount: c.amount, line: 1, cartons: 1, deduction: c.dm, evidence_state: c.evidence } });
    L.event({ at: addH(O.departed, -0.3), kind: 'carrier.bill_of_lading', po: O.po, system: 'Lakeline Freight', party: 'LAKELINE', channel: 'Scanned document', data: { bol: `BOL-${O.n}`, seal: `SL-${O.n}77`, in_case: c.case } });
    if (c.evidence === 'tally_only') L.event({ at: addH(O.departed, -0.35), kind: 'wms.load_tally', po: O.po, system: 'Kinross warehouse system', party: 'KINROSS', channel: 'API', data: { shipment: `SHP-${O.n}`, cartons_loaded: O.cartons.length, by_sscc: true, signed: true, held_by: 'Kinross Logistics' } });
  }
}

/** Counts Ashby and Northfield documents (997s included) in the 30 days before P10's clock. */
function windowCount(L) {
  const start = addD(CLOCK10, -30).getTime(), end = CLOCK10.getTime(); let n = 0;
  const pair = (d) => (d.from === 'ASHBY' && d.to === 'NORTHFIELD') || (d.from === 'NORTHFIELD' && d.to === 'ASHBY');
  for (const d of L.docs) {
    if (!pair(d) || d.test) continue; const t = Date.parse(d.at);
    if (t > start && t <= end) n++;
    const fa = t + d.ackDelay * 60000; if (!d.no_ack && fa > start && fa <= end) n++;
  }
  return n;
}

/** Generates the world, choosing the number of early replenishment orders that makes P10's 30-day window hold 3,412 documents. */
export function generate(tuning) {
  if (tuning) { const b = build(tuning.nPre, tuning.jitter); const n = windowCount(b.L); if (n === 3412) return { ...b, out: b.L.emit(), ...tuning }; }
  let nPre = 575; const seen = new Map();
  for (let step = 0; step < 40; step++) {
    for (let j = 0; j < 3; j++) {
      const key = `${nPre}:${j}`; if (seen.has(key)) continue;
      const b = build(nPre, j); const n = windowCount(b.L); seen.set(key, n);
      if (n === 3412) return { ...b, out: b.L.emit(), nPre, jitter: j };
    }
    const n0 = seen.get(`${nPre}:0`);
    const move = Math.round((3412 - n0) / 10 * (51.3 / 30));
    nPre += move === 0 ? (3412 > n0 ? 1 : -1) : move;
    if ([0, 1, 2].every((j) => seen.has(`${nPre}:${j}`))) nPre += step % 2 ? 1 : -1;
  }
  throw new Error(`No replenishment volume gives 3,412 documents in the 30 days before 17 Nov 11:00 (tried ${[...seen.entries()].map(([k, v]) => `${k}=${v}`).join(' ')})`);
}
