// Agent governance (T2.3): who each agent is and what it may do, pause and resume, and the change list.
// The change list (table agent_changes) holds every pause, resume and trial of a changed agent rule, with who did it and when.
// Nothing here sends a Trading Grid record. Write attribution on the access log lives in server.js, which logs every write.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { replayAgentRule } from './agents.js';

export const AS = 'ashby-assistant', NF = 'northfield-assistant';
/** The agents on each connection, the jobs they work and the authority they act under. Authority limits are read from the catalogue. */
export const AGENTS = {
  'Watch Agent': { connection: AS, jobs: ['missing_document'], authority: () => ({ rule: null, mode: 'approve', says: 'Proposes; Priya Raman approves before anything is sent' }) },
  'Claim Agent': { connection: AS, jobs: ['deduction'], authority: (db) => ({ rule: 'AP-4.1', mode: 'policy', limit: `$${D.param(db, 'AP-4.1', 'max_amount')}`, says: `Disputes without asking only when the NF-7.4 evidence is in the case and the charge is under $${D.param(db, 'AP-4.1', 'max_amount')} (AP-4.1); otherwise Priya Raman decides` }) },
  'Test Agent': { connection: AS, jobs: ['trade_test'], authority: () => ({ rule: null, mode: 'approve', says: 'Proposes; Priya Raman approves, Jordan Ellis activates' }) },
  'Shelf Agent': { connection: AS, jobs: ['shelf'], authority: () => ({ rule: 'AP-6.1', mode: 'approve', says: 'Recommends; Priya Raman approves and Jordan Ellis decides the order' }) },
  'Scout Agent': { connection: AS, jobs: ['shipment_risk'], authority: () => ({ rule: 'AP-3.2', mode: 'approve', says: 'Proposes Kinross tasks and Supplier ERP changes Priya Raman approves (AP-3.2); builds a ship notice only from the load scan under standing policy (AP-1.4); release always stays with Priya Raman (AP-1.3)' }) },
  'Pace Agent': { connection: AS, jobs: ['scorecard'], authority: () => ({ rule: null, mode: 'policy', says: 'Explains the on-time, in-full rate on Ashby’s own screen; nothing is sent, so there is nothing to approve' }) },
  'Review Agent': { connection: NF, jobs: ['deduction_review'], authority: () => ({ rule: 'NF-7.7', mode: 'suggest', says: 'Recommends only; Jordan Ellis decides each charge (NF-7.7)' }) },
  'Chase Agent': { connection: NF, jobs: ['ship_notice_chase'], authority: () => ({ rule: 'NF-7.7', mode: 'approve', says: 'Proposes requests to the supplier and Lakeline; Jordan Ellis approves each and decides every charge (NF-7.7)' }) },
  'Match Agent': { connection: NF, jobs: ['three_way_match'], authority: () => ({ rule: null, mode: 'suggest', says: 'Names where a variance comes from and the next step; Jordan Ellis acts' }) },
};
export const agentOfJob = (job) => Object.keys(AGENTS).find((a) => AGENTS[a].jobs.includes(job)) || null;
const findAgent = (name) => Object.keys(AGENTS).find((a) => a.toLowerCase() === String(name || '').trim().toLowerCase() || a.toLowerCase() === `${String(name || '').trim().toLowerCase()} agent`) || null;
const J = (s) => (s ? JSON.parse(s) : null);
const row = (r) => ({ id: `CL-${String(r.id).padStart(4, '0')}`, at: fmtET(r.at), agent: r.agent, kind: r.kind, rule: r.rule_id, change: J(r.change), result: J(r.result), run_by: r.run_by, note: r.note });

