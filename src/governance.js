// Agent governance (T2.3): who each agent is and what it may do, pause and resume, and the change list.
// The change list (table agent_changes) holds every pause, resume and trial of a changed agent rule, with who did it and when.
// Nothing here sends a Trading Grid record. Write attribution on the access log lives in server.js, which logs every write.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { replayAgentRule } from './agents.js';
import { RULE_SETS, ruleSet, runtimeOf } from './credit.js';

export const AS = 'ashby-assistant', NF = 'northfield-assistant';
/** The agents on each connection, the jobs they work and the authority they act under. Authority limits are read from the catalogue. */
export const AGENTS = {
  'Watch Agent': { connection: AS, jobs: ['missing_document'], authority: () => ({ rule: null, mode: 'approve', says: 'Drafts the missing 855, 856 or 810 and Priya Raman approves before it is sent; where Kinross or the Supplier ERP owns the fix, shows who fixes it and where, and sends nothing' }) },
  'Claim Agent': { connection: AS, jobs: ['deduction'], authority: () => ({ rule: 'AP-4.1', mode: 'approve', says: 'Proposes a dispute where the NF-7.4 evidence supports one; every dispute needs Priya Raman’s approval (AP-4.1)' }) },
  'Test Agent': { connection: AS, jobs: ['trade_test'], authority: () => ({ rule: null, mode: 'approve', says: 'Proposes; Priya Raman approves, Jordan Ellis activates' }) },
  'Shelf Agent': { connection: AS, jobs: ['shelf'], authority: () => ({ rule: 'AP-6.1', mode: 'policy', says: 'Recommends on both sides of Trading Grid and sends nothing; Jordan Ellis orders in Northfield’s own system' }) },
  'Scout Agent': { connection: AS, jobs: ['shipment_risk'], authority: () => ({ rule: 'AP-3.2', mode: 'approve', says: 'Shows what Kinross and Ashby’s desks fix in their own systems and sends them nothing (AP-3.2); builds a ship notice only from the load scan under standing policy (AP-1.4); the routing request and the ship notice release wait for Priya Raman (AP-1.3)' }) },
  'Pace Agent': { connection: AS, jobs: ['scorecard'], authority: () => ({ rule: null, mode: 'policy', says: 'Explains the on-time, in-full rate on Ashby’s own screen; nothing is sent, so there is nothing to approve' }) },
  'Review Agent': { connection: NF, jobs: ['deduction_review'], authority: () => ({ rule: 'NF-7.7', mode: 'suggest', says: 'Recommends only; Jordan Ellis decides each charge (NF-7.7)' }) },
  'Chase Agent': { connection: NF, jobs: ['ship_notice_chase'], authority: () => ({ rule: 'NF-7.7', mode: 'approve', says: 'Shows what Ashby and Lakeline owe and sends them nothing; Jordan Ellis approves each application advice (824) and decides every charge (NF-7.7)' }) },
  'Match Agent': { connection: NF, jobs: ['three_way_match'], authority: () => ({ rule: null, mode: 'suggest', says: 'Names where a variance comes from and the next step; Jordan Ellis acts' }) },
};
export const agentOfJob = (job) => Object.keys(AGENTS).find((a) => AGENTS[a].jobs.includes(job)) || null;
const findAgent = (name) => runtimeOf(name);
/** The rule sets of a connection as a caller names them: claim (Ashby’s evidence rules), … */
const namesOf = (cid) => Object.keys(AGENTS).filter((a) => AGENTS[a].connection === cid).map((a) => `${RULE_SETS[a].runtime} (${ruleSet(a)})`).join(', ');
const J = (s) => (s ? JSON.parse(s) : null);
const row = (r) => ({ id: `CL-${String(r.id).padStart(4, '0')}`, at: fmtET(r.at), agent: r.agent, kind: r.kind, rule: r.rule_id, change: J(r.change), result: J(r.result), run_by: r.run_by, note: r.note });

