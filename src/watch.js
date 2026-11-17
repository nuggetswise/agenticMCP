// Watch Agent runtime for P13 Silent order watch. A session branches the demo world at a story moment (default Wednesday
// 18 November 2026 09:00 ET), hides recorded records after it, and keeps its own writes in memory, so nothing it does reaches
// the recorded world. Shaped like src/scout.js:
//   Rule engine  - the queue of open orders missing a document Northfield requires, and deterministic builds (855 from the
//                  Supplier ERP sales order, 856 only from a load scan or fulfilment record, invoice from the shipped quantity).
//   Watch Agent  - a model choosing which reads to call and which permitted action to propose (runWatch).
//   Priya        - approves or rejects; the server, not the model, decides when her approval is required.
//   Kinross / Northfield (synthetic) - deterministic simulators: Kinross answers a status ask from facts; Northfield returns a
//                  997 (technical only) and, where the recorded world holds it later, the confirming record is revealed.
// A rule baseline (runBaseline) reads the same records and uses the same actions with fixed logic (the spec's decision table).
//
// Visibility. Every recorded record after the branch is hidden from reads. What a read returns after the branch is the
// session's own (drafts, sends, Kinross answers, synthetic 997s, each at or before the session clock) and the confirming
// records revealed for a session action when the clock reaches them: the 861 for a released ship notice, and the 945 with
// Kinross's scans for a status ask.
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { fmtET, et } from '../world/lib.js';
import * as D from './domain.js';
import { declarations, modelRoutes } from './aviator.js';

const MIN = 60000, H = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const J = (x) => (x ? JSON.parse(x) : {});
const SESSIONS = new Map(); const MAX_SESSIONS = 60;
const KINROSS = 'Kinross warehouse system';
// Prepared statements are cached per database: the queue is recomputed after every step.
const STMTS = new WeakMap();
const q1 = (db, sql) => { let m = STMTS.get(db); if (!m) STMTS.set(db, (m = new Map())); let st = m.get(sql); if (!st) m.set(sql, (st = db.prepare(sql))); return st; };
const ESCALATE_HOURS = 2; // Priya's rule: escalate to her when 2 hours are left.
const HORIZON_HOURS = 5; // A baseline or replay run covers Priya's morning: 09:00 to 14:00 ET at the P13 moment.
const MAX_ADVANCE_HOURS = 48; // An explicit advance may run on to two days after the branch, to show later confirmations.

// ---------- Policy: what each action needs, and what no one may change ----------
// mode: 'suggest' (Watch Agent may only suggest), 'approve' (Priya approves each), 'policy' (runs under her standing policy).
export const ACTIONS = {
  draft_acknowledgment: { label: 'Draft the order acknowledgment (855) from the Supplier ERP sales order', actor: 'Trading Grid', rule: 'NF-1.4', mode: 'policy', editable: true, args: ['po'] },
  draft_ship_notice:    { label: 'Draft the ship notice (856) from the load scan or fulfilment record', actor: 'Trading Grid', rule: 'AP-1.4', mode: 'policy', editable: false, args: ['po'] },
  draft_invoice_in_erp: { label: 'Create the invoice in the Supplier ERP from the shipped quantity and draft its 810', actor: 'Supplier ERP', rule: 'AP-3.2', mode: 'approve', editable: true, args: ['po'] },
  release_document:     { label: 'Send a drafted 855, 856 or 810 to Northfield', actor: 'Trading Grid', rule: 'AP-1.3', mode: 'approve', editable: false, args: ['po', 'document'] },
  ask_kinross_status:   { label: 'Ask Kinross for the status of a warehouse order', actor: 'Kinross (email task)', rule: 'AP-3.2', mode: 'approve', editable: true, args: ['po'] },
  flag_erp_record:      { label: 'Flag a fulfilment posted before departure on the Supplier ERP record', actor: 'Supplier ERP', rule: 'AP-3.2', mode: 'approve', editable: true, args: ['po', 'note'] },
  escalate_to_priya:    { label: 'Escalate an order to Priya Raman with what is known', actor: 'Trading Grid (notice to Priya)', rule: 'AP-2.4', mode: 'policy', editable: false, args: ['po', 'message'] },
};
export const GUARDRAILS = [
  { id: 'AP-1.4', owner: 'Administrator', text: 'Never build a ship notice except from a load scan or fulfilment record; quantities are never supplied by hand.' },
  { id: 'AP-3.3', owner: 'Administrator', text: 'Never treat a technical acknowledgment (997) as business acceptance; Northfield sends no business acceptance (NF-1.5).' },
  { id: 'NF-4.2', owner: 'Administrator', text: 'A late document stays Late after it is sent.' },
];
export const MOMENTS = { '2026-11-18 09:00 ET': '2026-11-18T14:00:00.000Z', '2026-11-19 16:00 ET': '2026-11-19T21:00:00.000Z', '2026-11-17 11:00 ET': '2026-11-17T16:00:00.000Z' };
export const P13_MOMENT = '2026-11-18 09:00 ET';

// ---------- Facts a presenter may set; Kinross and the moment are synthetic, the window is Priya's rule ----------
export const FACTS = {
  moment: { values: Object.keys(MOMENTS), recorded: P13_MOMENT, owner: 'Presenter', says: 'Story moment the session branches at: P13 (18 Nov 09:00), NR-46302 early fulfilment (19 Nov 16:00), NR-46156 rejected ship notice (17 Nov 11:00)' },
  kinross_window_hours: { values: [24, 48], recorded: 48, owner: 'Priya Raman', says: 'Priya’s rule: hours after the 940 by which Kinross must return the 945 before the order is flagged' },
  kinross_reachable: { values: ['yes', 'no'], recorded: 'yes', owner: 'Kinross', says: 'Whether Kinross answers a status ask (no: Kinross cannot be reached and its later records stay hidden)' },
  departure_scanned_46220: { values: ['yes', 'no'], recorded: 'no', owner: 'Kinross', says: 'A Kinross departure scan for NR-46220 at 08:30 ET on 18 November, with no load scan and no 945 (P13 moment only)' },
};
export function factsToVariation(facts = {}) {
  const v = {};
  for (const [k, val] of Object.entries(facts)) {
    const f = FACTS[k]; if (!f) throw new Error(`No such fact: ${k}. Facts: ${Object.keys(FACTS).join(', ')}`);
    if (f.values && !f.values.includes(val)) throw new Error(`${k} is one of: ${f.values.join(', ')}`);
    if (f.maxLength !== undefined && (typeof val !== 'string' || val.length > f.maxLength)) throw new Error(`${k} is text of at most ${f.maxLength} characters`);
    v[k] = val;
  }
  if (v.departure_scanned_46220 === 'yes' && (v.moment || P13_MOMENT) !== P13_MOMENT) throw new Error('departure_scanned_46220 applies at the P13 moment only');
  return v;
}
export const VARIATIONS = {
  canonical: { kinross_window_hours: 24 },
  window_48: {},
  kinross_unreachable: { kinross_window_hours: 24, kinross_reachable: 'no' },
  departure_scanned_46220: { kinross_window_hours: 24, departure_scanned_46220: 'yes' },
  early_fulfilment_46302: { moment: '2026-11-19 16:00 ET', kinross_window_hours: 24 },
  rejected_ship_notice_46156: { moment: '2026-11-17 11:00 ET', kinross_window_hours: 24 },
};

// ---------- Sessions ----------
export function startSession(db, { variation = {}, policy = {}, label = 'Operator', goal } = {}) {
  if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
  const facts = { ...Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, f.recorded])), ...factsToVariation(variation) };
  const changes = Object.entries(factsToVariation(variation)).map(([field, to]) => ({ field, from: FACTS[field].recorded, to }));
  const modes = {}; for (const [k, a] of Object.entries(ACTIONS)) { const want = policy[k]; modes[k] = want && a.editable && ['suggest', 'approve', 'policy'].includes(want) ? want : a.mode; }
  const branch = Date.parse(MOMENTS[facts.moment]);
  const id = `WS-${createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10)}`;
  const s = { id, label, created: new Date().toISOString(), facts, changes, modes, branch, clock: branch, horizon: branch + HORIZON_HOURS * H,
    goal: goal || 'Every document Northfield requires reaches it before its deadline under Northfield rules 2026.2. Act for Priya Raman, within Ashby’s rules.',
    rows: new Map(), docs: [], erp: { invoices: {}, notes: [] }, tasks: [], proposals: [], notices: [], synthetic: [], revealed: [], pending: [],
    trace: [], audit: [], reads: [], usedKeys: new Set(), agent: { history: [], status: 'idle', calls: 0, tool_calls: 0, ms: 0 } };
  if (facts.departure_scanned_46220 === 'yes') s.synthetic.push({ at: '2026-11-18T13:30:00.000Z', kind: 'wms.departure_scan', po: 'NR-46220', system: KINROSS, d: { shipment: 'SHP-46220', carrier: 'Lakeline Freight' }, synthetic: true });
  SESSIONS.set(id, s);
  trace(s, 'Trading Grid', 'system', 'Session branched from the recorded world', { at: fmtET(iso(branch)), hidden: 'Every recorded record after this time', changes });
  const q = queue(db, s);
  trace(s, 'Rule engine', 'rule', `${q.rows.length} open orders missing a document Northfield requires; ${q.nothing_to_chase.length} checked with nothing to chase`, { rows: q.rows.map((r) => `${r.po} ${r.document}: ${r.what} (${r.time_left})`), nothing_to_chase: q.nothing_to_chase.map((r) => r.po), kinross_window_hours: facts.kinross_window_hours });
  return s;
}
export const getSession = (id) => SESSIONS.get(id) || null;
function trace(s, actor, type, what, detail = {}) { s.trace.push({ n: s.trace.length + 1, clock: fmtET(iso(s.clock)), actor, type, what, ...(Object.keys(detail).length ? { detail } : {}) }); }
const MODE_APPROVER = { policy: 'Standing policy, set by Priya Raman', suggest: 'None: Watch Agent may only suggest' };
function audit(s, p, outcome) {
  const approver = p.taken_over_by || p.approved_by || (p.needs === 'approve' ? (p.state === 'Awaiting approval' ? 'Priya Raman (awaiting)' : p.rejected_by || 'Priya Raman') : MODE_APPROVER[p.needs]);
  s.audit.push({ session: s.id, proposal: p.id, action: p.action, agent: p.by, authority_rule: ACTIONS[p.action].rule, authority_mode: p.needs, approver, outcome, clock: fmtET(iso(s.clock)) });
}
export const TYPES = { system: 'System', rule: 'Fixed rule', ai: 'AI judgment', human: 'Human approval', external: 'External confirmation', tool: 'Tool call' };

