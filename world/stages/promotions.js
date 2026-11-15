// T1.13 Promotions: Ashby offers Northfield trade deals on a promotion announcement (889); Northfield settles bill-back
// and scan-based deals after the fact as promotion deductions on its remittance (820), and each deduction is matched to
// its deal from the world's own records, or shown unauthorised with the reason.
//
// Borrowed (pages opened 15 Nov 2026):
//  - ERPNext Pricing Rule: a rule per item with a rate or discount, Valid From and Valid Upto (blank meaning open), applied
//    to transactions inside its validity. `deals` is a pricing rule with two windows (promoted period, order window), as
//    SAP keeps a promotion's validity on its condition record (DATAB, DATBI). https://docs.frappe.io/erpnext/pricing-rule
//    and https://leanx.eu/sap/table/konh/ (both cited in docs/phase1/world-model.md).
//  - X12 889 structure, a retailer's own public guide: DeCA (US commissaries) 889 implementation guide. G42 promotion
//    status (01 new) and allowance number; G62*29 and G62*30 promotion performance start and end; N1*VN vendor and N1*BY
//    buying party; LX per item; G46 promotion allowance (G4601 97 cents off, G4602 method of handling, 02 off invoice);
//    G45 item (G4502 consumer UPC, G4505 UK with the GTIN-14, G4507 pack, G4509 CA or EA, G4513 allowance per unit of
//    G4509); G69 free-form offer text. https://pprd.commissaries.com/sites/default/files/2017-03/889-5010.pdf
//  - G62 date qualifiers (element 432): 23 and 24 promotion order date start and end, 29 and 30 promotion performance
//    date start and end. https://www.stedi.com/edi/x12-004040/element/432
//  - Method of handling (element 331): 01 billed back, 02 deducted from the invoice, ZZ mutually defined (here: settled
//    on units sold reported on the 852). https://edi.stedi.com/edi/x12-003020/element/331
//  - Deduction reason codes on the remittance (element 426, ADX02): SP sales promotion (scan-based), GH bill-back
//    allowance deduction, A8 promotional allowance (an off-invoice allowance claimed after the fact).
//    https://www.stedi.com/edi/x12-004010/element/426
//  - X12 004010 889 structure checked against bots-grammars x12/4010/889004010.py.
// Deal numbers, items, rates, windows and the units Northfield claims are Invented for this world.
//
// What the world can and cannot hold. Existing orders, invoices and remittances may not change (world-diff), so no deal
// price appears on an existing order line and no allowance on an existing invoice. The deals are set so that existing
// invoices simply fall outside them: the off-invoice deal's order window is February 2027, after the world's period.
// Bill-back and scan-based deals need no change to an order: they are settled from records after the period, the
// scan-based deal from Northfield's product activity (852; only two weeks exist, 18 to 31 October, for the trail runner)
// and the bill-back deals from the cases Ashby shipped in the period (856). Settlement travels as deductions on a new
// remittance, PMT-990168 on Wednesday 6 January 2027, which pays the invoices due that day exactly as Northfield's
// existing remittances do (one remittance per payment day, invoice paid 30 days after it was sent); no existing 820 is edited.
//
// Dates. No 889 between Ashby and Northfield sits in P10's window (18 October 11:00 to 17 November 11:00 ET): the
// scan-based deal is announced on 5 October, the two bill-back deals on 18 November, the off-invoice deal on 29 December
// with Ashby's quarterly catalogue maintenance; settlement is on 6 January 2027. Stage documents number from their own
// interchange range (world/log.js), so none renumbers an existing document.
import { seg, d8, money, clean, n1, first, day8 } from '../x12.js';
import { et, etDay, addD } from '../lib.js';
import { PARTY, ITEM, unitsPerCase } from '../ref.js';
import { packagingLevels } from './catalogue.js';

