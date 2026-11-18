// No tool response names an agent (17 November 2026). Starts the server, calls every tool on both connections with
// representative arguments (every story moment, every session preset, pauses, modes, trials, disputes, decisions), and
// fails if any result holds the word "Agent" or a key that calls a rule set an agent, or any tool title, description or
// connection instruction names one. Tool names and their `agent` argument are left as they are.
// Usage: npm run names   (add -v to list every place found)
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const PORT = 3979; const base = process.env.BASE || `http://127.0.0.1:${PORT}`;
const server = process.env.BASE ? null : spawn('node', ['--no-warnings', 'src/server.js'], { env: { ...process.env, MCP_TOKEN: 'a', NF_TOKEN: 'b', PORT: String(PORT) }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
const verbose = process.argv.includes('-v');
const hits = {}; const called = {};
function scan(conn, tool, v, path = '') {
  if (Array.isArray(v)) return v.forEach((x, i) => scan(conn, tool, x, `${path}[]`));
  if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (/agent/i.test(k)) add(conn, tool, `KEY ${path}.${k}`, typeof x === 'string' ? x : typeof x); scan(conn, tool, x, `${path}.${k}`); } return; }
  if (typeof v === 'string' && /Agent/.test(v)) add(conn, tool, `VAL ${path}`, v);
}
function add(conn, tool, where, sample) { const k = `${conn} ${tool} ${where}`; (hits[k] ||= new Set()).add(String(sample).slice(0, 140)); }
// Stored records read through run_readonly_sql (18 November 2026): event and document bodies, deduction case and dispute
// records, the finding log and every other table the connection can query. A tool result is reworded on its way out, so
// this counts in SQL instead (GLOB is case-sensitive): a value holding "Agent", an "agent" key in a JSON body, an event
// kind starting agent., or a recommendation that says it was sent to someone.
async function stored(conn, call) {
  const sql = async (q) => (await call('run_readonly_sql', { sql: q })).rows || [];
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name); let cols = 0;
  if (!tables.length) add(conn, 'run_readonly_sql', 'STORED', 'could not list tables');
  for (const t of tables) { const one = await sql(`SELECT * FROM "${t}" LIMIT 1`); if (!one.length) continue;
    for (const c of Object.keys(one[0])) { cols++; const n = (await sql(`SELECT count(*) n FROM "${t}" WHERE typeof("${c}") = 'text' AND ("${c}" GLOB '*Agent*' OR "${c}" GLOB '*"agent"*' OR "${c}" GLOB '*agent_*":*')`))[0]?.n; if (n) add(conn, 'run_readonly_sql', `STORED ${t}.${c}`, `${n} rows`); } }
  for (const [what, q] of [['event kind agent.*', "SELECT count(*) n FROM events WHERE kind GLOB 'agent*'"], ['recommendation with sent_to', "SELECT count(*) n FROM events WHERE kind GLOB '*recommendation' AND data GLOB '*sent_to*'"],
    ['case or dispute record drafted by an agent', "SELECT count(*) n FROM events WHERE kind GLOB 'case.*' AND (data GLOB '*Agent*' OR data GLOB '*agent*')"]]) { const n = (await sql(q))[0]?.n; if (n) add(conn, 'run_readonly_sql', `STORED ${what}`, `${n} rows`); }
  console.log(`${conn}: ${tables.length} tables, ${cols} columns of stored records read through run_readonly_sql`);
}
async function side(conn, tok, plan) {
  const c = new Client({ name: 'sweep', version: '1' }); await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${tok}`)));
  const { tools } = await c.listTools(); const names = new Set(tools.map((t) => t.name));
  for (const t of tools) { if (/Agent/.test(`${t.title || ''} ${t.description || ''}`)) add(conn, t.name, 'DESCRIPTION', (`${t.title} ${t.description}`.match(/.{0,40}Agent.{0,40}/) || [''])[0]); for (const [k, v] of Object.entries(t.inputSchema.properties || {})) if (/Agent/.test(v.description || '')) add(conn, t.name, `ARGUMENT ${k}`, v.description); }
  const ins = c.getInstructions?.() || ''; if (/Agent/.test(ins)) add(conn, '(connection)', 'INSTRUCTIONS', (ins.match(/.{0,40}Agent.{0,40}/) || [''])[0]);
  const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); const text = r.content.map((x) => x.text).join('\n'); let j; try { j = JSON.parse(text); } catch { j = text; } (called[`${conn} ${name}`] ||= 0); called[`${conn} ${name}`]++; scan(conn, name, j); return j; };
  await plan(call, names);
  await stored(conn, call);
  for (const n of names) if (!called[`${conn} ${n}`]) console.log('NOT CALLED', conn, n);
  await c.close();
}
const sess = async (call, p, variations, extra = {}) => {
  await call(`${p}_setup`);
  for (const v of variations) { const b = await call(`${p}_baseline`, { variation: v });
    if (b.session) { await call(`${p}_state`, { session: b.session, ...(extra.adv ? { advance_minutes: 600 } : {}) }); }
    const s = await call(`${p}_start`, { variation: v });
    const sid = s.session; const prop = (s.awaiting || s.proposals || [])[0];
    if (sid) await call(`${p}_state`, { session: sid });
    if (sid && prop) await call(`${p}_decide`, { session: sid, proposal: prop.id || prop.proposal || prop, decision: 'approve' });
    else if (sid) await call(`${p}_decide`, { session: sid, proposal: 'P-1', decision: 'approve' });
  }
  await call(`${p}_replay`, { variation: variations[0], detail: 'full' });
};
try {
await side('AS', process.env.TOK_AS || 'a', async (call) => {
  await call('get_story_calendar'); await call('list_rules_by_source'); await call('lookup_retailer_rules', {}); await call('lookup_retailer_rules', { rule_id: 'NF-7.4' });
  for (const as_of of [undefined, '2026-11-18T09:00:00-05:00', '2026-12-08T17:12:00-05:00', '2026-12-28T09:00:00-05:00', '2027-01-09T17:00:00-05:00']) {
    const a = as_of ? { as_of } : {};
    await call('orders_needing_attention', { ...a, include_warehouse: true }); await call('edi_health_summary', a); await call('list_deductions', a); await call('get_scorecard', { ...a, lines: true });
    for (const p of ['quarter', 'prior', 'all']) await call('finding_outcomes', { ...a, period: p, list: true });
    for (const po of ['NR-450118', 'NR-460207', 'NR-46215', 'NR-451207', 'NR-46156', 'NR-450390', 'NR-450415', 'NR-46220']) await call('get_order', { po, ...a });
    for (const cs of ['DC-40877', 'DC-40931', 'DC-41102', 'DC-41118', 'DC-41131']) await call('get_deduction_case', { case: cs, ...a });
    for (const [job, record] of [['missing_document', 'NR-46215'], ['deduction', 'DC-40877'], ['trade_test', 'ASN-78214'], ['shelf', '114'], ['shipment_risk', 'NR-460207'], ['scorecard', undefined]]) await call('recommend_next_step', { job, ...(record ? { record } : {}), ...a });
  }
  const fo = await call('finding_outcomes', { period: 'all', list: true, as_of: '2027-01-09T17:00:00-05:00' });
  { const ids = [...new Set((JSON.stringify(fo).match(/"(?:id|finding)":\s*"(F[A-Z]*-[^"]+)"/g) || []).map((x) => x.split('"')[3]))]; if (verbose) console.log('finding ids', ids.length, ids.slice(0, 3)); for (const id of ids.slice(0, 300)) await call('finding_outcomes', { finding: id, as_of: '2027-01-09T17:00:00-05:00' }); }
  for (const r of ['ASN-450118-1', 'ASN-450118-2', 'ASN-46118', 'INV-7731', 'ASN-78260', 'PMT-990168', 'RCV-DC2-77355', 'ASN-78214']) { await call('get_document', { reference: r }); await call('explain_rejection', { reference: r }); }
  await call('check_deliveries', { pos: ['NR-450118', 'NR-46101', 'NR-46156'] });
  await call('compare_with_other_suppliers', { question: 'rank' }); await call('read_retailer_records', { question: 'payables' });
  await call('request_change', { action: 'send corrected ship notice', po: 'NR-46156' }); await call('release_ship_notice', { document: 'ASN-78260' }); await call('release_ship_notice', { document: 'ASN-450118-1', po: 'NR-450118' });
  for (const cs of ['DC-40877', 'DC-40931', 'DC-41102']) await call('submit_dispute', { case: cs, as_of: '2026-12-28T09:00:00-05:00' });
  await call('run_readonly_sql', { sql: "SELECT * FROM events WHERE data LIKE '%Agent%' LIMIT 200" });
  await call('run_readonly_sql', { sql: "SELECT * FROM documents WHERE body LIKE '%Agent%' LIMIT 50" });
  await call('ask_aviator', { question: 'What is the order value of NR-450118?' });
  for (const a of ['claim', 'Scout Agent', 'shelf', 'Ashby’s performance rules', 'watch', 'test', 'nope']) { await call('pause_agent', { agent: a, reason: 'sweep' }); await call('resume_agent', { agent: a, reason: 'sweep' }); }
  await call('set_agent_mode', { agent: 'claim', action: 'submit_dispute', mode: 'policy' }); await call('set_agent_mode', { agent: 'claim', action: 'nope', mode: 'approve' }); await call('set_agent_mode', { agent: 'shelf', action: 'recommend_order', mode: 'suggest' }); await call('set_agent_mode', { agent: 'shelf', action: 'recommend_order', mode: 'approve' });
  for (const [job, rule, params, records] of [['deduction', 'AP-4.1', { max_amount: 150 }], ['missing_document', 'AP-3.4', { hours_left: 4 }, ['NR-46215']], ['shelf', 'AP-6.1', { min_weekly_avg: 500 }, ['114', '207']], ['shelf', 'AP-6.4', { carton: 80 }, ['114']]]) await call('replay_agent_rule', { job, rule, params, ...(records ? { records } : {}), as_of: '2026-10-26T08:07:00-04:00' });
  await call('update_supplier_rule', { rule: 'AP-4.1', params: { max_amount: 80 } }); await call('update_supplier_rule', { rule: 'AP-3.4', params: { hours_left: 4 } }); await call('update_supplier_rule', { rule: 'AP-6.1', params: { min_weekly_avg: 500 }, records: ['114', '207'], as_of: '2026-10-26T08:07:00-04:00' });
  await sess(call, 'scout', ['canonical', 'no_free_stock', 'no_time', 'bad_label']);
  await sess(call, 'watch', ['canonical', 'window_48', 'kinross_unreachable', 'departure_scanned_46220', 'early_fulfilment_46302', 'rejected_ship_notice_46156'], { adv: 1 });
  await call('watch_start', { run_by: 'rules' });
  await sess(call, 'claim', ['canonical', 'december_28', 'kinross_unreachable', 'northfield_upholds', 'promotions'], { adv: 1 });
  await sess(call, 'pace', ['canonical', 'mid_december', 'end_november'], { adv: 1 });
  await sess(call, 'shelf', ['canonical', 'in_transit', 'jordan_declines'], { adv: 1 });
  await call('get_change_list', { limit: 100 }); await call('get_access_log', { limit: 200 });
});
await side('NF', process.env.TOK_NF || 'b', async (call) => {
  await call('get_story_calendar'); await call('list_rules_by_source'); await call('lookup_rules', {}); await call('list_draft_rules');
  for (const as_of of [undefined, '2026-11-10T09:00:00-05:00', '2026-12-01T09:00:00-05:00', '2026-12-28T09:00:00-05:00', '2027-01-09T17:00:00-05:00']) {
    const a = as_of ? { as_of } : {};
    await call('supplier_document_trail', { po: 'NR-450118', ...a }); await call('supplier_document_trail', { supplier: 'Ashby Supplier', days: 30, ...a }); await call('supplier_scorecard', { lines: true, ...a }); await call('list_deduction_cases', a);
    for (const p of ['quarter', 'prior', 'all']) await call('finding_outcomes', { ...a, period: p, list: true });
    for (const cs of ['DC-40877', 'DC-40931', 'DC-41102', 'DC-41118', 'DC-41131']) await call('review_deduction_case', { case: cs, ...a });
    for (const r of ['INV-7731', 'NR-450118', 'INV-7731C', 'NR-450390', 'NR-46215', 'NR-460207']) await call('three_way_match', { reference: r, ...a });
  }
  const fo = await call('finding_outcomes', { period: 'all', list: true, as_of: '2027-01-09T17:00:00-05:00' });
  { const ids = [...new Set((JSON.stringify(fo).match(/"(?:id|finding)":\s*"(F[A-Z]*-[^"]+)"/g) || []).map((x) => x.split('"')[3]))]; if (verbose) console.log('finding ids', ids.length, ids.slice(0, 3)); for (const id of ids.slice(0, 300)) await call('finding_outcomes', { finding: id, as_of: '2027-01-09T17:00:00-05:00' }); }
  for (const r of ['ASN-450118-1', 'INV-7731', 'RCV-DC2-77355', 'PMT-990168']) await call('get_document', { reference: r });
  await call('replay_draft_rule', { draft: 'NFD-1' }); await call('replay_draft_rule', { draft: 'NFD-2' }); await call('publish_rule', { draft: 'NFD-1' });
  await call('decide_charge', { case: 'DC-40877', charge: 'SH01', decision: 'Reversed', reason: 'sweep', as_of: '2026-12-02T09:00:00-05:00' });
  await call('request_change', { action: 'ask for a corrected invoice', po: 'NR-450118' }); await call('read_supplier_records', { question: 'warehouse' });
  await call('run_readonly_sql', { sql: "SELECT * FROM events WHERE data LIKE '%Agent%' LIMIT 200" }); await call('run_readonly_sql', { sql: "SELECT * FROM review_notes LIMIT 50" });
  await call('ask_aviator', { question: 'Why is INV-7731 held?' });
  for (const a of ['review', 'Match Agent', 'Northfield’s ship notice rules', 'nope']) { await call('pause_agent', { agent: a, reason: 'sweep' }); await call('three_way_match', { reference: 'INV-7731' }); await call('review_deduction_case', { case: 'DC-40877', as_of: '2026-12-01T09:00:00-05:00' }); await call('resume_agent', { agent: a, reason: 'sweep' }); }
  await call('set_agent_mode', { agent: 'review', action: 'nope', mode: 'approve' });
  await sess(call, 'review', ['canonical', 'as02', 'tally_by_sscc', 'tally_count_only'], { adv: 1 });
  await sess(call, 'chase', ['canonical', 'mixed_trails', 'lakeline_unreachable'], { adv: 1 });
  await sess(call, 'match', ['canonical', 'correction_on_file', 'price_set_by_change', 'price_beyond_tolerance', 'total_differs', 'triple_mismatch', 'ashby_free_text', 'ashby_free_text_proved', 'ashby_dispute', 'ashby_no_answer']);
  await call('get_change_list', { limit: 100 }); await call('get_access_log', { limit: 200 });
});
const keys = Object.keys(hits).sort();
const byTool = {}; for (const k of keys) { const [conn, tool] = k.split(' '); (byTool[`${conn} ${tool}`] ||= []).push(k); }
console.log(`${Object.keys(called).length} tools called on both connections, ${Object.values(called).reduce((a, b) => a + b, 0)} calls; ${keys.length ? `${Object.keys(byTool).length} tools name an agent in ${keys.length} places` : 'no result, title, description or instruction names an agent'}`);
for (const [t, ks] of Object.entries(byTool)) { console.log(`\n## ${t}`); for (const k of ks) { const s = [...hits[k]]; console.log(`  ${k.split(' ').slice(2).join(' ')}  (${s.length})${verbose ? '\n      ' + s.slice(0, 6).join('\n      ') : '  e.g. ' + s[0]}`); } }
process.exitCode = keys.length ? 1 : 0;
} finally { if (server) { await fetch(`${base}/admin/a/reset`, { method: 'POST', redirect: 'manual' }).catch(() => {}); server.kill(); } } // the sweep's proposals, pauses and trials are cleared: the built world is left at baseline
