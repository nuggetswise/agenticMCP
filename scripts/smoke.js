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
  const scout = names.filter((n) => n.startsWith('scout_')); const watch = names.filter((n) => n.startsWith('watch_')); const GOVW = ['pause_agent', 'replay_agent_rule', 'update_supplier_rule', 'set_agent_mode', 'resume_agent'];
  ok('69 tools listed: 31 record and write tools (promotion_deduction, clean_invoices, store_shelves, catalogue_check and flag_preview added), 6 each for Scout, Watch, Claim, Pace and Shelf, 7 governance and admin tools and Aviator', names.includes('resume_agent') && names.length === 69 && names.includes('send_document') && ['claim_', 'pace_', 'shelf_'].every((p) => names.filter((x) => x.startsWith(p)).length === 6) && names.includes('ask_aviator') && scout.length === 6 && watch.length === 6 && [...GOVW, 'get_change_list'].every((g) => names.includes(g)), `${names.length}, ${scout.length} Scout, ${watch.length} Watch`); ok('no scenario tool', !names.includes('list_scenarios'));
  ok('every record tool read-only', tools.filter((t) => !/^(scout|watch|claim|pace|shelf)_/.test(t.name) && !GOVW.includes(t.name)).every((t) => t.annotations?.readOnlyHint === true));
  ok('governance writes are not marked read-only', tools.filter((t) => GOVW.includes(t.name) || (t.name.startsWith('scout_') && t.name !== 'scout_setup') || (t.name.startsWith('watch_') && t.name !== 'watch_setup')).every((t) => t.annotations?.readOnlyHint === false) && tools.find((t) => t.name === 'watch_setup')?.annotations?.readOnlyHint === true);
  { const av = await tool('ask_aviator', { question: 'What is the order value of NR-450118?' }); const lg = await tool('get_access_log', { limit: 3 });
    ok('Aviator reached through the connector: answers or says it has no key, and logs the call', (av.ok === true || /no model key/.test(av.message || '')) && JSON.stringify(lg).includes('ask_aviator'), JSON.stringify(av).slice(0, 160)); }
  const before = JSON.stringify(await tool('get_access_log', { limit: 1 })).length >= 0 && (await tool('run_readonly_sql', { sql: "SELECT count(*) n FROM events WHERE po = 'NR-460207'" })).rows?.[0]?.n;
  const sb = await tool('scout_baseline', {}); const after = (await tool('run_readonly_sql', { sql: "SELECT count(*) n FROM events WHERE po = 'NR-460207'" })).rows?.[0]?.n;
  ok('Scout session leaves the recorded world unchanged', sb.outcome?.cartons_loaded === 659 && sb.queue?.rows.length === 5 && before === after, `${before} -> ${after}`);
  // Watch Agent (P13): a baseline, a start (no model key here) and an explicit clock advance leave every recorded record of the five orders unchanged.
  { const P13 = ['NR-46210', 'NR-46215', 'NR-46220', 'NR-46226', 'NR-46231']; const snap = async () => JSON.stringify(await Promise.all(P13.map(async (po) => { const o = await tool('get_order', { po, as_of: '2026-12-31' }); delete o.read_at; return o; })));
    const w0 = await snap(); const su = await tool('watch_setup', {}); const wb = await tool('watch_baseline', {}); const ws = await tool('watch_start', {}); const wa = await tool('watch_state', { session: wb.session, advance_minutes: 2000 }); const w1 = await snap();
    ok('watch_setup lists facts, Priya’s window and guardrails', su.facts?.kinross_window_hours?.recorded === 48 && su.guardrails?.length === 3 && su.actions?.release_document?.priya_may_change === false, JSON.stringify(su).slice(0, 160));
    ok('watch baseline reaches the P13 end state', JSON.stringify(wb.outcome?.sent_on_time) === JSON.stringify(['NR-46210 855', 'NR-462411 856', 'NR-46226 810', 'NR-46220 856']) && JSON.stringify(wb.outcome?.sent_late) === '["NR-46215 856"]' && wb.outcome?.nothing_to_chase?.join() === 'NR-46231' && wb.outcome?.violations?.length === 0, JSON.stringify(wb.outcome).slice(0, 200));
    { const sv = await (await fetch(`${base}/sessions/${wb.session}`)).json(); const nx = await fetch(`${base}/sessions/WS-nosuch`);
      ok('a session view is readable by its id for recording, and an unknown id is not found', sv.session === wb.session && Array.isArray(sv.trace) && nx.status === 404); }
    ok('watch_start without a model key says so and simulates nothing', !!ws.blocked && ws.awaiting.length === 0 && ws.queue.rows.length === 7, JSON.stringify(ws.blocked));
    ok('watch_state advances the clock and reveals the confirming 861', /RCV-46220/.test(JSON.stringify(wa.arrived || [])) && wa.queue.rows.find((r) => r.po === 'NR-46220' && r.document === '856')?.closed === true, JSON.stringify(wa.arrived).slice(0, 200));
    ok('Watch session leaves the recorded world unchanged', w0 === w1 && w0.length > 1000, `${w0.length} vs ${w1.length}`); }
  const a = await tool('orders_needing_attention'); ok('attention via MCP', a.items?.map((i) => i.po).join() === 'NR-46151,NR-46142,NR-46156,NR-46133', JSON.stringify(a).slice(0, 200));
  const r = await rest('/v1/orders/attention'); ok('REST twin equals MCP', JSON.stringify(r.items) === JSON.stringify(a.items));
  const h = await rest('/v1/health?days=30'); ok('health via REST', h.documents === 3420 && h.failures === 41);
  const later = await tool('orders_needing_attention', { as_of: '2026-11-18T09:00:00-05:00', include_warehouse: true }); ok('as_of moves the answer', later.items?.[0]?.po === 'NR-46215');
  const o = await tool('get_order', { po: 'NR-450118' }); ok('order by number', o.found && o.shipments.length === 2);
  const d = await tool('get_document', { reference: 'ASN-450118-2' }); ok('document carries X12', /ISA\*/.test(JSON.stringify(d)));
  { const pre = await tool('get_order', { po: 'NR-460207' }), post = await tool('get_order', { po: 'NR-460207', as_of: '2026-12-04T10:00:00-05:00' });
    ok('get_order: no such order before Northfield sends it', pre.found === false && /^No such order as of/.test(pre.message) && !('order_value' in pre) && post.found === true && post.order_value > 0, JSON.stringify(pre).slice(0, 120)); }
  const x = await tool('get_order', { po: 'NR-447948' }); ok('another supplier’s order is not found', x.found === false, JSON.stringify(x).slice(0, 120));
  const c = await tool('compare_with_other_suppliers', { question: 'rank' }); ok('refusal text', JSON.stringify(c).includes('Not available to Ashby'));
  const w = await tool('release_ship_notice', { document: 'ASN-462410', po: 'NR-462410' }); ok('read-only boundary', JSON.stringify(w).includes('Action not available'));
  ok('no general request tool: Trading Grid sends only business documents', !(await client.listTools()).tools.some((t) => t.name === 'request_change'));
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
  const before = await tool('get_order', { po: 'NR-462410', as_of: '2027-01-09T12:00:00-05:00' });
  const p = await tool('release_ship_notice', { document: 'ASN-462410', po: 'NR-462410' }); ok('proposal recorded', /Awaiting approval/.test(JSON.stringify(p)), JSON.stringify(p).slice(0, 200));
  const mid = await tool('get_order', { po: 'NR-462410', as_of: '2027-01-09T12:00:00-05:00' }); ok('nothing changes before approval', JSON.stringify(mid.other_records) === JSON.stringify(before.other_records));
  const id = JSON.stringify(p).match(/PR-[0-9A-Za-z-]+/)?.[0]; await fetch(`${base}/admin/smoke/proposals/${id}/approve`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_order', { po: 'NR-462410', as_of: '2027-01-09T12:00:00-05:00' }); ok('approval appends an event', JSON.stringify(after.other_records).includes('proposal.approved') || after.other_records.length === before.other_records.length + 1, id);
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const reset = await tool('get_order', { po: 'NR-462410', as_of: '2027-01-09T12:00:00-05:00' }); ok('reset returns to baseline', JSON.stringify(reset.other_records) === JSON.stringify(before.other_records));
});
// Both scopes on one world: shared documents, private records, refusals, and one deduction case worked from both sides.
await withServer({}, 3973, async ({ base, nfClient, tool, nf }) => {
  const { tools } = await nfClient.listTools(); ok('Northfield: 51 tools (27 with lot_reach, promotion_deduction, rule documents, draft_rule, store_sell_through, fill_rate, ship_notice_timeliness, send_application_advice and decide_chargeback, 5 governance and admin, Aviator, and 6 each for Match, Review and Chase)', tools.length === 51 && tools.some((t) => t.name === 'lot_reach') && tools.some((t) => t.name === 'store_sell_through') && ['match', 'review', 'chase'].every((p) => ['setup', 'start', 'decide', 'state', 'baseline', 'replay'].every((x) => tools.some((t) => t.name === `${p}_${x}`))) && tools.some((t) => t.name === 'ask_aviator') && ['pause_agent', 'resume_agent', 'get_change_list'].every((g) => tools.some((t) => t.name === g)), String(tools.length));
  const x = (await tool('get_document', { reference: 'ASN-450118-2' })).x12, y = (await nf('get_document', { reference: 'ASN-450118-2' })).x12; ok('shared X12 is the same on both sides', !!x && x === y);
  { const pre = await nf('supplier_document_trail', { po: 'NR-460207' }), post = await nf('supplier_document_trail', { po: 'NR-460207', as_of: '2026-12-04T10:00:00-05:00' });
    ok('Northfield trail: no such order before it is sent', pre.found === false && /^No such order as of/.test(pre.message) && !('order_value' in pre) && !('requested_delivery' in pre) && post.found === true && post.documents.length >= 1, JSON.stringify(pre).slice(0, 120)); }
  const t = await nf('supplier_document_trail', { supplier: 'Ashby Supplier' }); ok('Northfield trail equals Ashby health', t.documents === 3420 && t.failures === 41, JSON.stringify(t).slice(0, 120));
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
  const rec = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' }); ok('Ashby’s evidence rules: attach tally and dispute, credited to the rule, no agent named', rec.next_step === 'attach_load_tally_and_dispute' && rec.found_by === 'Ashby evidence rule AP-4.1' && !('agent' in rec) && /Priya Raman approves each dispute/.test(rec.authority), JSON.stringify(rec).slice(0, 200));
  const d = await tool('submit_dispute', { case: 'DC-41118', as_of: '2026-12-28' }); ok('dispute needs Priya (tally not in the case)', d.result === 'Proposal recorded');
  const early = await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); ok('Northfield sees no dispute before approval', early.disputes.length === 0);
  await fetch(`${base}/admin/smoke/proposals/${d.proposal}/approve`, { method: 'POST', redirect: 'manual' });
  const rv = await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); ok('Northfield’s evidence rules recommend waiving, credited to the rule', rv.recommendation.next_step === 'recommend_waive' && /^Northfield evidence rule NF-/.test(rv.recommendation.found_by) && !('review_agent' in rv), JSON.stringify(rv.recommendation).slice(0, 120));
  const dc = await nf('decide_charge', { case: 'DC-41118', charge: 'SH01', decision: 'Waived', reason: 'Load tally by SSCC', as_of: '2027-01-02' }); ok('decision needs Jordan (NF-7.7)', dc.result === 'Proposal recorded' && dc.approver === 'Jordan Ellis');
  ok('Ashby cannot approve Northfield’s decision', (await fetch(`${base}/admin/smoke/proposals/${dc.proposal}/approve`, { method: 'POST', redirect: 'manual' })).status === 302 && (await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' })).decisions.length === 0);
  await fetch(`${base}/admin/nfsmoke/proposals/${dc.proposal}/approve`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' }); const h = JSON.stringify(after.history);
  ok('case shows who drafted, approved and decided', /"drafted_by":"Ashby’s evidence rules"/.test(h) && /"approved_by":"Priya Raman"/.test(h) && /"decided_by":"Jordan Ellis"/.test(h), h.slice(0, 200));
  const l1 = await tool('get_access_log', { limit: 50 }), l2 = await nf('get_access_log', { limit: 50 });
  ok('Northfield’s decision is in Ashby’s log', l1.calls.some((c) => c.tool === 'counterparty:decide_charge')); ok('Ashby’s dispute is in Northfield’s log', l2.calls.some((c) => c.tool === 'counterparty:submit_dispute'));
  // T2.3 story 1: every write on both logs names agent, authority, approver and outcome.
  { const isWrite = (c) => /^(submit_dispute|release_ship_notice|decide_charge|publish_rule|approve_proposal|reject_proposal|edit_proposal|pause_agent|resume_agent|replay_agent_rule|counterparty:.*|scout:.*|watch:.*)$/.test(c.tool);
    const all = [...(await tool('get_access_log', { limit: 200 })).calls, ...(await nf('get_access_log', { limit: 200 })).calls].filter(isWrite);
    const bare = all.filter((c) => !c.write || !(c.write.proposed_by || c.write.rules) || !c.write.authority?.mode || !c.write.approver || !c.write.outcome);
    ok('every write names who proposed it, authority, approver and outcome', all.length >= 8 && !bare.length, `${all.length} writes, ${bare.length} bare: ${bare.map((c) => c.tool).join(', ')}`);
    const w = (cs, f) => cs.find(f)?.write; const as = (await tool('get_access_log', { limit: 200 })).calls, ns = (await nf('get_access_log', { limit: 200 })).calls;
    const dp = w(as, (c) => c.tool === 'submit_dispute' && c.result === 'Proposal recorded'), da = w(as, (c) => c.tool === 'approve_proposal' && c.records.includes(d.proposal)), nd = w(ns, (c) => c.tool === 'approve_proposal' && c.records.includes(dc.proposal)), cp = w(as, (c) => c.tool === 'counterparty:decide_charge');
    ok('dispute write: Ashby’s evidence rules under AP-4.1, Priya approves', dp?.proposed_by === 'Ashby’s evidence rules' && dp?.authority.rule === 'AP-4.1' && dp?.authority.mode === 'approve' && da?.approver === 'Priya Raman' && /^Approved/.test(da?.outcome), JSON.stringify([dp, da]));
    ok('charge decision: NF-7.7, Jordan approves, shown on Ashby’s log too', nd?.authority.rule === 'NF-7.7' && nd?.approver === 'Jordan Ellis' && cp?.approver === 'Jordan Ellis' && /Waived/.test(cp?.outcome), JSON.stringify([nd, cp]));
    ok('case history shows authority and outcome', /"authority":\{"rule":"AP-4.1","mode":"approve"\}/.test(h) && /"outcome":"Dispute submitted"/.test(h), h.slice(0, 300)); }
  for (const p of ['/admin/nfsmoke', '/records/northfield/order/NR-450118']) ok(`page ${p}`, (await fetch(base + p)).status === 200);
  await fetch(`${base}/admin/nfsmoke/reset`, { method: 'POST', redirect: 'manual' });
  ok('reset clears both sides', (await nf('review_deduction_case', { case: 'DC-41118', as_of: '2027-01-06' })).disputes.length === 0);
});
// T2.3 stories 1, 2 and 4 through the connections: pause and resume, override, the trial record and Scout write attribution.
await withServer({}, 3974, async ({ base, tool, nf }) => {
  // Story 2: pause. Claim Agent's proposal becomes a plain task; resume brings it back. Every change is on the change list with who made it.
  const live = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  const pz = await tool('pause_agent', { agent: 'claim', reason: 'smoke' });
  const paused = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  ok('a paused rule set proposes nothing: a plain task', live.next_step === 'attach_load_tally_and_dispute' && pz.result === 'Paused' && pz.rules === 'Ashby’s evidence rules' && pz.runtime === 'claim' && paused.proposal === null && !('next_step' in paused) && !('authority' in paused) && paused.rules_state === 'Paused' && paused.record === 'DC-41118', JSON.stringify(paused).slice(0, 200));
  const other = await tool('recommend_next_step', { job: 'missing_document', record: 'NR-46156', as_of: '2026-11-18T09:00:00-05:00' }); ok('pause is per rule set', !!other.next_step && other.rules_state === undefined);
  const disp = await tool('submit_dispute', { case: 'DC-41118', as_of: '2026-12-28' }); const dl = (await tool('get_access_log', { limit: 5 })).calls.find((c) => c.tool === 'submit_dispute')?.write;
  ok('while paused, a dispute is the assistant’s proposal, not the evidence rules’', disp.result === 'Proposal recorded' && dl?.proposed_by === 'Priya Raman’s assistant', JSON.stringify(dl));
  ok('pause again changes nothing', (await tool('pause_agent', { agent: 'Claim Agent' })).result === 'Unchanged');
  const rq = await tool('resume_agent', { agent: 'claim' }); ok('a person resumes on the admin screen (P21) and it is on the change list', rq.result === 'Resumed' && /^CL-/.test(rq.change || ''), JSON.stringify(rq).slice(0, 160));
  await tool('pause_agent', { agent: 'Claim Agent' });
  const rz = await fetch(`${base}/admin/smoke/agents/claim/resume`, { method: 'POST', redirect: 'manual' }); const back = await tool('recommend_next_step', { job: 'deduction', record: 'DC-41118', as_of: '2026-12-28' });
  ok('a person resumes on the admin page, and the proposal returns', [302, 303].includes(rz.status) && back.next_step === 'attach_load_tally_and_dispute', String(rz.status));
  // Scout paused: the event arrives as a plain task and the model gets no turn (no key is needed to show it; without the pause Scout reports no model).
  await tool('pause_agent', { agent: 'Scout Agent' }); const ss = await tool('scout_start', {}); const st = await tool('scout_state', { session: ss.session });
  ok('paused Scout: plain task, no proposal, no model call', ss.status === 'paused' && ss.plain_task?.proposal === null && !ss.awaiting.some((a) => a.proposed_by === 'Model') && st.overhead.model_calls === 0 && !ss.blocked, JSON.stringify(ss).slice(0, 200));
  await fetch(`${base}/admin/smoke/agents/Scout%20Agent/resume`, { method: 'POST', redirect: 'manual' });
  const s2 = await tool('scout_start', {}); ok('resumed Scout reaches the model step again', s2.status !== 'paused' && !!s2.blocked, JSON.stringify(s2.blocked));
  const nfp = await nf('pause_agent', { agent: 'Review Agent' }); const rv = await nf('review_deduction_case', { case: 'DC-40877', as_of: '2027-01-06' });
  ok('Northfield pauses its evidence rules (by the old name): no recommendation', nfp.result === 'Paused' && nfp.rules === 'Northfield’s evidence rules' && rv.recommendation.proposal === null && rv.recommendation.rules_state === 'Paused');
  ok('a rule set of the other company cannot be paused', (await nf('pause_agent', { agent: 'Claim Agent' })).result === 'Invalid request');
  const cl = await tool('get_change_list', {}); const kinds = cl.entries.map((e) => `${e.kind}:${e.runtime}:${e.run_by}`);
  ok('pause and resume are on the change list with who made them', kinds.includes('pause:claim:Priya Raman’s assistant') && kinds.includes('resume:claim:Priya Raman') && !kinds.some((k) => k.startsWith('resume:') && k.endsWith('assistant')) && kinds.includes('resume:scout:Priya Raman') && cl.rule_sets.find((a) => a.runtime === 'claim')?.authority.rule === 'AP-4.1' && cl.rule_sets.find((a) => a.runtime === 'claim')?.authority.mode === 'approve' && !/Agent/.test(JSON.stringify(cl)), JSON.stringify(kinds));
  // Story 2: Priya rejects a proposal; recorded with her name, nothing appended.
  const before = await tool('get_order', { po: 'NR-46156' }); const pr = await tool('release_ship_notice', { document: 'ASN-46156', po: 'NR-46156' });
  await fetch(`${base}/admin/smoke/proposals/${pr.proposal}/reject`, { method: 'POST', redirect: 'manual' });
  const after = await tool('get_order', { po: 'NR-46156' }); const ov = (await tool('get_access_log', { limit: 20 })).calls.find((c) => c.tool === 'reject_proposal');
  ok('a reject is recorded with who made it, nothing appended', ov?.write.approver === 'Priya Raman' && /^Rejected; nothing sent/.test(ov?.write.outcome) && ov?.result === 'Rejected' && JSON.stringify(after.other_records) === JSON.stringify(before.other_records), JSON.stringify(ov));
  ok('a rejected proposal cannot then be approved', (await fetch(`${base}/admin/smoke/proposals/${pr.proposal}/approve`, { method: 'POST', redirect: 'manual' })).status === 302 && JSON.stringify((await tool('get_order', { po: 'NR-46156' })).other_records) === JSON.stringify(before.other_records));
  // Story 4: the trial record, readable back with get_change_list.
  const tr = await tool('replay_agent_rule', { job: 'shelf', rule: 'AP-6.1', params: { min_weekly_avg: 500 }, records: ['114', '207'], as_of: '2026-10-26T08:07:00-04:00' });
  const te = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === tr.trial);
  ok('trial of a changed rule recorded on the change list', tr.result === 'Trial recorded' && te?.runtime === 'shelf' && te?.rules === 'Ashby’s replenishment rules' && te?.change.from.min_weekly_avg === 1 && te?.change.to.min_weekly_avg === 500 && te?.result.changed.map((c) => c.record).join() === '114' && te?.run_by === 'Priya Raman’s assistant' && !!te?.at && !!te?.result.drift_measure && !!te?.result.rollback, String(JSON.stringify(te)).slice(0, 300));
  ok('the trial publishes nothing', (await tool('recommend_next_step', { job: 'shelf', record: '114', as_of: '2026-10-26T08:07:00-04:00' })).next_step === 'recommend_new_order');
  ok('AP-4.1 holds no amount: a trial of it is refused, and every dispute is a proposal', (await tool('replay_agent_rule', { job: 'deduction', rule: 'AP-4.1', params: { max_amount: 50 } })).result === 'Invalid request' && /Priya Raman approves each dispute/.test((await tool('recommend_next_step', { job: 'deduction', record: 'DC-40877', as_of: '2026-12-10T12:00:00-05:00' })).authority));
  ok('a trial of another company’s rule is refused', (await tool('replay_agent_rule', { job: 'deduction', rule: 'NF-7.4', params: { x: 1 } })).result === 'Invalid request');
  const sr = await tool('scout_replay', { policy: { send_routing_request: 'policy' } }); const se = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === sr.trial);
  ok('Scout replay of a changed policy recorded as a trial', se?.runtime === 'scout' && se?.rule === 'AP-3.2' && se?.result.authority_differs.some((d) => d.action === 'send_routing_request') && !!se?.result.drift_measure, String(JSON.stringify(se)).slice(0, 300));
  // Watch Agent paused: the queue arrives as plain tasks and the model gets no turn; resumed, it reaches the model step again.
  await tool('pause_agent', { agent: 'Watch Agent' }); const wp = await tool('watch_start', {});
  ok('paused Watch Agent: plain tasks, no proposal, no model call', wp.status === 'paused' && wp.plain_task?.proposal === null && wp.plain_task?.queue?.length === 7 && wp.awaiting.length === 0 && wp.overhead.model_calls === 0, JSON.stringify(wp).slice(0, 200));
  await fetch(`${base}/admin/smoke/agents/Watch%20Agent/resume`, { method: 'POST', redirect: 'manual' }); ok('resumed Watch Agent reaches the model step again', !!(await tool('watch_start', {})).blocked);
  const wr = await tool('watch_replay', { variation: 'kinross_unreachable' }); const wt = (await tool('get_change_list', { kind: 'trial' })).entries.find((e) => e.id === wr.trial);
  ok('Watch replay recorded as a trial with the baseline outcome', wt?.runtime === 'watch' && wt?.result.baseline.escalated.includes('NR-46220') && !!wt?.result.drift_measure && !!wr.watch?.blocked, String(JSON.stringify(wt)).slice(0, 200));
  const wl = (await tool('get_access_log', { limit: 200 })).calls.filter((c) => c.tool.startsWith('watch:'));
  ok('Watch writes on the access log with agent, authority, approver, outcome', wl.length >= 5 && wl.every((c) => (c.write?.proposed_by || c.write?.rules) && c.write.authority.rule && ['suggest', 'approve', 'policy'].includes(c.write.authority.mode) && c.write.approver && c.write.outcome) && wl.some((c) => c.write.authority.rule === 'AP-1.3' && c.write.approver === 'Test approver (replay)'), `${wl.length}`);
  // Story 1: Scout session writes reach the access log with their attribution.
  const sl = (await tool('get_access_log', { limit: 200 })).calls.filter((c) => c.tool.startsWith('scout:'));
  ok('Scout writes on the access log with agent, authority, approver, outcome', sl.length >= 5 && sl.every((c) => (c.write?.proposed_by || c.write?.rules) && c.write.authority.rule && ['suggest', 'approve', 'policy'].includes(c.write.authority.mode) && c.write.approver && c.write.outcome) && sl.some((c) => c.write.authority.mode === 'policy' && /^Standing policy/.test(c.write.approver)), `${sl.length}`);
  for (const p of ['/admin/smoke', '/admin/nfsmoke']) ok(`governance page ${p}`, (await fetch(base + p)).status === 200);
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  const cr = await tool('get_change_list', {}); ok('reset clears the change list and resumes every agent', cr.entries.length === 0 && cr.rule_sets.every((a) => a.state === 'Active') && (await nf('get_change_list', {})).rule_sets.every((a) => a.state === 'Active'));
});
// P14 Match Agent on Northfield's connection: six tools there and none on Ashby's, a session leaves the recorded world unchanged,
// its writes carry attribution on Northfield's access log, and Ashby's scope refuses Northfield's accounts payable records.
await withServer({}, 3975, async ({ base, client, nfClient, tool, nf }) => {
  const asNames = (await client.listTools()).tools.map((t) => t.name); ok('Match: Ashby’s connection lists no match_* tool', !asNames.some((n) => n.startsWith('match_')));
  const su = await nf('match_setup', {}); ok('Match: setup lists the held queue at the moment, facts, modes and guardrails', su.as_of === '2026-11-10T14:00:00.000Z' && su.queue_at_moment.map((q) => `${q.invoice}:${q.holds.map((h) => h.rule)}`).join() === 'INV-7731:NF-7.8' && su.facts.billed_line1.recorded === 300 && su.actions.release_for_payment_proposal.mode === 'suggest' && su.actions.release_for_payment_proposal.jordan_may_change === false && su.guardrails.length === 3, JSON.stringify(su.queue_at_moment).slice(0, 200));
  const sql = "SELECT (SELECT count(*) FROM invoices) i, (SELECT count(*) FROM documents WHERE po = 'NR-450118') d, (SELECT count(*) FROM errors) e, (SELECT group_concat(status) FROM invoices WHERE po = 'NR-450118') st";
  const before = JSON.stringify((await nf('run_readonly_sql', { sql })).rows), tw0 = JSON.stringify((await nf('three_way_match', { reference: 'INV-7731', as_of: '2026-11-10T09:00:00-05:00' })).lines);
  const mb = await nf('match_baseline', {}); const mt = await nf('match_baseline', { variation: 'triple_mismatch' });
  const after = JSON.stringify((await nf('run_readonly_sql', { sql })).rows), tw1 = JSON.stringify((await nf('three_way_match', { reference: 'INV-7731', as_of: '2026-11-10T09:00:00-05:00' })).lines);
  ok('Match: a session leaves the recorded world unchanged', mb.outcome?.first_step === 'reject_held_lines' && mb.outcome?.payment_released === false && mt.outcome?.proposed_clear_for_payment.join() === '3' && before === after && tw0 === tw1, `${before} -> ${after}`);
  const ms = await nf('match_start', {}); ok('Match: start without a model key says so and simulates nothing', !!ms.blocked && ms.awaiting.length === 0 && ms.overhead.model_calls === 0, JSON.stringify(ms.blocked));
  ok('Match: Ashby sees the hold and requests only', JSON.stringify(mb.ashby_sees).includes('AA-INV-7731') && !/"(proposal|proposals|payment_released|settling_record|lines_status)":/.test(JSON.stringify(mb.ashby_sees)));
  const ml = (await nf('get_access_log', { limit: 200 })).calls.filter((c) => c.tool.startsWith('match:'));
  ok('Match: writes on Northfield’s access log with agent, authority, approver and outcome', ml.length >= 5 && ml.every((c) => (c.write?.proposed_by || c.write?.rules) && c.write.authority.rule && ['suggest', 'approve', 'policy'].includes(c.write.authority.mode) && c.write.approver && c.write.outcome) && ml.some((c) => c.write.authority.mode === 'suggest' && /Jordan Ellis acts/.test(c.write.approver)) && ml.some((c) => c.write.approver === 'Test approver (replay)' || /^Standing policy/.test(c.write.approver)), `${ml.length}`);
  ok('Match: Ashby’s access log holds no Match entry', !(await tool('get_access_log', { limit: 200 })).calls.some((c) => c.tool.startsWith('match')));
  const ap = await tool('read_retailer_records', { question: 'Northfield accounts payable match for INV-7731' }); ok('Match: Ashby’s scope refuses Northfield’s accounts payable records', ap.result === 'Not available to Ashby' && /accounts payable/.test(ap.message), JSON.stringify(ap).slice(0, 160));
  // match_* tools are refused on Ashby's connection: not listed, and a call by name is an error, not an answer.
  { let refusedAll = true; for (const name of ['match_setup', 'match_start', 'match_decide', 'match_state', 'match_baseline', 'match_replay']) { try { const r = await client.callTool({ name, arguments: {} }); if (!r.isError) refusedAll = false; } catch { /* refused */ } }
    ok('Match: every match_* call on Ashby’s connection is refused', refusedAll); }
  ok('Match: each hold links the PO, receiving advice and invoice', su.queue_at_moment[0].holds[0].rule === 'NF-7.8' && su.queue_at_moment[0].holds[0].advice === 'Rule engine (this session)' && su.queue_at_moment[0].compared.purchase_order.link?.endsWith('/records/northfield/order/NR-450118') && su.queue_at_moment[0].compared.invoice.link?.endsWith('/records/northfield/document/INV-7731') && su.queue_at_moment[0].compared.receiving_advice.length === 2 && su.queue_at_moment[0].compared.receiving_advice.every((r) => /\/records\/northfield\/document\/RCV-/.test(r.link)), JSON.stringify(su.queue_at_moment[0].compared).slice(0, 200));
  { const lk = await fetch(su.queue_at_moment[0].compared.receiving_advice[0].link.replace(/^https?:\/\/[^/]+/, base)); ok('Match: a linked receiving advice opens on Northfield’s records', lk.ok, String(lk.status)); }
  { const rp = await nf('match_replay', {}); const cl = await nf('get_change_list', { kind: 'trial' }); const ac = await tool('get_change_list', { kind: 'trial' });
    ok('Match: replay without a model is recorded as a trial on Northfield’s change list only', !!rp.trial && !!rp.model_run?.blocked && cl.entries.some((e) => e.id === rp.trial && e.runtime === 'match' && e.kind === 'trial') && !ac.entries.some((e) => e.runtime === 'match'), JSON.stringify(rp).slice(0, 200)); }
  { const sq = await tool('run_readonly_sql', { sql: 'SELECT * FROM review_notes' }); ok('Match: Ashby’s SQL refuses Northfield’s reviewer notes with its own refusal text', sq.result === 'Not available to Ashby' && /^Not available to Ashby: Northfield’s accounts payable, draft rules and claims reviewer notes belong to Northfield Retailer\.$/.test(sq.message), JSON.stringify(sq)); }
  { const md = await nf('match_decide', { session: mb.session, proposal: 'MP-1', decision: 'approve' }); ok('Match: an executed proposal cannot be approved again', md.result === 'Refused', JSON.stringify(md).slice(0, 160)); }
  await nf('pause_agent', { agent: 'Match Agent' }); const pz = await nf('match_start', {}); ok('Match: paused, each held invoice is a plain task with no model call', pz.status === 'paused' && pz.plain_task?.proposal === null && pz.overhead.model_calls === 0 && !pz.blocked, JSON.stringify(pz).slice(0, 160));
});
// P21 Admin and rules: rules by source; an Ashby rule changed with its effect shown first; the next agent run reads it; an approval
// mode set in admin reaches the next run; Northfield cannot edit Ashby's rules and Ashby cannot edit Northfield's; reset restores.
await withServer({}, 3975, async ({ base, tool, nf }) => {
  const src = await tool('list_rules_by_source'); const g = Object.fromEntries(src.groups.map((x) => [x.source, x]));
  ok('rules by source: Ashby manual rules editable, Northfield guide read-only', g['Ashby manual rules'].count === 24 && !g['Ashby manual rules'].read_only && g['Northfield guide'].read_only && g['Northfield guide'].count === 78 && g['Northfield guide'].rules.filter((r) => r.state === 'In force from a later date').length === 13 && g['Ashby manual rules'].rules.find((r) => r.id === 'AP-4.1').created_by === 'Priya Raman' && g['Ashby manual rules'].rules.find((r) => r.id === 'AP-4.1').params === null && !g['Ashby manual rules'].rules.find((r) => r.id === 'AP-4.1').editable_here && /Every dispute of a deduction needs Priya Raman’s approval/.test(g['Ashby manual rules'].rules.find((r) => r.id === 'AP-4.1').rule), JSON.stringify(src.groups.map((x) => [x.source, x.count])));
  ok('Northfield sees no Ashby rule', (await nf('list_rules_by_source')).groups.find((x) => x.source === 'Ashby manual rules').count === 0);
  const preview = await tool('update_supplier_rule', { rule: 'AP-6.1', params: { min_weekly_avg: 500 }, records: ['114', '207'], as_of: '2026-10-26T08:07:00-04:00' });
  ok('a rule change shows its effect first and saves nothing', preview.result === 'Effect shown; nothing saved' && preview.effect.changed.some((c) => c.record === '114') && (await tool('list_rules_by_source')).groups.find((x) => x.source === 'Ashby manual rules').rules.find((r) => r.id === 'AP-6.1').params.min_weekly_avg === 1 && (await tool('update_supplier_rule', { rule: 'AP-4.1', params: { max_amount: 50 } })).result === 'Invalid request', JSON.stringify(preview.effect).slice(0, 200));
  ok('another company’s rule is read-only', (await tool('update_supplier_rule', { rule: 'NF-4.2', params: { hours: 2 } })).result === 'Invalid request' && (await nf('update_supplier_rule', { rule: 'AP-6.1', params: { min_weekly_avg: 2 } }).catch(() => ({ result: 'Invalid request' }))).result !== 'Rule changed');
  const ch = preview.effect.changed[0] || {}; const before = await tool('recommend_next_step', { job: 'shelf', record: ch.record, as_of: '2026-10-26T08:07:00-04:00' });
  const saved = await tool('update_supplier_rule', { ...{ rule: 'AP-6.1', params: { min_weekly_avg: 500 }, records: ['114', '207'], as_of: '2026-10-26T08:07:00-04:00' }, apply: true });
  ok('apply saves the change with who made it, on the change list', saved.result === 'Rule changed' && /at least 500 pair/.test(saved.statement) && (await tool('get_change_list', { kind: 'rule_change' })).entries[0]?.run_by === 'Priya Raman', JSON.stringify(saved).slice(0, 200));
  const nx = await tool('recommend_next_step', { job: 'shelf', record: ch.record, as_of: '2026-10-26T08:07:00-04:00' });
  ok('the next rule run reads the changed value', nx.next_step !== before.next_step && nx.next_step === ch.with_change?.next_step, `${ch.record}: ${before.next_step} -> ${nx.next_step}`);
  // Aviator's permissions per action (P21, 18 November 2026): editable ones start at answer only, a change is recorded with who made it, locked ones refuse.
  { const p0 = (await tool('get_change_list', {})).aviator_permissions; const by = (p, k) => p.actions.find((x) => x.action === k);
    ok('Aviator permissions start at the action card, with the locked actions shown locked', by(p0, 'open_dispute').permission === 'propose_action_card' && by(p0, 'answer_order_change').permission === 'propose_action_card' && by(p0, 'release_held_ship_notice').editable === false && by(p0, 'release_held_ship_notice').approver === 'Priya Raman' && p0.locked.length === 4, JSON.stringify(p0).slice(0, 300));
    const ch = await tool('set_agent_mode', { agent: 'aviator', action: 'open_dispute', mode: 'answer_only' }); const p1 = (await tool('get_change_list', {})); const e = p1.entries.find((x) => x.kind === 'aviator_permission');
    ok('an Aviator permission change is recorded on the change list with who made it', ch.result === 'Permission changed' && ch.from === 'propose_action_card' && by(p1.aviator_permissions, 'open_dispute').permission === 'answer_only' && by(p1.aviator_permissions, 'open_dispute').set_by === 'Priya Raman' && e?.assistant === 'Aviator' && e?.change.to === 'answer_only' && e?.run_by === 'Priya Raman', JSON.stringify(e));
    ok('a locked Aviator action and an unknown value are refused', (await tool('set_agent_mode', { agent: 'aviator', action: 'release_held_ship_notice', mode: 'answer_only' })).result === 'Invalid request' && (await tool('set_agent_mode', { agent: 'aviator', action: 'open_dispute', mode: 'policy' })).result === 'Invalid request'); }
  const m = await tool('set_agent_mode', { agent: 'Shelf Agent', action: 'recommend_order', mode: 'suggest' });
  ok('set_agent_mode records the standing mode', m.result === 'Mode changed' && m.from === 'policy' && m.to === 'suggest', JSON.stringify(m));
  ok('a locked action cannot change mode', (await tool('set_agent_mode', { agent: 'Shelf Agent', action: 'wait_for_transit', mode: 'approve' })).result === 'Invalid request');
  const sb = await tool('shelf_baseline', {});
  ok('the next run uses the standing mode: recommend_order only suggests', JSON.stringify(sb.trace).includes('suggest') || (sb.suggested || []).some((x) => x.action === 'recommend_order'), JSON.stringify(sb.suggested || []).slice(0, 160));
  await fetch(`${base}/admin/smoke/reset`, { method: 'POST', redirect: 'manual' });
  ok('reset restores the catalogue and clears standing modes', (await tool('list_rules_by_source')).groups.find((x) => x.source === 'Ashby manual rules').rules.find((r) => r.id === 'AP-6.1').params.min_weekly_avg === 1 && !(await tool('get_change_list', { kind: 'mode' })).entries.length);
});


