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
import { buildWorld, MAIN_DB, ASHBY_DB } from '../world/build.js';
import * as D from './domain.js';
import { TOOLS, BOUNDARY, SCOPES } from './tools.js';
import { recordPage, documentPage, adminPage, homePage } from './pages.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN || randomBytes(18).toString('base64url');
const BASE = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
export const WRITES = process.env.WRITES === 'on';
if (!process.env.MCP_TOKEN) console.warn(`MCP_TOKEN not set; generated one for this run: ${TOKEN}`);

if (!existsSync(MAIN_DB) || !existsSync(ASHBY_DB)) buildWorld();
const db = new DatabaseSync(MAIN_DB);
const ashbyDb = new DatabaseSync(ASHBY_DB, { readOnly: true });
const CONNECTION = 'ashby-assistant';
const BASELINE_EVENT = db.prepare('SELECT max(id) m FROM events').get().m;

const conn = () => { const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(CONNECTION); return { ...c, scopes: JSON.parse(c.scopes) }; };
function linkify(obj) {
  const walk = (v) => { if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = (k === 'link' && typeof x === 'string') ? (x ? `${BASE}/records/${x}` : null) : walk(x); return o; } return v; };
  return walk(obj);
}
const refsOf = (obj) => { const out = new Set(); const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (['po', 'reference', 'case', 'record'].includes(k) && typeof x === 'string') out.add(x); walk(x); } }; walk(obj); return [...out].slice(0, 50); };
function log(tool, scopesUsed, args, result, records) {
  db.prepare('INSERT INTO access_log (at, connection_id, user_name, tool, scopes_used, arguments, result, records) VALUES (?,?,?,?,?,?,?,?)').run(new Date().toISOString(), CONNECTION, conn().user_name, tool, JSON.stringify(scopesUsed), JSON.stringify(args || {}), result, JSON.stringify(records || []));
}

/** Masks parts of an answer the granted scopes do not cover. */
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

/** Runs one tool call: scope check, the read, masking, links and the access log. Used by MCP and REST alike. */
export function call(name, args = {}) {
  const tool = TOOLS.find((x) => x.name === name); const granted = conn().scopes; const has = (s) => granted.includes(s);
  if (tool) {
    const missing = tool.required.filter((s) => !has(s));
    if (missing.length) { log(name, tool.required, args, 'Scope not granted', []); return { result: 'Scope not granted', missing_scopes: missing, message: `Scope not granted: ${missing.join(', ')}. Ashby’s admin has not granted ${missing.length > 1 ? 'these scopes' : 'this scope'} to this assistant.` }; }
    if (args.supplier && !/ashby/i.test(args.supplier)) { log(name, tool.required, args, D.NOT_AVAILABLE, []); return { result: D.NOT_AVAILABLE, message: 'This connection reads Ashby Supplier’s own records only.' }; }
    let out; try { out = tool.run(db, args); } catch (e) { log(name, tool.required, args, 'Invalid request', []); return { result: 'Invalid request', error: e.message }; }
    const result = out && out.not_available ? D.NOT_AVAILABLE : 'Answered';
    const body = linkify(mask(out, has)); body.read_at = new Date().toISOString();
    log(name, [...tool.required, ...tool.optional.filter(has)], args, result, refsOf(out));
    return body;
  }
  if (name === 'compare_with_other_suppliers') { log(name, [], args, D.NOT_AVAILABLE, []); return { result: D.NOT_AVAILABLE, message: 'Other suppliers’ records are not available on Ashby’s connection.' }; }
  if (name === 'request_change') {
    const po = args.po ? D.normPo(args.po) : null; const link = po ? `${BASE}/records/order/${encodeURIComponent(po)}` : args.document ? `${BASE}/records/document/${encodeURIComponent(args.document)}` : null;
    if (!WRITES) { log(name, [], args, 'Action not available', po ? [po] : []); return { result: 'Action not available', message: 'This connection is read-only. Complete and approve the action in Trading Grid.', requested: args.action, link }; }
    const id = `PR-${String(db.prepare('SELECT count(*) n FROM proposals').get().n + 1).padStart(4, '0')}`;
    db.prepare('INSERT INTO proposals (id, created_at, created_by, action, target, payload, state) VALUES (?,?,?,?,?,?,?)').run(id, new Date().toISOString(), `${conn().user_name}’s assistant`, args.action, po || args.document || '', JSON.stringify(args), 'Awaiting approval');
    log(name, [], args, 'Proposal recorded', [id]);
    return { result: 'Proposal recorded', proposal: id, state: 'Awaiting approval', message: 'Nothing has changed. Priya Raman approves or rejects this proposal in Trading Grid.', approve_at: `${BASE}/admin/<token>`, link };
  }
  if (name === 'run_readonly_sql') {
    const missing = SCOPES.filter((s) => !has(s)); if (missing.length) { log(name, SCOPES, args, 'Scope not granted', []); return { result: 'Scope not granted', missing_scopes: missing }; }
    const q = String(args.sql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(q) || q.includes(';') || /\b(attach|detach|pragma|vacuum|insert|update|delete|drop|create|alter|replace|reindex|load_extension)\b/i.test(q)) { log(name, SCOPES, args, 'Invalid request', []); return { result: 'Invalid request', error: 'Only one read-only SELECT is allowed.' }; }
    try { const rows = ashbyDb.prepare(`SELECT * FROM (${q}) LIMIT 200`).all(); log(name, SCOPES, args, 'Answered', []); return { rows: rows.map((r) => ({ ...r })), row_count: rows.length, note: rows.length === 200 ? 'Limited to 200 rows' : undefined }; }
    catch (e) { log(name, SCOPES, args, 'Invalid request', []); return { result: 'Invalid request', error: e.message }; }
  }
  if (name === 'get_access_log') {
    const rows = db.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT ?').all(args.limit || 50); log(name, [], args, 'Answered', []);
    return { connection: CONNECTION, configured_by: conn().configured_by, scopes: conn().scopes, read_only: !WRITES, calls: rows.map((r) => ({ at: r.at, user: r.user_name, tool: r.tool, scopes: JSON.parse(r.scopes_used), arguments: JSON.parse(r.arguments), result: r.result, records: JSON.parse(r.records) })) };
  }
  return { result: 'Invalid request', error: `Unknown tool ${name}` };
}