/** The agent's state now: Paused or Active, from its latest pause or resume on the change list. */
export function agentState(db, agent) {
  const r = db.prepare("SELECT * FROM agent_changes WHERE agent = ? AND kind IN ('pause','resume') ORDER BY id DESC LIMIT 1").get(agent);
  return r && r.kind === 'pause' ? { agent, state: 'Paused', since: fmtET(r.at), by: r.run_by, reason: r.note } : { agent, state: 'Active' };
}
export const isPaused = (db, agent) => !!agent && agentState(db, agent).state === 'Paused';
/** An agent acts without asking only when its standing policy allows it and it is not paused (AP-4.1 for Claim Agent). */
export const mayActWithoutAsking = (db, agent, policyAllows) => !!policyAllows && !isPaused(db, agent);

/** Pause or resume one agent of this connection. Logged on the change list with who did it; a repeat changes nothing. */
export function setAgentState(db, cid, { agent: name, state, by, reason }) {
  const agent = findAgent(name);
  if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No agent ${name || '(none)'} on this connection. Agents: ${Object.keys(AGENTS).filter((a) => AGENTS[a].connection === cid).join(', ')}.` };
  const now = agentState(db, agent); const want = state === 'paused' ? 'Paused' : 'Active';
  if (now.state === want) return { result: 'Unchanged', agent, state: want, message: `${agent} is already ${want.toLowerCase()}.` };
  const id = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, agent, want === 'Paused' ? 'pause' : 'resume', null, JSON.stringify({ from: now.state, to: want }), JSON.stringify({ state: want }), by, reason || null).lastInsertRowid;
  return { result: want === 'Paused' ? 'Agent paused' : 'Agent resumed', agent, state: want, change: `CL-${String(id).padStart(4, '0')}`,
    message: want === 'Paused' ? `${agent} proposes nothing while paused. Each event it would work arrives as a plain task with no proposal.` : `${agent} works new events again under its rules.` };
}

/** While an agent is paused, the event it would work arrives as a plain task: the record and the job, with no proposal (R15). */
export function plainTask(db, out, agent) {
  const st = agentState(db, agent); const record = out.record || out.case || out.invoice || out.po || null;
  return { found: out.found !== false, job: out.job || null, record, as_of: out.as_of || null, agent, agent_state: 'Paused', paused_since: st.since, paused_by: st.by,
    task: `Work ${record || 'this record'} by hand`, proposal: null, message: `${agent} is paused, so this arrives as a plain task with no proposal. Nothing is drafted or sent.`, ...(out.link ? { link: out.link } : {}) };
}

/** Each agent of a connection with its state and authority limit (story 1). */
export const agentsOf = (db, cid) => Object.entries(AGENTS).filter(([, a]) => a.connection === cid).map(([name, a]) => ({ ...agentState(db, name), jobs: a.jobs, authority: a.authority(db) }));

/** Records a trial of a changed agent rule on the change list: what changed, the replay result, who ran it and when (story 4). */
export function recordTrial(db, cid, { agent, rule, change, result, by }) {
  const id = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, agent, 'trial', rule || null, JSON.stringify(change), JSON.stringify(result), by, null).lastInsertRowid;
  return `CL-${String(id).padStart(4, '0')}`;
}

/** Replays a changed agent rule (replayAgentRule) and records the trial. Only rules this company owns, and only parameters the catalogue holds. */
export function trialAgentRule(db, dataDb, cid, { job, rule, params, records, as_of }, by) {
  const agent = agentOfJob(job); if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No agent job ${job} on this connection` };
  const r = dataDb.prepare('SELECT id, owner, params FROM rules WHERE id = ?').get(String(rule || '').toUpperCase());
  if (!r || !r.params) return { result: 'Invalid request', message: `${rule} is not a rule with parameters an agent reads` };
  if (cid === AS && !/^Ashby/.test(r.owner)) return { result: 'Invalid request', message: `${r.id} is ${r.owner}’s rule; Ashby can trial only its own rules` };
  const inForce = JSON.parse(r.params); const bad = Object.keys(params || {}).filter((k) => !(k in inForce) || typeof params[k] !== 'number');
  if (!Object.keys(params || {}).length || bad.length) return { result: 'Invalid request', message: `${r.id} holds ${Object.keys(inForce).join(', ')}; give numbers for those only${bad.length ? ` (not ${bad.join(', ')})` : ''}` };
  const asOf = D.asOfDate(as_of);
  let recs = Array.isArray(records) && records.length ? records : null;
  if (!recs && job === 'deduction') recs = dataDb.prepare("SELECT DISTINCT json_extract(data, '$.case') c FROM events WHERE kind = 'case.opened' AND at >= '2026-09-27' AND at <= ?").all(asOf.toISOString()).map((x) => x.c);
  if (!recs || !recs.length) return { result: 'Invalid request', message: 'Name the records to replay (for this job there is no default set)' };
  const rep = replayAgentRule(dataDb, { job, change: { rule: r.id, params }, records: recs, asOf });
  const result = { as_of: rep.as_of, records: rep.records, changed: rep.changed, unchanged: rep.unchanged,
    drift_measure: `${rep.changed.length} of ${rep.records} records change next step or authority`,
    rule_in_force: { rule: r.id, params: inForce }, rollback: `Nothing was published: the catalogue still holds ${r.id} ${JSON.stringify(inForce)}. Rolling back a published change restores these values.` };
  const id = recordTrial(db, cid, { agent, rule: r.id, change: { rule: r.id, from: Object.fromEntries(Object.keys(params).map((k) => [k, inForce[k]])), to: params }, result, by });
  return { result: 'Trial recorded', trial: id, agent, job, change: { rule: r.id, params }, ...result, changes_nothing: true };
}

