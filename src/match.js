// Match Agent runtime for P14 (invoice variance investigation), on Northfield's connection, acting for Jordan Ellis.
// A session branches Northfield's records (build/northfield.db) at the P14 story moment, hides every record dated after the
// session clock, and keeps its own writes in memory, so nothing it does reaches the recorded world.
// Actors in a session, named in the trace:
//   Rule engine  - fixed checks (NF-7.8, NF-7.10, NF-7.11 holds) and the line evaluation every read and action uses.
//   Match Agent  - a model choosing which read tools to call and which permitted action to propose (runMatch).
//   Jordan Ellis - approves or rejects a proposal; the server, not the model, decides when his approval is required.
//   Ashby (synthetic) - a deterministic simulator answering an application advice (824) by explicit rules.
//                Ashby's recorded corrected invoice is revealed instead when the facts keep it and the clock passes its time.
// A rule baseline (runBaseline) uses the same reads and actions, so the two can be compared on the same state.
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { declarations, modelArgs } from './aviator.js';

const MIN = 60000, H = 3600000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const iso = (ms) => new Date(ms).toISOString();
const J = (s) => (s ? JSON.parse(s) : {});
const r2 = (x) => Math.round(x * 100) / 100;
const SESSIONS = new Map(); const MAX_SESSIONS = 60;
const HOLD_RULES = ['NF-7.8', 'NF-7.10', 'NF-7.11'];

// ---------- Policy: what each action needs, and what no one may change ----------
// mode: 'suggest' (the agent may only suggest; a person does it), 'approve' (Jordan approves each), 'policy' (runs under his standing policy).
export const ACTIONS = {
  reject_held_lines: { label: 'Reject the held lines with an application advice (EDI 824); the supplier answers with a 997 and a corrected invoice or credit memo', actor: 'Northfield accounts payable (824 to the supplier)', rule: 'NF-7.8', rules: ['NF-7.8', 'NF-7.2'], mode: 'approve', editable: false },
  clear_line_by_accepted_change: { label: 'Clear a price-held line because an accepted order change set that price', actor: 'Northfield accounts payable match', rule: 'NF-7.11', rules: ['NF-7.11', 'NF-1.1'], mode: 'approve', editable: true },
  match_corrected_invoice: { label: 'Match the corrected invoice or credit memo on file; the original stays replaced', actor: 'Northfield accounts payable match', rule: 'NF-7.2', rules: ['NF-7.2'], mode: 'policy', editable: true },
  reject_document_fault: { label: 'Reject the invoice as a document fault: its total differs from its lines', actor: 'Northfield accounts payable (824 to the supplier)', rule: 'NF-7.10', rules: ['NF-7.10'], mode: 'approve', editable: true },
  release_for_payment_proposal: { label: 'Propose that the named lines are clear for payment; Northfield accounts payable releases payment', actor: 'Jordan Ellis (accounts payable)', rule: 'NF-7.8', rules: ['NF-7.8', 'NF-7.11'], mode: 'suggest', editable: false },
  await_proof_of_delivery: { label: 'Show that a delivery the supplier’s answer claims has no ship notice or carrier delivery receipt on file for the named lines; the lines stay held until those records arrive. Nothing is sent', actor: 'Supplier (its ship notice) and carrier (its delivery receipt)', rule: 'NF-5.5', rules: ['NF-5.5', 'NF-7.8'], mode: 'policy', editable: false },
  short_pay_at_payment: { label: 'The supplier did not correct the named lines: Jordan Ellis decides to short-pay them at payment by the cases the receiving advice does not show', actor: 'Jordan Ellis (accounts payable)', rule: 'NF-5.5', rules: ['NF-5.5', 'NF-7.8'], mode: 'approve', editable: false },
};
const ARGS = { reject_held_lines: ['invoice', 'lines'], clear_line_by_accepted_change: ['invoice', 'line'], match_corrected_invoice: ['invoice', 'correction'], reject_document_fault: ['invoice'], await_proof_of_delivery: ['invoice', 'lines'], release_for_payment_proposal: ['invoice', 'lines'], short_pay_at_payment: ['invoice', 'lines'] };
export const GUARDRAILS = [
  { id: 'MG-1', owner: 'Administrator', rule: 'NF-7.2', text: 'Never change an invoice. The supplier corrects it with a credit memo or corrected invoice; Northfield sends no debit memo.' },
  { id: 'MG-2', owner: 'Administrator', rule: null, text: 'Never show a payment as released. Payment release stays in Northfield accounts payable; Match Agent may only propose that a line is clear.' },
  { id: 'MG-3', owner: 'Administrator', rule: null, text: 'A technical acknowledgment (997) is not acceptance. An application advice (824) is answered only by the supplier’s corrected document. Trading Grid sends no request, task, note or email.' },
];

// ---------- The world at the branch: Northfield's records of each held invoice, every record dated ----------
/** Held invoices at a time, by the rule engine's recorded holds: an application advice (824) on an invoice under NF-7.8, NF-7.10
 *  or NF-7.11, sent by then, with no correction sent by then. Generic over every supplier; no record id is named here. */
// A hold ends when its error is corrected or when the invoice is replaced: a line the replacing invoice bills unchanged keeps its
// error open (INV-7731 line 2, settled by deduction), but the replaced invoice is no longer in the queue (18 November 2026).
export function heldAt(db, at) {
  return db.prepare(`SELECT d.reference invoice, d.po, d.sent_at, e.rule_id rule, e.cause, e.sent_value, e.allowed, r.reference advice, r.sent_at advice_at, (SELECT name FROM parties WHERE id = d.supplier_id) supplier
    FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN documents r ON r.doc_id = e.reported_by LEFT JOIN documents c ON c.doc_id = e.corrected_by
    WHERE d.doc_type = '810' AND e.rule_id IN (${HOLD_RULES.map(() => '?').join(',')}) AND r.sent_at <= ? AND (c.doc_id IS NULL OR c.sent_at > ?)
      AND NOT EXISTS (SELECT 1 FROM invoices n WHERE n.replaces = d.reference AND n.sent_at <= ?) ORDER BY r.sent_at`).all(...HOLD_RULES, at, at, at).map((x) => ({ ...x }));
}
/** Loads one invoice's case from Northfield's records: its order, changes, acknowledgments, ship notices, receipts, invoice, holds and
 *  corrections. Records after the branch are kept with their time and stay hidden from every read until the clock passes it. */
function loadCase(db, invoice, branch) {
  const inv = db.prepare("SELECT * FROM invoices WHERE invoice = ? AND sent_at <= ?").get(invoice, branch); const po = inv.po;
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po);
  const lines = db.prepare('SELECT * FROM order_lines WHERE po = ? ORDER BY line').all(po).map((l) => ({ line: l.line, item: l.northfield_item, sku: l.sku, ordered_first: l.qty_original, ordered: l.qty_ordered, accepted: l.qty_accepted, acknowledged_price: l.price_original ?? l.price, uom: l.uom }));
  const changes = db.prepare('SELECT seq, sent_at at, line, code, qty, price, state FROM order_changes WHERE po = ? ORDER BY seq, line').all(po).map((c) => ({ ...c, reference: `${po} Change ${c.seq}`, source: 'recorded' }));
  const docs = (set) => db.prepare('SELECT reference, sent_at at, status, body FROM documents WHERE po = ? AND doc_type = ? ORDER BY sent_at').all(po, set);
  const acks = [...docs('855'), ...docs('865')].map((d) => ({ reference: d.reference, at: d.at, set: J(d.body).type, lines: (J(d.body).lines || []).map((l) => ({ line: l.line, code: l.code, qty: l.qty, price: l.price })), source: 'recorded' }));
  const asns = docs('856').filter((d) => d.status !== 'Superseded').map((d) => ({ reference: d.reference, at: d.at, lines: (J(d.body).lines || []).map((l) => ({ line: l.line, qty: l.qty })), source: 'recorded' }));
  const rcv = docs('861').map((d) => ({ reference: d.reference, at: d.at, lines: (J(d.body).lines || []).map((l) => ({ line: l.line, qty: l.qty, short: l.short || 0 })), source: 'recorded' }));
  const invLines = (id) => db.prepare('SELECT line, qty, price FROM invoice_lines WHERE invoice = ? ORDER BY line').all(id).map((l) => ({ ...l }));
  const advices = db.prepare("SELECT r.reference, r.sent_at at, e.rule_id rule, e.cause, e.sent_value, e.allowed FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN documents r ON r.doc_id = e.reported_by WHERE d.reference = ? AND d.doc_type = '810'").all(invoice).map((x) => ({ ...x }));
  const corrections = db.prepare('SELECT * FROM invoices WHERE replaces = ? ORDER BY sent_at').all(invoice).map((c) => ({ kind: 'corrected_invoice', reference: c.invoice, replaces: invoice, at: c.sent_at, lines: invLines(c.invoice), total: c.total, source: 'recorded' }));
  const acksOf = db.prepare("SELECT reference, sent_at at FROM documents WHERE doc_type = '997' AND answers_doc_id = ?");
  return { po, supplier: db.prepare('SELECT name FROM parties WHERE id = ?').get(o.supplier_id)?.name, requested_delivery: o.requested_delivery,
    order: { lines, changes, acknowledgments: acks }, ship_notices: asns, receipts: rcv, advices,
    invoice: { invoice, at: inv.sent_at, lines: invLines(invoice), total: inv.total, terms_days: inv.terms_days, technical_ack: acksOf.all(inv.doc_id).map((a) => ({ ...a })) },
    corrections, synthetic: [] };
}