// ---------- Visibility: what the session may see of one order ----------
const cutOf = (s) => s.branch;
const unreachable = (s) => s.facts.kinross_reachable === 'no';
const revealedFor = (s, po, type) => s.revealed.filter((r) => r.po === po && r.type === type && Date.parse(r.at) <= s.clock);
function recordedDocs(db, s, po) {
  return q1(db, 'SELECT doc_id, doc_type, reference, sent_at, status, sender_id FROM documents WHERE po = ? AND test = 0 AND sent_at <= ? ORDER BY sent_at').all(po, iso(cutOf(s))).map((d) => ({ ...d }));
}
function visibleDocs(db, s, po) {
  const rec = recordedDocs(db, s, po).map((d) => ({ doc_type: d.doc_type, reference: d.reference, sent_at: d.sent_at, source: 'Recorded', doc_id: d.doc_id }));
  const rev = revealedFor(s, po, 'doc').map((r) => ({ doc_type: r.doc_type, reference: r.reference, sent_at: r.at, source: r.source }));
  const ses = s.docs.filter((d) => d.po === po && d.state === 'Sent').map((d) => ({ doc_type: d.doc_type, reference: d.reference, sent_at: d.sent_at, source: 'This session' }));
  return [...rec, ...rev, ...ses].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}
function visibleEvents(db, s, po) {
  const rec = q1(db, 'SELECT at, kind, system, data FROM events WHERE po = ? AND at <= ? ORDER BY at').all(po, iso(cutOf(s))).map((e) => ({ at: e.at, kind: e.kind, system: e.system, d: J(e.data) }));
  const syn = s.synthetic.filter((e) => e.po === po && Date.parse(e.at) <= s.clock).map((e) => ({ ...e }));
  const rev = revealedFor(s, po, 'event').map((r) => ({ at: r.event_at, kind: r.kind, system: r.system, d: r.d, revealed: true }));
  return [...rec, ...syn, ...rev].sort((a, b) => a.at.localeCompare(b.at));
}
const lastEv = (evs, kind) => evs.filter((e) => e.kind === kind).pop() || null;
function warehouseOrder(db, s, po) {
  const w = q1(db, 'SELECT * FROM warehouse_orders WHERE po = ? AND sent_at <= ?').get(po, iso(cutOf(s)));
  if (!w) return null;
  const rev = revealedFor(s, po, 'doc').find((r) => r.doc_type === '945');
  const advice = rev ? rev.at : (w.advice_at && w.advice_at <= iso(cutOf(s)) ? w.advice_at : null);
  return { ref: w.ref, site: w.site, sent_at: w.sent_at, advice_at: advice, advice_ref: advice ? (rev ? rev.reference : `WSA-${po.slice(3)}`) : null };
}
/** Open rejections on recorded documents of one type, as the session sees them. */
function openRejection(db, s, po, type) {
  const cut = iso(cutOf(s));
  for (const d of recordedDocs(db, s, po).filter((x) => x.doc_type === type)) {
    const e = q1(db, 'SELECT e.*, r.sent_at rat, c.sent_at cat FROM errors e JOIN documents r ON r.doc_id = e.reported_by LEFT JOIN documents c ON c.doc_id = e.corrected_by WHERE e.doc_id = ?').all(d.doc_id).find((x) => x.rat <= cut && !(x.cat && x.cat <= cut));
    if (e && !s.docs.some((x) => x.po === po && x.doc_type === type && x.corrects === d.reference && x.state === 'Sent')) return { reference: d.reference, sent_at: d.sent_at, cause: e.cause, field: e.field, sent_value: e.sent_value, rule_id: e.rule_id, reported_by: e.reported_by.split(':')[1], reported_at: e.rat };
  }
  return null;
}
const sessionDoc = (s, po, type) => s.docs.filter((d) => d.po === po && d.doc_type === type).pop() || null;
/** The Supplier ERP sales order: the current PO revision as Ashby's ERP holds it at the cut. */
function salesOrder(db, s, po) {
  const cut = iso(cutOf(s));
  const lines = q1(db, 'SELECT line, sku, northfield_item, qty_original, price, uom FROM order_lines WHERE po = ? ORDER BY line').all(po).map((l) => ({ ...l }));
  for (const c of q1(db, 'SELECT line, code, qty FROM order_changes WHERE po = ? AND sent_at <= ? ORDER BY seq').all(po, cut)) { const l = lines.find((x) => x.line === c.line); if (l && c.qty != null) l.qty_original = c.qty; }
  return lines.map((l) => ({ line: l.line, sku: l.sku, northfield_item: l.northfield_item, qty: l.qty_original, uom: l.uom, price: l.price }));
}

