// Shared agent runtime (D61). One engine for every server-side agent that was a decision rule only: Claim, Review, Pace,
// Shelf and Chase. Each agent is a spec (src/claim.js and the rest); the engine gives it the same shape as Scout, Watch and
// Match: an isolated session branched from the recorded world at a story moment, reads cut at the session clock, actions the
// server gates by approval mode, a model that chooses reads and proposes actions, a rule baseline over the same reads and
// actions, and a governance replay that labels a step automation where the two agree.
//
// A spec supplies:
//   agent, prefix, person, company, moments, defaultMoment, goal, opening(s), facts, variations, actions, guardrails,
//   queue(db, s)           -> { rows: [{ id, record, what, state, closed }], ... }  (recomputed after every step)
//   reads                  -> { name: { description, input, run(db, s, args) } }    (engine adds read_queue, read_policy, read_proposals)
//   validate(db, s, action, args) -> null or the refusal text
//   execute(db, s, p, by)  -> { state: 'Completed' | 'Sent' | 'Delivered' | 'Refused', response, ... }
//   baseline(db, s, act)   -> one pass of the fixed decision table, calling act(action, args)
//   outcome(db, s)         -> the session's result, with violations
//   init(db, s)            -> optional, session set-up after branching
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { fmtET } from '../world/lib.js';
import { declarations, modelArgs } from './aviator.js';

export const MIN = 60000, H = 3600000;
export const iso = (ms) => new Date(ms).toISOString();
export const J = (x) => (x ? JSON.parse(x) : {});
export const TYPES = { system: 'System', rule: 'Fixed rule', ai: 'AI judgment', human: 'Human approval', external: 'External confirmation', tool: 'Tool call' };