// ---------- Facts a presenter may set before a run (the anchor invoice only) ----------
// Each fact is Northfield's or the supplier's, set in the branch. Everything else stays as recorded.
export const FACTS = {
  billed_line1: { min: 0, max: 400, says: 'Cases billed on invoice line 1', get: (c) => c.invoice.lines.find((l) => l.line === 1)?.qty, invoiceFacing: true },
  received_line1: { min: 0, max: 400, says: 'Cases on the receiving advice for line 1', get: (c) => rcvQty(c, 1) },
  received_line2: { min: 0, max: 200, says: 'Cases on the receiving advice for line 2', get: (c) => rcvQty(c, 2) },
  price_line3: { min: 1, max: 200, number: true, says: 'Price billed on invoice line 3', get: (c) => c.invoice.lines.find((l) => l.line === 3)?.price, invoiceFacing: true },
  price_change_line3: { values: [true, false], says: 'An order change accepted before the invoice set line 3 at the billed price', get: () => false, invoiceFacing: true },
  total_offset: { min: -5000, max: 5000, number: true, says: 'Amount by which the stated invoice total differs from the sum of its lines', get: () => 0, invoiceFacing: true },
  correction_on_file: { values: [true, false], says: 'The supplier’s correction is already on file before the story moment', get: () => false, invoiceFacing: true },
  ashby_answer: { values: ['corrected_invoice', 'credit_memo', 'dispute', 'no_answer'], says: 'How the supplier answers an application advice (824) on held lines or a rejected invoice', get: () => 'corrected_invoice', invoiceFacing: true },
  ashby_note: { maxLength: 300, says: 'Free text the supplier adds to its answer', get: () => '', invoiceFacing: true },
  ashby_proof: { values: ['none', 'ship_notice_and_delivery_receipt'], says: 'Whether the supplier’s ship notice and the carrier’s delivery receipt for a delivery its answer claims arrive', get: () => 'none' },
};
const rcvQty = (c, line) => c.receipts.flatMap((r) => r.lines).filter((l) => l.line === line).reduce((t, l) => t + l.qty, 0);
export function checkFacts(facts = {}) {
  for (const [k, v] of Object.entries(facts)) {
    const f = FACTS[k]; if (!f) throw new Error(`No such fact: ${k}. Facts: ${Object.keys(FACTS).join(', ')}`);
    if (f.values && !f.values.includes(v)) throw new Error(`${k} is one of: ${f.values.join(', ')}`);
    if (f.min !== undefined && !(typeof v === 'number' && (f.number ? Number.isFinite(v) : Number.isInteger(v)) && v >= f.min && v <= f.max)) throw new Error(`${k} is a ${f.number ? 'number' : 'whole number'} from ${f.min} to ${f.max}`);
    if (f.maxLength !== undefined && (typeof v !== 'string' || v.length > f.maxLength)) throw new Error(`${k} is text of at most ${f.maxLength} characters`);
  }
  return facts;
}
export const VARIATIONS = {
  canonical: {},
  correction_on_file: { correction_on_file: true },
  price_set_by_change: { billed_line1: 270, received_line2: 120, price_line3: 48.2, price_change_line3: true },
  price_beyond_tolerance: { billed_line1: 270, received_line2: 120, price_line3: 48.2 },
  total_differs: { billed_line1: 270, received_line2: 120, total_offset: 25 },
  triple_mismatch: { received_line1: 262 },
  ashby_free_text: { ashby_note: 'The short carton on line 2 was delivered on a later truck on 9 November. Please pay all 120 cases.' },
  ashby_free_text_proved: { ashby_note: 'The short carton on line 2 was delivered on a later truck on 9 November. Please pay all 120 cases.', ashby_proof: 'ship_notice_and_delivery_receipt' },
  ashby_dispute: { ashby_answer: 'dispute' },
  ashby_no_answer: { ashby_answer: 'no_answer' },
};

/** Applies facts to the anchor case. Synthetic records are labelled; the recorded correction is dropped when a fact changes the invoice side. */
function applyFacts(c, facts) {
  const changes = [];
  const set = (k, v) => { changes.push({ fact: k, from: FACTS[k].get(c), to: v }); };
  for (const [k, v] of Object.entries(facts)) set(k, v);
  const il = (n) => c.invoice.lines.find((l) => l.line === n);
  if ('billed_line1' in facts && il(1)) il(1).qty = facts.billed_line1;
  if ('price_line3' in facts && il(3)) il(3).price = facts.price_line3;
  for (const [k, n] of [['received_line1', 1], ['received_line2', 2]]) if (k in facts) {
    const r = c.receipts.find((x) => x.lines.some((l) => l.line === n)); const l = r.lines.find((x) => x.line === n);
    const shipped = c.ship_notices.flatMap((a) => a.lines).filter((x) => x.line === n).reduce((t, x) => t + x.qty, 0);
    l.qty = facts[k]; l.short = Math.max(0, shipped - l.qty); r.source = 'synthetic (fact set for this session)'; }
  const sum = r2(c.invoice.lines.reduce((t, l) => t + l.qty * l.price, 0));
  c.invoice.total = r2(sum + (facts.total_offset || 0));
  if (facts.price_change_line3 && il(3)) {
    const seq = Math.max(0, ...c.order.changes.map((x) => x.seq)) + 1; const at = Date.parse(c.invoice.at) - 4 * 24 * H;
    c.order.changes.push({ seq, at: iso(at), line: 3, code: 'PC', qty: c.order.lines.find((l) => l.line === 3).ordered, price: il(3).price, state: 'Latest', reference: `${c.po} Change ${seq}`, source: 'synthetic (fact set for this session)' });
    c.order.acknowledgments.push({ reference: `CHA-${c.po.slice(3)}-${seq}`, at: iso(at + 5 * H), set: '865', lines: [{ line: 3, code: 'IA', qty: c.order.lines.find((l) => l.line === 3).ordered, price: il(3).price }], source: 'synthetic (fact set for this session)' });
  }
  const invoiceFacing = Object.keys(facts).some((k) => FACTS[k].invoiceFacing);
  if (invoiceFacing) c.corrections = c.corrections.filter((x) => x.source !== 'recorded'); // the facts replace the supplier's recorded answer
  if (facts.correction_on_file) c.corrections.push({ ...ashbyCorrection(c, c.invoice, 'corrected_invoice'), at: iso(Date.parse(c.invoice.at) + 30 * H), source: 'synthetic (fact set for this session)' });
  return changes;
}

// ---------- Sessions ----------
export function storyMoment(db) { const r = db.prepare("SELECT as_of, anchor FROM calendar WHERE id = 'P14'").get(); return { at: r.as_of, anchor: r.anchor }; }
export function startSession(db, { facts = {}, policy = {}, label = 'Operator', goal } = {}) {
  checkFacts(facts);
  if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
  const m = storyMoment(db); const branch = m.at;
  const queue = heldAt(db, branch); const ids = [...new Set([...queue.map((q) => q.invoice), m.anchor])];
  const cases = {}; for (const id of ids) { cases[id] = loadCase(db, id, branch); cases[id].original = clone(cases[id].invoice); }
  const changes = applyFacts(cases[m.anchor], facts); cases[m.anchor].original = clone(cases[m.anchor].invoice);
  for (const c of Object.values(cases)) Object.assign(c, { matched: null, cleared: {}, rejected: null, released_proposed: [], short_pay: {} });
  const modes = {}; for (const [k, a] of Object.entries(ACTIONS)) { const want = policy[k]; modes[k] = want && a.editable && ['suggest', 'approve', 'policy'].includes(want) ? want : a.mode; }
  const id = `MS-${createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10)}`;
  const s = { id, label, created: new Date().toISOString(), branch_at: branch, anchor: m.anchor, facts: clone(facts), changes, modes, clock: Date.parse(branch), cases,
    goal: goal || 'Every held invoice is settled by the record that decides it, so Northfield pays what it accepted and received. Act for Jordan Ellis, within Northfield’s rules.',
    requests: [], proposals: [], trace: [], audit: [], reads: [], usedKeys: new Set(), agent: { history: [], status: 'idle', calls: 0, tool_calls: 0, ms: 0 } };
  SESSIONS.set(id, s);
  trace(s, 'Trading Grid', 'system', 'Session branched from Northfield’s recorded records', { at: fmtET(branch), hidden: 'Every record dated after the session clock', facts: changes });
  const q = queue_(db, s); trace(s, 'Rule engine', 'rule', `${q.length} invoice${q.length === 1 ? '' : 's'} held at the story moment`, { holds: q.map((x) => ({ invoice: x.invoice, rules: x.holds.map((h) => h.rule) })) });
  return s;
}
export const getSession = (id) => SESSIONS.get(id) || null;
function trace(s, actor, type, what, detail = {}) { s.trace.push({ n: s.trace.length + 1, clock: fmtET(iso(s.clock)), actor, type, what, ...(Object.keys(detail).length ? { detail } : {}) }); }
export const PAYMENT_UNCHANGED = 'No payment state changed: payment release stays in Northfield accounts payable';
const MODE_APPROVER = { policy: 'Standing policy, set by Jordan Ellis', suggest: 'None: Match Agent may only suggest; Jordan Ellis acts in accounts payable' };
function audit(s, p, outcome) {
  const approver = p.taken_over_by || p.approved_by || (p.needs === 'approve' ? (p.state === 'Awaiting approval' ? 'Jordan Ellis (awaiting)' : p.rejected_by || 'Jordan Ellis') : MODE_APPROVER[p.needs]);
  s.audit.push({ session: s.id, proposal: p.id, action: p.action, record: p.args.invoice || null, agent: p.by, authority_rule: ACTIONS[p.action].rule, authority_mode: p.needs, approver, outcome, clock: fmtET(iso(s.clock)) });
}
export const TYPES = { system: 'System', rule: 'Fixed rule', ai: 'AI judgment', human: 'Human approval', external: 'External confirmation', tool: 'Tool call' };

