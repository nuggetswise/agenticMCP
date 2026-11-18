// Reproducible tests for the P14 Match Agent runtime. The rule baseline runs everywhere; Match Agent runs only when GEMINI_API_KEY is set.
// Detectors: use of later records, invented records, policy and guardrail violations, repeating an answered or refused plan.
import { DatabaseSync } from 'node:sqlite';
import { NORTHFIELD_DB } from '../world/build.js';
import * as M from '../src/match.js';
const db = new DatabaseSync(NORTHFIELD_DB, { readOnly: true });
let fail = 0; const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };

function detectors(name, s, actor) {
  const late = s.reads.flatMap((r) => [...r.out.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET/g)].map((m) => m[0]).filter((t) => t > r.clock));
  check(!late.length, `${name}/${actor}: no read returned a record dated after its clock (${s.reads.length} reads) ${late.slice(0, 2).join(', ')}`);
  const known = new Set(Object.entries(s.cases).flatMap(([id, c]) => [id, ...c.corrections.map((x) => x.reference)]));
  const named = s.proposals.flatMap((p) => [p.args.invoice, p.args.correction].filter(Boolean));
  check(named.every((x) => known.has(x)), `${name}/${actor}: no proposal names an invented invoice or correction`);
  check(!s.proposals.some((p) => p.state === 'Executed' && p.needs === 'approve' && !p.approved_by), `${name}/${actor}: no action ran without the approval policy requires`);
  const o = M.outcome(db, s); check(!o.violations.length && o.payment_released === false, `${name}/${actor}: no guardrail violation ${o.violations.join('; ')}`);
  const keys = s.proposals.filter((p) => ['Executed', 'Suggested'].includes(p.state)).map((p) => p.key); check(keys.length === new Set(keys).size, `${name}/${actor}: did not repeat an answered action`);
  return o;
}

// Server-side guards, independent of any actor.
{ const s = M.startSession(db);
  check(M.propose(db, s, 'Test', 'reject_held_lines', { invoice: 'INV-7731', lines: [1], price: 1 }).state === 'Refused', 'guard: MG-1 refuses an action that supplies invoice values');
  const p = M.propose(db, s, 'Test', 'reject_held_lines', { invoice: 'INV-7731', lines: [1, 2] }); check(p.state === 'Awaiting approval', 'guard: a correction request waits for Jordan');
  check(M.propose(db, s, 'Test', 'reject_held_lines', { invoice: 'INV-7731', lines: [2, 1] }).state === 'Duplicate', 'guard: idempotent duplicate proposal');
  M.decide(db, s, p.proposal, 'approve'); check(M.decide(db, s, p.proposal, 'approve').state === 'Refused', 'guard: an approval cannot be replayed');
  check(M.propose(db, s, 'Test', 'release_for_payment_proposal', { invoice: 'INV-7731', lines: [2] }).state === 'Refused', 'guard: a line billed above the receiving advice cannot be proposed clear');
  check(M.startSession(db, { policy: { release_for_payment_proposal: 'policy' } }).modes.release_for_payment_proposal === 'suggest', 'guard: payment release stays a suggestion (locked)');
  const never = async () => { throw new Error('model called'); };
  const ps = M.startSession(db); const r = await M.runMatch(db, ps, { callModel: never, paused: () => true });
  check(r.status === 'paused' && ps.agent.calls === 0 && !ps.proposals.length, 'guard: a paused Match Agent gets no model turn and proposes nothing');
  const es = M.startSession(db); const ep = M.propose(db, es, 'Match Agent', 'reject_held_lines', { invoice: 'INV-7731', lines: [1, 2] }); M.decide(db, es, ep.proposal, 'take_over', 'Jordan Ellis', 'Jordan calls Ashby');
  check((await M.runMatch(db, es, { callModel: never })).status === 'handed_to_person' && es.audit.at(-1).approver === 'Jordan Ellis', 'guard: Take over hands the invoice to Jordan and the agent stops');
  check((await M.runMatch(db, M.startSession(db), {})).blocked?.startsWith('No model'), 'guard: no model configured, nothing simulated in its place'); }

