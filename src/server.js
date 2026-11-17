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
import { TOOLS, BOUNDARY, SCOPES, ASHBY_WRITES, ASHBY_REFUSALS, NF_TOOLS, NF_WRITES, NF_REFUSALS, NF_SCOPES, ASHBY_PRIVATE, refusalText } from './tools.js';
import { recordPage, documentPage, adminPage, homePage, nfOrderPage } from './pages.js';
import * as Aviator from './aviator.js';
import * as Scout from './scout.js';
import * as Watch from './watch.js';
import * as Match from './match.js';
import { runtimeTools } from './runtime.js';
import { Claim } from './claim.js';
import { Review } from './review.js';
import { Pace } from './pace.js';
import { Shelf } from './shelf.js';
import { Chase } from './chase.js';
import * as G from './governance.js';
import { JOBS } from './agents.js';

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
const BASELINE_RULES = db.prepare('SELECT id, statement, params FROM rules').all(); const BASELINE_VERSIONS = db.prepare('SELECT rule_id, valid_from, statement, params FROM rule_versions').all();
const AS = 'ashby-assistant', NF = 'northfield-assistant';
const BY_TOKEN = { [TOKEN]: AS, [NF_TOKEN]: NF };
// AVIATOR_TOKEN opens Aviator only (read tools through the model), never MCP, REST or admin: <token>-ashby or <token>-northfield.
const AV = process.env.AVIATOR_TOKEN || '';
const BY_AVIATOR = AV ? { [`${AV}-ashby`]: AS, [`${AV}-northfield`]: NF } : {};
const aviatorCid = (req, res) => { const c = BY_TOKEN[req.params.token] || BY_AVIATOR[req.params.token]; if (!c) { res.status(404).send('Not found'); return null; } return c; };
const OTHER = { [AS]: NF, [NF]: AS };
const SIDE = {
  [AS]: { party: 'ASHBY', person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer', notAvailable: D.NOT_AVAILABLE, scopes: SCOPES, sqlDb: () => ashbyDb, records: 'records', privateTables: ASHBY_PRIVATE.tables, privateWhat: ASHBY_PRIVATE.what },
  [NF]: { party: 'NORTHFIELD', person: 'Jordan Ellis', company: 'Northfield Retailer', other: 'Ashby Supplier', notAvailable: NR.NOT_AVAILABLE_NF, scopes: NF_SCOPES, sqlDb: () => nfDb, records: 'records/northfield', privateTables: /\b(warehouse_orders)\b/i, privateWhat: 'a supplier’s warehouse, ERP, carrier and agent records' },
};
const conn = (id) => { const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(id); return { ...c, scopes: JSON.parse(c.scopes) }; };
function linkify(obj, side) {
  const walk = (v) => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = (k === 'link' && typeof x === 'string') ? (x ? `${BASE}/${side.records}/${x}` : null) : walk(x); return o; } return v; };
  return walk(obj);
}
const refsOf = (obj) => { const out = new Set(); const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (['po', 'reference', 'case', 'record', 'invoice', 'proposal'].includes(k) && typeof x === 'string') out.add(x); walk(x); } }; walk(obj); return [...out].slice(0, 50); };
/** Every call is logged. A write also carries `w`: the agent or person who proposed it, the authority it ran under
 *  (rule id and mode: suggest, approve, policy, or person when a person acted directly), who approved and the outcome (T2.3 story 1). */
