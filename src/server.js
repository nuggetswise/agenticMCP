// MCP server: Ashby Supplier's Trading Grid connection for its own AI assistant, over one timeline of trade.
// Streamable HTTP at /mcp/<token>; the same tools as REST at /api/<token>/v1/... (see openapi/openapi.json).
// Every call is checked against the connection's scopes and logged. Read-only unless WRITES=on.
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { buildWorld, MAIN_DB, ASHBY_DB, NORTHFIELD_DB } from '../world/build.js';
import { fmtET } from '../world/lib.js';
import * as NR from './retailer.js';
import * as D from './domain.js';
import { TOOLS, BOUNDARY, SCOPES, ASHBY_WRITES, ASHBY_REFUSALS, NF_TOOLS, NF_WRITES, NF_REFUSALS, NF_SCOPES } from './tools.js';
import { recordPage, documentPage, adminPage, homePage, nfOrderPage } from './pages.js';
import * as Aviator from './aviator.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN || randomBytes(18).toString('base64url');
const NF_TOKEN = process.env.NF_TOKEN || randomBytes(18).toString('base64url');
const BASE = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Writes are proposals a person approves, with the catalogue's exceptions; WRITES=off makes both connections read-only.
export const WRITES = process.env.WRITES !== 'off';
if (!process.env.MCP_TOKEN) console.warn(`MCP_TOKEN not set; generated one for this run: ${TOKEN}`);
if (!process.env.NF_TOKEN) console.warn(`NF_TOKEN not set; generated one for this run: ${NF_TOKEN}`);

if (!existsSync(MAIN_DB) || !existsSync(ASHBY_DB) || !existsSync(NORTHFIELD_DB)) buildWorld();
const db = new DatabaseSync(MAIN_DB);
const ashbyDb = new DatabaseSync(ASHBY_DB, { readOnly: true });
const nfDb = new DatabaseSync(NORTHFIELD_DB, { readOnly: true });
const BASELINE_EVENT = db.prepare('SELECT max(id) m FROM events').get().m;
const AS = 'ashby-assistant', NF = 'northfield-assistant';
const BY_TOKEN = { [TOKEN]: AS, [NF_TOKEN]: NF };
// AVIATOR_TOKEN opens Aviator only (read tools through the model), never MCP, REST or admin: <token>-ashby or <token>-northfield.
const AV = process.env.AVIATOR_TOKEN || '';
const BY_AVIATOR = AV ? { [`${AV}-ashby`]: AS, [`${AV}-northfield`]: NF } : {};
const aviatorCid = (req, res) => { const c = BY_TOKEN[req.params.token] || BY_AVIATOR[req.params.token]; if (!c) { res.status(404).send('Not found'); return null; } return c; };
const OTHER = { [AS]: NF, [NF]: AS };
const SIDE = {
  [AS]: { party: 'ASHBY', person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer', notAvailable: D.NOT_AVAILABLE, scopes: SCOPES, sqlDb: () => ashbyDb, records: 'records', privateTables: /\b(review_notes|draft_rules|rule_replays)\b/i, privateWhat: 'Northfield’s accounts payable, draft rules and claims reviewer notes' },
  [NF]: { party: 'NORTHFIELD', person: 'Jordan Ellis', company: 'Northfield Retailer', other: 'Ashby Supplier', notAvailable: NR.NOT_AVAILABLE_NF, scopes: NF_SCOPES, sqlDb: () => nfDb, records: 'records/northfield', privateTables: /\b(warehouse_orders)\b/i, privateWhat: 'a supplier’s warehouse, ERP, carrier and agent records' },
};
const conn = (id) => { const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(id); return { ...c, scopes: JSON.parse(c.scopes) }; };
function linkify(obj, side) {
  const walk = (v) => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = (k === 'link' && typeof x === 'string') ? (x ? `${BASE}/${side.records}/${x}` : null) : walk(x); return o; } return v; };
  return walk(obj);
}
const refsOf = (obj) => { const out = new Set(); const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (['po', 'reference', 'case', 'record', 'invoice', 'proposal'].includes(k) && typeof x === 'string') out.add(x); walk(x); } }; walk(obj); return [...out].slice(0, 50); };
function log(cid, tool, scopesUsed, args, result, records) {
  db.prepare('INSERT INTO access_log (at, connection_id, user_name, tool, scopes_used, arguments, result, records) VALUES (?,?,?,?,?,?,?,?)').run(new Date().toISOString(), cid, conn(cid).user_name, tool, JSON.stringify(scopesUsed), JSON.stringify(args || {}), result, JSON.stringify(records || []));
}
/** A write that lands in a shared record is logged on the other company's connection too. */
const logOther = (cid, tool, what, records) => log(OTHER[cid], `counterparty:${tool}`, [], { by: SIDE[cid].company }, what, records);
const refuse = (cid, tool, args, what) => { const side = SIDE[cid]; log(cid, tool, [], args, side.notAvailable, []); return { result: side.notAvailable, message: `${side.notAvailable}: ${what} belong to ${side.other}.` }; };

