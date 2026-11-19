// Action cards: what Aviator, or a connected assistant, may ask a person to approve. The server builds every card from the
// side's own rules and the records at the moment, never from the model's words: the model names an action and a record, the
// server checks it against the rules and returns it as data: what happens, to whom, on which record and under which rule.
// Nothing happens until the person presses Approve; the card id is the idempotency key, so one press records one action.
//
// Trading Grid acts only as Trading Grid does: it sends a business document it carries (855, 865, 856, 810, 997, 824) or
// records a decision in its own workflows (a dispute, a charge decision, a chargeback, a published rule). It never sends an
// email, a note, a task or an instruction, and it never writes into the Supplier ERP or any other company's system.
import { writeInterchange, FUNC } from '../world/x12.js';
import { TED } from '../world/ref.js';
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import * as NR from './retailer.js';
import { appendEvent, appendDocument, appendRow, overlayRow, currentSession } from './session.js';

const J = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ISA = { ASHBY: 'ASHBYSUP', NORTHFIELD: 'NORTHFIELD' };
const NAME = { ASHBY: 'Ashby Supplier', NORTHFIELD: 'Northfield Retailer' };
const DOC_NAMES = { 855: 'order acknowledgment', 865: 'change acknowledgment', 856: 'ship notice', 810: 'invoice', 824: 'application advice', 997: 'technical acknowledgment' };
const CHARGE_NAMES = { SH01: 'shortage charge', AS02: 'ship notice mismatch charge', RT01: 'readiness chargeback', PROMO: 'promotion deduction' };
const chargeName = (c) => CHARGE_NAMES[c] || `${c} charge`;
// The 824 in Northfield's guide (validator/make-schemas.js, set 824): BGN, then OTI with TED and NTE. TED02 is AN 1 60.
export const GUIDE_824 = { ted02_max: 60, nte_allowed: true, nte_max: 80 };

/** Every action a card can carry, by side: the write it makes, Aviator's permission key in P21, and its rule. */
export const CARD_ACTIONS = {
  ashby: {
    open_dispute: { write: 'submit_dispute', permission: 'open_dispute', rule: 'AP-4.1', takes: 'case (DC-…), optional charge', does: 'Open a dispute in Northfield’s deduction case' },
    release_held_ship_notice: { write: 'release_ship_notice', permission: 'release_held_ship_notice', rule: 'AP-1.3', takes: 'document (a held ship notice)', does: 'Release a held ship notice to Northfield' },
    send_acknowledgment: { write: 'send_document', permission: 'send_acknowledgment', rule: 'NF-1.4', doc: '855', takes: 'po', does: 'Send the order acknowledgment (855)' },
    answer_order_change: { write: 'send_document', permission: 'answer_order_change', rule: 'NF-1.6', doc: '865', takes: 'po', does: 'Answer an order change with a change acknowledgment (865)' },
    send_ship_notice: { write: 'send_document', permission: 'send_ship_notice', rule: 'NF-4.2', doc: '856', takes: 'po', does: 'Send the ship notice (856) built from the load scan' },
    send_invoice: { write: 'send_document', permission: 'send_invoice', rule: 'NF-7.8', doc: '810', takes: 'po', does: 'Send the invoice (810) for the shipped quantity' },
    answer_application_advice: { write: 'send_document', permission: 'answer_application_advice', rule: 'NF-7.2', doc: '997', takes: 'advice (AA-…)', does: 'Answer Northfield’s application advice (824) with a 997 and the corrected document' },
  },
  northfield: {
    send_application_advice: { write: 'send_application_advice', permission: 'send_application_advice', rule: 'NF-7.8', takes: 'document (an 810 or 856 Northfield received), optional messages per error code', does: 'Reject a document with an application advice (824)' },
    decide_charge: { write: 'decide_charge', permission: 'decide_charge', rule: 'NF-7.7', takes: 'case, charge, decision (Reversed or Upheld), reason', does: 'Reverse or uphold a disputed deduction' },
    decide_chargeback: { write: 'decide_chargeback', permission: 'decide_chargeback', rule: 'NF-3.6', takes: 'po, decision (Apply or Waive)', does: 'Apply or waive a readiness chargeback' },
    publish_rule: { write: 'publish_rule', permission: 'publish_rule', rule: 'NF-11.1', takes: 'draft (NFD-…)', does: 'Publish a draft rule to suppliers after its replay' },
  },
};
const SIDE_PARTY = { ashby: 'ASHBY', northfield: 'NORTHFIELD' };
const PERSON = { ashby: 'Priya Raman', northfield: 'Jordan Ellis' };