const SQL_TOOL = { name: 'run_readonly_sql', title: 'Read-only SQL over Ashby records', description: 'One SELECT over a copy holding only Ashby Supplier’s records. Tables: orders(po, stream, ship_to, received_at, requested_delivery, order_value, accepted_value), order_lines, order_changes, documents(doc_id, reference, po, doc_type, name, sender_id, receiver_id, partner_id, sent_at, status, answers_doc_id, body JSON, raw X12), errors(doc_id, reported_by, channel, cause, field, sent_value, rule_id, status, corrected_by), shipments, shipment_lines, cartons(sscc, shipment_id, po, line, received), receipts, invoices, invoice_lines, remittance_items, adjustments, warehouse_orders, store_activity, events(at, kind, po, system, channel, data JSON), rules, items, locations, parties, calendar. Times are ISO UTC. At most 200 rows.', input: { sql: z.string().describe('A single SELECT or WITH query') } };
const LOG_TOOL = { name: 'get_access_log', title: 'Access log', description: 'Every call made on this connection: time, user, tool, scopes used, arguments, result and records returned. Newest first.', input: { limit: z.number().int().min(1).max(200).optional() } };
export const ALL_TOOLS = [...TOOLS, ...BOUNDARY, SQL_TOOL, LOG_TOOL];

function makeServer() {
  const server = new McpServer({ name: 'trading-grid-ashby', title: 'Trading Grid · Ashby Supplier', version: '0.2.0' }, {
    instructions: [
      'This is Ashby Supplier’s connection to Trading Grid, the B2B network Ashby uses to trade with Northfield Retailer. All data is fictional.',
      'It holds one quarter of trade, 27 September to 26 December 2026, with settlement to 6 January 2027. Times are US Eastern.',
      'Questions about "now" are answered as of the story clock, Tuesday 17 November 2026 11:00 Eastern, unless you pass as_of. get_story_calendar lists other moments.',
      'Find records by PO number, document reference or case id. Answer only from tool results and cite each record with its link.',
      'Keep a technical acknowledgment (997) separate from business acceptance: Northfield sends no business acceptance.',
      WRITES ? 'To change anything, call request_change: it records a proposal that Priya Raman approves in Trading Grid. Nothing changes before that.' : 'Nothing on this connection creates, changes or sends a Trading Grid record. For any action, call request_change and give the user its Trading Grid link.',
      'Records of other suppliers are not available; say "Not available to Ashby".',
    ].join(' '),
  });
  for (const tool of ALL_TOOLS) {
    const write = tool.name === 'request_change' && WRITES;
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: { ...tool.input, ...(tool.required ? { supplier: z.string().optional().describe('Supplier whose records to read. Only Ashby Supplier is available on this connection.') } : {}) }, annotations: { readOnlyHint: !write, destructiveHint: false, openWorldHint: false } },
      async (args = {}) => ({ content: [{ type: 'text', text: JSON.stringify(call(tool.name, args), null, 1) }] }));
  }
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.get('/', (req, res) => res.type('html').send(homePage()));
app.get('/healthz', (req, res) => res.json({ status: 'ok', version: '0.2.0', writes: WRITES }));
const tokenOk = (req, res) => { if (req.params.token !== TOKEN) { res.status(404).send('Not found'); return false; } return true; };

