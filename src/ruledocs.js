// Rule documents (P21 "Create rules from a document"), the guide change (P28) and Ashby's money in motion (P8, Ashby side).
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

/** P28: what Northfield's newest guide version changes for Ashby, at a moment. Ashby's records only. */
export function guideChangeImpact(db, asOf = storyClock()) {
  const T = asOf.toISOString();
  const docs = db.prepare("SELECT * FROM rule_documents WHERE owner = 'Northfield' AND published_at <= ? ORDER BY published_at").all(T);
  const nw = docs.at(-1), old = nw && docs.find((x) => x.doc_id === nw.replaces);
  if (!nw || !old) return { found: false, message: 'No revised Northfield guide is published by then' };
  const sec = db.prepare('SELECT * FROM rule_sections WHERE doc_id = ? AND new_in_version = 1').all(nw.doc_id);
  const r = db.prepare('SELECT * FROM rules WHERE id = ?').get(TRIP_RULE); const s = sec.find((x) => x.rule_id === TRIP_RULE);
  if (!r || !s) return { found: false, message: 'The revised guide adds no ship notice requirement' };
  const start = s.in_force_from || nw.in_force_from; const perNotice = chargeNumber(r.charge) || 150;
  const from30 = new Date(asOf.getTime() - 30 * DAY).toISOString();
  const past = db.prepare("SELECT d.reference, d.po, d.sent_at, d.body FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.test = 0 AND d.status <> 'Superseded' AND d.sent_at > ? AND d.sent_at <= ? ORDER BY d.sent_at").all(from30, T);
  const withTrip = past.filter((x) => J(x.body).trip_id);
  const fix = db.prepare("SELECT * FROM events WHERE kind = 'erp.correction' AND json_extract(data, '$.rule') = ? AND at <= ? ORDER BY at DESC LIMIT 1").get(TRIP_RULE, T);
  // Next week's shipments: Ashby's open Northfield orders with no ship notice by the moment, due for delivery in the first week of the rule.
  const end = new Date(Date.parse(start) + 7 * DAY).toISOString();
  const shipped = new Set(db.prepare("SELECT DISTINCT po FROM documents WHERE doc_type = '856' AND sent_at <= ?").all(T).map((x) => x.po));
  const upcoming = db.prepare("SELECT po, ship_to, requested_delivery, order_value FROM orders WHERE supplier_id = 'ASHBY' AND received_at <= ? AND requested_delivery >= ? AND requested_delivery < ? ORDER BY requested_delivery, po").all(T, etDay(new Date(start)), etDay(new Date(end)))
    .filter((o) => !shipped.has(o.po));
  const charged = fix ? 0 : upcoming.length;
  const first = Date.parse(T) >= Date.parse(start) ? db.prepare("SELECT d.* FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.test = 0 AND d.sent_at >= ? AND d.sent_at <= ? ORDER BY d.sent_at LIMIT 1").get(start, T) : null;
  const firstNext = db.prepare("SELECT d.reference, d.po, d.sent_at FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.test = 0 AND d.sent_at >= ? ORDER BY d.sent_at LIMIT 1").get(start);
  let confirmed = null;
  if (first) { const b = J(first.body); const ack = db.prepare("SELECT reference, sent_at, status FROM documents WHERE doc_type = '997' AND answers_doc_id = ? AND sent_at <= ?").get(first.doc_id, T);
    const rcv = db.prepare("SELECT reference, sent_at, body FROM documents WHERE doc_type = '861' AND sent_at <= ?").all(T).find((x) => J(x.body).asn_ref === first.reference);
    confirmed = { ship_notice: first.reference, po: first.po, sent: fmtET(first.sent_at), trip_id: b.trip_id || null, passes: !!b.trip_id, technical_acknowledgment: ack ? { reference: ack.reference, at: fmtET(ack.sent_at), reads: 'Technically acknowledged' } : null,
      receiving_advice: rcv ? { reference: rcv.reference, at: fmtET(rcv.sent_at), matches: true } : null }; }
  return { found: true, as_of: fmtET(asOf),
    guide: { old: { document: old.doc_id, version: old.version }, new: { document: nw.doc_id, version: nw.version, published: fmtET(nw.published_at), published_by: nw.published_by } },
    changed_requirement: { section: s.section, requires: s.requirement, starts: fmtET(start), charge: r.charge, segment_note: s.segment_note, rule: TRIP_RULE },
    replay: { period: `${fmtET(from30)} to ${fmtET(asOf)}`, ship_notices_read: past.length, pass_new_rule: withTrip.length, would_fail: past.length - withTrip.length, basis: 'Each ship notice checked for the trip ID in its header; a ship notice counts as affected only if it lacks it and ships on or after the start' },
    next_week: { from: etDay(new Date(start)), to: etDay(new Date(Date.parse(end) - 1)), shipments: upcoming.map((o) => ({ po: o.po, ship_to: o.ship_to, requested_delivery: o.requested_delivery, order_value: o.order_value, charge: fix ? 0 : perNotice })),
      would_be_charged: charged, money_at_stake: money(charged * perNotice), charge_per_ship_notice: perNotice },
    owner_fix: { owner: 'EDI operations', fix_in: 'Ashby’s ship notice map', state: fix ? 'Fixed' : 'Open', ...(fix ? { fixed_at: fmtET(fix.at), change: J(fix.data).change } : {}) },
    first_shipment_under_rule: confirmed || (firstNext ? { next: 'First shipment under the new rule', ship_notice: firstNext.reference, po: firstNext.po, at: fmtET(firstNext.sent_at), as_of: firstNext.sent_at } : null),
    already_shipped_wrong: db.prepare("SELECT count(*) n FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.sent_at >= ? AND d.sent_at <= ? AND json_extract(d.body, '$.trip_id') IS NULL").get(start, T).n,
    other_retailers: { retailers: 0, says: 'Ashby trades with Northfield only on Trading Grid in this world' } };
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
