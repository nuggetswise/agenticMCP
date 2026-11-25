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
  // The whole conversation's user text (the question with its server facts), the last tool result, and whether the server
  // sent the last answer back with its check's reasons.
  const q0 = body.contents.filter((c) => c.role === 'user').map((c) => (c.parts || []).map((p) => p.text || '').join(' ')).join(' ');
  const lastText = last.map((p) => p.text || '').join(' '); const rechecked = /^The server checked that answer/.test(lastText);
  const lastFr = [...body.contents].reverse().flatMap((c) => (c.parts || []).filter((p) => p.functionResponse))[0];
  const outsideFact = q0.match(/The owner is ([^,]+), in ([^.]+)\. Tell/);
  if (fr.length || rechecked) { const name = lastFr.functionResponse.name; const r = lastFr.functionResponse.response.result; const txt = JSON.stringify(r);
    if (outsideFact) return say(`That is done outside Trading Grid, so I can't raise anything for it here. ${outsideFact[1]} owns it, in ${outsideFact[2]}.`);
    // "Waive the disputes with a complete pack": the stand-in reads Northfield's case list and raises one card per charge the
    // evidence rules recommend waiving, as several calls in one turn, as the model does.
    if (name === 'list_deduction_cases' && /complete pack/.test(q0) && !rechecked) { const want = (r.cases || []).flatMap((c) => (c.charges || []).filter((x) => x.recommendation?.decision === 'Waived').map((x) => ({ action: 'decide_charge', case: c.case, charge: x.charge, decision: 'Waived' })));
      return want.length ? res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: want.map((a) => ({ functionCall: { name: 'propose_action', args: a } })) } }] })) : say('No dispute awaiting a decision has a complete pack.'); }
    if (name === 'propose_action' && fr.length > 1) { const cs = fr.map((p) => p.functionResponse.response.result).filter((x) => x && x.card).map((x) => x.card);
      return say(`Cards are ready to waive the shortage charge on ${cs.map((c) => c.record).join(' and ')}. Nothing happens until you press Approve on each.`); }
    if (name === 'propose_action') {
      // [lie]: the stand-in first describes the card wrongly, as Gemini did on 19 November; the server sends it back.
      if (/\[lie\]/.test(q0) && !rechecked) return say('I have sent the application advice to Ashby with your message "Please call us about this invoice" on line 4.');
      if (!r.card) return say(`There is no card for that. ${r.facts || r.reason || ''}`);
      const c = r.card; const ls = (c.lines || []).filter((l) => l.line).map((l) => `line ${l.line}`);
      if (r.refused_line) { const f = r.refused_line; return say(`Northfield's rules find no error on line ${f.asked_lines.join(' or ')}${f.missing.length ? `, which the invoice does not have` : ''}; they find errors on ${f.lines.map((l) => `line ${l}`).join(' and ')}. The card is for ${f.lines.map((l) => `line ${l}`).join(' and ')} and carries no message until you give one. Nothing happens until you press Approve.`); }
      return say(`The card is ready: ${c.label.toLowerCase()} to ${c.to}, on ${c.record}${ls.length ? ` for ${ls.join(' and ')}` : ''}${c.message ? `, with the message "${c.message.text}"` : ''}. Nothing happens until you press Approve.`); }
    if (/Not available to/.test(r.result || '')) return say(`${r.result}. ${r.message || ''}`);
    const pc = r.period_covered || r['period covered'];
    if (name === 'get_scorecard' && r.warehouse) return say(`${r.warehouse_failing_lines} order lines failed at ${r.warehouse}, ${r.warehouse_failing_cases} cases, in the period asked. Orders: ${r.lines.map((l) => l.po).join(', ')}.`);
    if (name === 'get_scorecard' || name === 'supplier_scorecard') return say(`${r.failing_lines} order lines failed in the period asked; rate ${r.score}. ${(r.by_warehouse || []).map((w) => `${w.warehouse}: ${w.lines} lines, ${w.cases} cases (${w.by_reason.map((x) => `${x.reason} ${x.lines} lines ${x.cases} cases`).join('; ')})`).join('. ')}.`);
    if (name === 'open_order_value') return say(`${r.due_in_period.invoices} invoices fall due in the period asked, $${r.due_in_period.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} on ${r.due_in_period.orders} open orders: ${r.due_in_period.list.map((d) => `${d.invoice} on ${d.po}`).join(', ')}.`);
    const refs = [...new Set(txt.match(REFS) || [])].slice(0, 3); const asOf = r.as_of || r.as_of_eastern || '';
    if (/\[invent\]/.test(q0) && !rechecked) return say(`INV-7731 is held: receiving advice REC-450118 shows 119 cases on line 2 against 120 billed.`);
    if (/\[none\]/.test(q0) && !rechecked) return say('All recent rejections have been fixed and confirmed, so nothing needs action.');
    // First the stand-in writes codes, as the model sometimes does; sent back with the reason, it writes plain words.
    return say(rechecked ? `From ${refs.join(', ') || 'the records'}: 270 cases shipped under Northfield’s matching rule, from the Kinross load scan.`
      : `From ${refs.join(', ') || 'the records'}: 270 CA shipped under NF-7.8 (wms.load_scan).`); }
  const q = last.map((p) => p.text || '').join(' '); const po = (q.match(/NR-\d{5,6}/) || [])[0];
  // The person asked for an action: the stand-in names it and its record, as the model does, and the server builds the card.
  if (/complete pack/.test(q)) return callT('list_deduction_cases', {});
  const cardAsk = q.match(/\[card (\w+) (\{.*\})\]/); if (cardAsk) return callT('propose_action', { action: cardAsk[1], ...JSON.parse(cardAsk[2]) });
  const adv = q.match(/call propose_action with answer_application_advice(?: \(advice ([A-Z0-9-]+)\))?/); if (adv) return callT('propose_action', { action: 'answer_application_advice', ...(adv[1] ? { advice: adv[1] } : {}) });
  // Ordinary words that ask for the action the records call for on the record on screen, as the model reads them.
  const screen = (q.match(/On screen: ((?:INV|ASN)-[A-Z0-9-]+)/) || [])[1];
  if (screen && /fix the invoice|sort this out|can you handle it/i.test(q)) return callT('propose_action', /^ASN-/.test(screen) ? { action: 'release_held_ship_notice', document: screen } : ashby ? { action: 'answer_application_advice', advice: `AA-${screen}` } : { action: 'send_application_advice', document: screen });
  // Like Gemini on 19 November, the stand-in drafts its own messages (the rule's cause); the person's words must win.
  const rej = q.match(/\breject (INV-\d+)/i); if (rej && !ashby) return callT('propose_action', { action: 'send_application_advice', document: rej[1], messages: [{ code: 'QTY', message: 'Invoice quantity above accepted quantity' }] });
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
  for (const [side, tool, b] of [['ashby', 'submit_dispute', { case: 'DC-40877' }], ['ashby', 'release_ship_notice', { document: 'ASN-46220' }], ['northfield', 'decide_charge', { case: 'DC-40877', charge: 'SH01', decision: 'Waived' }], ['northfield', 'publish_rule', { draft: 'NFD-1' }], ['ashby', 'update_supplier_rule', { rule: 'AP-6.4', params: { carton: 80 }, apply: true }], ['ashby', 'pause_agent', { agent: 'claim' }], ['ashby', 'scout_start', {}], ['ashby', 'run_readonly_sql', { sql: 'select 1' }], ['ashby', 'get_access_log', {}]]) {
    const r = await post(`/public/${side}/tools/${tool}`, b); ok(`public ${side} ${tool} is refused`, r.status === 403 && (await r.json()).result === 'Refused'); }
  // There is no general request tool: Trading Grid sends only business documents.
  for (const side of ['ashby', 'northfield']) { const r = await post(`/public/${side}/tools/request_change`, { action: 'x' }); ok(`public ${side} has no request_change`, r.status === 404 && (await r.json()).result === 'Not found'); }
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
  ok('no as_of: answered at the page moment, never the story clock', a1.ok && a1.as_of === MOMENT, JSON.stringify(a1));
  ok('an answer with codes is sent back to the model, which writes it in plain words; the server never rewrites it', a1.ok && a1.answer_from === 'model' && !/\bNF-\d|\bAP-\d|\bCA\b|\bEA\b|wms\.|load_scan|_/.test(a1.answer) && /270 cases/.test(a1.answer) && /Northfield’s matching rule/.test(a1.answer), a1.answer);
  { const row = new DatabaseSync(MAIN_DB, { readOnly: true }).prepare("SELECT arguments FROM access_log WHERE tool = 'aviator' AND connection_id = 'aviator-_test-ashby' ORDER BY id DESC LIMIT 1").get(); ok('the recheck is logged', JSON.parse(row?.arguments || '{}').rechecks >= 1, row?.arguments); }
  ok('records read are listed by business name', a1.ok && a1.read.some((r) => r.name === 'Purchase order NR-451207'), JSON.stringify(a1.read));
  ok('a question that asks for no action gets an answer and no card, in its own session', a1.ok && Object.keys(a1).sort().join() === 'also_read,answer,answer_from,as_of,as_of_eastern,cards,ok,read,session,side' && a1.cards.length === 0 && /^VS-/.test(a1.session), Object.keys(a1).join());
  const a2 = await (await av({ question: 'Where does NR-451207 stand?', side: 'ashby', as_of: '2026-10-27T15:00:00Z' })).json();
  ok('as_of inside the page window is used', a2.ok && a2.as_of === '2026-10-27T15:00:00.000Z', JSON.stringify(a2).slice(0, 300));
  for (const [n, v] of [['after the window', '2027-02-01T14:00:00Z'], ['before the moment', '2026-10-01T14:00:00Z'], ['not a date', 'tomorrow']]) { const r = await av({ question: 'Where does NR-450118 stand?', side: 'ashby', as_of: v }); const j = await r.json();
    ok(`token with a moment outside its binding is refused (${n})`, r.status === 403 && j.ok === false && j.error === 'outside_page_window' && !j.message, JSON.stringify(j)); }
  { const r = await av({ question: 'Where does NR-450118 stand?', side: 'northfield', as_of: '2026-10-01T14:00:00Z' }, PORT, REG.p14.token); ok('a page with an open window end still refuses a moment before its opening', r.status === 403);
    const r2 = await (await av({ question: 'Where does NR-450118 stand?', side: 'northfield' }, PORT, REG.p14.token)).json(); ok('a page with an open window end defaults to its opening moment', r2.ok && r2.as_of === '2026-11-10T14:00:00.000Z', JSON.stringify(r2).slice(0, 200)); }
  const a3 = await av({ question: 'Where does NR-450118 stand?', side: 'ashby' }, PORT, REG.p14.token); const a3j = await a3.json();
  ok('token with a side outside its binding is refused', a3.status === 403 && a3j.ok === false && a3j.error === 'side_not_on_page', JSON.stringify(a3j));
  const a3b = await av({ question: 'x', side: 'kinross' }); ok('unknown side is refused', a3b.status === 403);
  const a4 = await (await av({ question: 'What does Copper Ridge have on NR-450118, another supplier?', side: 'ashby' })).json();
  ok('the other company’s records are refused through Aviator', a4.ok && /Not available to Ashby/.test(a4.answer), JSON.stringify(a4));
  const l1 = await av({ question: 'x'.repeat(501), side: 'ashby' }); const l1j = await l1.json(); ok('a question over 500 characters is refused', l1.status === 400 && l1j.error === 'question_too_long', JSON.stringify(l1j));
  ok('a question of 500 characters is taken', (await av({ question: 'Where does NR-451207 stand? '.padEnd(500, 'x'), side: 'ashby' })).status === 200);
  const l2 = await av({ question: 'And now?', side: 'ashby', history: Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 't' })) }); const l2j = await l2.json(); ok('a history over 10 turns is refused', l2.status === 400 && l2j.error === 'too_many_turns' && l2j.max === 10, JSON.stringify(l2j));
  ok('a history of 10 turns is taken', (await av({ question: 'Where does NR-451207 stand?', side: 'ashby', history: Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 't' })) })).status === 200);
  const rows = ldb.prepare("SELECT connection_id, tool, arguments, result FROM access_log WHERE connection_id LIKE 'aviator-%'").all();
  const avRow = rows.filter((r) => r.connection_id === 'aviator-_test-ashby' && r.tool === 'aviator' && /^Answered/.test(r.result)).map((r) => JSON.parse(r.arguments))[0];
  ok('Aviator calls are logged as aviator-<prototype>-<side> with question length, tools, model route and time', !!avRow && avRow.question_chars === 27 && avRow.tools.join() === 'get_order' && /stand-in-model/.test(avRow.model_route) && typeof avRow.ms === 'number', JSON.stringify(avRow));
  ok('the log holds no question or answer text', !rows.some((r) => /Where does|270 cases|270 CA/.test(r.arguments + r.result)), '');
  ok('tool calls ran at the page moment', rows.some((r) => r.tool === 'get_order' && JSON.parse(r.arguments).as_of === MOMENT));

  // ---- periods: "this week" and named weeks resolve from as_of; a wrong-period answer is retried on the secondary model ----
  // The three questions the build chat found answered wrongly on 18 November, with their answers from the records
  // (the gate pins the same figures: scorecard.week_of_22_november, scorecard.groveport_lines, open_orders.due_this_week).
  const P7 = REG.p7.token, P8 = REG.p8.token;
  const w1 = await (await av({ question: 'Why did lines fail in the week of 22 November?', side: 'ashby' }, PORT, P7)).json();
  ok('P7 at 28 December: the week of 22 November is answered for 22 to 28 November, not the quarter', w1.ok && w1.as_of === '2026-12-28T14:00:00.000Z' && w1.period.from === '2026-11-22' && w1.period.to === '2026-11-28' && /^10 order lines failed in the period asked; rate 83\.6%/.test(w1.answer) && !/108/.test(w1.answer), JSON.stringify(w1));
  ok('P7: that week splits across both warehouses, in cases', /Kinross Groveport: 6 lines, 260 cases \(Short shipped, remainder cancelled 4 lines 258 cases; Received below ship notice 2 lines 2 cases\)/.test(w1.answer) && /Kinross Joliet: 4 lines, 123 cases \(Short shipped, remainder cancelled 2 lines 121 cases/.test(w1.answer), w1.answer);
  const w2 = await (await av({ question: 'Which lines failed at Kinross Groveport?', side: 'ashby' }, PORT, P7)).json(); const grv = (w2.answer || '').match(/NR-\d+/g) || [];
  const exp = new DatabaseSync(MAIN_DB, { readOnly: true }).prepare("SELECT DISTINCT s.po FROM shipments s JOIN orders o ON o.po = s.po WHERE s.ship_from = 'KIN-GRV' AND o.stream = 'replenishment'").all().map((r) => r.po);
  ok('P7: the Groveport answer lists the 44 Groveport lines (1,581 cases) and only orders shipped from Groveport', w2.ok && /^44 order lines failed at Kinross Groveport, 1581 cases, in the period asked/.test(w2.answer) && grv.length === 44 && grv.every((po) => exp.includes(po)), JSON.stringify(w2).slice(0, 500));
  const w3 = await (await av({ question: 'What falls due this week?', side: 'northfield' }, PORT, P8)).json();
  ok('P8 at 8 November 23:59: this week is 8 to 14 November, from as_of', w3.ok && w3.as_of === '2026-11-09T04:59:00.000Z' && w3.period.from === '2026-11-08' && w3.period.to === '2026-11-14', JSON.stringify(w3).slice(0, 300));
  ok('P8: 10 invoices, $1,056,413.30, on 10 open orders, not a single order', w3.ok && /^10 invoices fall due in the period asked, \$1,056,413\.30 on 10 open orders/.test(w3.answer) && (w3.answer.match(/NR-\d+/g) || []).length === 10, w3.answer);
  ok('P8 token serves both sides (Ashby added 24 November); a side off the page is refused', (await av({ question: 'What falls due this week?', side: 'kinross' }, PORT, P8)).status === 403);
  lazy = true; modelCalls.length = 0;
  const r1 = await (await av({ question: 'Why did lines fail in the week of 22 November?', side: 'ashby' }, PORT, P7)).json();
  ok('an answer for another period is retried on the secondary model and comes back for the week asked', r1.ok && /^10 order lines failed in the period asked/.test(r1.answer) && modelCalls.join() === 'primary,primary,secondary,secondary', `${modelCalls.join()} ${JSON.stringify(r1).slice(0, 300)}`);
  const r2 = await (await av({ question: 'What falls due this week?', side: 'northfield' }, PORT, P8)).json();
  ok('a single-order answer to a this-week question is retried on the secondary model', r2.ok && /^10 invoices fall due in the period asked/.test(r2.answer), JSON.stringify(r2).slice(0, 300));
  { const row = new DatabaseSync(MAIN_DB, { readOnly: true }).prepare("SELECT arguments FROM access_log WHERE connection_id = 'aviator-p7-ashby' AND tool = 'aviator' ORDER BY id DESC LIMIT 1").get(); const a = JSON.parse(row.arguments);
    ok('the retry is logged with its period and model route', a.retried_for_period_on === 'secondary' && a.period === '2026-11-22 to 2026-11-28' && /secondary · stand-in-second/.test(a.model_route), row.arguments); }
  lazy = false;
  for (const [qq, f, t] of [['What fell due last week?', '2026-11-01', '2026-11-07'], ['What falls due next week?', '2026-11-15', '2026-11-21'], ['What falls due 9 to 15 November?', '2026-11-09', '2026-11-15']]) { const j = await (await av({ question: qq, side: 'northfield' }, PORT, P8)).json();
    ok(`"${qq}" resolves to ${f} to ${t}`, j.ok && j.period.from === f && j.period.to === t && j.answer.includes('in the period asked'), JSON.stringify(j).slice(0, 240)); }

  // ---- daily cap on model calls ----
  await av({ question: 'Where does NR-451207 stand?', side: 'ashby' }, CAP_PORT);
  const c2 = await av({ question: 'Where does NR-451207 stand?', side: 'ashby' }, CAP_PORT); const c2j = await c2.json();
  ok('daily model cap returns its error code', c2.status === 429 && c2j.error === 'daily_cap' && !c2j.message, `${c2.status} ${JSON.stringify(c2j)}`);

  // ---- the test page in Chrome ----
  const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext(); const p = await ctx.newPage(); const errs = []; const hosts = new Set();
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/429|40[03]/.test(m.text())) errs.push(m.text()); }); p.on('request', (r) => hosts.add(new URL(r.url()).host));
  await p.goto(`${B}/p/_test`);
  const ask = async (q) => { const n = await p.$$eval('#log .a', (x) => x.length); await p.fill('#q', q); await p.click('#send'); await p.waitForFunction((k) => document.querySelectorAll('#log .a').length > k, n, { timeout: 30000 }); return p.$eval('#log .a:last-child', (e) => e.innerText); };
  const t1 = await ask('Where does NR-450118 stand?');
  ok('/p/_test Ashby: a typed question returns an answer citing records by business name', /Read: [^\n]*Purchase order NR-450118/.test(t1) && !/\bNF-\d|\bCA\b|[a-z]+\.[a-z_]+\b/.test(t1.replace(/\d\.\d/g, '')), t1);
  ok('/p/_test Ashby: answered with no as_of sent, and the answer carries no date (the moment itself is checked on the route above)', /270 cases/.test(t1) && !/20\d\d-\d\d-\d\d/.test(t1), t1);
  await p.selectOption('#side', 'northfield'); const t2 = await ask('Where does NR-450118 stand?');
  ok('/p/_test Northfield: a typed question returns an answer citing records by business name', /Read: [^\n]*NR-450118/.test(t2), t2);
  ok('the Northfield question ran on Northfield’s connection', ldb.prepare("SELECT count(*) n FROM access_log WHERE connection_id = 'aviator-_test-northfield' AND tool = 'supplier_document_trail'").get().n >= 1);
  const codes = await p.evaluate(async (tok) => { const out = []; for (let i = 0; i < 30; i++) out.push((await fetch(`/aviator/${tok}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Where does NR-451207 stand?', side: 'ashby' }) })).status); return out; }, T);
  const t3 = await ask('Where does NR-451207 stand?');
  ok('rate limit answers 429 and its message shows on the page', codes.includes(429) && /Wait a minute and ask again/.test(t3), `${codes.join(',')} · ${t3}`);
  ok('/p/_test: requests only to this server, no console errors', [...hosts].every((h) => h === `localhost:${PORT}`) && errs.length === 0, `${[...hosts].join(', ')} ${errs.join(' | ')}`);
  await br.close();
  { const codes = []; for (let i = 0; i < 40; i++) codes.push((await fetch(`${B}/public/ashby/tools/get_story_calendar`)).status); const last = await (await fetch(`${B}/public/ashby/tools/get_story_calendar`)).json();
    ok('public read rate limit answers 429 with its message', codes.includes(429) && last.error === 'rate_limited' && !last.message, `${codes.join(',')}`); }
  // The limit is per viewer: behind Cloudflare the viewer is CF-Connecting-IP, and an X-Forwarded-For a client adds moves nothing.
  { const at = (h) => fetch(`${B}/public/ashby/tools/get_story_calendar`, { headers: h }).then((r) => r.status);
    const spoof = []; for (let i = 0; i < 5; i++) spoof.push(await at({ 'x-forwarded-for': `10.9.0.${i}` }));
    const a = []; for (let i = 0; i < 45; i++) a.push(await at({ 'cf-connecting-ip': '203.0.113.7' }));
    const other = await at({ 'cf-connecting-ip': '203.0.113.8' });
    ok('the per-address limit follows the viewer, not a header the client adds', spoof.every((c) => c === 429) && a.includes(429) && other === 200, `spoofed ${spoof.join(',')} · viewer A ${a.slice(-3).join(',')} · viewer B ${other}`); }

  // ---- Action cards on _test: every write tool, the 824 with a message, Ashby's 824 request, an email refused, a double press, a second viewer ----
  { const V1 = { 'cf-connecting-ip': '203.0.113.50' }, V2 = { 'cf-connecting-ip': '203.0.113.51' };
    const ask = async (h, body) => (await post(`/aviator/${T}`, body, PORT, h)).json();
    const press = async (h, card, session, decision = 'approve') => { const r = await post(`/aviator/${T}/cards/${card}`, { session, decision }, PORT, h); return { status: r.status, ...(await r.json()) }; };
    const pub = async (side, tool, q, session) => (await fetch(`${B}/public/${side}/tools/${tool}?${new URLSearchParams({ ...q, ...(session ? { session } : {}) })}`, { headers: V2 })).json();
    let session = null; const card = async (side, question, as_of) => { const r = await ask(V1, { question, side, as_of, ...(session ? { session } : {}) }); session = r.session || session; return r; };
    const derived0 = Object.fromEntries(['invoices', 'invoice_lines', 'errors', 'shipments', 'shipment_lines'].map((t) => [t, ldb.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
    const main0 = ldb.prepare('SELECT count(*) n FROM events').get().n, docs0 = ldb.prepare('SELECT count(*) n FROM documents').get().n;
    const steps = [
      ['submit_dispute', 'ashby', 'Open a dispute on DC-40877 [card open_dispute {"case":"DC-40877"}]', '2026-12-01T09:00:00-05:00', (r) => r.record?.history?.some((h) => h.record === 'case.dispute' && h.charge === 'SH01' && h.approved_by === 'Priya Raman' && h.via === 'action card')],
      ['release_ship_notice', 'ashby', 'Release the held ship notice ASN-462410 [card release_held_ship_notice {"document":"ASN-462410"}]', '2026-11-18T15:10:00-05:00', (r) => /Released/.test(JSON.stringify(r.record)) && /action card/.test(JSON.stringify(r.record))],
      ['send_document (855)', 'ashby', 'Send the acknowledgment for NR-46210 [card send_acknowledgment {"po":"NR-46210"}]', '2026-11-18T09:00:00-05:00', (r) => r.record?.found && r.record.reference === 'ACK-46210-S' && /BAK\*00\*AD\*NR-46210/.test(r.record.x12)],
      ['send_application_advice (824 with message)', 'northfield', 'Reject INV-7731 with an application advice [card send_application_advice {"document":"INV-7731","messages":[{"code":"QTY","message":"Billed more cases than shipped or received"}]}]', '2026-11-10T09:00:00-05:00',
        (r) => r.record?.found && /TED\*QTY\*Billed more cases than shipped or received\*IT1\*\*2\*\*300~/.test(r.record.x12) && /NTE\*GEN\*270 shipped on line 1/.test(r.record.x12)],
      ['decide_charge', 'northfield', 'Waive the shortage charge on DC-40877 [card decide_charge {"case":"DC-40877","charge":"SH01","decision":"Waived"}]', '2026-12-03T09:00:00-05:00', (r) => r.record?.decisions?.some((d) => d.charge === 'SH01' && d.decision === 'Waived' && d.decided_by === 'Jordan Ellis')],
      ['decide_chargeback', 'northfield', 'Apply the readiness chargeback on NR-46602 [card decide_chargeback {"po":"NR-46602","decision":"Apply"}]', '2026-12-09T17:30:00-05:00', (r) => r.record?.found && r.record.case === 'DC-R46602' && r.record.charge === 'RT01'],
      ['publish_rule', 'northfield', 'Publish NFD-1 [card publish_rule {"draft":"NFD-1"}]', '2026-12-28T11:00:00-05:00', (r) => !JSON.stringify(r.record).match(/"id":\s*"NFD-1"[^}]*"state":\s*"Draft"/)],
    ];
    const pressed = {};
    for (const [tool, side, q, as_of, check] of steps) {
      const r = await card(side, q, as_of); const c = r.cards?.[0];
      ok(`card raised for ${tool}: says what happens, to whom, under which rule, with Approve and Cancel`, c && c.state === 'Open' && !('says' in c) && c.label && c.to && c.record && c.detail && c.rule?.text && c.approver && c.buttons.join() === 'Approve,Cancel' && r.answer_from === 'model' && /Approve/.test(r.answer), JSON.stringify(r).slice(0, 400));
      if (!c) continue; const p = await press(V1, c.id, session); pressed[tool] = { card: c.id, p };
      ok(`Approve on ${tool} writes once and returns the record re-read`, p.ok && p.card.state === 'Approved' && check(p), JSON.stringify(p).slice(0, 500)); }
    const tooLong = await ask(V1, { side: 'northfield', as_of: '2026-11-10T09:00:00-05:00', question: 'Reject INV-7731 [card send_application_advice {"document":"INV-7731","messages":[{"code":"QTY","message":"This message is far longer than the sixty characters the guide allows"}]}]' }); // a fresh session
    ok('an 824 message over 60 characters is refused and raises no card', !tooLong.cards?.length && /60/.test(tooLong.answer || ''), JSON.stringify(tooLong).slice(0, 300));
    const a824 = await card('ashby', 'Send an 824 to Northfield for AA-INV-7731', '2026-11-10T09:05:00-05:00'); const ac = a824.cards?.[0];
    ok('Ashby asked to send an 824: the model raises the 997 and corrected invoice card from the server’s fact, and writes the answer', ac && ac.action === 'answer_application_advice' && ac.detail?.document === 'INV-7731C-S' && ac.detail.sends_technical_acknowledgment === true && a824.answer_from === 'model', JSON.stringify(a824).slice(0, 400));
    if (ac) { const p = await press(V1, ac.id, session); ok('its Approve sends the 997 and the corrected invoice', p.ok && p.result.acknowledgment === 'FA-AA-INV-7731' && p.result.document === 'INV-7731C-S' && /REF\*OI\*INV-7731/.test(p.record?.x12 || ''), JSON.stringify(p).slice(0, 400)); }
    const mail = await card('ashby', 'Can you email Kinross and ask them for the load scan?', '2026-12-01T09:00:00-05:00');
    ok('"send an email" is refused: done outside Trading Grid, owner and place named, no card', !mail.cards?.length && /outside Trading Grid/.test(mail.answer) && mail.outside_trading_grid?.owner === 'Kinross', JSON.stringify(mail).slice(0, 300));
    // The model decides whether the person asked for an action (no keyword gate). A card it raises still writes nothing
    // until Approve: the record read before the press is unchanged.
    { const V3 = { 'cf-connecting-ip': '203.0.113.52' }; let s3 = null;
      const ask3 = async (side, question, as_of, context) => { const r = await ask(V3, { side, question, as_of, ...(context ? { context } : {}), ...(s3 ? { session: s3 } : {}) }); s3 = r.session || s3; return r; };
      for (const [q, side, as_of, ctx, action] of [['fix the invoice', 'ashby', '2026-11-10T09:30:00-05:00', 'INV-7731', 'answer_application_advice'], ['sort this out', 'ashby', '2026-11-18T15:10:00-05:00', 'ASN-462410', 'release_held_ship_notice'], ['can you handle it', 'northfield', '2026-11-18T15:00:00-05:00', 'INV-7790', 'send_application_advice']]) {
        const r = await ask3(side, q, as_of, ctx); const c = r.cards?.[0];
        ok(`"${q}" with ${ctx} on screen raises the ${action} card (no keyword gate)`, c && c.action === action && c.state === 'Open', JSON.stringify(r).slice(0, 300)); }
      const before = await pub('ashby', 'get_order', { po: 'NR-462410', as_of: '2026-11-18T15:10:00-05:00' }, s3);
      ok('a raised card writes nothing until Approve', !/action card/.test(JSON.stringify(before)), JSON.stringify(before).slice(0, 200));
      // The person's words to the other company go into the record Trading Grid carries: Northfield's 824 message.
      const s3a = s3; s3 = null;
      const rj = await ask3('northfield', 'Reject INV-7790 and tell Ashby line 3 is overbilled', '2026-11-18T15:00:00-05:00'); const rc = rj.cards?.[0];
      ok('"…line 3 is overbilled" is refused for line 3 (no such error); the card for line 1 is raised with no message and the person’s words unchanged', rc && rc.action === 'send_application_advice' && rc.offered_instead?.asked_lines?.[0] === 3 && rc.offered_instead.lines.join() === '1' && rc.offered_instead.missing.join() === '3' && !rc.message && /TED\*QTY\*Invoice quantity above accepted quantity\*/.test(rc.x12 || '') && !/overbilled/i.test(rc.x12 || '') && /line 1/.test(rj.answer) && /line 3/.test(rj.answer) && /no message/.test(rj.answer) && rj.answer_from === 'model', JSON.stringify(rj).slice(0, 600));
      const rp = rc ? await press(V3, rc.id, s3) : null;
      ok('its Approve sends the 824 for line 1 with the rule cause in TED02', rp?.ok && /TED\*QTY\*Invoice quantity above accepted quantity\*IT1\*\*2\*\*264~\s*NTE\*GEN\*240/.test(rp.record?.x12 || ''), JSON.stringify(rp).slice(0, 400));
      // Every calculated view sees the session's own documents: the three-way match lists the 824 in this session only.
      const m3 = await pub('northfield', 'three_way_match', { reference: 'INV-7790', as_of: '2026-11-18T15:30:00-05:00' }, s3);
      const mOther = await pub('northfield', 'three_way_match', { reference: 'INV-7790', as_of: '2026-11-18T15:30:00-05:00' }, s3a); const mNone = await pub('northfield', 'three_way_match', { reference: 'INV-7790', as_of: '2026-11-18T15:30:00-05:00' });
      ok('three_way_match lists the 824 sent by card in the same session', (m3.application_advice || []).some((a) => a.advice === rp?.result?.document && a.errors.some((e) => e.state === 'Open')), JSON.stringify(m3.application_advice));
      ok('and not in another session or the recorded world', !(mOther.application_advice || []).length && !(mNone.application_advice || []).length, `${JSON.stringify(mOther.application_advice)} ${JSON.stringify(mNone.application_advice)}`);
      // Ashby answers in the same session: the correction marks the 824's errors Corrected and the invoice Replaced, there only.
      const fx = await ask3('ashby', `Answer it [card answer_application_advice {"advice":"${rp?.result?.document}"}]`, '2026-11-18T15:40:00-05:00'); const fc = fx.cards?.[0];
      const fp = fc ? await press(V3, fc.id, s3) : null;
      const m4 = await pub('northfield', 'three_way_match', { reference: 'INV-7790', as_of: '2026-11-18T16:00:00-05:00' }, s3); const m4o = await pub('northfield', 'three_way_match', { reference: 'INV-7790', as_of: '2026-11-18T16:00:00-05:00' }, s3a);
      ok('a card correction marks the 824 errors Corrected and the original invoice Replaced, in that session', fp?.ok && (m4.application_advice || []).every((a) => a.errors.every((e) => e.state === 'Corrected')) && /^Replaced by INV-7790C/.test(m4.invoice_status || ''), `${JSON.stringify(fp).slice(0, 200)} ${JSON.stringify(m4.application_advice)} ${m4.invoice_status}`);
      ok('another viewer still sees the invoice held, with no correction', m4o.invoice_status === 'Held' && !(m4o.corrections || []).some((c) => /-S$/.test(c.invoice)), `${m4o.invoice_status} ${JSON.stringify(m4o.corrections)}`);
      // The person's words win over the model's own draft, go in TED02 of the errors they concern, and the rule cause moves to a note.
      const s3b = s3; s3 = null;
      const msg = await ask3('northfield', 'Reject INV-7731 and tell Ashby they billed more cases than received', '2026-11-10T09:00:00-05:00'); const mc = msg.cards?.[0];
      const teds = (mc?.x12 || '').split('~').filter((x) => x.startsWith('TED'));
      ok('"Reject INV-7731 and tell Ashby they billed more cases than received": the words are in TED02 of each error they concern, the cause in a note', mc && teds.length === 2 && teds.every((t) => t.split('*')[2] === 'They billed more cases than received') && /NTE\*GEN\*Invoice quantity above accepted quantity/.test(mc.x12) && /They billed more cases than received/.test(msg.answer), JSON.stringify(msg).slice(0, 600));
      const lie = await ask3('northfield', 'Reject INV-7731 and tell Ashby they billed more cases than received [lie]', '2026-11-10T09:00:00-05:00');
      ok('an answer that describes the card wrongly is sent back to the model, which answers again from the card; the server writes nothing', lie.cards?.length === 1 && lie.answer_from === 'model' && !('answer_replaced_because' in lie) && !/line 4|Please call/.test(lie.answer) && /They billed more cases than received/.test(lie.answer) && /Approve/.test(lie.answer), JSON.stringify(lie).slice(0, 500));
      s3 = s3b;
      // A line the invoice has but the rules find no error on: refused; the card is for the lines the rules found, with no message.
      s3 = null; const l3 = await ask3('northfield', 'Reject INV-7731 line 3 and tell Ashby it is overbilled', '2026-11-10T09:00:00-05:00'); const l3c = l3.cards?.[0];
      ok('"Reject INV-7731 line 3 and tell Ashby it is overbilled": line 3 has no error, so no card carries the message; the card is for lines 1 and 2', l3c && l3c.offered_instead?.asked_lines?.join() === '3' && l3c.offered_instead.lines.join() === '1,2' && !l3c.offered_instead.missing.length && !l3c.message && !/overbilled/i.test(l3c.x12 || '') && /line 3/.test(l3.answer) && /line 1/.test(l3.answer) && /line 2/.test(l3.answer), JSON.stringify(l3).slice(0, 500));
      const l5 = await ask3('northfield', 'Reject INV-7731 line 5 and tell Ashby it is overbilled', '2026-11-10T09:00:00-05:00'); const l5c = l5.cards?.[0];
      ok('"…line 5…": a line the invoice does not have is refused the same way, and the answer says so', l5c && l5c.offered_instead?.missing?.join() === '5' && !l5c.message && /does not have/.test(l5.answer), JSON.stringify(l5).slice(0, 400));
      // An invented record is sent back: every record the answer names was returned by a tool this turn, and is in read.
      const inv = await ask3('northfield', 'Why is INV-7731 held? [invent]', '2026-11-10T09:00:00-05:00');
      const cited = inv.answer?.match(/\b[A-Z]{2,5}(?:-[A-Z0-9]+)*-\d[A-Z0-9]*(?:-[A-Z0-9]+)*\b/g) || [];
      ok('an answer naming a record no tool returned is sent back; the answer cites only returned records, all listed in read', inv.ok && inv.answer_from === 'model' && !/REC-450118/.test(inv.answer) && cited.every((x) => inv.read.some((r) => r.record === x)), JSON.stringify(inv).slice(0, 400));
      { const rows = ldb.prepare("SELECT arguments FROM access_log WHERE tool = 'aviator' ORDER BY id DESC LIMIT 4").all().map((r) => JSON.parse(r.arguments));
        ok('the access log records the checks that sent each answer back', rows.some((a) => a.rechecks >= 1), JSON.stringify(rows.map((a) => a.rechecks))); }
      const kin = await ask3('northfield', 'tell Kinross to repick', '2026-11-18T15:00:00-05:00');
      ok('"tell Kinross to repick" is refused: Kinross owns it', !kin.cards?.length && /outside Trading Grid/.test(kin.answer) && kin.outside_trading_grid?.owner === 'Kinross', JSON.stringify(kin).slice(0, 300));
      const jor = await ask3('ashby', 'message Jordan that the ship notice is late', '2026-11-18T15:00:00-05:00');
      ok('"message Jordan that the ship notice is late" is refused on Ashby: no Ashby document carries it', !jor.cards?.length && /outside Trading Grid/.test(jor.answer) && jor.outside_trading_grid?.owner === 'Northfield', JSON.stringify(jor).slice(0, 300)); }
    const again = await press(V1, pressed.submit_dispute.card, session); const disputes = ((await pub('ashby', 'get_deduction_case', { case: 'DC-40877', as_of: '2026-12-01T12:00:00-05:00' }, session)).history || []).filter((h) => h.record === 'case.dispute');
    ok('a double press records once', again.ok && again.already_recorded === true && disputes.filter((d) => d.charge === 'SH01').length === 1, `${JSON.stringify(again).slice(0, 200)} · ${disputes.length}`);
    const cx = await card('ashby', 'Send the ship notice for NR-46215 [card send_ship_notice {"po":"NR-46215"}]', '2026-11-18T09:00:00-05:00'); const cxc = cx.cards?.[0];
    const cancelled = cxc ? await press(V1, cxc.id, session, 'cancel') : null; const nodoc = await pub('ashby', 'get_document', { reference: 'ASN-46215-S' }, session);
    ok('Cancel records nothing', cancelled?.card?.state === 'Cancelled' && nodoc.found === false, JSON.stringify(cancelled).slice(0, 200));
    const other = await ask(V2, { question: 'Where does DC-40877 stand?', side: 'ashby', as_of: '2026-12-01T12:00:00-05:00' });
    const otherCase = await pub('ashby', 'get_deduction_case', { case: 'DC-40877', as_of: '2026-12-01T12:00:00-05:00' }, other.session); const otherDoc = await pub('ashby', 'get_document', { reference: 'ACK-46210-S' }, other.session);
    const noSess = await pub('ashby', 'get_document', { reference: 'ACK-46210-S' });
    ok('a second viewer’s state is unchanged, and so is the recorded world', other.session && other.session !== session && !(otherCase.history || []).some((h) => h.record === 'case.dispute') && otherDoc.found === false && noSess.found === false
      && ldb.prepare('SELECT count(*) n FROM events').get().n === main0 && ldb.prepare('SELECT count(*) n FROM documents').get().n === docs0 && ['invoices', 'invoice_lines', 'errors', 'shipments', 'shipment_lines'].every((t) => ldb.prepare(`SELECT count(*) n FROM ${t}`).get().n === derived0[t]), `${other.session} ${JSON.stringify(otherCase.history)} ${otherDoc.found}`);
    const theirCard = await press(V2, pressed.decide_charge.card, other.session);
    ok('a card cannot be pressed from another session', theirCard.status === 404, JSON.stringify(theirCard).slice(0, 160));
    const logs = ldb.prepare("SELECT connection_id, user_name, tool, result FROM access_log WHERE tool LIKE 'card:%' ORDER BY id").all();
    ok('the access log records who pressed each card', logs.filter((l) => l.result === 'Approved').length >= 8 && logs.every((l) => /pressed on \/p\/_test \(viewer session VS-/.test(l.user_name)) && logs.some((l) => l.connection_id === 'aviator-_test-northfield' && /Jordan Ellis/.test(l.user_name)), JSON.stringify(logs.slice(0, 3)));
  }
  // ---- P6: Open dispute pressed on the page, then Jordan decides through Aviator, one session, as_of 3 December 15:00 UTC ----
  { const P6 = REG.p6.token; const AT = '2026-12-03T15:00:00Z'; const V4 = { 'cf-connecting-ip': '203.0.113.60' }, V5 = { 'cf-connecting-ip': '203.0.113.61' };
    const write = async (body, h = V4, tok = P6) => { const r = await post(`/aviator/${tok}/writes`, { action: 'open_dispute', charge: 'SH01', as_of: AT, ...body }, PORT, h); return { status: r.status, ...(await r.json()) }; };
    const read = async (side, tool, q, session, h = V4) => (await fetch(`${B}/public/${side}/tools/${tool}?${new URLSearchParams({ ...q, ...(session ? { session } : {}) })}`, { headers: h })).json();
    const mainEvents = ldb.prepare('SELECT count(*) n FROM events').get().n;
    const d1 = await write({ case: 'DC-41118' }); const S6 = d1.session;
    ok('P6 Open dispute on DC-41118 succeeds: ok, session, case, state Disputed', d1.status === 200 && d1.ok === true && /^VS-/.test(S6) && d1.case === 'DC-41118' && d1.state === 'Disputed' && Object.keys(d1).filter((k) => k !== 'status').sort().join() === 'case,ok,session,state', JSON.stringify(d1));
    const d2 = await write({ case: 'DC-41131', session: S6 }), d3 = await write({ case: 'DC-40931', session: S6 });
    ok('P6 Open dispute on DC-41131 (no load proof) and DC-40931 (accepted by Ashby on 2 December) succeed in the same session', d2.ok && d2.state === 'Disputed' && d2.session === S6 && d3.ok && d3.state === 'Disputed' && d3.session === S6, `${JSON.stringify(d2)} ${JSON.stringify(d3)}`);
    const again = await write({ case: 'DC-41118', session: S6 });
    ok('a second dispute on DC-41118 is refused with already_disputed, and no sentence', again.status === 409 && again.ok === false && again.error === 'already_disputed' && !again.message, JSON.stringify(again));
    for (const [n, body, tok, code] of [['a case not on the page', { case: 'DC-40999', session: S6 }, P6, 'not_on_page'], ['a page that does not show Ashby', { case: 'DC-41118' }, REG.p14.token, 'not_on_page'], ['as_of after the window end', { case: 'DC-41102', session: S6, as_of: '2027-01-07T15:00:00Z' }, P6, 'outside_window'], ['as_of before the page moment', { case: 'DC-41102', session: S6, as_of: '2026-11-30T15:00:00Z' }, P6, 'outside_window'], ['a session that is not live', { case: 'DC-41102', session: 'VS-000000000000' }, P6, 'session_expired']]) {
      const r = await write(body, V4, tok); ok(`P6 Open dispute refused for ${n}: ${code}`, r.ok === false && r.error === code && !r.message, JSON.stringify(r)); }
    const asCase = await read('ashby', 'get_deduction_case', { case: 'DC-41118', as_of: AT }, S6); const opened = (asCase.history || []).find((h) => h.record === 'case.dispute');
    ok('Ashby’s side: the page dispute shows as opened by Priya Raman, with the evidence the case shows', opened && opened.approved_by === 'Priya Raman' && opened.charge === 'SH01' && opened.amount === 96.8 && ['Bill of lading with seal', 'Proof of delivery', 'Load tally by SSCC'].every((e) => opened.evidence.includes(e)) && !opened.evidence.includes('Load scan by SSCC'), JSON.stringify(opened));
    const queue = await read('northfield', 'list_deduction_cases', { as_of: AT }, S6); const row = (k) => (queue.cases || []).find((c) => c.case === k)?.charges?.find((x) => x.charge === 'SH01');
    ok('Northfield’s side: the disputes are in Jordan’s queue with the rules’ recommendation as data', ['DC-41118', 'DC-41131', 'DC-40931', 'DC-40877'].every((k) => row(k)?.state === 'Disputed, awaiting decision') && row('DC-41102')?.state === 'Not disputed'
      && row('DC-41118').recommendation.decision === 'Waived' && row('DC-40877').recommendation.decision === 'Waived' && row('DC-41131').recommendation.decision === 'Not reviewed' && row('DC-41131').recommendation.missing.join() === 'Load scan or load tally by SSCC' && row('DC-40931').recommendation.decision === 'Not reviewed', JSON.stringify(queue.cases?.map((c) => [c.case, c.charges])));
    const nfCase = await read('northfield', 'review_deduction_case', { case: 'DC-41118', as_of: AT }, S6);
    ok('review_deduction_case on Northfield’s side shows the dispute from Priya Raman', (nfCase.disputes || []).some((d) => d.charge === 'SH01' && d.approved_by === 'Priya Raman'), JSON.stringify(nfCase.disputes));
    const many = (await post(`/aviator/${P6}`, { question: 'Waive the disputes with a complete pack', side: 'northfield', as_of: AT, session: S6 }, PORT, V4).then((r) => r.json()));
    const cards = many.cards || []; const byCase = Object.fromEntries(cards.map((c) => [c.record, c]));
    ok('"Waive the disputes with a complete pack": cards for DC-41118 and DC-40877 only, each Waived', many.ok && many.session === S6 && cards.length === 2 && Object.keys(byCase).sort().join() === 'DC-40877,DC-41118' && cards.every((c) => c.action === 'decide_charge' && c.detail.decision === 'Waived'), JSON.stringify(many).slice(0, 600));
    ok('each decision card carries case, charge, decision, amount and the rules’ recommendation as data', cards.every((c) => c.detail.case === c.record && c.detail.charge_code === 'SH01' && typeof c.detail.amount === 'number' && c.detail.recommendation?.decision === 'Waived' && c.detail.recommendation.by === 'Northfield’s evidence rules') && byCase['DC-41118']?.detail.amount === 96.8 && byCase['DC-40877']?.detail.amount === 88.4, JSON.stringify(cards.map((c) => c.detail)));
    const p41118 = byCase['DC-41118'] ? await post(`/aviator/${P6}/cards/${byCase['DC-41118'].id}`, { session: S6, decision: 'approve' }, PORT, V4).then((r) => r.json()) : {};
    ok('Approve on the DC-41118 card records Waived by Jordan Ellis', p41118.ok && p41118.card?.state === 'Approved' && (p41118.record?.decisions || []).some((d) => d.charge === 'SH01' && d.decision === 'Waived' && d.decided_by === 'Jordan Ellis'), JSON.stringify(p41118).slice(0, 400));
    const nfAfter = await read('northfield', 'review_deduction_case', { case: 'DC-41118', as_of: AT }, S6); const asAfter = await read('ashby', 'get_deduction_case', { case: 'DC-41118', as_of: AT }, S6);
    ok('DC-41118 reads Waived on both sides', (nfAfter.decisions || []).some((d) => d.decision === 'Waived' && d.decided_by === 'Jordan Ellis') && (asAfter.history || []).some((h) => h.record === 'case.decision' && h.decision === 'Waived' && h.decided_by === 'Jordan Ellis'), `${JSON.stringify(nfAfter.decisions)} ${JSON.stringify(asAfter.history)}`);
    const second = await post(`/aviator/${P6}`, { question: 'Waive DC-41118 [card decide_charge {"case":"DC-41118","charge":"SH01","decision":"Waived"}]', side: 'northfield', as_of: AT, session: S6 }, PORT, V4).then((r) => r.json());
    ok('a second decide_charge on DC-41118 is refused as already decided: no card', second.ok && !(second.cards || []).length && /already decided/.test(second.answer), JSON.stringify(second).slice(0, 300));
    // A new session sees none of these writes, and nothing reached the recorded world.
    const fresh = await write({ case: 'DC-41102' }, V5); const fresh18 = await read('ashby', 'get_deduction_case', { case: 'DC-41118', as_of: AT }, fresh.session, V5); const freshQ = await read('northfield', 'list_deduction_cases', { as_of: AT }, fresh.session, V5);
    const fr = (k) => freshQ.cases?.find((c) => c.case === k)?.charges?.[0]?.state;
    ok('a new session sees none of these writes', fresh.ok && fresh.session !== S6 && !(fresh18.history || []).some((h) => /case\.(dispute|decision)/.test(h.record)) && fr('DC-41118') === 'Not disputed' && fr('DC-41131') === 'Not disputed' && fr('DC-40931') === 'Not disputed' && fr('DC-41102') === 'Disputed, awaiting decision', `${JSON.stringify(fresh)} ${JSON.stringify(freshQ.cases?.map((c) => [c.case, c.charges?.[0]?.state]))}`);
    ok('no page dispute or decision reached main.events', ldb.prepare('SELECT count(*) n FROM events').get().n === mainEvents);
    const at6 = await read('northfield', 'review_deduction_case', { case: 'DC-40877', as_of: '2026-12-06T15:00:00Z' }, null, V5); const as6 = await read('ashby', 'get_deduction_case', { case: 'DC-40877', as_of: '2026-12-06T15:00:00Z' }, null, V5);
    ok('at 6 December 15:00 UTC DC-40877 reads Waived by Jordan Ellis, on both sides', (at6.decisions || []).some((d) => d.charge === 'SH01' && d.decision === 'Waived' && d.decided_by === 'Jordan Ellis') && (as6.history || []).some((h) => h.record === 'case.decision' && h.charge === 'SH01' && h.decision === 'Waived'), `${JSON.stringify(at6.decisions)} ${JSON.stringify(as6.history)}`);
    const plog = ldb.prepare("SELECT connection_id, tool, result, approver FROM access_log WHERE tool = 'page:open_dispute' ORDER BY id").all();
    ok('page disputes are logged under aviator-p6-ashby, approved by Priya Raman, refusals by code', plog.length >= 9 && plog.every((l) => l.connection_id === 'aviator-p6-ashby' || l.connection_id === 'aviator-p14-refused') && plog.filter((l) => l.result === 'Disputed').length === 4 && plog.some((l) => l.result === 'Refused: already_disputed'), JSON.stringify(plog)); }
  ok('no record was written by any public or Aviator call', ldb.prepare('SELECT count(*) n FROM events').get().n === events0 && ldb.prepare('SELECT count(*) n FROM proposals').get().n === props0);
} finally { srv.kill(); cap.kill(); model.close(); }
console.log(`${fails ? 'FAILED' : 'All hosted checks passed'}: ${fails} failed`); process.exit(fails ? 1 : 0);
