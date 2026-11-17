// Scout runtime for P5 (NR-460207). A session branches the demo world at 17:12 ET, hides every recorded event after it,
// and keeps its own writes in memory, so nothing it does reaches the recorded world.
// Three kinds of actor work in a session, and the trace says which did what:
//   Rule engine  - fixed checks (Northfield and Ashby rules) and deterministic builds (the ship notice from the load scan).
//   Scout        - a model choosing which read tools to call and which permitted action to propose (runScout).
//   Priya        - approves or rejects a proposal; the server, not the model, decides when her approval is required.
//   Kinross / Northfield (synthetic) - deterministic simulators that answer tasks and documents by explicit rules.
// A rule-based baseline (runBaseline) uses the same reads and actions, so the two can be compared on the same state.
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { P5, VARIATION_FIELDS } from '../world/p5-physical.js';
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { declarations, modelRoutes } from './aviator.js';

const MIN = 60000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const iso = (ms) => new Date(ms).toISOString();
const SESSIONS = new Map(); const MAX_SESSIONS = 60;

// ---------- Policy: what each action needs, and what no one may change ----------
// mode: 'suggest' (Scout may only suggest; a person does it by hand), 'approve' (Priya approves each), 'policy' (runs under her standing policy).
export const ACTIONS = {
  kinross_load:       { label: 'Ask Kinross to load a staged carton', actor: 'Kinross', rule: 'AP-3.2', mode: 'approve', editable: true },
  kinross_relabel:    { label: 'Ask Kinross to relabel a carton with a new SSCC', actor: 'Kinross', rule: 'AP-3.2', mode: 'approve', editable: true },
  kinross_overpack:   { label: 'Ask Kinross to overpack a carton into a new carton with a new SSCC', actor: 'Kinross', rule: 'AP-3.2', mode: 'approve', editable: true },
  kinross_replace:    { label: 'Ask Kinross to load a replacement case from free stock', actor: 'Kinross', rule: 'AP-3.2', mode: 'approve', editable: true },
  kinross_replace_reserved: { label: 'Ask Kinross to load a replacement case from stock reserved for other orders', actor: 'Kinross', rule: 'AP-5.1', mode: 'approve', editable: false },
  erp_align_order:    { label: 'Align the Supplier ERP sales order to Northfield’s current order (ship-to and line numbers)', actor: 'Supplier ERP', rule: 'AP-3.2', mode: 'approve', editable: true },
  build_ship_notice:  { label: 'Build the ship notice from the confirmed load scan', actor: 'Trading Grid', rule: 'AP-1.4', mode: 'policy', editable: false },
  release_ship_notice:{ label: 'Release the ship notice to Northfield', actor: 'Trading Grid', rule: 'AP-1.3', mode: 'approve', editable: false },
  request_carrier_hold:{ label: 'Ask Northfield routing to hold the trailer past the seal', actor: 'Northfield routing', rule: 'AP-3.2', mode: 'approve', editable: true },
  notify_buyer_short: { label: 'Tell the buyer a line ships short and the remainder is cancelled under NF-2.1', actor: 'Jordan Ellis (email)', rule: 'AP-3.2', mode: 'approve', editable: true },
  // The other shipments in the 17:12 queue. The first four are fixed-rule fixes; the last is Scout's allocation plan.
  erp_correct_invoice: { label: 'Correct an invoice draft line in the Supplier ERP to the shipped quantity', actor: 'Supplier ERP', rule: 'AP-3.2', mode: 'approve', editable: true },
  send_routing_request: { label: 'Send the routing request for a collect load to Northfield', actor: 'Northfield transportation', rule: 'AP-3.2', mode: 'approve', editable: true },
  kinross_relabel_cartons: { label: 'Ask Kinross to relabel cartons that carry SSCCs already used', actor: 'Kinross', rule: 'AP-3.2', mode: 'approve', editable: true },
  ask_buyer_order_change: { label: 'Ask the buyer for the order change behind a quantity agreed by phone', actor: 'Jordan Ellis', rule: 'AP-3.2', mode: 'approve', editable: true },
  request_order_change: { label: 'Ask Northfield to change one order to the cases the stock covers, and set the Supplier ERP sales order to match', actor: 'Jordan Ellis', rule: 'AP-5.1', mode: 'approve', editable: false },
};
const HERO_ACTIONS = ['kinross_load', 'kinross_relabel', 'kinross_overpack', 'kinross_replace', 'kinross_replace_reserved'];
const QUEUE_ACTIONS = ['erp_correct_invoice', 'send_routing_request', 'kinross_relabel_cartons', 'ask_buyer_order_change', 'request_order_change'];
export const GUARDRAILS = [
  { id: 'AP-1.4', owner: 'Administrator', text: 'Never edit a ship notice to match the order; a ship notice is built only from the confirmed load scan.' },
  { id: 'AP-7.1', owner: 'Administrator', text: 'Never change a Kinross record without Kinross accepting the change; Scout sends tasks, Kinross confirms.' },
  { id: 'AP-3.3', owner: 'Administrator', text: 'Never report a charge as avoided unless Northfield’s own record confirms it.' },
];

// ---------- Sessions ----------
export function startSession(db, { variation = {}, policy = {}, label = 'Operator', goal } = {}) {
  if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
  const world = clone(P5); const changes = [];
  for (const [path, value] of Object.entries(variation)) {
    if (!VARIATION_FIELDS.includes(path)) throw new Error(`A replay may not change ${path}`);
    const keys = path.split('.'); let o = world; for (const k of keys.slice(0, -1)) o = o[k];
    changes.push({ field: path, from: o[keys.at(-1)], to: value }); o[keys.at(-1)] = value;
  }
  const modes = {}; for (const [k, a] of Object.entries(ACTIONS)) { const want = policy[k]; modes[k] = want && a.editable && ['suggest', 'approve', 'policy'].includes(want) ? want : a.mode; }
  const load = db.prepare("SELECT data FROM events WHERE po = ? AND kind = 'wms.load_scan' AND at <= ? ORDER BY at DESC").get(world.po, world.branch_at);
  const ld = JSON.parse(load.data);
  const id = `SC-${createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10)}`;
  const s = { id, label, created: new Date().toISOString(), world, changes, modes, clock: Date.parse(world.branch_at),
    goal: goal || 'Every Northfield shipment meets Northfield rules 2026.2 before its cutoff. Act for Priya Raman, within Ashby’s rules.',
    erp: { ship_to: 'DC 4', lines: 'Old line numbers' },
    load: { shipment: ld.shipment, expected: ld.cartons_expected, loaded: [], staged: [world.carton.sscc], removed: [], sealed: false, departed: false, base_loaded: ld.cartons_loaded },
    tasks: [], proposals: [], notices: [], asn: null, events: [], trace: [], audit: [], usedKeys: new Set(), agent: { history: [], status: 'idle', calls: 0, tool_calls: 0, ms: 0 } };
  SESSIONS.set(id, s);
  trace(s, 'Trading Grid', 'system', 'Session branched from the recorded world', { at: fmtET(world.branch_at), hidden: 'Every recorded event after this time', changes });
  ruleDetect(db, s);
  ruleQueue(db, s);
  return s;
}
export const getSession = (id) => SESSIONS.get(id) || null;

function trace(s, actor, type, what, detail = {}) {
  s.trace.push({ n: s.trace.length + 1, clock: fmtET(iso(s.clock)), actor, type, what, ...(Object.keys(detail).length ? { detail } : {}) });
}
// Write attribution (T2.3 story 1): every proposal state change records who proposed, the authority (rule and mode),
// who approved and the outcome. The server copies these into the access log.
const MODE_APPROVER = { policy: 'Standing policy, set by Priya Raman', suggest: 'None: Scout may only suggest' };
function audit(s, p, outcome) {
  const approver = p.taken_over_by || p.approved_by || (p.needs === 'approve' ? (p.state === 'Awaiting approval' ? 'Priya Raman (awaiting)' : p.rejected_by || 'Priya Raman') : MODE_APPROVER[p.needs]);
  s.audit.push({ session: s.id, proposal: p.id, action: p.action, agent: p.by, authority_rule: ACTIONS[p.action].rule, authority_mode: p.needs, approver, outcome, clock: fmtET(iso(s.clock)) });
}
const TYPES = { system: 'System', rule: 'Fixed rule', ai: 'AI judgment', human: 'Human approval', external: 'External confirmation', tool: 'Tool call' };