const NF = PARTY.NORTHFIELD;
/** Deal status is read at the end of the world's settlement (the last remittance day). */
export const DEALS_AS_OF = '2027-01-06';
const METHOD = { 'Off-invoice': '02', 'Bill-back': '01', 'Scan-based': 'ZZ' };
const KIND_OF_METHOD = { '02': 'Off-invoice', '01': 'Bill-back', ZZ: 'Scan-based' };
const BASIS = { 'Off-invoice': 'Cases on the invoice of an order placed in the order window', 'Bill-back': 'Cases shipped (856) in the promoted period', 'Scan-based': 'Units sold in stores (852) in the promoted period' };
const REASON = { 'Scan-based': 'SP', 'Bill-back': 'GH', 'Off-invoice': 'A8' }; // ADX02, element 426
export const PROMOTION_REASONS = Object.values(REASON);

// The deals. Rates and windows are Invented. Order window: orders placed on these days carry the deal; promoted period:
// the days whose sales (scan-based) or shipments (bill-back) the deal pays on. Dates are Eastern calendar days, inclusive.
const DEALS = [
  { id: 'NFP-2610-01', supplier: 'ASHBY', sku: 'ASH-TRL-09', kind: 'Scan-based', rate: 0.25, uom: 'EA', period: ['2026-10-18', '2026-11-07'], order: ['2026-10-04', '2026-10-24'], at: ['2026-10-05', '10:00'], note: 'SCAN-BASED: UNITS SOLD ON 852' },
  { id: 'NFP-2611-02', supplier: 'ASHBY', sku: 'ASH-MUG-12', kind: 'Bill-back', rate: 1.2, uom: 'CA', period: ['2026-11-22', '2026-11-28'], order: ['2026-11-18', '2026-11-25'], at: ['2026-11-18', '10:00'], note: 'BILL-BACK ON CASES SHIPPED IN PERIOD' },
  { id: 'NFP-2612-03', supplier: 'ASHBY', sku: 'ASH-HNY-340', kind: 'Bill-back', rate: 0.5, uom: 'CA', period: ['2026-12-13', '2026-12-19'], order: ['2026-12-06', '2026-12-16'], at: ['2026-11-18', '10:30'], note: 'BILL-BACK ON CASES SHIPPED IN PERIOD' },
  { id: 'NFP-2702-04', supplier: 'ASHBY', sku: 'ASH-NAP-4', kind: 'Off-invoice', rate: 1.5, uom: 'CA', period: ['2027-02-07', '2027-03-06'], order: ['2027-02-01', '2027-02-28'], at: ['2026-12-29', '11:00'], note: 'OFF INVOICE, ORDERS IN FEBRUARY 2027' },
  // Another supplier's deal, so the views can show Ashby never sees it.
  { id: 'NFP-2701-05', supplier: 'BROOKLINE', sku: 'BRK-TWL-2', kind: 'Off-invoice', rate: 1.0, uom: 'CA', period: ['2027-01-17', '2027-02-13'], order: ['2027-01-10', '2027-01-31'], at: ['2026-12-30', '10:00'], note: 'OFF INVOICE, ORDERS 10 TO 31 JAN 2027' },
];
const consumerUpc = (() => { const m = {}; for (const l of packagingLevels()) if (l.level === 'Each') m[l.sku] = l.gtin.slice(2); return m; })();

// ---------- the 889 ----------
const doc889 = {
  func: 'QG', name: 'Promotion announcement',
  body: (d) => [
    seg('G42', d.status, d.ref),
    seg('G62', '29', d8(d.period_start)), seg('G62', '30', d8(d.period_end)), seg('G62', '23', d8(d.order_start)), seg('G62', '24', d8(d.order_end)),
    seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln), seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln),
    ...d.lines.flatMap((l) => [seg('LX', l.line), seg('G46', '97', l.method),
      seg('G45', '', l.upc || '', '', '', 'UK', l.gtin, l.pack, '', l.uom, '', '', '', money(l.rate)), seg('G69', clean(l.note).slice(0, 45))]),
  ],
  read: (S) => {
    const g = first(S, 'G42'); const dt = (q) => day8(first(S, 'G62', q)?.[2]); const lines = [];
    for (const e of S) {
      if (e[0] === 'LX') lines.push({ line: +e[1] });
      else if (e[0] === 'G46') Object.assign(lines[lines.length - 1], { allowance: e[1], method: e[2] });
      else if (e[0] === 'G45') Object.assign(lines[lines.length - 1], { upc: e[2] || null, gtin: e[6], pack: +e[7], uom: e[9], rate: +e[13] });
      else if (e[0] === 'G69') lines[lines.length - 1].note = e[1];
    }
    return { ref: g[2], po: null, status: g[1], period_start: dt('29'), period_end: dt('30'), order_start: dt('23'), order_end: dt('24'), parties: n1(S), lines };
  },
};