// ---------- Rule engine: the queue ----------
/** Open orders missing a document Northfield requires (or the Kinross 945), at the session clock, with each row's state. */
export function queue(db, s) {
  const clock = s.clock, since = iso(s.branch - 12 * 24 * H);
  const orders = q1(db, "SELECT * FROM orders WHERE supplier_id = 'ASHBY' AND stream <> 'store' AND received_at <= ? AND received_at >= ? ORDER BY po").all(iso(cutOf(s)), since);
  const fresh = []; const nothing = []; const watching = [];
  const win = (id) => q1(db, 'SELECT window_hours FROM rules WHERE id = ?').get(id).window_hours;
  for (const o of orders) {
    const docs = visibleDocs(db, s, o.po); const of = (t) => docs.filter((d) => d.doc_type === t);
    const evs = visibleEvents(db, s, o.po); const dep = lastEv(evs, 'wms.departure_scan'), fulfil = lastEv(evs, 'erp.fulfilment_posted'), plan = lastEv(evs, 'erp.shipment_planned');
    const add = (document, kind, what, ruleId, deadline, extra = {}) => fresh.push({ id: `${o.po} ${document}`, po: o.po, document, kind, what, rule: ruleId, deadline: deadline.getTime(), ...extra });
    if (!of('855').length && !of('865').length && !sessionDoc(s, o.po, '855')) { const due = new Date(Date.parse(o.received_at) + win('NF-1.4') * H); if (due - clock <= 8 * H) add('855', 'missing', 'Order acknowledgment not sent', 'NF-1.4', due); }
    const rej856 = openRejection(db, s, o.po, '856');
    if (rej856) add('856', 'rejected', `Ship notice rejected: ${rej856.cause}`, rej856.rule_id || 'NF-4.2', et(o.requested_delivery, o.ship_to === 'DC4' ? '07:00' : '06:00'), { rejection: rej856 });
    else if (dep && !of('856').length) add('856', 'missing', 'Ship notice not sent; the truck has left', 'NF-4.2', new Date(Date.parse(dep.at) + win('NF-4.2') * H), { truck_left: fmtET(dep.at) });
    // Fulfilment posts within 50 minutes of departure across the quarter; an hour with no departure scan is a held shipment.
    else if (!dep && fulfil && !of('856').length && (clock - Date.parse(fulfil.at) >= win('NF-4.2') * H || s.rows.has(`${o.po} 856`))) add('856', 'held', 'Supplier ERP shows the order shipped over an hour ago; no departure scan and no ship notice', 'NF-4.2', new Date((plan ? Date.parse(plan.d.planned_departure) : Date.parse(fulfil.at)) + win('NF-4.2') * H), { fulfilment_posted: fmtET(fulfil.at), planned_departure: plan ? fmtET(plan.d.planned_departure) : null });
    if (dep) { const rej = openRejection(db, s, o.po, '810'); const due = new Date(Date.parse(dep.at) + win('NF-7.9') * H);
      if (rej) add('810', 'rejected', `Invoice rejected: ${rej.cause}`, rej.rule_id || 'NF-7.9', due, { rejection: rej });
      else if (!of('810').length && (due - clock <= 24 * H || s.rows.has(`${o.po} 810`))) add('810', 'missing', 'Invoice not sent', 'NF-7.9', due, { shipped: fmtET(dep.at) }); }
    const w = warehouseOrder(db, s, o.po);
    if (w && !w.advice_at) { const due = new Date(Date.parse(w.sent_at) + s.facts.kinross_window_hours * H);
      if (clock >= due || s.rows.has(`${o.po} 945`)) add('945', 'missing', 'Warehouse shipping advice (945) not received from Kinross', 'KX-945', due, { warehouse_order: w.ref, warehouse_order_sent: fmtET(w.sent_at) });
      else watching.push({ po: o.po, document: '945', warehouse_order: w.ref, sent: fmtET(w.sent_at), due: fmtET(due), time_left: D.timeLeft(due, new Date(clock)), why_not_flagged: `Inside Priya’s ${s.facts.kinross_window_hours}-hour Kinross window` }); }
    const cha = of('865').pop();
    if (cha && clock - Date.parse(cha.sent_at) <= 48 * H) nothing.push({ po: o.po, document: 'Business acceptance of the change acknowledgment (865)', state: 'Not expected', rule: 'NF-1.5', evidence: of('997').some((d) => d.sent_at >= cha.sent_at) ? 'Technical acknowledgment (997) received; Northfield sends no business acceptance' : 'Northfield sends no business acceptance', nothing_to_chase: true });
  }
  for (const r of fresh) { if (!s.rows.has(r.id)) s.rows.set(r.id, { ...r, first_flagged: fmtET(iso(clock)) }); else Object.assign(s.rows.get(r.id), { kind: r.kind, what: r.what, rule: r.rule, deadline: r.deadline, ...(r.rejection ? { rejection: r.rejection } : {}) }); }
  const rows = [...s.rows.values()].map((r) => ({ ...r, ...rowState(db, s, r) })).sort((a, b) => a.deadline - b.deadline)
    .map(({ deadline, ...r }) => ({ ...r, deadline: fmtET(iso(deadline)), time_left: r.closed || /^Sent/.test(r.state) ? null : D.timeLeft(new Date(deadline), new Date(clock)) }));
  return { as_of: fmtET(iso(clock)), kinross_window_hours: s.facts.kinross_window_hours, rows, nothing_to_chase: nothing, watching_not_flagged: watching };
}
/** A row's state from session records. A late document stays Late after it is sent; a row closes only on its business confirmation. */
function rowState(db, s, r) {
  const sd = sessionDoc(s, r.po, r.document === '945' ? '___' : r.document);
  const sentLate = (d) => Date.parse(d.sent_at) > r.deadline;
  const tasks = s.tasks.filter((t) => t.po === r.po);
  if (r.document === '945') {
    const w = warehouseOrder(db, s, r.po);
    if (w?.advice_at) return { state: 'Closed', closed: true, warehouse_status: 'Shipped', confirmation: `Kinross shipping advice (945) ${w.advice_ref} received ${fmtET(w.advice_at)}`, closes_on: 'Kinross 945' };
    const t = tasks.at(-1);
    return { state: t ? (t.state === 'No answer' ? 'Unknown: Kinross did not answer' : 'Asked Kinross; waiting for the 945') : clockPast(s, r) ? 'Overdue' : 'Missing', late: clockPast(s, r), closed: false, warehouse_status: 'Unknown', closes_on: 'Kinross 945' };
  }
  if (r.document === '855') {
    if (sd?.state === 'Sent') return { state: sentLate(sd) ? 'Sent Late' : 'Sent', late: sentLate(sd), closed: true, sent: fmtET(sd.sent_at), technical_ack: sd.technical_ack || 'Awaiting 997', confirmation: 'Nothing further: Northfield returns a 997 only and sends no business acceptance (NF-1.5)', closes_on: 'Sending before the deadline; a 997 is technical only' };
    return { state: sd ? 'Drafted; not sent' : clockPast(s, r) ? 'Late' : 'Missing', late: clockPast(s, r), closed: false, closes_on: 'Sending before the deadline; a 997 is technical only' };
  }
  if (r.document === '856') {
    const sent = s.docs.filter((d) => d.po === r.po && d.doc_type === '856' && d.state === 'Sent').pop();
    if (sent) { const rcv = s.revealed.find((x) => x.po === r.po && x.doc_type === '861' && Date.parse(x.at) <= s.clock);
      const base = { late: sentLate(sent), sent: fmtET(sent.sent_at), reference: sent.reference, technical_ack: sent.technical_ack || 'Awaiting 997', closes_on: 'Northfield receiving advice (861)' };
      if (rcv) return { ...base, state: sentLate(sent) ? 'Closed; sent Late' : 'Closed', closed: true, confirmation: `Receiving advice ${rcv.reference}: ${rcv.received} cartons received; ${rcv.received === sent.cartons ? 'matches' : 'does not match'} the ship notice` };
      return { ...base, state: sentLate(sent) ? 'Sent Late' : 'Sent', closed: false }; }
    const draft = sd && sd.state === 'Draft';
    const state = draft ? 'Drafted; not sent' : r.kind === 'held' ? 'Held: the trailer has not departed' : r.kind === 'rejected' ? 'Rejected' : clockPast(s, r) ? 'Late' : 'Missing';
    return { state, late: clockPast(s, r), closed: false, closes_on: 'Northfield receiving advice (861)' };
  }
  if (r.document === '810') {
    if (sd?.state === 'Sent') return { state: sentLate(sd) ? 'Sent Late' : 'Sent', late: sentLate(sd), closed: false, sent: fmtET(sd.sent_at), technical_ack: sd.technical_ack || 'Awaiting 997', closes_on: 'Northfield payment (remittance), after this session' };
    return { state: sd ? 'Drafted; not sent' : r.kind === 'rejected' ? 'Rejected' : clockPast(s, r) ? 'Late' : 'Missing', late: clockPast(s, r), closed: false, closes_on: 'Northfield payment (remittance), after this session' };
  }
  return { state: 'Missing', closed: false };
}
const clockPast = (s, r) => s.clock > r.deadline;
const openRow = (db, s, po, doc) => queue(db, s).rows.find((r) => r.po === po && (!doc || r.document === doc) && !r.closed) || null;

// ---------- Reads (the evidence Watch Agent and the baseline may use; each cut at the session clock) ----------
const docOut = (d) => ({ type: d.doc_type, reference: d.reference, sent_at: fmtET(d.sent_at), source: d.source, ...(d.doc_type === '997' ? { meaning: 'Technical acknowledgment: receipt only, not business acceptance' } : {}) });
export const READS = {
  read_queue: { description: 'The rule engine’s queue at the session clock: every open order missing a document Northfield requires (or the Kinross 945 under Priya’s window), with its rule, deadline, time left and state; orders checked with nothing to chase; Kinross orders still inside the window.', input: {},
    run: (db, s) => queue(db, s) },
  read_order: { description: 'One order as Ashby sees it at the session clock: lines as ordered now, order changes, documents exchanged with their source, open rejections with their rule, and the Supplier ERP sales order, shipment plan, fulfilment, invoice and notes.', input: { po: z.string().describe('PO number') },
    run: (db, s, a) => { const po = D.normPo(a.po || ''); const o = q1(db, "SELECT * FROM orders WHERE po = ? AND supplier_id = 'ASHBY'").get(po);
      if (!o || Date.parse(o.received_at) > cutOf(s)) return { po, found: false, message: `No order ${po} as of ${fmtET(iso(s.clock))}` };
      const cut = iso(cutOf(s)); const evs = visibleEvents(db, s, po); const fulfil = lastEv(evs, 'erp.fulfilment_posted'), plan = lastEv(evs, 'erp.shipment_planned');
      const inv = s.erp.invoices[po]; const rec810 = visibleDocs(db, s, po).find((d) => d.doc_type === '810');
      const rej = ['856', '810'].map((t) => openRejection(db, s, po, t)).filter(Boolean).map((r) => ({ document: r.reference, cause: r.cause, field: r.field, sent_value: r.sent_value, reported_by: r.reported_by, reported: fmtET(r.reported_at), rule: D.rule(db, r.rule_id) }));
      return { po, found: true, as_of: fmtET(iso(s.clock)), evidence_cutoff: fmtET(cut), received: fmtET(o.received_at), ship_to: o.ship_to, requested_delivery: o.requested_delivery,
        lines: salesOrder(db, s, po).map(({ price, ...l }) => l), order_changes: q1(db, 'SELECT seq change, line, code, qty, sent_at FROM order_changes WHERE po = ? AND sent_at <= ? ORDER BY seq, line').all(po, cut).map((c) => ({ ...c, sent_at: fmtET(c.sent_at) })),
        documents: visibleDocs(db, s, po).map(docOut), open_rejections: rej,
        drafts: s.docs.filter((d) => d.po === po && d.state === 'Draft').map((d) => ({ type: d.doc_type, reference: d.reference, built_from: d.built_from })),
        supplier_erp: { sales_order: { lines: salesOrder(db, s, po), matches_current_order: true }, shipment_plan: plan ? { shipment: plan.d.shipment, site: plan.d.site, planned_departure: fmtET(plan.d.planned_departure), cartons: plan.d.cartons } : 'None',
          fulfilment: fulfil ? { posted: fmtET(fulfil.at), shipment: fulfil.d.shipment, cartons: fulfil.d.cartons } : 'Not posted', invoice: inv ? { reference: inv.reference, total: inv.total, from: inv.from } : rec810 ? `Invoiced: ${rec810.reference}` : 'None', notes: s.erp.notes.filter((n) => n.po === po), substitutions: evs.filter((e) => e.kind === 'erp.substitution').map((e) => ({ at: fmtET(e.at), ...e.d })) },
        session_notices: s.notices.filter((n) => n.po === po) }; } },
  read_warehouse: { description: 'Warehouse records for one order at the session clock: the Kinross warehouse order (940) and shipping advice (945), the load scan, the departure scan and every Kinross reply in this session. Orders shipped from Ashby’s own site have no 940 or 945.', input: { po: z.string().describe('PO number') },
    run: (db, s, a) => { const po = D.normPo(a.po || ''); const evs = visibleEvents(db, s, po); const w = warehouseOrder(db, s, po); const load = lastEv(evs, 'wms.load_scan'), dep = lastEv(evs, 'wms.departure_scan');
      return { po, as_of: fmtET(iso(s.clock)), warehouse_order_940: w ? { reference: w.ref, site: w.site === 'KIN-JOL' ? 'Kinross Joliet' : w.site === 'KIN-GRV' ? 'Kinross Groveport' : w.site, sent: fmtET(w.sent_at) } : 'None: not a Kinross order (ships from Ashby’s own site)',
        shipping_advice_945: w ? (w.advice_at ? { reference: w.advice_ref, received: fmtET(w.advice_at) } : 'Not received') : 'Not applicable',
        load_scan: load ? { at: fmtET(load.at), shipment: load.d.shipment, cartons_loaded: load.d.cartons_loaded, cartons_expected: load.d.cartons_expected, by_sscc: !!load.d.by_sscc, system: load.system, ...(load.d.trailer_state ? { trailer_state: load.d.trailer_state } : {}) } : 'None',
        departure_scan: dep ? { at: fmtET(dep.at), shipment: dep.d.shipment, carrier: dep.d.carrier, system: dep.system } : 'None',
        kinross_replies: s.tasks.filter((t) => t.po === po), warehouse_status: w && !w.advice_at ? 'Unknown until the 945 arrives' : dep ? 'Shipped' : 'Not shipped' }; } },
  read_rules: { description: 'Rules from the catalogue by id (for example NF-1.4, NF-4.2, NF-7.9, NF-1.5, KX-945, AP-1.4, AP-3.3) or by topic words.', input: { ids: z.array(z.string()).optional(), topic: z.string().optional() },
    run: (db, s, a) => a.ids?.length ? { rules: a.ids.map((id) => D.rule(db, id)).filter(Boolean) } : D.rules(db, { topic: a.topic || '' }) },
  read_policy: { description: 'What each action needs (Watch Agent may only suggest, Priya approves, or it runs under her standing policy), Priya’s editable rules (the Kinross 945 window, escalation at 2 hours left), and the administrator guardrails no one may change.', input: {},
    run: (db, s) => ({ actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, done_by: a.actor, rule: a.rule, takes: a.args, needs: s.modes[k] === 'policy' ? 'Runs under Priya’s standing policy' : s.modes[k] === 'approve' ? 'Priya approves' : 'Watch Agent may only suggest; Priya does it by hand' }])),
      priya_rules: { kinross_945_window_hours: s.facts.kinross_window_hours, escalate_when_hours_left: ESCALATE_HOURS, drafts: 'A draft reaches Northfield only when Priya approves its release' }, guardrails: GUARDRAILS }) },
  read_proposals: { description: 'Every action proposed in this session, with its state (awaiting approval, approved, rejected, executed, failed, refused) and its result.', input: {},
    run: (db, s) => ({ proposals: s.proposals.map((p) => ({ id: p.id, action: p.action, args: p.args, state: p.state, result: p.result || null })) }) },
  read_tasks: { description: 'Every status ask sent to Kinross in this session with its state and Kinross’s answer.', input: {},
    run: (db, s) => ({ tasks: s.tasks }) },
};
export function read(db, s, name, args = {}) {
  const r = READS[name]; if (!r) return { result: 'Refused', message: `No read ${name}` };
  const out = r.run(db, s, args);
  s.reads.push({ name, args, out: JSON.stringify(out), clock: s.clock, revealed: s.revealed.filter((x) => Date.parse(x.at) <= s.clock).map((x) => x.reference || `${x.kind}@${x.at}`) });
  return out;
}