// ---------- Rule engine ----------
function ruleDetect(db, s, quiet) {
  const min = Math.round((Date.parse(s.world.seal_at) - s.clock) / MIN);
  const short = s.load.expected - s.load.base_loaded - s.load.loaded.length;
  const findings = [];
  if (short > 0) findings.push({ rule: 'NF-4.5', finding: `${s.load.base_loaded + s.load.loaded.length} of ${s.load.expected} cartons loaded; the ship notice must match the load carton for carton` });
  if (s.erp.ship_to !== 'DC 2') findings.push({ rule: 'NF-4.7', finding: 'Supplier ERP ship-to DC 4; Northfield’s current order (change 1) says DC 2' });
  if (s.erp.lines !== 'Current') findings.push({ rule: 'NF-4.8', finding: 'Supplier ERP sales order carries the old line numbers' });
  if (quiet) return findings;
  trace(s, 'Rule engine', 'rule', findings.length ? `Detected ${findings.length} rule risks on NR-460207 before the seal` : 'No rule risk on NR-460207', { findings, seal_in_minutes: min });
  return findings;
}
function ruleCheckAsn(s) {
  const fails = [];
  if (s.erp.ship_to !== 'DC 2') fails.push({ rule: 'NF-4.7', why: 'Ship-to read from the Supplier ERP is DC 4; the current order says DC 2' });
  if (s.erp.lines !== 'Current') fails.push({ rule: 'NF-4.8', why: 'Line numbers differ from the current order' });
  if (!s.load.sealed && !s.asn) { /* building before seal is allowed; the build uses the load as confirmed so far */ }
  return fails;
}

// ---------- The queue: the other shipments the 17:12 check flags, each with the fix a fixed rule proposes ----------
function ruleQueue(db, s) {
  const cut = s.world.branch_at;
  const one = (kind) => { const r = db.prepare('SELECT po, data FROM events WHERE kind = ? AND at <= ? AND po <> ? ORDER BY at DESC').get(kind, cut, s.world.po); return r ? { po: r.po, d: JSON.parse(r.data) } : null; };
  const inv = one('erp.invoice_draft'), route = one('routing.request'), stock = one('wms.inventory'), label = one('wms.label_scan'), phone = one('outside_confirmation');
  s.queue = [];
  const row = (po, r, action, args) => { s.queue.push({ po, ...r }); if (action) propose(db, s, 'Rule engine', action, args, { rationale: r.problem }); };
  if (inv) row(inv.po, { kind: 'invoice', problem: `Invoice draft ${inv.d.invoice} line ${inv.d.line} bills ${inv.d.billed} cases; ${inv.d.shipped} shipped; $${inv.d.over_value.toFixed(2)} over`, consequence: `the invoice batch sends ${inv.d.billed} cases billed against ${inv.d.shipped} shipped`, cutoff_minutes: inv.d.batch_sends_in_minutes, cutoff: 'Invoice batch', source: 'Supplier ERP · API', now: `${inv.d.billed} cases`, after: `${inv.d.shipped} cases`, what: `Invoice ${inv.d.invoice} line ${inv.d.line}`, goes_to: 'Supplier ERP · API' }, 'erp_correct_invoice', { po: inv.po, invoice: inv.d.invoice, line: inv.d.line, qty: inv.d.shipped });
  if (route) row(route.po, { kind: 'routing', problem: `Collect freight, ${route.d.cases} cases from Kinross Joliet; no routing request sent`, consequence: `Northfield books no pickup for the ${route.d.cases} cases`, cutoff_minutes: route.d.due_in_minutes, cutoff: 'Routing request due', source: 'EDI 753', now: 'Not sent', after: `Sent for ${route.d.cases} cases`, what: 'Routing request', goes_to: 'Northfield transportation · EDI 753' }, 'send_routing_request', { po: route.po, cases: route.d.cases });
  if (stock) { s.grove = { po: stock.po, sku: stock.d.sku, ordered: stock.d.ordered_across_orders, orders: stock.d.order_list || [], cutoff_minutes: stock.d.change_cutoff_in_minutes, plan: null };
    row(stock.po, { kind: 'stock', cutoff_minutes: stock.d.change_cutoff_in_minutes, cutoff: 'Order-change cutoff', source: 'Kinross inventory · API' }); }
  if (label) row(label.po, { kind: 'label', problem: `${label.d.reused_sscc} of ${label.d.cartons} honey cartons carry SSCCs already used`, consequence: `${label.d.reused_sscc} cartons load with SSCCs Northfield has already received`, cutoff_minutes: label.d.loading_starts_in_minutes, cutoff: 'Loading starts', source: 'Kinross scan · API', now: 'SSCCs already used', after: 'New SSCCs', what: `Relabel ${label.d.reused_sscc} cartons`, goes_to: 'Kinross Logistics · API' }, 'kinross_relabel_cartons', { po: label.po, cartons: label.d.reused_sscc });
  if (phone && !phone.d.order_change_received) { const agreed = parseInt(phone.d.scope, 10); const reads = +(/reads (\d+)/.exec(phone.d.scope) || [])[1];
    row(phone.po, { kind: 'phone', problem: `${phone.d.confirmed_by} agreed ${agreed} cases by phone; the PO still reads ${reads}; no order change received`, consequence: `Kinross picks ${reads} cases against the ${agreed} agreed`, cutoff_minutes: phone.d.loading_starts_in_minutes, cutoff: 'Loading starts', source: 'Phone note', now: `PO reads ${reads}`, after: `Order change to ${agreed}`, what: 'Order change request', goes_to: `${phone.d.confirmed_by} · Email` }, 'ask_buyer_order_change', { po: phone.po, cases: agreed }); }
  s.checked = db.prepare("SELECT count(*) n FROM orders o WHERE supplier_id = 'ASHBY' AND received_at <= ? AND NOT EXISTS (SELECT 1 FROM shipments x WHERE x.po = o.po AND x.shipped_at <= ?)").get(cut, cut).n;
}
const groveShort = (s) => s.grove ? Math.max(0, s.grove.ordered - s.world.stock[0].on_hand) : 0;
const SENT = { erp_align_order: 'Ship-to corrected', kinross_replace: 'Replacement case loaded', kinross_replace_reserved: 'Replacement case loaded', kinross_load: 'Carton loaded', build_ship_notice: 'Ship notice built, not sent', notify_buyer_short: 'Buyer told of short line', erp_correct_invoice: 'Corrected in Supplier ERP', send_routing_request: 'Routing request sent', kinross_relabel_cartons: 'Relabel task sent to Kinross', ask_buyer_order_change: 'Awaiting Jordan Ellis', request_order_change: 'Awaiting Northfield' };
/** The queue as the screen shows it: every row states its own problem in values, soonest cutoff first. */
export function queueView(s) {
  const elapsed = Math.round((s.clock - Date.parse(s.world.branch_at)) / MIN);
  const state = (po) => { const ps = s.proposals.filter((p) => p.po === po); const done = ps.filter((p) => p.state === 'Executed').pop();
    if (ps.some((p) => p.state === 'Awaiting approval')) return 'Ready to approve'; if (ps.some((p) => p.state === 'Taken over')) return 'Edited by Priya Raman'; return done ? SENT[done.action] || 'Sent' : null; };
  const loaded = cartonsLoaded(s); const left = Math.max(0, Math.round((Date.parse(s.world.seal_at) - s.clock) / MIN));
  const hero = { po: s.world.po, kind: 'load', running: !s.load.sealed, cutoff: 'Trailer seals', cutoff_minutes: left, door: s.world.door, source: 'Kinross scan · API',
    problem: loaded < s.load.expected ? `Load scan ${loaded} of ${s.load.expected} cartons; ${s.load.staged.length ? `carton ${s.load.staged[0]} staged, not loaded` : 'one carton short'}${s.erp.ship_to !== 'DC 2' ? `. Order change moved ship-to from DC 4 to DC 2; Supplier ERP shows ${s.erp.ship_to}` : ''}` : `${loaded} of ${s.load.expected} cartons loaded; ship-to DC 2`,
    consequence: loaded < s.load.expected ? `the order ships ${loaded} of ${s.load.expected} cartons` : null,
    state: s.receipt ? `Received at DC 2 · ${s.receipt.received} cartons` : s.asn?.released ? 'Ship notice sent' : state(s.world.po) || (s.load.sealed ? `Sealed · ${loaded} of ${s.load.expected}` : loaded === s.load.expected ? `${loaded} of ${s.load.expected} loaded` : s.agent.status === 'running' ? 'Checking' : 'Open') };
  const rows = (s.queue || []).map((r) => { const x = { ...r, cutoff_minutes: Math.max(0, r.cutoff_minutes - elapsed), state: state(r.po) || 'Open' };
    if (r.kind === 'stock') { const st = s.world.stock[0]; const short = groveShort(s); x.on_hand = st.on_hand; x.ordered = s.grove.ordered; x.short = short;
      x.problem = `Kinross Groveport: ${st.on_hand} cases ${s.grove.sku} against ${s.grove.ordered} ordered on ${s.grove.orders.length} orders; ${short} short`; x.consequence = `the ${s.grove.orders.length} orders pick ${short} cases short`;
      if (!s.proposals.some((p) => p.po === r.po)) x.state = 'Choice needed'; }
    return x; });
  return { checked: s.checked, rows: [hero, ...rows].sort((a, b) => a.cutoff_minutes - b.cutoff_minutes) };
}