// ---------- generating ----------
const latestBy = (docs, key) => { const m = new Map(); for (const d of docs) { const k = key(d); const p = m.get(k); if (!p || d.at >= p.at) m.set(k, d); } return [...m.values()]; };
/** Ashby's accepted ship notices to Northfield, one per number (a resend replaces the one it corrects), as derive reads them. */
function shipNotices(L) {
  const refused = new Set(L.docs.filter((d) => d.type === '824' && d.action === 'TR').map((d) => d._target));
  return latestBy(L.docs.filter((d) => d.type === '856' && d.from === 'ASHBY' && d.to === 'NORTHFIELD' && !d.test && !(d.fault && d.fault !== 'no_ctt') && !refused.has(d)), (d) => d.ref);
}
const inDays = (iso, from, to) => { const day = etDay(new Date(iso)); return day >= from && day <= to; };
const r2 = (x) => Math.round(x * 100) / 100;

function generate(L, { G }) {
  const head = (s) => ({ vendor_name: PARTY[s].name, vendor_gln: PARTY[s].gln, buyer_name: NF.name, buyer_gln: NF.gln });
  for (const x of DEALS) {
    const it = ITEM[x.sku];
    L.doc({ type: '889', from: x.supplier, to: 'NORTHFIELD', at: et(...x.at), ref: x.id, status: '01', period_start: x.period[0], period_end: x.period[1], order_start: x.order[0], order_end: x.order[1], ...head(x.supplier),
      lines: [{ line: 1, method: METHOD[x.kind], upc: consumerUpc[x.sku] || null, gtin: it.gtin, pack: unitsPerCase(it.pack), uom: x.uom, rate: x.rate, note: x.note }] });
  }
  // Settlement: Northfield's remittance of 6 January 2027 pays the invoices due that day (sent 7 December, paid 30 days
  // later, as world/generate.js pays every invoice) and takes five promotion deductions.
  const PAY_DAY = '2027-01-06';
  const items = G.life.filter((O) => O.invAt && etDay(addD(O.invAt, 30)) === PAY_DAY).map((O) => ({ invoice: O.invRef, po: O.po, paid: O.invTotal, invoice_amount: O.invTotal, adjustments: [] }));
  if (items.length < 6) throw new Error(`promotions: only ${items.length} invoices due on ${PAY_DAY}`);
  const deal = Object.fromEntries(DEALS.map((x) => [x.id, x]));
  const claim = (ref, x, from, to, qty, rate) => ({ ref, reason: REASON[x.kind], amount: r2(qty * rate), note: `Promotion ${x.id} ${x.sku} ${from}..${to} ${qty} ${x.uom} x ${money(rate)}` });
  // Scan-based: units sold on Northfield's 852 for the weeks it reported (18 to 31 October) ...
  const sold = (sku, from, to) => L.docs.filter((d) => d.type === '852' && !d.test && d.period_start >= from && d.period_end <= to).flatMap((d) => d.items.filter((i) => i.sku === sku).flatMap((i) => i.stores)).reduce((a, s) => a + s.sold, 0);
  const d1 = deal['NFP-2610-01']; const s1 = sold(d1.sku, '2026-10-18', '2026-10-31');
  if (!s1) throw new Error('promotions: no 852 units sold for the trail runner, 18 to 31 October');
  // ... and a claim for 1 to 7 November, a week Northfield never reported on an 852: 1,480 pairs from its own point of
  // sale (Invented). Nothing on record supports it.
  // Bill-back: cases shipped on Ashby's ship notices in the promoted period. The honey deal is claimed at 0.60 a case,
  // above the 0.50 agreed on the 889.
  const asns = shipNotices(L);
  const shipped = (sku, from, to) => asns.filter((d) => inDays(d.shipped_at, from, to)).flatMap((d) => d.lines).filter((l) => l.sku === sku && (l.uom || 'CA') === 'CA').reduce((a, l) => a + l.qty, 0);
  const d2 = deal['NFP-2611-02'], d3 = deal['NFP-2612-03'], d4 = deal['NFP-2702-04'];
  const claims = [
    claim('PD-2701-01', d1, '2026-10-18', '2026-10-31', s1, d1.rate),
    claim('PD-2701-02', d1, '2026-11-01', '2026-11-07', 1480, d1.rate),
    claim('PD-2701-03', d2, ...d2.period, shipped(d2.sku, ...d2.period), d2.rate),
    claim('PD-2701-04', d3, ...d3.period, shipped(d3.sku, ...d3.period), 0.6),
  ];
  // Off-invoice: Northfield claims the February napkin allowance on a December invoice paid today.
  const invDoc = (ref) => latestBy(L.docs.filter((d) => d.type === '810' && d.ref === ref && !d.test), () => 1)[0];
  const napInv = items.map((i) => ({ i, l: invDoc(i.invoice).lines.find((l) => l.sku === d4.sku) })).filter((x) => x.l).sort((a, b) => b.l.qty - a.l.qty)[0];
  if (!napInv) throw new Error(`promotions: no napkin invoice due on ${PAY_DAY}`);
  const offInv = { ...claim('PD-2701-05', d4, etDay(new Date(invDoc(napInv.i.invoice).at)), etDay(new Date(invDoc(napInv.i.invoice).at)), napInv.l.qty, d4.rate), invoice: napInv.i.invoice };
  // Each deduction sits on one invoice: the off-invoice claim on the invoice it names, the others on the largest invoices.
  napInv.i.adjustments.push({ amount: -offInv.amount, reason: offInv.reason, ref: offInv.ref, note: offInv.note });
  const rest = items.filter((i) => i !== napInv.i).sort((a, b) => b.paid - a.paid);
  [...claims].sort((a, b) => b.amount - a.amount).forEach((c, k) => { if (rest[k].paid <= c.amount) throw new Error(`promotions: ${c.ref} exceeds invoice ${rest[k].invoice}`); rest[k].adjustments.push({ amount: -c.amount, reason: c.reason, ref: c.ref, note: c.note }); });
  for (const i of items) i.paid = r2(i.invoice_amount + i.adjustments.reduce((a, x) => a + x.amount, 0));
  const pay = L.doc({ type: '820', from: 'NORTHFIELD', to: 'ASHBY', at: et(PAY_DAY, '08:00'), ref: 'PMT-990168', amount: r2(items.reduce((a, i) => a + i.paid, 0)), payer_name: NF.name, payer_gln: NF.gln, payee_name: PARTY.ASHBY.name, payee_gln: PARTY.ASHBY.gln, items: items.sort((a, b) => b.paid - a.paid) });
  void pay;
}

