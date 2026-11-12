// Read-only MCP server: Ashby Supplier's Trading Grid connection for its own AI assistant.
// Streamable HTTP at /mcp/<token>. Every call is checked against the connection's scopes and logged.
import express from 'express';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { seed, MAIN_DB, ASHBY_DB } from '../data/seed.js';
import * as D from './domain.js';
import { recordPage, adminPage, homePage } from './pages.js';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MCP_TOKEN || randomBytes(18).toString('base64url');
const BASE = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
if (!process.env.MCP_TOKEN) console.warn(`MCP_TOKEN not set; generated one for this run: ${TOKEN}`);

if (!existsSync(MAIN_DB) || !existsSync(ASHBY_DB)) seed();
const db = new DatabaseSync(MAIN_DB);
const ashbyDb = new DatabaseSync(ASHBY_DB, { readOnly: true });
const CONNECTION = 'ashby-assistant';
const SCENARIOS = ['p10', 'p13', 'core'];
const ALL_SCOPES = ['orders', 'documents', 'errors', 'rules'];

const conn = () => { const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(CONNECTION); return { ...c, scopes: JSON.parse(c.scopes) }; };
function linkify(obj, sc) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = (k === 'link' && typeof x === 'string') ? (x ? `${BASE}/records/${sc}/${x}` : null) : walk(x); return o; }
    return v;
  };
  return walk(obj);
}
const refsOf = (obj) => {
  const out = new Set();
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (['po', 'reference'].includes(k) && typeof x === 'string') out.add(x); walk(x); } } };
  walk(obj); return [...out].slice(0, 50);
};
function log(tool, sc, scopesUsed, args, result, records) {
  db.prepare('INSERT INTO access_log (at, connection_id, user_name, tool, scenario, scopes_used, arguments, result, records) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), CONNECTION, conn().user_name, tool, sc || null, JSON.stringify(scopesUsed), JSON.stringify(args || {}), result, JSON.stringify(records || []));
}
const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });

/** Wraps a tool: checks required scopes, masks optional ones, logs the call. */
function guarded(name, { required = [], optional = [] }, fn) {
  return async (args = {}) => {
    const sc = args.scenario || 'p10';
    const granted = conn().scopes;
    const missing = required.filter((s) => !granted.includes(s));
    if (missing.length) {
      log(name, sc, required, args, 'Scope not granted', []);
      return text({ result: 'Scope not granted', missing_scopes: missing, message: `Ashby’s IT admin has not granted the ${missing.join(' and ')} scope${missing.length > 1 ? 's' : ''} to this assistant.` });
    }
    if (args.supplier && !/ashby/i.test(args.supplier)) {
      log(name, sc, required, args, D.NOT_AVAILABLE, []);
      return text({ result: D.NOT_AVAILABLE, message: 'This connection reads Ashby Supplier’s own records only.' });
    }
    const has = (s) => granted.includes(s);
    const out = fn({ ...args, scenario: sc }, has);
    const result = out && out.not_available ? D.NOT_AVAILABLE : out && out.result_label ? out.result_label : 'Answered';
    if (out && out.result_label) delete out.result_label;
    const body = linkify(out, sc);
    log(name, sc, [...required, ...optional.filter(has)], args, result, refsOf(out));
    return text(body);
  };
}

const ruleMask = (has, r) => (has('rules') ? r : r ? { id: r.id, statement: 'Scope not granted: rules', source: null } : r);
const scenarioArg = z.enum(SCENARIOS).optional().describe('Demo scenario. p10 (default): 30 days of Ashby and Northfield EDI at 11:00 on the demo day. p13: five open orders at 09:00 the next day. core: the PO NR-450118 order story.');
const supplierArg = z.string().optional().describe('Supplier whose records to read. Only Ashby Supplier is available on this connection.');