// ---------- Actions: proposed by Watch Agent or the baseline, gated by the server, executed by simulators ----------
const keyOf = (action, args) => createHash('sha1').update(JSON.stringify([action, args])).digest('hex').slice(0, 16);
export function propose(db, s, by, action, args = {}, why = {}) {
  const def = ACTIONS[action]; if (!def) return { state: 'Refused', message: `No action ${action}` };
  if (args.po) args = { ...args, po: D.normPo(args.po) };
  const key = keyOf(action, { po: args.po, document: args.document, n: action === 'ask_kinross_status' ? s.tasks.filter((t) => t.po === args.po).length : 0 });
  const open = s.proposals.find((p) => p.key === key && ['Awaiting approval', 'Approved', ...(['ask_kinross_status'].includes(action) ? [] : ['Executed'])].includes(p.state));
  if (open) return { state: 'Duplicate', proposal: open.id, message: `The same action is already ${open.state.toLowerCase()} (${open.id}).` };
  const bad = validate(db, s, action, args); if (bad) { trace(s, 'Trading Grid', 'rule', `Refused ${action}`, { by, args, reason: bad }); return { state: 'Refused', message: bad }; }
  const p = { id: `WP-${s.proposals.length + 1}`, key, action, args, by, rationale: why.rationale || null, alternatives: why.alternatives || [], state: 'Awaiting approval', needs: s.modes[action], at: fmtET(iso(s.clock)) };
  s.proposals.push(p);
  trace(s, by, by === 'Watch Agent' ? 'ai' : 'rule', `Proposed: ${def.label}`, { proposal: p.id, args, rationale: p.rationale, alternatives: p.alternatives, needs: p.needs });
  if (p.needs === 'suggest') { p.state = 'Suggested'; audit(s, p, 'Suggested; Priya does it by hand'); return { state: 'Suggested', proposal: p.id, message: 'Watch Agent may only suggest this action; Priya does it by hand.' }; }
  if (p.needs === 'policy') return execute(db, s, p, 'Standing policy');
  audit(s, p, 'Awaiting approval');
  return { state: 'Awaiting approval', proposal: p.id, approver: 'Priya Raman', rule: def.rule };
}
function validate(db, s, action, a) {
  const def = ACTIONS[action]; const extra = Object.keys(a).filter((k) => !def.args.includes(k));
  if (extra.length) return action === 'draft_ship_notice' ? `AP-1.4: a ship notice is built only from a load scan or fulfilment record; ${extra.join(', ')} cannot be supplied.` : `${action} takes only ${def.args.join(', ')}; refused ${extra.join(', ')}.`;
  if (!a.po) return 'Name the order (po).';
  const po = a.po; const o = q1(db, "SELECT * FROM orders WHERE po = ? AND supplier_id = 'ASHBY'").get(po);
  if (!o || Date.parse(o.received_at) > cutOf(s)) return `No order ${po} as of ${fmtET(iso(s.clock))}.`;
  const q = queue(db, s); const rows = q.rows.filter((r) => r.po === po && !r.closed); const row = (d) => rows.find((r) => r.document === d);
  if (q.nothing_to_chase.some((n) => n.po === po) && !rows.length) return `Nothing to chase on ${po}: Northfield returns a 997 only and sends no business acceptance (NF-1.5).`;
  const evs = visibleEvents(db, s, po); const load = lastEv(evs, 'wms.load_scan'), fulfil = lastEv(evs, 'erp.fulfilment_posted'), dep = lastEv(evs, 'wms.departure_scan');
  switch (action) {
    case 'draft_acknowledgment': { if (!row('855')) return `No order acknowledgment is missing on ${po}.`; if (sessionDoc(s, po, '855')) return `An 855 for ${po} is already drafted in this session.`; return null; }
    case 'draft_ship_notice': { if (!load && !fulfil) return `AP-1.4: a ship notice is built only from a load scan or fulfilment record, and ${po} has neither.`;
      if (!row('856')) return `No ship notice is missing or rejected on ${po}.`;
      if (s.docs.some((d) => d.po === po && d.doc_type === '856' && d.state === 'Draft')) return `A ship notice for ${po} is already drafted and not sent.`; return null; }
    case 'draft_invoice_in_erp': { if (!row('810') || row('810').kind !== 'missing') return `No invoice is missing on ${po}.`; if (s.erp.invoices[po]) return `The Supplier ERP already holds invoice ${s.erp.invoices[po].reference} for ${po}.`;
      if (!shippedLines(db, s, po)) return `Nothing on ${po} records a shipped quantity (no ship notice sent).`; return null; }
    case 'release_document': { if (!['855', '856', '810'].includes(a.document)) return 'Name the document to release: 855, 856 or 810.';
      const d = s.docs.find((x) => x.po === po && x.doc_type === a.document && x.state === 'Draft'); if (!d) return `There is no drafted ${a.document} for ${po} to release.`;
      if (a.document === '856' && !dep) return `NF-4.2: a ship notice is sent after departure, and ${po} has no departure scan.`; return null; }
    case 'ask_kinross_status': { const w = warehouseOrder(db, s, po); if (!w) return `${po} is not a Kinross order; it ships from Ashby’s own site.`; if (w.advice_at) return `Kinross already returned the 945 for ${po}.`;
      const last = s.tasks.filter((t) => t.po === po).pop(); if (last && s.clock - Date.parse(last.sent_iso) < 60 * MIN) return `Kinross was asked about ${po} ${Math.round((s.clock - Date.parse(last.sent_iso)) / MIN)} minutes ago; ask again after 60 minutes.`; return null; }
    case 'flag_erp_record': { if (!fulfil || dep) return `No fulfilment posted before departure on ${po}.`; if (s.erp.notes.some((n) => n.po === po)) return `The Supplier ERP record for ${po} is already flagged.`; if (a.note && a.note.length > 300) return 'A note is at most 300 characters.'; return null; }
    case 'escalate_to_priya': { if (!rows.length) return `Nothing is open on ${po}.`; if (!a.message || a.message.length > 600) return 'Give the message for Priya (at most 600 characters).'; if (s.notices.some((n) => n.po === po && n.kind === 'escalation' && s.clock - n.at_ms < 60 * MIN)) return `${po} was escalated less than an hour ago.`; return null; }
  }
  return null;
}
export function decide(db, s, proposalId, decision, by = 'Priya Raman', note) {
  const p = s.proposals.find((x) => x.id === proposalId);
  if (!p) return { state: 'Refused', message: `No proposal ${proposalId}` };
  if (p.state !== 'Awaiting approval') return { state: 'Refused', message: `${proposalId} is ${p.state.toLowerCase()}; an approval cannot be replayed.` };
  if (decision === 'edit') { p.state = 'Taken over'; p.taken_over_by = by; p.note = note || null; s.handed_over = { by, proposal: p.id, note: p.note, at: fmtET(iso(s.clock)) }; s.agent.status = 'handed_to_person';
    trace(s, by, 'human', `Edit suggestion: ${by} set ${p.id} aside and does the case by hand`, { action: p.action, note: p.note }); audit(s, p, `Taken over by ${by}; done by hand${p.note ? `: ${p.note}` : ''}`); return { state: 'Taken over', proposal: p.id, by }; }
  if (decision !== 'approve') { p.state = 'Rejected'; p.rejected_by = by; trace(s, by, 'human', `Rejected ${p.id}`, { action: p.action }); audit(s, p, 'Rejected'); return { state: 'Rejected', proposal: p.id }; }
  // Validated again at approval: the world may have moved since the proposal (UI pace: one minute per decision).
  s.clock += MIN; tick(db, s);
  const bad = validate(db, s, p.action, p.args); if (bad) { p.state = 'Failed'; p.result = { state: 'Refused', response: bad }; trace(s, 'Trading Grid', 'rule', `Refused at approval: ${p.id}`, { reason: bad }); audit(s, p, `Failed: ${bad}`); return { state: 'Failed', proposal: p.id, result: p.result }; }
  p.state = 'Approved'; p.approved_by = by; trace(s, by, 'human', `Approved ${p.id}: ${ACTIONS[p.action].label}`, { args: p.args });
  return execute(db, s, p, by);
}
/** Shipped quantity: the session's own sent ship notice, else the recorded one the session can see. */
function shippedLines(db, s, po) {
  const own = s.docs.filter((d) => d.po === po && d.doc_type === '856' && d.state === 'Sent').pop(); if (own) return { from: `Ship notice ${own.reference} (this session)`, lines: own.lines };
  const rec = recordedDocs(db, s, po).filter((d) => d.doc_type === '856').pop(); if (!rec) return null;
  const lines = q1(db, 'SELECT line, sku, qty FROM shipment_lines WHERE shipment_id = (SELECT shipment_id FROM shipments WHERE doc_id = ? OR shipment_id = ? LIMIT 1) ORDER BY line').all(rec.doc_id, rec.reference).map((l) => ({ ...l }));
  return lines.length ? { from: `Ship notice ${rec.reference}`, lines } : null;
}
const sref = (s) => s.id.slice(3, 7).toUpperCase();
function schedule(s, item) { if (!s.pending.some((p) => p.key === item.key) && !s.revealed.some((r) => r.key === item.key)) s.pending.push(item); }
/** Moves pending reveals whose time has come into the session, in time order. */
export function tick(db, s) {
  const due = s.pending.filter((p) => Date.parse(p.at) <= s.clock).sort((a, b) => a.at.localeCompare(b.at) || (a.event_at || a.at).localeCompare(b.event_at || b.at)); const out = [];
  for (const p of due) {
    s.pending.splice(s.pending.indexOf(p), 1); s.revealed.push(p); out.push(p);
    if (p.on) p.on(s);
    trace(s, p.actor, 'external', p.what, { at: fmtET(p.at), ...(p.reference ? { record: p.reference } : {}), synthetic: !!p.synthetic, ...(p.note ? { note: p.note } : {}) });
  }
  return out;
}
export function advance(db, s, { minutes, to } = {}) {
  const target = Math.min(to != null ? to : s.clock + (minutes || 0) * MIN, s.branch + MAX_ADVANCE_HOURS * H); if (target > s.clock) s.clock = target;
  const arrived = tick(db, s); if (arrived.length) queue(db, s);
  return arrived;
}
function execute(db, s, p, by) {
  if (s.usedKeys.has(p.key + p.id)) return { state: 'Refused', message: 'Already executed' }; s.usedKeys.add(p.key + p.id);
  const a = p.args, po = a.po; let r;
  switch (p.action) {
    case 'draft_acknowledgment': {
      const lines = salesOrder(db, s, po); s.clock += 2 * MIN;
      const d = { doc_type: '855', po, reference: `ACK-${po.slice(3)}-W${sref(s)}`, state: 'Draft', built_from: 'Supplier ERP sales order', lines: lines.map((l) => ({ ...l, status: 'Accepted as ordered (IA)' })), synthetic: true }; s.docs.push(d);
      trace(s, 'Rule engine', 'rule', `855 drafted from the Supplier ERP sales order: ${lines.length} lines, every line as ordered`, { reference: d.reference });
      r = { state: 'Completed', response: `Drafted ${d.reference} from the Supplier ERP sales order; not sent`, draft: d }; break; }
    case 'draft_ship_notice': {
      const evs = visibleEvents(db, s, po); const load = lastEv(evs, 'wms.load_scan'), fulfil = lastEv(evs, 'erp.fulfilment_posted'); const row = openRow(db, s, po, '856');
      const cartons = load ? load.d.cartons_loaded : fulfil.d.cartons; s.clock += 2 * MIN;
      const d = { doc_type: '856', po, reference: `ASN-${po.slice(3)}-W${sref(s)}`, state: 'Draft', built_from: load ? `Load scan ${fmtET(load.at)} (${load.system})` : `Supplier ERP fulfilment ${fmtET(fulfil.at)}`, cartons, shipment: (load || fulfil).d.shipment,
        lines: salesOrder(db, s, po).map(({ line, sku, northfield_item, qty, uom }) => ({ line, sku, northfield_item, qty, uom })), ...(row?.kind === 'rejected' ? { corrects: row.rejection.reference, correction: `Items from the current PO revision; replaces the item ${row.rejection.sent_value} rejected under ${row.rejection.rule_id}` } : {}), synthetic: true };
      s.docs.push(d); trace(s, 'Rule engine', 'rule', `Ship notice drafted from the ${load ? 'load scan' : 'Supplier ERP fulfilment record'}: ${cartons} cartons${d.corrects ? `; corrects ${d.corrects}` : ''}`, { reference: d.reference, built_from: d.built_from });
      r = { state: 'Completed', response: `Drafted ${d.reference} for ${cartons} cartons; not sent`, draft: d }; break; }
    case 'draft_invoice_in_erp': {
      const sh = shippedLines(db, s, po); const so = salesOrder(db, s, po); s.clock += 3 * MIN;
      const lines = sh.lines.map((l) => { const pr = so.find((x) => x.line === l.line)?.price || 0; return { line: l.line, sku: l.sku, qty: l.qty, price: pr, amount: Math.round(l.qty * pr * 100) / 100 }; });
      const total = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100; const ref = `INV-${po.slice(3)}-W${sref(s)}`;
      s.erp.invoices[po] = { reference: ref, total, from: sh.from, lines };
      s.docs.push({ doc_type: '810', po, reference: ref, state: 'Draft', built_from: `Supplier ERP invoice from the shipped quantity (${sh.from})`, lines, total, synthetic: true });
      trace(s, 'Supplier ERP', 'external', `Invoice ${ref} created from the shipped quantity: $${total.toFixed(2)}; 810 drafted`, { from: sh.from });
      r = { state: 'Completed', response: `Supplier ERP invoice ${ref} for $${total.toFixed(2)} from ${sh.from}; 810 drafted, not sent`, invoice: s.erp.invoices[po] }; break; }
    case 'release_document': {
      const d = s.docs.find((x) => x.po === po && x.doc_type === a.document && x.state === 'Draft'); const row = [...s.rows.values()].find((x) => x.po === po && x.document === a.document);
      s.clock += 2 * MIN; d.state = 'Sent'; d.sent_at = iso(s.clock); d.released_by = by; d.late = row ? s.clock > row.deadline : false;
      trace(s, 'Trading Grid', 'system', `${a.document} ${d.reference} sent to Northfield${d.late ? '; recorded Late' : ''}`, { at: fmtET(d.sent_at), released_by: by, rule: row?.rule, late: d.late });
      const ack = `FA-W${sref(s)}${s.docs.indexOf(d) + 1}`;
      schedule(s, { key: `997:${d.reference}`, type: 'doc', doc_type: '997', po, reference: ack, at: iso(s.clock + 5 * MIN), actor: 'Northfield (synthetic)', what: `Technical acknowledgment (997) ${ack} for ${d.reference}: receipt only, not business acceptance`, synthetic: true, source: 'Northfield (synthetic)', on: () => { d.technical_ack = `997 ${ack} received; technical only, not business acceptance`; } });
      if (a.document === '856') { const rc = q1(db, 'SELECT receipt, received_at, sum(qty) qty FROM receipts WHERE po = ? AND received_at > ? GROUP BY receipt ORDER BY received_at').get(po, iso(cutOf(s)));
        if (rc) { const cartons = rc.qty; schedule(s, { key: `861:${po}`, type: 'doc', doc_type: '861', po, reference: rc.receipt, at: iso(Math.max(Date.parse(rc.received_at), s.clock + 10 * MIN)), received: cartons, actor: 'Northfield (recorded receipt)', what: `Receiving advice (861) ${rc.receipt}: ${cartons} cartons received; ${cartons === d.cartons ? 'matches' : 'does not match'} ship notice ${d.reference}`, source: 'Northfield (recorded; revealed as the confirming record)' }); } }
      r = { state: 'Completed', response: `${d.reference} sent at ${fmtET(d.sent_at)}${d.late ? '; Late (stays Late)' : ''}. A 997 follows; it is technical only.`, late: d.late }; break; }
    case 'ask_kinross_status': {
      s.clock += 10 * MIN; const w = warehouseOrder(db, s, po);
      const t = { id: `KT-${s.tasks.length + 1}`, po, proposal: p.id, sent_at: fmtET(iso(s.clock - 10 * MIN)), sent_iso: iso(s.clock - 10 * MIN), synthetic: true };
      if (unreachable(s)) Object.assign(t, { state: 'No answer', response: 'Kinross did not answer; warehouse status Unknown' });
      else {
        const rec = q1(db, 'SELECT advice_at FROM warehouse_orders WHERE po = ?').get(po); const kev = q1(db, 'SELECT at, kind, system, data FROM events WHERE po = ? AND system = ? AND at > ? ORDER BY at').all(po, KINROSS, iso(cutOf(s)));
        const now = iso(s.clock); const syn = s.synthetic.find((e) => e.po === po && e.kind === 'wms.departure_scan');
        const recDep = kev.find((e) => e.kind === 'wms.departure_scan' && e.at <= now), recLoad = kev.find((e) => e.kind === 'wms.load_scan' && e.at <= now);
        const response = syn ? `The trailer left at ${fmtET(syn.at)}; the load scan and 945 follow when our 945 job runs` : rec?.advice_at && rec.advice_at <= now ? `945 sent at ${fmtET(rec.advice_at)}` : recDep ? `Departed at ${fmtET(recDep.at)}; the 945 follows` : recLoad ? 'Loaded; the trailer has not departed' : 'Picked; the load is not on a trailer and has not departed';
        Object.assign(t, { state: 'Answered', response });
        // The confirming record: the recorded 945 and the Kinross scans before it, revealed when the clock reaches them.
        if (rec?.advice_at && rec.advice_at > iso(cutOf(s))) {
          // Kinross's load and departure scans arrive with its 945 (the confirming record), each keeping its own time.
          const with945 = iso(Math.max(Date.parse(rec.advice_at), s.clock));
          for (const e of kev.filter((x) => x.at <= rec.advice_at && !(syn && x.kind === 'wms.departure_scan'))) schedule(s, { key: `ev:${po}:${e.kind}:${e.at}`, type: 'event', po, kind: e.kind, system: e.system, d: J(e.data), at: with945, event_at: e.at, actor: 'Kinross (recorded)', what: `Kinross ${e.kind === 'wms.load_scan' ? `load scan: ${J(e.data).cartons_loaded} of ${J(e.data).cartons_expected} cartons` : 'departure scan'} at ${fmtET(e.at)}, sent with the 945`, source: 'Kinross (recorded; revealed with the 945)' });
          schedule(s, { key: `945:${po}`, type: 'doc', doc_type: '945', po, reference: `WSA-${po.slice(3)}`, at: with945, actor: 'Kinross (recorded)', what: `Kinross shipping advice (945) WSA-${po.slice(3)} received`, source: 'Kinross (recorded; revealed as the confirming record)' });
        }
      }
      s.tasks.push(t); trace(s, 'Kinross (synthetic)', 'external', `Kinross ${t.state === 'No answer' ? 'did not answer' : 'answered'} the status ask on ${po}`, { task: t.id, response: t.response, note: t.note || null });
      r = { state: t.state === 'No answer' ? 'Sent' : 'Completed', response: t.response, ...(t.note ? { note: t.note } : {}), warehouse_status: w?.advice_at ? 'Shipped' : 'Unknown until the 945 arrives' }; tick(db, s); break; }
    case 'flag_erp_record': { s.clock += MIN; const n = { po, note: a.note || 'Fulfilment posted before the trailer departed; no 945 and no departure scan yet', by, at: fmtET(iso(s.clock)) }; s.erp.notes.push(n);
      trace(s, 'Supplier ERP', 'external', `Note added to the fulfilment record of ${po}`, { note: n.note }); r = { state: 'Completed', response: 'Note added on the Supplier ERP record' }; break; }
    case 'escalate_to_priya': { s.clock += MIN; s.notices.push({ po, kind: 'escalation', message: a.message, at: fmtET(iso(s.clock)), at_ms: s.clock, by: p.by });
      trace(s, 'Trading Grid', 'system', `Escalated ${po} to Priya Raman`, { message: a.message }); r = { state: 'Delivered', response: 'Priya Raman notified with what is known' }; break; }
    default: r = { state: 'Refused', response: 'Unknown action' };
  }
  tick(db, s);
  p.state = ['Completed', 'Delivered', 'Sent'].includes(r.state) ? 'Executed' : 'Failed'; p.result = r; p.executed_under = by;
  audit(s, p, `${p.state}: ${r.response || r.state}`);
  return { state: p.state, proposal: p.id, result: r };
}