function log(cid, tool, scopesUsed, args, result, records, w) {
  db.prepare('INSERT INTO access_log (at, connection_id, user_name, tool, scopes_used, arguments, result, records, agent, authority_rule, authority_mode, approver, outcome) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(new Date().toISOString(), cid, conn(cid).user_name, tool, JSON.stringify(scopesUsed), JSON.stringify(args || {}), result, JSON.stringify(records || []),
    w ? w.agent : null, w ? w.rule || null : null, w ? w.mode : null, w ? w.approver : null, w ? w.outcome || result : null);
}
/** A write that lands in a shared record is logged on the other company's connection too, with the same attribution. */
const logOther = (cid, tool, what, records, w) => log(OTHER[cid], `counterparty:${tool}`, [], { by: SIDE[cid].company }, what, records, w && { ...w, outcome: what });
const assistantOf = (cid) => `${SIDE[cid].person}’s assistant`;
/** Attribution for a refused or invalid write: nothing was recorded, and the log says so. */
const refusedW = (cid, rule, outcome) => ({ agent: assistantOf(cid), rule, mode: 'approve', approver: 'None: nothing was recorded', outcome });
const refuse = (cid, tool, args, what) => { const side = SIDE[cid]; log(cid, tool, [], args, side.notAvailable, [], WRITE_NAMES.has(tool) ? refusedW(cid, null, side.notAvailable) : undefined); return { result: side.notAvailable, message: refusalText(side.notAvailable, what, side.other) }; };

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
function propose(cid, kind, rule, action, target, payload, by = assistantOf(cid)) {
  const id = `PR-${String(db.prepare('SELECT count(*) n FROM proposals').get().n + 1).padStart(4, '0')}`; const side = SIDE[cid];
  db.prepare('INSERT INTO proposals (id, connection_id, kind, approver, rule_id, created_at, created_by, action, target, payload, state, authority_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, cid, kind, side.person, rule || null, new Date().toISOString(), by, action, target || '', JSON.stringify(payload), 'Awaiting approval', 'approve');
  log(cid, kind === 'change' ? 'request_change' : ({ dispute: 'submit_dispute', release: 'release_ship_notice', decision: 'decide_charge', publish: 'publish_rule' })[kind], [], payload, 'Proposal recorded', [id, target].filter(Boolean),
    { agent: by, rule, mode: 'approve', approver: `${side.person} (awaiting)`, outcome: `Proposal ${id} awaiting approval` });
  return { result: 'Proposal recorded', proposal: id, state: 'Awaiting approval', approver: side.person, rule: rule ? D.rule(db, rule) : null, message: `Nothing has left ${side.company}. ${side.person} approves or rejects this proposal in Trading Grid.`, approve_at: `${BASE}/admin/<token>` };
}

/** Writes. Each follows the rule catalogue: an agent drafts, a person approves, with AP-4.1's exception. */
function write(cid, name, args) {
  if (!WRITES) { log(cid, name, [], args, 'Action not available', [], refusedW(cid, null, 'Action not available: writes are off')); return { result: 'Action not available', message: 'This connection is read-only. Complete and approve the action in Trading Grid.' }; }
  if (cid === AS && name === 'submit_dispute') {
    const c = D.deductionCase(db, args.case || '', D.asOfDate(args.as_of)); if (!c.found) { const r = c.not_available ? D.NOT_AVAILABLE : 'Invalid request'; log(cid, name, [], args, r, [], refusedW(cid, 'AP-4.1', r)); return c; }
    const charge = (args.charge || c.charge).toUpperCase(); const amount = charge === c.charge ? (c.dispute_amount ?? c.amount) : Math.abs((c.other_charges_on_this_order.find((x) => /CI-NF/.test(x.reference || '')) || {}).amount || 0);
    const done = db.prepare("SELECT 1 FROM events WHERE kind = 'case.dispute' AND json_extract(data,'$.case') = ? AND json_extract(data,'$.charge') = ?").get(c.case, charge);
    if (done) { log(cid, name, [], args, 'Invalid request', [c.case], refusedW(cid, 'NF-7.3', 'Invalid request: already disputed')); return { result: 'Invalid request', message: `${charge} in ${c.case} is already disputed. NF-7.3 allows one dispute per deduction.` }; }
    const st = Object.fromEntries(c.evidence.map((e) => [e.kind, e.state]));
    const onHand = st['carrier.bill_of_lading'] === 'In the case' && st['carrier.delivery_receipt'] === 'In the case' && (st['wms.load_scan'] === 'In the case' || st['wms.load_tally'] === 'In the case');
    const limit = D.param(db, 'AP-4.1', 'max_amount'); const evidence = args.evidence && args.evidence.length ? args.evidence : c.evidence.filter((e) => e.state !== 'Not found').map((e) => e.evidence);
    // While Claim Agent is paused nothing is disputed without asking: the dispute becomes a proposal Priya approves.
    const claimPaused = G.isPaused(db, 'Claim Agent');
    if (G.mayActWithoutAsking(db, 'Claim Agent', onHand && amount < limit)) {
      const w = { agent: 'Claim Agent', rule: 'AP-4.1', mode: 'policy', approver: 'Standing policy AP-4.1, set by Priya Raman', outcome: 'Dispute submitted' };
      const at = writeAt(c.po, args.as_of); addEvent(at, 'case.dispute', c.po, 'ASHBY', { case: c.case, charge, amount, evidence, drafted_by: 'Claim Agent', approved_by: 'Standing rule AP-4.1, set by Priya Raman', without_asking: true, authority: { rule: 'AP-4.1', mode: 'policy' }, outcome: 'Dispute submitted' });
      log(cid, name, ['deductions'], args, 'Dispute submitted under AP-4.1', [c.case], w); logOther(cid, name, `Dispute received on ${charge} in ${c.case}`, [c.case], w);
      return { result: 'Dispute submitted', case: c.case, charge, amount, at: fmtET(at), evidence, authority: `Claim Agent submitted without asking: the NF-7.4 evidence is in the case and $${amount.toFixed(2)} is under $${limit} (AP-4.1)`, rule: D.rule(db, 'AP-4.1') };
    }
    return propose(cid, 'dispute', 'AP-4.1', `Dispute ${charge} in ${c.case}`, c.case, { case: c.case, po: c.po, charge, amount, evidence, as_of: args.as_of || null, why_not_automatic: claimPaused ? 'Claim Agent is paused' : !onHand ? 'The NF-7.4 evidence is not all in the case' : `$${amount.toFixed(2)} is not under $${limit}` }, claimPaused ? assistantOf(cid) : 'Claim Agent');
  }
  if (cid === AS && name === 'release_ship_notice') return propose(cid, 'release', 'AP-1.3', `Release held ship notice ${args.document}`, args.document, args);
  if (cid === NF && name === 'decide_charge') {
    const c = NR.caseNF(db, args.case || '', D.asOfDate(args.as_of)); if (!c.found) { log(cid, name, [], args, 'Invalid request', [], refusedW(cid, 'NF-7.7', 'Invalid request')); return c; }
    const charge = args.charge.toUpperCase(); const disputed = c.disputes.some((d) => d.charge === charge); const decided = c.decisions.some((d) => d.charge === charge);
    if (!disputed || decided) { log(cid, name, [], args, 'Invalid request', [c.case], refusedW(cid, 'NF-7.7', 'Invalid request')); return { result: 'Invalid request', message: decided ? `${charge} in ${c.case} is already decided` : `${charge} in ${c.case} has not been disputed` }; }
    const rec = !G.isPaused(db, 'Review Agent') && c.review_agent && c.review_agent.charge === charge ? c.review_agent.next_step : null;
    return propose(cid, 'decision', 'NF-7.7', `${args.decision} ${charge} in ${c.case}`, c.case, { case: c.case, po: c.po, charge, decision: args.decision, reason: args.reason || null, review_agent: rec, as_of: args.as_of || null });
  }
  if (cid === NF && name === 'publish_rule') {
    const id = String(args.draft || '').toUpperCase(); const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(id);
    if (!d) { log(cid, name, [], args, 'Invalid request', [], refusedW(cid, null, 'Invalid request')); return { result: 'Invalid request', message: `No draft rule ${args.draft}` }; }
    if (d.state !== 'Draft') { log(cid, name, [], args, 'Invalid request', [id], refusedW(cid, null, 'Invalid request')); return { result: 'Invalid request', message: d.in_force_from ? `${id} is already published and goes into force on ${fmtET(d.in_force_from).slice(0, 10)}` : `${id} is already ${d.state.toLowerCase()}` }; }
    if (!db.prepare('SELECT 1 FROM rule_replays WHERE draft_id = ?').get(id)) { log(cid, name, [], args, 'Refused: replay first', [id], refusedW(cid, null, 'Refused: replay first')); return { result: 'Refused', message: `${id} has not been replayed against the quarter. Call replay_draft_rule with draft ${id} first; a rule is published only after a replay.` }; }
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
    // A paused agent proposes nothing: its event arrives as a plain task (R15, T2.3 story 2). Enforced here, not by the client.
    if (name === 'recommend_next_step' && out && out.found !== false && G.isPaused(db, G.agentOfJob(args.job))) out = G.plainTask(db, out, G.agentOfJob(args.job));
    if (name === 'three_way_match' && out && out.found && G.isPaused(db, 'Match Agent')) out = { ...out, next_step: null, agent_state: 'Paused', task: 'Match Agent is paused; work this variance by hand' };
    if (name === 'review_deduction_case' && out && out.found && G.isPaused(db, 'Review Agent')) out = { ...out, review_agent: { agent_state: 'Paused', proposal: null, task: `Review ${out.case} by hand`, message: 'Review Agent is paused, so the case arrives with no recommendation.' } };
    if (tool.records_replay && out && out.found && out.draft) db.prepare('INSERT INTO rule_replays (draft_id, at, by_connection, result) VALUES (?,?,?,?)').run(out.draft.id, new Date().toISOString(), cid, JSON.stringify({ failing_with_draft: out.failing_with_draft, added_exposure: out.added_exposure }));
    const result = out && out.not_available ? side.notAvailable : 'Answered';
    const body = linkify(cid === AS ? mask(out, has) : out, side); body.read_at = new Date().toISOString();
    log(cid, name, [...tool.required, ...tool.optional.filter(has)], args, result, refsOf(out));
    return body;
  }
  if (cid === AS && name === 'compare_with_other_suppliers') { log(cid, name, [], args, D.NOT_AVAILABLE, []); return { result: D.NOT_AVAILABLE, message: 'Other suppliers’ records are not available on Ashby’s connection.' }; }
  if (cid === AS && name === 'read_retailer_records') return refuse(cid, name, args, ASHBY_PRIVATE.what);
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
    return { connection: cid, configured_by: conn(cid).configured_by, scopes: conn(cid).scopes, writes: WRITES ? 'Proposals a person approves' : 'Read only', agents: G.agentsOf(db, cid),
      calls: rows.map((r) => ({ at: r.at, user: r.user_name, tool: r.tool, scopes: JSON.parse(r.scopes_used), arguments: JSON.parse(r.arguments), result: r.result, records: JSON.parse(r.records),
        ...(r.agent ? { write: { agent: r.agent, authority: { rule: r.authority_rule, mode: r.authority_mode }, approver: r.approver, outcome: r.outcome } } : {}) })) };
  }
  // Governance (T2.3): pause and resume an agent, trial a changed agent rule, read the change list.
  // An assistant may pause an agent (the safe direction) but never resume one: resuming hands authority back, so only a person on the admin page does it.
  if (name === 'resume_agent') {
    // P21: a person resumes a paused agent on the admin screen. Recorded on the change list with who resumed it; the agent works new events again.
    const r = G.setAgentState(db, cid, { agent: args.agent, state: 'active', by: side.person, reason: args.reason });
    log(cid, name, [], args, r.result, r.change ? [r.change] : [], { agent: assistantOf(cid), rule: null, mode: 'person', approver: r.result === 'Agent resumed' ? side.person : 'None', outcome: r.result === 'Invalid request' ? r.message : `${r.agent} ${r.state.toLowerCase()}` });
    return r;
  }
  if (name === 'pause_agent') {
    const r = G.setAgentState(db, cid, { agent: args.agent, state: 'paused', by: assistantOf(cid), reason: args.reason });
    log(cid, name, [], args, r.result, r.change ? [r.change] : [], { agent: assistantOf(cid), rule: null, mode: 'person', approver: `${side.person} (asked in the assistant)`, outcome: r.result === 'Invalid request' ? r.message : `${r.agent} ${r.state.toLowerCase()}` });
    return r;
  }
  if (name === 'replay_agent_rule' && cid === AS) {
    const r = G.trialAgentRule(db, ashbyDb, cid, args, assistantOf(cid));
    log(cid, name, [], args, r.result, r.trial ? [r.trial] : [], { agent: assistantOf(cid), rule: r.change?.rule || null, mode: 'person', approver: 'None needed: a trial publishes nothing', outcome: r.trial ? `Trial ${r.trial}: ${r.drift_measure}` : r.message });
    return r;
  }
  // P21 Admin and rules: rules by source, a supplier's own rule changed with its effect shown first, an agent action's approval mode.
  if (name === 'list_rules_by_source') { const r = G.rulesBySource(db, cid === AS ? db : nfDb, cid); log(cid, name, [], args, 'Answered', []); return r; }
  if (name === 'update_supplier_rule') {
    const r = G.updateSupplierRule(db, cid, args, side.person);
    log(cid, name, [], args, r.result, r.change ? [r.change] : [], { agent: assistantOf(cid), rule: r.rule || null, mode: 'person', approver: r.result === 'Rule changed' ? `${side.person} (asked in the assistant)` : 'None: nothing saved', outcome: r.result === 'Rule changed' ? `${r.rule} ${JSON.stringify(r.from)} to ${JSON.stringify(r.to)}` : r.message || r.result });
    return r;
  }
  if (name === 'set_agent_mode') {
    const r = G.setAgentMode(db, cid, args, AGENT_ACTIONS, side.person);
    log(cid, name, [], args, r.result, r.change ? [r.change] : [], { agent: assistantOf(cid), rule: null, mode: 'person', approver: r.result === 'Mode changed' ? `${side.person} (asked in the assistant)` : 'None', outcome: r.result === 'Mode changed' ? `${r.agent} ${r.action}: ${r.from} to ${r.to}` : r.message || r.result });
    return r;
  }
  if (name === 'get_change_list') { const r = G.changeList(db, cid, { limit: args.limit || 50, kind: args.kind }); log(cid, name, [], args, 'Answered', r.entries.map((e) => e.id).slice(0, 50)); return r; }
  return { result: 'Invalid request', error: `Unknown tool ${name}` };
}

/** A person decides a proposal in Trading Grid. Approval appends the record it describes. */
/** decision: approve, reject, or edit (Edit suggestion, R15): the person sets the proposal aside and does the case by hand; nothing is appended. */
export function decide(cid, id, decision, note) {
  const p = db.prepare("SELECT * FROM proposals WHERE id = ? AND state = 'Awaiting approval'").get(id); if (!p || p.connection_id !== cid) return null;
  const side = SIDE[cid]; const a = JSON.parse(p.payload); let eventId = null; const now = new Date().toISOString();
  const w = { agent: p.created_by, rule: p.rule_id, mode: p.authority_mode || 'approve', approver: side.person };
  const auth = { rule: p.rule_id, mode: p.authority_mode || 'approve' };
  if (decision === 'approve') {
    if (p.kind === 'dispute') { eventId = addEvent(writeAt(a.po, a.as_of), 'case.dispute', a.po, 'ASHBY', { case: a.case, charge: a.charge, amount: a.amount, evidence: a.evidence, drafted_by: p.created_by, approved_by: 'Priya Raman', authority: auth, outcome: 'Dispute submitted', proposal: p.id }); logOther(cid, 'submit_dispute', `Dispute received on ${a.charge} in ${a.case}`, [a.case], w); }
    else if (p.kind === 'decision') { const c = NR.caseNF(db, a.case, D.asOfDate('2027-01-06')); const amt = c.charge === 'PROMO' ? c.disputes.filter((d) => d.charge === a.charge).at(-1)?.amount : (c.withheld.find((w) => (a.charge === c.charge ? w.reference === c.deduction : /CI-NF/.test(w.reference))) || {}).amount;
      eventId = addEvent(writeAt(a.po, a.as_of), 'case.decision', a.po, 'NORTHFIELD', { case: a.case, charge: a.charge, amount: amt ? Math.abs(amt) : null, decision: a.decision, decided_by: 'Jordan Ellis', drafted_by: p.created_by, review_agent_recommended: a.review_agent, reason: a.reason, authority: auth, outcome: a.decision, proposal: p.id }); logOther(cid, 'decide_charge', `${a.charge} in ${a.case} ${a.decision} by Jordan Ellis`, [a.case], w); }
    else if (p.kind === 'publish') { const d = db.prepare('SELECT * FROM draft_rules WHERE id = ?').get(a.draft); db.prepare("UPDATE draft_rules SET state = 'Published' WHERE id = ?").run(a.draft); eventId = addEvent(writeAt(null, null), 'rule.published', null, 'NORTHFIELD', { draft: a.draft, statement: d.statement, published_by: 'Jordan Ellis', replayed: true, drafted_by: p.created_by, authority: auth, proposal: p.id }); logOther(cid, 'publish_rule', `Rule ${a.draft} published by Northfield`, [a.draft], w); }
    else if (p.kind === 'release') { eventId = addEvent(writeAt(a.po ? D.normPo(a.po) : null, null), 'tg.release', a.po ? D.normPo(a.po) : null, 'ASHBY', { document: a.document, released_by: 'Priya Raman', rule: 'AP-1.3', drafted_by: p.created_by, authority: auth, proposal: p.id }); }
    else eventId = addEvent(now, 'proposal.approved', /^NR-/.test(p.target) ? p.target : null, side.party, { proposal: p.id, action: p.action, target: p.target, proposed_by: p.created_by, approved_by: side.person });
  }
  const state = decision === 'approve' ? 'Approved' : decision === 'edit' ? 'Taken over' : 'Rejected';
  const outcome = decision === 'approve' ? `Approved; ${eventId ? `record ${eventId} appended` : 'nothing appended'}` : decision === 'edit' ? `Taken over by ${side.person}; done by hand${note ? `: ${note}` : ''}` : 'Rejected; nothing sent';
  db.prepare('UPDATE proposals SET state = ?, decided_by = ?, decided_at = ?, result_event = ?, note = ? WHERE id = ?').run(state, side.person, now, eventId, decision === 'edit' ? note || null : null, p.id);
  log(cid, `${decision}_proposal`, [], { proposal: p.id, ...(note ? { note } : {}) }, state, [p.id, p.target], { ...w, outcome });
  return p.id;
}