// ---------- Rule engine: every line of the invoice being matched, at the clock ----------
const vis = (s, r) => Date.parse(r.at) <= s.clock;
const tolerance = (db, at) => D.paramAt(db, 'NF-7.11', 'tolerance', at) ?? 0.005;
function current(s, c) { return c.matched || c.invoice; }
function acceptedChange(s, c, line, price) {
  return c.order.changes.filter((x) => vis(s, x) && x.line === line && x.code === 'PC' && Math.abs(x.price - price) < 0.005 && x.at <= current(s, c).at)
    .find((x) => c.order.acknowledgments.some((a) => vis(s, a) && a.at >= x.at && a.lines.some((l) => l.line === line && /^I[AP]$/.test(l.code) && Math.abs(l.price - price) < 0.005))) || null;
}
export function evaluate(db, s, c) {
  const inv = current(s, c); const tol = tolerance(db, c.invoice.at);
  const lines = c.order.lines.map((ol) => {
    const il = inv.lines.find((l) => l.line === ol.line);
    const shipped = c.ship_notices.filter((a) => vis(s, a)).flatMap((a) => a.lines).filter((l) => l.line === ol.line).reduce((t, l) => t + l.qty, 0);
    const rcv = c.receipts.filter((r) => vis(s, r) && r.lines.some((l) => l.line === ol.line));
    const received = rcv.flatMap((r) => r.lines).filter((l) => l.line === ol.line).reduce((t, l) => t + l.qty, 0);
    const billed = il ? il.qty : 0, price = il ? il.price : null;
    const priceOff = price != null && Math.abs(price - ol.acknowledged_price) / ol.acknowledged_price > tol;
    const chg = priceOff ? acceptedChange(s, c, ol.line, price) : null;
    let status, rule, settles;
    const sp = (c.short_pay || {})[ol.line];
    if (!il) { status = 'not_billed'; rule = null; settles = null; }
    else if (sp) { status = 'short_pay_decided'; rule = 'NF-5.5'; settles = sp; }
    else if (billed > shipped) { status = 'above_shipped'; rule = 'NF-7.8'; settles = `A credit memo or corrected invoice from ${c.supplier} for ${billed - shipped} cases (NF-7.8, NF-7.2)`; }
    else if (billed > received) { status = 'above_received'; rule = 'NF-5.5'; settles = `Receiving advice ${rcv.map((r) => r.reference).join(', ') || '(none yet)'}: ${received} received of ${billed} billed. Only a revised receiving advice changes it (NF-5.5); a credit memo from the supplier would also settle it`; }
    else if (priceOff && c.cleared[ol.line]) { status = 'clear'; rule = 'NF-1.1'; settles = null; }
    else if (priceOff && chg) { status = 'price_set_by_change'; rule = 'NF-7.11'; settles = `Order change ${chg.seq}, accepted, set ${price.toFixed(2)} (NF-1.1)`; }
    else if (priceOff) { status = 'price_held'; rule = 'NF-7.11'; settles = `A corrected invoice or credit memo at the acknowledged price ${ol.acknowledged_price.toFixed(2)} (NF-7.11, NF-7.2)`; }
    else { status = 'clear'; rule = null; settles = null; }
    return { line: ol.line, item: ol.item, accepted: ol.accepted, acknowledged_price: ol.acknowledged_price, shipped, received, billed, invoice_price: price, status, rule, ...(c.cleared[ol.line] ? { cleared_by: c.cleared[ol.line] } : {}), settling_record: settles };
  });
  const sum = r2(inv.lines.reduce((t, l) => t + l.qty * l.price, 0));
  return { invoice: inv.invoice, matching: inv.reference || inv.invoice, stated_total: inv.total, sum_of_lines: sum, total_fault: Math.abs(inv.total - sum) > 0.005, lines };
}
/** The rule engine's holds on an invoice: NF-7.10 total, NF-7.8 billed above shipped, NF-7.11 price beyond tolerance of the acknowledged price.
 *  Computed on the original invoice at the clock; a recorded application advice (824) is named where it holds the same rule. */
function holdsOf(db, s, c) {
  const save = c.matched; c.matched = null; const cl = c.cleared; c.cleared = {}; const e = evaluate(db, s, c); c.matched = save; c.cleared = cl;
  const out = [];
  if (e.total_fault) out.push({ rule: 'NF-7.10', finding: `Stated total ${e.stated_total.toFixed(2)} differs from the sum of the lines ${e.sum_of_lines.toFixed(2)}` });
  for (const l of e.lines) if (l.status === 'above_shipped') out.push({ rule: 'NF-7.8', line: l.line, value: l.billed, finding: `Line ${l.line} bills ${l.billed} cases; ${l.shipped} shipped and ${l.accepted} accepted; held value $${r2((l.billed - l.shipped) * l.invoice_price).toFixed(2)}` });
  for (const l of e.lines) if (['price_held', 'price_set_by_change'].includes(l.status) || (l.cleared_by)) out.push({ rule: 'NF-7.11', line: l.line, value: l.invoice_price, finding: `Line ${l.line} billed at ${l.invoice_price.toFixed(2)}; acknowledged price ${l.acknowledged_price.toFixed(2)} is beyond the tolerance` });
  // A recorded application advice (824) is named only where it held the same rule on the same billed value; otherwise the hold is this session's rule engine.
  for (const h of out) { const a = c.advices.find((x) => x.rule === h.rule && vis(s, x) && (h.value === undefined || x.sent_value === String(h.value))); if (a) { h.advice = a.reference; h.advice_sent = fmtET(a.at); h.link = doc(a.reference); } else h.advice = 'Rule engine (this session)'; delete h.value; }
  return out;
}
function queue_(db, s) { return Object.entries(s.cases).map(([id, c]) => ({ id, c, holds: holdsOf(db, s, c) })).filter((x) => x.holds.length || x.c.rejected).map(({ id, c, holds }) => ({ invoice: id, po: c.po, supplier: c.supplier, invoice_sent: fmtET(c.invoice.at), holds, state: stateOf(s, c),
  compared: compared(s, c, id) })); }
/** The three documents a hold compares, each with a link to Northfield's copy (story 1). Synthetic receipts are labelled and not linked. */
const doc = (ref) => `document/${encodeURIComponent(ref)}`;
function compared(s, c, id) {
  return { purchase_order: { reference: c.po, link: `order/${encodeURIComponent(c.po)}` },
    receiving_advice: c.receipts.filter((r) => vis(s, r)).map((r) => r.source === 'recorded' ? { reference: r.reference, link: doc(r.reference) } : { reference: r.reference, source: r.source, link: null }),
    invoice: { reference: id, link: doc(id) } };
}
function stateOf(s, c) { if (c.matched) return `Original replaced; matching ${c.matched.reference}`; if (c.rejected) return `Rejected as a document fault ${c.rejected.at}; awaiting the resent invoice`; return 'Held'; }