/** The change list of a connection, newest first, with each agent's state now. */
export function changeList(db, cid, { limit = 50, kind } = {}) {
  const rows = db.prepare(`SELECT * FROM agent_changes WHERE connection_id = ?${kind ? ' AND kind = ?' : ''} ORDER BY id DESC LIMIT ?`).all(...[cid, kind, limit].filter((x) => x !== undefined));
  return { connection: cid, agents: agentsOf(db, cid), entries: rows.map(row) };
}

// ---------- P21 Admin and rules: rules by source, a supplier's own rule changed with its effect shown first, approval modes ----------
// One place where a rule or an agent's authority changes; every agent reads the result on its next run (rules from the
// catalogue tables, modes from the change list). A company changes only its own rules: Ashby its policies and agreements here;
// Northfield its guide through draft, replay and publish (P15). Reset restores the catalogue and clears the change list.
const SOURCE_OF = (owner) => owner === 'Supplier ERP' ? 'Supplier ERP' : /^Ashby/.test(owner || '') ? 'Ashby manual rules' : owner === 'Northfield' ? 'Northfield guide' : 'Standards and law';
const JOB_OF_RULE = { 'AP-4.1': 'deduction', 'AP-6.1': 'shelf', 'AP-6.2': 'shelf', 'AP-6.3': 'shelf', 'AP-6.4': 'shelf' };
const PERSON_OF = { [AS]: 'Priya Raman', [NF]: 'Jordan Ellis' };
const lastRuleChange = (db, id) => { const r = db.prepare("SELECT * FROM agent_changes WHERE kind = 'rule_change' AND rule_id = ? ORDER BY id DESC LIMIT 1").get(id); return r ? { at: fmtET(r.at), by: r.run_by, change: J(r.change) } : null; };