// ---------- typed rows ----------
const statusOf = (x) => (DEALS_AS_OF < x.period_start && DEALS_AS_OF < x.order_start ? 'Announced' : DEALS_AS_OF > x.period_end && DEALS_AS_OF > x.order_end ? 'Ended' : 'Active');
function derive(d, T, ctx) {
  T.deals ||= [];
  const byGtin = Object.fromEntries(Object.values(ITEM).map((i) => [i.gtin, i]));
  for (const l of d.lines) {
    const it = byGtin[l.gtin]; if (!it) throw new Error(`889 ${d.ref}: GTIN ${l.gtin} is no item`);
    const kind = KIND_OF_METHOD[l.method];
    const row = { deal_id: d.ref, supplier_id: d.sender, retailer_id: d.receiver, sku: it.sku, kind, method_code: l.method, allowance_code: l.allowance, rate: l.rate, rate_uom: l.uom, quantity_basis: BASIS[kind],
      period_start: d.period_start, period_end: d.period_end, order_start: d.order_start, order_end: d.order_end, status: null, announced_doc_id: d.doc_id, announced_at: d.at, terms: l.note, basis: 'Invented' };
    row.status = statusOf(row); T.deals.push(row);
  }
  void ctx;
}

/** Reads the records a settlement is recomputed from: from the derived tables (T) during the build, or from a database. */
export function readerFromRows(T) {
  const orders = new Map(T.orders.map((o) => [o.po, o])); const ships = new Map(T.shipments.map((s) => [s.shipment_id, s]));
  return {
    deal: (id) => T.deals.find((x) => x.deal_id === id) || null,
    sold: (sku, from, to) => T.store_activity.filter((r) => r.sku === sku && r.period_start >= from && r.period_end <= to),
    shipped: (supplier, sku, from, to) => T.shipment_lines.filter((l) => l.sku === sku && l.uom === 'CA' && orders.get(l.po)?.supplier_id === supplier && inDays(ships.get(l.shipment_id).shipped_at, from, to)).map((l) => ({ ...l, doc_id: ships.get(l.shipment_id).doc_id })),
    invoiceLines: (invoice, sku) => { const i = T.invoices.find((x) => x.invoice === invoice); if (!i) return null; const ol = T.order_lines.filter((l) => l.po === i.po && l.sku === sku).map((l) => l.line); return { invoice: i, order: orders.get(i.po), lines: T.invoice_lines.filter((l) => l.invoice === invoice && ol.includes(l.line)) }; },
  };
}
export function readerFromDb(db) {
  return {
    deal: (id) => { const r = db.prepare('SELECT * FROM deals WHERE deal_id = ?').get(id); return r ? { ...r } : null; },
    sold: (sku, from, to) => db.prepare('SELECT * FROM store_activity WHERE sku = ? AND period_start >= ? AND period_end <= ?').all(sku, from, to),
    shipped: (supplier, sku, from, to) => db.prepare("SELECT l.*, s.shipped_at, s.doc_id FROM shipment_lines l JOIN shipments s ON s.shipment_id = l.shipment_id JOIN orders o ON o.po = l.po WHERE l.sku = ? AND l.uom = 'CA' AND o.supplier_id = ? AND s.shipped_at >= ? AND s.shipped_at < ?")
      .all(sku, supplier, et(from, '00:00').toISOString(), et(etDay(addD(et(to, '12:00'), 1)), '00:00').toISOString()).filter((l) => inDays(l.shipped_at, from, to)),
    invoiceLines: (invoice, sku) => { const i = db.prepare('SELECT * FROM invoices WHERE invoice = ?').get(invoice); if (!i) return null;
      return { invoice: i, order: db.prepare('SELECT * FROM orders WHERE po = ?').get(i.po), lines: db.prepare('SELECT il.* FROM invoice_lines il JOIN order_lines ol ON ol.po = il.po AND ol.line = il.line WHERE il.invoice = ? AND ol.sku = ?').all(invoice, sku) }; },
  };
}

