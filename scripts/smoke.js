// Smoke test: starts the server, connects with the MCP SDK client over Streamable HTTP, and checks the tools,
// the REST twin, the scope mask, isolation, the read-only boundary, and (WRITES=on) proposal, approval and reset.
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0; const fails = []; const ok = (n, c, d = '') => { if (c) pass++; else fails.push(`${n} ${d}`); };
async function withServer(env, port, fn) {
  const p = spawn('node', ['--no-warnings', 'src/server.js'], { env: { ...process.env, MCP_TOKEN: 'smoke', NF_TOKEN: 'nfsmoke', PORT: String(port), ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try { for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await sleep(100); }
    const client = new Client({ name: 'smoke', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/smoke`)));
    const nfClient = new Client({ name: 'smoke-nf', version: '1' }); await nfClient.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/nfsmoke`)));
    const tool = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    const nf = async (name, args = {}) => JSON.parse((await nfClient.callTool({ name, arguments: args })).content[0].text);
    const rest = async (path, init) => (await fetch(`${base}/api/smoke${path}`, init)).json();
    await fn({ base, client, nfClient, tool, nf, rest }); await client.close(); await nfClient.close(); } finally { p.kill(); }
}
await withServer({ WRITES: 'off' }, 3971, async ({ base, client, tool, rest }) => {
  const { tools } = await client.listTools(); const names = tools.map((t) => t.name);
  ok('19 tools listed', names.length === 19, String(names.length)); ok('no scenario tool', !names.includes('list_scenarios'));
  ok('every tool read-only', tools.every((t) => t.annotations?.readOnlyHint === true));
  const a = await tool('orders_needing_attention'); ok('attention via MCP', a.items?.map((i) => i.po).join() === 'NR-46151,NR-46142,NR-46156,NR-46133', JSON.stringify(a).slice(0, 200));
  const r = await rest('/v1/orders/attention'); ok('REST twin equals MCP', JSON.stringify(r.items) === JSON.stringify(a.items));
  const h = await rest('/v1/health?days=30'); ok('health via REST', h.documents === 3412 && h.failures === 41);
  const later = await tool('orders_needing_attention', { as_of: '2026-11-18T09:00:00-05:00', include_warehouse: true }); ok('as_of moves the answer', later.items?.[0]?.po === 'NR-46215');
  const o = await tool('get_order', { po: 'NR-450118' }); ok('order by number', o.found && o.shipments.length === 2);
  const d = await tool('get_document', { reference: 'ASN-450118-2' }); ok('document carries X12', /ISA\*/.test(JSON.stringify(d)));
  { const pre = await tool('get_order', { po: 'NR-460207' }), post = await tool('get_order', { po: 'NR-460207', as_of: '2026-12-04T10:00:00-05:00' });
    ok('get_order: no such order before Northfield sends it', pre.found === false && /^No such order as of/.test(pre.message) && !('order_value' in pre) && post.found === true && post.order_value > 0, JSON.stringify(pre).slice(0, 120)); }
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
await withServer({}, 3972, async ({ base, tool }) => {
  const before = await tool('get_order', { po: 'NR-46156' });
  const p = await tool('request_change', { action: 'send corrected ship notice', po: 'NR-46156' }); ok('proposal recorded', /Awaiting approval/.test(JSON.stringify(p)), JSON.stringify(p).slice(0, 200));
  const mid = await tool('get_order', { po: 'NR-46156' }); ok('nothing changes before approval', JSON.stringify(mid.other_records) === JSON.stringify(before.other_records));
  const id = JSON.stringify(p).match(/PR-[0-9A-Za-z-]+/)?.[0]; await fetch(`${base}/admin/smoke/proposals/${id}/approve`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_order', { po: 'NR-46156' }); ok('approval appends an event', JSON.stringify(after.other_records).includes('proposal.approved') || after.other_records.length === before.other_records.length + 1, id);
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const reset = await tool('get_order', { po: 'NR-46156' }); ok('reset returns to baseline', JSON.stringify(reset.other_records) === JSON.stringify(before.other_records));
});
// Both scopes on one world: shared documents, private records, refusals, and one deduction case worked from both sides.
await withServer({}, 3973, async ({ base, nfClient, tool, nf }) => {
  const { tools } = await nfClient.listTools(); ok('Northfield: 16 tools', tools.length === 16, String(tools.length));
  const x = (await tool('get_document', { reference: 'ASN-450118-2' })).x12, y = (await nf('get_document', { reference: 'ASN-450118-2' })).x12; ok('shared X12 is the same on both sides', !!x && x === y);
  { const pre = await nf('supplier_document_trail', { po: 'NR-460207' }), post = await nf('supplier_document_trail', { po: 'NR-460207', as_of: '2026-12-04T10:00:00-05:00' });
    ok('Northfield trail: no such order before it is sent', pre.found === false && /^No such order as of/.test(pre.message) && !('order_value' in pre) && !('requested_delivery' in pre) && post.found === true && post.documents.length >= 1, JSON.stringify(pre).slice(0, 120)); }
  const t = await nf('supplier_document_trail', { supplier: 'Ashby Supplier' }); ok('Northfield trail equals Ashby health', t.documents === 3412 && t.failures === 41, JSON.stringify(t).slice(0, 120));
  const refusalsNf = [await nf('get_document', { reference: 'WSA-45620' }), await nf('read_supplier_records', { question: 'Kinross load scans' }), await nf('run_readonly_sql', { sql: 'SELECT * FROM warehouse_orders' }), await nf('lookup_rules', { rule_id: 'AP-4.1' })];
  ok('Northfield refuses the 945', /Not available to Northfield/.test(JSON.stringify(refusalsNf[0]))); ok('Northfield refuses supplier records', /Not available to Northfield/.test(JSON.stringify(refusalsNf[1])));
  ok('Northfield SQL refuses the warehouse', /Not available to Northfield/.test(JSON.stringify(refusalsNf[2]))); ok('Northfield does not see Ashby policies', refusalsNf[3].count === 0);
  const refusalsAs = [await tool('read_retailer_records', { question: 'draft rules' }), await tool('run_readonly_sql', { sql: 'SELECT * FROM review_notes' })];
  ok('Ashby refuses Northfield records', refusalsAs.every((r) => /Not available to Ashby/.test(JSON.stringify(r))));
  const logNf = await nf('get_access_log', { limit: 50 }), logAs = await tool('get_access_log', { limit: 50 });
  ok('every Northfield refusal logged', logNf.calls.filter((c) => c.result === 'Not available to Northfield').length >= 3);
  ok('every Ashby refusal logged', logAs.calls.filter((c) => c.result === 'Not available to Ashby').length >= 2);
  const rel = await tool('release_ship_notice', { document: 'ASN-46156', po: 'NR-46156' }); ok('release always needs Priya (AP-1.3)', rel.result === 'Proposal recorded' && rel.approver === 'Priya Raman');
  const pub = await nf('publish_rule', { draft: 'NFD-1' }); ok('no publish before replay', pub.result === 'Refused');
  const rp = await nf('replay_draft_rule', { draft: 'NFD-1' }); ok('replay shows exposure', rp.failing_with_draft > rp.failing_now);
  const pub2 = await nf('publish_rule', { draft: 'NFD-1' }); ok('publish after replay is a proposal', pub2.result === 'Proposal recorded' && pub2.approver === 'Jordan Ellis');
  // The demo case: DC-41118 from both sides.
  const rec = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' }); ok('Claim Agent: attach tally and dispute', rec.next_step === 'attach_load_tally_and_dispute');
  const d = await tool('submit_dispute', { case: 'DC-41118', as_of: '2026-12-28' }); ok('dispute needs Priya (tally not in the case)', d.result === 'Proposal recorded');
  const early = await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); ok('Northfield sees no dispute before approval', early.disputes.length === 0);
  await fetch(`${base}/admin/smoke/proposals/${d.proposal}/approve`, { method: 'POST', redirect: 'manual' });
  const rv = await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); ok('Review Agent recommends reversal', rv.review_agent.next_step === 'recommend_reverse', JSON.stringify(rv.review_agent).slice(0, 120));
  const dc = await nf('decide_charge', { case: 'DC-41118', charge: 'SH01', decision: 'Reversed', reason: 'Load tally by SSCC', as_of: '2027-01-02' }); ok('decision needs Jordan (NF-7.7)', dc.result === 'Proposal recorded' && dc.approver === 'Jordan Ellis');
  ok('Ashby cannot approve Northfield’s decision', (await fetch(`${base}/admin/smoke/proposals/${dc.proposal}/approve`, { method: 'POST', redirect: 'manual' })).status === 302 && (await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' })).decisions.length === 0);
  await fetch(`${base}/admin/nfsmoke/proposals/${dc.proposal}/approve`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); const h = JSON.stringify(after.history);
  ok('case shows who drafted, approved and decided', /"drafted_by":"Claim Agent"/.test(h) && /"approved_by":"Priya Raman"/.test(h) && /"decided_by":"Jordan Ellis"/.test(h), h.slice(0, 200));
  const l1 = await tool('get_access_log', { limit: 50 }), l2 = await nf('get_access_log', { limit: 50 });
  ok('Northfield’s decision is in Ashby’s log', l1.calls.some((c) => c.tool === 'counterparty:decide_charge')); ok('Ashby’s dispute is in Northfield’s log', l2.calls.some((c) => c.tool === 'counterparty:submit_dispute'));
  for (const p of ['/admin/nfsmoke', '/records/northfield/order/NR-450118']) ok(`page ${p}`, (await fetch(base + p)).status === 200);
  await fetch(`${base}/admin/nfsmoke/reset`, { method: 'POST', redirect: 'manual' });
  ok('reset clears both sides', (await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' })).disputes.length === 0);
});
console.log(`${pass} smoke checks passed, ${fails.length} failed`); for (const f of fails) console.log(`FAIL ${f}`); process.exit(fails.length ? 1 : 0);
