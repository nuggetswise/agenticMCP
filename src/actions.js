// Action cards: what Aviator, or a connected assistant, may ask a person to approve. The server builds every card from the
// side's own rules and the records at the moment, never from the model's words: the model names an action and a record, the
// server checks it against the rules and writes the plain sentence that says what happens, to whom and under which rule.
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
import { appendEvent, appendDocument, appendRow, currentSession } from './session.js';

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
  return { action: c.action, args: ref ? { [c.arg]: ref.toUpperCase() } : {}, note: note ? note[0].toUpperCase() + note.slice(1) : null };
}
/** A request Trading Grid does not carry: an email, call or instruction to someone, or a change in another company's system. */
export function outsideTradingGrid(q, side) {
  const t = String(q || ''); if (carriedMessage(t, side)) return null;
  const asksSend = OUTSIDE.test(t) && /\b(can you|could you|please|send|write|draft|go|would you)\b|^\s*\w+\b/i.test(t);
  const otherSystem = /\b(change|update|edit|fix|correct|cancel|delete|create|post|adjust)\b.*\b(supplier erp|netsuite|erp|wms|warehouse system|(kinross|lakeline|northfield|ashby)(’s|'s)? (own )?(system|systems|erp|wms|portal|inventory|ordering system))\b/i.test(t);
  const thisSidesDoc = /\b(855|856|810|865|824|997|ship notice|invoice|acknowledg|application advice|dispute|chargeback|deduction|rule)\b/i.test(t) && !OUTSIDE.test(t);
  if (!(OUTSIDE.test(t) && asksSend) && !(otherSystem && !thisSidesDoc)) return null;
  const hit = OWNERS.find(([re]) => re.test(t)); const [, who, where] = hit || [null, side === 'ashby' ? 'the person who owns it' : 'the owner of the record', 'their own system'];
  return { answer: `That is done outside Trading Grid. Trading Grid sends only business documents and records decisions in its own workflows; it does not ${/\b(call|phone|ring)\b/i.test(t) ? 'make calls' : 'send emails, messages or instructions'}, and it changes nothing in a company’s own system. ${who} owns it, in ${where}.`, owner: who, where };
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
    says: `Open a dispute of the ${chargeName(charge)} of ${money(amount)} on ${c.case} in Northfield’s deduction case, with ${evidence.join(', ') || 'the case evidence'}${note ? `, noting "${note}"` : ''}. Northfield’s reviewer decides it (NF-7.7).` } };
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
    says: `Release ship notice ${doc} for ${hold.po} to Northfield. Every failure that held it is fixed and confirmed by its owner’s record. Priya Raman releases it (AP-1.3).` } };
}
function buildDocument(db, side, a, T, type) {
  const po = D.normPo(String(a.po || a.record || '')); const o = ordersOf(db, po); if (!o || o.supplier_id !== 'ASHBY') return { ok: false, message: `No Ashby order ${po}.` };
  const docs = docsOf(db, po, T); const has = (t) => docs.filter((d) => d.doc_type === t);
  if (!has('850').length) return { ok: false, message: `Northfield’s purchase order ${po} has not arrived at this moment.` };
  const parties = partiesOf(db, po); const lines = linesOf(db, po); const base = po.replace(/^NR-/, '');
  if (type === '855') {
    if (has('855').length) return { ok: false, message: `${po} is already acknowledged (${has('855').at(-1).reference}).` };
    const ref = refFree(db, `ACK-${base}`); const body = { lines: lines.map((l) => ({ line: l.line, qty_ordered: l.qty_ordered, qty: l.qty_ordered, price: l.price, code: 'IA', ...itemOf(l) })) };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '855', ref, body }, says: `Send order acknowledgment ${ref} to Northfield, accepting ${lines.map((l) => `line ${l.line} at ${l.qty_ordered} cases`).join(', ')} at the order prices (NF-1.4).` } };
  }
  if (type === '865') {
    const ch = has('860').at(-1); if (!ch) return { ok: false, message: `Northfield has sent no order change on ${po}.` };
    if (has('865').some((d) => d.sent_at > ch.sent_at)) return { ok: false, message: `Order change ${ch.reference} on ${po} is already answered.` };
    const seq = J(ch.body).seq || 1; const ref = refFree(db, `CA-${base}-${seq}`);
    const body = { seq, lines: lines.map((l) => ({ line: l.line, qty_ordered: l.qty_ordered, qty: l.qty_ordered, price: l.price, code: 'IA', ...itemOf(l) })) };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '865', ref, body }, says: `Send change acknowledgment ${ref} to Northfield, accepting order change ${seq} on ${po}: ${lines.map((l) => `line ${l.line} at ${l.qty_ordered} cases`).join(', ')} (NF-1.6).` } };
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
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '856', ref, body }, says: `Send ship notice ${ref} for ${po} to Northfield, built from the load scan of ${load.d.cartons_loaded} cartons and the departure at ${fmtET(dep.at).slice(11)}${late ? '. It is more than an hour after departure, so it stays Late (NF-4.2)' : ' (NF-4.2)'}.` } };
  }
  if (type === '810') {
    if (has('810').length) return { ok: false, message: `${po} is already invoiced (${has('810').at(-1).reference}).` };
    const asn = has('856').at(-1); if (!asn) return { ok: false, message: `${po} has no ship notice yet. The invoice bills the shipped quantity (NF-7.8), so it follows the ship notice.` };
    const shipped = (n) => J(asn.body).lines?.filter((l) => l.line === n).reduce((s, l) => s + l.qty, 0) ?? 0;
    const ls = lines.map((l) => ({ line: l.line, qty: shipped(l.line), uom: 'CA', price: l.price, ...itemOf(l) })).filter((l) => l.qty > 0);
    const total = Math.round(ls.reduce((s, l) => s + l.qty * l.price, 0) * 100) / 100; const ref = refFree(db, `INV-${base}`);
    const body = { po_ref: po, po_date: o.received_at.slice(0, 10), buyer_name: parties.BY?.name, buyer_gln: parties.BY?.gln, vendor_name: parties.VN?.name, vendor_gln: parties.VN?.gln, terms_days: 30, lines: ls, total };
    return { ok: true, card: { record: ref, po, to: 'Northfield Retailer', args: { po, document: '810', ref, body }, says: `Send invoice ${ref} for ${po} to Northfield: ${ls.map((l) => `line ${l.line}, ${l.qty} cases at ${money(l.price)}`).join('; ')}, ${money(total)} in all, the quantity on ship notice ${asn.reference} (NF-7.8).` } };
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
    says: `Ashby does not send an application advice here: Northfield’s ${adv.reference} rejects invoice ${rejected.reference}. Send ${ack ? '' : `the technical acknowledgment (997) of ${adv.reference} and `}corrected invoice ${ref} replacing ${rejected.reference}: ${ls.map((l) => `line ${l.line} at ${l.qty} cases`).join(', ')}, ${money(total)} (NF-7.2).` } };
}
/** Northfield's 824 against a document it received: each error coded from its guide, with a plain message in TED02. */
function buildAdvice(db, side, a, T) {
  const ref = String(a.document || a.record || '').toUpperCase();
  const d = db.prepare("SELECT * FROM documents WHERE upper(reference) = ? AND receiver_id = 'NORTHFIELD' AND doc_type IN ('810','856') AND sent_at <= ? ORDER BY sent_at DESC").get(ref, T);
  if (!d) return { ok: false, message: `No invoice or ship notice ${ref} received by Northfield at this moment.` };
  if (db.prepare("SELECT 1 FROM documents WHERE doc_type = '824' AND answers_doc_id = ? AND sent_at <= ?").get(d.doc_id, T)) return { ok: false, message: `${ref} is already rejected with an application advice.` };
  const errors = [];
  if (d.doc_type === '810') {
    const m = NR.threeWayMatch(db, ref, new Date(T)); if (!m.found) return { ok: false, message: m.message };
    for (const l of m.lines) {
      if (/^quantity/.test(l.origin)) errors.push({ code: 'QTY', seg: 'IT1', elem: '2', bad: String(l.billed), allowed: `${Math.min(l.shipped, l.received)} ${l.received < l.shipped ? 'received' : 'shipped'} on line ${l.line}; held value ${money(l.amount_at_issue)}`, line: l.line });
      else if (/^price/.test(l.origin)) errors.push({ code: 'PRC', seg: 'IT1', elem: '4', bad: String(l.invoice_price), allowed: `Order price ${money(l.po_price)} on line ${l.line}`, line: l.line });
    }
    const sum = Math.round(m.lines.reduce((s, l) => s + l.billed * (l.invoice_price ?? 0), 0) * 100) / 100;
    if (Math.abs(sum - m.invoice_total) > 0.005) errors.push({ code: 'TOT', seg: 'TDS', elem: '1', bad: String(Math.round(m.invoice_total * 100)), allowed: `Lines add to ${money(sum)}` });
  } else {
    const o = ordersOf(db, d.po); const b = J(d.body); const st = b.parties?.ST?.name || '';
    const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(o?.ship_to);
    if (loc && st && !st.includes(String(loc.name || '').replace(/^Northfield /, ''))) errors.push({ code: 'STO', seg: 'N1', elem: '2', bad: st, allowed: `Current order ships to ${loc.name}` });
    if ((b.lines || []).some((l) => l.uom && l.uom !== 'CA')) errors.push({ code: 'UOM', seg: 'SN1', elem: '3', bad: (b.lines.find((l) => l.uom !== 'CA') || {}).uom, allowed: 'Quantities in cases (CA)' });
  }
  if (!errors.length) return { ok: false, message: `Northfield’s rules find no error in ${ref} at this moment, so there is nothing to reject.` };
  // TED02: the plain message. The guide's cause by default; a message drafted for the person must stay plain and within 60 characters.
  const drafted = Object.fromEntries((Array.isArray(a.messages) ? a.messages : []).map((x) => [String(x.code || '').toUpperCase(), String(x.message || '').replace(/[*~>\n\r]/g, ' ').trim()]));
  // A message the person gave in words ("tell Ashby line 3 is overbilled") goes on the first error: in TED02 when it fits
  // 60 characters, else as a note (NTE) of at most 80 characters, which Northfield's guide allows.
  const note = a.note ? String(a.note).replace(/[*~>\n\r]/g, ' ').trim() : null; let noteIn = null;
  if (note && !Object.keys(drafted).length) { if (note.length <= GUIDE_824.ted02_max) { drafted[errors[0].code] = note; noteIn = 'TED02'; }
    else if (GUIDE_824.nte_allowed && note.length <= GUIDE_824.nte_max) { errors[0].note = note; noteIn = 'NTE'; }
    else return { ok: false, message: `The message is ${note.length} characters; the application advice carries at most ${GUIDE_824.ted02_max} in the error (TED02) or ${GUIDE_824.nte_max} in a note (NTE).` }; }
  for (const e of errors) { const msg = drafted[e.code] || TED[e.code].cause; if (msg.length > GUIDE_824.ted02_max) return { ok: false, message: `The message for ${e.code} is ${msg.length} characters; the application advice allows ${GUIDE_824.ted02_max} (TED02).` }; e.cause = msg; e.rule = TED[e.code].rule; if (!GUIDE_824.nte_allowed) e.allowed = null; }
  const b = J(d.body); const aref = refFree(db, `AA-${ref}`);
  const body = { action: 'TE', answers_ref: ref, answers_gs: d.gs_ctl, answers_st: d.st_ctl, answers_set: d.doc_type, errors: errors.map(({ code, cause, seg, elem, bad, allowed, note: n }) => ({ code, cause, seg, elem, bad, allowed, ...(n ? { note: n } : {}) })) };
  // Where the person's words name a line the rules do not find in error, the card says so beside the message.
  const lineSaid = note && note.match(/\bline\s+(\d+)/i)?.[1]; const linesFound = errors.map((e) => e.line).filter(Boolean);
  const mismatch = lineSaid && linesFound.length && !linesFound.includes(Number(lineSaid)) ? ` Northfield’s rules find the error on line ${linesFound.join(', ')}, not line ${lineSaid}.` : '';
  return { ok: true, card: { record: aref, po: d.po, to: NAME[d.sender_id] || d.sender_id, args: { document: ref, answers: d.doc_id, ref: aref, body, supplier: d.sender_id },
    says: `Send application advice ${aref} to ${NAME[d.sender_id] || d.sender_id}, rejecting ${DOC_NAMES[d.doc_type]} ${ref}: ${errors.map((e) => `${e.code} "${e.cause}"${e.allowed ? ` (${e.allowed})` : ''}${e.note ? `, note "${e.note}"` : ''}`).join('; ')}.${mismatch} ${NAME[d.sender_id] || 'The supplier'} answers with a 997 and the corrected document (${[...new Set(errors.map((e) => e.rule))].join(', ')}).`,
    message: note ? { text: note, in: noteIn } : null,
    x12_preview: errors.map((e) => `TED*${e.code}*${e.cause}*${e.seg}**${e.elem}**${e.bad}${e.allowed ? `~NTE*GEN*${String(e.allowed).slice(0, GUIDE_824.nte_max)}` : ''}${e.note ? `~NTE*GEN*${e.note}` : ''}`).join('~') } };
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
    says: `${decision === 'Reversed' ? 'Reverse' : 'Uphold'} the ${chargeName(charge)} of ${money(amount)} on ${c.case}${reason ? `: ${reason}` : ''}. ${decision === 'Reversed' ? 'The repayment follows on Northfield’s next remittance (NF-7.6). ' : ''}Jordan Ellis decides it (NF-7.7).` } };
}
function buildChargeback(db, side, a, T) {
  const po = D.normPo(String(a.po || a.record || '')); const miss = evsOf(db, po, 'carrier.pickup_missed', T).pop();
  if (!miss) return { ok: false, message: `Lakeline reports no missed pickup on ${po} at this moment, so there is no readiness chargeback to decide.` };
  if (db.prepare("SELECT 1 FROM events WHERE po = ? AND at <= ? AND ((kind = 'case.opened' AND json_extract(data,'$.charge') = 'RT01') OR kind = 'compliance.chargeback_waived')").get(po, T)) return { ok: false, message: `The readiness chargeback on ${po} is already decided.` };
  const decision = /waive/i.test(a.decision || '') ? 'Waive' : /apply|approve|charge/i.test(a.decision || '') ? 'Apply' : null; if (!decision) return { ok: false, message: 'Say whether to apply or waive the chargeback.' };
  const amount = D.chargeOf(db, 'RT01'); const sup = ordersOf(db, po)?.supplier_id; const caseId = `DC-R${po.replace(/^NR-/, '')}`;
  return { ok: true, card: { record: decision === 'Apply' ? caseId : po, po, to: decision === 'Apply' ? `${NAME[sup] || sup} (deduction case)` : 'Northfield compliance record', args: { po, decision, amount, case: caseId, supplier: sup, assigned_pickup: miss.d.assigned_pickup },
    says: decision === 'Apply' ? `Apply the ${money(amount)} readiness chargeback on ${po}: Lakeline reports the collect load not ready at the assigned pickup (NF-3.6). This opens deduction case ${caseId} in Trading Grid, visible to ${NAME[sup] || 'the supplier'} with the carrier status attached.` : `Waive the readiness chargeback on ${po}. Trading Grid records the waiver with Jordan Ellis’s name; no case is opened (NF-3.6).` } };
}
function buildPublish(db, side, a, T) {
  const id = String(a.draft || a.record || '').toUpperCase(); const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(id);
  if (!d) return { ok: false, message: `No draft rule ${id}.` };
  if (d.state !== 'Draft') return { ok: false, message: `${id} is already ${d.state.toLowerCase()}.` };
  const r = NR.replayRule(db, { draft: id, as_of: T }); if (!r || r.found === false) return { ok: false, message: r?.message || `${id} could not be replayed.` };
  const fails = r.failing_with_draft ?? r.failing ?? null; const exposure = r.added_exposure ?? null;
  return { ok: true, card: { record: id, po: null, to: 'Every Northfield supplier', args: { draft: id, replay: { failing_with_draft: fails, added_exposure: exposure } },
    says: `Publish ${id} to suppliers: “${d.statement}”. Replayed against the quarter, it ${fails != null ? `fails ${typeof fails === 'object' ? JSON.stringify(fails) : fails} documents` : 'was checked'}${exposure != null ? ` and adds ${typeof exposure === 'number' ? money(exposure) : JSON.stringify(exposure)} in exposure` : ''}. A rule is published only after its replay (NF-11.1).` } };
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
      appendDocument(db, inv); deriveRows(db, inv, a.body); out.document = inv.reference; out.event = ev('tg.sent', a.po, { document: inv.reference, set: '810', replaces: a.body.replaces, answers: a.advice, sent_by: by }); return out; }
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