/** Masks parts of an Ashby answer the granted scopes do not cover. */
function mask(out, has) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) {
      if ((k === 'rule' || k === 'evidence_rule') && x && !has('rules')) o[k] = { id: x.id, statement: 'Scope not granted: rules', source: null };
      else if (['rejections', 'top_causes', 'other_causes', 'open_failures', 'rejected_by', 'failure_rate'].includes(k) && !has('errors')) o[k] = 'Scope not granted: errors';
      else if (k === 'failures' && typeof x === 'number' && !has('errors')) o[k] = 'Scope not granted: errors';
      else if (k === 'reason' && typeof x === 'string' && !has('errors')) o[k] = x.replace(/:.*$/, ': cause hidden, errors scope not granted');
      else if (['charges', 'payments'].includes(k) && !has('deductions')) o[k] = 'Scope not granted: deductions';
      else if (k === 'documents' && Array.isArray(x) && !has('documents')) o[k] = 'Scope not granted: documents';
      else o[k] = walk(x);
    } return o; }
    return v;
  };
  return walk(out);
}

/** When a write lands: after the later of the requested time and the last record on that order. */
function writeAt(po, asOf) { const last = po ? db.prepare('SELECT max(at) m FROM events WHERE po = ?').get(po).m : null; const t = Math.max(D.asOfDate(asOf).getTime(), last ? Date.parse(last) + 60000 : 0); return new Date(t).toISOString(); }
function addEvent(at, kind, po, party, data) { return db.prepare('INSERT INTO events (at, kind, po, system, party, channel, data) VALUES (?,?,?,?,?,?,?)').run(at, kind, po, kind.startsWith('case.') ? 'Northfield deduction case' : kind.startsWith('rule.') ? 'Northfield supplier guide' : 'Trading Grid', party, 'Trading Grid', JSON.stringify(data)).lastInsertRowid; }
function propose(cid, kind, rule, action, target, payload) {
  const id = `PR-${String(db.prepare('SELECT count(*) n FROM proposals').get().n + 1).padStart(4, '0')}`; const side = SIDE[cid];
  db.prepare('INSERT INTO proposals (id, connection_id, kind, approver, rule_id, created_at, created_by, action, target, payload, state) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, cid, kind, side.person, rule || null, new Date().toISOString(), `${side.person}’s assistant`, action, target || '', JSON.stringify(payload), 'Awaiting approval');
  log(cid, kind === 'change' ? 'request_change' : ({ dispute: 'submit_dispute', release: 'release_ship_notice', decision: 'decide_charge', publish: 'publish_rule' })[kind], [], payload, 'Proposal recorded', [id, target].filter(Boolean));
  return { result: 'Proposal recorded', proposal: id, state: 'Awaiting approval', approver: side.person, rule: rule ? D.rule(db, rule) : null, message: `Nothing has left ${side.company}. ${side.person} approves or rejects this proposal in Trading Grid.`, approve_at: `${BASE}/admin/<token>` };
}

/** Writes. Each follows the rule catalogue: an agent drafts, a person approves, with AP-4.1's exception. */
function write(cid, name, args) {
  if (!WRITES) { log(cid, name, [], args, 'Action not available', []); return { result: 'Action not available', message: 'This connection is read-only. Complete and approve the action in Trading Grid.' }; }
  if (cid === AS && name === 'submit_dispute') {
    const c = D.deductionCase(db, args.case || '', D.asOfDate(args.as_of)); if (!c.found) { log(cid, name, [], args, c.not_available ? D.NOT_AVAILABLE : 'Invalid request', []); return c; }
    const charge = (args.charge || c.charge).toUpperCase(); const amount = charge === c.charge ? c.amount : Math.abs((c.other_charges_on_this_order.find((x) => /CI-NF/.test(x.reference || '')) || {}).amount || 0);
    const done = db.prepare("SELECT 1 FROM events WHERE kind = 'case.dispute' AND json_extract(data,'$.case') = ? AND json_extract(data,'$.charge') = ?").get(c.case, charge);
    if (done) { log(cid, name, [], args, 'Invalid request', [c.case]); return { result: 'Invalid request', message: `${charge} in ${c.case} is already disputed. NF-7.3 allows one dispute per deduction.` }; }
    const st = Object.fromEntries(c.evidence.map((e) => [e.kind, e.state]));
    const onHand = st['carrier.bill_of_lading'] === 'In the case' && st['carrier.delivery_receipt'] === 'In the case' && (st['wms.load_scan'] === 'In the case' || st['wms.load_tally'] === 'In the case');
    const limit = D.param(db, 'AP-4.1', 'max_amount'); const evidence = args.evidence && args.evidence.length ? args.evidence : c.evidence.filter((e) => e.state !== 'Not found').map((e) => e.evidence);
    if (onHand && amount < limit) {
      const at = writeAt(c.po, args.as_of); addEvent(at, 'case.dispute', c.po, 'ASHBY', { case: c.case, charge, amount, evidence, drafted_by: 'Claim Agent', approved_by: 'Standing rule AP-4.1, set by Priya Raman', without_asking: true });
      log(cid, name, ['deductions'], args, 'Dispute submitted under AP-4.1', [c.case]); logOther(cid, name, `Dispute received on ${charge} in ${c.case}`, [c.case]);
      return { result: 'Dispute submitted', case: c.case, charge, amount, at: fmtET(at), evidence, authority: `Claim Agent submitted without asking: the NF-7.4 evidence is in the case and $${amount.toFixed(2)} is under $${limit} (AP-4.1)`, rule: D.rule(db, 'AP-4.1') };
    }
    return propose(cid, 'dispute', 'AP-4.1', `Dispute ${charge} in ${c.case}`, c.case, { case: c.case, po: c.po, charge, amount, evidence, as_of: args.as_of || null, why_not_automatic: !onHand ? 'The NF-7.4 evidence is not all in the case' : `$${amount.toFixed(2)} is not under $${limit}` });
  }
  if (cid === AS && name === 'release_ship_notice') return propose(cid, 'release', 'AP-1.3', `Release held ship notice ${args.document}`, args.document, args);
  if (cid === NF && name === 'decide_charge') {
    const c = NR.caseNF(db, args.case || '', D.asOfDate(args.as_of)); if (!c.found) { log(cid, name, [], args, 'Invalid request', []); return c; }
    const charge = args.charge.toUpperCase(); const disputed = c.disputes.some((d) => d.charge === charge); const decided = c.decisions.some((d) => d.charge === charge);
    if (!disputed || decided) { log(cid, name, [], args, 'Invalid request', [c.case]); return { result: 'Invalid request', message: decided ? `${charge} in ${c.case} is already decided` : `${charge} in ${c.case} has not been disputed` }; }
    const rec = c.review_agent && c.review_agent.charge === charge ? c.review_agent.next_step : null;
    return propose(cid, 'decision', 'NF-7.7', `${args.decision} ${charge} in ${c.case}`, c.case, { case: c.case, po: c.po, charge, decision: args.decision, reason: args.reason || null, review_agent: rec, as_of: args.as_of || null });
  }
  if (cid === NF && name === 'publish_rule') {
    const id = String(args.draft || '').toUpperCase(); const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(id);
    if (!d) { log(cid, name, [], args, 'Invalid request', []); return { result: 'Invalid request', message: `No draft rule ${args.draft}` }; }
    if (!db.prepare('SELECT 1 FROM rule_replays WHERE draft_id = ?').get(id)) { log(cid, name, [], args, 'Refused: replay first', [id]); return { result: 'Refused', message: `${id} has not been replayed against the quarter. Call replay_draft_rule with draft ${id} first; a rule is published only after a replay.` }; }
    return propose(cid, 'publish', null, `Publish ${id}: ${d.statement}`, id, { draft: id });
  }
  if (name === 'request_change') { const po = args.po ? D.normPo(args.po) : null; return propose(cid, 'change', null, args.action, po || args.document || '', args); }
  return { result: 'Invalid request', error: `Unknown tool ${name}` };
}

/** Runs one tool call for one connection: scope check, the read, masking, links and the access log. */
export function call(cid, name, args = {}) {
  const side = SIDE[cid]; const granted = conn(cid).scopes; const has = (s) => granted.includes(s);
  const list = cid === AS ? TOOLS : NF_TOOLS; const tool = list.find((x) => x.name === name);
  if (tool) {
    const missing = tool.required.filter((s) => !has(s));
    if (missing.length) { log(cid, name, tool.required, args, 'Scope not granted', []); return { result: 'Scope not granted', missing_scopes: missing, message: `Scope not granted: ${missing.join(', ')}. ${side.company}’s admin has not granted ${missing.length > 1 ? 'these scopes' : 'this scope'} to this assistant.` }; }
    if (cid === AS && args.supplier && !/ashby/i.test(args.supplier)) { log(cid, name, tool.required, args, D.NOT_AVAILABLE, []); return { result: D.NOT_AVAILABLE, message: 'This connection reads Ashby Supplier’s own records only.' }; }
    let out; try { out = tool.run(db, args); } catch (e) { log(cid, name, tool.required, args, 'Invalid request', []); return { result: 'Invalid request', error: e.message }; }
    if (tool.records_replay && out && out.found && out.draft) db.prepare('INSERT INTO rule_replays (draft_id, at, by_connection, result) VALUES (?,?,?,?)').run(out.draft.id, new Date().toISOString(), cid, JSON.stringify({ failing_with_draft: out.failing_with_draft, added_exposure: out.added_exposure }));
    const result = out && out.not_available ? side.notAvailable : 'Answered';
    const body = linkify(cid === AS ? mask(out, has) : out, side); body.read_at = new Date().toISOString();
    log(cid, name, [...tool.required, ...tool.optional.filter(has)], args, result, refsOf(out));
    return body;
  }
  if (cid === AS && name === 'compare_with_other_suppliers') { log(cid, name, [], args, D.NOT_AVAILABLE, []); return { result: D.NOT_AVAILABLE, message: 'Other suppliers’ records are not available on Ashby’s connection.' }; }
  if (cid === AS && name === 'read_retailer_records') return refuse(cid, name, args, 'Northfield’s accounts payable, draft rules and claims reviewer notes');
  if (cid === NF && name === 'read_supplier_records') return refuse(cid, name, args, 'Suppliers’ ERP, warehouse, carrier and agent records and their internal policies');
  if ([...(cid === AS ? ASHBY_WRITES : NF_WRITES), { name: 'request_change' }].some((w) => w.name === name)) return write(cid, name, args);
  if (name === 'run_readonly_sql') {
    const missing = side.scopes.filter((s) => !has(s)); if (missing.length) { log(cid, name, side.scopes, args, 'Scope not granted', []); return { result: 'Scope not granted', missing_scopes: missing }; }
    const q = String(args.sql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(q) || q.includes(';') || /\b(attach|detach|pragma|vacuum|insert|update|delete|drop|create|alter|replace|reindex|load_extension)\b/i.test(q)) { log(cid, name, side.scopes, args, 'Invalid request', []); return { result: 'Invalid request', error: 'Only one read-only SELECT is allowed.' }; }
    if (side.privateTables.test(q)) return refuse(cid, name, args, side.privateWhat);
    try { const rows = side.sqlDb().prepare(`SELECT * FROM (${q}) LIMIT 200`).all(); log(cid, name, side.scopes, args, 'Answered', []); return { rows: rows.map((r) => ({ ...r })), row_count: rows.length, note: rows.length === 200 ? 'Limited to 200 rows' : undefined }; }
    catch (e) { log(cid, name, side.scopes, args, 'Invalid request', []); return { result: 'Invalid request', error: e.message }; }
  }
  if (name === 'get_access_log') {
    const rows = db.prepare('SELECT * FROM access_log WHERE connection_id = ? ORDER BY id DESC LIMIT ?').all(cid, args.limit || 50); log(cid, name, [], args, 'Answered', []);
    return { connection: cid, configured_by: conn(cid).configured_by, scopes: conn(cid).scopes, writes: WRITES ? 'Proposals a person approves' : 'Read only', calls: rows.map((r) => ({ at: r.at, user: r.user_name, tool: r.tool, scopes: JSON.parse(r.scopes_used), arguments: JSON.parse(r.arguments), result: r.result, records: JSON.parse(r.records) })) };
  }
  return { result: 'Invalid request', error: `Unknown tool ${name}` };
}

/** A person decides a proposal in Trading Grid. Approval appends the record it describes. */
export function decide(cid, id, decision) {
  const p = db.prepare("SELECT * FROM proposals WHERE id = ? AND state = 'Awaiting approval'").get(id); if (!p || p.connection_id !== cid) return null;
  const side = SIDE[cid]; const a = JSON.parse(p.payload); let eventId = null; const now = new Date().toISOString();
  if (decision === 'approve') {
    if (p.kind === 'dispute') { eventId = addEvent(writeAt(a.po, a.as_of), 'case.dispute', a.po, 'ASHBY', { case: a.case, charge: a.charge, amount: a.amount, evidence: a.evidence, drafted_by: 'Claim Agent', approved_by: 'Priya Raman' }); logOther(cid, 'submit_dispute', `Dispute received on ${a.charge} in ${a.case}`, [a.case]); }
    else if (p.kind === 'decision') { const c = NR.caseNF(db, a.case, D.asOfDate('2027-01-06')); const amt = (c.withheld.find((w) => (a.charge === c.charge ? w.reference === c.deduction : /CI-NF/.test(w.reference))) || {}).amount;
      eventId = addEvent(writeAt(a.po, a.as_of), 'case.decision', a.po, 'NORTHFIELD', { case: a.case, charge: a.charge, amount: amt ? Math.abs(amt) : null, decision: a.decision, decided_by: 'Jordan Ellis', drafted_by: 'Jordan Ellis’s assistant', review_agent_recommended: a.review_agent, reason: a.reason }); logOther(cid, 'decide_charge', `${a.charge} in ${a.case} ${a.decision} by Jordan Ellis`, [a.case]); }
    else if (p.kind === 'publish') { const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(a.draft); db.prepare("UPDATE draft_rules SET state = 'Published' WHERE id = ?").run(a.draft); eventId = addEvent(writeAt(null, null), 'rule.published', null, 'NORTHFIELD', { draft: a.draft, statement: d.statement, published_by: 'Jordan Ellis', replayed: true }); logOther(cid, 'publish_rule', `Rule ${a.draft} published by Northfield`, [a.draft]); }
    else if (p.kind === 'release') { eventId = addEvent(writeAt(a.po ? D.normPo(a.po) : null, null), 'tg.release', a.po ? D.normPo(a.po) : null, 'ASHBY', { document: a.document, released_by: 'Priya Raman', rule: 'AP-1.3' }); }
    else eventId = addEvent(now, 'proposal.approved', /^NR-/.test(p.target) ? p.target : null, side.party, { proposal: p.id, action: p.action, target: p.target, proposed_by: p.created_by, approved_by: side.person });
  }
  db.prepare('UPDATE proposals SET state = ?, decided_by = ?, decided_at = ?, result_event = ? WHERE id = ?').run(decision === 'approve' ? 'Approved' : 'Rejected', side.person, now, eventId, p.id);
  log(cid, `${decision}_proposal`, [], { proposal: p.id }, decision === 'approve' ? 'Approved' : 'Rejected', [p.id, p.target]);
  return p.id;
}

const SQL_TOOL = { name: 'run_readonly_sql', title: 'Read-only SQL over Ashby records', description: 'One SELECT over a copy holding only Ashby Supplier’s records. Tables: orders(po, stream, ship_to, received_at, requested_delivery, order_value, accepted_value), order_lines, order_changes, documents(doc_id, reference, po, doc_type, name, sender_id, receiver_id, partner_id, sent_at, status, answers_doc_id, body JSON, raw X12), errors(doc_id, reported_by, channel, cause, field, sent_value, rule_id, status, corrected_by), shipments, shipment_lines, cartons(sscc, shipment_id, po, line, received), receipts, invoices, invoice_lines, remittance_items, adjustments, warehouse_orders, store_activity, events(at, kind, po, system, channel, data JSON), rules(id, owner, implements, params, statement, ...), items, locations, parties, calendar. Baseline records, without writes made on the connection. Times are ISO UTC. At most 200 rows.', input: { sql: z.string().describe('A single SELECT or WITH query') } };
const NF_SQL_TOOL = { name: 'run_readonly_sql', title: 'Read-only SQL over Northfield records', description: 'One SELECT over a copy holding Northfield Retailer’s records: every supplier’s orders, order lines and changes, exchanged documents (no 940 or 945), errors, shipments and cartons from ship notices, receipts, invoices, remittances and adjustments, store activity, Northfield’s own events, deduction cases, review_notes, draft_rules, rules (Northfield, industry and law). Baseline records, without writes made on the connection. Times are ISO UTC. At most 200 rows.', input: { sql: z.string().describe('A single SELECT or WITH query') } };
const LOG_TOOL = { name: 'get_access_log', title: 'Access log', description: 'Every call made on this connection, and writes the other company made into shared records: time, user, tool, scopes used, arguments, result and records returned. Newest first.', input: { limit: z.number().int().min(1).max(200).optional() } };
export const ALL_TOOLS = [...TOOLS, ...BOUNDARY, ...ASHBY_WRITES, ...ASHBY_REFUSALS, SQL_TOOL, LOG_TOOL];
export const ALL_NF_TOOLS = [...NF_TOOLS, ...NF_WRITES, ...NF_REFUSALS, NF_SQL_TOOL, LOG_TOOL];
const WRITE_NAMES = new Set(['request_change', 'submit_dispute', 'release_ship_notice', 'decide_charge', 'publish_rule']);

const INSTRUCTIONS = {
  [AS]: () => ['This is Ashby Supplier’s connection to Trading Grid, the B2B network Ashby uses to trade with Northfield Retailer. All data is fictional.',
    'It holds one quarter of trade, 27 September to 26 December 2026, with settlement to 6 January 2027. Times are US Eastern.',
    'Questions about "now" are answered as of the story clock, Tuesday 17 November 2026 11:00 Eastern, unless you pass as_of. get_story_calendar lists other moments.',
    'Find records by PO number, document reference or case id. Answer only from tool results and cite each record with its link.',
    'Keep a technical acknowledgment (997) separate from business acceptance: Northfield sends no business acceptance.',
    WRITES ? 'Writes follow Ashby’s rules: submit_dispute, release_ship_notice and request_change record proposals Priya Raman approves in Trading Grid; only AP-4.1 lets Claim Agent dispute without asking. Ship notice release always stays with a person (AP-1.3).' : 'Nothing on this connection creates, changes or sends a Trading Grid record. For any action, call request_change and give the user its Trading Grid link.',
    'Records of other suppliers are not available, and Northfield’s payables, draft rules and reviewer notes are Northfield’s: say "Not available to Ashby".'].join(' '),
  [NF]: () => ['This is Northfield Retailer’s connection to Trading Grid for Jordan Ellis’s own assistant. All data is fictional.',
    'It holds the same quarter of trade as its suppliers see, 27 September to 26 December 2026, settlement to 6 January 2027. Times are US Eastern; the default as_of is Tuesday 17 November 2026 11:00 Eastern.',
    'Documents exchanged with suppliers are shared: both sides see the same X12. A supplier’s ERP, warehouse, carrier and agent records are the supplier’s: say "Not available to Northfield" unless the supplier shared them into a case.',
    WRITES ? 'Writes follow Northfield’s guide: decide_charge, publish_rule and request_change record proposals Jordan Ellis approves in Trading Grid. Jordan decides every charge (NF-7.7). A rule is published only after replay_draft_rule.' : 'This connection is read-only.',
    'Answer only from tool results and cite each record with its link.'].join(' '),
};
function makeServer(cid) {
  const server = new McpServer({ name: cid === AS ? 'trading-grid-ashby' : 'trading-grid-northfield', title: cid === AS ? 'Trading Grid · Ashby Supplier' : 'Trading Grid · Northfield Retailer', version: '0.3.0' }, { instructions: INSTRUCTIONS[cid]() });
  for (const tool of cid === AS ? ALL_TOOLS : ALL_NF_TOOLS) {
    const write = WRITE_NAMES.has(tool.name) && WRITES;
    const extra = cid === AS && tool.required ? { supplier: z.string().optional().describe('Supplier whose records to read. Only Ashby Supplier is available on this connection.') } : {};
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: { ...tool.input, ...extra }, annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false } },
      async (args = {}) => ({ content: [{ type: 'text', text: JSON.stringify(call(cid, tool.name, args), null, 1) }] }));
  }
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.get('/', (req, res) => res.type('html').send(homePage()));
app.get('/healthz', (req, res) => res.json({ status: 'ok', version: '0.3.0', writes: WRITES, connections: [AS, NF], aviator: !!process.env.GEMINI_API_KEY }));
const cidOf = (req, res) => { const c = BY_TOKEN[req.params.token]; if (!c) { res.status(404).send('Not found'); return null; } return c; };