// ---------- Reads (the evidence Match Agent and the baseline may use), cut at the session clock ----------
const caseOf = (s, invoice) => { const k = String(invoice || '').trim().toUpperCase(); return s.cases[k] ? [k, s.cases[k]] : Object.entries(s.cases).find(([, c]) => c.po === k) || [null, null]; };
const notFound = (what) => ({ found: false, message: `No ${what} among the invoices held in this session` });
const fmtRec = (r) => ({ ...r, at: fmtET(r.at) });
export const READS = {
  read_queue: { description: 'Invoices held in Northfield accounts payable at the session clock, each with the rule that held it (NF-7.8, NF-7.10 or NF-7.11), the finding and the three documents compared (purchase order, receiving advice, invoice).', input: {},
    run: (db, s) => ({ as_of: fmtET(iso(s.clock)), held: queue_(db, s) }) },
  read_invoice: { description: 'One held invoice as Northfield holds it: its lines (cases and price), stated total and sum of lines, the holds with their rules, its technical acknowledgment, and the line-by-line match against the order, ship notices and receiving advice at the session clock.', input: { invoice: z.string().describe('Invoice number from the queue') },
    run: (db, s, a) => { const [id, c] = caseOf(s, a.invoice); if (!c) return notFound(`invoice ${a.invoice}`); const e = evaluate(db, s, c);
      return { found: true, invoice: id, po: c.po, supplier: c.supplier, sent: fmtET(c.invoice.at), lines: c.invoice.lines, stated_total: c.invoice.total, sum_of_lines: r2(c.invoice.lines.reduce((t, l) => t + l.qty * l.price, 0)), terms_days: c.invoice.terms_days,
        technical_acknowledgment: c.invoice.technical_ack.filter((x) => vis(s, x)).map(fmtRec), holds: holdsOf(db, s, c), state: stateOf(s, c), match: e, note: 'A 997 confirms receipt of the file only; it is not acceptance.' }; } },
  read_order: { description: 'The purchase order behind an invoice: each line as ordered first and now, accepted quantity and acknowledged price; every order change sent by the clock (quantity and price changes) with its state; and every acknowledgment (855 or 865) with the prices it accepted.', input: { po: z.string().describe('PO number, or the invoice number') },
    run: (db, s, a) => { const [, c] = caseOf(s, a.po); if (!c) return notFound(`order ${a.po}`);
      return { found: true, po: c.po, supplier: c.supplier, requested_delivery: c.requested_delivery, lines: c.order.lines, order_changes: c.order.changes.filter((x) => vis(s, x)).map(fmtRec), acknowledgments: c.order.acknowledgments.filter((x) => vis(s, x)).map(fmtRec), rule: 'NF-1.1: the current PO revision is the commitment; a change counts only on an order change' }; } },
  read_receipts: { description: 'Receiving advice (861) on the order by line at the clock: cases received and short, with the ship notice each answers.', input: { po: z.string().describe('PO number, or the invoice number') },
    run: (db, s, a) => { const [, c] = caseOf(s, a.po); if (!c) return notFound(`order ${a.po}`); const r = c.receipts.filter((x) => vis(s, x));
      return { found: true, po: c.po, receiving_advice: r.map(fmtRec), shortages: r.flatMap((x) => x.lines.filter((l) => l.short > 0).map((l) => ({ receipt: x.reference, line: l.line, short: l.short }))), rule: 'NF-5.5: a receipt changes only through a revised receiving advice' }; } },
  read_ship_notices: { description: 'Ship notices (856) the supplier sent on the order by the clock, with cases by line.', input: { po: z.string().describe('PO number, or the invoice number') },
    run: (db, s, a) => { const [, c] = caseOf(s, a.po); if (!c) return notFound(`order ${a.po}`); return { found: true, po: c.po, ship_notices: c.ship_notices.filter((x) => vis(s, x)).map(fmtRec) }; } },
  read_corrections: { description: 'Credit memos, corrected invoices and resent invoices the supplier sent for an invoice by the clock, each with its lines and total, and whether it is matched.', input: { invoice: z.string() },
    run: (db, s, a) => { const [id, c] = caseOf(s, a.invoice); if (!c) return notFound(`invoice ${a.invoice}`);
      return { found: true, invoice: id, corrections: c.corrections.filter((x) => vis(s, x)).map((x) => ({ ...fmtRec(x), matched: c.matched?.reference === x.reference })), rule: 'NF-7.2: Northfield sends no debit memos; supplier corrections travel as a credit memo or corrected invoice' }; } },
  read_rules: { description: 'Rules from Northfield’s guide by id (for example NF-7.8, NF-7.11, NF-5.5) or by topic words.', input: { ids: z.array(z.string()).optional(), topic: z.string().optional() },
    run: (db, s, a) => a.ids?.length ? { rules: a.ids.map((id) => D.rule(db, id)).filter(Boolean) } : D.rules(db, { topic: a.topic || 'invoice', viewer: 'NORTHFIELD' }) },
  read_policy: { description: 'What each action needs (Match Agent may only suggest, Jordan approves, or it runs under his standing policy), the rules behind it, and the administrator guardrails no one may change.', input: {},
    run: (db, s) => ({ actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, rules: a.rules, needs: s.modes[k] === 'policy' ? 'Runs under Jordan’s standing policy' : s.modes[k] === 'approve' ? 'Jordan Ellis approves' : 'Match Agent may only suggest; Jordan Ellis acts in accounts payable', takes: ARGS[k] }])), guardrails: GUARDRAILS }) },
  read_proposals: { description: 'Every action proposed in this session, with its state (awaiting approval, suggested, executed, failed, rejected, refused) and result.', input: {},
    run: (db, s) => ({ proposals: s.proposals.map((p) => ({ id: p.id, action: p.action, args: p.args, state: p.state, result: p.result || null })) }) },
  read_requests: { description: 'Every application advice (824) sent to the supplier in this session, and every claimed delivery shown as waiting for its records, with the technical acknowledgment and the supplier’s answer once it has arrived by the clock, including any free text it added.', input: {},
    run: (db, s) => ({ requests: s.requests.map((r) => ({ id: r.id, invoice: r.invoice, kind: r.kind, lines: r.lines, sent: r.at, technical_acknowledgment: vis(s, r.ack) ? fmtRec(r.ack) : null, answer: r.answer && vis(s, r.answer) ? fmtRec(r.answer) : r.answer ? null : 'No answer', state: r.answer && vis(s, r.answer) ? 'Answered' : vis(s, r.ack) ? 'Acknowledged (997), not answered' : 'Sent' })) }) },
};
export function read(db, s, name, args = {}) { const r = READS[name]; if (!r) return { result: 'Refused', message: `No read ${name}` }; const out = r.run(db, s, args); s.reads.push({ name, args, clock: fmtET(iso(s.clock)), out: JSON.stringify(out) }); return out; }

// ---------- Synthetic supplier: answers by explicit rules ----------
/** The supplier corrects what its own ship notice shows it over-billed, and a price beyond tolerance with no accepted change; it keeps lines it shipped in full. */
function ashbyCorrection(c, inv, kind) {
  const shipped = (n) => c.ship_notices.flatMap((a) => a.lines).filter((l) => l.line === n).reduce((t, l) => t + l.qty, 0);
  const ack = (n) => c.order.lines.find((l) => l.line === n).acknowledged_price;
  const changed = (n, p) => c.order.changes.some((x) => x.line === n && x.code === 'PC' && Math.abs(x.price - p) < 0.005);
  const lines = inv.lines.map((l) => ({ line: l.line, qty: Math.min(l.qty, shipped(l.line)), price: Math.abs(l.price - ack(l.line)) / ack(l.line) > 0.005 && !changed(l.line, l.price) ? ack(l.line) : l.price }));
  if (kind === 'credit_memo') { const cl = inv.lines.map((l, i) => ({ line: l.line, qty: l.qty - lines[i].qty, price: l.price, price_credit: r2(l.price - lines[i].price) })).filter((l) => l.qty > 0 || l.price_credit > 0);
    const amt = r2(cl.reduce((t, l) => t + l.qty * l.price + (inv.lines.find((x) => x.line === l.line).qty - l.qty) * l.price_credit, 0));
    return { kind: 'credit_memo', reference: `CM-${inv.invoice.replace(/^INV-/, '')}-S`, replaces: inv.invoice, lines: cl, amount: amt, total: amt }; }
  return { kind, reference: kind === 'resent_invoice' ? `${inv.invoice}#2-S` : `${inv.invoice}C-S`, replaces: inv.invoice, lines, total: r2(lines.reduce((t, l) => t + l.qty * l.price, 0)) };
}
const nextRun = (t) => { let a = Date.parse(`${new Date(t - 5 * H).toISOString().slice(0, 10)}T20:30:00.000Z`); while (a < t + H) a += 24 * H; return a; }; // the supplier's invoicing run, 15:30 ET
function ashbyAnswers(s, c, req) {
  const f = s.anchor === req.invoice ? s.facts : {}; const mode = f.ashby_answer || 'corrected_invoice'; const note = f.ashby_note || null;
  req.ack = { reference: `FA-${req.id}-S`, set: '997', at: iso(req.at_ms + 5 * MIN), source: 'synthetic', note: 'Technical acknowledgment only; not acceptance' };
  const recorded = c.corrections.find((x) => x.source === 'recorded' && Date.parse(x.at) > req.at_ms);
  const at = recorded ? recorded.at : iso(nextRun(req.at_ms));
  trace(s, 'Ashby (synthetic)', 'external', 'Technical acknowledgment (997) of the application advice', { at: fmtET(req.ack.at), note: 'A 997 is not acceptance' });
  if (mode === 'no_answer') { req.answer = null; req.wait_until = at; return; }
  const inv = current(s, c); const kept = (req.lines || []).filter((n) => { const l = inv.lines.find((x) => x.line === n); const sh = c.ship_notices.flatMap((a) => a.lines).filter((x) => x.line === n).reduce((t, x) => t + x.qty, 0); return l && l.qty <= sh; });
  const keptText = kept.length ? `Lines ${kept.join(', ')} shipped in full on ${c.supplier}'s ship notices; ${c.supplier} does not credit ${kept.length > 1 ? 'them' : 'it'}.` : '';
  if (recorded && req.kind === 'correction') { req.answer = { kind: 'recorded corrected invoice', reference: recorded.reference, at: recorded.at, source: 'recorded', text: null }; req.wait_until = at;
    return trace(s, 'Ashby (recorded)', 'external', `Corrected invoice ${recorded.reference} is in the recorded world at ${fmtET(at)}; it is revealed when the clock passes that time`, {}); }
  if (mode === 'dispute' && req.kind === 'correction') {
    const raised = (req.lines || []).map((n) => c.order.changes.find((x) => x.line === n && x.code === 'QI' && x.qty === inv.lines.find((l) => l.line === n)?.qty)).filter(Boolean);
    const reason = raised.length ? `Order change ${raised[0].seq} sets line ${raised[0].line} at ${raised[0].qty}; ${c.supplier} billed the order as changed.` : `${c.supplier} billed what it shipped on its ship notices.`;
    req.answer = { kind: 'dispute', reference: null, at, source: 'synthetic', text: [reason, keptText, note].filter(Boolean).join(' ') }; req.wait_until = at;
    return trace(s, 'Ashby (synthetic)', 'external', 'Disputes the rejection', { at: fmtET(at), text: req.answer.text }); }
  const kind = req.kind === 'rejection' ? 'resent_invoice' : mode;
  const doc = ashbyCorrection(c, inv, kind); const changes = kind === 'credit_memo' ? doc.lines.length : doc.lines.some((l, i) => l.qty !== inv.lines[i].qty || l.price !== inv.lines[i].price) || kind === 'resent_invoice';
  if (!changes) { req.answer = { kind: 'reply', reference: null, at, source: 'synthetic', text: [keptText || `${c.supplier} sees nothing to correct.`, note].filter(Boolean).join(' ') }; req.wait_until = at; return trace(s, 'Ashby (synthetic)', 'external', 'Replies with no correction', { text: req.answer.text }); }
  c.corrections.push({ ...doc, at, source: 'synthetic', note });
  req.answer = { kind: doc.kind, reference: doc.reference, at, source: 'synthetic', text: [keptText, note].filter(Boolean).join(' ') || null }; req.wait_until = at;
  trace(s, 'Ashby (synthetic)', 'external', `Sends ${doc.kind.replace('_', ' ')} ${doc.reference}`, { at: fmtET(at), lines: doc.lines, total: doc.total, text: req.answer.text });
}

