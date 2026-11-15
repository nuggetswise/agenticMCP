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
  // 19 record tools, six Scout tools (CALLS 81), six Watch tools (P13) and three governance tools (T2.3). Scout tools change only an isolated in-memory session, never a
  // Trading Grid record, but they are not marked read-only so that a client still confirms before approving on Priya's behalf. Pause, resume and
  // a trial record on the change list, so they are not read-only either; get_change_list is.
  const scout = names.filter((n) => n.startsWith('scout_')); const watch = names.filter((n) => n.startsWith('watch_')); const GOVW = ['pause_agent', 'replay_agent_rule'];
  ok('35 tools listed: 19 record tools, 6 Scout tools, 6 Watch tools, 3 governance tools and Aviator; no resume tool', !names.includes('resume_agent') && names.length === 35 && names.includes('ask_aviator') && scout.length === 6 && watch.length === 6 && [...GOVW, 'get_change_list'].every((g) => names.includes(g)), `${names.length}, ${scout.length} Scout, ${watch.length} Watch`); ok('no scenario tool', !names.includes('list_scenarios'));
  ok('every record tool read-only', tools.filter((t) => !t.name.startsWith('scout_') && !t.name.startsWith('watch_') && !GOVW.includes(t.name)).every((t) => t.annotations?.readOnlyHint === true));
  ok('governance writes are not marked read-only', tools.filter((t) => GOVW.includes(t.name) || (t.name.startsWith('scout_') && t.name !== 'scout_setup') || (t.name.startsWith('watch_') && t.name !== 'watch_setup')).every((t) => t.annotations?.readOnlyHint === false) && tools.find((t) => t.name === 'watch_setup')?.annotations?.readOnlyHint === true);
  { const av = await tool('ask_aviator', { question: 'What is the order value of NR-450118?' }); const lg = await tool('get_access_log', { limit: 3 });
    ok('Aviator reached through the connector: answers or says it has no key, and logs the call', (av.ok === true || /no model key/.test(av.message || '')) && JSON.stringify(lg).includes('ask_aviator'), JSON.stringify(av).slice(0, 160)); }
  const before = JSON.stringify(await tool('get_access_log', { limit: 1 })).length >= 0 && (await tool('run_readonly_sql', { sql: "SELECT count(*) n FROM events WHERE po = 'NR-460207'" })).rows?.[0]?.n;
  const sb = await tool('scout_baseline', {}); const after = (await tool('run_readonly_sql', { sql: "SELECT count(*) n FROM events WHERE po = 'NR-460207'" })).rows?.[0]?.n;
  ok('Scout session leaves the recorded world unchanged', sb.outcome?.cartons_loaded === 659 && before === after, `${before} -> ${after}`);
  // Watch Agent (P13): a baseline, a start (no model key here) and an explicit clock advance leave every recorded record of the five orders unchanged.
  { const P13 = ['NR-46210', 'NR-46215', 'NR-46220', 'NR-46226', 'NR-46231']; const snap = async () => JSON.stringify(await Promise.all(P13.map(async (po) => { const o = await tool('get_order', { po, as_of: '2026-12-31' }); delete o.read_at; return o; })));
    const w0 = await snap(); const su = await tool('watch_setup', {}); const wb = await tool('watch_baseline', {}); const ws = await tool('watch_start', {}); const wa = await tool('watch_state', { session: wb.session, advance_minutes: 2000 }); const w1 = await snap();
    ok('watch_setup lists facts, Priya’s window and guardrails', su.facts?.kinross_window_hours?.recorded === 48 && su.guardrails?.length === 3 && su.actions?.release_document?.priya_may_change === false, JSON.stringify(su).slice(0, 160));
    ok('watch baseline reaches the P13 end state', JSON.stringify(wb.outcome?.sent_on_time) === JSON.stringify(['NR-46210 855', 'NR-46226 810', 'NR-46220 856']) && JSON.stringify(wb.outcome?.sent_late) === '["NR-46215 856"]' && wb.outcome?.nothing_to_chase?.join() === 'NR-46231' && wb.outcome?.violations?.length === 0, JSON.stringify(wb.outcome).slice(0, 200));
    ok('watch_start without a model key says so and simulates nothing', !!ws.blocked && ws.awaiting.length === 0 && ws.queue.rows.length === 4, JSON.stringify(ws.blocked));
    ok('watch_state advances the clock and reveals the confirming 861', /RCV-46220/.test(JSON.stringify(wa.arrived || [])) && wa.queue.rows.find((r) => r.po === 'NR-46220' && r.document === '856')?.closed === true, JSON.stringify(wa.arrived).slice(0, 200));
    ok('Watch session leaves the recorded world unchanged', w0 === w1 && w0.length > 1000, `${w0.length} vs ${w1.length}`); }
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
  const { tools } = await nfClient.listTools(); ok('Northfield: 19 tools (16, 2 governance and Aviator), no resume tool', tools.length === 19 && tools.some((t) => t.name === 'ask_aviator') && !tools.some((t) => t.name === 'resume_agent') && ['pause_agent', 'get_change_list'].every((g) => tools.some((t) => t.name === g)), String(tools.length));
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
  // T2.3 story 1: every write on both logs names agent, authority, approver and outcome.
  { const isWrite = (c) => /^(request_change|submit_dispute|release_ship_notice|decide_charge|publish_rule|approve_proposal|reject_proposal|edit_proposal|pause_agent|resume_agent|replay_agent_rule|counterparty:.*|scout:.*|watch:.*)$/.test(c.tool);
    const all = [...(await tool('get_access_log', { limit: 200 })).calls, ...(await nf('get_access_log', { limit: 200 })).calls].filter(isWrite);
    const bare = all.filter((c) => !c.write || !c.write.agent || !c.write.authority?.mode || !c.write.approver || !c.write.outcome);
    ok('every write names agent, authority, approver and outcome', all.length >= 8 && !bare.length, `${all.length} writes, ${bare.length} bare: ${bare.map((c) => c.tool).join(', ')}`);
    const w = (cs, f) => cs.find(f)?.write; const as = (await tool('get_access_log', { limit: 200 })).calls, ns = (await nf('get_access_log', { limit: 200 })).calls;
    const dp = w(as, (c) => c.tool === 'submit_dispute' && c.result === 'Proposal recorded'), da = w(as, (c) => c.tool === 'approve_proposal' && c.records.includes(d.proposal)), nd = w(ns, (c) => c.tool === 'approve_proposal' && c.records.includes(dc.proposal)), cp = w(as, (c) => c.tool === 'counterparty:decide_charge');
    ok('dispute write: Claim Agent under AP-4.1, Priya approves', dp?.agent === 'Claim Agent' && dp?.authority.rule === 'AP-4.1' && dp?.authority.mode === 'approve' && da?.approver === 'Priya Raman' && /^Approved/.test(da?.outcome), JSON.stringify([dp, da]));
    ok('charge decision: NF-7.7, Jordan approves, shown on Ashby’s log too', nd?.authority.rule === 'NF-7.7' && nd?.approver === 'Jordan Ellis' && cp?.approver === 'Jordan Ellis' && /Reversed/.test(cp?.outcome), JSON.stringify([nd, cp]));
    ok('case history shows authority and outcome', /"authority":\{"rule":"AP-4.1","mode":"approve"\}/.test(h) && /"outcome":"Dispute submitted"/.test(h), h.slice(0, 300)); }
  for (const p of ['/admin/nfsmoke', '/records/northfield/order/NR-450118']) ok(`page ${p}`, (await fetch(base + p)).status === 200);
  await fetch(`${base}/admin/nfsmoke/reset`, { method: 'POST', redirect: 'manual' });
  ok('reset clears both sides', (await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' })).disputes.length === 0);
});
// T2.3 stories 1, 2 and 4 through the connections: pause and resume, override, the trial record and Scout write attribution.
await withServer({}, 3974, async ({ base, tool, nf }) => {
  // Story 2: pause. Claim Agent's proposal becomes a plain task; resume brings it back. Every change is on the change list with who made it.
  const live = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  const pz = await tool('pause_agent', { agent: 'Claim Agent', reason: 'smoke' });
  const paused = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  ok('paused agent proposes nothing: a plain task', live.next_step === 'attach_load_tally_and_dispute' && pz.result === 'Agent paused' && paused.proposal === null && !('next_step' in paused) && !('authority' in paused) && paused.agent_state === 'Paused' && paused.record === 'DC-41118', JSON.stringify(paused).slice(0, 200));
  const other = await tool('recommend_next_step', { job: 'missing_document', record: 'NR-46156', as_of: '2026-11-18T09:00:00-05:00' }); ok('pause is per agent', !!other.next_step && other.agent_state === undefined);
  const disp = await tool('submit_dispute', { case: 'DC-41118', as_of: '2026-12-28' }); const dl = (await tool('get_access_log', { limit: 5 })).calls.find((c) => c.tool === 'submit_dispute')?.write;
  ok('while paused, a dispute is the assistant’s proposal, not Claim Agent’s', disp.result === 'Proposal recorded' && dl?.agent === 'Priya Raman’s assistant', JSON.stringify(dl));
  ok('pause again changes nothing', (await tool('pause_agent', { agent: 'Claim Agent' })).result === 'Unchanged');
  const rq = await tool('resume_agent', { agent: 'claim' }).catch((e) => ({ result: 'Refused', error: String(e) })); ok('the assistant cannot resume an agent', /Refused|not found|Unknown/i.test(JSON.stringify(rq)), JSON.stringify(rq).slice(0, 160));
  const rz = await fetch(`${base}/admin/smoke/agents/claim/resume`, { method: 'POST', redirect: 'manual' }); const back = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  ok('a person resumes on the admin page, and the proposal returns', [302, 303].includes(rz.status) && back.next_step === 'attach_load_tally_and_dispute', String(rz.status));
  // Scout paused: the event arrives as a plain task and the model gets no turn (no key is needed to show it; without the pause Scout reports no model).
  await tool('pause_agent', { agent: 'Scout Agent' }); const ss = await tool('scout_start', {}); const st = await tool('scout_state', { session: ss.session });
  ok('paused Scout: plain task, no proposal, no model call', ss.status === 'paused' && ss.plain_task?.proposal === null && ss.awaiting.length === 0 && st.overhead.model_calls === 0 && !ss.blocked, JSON.stringify(ss).slice(0, 200));
  await fetch(`${base}/admin/smoke/agents/Scout%20Agent/resume`, { method: 'POST', redirect: 'manual' });
  const s2 = await tool('scout_start', {}); ok('resumed Scout reaches the model step again', s2.status !== 'paused' && !!s2.blocked, JSON.stringify(s2.blocked));
  const nfp = await nf('pause_agent', { agent: 'Review Agent' }); const rv = await nf('review_deduction_case', { case: 'DC-40877', as_of: '2027-01-06' });
  ok('Northfield pauses Review Agent: no recommendation', nfp.result === 'Agent paused' && rv.review_agent.proposal === null && rv.review_agent.agent_state === 'Paused');
  ok('an agent of the other company cannot be paused', (await nf('pause_agent', { agent: 'Claim Agent' })).result === 'Invalid request');
  const cl = await tool('get_change_list', {}); const kinds = cl.entries.map((e) => `${e.kind}:${e.agent}:${e.run_by}`);
  ok('pause and resume are on the change list with who made them', kinds.includes('pause:Claim Agent:Priya Raman’s assistant') && kinds.includes('resume:Claim Agent:Priya Raman') && !kinds.some((k) => k.startsWith('resume:') && k.endsWith('assistant')) && kinds.includes('resume:Scout Agent:Priya Raman') && cl.agents.find((a) => a.agent === 'Claim Agent')?.authority.rule === 'AP-4.1', JSON.stringify(kinds));
  // Story 2: override. Priya sets a proposal aside (Edit suggestion) and does it by hand; recorded with her name, nothing appended.
  const before = await tool('get_order', { po: 'NR-46156' }); const pr = await tool('request_change', { action: 'send corrected ship notice', po: 'NR-46156' });
  await fetch(`${base}/admin/smoke/proposals/${pr.proposal}/edit`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'note=Priya+sends+it+from+NetSuite', redirect: 'manual' });
  const after = await tool('get_order', { po: 'NR-46156' }); const ov = (await tool('get_access_log', { limit: 20 })).calls.find((c) => c.tool === 'edit_proposal');
  ok('override recorded with who made it, nothing appended', ov?.write.approver === 'Priya Raman' && /^Taken over by Priya Raman; done by hand: Priya sends it from NetSuite/.test(ov?.write.outcome) && ov?.result === 'Taken over' && JSON.stringify(after.other_records) === JSON.stringify(before.other_records), JSON.stringify(ov));
  ok('an overridden proposal cannot then be approved', (await fetch(`${base}/admin/smoke/proposals/${pr.proposal}/approve`, { method: 'POST', redirect: 'manual' })).status === 302 && JSON.stringify((await tool('get_order', { po: 'NR-46156' })).other_records) === JSON.stringify(before.other_records));
  // Story 4: the trial record, readable back with get_change_list.
  const tr = await tool('replay_agent_rule', { job: 'deduction', rule: 'AP-4.1', params: { max_amount: 50 }, as_of: '2026-12-10T12:00:00-05:00' });
  const te = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === tr.trial);
  ok('trial of a changed agent rule recorded on the change list', tr.result === 'Trial recorded' && te?.agent === 'Claim Agent' && te?.change.from.max_amount === 250 && te?.change.to.max_amount === 50 && te?.result.changed.map((c) => c.record).join() === 'DC-40877' && te?.run_by === 'Priya Raman’s assistant' && !!te?.at && !!te?.result.drift_measure && !!te?.result.rollback, String(JSON.stringify(te)).slice(0, 300));
  ok('the trial publishes nothing', /^Claim Agent may dispute/.test((await tool('recommend_next_step', { job: 'deduction', record: 'DC-40877', as_of: '2026-12-10T12:00:00-05:00' })).authority));
  ok('a trial of another company’s rule is refused', (await tool('replay_agent_rule', { job: 'deduction', rule: 'NF-7.4', params: { x: 1 } })).result === 'Invalid request');
  const sr = await tool('scout_replay', { policy: { kinross_load: 'policy' } }); const se = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === sr.trial);
  ok('Scout replay of a changed policy recorded as a trial', se?.agent === 'Scout Agent' && se?.rule === 'AP-3.2' && se?.result.authority_differs.some((d) => d.action === 'kinross_load') && !!se?.result.drift_measure, String(JSON.stringify(se)).slice(0, 300));
  // Watch Agent paused: the queue arrives as plain tasks and the model gets no turn; resumed, it reaches the model step again.
  await tool('pause_agent', { agent: 'Watch Agent' }); const wp = await tool('watch_start', {});
  ok('paused Watch Agent: plain tasks, no proposal, no model call', wp.status === 'paused' && wp.plain_task?.proposal === null && wp.plain_task?.queue?.length === 4 && wp.awaiting.length === 0 && wp.overhead.model_calls === 0, JSON.stringify(wp).slice(0, 200));
  await fetch(`${base}/admin/smoke/agents/Watch%20Agent/resume`, { method: 'POST', redirect: 'manual' }); ok('resumed Watch Agent reaches the model step again', !!(await tool('watch_start', {})).blocked);
  const wr = await tool('watch_replay', { variation: 'kinross_unreachable' }); const wt = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === wr.trial);
  ok('Watch replay recorded as a trial with the baseline outcome', wt?.agent === 'Watch Agent' && wt?.result.baseline.escalated.includes('NR-46220') && !!wt?.result.drift_measure && !!wr.watch?.blocked, String(JSON.stringify(wt)).slice(0, 200));
  const wl = (await tool('get_access_log', { limit: 200 })).calls.filter((c) => c.tool.startsWith('watch:'));
  ok('Watch writes on the access log with agent, authority, approver, outcome', wl.length >= 5 && wl.every((c) => c.write?.agent && c.write.authority.rule && ['suggest', 'approve', 'policy'].includes(c.write.authority.mode) && c.write.approver && c.write.outcome) && wl.some((c) => c.write.authority.rule === 'AP-1.3' && c.write.approver === 'Test approver (replay)'), `${wl.length}`);
  // Story 1: Scout session writes reach the access log with their attribution.
  const sl = (await tool('get_access_log', { limit: 200 })).calls.filter((c) => c.tool.startsWith('scout:'));
  ok('Scout writes on the access log with agent, authority, approver, outcome', sl.length >= 5 && sl.every((c) => c.write?.agent && c.write.authority.rule && ['suggest', 'approve', 'policy'].includes(c.write.authority.mode) && c.write.approver && c.write.outcome) && sl.some((c) => c.write.authority.mode === 'policy' && /^Standing policy/.test(c.write.approver)), `${sl.length}`);
  for (const p of ['/admin/smoke', '/admin/nfsmoke']) ok(`governance page ${p}`, (await fetch(base + p)).status === 200);
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const cr = await tool('get_change_list', {}); ok('reset clears the change list and resumes every agent', cr.entries.length === 0 && cr.agents.every((a) => a.state === 'Active') && (await nf('get_change_list', {})).agents.every((a) => a.state === 'Active'));
});
console.log(`${pass} smoke checks passed, ${fails.length} failed`); for (const f of fails) console.log(`FAIL ${f}`); process.exit(fails.length ? 1 : 0);