function makeServer() {
  const server = new McpServer({ name: 'trading-grid-ashby', title: 'Trading Grid · Ashby Supplier', version: '0.1.0' }, {
    instructions: [
      'This is Ashby Supplier’s read-only connection to Trading Grid, the B2B network Ashby uses to trade with Northfield Retailer.',
      'All data is fictional demo data. Times are US Eastern and every scenario runs at a fixed demo clock.',
      'Answer only from tool results. Cite each record with its link. Keep a technical acknowledgment (997) separate from business acceptance.',
      'Nothing on this connection creates, changes or sends a Trading Grid record. For any action, call request_change and give the user its Trading Grid link.',
      'Records of other suppliers are not available; say "Not available to Ashby".',
    ].join(' '),
  });
  const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  server.registerTool('orders_needing_attention', {
    title: 'Orders needing attention',
    description: 'Ashby orders with Northfield that need action now: rejected documents and required documents not yet sent, each with the reason, the Northfield rule and its source, the deadline and time left, and a link to the order record. Also lists items checked that need nothing.',
    inputSchema: { scenario: scenarioArg, supplier: supplierArg }, annotations: ro,
  }, guarded('orders_needing_attention', { required: ['orders', 'documents'], optional: ['errors', 'rules'] }, ({ scenario }, has) => {
    const a = D.attention(db, scenario);
    a.items = a.items.map((i) => ({ ...i, reason: has('errors') ? i.reason : i.reason.replace(/:.*$/, ': cause hidden, errors scope not granted'), rule: ruleMask(has, i.rule) }));
    a.checked_nothing_to_chase = a.checked_nothing_to_chase.map((c) => ({ ...c, rule: ruleMask(has, c.rule) }));
    return a;
  }));

  server.registerTool('explain_rejection', {
    title: 'Explain a rejected document',
    description: 'Why Northfield rejected an Ashby document (ship notice, invoice, acknowledgment): the failing field, the value sent and its length, the allowed value, the rule and its source, the root cause, whether it was corrected, and later documents that failed for the same cause. Accepts a document reference such as ASN-46118 or INV-46133, or a PO number.',
    inputSchema: { reference: z.string().describe('Document reference (ASN-46118, INV-46133) or PO number'), scenario: scenarioArg, supplier: supplierArg }, annotations: ro,
  }, guarded('explain_rejection', { required: ['documents', 'errors'], optional: ['rules'] }, ({ reference, scenario }, has) => {
    const r = D.explainRejection(db, scenario, reference);
    if (r.rejections) r.rejections = r.rejections.map((x) => ({ ...x, rule: ruleMask(has, x.rule) }));
    return r;
  }));

  server.registerTool('edi_health_summary', {
    title: 'EDI health summary',
    description: 'Ashby’s EDI exchange with Northfield over a period ending at the demo clock: documents by type, failures, failures by channel (application advice 824 or technical acknowledgment 997), open failures, and the top causes.',
    inputSchema: { days: z.number().int().min(1).max(90).optional().describe('Days ending at the demo clock, default 30'), scenario: scenarioArg, supplier: supplierArg }, annotations: ro,
  }, guarded('edi_health_summary', { required: ['documents'], optional: ['errors'] }, ({ days, scenario }, has) => {
    const h = D.health(db, scenario, days || 30);
    if (!has('errors')) { h.failures = 'Scope not granted: errors'; delete h.failure_rate; delete h.rejected_by; delete h.open_failures; delete h.top_causes; delete h.other_causes; }
    return h;
  }));

  server.registerTool('check_deliveries', {
    title: 'Check deliveries for POs',
    description: 'For a list of PO numbers, whether each was delivered on time: requested delivery date on the purchase order against the date on Northfield’s receiving advice (861), with truck departure, ship notice and receipt records. Use it to check claims such as a list of POs a buyer says arrived late.',
    inputSchema: { pos: z.array(z.string()).min(1).max(50).describe('PO numbers, for example NR-46101'), scenario: scenarioArg, supplier: supplierArg }, annotations: ro,
  }, guarded('check_deliveries', { required: ['orders', 'documents'] }, ({ pos, scenario }) => D.deliveries(db, scenario, pos)));

  server.registerTool('get_order', {
    title: 'Order record',
    description: 'One Ashby order with Northfield: lines, shipments, every document exchanged in order with its status, rejections, outside confirmations and deductions.',
    inputSchema: { po: z.string().describe('PO number, for example NR-46133'), scenario: scenarioArg, supplier: supplierArg }, annotations: ro,
  }, guarded('get_order', { required: ['orders'], optional: ['documents', 'errors'] }, ({ po, scenario }, has) => {
    const o = D.lifecycle(db, scenario, po);
    if (o.found && !has('documents')) o.documents = 'Scope not granted: documents';
    if (o.found && !has('errors')) o.rejections = 'Scope not granted: errors';
    return o;
  }));

  server.registerTool('lookup_retailer_rules', {
    title: 'Retailer rules',
    description: 'Northfield’s trading rules for Ashby (deadlines, field limits, item and location rules, charges) and the Kinross warehouse rule, each with its source. Filter by topic words or X12 document number.',
    inputSchema: { topic: z.string().optional().describe('Words to match, for example "invoice" or "PO reference"'), document: z.string().optional().describe('X12 set, for example 856') }, annotations: ro,
  }, guarded('lookup_retailer_rules', { required: ['rules'] }, ({ topic, document }) => D.rules(db, { topic, document })));

  server.registerTool('compare_with_other_suppliers', {
    title: 'Compare with other suppliers',
    description: 'Requests to compare Ashby with other Northfield suppliers or read their records.',
    inputSchema: { question: z.string().describe('What the user asked about other suppliers') }, annotations: ro,
  }, guarded('compare_with_other_suppliers', {}, () => ({ not_available: true, result: D.NOT_AVAILABLE, message: 'Other suppliers’ records are not available on Ashby’s connection.' })));

  server.registerTool('request_change', {
    title: 'Request a change in Trading Grid',
    description: 'Use when the user asks to send, resend, correct, approve or change anything (a ship notice, invoice, acknowledgment, order). This connection cannot make changes; it returns the Trading Grid record where an authorized user completes and approves the action.',
    inputSchema: { action: z.string().describe('What the user asked to do'), po: z.string().optional().describe('PO number the action concerns'), scenario: scenarioArg }, annotations: ro,
  }, guarded('request_change', {}, ({ action, po, scenario }) => ({
    result_label: 'Action not available', result: 'Action not available',
    message: 'This connection is read-only. Complete and approve the action in Trading Grid.', requested: action,
    link: po ? `order/${encodeURIComponent(po.toUpperCase().replace(/^(\d)/, 'NR-$1'))}` : '', scenario,
  })));

  server.registerTool('run_readonly_sql', {
    title: 'Read-only SQL over Ashby records',
    description: 'One SELECT over a copy holding only Ashby Supplier’s records. Tables: scenarios, parties, people, locations, items, rules, orders(scenario, po, ship_to, received_at, requested_delivery, order_value), order_lines, shipments(planned_departure, departed_at), documents(scenario, doc_id, reference, po, doc_type, name, sender_id, receiver_id, sent_at ISO UTC, status, answers_doc_id, covers, body JSON), errors(doc_id, cause, field, sent_value, status, corrected_by), warehouse_orders, confirmations, deductions, cartons, scorecards. Always filter by scenario. Returns at most 200 rows.',
    inputSchema: { sql: z.string().describe('A single SELECT or WITH query') }, annotations: ro,
  }, guarded('run_readonly_sql', { required: ALL_SCOPES }, ({ sql }) => {
    const q = sql.trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(q) || q.includes(';') || /\b(attach|detach|pragma|vacuum|insert|update|delete|drop|create|alter|replace|reindex|load_extension)\b/i.test(q)) {
      return { result_label: 'Invalid request', error: 'Only one read-only SELECT is allowed.' };
    }
    try {
      const rows = ashbyDb.prepare(`SELECT * FROM (${q}) LIMIT 200`).all();
      return { rows: rows.map((r) => ({ ...r })), row_count: rows.length, note: rows.length === 200 ? 'Limited to 200 rows' : undefined };
    } catch (e) { return { result_label: 'Invalid request', error: e.message }; }
  }));

  server.registerTool('get_access_log', {
    title: 'Access log',
    description: 'Every call made on this connection: time, user, tool, scopes used, arguments, result and records returned. Newest first.',
    inputSchema: { limit: z.number().int().min(1).max(200).optional() }, annotations: ro,
  }, async ({ limit } = {}) => {
    const rows = db.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT ?').all(limit || 50);
    log('get_access_log', null, [], { limit }, 'Answered', []);
    return text({ connection: CONNECTION, configured_by: conn().configured_by, scopes: conn().scopes, read_only: true, admin_page: `${BASE}/admin/<token>`, calls: rows.map((r) => ({ at: r.at, user: r.user_name, tool: r.tool, scenario: r.scenario, scopes: JSON.parse(r.scopes_used), arguments: JSON.parse(r.arguments), result: r.result, records: JSON.parse(r.records) })) });
  });

  server.registerTool('list_scenarios', {
    title: 'Demo scenarios', description: 'The demo scenarios available on this connection, with their fixed clocks.', inputSchema: {}, annotations: ro,
  }, async () => text({ scenarios: db.prepare('SELECT id, name, clock, summary FROM scenarios').all().map((s) => ({ ...s, clock: D.scenario(db, s.id).clockDate.toISOString() })) }));

  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => res.type('html').send(homePage()));
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