const SQL_TOOL = { name: 'run_readonly_sql', title: 'Read-only SQL over Ashby records', description: 'One SELECT over a copy holding only Ashby Supplier’s records. Tables: orders(po, stream, ship_to, received_at, requested_delivery, order_value, accepted_value), order_lines, order_changes, documents(doc_id, reference, po, doc_type, name, sender_id, receiver_id, partner_id, sent_at, status, answers_doc_id, body JSON, raw X12), errors(doc_id, reported_by, channel, cause, field, sent_value, rule_id, status, corrected_by), shipments, shipment_lines, cartons(sscc, shipment_id, po, line, received), receipts, invoices, invoice_lines, remittance_items, adjustments, warehouse_orders, store_activity, events(at, kind, po, system, channel, data JSON), rules(id, owner, implements, params, statement, ...), items, locations, parties, calendar. Baseline records, without writes made on the connection. Times are ISO UTC. At most 200 rows.', input: { sql: z.string().describe('A single SELECT or WITH query') } };
const NF_SQL_TOOL = { name: 'run_readonly_sql', title: 'Read-only SQL over Northfield records', description: 'One SELECT over a copy holding Northfield Retailer’s records: every supplier’s orders, order lines and changes, exchanged documents (no 940 or 945), errors, shipments and cartons from ship notices, receipts, invoices, remittances and adjustments, store activity, Northfield’s own events, deduction cases, review_notes, draft_rules, rules (Northfield, industry and law). Baseline records, without writes made on the connection. Times are ISO UTC. At most 200 rows.', input: { sql: z.string().describe('A single SELECT or WITH query') } };
const LOG_TOOL = { name: 'get_access_log', title: 'Access log', description: 'Every call made on this connection, and writes the other company made into shared records: time, user, tool, scopes used, arguments, result and records returned. Newest first.', input: { limit: z.number().int().min(1).max(200).optional() } };
export const ALL_TOOLS = [...TOOLS, ...BOUNDARY, ...ASHBY_WRITES, ...ASHBY_REFUSALS, SQL_TOOL, LOG_TOOL];
export const ALL_NF_TOOLS = [...NF_TOOLS, ...NF_WRITES, ...NF_REFUSALS, NF_SQL_TOOL, LOG_TOOL];
const WRITE_NAMES = new Set(['request_change', 'submit_dispute', 'release_ship_notice', 'decide_charge', 'publish_rule']);
// Governance tools (T2.3). Pause and a trial change no Trading Grid record but do record on the change list, so none is marked read-only.
const agentNames = (cid) => Object.keys(G.AGENTS).filter((a) => G.AGENTS[a].connection === cid).join(', ');
const GOV = (cid) => [
  { name: 'pause_agent', title: 'Pause an agent', write: true, description: `Pauses one of ${SIDE[cid].company}’s agents (${agentNames(cid)}). While paused the agent proposes nothing: each event it would work arrives as a plain task with no proposal${cid === AS ? ', Claim Agent disputes nothing without asking, and Scout gets no model turn' : ''}. Recorded on the change list with who paused it and why. Only call this when the user asks.`, input: { agent: z.string().describe(`Agent name: ${agentNames(cid)}`), reason: z.string().optional() } },
  { name: 'resume_agent', title: 'Resume a paused agent', write: true, description: `Resumes one of ${SIDE[cid].company}’s paused agents (${agentNames(cid)}) for the person on the admin screen; it works new events again under its rules and its approval modes. Recorded on the change list with who resumed it. Only call this when the user has decided.`, input: { agent: z.string().describe(`Agent name: ${agentNames(cid)}`), reason: z.string().optional() } },
  ...(cid === AS ? [{ name: 'replay_agent_rule', title: 'Trial a changed agent rule', write: true, description: 'Replays a change to one of Ashby’s agent rules (a parameter the catalogue holds, for example AP-4.1 max_amount 50) over records beside the rule in force, lists every record whose next step or authority differs, and records the trial on the change list with who ran it, the drift measure and the rollback path. Nothing is published and the catalogue is unchanged. Deduction cases default to every case of the quarter up to as_of.',
    input: { job: z.enum(Object.keys(JOBS)).describe('Agent job, for example deduction (Claim Agent)'), rule: z.string().describe('Ashby rule id, for example AP-4.1'), params: z.record(z.number()).describe('Parameters to change, for example {"max_amount": 50}'), records: z.array(z.string()).optional().describe('Records to replay; deduction defaults to the quarter’s cases'), as_of: z.string().optional() } }] : []),
  { name: 'get_change_list', title: 'Agent change list', description: 'Each agent with its state (Active or Paused) and authority limit, and the change list newest first: every pause, resume, trial of a changed agent rule, rule change and approval-mode change, with what changed, the result, who did it and when.', input: { limit: z.number().int().min(1).max(200).optional(), kind: z.enum(['pause', 'resume', 'trial', 'rule_change', 'mode']).optional() } },
  { name: 'list_rules_by_source', title: 'Rules by source', description: `Every rule ${SIDE[cid].company} trades under, grouped by where it comes from: the Supplier ERP, Ashby's manual rules, Northfield's guide, and standards and law. Each with who created it and when, its parameters, its last change and whether ${SIDE[cid].company} may edit it here. Changes nothing.`, input: {} },
  ...(cid === AS ? [{ name: 'update_supplier_rule', title: 'Change one of Ashby’s own rules', write: true, description: 'Changes a parameter of one of Ashby’s manual rules (for example AP-4.1 max_amount 150, AP-6.4 carton 40, AP-7.2 hours 48). Without apply it shows which open work the change touches and saves nothing; with apply true it saves the change in the catalogue the agents read, records it on the change list with who made it, and every agent uses it on its next run. Northfield’s guide and standards are read-only. Only call with apply true when the user has decided.',
    input: { rule: z.string().describe('Ashby rule id, for example AP-4.1'), params: z.record(z.number()).describe('Parameters to change, for example {"max_amount": 150}'), apply: z.boolean().optional().describe('true saves the change; omitted shows its effect only'), records: z.array(z.string()).optional(), as_of: z.string().optional() } }] : []),
  { name: 'set_agent_mode', title: 'Set an agent action’s approval mode', write: true, description: `Sets the standing approval mode of one action of one of ${SIDE[cid].company}’s agents (${agentNames(cid)}) for Northfield Retailer: suggest (the agent only suggests), approve (${SIDE[cid].person} approves each), or policy (it runs under the standing policy). Only actions ${SIDE[cid].person} may change; locked actions and guardrails stay. Recorded on the change list; the agent uses it on its next run. Only call this when the user has decided.`,
    input: { agent: z.string().describe(`Agent name: ${agentNames(cid)}`), action: z.string().describe('Action name, as the agent’s setup tool lists it'), mode: z.enum(['suggest', 'approve', 'policy']), retailer: z.string().optional() } },
];
export const GOV_TOOLS = { [AS]: GOV(AS), [NF]: GOV(NF) };