// ---------- Aviator (18 November 2026) ----------
// 1. Every tool on both connections, and every runtime's own tools, converts to the model's schema subset (enums only as
//    strings). The live Ashby connection failed here: orders_needing_attention.kinross_window_hours was a numeric enum.
// 2. With a model key, ask_aviator answers on both connections, one question per story calendar page, on the connection of
//    whoever sees it; quantities read in cases (never units); no answer or instruction names an agent.
{ const A = await import('../src/aviator.js'); const T = await import('../src/tools.js');
  const rt = { match: (await import('../src/match.js')).AGENT_TOOLS, watch: (await import('../src/watch.js')).AGENT_TOOLS, scout: (await import('../src/scout.js')).AGENT_TOOLS };
  for (const [f, n] of [['claim', 'Claim'], ['chase', 'Chase'], ['pace', 'Pace'], ['review', 'Review'], ['shelf', 'Shelf']]) rt[f] = (await import(`../src/${f}.js`))[n].AGENT_TOOLS;
  const own = [['Ashby read tools', T.TOOLS], ['Northfield read tools', T.NF_TOOLS], ...Object.entries(rt).map(([k, v]) => [`${k} runtime`, v])].flatMap(([k, v]) => A.modelSchemaProblems(A.declarations(v)).map((p) => `${k}: ${p}`));
  ok('model schemas: every Aviator and runtime tool is in the model’s subset, enums as strings', own.length === 0, own.slice(0, 5).join('; '));
  ok('model schemas: kinross_window_hours goes as "24"/"48" and comes back as 24/48', JSON.stringify(A.declarations(T.TOOLS).find((d) => d.name === 'orders_needing_attention').parameters.properties.kinross_window_hours.enum) === '["24","48"]' && A.modelArgs(T.TOOLS, 'orders_needing_attention', { kinross_window_hours: '48', include_warehouse: 'true' }).kinross_window_hours === 48 && A.modelArgs(T.TOOLS, 'orders_needing_attention', { include_warehouse: 'true' }).include_warehouse === true);
  ok('model schemas: Aviator’s instruction names no agent and asks for quantities in the record’s unit', !/Agent/.test(A.instruction({ person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer', clock: 'x' })) && /never call a quantity units/.test(A.instruction({ person: 'p', company: 'c', other: 'o', clock: 'x' })));
  await withServer({ WRITES: 'off' }, 3976, async ({ client, nfClient, tool, nf }) => {
    const all = [...(await client.listTools()).tools.map((t) => ['Ashby', t]), ...(await nfClient.listTools()).tools.map((t) => ['Northfield', t])];
    const bad = all.flatMap(([c, t]) => A.modelSchemaProblems([{ name: t.name, parameters: A.toModel(t.inputSchema) }]).map((p) => `${c} ${p}`));
    ok(`model schemas: all ${all.length} tools on both connections convert to the model’s subset`, bad.length === 0, bad.slice(0, 5).join('; '));
    { const np = (await nf('get_change_list', {})).aviator_permissions; ok('Northfield: every action starts at the card; deciding a charge is locked to the card Jordan presses', np.actions.map((x) => `${x.action}:${x.permission}:${x.editable}`).join() === 'send_application_advice:propose_action_card:true,decide_charge:propose_action_card:false,decide_chargeback:propose_action_card:true,draft_rule:propose_action_card:true,publish_rule:propose_action_card:true', JSON.stringify(np.actions));
      const full = await nf('replay_draft_rule', { draft: 'NFD-1' }); const part = await nf('replay_draft_rule', { draft: 'NFD-1', as_of: '2026-11-17T11:00:00-05:00' });
      ok('a draft rule replays as of a time: fewer documents than the quarter, and it says up to when', part.documents_up_to === '2026-11-17 11:00 ET' && part.documents_replayed < full.documents_replayed && part.failing_with_draft < full.failing_with_draft && !('documents_up_to' in full), `${part.documents_replayed} of ${full.documents_replayed}`); }
    if (!process.env.GEMINI_API_KEY) { console.log('SKIPPED Aviator answers per calendar page: no GEMINI_API_KEY on this machine (run the smoke test where the key is set)'); return; }
    const cal = (await tool('get_story_calendar')).moments;
    // One question per page, asked as of the page's moment; q marks a question whose answer must give quantities.
    const Q = { P2: ['What does Northfield require before a drop-ship order ships?'], P21: ['Which of the rules we trade under can we change ourselves?'], P15: ['What would draft rule NFD-1 have charged over the quarter?'],
      P23: ['What changed on NR-450118 today, and how many does line 1 now order?', 'q'], P13: ['Which open orders are missing a document Northfield requires?'], P5: ['How many are ordered on NR-460207, and when is its pickup?', 'q'],
      P11: ['Why is ship notice ASN-78260 held?'], P24: ['Did Lakeline pick up NR-46602 today, and how many were ordered?', 'q'], P9: ['How many did order NR-451207 order for store 114?', 'q'],
      P14: ['Why does INV-7731 not match its order and receipt? Give the quantities.', 'q'], P8: ['How many were received on NR-450118?', 'q'], P6: ['How many are claimed short in case DC-40877?', 'q'],
      P20: ['Which promotion deductions came on remittance PMT-990168?'], P7: ['What is Ashby’s on-time, in-full rate for the quarter, and how much failed?', 'q'], P22: ['How many findings were confirmed this quarter?'] };
    for (const m of cal) {
      const [q, qty] = Q[m.id] || []; if (!q) { ok(`aviator: a question for ${m.id}`, false); continue; }
      const sides = /then/.test(m.seen_by) ? [['Ashby', tool], ['Northfield', nf]] : /Jordan/.test(m.seen_by) ? [['Northfield', nf]] : [['Ashby', tool]];
      for (const [side, ask] of sides) {
        const r = await ask('ask_aviator', { question: `As of ${m.as_of_eastern}: ${q}` }); const text = r.answer || '';
        ok(`aviator ${m.id} on ${side}: answers from its tools`, r.ok === true && r.answered_from_tools === true, `${r.status || ''} ${r.message || ''} ${(r.detail || '').slice(0, 160)}`);
        ok(`aviator ${m.id} on ${side}: names no agent`, !/\bAgent\b/.test(JSON.stringify(r)), text.slice(0, 160));
        if (qty) ok(`aviator ${m.id} on ${side}: quantities in cases, never units`, /\bcases?\b/i.test(text) && !/\bunits?\b/i.test(text), text.slice(0, 200));
      }
    }
  });
}

console.log(`${pass} smoke checks passed, ${fails.length} failed`); for (const f of fails) console.log(`FAIL ${f}`); process.exit(fails.length ? 1 : 0);