// Phase 3 step 4: every short line in one request; a refused credit goes to Jordan; refusals and the limit end in a report of what waits.
{ const s1 = M.startSession(db); const one = M.propose(db, s1, 'Match Agent', 'reject_held_lines', { invoice: 'INV-7731', lines: [1] });
  check(one.state === 'Refused' && /every held line together/.test(one.message), 'fix: an application advice for line 1 alone is refused while line 2 is short; every held line goes in one 824');
  const s2 = M.startSession(db, { facts: M.VARIATIONS.ashby_dispute }); check(M.propose(db, s2, 'Match Agent', 'short_pay_at_payment', { invoice: 'INV-7731', lines: [1, 2] }).state === 'Refused', 'fix: no short-pay before the supplier has answered a request for those lines');
  const rq = M.propose(db, s2, 'Match Agent', 'reject_held_lines', { invoice: 'INV-7731', lines: [1, 2] }); M.decide(db, s2, rq.proposal, 'approve');
  const sp = M.propose(db, s2, 'Match Agent', 'short_pay_at_payment', { invoice: 'INV-7731', lines: [1, 2] });
  check(sp.state === 'Awaiting approval' && sp.approver === 'Jordan Ellis', 'fix: when the supplier refuses the credit, Match Agent escalates to Jordan Ellis with a short-pay proposal he decides');
  const d = M.decide(db, s2, sp.proposal, 'approve'); check(d.state === 'Executed' && M.outcome(db, s2).payment_released === false && M.outcome(db, s2).lines.filter((l) => l.status === 'short_pay_decided').length === 2, 'fix: the short-pay decision settles both lines and releases no payment');
  const bad = [[{ name: 'propose_action', args: { action: 'release_for_payment_proposal', invoice: 'INV-7731', lines: [2], rationale: 'scripted' } }], [{ name: 'propose_action', args: { action: 'release_for_payment_proposal', invoice: 'INV-7731', lines: [2], rationale: 'scripted' } }], [{ name: 'read_queue', args: {} }], [{ name: 'read_queue', args: {} }]];
  let k = 0; const s3 = M.startSession(db); const r3 = await M.runMatch(db, s3, { callModel: async () => ({ candidates: [{ content: { role: 'model', parts: (bad[k++] || [{ name: 'read_queue', args: {} }]).map((f) => ({ functionCall: f })) } }] }) });
  check(r3.status === 'waiting_for_jordan' && k === 2 && s3.trace.some((t) => /^Waiting for Jordan Ellis/.test(t.what)), 'fix: an action refused twice stops the agent, which reports what waits for Jordan Ellis instead of retrying to its limit');
  const s4 = M.startSession(db); const r4 = await M.runMatch(db, s4, { callModel: async () => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'read_queue', args: {} } }] } }] }), maxToolCalls: 3 });
  check(r4.status !== 'stopped' && s4.trace.some((t) => /^At its limit; waiting/.test(t.what)), 'fix: at its limit Match Agent reports what it is waiting for, never just stopped'); }

// Harness check of the agent loop with a scripted caller (not a model): tool calls reach the reads and the gate.
{ const script = [[{ name: 'read_queue', args: {} }], [{ name: 'propose_action', args: { action: 'release_for_payment_proposal', invoice: 'INV-7731', lines: [1, 3], rationale: 'scripted' } }], [{ name: 'propose_action', args: { action: 'reject_held_lines', invoice: 'INV-7731', lines: [1, 2], rationale: 'scripted' } }], []];
  let i = 0; const scripted = async () => ({ candidates: [{ content: { role: 'model', parts: (script[i++] || []).map((f) => ({ functionCall: f })).concat(i > 3 ? [{ text: 'Waiting.' }] : []) } }] });
  const s = M.startSession(db, { label: 'scripted harness' }); const r = await M.runMatch(db, s, { callModel: scripted });
  check(r.status === 'waiting_for_jordan' && s.proposals.map((p) => p.state).join() === 'Awaiting approval' && s.trace.some((t) => t.what === 'Refused release_for_payment_proposal'), 'harness: scripted caller reads, is refused a release on a held line, and waits for Jordan on the request'); }