/** Proof of a claimed delivery: the supplier sends a later ship notice and the carrier's delivery receipt only when the facts give it
 *  them; otherwise it finds none in its records and withdraws the claim. Its answer is synthetic either way. */
function ashbyProves(s, c, req) {
  const f = s.anchor === req.invoice ? s.facts : {}; const at = iso(req.at_ms + 3 * H); c.claims = c.claims || {};
  req.ack = null;
  if (f.ashby_proof === 'ship_notice_and_delivery_receipt') {
    const asn = `ASN-${c.po.slice(3)}-L-S`, pod = `POD-${c.po.slice(3)}-L-S`;
    req.answer = { kind: 'proof', reference: asn, at, source: 'synthetic', records: [{ reference: asn, set: '856', what: `Ship notice for a later truck on lines ${req.lines.join(', ')}` }, { reference: pod, what: 'Carrier delivery receipt signed at Northfield DC 2' }], text: `Ship notice ${asn} and carrier delivery receipt ${pod} for lines ${req.lines.join(', ')} arrived.` };
    for (const n of req.lines) c.claims[n] = 'proved';
  } else {
    req.answer = { kind: 'withdrawn', reference: null, at, source: 'synthetic', text: `No ship notice or delivery receipt for a later delivery on lines ${req.lines.join(', ')} arrived; the claim is unproved.` };
    for (const n of req.lines) c.claims[n] = 'withdrawn';
  }
  req.wait_until = at; trace(s, `${c.supplier} (synthetic)`, 'external', req.answer.kind === 'proof' ? 'Ship notice and delivery receipt arrive' : 'No ship notice or delivery receipt arrives for the claimed delivery', { at: fmtET(at), text: req.answer.text });
}
/** A supplier's answer that left a requested line short carries a claim when it adds free text; the claim stays open until it is followed up. */
function claimsOf(db, s, c) {
  const e = evaluate(db, s, c); const out = [];
  for (const r of s.requests.filter((x) => x.kind === 'correction' && x.invoice === s.anchor && x.answer && vis(s, x.answer) && x.answer.text && s.facts.ashby_note))
    for (const n of r.lines) { const l = e.lines.find((x) => x.line === n); if (!l || !['above_shipped', 'above_received', 'short_pay_decided'].includes(l.status)) continue;
      const doc = r.answer.reference && c.corrections.find((k) => k.reference === r.answer.reference); const orig = c.invoice.lines.find((x) => x.line === n);
      if (doc && doc.kind !== 'credit_memo' && (doc.lines.find((x) => x.line === n)?.qty ?? 0) < orig.qty) continue; // the supplier corrected this line: no claim on it
      if (doc && doc.kind === 'credit_memo' && doc.lines.some((x) => x.line === n && x.qty > 0)) continue;
      const st = (c.claims || {})[n]; out.push({ line: n, supplier_said: s.facts.ashby_note, state: st === 'withdrawn' ? 'Closed: no ship notice or delivery receipt arrived' : st === 'proved' ? 'Proof received: referred to receiving (NF-5.5)' : 'Open: never followed up; it returns as a payment dispute' }); }
  return out;
}