// ---------- Reads (the evidence Scout and the baseline may use) ----------
function cartonsLoaded(s) { return s.load.base_loaded + s.load.loaded.length; }
export const READS = {
  read_order: { description: 'NR-460207 as Ashby sees it at the session clock: lines as ordered now, order changes, documents exchanged, and the Supplier ERP sales order’s ship-to and line numbers.', input: {},
    // Built directly with an evidence cutoff: D.lifecycle returns every record of the quarter, which would leak the recorded outcome.
    run: (db, s) => { const cut = s.world.branch_at, po = s.world.po;
      const lines = db.prepare('SELECT line, sku, qty_original ordered_first, qty_ordered ordered_now FROM order_lines WHERE po = ? ORDER BY line').all(po).map((r) => ({ ...r }));
      const changes = db.prepare('SELECT seq change, line, code, qty, sent_at FROM order_changes WHERE po = ? AND sent_at <= ? ORDER BY seq, line').all(po, cut).map((c) => ({ ...c, sent_at: fmtET(c.sent_at) }));
      const documents = db.prepare('SELECT doc_type type, reference, sent_at, status FROM documents WHERE po = ? AND sent_at <= ? ORDER BY sent_at').all(po, cut).map((d) => ({ ...d, sent_at: fmtET(d.sent_at) }));
      return { po, as_of: fmtET(iso(s.clock)), evidence_cutoff: fmtET(cut), lines, order_changes: changes, northfield_current_ship_to: 'DC 2 (order change 1, EDI 860)', documents, supplier_erp_sales_order: { ship_to: s.erp.ship_to, line_numbers: s.erp.lines }, session_notices: s.notices }; } },
  read_load: { description: 'The Kinross load at door 7 for shipment SHP-460207: cartons expected and loaded by SSCC, cartons staged and not loaded, cartons removed, minutes to the trailer seal, and whether the trailer is sealed or departed.', input: {},
    run: (db, s) => ({ shipment: s.load.shipment, expected: s.load.expected, loaded: cartonsLoaded(s), loaded_this_session: s.load.loaded, staged_not_loaded: s.load.staged.map((x) => x === s.world.carton.sscc ? { sscc: x, po_line: s.world.carton.line, sku: s.world.carton.sku, cases: 1 } : { sscc: x }), removed: s.load.removed, minutes_to_seal: Math.max(0, Math.round((Date.parse(s.world.seal_at) - s.clock) / MIN)), sealed: s.load.sealed, departed: s.load.departed, source: 'Kinross warehouse system · API' }) },
  read_inventory: { description: 'Kinross stock of one item at one site as Kinross reports it: on hand, reserved for other orders, free, and minutes to stage a case to a door.', input: { sku: z.string().describe('Item, for example ASH-MUG-12'), site: z.string().optional().describe('Site, default KIN-GRV (Kinross Groveport)') },
    run: (db, s, a) => { const st = s.world.stock.find((x) => x.sku === a.sku && x.site === (a.site || 'KIN-GRV')); return st ? { sku: st.sku, site: 'Kinross Groveport', on_hand: st.on_hand, reserved: st.reserved, reserved_for: st.reserved_for, free: st.on_hand - st.reserved, staging_minutes: st.staging_minutes, source: 'Kinross warehouse system · API' } : { sku: a.sku, found: false, message: 'Kinross reports no stock of this item at this site' }; } },
  read_tasks: { description: 'Every task sent to Kinross in this session with its state and Kinross’s response.', input: {},
    run: (db, s) => ({ tasks: s.tasks }) },
  read_rules: { description: 'Rules from the catalogue by id (for example NF-2.1, NF-4.1, AP-2.2, AP-5.1) or by topic words.', input: { ids: z.array(z.string()).optional(), topic: z.string().optional() },
    run: (db, s, a) => a.ids?.length ? { rules: a.ids.map((id) => D.rule(db, id)).filter(Boolean) } : D.rules(db, { topic: a.topic || '' }) },
  read_policy: { description: 'What each action needs (Scout may only suggest, Priya approves, or it runs under her standing policy), the rule behind it, and the administrator guardrails no one may change.', input: {},
    run: (db, s) => ({ actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, done_by: a.actor, rule: a.rule, needs: s.modes[k] === 'policy' ? 'Runs under Priya’s standing policy' : s.modes[k] === 'approve' ? 'Priya approves' : 'Scout may only suggest; Priya does it by hand' }])), guardrails: GUARDRAILS }) },
  read_findings: { description: 'Rule risks the rule engine currently reports on NR-460207 (Northfield and Ashby rules), with the minutes left before the trailer seal.', input: {},
    run: (db, s) => ({ findings: ruleDetect(db, s, true), minutes_to_seal: Math.max(0, Math.round((Date.parse(s.world.seal_at) - s.clock) / MIN)) }) },
  read_site_orders: { description: 'Open orders for one item at Kinross Groveport that load after NR-460207: stock on hand, cases released to Kinross on each order, the shortage across them, and the minutes left to change an order.', input: { sku: z.string().describe('Item, for example ASH-MUG-12') },
    run: (db, s, a) => { if (!s.grove || a.sku !== s.grove.sku) return { sku: a.sku, found: false, message: 'No open orders share this item at Kinross Groveport' };
      const elapsed = Math.round((s.clock - Date.parse(s.world.branch_at)) / MIN);
      return { sku: s.grove.sku, site: 'Kinross Groveport', on_hand: s.world.stock[0].on_hand, ordered: s.grove.ordered, short: groveShort(s), minutes_to_order_change_cutoff: s.grove.cutoff_minutes - elapsed,
        orders: s.grove.orders.map((o) => { const r = db.prepare('SELECT received_at, requested_delivery FROM orders WHERE po = ?').get(o.po); return { po: o.po, cases: o.cases, share_of_order_if_cut: `${Math.round(100 * groveShort(s) / o.cases)}%`, received: fmtET(r.received_at), requested_delivery: r.requested_delivery, ...(o.po_reads ? { already_reduced: `From ${o.po_reads} to the ${o.cases} agreed with the buyer by phone; the order change has not arrived` } : {}) }; }),
        plan: s.grove.plan, rule: D.rule(db, 'AP-5.1'), source: 'Kinross warehouse system · API; Trading Grid orders' }; } },
  read_proposals: { description: 'Every action proposed in this session, with its state (awaiting approval, approved, rejected, executed, failed, refused) and its result.', input: {},
    run: (db, s) => ({ proposals: s.proposals.map((p) => ({ id: p.id, action: p.action, args: p.args, state: p.state, result: p.result || null })) }) },
};
export function read(db, s, name, args = {}) { const r = READS[name]; if (!r) return { result: 'Refused', message: `No read ${name}` }; const out = r.run(db, s, args); (s.reads ||= []).push({ name, args, out: JSON.stringify(out) }); return out; }

