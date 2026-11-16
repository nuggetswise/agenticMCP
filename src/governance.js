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
  'Pace Agent': { connection: AS, jobs: ['scorecard'], authority: () => ({ rule: null, mode: 'approve', says: 'Drafts a corrective task; Priya Raman approves' }) },
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