const INSTRUCTIONS = {
  [AS]: () => ['This is Ashby Supplier’s connection to Trading Grid, the B2B network Ashby uses to trade with Northfield Retailer. All data is fictional.',
    'It holds one quarter of trade, 27 September to 26 December 2026, with settlement to 9 January 2027. Times are US Eastern.',
    'Questions about "now" are answered as of the story clock, Tuesday 17 November 2026 11:00 Eastern, unless you pass as_of. get_story_calendar lists other moments.',
    'Find records by PO number, document reference or case id. Answer only from tool results and cite each record with its link.',
    'Keep a technical acknowledgment (997) separate from business acceptance: Northfield sends no business acceptance.',
    WRITES ? 'Writes follow Ashby’s rules: submit_dispute, release_ship_notice and request_change record proposals Priya Raman approves in Trading Grid; only AP-4.1 lets Claim Agent dispute without asking. Ship notice release always stays with a person (AP-1.3).' : 'Nothing on this connection creates, changes or sends a Trading Grid record. For any action, call request_change and give the user its Trading Grid link.',
    'Records of other suppliers are not available, and Northfield’s payables, draft rules and reviewer notes are Northfield’s: say "Not available to Ashby".'].join(' '),
  [NF]: () => ['This is Northfield Retailer’s connection to Trading Grid for Jordan Ellis’s own assistant. All data is fictional.',
    'It holds the same quarter of trade as its suppliers see, 27 September to 26 December 2026, settlement to 9 January 2027. Times are US Eastern; the default as_of is Tuesday 17 November 2026 11:00 Eastern.',
    'Documents exchanged with suppliers are shared: both sides see the same X12. A supplier’s ERP, warehouse, carrier and agent records are the supplier’s: say "Not available to Northfield" unless the supplier shared them into a case.',
    WRITES ? 'Writes follow Northfield’s guide: decide_charge, publish_rule and request_change record proposals Jordan Ellis approves in Trading Grid. Jordan decides every charge (NF-7.7). A rule is published only after replay_draft_rule.' : 'This connection is read-only.',
    'Answer only from tool results and cite each record with its link.'].join(' '),
};
// ---------- Scout (P5): a server-side agent working in an isolated session branched from the recorded world ----------
const scoutModel = () => process.env.LOCAL_TEST_SCRIPTED_SCOUT ? Scout.scriptedCaller() : Scout.geminiCaller(Aviator.modelRoutes());
const FACTS_IN = z.object({ carton_condition: z.enum(['crushed', 'good']), carton_contents: z.enum(['damaged', 'intact']), carton_label: z.enum(['readable', 'unreadable']), free_cases: z.number().int(), staging_minutes: z.number().int() }).partial().optional().describe('Facts at Kinross to branch with, on top of the preset: carton_condition, carton_contents, carton_label, free_cases, staging_minutes. scout_setup lists them with their recorded values.');
const POLICY_IN = z.record(z.enum(['suggest', 'approve', 'policy'])).optional().describe('Approval mode per action for this run, for actions Priya Raman may change (scout_setup lists them). Locked actions keep their mode.');
const branchWith = (variation, facts) => ({ ...Scout.VARIATIONS[variation || 'canonical'], ...Scout.factsToVariation(facts || {}) });
const VAR = z.enum(Object.keys(Scout.VARIATIONS)).optional().describe(`Physical state at Kinross to branch with: ${Object.keys(Scout.VARIATIONS).join(', ')}. Default canonical.`);
export const scoutView = (sess, extra = {}) => sess ? ({ session: sess.id, label: sess.label, clock: fmtET(new Date(sess.clock)), status: sess.agent.status, ...scoutGov(sess), variation: sess.changes, awaiting: sess.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, po: p.po, action: p.action, does: Scout.ACTIONS[p.action].label, args: p.args, proposed_by: p.by, rationale: p.rationale, alternatives: p.alternatives, rule: Scout.ACTIONS[p.action].rule })), queue: Scout.queueView(sess), tasks: sess.tasks, proposals: sess.proposals.map((p) => ({ id: p.id, po: p.po, action: p.action, args: p.args, by: p.by, state: p.state, needs: p.needs, approved_by: p.approved_by || null, taken_over_by: p.taken_over_by || null, result: p.result?.response || null, at: p.at })), ship_notice: sess.asn, receipt: sess.receipt || null, load: { loaded: sess.load.base_loaded + sess.load.loaded.length, of: sess.load.expected, staged: sess.load.staged, sealed: sess.load.sealed }, outcome: Scout.outcome(sess), trace: sess.trace, overhead: { model_calls: sess.agent.calls, tool_calls: sess.agent.tool_calls, ms: sess.agent.ms, model_routes: sess.agent.routes || {} }, ...extra }) : { result: 'Invalid request', error: 'No such session; sessions live in memory and end when the server restarts.' };
// Governance (T2.3): Scout runs only while not paused (checked by the server before every model turn), a person can set a
// proposal aside (Edit suggestion), and every proposal state change is copied into the access log with its attribution.
const scoutPaused = () => G.isPaused(db, 'Scout Agent');
function scoutGov(sess) {
  const g = {};
  if (sess.agent.status === 'paused') { const f = sess.trace.find((t) => t.actor === 'Rule engine')?.detail?.findings || []; g.plain_task = { agent: 'Scout Agent', agent_state: 'Paused', proposal: null, task: 'Kinross load scan for SHP-460207: work the shipment by hand', rule_findings: f, message: 'Scout Agent is paused, so this event arrives as a plain task with no proposal.' }; }
  if (sess.handed_over) g.handed_over = sess.handed_over;
  return g;
}
function drainScout(sessionId) { const sess = Scout.getSession(sessionId); if (!sess) return; for (const a of sess.audit.slice(sess.audited || 0)) log(AS, `scout:${a.action}`, [], { session: a.session, proposal: a.proposal }, a.outcome, [a.session, a.proposal], { agent: a.agent, rule: a.authority_rule, mode: a.authority_mode, approver: a.approver, outcome: a.outcome }); sess.audited = sess.audit.length; }
// A short answer for a caller that reads the full view from /sessions/<id> instead (the recorder does).
const scoutBrief = (v) => v.session ? { session: v.session, status: v.status, clock: v.clock, ...(v.blocked ? { blocked: v.blocked } : {}), awaiting: v.awaiting.map((p) => ({ id: p.id, po: p.po, action: p.action, args: p.args, proposed_by: p.proposed_by })), outcome: { cartons_loaded: v.outcome.cartons_loaded, ship_to_correct: v.outcome.ship_to_correct, receipt_matches_ship_notice: v.outcome.receipt_matches_ship_notice }, model_calls: v.overhead.model_calls } : v;
async function scoutStart({ brief, ...a } = {}) { const v = await scoutStartFull(a); return brief ? scoutBrief(v) : v; }
async function scoutDecide({ brief, ...a }) { const v = await scoutDecideFull(a); return brief ? scoutBrief(v) : v; }
async function scoutStartFull({ variation, facts, policy, label } = {}) { const sess = Scout.startSession(db, { variation: branchWith(variation, facts), policy: withModes('Scout Agent', policy), label: label || 'Operator' }); const run = await Scout.runScout(db, sess, { callModel: scoutModel(), paused: scoutPaused }); drainScout(sess.id); return scoutView(sess, run.ok ? {} : { blocked: run.blocked || run.status }); }
async function scoutDecideFull({ session, proposal, decision, note, choice }) { const sess = Scout.getSession(session); if (!sess) return scoutView(null); const r = await Scout.decideAndResume(db, sess, proposal, decision, 'Priya Raman', { callModel: scoutModel(), paused: scoutPaused, note, choice }); drainScout(sess.id); if (r.state === 'Refused') return { ...r, result: 'Refused' }; return scoutView(sess, r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}); }
async function scoutBaseline({ variation, facts, policy } = {}) { const sess = Scout.startSession(db, { variation: branchWith(variation, facts), policy: policy || {}, label: 'Rule baseline' }); Scout.runBaseline(db, sess); drainScout(sess.id); return scoutView(sess); }
const brief = (tr) => tr.map((t) => `${t.n}. ${t.clock.slice(11, 16)} ${t.actor} [${Scout.TYPES[t.type] || t.type}] ${t.what}${t.detail?.args && Object.keys(t.detail.args).length ? ' ' + JSON.stringify(t.detail.args) : ''}${t.detail?.response ? ' · ' + t.detail.response : ''}${t.detail?.reason ? ' · ' + t.detail.reason : ''}${t.detail?.rationale ? ' · why: ' + t.detail.rationale : ''}${t.detail?.text ? ' · ' + t.detail.text.slice(0, 240) : ''}`);
/** Scout's governance replay, recorded on the change list as a trial (T2.3 story 4): what changed (policy modes, physical variation),
 *  the outcomes under the policy in force and the change, the actions whose authority differs, who ran it and when. */
async function scoutReplay({ variation, facts, detail, policy } = {}, by = assistantOf(AS)) {
  const r = await Scout.replay(db, { variation: branchWith(variation, facts), policy: policy || {}, callModel: scoutModel(), paused: scoutPaused });
  for (const id of [r.baseline.session, r.scout.session, r.policy_trial?.in_force.session]) if (id) drainScout(id);
  const pt = r.policy_trial; const so = r.scout.blocked ? { blocked: r.scout.blocked } : r.scout.outcome;
  const trial = G.recordTrial(db, AS, { agent: 'Scout Agent', rule: pt ? [...new Set(pt.asked.map((a) => a.rule).filter(Boolean))].join(',') || null : null, by,
    change: { policy: pt ? pt.asked : 'Policy in force (no change)', variation: variation || 'canonical' },
    result: { baseline_with_change: r.baseline.outcome, baseline_in_force: pt ? pt.in_force.outcome : r.baseline.outcome, authority_differs: pt ? pt.differs : [], refused_changes: pt ? pt.refused : [], scout: so,
      drift_measure: pt ? `${pt.differs.length} proposal outcomes differ; cartons ${pt.in_force.outcome.cartons_loaded} under the policy in force, ${r.baseline.outcome.cartons_loaded} with the change; approvals ${pt.in_force.outcome.approvals} and ${r.baseline.outcome.approvals}` : 'No change replayed',
      rollback: `Nothing was changed: Scout’s live policy stays ${JSON.stringify(Object.fromEntries(Object.entries(Scout.ACTIONS).map(([k, a]) => [k, a.mode])))}. Sessions are in memory and leave the recorded world unchanged.` } });
  if (detail === 'full') return { ...r, trial };
  return { trial, variation: variation || 'canonical', changes: r.variation, evidence_cutoff: r.evidence_cutoff, ...(pt ? { policy_trial: { asked: pt.asked, refused: pt.refused, authority_differs: pt.differs, in_force: pt.in_force.outcome, with_change: pt.with_change.outcome } } : {}), baseline: { session: r.baseline.session, outcome: r.baseline.outcome, trace: brief(r.baseline.trace) }, scout: r.scout.blocked ? r.scout : { session: r.scout.session, status: r.scout.status, outcome: r.scout.outcome, overhead: r.scout.overhead, trace: brief(r.scout.trace) } }; }