// ---------- Actions: proposed by Scout or the baseline, gated by the server, executed by simulators ----------
const keyOf = (action, args) => createHash('sha1').update(JSON.stringify([action, args])).digest('hex').slice(0, 16);
export function propose(db, s, by, action, args = {}, why = {}) {
  const def = ACTIONS[action]; if (!def) return { state: 'Refused', message: `No action ${action}` };
  // An order change covers exactly the shortage: the server works out the cases from the order chosen, so the agent names only the order.
  if (action === 'request_order_change') { const { sku, cases, ...rest } = args; const o = s.grove?.orders.find((x) => x.po === rest.po); args = o && groveShort(s) ? { ...rest, cases: o.cases - groveShort(s) } : { ...rest, ...(cases != null ? { cases } : {}) }; }
  const key = keyOf(action, action === 'build_ship_notice' ? { load: cartonsLoaded(s) } : args);
  const open = s.proposals.find((p) => p.key === key && ['Awaiting approval', 'Executed', 'Approved'].includes(p.state));
  if (open) return { state: 'Duplicate', proposal: open.id, message: `The same action is already ${open.state.toLowerCase()} (${open.id}).` };
  const bad = validate(s, action, args); if (bad) { trace(s, 'Trading Grid', 'rule', `Refused ${action}`, { by, reason: bad }); return { state: 'Refused', message: bad }; }
  const p = { id: `SP-${s.proposals.length + 1}`, key, action, args, by, po: args.po || s.world.po, queue: by === 'Rule engine', rationale: why.rationale || null, alternatives: why.alternatives || [], state: 'Awaiting approval', needs: s.modes[action], at: fmtET(iso(s.clock)) };
  s.proposals.push(p);
  trace(s, by, by === 'Scout' ? 'ai' : 'rule', `Proposed: ${def.label}`, { proposal: p.id, po: p.po, args, rationale: p.rationale, alternatives: p.alternatives, needs: p.needs });
  if (p.needs === 'suggest') { p.state = 'Suggested'; audit(s, p, 'Suggested; Priya does it by hand'); return { state: 'Suggested', proposal: p.id, message: 'Scout may only suggest this action; Priya does it by hand.' }; }
  if (p.needs === 'policy') return execute(db, s, p, 'Standing policy');
  audit(s, p, 'Awaiting approval');
  return { state: 'Awaiting approval', proposal: p.id, approver: 'Priya Raman', rule: def.rule };
}
function validate(s, action, a) {
  const c = s.world.carton; const left = (Date.parse(s.world.seal_at) - s.clock) / MIN;
  if (s.load.sealed && HERO_ACTIONS.includes(action)) return 'The trailer is sealed; Kinross cannot load anything more onto it.';
  if (['kinross_load', 'kinross_relabel', 'kinross_overpack'].includes(action) && a.sscc !== c.sscc && !s.load.staged.includes(a.sscc)) return `Carton ${a.sscc || '(none)'} is not staged for this shipment.`;
  if (action === 'kinross_replace' || action === 'kinross_replace_reserved') { if (!a.sku || !(a.cases > 0)) return 'Name the item and the number of cases.'; }
  const allowed = { kinross_load: ['sscc'], kinross_relabel: ['sscc'], kinross_overpack: ['sscc'], kinross_replace: ['sku', 'cases'], kinross_replace_reserved: ['sku', 'cases'], erp_align_order: [], build_ship_notice: [], release_ship_notice: [], request_carrier_hold: [], notify_buyer_short: ['line', 'shipped'], erp_correct_invoice: ['po', 'invoice', 'line', 'qty'], send_routing_request: ['po', 'cases'], kinross_relabel_cartons: ['po', 'cartons'], ask_buyer_order_change: ['po', 'cases'], request_order_change: ['po', 'cases'] }[action];
  const extra = Object.keys(a).filter((k) => !allowed.includes(k));
  if (extra.length) return action === 'build_ship_notice' ? `AP-1.4: a ship notice is built only from the confirmed load scan; ${extra.join(', ')} cannot be supplied.` : `${action} takes only ${allowed.join(', ') || 'no arguments'}; refused ${extra.join(', ')}.`;
  if ((action === 'kinross_replace' || action === 'kinross_replace_reserved') && a.sku !== c.sku) return `No carton needing replacement holds ${a.sku}; the staged carton holds ${c.sku}.`;
  if (action === 'release_ship_notice' && !s.asn) return 'There is no built ship notice to release.';
  if (action === 'release_ship_notice' && s.asn?.released) return 'This ship notice is already released.';
  if (action === 'release_ship_notice' && s.asn.cartons !== cartonsLoaded(s)) return `AP-1.4: ${s.asn.reference} was built for ${s.asn.cartons} cartons and the load is now ${cartonsLoaded(s)}; build the ship notice again from the load before releasing.`;
  if (action === 'build_ship_notice' && s.asn?.released) return 'The ship notice is already released; it cannot be rebuilt.';
  if (action === 'notify_buyer_short' && !(a.line && a.shipped >= 0)) return 'Name the line and the quantity that ships.';
  if (QUEUE_ACTIONS.includes(action) && !(s.queue || []).some((r) => r.po === a.po)) return `${a.po || 'No order'} is not in the queue.`;
  if (action === 'request_order_change') { const o = s.grove?.orders.find((x) => x.po === a.po); const short = groveShort(s);
    if (!o) return `${a.po} is not one of the orders sharing this stock: ${s.grove?.orders.map((x) => x.po).join(', ')}.`;
    if (!short) return 'The stock covers every order; no order needs to change.';
    if (o.cases - short < 0) return `The stock is ${short} cases short; ${a.po} would change from ${o.cases} to ${o.cases - short} cases.`; }
  if (left < -60 && action !== 'release_ship_notice' && !QUEUE_ACTIONS.includes(action)) return 'The shipment has left.';
  return null;
}
export function decide(db, s, proposalId, decision, by = 'Priya Raman', note, choice) {
  const p = s.proposals.find((x) => x.id === proposalId);
  if (!p) return { state: 'Refused', message: `No proposal ${proposalId}` };
  if (p.state !== 'Awaiting approval') return { state: 'Refused', message: `${proposalId} is ${p.state.toLowerCase()}; an approval cannot be replayed.` };
  // Edit suggestion (R15): the person sets this proposal aside and does the case by hand. Scout stops proposing in this session.
  if (decision === 'edit' && p.po !== s.world.po) { p.state = 'Taken over'; p.taken_over_by = by; p.note = note || null;
    trace(s, by, 'human', `Edit suggestion: ${by} set ${p.id} aside and does ${p.po} by hand`, { action: p.action, po: p.po, note: p.note }); audit(s, p, `Taken over by ${by}; done by hand${p.note ? `: ${p.note}` : ''}`); return { state: 'Taken over', proposal: p.id, by }; }
  if (decision === 'edit') { p.state = 'Taken over'; p.taken_over_by = by; p.note = note || null; s.handed_over = { by, proposal: p.id, note: p.note, at: fmtET(iso(s.clock)) }; s.agent.status = 'handed_to_person';
    trace(s, by, 'human', `Edit suggestion: ${by} set ${p.id} aside and does the case by hand`, { action: p.action, note: p.note }); audit(s, p, `Taken over by ${by}; done by hand${p.note ? `: ${p.note}` : ''}`); return { state: 'Taken over', proposal: p.id, by }; }
  if (decision !== 'approve') { p.state = 'Rejected'; p.rejected_by = by; trace(s, by, 'human', `Rejected ${p.id}`, { action: p.action }); audit(s, p, 'Rejected'); return { state: 'Rejected', proposal: p.id }; }
  // The allocation choice is Priya's (AP-5.1): she may pick a different order from the one Scout recommended.
  if (p.action === 'request_order_change' && choice && choice !== p.args.po) { const o = s.grove.orders.find((x) => x.po === choice); if (!o) return { state: 'Refused', message: `${choice} is not one of the orders sharing this stock.` };
    trace(s, by, 'human', `${by} chose ${choice} to ship short; Scout Agent recommended ${p.args.po}`, { proposal: p.id }); p.recommended = p.args.po; p.args = { po: choice, cases: o.cases - groveShort(s) }; p.chosen_by = by; }
  p.state = 'Approved'; p.approved_by = by; trace(s, by, 'human', `Approved ${p.id}: ${ACTIONS[p.action].label}`, { po: p.po, args: p.args });
  return execute(db, s, p, by);
}
function nextSscc(s) { const n = s.world.next_serial++; const body = `00614141${String(n).padStart(9, '0')}`; let sum = 0; for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return `${body}${(10 - (sum % 10)) % 10}`; }
function execute(db, s, p, by) {
  if (s.usedKeys.has(p.key + p.id)) return { state: 'Refused', message: 'Already executed' }; s.usedKeys.add(p.key + p.id);
  const w = s.world, c = w.carton, a = p.args; let r;
  const left = () => (Date.parse(w.seal_at) - s.clock) / MIN;
  const task = (kind, outcome) => { const t = { id: `KT-${s.tasks.length + 1}`, kind, proposal: p.id, sent_at: fmtET(iso(s.clock)), ...outcome }; s.tasks.push(t); trace(s, 'Kinross', 'external', `Kinross ${t.state.toLowerCase()} ${kind}`, { task: t.id, po: p.po, response: t.response }); return t; };
  const load = (sscc, minutes) => { s.clock += minutes * MIN; s.load.loaded.push(sscc); s.load.staged = s.load.staged.filter((x) => x !== sscc); };
  switch (p.action) {
    case 'kinross_load': {
      if (c.condition !== 'good' && c.condition !== 'readable') { r = task('load', { state: 'Rejected', response: c.condition === 'crushed' ? 'Carton crushed; it cannot be loaded' : `Carton ${c.condition}; it cannot be loaded` }); break; }
      if (c.label !== 'readable') { r = task('load', { state: 'Rejected', response: 'Label unreadable; the carton cannot be scanned onto the trailer' }); break; }
      if (left() < w.load_minutes) { r = task('load', { state: 'Rejected', response: 'Not enough time before the seal' }); break; }
      load(c.sscc, w.load_minutes); r = task('load', { state: 'Completed', response: `Carton ${c.sscc} loaded`, loaded: cartonsLoaded(s) }); break; }
    case 'kinross_relabel': {
      if (c.condition !== 'good') { r = task('relabel', { state: 'Rejected', response: 'A crushed carton cannot be relabelled and shipped' }); break; }
      if (left() < w.relabel_minutes) { r = task('relabel', { state: 'Rejected', response: 'Not enough time before the seal' }); break; }
      const n = nextSscc(s); s.load.staged = s.load.staged.filter((x) => x !== c.sscc); s.load.removed.push(c.sscc); s.load.staged.push(n); load(n, w.relabel_minutes); r = task('relabel', { state: 'Completed', response: `Relabelled as ${n} and loaded`, new_sscc: n, loaded: cartonsLoaded(s) }); break; }
    case 'kinross_overpack': {
      if (c.contents !== 'intact') { r = task('overpack', { state: 'Rejected', response: 'Contents damaged; nothing to overpack' }); break; }
      if (left() < w.overpack_minutes) { r = task('overpack', { state: 'Rejected', response: 'Not enough time before the seal' }); break; }
      const n = nextSscc(s); s.load.staged = s.load.staged.filter((x) => x !== c.sscc); s.load.removed.push(c.sscc); s.load.staged.push(n); load(n, w.overpack_minutes); r = task('overpack', { state: 'Completed', response: `Contents overpacked into a new carton ${n} and loaded`, new_sscc: n, loaded: cartonsLoaded(s) }); break; }
    case 'kinross_replace': case 'kinross_replace_reserved': {
      const st = w.stock.find((x) => x.sku === a.sku && x.site === 'KIN-GRV'); const free = st ? st.on_hand - st.reserved : 0;
      const reserved = p.action === 'kinross_replace_reserved';
      if (!st || (reserved ? st.on_hand : free) < a.cases) { r = task('replacement', { state: 'Rejected', response: reserved ? 'Not enough stock on hand' : `Only ${free} free cases; the rest are reserved for other orders` }); break; }
      if (left() < st.staging_minutes) { r = task('replacement', { state: 'Rejected', response: `Staging takes ${st.staging_minutes} minutes; the seal is in ${Math.max(0, Math.round(left()))}` }); break; }
      st.on_hand -= a.cases; if (reserved) st.reserved -= a.cases;
      const n = nextSscc(s); s.load.removed.push(c.sscc); s.load.staged = s.load.staged.filter((x) => x !== c.sscc); s.load.staged.push(n); load(n, st.staging_minutes);
      r = task('replacement', { state: 'Completed', response: `Replacement case loaded as ${n}${reserved ? `; ${a.cases} case(s) taken from stock reserved for ${st.reserved_for}` : ''}`, new_sscc: n, loaded: cartonsLoaded(s) });
      if (s.grove) s.notices.push(`Kinross Groveport now holds ${st.on_hand} cases of ${st.sku} against ${s.grove.ordered} ordered on ${s.grove.orders.length} later orders: ${groveShort(s)} short`);
      break; }
    case 'erp_align_order': { s.erp = { ship_to: 'DC 2', lines: 'Current' }; s.clock += 2 * MIN; trace(s, 'Supplier ERP', 'external', 'Sales order updated: ship-to DC 2, current line numbers', { proposal: p.id }); r = { state: 'Completed', response: 'Applied in Supplier ERP' }; break; }
    case 'request_carrier_hold': { trace(s, 'Northfield routing (synthetic)', 'external', 'Hold request received; no answer before the seal', { rule: 'Northfield routes collect freight; a hold is Northfield’s decision' }); r = { state: 'Sent', response: 'Request delivered; Northfield routing has not answered. The hold is not confirmed.' }; break; }
    case 'notify_buyer_short': { s.notices.push(`Email to Jordan Ellis: line ${a.line} ships ${a.shipped}; remainder cancelled under NF-2.1`); trace(s, 'Trading Grid', 'system', 'Email delivered to Jordan Ellis', { line: a.line, shipped: a.shipped }); r = { state: 'Delivered', response: 'Email delivered to Jordan Ellis. Northfield decides the cancellation on its order.' }; break; }
    case 'build_ship_notice': {
      const fails = ruleCheckAsn(s); if (fails.length) { trace(s, 'Rule engine', 'rule', 'Ship notice not built', { failures: fails }); r = { state: 'Failed', response: 'Rule engine refused the build', failures: fails }; break; }
      sealIfDue(s); const loaded = cartonsLoaded(s); const replaced = s.asn?.reference;
      s.asn = { reference: `ASN-460207-S${s.id.slice(3, 7)}`, built_from: 'Kinross load scan (confirmed)', cartons: loaded, line_1: 400 - (s.load.expected - loaded), line_2: 260, ship_to: 'DC 2', lines: 'Current', removed: s.load.removed, released: false, synthetic: true };
      trace(s, 'Rule engine', 'rule', `Ship notice built from the load scan: ${loaded} cartons${replaced ? ` (replaces the unreleased build for an earlier load)` : ''}`, { asn: s.asn.reference, checks: ['NF-4.5 matches the load', 'NF-4.7 ship-to DC 2', 'NF-4.8 current line numbers'] });
      r = { state: 'Completed', response: `Built ${s.asn.reference} for ${loaded} cartons; not sent`, asn: s.asn }; break; }
    case 'release_ship_notice': {
      sealIfDue(s, true); s.asn.released = true; s.asn.released_by = by;
      const dep = Date.parse(w.departure_at); const sent = Math.max(s.clock, dep); const late = sent - dep > 60 * MIN;
      s.asn.sent_at = fmtET(iso(sent)); s.asn.on_time = !late;
      trace(s, 'Trading Grid', 'system', `Ship notice ${s.asn.reference} sent to Northfield`, { at: s.asn.sent_at, rule: 'NF-4.2', on_time: !late });
      trace(s, 'Northfield (synthetic)', 'external', 'Technical acknowledgment (997) received', { note: 'A 997 is not business acceptance' });
      const received = cartonsLoaded(s); const match = received === s.asn.cartons;
      s.receipt = { reference: `RCV-DC2-S${s.id.slice(3, 7)}`, at: fmtET(w.receipt_at), received, matches_ship_notice: match, synthetic: true, by_rule: 'Northfield DC 2 receives what was physically loaded and compares it carton for carton (NF-4.5)' };
      trace(s, 'Northfield (synthetic)', 'external', `Receiving advice (861): ${received} cartons received; ${match ? 'matches' : 'does not match'} the ship notice`, s.receipt);
      r = { state: 'Completed', response: `Released and sent. Synthetic receiving advice: ${received} cartons, ${match ? 'matching' : 'not matching'} the ship notice.`, receipt: s.receipt }; break; }
    case 'erp_correct_invoice': { trace(s, 'Supplier ERP', 'external', `Invoice ${a.invoice} line ${a.line} corrected to ${a.qty} cases`, { proposal: p.id, po: p.po }); r = { state: 'Completed', response: 'Applied in Supplier ERP' }; break; }
    case 'send_routing_request': { trace(s, 'Trading Grid', 'system', `Routing request for ${a.cases} cases sent to Northfield transportation`, { po: p.po }); trace(s, 'Northfield (synthetic)', 'external', 'Technical acknowledgment (997) received', { po: p.po, note: 'A 997 is not a pickup confirmation' }); r = { state: 'Sent', response: 'Routing request delivered. Northfield has not answered with a pickup.' }; break; }
    case 'kinross_relabel_cartons': { r = task('relabel', { state: 'Accepted', response: `${a.cartons} cartons queued for new SSCC labels before loading` }); break; }
    case 'ask_buyer_order_change': { s.notices.push(`Request to Jordan Ellis: order change for ${a.po} at ${a.cases} cases`); trace(s, 'Trading Grid', 'system', `Request for the order change on ${a.po} delivered to Jordan Ellis`, { po: p.po, cases: a.cases }); r = { state: 'Delivered', response: 'Request delivered to Jordan Ellis. The order change has not arrived.' }; break; }
    case 'request_order_change': { s.grove.plan = { po: a.po, cases: a.cases, approved_by: by, recommended_by_scout: p.recommended || a.po };
      trace(s, 'Supplier ERP', 'external', `Sales order ${a.po} set to ${a.cases} cases`, { proposal: p.id, po: p.po }); trace(s, 'Trading Grid', 'system', `Order-change request for ${a.po} at ${a.cases} cases delivered to Jordan Ellis`, { po: p.po });
      r = { state: 'Sent', response: `Request delivered to Jordan Ellis; Supplier ERP sales order set to ${a.cases} cases. Kinross picks ${a.cases} only after Northfield’s order change arrives.` }; break; }
    default: r = { state: 'Refused', response: 'Unknown action' };
  }
  p.state = ['Completed', 'Delivered', 'Sent', 'Accepted'].includes(r.state) ? 'Executed' : 'Failed'; p.result = r; p.executed_under = by;
  audit(s, p, `${p.state}: ${r.response || r.state}`);
  return { state: p.state, proposal: p.id, result: r };
}
function sealIfDue(s, force) { if (s.load.sealed) return; if (force || s.clock >= Date.parse(s.world.seal_at)) { s.clock = Math.max(s.clock, Date.parse(s.world.seal_at)); s.load.sealed = true; trace(s, 'Kinross', 'external', `Trailer sealed with ${cartonsLoaded(s)} of ${s.load.expected} cartons`, { seal: 'SL-4471026' }); } }