app.post('/mcp/:token', async (req, res) => {
  const cid = cidOf(req, res); if (!cid) return;
  const server = makeServer(cid); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
});
app.get('/mcp/:token', (req, res) => { if (cidOf(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });
app.delete('/mcp/:token', (req, res) => { if (cidOf(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });

// REST: Ashby's tools as the API draft describes them; every tool on either connection at /api/<token>/tools/<name>.
for (const tool of [...TOOLS, ...BOUNDARY]) {
  const [method, path] = tool.rest; const route = `/api/:token${path.replace(/\{(\w+)\}/g, ':$1')}`;
  app[method.toLowerCase()](route, (req, res) => {
    const cid = cidOf(req, res); if (!cid) return; if (cid !== AS) return res.status(404).send('Not found');
    const { token, ...params } = req.params; const q = { ...req.query }; if (q.days) q.days = Number(q.days); for (const k of ['include_warehouse', 'lines']) if (k in q) q[k] = q[k] === 'true';
    const args = { ...q, ...(req.body || {}), ...params }; if (typeof args.pos === 'string') args.pos = args.pos.split(',');
    res.json(call(AS, tool.name, args));
  });
}
app.get('/api/:token/tools', (req, res) => { const cid = cidOf(req, res); if (!cid) return; res.json({ instructions: INSTRUCTIONS[cid](), tools: (cid === AS ? ALL_TOOLS : ALL_NF_TOOLS).map((t) => ({ name: t.name, description: t.description, input: Object.fromEntries(Object.entries(t.input || {}).map(([k, v]) => [k, v.description || ''])) })) }); });
app.all('/api/:token/tools/:name', (req, res) => { const cid = cidOf(req, res); if (!cid) return; res.json(call(cid, req.params.name, { ...req.query, ...(req.body || {}) })); });

app.get('/records/order/:po', (req, res) => res.type('html').send(recordPage(D.lifecycle(db, req.params.po))));
app.get('/records/document/:id', (req, res) => res.type('html').send(documentPage(D.document(db, req.params.id))));
app.get('/records/northfield/order/:po', (req, res) => res.type('html').send(nfOrderPage(NR.trail(db, { po: req.params.po, asOf: D.asOfDate('2027-01-06') }))));
app.get('/records/northfield/document/:id', (req, res) => { const d = NR.documentNF(db, req.params.id); res.type('html').send(d.found ? documentPage(D.document(db, req.params.id).found ? D.document(db, req.params.id) : { ...d, found: true, versions: [], control_numbers: {}, file: '' }) : nfOrderPage(d)); });
app.get('/records/:old/order/:po', (req, res) => res.redirect(`/records/order/${encodeURIComponent(req.params.po)}`));

const adminData = (cid, token) => ({ connection: conn(cid), side: SIDE[cid], rows: db.prepare('SELECT * FROM access_log WHERE connection_id = ? ORDER BY id DESC LIMIT 200').all(cid), allScopes: SIDE[cid].scopes, token, mcpUrl: `${BASE}/mcp/${token}`, writes: WRITES, proposals: db.prepare('SELECT * FROM proposals WHERE connection_id = ? ORDER BY created_at DESC').all(cid) });
// Aviator: the in-product assistant. A Trading Grid page posts a question; the model runs on the server with the
// connection's read tools only, so scopes, refusals and the access log apply exactly as they do for the company's own assistant.
const cors = (res) => res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' });
app.options('/aviator/:token', (req, res) => { cors(res).status(204).end(); });
app.post('/aviator/:token', async (req, res) => {
  const cid = aviatorCid(req, res); if (!cid) return; cors(res);
  const tools = cid === AS ? TOOLS : NF_TOOLS; const side = SIDE[cid]; const q = req.body?.question;
  try {
    const out = await Aviator.ask({ question: q, history: Array.isArray(req.body?.history) ? req.body.history : [], tools, callTool: (name, args) => call(cid, name, args), side: { person: side.person, company: side.company, other: side.other }, clock: fmtET(D.storyClock()), apiKey: process.env.GEMINI_API_KEY });
    log(cid, 'aviator', [], { question: String(q || '').slice(0, 300) }, out.ok ? `Answered from ${out.tools_called.length} tool call(s)` : out.message, []);
    res.status(out.ok ? 200 : out.status).json(out);
  } catch (e) { console.error(e); res.status(500).json({ ok: false, message: 'Aviator failed.' }); }
});
app.get('/openapi.json', (req, res) => { const f = new URL('../openapi/openapi.json', import.meta.url); if (existsSync(f)) res.type('json').send(readFileSync(f)); else res.status(404).send('Not built'); });
app.get('/admin/:token', (req, res) => { const cid = cidOf(req, res); if (cid) res.type('html').send(adminPage(adminData(cid, req.params.token))); });
app.post('/admin/:token/scopes', (req, res) => {
  const cid = cidOf(req, res); if (!cid) return;
  db.prepare('UPDATE connections SET scopes = ?, configured_at = ? WHERE id = ?').run(JSON.stringify(SIDE[cid].scopes.filter((s) => req.body[s] === 'on')), new Date().toISOString(), cid);
  res.redirect(`/admin/${req.params.token}`);
});
app.post('/admin/:token/clear-log', (req, res) => { const cid = cidOf(req, res); if (!cid) return; db.prepare('DELETE FROM access_log WHERE connection_id = ?').run(cid); res.redirect(`/admin/${req.params.token}`); });
// A person decides each proposal here. Approval appends the record it describes; a reset returns both companies to baseline.
app.post('/admin/:token/proposals/:id/:decision', (req, res) => {
  const cid = cidOf(req, res); if (!cid) return; if (!WRITES) return res.status(403).send('Writes are off in this release');
  decide(cid, req.params.id, req.params.decision === 'approve' ? 'approve' : 'reject'); res.redirect(`/admin/${req.params.token}`);
});
app.post('/admin/:token/reset', (req, res) => {
  const cid = cidOf(req, res); if (!cid) return;
  db.prepare('DELETE FROM events WHERE id > ?').run(BASELINE_EVENT); db.prepare('DELETE FROM proposals').run(); db.prepare('DELETE FROM access_log').run(); db.prepare('DELETE FROM rule_replays').run();
  db.prepare("UPDATE draft_rules SET state = 'Draft'").run();
  for (const c of [AS, NF]) db.prepare('UPDATE connections SET scopes = ? WHERE id = ?').run(JSON.stringify(SIDE[c].scopes), c);
  res.redirect(`/admin/${req.params.token}`);
});

if (process.env.NO_LISTEN !== '1') app.listen(PORT, () => console.log(`Trading Grid demo MCP server on ${BASE} · Ashby ${BASE}/mcp/<MCP_TOKEN> · Northfield ${BASE}/mcp/<NF_TOKEN> · writes ${WRITES ? 'on' : 'off'}`));