// ---------- Outcome and verification ----------
export function outcome(db, s) {
  const q = queue(db, s); const sent = s.docs.filter((d) => d.state === 'Sent'); const violations = [];
  for (const d of s.docs.filter((x) => x.doc_type === '856')) if (!/^Load scan|^Supplier ERP fulfilment/.test(d.built_from)) violations.push(`AP-1.4: ${d.reference} not built from a load scan or fulfilment record`);
  for (const d of sent) { const p = s.proposals.find((x) => x.action === 'release_document' && x.args.po === d.po && x.args.document === d.doc_type && x.state === 'Executed'); if (!p?.approved_by) violations.push(`${d.reference} sent without Priya’s approval`); }
  for (const r of q.rows) { if (/accept/i.test(r.state)) violations.push(`AP-3.3: ${r.po} ${r.document} shown as accepted`); if (r.sent && r.late && !/Late/.test(r.state)) violations.push(`NF-4.2: ${r.po} ${r.document} was late and is not shown Late`); }
  for (const n of q.nothing_to_chase) if (s.proposals.some((p) => p.args.po === n.po && p.state === 'Executed')) violations.push(`${n.po} chased though nothing is expected`);
  return { as_of: q.as_of, rows: q.rows.map((r) => ({ po: r.po, document: r.document, state: r.state, late: !!r.late, closed: !!r.closed, ...(r.confirmation ? { confirmation: r.confirmation } : {}), ...(r.technical_ack ? { technical_ack: r.technical_ack } : {}) })),
    sent_on_time: sent.filter((d) => !d.late).map((d) => `${d.po} ${d.doc_type}`), sent_late: sent.filter((d) => d.late).map((d) => `${d.po} ${d.doc_type}`),
    kinross_asked: [...new Set(s.tasks.map((t) => t.po))], kinross_confirmed: q.rows.filter((r) => r.document === '945' && r.closed).map((r) => r.po), escalated: [...new Set(s.notices.filter((n) => n.kind === 'escalation').map((n) => n.po))], erp_flagged: s.erp.notes.map((n) => n.po),
    nothing_to_chase: q.nothing_to_chase.map((n) => n.po), business_acceptance_shown: false, approvals: s.trace.filter((t) => t.type === 'human').length,
    actions_executed: s.proposals.filter((p) => p.state === 'Executed').length, actions_failed: s.proposals.filter((p) => p.state === 'Failed').length, actions_refused: s.trace.filter((t) => /^Refused/.test(t.what)).length, violations,
    synthetic: 'Kinross answers, 997s and session documents are synthetic, from the deterministic rules in src/watch.js; 861s and 945s are recorded records revealed as confirmations' };
}