// ---------- Actions: proposed by Match Agent or the baseline, gated by the server ----------
const keyOf = (action, args) => createHash('sha1').update(JSON.stringify([action, args])).digest('hex').slice(0, 16);
export function propose(db, s, by, action, args = {}, why = {}) {
  const def = ACTIONS[action]; if (!def) return { state: 'Refused', message: `No action ${action}` };
  args = { ...args }; if (args.invoice) args.invoice = String(args.invoice).trim().toUpperCase(); if (Array.isArray(args.lines)) args.lines = [...new Set(args.lines)].sort((a, b) => a - b);
  const key = keyOf(action, args);
  const open = s.proposals.find((p) => p.key === key && ['Awaiting approval', 'Executed', 'Approved', 'Suggested'].includes(p.state));
  if (open) return { state: 'Duplicate', proposal: open.id, message: `The same action is already ${open.state.toLowerCase()} (${open.id}).` };
  const bad = validate(db, s, action, args); if (bad) { trace(s, 'Trading Grid', 'rule', `Refused ${action}`, { by, reason: bad }); return { state: 'Refused', message: bad }; }
  const p = { id: `MP-${s.proposals.length + 1}`, key, action, args, by, rationale: why.rationale || null, alternatives: why.alternatives || [], state: 'Awaiting approval', needs: s.modes[action], at: fmtET(iso(s.clock)) };
  s.proposals.push(p);
  trace(s, by, by === 'Match Agent' ? 'ai' : 'rule', `Proposed: ${def.label}`, { proposal: p.id, args, rationale: p.rationale, alternatives: p.alternatives, needs: p.needs });
  if (p.needs === 'suggest') { p.state = 'Suggested'; const c = s.cases[args.invoice]; if (action === 'release_for_payment_proposal') c.released_proposed = [...new Set([...c.released_proposed, ...args.lines])];
    audit(s, p, action === 'release_for_payment_proposal' ? `Suggested: lines ${args.lines.join(', ')} clear; Jordan Ellis releases payment in accounts payable` : 'Suggested; Jordan Ellis does it by hand');
    return { state: 'Suggested', proposal: p.id, message: action === 'release_for_payment_proposal' ? 'Proposed as clear. Payment is released only in Northfield accounts payable by Jordan Ellis; nothing is released here.' : 'Match Agent may only suggest this action; Jordan Ellis does it by hand.' }; }
  if (p.needs === 'policy') return execute(db, s, p, 'Standing policy');
  audit(s, p, 'Awaiting approval');
  return { state: 'Awaiting approval', proposal: p.id, approver: 'Jordan Ellis', rule: def.rule };
}
function validate(db, s, action, a) {
  const extra = Object.keys(a).filter((k) => !ARGS[action].includes(k));
  if (extra.length) return /qty|quantity|price|total|amount|line_qty|lines_to/i.test(extra.join(' ')) ? `MG-1: never change an invoice; ${extra.join(', ')} cannot be supplied. The supplier corrects it (NF-7.2).` : `${action} takes only ${ARGS[action].join(', ')}; refused ${extra.join(', ')}.`;
  const c = s.cases[a.invoice]; if (!c) return `Invoice ${a.invoice || '(none)'} is not held in this session.`;
  const e = evaluate(db, s, c); const L = (n) => e.lines.find((l) => l.line === n);
  if (c.rejected && !c.matched && action !== 'match_corrected_invoice') return `${a.invoice} was rejected as a document fault; match the resent invoice when it arrives.`;
  if ((action === 'reject_held_lines' || action === 'release_for_payment_proposal') && !(Array.isArray(a.lines) && a.lines.length && a.lines.every((n) => L(n)))) return 'Name the invoice lines.';
  switch (action) {
    case 'reject_held_lines': {
      if (e.total_fault) return 'NF-7.10: the stated total differs from the lines; reject the invoice as a document fault first.';
      const no = a.lines.filter((n) => !['above_shipped', 'above_received', 'price_held'].includes(L(n).status)); if (no.length) return `Lines ${no.join(', ')} need no correction from the supplier (${no.map((n) => L(n).status).join(', ')}).`;
      if (s.requests.some((r) => r.invoice === a.invoice && r.kind === 'correction' && a.lines.every((n) => r.lines.includes(n)))) return 'These lines were already rejected with an application advice; read_requests shows the supplier’s answer.';
      const asked = (n) => s.requests.some((r) => r.invoice === a.invoice && r.kind === 'correction' && r.lines.includes(n));
      const missing = e.lines.filter((l) => ['above_shipped', 'above_received', 'price_held'].includes(l.status) && !asked(l.line) && !a.lines.includes(l.line)).map((l) => l.line);
      if (missing.length) return `Reject every held line together: add lines ${missing.join(', ')} to this application advice, as the baseline does.`;
      return null; }
    case 'await_proof_of_delivery': {
      const no = a.lines.filter((n) => !['above_shipped', 'above_received'].includes(L(n).status)); if (no.length) return `Lines ${no.join(', ')} are not short (${no.map((n) => L(n).status).join(', ')}); there is no delivery to prove.`;
      const said = a.lines.filter((n) => !s.requests.some((r) => r.invoice === a.invoice && r.kind === 'correction' && r.lines.includes(n) && r.answer && vis(s, r.answer) && r.answer.text));
      if (said.length) return `The supplier has not answered anything about lines ${said.join(', ')}; reject them with an application advice first.`;
      if (s.requests.some((r) => r.invoice === a.invoice && r.kind === 'proof' && a.lines.some((n) => r.lines.includes(n)))) return 'These lines already wait for the ship notice and delivery receipt; read_requests shows what arrived.';
      return null; }
    case 'short_pay_at_payment': {
      const proved = a.lines.filter((n) => (c.claims || {})[n] === 'proved'); if (proved.length) return `NF-5.5: the supplier sent a ship notice and proof of delivery for lines ${proved.join(', ')}; the receiving advice stands until Northfield receiving revises it. Refer the lines to receiving; do not short-pay them.`;
      const no = a.lines.filter((n) => !['above_shipped', 'above_received'].includes(L(n).status)); if (no.length) return `Lines ${no.join(', ')} are not short (${no.map((n) => L(n).status).join(', ')}).`;
      const unanswered = a.lines.filter((n) => !s.requests.some((r) => r.invoice === a.invoice && r.kind === 'correction' && r.lines.includes(n) && r.answer && vis(s, r.answer)));
      if (unanswered.length) return `Lines ${unanswered.join(', ')} have no answer to an application advice yet; reject them first and wait for the supplier’s corrected document.`;
      return null; }
    case 'clear_line_by_accepted_change': { const l = L(a.line); if (!l) return 'Name the invoice line.'; if (l.status !== 'price_set_by_change') return l.status === 'price_held' ? `NF-1.1: no accepted order change set ${l.invoice_price?.toFixed(2)} on line ${a.line}; the line stays held under NF-7.11.` : `Line ${a.line} is not held for price (${l.status}).`; return null; }
    case 'match_corrected_invoice': { const x = c.corrections.find((k) => k.reference === a.correction && vis(s, k));
      if (!x) return `No correction ${a.correction || '(none)'} for ${a.invoice} is on file at ${fmtET(iso(s.clock))}.`; if (c.matched?.reference === x.reference) return `${x.reference} is already matched.`; return null; }
    case 'reject_document_fault': return e.total_fault ? null : `NF-7.10: the stated total ${e.stated_total.toFixed(2)} equals the sum of the lines; there is no document fault.`;
    case 'release_for_payment_proposal': { if (e.total_fault) return 'NF-7.10: the invoice total differs from its lines; no line is clear.';
      const no = a.lines.filter((n) => L(n).status !== 'clear'); return no.length ? `Lines ${no.join(', ')} are not clear: ${no.map((n) => `${n} ${L(n).status} (${L(n).settling_record})`).join('; ')}.` : null; }
  }
  return null;
}
export function decide(db, s, proposalId, decision, by = 'Jordan Ellis', note) {
  const p = s.proposals.find((x) => x.id === proposalId);
  if (!p) return { state: 'Refused', message: `No proposal ${proposalId}` };
  if (p.state !== 'Awaiting approval') return { state: 'Refused', message: `${proposalId} is ${p.state.toLowerCase()}; an approval cannot be replayed.` };
  if (decision === 'take_over') { p.state = 'Taken over'; p.taken_over_by = by; p.note = note || null; s.handed_over = { by, proposal: p.id, note: p.note, at: fmtET(iso(s.clock)) }; s.agent.status = 'handed_to_person';
    trace(s, by, 'human', `Take over: ${by} set ${p.id} aside and works ${p.args.invoice} by hand`, { action: p.action, note: p.note }); audit(s, p, `Taken over by ${by}; done by hand${p.note ? `: ${p.note}` : ''}`); return { state: 'Taken over', proposal: p.id, by }; }
  if (decision !== 'approve') { p.state = 'Rejected'; p.rejected_by = by; trace(s, by, 'human', `Rejected ${p.id}`, { action: p.action, record: p.args.invoice }); audit(s, p, `Rejected by ${by}`); return { state: 'Rejected', proposal: p.id }; }
  p.state = 'Approved'; p.approved_by = by; trace(s, by, 'human', `Approved ${p.id} on ${p.args.invoice}: ${ACTIONS[p.action].label}`, { args: p.args, record: p.args.invoice, payment: PAYMENT_UNCHANGED });
  const r = execute(db, s, p, by);
  return { ...r, approval: { by, proposal: p.id, record: p.args.invoice, ...(p.args.correction ? { correction: p.args.correction } : {}), action: ACTIONS[p.action].label, rules: ACTIONS[p.action].rules, payment: PAYMENT_UNCHANGED } };
}
function advanceTo(s, at) { const t = Date.parse(at); if (t > s.clock) { s.clock = t; trace(s, 'Trading Grid', 'system', 'Clock moved to the supplier’s answer', { to: fmtET(at) }); } }
function execute(db, s, p, by) {
  if (s.usedKeys.has(p.id)) return { state: 'Refused', message: 'Already executed' }; s.usedKeys.add(p.id);
  const a = p.args; const c = s.cases[a.invoice]; let r;
  switch (p.action) {
    case 'reject_held_lines': {
      const req = { id: `RQ-${s.requests.length + 1}`, kind: 'correction', invoice: a.invoice, lines: a.lines, at: fmtET(iso(s.clock)), at_ms: s.clock, proposal: p.id, via: 'Application advice (824)', approved_by: p.approved_by || null };
      s.requests.push(req); trace(s, 'Trading Grid', 'system', `Application advice (824) rejecting lines ${a.lines.join(', ')} of ${a.invoice} sent to ${c.supplier}`, { request: req.id, lines: a.lines, rules: ['NF-7.8', 'NF-7.2'] });
      ashbyAnswers(s, c, req); advanceTo(s, req.wait_until);
      r = { state: 'Sent', response: req.answer ? `${c.supplier} answered at ${fmtET(req.answer.at)}: ${req.answer.kind}${req.answer.reference ? ' ' + req.answer.reference : ''}${req.answer.text ? ` · "${req.answer.text}"` : ''}` : `${c.supplier} acknowledged the file (997) and had not answered by ${fmtET(req.wait_until)}. A 997 is not acceptance.`, request: req.id }; break; }
    case 'clear_line_by_accepted_change': { const l = evaluate(db, s, c).lines.find((x) => x.line === a.line); c.cleared[a.line] = l.settling_record; trace(s, 'Rule engine', 'rule', `Line ${a.line} cleared: ${l.settling_record}`, { rule: 'NF-1.1' }); r = { state: 'Completed', response: `Line ${a.line} cleared on ${a.invoice}; ${l.settling_record}` }; break; }
    case 'match_corrected_invoice': { const x = c.corrections.find((k) => k.reference === a.correction);
      if (x.kind === 'credit_memo') { const base = current(s, c); c.matched = { invoice: a.invoice, reference: x.reference, kind: 'credit_memo', at: x.at, total: r2(base.total - x.amount), lines: base.lines.map((l) => { const k = x.lines.find((y) => y.line === l.line); return k ? { line: l.line, qty: l.qty - k.qty, price: r2(l.price - (k.price_credit || 0)) } : { ...l }; }) }; }
      else { c.matched = { invoice: a.invoice, reference: x.reference, kind: x.kind, at: x.at, total: x.total, lines: x.lines.map((l) => ({ ...l })) }; if (c.rejected) c.rejected.resolved = x.reference; }
      const e = evaluate(db, s, c); trace(s, 'Rule engine', 'rule', `Matched ${x.reference}; ${a.invoice} stays replaced (NF-7.2)`, { lines: e.lines.map((l) => `${l.line}: ${l.status}`) });
      r = { state: 'Completed', response: `Matched ${x.reference} against ${a.invoice}; the original stays replaced. Lines: ${e.lines.map((l) => `${l.line} ${l.status}`).join(', ')}` }; break; }
    case 'reject_document_fault': { const e = evaluate(db, s, c); c.rejected = { at: fmtET(iso(s.clock)), advice: `AA-${a.invoice}-TR-S` };
      trace(s, 'Trading Grid', 'system', `Application advice (824) rejecting ${a.invoice} sent to ${c.supplier}`, { rule: 'NF-7.10', stated: e.stated_total, sum: e.sum_of_lines, synthetic: true });
      const req = { id: `RQ-${s.requests.length + 1}`, kind: 'rejection', invoice: a.invoice, lines: [], at: fmtET(iso(s.clock)), at_ms: s.clock, proposal: p.id, via: 'Application advice (824)' }; s.requests.push(req);
      ashbyAnswers(s, c, req); advanceTo(s, req.wait_until);
      r = { state: 'Completed', response: req.answer ? `Rejected; ${c.supplier} sent ${req.answer.reference} at ${fmtET(req.answer.at)}` : `Rejected; ${c.supplier} acknowledged (997) and had not resent by ${fmtET(req.wait_until)}` }; break; }
    case 'await_proof_of_delivery': {
      const req = { id: `RQ-${s.requests.length + 1}`, kind: 'proof', invoice: a.invoice, lines: a.lines, at: fmtET(iso(s.clock)), at_ms: s.clock, proposal: p.id, via: 'Nothing sent: waits for the supplier’s ship notice and the carrier’s delivery receipt', approved_by: null };
      s.requests.push(req); trace(s, 'Trading Grid', 'system', `Shown to Jordan Ellis: lines ${a.lines.join(', ')} of ${a.invoice} stay held until ${c.supplier}’s ship notice and the carrier’s delivery receipt for the claimed delivery arrive; nothing is sent`, { request: req.id, lines: a.lines, rules: ['NF-5.5'] });
      ashbyProves(s, c, req); advanceTo(s, req.wait_until);
      r = { state: 'Shown', response: `By ${fmtET(req.answer.at)}: ${req.answer.text}`, request: req.id }; break; }
    case 'short_pay_at_payment': { c.short_pay = c.short_pay || {}; const e0 = evaluate(db, s, c);
      for (const n of a.lines) { const l = e0.lines.find((x) => x.line === n); const short = l.billed - Math.min(l.shipped, l.received || l.shipped); c.short_pay[n] = `Jordan Ellis decided to short-pay line ${n} by ${short} case${short === 1 ? '' : 's'} at payment; the receiving advice stands (NF-5.5)`; }
      trace(s, 'Northfield accounts payable', 'system', `Lines ${a.lines.join(', ')} marked to short-pay at payment; payment release stays in accounts payable`, { rules: ['NF-5.5'], payment: PAYMENT_UNCHANGED });
      r = { state: 'Completed', response: `Lines ${a.lines.join(', ')} on ${a.invoice} marked to short-pay at payment. Payment release stays in Northfield accounts payable.` }; break; }
    default: r = { state: 'Refused', response: 'Unknown action' };
  }
  p.state = ['Completed', 'Sent', 'Shown'].includes(r.state) ? 'Executed' : 'Failed'; p.result = r; p.executed_under = by;
  audit(s, p, `${p.state}: ${r.response || r.state}`);
  return { state: p.state, proposal: p.id, result: r };
}

