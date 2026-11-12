// End-to-end test through a real MCP client. Usage: SMOKE_BASE=http://localhost:3000 MCP_TOKEN=... node scripts/smoke.js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.SMOKE_BASE || 'http://localhost:3000';
const TOKEN = process.env.MCP_TOKEN;
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp/${TOKEN}`)));
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) { fails++; console.log('   ', JSON.stringify(got).slice(0, 400)); } };
const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
const setScopes = (s) => fetch(`${BASE}/admin/${TOKEN}/scopes`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: s.map((x) => `${x}=on`).join('&'), redirect: 'manual' });

const tools = (await client.listTools()).tools.map((t) => t.name);
check('tools listed', tools.includes('orders_needing_attention') && tools.includes('run_readonly_sql'), tools);
check('every tool is read-only', (await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint), null);

const a = await call('orders_needing_attention');
check('Q1 four orders with rule and link', a.items.map((i) => `${i.po} ${i.time_left}`).join('|') === 'NR-46156 4 hours left|NR-46142 5 hours left|NR-46151 7 hours left|NR-46133 1 day left' && a.items.every((i) => i.link.startsWith(BASE) && i.rule.source), a);
const x = await call('explain_rejection', { reference: 'ASN-46118' });
const r = x.rejections[0];
check('Q2 ASN-46118: 26 vs 22 characters, three later documents', r.sent_length === '26 characters' && r.allowed.startsWith('22 characters') && r.same_cause_later.length === 3, r);
const h = await call('edi_health_summary', { days: 30 });
check('Q3 3,412 documents, 41 failures, top three causes', h.documents === 3412 && h.failures === 41 && h.top_causes.length === 3, h);
const d = await call('check_deliveries', { pos: ['NR-46101', 'NR-46103', 'NR-46104', 'NR-46106', 'NR-46108', 'NR-46110'] });
check('Q4 escalation five on time, one late', d.on_time === 5 && d.late === 1, d);

const other = await call('compare_with_other_suppliers', { question: 'How do other Northfield suppliers score on rejections?' });
check('S2 other suppliers: Not available to Ashby', other.result === 'Not available to Ashby', other);
const otherPo = await call('get_order', { po: 'NR-81205' });
check('S2 other supplier PO: Not available to Ashby', otherPo.message === 'Not available to Ashby', otherPo);
const otherArg = await call('edi_health_summary', { supplier: 'Brookline Goods' });
check('S2 supplier argument: Not available to Ashby', otherArg.result === 'Not available to Ashby', otherArg);

await setScopes(['orders', 'documents', 'errors']);
const masked = await call('orders_needing_attention');
check('S3 rules scope removed: rules hidden on next call', masked.items.every((i) => i.rule.statement === 'Scope not granted: rules'), masked.items[0]);
const blocked = await call('lookup_retailer_rules', { topic: 'invoice' });
check('S3 rule lookup blocked', blocked.result === 'Scope not granted', blocked);
await setScopes(['orders', 'documents', 'errors', 'rules']);
const restored = await call('orders_needing_attention');
check('S3 scope restored on next call', restored.items[0].rule.source === 'Northfield MIG', restored.items[0]);

const act = await call('request_change', { action: 'Resend the invoice', po: 'NR-46133' });
check('S4 action request: Action not available with link', act.result === 'Action not available' && act.link.includes('/records/p10/order/NR-46133'), act);

const sql = await call('run_readonly_sql', { sql: "SELECT count(*) n FROM documents WHERE scenario='p10' AND sent_at > '2026-10-18T16:00:00.000Z'" });
check('SQL reads Ashby copy', sql.rows[0].n === 3412, sql);
const sqlOther = await call('run_readonly_sql', { sql: "SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'" });
check('SQL copy holds no other supplier', sqlOther.rows[0].n === 0, sqlOther);
const attach = await call('run_readonly_sql', { sql: "ATTACH 'build/tg.db' AS m" });
check('SQL blocks ATTACH', !!attach.error, attach);
const write = await call('run_readonly_sql', { sql: 'SELECT 1; DELETE FROM orders' });
check('SQL blocks a second statement', !!write.error, write);

const p13 = await call('orders_needing_attention', { scenario: 'p13' });
check('P13 four missing documents', p13.items.length === 4 && p13.checked_nothing_to_chase[0].state === 'Not expected', p13);

const logRes = await call('get_access_log', { limit: 30 });
const results = logRes.calls.map((c) => c.result);
check('access log holds every call, including declined ones', ['Answered', 'Not available to Ashby', 'Scope not granted', 'Action not available', 'Invalid request'].every((k) => results.includes(k)), results);

const page = await fetch(`${BASE}/records/p10/order/NR-46133`).then((x) => x.text());
check('record page renders', page.includes('PO NR-46133') && page.includes('INV-46133'), page.slice(0, 200));
const otherPage = await fetch(`${BASE}/records/p10/order/NR-81205`).then((x) => x.text());
check('record page for another supplier is Not available', otherPage.includes('Not available to Ashby'), otherPage.slice(0, 200));
const bad = await fetch(`${BASE}/mcp/wrong-token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('wrong token is refused', bad.status === 404, bad.status);

await client.close();
console.log(fails ? `${fails} failed` : 'All smoke checks passed');
process.exit(fails ? 1 : 0);