// ---------- Rule baseline: the same reads and actions, fixed logic (the spec's decision table), structured fields only ----------
/** One pass over the queue: the next step for each open row, from the records alone. Free-text notes are never read. */
export function baselinePass(db, s, act) {
  const q = read(db, s, 'read_queue'); const done = [];
  for (const r of q.rows.filter((x) => !x.closed)) {
    const row = s.rows.get(r.id); const hoursLeft = (row.deadline - s.clock) / H;
    const escalate = (why) => { if (!s.notices.some((n) => n.po === r.po && n.kind === 'escalation')) done.push(act('escalate_to_priya', { po: r.po, message: `${r.po} ${r.document}: ${why}. ${D.timeLeft(new Date(row.deadline), new Date(s.clock))}.` })); };
    const askKinross = (wh) => { const t = s.tasks.filter((x) => x.po === r.po); const last = t.at(-1);
      if (!wh.warehouse_order_940?.reference || wh.shipping_advice_945 !== 'Not received') return;
      if (!last || (last.state === 'No answer' && t.length < 3 && s.clock - Date.parse(last.sent_iso) >= 60 * MIN)) done.push(act('ask_kinross_status', { po: r.po })); };
    if (r.document === '855' && /^(Missing|Late)$/.test(r.state)) { done.push(act('draft_acknowledgment', { po: r.po })); done.push(act('release_document', { po: r.po, document: '855' })); }
    else if (r.document === '855' && /^Drafted/.test(r.state)) done.push(act('release_document', { po: r.po, document: '855' }));
    else if (r.document === '856') {
      const wh = read(db, s, 'read_warehouse', { po: r.po }); const ord = read(db, s, 'read_order', { po: r.po });
      const source = wh.load_scan !== 'None' || ord.supplier_erp.fulfilment !== 'Not posted'; const departed = wh.departure_scan !== 'None';
      if (/^Drafted/.test(r.state)) { if (departed) done.push(act('release_document', { po: r.po, document: '856' })); }
      else if (r.kind === 'rejected') { done.push(act('draft_ship_notice', { po: r.po })); done.push(act('release_document', { po: r.po, document: '856' })); }
      else if (r.kind === 'held') { if (!s.erp.notes.some((n) => n.po === r.po)) done.push(act('flag_erp_record', { po: r.po })); askKinross(wh); if (hoursLeft <= ESCALATE_HOURS) escalate('Supplier ERP shows shipped; no departure scan and no 945'); }
      else if (departed && source && /^(Missing|Late)$/.test(r.state)) { done.push(act('draft_ship_notice', { po: r.po })); done.push(act('release_document', { po: r.po, document: '856' })); }
      else if (departed && !source) { askKinross(wh); if (hoursLeft <= ESCALATE_HOURS) escalate('departed with no load scan and no fulfilment record; no ship notice can be built'); }
    }
    else if (r.document === '810' && r.kind === 'missing') {
      if (/^Drafted/.test(r.state)) done.push(act('release_document', { po: r.po, document: '810' }));
      else if (/^(Missing|Late)$/.test(r.state)) { const ord = read(db, s, 'read_order', { po: r.po }); if (ord.supplier_erp.invoice === 'None') done.push(act('draft_invoice_in_erp', { po: r.po })); done.push(act('release_document', { po: r.po, document: '810' })); }
    }
    else if (r.document === '945') {
      const wh = read(db, s, 'read_warehouse', { po: r.po }); askKinross(wh);
      const last = s.tasks.filter((x) => x.po === r.po).at(-1); if (last?.state === 'No answer' && hoursLeft <= ESCALATE_HOURS) escalate('Kinross cannot be reached; warehouse status Unknown');
    }
  }
  return done.filter(Boolean);
}
export function runBaseline(db, s, approve = (id) => decide(db, s, id, 'approve', 'Test approver (replay)')) {
  const act = (action, args) => { const r = propose(db, s, 'Baseline', action, args); return r.state === 'Awaiting approval' ? approve(r.proposal) : r; };
  // Steps at the earliest of: the next confirming record, the next 2-hours-left mark of an open row, or one hour on; to the horizon.
  for (let i = 0; i < 200 && s.clock <= s.horizon; i++) {
    baselinePass(db, s, act);
    const marks = [s.clock + H, ...s.pending.map((p) => Date.parse(p.at)), ...[...s.rows.values()].map((r) => r.deadline - ESCALATE_HOURS * H)].filter((t) => t > s.clock);
    const next = Math.min(...marks); if (next > s.horizon) break; advance(db, s, { to: next });
  }
  return outcome(db, s);
}