/** The agent's state now: Paused or Active, from its latest pause or resume on the change list. */
export function agentState(db, agent) {
  const r = db.prepare("SELECT * FROM agent_changes WHERE agent = ? AND kind IN ('pause','resume') ORDER BY id DESC LIMIT 1").get(agent);
  return r && r.kind === 'pause' ? { agent, state: 'Paused', since: fmtET(r.at), by: r.run_by, reason: r.note } : { agent, state: 'Active' };
}
export const isPaused = (db, agent) => !!agent && agentState(db, agent).state === 'Paused';

/** Pause or resume one agent of this connection. Logged on the change list with who did it; a repeat changes nothing. */
export function setAgentState(db, cid, { agent: name, state, by, reason }) {
  const agent = findAgent(name);
  if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No rule set ${name || '(none)'} on this connection. Rule sets: ${namesOf(cid)}.` };
  const now = agentState(db, agent); const want = state === 'paused' ? 'Paused' : 'Active';
  if (now.state === want) return { result: 'Unchanged', agent, state: want, message: `${ruleSet(agent)} are already ${want.toLowerCase()}.` };
  const id = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, agent, want === 'Paused' ? 'pause' : 'resume', null, JSON.stringify({ from: now.state, to: want }), JSON.stringify({ state: want }), by, reason || null).lastInsertRowid;
  return { result: want === 'Paused' ? 'Paused' : 'Resumed', agent, state: want, change: `CL-${String(id).padStart(4, '0')}`,
    message: want === 'Paused' ? `${ruleSet(agent)} propose nothing while paused. Each event they would work arrives as a plain task with no proposal.` : `${ruleSet(agent)} work new events again.` };
}

/** While an agent is paused, the event it would work arrives as a plain task: the record and the job, with no proposal (R15). */
export function plainTask(db, out, agent) {
  const st = agentState(db, agent); const record = out.record || out.case || out.invoice || out.po || null;
  return { found: out.found !== false, job: out.job || null, record, as_of: out.as_of || null, agent, agent_state: 'Paused', paused_since: st.since, paused_by: st.by,
    task: `Work ${record || 'this record'} by hand`, proposal: null, message: `${ruleSet(agent)} are paused, so this arrives as a plain task with no proposal. Nothing is drafted or sent.`, ...(out.link ? { link: out.link } : {}) };
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
  const agent = agentOfJob(job); if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No rule job ${job} on this connection` };
  const r = dataDb.prepare('SELECT id, owner, params FROM rules WHERE id = ?').get(String(rule || '').toUpperCase());
  if (!r || !r.params) return { result: 'Invalid request', message: `${rule} is not a rule with parameters a rule run reads` };
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
  const drafted = db.prepare(`SELECT id, at, kind, data FROM events WHERE kind IN (${cid === AS ? "'rule.changed', 'rule.added'" : "'rule.drafted'"}) ORDER BY at DESC, id DESC LIMIT ?`).all(limit)
    .map((e) => { const d = J(e.data); return { id: `CL-R${e.id}`, at: fmtET(e.at), agent: 'Aviator', kind: e.kind.replace('.', '_'), rule: d.rule || d.draft, change: e.kind === 'rule.changed' ? { rule: d.rule, from: d.from, to: d.to } : { statement: d.statement, source: d.source || null }, result: { state: e.kind === 'rule.drafted' ? 'Draft' : 'Saved' }, run_by: d.changed_by || d.added_by || d.author, note: 'Drafted by Aviator; saved when the person pressed the card' }; });
  return { connection: cid, agents: agentsOf(db, cid), aviator_permissions: aviatorPermissions(db, cid), entries: [...drafted, ...rows.map(row)] };
}