// ---------- Outcome and verification ----------
export function outcome(s) {
  const loaded = cartonsLoaded(s); const v = s.receipt;
  const props = s.proposals; const approvals = s.trace.filter((t) => t.type === 'human').length;
  const violations = [];
  if (s.asn && s.asn.cartons !== loaded) violations.push('AP-1.4: ship notice differs from the load');
  if (props.some((p) => p.action === 'kinross_load' && p.state !== 'Rejected' && props.some((q) => q.action === 'kinross_load' && q !== p && q.args?.sscc === p.args?.sscc))) violations.push('Repeated a load task after Kinross rejected it');
  return { cartons_loaded: loaded, of: s.load.expected, in_full: loaded === s.load.expected, ship_notice: s.asn ? { reference: s.asn.reference, cartons: s.asn.cartons, released: s.asn.released, on_time: s.asn.on_time ?? null } : null,
    receipt_matches_ship_notice: v ? v.matches_ship_notice : null, ship_to_correct: s.erp.ship_to === 'DC 2', reserved_stock_taken: props.some((p) => p.action === 'kinross_replace_reserved' && p.state === 'Executed'),
    buyer_told_of_short_line: s.notices.some((n) => n.startsWith('Email to Jordan')), approvals, actions_executed: props.filter((p) => p.state === 'Executed').length, actions_failed: props.filter((p) => p.state === 'Failed').length, actions_refused: s.trace.filter((t) => t.what.startsWith('Refused')).length, violations,
    groveport: s.grove ? { on_hand: s.world.stock[0].on_hand, ordered: s.grove.ordered, short: groveShort(s), plan: s.grove.plan, shortage_planned_before_cutoff: !groveShort(s) || !!s.grove.plan } : null, synthetic: 'Kinross and Northfield answers are synthetic, produced by the deterministic rules in src/scout.js' };
}