const EXPECT = { canonical: 'reject_held_lines', correction_on_file: 'match_corrected_invoice', price_set_by_change: 'clear_line_by_accepted_change', price_beyond_tolerance: 'reject_held_lines', total_differs: 'reject_document_fault', triple_mismatch: 'reject_held_lines', ashby_free_text: 'reject_held_lines', ashby_free_text_proved: 'reject_held_lines', ashby_dispute: 'reject_held_lines', ashby_no_answer: 'reject_held_lines' };
const rows = [];
for (const [name, facts] of Object.entries(M.VARIATIONS)) {
  const s = M.startSession(db, { facts, label: `test ${name}` }); const o = M.runBaseline(db, s); detectors(name, s, 'baseline');
  check(o.first_step === EXPECT[name], `${name}/baseline: first step ${EXPECT[name]} (got ${o.first_step})`);
  rows.push({ variation: name, actor: 'baseline', steps: o.steps.join(' > '), clear: o.proposed_clear_for_payment.join(','), held: o.lines.filter((l) => l.status !== 'clear').map((l) => `${l.line}:${l.status}`).join(' '), answer: o.requests.map((r) => r.answer).join('; '), approvals: o.approvals });
}
// Stand-in caller (not a model, and labelled so): it speaks the model's function-calling protocol, decides only from the tool results
// it is handed (read_invoice, read_corrections, read_requests, read_proposals), and follows the decision table. It proves the replay,
// approval, trace and automation plumbing end to end without a key; it says nothing about what a real model would do.
function standIn() {
  return async (body) => {
    const last = body.contents.at(-1); const results = Object.fromEntries((last.parts || []).filter((x) => x.functionResponse).map((x) => [x.functionResponse.name, x.functionResponse.response.result]));
    const fc = (calls, text) => ({ _route: 'stand-in · not a model', candidates: [{ content: { role: 'model', parts: [...calls.map(([name, args]) => ({ functionCall: { name, args } })), ...(text ? [{ text }] : [])] } }] });
    const queue = body.contents.flatMap((c) => c.parts || []).filter((x) => x.functionResponse?.name === 'read_queue').map((x) => x.functionResponse.response.result).at(-1);
    if (!queue) return fc([['read_queue', {}]]);
    const inv = queue.held[0]?.invoice; if (!inv) return fc([], 'Nothing is held.');
    const first = !body.contents.some((c) => (c.parts || []).some((x) => x.functionResponse?.name === 'read_receipts'));
    if (!results.read_invoice) return fc([...(first ? [['read_receipts', { po: inv }]] : []), ['read_invoice', { invoice: inv }], ['read_corrections', { invoice: inv }], ['read_requests', {}], ['read_proposals', {}]]);
    const m = results.read_invoice.match; const L = m.lines; const props = results.read_proposals.proposals.filter((x) => ['Executed', 'Suggested', 'Awaiting approval'].includes(x.state));
    if (props.some((x) => x.state === 'Awaiting approval')) return fc([], 'A proposal waits for Jordan Ellis.');
    const asked = results.read_requests.requests.filter((r) => r.invoice === inv && r.kind === 'correction').flatMap((r) => r.lines);
    const rejected = /^Rejected/.test(results.read_invoice.state);
    const corr = results.read_corrections.corrections.find((c) => !c.matched && !props.some((x) => x.action === 'match_corrected_invoice' && x.args.correction === c.reference));
    const propose = (action, args, why) => fc([['propose_action', { action, invoice: inv, ...args, rationale: why }]]);
    if (rejected && !corr) return fc([], 'Waiting for the resent invoice.');
    if (m.total_fault && !rejected) return propose('reject_document_fault', {}, `read_invoice: stated total ${m.stated_total} differs from the sum of lines ${m.sum_of_lines} (NF-7.10)`);
    if (corr) return propose('match_corrected_invoice', { correction: corr.reference }, `read_corrections: ${corr.reference} is on file (NF-7.2)`);
    const chg = L.find((l) => l.status === 'price_set_by_change'); if (chg) return propose('clear_line_by_accepted_change', { line: chg.line }, `read_invoice: ${chg.settling_record}`);
    const need = L.filter((l) => ['above_shipped', 'above_received', 'price_held'].includes(l.status) && !asked.includes(l.line)).map((l) => l.line);
    if (need.length) return propose('reject_held_lines', { lines: need }, `read_receipts and read_invoice: lines ${need.join(', ')} do not match`);
    const answered = results.read_requests.requests.filter((r) => r.invoice === inv && r.kind === 'correction' && /^Answered/.test(r.state)).flatMap((r) => r.lines);
    const left = L.filter((l) => ['above_shipped', 'above_received'].includes(l.status) && answered.includes(l.line)).map((l) => l.line);
    if (left.length) return propose('short_pay_at_payment', { lines: left }, `read_requests: the supplier's answer leaves lines ${left.join(', ')} uncorrected`);
    const done = props.filter((x) => x.action === 'release_for_payment_proposal').flatMap((x) => x.args.lines);
    const clear = L.filter((l) => l.status === 'clear' && !done.includes(l.line)).map((l) => l.line);
    if (clear.length) return propose('release_for_payment_proposal', { lines: clear }, `read_invoice: lines ${clear.join(', ')} match`);
    return fc([], 'Proposed what the records settle; the rest stays with Jordan.');
  };
}
// The stand-in must reach the baseline's outcome in every preset, through the same server gate, with every proposal approved by a labelled test approver.
for (const [name, facts] of Object.entries(M.VARIATIONS)) {
  const r = await M.replay(db, { facts, callModel: standIn() });
  if (r.agent.blocked) { check(false, `${name}/stand-in: replay blocked ${r.agent.blocked}`); continue; }
  const s = M.getSession(r.agent.session); const o = detectors(name, s, 'stand-in');
  check(r.agent.status === 'done' && o.first_step === r.baseline.outcome.first_step && JSON.stringify(o.lines) === JSON.stringify(r.baseline.outcome.lines) && o.proposed_clear_for_payment.join() === r.baseline.outcome.proposed_clear_for_payment.join(), `${name}/stand-in: same first step and line outcome as the baseline (${o.steps.join(' > ')})`);
  check(r.comparison && r.comparison.agent_only.length === 0 && r.comparison.baseline_only.length === 0 && r.steps.every((x) => x.automation), `${name}/stand-in: every step both took is called automation (${r.automation})`);
  check(s.trace.filter((t) => t.type === 'ai').every((t) => t.actor === 'Match Agent') && s.trace.filter((t) => t.type === 'human').every((t) => t.actor === 'Test approver (replay)') && s.trace.filter((t) => t.type === 'external').every((t) => /\((synthetic|recorded)\)$/.test(t.actor)), `${name}/stand-in: the trace names who did each step, supplier answers labelled synthetic or recorded`);
  rows.push({ variation: name, actor: 'stand-in (not a model)', steps: o.steps.join(' > '), clear: o.proposed_clear_for_payment.join(','), held: o.lines.filter((l) => l.status !== 'clear').map((l) => `${l.line}:${l.status}`).join(' '), answer: o.requests.map((x) => x.answer).join('; '), approvals: o.approvals });
}
// A free-text supplier note reaches the agent's reads but changes nothing the baseline does: the note is where a model may earn its place.
{ const a = M.startSession(db), b = M.startSession(db, { facts: M.VARIATIONS.ashby_free_text }); const oa = M.runBaseline(db, a), ob = M.runBaseline(db, b);
  check(JSON.stringify(oa.lines.map((l) => l.status)) === JSON.stringify(ob.lines.map((l) => l.status)) && /later truck/.test(JSON.stringify(M.read(db, b, 'read_requests'))), 'baseline: the supplier’s free-text note is readable but does not change a receiving advice or the baseline’s outcome'); }

const call = process.env.GEMINI_API_KEY ? (await import('../src/scout.js')).geminiCaller(process.env.GEMINI_API_KEY) : null;
if (!call) console.log('\nBLOCKED  Match Agent runs need GEMINI_API_KEY on this machine. Nothing was simulated in their place.');
else for (const [name, facts] of Object.entries(M.VARIATIONS)) {
  const r = await M.replay(db, { facts, callModel: call });
  if (r.agent.blocked) { console.log(`BLOCKED ${name}: ${r.agent.blocked}`); continue; }
  const s = M.getSession(r.agent.session); const o = detectors(name, s, 'agent');
  rows.push({ variation: name, actor: 'agent', steps: o.steps.join(' > '), clear: o.proposed_clear_for_payment.join(','), held: o.lines.filter((l) => l.status !== 'clear').map((l) => `${l.line}:${l.status}`).join(' '), answer: o.requests.map((x) => x.answer).join('; '), approvals: o.approvals, automation: r.automation, model_calls: r.agent.overhead.model_calls });
}
console.table(rows); process.exit(fail ? 1 : 0);
