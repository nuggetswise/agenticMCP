// Smoke test: starts the server, connects with the MCP SDK client over Streamable HTTP, and checks the tools,
// the REST twin, the scope mask, isolation, the read-only boundary, and (WRITES=on) proposal, approval and reset.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const fails = []; const ok = (n, c, d = '') => { if (c) pass++; else fails.push(`${n} ${d}`); };
async function withServer(env, port, fn) {
  const p = spawn('node', ['--no-warnings', 'src/server.js'], { env: { ...process.env, MCP_TOKEN: 'smoke', PORT: String(port), ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try { for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await sleep(100); }
    const client = new Client({ name: 'smoke', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/smoke`)));
    const tool = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    const rest = async (path, init) => (await fetch(`${base}/api/smoke${path}`, init)).json();
    await fn({ base, client, tool, rest }); await client.close(); } finally { p.kill(); }
}
await withServer({}, 3971, async ({ base, client, tool, rest }) => {
  const { tools } = await client.listTools(); const names = tools.map((t) => t.name);
  ok('16 tools listed', names.length === 16, String(names.length)); ok('no scenario tool', !names.includes('list_scenarios'));
  ok('every tool read-only', tools.every((t) => t.annotations?.readOnlyHint === true));
  const a = await tool('orders_needing_attention'); ok('attention via MCP', a.items?.map((i) => i.po).join() === 'NR-46151,NR-46142,NR-46156,NR-46133', JSON.stringify(a).slice(0, 200));
  const r = await rest('/v1/orders/attention'); ok('REST twin equals MCP', JSON.stringify(r.items) === JSON.stringify(a.items));
  const h = await rest('/v1/health?days=30'); ok('health via REST', h.documents === 3412 && h.failures === 41);
  const later = await tool('orders_needing_attention', { as_of: '2026-11-18T09:00:00-05:00', include_warehouse: true }); ok('as_of moves the answer', later.items?.[0]?.po === 'NR-46215');
  const o = await tool('get_order', { po: 'NR-450118' }); ok('order by number', o.found && o.shipments.length === 2);
  const d = await tool('get_document', { reference: 'ASN-450118-2' }); ok('document carries X12', /ISA\*/.test(JSON.stringify(d)));
  const x = await tool('get_order', { po: 'NR-447948' }); ok('another supplier’s order is not found', x.found === false, JSON.stringify(x).slice(0, 120));
  const c = await tool('compare_with_other_suppliers', { question: 'rank' }); ok('refusal text', JSON.stringify(c).includes('Not available to Ashby'));
  const w = await tool('request_change', { action: 'resend the ship notice', po: 'NR-46156' }); ok('read-only boundary', JSON.stringify(w).includes('Action not available'));
  const n = await tool('recommend_next_step', { job: 'missing_document', record: 'NR-46215', as_of: '2026-11-18T09:00:00-05:00' }); ok('agent decision', n.next_step === 'draft_ship_notice_from_load_scan');
  const sql = await tool('run_readonly_sql', { sql: "SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'" }); ok('SQL sees only Ashby', JSON.stringify(sql).includes('"n": 0') || JSON.stringify(sql).includes('"n":0'), JSON.stringify(sql).slice(0, 160));
  const bad = await tool('run_readonly_sql', { sql: 'DELETE FROM orders' }); ok('SQL refuses writes', /only|not allowed|read-only|SELECT/i.test(JSON.stringify(bad)));
  await fetch(`${base}/admin/smoke/scopes`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'orders=on&documents=on', redirect: 'manual' });
  const m = await tool('explain_rejection', { reference: 'ASN-46118' }); ok('scope off blocks the tool', /scope|not shared|not granted/i.test(JSON.stringify(m)), JSON.stringify(m).slice(0, 160));
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const m2 = await tool('explain_rejection', { reference: 'ASN-46118' }); ok('reset restores scopes', m2.rejected === true);
  const log = await tool('get_access_log'); ok('access log records calls', JSON.stringify(log).includes('explain_rejection'));
  ok('openapi served', (await (await fetch(`${base}/openapi.json`)).json()).openapi === '3.0.3');
  for (const p of ['/records/order/NR-450118', '/records/document/ASN-46118', '/admin/smoke', '/']) ok(`page ${p}`, (await fetch(base + p)).status === 200);
  ok('wrong token refused', (await fetch(`${base}/api/nope/v1/health`)).status >= 401);
});
await withServer({ WRITES: 'on' }, 3972, async ({ base, tool }) => {
  const before = await tool('get_order', { po: 'NR-46156' });
  const p = await tool('request_change', { action: 'send corrected ship notice', po: 'NR-46156' }); ok('proposal recorded', /Awaiting approval/.test(JSON.stringify(p)), JSON.stringify(p).slice(0, 200));
  const mid = await tool('get_order', { po: 'NR-46156' }); ok('nothing changes before approval', JSON.stringify(mid.other_records) === JSON.stringify(before.other_records));
  const id = JSON.stringify(p).match(/PR-[0-9A-Za-z-]+/)?.[0]; await fetch(`${base}/admin/smoke/proposals/${id}/approve`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_order', { po: 'NR-46156' }); ok('approval appends an event', JSON.stringify(after.other_records).includes('proposal.approved') || after.other_records.length === before.other_records.length + 1, id);
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const reset = await tool('get_order', { po: 'NR-46156' }); ok('reset returns to baseline', JSON.stringify(reset.other_records) === JSON.stringify(before.other_records));
});
console.log(`${pass} smoke checks passed, ${fails.length} failed`); for (const f of fails) console.log(`FAIL ${f}`); process.exit(fails.length ? 1 : 0);
