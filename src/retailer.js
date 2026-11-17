// Northfield's side of the same world: what Jordan Ellis's own assistant may read and draft.
// Shared records are the documents both companies exchanged and the deduction case they both work in. Ashby's
// warehouse, ERP, carrier and agent records stay Ashby's; Northfield's payables, draft rules and reviewer notes stay
// Northfield's. Every answer is read as of a time; nothing here sends or changes anything.
import { fmtET } from '../world/lib.js';
import { normPo, rule, param, paramAt, chargeOf, storyClock, timeLeft, notYet, promotionOf } from './domain.js';
import { otif, scorecardAsOf, supplierRanking, QUARTER } from './score.js';
import { et } from '../world/lib.js';

/** The current period starts here. Lists and replays cover it by default; `from` reaches the history before it. */
export const QUARTER_FROM = et(QUARTER.start, '00:00').toISOString();
export const fromDate = (from) => (from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00-04:00` : from).toISOString() : QUARTER_FROM);

export const NOT_AVAILABLE_NF = 'Not available to Northfield';
const J = (s) => (s ? JSON.parse(s) : {});
const H = 3600000;
/** Document sets Northfield is a party to. The 940 and 945 pass between Ashby and its warehouse only. */
export const SHARED_SETS = ['850', '855', '856', '810', '860', '865', '861', '824', '997', '820', '852'];
const ASHBY_SYSTEMS = /^(Supplier ERP|Kinross|Lakeline|Trading Grid trade testing)/;
const supplierName = (db, id) => db.prepare('SELECT name FROM parties WHERE id = ?').get(id)?.name || id;
const findSupplier = (db, s) => { if (!s) return null; const k = String(s).trim().toLowerCase(); return db.prepare("SELECT id, name FROM parties WHERE kind = 'Supplier' AND (lower(id) = ? OR lower(name) = ? OR lower(name) LIKE ?)").get(k, k, `${k}%`) || null; };

/** A refusal for a record that belongs to Ashby. */
export const ashbyPrivate = (what) => ({ found: false, not_available: true, result: NOT_AVAILABLE_NF, message: `${NOT_AVAILABLE_NF}: ${what} belongs to Ashby Supplier and is not shared with Northfield. Ask the supplier to share it into the deduction case or on a document.` });

/** A PO's shared trail, or one supplier's exchange over a period. */
export function trail(db, { po: poIn, supplier, days = 30, asOf = storyClock() } = {}) {
  const T = asOf.toISOString();
  if (poIn) {
    const po = normPo(poIn); const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po); if (!o) return { found: false, message: `No order ${po} at Northfield` }; if (o.received_at > T) return notYet(po, asOf);
    const docs = db.prepare(`SELECT * FROM documents WHERE po = ? AND sent_at <= ? AND doc_type IN (${SHARED_SETS.map(() => '?').join(',')}) ORDER BY sent_at`).all(po, T, ...SHARED_SETS);
    const errs = db.prepare('SELECT e.*, d.reference FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN documents r ON r.doc_id = e.reported_by WHERE d.po = ? AND r.sent_at <= ?').all(po, T);
    return { found: true, po, supplier: supplierName(db, o.supplier_id), as_of: fmtET(asOf), order_value: o.order_value, requested_delivery: o.requested_delivery,
      documents: docs.map((d) => ({ sent: fmtET(d.sent_at), set: d.doc_type, document: d.name, reference: d.reference, from: d.sender_id === 'NORTHFIELD' ? 'Northfield' : supplierName(db, d.sender_id), status: d.status, link: `document/${encodeURIComponent(d.reference)}` })),
      rejections: errs.map((e) => ({ document: e.reference, cause: e.cause, rule: e.rule_id, channel: e.channel, status: e.status })),
      receipts: db.prepare('SELECT receipt, received_at, line, qty, short FROM receipts WHERE po = ? AND received_at <= ? ORDER BY received_at').all(po, T).map((r) => ({ ...r, received_at: fmtET(r.received_at) })),
      invoices: db.prepare('SELECT invoice, sent_at, total, status, replaces FROM invoices WHERE po = ? AND sent_at <= ? ORDER BY sent_at').all(po, T).map((i) => ({ ...i, sent_at: fmtET(i.sent_at) })),
      not_shown: 'The supplier’s ERP, warehouse, carrier and agent records are the supplier’s own and are not shown.' };
  }
  const s = findSupplier(db, supplier); if (!s) return { found: false, message: `No supplier ${supplier} trades with Northfield` };
  const from = new Date(asOf.getTime() - days * 24 * H).toISOString();
  const where = `supplier_id = ? AND partner_id = 'NORTHFIELD' AND test = 0 AND sent_at > ? AND sent_at <= ? AND doc_type IN (${SHARED_SETS.map(() => '?').join(',')})`;
  const docs = db.prepare(`SELECT doc_type, count(*) n FROM documents WHERE ${where} GROUP BY doc_type ORDER BY n DESC`).all(s.id, from, T, ...SHARED_SETS);
  const all = db.prepare(`SELECT e.cause, e.channel, d.reference, d.status dst, c.sent_at corrected_at FROM errors e JOIN documents d ON d.doc_id = e.doc_id LEFT JOIN documents c ON c.doc_id = e.corrected_by WHERE d.supplier_id = ? AND d.partner_id = 'NORTHFIELD' AND d.test = 0 AND d.sent_at > ? AND d.sent_at <= ?`).all(s.id, from, T);
  const fails = all.filter((f) => !/^Held/.test(f.dst)); const open = (f) => !(f.corrected_at && f.corrected_at <= T);
  return { found: true, supplier: s.name, period: `${days} days ending ${fmtET(asOf)}`, documents: docs.reduce((t, d) => t + d.n, 0), by_set: docs.map((d) => ({ set: d.doc_type, count: d.n })), failures: fails.length,
    rejected_by: { application_advice_824: fails.filter((f) => f.channel.includes('824')).length, technical_acknowledgment_997: fails.filter((f) => f.channel.includes('997')).length }, open_failures: fails.filter(open).map((f) => f.reference) };
}

/** A document Northfield exchanged, with its X12. */
export function documentNF(db, reference) {
  const ref = reference.trim().toUpperCase();
  const d = db.prepare('SELECT * FROM documents WHERE upper(doc_id) = ? OR upper(reference) = ? ORDER BY sent_at DESC').get(ref, ref);
  if (!d) return { found: false, message: `No document ${reference} at Northfield` };
  if (!SHARED_SETS.includes(d.doc_type)) return ashbyPrivate(`${d.name} ${d.reference}, a document between Ashby and its warehouse,`);
  return { found: true, document: d.name, set: d.doc_type, reference: d.reference, from: supplierName(db, d.sender_id), to: supplierName(db, d.receiver_id), sent: fmtET(d.sent_at), status: d.status, po: d.po, x12: d.raw.length > 6000 ? `${d.raw.slice(0, 6000)}\n... (${d.raw.length} characters in the file)` : d.raw, link: `document/${encodeURIComponent(d.reference)}` };
}

/** On-time, in-full as Trading Grid calculates it (P7). With a supplier: that supplier's rate, reasons and, on request, its
 * failing lines with the documents behind each. Without one: every supplier with a rate, ranked. A supplier's ERP, warehouse
 * and carrier records play no part: each reason is read from documents Northfield exchanged with the supplier. */
export function scorecardNF(db, supplier, asOf = storyClock(), { lines = false } = {}) {
  if (!supplier) return { found: true, ...supplierRanking(db, asOf) };
  const s = findSupplier(db, supplier); if (!s) return { found: false, message: `No supplier ${supplier}` };
  const r = scorecardAsOf(db, asOf, s.id); if (r.calculated && !r.cases) return { found: false, message: `${s.name} has no order line with a delivery date in the quarter` };
  if (r.calculated && lines) r.lines = otif(db, { supplier: s.id, asOf }).lines.map((l) => ({ ...l, order: `order/${encodeURIComponent(l.po)}` }));
  return { found: true, supplier: s.name, ...r };
}

const caseOpened = (db, key) => db.prepare("SELECT * FROM events WHERE kind = 'case.opened'").all().map((e) => ({ ...e, d: J(e.data) })).find((e) => e.d.case === key || e.d.deduction === key || e.po === normPo(key));

/** Deduction cases Northfield has opened, all suppliers. */
export function casesNF(db, asOf = storyClock(), from = null) {
  const rows = db.prepare("SELECT * FROM events WHERE kind = 'case.opened' AND at <= ? AND at >= ? ORDER BY at").all(asOf.toISOString(), fromDate(from)).map((e) => ({ ...J(e.data), po: e.po, opened: fmtET(e.at), supplier: supplierName(db, db.prepare('SELECT supplier_id FROM orders WHERE po = ?').get(e.po)?.supplier_id) }));
  return { as_of: fmtET(asOf), opened_from: fmtET(fromDate(from)), count: rows.length, total_amount: Math.round(rows.reduce((t, c) => t + c.amount, 0) * 100) / 100, cases: rows.map((c) => ({ case: c.case, supplier: c.supplier, po: c.po, charge: c.charge, amount: c.amount, opened: c.opened })) };
}

/** One case from Northfield's side: charges, what the supplier put in the case, what NF-7.4 needs, reviewer notes and decisions. */
export function caseNF(db, ref, asOf = storyClock()) {
  const key = ref.trim().toUpperCase(); const opened = caseOpened(db, key); const T = asOf.toISOString();
  if (!opened) return { found: false, message: `No deduction case ${ref} at Northfield` };
  if (opened.at > T) return { found: false, message: `Case ${opened.d.case} was not yet opened at ${fmtET(asOf)}` };
  const c = opened.d; const po = opened.po;
  const evs = db.prepare('SELECT * FROM events WHERE po = ? AND at <= ? ORDER BY at').all(po, T).map((e) => ({ ...e, d: J(e.data) }));
  const caseEv = evs.filter((e) => e.kind.startsWith('case.') && (e.d.case === c.case || !e.d.case));
  const shared = new Set(caseEv.filter((e) => e.kind === 'case.dispute').flatMap((e) => e.d.evidence || []));
  for (const e of evs) if (e.d.in_case === c.case) shared.add({ 'carrier.bill_of_lading': 'Bill of lading with seal', 'carrier.delivery_receipt': 'Proof of delivery', 'wms.load_scan': 'Load scan by SSCC', 'wms.load_tally': 'Load tally by SSCC' }[e.kind] || e.kind);
  const adj = db.prepare('SELECT * FROM adjustments WHERE po = ? AND paid_at <= ? ORDER BY paid_at').all(po, T).filter((a) => a.reference === c.deduction || /AS02|CI-NF/.test(a.reference || ''));
  const notes = db.prepare('SELECT at, charge, author, note FROM review_notes WHERE case_id = ? AND at <= ? ORDER BY at').all(c.case, T).map((n) => ({ ...n, at: fmtET(n.at) }));
  const decided = caseEv.filter((e) => e.kind === 'case.decision').map((e) => ({ at: fmtET(e.at), charge: e.d.charge, decision: e.d.decision, decided_by: e.d.decided_by, recommended_by: e.d.recommended_by || null, reason: e.d.reason }));
  const disputes = caseEv.filter((e) => e.kind === 'case.dispute').map((e) => ({ at: fmtET(e.at), charge: e.d.charge, amount: e.d.amount, evidence: e.d.evidence, drafted_by: e.d.drafted_by || null, approved_by: e.d.approved_by }));
  const promo = c.charge === 'PROMO' ? promotionOf(db, c.deduction) : null;
  const review = reviewRecommendation(db, { charge: c.charge, shared: [...shared], disputes, decided, promo });
  if (promo) return { found: true, case: c.case, supplier: supplierName(db, db.prepare('SELECT supplier_id FROM orders WHERE po = ?').get(po)?.supplier_id), po, as_of: fmtET(asOf), charge: c.charge, kind: 'Promotion deduction', amount: c.amount, deduction: c.deduction, deal: promo.deal, promotion: promo,
    withheld: adj.filter((a) => a.amount < 0).map((a) => ({ payment: a.payment, at: fmtET(a.paid_at), amount: a.amount, reference: a.reference, invoice: a.invoice })), repaid: repaidOn(db, decided, { ...c, po }, T),
    evidence_required: 'The deal Northfield announced (889) and the record the claimed amount rests on: store activity (852), ship notices (856) or the invoice (810)', evidence_in_case: [...shared], disputes, decisions: decided, reviewer_notes: notes, review_agent: review,
    authority: 'Jordan Ellis decides each charge in the case (NF-7.7). Review Agent checks the evidence and recommends; it decides nothing.', link: `order/${encodeURIComponent(po)}` };
  return { found: true, case: c.case, supplier: supplierName(db, db.prepare('SELECT supplier_id FROM orders WHERE po = ?').get(po)?.supplier_id), po, as_of: fmtET(asOf), charge: c.charge, amount: c.amount, deduction: c.deduction, cartons: c.cartons,
    withheld: adj.filter((a) => a.amount < 0).map((a) => ({ payment: a.payment, at: fmtET(a.paid_at), amount: a.amount, reference: a.reference })), repaid: repaidOn(db, decided, { ...c, po }, T),
    evidence_required: rule(db, 'NF-7.4'), evidence_in_case: [...shared], disputes, decisions: decided, reviewer_notes: notes, review_agent: review,
    authority: 'Jordan Ellis decides each charge in the case (NF-7.7). Review Agent checks the evidence and recommends; it decides nothing.', link: `order/${encodeURIComponent(po)}` };
}

/** Repayment of a reversed charge, read from Northfield's own remittance: a later payment line that pays more than its invoice by the reversed amount. */
function repaidOn(db, decided, c, T) {
  const rev = decided.filter((d) => d.decision === 'Reversed' && d.charge === c.charge); if (!rev.length) return [];
  // A repayment that names the deduction it reverses (NF-7.6) is read from the remittance itself.
  if (c.charge === 'PROMO') return db.prepare('SELECT * FROM deduction_repayments WHERE reference = ? AND repaid_at <= ? ORDER BY repaid_at').all(c.deduction, T).map((r) => ({ payment: r.repayment_payment, at: fmtET(r.repaid_at), amount: r.repaid_amount, carried_on: r.repayment_invoice, reference: r.reference }));
  const sid = db.prepare('SELECT supplier_id FROM orders WHERE po = ?').get(c.po)?.supplier_id;
  const rows = db.prepare('SELECT payment, paid_at, invoice, po, paid, invoice_amount FROM remittance_items WHERE payee_id = ? AND paid_at <= ? AND paid > invoice_amount ORDER BY paid_at').all(sid, T);
  const hit = rows.find((r) => Math.abs(r.paid - r.invoice_amount - c.amount) < 0.005);
  return hit ? [{ payment: hit.payment, at: fmtET(hit.paid_at), amount: Math.round((hit.paid - hit.invoice_amount) * 100) / 100, carried_on: `${hit.invoice} (${hit.po})`, reference: c.deduction }] : [];
}

/** Review Agent: is the evidence the guide requires in the case, and what does it support? */
export function reviewRecommendation(db, { charge, shared, disputes, decided, promo = null }) {
  const pending = disputes.filter((d) => !decided.some((x) => x.charge === d.charge));
  if (!pending.length) return { next_step: decided.length ? 'nothing_to_do' : 'wait_for_dispute', reason: decided.length ? 'Every disputed charge is decided' : 'The supplier has not disputed' };
  const d = pending[0]; const has = (s) => d.evidence.concat(shared).some((x) => new RegExp(s, 'i').test(x));
  // A promotion deduction is checked against the deal Northfield announced and the records the claim rests on.
  if (d.charge === 'PROMO' && promo) return promo.unsupported_amount > 0 && Math.abs(promo.unsupported_amount - d.amount) < 0.005
    ? { charge: d.charge, next_step: 'recommend_reverse', amount: promo.unsupported_amount, stands: promo.supported_amount, reason: promo.reason, records: promo.records, rule: rule(db, 'NF-7.6') }
    : { charge: d.charge, next_step: 'recommend_uphold', reason: promo.unsupported_amount > 0 ? `The dispute asks for $${d.amount.toFixed(2)}; the records leave $${promo.unsupported_amount.toFixed(2)} unsupported` : 'The deduction matches its deal', records: promo.records };
  if (d.charge === 'SH01') {
    const seal = has('bill of lading'), pod = has('deliver'), proof = has('load scan|load tally');
    if (!(seal && pod && proof)) return { charge: d.charge, next_step: 'recommend_not_reviewed', missing: [!seal && 'Bill of lading with seal', !pod && 'Proof of delivery', !proof && 'Load scan or load tally by SSCC'].filter(Boolean), rule: rule(db, 'NF-7.5'), charge_if_not_reviewed: `ID01 $${chargeOf(db, 'ID01')}` };
    return { charge: d.charge, next_step: 'recommend_reverse', reason: 'Seal intact, proof of delivery, and the carton loaded before the seal by SSCC', rules: [rule(db, 'NF-5.3'), rule(db, 'NF-7.4')], note: 'A reversal does not change the receipt (NF-5.5).' };
  }
  if (d.charge === 'AS02') return { charge: d.charge, next_step: 'recommend_uphold', reason: 'The ship notice still differs from the receiving advice; the receipt changes only through a revised receiving advice', rule: rule(db, 'NF-5.5') };
  return { charge: d.charge, next_step: 'jordan_decides', reason: 'No review rule for this charge' };
}

/** Three-way match: PO, receiving advice and invoice for one invoice or PO, and where the variance comes from. */
export function threeWayMatch(db, ref, asOf = storyClock()) {
  const key = ref.trim().toUpperCase(); const T = asOf.toISOString();
  const inv0 = db.prepare('SELECT * FROM invoices WHERE upper(invoice) = ?').get(key); const po = inv0 ? inv0.po : normPo(key);
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po); if (!o) return { found: false, message: `No invoice or order ${ref} at Northfield` };
  const invs = db.prepare('SELECT * FROM invoices WHERE po = ? AND sent_at <= ? ORDER BY sent_at').all(po, T); if (!invs.length) return { found: false, message: `No invoice on ${po} at ${fmtET(asOf)}` };
  const inv = inv0 && inv0.sent_at <= T ? inv0 : invs.find((i) => !i.replaces && /Held/.test(i.status)) || invs[invs.length - 1];
  const tol = paramAt(db, 'NF-7.11', 'tolerance', inv.sent_at); // the tolerance in force when the invoice was sent
  const lines = db.prepare('SELECT * FROM order_lines WHERE po = ? ORDER BY line').all(po).map((l) => {
    const il = db.prepare('SELECT * FROM invoice_lines WHERE invoice = ? AND line = ?').get(inv.invoice, l.line);
    const shipped = db.prepare("SELECT coalesce(sum(qty),0) q FROM shipment_lines WHERE po = ? AND line = ? AND shipment_id IN (SELECT shipment_id FROM shipments WHERE sent_at <= ?)").get(po, l.line, T).q;
    const received = db.prepare('SELECT coalesce(sum(qty),0) q FROM receipts WHERE po = ? AND line = ? AND received_at <= ?').get(po, l.line, T).q;
    const billed = il ? il.qty : 0; const price = il ? il.price : null; const priceVar = price != null && l.price ? Math.abs(price - l.price) / l.price : 0;
    const origin = !il ? 'not billed' : billed > shipped ? 'quantity: billed more than shipped' : billed > received ? 'quantity: billed more than received' : priceVar > tol ? 'price: beyond the NF-7.11 tolerance' : 'matches';
    const chg = l.price_original != null && l.price !== l.price_original ? db.prepare("SELECT seq, sent_at FROM order_changes WHERE po = ? AND line = ? AND code = 'PC' AND sent_at <= ? ORDER BY seq DESC").get(po, l.line, T) : null;
    return { line: l.line, item: l.northfield_item, ordered: l.qty_ordered, accepted: l.qty_accepted, po_price: l.price, ...(chg ? { first_po_price: l.price_original, price_set_by: `Order change ${chg.seq}, ${fmtET(chg.sent_at)} (NF-1.1)` } : {}), shipped, received, billed, invoice_price: price, origin, amount_at_issue: !il ? 0 : Math.round(Math.max(0, billed - Math.min(shipped, received)) * l.price * 100) / 100 + (priceVar > tol ? Math.round((price - l.price) * billed * 100) / 100 : 0) };
  });
  const corrections = invs.filter((i) => i.replaces === inv.invoice || (i.invoice !== inv.invoice && i.replaces)).map((i) => ({ invoice: i.invoice, replaces: i.replaces, sent: fmtET(i.sent_at), total: i.total, status: i.status }));
  const bad = lines.filter((l) => l.origin !== 'matches' && l.origin !== 'not billed');
  let origin, next, step;
  if (!bad.length) { origin = 'none'; step = 'release_for_payment'; next = { record: 'Payment on the next remittance', rule: null }; }
  else if (corrections.length && corrections.some((c) => c.replaces === inv.invoice)) { origin = 'missed correction: a corrected invoice is on file but the original is still the one being matched'; step = 'match_corrected_invoice'; next = { record: `Match corrected invoice ${corrections.find((c) => c.replaces === inv.invoice).invoice} and close ${inv.invoice}`, rule: rule(db, 'NF-7.2') }; }
  else if (bad.some((l) => l.origin.startsWith('quantity: billed more than shipped'))) { origin = 'quantity: billed more than the ship notice'; step = 'hold_and_request_corrected_invoice'; next = { record: 'Hold the invoice; the supplier sends a corrected invoice or credit memo', rule: rule(db, 'NF-7.8') }; }
  else if (bad.some((l) => l.origin.startsWith('quantity'))) { origin = 'quantity: received less than billed'; step = 'settle_on_receiving_advice'; next = { record: 'The receiving advice settles it: a shortage charge (SH01) or a revised receiving advice', rule: rule(db, 'NF-5.5') }; }
  else { origin = 'price'; step = 'hold_for_price'; next = { record: 'The accepted PO price settles it; the line is held', rule: rule(db, 'NF-7.11') }; }
  return { found: true, agent: 'Match Agent', acting_for: 'Jordan Ellis', po, supplier: supplierName(db, o.supplier_id), invoice: inv.invoice, invoice_status: corrections.some((c) => c.replaces === inv.invoice) || !/replaced/i.test(inv.status) ? inv.status : 'Held', invoice_total: inv.total, as_of: fmtET(asOf), lines, corrections, variance_origin: origin, next_step: step, deciding_record: next,
    evidence: { purchase_order: `${po} accepted ${lines.map((l) => l.accepted).join(' · ')}`, ship_notices: lines.map((l) => l.shipped).join(' · '), receiving_advice: lines.map((l) => l.received).join(' · '), invoice: `${inv.invoice} billed ${lines.map((l) => l.billed).join(' · ')}`, corrections: corrections.map((c) => c.invoice).join(', ') || 'None' },
    rule_baseline: 'Holds every invoice that does not match and leaves a payables clerk to find why',
    not_in_this_world: 'Promotion allowances and tax lines: Northfield invoices in this quarter carry none, so neither can be the origin.',
    authority: 'Approval of payment stays in Northfield accounts payable with Jordan Ellis. The agent finds the origin and fetches the record; it approves nothing.' };
}

/** Draft rules: what each checks, and replaying one against the quarter's exchanged X12 before it is published. */
export const REPLAY_CHECKS = {
  ship_notice_minutes: { what: 'Ship notice sent within N minutes of the shipped time in the ship notice', set: '856', current: 'NF-4.2', currentValue: 60 },
  acknowledgment_hours: { what: 'Order acknowledgment sent within N hours of the purchase order', set: '855', current: 'NF-1.4', currentValue: 24 },
  invoice_days: { what: 'Invoice sent within N days of the shipped time', set: '810', current: 'NF-7.9', currentValue: 2 },
  price_tolerance_pct: { what: 'Invoice line price within N percent of the purchase order price', set: '810', current: 'NF-7.11', currentValue: 0.5 },
  // Change list 4: checks behind the retailer rules adopted as drafts. current null = Northfield has no such rule today.
  supplier_997_hours: { what: 'Supplier’s functional acknowledgment (997) to the order within N hours', set: '850', current: null },
  ship_to_mismatch: { what: 'Ship-to on the ship notice matches the order', set: '856', current: 'NF-4.7', currentValue: 0, currentCharge: 150 },
  item_not_on_order: { what: 'Every item on the ship notice is on the order and the item list', set: '856', current: 'NF-4.11 (no charge)', currentValue: 0, currentCharge: 0 },
  over_shipment_pct: { what: 'Shipped quantity below N percent of the quantity ordered', set: '856', current: null },
  under_shipment_pct: { what: 'Shipped quantity short of the order by less than N percent', set: '856', current: null },
  ship_not_after_days: { what: 'Shipped no more than N business days after the order’s ship-not-after date', set: '856', current: null, needs: 'ship-not-after dates on Northfield’s orders, which the world does not yet hold' },
  ship_not_before_days: { what: 'Shipped no more than N days before the order’s ship-not-before date', set: '856', current: null, needs: 'ship-not-before dates on Northfield’s orders, which the world does not yet hold' },
  uom_mismatch: { what: 'Ship notice quantities in the order’s unit (cases)', set: '856', current: 'NF-4.14 (no charge)', currentValue: 0, currentCharge: 0 },
  duplicate_shipment_id: { what: 'No ship notice reuses a shipment identifier', set: '856', current: null },
  carton_over_cm: { what: 'No carton over N cm on any side', set: '856', current: null },
  unit_over_kg: { what: 'No carton holds a unit over N kg', set: '856', current: null },
  carton_contents_units: { what: 'Carton contents match the ship notice, charged per unit that differs', set: '856', current: 'NF-4.5 ($150 plus $1 per carton)', currentValue: 0, currentCharge: 'NF-4.5' },
  ship_notice_accuracy_pct: { what: 'Ship notice accurate and complete, charged as N percent of the order’s cost', set: '856', current: null },
};
function failsOf(db, check, value) {
  const docs = (set) => db.prepare(`SELECT d.*, o.supplier_id sup FROM documents d JOIN orders o ON o.po = d.po WHERE d.doc_type = ? AND d.status <> 'Superseded' AND d.sent_at >= ?`).all(set, QUARTER_FROM);
  const first = (po, set) => db.prepare('SELECT sent_at, body FROM documents WHERE po = ? AND doc_type = ? ORDER BY sent_at').get(po, set);
  const out = [];
  if (check === 'ship_notice_minutes') for (const d of docs('856')) { const b = J(d.body); if (b.shipped_at && (Date.parse(d.sent_at) - Date.parse(b.shipped_at)) / 60000 > value) out.push(d); }
  if (check === 'acknowledgment_hours') for (const d of docs('855')) { const p = first(d.po, '850'); if (p && (Date.parse(d.sent_at) - Date.parse(p.sent_at)) / H > value) out.push(d); }
  if (check === 'invoice_days') for (const d of docs('810')) { const s = first(d.po, '856'); const b = s ? J(s.body) : null; if (b && b.shipped_at && (Date.parse(d.sent_at) - Date.parse(b.shipped_at)) / (24 * H) > value) out.push(d); }
  const lines856 = () => db.prepare(`SELECT s.shipment_id, d.reference, d.doc_id, d.po, o.supplier_id sup, o.order_value, sl.line, sl.sku, sl.qty, sl.uom, ol.qty_ordered, ol.uom ouom, ol.price FROM shipment_lines sl JOIN shipments s ON s.shipment_id = sl.shipment_id JOIN documents d ON d.doc_id = s.doc_id JOIN orders o ON o.po = d.po JOIN order_lines ol ON ol.po = sl.po AND ol.line = sl.line WHERE d.status <> 'Superseded' AND d.sent_at >= ?`).all(QUARTER_FROM);
  const byDoc = (rows, units = () => 1) => { const m = new Map(); for (const r of rows) { const k = r.doc_id || r.reference; const x = m.get(k) || { ...r, units: 0 }; x.units += units(r); m.set(k, x); } return [...m.values()]; };
  const errs = (rule) => db.prepare(`SELECT d.*, o.supplier_id sup, o.order_value FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN orders o ON o.po = d.po WHERE e.rule_id = ? AND d.sent_at >= ? GROUP BY d.doc_id`).all(rule, QUARTER_FROM);
  if (check === 'supplier_997_hours') for (const d of docs('850')) { const a = db.prepare("SELECT sent_at FROM documents WHERE doc_type = '997' AND answers_doc_id = ? AND sender_id = ? ORDER BY sent_at").get(d.doc_id, d.sup); if (!a || (Date.parse(a.sent_at) - Date.parse(d.sent_at)) / H > value) out.push(d); }
  if (check === 'ship_to_mismatch') out.push(...db.prepare(`SELECT d.*, o.supplier_id sup FROM shipments s JOIN documents d ON d.doc_id = s.doc_id JOIN orders o ON o.po = s.po WHERE d.status <> 'Superseded' AND d.sent_at >= ? AND s.ship_to IS NOT NULL AND s.ship_to <> o.ship_to`).all(QUARTER_FROM), ...errs('NF-4.12'));
  if (check === 'item_not_on_order') { out.push(...errs('NF-4.11')); out.push(...byDoc(lines856().filter((r) => r.sku && r.sku !== db.prepare('SELECT sku FROM order_lines WHERE po = ? AND line = ?').get(r.po, r.line)?.sku))); }
  if (check === 'uom_mismatch') { out.push(...errs('NF-4.14')); out.push(...byDoc(lines856().filter((r) => r.uom && r.ouom && r.uom !== r.ouom))); }
  if (check === 'over_shipment_pct' || check === 'under_shipment_pct') { const tot = {}; for (const r of lines856()) { const k = `${r.po}|${r.line}`; (tot[k] ||= { ...r, shipped: 0 }).shipped += r.qty; }
    const bad = Object.values(tot).filter((t) => check === 'over_shipment_pct' ? t.shipped * 100 >= value * t.qty_ordered : t.qty_ordered > 0 && (t.qty_ordered - t.shipped) * 100 >= value * t.qty_ordered);
    out.push(...byDoc(bad, (t) => check === 'over_shipment_pct' ? (t.shipped - t.qty_ordered) * t.price : 1)); }
  if (check === 'duplicate_shipment_id') { const seen = {}; const corrects = (d) => db.prepare("SELECT 1 FROM document_links WHERE doc_id = ? AND kind = 'corrects'").get(d.doc_id); for (const d of docs('856').sort((a, b) => a.sent_at.localeCompare(b.sent_at))) { if (seen[d.reference] && !corrects(d)) out.push(d); seen[d.reference] = true; } } // a corrected ship notice that replaces a rejected one keeps its identifier by design
  if (check === 'carton_over_cm' || check === 'unit_over_kg') { const big = new Set(db.prepare(check === 'carton_over_cm' ? "SELECT DISTINCT sku FROM packaging_levels WHERE level = 'Case' AND max(length, width, height) * 2.54 > ?" : "SELECT DISTINCT sku FROM packaging_levels WHERE level = 'Each' AND gross_weight * 0.45359 > ?").all(value).map((r) => r.sku));
    if (big.size) out.push(...byDoc(db.prepare(`SELECT d.*, o.supplier_id sup, c.sku FROM cartons c JOIN shipments s ON s.shipment_id = c.shipment_id JOIN documents d ON d.doc_id = s.doc_id JOIN orders o ON o.po = c.po WHERE d.status <> 'Superseded' AND d.sent_at >= ?`).all(QUARTER_FROM).filter((r) => big.has(r.sku)))); }
  if (check === 'carton_contents_units') out.push(...byDoc(db.prepare(`SELECT d.*, o.supplier_id sup, c.qty, c.received FROM cartons c JOIN shipments s ON s.shipment_id = c.shipment_id JOIN documents d ON d.doc_id = s.doc_id JOIN orders o ON o.po = c.po WHERE d.status <> 'Superseded' AND d.sent_at >= ? AND c.qty <> c.received`).all(QUARTER_FROM), (r) => Math.abs(r.qty - r.received)));
  if (check === 'ship_notice_accuracy_pct') out.push(...db.prepare(`SELECT d.*, o.supplier_id sup, o.order_value FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN orders o ON o.po = d.po WHERE d.doc_type = '856' AND d.sent_at >= ? GROUP BY d.doc_id`).all(QUARTER_FROM));
  if (check === 'price_tolerance_pct') for (const d of docs('810')) { const b = J(d.body); for (const l of b.lines || []) { const ol = db.prepare('SELECT price FROM order_lines WHERE po = ? AND line = ?').get(d.po, l.line); if (ol && ol.price && Math.abs(l.price - ol.price) / ol.price * 100 > value) { out.push(d); break; } } }
  return out;
}
export function replayRule(db, { draft, check, value, charge }) {
  let d = null;
  if (draft) { d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(draft.trim().toUpperCase()); if (!d) return { found: false, message: `No draft rule ${draft}` }; check = d.check_kind; value = d.value; charge = d.charge; }
  const C = REPLAY_CHECKS[check]; if (!C) return { found: false, message: `Replay checks: ${Object.keys(REPLAY_CHECKS).join(', ')}` };
  const v = Number(value); if (!Number.isFinite(v) || v < 0) return { found: false, message: 'value must be a number' };
  if (C.needs) return { found: true, draft: d ? { id: d.id, statement: d.statement, state: d.state } : null, check: C.what.replace('N', String(v)), replayable: false, needs: C.needs, note: 'Not replayed: the quarter’s records cannot show this check yet. Nothing is published.' };
  const basis = d?.charge_basis || 'per document'; const perFail = charge == null && d ? null : Number(charge ?? 150);
  const cost = (rows) => perFail == null ? null : Math.round(rows.reduce((t, r) => t + (basis.startsWith('percent of order') ? (r.order_value || 0) * perFail / 100 : basis.startsWith('percent of over') ? (r.units || 0) * perFail / 100 : basis === 'per unit' || basis === 'per carton' ? (r.units || 1) * perFail : perFail), 0) * 100) / 100;
  const now = C.current == null ? [] : failsOf(db, check, C.currentValue); const then = failsOf(db, check, v);
  if (C.current == null || C.currentCharge !== undefined) {
    const by = (rows) => { const m = {}; for (const r of rows) (m[r.sup] ||= []).push(r.reference); return m; }; const B = by(then);
    return { found: true, draft: d ? { id: d.id, statement: d.statement, state: d.state, basis: d.basis } : null, check: C.what.replace('N', String(v)), compared_with: C.current ? `${C.current} in force` : 'No such rule in force today',
      documents_replayed: db.prepare("SELECT count(*) n FROM documents WHERE doc_type = ? AND status <> 'Superseded' AND sent_at >= ?").get(C.set, QUARTER_FROM).n, failing_with_draft: then.length, charge: perFail == null ? 'To set' : basis.startsWith('percent') ? `${perFail}% of the ${basis.replace(/^percent of (the )?/, '')}` : `$${perFail.toFixed(2)} ${basis}`,
      exposure_with_draft: cost(then) == null ? 'To set' : cost(then),
      by_supplier: Object.keys(B).map((s) => ({ supplier: supplierName(db, s), with_draft: B[s].length, documents: B[s].slice(0, 5) })).sort((a, b) => b.with_draft - a.with_draft),
      note: 'Replayed against the quarter’s exchanged records only. Nothing is published; publishing needs this replay on record and Jordan Ellis’s approval.' }; }
  const by = (rows) => { const m = {}; for (const r of rows) (m[r.sup] ||= []).push(r.reference); return m; };
  const A = by(now), B = by(then); const sups = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  return { found: true, draft: d ? { id: d.id, statement: d.statement, state: d.state } : null, check: C.what.replace('N', String(v)), compared_with: `${C.current} at ${C.currentValue}`, documents_replayed: db.prepare("SELECT count(*) n FROM documents WHERE doc_type = ? AND status <> 'Superseded' AND sent_at >= ?").get(C.set, QUARTER_FROM).n,
    failing_now: now.length, failing_with_draft: then.length, charge_per_failure: perFail, added_exposure: (then.length - now.length) * perFail,
    by_supplier: sups.map((s) => ({ supplier: supplierName(db, s), now: (A[s] || []).length, with_draft: (B[s] || []).length, newly_failing: (B[s] || []).filter((x) => !(A[s] || []).includes(x)).slice(0, 5) })).sort((a, b) => b.with_draft - a.with_draft),
    note: 'Replayed against the quarter’s exchanged X12 only. Nothing is published; publishing needs this replay on record and Jordan Ellis’s approval.' };
}
export function draftRules(db) { return { drafts: db.prepare('SELECT * FROM draft_rules ORDER BY id').all().map((r) => ({ ...r })) }; }
export { timeLeft };

export const JOBS = { three_way_match: (db, r, t) => threeWayMatch(db, r, t) };