const CLAIM = /^Promotion (\S+) (\S+) (\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2}) (\d+) (CA|EA) x (\d+(?:\.\d+)?)$/;
/** A promotion deduction as the remittance states it: deal, item, period, quantity, unit and rate from the NTE text. */
export function parseClaim(a) {
  const m = CLAIM.exec(a.note || ''); if (!m) return null;
  return { deal_id: m[1], sku: m[2], from: m[3], to: m[4], qty: +m[5], uom: m[6], rate: +m[7], amount: r2(-a.amount) };
}

/** Settles one promotion deduction against its deal from the records: Matched, or Unauthorised with the reason. */
export function settle(adj, R) {
  const c = parseClaim(adj);
  const out = (decision, reason, o = {}) => ({ decision, reason, recomputed_qty: null, agreed_rate: null, authorised_amount: 0, records: [], ...o, unauthorised_amount: r2(-adj.amount - (o.authorised_amount ?? 0)) });
  if (!c) return { claim: null, ...out('Unauthorised', 'The deduction names no deal, item, period and quantity') };
  const x = R.deal(c.deal_id);
  if (!x) return { claim: c, ...out('Unauthorised', `No deal ${c.deal_id} on record`) };
  if (x.supplier_id !== adj.payee_id) return { claim: c, ...out('Unauthorised', `Deal ${x.deal_id} is not a deal of ${adj.payee_id}`) };
  if (x.sku !== c.sku) return { claim: c, ...out('Unauthorised', `Item ${c.sku} is not on deal ${x.deal_id} (${x.sku})`) };
  if (x.rate_uom !== c.uom) return { claim: c, ...out('Unauthorised', `Claimed per ${c.uom}; deal ${x.deal_id} pays per ${x.rate_uom}`) };
  if (Math.abs(r2(c.qty * c.rate) - c.amount) > 0.005) return { claim: c, ...out('Unauthorised', `Amount ${money(c.amount)} is not ${c.qty} x ${money(c.rate)}`) };
  let qty = 0; let records = [];
  if (x.kind === 'Scan-based' || x.kind === 'Bill-back') {
    if (c.from < x.period_start || c.to > x.period_end) return { claim: c, ...out('Unauthorised', `Claimed period ${c.from} to ${c.to} is outside the promoted period ${x.period_start} to ${x.period_end}`) };
    if (x.kind === 'Scan-based') { const rows = R.sold(x.sku, c.from, c.to); qty = rows.reduce((a, r) => a + r.sold, 0); records = [...new Set(rows.map((r) => `852 ${r.period_start}..${r.period_end}`))]; }
    else { const rows = R.shipped(x.supplier_id, x.sku, c.from, c.to); qty = rows.reduce((a, r) => a + r.qty, 0); records = [...new Set(rows.map((r) => r.doc_id))]; }
  } else {
    const inv = R.invoiceLines(adj.invoice, x.sku);
    if (!inv || !inv.lines.length) return { claim: c, ...out('Unauthorised', `Invoice ${adj.invoice} bills no ${x.sku}`) };
    const ordered = etDay(new Date(inv.order.received_at));
    records = [inv.invoice.doc_id];
    if (ordered < x.order_start || ordered > x.order_end) return { claim: c, ...out('Unauthorised', `Order ${inv.order.po} was placed on ${ordered}, outside the order window ${x.order_start} to ${x.order_end}`, { records }) };
    qty = inv.lines.reduce((a, l) => a + l.qty, 0);
  }
  const authorised = r2(qty * x.rate); const base = { recomputed_qty: qty, agreed_rate: x.rate, authorised_amount: Math.min(authorised, c.amount), records };
  if (c.rate > x.rate) return { claim: c, ...out('Unauthorised', `Rate ${money(c.rate)} per ${c.uom} is above the ${money(x.rate)} agreed on deal ${x.deal_id}`, base) };
  if (qty !== c.qty) return { claim: c, ...out('Unauthorised', qty === 0 && x.kind === 'Scan-based' ? `No product activity (852) on record for ${c.from} to ${c.to}; ${c.qty} units claimed` : `${c.qty} ${c.uom} claimed; the records hold ${qty}`, base) };
  return { claim: c, ...out('Matched', `${qty} ${c.uom} x ${money(x.rate)} recomputed from ${x.kind === 'Scan-based' ? 'the 852' : x.kind === 'Bill-back' ? 'the ship notices' : 'the invoice'}`, base) };
}