/** Every rule this connection sees, grouped by where it comes from, with who created it and when, and whether this company may edit it. */
export function rulesBySource(db, dataDb, cid) {
  const rows = dataDb.prepare('SELECT r.id, r.owner, r.statement, r.params, r.basis, v.valid_from FROM rules r LEFT JOIN rule_versions v ON v.rule_id = r.id AND v.valid_to IS NULL ORDER BY r.id').all();
  const groups = { 'Supplier ERP': [], 'Ashby manual rules': [], 'Northfield guide': [], 'Standards and law': [] };
  for (const r of rows) {
    const src = SOURCE_OF(r.owner); const live = cid === AS ? db.prepare('SELECT statement, params FROM rules WHERE id = ?').get(r.id) || r : r;
    groups[src].push({ id: r.id, source: src, owner: r.owner, rule: live.statement, params: live.params ? JSON.parse(live.params) : null, basis: r.basis,
      created_by: src === 'Ashby manual rules' ? 'Priya Raman' : src === 'Northfield guide' ? 'Jordan Ellis' : r.owner, created: r.valid_from || null,
      editable_here: cid === AS && src === 'Ashby manual rules' && !!live.params, last_change: lastRuleChange(db, r.id) });
  }
  // Northfield rules published from a draft (P15) join the guide; those going into force later carry the date (D72).
  for (const d of db.prepare("SELECT * FROM draft_rules WHERE state IN ('Scheduled', 'Published') ORDER BY id").all())
    groups['Northfield guide'].push({ id: d.id, source: 'Northfield guide', owner: 'Northfield', rule: d.statement, params: null, basis: d.basis, created_by: d.author, created: d.created_at.slice(0, 10),
      editable_here: false, last_change: null, state: d.state === 'Scheduled' ? 'In force from a later date' : 'In force', in_force_from: d.in_force_from || null });
  return { connection: cid, groups: Object.entries(groups).map(([source, rules]) => ({ source, count: rules.length, read_only: !(cid === AS && source === 'Ashby manual rules'), rules })),
    note: cid === AS ? 'Ashby edits only its own manual rules, and only their parameters; Northfield’s guide and standards are read-only here. No rule in the catalogue is read from the Supplier ERP today.' : 'Northfield changes its guide through a draft, a replay against the quarter and publishing; nothing here edits a rule.' };
}

/** Changes a parameter of one of Ashby's own rules. Without apply it shows the effect on open work and saves nothing; with apply it
 *  saves the change in the catalogue the agents read, records it on the change list, and every agent uses it on its next run. */
export function updateSupplierRule(db, cid, { rule, params, apply, records, as_of }, by) {
  if (cid !== AS) return { result: 'Invalid request', message: 'Northfield changes its guide through a draft, a replay and publishing (draft rules); this tool edits Ashby’s own rules only.' };
  const id = String(rule || '').toUpperCase(); const r = db.prepare('SELECT id, owner, statement, params FROM rules WHERE id = ?').get(id);
  if (!r) return { result: 'Invalid request', message: `No rule ${rule}` };
  if (!/^Ashby/.test(r.owner)) return { result: 'Invalid request', message: `${r.id} is ${r.owner}’s rule and read-only for Ashby` };
  if (!r.params) return { result: 'Invalid request', message: `${r.id} has no parameter to change; its wording is set in the catalogue` };
  const inForce = JSON.parse(r.params); const bad = Object.keys(params || {}).filter((k) => !(k in inForce) || typeof params[k] !== 'number' || !(params[k] > 0));
  if (!Object.keys(params || {}).length || bad.length) return { result: 'Invalid request', message: `${r.id} holds ${Object.keys(inForce).join(', ')}; give positive numbers for those only${bad.length ? ` (not ${bad.join(', ')})` : ''}` };
  const job = JOB_OF_RULE[r.id]; let effect = { touches: 'No agent reads this parameter on open work', changed: [], records: 0 };
  if (job) {
    const asOf = D.asOfDate(as_of || (job === 'deduction' ? '2026-12-28T10:00:00-05:00' : undefined)); let recs = Array.isArray(records) && records.length ? records : null;
    if (!recs && job === 'deduction') recs = db.prepare("SELECT DISTINCT json_extract(data, '$.case') c FROM events WHERE kind = 'case.opened' AND at >= '2026-09-27' AND at <= ?").all(asOf.toISOString()).map((x) => x.c);
    if (!recs && job === 'shelf') recs = db.prepare('SELECT DISTINCT store FROM store_activity ORDER BY store').all().map((x) => String(x.store));
    const rep = replayAgentRule(db, { job, change: { rule: r.id, params }, records: recs || [], asOf });
    effect = { touches: `${agentOfJob(job)}: ${rep.changed.length} of ${rep.records} open records change next step or authority`, agent: agentOfJob(job), changed: rep.changed, records: rep.records, rows: rep.rows, as_of: rep.as_of };
  }
  const from = Object.fromEntries(Object.keys(params).map((k) => [k, inForce[k]]));
  if (!apply) return { result: 'Effect shown; nothing saved', rule: r.id, from, to: params, effect, next: 'Call again with apply true to save the change.' };
  const next = { ...inForce, ...params }; let statement = r.statement;
  for (const [k, v] of Object.entries(params)) { const old = String(inForce[k]); statement = statement.replace(new RegExp(`(^|[^0-9.])\\$?${old.replace('.', '\\.')}(?![0-9.])`, 'g'), (m, pre) => `${pre}${m.slice(pre.length).startsWith('$') ? '$' : ''}${v}`); }
  db.prepare('UPDATE rules SET params = ?, statement = ? WHERE id = ?').run(JSON.stringify(next), statement, r.id);
  db.prepare('UPDATE rule_versions SET params = ?, statement = ? WHERE rule_id = ? AND valid_to IS NULL').run(JSON.stringify(next), statement, r.id);
  const cl = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, effect.agent || 'Rules', 'rule_change', r.id, JSON.stringify({ rule: r.id, from, to: params }), JSON.stringify(effect), by || PERSON_OF[cid], null).lastInsertRowid;
  return { result: 'Rule changed', rule: r.id, from, to: params, statement, effect, change: `CL-${String(cl).padStart(4, '0')}`, applies: 'Every agent reads it on its next run' };
}