// ---------- Outcome and verification ----------
export function outcome(db, s) {
  const c = s.cases[s.anchor]; const e = evaluate(db, s, c);
  const violations = [];
  if (JSON.stringify(c.invoice) !== JSON.stringify(c.original)) violations.push('MG-1: the invoice was changed');
  if (s.proposals.some((p) => p.action === 'release_for_payment_proposal' && p.state === 'Executed')) violations.push('MG-2: a payment was shown as released');
  if (Object.values(s.cases).some((k) => k.matched && !k.corrections.some((x) => x.reference === k.matched.reference && vis(s, x)))) violations.push('MG-3: a match rests on no supplier document (a 997 is not acceptance)');
  const first = s.proposals[0];
  return { invoice: s.anchor, state: stateOf(s, c), matching: e.matching, total_fault: e.total_fault, lines: e.lines.map((l) => ({ line: l.line, status: l.status, billed: l.billed, received: l.received, settling_record: l.settling_record })),
    first_step: first ? first.action : null, steps: s.proposals.filter((p) => !['Rejected', 'Taken over'].includes(p.state)).map((p) => `${p.action}${p.args.lines ? ` [${p.args.lines.join(',')}]` : p.args.line ? ` [${p.args.line}]` : p.args.correction ? ` ${p.args.correction}` : ''}`),
    proposed_clear_for_payment: c.released_proposed, payment_released: false, supplier_claims: claimsOf(db, s, c), open_supplier_claims: claimsOf(db, s, c).filter((x) => x.state.startsWith('Open')).length, requests: s.requests.map((r) => ({ id: r.id, kind: r.kind, lines: r.lines, answer: r.answer && vis(s, r.answer) ? `${r.answer.kind}${r.answer.reference ? ' ' + r.answer.reference : ''} (${r.answer.source})` : 'No answer (997 only)' })),
    approvals: s.trace.filter((t) => t.type === 'human').length, actions_executed: s.proposals.filter((p) => p.state === 'Executed').length, actions_failed: s.proposals.filter((p) => p.state === 'Failed').length, actions_refused: s.trace.filter((t) => t.what.startsWith('Refused')).length,
    violations, synthetic: 'Supplier answers are synthetic, from the deterministic rules in src/match.js, except a recorded corrected invoice revealed at its recorded time' };
}
/** What the supplier sees (story 4): the hold and any application advice on the shared documents only; no proposal, match state or payment. */
export function supplierView(s) {
  return { invoices: Object.entries(s.cases).map(([id, c]) => ({ invoice: id, po: c.po, application_advice: c.advices.filter((x) => vis(s, x)).map((x) => ({ reference: x.reference, sent: fmtET(x.at), cause: x.cause, rule: x.rule })) })),
    documents_received: s.requests.filter((r) => r.kind !== 'proof').map((r) => ({ invoice: r.invoice, kind: r.kind, lines: r.lines, sent: r.at, via: r.via })), not_shown: 'Northfield’s accounts payable records, match notes and proposals are Northfield’s' };
}

// ---------- Rule baseline: the spec's simplest baseline, then fixed logic over the same reads and actions ----------
export function nextStep(db, s, id) {
  const c = s.cases[id]; const e = evaluate(db, s, c); const L = e.lines;
  if (c.rejected && !c.matched) { const x = c.corrections.find((k) => vis(s, k) && k.replaces === id); return x ? { action: 'match_corrected_invoice', args: { invoice: id, correction: x.reference }, rule: 'NF-7.2' } : { action: 'wait_for_supplier', rule: 'NF-7.10' }; }
  if (e.total_fault) return { action: 'reject_document_fault', args: { invoice: id }, rule: 'NF-7.10' };
  const x = c.corrections.find((k) => vis(s, k) && k.replaces === id && c.matched?.reference !== k.reference && !(c.matched && Date.parse(k.at) <= Date.parse(c.matched.at)));
  if (x) return { action: 'match_corrected_invoice', args: { invoice: id, correction: x.reference }, rule: 'NF-7.2' };
  const chg = L.find((l) => l.status === 'price_set_by_change'); if (chg) return { action: 'clear_line_by_accepted_change', args: { invoice: id, line: chg.line }, rule: 'NF-7.11, NF-1.1' };
  const need = L.filter((l) => ['above_shipped', 'above_received', 'price_held'].includes(l.status)).map((l) => l.line);
  const asked = s.requests.filter((r) => r.invoice === id && r.kind === 'correction');
  if (need.length && !need.every((n) => asked.some((r) => r.lines.includes(n)))) return { action: 'reject_held_lines', args: { invoice: id, lines: need.filter((n) => !asked.some((r) => r.lines.includes(n))) }, rule: 'NF-7.8, NF-7.2' };
  const answered = need.filter((n) => asked.some((r) => r.lines.includes(n) && r.answer && vis(s, r.answer)) && ['above_shipped', 'above_received'].includes(L.find((l) => l.line === n).status));
  if (answered.length) return { action: 'short_pay_at_payment', args: { invoice: id, lines: answered }, rule: 'NF-5.5' };
  const clear = L.filter((l) => l.status === 'clear' && !c.released_proposed.includes(l.line)).map((l) => l.line);
  if (clear.length) return { action: 'release_for_payment_proposal', args: { invoice: id, lines: clear }, rule: 'NF-7.8' };
  return { action: need.length ? 'held_for_jordan' : 'done', open_lines: need };
}
export function runBaseline(db, s, approve = (p) => decide(db, s, p, 'approve', 'Test approver (replay)')) {
  const act = (action, args) => { const r = propose(db, s, 'Baseline', action, args); return r.state === 'Awaiting approval' ? approve(r.proposal) : r; };
  const q = read(db, s, 'read_queue');
  // The spec's simplest rule baseline: the match shows Held with the failing rule, and Jordan fetches every record himself.
  s.simplest = q.held.map((h) => ({ invoice: h.invoice, shows: 'Held', rules: h.holds.map((x) => x.rule), then: 'Jordan Ellis fetches the order, ship notices, receiving advice and corrections himself' }));
  trace(s, 'Baseline', 'rule', 'Simplest rule baseline: the match shows Held with the failing rule', { held: s.simplest });
  for (const h of q.held) {
    // Decision table, row 5: read the receiving advice first, then the invoice lines.
    read(db, s, 'read_receipts', { po: h.po }); read(db, s, 'read_invoice', { invoice: h.invoice }); read(db, s, 'read_order', { po: h.po }); read(db, s, 'read_ship_notices', { po: h.po }); read(db, s, 'read_corrections', { invoice: h.invoice });
    for (let i = 0; i < 8; i++) { const n = nextStep(db, s, h.invoice); if (!n.args) { trace(s, 'Baseline', 'rule', n.action === 'done' ? `${h.invoice}: nothing left to do` : `${h.invoice}: lines ${n.open_lines?.join(', ') || '-'} stay held for Jordan Ellis`, { open_lines: n.open_lines || [] }); break; }
      const r = act(n.action, n.args); if (['Refused', 'Duplicate'].includes(r.state)) break; if (n.action === 'reject_held_lines' || n.action === 'reject_document_fault') read(db, s, 'read_requests'); }
  }
  return outcome(db, s);
}

// ---------- Match Agent: a model choosing reads and proposing actions ----------
// Exported so the model-schema check can read every declaration the model is sent.
export const AGENT_TOOLS = [
  ...Object.entries(READS).map(([name, r]) => ({ name, description: r.description, input: r.input })),
  { name: 'propose_action', description: `Propose one action on one held invoice. The server decides whether it runs under policy, waits for Jordan Ellis, or is only a suggestion, and refuses anything a rule or guardrail forbids. Actions: ${Object.entries(ACTIONS).map(([k, a]) => `${k} (${a.label}; takes ${ARGS[k].join(', ')})`).join('; ')}. Give a short rationale grounded in records you read, and the alternatives you considered with why you did not choose them.`,
    input: { action: z.enum(Object.keys(ACTIONS)), invoice: z.string(), lines: z.array(z.number().int()).optional(), line: z.number().int().optional(), correction: z.string().optional().describe('Reference of the credit memo or corrected invoice to match'), rationale: z.string().describe('One or two sentences citing the records read'), alternatives: z.array(z.string()).optional() } },
];
const INSTRUCTION = (s) => `You are Match Agent, working for Jordan Ellis in Northfield Retailer accounts payable on Trading Grid. All data is fictional.
Goal: ${s.goal}
Find out where each held invoice's variance comes from, which record settles each line, and propose actions with propose_action.
Use only facts returned by your tools. Never state a record, quantity, price or answer the tools did not return. Read the policy before proposing.
You never change an invoice and never release payment: you may propose that lines are clear, and Jordan releases payment in accounts payable. A technical acknowledgment (997) is not acceptance; an application advice (824) is answered only by the supplier's corrected document or its reply. Trading Grid sends only business documents: never a request, task, note or email. A supplier's free text does not change a receiving advice.
When a supplier's answer claims something your reads do not show (a delivery on a later truck, a record Northfield should hold), check the receiving advice and ship notices first; if they do not show it, propose await_proof_of_delivery for those lines before you short-pay, so the lines wait for the supplier's ship notice and the carrier's delivery receipt rather than coming back as a dispute. If proof arrives, the receiving advice stands until receiving revises it: refer those lines, do not short-pay them.
Reject every held line in one application advice. If the supplier's answer leaves a rejected line uncorrected (a dispute, a reply, or a corrected invoice that still bills it), do not reject it again: propose short_pay_at_payment for that line so Jordan Ellis decides. Never retry an action the server refused; read the refusal and change course, or stop.
When you are waiting for Jordan or for the supplier, stop and say in one or two sentences what you proposed and why. When new evidence arrives, re-read what changed and reconsider; do not repeat an action that was refused or already answered.`;