app.post('/mcp/:token', async (req, res) => {
  if (!tokenOk(req, res)) return;
  const server = makeServer(); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }); }
});
app.get('/mcp/:token', (req, res) => { if (tokenOk(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });
app.delete('/mcp/:token', (req, res) => { if (tokenOk(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });

// REST: the same tools, as the API draft describes them.
for (const tool of [...TOOLS, ...BOUNDARY]) {
  const [method, path] = tool.rest; const route = `/api/:token${path.replace(/\{(\w+)\}/g, ':$1')}`;
  app[method.toLowerCase()](route, (req, res) => {
    if (!tokenOk(req, res)) return;
    const { token, ...params } = req.params; const q = { ...req.query }; if (q.days) q.days = Number(q.days); for (const k of ['include_warehouse', 'lines']) if (k in q) q[k] = q[k] === 'true';
    const args = { ...q, ...(req.body || {}), ...params }; if (typeof args.pos === 'string') args.pos = args.pos.split(',');
    res.json(call(tool.name, args));
  });
}

app.get('/records/order/:po', (req, res) => res.type('html').send(recordPage(D.lifecycle(db, req.params.po))));
app.get('/records/document/:id', (req, res) => res.type('html').send(documentPage(D.document(db, req.params.id))));
app.get('/records/:old/order/:po', (req, res) => res.redirect(`/records/order/${encodeURIComponent(req.params.po)}`));

const adminData = () => ({ connection: conn(), rows: db.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT 200').all(), allScopes: SCOPES, token: TOKEN, mcpUrl: `${BASE}/mcp/${TOKEN}`, writes: WRITES, proposals: db.prepare('SELECT * FROM proposals ORDER BY created_at DESC').all() });
app.get('/openapi.json', (req, res) => { const f = new URL('../openapi/openapi.json', import.meta.url); if (existsSync(f)) res.type('json').send(readFileSync(f)); else res.status(404).send('Not built'); });
app.get('/admin/:token', (req, res) => { if (tokenOk(req, res)) res.type('html').send(adminPage(adminData())); });
app.post('/admin/:token/scopes', (req, res) => {
  if (!tokenOk(req, res)) return;
  db.prepare('UPDATE connections SET scopes = ?, configured_at = ? WHERE id = ?').run(JSON.stringify(SCOPES.filter((s) => req.body[s] === 'on')), new Date().toISOString(), CONNECTION);
  res.redirect(`/admin/${TOKEN}`);
});
app.post('/admin/:token/clear-log', (req, res) => { if (!tokenOk(req, res)) return; db.prepare('DELETE FROM access_log').run(); res.redirect(`/admin/${TOKEN}`); });
// Writes as events: an approved proposal is appended to the event log; a reset removes everything after the baseline.
app.post('/admin/:token/proposals/:id/:decision', (req, res) => {
  if (!tokenOk(req, res)) return; if (!WRITES) return res.status(403).send('Writes are off in this release');
  const p = db.prepare("SELECT * FROM proposals WHERE id = ? AND state = 'Awaiting approval'").get(req.params.id); if (!p) return res.redirect(`/admin/${TOKEN}`);
  const now = new Date().toISOString(); let eventId = null;
  if (req.params.decision === 'approve') { eventId = db.prepare('INSERT INTO events (at, kind, po, system, party, channel, data) VALUES (?,?,?,?,?,?,?)').run(now, 'proposal.approved', /^NR-/.test(p.target) ? p.target : null, 'Trading Grid', 'ASHBY', 'API', JSON.stringify({ proposal: p.id, action: p.action, target: p.target, proposed_by: p.created_by, approved_by: 'Priya Raman' })).lastInsertRowid; }
  db.prepare('UPDATE proposals SET state = ?, decided_by = ?, decided_at = ?, result_event = ? WHERE id = ?').run(req.params.decision === 'approve' ? 'Approved' : 'Rejected', 'Priya Raman', now, eventId, p.id);
  res.redirect(`/admin/${TOKEN}`);
});
app.post('/admin/:token/reset', (req, res) => {
  if (!tokenOk(req, res)) return;
  db.prepare('DELETE FROM events WHERE id > ?').run(BASELINE_EVENT); db.prepare('DELETE FROM proposals').run(); db.prepare('DELETE FROM access_log').run();
  db.prepare('UPDATE connections SET scopes = ? WHERE id = ?').run(JSON.stringify(SCOPES), CONNECTION);
  res.redirect(`/admin/${TOKEN}`);
});

if (process.env.NO_LISTEN !== '1') app.listen(PORT, () => console.log(`Trading Grid demo MCP server on ${BASE} · connector URL ${BASE}/mcp/<MCP_TOKEN> · writes ${WRITES ? 'on' : 'off'}`));