// ---------- Plain-language intent: Aviator acts only when asked, and never outside Trading Grid ----------
// Words that ask for a message to someone. "message", "text" and "tell" count only with a person or company after them.
const WHO = '(?:him|her|them|kinross|lakeline|jordan|priya|ashby|northfield|the (?:buyer|carrier|warehouse|supplier|retailer|desk|order desk|billing desk|driver))';
const OUTSIDE = new RegExp(`\\b(?:e-?mail|phone|call|ring up|sms|slack|teams|whatsapp|instruct|remind|notify|ping|chase)\\b|\\b(?:message|text|tell|ask)\\s+${WHO}\\b`, 'i');
const OWNERS = [
  [/kinross|warehouse|3pl/i, 'Kinross', 'Kinross’s warehouse system'], [/lakeline|carrier|driver|truck/i, 'Lakeline Freight', 'Lakeline’s own systems'],
  [/billing desk|order desk|supplier erp|netsuite|ashby/i, 'Ashby', 'the Supplier ERP'], [/jordan|northfield|buyer|retailer/i, 'Northfield', 'Northfield’s own systems'],
  [/priya/i, 'Ashby', 'Ashby’s own systems'],
];
// A message to the other company that a Trading Grid document or decision carries. Northfield's application advice
// carries a plain message per error (TED02, 60 characters, or a note in NTE, 80 characters, as its guide allows); Ashby's
// dispute in Northfield's deduction case carries a note. The words go into that record and a card is raised; no email.
const CARRIERS = {
  northfield: { action: 'send_application_advice', names: /\b(reject|rejecting|824|application advice)\b/i, ref: /\b(?:INV|ASN)-[A-Z0-9-]+\b/i, arg: 'document' },
  ashby: { action: 'open_dispute', names: /\bdispute\b/i, ref: /\bDC-[A-Z0-9-]+\b/i, arg: 'case' },
};
const MESSAGE_WORDS = new RegExp(`\\b(?:tell|message|text|ask|let)\\s+${WHO}\\s+(?:know\\s+)?(?:that\\s+|to\\s+)?([^]+)$`, 'i');
const NOT_CARRIED = /\b(?:e-?mail|phone|call|ring up|sms|slack|teams|whatsapp)\b/i;
/** The record a request's message to the other company goes into, and the message words; null when no such record is named. */
export function carriedMessage(q, side) {
  const t = String(q || ''); const c = CARRIERS[side]; if (!c || !c.names.test(t) || NOT_CARRIED.test(t)) return null;
  const ref = t.match(c.ref)?.[0]; const m = t.match(MESSAGE_WORDS);
  const note = m ? m[1].replace(/[*~>\n\r]/g, ' ').replace(/\s+/g, ' ').replace(/[.!\s]+$/, '').trim() : null;
  // Lines the person names anywhere in the request ("reject INV-7731 line 3 and tell Ashby it is overbilled"): the message
  // belongs to those lines only.
  const lm = t.match(/\blines?\s+(\d+(?:\s*(?:,|and|&)\s*\d+)*)/i); const lines = lm ? [...new Set(lm[1].match(/\d+/g).map(Number))] : [];
  return { action: c.action, args: ref ? { [c.arg]: ref.toUpperCase() } : {}, note: note ? note[0].toUpperCase() + note.slice(1) : null, lines };
}
/** A request Trading Grid does not carry: an email, call or instruction to someone, or a change in another company's system. */
export function outsideTradingGrid(q, side) {
  const t = String(q || ''); if (carriedMessage(t, side)) return null;
  const asksSend = OUTSIDE.test(t) && /\b(can you|could you|please|send|write|draft|go|would you)\b|^\s*\w+\b/i.test(t);
  const otherSystem = /\b(change|update|edit|fix|correct|cancel|delete|create|post|adjust)\b.*\b(supplier erp|netsuite|erp|wms|warehouse system|(kinross|lakeline|northfield|ashby)(’s|'s)? (own )?(system|systems|erp|wms|portal|inventory|ordering system))\b/i.test(t);
  const thisSidesDoc = /\b(855|856|810|865|824|997|ship notice|invoice|acknowledg|application advice|dispute|chargeback|deduction|rule)\b/i.test(t) && !OUTSIDE.test(t);
  if (!(OUTSIDE.test(t) && asksSend) && !(otherSystem && !thisSidesDoc)) return null;
  const hit = OWNERS.find(([re]) => re.test(t)); const [, who, where] = hit || [null, side === 'ashby' ? 'the person who owns it' : 'the owner of the record', 'their own system'];
  return { owner: who, where, asks: /\b(call|phone|ring)\b/i.test(t) ? 'a call' : otherSystem && !OUTSIDE.test(t) ? 'a change in another company’s system' : 'an email, message or instruction' };
}

// ---------- Records ----------
const at = (T) => (T instanceof Date ? T : new Date(T)).toISOString();
const ordersOf = (db, po) => db.prepare('SELECT * FROM orders WHERE po = ?').get(po);
const docsOf = (db, po, T) => db.prepare('SELECT * FROM documents WHERE po = ? AND sent_at <= ? ORDER BY sent_at').all(po, T);
const evsOf = (db, po, kind, T) => db.prepare('SELECT * FROM events WHERE po = ? AND kind = ? AND at <= ? ORDER BY at').all(po, kind, T).map((e) => ({ ...e, d: J(e.data) }));
const linesOf = (db, po) => db.prepare('SELECT * FROM order_lines WHERE po = ? ORDER BY line').all(po);
const partiesOf = (db, po) => J(db.prepare("SELECT body FROM documents WHERE po = ? AND doc_type = '850' ORDER BY sent_at").get(po)?.body).parties || {};
const refFree = (db, ref) => (db.prepare('SELECT 1 FROM main.documents WHERE reference = ?').get(ref) ? `${ref}-S` : ref);
let CTL = 900000000;
function x12Doc(db, { type, ref, po, from, to, T, body, answers = null, name }) {
  const ctl = ++CTL; const d = { type, at: T, ref, po, ...body };
  const raw = writeInterchange(d, { isaSender: ISA[from], isaReceiver: ISA[to], ctl });
  const supplier = from === 'NORTHFIELD' ? to : from;
  return { doc_id: `${type}:${ref}:${currentSession() || 'X'}`, reference: ref, po, doc_type: type, name, sender_id: from, receiver_id: to, supplier_id: supplier, partner_id: 'NORTHFIELD', sent_at: T, isa_ctl: ctl, gs_ctl: ctl, st_ctl: '0001', status: 'Delivered', answers_doc_id: answers, test: 0, file: 'session', body: JSON.stringify({ ...d, isa_ctl: ctl, gs_ctl: ctl, st_ctl: '0001', session: currentSession() }), raw };
}
/** The rows a sent document adds to the calculated tables, as the world's build derives them, so every calculated view
 *  (three-way match, scorecards, open-order value, rejections) sees the document in the session that sent it. */
function deriveRows(db, doc, body) {
  const locOf = (gln) => (gln && db.prepare('SELECT id FROM locations WHERE gln = ?').get(gln)?.id) || gln || null;
  if (doc.doc_type === '810') {
    appendRow(db, 'invoices', { invoice: doc.reference, po: doc.po, doc_id: doc.doc_id, sent_at: doc.sent_at, total: body.total, status: doc.status, replaces: body.replaces || null, terms_days: body.terms_days ?? null });
    for (const l of body.lines || []) appendRow(db, 'invoice_lines', { invoice: doc.reference, po: doc.po, line: l.line, qty: l.qty, price: l.price });
  } else if (doc.doc_type === '856') {
    appendRow(db, 'shipments', { shipment_id: doc.reference, po: doc.po, doc_id: doc.doc_id, sent_at: doc.sent_at, shipped_at: body.shipped_at, delivery_date: body.delivery_date || null, cartons: body.carton_count, ship_from: locOf(body.ship_from_gln), ship_to: locOf(body.ship_to_gln), bol: body.bol || null, seal: body.seal || null, complete: 1 });
    for (const l of body.lines || []) appendRow(db, 'shipment_lines', { shipment_id: doc.reference, po: doc.po, line: l.line, sku: l.sku || null, qty: l.qty, uom: l.uom || 'CA' });
  } else if (doc.doc_type === '824') {
    (body.errors || []).forEach((e, i) => appendRow(db, 'errors', { error_id: `${doc.doc_id}:${i + 1}`, doc_id: doc.answers_doc_id, reported_by: doc.doc_id, channel: 'Application advice (824)', code: e.code, cause: e.cause, field: e.seg ? `${e.seg}${e.elem ? String(e.elem).padStart(2, '0') : ''}` : null, sent_value: e.bad ?? null, allowed: e.allowed ?? null, rule_id: TED[e.code]?.rule || null, status: 'Open', corrected_by: null }));
  }
}
const itemOf = (l) => ({ nf_item: l.northfield_item, sku: l.sku, gtin: l.gtin || undefined });

// ---------- Builders: each returns { ok, card } or { ok: false, message } ----------
function buildDispute(db, side, a, T) {
  const c = D.deductionCase(db, String(a.case || a.record || ''), new Date(T)); if (!c.found) return { ok: false, message: c.message };
  const charge = String(a.charge || c.charge).toUpperCase();
  if (db.prepare("SELECT 1 FROM events WHERE kind = 'case.dispute' AND at <= ? AND json_extract(data,'$.case') = ? AND json_extract(data,'$.charge') = ?").get(T, c.case, charge)) return { ok: false, message: `${chargeName(charge)} on ${c.case} is already disputed. Northfield’s guide allows one dispute per deduction (NF-7.3).` };
  const st = Object.fromEntries((c.evidence || []).map((e) => [e.kind, e]));
  const inCase = (k) => st[k]?.state === 'In the case';
  if (charge === 'SH01' && !(inCase('carrier.bill_of_lading') && inCase('carrier.delivery_receipt') && (inCase('wms.load_scan') || inCase('wms.load_tally')))) {
    const missing = (c.evidence || []).filter((e) => e.state !== 'In the case' && e.state !== 'Not found').map((e) => `${e.evidence}: ${e.state}`);
    return { ok: false, message: `Northfield’s guide needs the bill of lading with seal, proof of delivery and a load scan or tally in the case before a shortage dispute (NF-7.4). ${missing.join('; ') || 'The proof is not in the case'}. The owner of each record shares it into the case; Trading Grid sends them nothing.` };
  }
  const amount = charge === c.charge ? (c.dispute_amount ?? c.amount) : Math.abs((c.other_charges_on_this_order || []).find((x) => x.charge === charge)?.amount || 0);
  const evidence = (c.evidence || []).filter((e) => e.state === 'In the case').map((e) => e.evidence);
  const note = a.note ? String(a.note).replace(/[\n\r]/g, ' ').trim().slice(0, 300) : null;
  return { ok: true, card: { record: c.case, po: c.po, to: 'Northfield deduction case', args: { case: c.case, charge, amount, evidence, note },
    detail: { case: c.case, po: c.po, charge: chargeName(charge), amount, evidence, note, decided_by: 'Northfield’s reviewer' } } };
}
function buildRelease(db, side, a, T) {
  const doc = String(a.document || a.record || '').toUpperCase().replace(/\s+DRAFT$/, '');
  const hold = db.prepare("SELECT * FROM events WHERE kind = 'tg.hold' AND at <= ? ORDER BY at").all(T).map((e) => ({ ...e, d: J(e.data) })).filter((e) => String(e.d.document || '').toUpperCase().replace(/\s+DRAFT$/, '') === doc).pop();
  if (!hold) return { ok: false, message: `No held ship notice ${doc} in Trading Grid at this moment.` };
  if (hold.d.released_at && hold.d.released_at <= T) return { ok: false, message: `${doc} was already released at ${fmtET(hold.d.released_at)}.` };
  if (db.prepare("SELECT 1 FROM events WHERE kind = 'tg.release' AND at <= ? AND upper(json_extract(data,'$.document')) = ?").get(T, doc)) return { ok: false, message: `${doc} is already released.` };
  // AP-1.3: release only once every failure on it is fixed, each confirmed by its owner's next record.
  const after = (kind) => db.prepare('SELECT at FROM events WHERE po = ? AND kind = ? AND at > ? AND at <= ? ORDER BY at').get(hold.po, kind, hold.at, T);
  let fixed = true, open = '';
  if (/departure scan/i.test(hold.d.closes_on || '')) { const dep = db.prepare("SELECT at FROM events WHERE po = ? AND kind = 'wms.departure_scan' AND at <= ?").get(hold.po, T); fixed = !!dep; open = `${hold.d.finding}. ${hold.d.owner || 'The owner'} fixes it in ${hold.d.fix_in || 'its own system'}; the hold closes on the ${hold.d.closes_on}`; }
  else if (Array.isArray(hold.d.findings)) { fixed = !!after('erp.correction'); open = hold.d.findings.map((f) => `${f.finding} (${f.owner})`).join('; '); }
  if (!fixed) return { ok: false, message: `${doc} stays held: ${open}. A held ship notice is released only after every failure on it is fixed (AP-1.3).` };
  return { ok: true, card: { record: doc, po: hold.po, to: 'Northfield Retailer', args: { document: doc, po: hold.po },
    detail: { document: doc, document_kind: 'Ship notice', po: hold.po, held_at: fmtET(hold.at), failures_fixed: true } } };
}
function buildDocument(db, side, a, T, type) {
  const po = D.normPo(String(a.po || a.record || '')); const o = ordersOf(db, po); if (!o || o.supplier_id !== 'ASHBY') return { ok: false, message: `No Ashby order ${po}.` };
  const docs = docsOf(db, po, T); const has = (t) => docs.filter((d) => d.doc_type === t);
  if (!has('850').length) return { ok: false, message: `Northfield’s purchase order ${po} has not arrived at this moment.` };
  const parties = partiesOf(db, po); const lines = linesOf(db, po); const base = po.replace(/^NR-/, '');
  if (type === '855') {
    if (has('855').length) return { ok: false, message: `${po} is already acknowledged (${has('855').at(-1).reference}).` };
    const ref = refFree(db, `ACK-${base}`); const body = { lines: lines.map((l) => ({ line: l.line, qty_ordered: l.qty_ordered, qty: l.qty_ordered, price: l.price, code: 'IA', ...itemOf(l) })) };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '855', ref, body }, detail: { document: ref, document_kind: 'Order acknowledgment', po, lines: lines.map((l) => ({ line: l.line, cases: l.qty_ordered, price: l.price })) } } };
  }
  if (type === '865') {
    const ch = has('860').at(-1); if (!ch) return { ok: false, message: `Northfield has sent no order change on ${po}.` };
    if (has('865').some((d) => d.sent_at > ch.sent_at)) return { ok: false, message: `Order change ${ch.reference} on ${po} is already answered.` };
    const seq = J(ch.body).seq || 1; const ref = refFree(db, `CA-${base}-${seq}`);
    const body = { seq, lines: lines.map((l) => ({ line: l.line, qty_ordered: l.qty_ordered, qty: l.qty_ordered, price: l.price, code: 'IA', ...itemOf(l) })) };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '865', ref, body }, detail: { document: ref, document_kind: 'Change acknowledgment', po, order_change: seq, lines: lines.map((l) => ({ line: l.line, cases: l.qty_ordered, price: l.price })) } } };
  }
  if (type === '856') {
    if (has('856').length) return { ok: false, message: `A ship notice for ${po} is already sent (${has('856').at(-1).reference}).` };
    const load = evsOf(db, po, 'wms.load_scan', T).pop(); const dep = evsOf(db, po, 'wms.departure_scan', T).pop();
    if (!dep) return { ok: false, message: `${po} has no departure scan yet. A ship notice is sent after the trailer departs (NF-4.2); the owner’s departure scan confirms it.` };
    if (!load) return { ok: false, message: `${po} has no load scan. A ship notice is built only from the confirmed load scan (AP-1.4).` };
    if (load.d.cartons_loaded !== load.d.cartons_expected) return { ok: false, message: `The load scan shows ${load.d.cartons_loaded} of ${load.d.cartons_expected} cartons. The ship notice is built from what was loaded (AP-1.4); the line split needs the pick detail from the warehouse.` };
    const ref = refFree(db, `ASN-${base}`); const late = (Date.parse(T) - Date.parse(dep.at)) / 3600000 > 1;
    const body = { po_ref: po, carton_count: load.d.cartons_loaded, scac: 'LKLF', shipped_at: dep.at, delivery_date: o.requested_delivery, ship_to_name: parties.ST?.name, ship_to_gln: parties.ST?.gln, ship_from_name: 'Ashby Supplier', ship_from_gln: parties.VN?.gln,
      lines: lines.map((l) => ({ line: l.line, qty: l.qty_accepted ?? l.qty_ordered, uom: 'CA', ...itemOf(l) })) };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '856', ref, body }, detail: { document: ref, document_kind: 'Ship notice', po, cartons: load.d.cartons_loaded, departed: fmtET(dep.at), late, lines: body.lines.map((l) => ({ line: l.line, cases: l.qty })) } } };
  }
  if (type === '810') {
    if (has('810').length) return { ok: false, message: `${po} is already invoiced (${has('810').at(-1).reference}).` };
    const asn = has('856').at(-1); if (!asn) return { ok: false, message: `${po} has no ship notice yet. The invoice bills the shipped quantity (NF-7.8), so it follows the ship notice.` };
    const shipped = (n) => J(asn.body).lines?.filter((l) => l.line === n).reduce((s, l) => s + l.qty, 0) ?? 0;
    const ls = lines.map((l) => ({ line: l.line, qty: shipped(l.line), uom: 'CA', price: l.price, ...itemOf(l) })).filter((l) => l.qty > 0);
    const total = Math.round(ls.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100; const ref = refFree(db, `INV-${base}`);
    const body = { po_ref: po, po_date: o.received_at.slice(0, 10), buyer_name: parties.BY?.name, buyer_gln: parties.BY?.gln, vendor_name: parties.VN?.name, vendor_gln: parties.VN?.gln, terms_days: 30, lines: ls, total };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '810', ref, body }, detail: { document: ref, document_kind: 'Invoice', po, ship_notice: asn.reference, lines: ls.map((l) => ({ line: l.line, cases: l.qty, price: l.price, amount: Math.round(l.qty * l.price * 100) / 100 })), total } } };
  }
  return { ok: false, message: 'Name the document to send: 855, 865, 856 or 810.' };
}
/** Ashby answers Northfield's 824 with a 997 and the corrected document; it does not send an 824 of its own. */
function buildAnswerAdvice(db, side, a, T) {
  let adv = a.advice || a.record ? db.prepare("SELECT * FROM documents WHERE doc_type = '824' AND upper(reference) = ? AND sent_at <= ?").get(String(a.advice || a.record).toUpperCase(), T) : null;
  if (!adv && a.po) adv = db.prepare("SELECT * FROM documents WHERE doc_type = '824' AND po = ? AND receiver_id = 'ASHBY' AND sent_at <= ? ORDER BY sent_at DESC").get(D.normPo(a.po), T);
  if (!adv) adv = db.prepare("SELECT * FROM documents WHERE doc_type = '824' AND receiver_id = 'ASHBY' AND sent_at <= ? ORDER BY sent_at DESC").get(T);
  if (!adv || adv.receiver_id !== 'ASHBY') return { ok: false, message: 'No application advice (824) from Northfield to answer at this moment.' };
  const b = J(adv.body); const rejected = db.prepare('SELECT * FROM documents WHERE reference = ? AND doc_type = ? ORDER BY sent_at DESC').get(b.answers_ref, b.answers_set);
  const ack = db.prepare("SELECT reference FROM documents WHERE doc_type = '997' AND answers_doc_id = ? AND sent_at <= ?").get(adv.doc_id, T);
  const corrected = db.prepare('SELECT reference, sent_at FROM documents WHERE po = ? AND doc_type = ? AND sent_at > ? AND sent_at <= ? ORDER BY sent_at').get(adv.po, b.answers_set, adv.sent_at, T);
  if (corrected && ack) return { ok: false, message: `Northfield’s ${adv.reference} is already answered: 997 ${ack.reference} and corrected ${DOC_NAMES[b.answers_set]} ${corrected.reference}.` };
  if (!rejected || b.answers_set !== '810') return { ok: false, message: `${adv.reference} rejects ${b.answers_ref}. The corrected document is rebuilt from its source record by the step that makes it; Trading Grid sends the 997 for it.` };
  const rb = J(rejected.body); const lines = linesOf(db, adv.po);
  const shippedBy = (n) => db.prepare('SELECT coalesce(sum(qty),0) q FROM shipment_lines WHERE po = ? AND line = ? AND shipment_id IN (SELECT shipment_id FROM shipments WHERE sent_at <= ?)').get(adv.po, n, T).q;
  const ls = (rb.lines || []).map((l) => { const ol = lines.find((x) => x.line === l.line); return { ...l, qty: Math.min(l.qty, shippedBy(l.line)), price: ol ? ol.price : l.price }; });
  const total = Math.round(ls.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100; const ref = refFree(db, `${rejected.reference}C`);
  const body = { po_ref: adv.po, po_date: rb.po_date || null, replaces: rejected.reference, buyer_name: rb.parties?.BY?.name, buyer_gln: rb.parties?.BY?.gln, vendor_name: rb.parties?.VN?.name, vendor_gln: rb.parties?.VN?.gln, terms_days: rb.terms_days ?? 30, lines: ls, total };
  return { ok: true, card: { record: ref, po: adv.po, to: 'Northfield Retailer', args: { advice: adv.reference, po: adv.po, document: '997+810', ref, ack_needed: !ack, body },
    detail: { document: ref, document_kind: 'Corrected invoice', po: adv.po, replaces: rejected.reference, answers_application_advice_on: rejected.reference, sends_technical_acknowledgment: !ack, lines: ls.map((l) => ({ line: l.line, cases: l.qty, price: l.price, amount: Math.round(l.qty * l.price * 100) / 100 })), total } } };
}
/** Northfield's 824 against a document it received: each error coded from its guide, with a plain message in TED02. */
function buildAdvice(db, side, a, T) {
  const ref = String(a.document || a.record || '').toUpperCase();
  const d = db.prepare("SELECT * FROM documents WHERE upper(reference) = ? AND receiver_id = 'NORTHFIELD' AND doc_type IN ('810','856') AND sent_at <= ? ORDER BY sent_at DESC").get(ref, T);
  if (!d) return { ok: false, message: `No invoice or ship notice ${ref} received by Northfield at this moment.` };
  if (db.prepare("SELECT 1 FROM documents WHERE doc_type = '824' AND answers_doc_id = ? AND sent_at <= ?").get(d.doc_id, T)) return { ok: false, message: `${ref} is already rejected with an application advice.` };
  const errors = []; let docLines = [];
  if (d.doc_type === '810') {
    const m = NR.threeWayMatch(db, ref, new Date(T)); if (!m.found) return { ok: false, message: m.message }; docLines = m.lines.filter((l) => l.billed > 0).map((l) => l.line);
    for (const l of m.lines) {
      if (/^quantity/.test(l.origin)) errors.push({ code: 'QTY', seg: 'IT1', elem: '2', bad: String(l.billed), allowed: `${Math.min(l.shipped, l.received)} ${l.received < l.shipped ? 'received' : 'shipped'} on line ${l.line}; held value ${money(l.amount_at_issue)}`, line: l.line,
        billed: l.billed, shipped: l.shipped, received: l.received, held: l.amount_at_issue, plain: `billed ${l.billed} cases; ${l.shipped} shipped and ${l.received} received, ${money(l.amount_at_issue)} held` });
      else if (/^price/.test(l.origin)) errors.push({ code: 'PRC', seg: 'IT1', elem: '4', bad: String(l.invoice_price), allowed: `Order price ${money(l.po_price)} on line ${l.line}`, line: l.line, plain: `billed at ${money(l.invoice_price)} against the order price of ${money(l.po_price)}` });
    }
    const sum = Math.round(m.lines.reduce((s, l) => s + l.billed * (l.invoice_price ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - m.invoice_total) > 0.005) errors.push({ code: 'TOT', seg: 'TDS', elem: '1', bad: String(Math.round(m.invoice_total * 100)), allowed: `Lines add to ${money(sum)}`, plain: `the invoice total of ${money(m.invoice_total)} differs from its lines, which add to ${money(sum)}` });
  } else {
    const o = ordersOf(db, d.po); const b = J(d.body); const st = b.parties?.ST?.name || '';
    const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(o?.ship_to);
    if (loc && st && !st.includes(String(loc.name || '').replace(/^Northfield /, ''))) errors.push({ code: 'STO', seg: 'N1', elem: '2', bad: st, allowed: `Current order ships to ${loc.name}`, plain: `it ships to ${st}; the current order ships to ${loc.name}` });
    if ((b.lines || []).some((l) => l.uom && l.uom !== 'CA')) errors.push({ code: 'UOM', seg: 'SN1', elem: '3', bad: (b.lines.find((l) => l.uom !== 'CA') || {}).uom, allowed: 'Quantities in cases (CA)', plain: 'quantities are not in cases' });
  }
  if (!errors.length) return { ok: false, message: `Northfield’s rules find no error in ${ref} at this moment, so there is nothing to reject.` };
  // TED02 carries the plain message for each error: the guide's cause by default, a message the model drafted for a code,
  // or, above both, the person's own words ("tell Ashby they billed more cases than received"). The person's words go in
  // TED02 of the error they concern, and that error's rule cause moves to a note (NTE). Words over 60 characters go in a
  // note of at most 80 characters instead; longer is refused. A line the words name that the rules do not find is refused.
  const drafted = Object.fromEntries((Array.isArray(a.messages) ? a.messages : []).map((x) => [String(x.code || '').toUpperCase(), String(x.message || '').replace(/[*~>\n\r]/g, ' ').trim()]));
  const note = a.note ? String(a.note).replace(/[*~>\n\r]/g, ' ').replace(/\s+/g, ' ').trim() : null; let noteIn = null; let targets = [];
  // Lines the person named, in the request or in the words: the message belongs to those lines only. A named line the rules
  // find no error on (one the document has, or one it does not have) is refused: no card carries the message.
  const named = [...new Set([...(Array.isArray(a.lines) ? a.lines.map(Number) : []), ...(note && note.match(/\bline\s+(\d+)/i) ? [Number(note.match(/\bline\s+(\d+)/i)[1])] : [])])].filter(Boolean);
  const linesFound = [...new Set(errors.map((e) => e.line).filter(Boolean))];
  if (named.length && note) {
    const bad = named.filter((l) => !linesFound.includes(l));
    if (bad.length) return { ok: false, wrong_line: { said: bad, found: linesFound, missing: bad.filter((l) => !docLines.includes(l)), no_error: bad.filter((l) => docLines.includes(l)) },
      message: `Northfield’s rules find no error on line ${bad.join(' or ')} of ${DOC_NAMES[d.doc_type]} ${ref}${bad.some((l) => !docLines.includes(l)) ? ` (it has no line ${bad.filter((l) => !docLines.includes(l)).join(' or ')})` : ''}. They find errors on line ${linesFound.join(' and ') || 'none'}.` };
  }
  if (note) {
    targets = named.length ? errors.filter((e) => named.includes(e.line))
      : /\breceiv/i.test(note) ? errors.filter((e) => e.billed != null && e.billed > e.received)
      : /\bship/i.test(note) && d.doc_type === '810' ? errors.filter((e) => e.billed != null && e.billed > e.shipped)
      : /\bprice/i.test(note) ? errors.filter((e) => e.code === 'PRC') : /\btotal/i.test(note) ? errors.filter((e) => e.code === 'TOT') : [];
    if (!targets.length) targets = errors; // words that name no line or kind concern every error
    if (note.length > GUIDE_824.nte_max) return { ok: false, message: `The message is ${note.length} characters. The application advice carries at most ${GUIDE_824.ted02_max} in the error message or ${GUIDE_824.nte_max} in a note.` };
    noteIn = note.length <= GUIDE_824.ted02_max ? 'TED02' : 'NTE';
  }
  for (const [code, msg] of Object.entries(drafted)) if (msg.length > GUIDE_824.ted02_max && !(note && errors.filter((e) => e.code === code).every((e) => targets.includes(e)))) return { ok: false, message: `The message for this error is ${msg.length} characters; the application advice allows ${GUIDE_824.ted02_max} in the error message.` };
  for (const e of errors) {
    const cause = drafted[e.code] || TED[e.code].cause; e.rule = TED[e.code].rule; e.notes = [];
    if (targets.includes(e) && noteIn === 'TED02') { e.cause = note; e.notes.push(TED[e.code].cause); }
    else { e.cause = cause; if (targets.includes(e)) e.notes.push(note); }
    if (GUIDE_824.nte_allowed && e.allowed) e.notes.push(e.allowed); else if (!GUIDE_824.nte_allowed) e.notes = [];
    e.notes = e.notes.map((n) => String(n).slice(0, GUIDE_824.nte_max)); }
  const aref = refFree(db, `AA-${ref}`); const who = NAME[d.sender_id] || d.sender_id;
  const body = { action: 'TE', answers_ref: ref, answers_gs: d.gs_ctl, answers_st: d.st_ctl, answers_set: d.doc_type, errors: errors.map(({ code, cause, seg, elem, bad, allowed, notes }) => ({ code, cause, seg, elem, bad, allowed, notes })) };
  const x12 = errors.map((e) => [`TED*${e.code}*${e.cause}*${e.seg}**${e.elem}**${e.bad}`, ...e.notes.map((n) => `NTE*GEN*${n}`)].join('~')).join('~');
  // The card is data: what the 824 rejects, each error's line with billed, shipped, received and the amount held, and the
  // message exactly as the person gave it. Aviator explains it; the server checks that explanation against these fields.
  const lines = errors.map((e) => ({ ...(e.line ? { line: e.line } : {}), problem: TED[e.code].cause, ...(e.billed != null ? { billed: e.billed, shipped: e.shipped, received: e.received, amount_held: e.held } : {}), message: e.cause !== TED[e.code].cause ? e.cause : null }));
  return { ok: true, card: { record: aref, po: d.po, to: who, args: { document: ref, answers: d.doc_id, ref: aref, body, supplier: d.sender_id },
    detail: { rejects: ref, document_kind: DOC_NAMES[d.doc_type], po: d.po, lines },
    message: note ? { text: note, in: noteIn, lines: targets.map((e) => e.line).filter(Boolean) } : null, x12_preview: x12 } };
}
function buildDecision(db, side, a, T) {
  const c = NR.caseNF(db, String(a.case || a.record || ''), new Date(T)); if (!c.found) return { ok: false, message: c.message };
  const charge = String(a.charge || c.charge).toUpperCase(); const decision = /uphold/i.test(a.decision || '') ? 'Upheld' : /revers/i.test(a.decision || '') ? 'Reversed' : null;
  if (!decision) return { ok: false, message: 'Say whether to reverse or uphold the charge.' };
  if (!c.disputes.some((d) => d.charge === charge)) return { ok: false, message: `The ${chargeName(charge)} on ${c.case} has not been disputed; Jordan Ellis decides a charge once it is disputed (NF-7.7).` };
  if (c.decisions.some((d) => d.charge === charge)) return { ok: false, message: `The ${chargeName(charge)} on ${c.case} is already decided.` };
  const amount = c.disputes.filter((d) => d.charge === charge).at(-1).amount; const rec = c.review_agent?.charge === charge ? c.review_agent : null;
  const reason = String(a.reason || rec?.reason || '').slice(0, 300) || null;
  return { ok: true, card: { record: c.case, po: c.po, to: `${c.supplier} (deduction case)`, args: { case: c.case, po: c.po, charge, decision, amount, reason, recommended: rec?.next_step || null },
    detail: { case: c.case, po: c.po, charge: chargeName(charge), amount, decision, reason, repayment_on_next_remittance: decision === 'Reversed' } } };
}
function buildChargeback(db, side, a, T) {
  const po = D.normPo(String(a.po || a.record || '')); const miss = evsOf(db, po, 'carrier.pickup_missed', T).pop();
  if (!miss) return { ok: false, message: `Lakeline reports no missed pickup on ${po} at this moment, so there is no readiness chargeback to decide.` };
  if (db.prepare("SELECT 1 FROM events WHERE po = ? AND at <= ? AND ((kind = 'case.opened' AND json_extract(data,'$.charge') = 'RT01') OR kind = 'compliance.chargeback_waived')").get(po, T)) return { ok: false, message: `The readiness chargeback on ${po} is already decided.` };
  const decision = /waive/i.test(a.decision || '') ? 'Waive' : /apply|approve|charge/i.test(a.decision || '') ? 'Apply' : null; if (!decision) return { ok: false, message: 'Say whether to apply or waive the chargeback.' };
  const amount = D.chargeOf(db, 'RT01'); const sup = ordersOf(db, po)?.supplier_id; const caseId = `DC-R${po.replace(/^NR-/, '')}`;
  return { ok: true, card: { record: decision === 'Apply' ? caseId : po, po, to: decision === 'Apply' ? `${NAME[sup] || sup} (deduction case)` : 'Northfield compliance record', args: { po, decision, amount, case: caseId, supplier: sup, assigned_pickup: miss.d.assigned_pickup },
    detail: { po, amount, decision, opens_case: decision === 'Apply' ? caseId : null, supplier: NAME[sup] || sup, carrier_status: 'Not ready at assigned pickup' } } };
}
function buildPublish(db, side, a, T) {
  const id = String(a.draft || a.record || '').toUpperCase(); const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(id);
  if (!d) return { ok: false, message: `No draft rule ${id}.` };
  if (d.state !== 'Draft') return { ok: false, message: `${id} is already ${d.state.toLowerCase()}.` };
  const r = NR.replayRule(db, { draft: id, as_of: T }); if (!r || r.found === false) return { ok: false, message: r?.message || `${id} could not be replayed.` };
  const fails = r.failing_with_draft ?? r.failing ?? null; const exposure = r.added_exposure ?? null;
  return { ok: true, card: { record: id, po: null, to: 'Every Northfield supplier', args: { draft: id, replay: { failing_with_draft: fails, added_exposure: exposure } },
    detail: { draft: id, statement: d.statement, replay: { failing: fails, added_exposure: exposure } } } };
}
const BUILD = { open_dispute: buildDispute, release_held_ship_notice: buildRelease, send_acknowledgment: (db, s, a, T) => buildDocument(db, s, a, T, '855'), answer_order_change: (db, s, a, T) => buildDocument(db, s, a, T, '865'),
  send_ship_notice: (db, s, a, T) => buildDocument(db, s, a, T, '856'), send_invoice: (db, s, a, T) => buildDocument(db, s, a, T, '810'), answer_application_advice: buildAnswerAdvice,
  send_application_advice: buildAdvice, decide_charge: buildDecision, decide_chargeback: buildChargeback, publish_rule: buildPublish };

/** Builds the card for one action on one side at one moment, or says plainly why there is none. */
export function buildCard(db, side, action, args = {}, T) {
  const def = CARD_ACTIONS[side]?.[action]; if (!def) return { ok: false, message: `${action} is not something ${side === 'ashby' ? 'Ashby' : 'Northfield'} does in Trading Grid.` };
  let r; try { r = BUILD[action](db, side, args || {}, at(T)); } catch (e) { return { ok: false, message: `The records do not support this action: ${String(e.message).slice(0, 160)}` }; }
  if (!r.ok) return r;
  return { ok: true, card: { action, write: def.write, side, rule: def.rule, approver: PERSON[side], buttons: ['Approve', 'Cancel'], at: at(T), ...r.card } };
}

// A reference to a record: letters, then parts, with a number (NR-450118, INV-7731C, RCV-DC2-77290, AA-INV-7731, PMT-990412).
// A rule code (NF-7.8) is caught by the code check instead.
export const REF_RE = /\b[A-Z]{2,5}(?:-[A-Z0-9]+)*-\d[A-Z0-9]*(?:-[A-Z0-9]+)*\b(?!\.\d)/g;
/** Checks Aviator's answer, which the model writes, against the cards it raised and the records it read this turn. Returns
 *  the failures as { id, text }, empty when it holds; the server sends the texts back to the model to answer again and
 *  never rewrites the answer. Checks, by id:
 *  empty · code (rule, charge or unit code, field name, record kind) · markdown · quote (a quoted phrase on no card, in no
 *  tool result and not in the question) · reference (a record reference no tool returned this turn) · amount (a dollar
 *  amount on no card and in no tool result) · done (says an action is done) · line (a line on no card and in no tool result) · message (a card's message not
 *  given word for word) · no_message (claims a message the card does not carry) · refused_line (does not say which lines
 *  the rules found when the person named another) · approve (does not say nothing happens until Approve) · no_card
 *  (describes a card that was not raised) · owner, outside (an outside-Trading-Grid reply without the owner or the words)
 *  · expected (the records call for a card the model did not raise). */
export function checkAnswer(answer, { cards = [], results = [], outside = null, expect = null, codes = [], question = '' } = {}) {
  const text = String(answer || ''); const out = []; const fail = (id, t) => { if (!out.some((x) => x.id === id && x.text === t)) out.push({ id, text: t }); };
  if (!text.trim() || text.trim() === 'No answer.') return [{ id: 'empty', text: 'The answer is empty. Answer the question from the tool results.' }];
  const fieldsOf = (c) => JSON.stringify({ to: c.to, record: c.record, detail: c.detail, message: c.message, rule: c.rule_text, offered: c.offered, x12: c.x12_preview });
  const raw = `${cards.map(fieldsOf).join(' ')} ${JSON.stringify(results)} ${question}`;
  const hay = raw.toLowerCase().replace(/\\[nrt]|\s+/g, ' ');
  const cardHay = cards.map(fieldsOf).join(' ').toLowerCase().replace(/\s+/g, ' ');
  const code = text.match(/\b(?:NF|AP|AM|KX)-\d+(?:\.\d+)?\b|\b[A-Z]{2}\d{2}\b(?!-)|\b\d[\d,]*\s*(?:CA|EA)\b|\b[a-z]+_[a-z_]+\b|\b(?:wms|carrier|erp|tg|case|rule)\.[a-z_]+\b/);
  if (code && !codes.includes(code[0])) fail('code', `It contains "${code[0]}". Write plain words: say whose rule it is, the charge by name, cases or each, and records by their reference and what they are; no codes or field names.`);
  if (/\*\*|^#+ |^\s*[-*] /m.test(text)) fail('markdown', 'It uses markdown. Write plain sentences.');
  for (const m of text.matchAll(/["“]([^"”]{3,})["”]/g)) if (!hay.includes(m[1].toLowerCase().replace(/\s+/g, ' ').replace(/[.]$/, ''))) fail('quote', `It quotes "${m[1]}", which is on no card, in no tool result and not in the question. Quote only what the card or the records hold.`);
  // Every record it names must have been returned by a tool call in this turn: no reference is made up or recalled.
  const returned = `${cards.map(fieldsOf).join(' ')} ${JSON.stringify(results)}`; for (const m of new Set(text.match(REF_RE) || [])) if (!returned.includes(m)) fail('reference', `It names ${m}, which no tool returned in this turn. Name only records the tools returned; read the record first if you need it.`);
  for (const m of text.matchAll(/\$\s?(\d[\d,]*(?:\.\d\d)?)/g)) { const n = m[1].replace(/,/g, ''); const v = Number(n);
    if (!hay.includes(n) && !hay.includes(v.toFixed(2)) && !hay.includes(String(v)) && !hay.includes(m[1])) fail('amount', `It gives $${m[1]}, which is on no card and in no tool result. Give amounts as the records state them.`); }
  if (new RegExp(`\\b(?:${cards.length ? '(?:has|have) been (?:sent|released|published|submitted|approved)|is now (?:sent|released|published)|' : ''}I(?:'ve| have)? (?:sent|rejected|released|published|opened|applied|waived|reversed|upheld|submitted|disputed|filed|issued)|we(?:'ve| have)? (?:sent|released|published|submitted))\\b`, 'i').test(text)) fail('done', 'It says an action is done. Nothing happens until the person presses Approve on the card; say the card is ready.');
  for (const m of text.matchAll(/\bline (\d+)\b/gi)) if (!new RegExp(`"line":${m[1]}\\b|line ${m[1]}\\b|"asked_lines?":\\[?[\\d,]*\\b${m[1]}\\b`).test(hay)) fail('line', `It names line ${m[1]}, which is on no card and in no tool result.`);
  if (cards.length) {
    for (const c of cards) {
      if (c.message && !text.toLowerCase().includes(c.message.text.toLowerCase())) fail('message', `The card carries the message "${c.message.text}" exactly; give it word for word.`);
      if (!c.message && /\b(?:with|includes?|including|carries|carrying|adds?) (?:your|the) (?:message|note|words)\b|\b(?:your|the) (?:message|note) (?:is|was) (?:included|added|in)\b/i.test(text)) fail('no_message', 'It says the card carries a message; this card carries none.');
      if (c.offered && !c.offered.lines.every((l) => new RegExp(`\\bline ${l}\\b|\\blines?\\b[^.]*\\b${l}\\b`, 'i').test(text))) fail('refused_line', `The person named line ${c.offered.asked_lines.join(' and ')}, where the rules find no error${c.offered.missing.length ? ` (the invoice has no line ${c.offered.missing.join(' or ')})` : ''}. Say so, name the lines the rules found (${c.offered.lines.map((l) => `line ${l}`).join(' and ')}), and say the card is for those lines and carries no message until the person gives one.`);
    }
    if (!/\bapprove/i.test(text)) fail('approve', 'Say that nothing happens until the person presses Approve on the card.');
  } else if (/\b(?:card (?:is )?ready|the card below|press(?:es)? Approve)\b/i.test(text)) fail('no_card', 'It describes a card, but no card was raised. Call propose_action, or say why there is no card.');
  if (outside) { if (!text.includes(outside.owner)) fail('owner', `Name the owner: ${outside.owner}, in ${outside.where}.`); if (!/outside Trading Grid/i.test(text)) fail('outside', 'Say plainly that this is done outside Trading Grid.'); }
  if (expect && !cards.some((c) => c.action === expect.action) && !expect.refused) fail('expected', expect.reason);
  return out;
}

/** Makes the write a card describes, at the card's moment, in the session in force. Returns the record written. */
export function applyCard(db, card, by) {
  const a = card.args; const T = card.at; const side = card.side; const party = SIDE_PARTY[side];
  const ev = (kind, po, data, system = 'Trading Grid') => appendEvent(db, { at: T, kind, po, system, party, channel: 'Trading Grid', data: JSON.stringify({ ...data, via: 'action card', card: card.id, pressed_by: by }) });
  switch (card.action) {
    case 'open_dispute': return { event: ev('case.dispute', card.po, { case: a.case, charge: a.charge, amount: a.amount, evidence: a.evidence, ...(a.note ? { note: a.note } : {}), approved_by: by, rule: 'AP-4.1' }, 'Northfield deduction case') };
    case 'release_held_ship_notice': return { event: ev('tg.release', a.po, { document: a.document, state: 'Released', rule: 'AP-1.3', released_by: by }) };
    case 'send_acknowledgment': case 'answer_order_change': case 'send_ship_notice': case 'send_invoice': {
      const doc = x12Doc(db, { type: a.document, ref: a.ref, po: a.po, from: 'ASHBY', to: 'NORTHFIELD', T, body: a.body, name: { 855: 'Order acknowledgment', 865: 'Change acknowledgment', 856: 'Ship notice', 810: 'Invoice' }[a.document] });
      appendDocument(db, doc); deriveRows(db, doc, a.body); return { document: doc.reference, event: ev('tg.sent', a.po, { document: doc.reference, set: a.document, sent_by: by }) }; }
    case 'answer_application_advice': {
      const adv = db.prepare("SELECT * FROM documents WHERE doc_type = '824' AND reference = ?").get(a.advice); const out = {};
      if (a.ack_needed && adv) { const ack = x12Doc(db, { type: '997', ref: `FA-${adv.reference}`, po: a.po, from: 'ASHBY', to: 'NORTHFIELD', T, answers: adv.doc_id, name: 'Technical acknowledgment', body: { group_id: FUNC['824'], group_ctl: adv.gs_ctl, set_id: '824', set_ctl: adv.st_ctl, result: 'A' } }); appendDocument(db, ack); out.acknowledgment = ack.reference; }
      const inv = x12Doc(db, { type: '810', ref: a.ref, po: a.po, from: 'ASHBY', to: 'NORTHFIELD', T: new Date(Date.parse(T) + 60000).toISOString(), body: a.body, name: 'Invoice' });
      appendDocument(db, inv); deriveRows(db, inv, a.body); out.document = inv.reference;
      // In the viewer's session the correction closes the advice: its open errors read Corrected by this invoice, and the
      // original invoice reads Replaced. Recorded rows and other viewers are unchanged.
      if (adv) { for (const e of db.prepare("SELECT error_id FROM errors WHERE reported_by = ? AND status = 'Open'").all(adv.doc_id)) overlayRow(db, 'errors', e.error_id, { status: 'Corrected', corrected_by: inv.doc_id });
        overlayRow(db, 'invoices', a.body.replaces, { status: `Replaced by ${inv.reference}` }); } out.event = ev('tg.sent', a.po, { document: inv.reference, set: '810', replaces: a.body.replaces, answers: a.advice, sent_by: by }); return out; }
    case 'send_application_advice': {
      const doc = x12Doc(db, { type: '824', ref: a.ref, po: card.po, from: 'NORTHFIELD', to: a.supplier, T, answers: a.answers, body: a.body, name: 'Application advice' });
      appendDocument(db, doc); deriveRows(db, doc, a.body); return { document: doc.reference, event: ev('tg.sent', card.po, { document: doc.reference, set: '824', rejects: a.document, approved_by: by }) }; }
    case 'decide_charge': return { event: ev('case.decision', a.po, { case: a.case, charge: a.charge, amount: a.amount, decision: a.decision, decided_by: by, reason: a.reason, recommended_by: a.recommended ? 'Northfield’s evidence rules' : null }, 'Northfield deduction case') };
    case 'decide_chargeback': return a.decision === 'Apply'
      ? { case: a.case, event: ev('case.opened', a.po, { case: a.case, charge: 'RT01', amount: a.amount, deduction: null, opened_by: by, basis: `Lakeline reports the collect load not ready at the assigned pickup ${fmtET(a.assigned_pickup)}`, dispute_deadline: new Date(Date.parse(T) + 60 * 86400000).toISOString().slice(0, 10) }, 'Northfield deduction case') }
      : { event: ev('compliance.chargeback_waived', a.po, { charge: 'RT01', amount: a.amount, waived_by: by }, 'Northfield compliance record') };
    case 'publish_rule': return { event: ev('rule.published', null, { draft: a.draft, published_by: by, replay: a.replay, rule: 'NF-11.1' }, 'Northfield supplier guide') };
  }
  throw new Error(`No write for ${card.action}`);
}

/** The read that shows the record after the write: the side's own tool, on the same record, at the card's moment. */
export function rereadOf(card, result) {
  const T = card.at; const a = card.args;
  switch (card.action) {
    case 'open_dispute': return ['get_deduction_case', { case: a.case, as_of: T }];
    case 'release_held_ship_notice': return ['get_order', { po: a.po, as_of: T }];
    case 'send_acknowledgment': case 'answer_order_change': case 'send_ship_notice': case 'send_invoice': case 'answer_application_advice': return ['get_document', { reference: result.document }];
    case 'send_application_advice': return ['get_document', { reference: result.document }];
    case 'decide_charge': return ['review_deduction_case', { case: a.case, as_of: T }];
    case 'decide_chargeback': return a.decision === 'Apply' ? ['review_deduction_case', { case: a.case, as_of: T }] : ['supplier_document_trail', { po: a.po, as_of: T }];
    case 'publish_rule': return ['list_draft_rules', {}];
  }
  return null;
}