export function makeRuntime(spec) {
  const SESSIONS = new Map(); const MAX = 60;
  const { agent, prefix, person } = spec;
  const ACTIONS = spec.actions;

  function factsToVariation(facts = {}) {
    const v = {};
    for (const [k, val] of Object.entries(facts)) {
      const f = spec.facts[k]; if (!f) throw new Error(`No such fact: ${k}. Facts: ${Object.keys(spec.facts).join(', ')}`);
      if (f.values && !f.values.includes(val)) throw new Error(`${k} is one of: ${f.values.join(', ')}`);
      if (f.maxLength !== undefined && (typeof val !== 'string' || val.length > f.maxLength)) throw new Error(`${k} is text of at most ${f.maxLength} characters`);
      if (f.number && typeof val !== 'number') throw new Error(`${k} is a number`);
      v[k] = val;
    }
    return v;
  }
  const branchWith = (variation, facts) => ({ ...(spec.variations[variation || 'canonical'] || {}), ...factsToVariation(facts || {}) });

  function trace(s, actor, type, what, detail = {}) { s.trace.push({ n: s.trace.length + 1, clock: fmtET(iso(s.clock)), actor, type, what, ...(Object.keys(detail).length ? { detail } : {}) }); }
  const MODE_APPROVER = { policy: `Standing policy, set by ${person}`, suggest: `None: ${agent} may only suggest` };
  function audit(s, p, outcome) {
    const approver = p.taken_over_by || p.approved_by || (p.needs === 'approve' ? (p.state === 'Awaiting approval' ? `${person} (awaiting)` : p.rejected_by || person) : MODE_APPROVER[p.needs]);
    s.audit.push({ session: s.id, proposal: p.id, action: p.action, record: p.args.record || null, agent: p.by, authority_rule: ACTIONS[p.action].rule, authority_mode: p.needs, approver, outcome, clock: fmtET(iso(s.clock)) });
  }

  function startSession(db, { variation = {}, policy = {}, label = 'Operator' } = {}) {
    if (SESSIONS.size >= MAX) SESSIONS.delete(SESSIONS.keys().next().value);
    const set = factsToVariation(variation);
    const facts = { ...Object.fromEntries(Object.entries(spec.facts).map(([k, f]) => [k, f.recorded])), ...set };
    const changes = Object.entries(set).map(([field, to]) => ({ field, from: spec.facts[field].recorded, to }));
    const modes = {}; for (const [k, a] of Object.entries(ACTIONS)) { const want = policy[k]; modes[k] = want && a.editable && ['suggest', 'approve', 'policy'].includes(want) ? want : a.mode; }
    const momentKey = facts.moment || spec.defaultMoment; const branch = Date.parse(spec.moments[momentKey]);
    const id = `${prefix}-${createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10)}`;
    const s = { id, label, created: new Date().toISOString(), facts, changes, modes, moment: momentKey, branch, clock: branch, horizon: branch + (spec.horizonHours || 72) * H,
      goal: spec.goal, proposals: [], pending: [], revealed: [], trace: [], audit: [], reads: [], usedKeys: new Set(), state: {},
      agent: { history: [], status: 'idle', calls: 0, tool_calls: 0, ms: 0 } };
    SESSIONS.set(id, s);
    trace(s, 'Trading Grid', 'system', 'Session branched from the recorded world', { at: fmtET(iso(branch)), hidden: 'Every recorded record after this time', changes });
    if (spec.init) spec.init(db, s, ctx);
    const q = spec.queue(db, s, ctx);
    trace(s, 'Rule engine', 'rule', `${q.rows.length} ${spec.queueNoun || 'records'} to work`, { rows: q.rows.map((r) => `${r.record}: ${r.what}`) });
    return s;
  }
  const getSession = (id) => SESSIONS.get(id) || null;

  // ---------- Reveals: recorded or synthetic records that arrive later in a session ----------
  function schedule(s, item) { if (!s.pending.some((p) => p.key === item.key) && !s.revealed.some((r) => r.key === item.key)) s.pending.push(item); }
  function tick(db, s) {
    const out = [];
    // A record that arrives can schedule the next one (a decision schedules its repayment): loop until nothing more is due.
    for (let guard = 0; guard < 50; guard++) {
      const due = s.pending.filter((p) => Date.parse(p.at) <= s.clock).sort((a, b) => a.at.localeCompare(b.at)); if (!due.length) break;
      for (const p of due) { s.pending.splice(s.pending.indexOf(p), 1); s.revealed.push(p); out.push(p); if (p.on) p.on(s);
        trace(s, p.actor, 'external', p.what, { at: fmtET(p.at), ...(p.reference ? { record: p.reference } : {}), synthetic: !!p.synthetic, ...(p.note ? { note: p.note } : {}) }); }
    }
    return out;
  }
  function advance(db, s, { minutes, to } = {}) {
    const target = Math.min(to != null ? to : s.clock + (minutes || 0) * MIN, s.branch + (spec.maxAdvanceHours || 24 * 45) * H); if (target > s.clock) s.clock = target;
    return tick(db, s);
  }
  const revealed = (s, pred) => s.revealed.filter((r) => Date.parse(r.at) <= s.clock && pred(r));
  const ctx = { trace, schedule, revealed, tick, MIN, H, iso, fmtET };

  // ---------- Reads ----------
  const READS = {
    read_queue: { description: `The rule engine's queue at the session clock: every ${spec.queueNoun || 'record'} ${agent} works, with its state.`, input: {}, run: (db, s) => spec.queue(db, s, ctx) },
    ...spec.reads,
    read_policy: { description: `What each action needs (${agent} may only suggest, ${person} approves, or it runs under a standing policy), and the administrator guardrails no one may change.`, input: {},
      run: (db, s) => ({ actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, done_by: a.actor, rule: a.rule, takes: a.args, needs: s.modes[k] === 'policy' ? `Runs under ${person}'s standing policy` : s.modes[k] === 'approve' ? `${person} approves` : `${agent} may only suggest` }])), guardrails: spec.guardrails }) },
    read_proposals: { description: 'Every action proposed in this session, with its state and result.', input: {}, run: (db, s) => ({ proposals: s.proposals.map((p) => ({ id: p.id, action: p.action, args: p.args, state: p.state, result: p.result || null })) }) },
  };
  function read(db, s, name, args = {}) {
    const r = READS[name]; if (!r) return { result: 'Refused', message: `No read ${name}` };
    const out = r.run(db, s, args, ctx); s.reads.push({ name, args, clock: s.clock }); return out;
  }

  // ---------- Actions ----------
  const keyOf = (action, args) => createHash('sha1').update(JSON.stringify([action, args])).digest('hex').slice(0, 16);
  function propose(db, s, by, action, args = {}, why = {}) {
    const def = ACTIONS[action]; if (!def) return { state: 'Refused', message: `No action ${action}` };
    for (const k of Object.keys(args)) if (args[k] === undefined || args[k] === '' || args[k] === null) delete args[k];
    const extra = Object.keys(args).filter((k) => !def.args.includes(k)); if (extra.length) { const m = `${action} takes only ${def.args.join(', ')}; refused ${extra.join(', ')}.`; trace(s, 'Trading Grid', 'rule', `Refused ${action}`, { by, args, reason: m }); return { state: 'Refused', usage: true, message: m }; }
    const key = keyOf(action, args);
    const open = s.proposals.find((p) => p.key === key && ['Awaiting approval', 'Approved', 'Executed'].includes(p.state));
    if (open) return { state: 'Duplicate', proposal: open.id, message: `The same action is already ${open.state.toLowerCase()} (${open.id}).` };
    const bad = spec.validate(db, s, action, args, ctx); if (bad) { trace(s, 'Trading Grid', 'rule', `Refused ${action}`, { by, args, reason: bad }); return { state: 'Refused', message: bad }; }
    const p = { id: `${prefix}P-${s.proposals.length + 1}`, key, action, args, by, rationale: why.rationale || null, alternatives: why.alternatives || [], state: 'Awaiting approval', needs: spec.modeFor?.(db, s, action, args) || s.modes[action], at: fmtET(iso(s.clock)) };
    s.proposals.push(p);
    trace(s, by, by === agent ? 'ai' : 'rule', `Proposed: ${def.label}`, { proposal: p.id, args, rationale: p.rationale, alternatives: p.alternatives, needs: p.needs });
    if (p.needs === 'suggest') { p.state = 'Suggested'; audit(s, p, `Suggested; ${person} decides`); return { state: 'Suggested', proposal: p.id, message: `${agent} may only suggest this; ${person} decides.` }; }
    if (p.needs === 'policy') return execute(db, s, p, 'Standing policy');
    audit(s, p, 'Awaiting approval');
    return { state: 'Awaiting approval', proposal: p.id, approver: person, rule: def.rule };
  }
  function execute(db, s, p, by) {
    if (s.usedKeys.has(p.id)) return { state: 'Refused', message: 'Already executed' }; s.usedKeys.add(p.id);
    const r = spec.execute(db, s, p, by, ctx); tick(db, s);
    p.state = ['Completed', 'Delivered', 'Sent'].includes(r.state) ? 'Executed' : 'Failed'; p.result = r; p.executed_under = by;
    trace(s, ACTIONS[p.action].actor, 'external', `${p.state}: ${ACTIONS[p.action].label}`, { proposal: p.id, response: r.response });
    audit(s, p, `${p.state}: ${r.response || r.state}`);
    return { state: p.state, proposal: p.id, result: r };
  }
  function decide(db, s, proposalId, decision, by = person, note) {
    const p = s.proposals.find((x) => x.id === proposalId);
    if (!p) return { state: 'Refused', message: `No proposal ${proposalId}` };
    if (p.state !== 'Awaiting approval' && !(p.state === 'Suggested' && decision === 'approve')) return { state: 'Refused', message: `${proposalId} is ${p.state.toLowerCase()}; an approval cannot be replayed.` };
    if (decision === 'edit') { p.state = 'Taken over'; p.taken_over_by = by; p.note = note || null; (s.handed ||= {})[p.args.record || '*'] = { by, proposal: p.id, note: p.note, at: fmtET(iso(s.clock)) };
      trace(s, by, 'human', `Edit suggestion: ${by} set ${p.id} aside and works ${p.args.record || 'the case'} by hand; ${agent} watches for the next event on it`, { action: p.action, note: p.note }); audit(s, p, `Taken over by ${by}${p.note ? `: ${p.note}` : ''}`); return { state: 'Taken over', proposal: p.id, by }; }
    if (decision !== 'approve') { p.state = 'Rejected'; p.rejected_by = by; trace(s, by, 'human', `Rejected ${p.id}`, { action: p.action }); audit(s, p, 'Rejected'); return { state: 'Rejected', proposal: p.id }; }
    s.clock += MIN; tick(db, s);
    const bad = spec.validate(db, s, p.action, p.args, ctx); if (bad) { p.state = 'Failed'; p.result = { state: 'Refused', response: bad }; trace(s, 'Trading Grid', 'rule', `Refused at approval: ${p.id}`, { reason: bad }); audit(s, p, `Failed: ${bad}`); return { state: 'Failed', proposal: p.id, result: p.result }; }
    p.state = 'Approved'; p.approved_by = by; trace(s, by, 'human', `Approved ${p.id}: ${ACTIONS[p.action].label}`, { args: p.args });
    return execute(db, s, p, by);
  }

  // ---------- Rule baseline ----------
  function runBaseline(db, s, approve = (id) => decide(db, s, id, 'approve', 'Test approver (replay)')) {
    const act = (action, args) => { const r = propose(db, s, 'Baseline', action, args); return r.state === 'Awaiting approval' ? approve(r.proposal) : r; };
    for (let i = 0; i < 60 && s.clock <= s.horizon; i++) {
      const before = s.proposals.length; spec.baseline(db, s, act, ctx);
      const next = Math.min(...s.pending.map((p) => Date.parse(p.at)), Infinity);
      if (s.proposals.length === before && (next === Infinity || next > s.horizon)) break;
      if (next !== Infinity && next <= s.horizon) advance(db, s, { to: next }); else if (s.proposals.length === before) break;
    }
    return spec.outcome(db, s, ctx);
  }

  // ---------- The agent: a model choosing reads and proposing actions ----------
  const argSchema = {};
  for (const a of Object.values(ACTIONS)) for (const k of a.args) if (!argSchema[k]) argSchema[k] = (spec.argTypes?.[k] || z.string()).optional();
  const AGENT_TOOLS = [
    ...Object.entries(READS).map(([name, r]) => ({ name, description: r.description, input: r.input })),
    { name: 'propose_action', description: `Propose one action. The server decides whether it runs under policy or waits for ${person}, and refuses anything a rule or guardrail forbids. Actions: ${Object.entries(ACTIONS).map(([k, a]) => `${k} (${a.label}; takes ${a.args.join(', ')})`).join('; ')}. Give a short rationale grounded in records you read, and the alternatives you considered.`,
      input: { action: z.enum(Object.keys(ACTIONS)), ...argSchema, rationale: z.string().describe('One or two sentences citing the records read'), alternatives: z.array(z.string()).optional() } },
  ];
  const INSTRUCTION = (s) => `You are ${agent}, working for ${person} at ${spec.company} on Trading Grid. All data is fictional.
Goal: ${s.goal}
${typeof spec.instruction === 'function' ? spec.instruction(s) : spec.instruction}
Start with read_queue: every action's record argument is a row id from the queue, exactly as written there. Pass an action only the arguments read_policy lists for it.
Use only facts returned by your tools. Never state a record, amount or confirmation the tools did not return. Read the policy before proposing. A proposal that waits for approval is not done.
Never retry an action the server refused; read the refusal and change course, or stop and say what waits for ${person}.
When you are waiting for ${person} or another party, stop and say in one or two sentences what you proposed and why. When new evidence arrives, re-read what changed and reconsider.`;
  function waitAtLimit(s, ag, t0) {
    const aw = s.proposals.filter((p) => p.state === 'Awaiting approval'); ag.status = 'waiting_for_person';
    trace(s, agent, 'system', `At its limit; waiting: ${aw.length ? `${aw.map((p) => p.id).join(', ')} waits for ${person}` : `nothing left it may do; ${person} decides what is open`}`, { tool_calls: ag.tool_calls, ms: Date.now() - t0 });
  }
  async function runAgent(db, s, { callModel, maxSteps = 14, maxToolCalls = 24, maxSessionCalls = 96, maxMs = 300000, event, paused = () => false } = {}) {
    if (paused()) { s.agent.status = 'paused'; trace(s, 'Trading Grid', 'system', `${agent} is paused by the administrator; the queue arrives as plain tasks with no proposal`, {}); return { ok: true, status: 'paused', awaiting: [] }; }
    if (!callModel) return { ok: false, blocked: `No model is configured on this server; ${agent} cannot run. Nothing was simulated in its place.` };
    const ag = s.agent; const t0 = Date.now(); const turnStart = ag.tool_calls; ag.status = 'running';
    if (!ag.history.length) ag.history.push({ role: 'user', parts: [{ text: `Business event: ${spec.opening(s)} Clock: ${fmtET(iso(s.clock))}.` }] });
    else if (event) ag.history.push({ role: 'user', parts: [{ text: `New evidence at ${fmtET(iso(s.clock))}: ${event}` }] });
    const decl = declarations(AGENT_TOOLS);
    for (let step = 0; step < maxSteps; step++) {
      if (paused()) { ag.status = 'paused'; trace(s, 'Trading Grid', 'system', `${agent} paused by the administrator; stopped before its next step`, {}); break; }
      if (Date.now() - t0 > maxMs || ag.tool_calls - turnStart >= maxToolCalls || ag.tool_calls >= maxSessionCalls) { waitAtLimit(s, ag, t0); break; }
      let data; try { data = await callModel({ systemInstruction: { parts: [{ text: INSTRUCTION(s) }] }, contents: ag.history, tools: [{ functionDeclarations: decl }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { temperature: 0 } }); ag.calls++; if (data?._route) (ag.routes ||= {})[data._route] = (ag.routes[data._route] || 0) + 1; }
      catch (e) { ag.status = 'model_failed'; trace(s, agent, 'system', 'Model call failed; no state was changed', { error: String(e.message || e).slice(0, 200) }); return { ok: false, status: ag.status }; }
      const content = data?.candidates?.[0]?.content; const parts = content?.parts || []; const calls = parts.filter((p) => p.functionCall);
      const text = parts.map((p) => p.text || '').join('').trim();
      if (content) ag.history.push(content);
      if (text) trace(s, agent, 'ai', `${agent} said`, { text: text.slice(0, 600) });
      if (!calls.length) {
        ag.status = s.proposals.some((p) => p.state === 'Awaiting approval') ? 'waiting_for_person' : s.pending.length ? 'waiting_for_records' : 'done';
        // A rule finding on the queue must be answered: if the agent stops with a row the rules marked as needing action, it is told once and goes on.
        if (ag.status === 'done' && spec.mustAnswer) { ag.nudged ||= []; const open = spec.queue(db, s, ctx).rows.filter((r) => !r.closed && spec.mustAnswer(r, s) && !ag.nudged.includes(`${r.id}|${r.state}`));
          if (open.length) { ag.nudged.push(...open.map((r) => `${r.id}|${r.state}`)); trace(s, 'Rule engine', 'rule', `Open findings the agent has not answered: ${open.map((r) => r.id).join(', ')}`, { rows: open.map((r) => `${r.id}: ${r.state}`) });
            ag.history.push({ role: 'user', parts: [{ text: `The rule engine still shows open findings you have not answered: ${open.map((r) => `${r.id} (${r.state}: ${r.what})`).join('; ')}. Answer each with a permitted action, or say why none applies.` }] }); ag.status = 'running'; continue; } }
        break; }
      const responses = []; let waiting = false; let blocked = null;
      for (const { functionCall: f } of calls) {
        ag.tool_calls++; const args = { ...modelArgs(AGENT_TOOLS, f.name, f.args) }; let result;
        if (f.name === 'propose_action') {
          const { action, rationale, alternatives, ...rest } = args;
          if (rest.record && s.handed?.[rest.record] && !s.handed[rest.record].reopened) result = { state: 'Refused', message: `${person} took ${rest.record} over; ${agent} proposes on it again only after a new business event.` };
          else result = propose(db, s, agent, action, rest, { rationale, alternatives });
          if (result.state === 'Awaiting approval') waiting = true;
          if (result.state === 'Refused' && !result.usage) { ag.refused ||= {}; ag.refused[action] = (ag.refused[action] || 0) + 1; if (ag.refused[action] >= 2) { blocked = result.message; result = { ...result, message: `${result.message} Refused twice: stop proposing ${action}; ${person} is told what is waiting.` }; } }
        } else if (READS[f.name]) { result = read(db, s, f.name, args); trace(s, agent, 'tool', `Read ${f.name}`, { args }); }
        else result = { result: 'Refused', message: `No tool ${f.name}` };
        responses.push({ functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } });
      }
      ag.history.push({ role: 'user', parts: responses });
      if (waiting) ag.status = 'waiting_for_person';
      if (blocked) { ag.status = 'waiting_for_person'; trace(s, agent, 'system', `Waiting for ${person}: ${blocked}`, { refused: ag.refused }); break; }
    }
    ag.ms += Date.now() - t0;
    return { ok: true, status: ag.status, awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, args: p.args, rationale: p.rationale })) };
  }
  async function decideAndResume(db, s, proposalId, decision, by, opts = {}) {
    const r = decide(db, s, proposalId, decision, by, opts.note);
    if (r.state === 'Refused') return r;
    if (r.state === 'Taken over') return { decision: r, run: { ok: true, status: s.agent.status } };
    if (s.proposals.some((p) => p.state === 'Awaiting approval')) return { decision: r, run: { ok: true, status: 'waiting_for_person' } };
    const ev = r.result ? `${proposalId} ${decision === 'approve' ? 'approved by ' + by : 'rejected'}; result: ${JSON.stringify(r.result)}` : `${proposalId} rejected by ${by}`;
    return { decision: r, run: opts.callModel ? await runAgent(db, s, { ...opts, event: ev }) : { ok: true, status: s.agent.status } };
  }
  async function advanceAndResume(db, s, { minutes, ...opts } = {}) {
    const target = minutes != null ? s.clock + minutes * MIN : Math.min(...s.pending.map((p) => Date.parse(p.at)), s.horizon);
    const arrived = advance(db, s, { to: target });
    // A new business event on a record that was taken over hands it back to the agent.
    for (const a of arrived) if (a.record && s.handed?.[a.record]) s.handed[a.record].reopened = true;
    if (!arrived.length || !opts.callModel) return { arrived: arrived.map((a) => a.what), run: { ok: true, status: s.agent.status } };
    return { arrived: arrived.map((a) => a.what), run: await runAgent(db, s, { ...opts, event: `Records arrived: ${arrived.map((a) => a.what).join('; ')}` }) };
  }
  function compare(a, b) {
    const steps = (s) => s.proposals.filter((p) => ['Executed', 'Suggested'].includes(p.state)).map((p) => `${p.action} ${p.args.record || ''}`.trim());
    const A = steps(a), B = steps(b);
    return { same_steps: A.filter((x) => B.includes(x)), baseline_only: A.filter((x) => !B.includes(x)), agent_only: B.filter((x) => !A.includes(x)) };
  }
  async function replay(db, { variation = {}, policy = {}, callModel, paused = () => false } = {}) {
    const base = startSession(db, { variation, policy, label: 'Replay · baseline' }); const b = runBaseline(db, base);
    const as = startSession(db, { variation, policy, label: `Replay · ${agent}` });
    let run = await runAgent(db, as, { callModel, paused }); let rounds = 0;
    while (run.ok && rounds++ < 24) {
      if (run.status === 'waiting_for_person') { const p = as.proposals.find((x) => x.state === 'Awaiting approval'); if (!p) break; run = (await decideAndResume(db, as, p.id, 'approve', 'Test approver (replay)', { callModel, paused })).run; continue; }
      if (as.pending.length && as.clock < as.horizon) { run = (await advanceAndResume(db, as, { callModel, paused })).run; continue; }
      break;
    }
    return { variation: base.changes, evidence_cutoff: fmtET(iso(base.branch)), baseline: { session: base.id, outcome: b, trace: base.trace },
      agent: run.ok && run.status !== 'paused' ? { session: as.id, status: run.status, outcome: spec.outcome(db, as, ctx), overhead: { model_calls: as.agent.calls, tool_calls: as.agent.tool_calls, ms: as.agent.ms }, trace: as.trace } : { session: as.id, blocked: run.blocked || run.status, trace: as.trace },
      automation: run.ok && run.status !== 'paused' ? compare(base, as) : null };
  }
  const setup = () => ({ agent, prototype: spec.prototype, moments: spec.moments, default_moment: spec.defaultMoment,
    facts: Object.fromEntries(Object.entries(spec.facts).map(([k, f]) => [k, { says: f.says, owner: f.owner, recorded: f.recorded, ...(f.values ? { values: f.values } : {}), ...(f.maxLength ? { max_length: f.maxLength } : {}) }])),
    presets: spec.variations,
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { does: a.label, rule: a.rule, takes: a.args, mode: a.mode, person_may_change: a.editable, modes: a.editable ? ['suggest', 'approve', 'policy'] : [a.mode] }])),
    guardrails: spec.guardrails, owner_note: spec.ownerNote || 'Outside parties answer by deterministic rules, labelled synthetic; guardrails are the administrator’s.' });
  const view = (db, s, extra = {}) => s ? ({ session: s.id, agent, label: s.label, clock: fmtET(iso(s.clock)), branch_at: fmtET(iso(s.branch)), status: s.agent.status, variation: s.changes, facts: s.facts,
    queue: spec.queue(db, s, ctx), awaiting: s.proposals.filter((p) => p.state === 'Awaiting approval').map((p) => ({ id: p.id, action: p.action, does: ACTIONS[p.action].label, args: p.args, proposed_by: p.by, rationale: p.rationale, alternatives: p.alternatives, rule: ACTIONS[p.action].rule })),
    suggested: s.proposals.filter((p) => p.state === 'Suggested').map((p) => ({ id: p.id, action: p.action, does: ACTIONS[p.action].label, args: p.args, proposed_by: p.by, rationale: p.rationale })),
    pending: s.pending.map((p) => ({ at: fmtET(p.at), what: p.what })), ...(s.handed ? { handed_over: s.handed } : {}),
    roles: s.proposals.filter((p) => p.state !== 'Awaiting approval').map((p) => ({ proposal: p.id, action: p.action, recommended_by: p.by, authorised_by: p.taken_over_by ? `${p.taken_over_by} (took over)` : p.approved_by || (p.needs === 'policy' ? `Standing policy (${ACTIONS[p.action].rule})` : p.needs === 'suggest' ? person : p.rejected_by || '—'), carried_out_by: p.state === 'Executed' ? ACTIONS[p.action].actor : '—', state: p.state })),
    outcome: spec.outcome(db, s, ctx), trace: s.trace, overhead: { model_calls: s.agent.calls, tool_calls: s.agent.tool_calls, ms: s.agent.ms, model_routes: s.agent.routes || {} }, ...extra })
    : { result: 'Invalid request', error: 'No such session; sessions live in memory and end when the server restarts.' };

  return { spec, agent, prefix, ACTIONS, READS, TYPES, AGENT_TOOLS, factsToVariation, branchWith, startSession, getSession, read, propose, decide, tick, advance, runBaseline, runAgent, decideAndResume, advanceAndResume, replay, compare, setup, view, outcome: (db, s) => spec.outcome(db, s, ctx), queue: (db, s) => spec.queue(db, s, ctx) };
}