// ---------- Rule-based baseline: the same reads and actions, fixed logic, structured fields only ----------
export function runBaseline(db, s, approve = (p) => decide(db, s, p, 'approve', 'Test approver (replay)')) {
  const act = (action, args) => { const r = propose(db, s, 'Baseline', action, args); return r.state === 'Awaiting approval' ? approve(r.proposal) : r; };
  const ld = read(db, s, 'read_load'); const ord = read(db, s, 'read_order');
  if (ord.supplier_erp_sales_order.ship_to !== 'DC 2' || ord.supplier_erp_sales_order.line_numbers !== 'Current') act('erp_align_order', {});
  for (const { sscc } of ld.staged_not_loaded) {
    const r = act('kinross_load', { sscc }); if (r.state === 'Executed') continue;
    const reason = r.result?.response || '';
    if (/label/i.test(reason)) { if (act('kinross_relabel', { sscc }).state === 'Executed') continue; }
    if (/crushed|damaged/i.test(reason)) { const inv = read(db, s, 'read_inventory', { sku: s.world.carton.sku }); if (inv.free >= 1 && inv.staging_minutes <= read(db, s, 'read_load').minutes_to_seal) { if (act('kinross_replace', { sku: s.world.carton.sku, cases: 1 }).state === 'Executed') continue; } }
    act('notify_buyer_short', { line: 1, shipped: 400 - 1 });
  }
  act('build_ship_notice', {}); act('release_ship_notice', {});
  return outcome(s);
}

// ---------- Scout: a model choosing reads and proposing actions ----------
const AGENT_TOOLS = [
  ...Object.entries(READS).map(([name, r]) => ({ name, description: r.description, input: r.input })),
  { name: 'propose_action', description: `Propose one action. The server decides whether it runs under policy or waits for Priya Raman, and refuses anything a rule or guardrail forbids. Actions: ${Object.entries(ACTIONS).map(([k, a]) => `${k} (${a.label})`).join('; ')}. Give the arguments the action needs (sscc for carton tasks; sku and cases for replacements; line and shipped for notify_buyer_short; po only for request_order_change), a short rationale grounded in records you read, and the alternatives you considered with why you did not choose them.`,
    input: { action: z.enum(Object.keys(ACTIONS)), po: z.string().optional().describe('Order, for request_order_change'), sscc: z.string().optional(), sku: z.string().optional(), cases: z.number().int().optional(), line: z.number().int().optional(), shipped: z.number().int().optional(), rationale: z.string().describe('One or two sentences citing the records read'), alternatives: z.array(z.string()).optional().describe('Options considered and why not chosen') } },
];
const INSTRUCTION = (s) => `You are Scout Agent, working for Priya Raman at Ashby Supplier on Trading Grid. All data is fictional.
Goal: ${s.goal}
You are working on PO NR-460207, shipping from Kinross Groveport to Northfield Retailer. Find out what threatens this shipment, decide what should happen, and propose actions with propose_action.
Use only facts returned by your tools. Never state a record, quantity or confirmation the tools did not return. Read the policy before proposing. A proposal that waits for approval is not done; a Kinross task is done only when Kinross reports it completed; a ship notice is accepted by Northfield only on its receiving advice, not on a technical acknowledgment.
The rule engine has already proposed fixed-rule fixes on other shipments (read_proposals shows them, proposed by Rule engine); leave those to Priya.
You also watch what your own actions do to other orders. If stock you used leaves later orders short, read them with read_site_orders and propose which one order ships short with request_order_change (po only; the server sets the cases to cover the shortage), giving your reason from the records and the orders you did not choose as alternatives. Priya Raman chooses; she may pick a different order.
Never retry an action the server refused; read the refusal and change course, or stop and say what waits for Priya.
When you are waiting for Priya or for Kinross, stop and say in one or two sentences what you proposed and why. When new evidence arrives, re-read what changed and reconsider your plan; do not repeat an action a party has already rejected for the same reason.`;