// ---------- Watch Agent: a model choosing reads and proposing actions ----------
const AGENT_TOOLS = [
  ...Object.entries(READS).map(([name, r]) => ({ name, description: r.description, input: r.input })),
  { name: 'propose_action', description: `Propose one action. The server decides whether it runs under policy or waits for Priya Raman, and refuses anything a rule or guardrail forbids. Actions: ${Object.entries(ACTIONS).map(([k, a]) => `${k} (${a.label}; takes ${a.args.join(', ')})`).join('; ')}. Give a short rationale grounded in records you read, and the alternatives you considered with why you did not choose them.`,
    input: { action: z.enum(Object.keys(ACTIONS)), po: z.string().describe('PO number'), document: z.enum(['855', '856', '810']).optional().describe('With release_document: which drafted document to send'), note: z.string().optional().describe('With flag_erp_record'), message: z.string().optional().describe('With escalate_to_priya: what Priya needs to know'), rationale: z.string().describe('One or two sentences citing the records read'), alternatives: z.array(z.string()).optional().describe('Options considered and why not chosen') } },
];
const INSTRUCTION = (s) => `You are Watch Agent, working for Priya Raman at Ashby Supplier on Trading Grid. All data is fictional.
Goal: ${s.goal}
Find the open orders that are missing a document Northfield requires, find out from the source records why each is missing, and propose the next step for each with propose_action.
Use only facts returned by your tools. Never state a record, quantity or confirmation the tools did not return. Read the policy before proposing. A proposal that waits for approval is not done. A technical acknowledgment (997) is never business acceptance. A ship notice is confirmed only by Northfield's receiving advice (861); a Kinross request only by the 945. A late document stays Late after it is sent.
A draft made under Priya's standing policy has not reached Northfield: once a document is drafted, propose release_document for it in the same pass, so every drafted document waits for Priya's decision rather than sitting unsent.
Never retry an action the server refused; read the refusal and change course, or stop and say what waits for Priya.
When you are waiting for Priya, Kinross or Northfield, stop and say in one or two sentences what you proposed and why. When new evidence arrives, re-read what changed and reconsider; do not repeat an action a party already answered for the same reason.`;

/** At its limit the agent never just stops: it reports what it waits for, a proposal for Priya Raman or an answer from Kinross or Northfield. */
function waitAtLimit(s, ag, t0) {
  const aw = s.proposals.filter((p) => p.state === 'Awaiting approval');
  ag.status = 'waiting_for_priya';
  const what = aw.length ? `${aw.map((p) => p.id).join(', ')} waits for Priya Raman` : 'nothing left it may do; Priya Raman decides what is open';
  trace(s, 'Watch Agent', 'system', `At its limit; waiting: ${what}`, { tool_calls: ag.tool_calls, ms: Date.now() - t0 });
}
export async function runWatch(db, s, { callModel, maxSteps = 14, maxToolCalls = 24, maxSessionCalls = 96, maxMs = 300000, event, paused = () => false } = {}) {
  if (s.handed_over) return { ok: true, status: 'handed_to_person', awaiting: [] };
  if (paused()) { s.agent.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Watch Agent is paused by the administrator; the queue arrives as plain tasks with no proposal', {}); return { ok: true, status: 'paused', awaiting: [] }; }
  if (!callModel) return { ok: false, blocked: 'No model is configured on this server; Watch Agent cannot run. Nothing was simulated in its place.' };
  const ag = s.agent; const t0 = Date.now(); const turnStart = ag.tool_calls; ag.status = 'running';
  if (!ag.history.length) ag.history.push({ role: 'user', parts: [{ text: `Business event: the morning check of Ashby’s open Northfield orders against the documents Northfield requires. Clock: ${fmtET(iso(s.clock))}.` }] });
  else if (event) ag.history.push({ role: 'user', parts: [{ text: `New evidence at ${fmtET(iso(s.clock))}: ${event}` }] });
  const decl = declarations(AGENT_TOOLS);
  for (let step = 0; step < maxSteps; step++) {
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Watch Agent paused by the administrator; stopped before its next step', {}); break; }
    if (Date.now() - t0 > maxMs || ag.tool_calls - turnStart >= maxToolCalls || ag.tool_calls >= maxSessionCalls) { waitAtLimit(s, ag, t0); break; }
    let data; try { data = await callModel({ systemInstruction: { parts: [{ text: INSTRUCTION(s) }] }, contents: ag.history, tools: [{ functionDeclarations: decl }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { temperature: 0 } }); ag.calls++; if (data?._route) (ag.routes ||= {})[data._route] = (ag.routes[data._route] || 0) + 1; }
    catch (e) { ag.status = 'model_failed'; trace(s, 'Watch Agent', 'system', 'Model call failed; no state was changed', { error: String(e.message || e).slice(0, 200) }); return { ok: false, status: ag.status }; }
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Watch Agent paused by the administrator; the model’s last answer was not applied', {}); break; }
    const content = data?.candidates?.[0]?.content; const parts = content?.parts || []; const calls = parts.filter((p) => p.functionCall);
    const text = parts.map((p) => p.text || '').join('').trim();
    if (content) ag.history.push(content);
    if (text) trace(s, 'Watch Agent', 'ai', 'Watch Agent said', { text: text.slice(0, 600) });
    if (!calls.length) { ag.status = s.proposals.some((p) => p.state === 'Awaiting approval') ? 'waiting_for_priya' : s.pending.length ? 'waiting_for_records' : 'done'; break; }
    const responses = []; let waiting = false; let blocked = null;
    for (const { functionCall: f } of calls) {
      ag.tool_calls++; const args = f.args || {}; let result;
      if (f.name === 'propose_action') { const { action, rationale, alternatives, ...rest } = args; for (const k of Object.keys(rest)) if (rest[k] === undefined || rest[k] === '') delete rest[k]; result = propose(db, s, 'Watch Agent', action, rest, { rationale, alternatives }); if (result.state === 'Awaiting approval') waiting = true; 
        if (result.state === 'Refused') { ag.refused = ag.refused || {}; ag.refused[action] = (ag.refused[action] || 0) + 1; if (ag.refused[action] >= 2) { blocked = result.message; result = { ...result, message: `${result.message} Refused twice: stop proposing ${action}; Priya Raman is told what is waiting.` }; } } }
      else if (READS[f.name]) { result = read(db, s, f.name, args); trace(s, 'Watch Agent', 'tool', `Read ${f.name}`, { args }); }
      else result = { result: 'Refused', message: `No tool ${f.name}` };
      responses.push({ functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } });
    }
    ag.history.push({ role: 'user', parts: responses });
    if (waiting) ag.status = 'waiting_for_priya';
    if (blocked) { ag.status = 'waiting_for_priya'; trace(s, 'Watch Agent', 'system', `Waiting for Priya Raman: ${blocked}`, { refused: ag.refused }); break; }
  }
  ag.ms += Date.now() - t0;
  return { ok: true, status: ag.status, awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, args: p.args, rationale: p.rationale, alternatives: p.alternatives })) };
}
// ---------- Run by the rules, with no agent (D75): the decision table proposes, Priya approves, the records answer ----------
// The same queue, reads, actions, approval modes and simulators as an agent session. No model is called and nothing is
// credited to an agent. The Kinross window is Priya's rule in the catalogue (KX-945), so a change in admin flags different rows.
const RULES = 'Rule engine';
/** One pass of the decision table. An action that needs Priya waits; a second action on the same order in the same pass
 *  (send the invoice once it is created) rides on the first as its next step, approved with it. */