const tokenOk = (req, res) => { if (req.params.token !== TOKEN) { res.status(404).send('Not found'); return false; } return true; };
app.post('/mcp/:token', async (req, res) => {
  if (!tokenOk(req, res)) return;
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
app.get('/mcp/:token', (req, res) => { if (tokenOk(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });
app.delete('/mcp/:token', (req, res) => { if (tokenOk(req, res)) res.status(405).set('Allow', 'POST').send('Method not allowed'); });

app.get('/records/:sc/order/:po', (req, res) => {
  const { sc, po } = req.params;
  if (!SCENARIOS.includes(sc)) return res.status(404).send('Not found');
  res.type('html').send(recordPage(D.lifecycle(db, sc, po), D.scenario(db, sc)));
});
app.get('/records/:sc/', (req, res) => res.redirect(`/records/${req.params.sc}/order/${req.query.po || ''}`));

app.get('/admin/:token', (req, res) => {
  if (!tokenOk(req, res)) return;
  const rows = db.prepare('SELECT * FROM access_log ORDER BY id DESC LIMIT 200').all();
  res.type('html').send(adminPage({ connection: conn(), rows, allScopes: ALL_SCOPES, token: TOKEN, mcpUrl: `${BASE}/mcp/${TOKEN}` }));
});
app.post('/admin/:token/scopes', (req, res) => {
  if (!tokenOk(req, res)) return;
  const picked = ALL_SCOPES.filter((s) => req.body[s] === 'on');
  db.prepare('UPDATE connections SET scopes = ?, configured_at = ? WHERE id = ?').run(JSON.stringify(picked), new Date().toISOString(), CONNECTION);
  res.redirect(`/admin/${TOKEN}`);
});
app.post('/admin/:token/clear-log', (req, res) => {
  if (!tokenOk(req, res)) return;
  db.prepare('DELETE FROM access_log').run();
  res.redirect(`/admin/${TOKEN}`);
});

app.listen(PORT, () => console.log(`Trading Grid demo MCP server on ${BASE} · connector URL ${BASE}/mcp/<MCP_TOKEN>`));
