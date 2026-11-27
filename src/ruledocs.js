// Rule documents (P21 "Create rules from a document") and Ashby's money in motion (P8, Ashby side).
// Every figure is read from the records; nothing here writes. A rule drafted from a document goes into force only through
// a person's own save (Ashby) or Northfield's replay and publish (P15).
import { fmtET, etDay } from '../world/lib.js';
import * as NR from './retailer.js';
import { storyClock } from './domain.js';

const J = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const money = (n) => Math.round(n * 100) / 100;
const DAY = 86400000;
export const TRIP_RULE = 'NF-4.18';

// The replay check behind a document's requirement, where the quarter's records can show it.
const CHECK_OF = { 'NF-4.18': ['ship_notice_trip_id', 0], 'NF-4.2': ['ship_notice_minutes', 60], 'NF-1.4': ['acknowledgment_hours', 24], 'NF-7.9': ['invoice_days', 2], 'NF-7.11': ['price_tolerance_pct', 0.5], 'NF-4.7': ['ship_to_mismatch', 0], 'NF-4.14': ['uom_mismatch', 0] };
const WHEN = { 850: 'A purchase order arrives', 855: 'An order acknowledgment is sent', 856: 'A ship notice is sent', 810: 'An invoice is sent', 861: 'A receiving advice arrives', 824: 'An application advice is sent', 945: 'A warehouse shipping order is open', 940: 'A warehouse shipping order is sent' };
const chargeNumber = (c) => { const m = String(c || '').match(/\$(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };

/** The rule documents a side can open: Ashby sees Northfield's guide and its own agreements; Northfield its guide only. */
export function ruleDocumentList(db, side, asOf = storyClock()) {
  const T = asOf.toISOString();
  // Northfield holds its own guide versions before it publishes them; Ashby sees a version once it is published.
  const rows = side === 'northfield' ? db.prepare("SELECT * FROM rule_documents WHERE owner = 'Northfield' ORDER BY published_at").all() : db.prepare('SELECT * FROM rule_documents WHERE published_at <= ? ORDER BY owner, published_at').all(T);
  return { found: true, as_of: fmtET(asOf), documents: rows.map((d) => ({ document: d.doc_id, title: d.title, version: d.version, owner: d.owner === 'Ashby agreement' ? 'Ashby agreement' : d.owner,
    published: d.published_at <= T ? fmtET(d.published_at) : 'Not yet published', in_force_from: fmtET(d.in_force_from), in_force_to: d.in_force_to ? fmtET(d.in_force_to) : null, sections: db.prepare('SELECT count(*) n FROM rule_sections WHERE doc_id = ?').get(d.doc_id).n })) };
}

/** Ashby's own replay of a requirement over its own records this quarter. */
function ashbyReplay(db, ruleId, asOf) {
  const T = asOf.toISOString();
  if (ruleId === 'KX-945') {
    const rows = db.prepare("SELECT w.ref, w.po, w.sent_at, w.advice_at FROM warehouse_orders w JOIN orders o ON o.po = w.po WHERE o.supplier_id = 'ASHBY' AND w.sent_at >= '2026-09-27' AND w.sent_at <= ?").all(T);
    if (!rows.length) return { replayed: false, says: 'Not replayed: no matching records' };
    const late = rows.filter((r) => !r.advice_at || r.advice_at > T || (Date.parse(r.advice_at) - Date.parse(r.sent_at)) / 3600000 > 48);
    return { replayed: true, records_replayed: rows.length, record_kind: 'warehouse shipping orders (940)', failing: late.length, examples: late.slice(0, 5).map((r) => r.po), charge: 'To set', exposure: 'To set' };
  }
  if (ruleId === TRIP_RULE) {
    const rows = db.prepare("SELECT d.reference, d.body FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.test = 0 AND d.status <> 'Superseded' AND d.sent_at >= '2026-09-27' AND d.sent_at <= ?").all(T);
    if (!rows.length) return { replayed: false, says: 'Not replayed: no matching records' };
    const fail = rows.filter((r) => !J(r.body).trip_id);
    return { replayed: true, records_replayed: rows.length, record_kind: 'ship notices (856)', failing: fail.length, charge: '$150.00 per ship notice', exposure: money(fail.length * 150) };
  }
  return { replayed: false, says: 'Not replayed: no matching records' };
}

/** The draft rules a document holds, each in When, Check, Then, Charge and Owner form, citing its document and section,
 *  each replayed against the quarter where the records can show it. A guide version yields the requirements it adds or
 *  changes against the version before it; an agreement yields every section. Nothing is saved or published. */
export function extractRules(db, side, { document, as_of } = {}) {
  const asOf = as_of ? new Date(as_of) : storyClock(); const T = asOf.toISOString();
  const list = ruleDocumentList(db, side, asOf).documents; const key = String(document || '').trim().toUpperCase();
  const d = db.prepare('SELECT * FROM rule_documents WHERE upper(doc_id) = ?').get(key);
  if (!d || (side === 'northfield' && d.owner !== 'Northfield')) return { found: false, message: d ? 'Not available to Northfield: Ashby’s agreements are Ashby’s own records' : `No rule document ${document}`, documents: list.map((x) => x.document) };
  if (d.published_at > T && side !== 'northfield') return { found: false, message: `${d.title} ${d.version} is not published by ${fmtET(asOf)}`, documents: list.map((x) => x.document) };
  const all = db.prepare('SELECT * FROM rule_sections WHERE doc_id = ? ORDER BY CAST(section AS REAL), section').all(d.doc_id);
  const prev = d.replaces ? new Map(db.prepare('SELECT * FROM rule_sections WHERE doc_id = ?').all(d.replaces).map((s) => [s.rule_id, s])) : null;
  const picked = prev ? all.filter((s) => !prev.has(s.rule_id) || prev.get(s.rule_id).requirement !== s.requirement) : all;
  const rule = (id) => db.prepare('SELECT * FROM rules WHERE id = ?').get(id) || {};
  const drafts = picked.map((s) => {
    const r = rule(s.rule_id); const set = String(r.doc_type || '').split(',')[0];
    const charge = s.charge || r.charge || null; const owner = d.owner === 'Northfield' ? (side === 'northfield' ? 'Northfield, Jordan Ellis' : 'Ashby, EDI operations') : 'Ashby, Priya Raman';
    let replay;
    if (side === 'northfield') { const c = CHECK_OF[s.rule_id];
      if (!c) replay = { replayed: false, says: 'Not replayed: no matching records' };
      else { const x = NR.replayRule(db, { check: c[0], value: c[1], charge: chargeNumber(charge) ?? undefined, as_of: T });
        replay = x.found === false || !x.documents_replayed ? { replayed: false, says: 'Not replayed: no matching records' } : { replayed: true, records_replayed: x.documents_replayed, record_kind: 'documents exchanged this quarter', failing: x.failing_with_draft, charge: x.charge, exposure: x.exposure_with_draft ?? x.added_exposure ?? 'To set' }; }
    } else replay = ashbyReplay(db, s.rule_id, asOf);
    return { source: { document: `${d.title} ${d.version}`, section: s.section, in_force_from: s.in_force_from ? fmtET(s.in_force_from) : fmtET(d.in_force_from) },
      requires: s.requirement, when: WHEN[set] || 'When the trade the section covers takes place', check: s.requirement, then: charge ? `Charge ${charge}` : 'Flag it to its owner before the document leaves', charge: charge || 'To set', owner,
      new_in_version: !!s.new_in_version, segment_note: s.segment_note, replay, state: 'Draft, not saved', rule_ref: s.rule_id };
  });
  return { found: true, document: { id: d.doc_id, title: d.title, version: d.version, published: d.published_at <= T ? fmtET(d.published_at) : 'Not yet published',  in_force_from: fmtET(d.in_force_from), replaces: d.replaces },
    sections_read: all.length, ...(prev ? { compared_with: d.replaces, unchanged_sections: all.length - picked.length } : {}), drafts,
    note: side === 'northfield' ? 'Drafts only: a draft goes into Draft rules, and a rule is published only after its replay (Rule Replay).' : 'Drafts only: Priya Raman saves a draft as an Ashby manual rule; a rule from Northfield’s guide stays Northfield’s and read-only.' };
}

/** P8, Ashby's side: Ashby's working capital with Northfield at a moment. Ashby's records only. */
export function ashbyMoney(db, asOf = storyClock()) {
  const T = asOf.toISOString(); const today = etDay(asOf);
  // Every Ashby order with Northfield received in the quarter's window (buyer and store replenishment), at its furthest document.
  const orders = db.prepare("SELECT po, order_value FROM orders WHERE supplier_id = 'ASHBY' AND retailer_id = 'NORTHFIELD' AND received_at >= '2026-06-28' AND received_at <= ?").all(T);
  const paidPo = new Set(db.prepare("SELECT DISTINCT po FROM remittance_items WHERE paid_at <= ?").all(T).map((r) => r.po));
  const stageOf = new Map(); for (const d of db.prepare("SELECT d.po, d.doc_type FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.sent_at <= ? AND d.status <> 'Rejected' AND d.test = 0 AND d.doc_type IN ('855','856','861','810')").all(T)) { const k = { 855: 2, 856: 3, 861: 4, 810: 5 }[d.doc_type]; if (k > (stageOf.get(d.po) || 1)) stageOf.set(d.po, k); }
  const NAMES = ['Ordered', 'Acknowledged', 'Shipped', 'Received', 'Invoiced'];
  const openList = orders.filter((o) => !paidPo.has(o.po)).map((o) => ({ po: o.po, stage: NAMES[(stageOf.get(o.po) || 1) - 1], value: o.order_value }));
  const base = { open_orders: openList.length, open_value: money(openList.reduce((t, o) => t + o.value, 0)), by_stage: [...NAMES.map((s) => { const xs = openList.filter((o) => o.stage === s); return { stage: s, orders: xs.length, value: money(xs.reduce((t, o) => t + o.value, 0)) }; }), { stage: 'Paid', orders: orders.length - openList.length, value: money(orders.filter((o) => paidPo.has(o.po)).reduce((t, o) => t + o.order_value, 0)) }], open_order_list: openList };
  const paidBy = new Map(); for (const p of db.prepare("SELECT r.invoice, sum(r.paid) paid FROM remittance_items r JOIN orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY' AND r.paid_at <= ? GROUP BY r.invoice").all(T)) paidBy.set(p.invoice, p.paid);
  const openSet = new Set(openList.map((o) => o.po)); const inv = db.prepare("SELECT i.* FROM invoices i JOIN orders o ON o.po = i.po WHERE o.supplier_id = 'ASHBY' AND o.retailer_id = 'NORTHFIELD' AND i.sent_at <= ?").all(T).filter((i) => openSet.has(i.po));
  const replacedBy = new Map(inv.filter((i) => i.replaces).map((i) => [i.replaces, i.invoice]));
  // An invoice is held while an application advice rejecting it has open errors at the moment.
  const heldErr = (invRow) => db.prepare("SELECT e.cause, e.field FROM errors e JOIN documents a ON a.doc_id = e.reported_by WHERE a.doc_type = '824' AND a.sent_at <= ? AND e.doc_id = ? AND (e.corrected_by IS NULL OR e.corrected_by NOT IN (SELECT doc_id FROM documents WHERE sent_at <= ?))").all(T, invRow.doc_id, T);
  const unpaid = inv.filter((i) => !paidBy.has(i.invoice) && !replacedBy.has(i.invoice));
  const rows = unpaid.map((i) => { const due = etDay(new Date(Date.parse(i.sent_at) + (i.terms_days || 30) * DAY)); const e = heldErr(i); return { invoice: i.invoice, po: i.po, amount: i.total, invoiced: etDay(new Date(i.sent_at)), terms_days: i.terms_days || 30, due, held: e.length ? { cause: e.map((x) => x.cause).join('; '), owner: 'Ashby billing', fix_in: 'Supplier ERP invoice' } : null }; });
  const week = (d) => { const x = new Date(`${d}T12:00:00Z`); const s = new Date(x.getTime() - x.getUTCDay() * DAY); return etDay(s); };
  const thisWeek = week(today); const nextWeek = etDay(new Date(Date.parse(`${thisWeek}T12:00:00Z`) + 7 * DAY));
  const clean = rows.filter((r) => !r.held); const bucket = (f) => { const xs = clean.filter(f); return { invoices: xs.length, value: money(xs.reduce((t, x) => t + x.amount, 0)) }; };
  const incoming = { basis: 'Unpaid invoices by due date: invoice date plus the payment terms each invoice carries', overdue: bucket((r) => r.due < today), this_week: bucket((r) => r.due >= today && week(r.due) === thisWeek), next_week: bucket((r) => week(r.due) === nextWeek), later: bucket((r) => r.due > today && week(r.due) > nextWeek) };
  const receivedNotInvoiced = (base.open_order_list || []).filter((o) => o.stage === 'Received').map((o) => ({ po: o.po, value: o.value, cause: 'Receiving advice in; no invoice sent', owner: 'Ashby billing', fix_in: 'Supplier ERP invoice' }));
  const invoicedHeld = rows.filter((r) => r.held).map((r) => ({ invoice: r.invoice, po: r.po, amount: r.amount, ...r.held }));
  // Possible deductions: cases Northfield has opened that no remittance has taken yet, and short receipts with no case yet,
  // costed by Northfield's published shortage charge (invoice cost of each short carton plus $50).
  const opened = db.prepare("SELECT e.po, e.data, e.at FROM events e JOIN orders o ON o.po = e.po WHERE e.kind = 'case.opened' AND o.supplier_id = 'ASHBY' AND e.at <= ?").all(T).map((e) => ({ po: e.po, ...J(e.data), at: e.at }));
  const taken = new Set(db.prepare("SELECT reference FROM adjustments a JOIN orders o ON o.po = a.po WHERE o.supplier_id = 'ASHBY' AND a.paid_at <= ?").all(T).map((x) => x.reference));
  const caseOpen = opened.filter((c) => c.deduction && !taken.has(c.deduction)).map((c) => ({ case: c.case, po: c.po, charge: c.charge, amount: c.amount, state: 'Case open; not yet taken on a remittance' }));
  const casePo = new Set(opened.map((c) => c.po));
  const shorts = db.prepare("SELECT r.po, r.receipt, r.line, r.short, l.price FROM receipts r JOIN orders o ON o.po = r.po JOIN order_lines l ON l.po = r.po AND l.line = r.line WHERE o.supplier_id = 'ASHBY' AND r.received_at >= '2026-09-27' AND r.received_at <= ? AND r.short > 0").all(T).filter((x) => !casePo.has(x.po));
  const byPo = {}; for (const s of shorts) { const x = (byPo[s.po] ||= { po: s.po, receipt: s.receipt, short_cases: 0, value: 0 }); x.short_cases += s.short; x.value += s.short * (s.price || 0); }
  const shortRisk = Object.values(byPo).map((x) => ({ po: x.po, receipt: x.receipt, short_cases: x.short_cases, amount: money(x.value + 50), basis: 'Shortage charge: invoice cost of each short carton plus $50 (Northfield’s guide)', state: 'Short at receipt; no case yet' }));
  const paidShort = db.prepare("SELECT r.payment, r.paid_at, r.invoice, r.po, r.paid, r.invoice_amount FROM remittance_items r JOIN orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY' AND r.paid_at >= '2026-09-27' AND r.paid_at <= ? AND r.paid < r.invoice_amount ORDER BY r.paid_at").all(T)
    .map((x) => { const adj = db.prepare('SELECT amount, reference, note FROM adjustments WHERE payment = ? AND invoice = ?').all(x.payment, x.invoice); const caseId = adj.map((a) => (String(a.note || '').match(/DC-\d+/) || [])[0]).find(Boolean) || null;
      const repaid = db.prepare('SELECT sum(amount) s FROM adjustments WHERE amount > 0 AND reference IN (' + (adj.map(() => '?').join(',') || "''") + ') AND paid_at <= ?').get(...adj.map((a) => a.reference), T).s || 0;
      return { invoice: x.invoice, po: x.po, payment: x.payment, paid: x.paid, invoiced: x.invoice_amount, gap: money(x.invoice_amount - x.paid), paid_on: fmtET(x.paid_at), deduction: adj.map((a) => a.reference).join(', ') || null, case: caseId, repaid_since: money(repaid) }; });
  const sum = (xs, f) => money(xs.reduce((t, x) => t + f(x), 0));
  return { found: true, as_of: fmtET(asOf), side: 'Ashby Supplier', retailer: 'Northfield Retailer', read_by: 'Trading Grid, from the documents it carries and Ashby’s own records',
    open_orders: base.open_orders, open_value: base.open_value, by_stage: base.by_stage,
    incoming, unpaid: { invoices: rows.length, value: sum(rows, (r) => r.amount) },
    held: { received_not_invoiced: { orders: receivedNotInvoiced.length, value: sum(receivedNotInvoiced, (x) => x.value), list: receivedNotInvoiced.slice(0, 40) }, invoiced_and_held: { invoices: invoicedHeld.length, value: sum(invoicedHeld, (x) => x.amount), list: invoicedHeld } },
    possible_deductions: { cases_not_yet_taken: { cases: caseOpen.length, value: sum(caseOpen, (x) => x.amount), list: caseOpen }, short_without_case: { orders: shortRisk.length, value: sum(shortRisk, (x) => x.amount), list: shortRisk.slice(0, 40) } },
    paid_short: { invoices: paidShort.length, gap: sum(paidShort, (x) => x.gap), list: paidShort },
    not_available: 'Northfield’s payables and budget decisions are Not available to Ashby',
    reconciles: { stage_total: sum(base.by_stage.filter((s) => s.stage !== 'Paid'), (s) => s.value), open_value: base.open_value, unpaid_invoices_on_open_orders: sum(rows, (r) => r.amount) } };
}

/** P27, Ashby's side: Ashby's unpaid Northfield invoices at a moment, each read against Kanmon agreement KN-1. An invoice is
 *  clean when Northfield's receiving advice covers every order item it bills in full, no application advice rejects it and
 *  it is not replaced. Funding one costs KN-1's fee, 1.5% per 30 days prorated by day from today to its due date. Ashby's
 *  records only: Northfield's payables and budget stay Northfield's. */
export function cleanInvoices(db, asOf = storyClock(), { list = false } = {}) {
  const T = asOf.toISOString(); const today = Date.parse(`${etDay(asOf)}T12:00:00Z`);
  const kn = db.prepare("SELECT params FROM rules WHERE id = 'KN-1'").get(); const p = kn ? J(kn.params) || {} : {}; const pct = Number(p.fee_pct_per_30_days ?? 1.5);
  const inv = db.prepare("SELECT i.* FROM invoices i JOIN orders o ON o.po = i.po WHERE o.supplier_id = 'ASHBY' AND o.retailer_id = 'NORTHFIELD' AND i.sent_at <= ?").all(T);
  const paid = new Set(db.prepare('SELECT DISTINCT invoice FROM remittance_items WHERE paid_at <= ?').all(T).map((r) => r.invoice));
  const replaced = new Set(inv.filter((i) => i.replaces).map((i) => i.replaces));
  const lineQ = db.prepare('SELECT line, qty FROM invoice_lines WHERE invoice = ?'); const recQ = db.prepare('SELECT line, sum(qty) q FROM receipts WHERE po = ? AND received_at <= ? GROUP BY line');
  const rejQ = db.prepare("SELECT e.cause FROM errors e JOIN documents a ON a.doc_id = e.reported_by WHERE a.doc_type = '824' AND a.sent_at <= ? AND e.doc_id = ? AND (e.corrected_by IS NULL OR e.corrected_by NOT IN (SELECT doc_id FROM documents WHERE sent_at <= ?))");
  const rows = inv.filter((i) => !paid.has(i.invoice) && !replaced.has(i.invoice)).map((i) => {
    const due = Date.parse(i.sent_at) + (i.terms_days || 30) * DAY; const days = Math.max(0, Math.round((Date.parse(`${etDay(new Date(due))}T12:00:00Z`) - today) / DAY));
    const rec = Object.fromEntries(recQ.all(i.po, T).map((r) => [r.line, r.q])); const why = [];
    if (!Object.keys(rec).length) why.push('No receiving advice yet');
    else for (const l of lineQ.all(i.invoice)) if ((rec[l.line] || 0) < l.qty) why.push(`Billed ${l.qty} cases on order item ${l.line}; Northfield received ${rec[l.line] || 0}`);
    for (const e of rejQ.all(T, i.doc_id, T)) why.push(`Rejected by Northfield's application advice: ${e.cause}`);
    return { invoice: i.invoice, po: i.po, amount: money(i.total), due: etDay(new Date(due)), days_to_due: days, clean: !why.length, ...(why.length ? { why_not_clean: why.join('; ') } : { fee_if_funded_today: money(i.total * pct / 100 * days / 30) }) };
  });
  const clean = rows.filter((r) => r.clean); const sum = (xs, k) => money(xs.reduce((t, x) => t + x[k], 0));
  return { found: true, as_of: fmtET(asOf), agreement: 'Ashby’s invoice financing agreement with Kanmon', terms: { advance: `${(p.advance ?? 1) * 100}% of the invoice`, fee: `${pct}% per 30 days, prorated by day`, repaid_from: 'Northfield’s payment of the invoice' },
    test: 'Clean: Northfield’s receiving advice covers every order item the invoice bills in full, no application advice rejects it, and no later invoice replaces it',
    unpaid_invoices: rows.length, unpaid_value: sum(rows, 'amount'), clean_invoices: clean.length, clean_value: sum(clean, 'amount'), fee_to_fund_all_clean_today: money(clean.reduce((t, x) => t + x.amount * pct / 100 * x.days_to_due / 30, 0)),
    not_clean: rows.filter((r) => !r.clean), ...(list ? { clean_list: clean } : { clean_largest: [...clean].sort((a, b) => b.amount - a.amount).slice(0, 10) }),
    note: 'Northfield’s payables and budget decisions are Northfield’s; this reads Ashby’s own invoices and the documents Northfield sent Ashby.' };
}

/** P20: a promotion deduction Northfield took on a remittance, read the same on both sides: the deal it names (Ashby's
 *  promotion announcement, 889), the claim, and the check of the claim against the deal, the store activity reports (852),
 *  the ship notices (856) and the invoice (810). Both sides read the check as Trading Grid's promotion rules (26 November 2026; the Vividly path is retired). With no reference: every promotion
 *  deduction on the remittance. A name such as 2701-04 reads as PD-2701-04. */
export function promotionDeduction(db, ref, viewer = 'ashby', asOf = storyClock()) {
  const T = asOf.toISOString(); const ITEM = (sku) => db.prepare('SELECT description FROM items WHERE sku = ?').get(sku)?.description || sku;
  const deal = (id) => { const d = id && db.prepare('SELECT deal_id, kind, rate, rate_uom, period_start, period_end, order_start, order_end, terms FROM deals WHERE deal_id = ?').get(id); return d ? { deal: d.deal_id, kind: d.kind, rate: `$${d.rate.toFixed(2)} per ${d.rate_uom === 'EA' ? 'each' : 'case'}`, promoted_weeks: `${d.period_start} to ${d.period_end}`, order_window: `${d.order_start} to ${d.order_end}`, terms: d.terms } : 'No deal on record'; };
  const view = (r) => ({ deduction: r.deduction_ref, remittance: r.payment, invoice: r.invoice, item: ITEM(r.sku), kind: r.kind,
    claim: { deal: r.claimed_deal, from: r.claim_from, to: r.claim_to, quantity: r.claimed_qty, unit: r.claimed_uom === 'EA' ? 'each' : 'cases', rate: r.claimed_rate, withheld: money(r.claimed_amount) },
    deal_announced: deal(r.claimed_deal),
    promotion_check: { result: r.decision === 'Matched' ? 'Supported by the deal' : 'Not supported by the deal', why: r.reason, agreed_rate: r.agreed_rate, quantity_from_records: r.recomputed_qty, supported: money(r.authorised_amount), not_supported: money(r.unauthorised_amount), records: J(r.records) || [] } });
  const rows = db.prepare("SELECT * FROM deal_settlements WHERE supplier_id = 'ASHBY' AND paid_at <= ? ORDER BY deduction_ref").all(T);
  if (!rows.length) return { found: false, message: `No promotion deduction on a remittance at ${fmtET(asOf)}` };
  if (ref) { const m = String(ref).match(/(?:PD-)?(\d{4}-\d{2})/); const id = m ? `PD-${m[1]}` : String(ref); const r = rows.find((x) => x.deduction_ref === id);
    return r ? { found: true, as_of: fmtET(asOf), ...view(r) } : { found: false, message: `No promotion deduction ${id}; the remittance holds ${rows.map((x) => x.deduction_ref).join(', ')}` }; }
  return { found: true, as_of: fmtET(asOf), remittance: rows[0].payment, deductions: rows.map(view), withheld: money(rows.reduce((t, r) => t + r.claimed_amount, 0)), not_supported: money(rows.reduce((t, r) => t + r.unauthorised_amount, 0)) };
}

// ---------- Catalogue data mismatch (P25) ----------
// The UPC an Ashby ship notice carries for each item at a moment: the ship notice map's value when the map holds one,
// else the Supplier ERP item mapping for the Northfield item, else the item master. Each is checked as Northfield's rules
// read it: 12 digits with the GS1 check digit, and held in the catalogue records Ashby has published to Northfield.
const upcCheckDigit = (u) => { const d = String(u).slice(0, 11).split('').map(Number); const s = d.reduce((t, x, i) => t + x * (i % 2 === 0 ? 3 : 1), 0); return (10 - (s % 10)) % 10; };
export function catalogueCheck(db, asOf = storyClock()) {
  const T = asOf.toISOString();
  const held = db.prepare("SELECT sku, product, item_number, colour, size FROM catalogue_records WHERE supplier_id = 'ASHBY' AND published_at <= ? ORDER BY sku").all(T);
  const heldUpc = new Set(held.map((h) => h.item_number));
  const at = (sku, rec) => db.prepare('SELECT value, note FROM supplier_item_records WHERE supplier_id = ? AND sku = ? AND record = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC LIMIT 1').get('ASHBY', sku, rec, T, T);
  const items = db.prepare("SELECT sku, description FROM items WHERE supplier_id = 'ASHBY' ORDER BY sku").all();
  const sent = {}; for (const it of items) { const v = at(it.sku, 'Ashby ship notice map') || at(it.sku, 'Supplier ERP item mapping') || at(it.sku, 'Supplier ERP item master'); if (v) sent[it.sku] = v.value; }
  const problem = (u) => { if (!/^\d+$/.test(u) || u.length !== 12) return `${u.length} digits where a UPC has 12`; if (upcCheckDigit(u) !== Number(u[11])) return `Wrong check digit: it should be ${upcCheckDigit(u)}`; if (!heldUpc.has(u)) return 'Not held by Northfield: never published in Ashby’s catalogue records'; return null; };
  const name = Object.fromEntries(items.map((i) => [i.sku, i.description]));
  const wrong = Object.entries(sent).map(([sku, upc]) => ({ sku, item: name[sku], upc, problem: problem(upc) })).filter((x) => x.problem);
  const wrongSku = new Set(wrong.map((w) => w.sku));
  // Open orders: Northfield orders received, with no ship notice sent yet, that carry an item whose UPC would be wrong.
  const open = db.prepare("SELECT o.po, o.ship_to, o.order_value FROM orders o WHERE o.supplier_id = 'ASHBY' AND o.received_at <= ? AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.po = o.po) ORDER BY o.po").all(T)
    .map((o) => ({ ...o, lines: db.prepare('SELECT line, sku, qty_ordered FROM order_lines WHERE po = ? ORDER BY line').all(o.po) }))
    .filter((o) => o.lines.some((l) => wrongSku.has(l.sku)));
  // A ship notice built and not yet sent is held in Trading Grid for its checks; its order is the one on screen, not an open order.
  const heldNotices = db.prepare("SELECT s.shipment_id, s.po FROM shipments s JOIN orders o ON o.po = s.po WHERE o.supplier_id = 'ASHBY' AND o.received_at <= ? AND s.sent_at > ?").all(T, T)
    .filter((h) => db.prepare('SELECT sku FROM shipment_lines WHERE shipment_id = ?').all(h.shipment_id).some((l) => wrongSku.has(l.sku)));
  const unpublished = db.prepare("SELECT sku, value, note FROM supplier_item_records WHERE supplier_id = 'ASHBY' AND record = 'Supplier ERP item master' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)").all(T, T).filter((r) => !heldUpc.has(r.value) && !held.some((h) => h.sku === r.sku));
  return { found: true, as_of: fmtET(asOf),
    northfield_holds: held.map((h) => ({ product: name[h.sku] || h.product, upc: h.item_number, colour: h.colour, size: h.size })),
    in_supplier_erp_not_published: unpublished.map((u) => ({ upc: u.value, note: u.note })),
    wrong_on_ship_notices: wrong.map((w) => ({ item: w.item, upc_sent: w.upc, problem: w.problem })),
    ship_notices_held_for_these_item_numbers: heldNotices.map((h) => ({ ship_notice: h.shipment_id, order: h.po })),
    open_orders_with_the_same_item_numbers: open.map((o) => ({ order: o.po, ship_to: o.ship_to.replace(/^DC(\d)/, 'DC $1'), value: money(o.order_value), would_carry: o.lines.filter((l) => wrongSku.has(l.sku)).map((l) => ({ item: name[l.sku], upc: sent[l.sku] })) })),
    open_value: money(open.reduce((t, o) => t + o.order_value, 0)),
    rules: { item_number: 'GS1 standard: 12 digits for a UPC, the last a check digit', held: 'Northfield guide: every order item on a ship notice carries a UPC Northfield holds in the supplier’s catalogue records' } };
}