function settlementRow(a, R, docByPayment) {
  const s = settle(a, R); const c = s.claim || {}; const x = c.deal_id ? R.deal(c.deal_id) : null;
  return { deduction_ref: a.reference, payment: a.payment, doc_id: docByPayment(a.payment), paid_at: a.paid_at, supplier_id: a.payee_id, invoice: a.invoice, reason_code: a.reason,
    deal_id: x ? x.deal_id : null, claimed_deal: c.deal_id ?? null, kind: x?.kind ?? null, sku: c.sku ?? null, claim_from: c.from ?? null, claim_to: c.to ?? null, claimed_qty: c.qty ?? null, claimed_uom: c.uom ?? null, claimed_rate: c.rate ?? null,
    claimed_amount: r2(-a.amount), agreed_rate: s.agreed_rate, recomputed_qty: s.recomputed_qty, authorised_amount: s.authorised_amount, unauthorised_amount: s.unauthorised_amount, decision: s.decision, reason: s.reason,
    deal_doc_id: x?.announced_doc_id ?? null, records: JSON.stringify(s.records) };
}
export const isPromotion = (a) => a.amount < 0 && PROMOTION_REASONS.includes(a.reason);
function finish(T, ctx) {
  T.deals ||= [];
  const R = readerFromRows(T); const docOf = new Map(ctx.docs.filter((d) => d.type === '820').map((d) => [d.ref, d.doc_id]));
  T.deal_settlements = T.adjustments.filter(isPromotion).map((a) => settlementRow(a, R, (p) => docOf.get(p)));
}