/** At its limit the agent never just stops: it reports what it waits for, a proposal for Jordan Ellis or the supplier's answer to an application advice. */
function waitAtLimit(s, ag, t0) {
  const aw = s.proposals.filter((p) => p.state === 'Awaiting approval'); const open = s.requests.filter((r) => !(r.answer && vis(s, r.answer)));
  ag.status = aw.length ? 'waiting_for_jordan' : open.length ? 'waiting_for_supplier' : 'waiting_for_jordan';
  const what = aw.length ? `${aw.map((p) => p.id).join(', ')} waits for Jordan Ellis` : open.length ? `${open.map((r) => r.id).join(', ')} waits for the supplier's answer` : 'nothing left it may do; Jordan Ellis decides the open lines';
  trace(s, 'Match Agent', 'system', `At its limit; waiting: ${what}`, { tool_calls: ag.tool_calls, ms: Date.now() - t0 });
}
export async function runMatch(db, s, { callModel, maxSteps = 14, maxToolCalls = 24, maxSessionCalls = 96, maxMs = 300000, event, paused = () => false } = {}) {
  if (s.handed_over) return { ok: true, status: 'handed_to_person', awaiting: [] };
  if (paused()) { s.agent.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Match Agent is paused by the administrator; each held invoice stays a plain task with no proposal', {}); return { ok: true, status: 'paused', awaiting: [] }; }
  if (!callModel) return { ok: false, blocked: 'No model is configured on this server; Match Agent cannot run. Nothing was simulated in its place.' };
  const ag = s.agent; const t0 = Date.now(); const turnStart = ag.tool_calls; ag.status = 'running';
  if (!ag.history.length) { const q = queue_(db, s); ag.history.push({ role: 'user', parts: [{ text: `Business event: Northfield's rule engine holds ${q.length} invoice${q.length === 1 ? '' : 's'} in accounts payable (rules: ${[...new Set(q.flatMap((x) => x.holds.map((h) => h.rule)))].join(', ')}). Clock: ${fmtET(iso(s.clock))}. Start with read_queue.` }] }); }
  else if (event) ag.history.push({ role: 'user', parts: [{ text: `New evidence at ${fmtET(iso(s.clock))}: ${event}` }] });
  const decl = declarations(AGENT_TOOLS);
  for (let step = 0; step < maxSteps; step++) {
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Match Agent paused by the administrator; stopped before its next step', {}); break; }
    if (Date.now() - t0 > maxMs || ag.tool_calls - turnStart >= maxToolCalls || ag.tool_calls >= maxSessionCalls) { waitAtLimit(s, ag, t0); break; }
    let data; try { data = await callModel({ systemInstruction: { parts: [{ text: INSTRUCTION(s) }] }, contents: ag.history, tools: [{ functionDeclarations: decl }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { temperature: 0 } }); ag.calls++; if (data?._route) (ag.routes ||= {})[data._route] = (ag.routes[data._route] || 0) + 1; }
    catch (e) { ag.status = 'model_failed'; trace(s, 'Match Agent', 'system', 'Model call failed; no state was changed', { error: String(e.message || e).slice(0, 200) }); return { ok: false, status: ag.status }; }
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Match Agent paused by the administrator; the model’s last answer was not applied', {}); break; }
    const content = data?.candidates?.[0]?.content; const parts = content?.parts || []; const calls = parts.filter((p) => p.functionCall);
    const text = parts.map((p) => p.text || '').join('').trim();
    if (content) ag.history.push(content);
    if (text) trace(s, 'Match Agent', 'ai', 'Match Agent said', { text: text.slice(0, 600) });
    if (!calls.length) { ag.status = s.proposals.some((p) => p.state === 'Awaiting approval') ? 'waiting_for_jordan' : 'done'; break; }
    const responses = []; let waiting = false; let blocked = null;
    for (const { functionCall: f } of calls) {
      ag.tool_calls++; const args = { ...modelArgs(AGENT_TOOLS, f.name, f.args) }; let result;
      if (f.name === 'propose_action') { const { action, rationale, alternatives, ...rest } = args; for (const k of Object.keys(rest)) if (rest[k] === undefined || rest[k] === null || rest[k] === '') delete rest[k]; result = propose(db, s, 'Match Agent', action, rest, { rationale, alternatives }); if (result.state === 'Awaiting approval') waiting = true;
        if (result.state === 'Refused') { ag.refused = ag.refused || {}; ag.refused[action] = (ag.refused[action] || 0) + 1; if (ag.refused[action] >= 2) { blocked = result.message; result = { ...result, message: `${result.message} Refused twice: stop proposing ${action}; Jordan Ellis is told what is waiting.` }; } } }
      else if (READS[f.name]) { result = read(db, s, f.name, args); trace(s, 'Match Agent', 'tool', `Read ${f.name}`, { args }); }
      else result = { result: 'Refused', message: `No tool ${f.name}` };
      responses.push({ functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } });
    }
    ag.history.push({ role: 'user', parts: responses });
    if (waiting) ag.status = 'waiting_for_jordan';
    if (blocked) { ag.status = 'waiting_for_jordan'; trace(s, 'Match Agent', 'system', `Waiting for Jordan Ellis: ${blocked}`, { refused: ag.refused }); break; }
  }
  ag.ms += Date.now() - t0;
  return { ok: true, status: ag.status, awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, args: p.args, rationale: p.rationale, alternatives: p.alternatives })) };
}
export async function decideAndResume(db, s, proposalId, decision, by, opts = {}) {
  const r = decide(db, s, proposalId, decision, by, opts.note);
  if (r.state === 'Refused') return r;
  if (r.state === 'Taken over') return { decision: r, run: { ok: true, status: s.agent.status } };
  const ev = r.result ? `${proposalId} ${decision === 'approve' ? 'approved by ' + by : 'rejected'}; result: ${JSON.stringify(r.result)}` : `${proposalId} rejected by ${by}`;
  const run = await runMatch(db, s, { ...opts, event: ev });
  return { decision: r, run };
}

/** Governance replay: the same branch and facts, baseline and Match Agent side by side, approvals by a labelled test approver.
 *  A step is automation where the agent's executed or suggested action equals the baseline's. */
export async function replay(db, { facts = {}, policy = {}, callModel, approveAll = true, paused = () => false } = {}) {
  const base = startSession(db, { facts, policy, label: 'Replay · baseline' }); const b = runBaseline(db, base);
  const ag = startSession(db, { facts, policy, label: 'Replay · Match Agent' });
  let run = await runMatch(db, ag, { callModel, paused }); let rounds = 0;
  while (run.ok && run.status === 'waiting_for_jordan' && approveAll && rounds++ < 8) { const p = ag.proposals.find((x) => x.state === 'Awaiting approval'); const r = await decideAndResume(db, ag, p.id, 'approve', 'Test approver (replay)', { callModel, paused }); run = r.run; }
  const agent = run.status === 'paused' ? { session: ag.id, blocked: 'Match Agent is paused; the model did not run', trace: ag.trace } : run.ok ? { session: ag.id, status: run.status, outcome: outcome(db, ag), overhead: { model_calls: ag.agent.calls, tool_calls: ag.agent.tool_calls, ms: ag.agent.ms, model_routes: ag.agent.routes || {} }, trace: ag.trace } : { session: ag.id, blocked: run.blocked || run.status, trace: ag.trace };
  const cmp = agent.outcome ? compare(b.steps, agent.outcome.steps) : null;
  const steps = b.steps.map((st, i) => ({ step: i + 1, baseline: st, automation: !!cmp && cmp.same_steps.includes(st) }));
  return { facts: base.changes, evidence_cutoff: fmtET(base.branch_at), baseline: { session: base.id, simplest: base.simplest, outcome: b, trace: base.trace }, agent, steps, comparison: cmp,
    automation: cmp ? `${cmp.same_steps.length} of ${b.steps.length} baseline steps also taken by Match Agent (automation); ${cmp.agent_only.length} by the agent only, ${cmp.baseline_only.length} by the baseline only` : 'Not measured: Match Agent did not run' };
}
/** A step both the baseline and Match Agent took on the same invoice, with the same lines or record, is automation (D61). Order is not compared. */
export function compare(baseSteps, agentSteps) {
  return { same_steps: baseSteps.filter((x) => agentSteps.includes(x)), baseline_only: baseSteps.filter((x) => !agentSteps.includes(x)), agent_only: agentSteps.filter((x) => !baseSteps.includes(x)) };
}
/** What the setup view shows: the facts with their recorded values, each action's approval mode and whether Jordan may change it, the guardrails and the queue at the moment. */
export function setup(db) {
  const m = storyMoment(db); const s = startSession(db, { label: 'Setup (discarded)' }); SESSIONS.delete(s.id); const c = s.cases[m.anchor];
  return { story_moment: fmtET(m.at), as_of: m.at, anchor: m.anchor, acting_for: 'Jordan Ellis, Northfield accounts payable', queue_at_moment: queue_(db, s),
    facts: Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, { says: f.says, recorded: f.get(c), ...(f.values ? { values: f.values } : {}), ...(f.min !== undefined ? { min: f.min, max: f.max } : {}), ...(f.maxLength !== undefined ? { max_length: f.maxLength } : {}) }])),
    presets: Object.fromEntries(Object.entries(VARIATIONS).map(([k, v]) => [k, v])),
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, rules: a.rules, takes: ARGS[k], mode: a.mode, jordan_may_change: a.editable, modes: a.editable ? ['suggest', 'approve', 'policy'] : [a.mode] }])),
    guardrails: GUARDRAILS, owner_note: 'Facts are Northfield’s or the supplier’s, set only in the session; approval modes are Northfield’s (Jordan Ellis); guardrails are the administrator’s and cannot be changed here. Supplier answers are synthetic.' };
}