const SCOUT_TOOLS = [
  { name: 'scout_start', title: 'Start Scout on NR-460207', description: 'Branches the demo world at Tuesday 8 December 2026 17:12 ET into an isolated session (later recorded events hidden; nothing reaches the recorded world), lets Scout Agent investigate the Kinross load scan for NR-460207 with its read tools, and returns when Scout waits for Priya Raman, finishes or hits its limit. Returns the session id, proposals awaiting approval and the full trace with who did what. Kinross and Northfield answers in a session are synthetic, from deterministic rules.', input: { variation: VAR, facts: FACTS_IN, policy: POLICY_IN, label: z.string().optional(), brief: z.boolean().optional().describe('Return only the session id, status, proposals awaiting approval and outcome; the full view stays at the session link') }, run: scoutStart },
  { name: 'scout_setup', title: 'Scout setup: facts, approval modes and guardrails', description: 'What can be set before a Scout run on NR-460207: the Kinross facts with their recorded values, each action with its rule, its approval mode and whether Priya Raman may change it, and the administrator guardrails. Changes nothing.', input: {}, run: async () => Scout.setup() },
  { name: 'scout_decide', title: 'Decide a Scout proposal as Priya Raman', description: 'Records Priya Raman’s decision on one proposal in a Scout session: approve, reject, or edit (Edit suggestion: she sets it aside and does the case by hand, recorded with her name). On approval the server executes it (Kinross and Northfield respond by their rules), then Scout continues from the result. An approval cannot be replayed. Only call this when the user has decided.', input: { session: z.string(), proposal: z.string().describe('Proposal id, for example SP-2'), decision: z.enum(['approve', 'reject', 'edit']).describe('approve, reject, or edit: Edit suggestion, where Priya sets the proposal aside and does the case by hand; Scout then stops proposing in this session'), note: z.string().optional().describe('With edit: what Priya does instead'), brief: z.boolean().optional().describe('Return only the session id, status, proposals awaiting approval and outcome') }, run: scoutDecide },
  { name: 'scout_state', title: 'Scout session state and trace', description: 'Current state of a Scout session: clock, load, proposals awaiting approval, outcome so far, trace and agent overhead.', input: { session: z.string() }, run: async ({ session }) => scoutView(Scout.getSession(session)) },
  { name: 'scout_baseline', title: 'Rule baseline on NR-460207', description: 'Runs the deterministic rule baseline on the same branch and variation, with the same reads and actions and a labelled test approver, and returns its outcome and trace.', input: { variation: VAR, facts: FACTS_IN, policy: POLICY_IN }, run: scoutBaseline },
  { name: 'scout_replay', title: 'Governance replay: baseline and Scout side by side', description: 'Runs the rule baseline and Scout on the same branch and variation, approving every proposal as a labelled test approver, and returns both outcomes, one-line traces and Scout’s overhead. Pass detail full for every trace field. Pass policy to trial a changed approval mode for an editable action (for example {"kinross_load": "policy"}): the baseline then also runs under the policy in force and the actions whose authority differs are listed. Every replay is recorded on the change list as a trial (get_change_list). Locked actions (AP-1.3 release, AP-1.4 build, AP-5.1 reserved stock) cannot change. For governance review, not operation.', input: { variation: VAR, detail: z.enum(['brief', 'full']).optional(), policy: z.record(z.enum(['suggest', 'approve', 'policy'])).optional().describe('Action to mode: suggest, approve or policy') }, run: (a) => scoutReplay(a) },
];
// ---------- Watch Agent (P13): a server-side agent on the open-order queue, in an isolated session branched from the recorded world ----------
const watchPaused = () => G.isPaused(db, 'Watch Agent');
const WFACTS_IN = z.object({ moment: z.enum(Object.keys(Watch.MOMENTS)), kinross_window_hours: z.number().int(), kinross_reachable: z.enum(['yes', 'no']), departure_scanned_46220: z.enum(['yes', 'no']) }).partial().optional()
  .describe('Facts to branch with, on top of the preset: moment (story moment), kinross_window_hours (Priya’s rule: 24 or 48), kinross_reachable, departure_scanned_46220. watch_setup lists them with their recorded values.');
const WVAR = z.enum(Object.keys(Watch.VARIATIONS)).optional().describe(`Preset to branch with: ${Object.keys(Watch.VARIATIONS).join(', ')}. Default canonical (Priya has set the Kinross window to 24 hours).`);
const WPOLICY_IN = z.record(z.enum(['suggest', 'approve', 'policy'])).optional().describe('Approval mode per action for this run, for actions Priya Raman may change (watch_setup lists them). Locked actions keep their mode.');
const watchBranch = (variation, facts) => ({ ...Watch.VARIATIONS[variation || 'canonical'], ...Watch.factsToVariation(facts || {}) });
function watchGov(sess) {
  const g = {};
  if (sess.agent.status === 'paused') g.plain_task = { agent: 'Watch Agent', agent_state: 'Paused', proposal: null, task: 'Work the open-order queue by hand', queue: Watch.queue(db, sess).rows.map((r) => `${r.po} ${r.document}: ${r.what}`), message: 'Watch Agent is paused, so the queue arrives as plain tasks with no proposal.' };
  if (sess.handed_over) g.handed_over = sess.handed_over;
  return g;
}
export const watchView = (sess, extra = {}) => sess ? ({ session: sess.id, label: sess.label, clock: fmtET(new Date(sess.clock)), branch_at: fmtET(new Date(sess.branch)), status: sess.agent.status, ...watchGov(sess), variation: sess.changes, facts: sess.facts,
  queue: Watch.queue(db, sess), awaiting: sess.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, does: Watch.ACTIONS[p.action].label, args: p.args, ...(p.then ? { then: { action: p.then.action, does: Watch.ACTIONS[p.then.action].label, args: p.then.args } } : {}), proposed_by: p.by, rationale: p.rationale, alternatives: p.alternatives, rule: Watch.ACTIONS[p.action].rule })),
  confirmations_pending: sess.pending.map((p) => ({ at: fmtET(p.at), what: p.doc_type === '997' ? 'Technical acknowledgment (997)' : p.doc_type === '861' ? 'Northfield receiving advice (861)' : p.doc_type === '945' ? 'Kinross shipping advice (945)' : 'Kinross scan', po: p.po })),
  outcome: Watch.outcome(db, sess), trace: sess.trace, overhead: { model_calls: sess.agent.calls, tool_calls: sess.agent.tool_calls, ms: sess.agent.ms, model_routes: sess.agent.routes || {} }, ...extra }) : { result: 'Invalid request', error: 'No such session; sessions live in memory and end when the server restarts.' };
function drainWatch(sessionId) { const sess = Watch.getSession(sessionId); if (!sess) return; for (const a of sess.audit.slice(sess.audited || 0)) log(AS, `watch:${a.action}`, [], { session: a.session, proposal: a.proposal }, a.outcome, [a.session, a.proposal], { agent: a.agent, rule: a.authority_rule, mode: a.authority_mode, approver: a.approver, outcome: a.outcome }); sess.audited = sess.audit.length; }
async function watchStart({ variation, facts, policy, label, run_by } = {}) {
  if (run_by === 'rules') { const sess = Watch.startRules(db, { variation: watchBranch(variation, facts), policy: withModes('Watch Agent', policy), label: label || 'Operator' }); drainWatch(sess.id); return watchView(sess); }
  const sess = Watch.startSession(db, { variation: watchBranch(variation, facts), policy: withModes('Watch Agent', policy), label: label || 'Operator' }); const run = await Watch.runWatch(db, sess, { callModel: scoutModel(), paused: watchPaused }); drainWatch(sess.id); return watchView(sess, run.ok ? {} : { blocked: run.blocked || run.status }); }
async function watchDecide({ session, proposal, decision, note }) { const sess = Watch.getSession(session); if (!sess) return watchView(null); if (sess.by_rules) { const r = Watch.decideRules(db, sess, proposal, decision, 'Priya Raman', note); drainWatch(sess.id); return r.state === 'Refused' ? { ...r, result: 'Refused' } : watchView(sess); } const r = await Watch.decideAndResume(db, sess, proposal, decision, 'Priya Raman', { callModel: scoutModel(), paused: watchPaused, note }); drainWatch(sess.id); if (r.state === 'Refused') return { ...r, result: 'Refused' }; return watchView(sess, r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}); }
async function watchState({ session, advance_minutes } = {}) { const sess = Watch.getSession(session); if (!sess) return watchView(null); if (!advance_minutes) return watchView(sess);
  if (sess.by_rules) { const arrived = Watch.advanceRules(db, sess, { minutes: advance_minutes }); drainWatch(sess.id); return watchView(sess, { arrived }); }
  const r = await Watch.advanceAndResume(db, sess, { minutes: advance_minutes, callModel: scoutModel(), paused: watchPaused }); drainWatch(sess.id); return watchView(sess, { arrived: r.arrived, ...(r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}) }); }