// ---------- P21 Admin and rules: rules by source, a supplier's own rule changed with its effect shown first, approval modes ----------
// One place where a rule or an agent's authority changes; every agent reads the result on its next run (rules from the
// catalogue tables, modes from the change list). A company changes only its own rules: Ashby its policies and agreements here;
// Northfield its guide through draft, replay and publish (P15). Reset restores the catalogue and clears the change list.
const SOURCE_OF = (owner) => owner === 'Supplier ERP' ? 'Supplier ERP' : /^Ashby/.test(owner || '') ? 'Ashby manual rules' : owner === 'Northfield' ? 'Northfield guide' : 'Standards and law';
const JOB_OF_RULE = { 'AP-6.1': 'shelf', 'AP-6.2': 'shelf', 'AP-6.3': 'shelf', 'AP-6.4': 'shelf' };
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
  // Rule changes and new rules saved from an Aviator card (P21), in the viewer's session or on record: they stand on the
  // change list as the person's, drafted by Aviator.
  if (cid === AS) for (const e of db.prepare("SELECT at, kind, data FROM events WHERE kind IN ('rule.changed', 'rule.added') ORDER BY at, id").all()) { const d = J(e.data);
    if (e.kind === 'rule.changed') { const x = groups['Ashby manual rules'].find((r) => r.id === d.rule); if (x) { x.params = { ...(x.params || {}), ...d.to }; x.last_change = { at: fmtET(e.at), by: d.changed_by, drafted_by: d.drafted_by, change: { rule: d.rule, from: d.from, to: d.to } }; } }
    else groups['Ashby manual rules'].push({ id: d.rule, source: 'Ashby manual rules', owner: 'Ashby', rule: d.statement, params: null, basis: 'Ashby', created_by: d.added_by, created: e.at.slice(0, 10), editable_here: false, last_change: { at: fmtET(e.at), by: d.added_by, drafted_by: d.drafted_by }, from_document: d.source || null }); }
  // Each rule's document and section, where one stands behind it (rule documents, P21).
  const secOf = new Map(); try { for (const s of db.prepare("SELECT s.rule_id, s.section, d.title, d.version, d.doc_id FROM rule_sections s JOIN rule_documents d ON d.doc_id = s.doc_id WHERE d.in_force_to IS NULL OR d.owner <> 'Northfield' ORDER BY d.published_at").all()) secOf.set(s.rule_id, { document: `${s.title} ${s.version}`, section: s.section }); } catch { /* tables absent in an older build */ }
  for (const g of Object.values(groups)) for (const r of g) if (secOf.has(r.id)) r.document = secOf.get(r.id);
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
  const job = JOB_OF_RULE[r.id]; let effect = { touches: 'No rule run reads this parameter on open work', changed: [], records: 0 };
  if (job) {
    const asOf = D.asOfDate(as_of || (job === 'deduction' ? '2026-12-28T10:00:00-05:00' : undefined)); let recs = Array.isArray(records) && records.length ? records : null;
    if (!recs && job === 'deduction') recs = db.prepare("SELECT DISTINCT json_extract(data, '$.case') c FROM events WHERE kind = 'case.opened' AND at >= '2026-09-27' AND at <= ?").all(asOf.toISOString()).map((x) => x.c);
    if (!recs && job === 'shelf') recs = db.prepare('SELECT DISTINCT store FROM store_activity ORDER BY store').all().map((x) => String(x.store));
    const rep = replayAgentRule(db, { job, change: { rule: r.id, params }, records: recs || [], asOf });
    effect = { touches: `${ruleSet(agentOfJob(job))}: ${rep.changed.length} of ${rep.records} open records change next step or authority`, agent: agentOfJob(job), changed: rep.changed, records: rep.records, rows: rep.rows, as_of: rep.as_of };
  }
  const from = Object.fromEntries(Object.keys(params).map((k) => [k, inForce[k]]));
  if (!apply) return { result: 'Effect shown; nothing saved', rule: r.id, from, to: params, effect, next: 'Call again with apply true to save the change.' };
  const next = { ...inForce, ...params }; let statement = r.statement;
  for (const [k, v] of Object.entries(params)) { const old = String(inForce[k]); statement = statement.replace(new RegExp(`(^|[^0-9.])\\$?${old.replace('.', '\\.')}(?![0-9.])`, 'g'), (m, pre) => `${pre}${m.slice(pre.length).startsWith('$') ? '$' : ''}${v}`); }
  db.prepare('UPDATE rules SET params = ?, statement = ? WHERE id = ?').run(JSON.stringify(next), statement, r.id);
  db.prepare('UPDATE rule_versions SET params = ?, statement = ? WHERE rule_id = ? AND valid_to IS NULL').run(JSON.stringify(next), statement, r.id);
  const cl = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, effect.agent || 'Rules', 'rule_change', r.id, JSON.stringify({ rule: r.id, from, to: params }), JSON.stringify(effect), by || PERSON_OF[cid], null).lastInsertRowid;
  return { result: 'Rule changed', rule: r.id, from, to: params, statement, effect, change: `CL-${String(cl).padStart(4, '0')}`, applies: 'Every rule run reads it from its next run' };
}