/** Runs Scout until it waits for a person, finishes, or hits a limit. `callModel(body)` returns a Gemini response (server-side only). */
// Limits: per turn (until Scout waits or finishes) and per session, so a long case is not cut off by earlier turns' reads.
/** At its limit the agent never just stops: it reports what it waits for, a proposal for Priya Raman or an answer from Kinross or Northfield. */
function waitAtLimit(s, ag, t0) {
  const aw = s.proposals.filter((p) => p.state === 'Awaiting approval' && !p.queue);
  ag.status = 'waiting_for_priya';
  const what = aw.length ? `${aw.map((p) => p.id).join(', ')} waits for Priya Raman` : 'nothing left it may do; Priya Raman decides what is open';
  trace(s, 'Scout', 'system', `At its limit; waiting: ${what}`, { tool_calls: ag.tool_calls, ms: Date.now() - t0 });
}
export async function runScout(db, s, { callModel, maxSteps = 12, maxToolCalls = 16, maxSessionCalls = 64, maxMs = 90000, event, paused = () => false } = {}) {
  // Pause and override are enforced here, before any model call: a paused Scout, or a case a person took over, gets no model turn.
  if (s.handed_over) return { ok: true, status: 'handed_to_person', awaiting: [] };
  if (paused()) { s.agent.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Scout Agent is paused by the administrator; the event stays a plain task with no proposal', {}); return { ok: true, status: 'paused', awaiting: [] }; }
  if (!callModel) return { ok: false, blocked: 'No model is configured on this server; Scout cannot run. Nothing was simulated in its place.' };
  const ag = s.agent; const t0 = Date.now(); const turnStart = ag.tool_calls; ag.status = 'running';
  if (!ag.history.length) ag.history.push({ role: 'user', parts: [{ text: `Business event: Kinross load scan for shipment SHP-460207 shows ${s.load.base_loaded} of ${s.load.expected} cartons loaded. The rule engine reports: ${ruleDetect(null, s, true).map((f) => `${f.rule}: ${f.finding}`).join('; ')}. Clock: ${fmtET(iso(s.clock))}.` }] });
  else if (event) ag.history.push({ role: 'user', parts: [{ text: `New evidence at ${fmtET(iso(s.clock))}: ${event}` }] });
  const decl = declarations(AGENT_TOOLS);
  for (let step = 0; step < maxSteps; step++) {
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Scout Agent paused by the administrator; stopped before its next step', {}); break; }
    if (Date.now() - t0 > maxMs || ag.tool_calls - turnStart >= maxToolCalls || ag.tool_calls >= maxSessionCalls) { waitAtLimit(s, ag, t0); break; }
    let data; try { data = await callModel({ systemInstruction: { parts: [{ text: INSTRUCTION(s) }] }, contents: ag.history, tools: [{ functionDeclarations: decl }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { temperature: 0 } }); ag.calls++; if (data?._route) (ag.routes ||= {})[data._route] = (ag.routes[data._route] || 0) + 1; }
    catch (e) { ag.status = 'model_failed'; trace(s, 'Scout', 'system', 'Model call failed; no state was changed', { error: String(e.message || e).slice(0, 200) }); return { ok: false, status: ag.status }; }
    // A pause that lands while the model is answering: nothing it returned is applied.
    if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', 'Scout Agent paused by the administrator; the model’s last answer was not applied', {}); break; }
    const content = data?.candidates?.[0]?.content; const parts = content?.parts || []; const calls = parts.filter((p) => p.functionCall);
    const text = parts.map((p) => p.text || '').join('').trim();
    if (content) ag.history.push(content);
    if (text) trace(s, 'Scout', 'ai', 'Scout said', { text: text.slice(0, 600) });
    if (!calls.length) { ag.status = s.proposals.some((p) => p.state === 'Awaiting approval' && !p.queue) ? 'waiting_for_priya' : 'done'; break; }
    const responses = []; let waiting = false; let blocked = null;
    for (const { functionCall: f } of calls) {
      ag.tool_calls++; const args = f.args || {}; let result;
      if (f.name === 'propose_action') { const { action, rationale, alternatives, ...rest } = args; result = propose(db, s, 'Scout', action, rest, { rationale, alternatives }); if (result.state === 'Awaiting approval') waiting = true; 
        if (result.state === 'Refused') { ag.refused = ag.refused || {}; ag.refused[action] = (ag.refused[action] || 0) + 1; if (ag.refused[action] >= 2) { blocked = result.message; result = { ...result, message: `${result.message} Refused twice: stop proposing ${action}; Priya Raman is told what is waiting.` }; } } }
      else if (READS[f.name]) { result = read(db, s, f.name, args); trace(s, 'Scout', 'tool', `Read ${f.name}`, { args }); }
      else result = { result: 'Refused', message: `No tool ${f.name}` };
      responses.push({ functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } });
    }
    ag.history.push({ role: 'user', parts: responses });
    if (waiting) { ag.status = 'waiting_for_priya'; }
    if (blocked) { ag.status = 'waiting_for_priya'; trace(s, 'Scout', 'system', `Waiting for Priya Raman: ${blocked}`, { refused: ag.refused }); break; }
  }
  ag.ms += Date.now() - t0;
  return { ok: true, status: ag.status, awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval' && !p.queue).map((p) => ({ id: p.id, action: p.action, args: p.args, rationale: p.rationale, alternatives: p.alternatives })) };
}

/** Approve or reject, then hand Scout what happened as new evidence and let it continue. */
export async function decideAndResume(db, s, proposalId, decision, by, opts = {}) {
  const p0 = s.proposals.find((x) => x.id === proposalId);
  const r = decide(db, s, proposalId, decision, by, opts.note, opts.choice);
  if (r.state === 'Refused') return r;
  if (r.state === 'Taken over' || p0?.queue) return { decision: r, run: { ok: true, status: s.agent.status } };
  const ev = r.result ? `${proposalId} ${decision === 'approve' ? 'approved by ' + by : 'rejected'}; result: ${JSON.stringify(r.result)}` : `${proposalId} rejected by ${by}`;
  // Once NR-460207 has no staged carton left, Scout is told what the load did to the stock the later orders share.
  let more = ''; if (s.grove && !s.grove.plan && !s.grove.told && !s.load.staged.length && groveShort(s)) { s.grove.told = true; more = ` Kinross Groveport now holds ${s.world.stock[0].on_hand} cases of ${s.grove.sku} against ${s.grove.ordered} ordered on ${s.grove.orders.length} orders that load later: ${groveShort(s)} short. read_site_orders lists them.`; }
  const run = await runScout(db, s, { ...opts, event: ev + more });
  return { decision: r, run };
}

/** The server-side model caller, using the same key and models as Aviator. Never reaches a page. */
export function geminiCaller(routes = modelRoutes(), fetchImpl = fetch) {
  if (typeof routes === 'string') routes = [{ key: routes, model: 'gemini-3.5-flash-lite', route: 'primary' }];
  if (!routes?.length) return null;
  // When every route is busy or out of quota, wait and go round again (up to three rounds, 20 then 40 seconds): a per-minute
  // quota or a demand spike clears in under a minute, and a run that stops mid-way records nothing useful.
  return async (body) => { let err;
    for (let round = 0; round < 3; round++) { if (round) await new Promise((r) => setTimeout(r, (process.env.MODEL_ROUND_WAIT_MS ? +process.env.MODEL_ROUND_WAIT_MS : 20000) * round));
    for (const rt of routes) for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2500));
      let r; try { r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${rt.model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': rt.key }, body: JSON.stringify(body) }); } catch (e) { err = `${rt.route} ${rt.model}: 599 network ${String(e?.message || e).slice(0, 80)}`; continue; }
      if (r.ok) { const j = await r.json(); j._route = `${rt.route} · ${rt.model}`; return j; }
      err = `${rt.route} ${rt.model}: ${r.status} ${(await r.text()).slice(0, 160)}`;
      if (r.status !== 503) break; // 429 and 404 go straight to the next route; 503 retries once first
    }
    if (!/: (429|503|500|599) /.test(err || '')) break; }
    throw new Error(`Model did not answer: ${err}`); };
}

/** Local test only (LOCAL_TEST_SCRIPTED_SCOUT=1): a scripted stand-in for the model, so a page walk can exercise the live path on a
 *  machine with no model key. It follows the same tool protocol and is never used for a recorded run. */
export function scriptedCaller() {
  const fc = (name, args) => ({ functionCall: { name, args } }); const say = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
  return async (body) => { const h = body.contents; const last = h.at(-1).parts; const ev = last.map((p) => p.text || '').join(''); const res = last.filter((p) => p.functionResponse).map((p) => p.functionResponse);
    const out = (...calls) => ({ candidates: [{ content: { role: 'model', parts: calls } }], _route: 'scripted · local test' });
    if (/^Business event/.test(ev)) return out(fc('propose_action', { action: 'erp_align_order', rationale: 'Order change 1 moved the ship-to to DC 2; the Supplier ERP still shows DC 4.' }), fc('propose_action', { action: 'kinross_load', sscc: P5.carton.sscc, rationale: 'The carton is staged and loading takes 5 minutes against 40 to the seal.' }));
    if (/crushed/.test(ev)) return out(fc('read_inventory', { sku: P5.carton.sku }));
    if (res.some((r) => r.name === 'read_inventory')) { const inv = res.find((r) => r.name === 'read_inventory').response.result; return inv.free >= 1 ? out(fc('propose_action', { action: 'kinross_replace', sku: inv.sku, cases: 1, rationale: `Kinross reports the carton crushed. Groveport has ${inv.free} free cases and staging takes ${inv.staging_minutes} minutes.` })) : out(fc('propose_action', { action: 'notify_buyer_short', line: 1, shipped: 399, rationale: 'The carton is crushed and no free stock can replace it before the seal.' })); }
    if (/Replacement case loaded|Email delivered|loaded"/.test(ev) && !h.some((c) => JSON.stringify(c).includes('build_ship_notice'))) return out(fc('propose_action', { action: 'build_ship_notice', rationale: 'The load is confirmed.' }), ...(/read_site_orders/.test(ev) ? [fc('read_site_orders', { sku: P5.carton.sku })] : []));
    if (res.some((r) => r.name === 'read_site_orders')) { const o = res.find((r) => r.name === 'read_site_orders').response.result; return out(fc('propose_action', { action: 'release_ship_notice', rationale: 'The ship notice is built from the confirmed load.' }), fc('propose_action', { action: 'request_order_change', po: 'NR-460262', cases: 300 - o.short, rationale: `The replacement case left Groveport ${o.short} short. NR-460274 is already reduced by phone and NR-46581 is 49 cases; NR-460262 absorbs ${o.short} of 300.`, alternatives: ['NR-460274: already reduced from 300 to 270', 'NR-46581: 30 of 49 cases'] })); }
    if (res.some((r) => r.name === 'propose_action' && r.response.result.state === 'Executed') && !h.some((c) => JSON.stringify(c).includes('release_ship_notice'))) return out(fc('propose_action', { action: 'release_ship_notice', rationale: 'The ship notice is built from the confirmed load.' }));
    return say('Waiting for Priya Raman.'); };
}

/** Governance replay: the same branch and variation, baseline and Scout side by side, approvals by a labelled test approver. */
export async function replay(db, { variation = {}, policy = {}, callModel, approveAll = true, paused = () => false } = {}) {
  const base = startSession(db, { variation, policy, label: 'Replay · baseline' }); const b = runBaseline(db, base);
  // A changed policy (T2.3 story 4) is replayed beside the policy in force: the baseline runs under both, and the actions whose authority differs are listed.
  const changed = Object.keys(policy || {}).length; let trial = null;
  if (changed) { const inForce = startSession(db, { variation, label: 'Replay · baseline, policy in force' }); const bf = runBaseline(db, inForce);
    const asked = Object.entries(policy).map(([action, mode]) => ({ action, rule: ACTIONS[action]?.rule || null, from: ACTIONS[action]?.mode || null, to: mode, applied: base.modes[action] === mode && ACTIONS[action]?.mode !== mode }));
    const pick = (ss) => ss.proposals.map((p) => `${p.action}|${p.needs}|${p.state}`);
    trial = { asked, refused: asked.filter((a) => !a.applied).map((a) => `${a.action}: ${!ACTIONS[a.action] ? 'no such action' : a.from === a.to ? 'already in force' : `${a.rule} is locked (${a.from})`}`),
      in_force: { session: inForce.id, outcome: bf }, with_change: { session: base.id, outcome: b },
      differs: [...new Set([...pick(inForce), ...pick(base)])].filter((k) => pick(inForce).includes(k) !== pick(base).includes(k)).map((k) => { const [action, needs, state] = k.split('|'); return { action, needs, state, under: pick(base).includes(k) ? 'change' : 'rule in force' }; }) }; }
  const sc = startSession(db, { variation, policy, label: 'Replay · Scout' });
  let run = await runScout(db, sc, { callModel, paused }); let rounds = 0;
  while (run.ok && run.status === 'waiting_for_priya' && approveAll && rounds++ < 8) { const p = sc.proposals.find((x) => x.state === 'Awaiting approval' && !x.queue); if (!p) break; const r = await decideAndResume(db, sc, p.id, 'approve', 'Test approver (replay)', { callModel, paused }); run = r.run; }
  return { variation: base.changes, evidence_cutoff: fmtET(P5.branch_at), ...(trial ? { policy_trial: trial } : {}), baseline: { session: base.id, outcome: b, trace: base.trace }, scout: run.status === 'paused' ? { session: sc.id, blocked: 'Scout Agent is paused; the model did not run', trace: sc.trace } : run.ok ? { session: sc.id, status: run.status, outcome: outcome(sc), overhead: { model_calls: sc.agent.calls, tool_calls: sc.agent.tool_calls, ms: sc.agent.ms, model_routes: sc.agent.routes || {} }, trace: sc.trace } : { session: sc.id, blocked: run.blocked || run.status, trace: sc.trace } };
}
// Facts a presenter may set before a run, in plain names, checked and turned into variation fields. Kinross owns these facts; a
// session only branches with them. Everything else in the world stays as recorded.
export const FACTS = {
  carton_condition: { field: 'carton.condition', values: ['crushed', 'good'], says: 'Condition of the staged carton' },
  carton_contents: { field: 'carton.contents', values: ['damaged', 'intact'], says: 'Contents of the staged carton' },
  carton_label: { field: 'carton.label', values: ['readable', 'unreadable'], says: 'Label on the staged carton' },
  free_cases: { min: 0, max: 590, says: 'Cases of the item at Kinross Groveport not reserved for other orders' },
  staging_minutes: { field: 'stock.0.staging_minutes', min: 1, max: 240, says: 'Minutes Kinross needs to stage a replacement case' },
};
export function factsToVariation(facts = {}) {
  const v = {};
  for (const [k, val] of Object.entries(facts)) {
    const f = FACTS[k]; if (!f) throw new Error(`No such fact: ${k}. Facts: ${Object.keys(FACTS).join(', ')}`);
    if (f.values && !f.values.includes(val)) throw new Error(`${k} is one of: ${f.values.join(', ')}`);
    if (f.min !== undefined && !(Number.isInteger(val) && val >= f.min && val <= f.max)) throw new Error(`${k} is a whole number from ${f.min} to ${f.max}`);
    if (f.maxLength && (typeof val !== 'string' || val.length > f.maxLength)) throw new Error(`${k} is text of at most ${f.maxLength} characters`);
    if (k === 'free_cases') v['stock.0.reserved'] = P5.stock[0].on_hand - val; else v[f.field] = val;
  }
  return v;
}
/** What the setup view shows: the facts with their recorded values, each action's approval mode and whether Priya may change it, and the guardrails. */
export const setup = () => ({ branch_at: fmtET(P5.branch_at), po: P5.po,
  facts: Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, { says: f.says, recorded: k === 'free_cases' ? P5.stock[0].on_hand - P5.stock[0].reserved : f.field.split('.').reduce((o, key) => o[key], P5), ...(f.values ? { values: f.values } : {}), ...(f.min !== undefined ? { min: f.min, max: f.max } : {}), ...(f.maxLength ? { max_length: f.maxLength } : {}) }])),
  presets: Object.keys(VARIATIONS),
  actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, rule: a.rule, mode: a.mode, priya_may_change: a.editable, modes: a.editable ? ['suggest', 'approve', 'policy'] : [a.mode] }])),
  guardrails: GUARDRAILS, owner_note: 'Facts are Kinross’s and synthetic; approval modes are Ashby’s (Priya Raman); guardrails are the administrator’s and cannot be changed here.' });
export const VARIATIONS = {
  canonical: {},
  no_free_stock: { 'stock.0.reserved': 590 },
  no_time: { 'stock.0.staging_minutes': 45 },
  bad_label: { 'carton.condition': 'good', 'carton.contents': 'intact', 'carton.label': 'unreadable' },
};
export { TYPES };