async function watchBaseline({ variation, facts, policy } = {}) { const sess = Watch.startSession(db, { variation: watchBranch(variation, facts), policy: policy || {}, label: 'Rule baseline' }); Watch.runBaseline(db, sess); drainWatch(sess.id); return watchView(sess); }
const wbrief = (tr) => tr.filter((t) => t.type !== 'tool').map((t) => `${t.n}. ${t.clock.slice(11, 16)} ${t.actor} [${Watch.TYPES[t.type] || t.type}] ${t.what}${t.detail?.args && Object.keys(t.detail.args).length ? ' ' + JSON.stringify(t.detail.args) : ''}${t.detail?.response ? ' · ' + t.detail.response : ''}${t.detail?.note ? ' · note: ' + t.detail.note : ''}${t.detail?.reason ? ' · ' + t.detail.reason : ''}${t.detail?.rationale ? ' · why: ' + t.detail.rationale : ''}${t.detail?.text ? ' · ' + t.detail.text.slice(0, 240) : ''}`);
/** Watch Agent's governance replay: baseline and agent on the same branch, recorded on the change list as a trial. */
async function watchReplay({ variation, facts, detail, policy } = {}, by = assistantOf(AS)) {
  const r = await Watch.replay(db, { variation: watchBranch(variation, facts), policy: policy || {}, callModel: scoutModel(), paused: watchPaused });
  for (const id of [r.baseline.session, r.watch.session]) if (id) drainWatch(id);
  const wo = r.watch.blocked ? { blocked: r.watch.blocked } : r.watch.outcome;
  const trial = G.recordTrial(db, AS, { agent: 'Watch Agent', rule: null, by, change: { policy: Object.keys(policy || {}).length ? policy : 'Policy in force (no change)', variation: variation || 'canonical', facts: facts || {} },
    result: { baseline: r.baseline.outcome, watch: wo, automation: r.automation, drift_measure: r.automation ? `${r.automation.same_steps.length} steps the same (automation), ${r.automation.agent_only.length} by the agent only, ${r.automation.baseline_only.length} by the baseline only` : 'Watch Agent did not run; nothing to compare',
      rollback: 'Nothing was changed: sessions are in memory and leave the recorded world unchanged.' } });
  if (detail === 'full') return { ...r, trial };
  return { trial, variation: variation || 'canonical', changes: r.variation, evidence_cutoff: r.evidence_cutoff, baseline: { session: r.baseline.session, outcome: r.baseline.outcome, trace: wbrief(r.baseline.trace) }, watch: r.watch.blocked ? { session: r.watch.session, blocked: r.watch.blocked, trace: wbrief(r.watch.trace) } : { session: r.watch.session, status: r.watch.status, outcome: r.watch.outcome, overhead: r.watch.overhead, trace: wbrief(r.watch.trace) }, automation: r.automation };
}
const WATCH_TOOLS = [
  { name: 'watch_setup', title: 'Watch setup: facts, Priya’s rules, approval modes and guardrails', description: 'What can be set before a Watch Agent run on Ashby’s open Northfield orders: the story moment and Kinross facts with their recorded values, Priya Raman’s editable rules (the Kinross 945 window), each action with its rule, approval mode and whether Priya may change it, the presets, and the administrator guardrails. Changes nothing.', input: {}, run: async () => Watch.setup() },
  { name: 'watch_start', title: 'Start Watch Agent on the open-order queue', description: 'Branches the demo world at Wednesday 18 November 2026 09:00 ET (or another preset moment) into an isolated session (later recorded records hidden; nothing reaches the recorded world), lets Watch Agent read the queue of orders missing a document Northfield requires and investigate each, and returns when it waits for Priya Raman, finishes or hits its limit. Returns the session id, the queue with each row’s state, proposals awaiting approval and the full trace. Kinross answers, 997s and session documents are synthetic.', input: { variation: WVAR, facts: WFACTS_IN, policy: WPOLICY_IN, label: z.string().optional(), run_by: z.enum(['agent', 'rules']).optional().describe('rules: the decision table proposes with no model and no agent, and the Kinross window is read from KX-945 (P13); default agent') }, run: watchStart },
  { name: 'watch_decide', title: 'Decide a Watch Agent proposal as Priya Raman', description: 'Records Priya Raman’s decision on one proposal in a Watch session: approve, reject, or edit (Edit suggestion: she sets it aside and does it by hand). On approval the server executes it (Kinross and Northfield respond by their rules) and Watch Agent continues from the result. An approval cannot be replayed. Only call this when the user has decided.', input: { session: z.string(), proposal: z.string().describe('Proposal id, for example WP-2'), decision: z.enum(['approve', 'reject', 'edit']), note: z.string().optional().describe('With edit: what Priya does instead') }, run: watchDecide },
  { name: 'watch_state', title: 'Watch session state, queue and trace', description: 'Current state of a Watch session: clock, queue rows with their states, proposals awaiting approval, confirmations pending, outcome, trace and agent overhead. Pass advance_minutes to move the session clock on: confirming records due by then arrive (a 997, a receiving advice, a Kinross 945) and Watch Agent continues from them.', input: { session: z.string(), advance_minutes: z.number().int().min(1).max(2880).optional() }, run: watchState },
  { name: 'watch_baseline', title: 'Rule baseline on the open-order queue', description: 'Runs the deterministic rule baseline (the decision table for a missing document) on the same branch and facts, with the same reads and actions and a labelled test approver, over Priya’s morning, and returns its outcome and trace.', input: { variation: WVAR, facts: WFACTS_IN, policy: WPOLICY_IN }, run: watchBaseline },
  { name: 'watch_replay', title: 'Governance replay: baseline and Watch Agent side by side', description: 'Runs the rule baseline and Watch Agent on the same branch and facts, approving every proposal as a labelled test approver and moving the clock to each confirming record, and returns both outcomes, one-line traces, the steps both took (automation) and those only one took. Recorded on the change list as a trial. For governance review, not operation.', input: { variation: WVAR, facts: WFACTS_IN, detail: z.enum(['brief', 'full']).optional(), policy: WPOLICY_IN }, run: (a) => watchReplay(a) },
];
// ---------- Match Agent (P14): a server-side agent on Northfield's connection, in a session branched at the P14 story moment ----------
const MATCH_FACTS_IN = z.object({ billed_line1: z.number().int(), received_line1: z.number().int(), received_line2: z.number().int(), price_line3: z.number(), price_change_line3: z.boolean(), total_offset: z.number(), correction_on_file: z.boolean(), ashby_answer: z.enum(['corrected_invoice', 'credit_memo', 'dispute', 'no_answer']), ashby_note: z.string().max(300), ashby_proof: z.enum(['none', 'ship_notice_and_delivery_receipt']) }).partial().optional().describe('Facts to branch with, on top of the preset: billed_line1, received_line1, received_line2, price_line3, price_change_line3, total_offset, correction_on_file, ashby_answer (how the supplier answers), ashby_note (free text it adds), ashby_proof (what it can send when asked to prove a delivery its note claims). match_setup lists them with their recorded values.');
const MATCH_VAR = z.enum(Object.keys(Match.VARIATIONS)).optional().describe(`Preset facts: ${Object.keys(Match.VARIATIONS).join(', ')}. Default canonical.`);
const MATCH_POLICY_IN = z.record(z.enum(['suggest', 'approve', 'policy'])).optional().describe('Approval mode per action for this run, for actions Jordan Ellis may change (match_setup lists them). Locked actions keep their mode.');
const matchFacts = (variation, facts) => ({ ...Match.VARIATIONS[variation || 'canonical'], ...(facts || {}) });
const matchModel = () => Scout.geminiCaller(Aviator.modelRoutes());
const matchPaused = () => G.isPaused(db, 'Match Agent');
export const matchView = (sess, extra = {}) => sess ? ({ session: sess.id, label: sess.label, clock: fmtET(new Date(sess.clock)), status: sess.agent.status, branch_at: fmtET(sess.branch_at), facts: sess.changes,
  ...(sess.agent.status === 'paused' ? { plain_task: { agent: 'Match Agent', agent_state: 'Paused', proposal: null, task: 'Work each held invoice by hand', message: 'Match Agent is paused, so each held invoice arrives as a plain task with no proposal.' } } : {}), ...(sess.handed_over ? { handed_over: sess.handed_over } : {}),
  queue: Match.READS.read_queue.run(nfDb, sess).held, awaiting: sess.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, does: Match.ACTIONS[p.action].label, args: p.args, proposed_by: p.by, rationale: p.rationale, alternatives: p.alternatives, rules: Match.ACTIONS[p.action].rules })),
  outcome: Match.outcome(nfDb, sess), ...(sess.simplest ? { simplest_baseline: sess.simplest } : {}), ashby_sees: Match.supplierView(sess), trace: sess.trace, overhead: { model_calls: sess.agent.calls, tool_calls: sess.agent.tool_calls, ms: sess.agent.ms, model_routes: sess.agent.routes || {} }, ...extra })
  : { result: 'Invalid request', error: 'No such session; sessions live in memory and end when the server restarts.' };