export function rulesPass(db, s) {
  const waiting = new Map(s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => [p.args.po, null]));
  const act = (action, args) => {
    if (s.set_aside.has(args.po)) return null;
    if (waiting.has(args.po)) { const first = waiting.get(args.po); if (first && !first.then) first.then = { action, args }; return null; }
    const r = propose(db, s, RULES, action, args, { rationale: null });
    if (r.state === 'Awaiting approval') waiting.set(args.po, s.proposals.find((p) => p.id === r.proposal));
    return r;
  };
  return baselinePass(db, s, act);
}
export function startRules(db, { variation = {}, policy = {}, label } = {}) {
  const hours = D.param(db, 'KX-945', 'hours');
  const s = startSession(db, { variation: { ...(FACTS.kinross_window_hours.values.includes(hours) ? { kinross_window_hours: hours } : {}), ...variation }, policy, label });
  s.by_rules = true; s.set_aside = new Set(); s.agent.status = 'rules'; rulesPass(db, s); return s;
}
export function decideRules(db, s, proposalId, decision, by = 'Priya Raman', note) {
  const p = s.proposals.find((x) => x.id === proposalId); let r = decide(db, s, proposalId, decision, by, note);
  if (r.state === 'Refused') return r;
  if (r.state === 'Taken over') { s.set_aside.add(p.args.po); s.handed_over = null; s.agent.status = 'rules'; return r; }
  // The next step shown with this approval (the 810 once its invoice exists) goes under the same approval.
  if (decision === 'approve' && p.then && p.state === 'Executed') { const n = propose(db, s, RULES, p.then.action, p.then.args); if (n.state === 'Awaiting approval') r = decide(db, s, n.proposal, 'approve', by); }
  rulesPass(db, s); return r;
}
export function advanceRules(db, s, { minutes, to } = {}) {
  const target = to != null ? to : minutes != null ? s.clock + minutes * MIN : Math.min(...s.pending.map((p) => Date.parse(p.at)), s.horizon);
  const arrived = advance(db, s, { to: target });
  // A new record on an order Priya took over brings the rules back to it.
  for (const a of arrived) if (a.po) s.set_aside.delete(a.po);
  rulesPass(db, s); return arrived.map((a) => a.what);
}
/** What a page needs of a rules session: clock, queue, proposals waiting for Priya, records still due, and the trace. */
export const rulesView = (db, s) => ({ session: s.id, clock: fmtET(iso(s.clock)), branch_at: fmtET(iso(s.branch)), status: 'rules', facts: s.facts, queue: queue(db, s),
  awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, does: ACTIONS[p.action].label, args: p.args, ...(p.then ? { then: { action: p.then.action, does: ACTIONS[p.then.action].label, args: p.then.args } } : {}), proposed_by: p.by, rule: ACTIONS[p.action].rule })),
  confirmations_pending: s.pending.map((p) => ({ at: fmtET(p.at), what: p.doc_type === '997' ? 'Technical acknowledgment (997)' : p.doc_type === '861' ? 'Northfield receiving advice (861)' : p.doc_type === '945' ? 'Kinross shipping advice (945)' : 'Kinross scan', po: p.po })), trace: s.trace });
/** One order worked alone by the rules with every proposal approved: its state after each approval, once the records due for it
 *  have arrived. A page with no connection plays these, order by order, under the Simulated label. */
export function rulesRecording(db, opts = {}) {
  const start = rulesView(db, startRules(db, opts)); const steps = {};
  const cut = (v, po) => ({ rows: v.queue.rows.filter((r) => r.po === po), awaiting: v.awaiting.filter((p) => p.args.po === po), confirmations_pending: v.confirmations_pending.filter((c) => c.po === po),
    trace: v.trace.filter((t) => t.type !== 'tool' && (String(t.what).includes(po) || JSON.stringify(t.detail || {}).includes(po))) });
  for (const po of [...new Set(start.queue.rows.map((r) => r.po))]) {
    const s = startRules(db, opts); steps[po] = [];
    for (let i = 0; i < 6; i++) {
      const mine = s.proposals.filter((p) => p.state === 'Awaiting approval' && p.args.po === po); if (!mine.length) break;
      for (const p of mine) decideRules(db, s, p.id, 'approve');
      const due = () => s.pending.filter((p) => p.po === po && Date.parse(p.at) <= s.horizon);
      for (let k = 0; k < 8 && due().length && !s.proposals.some((p) => p.state === 'Awaiting approval' && p.args.po === po); k++) advanceRules(db, s, { to: Math.min(...due().map((p) => Date.parse(p.at))) });
      steps[po].push(cut(rulesView(db, s), po));
    }
  }
  return { start, steps };
}

export async function decideAndResume(db, s, proposalId, decision, by, opts = {}) {
  const r = decide(db, s, proposalId, decision, by, opts.note);
  if (r.state === 'Refused') return r;
  if (r.state === 'Taken over') return { decision: r, run: { ok: true, status: s.agent.status } };
  // Another proposal may still wait for Priya: the agent resumes only when none does.
  if (s.proposals.some((p) => p.state === 'Awaiting approval')) return { decision: r, run: { ok: true, status: 'waiting_for_priya' } };
  const ev = r.result ? `${proposalId} ${decision === 'approve' ? 'approved by ' + by : 'rejected'}; result: ${JSON.stringify(r.result)}` : `${proposalId} rejected by ${by}`;
  return { decision: r, run: await runWatch(db, s, { ...opts, event: ev }) };
}
/** Moves the session clock (explicitly, or to the next confirming record) and hands any record that arrived to the agent. */
export async function advanceAndResume(db, s, { minutes, to, ...opts } = {}) {
  const target = to != null ? to : minutes != null ? s.clock + minutes * MIN : Math.min(...s.pending.map((p) => Date.parse(p.at)), s.horizon);
  const arrived = advance(db, s, { to: target });
  if (!arrived.length || s.handed_over || !opts.callModel) return { arrived: arrived.map((a) => a.what), run: { ok: true, status: s.agent.status } };
  return { arrived: arrived.map((a) => a.what), run: await runWatch(db, s, { ...opts, event: `Records arrived: ${arrived.map((a) => a.what).join('; ')}` }) };
}
export { geminiCaller } from './scout.js';

export async function replay(db, { variation = {}, policy = {}, callModel, approveAll = true, paused = () => false } = {}) {
  const base = startSession(db, { variation, policy, label: 'Replay · baseline' }); const b = runBaseline(db, base);
  const ws = startSession(db, { variation, policy, label: 'Replay · Watch Agent' });
  let run = await runWatch(db, ws, { callModel, paused }); let rounds = 0;
  while (run.ok && approveAll && rounds++ < 24) {
    if (run.status === 'waiting_for_priya') { const p = ws.proposals.find((x) => x.state === 'Awaiting approval'); if (!p) break; run = (await decideAndResume(db, ws, p.id, 'approve', 'Test approver (replay)', { callModel, paused })).run; continue; }
    if (ws.pending.length && ws.clock < ws.horizon) { run = (await advanceAndResume(db, ws, { callModel, paused })).run; continue; }
    break;
  }
  return { variation: base.changes, evidence_cutoff: fmtET(iso(base.branch)), baseline: { session: base.id, outcome: b, trace: base.trace },
    watch: run.status === 'paused' ? { session: ws.id, blocked: 'Watch Agent is paused; the model did not run', trace: ws.trace } : run.ok ? { session: ws.id, status: run.status, outcome: outcome(db, ws), overhead: { model_calls: ws.agent.calls, tool_calls: ws.agent.tool_calls, ms: ws.agent.ms, model_routes: ws.agent.routes || {} }, trace: ws.trace } : { session: ws.id, blocked: run.blocked || run.status, trace: ws.trace },
    automation: run.ok && run.status !== 'paused' ? compare(base, ws) : null };
}
/** Where the agent and the baseline took the same step on the same order, the step is automation (D61). */
export function compare(a, b) {
  const steps = (s) => s.proposals.filter((p) => ['Executed', 'Suggested'].includes(p.state)).map((p) => `${p.action} ${p.args.po}${p.args.document ? ' ' + p.args.document : ''}`);
  const A = steps(a), B = steps(b);
  return { same_steps: A.filter((x) => B.includes(x)), baseline_only: A.filter((x) => !B.includes(x)), agent_only: B.filter((x) => !A.includes(x)) };
}

/** What the setup view shows: the facts with their recorded values, each action's mode and whether Priya may change it, Priya's rules and the guardrails. */
export const setup = () => ({ branch_at: P13_MOMENT, prototype: 'P13 Silent order watch',
  facts: Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, { says: f.says, owner: f.owner, recorded: f.recorded, ...(f.values ? { values: f.values } : {}), ...(f.maxLength ? { max_length: f.maxLength } : {}) }])),
  presets: Object.fromEntries(Object.entries(VARIATIONS).map(([k, v]) => [k, v])),
  priya_rules: { kinross_window_hours: { default: 48, allowed: [24, 48], editable: true, effect: 'Changes which Kinross orders are flagged' }, escalate_when_hours_left: { value: ESCALATE_HOURS, editable: false }, drafts: 'Need her approval before release' },
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, rule: a.rule, takes: a.args, mode: a.mode, priya_may_change: a.editable, modes: a.editable ? ['suggest', 'approve', 'policy'] : [a.mode] }])),
  guardrails: GUARDRAILS, owner_note: 'Kinross facts and the story moment are synthetic; the Kinross window and approval modes are Ashby’s (Priya Raman); guardrails are the administrator’s and cannot be changed here.' });