/** The approval mode each agent action runs under now, from the latest mode change on the change list (none: the agent's default). */
export function modesOf(db, agent) {
  const out = {}; for (const r of db.prepare("SELECT change FROM agent_changes WHERE kind = 'mode' AND agent = ? ORDER BY id").all(agent)) { const c = J(r.change); out[c.action] = c.to; }
  return out;
}
// ---------- Aviator's permissions, per action (P21, 18 November 2026; widened 18 November) ----------
// What Aviator may do when a person asks it to act: answer only, or raise an action card the person approves. Every action a
// card can carry starts at the card and can be set to answer only on the change list. Two are locked to the card: a held ship
// notice is released only when Priya Raman presses Approve, and a Northfield charge is decided only when Jordan Ellis does.
// Aviator never acts unasked, never presses Approve and never sends anything outside a business document.
export const AVIATOR_PERMISSIONS = ['answer_only', 'propose_action_card'];
export const AVIATOR_ACTIONS = {
  [AS]: {
    open_dispute: { label: 'Open a dispute in Northfield’s deduction case', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'AP-4.1' },
    release_held_ship_notice: { label: 'Release a held ship notice', editable: false, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'AP-1.3', locked: 'Locked to the card: a held ship notice is released only when Priya Raman presses Approve' },
    send_acknowledgment: { label: 'Send the order acknowledgment (855)', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'NF-1.4' },
    answer_order_change: { label: 'Answer an order change with a change acknowledgment (865)', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'NF-1.6' },
    send_ship_notice: { label: 'Send the ship notice (856) built from the load scan', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'NF-4.2' },
    send_invoice: { label: 'Send the invoice (810) for the shipped quantity', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'NF-7.8' },
    change_rule: { label: 'Change one of Ashby’s manual rules', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: null },
    add_rule: { label: 'Add an Ashby manual rule', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: null },
    answer_application_advice: { label: 'Answer an application advice with the 997 and the corrected document', editable: true, starts: 'propose_action_card', approver: 'Priya Raman', rule: 'NF-7.2' },
  },
  [NF]: {
    send_application_advice: { label: 'Reject a document with an application advice (EDI 824)', editable: true, starts: 'propose_action_card', approver: 'Jordan Ellis', rule: 'NF-7.8' },
    decide_charge: { label: 'Waive or uphold a disputed deduction', editable: false, starts: 'propose_action_card', approver: 'Jordan Ellis', rule: 'NF-7.7', locked: 'Locked to the card: Jordan Ellis decides every charge by pressing Approve' },
    decide_chargeback: { label: 'Apply or waive a readiness chargeback', editable: true, starts: 'propose_action_card', approver: 'Jordan Ellis', rule: 'NF-3.6' },
    draft_rule: { label: 'Draft a rule into Draft rules', editable: true, starts: 'propose_action_card', approver: 'Jordan Ellis', rule: 'NF-11.1' },
    publish_rule: { label: 'Publish a rule after its replay', editable: true, starts: 'propose_action_card', approver: 'Jordan Ellis', rule: 'NF-11.1' },
  },
};
const AVIATOR_LOCKS = ['Aviator never acts unasked', 'Aviator never releases a held ship notice: Priya Raman presses Approve on the card', 'Aviator never decides a Northfield charge: Jordan Ellis presses Approve on the card', 'Aviator sends nothing outside a business document and changes no other company’s system'];
/** Aviator's permission for each action on this connection, as recorded now. */
export function aviatorPermissions(db, cid) {
  const last = {}; for (const r of db.prepare("SELECT * FROM agent_changes WHERE connection_id = ? AND kind = 'aviator_permission' ORDER BY id").all(cid)) { const c = J(r.change); last[c.action] = { permission: c.to, set_by: r.run_by, set_at: fmtET(r.at) }; }
  return { for: PERSON_OF[cid], values: AVIATOR_PERMISSIONS, actions: Object.entries(AVIATOR_ACTIONS[cid]).map(([action, a]) => ({ action, label: a.label, permission: a.editable && last[action] ? last[action].permission : a.starts, editable: a.editable, approver: a.approver, rule: a.rule,
    ...(a.locked ? { locked: a.locked } : {}), ...(a.editable && last[action] ? { set_by: last[action].set_by, set_at: last[action].set_at } : { set_by: null, note: a.editable ? 'Starts at the action card; no change recorded' : undefined }) })), locked: AVIATOR_LOCKS };
}
/** Sets Aviator's permission for one action; recorded on the change list with who set it. */
export function setAviatorPermission(db, cid, { action, mode }, by) {
  const acts = AVIATOR_ACTIONS[cid]; const a = acts[action]; if (!a) return { result: 'Invalid request', message: `Aviator actions on this connection: ${Object.keys(acts).join(', ')}` };
  if (!AVIATOR_PERMISSIONS.includes(mode)) return { result: 'Invalid request', message: `Aviator’s permission is ${AVIATOR_PERMISSIONS.join(' or ')}` };
  if (!a.editable) return { result: 'Invalid request', message: `${action}: ${a.locked}` };
  const now = aviatorPermissions(db, cid).actions.find((x) => x.action === action).permission; if (now === mode) return { result: 'Unchanged', assistant: 'Aviator', action, permission: mode };
  const cl = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, 'Aviator', 'aviator_permission', a.rule || null, JSON.stringify({ action, from: now, to: mode }), JSON.stringify({ permission: mode }), by || PERSON_OF[cid], null).lastInsertRowid;
  return { result: 'Permission changed', assistant: 'Aviator', action, label: a.label, from: now, to: mode, change: `CL-${String(cl).padStart(4, '0')}`, applies: 'Aviator uses it from its next answer', approver: a.approver };
}