function drainMatch(sessionId) { const sess = Match.getSession(sessionId); if (!sess) return; for (const a of sess.audit.slice(sess.audited || 0)) log(NF, `match:${a.action}`, [], { session: a.session, proposal: a.proposal }, a.outcome, [a.session, a.proposal, a.record].filter(Boolean), { agent: a.agent, rule: a.authority_rule, mode: a.authority_mode, approver: a.approver, outcome: a.outcome }); sess.audited = sess.audit.length; }
async function matchStart({ variation, facts, policy, label } = {}) { const sess = Match.startSession(nfDb, { facts: matchFacts(variation, facts), policy: withModes('Match Agent', policy), label: label || 'Operator' }); const run = await Match.runMatch(nfDb, sess, { callModel: matchModel(), paused: matchPaused }); drainMatch(sess.id); return matchView(sess, run.ok ? {} : { blocked: run.blocked || run.status }); }
async function matchDecide({ session, proposal, decision, note }) { const sess = Match.getSession(session); if (!sess) return matchView(null); const r = await Match.decideAndResume(nfDb, sess, proposal, decision, 'Jordan Ellis', { callModel: matchModel(), paused: matchPaused, note }); drainMatch(sess.id); if (r.state === 'Refused') return { ...r, result: 'Refused' }; const dec = r.decision?.approval ? { state: r.decision.state, ...r.decision.approval } : { state: r.decision?.state, by: 'Jordan Ellis', proposal, payment: Match.PAYMENT_UNCHANGED }; return matchView(sess, { decision: dec, ...(r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}) }); }
async function matchBaseline({ variation, facts, policy } = {}) { const sess = Match.startSession(nfDb, { facts: matchFacts(variation, facts), policy: policy || {}, label: 'Rule baseline' }); Match.runBaseline(nfDb, sess); drainMatch(sess.id); return matchView(sess); }
async function matchReplay({ variation, facts, policy, detail } = {}, by = assistantOf(NF)) {
  const r = await Match.replay(nfDb, { facts: matchFacts(variation, facts), policy: policy || {}, callModel: matchModel(), paused: matchPaused });
  for (const id of [r.baseline.session, r.agent.session]) if (id) drainMatch(id);
  const trial = G.recordTrial(db, NF, { agent: 'Match Agent', rule: null, by, change: { policy: policy && Object.keys(policy).length ? policy : 'Policy in force (no change)', variation: variation || 'canonical', facts: r.facts },
    result: { baseline: r.baseline.outcome, agent: r.agent.blocked ? { blocked: r.agent.blocked } : r.agent.outcome, steps: r.steps, drift_measure: r.automation, rollback: 'Nothing was changed: sessions are in memory and leave Northfield’s recorded records unchanged.' } });
  if (detail === 'full') return { ...r, trial };
  return { trial, variation: variation || 'canonical', facts: r.facts, evidence_cutoff: r.evidence_cutoff, simplest_baseline: r.baseline.simplest, baseline: { session: r.baseline.session, outcome: r.baseline.outcome, trace: brief(r.baseline.trace) }, agent: r.agent.blocked ? { session: r.agent.session, blocked: r.agent.blocked, trace: brief(r.agent.trace) } : { session: r.agent.session, status: r.agent.status, outcome: r.agent.outcome, overhead: r.agent.overhead, trace: brief(r.agent.trace) }, steps: r.steps, comparison: r.comparison, automation: r.automation };
}
const MATCH_TOOLS = [
  { name: 'match_setup', title: 'Match Agent setup: queue, facts, approval modes and guardrails', description: 'What can be set before a Match Agent run on the P14 story moment (Tuesday 10 November 2026 09:00 ET): the invoices held at that moment with their rules, the facts with their recorded values and presets, each action with its rules, its approval mode and whether Jordan Ellis may change it, and the administrator guardrails. Changes nothing.', input: {}, run: async () => Match.setup(nfDb) },
  { name: 'match_start', title: 'Start Match Agent on the held invoices', description: 'Branches Northfield’s records at the P14 story moment into an isolated session (later records hidden; nothing reaches the recorded world), lets Match Agent investigate the held invoices with its read tools, and returns when it waits for Jordan Ellis, finishes or hits its limit. Returns the session id, the queue, proposals awaiting approval and the trace with who did what. Supplier answers in a session are synthetic, from deterministic rules, except a recorded corrected invoice revealed at its recorded time.', input: { variation: MATCH_VAR, facts: MATCH_FACTS_IN, policy: MATCH_POLICY_IN, label: z.string().optional() }, run: matchStart },
  { name: 'match_decide', title: 'Decide a Match Agent proposal as Jordan Ellis', description: 'Records Jordan Ellis’s decision on one proposal in a Match session: approve, reject, or edit (Edit suggestion: he sets it aside and works the invoice by hand, recorded with his name). On approval the server executes it (the supplier answers by its rules), then Match Agent continues. No payment is released by any decision. An approval cannot be replayed. Only call this when the user has decided.', input: { session: z.string(), proposal: z.string().describe('Proposal id, for example MP-1'), decision: z.enum(['approve', 'reject', 'edit']), note: z.string().optional().describe('With edit: what Jordan does instead') }, run: matchDecide },
  { name: 'match_state', title: 'Match session state and trace', description: 'Current state of a Match session: clock, queue, proposals awaiting approval, outcome so far (line by line, with the record that settles each), what the supplier sees, trace and agent overhead.', input: { session: z.string() }, run: async ({ session }) => matchView(Match.getSession(session)) },
  { name: 'match_baseline', title: 'Rule baseline on the held invoices', description: 'Runs the rule baseline on the same branch and facts: first the simplest baseline (the match shows Held with the failing rule), then fixed logic from the P14 decision table over the same reads and actions, with a labelled test approver. Returns its outcome and trace.', input: { variation: MATCH_VAR, facts: MATCH_FACTS_IN, policy: MATCH_POLICY_IN }, run: matchBaseline },
  { name: 'match_replay', title: 'Governance replay: baseline and Match Agent side by side', description: 'Runs the rule baseline and Match Agent on the same branch and facts, approving every proposal as a labelled test approver, and returns both outcomes, one-line traces, the steps where the two match (automation) and the agent’s overhead. Recorded on the change list as a trial. Pass detail full for every trace field. For governance review, not operation.', input: { variation: MATCH_VAR, facts: MATCH_FACTS_IN, policy: MATCH_POLICY_IN, detail: z.enum(['brief', 'full']).optional() }, run: (a) => matchReplay(a) },
];
// ---------- Claim, Pace and Shelf (Ashby) and Review and Chase (Northfield): agents on the shared runtime (src/runtime.js, D61) ----------
const rtModel = () => Scout.geminiCaller(Aviator.modelRoutes());
/** Each agent's settable actions, from its own setup tool, for set_agent_mode. */
function AGENT_ACTIONS(agent) {
  const rt = { 'Claim Agent': Claim, 'Pace Agent': Pace, 'Shelf Agent': Shelf, 'Review Agent': Review, 'Chase Agent': Chase }[agent];
  if (rt) return rt.setup().actions; if (agent === 'Scout Agent') return Scout.setup().actions; if (agent === 'Watch Agent') return Watch.setup().actions; if (agent === 'Match Agent') return Match.setup(nfDb).actions; return null;
}
/** A run's approval modes: the standing modes set in admin (P21), then any the run itself asks for. */
const withModes = (agent, policy) => ({ ...G.modesOf(db, agent), ...(policy || {}) });
const rtSet = (cid, rt, name, dataDb) => runtimeTools(rt, { name, db: dataDb, callModel: rtModel, paused: () => G.isPaused(db, rt.agent), modes: () => G.modesOf(db, rt.agent),
  log: (tool, args, outcome, records, w) => log(cid, tool, [], args, outcome, records, w), recordTrial: (t) => G.recordTrial(db, cid, t), by: () => assistantOf(cid) });
export const RUNTIME_TOOLS = { [AS]: [...rtSet(AS, Claim, 'claim', db), ...rtSet(AS, Pace, 'pace', db), ...rtSet(AS, Shelf, 'shelf', db)], [NF]: [...rtSet(NF, Review, 'review', nfDb), ...rtSet(NF, Chase, 'chase', nfDb)] };
// A replay runs the baseline and the agent end to end and can outlast a connector's call budget (about four minutes). Every
// *_replay tool answers inline when it finishes within RUN_WAIT_MS; otherwise it answers at once with a job id, keeps running,
// and its result is read at /jobs/<id> (random ids, memory only, fictional data). Nothing about the run itself changes.
const RUN_JOBS = new Map(); const RUN_WAIT_MS = Number(process.env.REPLAY_WAIT_MS || 150000); const RUN_PENDING = Symbol('pending');
function asJob(t) {
  if (!t.name.endsWith('_replay') || t.asJob) return t; const run = t.run;
  t.run = async (args) => {
    const id = `JOB-${randomBytes(6).toString('hex')}`; const job = { id, tool: t.name, args, status: 'running', started: new Date().toISOString() }; RUN_JOBS.set(id, job);
    if (RUN_JOBS.size > 200) RUN_JOBS.delete(RUN_JOBS.keys().next().value);
    const p = Promise.resolve().then(() => run(args)).then((r) => { job.status = 'finished'; job.finished = new Date().toISOString(); job.result = r; return r; }, (e) => { job.status = 'failed'; job.error = String(e?.message || e); return { result: 'Invalid request', error: job.error }; });
    const r = await Promise.race([p, new Promise((ok) => setTimeout(() => ok(RUN_PENDING), RUN_WAIT_MS))]);
    if (r !== RUN_PENDING) return { job: id, ...r };
    return { status: 'running', job: id, poll: `${BASE}/jobs/${id}`, message: `${t.name} is still running on the server; read its result at ${BASE}/jobs/${id}. It is recorded on the change list as a trial when it finishes.` };
  };
  t.asJob = true; return t;
}
/** Every agent session tool on a connection, for MCP and REST: Scout, Watch and Match, and the shared-runtime agents. */
for (const t of [...SCOUT_TOOLS, ...WATCH_TOOLS, ...MATCH_TOOLS, ...RUNTIME_TOOLS[AS], ...RUNTIME_TOOLS[NF]]) asJob(t);
const SESSION_TOOLS = (cid) => cid === AS ? [...SCOUT_TOOLS, ...WATCH_TOOLS, ...RUNTIME_TOOLS[AS]] : [...MATCH_TOOLS, ...RUNTIME_TOOLS[NF]];
async function runSessionTool(cid, t, args) { let out; try { out = await t.run(args); if (cid === NF) out = linkify(out, SIDE[NF]); } catch (e) { out = { result: 'Invalid request', error: e.message }; } log(cid, t.name, [], args, out.result || out.status || 'Answered', []); return out; }
function makeServer(cid) {
  const server = new McpServer({ name: cid === AS ? 'trading-grid-ashby' : 'trading-grid-northfield', title: cid === AS ? 'Trading Grid · Ashby Supplier' : 'Trading Grid · Northfield Retailer', version: '0.3.1' }, { instructions: INSTRUCTIONS[cid]() });
  for (const t of GOV_TOOLS[cid]) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !t.write, destructiveHint: false, openWorldHint: false } },
    async (args = {}) => ({ content: [{ type: 'text', text: JSON.stringify(call(cid, t.name, args), null, 1) }] }));
  for (const tool of cid === AS ? ALL_TOOLS : ALL_NF_TOOLS) {
    const write = WRITE_NAMES.has(tool.name) && WRITES;
    const extra = cid === AS && tool.required ? { supplier: z.string().optional().describe('Supplier whose records to read. Only Ashby Supplier is available on this connection.') } : {};
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: { ...tool.input, ...extra }, annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false } },
      async (args = {}) => ({ content: [{ type: 'text', text: JSON.stringify(call(cid, tool.name, args), null, 1) }] }));
  }
  // Aviator for a Trading Grid page: the page reaches it through the viewer's own connector and holds no key (T2.10, T2.11).
  server.registerTool('ask_aviator', { title: 'Ask Aviator', description: `Aviator, Trading Grid's in-product assistant, answers one question for ${SIDE[cid].person} at ${SIDE[cid].company}. The model runs on the server with this connection's read tools only, so the same scopes, refusals and access log apply; it cites the records it used and never writes: an action goes back to the screen for approval. Used by Trading Grid prototype pages; an assistant connected directly should call the read tools itself.`,
    inputSchema: { question: z.string().describe('The question in the person\'s own words'), history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string() })).optional().describe('Earlier turns of this conversation, oldest first'), context: z.string().optional().describe('The record open on the screen, such as a PO number, so a short question can be answered about it') },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    async ({ question, history = [], context } = {}) => {
      const tools = cid === AS ? TOOLS : NF_TOOLS; const side = SIDE[cid];
      const q = context ? `${question}\n(On screen: ${context})` : question;
      let out; try { out = await Aviator.ask({ question: q, history, tools, callTool: (name, args) => call(cid, name, args), side: { person: side.person, company: side.company, other: side.other }, clock: fmtET(D.storyClock()), routes: Aviator.modelRoutes() }); } catch (e) { out = { ok: false, message: 'Aviator failed.' }; }
      log(cid, 'ask_aviator', [], { question: String(question || '').slice(0, 300) }, out.ok ? `Answered from ${out.tools_called.length} tool call(s)` : out.message, []);
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] };
    });
  if (cid === AS) for (const t of SCOUT_TOOLS) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: t.name === 'scout_setup', destructiveHint: false, openWorldHint: false } },
    async (args = {}) => { let out; try { out = await t.run(args); } catch (e) { out = { result: 'Invalid request', error: e.message }; } log(cid, t.name, [], args, out.result || out.status || 'Answered', []); return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] }; });
  if (cid === AS) for (const t of WATCH_TOOLS) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: t.name === 'watch_setup', destructiveHint: false, openWorldHint: false } },
    async (args = {}) => { let out; try { out = await t.run(args); } catch (e) { out = { result: 'Invalid request', error: e.message }; } log(cid, t.name, [], args, out.result || out.status || 'Answered', []); return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] }; });
  for (const t of RUNTIME_TOOLS[cid]) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false } },
    async (args = {}) => ({ content: [{ type: 'text', text: JSON.stringify(await runSessionTool(cid, t, args), null, 1) }] }));
  if (cid === NF) for (const t of MATCH_TOOLS) server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: { readOnlyHint: t.name === 'match_setup' || t.name === 'match_state', destructiveHint: false, openWorldHint: false } },
    async (args = {}) => { let out; try { out = linkify(await t.run(args), SIDE[NF]); } catch (e) { out = { result: 'Invalid request', error: e.message }; } log(cid, t.name, [], args, out.result || out.status || 'Answered', []); return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] }; });
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.get('/', (req, res) => res.type('html').send(homePage()));
app.get('/healthz', (req, res) => res.json({ status: 'ok', version: '0.3.1', writes: WRITES, connections: [AS, NF], aviator: !!process.env.GEMINI_API_KEY, model_routes: Aviator.modelRoutes().map((r) => `${r.route} · ${r.model}`) }));
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
app.get('/api/:token/tools', (req, res) => { const cid = cidOf(req, res); if (!cid) return; res.json({ instructions: INSTRUCTIONS[cid](), tools: [...(cid === AS ? ALL_TOOLS : ALL_NF_TOOLS), ...GOV_TOOLS[cid], ...SESSION_TOOLS(cid)].map((t) => ({ name: t.name, description: t.description, input: Object.fromEntries(Object.entries(t.input || {}).map(([k, v]) => [k, v.description || ''])) })) }); });
app.all('/api/:token/tools/:name', async (req, res) => { const cid = cidOf(req, res); if (!cid) return; const args = { ...req.query, ...(req.body || {}) };
  // Agent session tools (scout_*, watch_*, match_*, claim_*, review_*, pace_*, shelf_*, chase_*) answer over REST too, so a page built
  // outside Claude reaches the same agents with the connection's token held on its own server.
  const t = SESSION_TOOLS(cid).find((x) => x.name === req.params.name); if (t) return res.json(await runSessionTool(cid, t, args));
  res.json(call(cid, req.params.name, args)); });