/** The settlement of one deduction read from a database (the gate's own recompute; a scratch copy shows a changed deal). */
export function settleFromDb(db, ref) {
  const a = db.prepare('SELECT * FROM adjustments WHERE reference = ? AND amount < 0').get(ref); if (!a) return null;
  return settle({ ...a }, readerFromDb(db));
}

export default {
  id: 'promotions',
  docs: { 889: doc889 },
  // The 889 starts a promotion's flow. The deal is agreed between buyer and supplier off EDI (as an ERPNext Pricing Rule
  // or an SAP condition record is master data set up before any transaction), so the announcement answers no document.
  origins: ['889'],
  prev: () => [],
  // A remittance that takes a promotion deduction also names the deal announcement it settles, and the 852 reports,
  // ship notices or invoice the amount is recomputed from (D60: every deduction links to what it settles against).
  alsoPrev(d, ctx) {
    if (d.type !== '820') return [];
    const out = [];
    for (const i of d.items) for (const a of i.adjustments) {
      if (!(a.amount < 0 && PROMOTION_REASONS.includes(a.reason))) continue;
      const c = parseClaim(a); if (!c) continue;
      const ann = (ctx.byRef.get(`889:${c.deal_id}:${d.receiver}`) || []).find((x) => x.at <= d.at); if (!ann) continue;
      out.push({ doc: ann, kind: 'settles deal' });
      if (a.reason === 'SP') for (const r of ctx.docs.filter((x) => x.type === '852' && !x.test && x.at <= d.at && x.period_start >= c.from && x.period_end <= c.to && x.items.some((it) => it.sku === c.sku))) out.push({ doc: r, kind: 'settles against product activity' });
      if (a.reason === 'GH') {
        ctx._promoShip ??= (() => { const sup = new Map(ctx.T.orders.map((o) => [o.po, o.supplier_id])); const m = new Map(); for (const l of ctx.T.shipment_lines) if (l.uom === 'CA') (m.get(l.shipment_id) || m.set(l.shipment_id, new Set()).get(l.shipment_id)).add(l.sku); return { sup, m }; })();
        for (const s of ctx.T.shipments) if (ctx._promoShip.sup.get(s.po) === d.receiver && ctx._promoShip.m.get(s.shipment_id)?.has(c.sku) && inDays(s.shipped_at, c.from, c.to)) { const sd = ctx.byId.get(s.doc_id); if (sd) out.push({ doc: sd, kind: 'settles against ship notice' }); }
      }
      if (a.reason === 'A8') { const inv = (ctx.byRef.get(`810:${i.invoice}:${d.receiver}`) || []).filter((x) => !x.rejected && x.at <= d.at).pop(); if (inv) out.push({ doc: inv, kind: 'settles against invoice' }); }
    }
    return out;
  },
  schema: `
-- T1.13: deals announced on the 889 (a pricing rule per item with a promoted period and an order window), and the
-- settlement of each promotion deduction taken on a remittance.
CREATE TABLE deals (deal_id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES parties(id), retailer_id TEXT NOT NULL REFERENCES parties(id), sku TEXT NOT NULL REFERENCES items(sku),
  kind TEXT NOT NULL CHECK (kind IN ('Off-invoice','Bill-back','Scan-based')), method_code TEXT NOT NULL, allowance_code TEXT, rate REAL NOT NULL CHECK (rate > 0), rate_uom TEXT NOT NULL CHECK (rate_uom IN ('CA','EA')),
  quantity_basis TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, order_start TEXT NOT NULL, order_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Announced','Active','Ended','Cancelled')), announced_doc_id TEXT NOT NULL REFERENCES documents(doc_id), announced_at TEXT NOT NULL, terms TEXT, basis TEXT NOT NULL,
  CHECK (period_start <= period_end AND order_start <= order_end));
CREATE TABLE deal_settlements (deduction_ref TEXT PRIMARY KEY, payment TEXT NOT NULL, doc_id TEXT NOT NULL REFERENCES documents(doc_id), paid_at TEXT NOT NULL, supplier_id TEXT NOT NULL REFERENCES parties(id),
  invoice TEXT NOT NULL REFERENCES invoices(invoice), reason_code TEXT NOT NULL, deal_id TEXT REFERENCES deals(deal_id), claimed_deal TEXT, kind TEXT, sku TEXT REFERENCES items(sku),
  claim_from TEXT, claim_to TEXT, claimed_qty INTEGER, claimed_uom TEXT, claimed_rate REAL, claimed_amount REAL NOT NULL, agreed_rate REAL, recomputed_qty INTEGER,
  authorised_amount REAL NOT NULL, unauthorised_amount REAL NOT NULL, decision TEXT NOT NULL CHECK (decision IN ('Matched','Unauthorised')), reason TEXT NOT NULL,
  deal_doc_id TEXT REFERENCES documents(doc_id), records TEXT NOT NULL);
`,
  generate,
  derive,
  finish,
  views: {
    // Deal terms are shared between the two parties to the deal: Ashby sees its own deals and their settlement, never
    // another supplier's; Northfield sees every deal it was offered.
    ashby: ["INSERT INTO deals SELECT * FROM m.deals WHERE supplier_id = 'ASHBY'", "INSERT INTO deal_settlements SELECT * FROM m.deal_settlements WHERE supplier_id = 'ASHBY'"],
    northfield: ['INSERT INTO deals SELECT * FROM m.deals', 'INSERT INTO deal_settlements SELECT * FROM m.deal_settlements'],
  },
  staedi: {
    SEG: {
      G42: ['ID 2 2!', 'AN 1 16!', 'ID 2 2'],
      G46: ['ID 1 3!', 'ID 2 2!', 'R 1 15', 'ID 2 2', 'N 1 15', 'ID 1 1', 'R 1 6', 'AN 1 16', 'AN 1 20', 'AN 1 80', 'ID 3 3', 'R 1 9'],
      G45: ['AN 12 12', 'AN 12 12', 'AN 1 16', 'AN 1 16', 'ID 2 2', 'AN 1 48', 'R 1 6', 'R 1 8', 'ID 2 2', 'ID 2 2', 'DT 8 8', 'R 1 6', 'R 1 15'],
      G69: ['AN 1 45!'],
    },
    SET: {
      889: ['G42!', 'G62!+', ['N1!+'], ['LX!+', 'G46+', ['G45!+', 'G69+']]],
    },
  },
};