/** Sets one agent action's standing approval mode for a retailer: suggest, approve or policy. Only actions the person may change;
 *  locked actions and guardrails stay as they are. Recorded on the change list; the agent uses it on its next run. */
export function setAgentMode(db, cid, { agent: name, action, mode, retailer = 'Northfield Retailer' }, actionsOf, by) {
  const agent = findAgent(name);
  if (!agent || AGENTS[agent].connection !== cid) return { result: 'Invalid request', message: `No rule set ${name || '(none)'} on this connection. Rule sets: ${namesOf(cid)}.` };
  if (!['suggest', 'approve', 'policy'].includes(mode)) return { result: 'Invalid request', message: 'Mode is suggest, approve or policy' };
  if (retailer !== 'Northfield Retailer') return { result: 'Invalid request', message: 'Northfield Retailer is the only retailer in this world' };
  const acts = actionsOf(agent); if (!acts) return { result: 'Invalid request', message: `${ruleSet(agent)} have no settable actions` };
  const a = acts[action]; if (!a) return { result: 'Invalid request', message: `Actions of ${ruleSet(agent)}: ${Object.keys(acts).join(', ')}` };
  const may = a.person_may_change ?? a.priya_may_change ?? a.jordan_may_change; if (!may) return { result: 'Invalid request', message: `${action} is locked at ${a.mode} (${a.rule || 'guardrail'}); only the administrator changes it` };
  const now = modesOf(db, agent)[action] || a.mode; if (now === mode) return { result: 'Unchanged', agent, action, mode };
  const cl = db.prepare('INSERT INTO agent_changes (at, connection_id, agent, kind, rule_id, change, result, run_by, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), cid, agent, 'mode', a.rule || null, JSON.stringify({ action, from: now, to: mode, retailer }), JSON.stringify({ mode }), by || PERSON_OF[cid], null).lastInsertRowid;
  return { result: 'Mode changed', agent, action, retailer, from: now, to: mode, change: `CL-${String(cl).padStart(4, '0')}`, applies: `${ruleSet(agent)} use it from their next run` };
}