/** The approval mode each agent action runs under now, from the latest mode change on the change list (none: the agent's default). */
export function modesOf(db, agent) {
  const out = {}; for (const r of db.prepare("SELECT change FROM agent_changes WHERE kind = 'mode' AND agent = ? ORDER BY id").all(agent)) { const c = J(r.change); out[c.action] = c.to; }
  return out;
}
/** Sets one agent action's standing approval mode for a retailer: suggest, approve or policy. Only actions the person may change;
 *  locked actions and guardrails stay as they are. Recorded on the change list; the agent uses it on its next run. */
export function setAgentMode(db, cid, { agent: name, action, mode, retailer = 'Northfield Retailer' }, actionsOf, by) {
  const agent = findAgent(name);
  if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No agent ${name || '(none)'} on this connection. Agents: ${Object.keys(AGENTS).filter((a) => AGENTS[a].connection === cid).join(', ')}.` };
  if (!['suggest', 'approve', 'policy'].includes(mode)) return { result: 'Invalid request', message: 'Mode is suggest, approve or policy' };
  if (retailer !== 'Northfield Retailer') return { result: 'Invalid request', message: 'Northfield Retailer is the only retailer in this world' };
  const acts = actionsOf(agent); if (!acts) return { result: 'Invalid request', message: `${agent} has no settable actions` };
  const a = acts[action]; if (!a) return { result: 'Invalid request', message: `${agent} actions: ${Object.keys(acts).join(', ')}` };
  const may = a.person_may_change ?? a.priya_may_change ?? a.jordan_may_change; if (!may) return { result: 'Invalid request', message: `${action} is locked at ${a.mode} (${a.rule || 'guardrail'}); only the administrator changes it` };
  const now = modesOf(db, agent)[action] || a.mode; if (now === mode) return { result: 'Unchanged', agent, action, mode };
  const cl = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, agent, 'mode', a.rule || null, JSON.stringify({ action, from: now, to: mode, retailer }), JSON.stringify({ mode }), by || PERSON_OF[cid], null).lastInsertRowid;
  return { result: 'Mode changed', agent, action, retailer, from: now, to: mode, change: `CL-${String(cl).padStart(4, '0')}`, applies: `${agent} uses it on its next run` };
}
