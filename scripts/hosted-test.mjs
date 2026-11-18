// Hosting at /p/<id>, Aviator for hosted pages, the public read route and the model-key protections, end to end on a local
// server, driven from the route's own test page pages/_test.html in Chrome (Playwright). Prototype pages are not touched.
// The model is a local stand-in (GEMINI_API_BASE) that follows the model's tool protocol: it calls one of the side's read
// tools and answers from the result, writing codes on purpose so the plain-words pass is tested. It is never used on the
// deployed server, where the real model answers. Pages are opened in Chrome (Playwright) from /p/<id>.
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REG = JSON.parse(readFileSync(join(ROOT, 'pages', 'pages.json'), 'utf8')).pages;
const REGFILES = new Set(Object.keys(REG).filter((id) => existsSync(join(ROOT, 'pages', `${id}.html`))));
const MODEL_PORT = 3197, PORT = 3198, CAP_PORT = 3196; const B = `http://localhost:${PORT}`;
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + String(d).slice(0, 600)}`); if (!c) fails++; };

// ---- the stand-in model ----
const REFS = /\b(?:NR-\d{5,6}|INV-\d+C?|ASN-[\d-]+|RCV-[A-Z0-9-]+|DC-\d+|PMT-\d+|PD-[\d-]+|ACK-[\d-]+)\b/g;
// `lazy` makes the primary stand-in ignore the period a question names, as the real primary model did on 18 November, so the
// retry on the secondary model is exercised. The secondary stand-in always follows the period.
let lazy = false; const modelCalls = [];
const model = createServer((req, res) => { let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
  const body = JSON.parse(raw); const sys = body.systemInstruction.parts[0].text; const ashby = /acting for Priya Raman/.test(sys); const which = /stand-in-second/.test(req.url) ? 'secondary' : 'primary'; modelCalls.push(which);
  const last = body.contents.at(-1).parts; const fr = last.filter((p) => p.functionResponse);
  const say = (text) => res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }));
  const callT = (name, args) => res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }] }));
  res.setHeader('content-type', 'application/json');
  if (fr.length) { const name = fr[0].functionResponse.name; const r = fr[0].functionResponse.response.result; const txt = JSON.stringify(r);
    if (/Not available to/.test(r.result || '')) return say(`${r.result}. ${r.message || ''}`);
    const pc = r.period_covered || r['period covered'];
    if (name === 'get_scorecard' && r.warehouse) return say(`${r.warehouse_failing_lines} order lines failed at ${r.warehouse}, ${r.warehouse_failing_cases} cases, from ${pc.from} to ${pc.to}. Orders: ${r.lines.map((l) => l.po).join(', ')}.`);
    if (name === 'get_scorecard' || name === 'supplier_scorecard') return say(`${r.failing_lines} order lines failed from ${pc.from} to ${pc.to}; rate ${r.score}. ${(r.by_warehouse || []).map((w) => `${w.warehouse}: ${w.lines} lines, ${w.cases} cases (${w.by_reason.map((x) => `${x.reason} ${x.lines} lines ${x.cases} CA`).join('; ')})`).join('. ')}.`);
    if (name === 'open_order_value') return say(`${r.due_in_period.invoices} invoices fall due from ${pc.from} to ${pc.to}, $${r.due_in_period.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} on ${r.due_in_period.orders} open orders: ${r.due_in_period.list.map((d) => `${d.invoice} on ${d.po}`).join(', ')}.`);
    const refs = [...new Set(txt.match(REFS) || [])].slice(0, 3); const asOf = r.as_of || r.as_of_eastern || '';
    return say(`From ${refs.join(', ') || 'the records'}: line 1 shipped 270 CA under NF-7.8 (wms.load_scan); the order total is ${r.order_value ?? 'shown'}. As of ${asOf}.`); }
  const q = last.map((p) => p.text || '').join(' '); const po = (q.match(/NR-\d{5,6}/) || [])[0];
  const hint = q.match(/pass from (\d{4}-\d\d-\d\d) and to (\d{4}-\d\d-\d\d)/); const per = hint && !(lazy && which === 'primary') ? { from: hint[1], to: hint[2] } : {};
  if (/f[ae]ll(s)? due|open orders/i.test(q) && !ashby) return lazy && which === 'primary' ? callT('supplier_document_trail', { po: 'NR-450118' }) : callT('open_order_value', per);
  if (/Groveport/i.test(q) && ashby) return callT('get_scorecard', { warehouse: 'Kinross Groveport', ...per });
  if (/lines fail|calculated/i.test(q)) return callT(ashby ? 'get_scorecard' : 'supplier_scorecard', ashby ? per : { supplier: 'Ashby Supplier', ...per });
  if (/another supplier|Copper Ridge/i.test(q)) return callT(ashby ? 'get_order' : 'supplier_document_trail', ashby ? { po: po || 'NR-450118', supplier: 'Copper Ridge' } : { po: po || 'NR-450118' });
  if (ashby) return callT('get_order', { po: po || 'NR-450118' });
  return callT('supplier_document_trail', { po: po || 'NR-450118' });
}); });
await new Promise((r) => model.listen(MODEL_PORT, r));

const start = (port, env) => { const p = spawn(process.execPath, ['--no-warnings', join(ROOT, 'src/server.js')], { env: { ...process.env, PORT: String(port), GEMINI_API_KEY: 'stand-in', GEMINI_API_KEY_SECONDARY: 'stand-in-2', GEMINI_MODEL_SECONDARY: 'stand-in-second', GEMINI_MODEL: 'stand-in-model', GEMINI_API_BASE: `http://localhost:${MODEL_PORT}`, MCP_TOKEN: 'as-test', NF_TOKEN: 'nf-test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.out = () => out; return p; };
const up = async (port) => { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 250)); } return false; };
const srv = start(PORT, { AVIATOR_PER_MINUTE: '26', AVIATOR_PER_ADDRESS_DAY: '200', PUBLIC_PER_MINUTE: '30', MODEL_DAILY_CAP: '500' });
const cap = start(CAP_PORT, { MODEL_DAILY_CAP: '1' });
ok('server starts', await up(PORT), srv.out()); await up(CAP_PORT);
const post = (path, body, port = PORT, headers = {}) => fetch(`http://localhost:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const MOMENT = '2026-10-26T12:07:00.000Z'; const T = REG._test.token; const av = (b, port, tok = T) => post(`/aviator/${tok}`, b, port);
const { DatabaseSync } = await import('node:sqlite'); const { MAIN_DB } = await import('../world/build.js');

try {
  // ---- hosting ----
  const pg = await fetch(`${B}/p/_test`); const csp = pg.headers.get('content-security-policy') || '';
  ok('/p/_test serves pages/_test.html byte for byte', pg.status === 200 && (await pg.text()) === readFileSync(join(ROOT, 'pages', '_test.html'), 'utf8'));
  ok('hosted page headers: noindex, connect-src self', /noindex/.test(pg.headers.get('x-robots-tag') || '') && /connect-src 'self'/.test(csp), csp);
  ok('robots.txt disallows /p/', /Disallow: \/p\//.test(await (await fetch(`${B}/robots.txt`)).text()));
  ok('/p/p99 is not found; an unsynced page is not found', (await fetch(`${B}/p/p99`)).status === 404 && (await fetch(`${B}/p/p9`)).status === (REGFILES.has('p9') ? 200 : 404));
  const idx = await (await fetch(`${B}/p`)).json(); ok('the test page is listed nowhere', !JSON.stringify(idx).includes('_test') && !(await (await fetch(`${B}/`)).text()).includes('_test'));

  // ---- public read route ----
  const pub = await fetch(`${B}/public/ashby/tools/get_order?po=NR-450118`, { headers: { origin: 'https://example.org' } }); const pj = await pub.json();
  ok('public read with no token answers, with the CORS header', pub.status === 200 && pj.found === true && pub.headers.get('access-control-allow-origin') === '*', JSON.stringify(pj).slice(0, 200));
  for (const [side, tool, b] of [['ashby', 'submit_dispute', { case: 'DC-40877' }], ['ashby', 'release_ship_notice', { document: 'ASN-46220' }], ['ashby', 'request_change', { action: 'x' }], ['northfield', 'decide_charge', { case: 'DC-40877', charge: 'SH01', decision: 'Reversed' }], ['northfield', 'publish_rule', { draft: 'NFD-1' }], ['ashby', 'update_supplier_rule', { rule: 'AP-6.4', params: { carton: 80 }, apply: true }], ['ashby', 'pause_agent', { agent: 'claim' }], ['ashby', 'scout_start', {}], ['ashby', 'run_readonly_sql', { sql: 'select 1' }], ['ashby', 'get_access_log', {}]]) {
    const r = await post(`/public/${side}/tools/${tool}`, b); ok(`public ${side} ${tool} is refused`, r.status === 403 && (await r.json()).result === 'Refused'); }
  const x1 = await (await post('/public/ashby/tools/read_retailer_records', {})).json(); ok('Ashby public: Northfield private records refused', x1.result === 'Not available to Ashby', JSON.stringify(x1));
  const x2 = await (await post('/public/northfield/tools/read_supplier_records', {})).json(); ok('Northfield public: Ashby private records refused', x2.result === 'Not available to Northfield', JSON.stringify(x2));
  const x3 = await (await post('/public/ashby/tools/get_order', { po: 'NR-450118', supplier: 'Copper Ridge' })).json(); ok('Ashby public: another supplier refused', x3.result === 'Not available to Ashby', JSON.stringify(x3));
  const x4 = await (await post('/public/ashby/tools/list_draft_rules', {})).json(); ok('Ashby public: no Northfield tool', x4.result === 'Not found', JSON.stringify(x4));
  ok('page token opens no REST, MCP, admin or public data route', (await post(`/api/${T}/tools/get_order`, { po: 'NR-450118' })).status === 404 && (await post(`/mcp/${T}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status === 404 && (await fetch(`${B}/admin/${T}`)).status === 404 && (await post(`/public/${T}/tools/get_order`, {})).status === 404);
  const ldb = new DatabaseSync(MAIN_DB, { readOnly: true }); const pubRows = ldb.prepare("SELECT connection_id, tool, result FROM access_log WHERE connection_id LIKE 'public-%'").all();
  ok('public calls are logged as public-ashby and public-northfield', pubRows.some((r) => r.connection_id === 'public-ashby' && r.tool === 'get_order') && pubRows.some((r) => r.connection_id === 'public-northfield' && r.tool === 'read_supplier_records') && pubRows.some((r) => r.tool === 'submit_dispute' && /Refused/.test(r.result)), JSON.stringify(pubRows.slice(0, 6)));
  const events0 = ldb.prepare('SELECT count(*) n FROM events').get().n, props0 = ldb.prepare('SELECT count(*) n FROM proposals').get().n;

  // ---- Aviator for hosted pages ----
  const a1 = await (await av({ question: 'Where does NR-451207 stand?', side: 'ashby' })).json();
  ok('no as_of: answered at the page moment, never the story clock', a1.ok && a1.as_of === MOMENT && /2026-10-26/.test(a1.answer), JSON.stringify(a1));
  ok('answer has no rule codes, unit codes or field names; quantities in cases', a1.ok && !/\bNF-\d|\bAP-\d|\bCA\b|\bEA\b|wms\.|load_scan|_/.test(a1.answer) && /270 cases/.test(a1.answer) && /Northfield’s rule/.test(a1.answer), a1.answer);
  ok('records read are listed by business name', a1.ok && a1.read.some((r) => r.name === 'Purchase order NR-451207'), JSON.stringify(a1.read));
  ok('answers only: no action card in the reply', a1.ok && Object.keys(a1).sort().join() === 'answer,as_of,as_of_eastern,ok,read,side', Object.keys(a1).join());
  const a2 = await (await av({ question: 'Where does NR-451207 stand?', side: 'ashby', as_of: '2026-10-27T15:00:00Z' })).json();
  ok('as_of inside the page window is used', a2.ok && a2.as_of === '2026-10-27T15:00:00.000Z', JSON.stringify(a2).slice(0, 300));
  for (const [n, v] of [['after the window', '2026-12-28T14:00:00Z'], ['before the moment', '2026-10-01T14:00:00Z'], ['not a date', 'tomorrow']]) { const r = await av({ question: 'Where does NR-450118 stand?', side: 'ashby', as_of: v }); const j = await r.json();
    ok(`token with a moment outside its binding is refused (${n})`, r.status === 403 && j.ok === false && /own moment/.test(j.message), JSON.stringify(j)); }
  { const r = await av({ question: 'Where does NR-450118 stand?', side: 'northfield', as_of: '2026-10-01T14:00:00Z' }, PORT, REG.p14.token); ok('a page with an open window end still refuses a moment before its opening', r.status === 403);
    const r2 = await (await av({ question: 'Where does NR-450118 stand?', side: 'northfield' }, PORT, REG.p14.token)).json(); ok('a page with an open window end defaults to its opening moment', r2.ok && r2.as_of === '2026-11-10T14:00:00.000Z', JSON.stringify(r2).slice(0, 200)); }
  const a3 = await av({ question: 'Where does NR-450118 stand?', side: 'ashby' }, PORT, REG.p14.token); const a3j = await a3.json();
  ok('token with a side outside its binding is refused', a3.status === 403 && a3j.ok === false && /does not show/.test(a3j.message), JSON.stringify(a3j));
  const a3b = await av({ question: 'x', side: 'kinross' }); ok('unknown side is refused', a3b.status === 403);
  const a4 = await (await av({ question: 'What does Copper Ridge have on NR-450118, another supplier?', side: 'ashby' })).json();
  ok('the other company’s records are refused through Aviator', a4.ok && /Not available to Ashby/.test(a4.answer), JSON.stringify(a4));
  const l1 = await av({ question: 'x'.repeat(501), side: 'ashby' }); const l1j = await l1.json(); ok('a question over 500 characters is refused', l1.status === 400 && /500 characters/.test(l1j.message), JSON.stringify(l1j));
  ok('a question of 500 characters is taken', (await av({ question: 'Where does NR-451207 stand? '.padEnd(500, 'x'), side: 'ashby' })).status === 200);
  const l2 = await av({ question: 'And now?', side: 'ashby', history: Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 't' })) }); const l2j = await l2.json(); ok('a history over 10 turns is refused', l2.status === 400 && /10 turns/.test(l2j.message), JSON.stringify(l2j));
  ok('a history of 10 turns is taken', (await av({ question: 'Where does NR-451207 stand?', side: 'ashby', history: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 't' })) })).status === 200);
  const rows = ldb.prepare("SELECT connection_id, tool, arguments, result FROM access_log WHERE connection_id LIKE 'aviator-%'").all();
  const avRow = rows.filter((r) => r.connection_id === 'aviator-_test-ashby' && r.tool === 'aviator' && /^Answered/.test(r.result)).map((r) => JSON.parse(r.arguments))[0];
  ok('Aviator calls are logged as aviator-<prototype>-<side> with question length, tools, model route and time', !!avRow && avRow.question_chars === 27 && avRow.tools.join() === 'get_order' && /stand-in-model/.test(avRow.model_route) && typeof avRow.ms === 'number', JSON.stringify(avRow));
  ok('the log holds no question or answer text', !rows.some((r) => /Where does|line 1 shipped|270/.test(r.arguments + r.result)), '');
  ok('tool calls ran at the page moment', rows.some((r) => r.tool === 'get_order' && JSON.parse(r.arguments).as_of === MOMENT));

  // ---- periods: "this week" and named weeks resolve from as_of; a wrong-period answer is retried on the secondary model ----
  // The three questions the build chat found answered wrongly on 18 November, with their answers from the records
  // (the gate pins the same figures: scorecard.week_of_22_november, scorecard.groveport_lines, open_orders.due_this_week).
  const P7 = REG.p7.token, P8 = REG.p8.token;
  const w1 = await (await av({ question: 'Why did lines fail in the week of 22 November?', side: 'ashby' }, PORT, P7)).json();
  ok('P7 at 28 December: the week of 22 November is answered for 22 to 28 November, not the quarter', w1.ok && w1.as_of === '2026-12-28T14:00:00.000Z' && w1.period.from === '2026-11-22' && w1.period.to === '2026-11-28' && /^10 order lines failed from 2026-11-22 to 2026-11-28; rate 83\.6%/.test(w1.answer) && !/108/.test(w1.answer), JSON.stringify(w1));
  ok('P7: that week splits across both warehouses, in cases', /Kinross Groveport: 6 lines, 260 cases \(Short shipped, remainder cancelled 4 lines 258 cases; Received below ship notice 2 lines 2 cases\)/.test(w1.answer) && /Kinross Joliet: 4 lines, 123 cases \(Short shipped, remainder cancelled 2 lines 121 cases/.test(w1.answer), w1.answer);
  const w2 = await (await av({ question: 'Which lines failed at Kinross Groveport?', side: 'ashby' }, PORT, P7)).json(); const grv = (w2.answer || '').match(/NR-\d+/g) || [];
  const exp = new DatabaseSync(MAIN_DB, { readOnly: true }).prepare("SELECT DISTINCT s.po FROM shipments s JOIN orders o ON o.po = s.po WHERE s.ship_from = 'KIN-GRV' AND o.stream = 'replenishment'").all().map((r) => r.po);
  ok('P7: the Groveport answer lists the 44 Groveport lines (1,581 cases) and only orders shipped from Groveport', w2.ok && /^44 order lines failed at Kinross Groveport, 1581 cases, from 2026-09-27 to 2026-12-26/.test(w2.answer) && grv.length === 44 && grv.every((po) => exp.includes(po)), JSON.stringify(w2).slice(0, 500));
  const w3 = await (await av({ question: 'What falls due this week?', side: 'northfield' }, PORT, P8)).json();
  ok('P8 at 8 November 23:59: this week is 8 to 14 November, from as_of', w3.ok && w3.as_of === '2026-11-09T04:59:00.000Z' && w3.period.from === '2026-11-08' && w3.period.to === '2026-11-14', JSON.stringify(w3).slice(0, 300));
  ok('P8: 10 invoices, $1,056,413.30, on 10 open orders, not a single order', w3.ok && /^10 invoices fall due from 2026-11-08 to 2026-11-14, \$1,056,413\.30 on 10 open orders/.test(w3.answer) && (w3.answer.match(/NR-\d+/g) || []).length === 10, w3.answer);
  ok('P8 token is Northfield only', (await av({ question: 'What falls due this week?', side: 'ashby' }, PORT, P8)).status === 403);
  lazy = true; modelCalls.length = 0;
  const r1 = await (await av({ question: 'Why did lines fail in the week of 22 November?', side: 'ashby' }, PORT, P7)).json();
  ok('an answer for another period is retried on the secondary model and comes back for the week asked', r1.ok && /^10 order lines failed from 2026-11-22 to 2026-11-28/.test(r1.answer) && modelCalls.join() === 'primary,primary,secondary,secondary', `${modelCalls.join()} ${JSON.stringify(r1).slice(0, 300)}`);
  const r2 = await (await av({ question: 'What falls due this week?', side: 'northfield' }, PORT, P8)).json();
  ok('a single-order answer to a this-week question is retried on the secondary model', r2.ok && /^10 invoices fall due from 2026-11-08 to 2026-11-14/.test(r2.answer), JSON.stringify(r2).slice(0, 300));
  { const row = new DatabaseSync(MAIN_DB, { readOnly: true }).prepare("SELECT arguments FROM access_log WHERE connection_id = 'aviator-p7-ashby' AND tool = 'aviator' ORDER BY id DESC LIMIT 1").get(); const a = JSON.parse(row.arguments);
    ok('the retry is logged with its period and model route', a.retried_for_period_on === 'secondary' && a.period === '2026-11-22 to 2026-11-28' && /secondary · stand-in-second/.test(a.model_route), row.arguments); }
  lazy = false;
  for (const [qq, f, t] of [['What fell due last week?', '2026-11-01', '2026-11-07'], ['What falls due next week?', '2026-11-15', '2026-11-21'], ['What falls due 9 to 15 November?', '2026-11-09', '2026-11-15']]) { const j = await (await av({ question: qq, side: 'northfield' }, PORT, P8)).json();
    ok(`"${qq}" resolves to ${f} to ${t}`, j.ok && j.period.from === f && j.period.to === t && j.answer.includes(`from ${f} to ${t}`), JSON.stringify(j).slice(0, 240)); }

  // ---- daily cap on model calls ----
  await av({ question: 'Where does NR-451207 stand?', side: 'ashby' }, CAP_PORT);
  const c2 = await av({ question: 'Where does NR-451207 stand?', side: 'ashby' }, CAP_PORT); const c2j = await c2.json();
  ok('daily model cap returns its plain message', c2.status === 429 && /daily limit of answers/.test(c2j.message), `${c2.status} ${JSON.stringify(c2j)}`);

  // ---- the test page in Chrome ----
  const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext(); const p = await ctx.newPage(); const errs = []; const hosts = new Set();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/429|40[03]/.test(m.text())) errs.push(m.text()); }); p.on('request', (r) => hosts.add(new URL(r.url()).host));
  await p.goto(`${B}/p/_test`);
  const ask = async (q) => { const n = await p.$$eval('#log .a', (x) => x.length); await p.fill('#q', q); await p.click('#send'); await p.waitForFunction((k) => document.querySelectorAll('#log .a').length > k, n, { timeout: 30000 }); return p.$eval('#log .a:last-child', (e) => e.innerText); };
  const t1 = await ask('Where does NR-450118 stand?');
  ok('/p/_test Ashby: a typed question returns an answer citing records by business name', /Read: [^\n]*Purchase order NR-450118/.test(t1) && !/\bNF-\d|\bCA\b|[a-z]+\.[a-z_]+\b/.test(t1.replace(/\d\.\d/g, '')), t1);
  ok('/p/_test Ashby: answered at the page moment with no as_of sent', /2026-10-26/.test(t1), t1);
  await p.selectOption('#side', 'northfield'); const t2 = await ask('Where does NR-450118 stand?');
  ok('/p/_test Northfield: a typed question returns an answer citing records by business name', /Read: [^\n]*NR-450118/.test(t2), t2);
  ok('the Northfield question ran on Northfield’s connection', ldb.prepare("SELECT count(*) n FROM access_log WHERE connection_id = 'aviator-_test-northfield' AND tool = 'supplier_document_trail'").get().n >= 1);
  const codes = await p.evaluate(async (tok) => { const out = []; for (let i = 0; i < 30; i++) out.push((await fetch(`/aviator/${tok}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Where does NR-451207 stand?', side: 'ashby' }) })).status); return out; }, T);
  const t3 = await ask('Where does NR-451207 stand?');
  ok('rate limit answers 429 and its message shows on the page', codes.includes(429) && /Wait a minute and ask again/.test(t3), `${codes.join(',')} · ${t3}`);
  ok('/p/_test: requests only to this server, no console errors', [...hosts].every((h) => h === `localhost:${PORT}`) && errs.length === 0, `${[...hosts].join(', ')} ${errs.join(' | ')}`);
  await br.close();
  { const codes = []; for (let i = 0; i < 40; i++) codes.push((await fetch(`${B}/public/ashby/tools/get_story_calendar`)).status); const last = await (await fetch(`${B}/public/ashby/tools/get_story_calendar`)).json();
    ok('public read rate limit answers 429 with its message', codes.includes(429) && /limit of requests per minute/.test(last.message || ''), `${codes.join(',')}`); }
  ok('no record was written by any public or Aviator call', ldb.prepare('SELECT count(*) n FROM events').get().n === events0 && ldb.prepare('SELECT count(*) n FROM proposals').get().n === props0);
} finally { srv.kill(); cap.kill(); model.close(); }
console.log(`${fails ? 'FAILED' : 'All hosted checks passed'}: ${fails} failed`); process.exit(fails ? 1 : 0);