/** The six tools every runtime exposes on its connection, named <name>_start, _state, _decide, _setup, _baseline, _replay. */
export function runtimeTools(rt, { name, db, callModel, paused, log, recordTrial, by, modes = () => ({}) }) {
  const pol = (policy) => ({ ...modes(), ...(policy || {}) }); // standing modes set in admin (P21), then the run's own
  const VAR = z.enum(Object.keys(rt.spec.variations)).optional().describe(`Preset facts: ${Object.keys(rt.spec.variations).join(', ')}. Default canonical.`);
  const FACTS = z.record(z.any()).optional().describe(`Facts to branch with, on top of the preset. ${name}_setup lists them with their recorded values.`);
  const POLICY = z.record(z.enum(['suggest', 'approve', 'policy'])).optional().describe(`Approval mode per action for this run, for actions ${rt.spec.person} may change. Locked actions keep their mode.`);
  const drain = (s) => { if (!s) return; for (const a of s.audit.slice(s.audited || 0)) log(`${name}:${a.action}`, { session: a.session, proposal: a.proposal }, a.outcome, [a.session, a.proposal, a.record].filter(Boolean), { agent: a.agent, rule: a.authority_rule, mode: a.authority_mode, approver: a.approver, outcome: a.outcome }); s.audited = s.audit.length; };
  const brief = (tr) => tr.filter((t) => t.type !== 'tool').map((t) => `${t.n}. ${t.clock.slice(11, 16)} ${t.actor} [${TYPES[t.type] || t.type}] ${t.what}${t.detail?.args && Object.keys(t.detail.args).length ? ' ' + JSON.stringify(t.detail.args) : ''}${t.detail?.response ? ' · ' + t.detail.response : ''}${t.detail?.reason ? ' · ' + t.detail.reason : ''}${t.detail?.rationale ? ' · why: ' + t.detail.rationale : ''}`);
  const desc = rt.spec.toolText;
  return [
    { name: `${name}_setup`, readOnly: true, title: `${rt.agent} setup: facts, approval modes and guardrails`, description: `What can be set before a ${rt.agent} run (${desc}): story moments, facts with their recorded values, presets, each action with its rule and approval mode, and the administrator guardrails. Changes nothing.`, input: {}, run: async () => rt.setup() },
    { name: `${name}_start`, title: `Start ${rt.agent}`, description: `Branches the demo world at the story moment into an isolated session (later recorded records hidden; nothing reaches the recorded world), lets ${rt.agent} investigate ${desc} with its read tools, and returns when it waits for ${rt.spec.person}, finishes or hits its limit. Returns the session id, the queue, proposals awaiting approval, who recommended, authorised and carried out each action, and the trace. Outside parties answer by deterministic rules, labelled synthetic.`, input: { variation: VAR, facts: FACTS, policy: POLICY, label: z.string().optional() },
      run: async ({ variation, facts, policy, label } = {}) => { const s = rt.startSession(db, { variation: rt.branchWith(variation, facts), policy: pol(policy), label: label || 'Operator' }); const r = await rt.runAgent(db, s, { callModel: callModel(), paused }); drain(s); return rt.view(db, s, r.ok ? {} : { blocked: r.blocked || r.status }); } },
    { name: `${name}_decide`, title: `Decide a ${rt.agent} proposal as ${rt.spec.person}`, description: `Records ${rt.spec.person}'s decision on one proposal: approve, reject, or edit (Edit suggestion: the person takes the record over; ${rt.agent} proposes on it again only after a new business event). On approval the server executes it, then ${rt.agent} continues from the result. An approval cannot be replayed. Only call this when the user has decided.`, input: { session: z.string(), proposal: z.string(), decision: z.enum(['approve', 'reject', 'edit']), note: z.string().optional() },
      run: async ({ session, proposal, decision, note }) => { const s = rt.getSession(session); if (!s) return rt.view(db, null); const r = await rt.decideAndResume(db, s, proposal, decision, rt.spec.person, { callModel: callModel(), paused, note }); drain(s); if (r.state === 'Refused') return { ...r, result: 'Refused' }; return rt.view(db, s, r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}); } },
    { name: `${name}_state`, readOnly: true, title: `${rt.agent} session state and trace`, description: `Current state of a ${rt.agent} session: clock, queue, proposals, roles, pending records, outcome and trace. Pass advance_minutes to move the session clock on: records due by then arrive and ${rt.agent} continues from them.`, input: { session: z.string(), advance_minutes: z.number().int().min(1).max(60 * 24 * 45).optional() },
      run: async ({ session, advance_minutes } = {}) => { const s = rt.getSession(session); if (!s) return rt.view(db, null); if (!advance_minutes) return rt.view(db, s); const r = await rt.advanceAndResume(db, s, { minutes: advance_minutes, callModel: callModel(), paused }); drain(s); return rt.view(db, s, { arrived: r.arrived, ...(r.run?.ok === false ? { blocked: r.run.blocked || r.run.status } : {}) }); } },
    { name: `${name}_baseline`, title: `Rule baseline for ${rt.agent}`, description: `Runs the fixed decision table on the same branch and facts, with the same reads and actions and a labelled test approver, and returns its outcome and trace.`, input: { variation: VAR, facts: FACTS, policy: POLICY },
      run: async ({ variation, facts, policy } = {}) => { const s = rt.startSession(db, { variation: rt.branchWith(variation, facts), policy: pol(policy), label: 'Rule baseline' }); rt.runBaseline(db, s); drain(s); return rt.view(db, s); } },
    { name: `${name}_replay`, title: `Governance replay: baseline and ${rt.agent} side by side`, description: `Runs the rule baseline and ${rt.agent} on the same branch and facts, approving every proposal as a labelled test approver and moving the clock to each arriving record, and returns both outcomes, one-line traces, and the steps both took (automation) and those only one took. Recorded on the change list as a trial. For governance review, not operation.`, input: { variation: VAR, facts: FACTS, policy: POLICY, detail: z.enum(['brief', 'full']).optional() },
      run: async ({ variation, facts, policy, detail } = {}) => {
        const r = await rt.replay(db, { variation: rt.branchWith(variation, facts), policy: pol(policy), callModel: callModel(), paused });
        for (const id of [r.baseline.session, r.agent.session]) drain(rt.getSession(id));
        const trial = recordTrial({ agent: rt.agent, rule: null, by: by(), change: { policy: Object.keys(policy || {}).length ? policy : 'Policy in force (no change)', variation: variation || 'canonical', facts: facts || {} },
          result: { baseline: r.baseline.outcome, agent: r.agent.blocked ? { blocked: r.agent.blocked } : r.agent.outcome, automation: r.automation, drift_measure: r.automation ? `${r.automation.same_steps.length} steps the same (automation), ${r.automation.agent_only.length} by the agent only, ${r.automation.baseline_only.length} by the baseline only` : `${rt.agent} did not run; nothing to compare`, rollback: 'Nothing was changed: sessions are in memory and leave the recorded world unchanged.' } });
        if (detail === 'full') return { ...r, trial };
        return { trial, changes: r.variation, evidence_cutoff: r.evidence_cutoff, baseline: { session: r.baseline.session, outcome: r.baseline.outcome, trace: brief(r.baseline.trace) }, agent: r.agent.blocked ? { session: r.agent.session, blocked: r.agent.blocked, trace: brief(r.agent.trace) } : { session: r.agent.session, status: r.agent.status, outcome: r.agent.outcome, overhead: r.agent.overhead, trace: brief(r.agent.trace) }, automation: r.automation };
      } },
  ];
}