// A session's current view by its id, for recording a real run into a prototype page. Session ids are random and live in memory
// only; the data is fictional. Builders fetch the views a connector already returned, so a page's recorded run is never retyped.
app.get('/jobs/:id', (req, res) => { const j = RUN_JOBS.get(String(req.params.id)); if (!j) return res.status(404).json({ error: 'No such job; jobs live in memory and end when the server restarts.' }); res.json(j); });
app.get('/sessions/:id', (req, res) => { const id = String(req.params.id).replace(/\.json$/, '');
  const rt = [[Claim, db], [Pace, db], [Shelf, db], [Review, nfDb], [Chase, nfDb]].find(([r]) => id.startsWith(`${r.prefix}-`) && r.getSession(id));
  const v = id.startsWith('SC-') && Scout.getSession(id) ? scoutView(Scout.getSession(id)) : id.startsWith('WS-') && Watch.getSession(id) ? watchView(Watch.getSession(id)) : id.startsWith('MS-') && Match.getSession(id) ? matchView(Match.getSession(id)) : rt ? rt[0].view(rt[1], rt[0].getSession(id)) : null;
  if (!v) return res.status(404).json({ error: 'No such session; sessions live in memory and end when the server restarts.' }); res.json(v); });
app.get('/records/order/:po', (req, res) => res.type('html').send(recordPage(D.lifecycle(db, req.params.po))));
app.get('/records/document/:id', (req, res) => res.type('html').send(documentPage(D.document(db, req.params.id))));
app.get('/records/northfield/order/:po', (req, res) => res.type('html').send(nfOrderPage(NR.trail(db, { po: req.params.po, asOf: D.asOfDate('2027-01-06') }))));
app.get('/records/northfield/document/:id', (req, res) => { const d = NR.documentNF(db, req.params.id); res.type('html').send(d.found ? documentPage(D.document(db, req.params.id).found ? D.document(db, req.params.id) : { ...d, found: true, versions: [], control_numbers: {}, file: '' }) : nfOrderPage(d)); });
app.get('/records/:old/order/:po', (req, res) => res.redirect(`/records/order/${encodeURIComponent(req.params.po)}`));

const adminData = (cid, token) => ({ connection: conn(cid), side: SIDE[cid], rows: db.prepare('SELECT * FROM access_log WHERE connection_id = ? ORDER BY id DESC LIMIT 200').all(cid), allScopes: SIDE[cid].scopes, token, mcpUrl: `${BASE}/mcp/${token}`, writes: WRITES, proposals: db.prepare('SELECT * FROM proposals WHERE connection_id = ? ORDER BY created_at DESC').all(cid), governance: G.changeList(db, cid, { limit: 50 }) });
// Aviator: the in-product assistant. A Trading Grid page posts a question; the model runs on the server with the
// connection's read tools only, so scopes, refusals and the access log apply exactly as they do for the company's own assistant.
const cors = (res) => res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' });
app.options('/aviator/:token', (req, res) => { cors(res).status(204).end(); });
app.post('/aviator/:token', async (req, res) => {
  const cid = aviatorCid(req, res); if (!cid) return; cors(res);
  const tools = cid === AS ? TOOLS : NF_TOOLS; const side = SIDE[cid]; const q = req.body?.question;
  try {
    const out = await Aviator.ask({ question: q, history: Array.isArray(req.body?.history) ? req.body.history : [], tools, callTool: (name, args) => call(cid, name, args), side: { person: side.person, company: side.company, other: side.other }, clock: fmtET(D.storyClock()), routes: Aviator.modelRoutes() });
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
  const d = ['approve', 'reject', 'edit'].includes(req.params.decision) ? req.params.decision : null; if (!d) return res.status(400).send('Decision is approve, reject or edit');
  decide(cid, req.params.id, d, req.body?.note); res.redirect(`/admin/${req.params.token}`);
});
// An administrator pauses or resumes an agent (T2.3 story 2). Recorded on the change list and the access log with the person's name.
app.post('/admin/:token/agents/:agent/:action', (req, res) => {
  const cid = cidOf(req, res); if (!cid) return; if (!['pause', 'resume'].includes(req.params.action)) return res.status(400).send('Action is pause or resume');
  const by = SIDE[cid].person; const r = G.setAgentState(db, cid, { agent: req.params.agent, state: req.params.action === 'pause' ? 'paused' : 'active', by, reason: req.body?.reason });
  log(cid, `${req.params.action}_agent`, [], { agent: req.params.agent, via: 'admin' }, r.result, r.change ? [r.change] : [], { agent: by, rule: null, mode: 'person', approver: by, outcome: r.result === 'Invalid request' ? r.message : `${r.agent} ${r.state.toLowerCase()}` });
  if (r.result === 'Invalid request') return res.status(400).send(r.message); res.redirect(`/admin/${req.params.token}`);
});
app.post('/admin/:token/reset', (req, res) => {
  const cid = cidOf(req, res); if (!cid) return;
  db.prepare('DELETE FROM events WHERE id > ?').run(BASELINE_EVENT); db.prepare('DELETE FROM proposals').run(); db.prepare('DELETE FROM access_log').run(); db.prepare('DELETE FROM rule_replays').run(); db.prepare('DELETE FROM agent_changes').run();
  db.prepare("UPDATE draft_rules SET state = CASE WHEN in_force_from IS NULL THEN 'Draft' ELSE 'Scheduled' END").run();
  for (const r of BASELINE_RULES) db.prepare('UPDATE rules SET statement = ?, params = ? WHERE id = ?').run(r.statement, r.params, r.id);
  for (const v of BASELINE_VERSIONS) db.prepare('UPDATE rule_versions SET statement = ?, params = ? WHERE rule_id = ? AND valid_from = ?').run(v.statement, v.params, v.rule_id, v.valid_from);
  for (const c of [AS, NF]) db.prepare('UPDATE connections SET scopes = ? WHERE id = ?').run(JSON.stringify(SIDE[c].scopes), c);
  res.redirect(`/admin/${req.params.token}`);
});

if (process.env.NO_LISTEN !== '1') app.listen(PORT, () => console.log(`Trading Grid demo MCP server on ${BASE} · Ashby ${BASE}/mcp/<MCP_TOKEN> · Northfield ${BASE}/mcp/<NF_TOKEN> · writes ${WRITES ? 'on' : 'off'}`));
