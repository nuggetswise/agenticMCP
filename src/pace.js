// Pace Agent runtime for P7 Performance Improvement (Ashby side). A session branches at 28 December 2026 09:00 ET, when
// Northfield's 13-week scorecard arrives (91.0% official, 108 failing lines; NF-9.2 asks for a corrective plan within 30 days).
// Pace Agent traces the short shipments behind the score. If one item at one warehouse carries most of them, it drafts the
// corrective task; if they split across warehouses, it asks Priya Raman which site leads before drafting anything. It also
// shares the explanation of the official against the network-calculated score with Jordan Ellis. Priya's answer and
// Northfield's acceptance are synthetic, from presenter facts. Rule baseline: drafts a task for the largest reason code.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { makeRuntime, MIN, H, iso, J } from './runtime.js';
import { z } from 'zod';

const PERIODS = { quarter: { from: '2026-09-27', to: '2026-12-26', label: 'Quarter, 27 September to 26 December' }, week_nov22: { from: '2026-11-22', to: '2026-11-28', label: 'Week of 22 to 28 November' } };
const site = (x) => (x === 'KIN-JOL' ? 'Kinross Joliet' : x === 'KIN-GRV' ? 'Kinross Groveport' : x);
function shorts(db, s, key) {
  const p = PERIODS[key]; const end = `${p.to}T23:59:59.000Z` < iso(s.branch) ? `${p.to}T23:59:59.000Z` : iso(s.branch);
  const rows = db.prepare("SELECT at, po, data FROM events WHERE kind = 'wms.short_pick' AND at >= ? AND at <= ? ORDER BY at").all(`${p.from}T00:00:00.000Z`, end).map((e) => ({ at: fmtET(e.at), po: e.po, ...J(e.data) }));
  const g = {}; for (const r of rows) { const k = `${r.sku} at ${site(r.site)}`; (g[k] ||= { group: k, sku: r.sku, warehouse: site(r.site), lines: 0, cases_short: 0 }); g[k].lines++; g[k].cases_short += r.ordered - r.picked; }
  const groups = Object.values(g).sort((a, b) => b.lines - a.lines); const share = rows.length ? groups[0].lines / rows.length : 0;
  return { period: p.label, short_lines: rows.length, groups, largest_share: Math.round(share * 100), one_cause: rows.length >= 4 && share >= 0.7, warehouses: [...new Set(groups.map((x) => x.warehouse))], lines: rows };
}
function scorecard(db, s) {
  const e = db.prepare("SELECT at, data FROM events WHERE kind = 'scorecard.published' AND at <= ? ORDER BY at DESC").get(iso(s.branch)); if (!e) return null;
  const d = J(e.data); return { received: fmtET(e.at), ...d, official_pct: `${(d.official * 100).toFixed(1)}%`, network_pct: d.network_view ? `${(d.network_view * 100).toFixed(1)}%` : null,
    difference_explained_by: 'PO NR-450118 line 2: Northfield’s receipt counts it one carton short; Northfield’s own dispute decision on DC-40877 reversed the shortage (load scan before the seal), and the receipt stands until receiving revises it (NF-5.5)' };
}
const st = (s) => (s.state.p ||= { tasks: {}, questions: {}, answers: {}, shared: null, accepted: null });

const spec = {
  agent: 'Pace Agent', prefix: 'PC', person: 'Priya Raman', company: 'Ashby Supplier', prototype: 'P7 Performance Improvement',
  toolText: 'Northfield’s scorecard and the short shipments behind it',
  moments: { '2026-12-28 09:00 ET': '2026-12-28T14:00:00.000Z' }, defaultMoment: '2026-12-28 09:00 ET', horizonHours: 24 * 5, queueNoun: 'periods to explain',
  goal: 'Give Ashby and Northfield the same account of the on-time, in-full score and what drives it, and draft a corrective task only for a cause the records support (NF-9.2, NF-9.3).',
  instruction: `Read Northfield's scorecard, then the short shipments for each period. If one item at one warehouse carries most of them, draft the corrective task for that cause. If they split across warehouses, ask Priya which site leads before drafting anything; never draft a plan for an unsupported cause. Share the explanation of the official against the network-calculated score with Jordan Ellis: Northfield's official score stays authoritative and is never overwritten. A closed task is not an improvement.`,
  opening: () => 'Northfield’s 13-week scorecard for Ashby arrived.',
  facts: {
    priya_answer_week: { values: ['groveport', 'joliet', 'both_separately'], recorded: 'groveport', owner: 'Priya Raman (synthetic)', says: 'How Priya answers which warehouse leads the plan for the week of 22 November' },
    northfield_accepts: { values: ['yes', 'no'], recorded: 'yes', owner: 'Northfield (synthetic)', says: 'Whether Jordan Ellis accepts the shared explanation' },
  },
  variations: { canonical: {}, joliet_leads: { priya_answer_week: 'joliet' }, northfield_rejects: { northfield_accepts: 'no' } },
  actions: {
    draft_corrective_task: { label: 'Draft a corrective task with its cause, owner and warehouse for Ashby’s plan', actor: 'Trading Grid (task to Kinross and Supplier ERP owners)', rule: 'NF-9.3', mode: 'approve', editable: true, args: ['record', 'cause', 'owner'] },
    ask_priya: { label: 'Ask Priya Raman a question before drafting', actor: 'Trading Grid (notice to Priya)', rule: 'AP-3.1', mode: 'policy', editable: false, args: ['record', 'question'] },
    share_explanation: { label: 'Share the explanation of the official and network-calculated scores, with the lines and documents behind it, with Jordan Ellis', actor: 'Northfield (shared performance review)', rule: 'NF-9.3', mode: 'approve', editable: true, args: ['record'] },
  },
  guardrails: [
    { id: 'NF-9.1', owner: 'Administrator', text: 'Northfield’s official score stays authoritative; a network-calculated figure is labelled as such.' },
    { id: 'NF-9.3', owner: 'Administrator', text: 'A plan names a cause the records support; a split cause needs Priya’s answer first.' },
    { id: 'AP-3.3', owner: 'Administrator', text: 'A closed task is never reported as an improvement; only Northfield’s next scorecard on the same definition shows one.' },
  ],
  queue: (db, s) => { const p = st(s); const rows = Object.keys(PERIODS).map((k) => { const x = shorts(db, s, k); const t = p.tasks[k];
      return { id: k, record: k, what: `${x.short_lines} short-shipped lines; largest group ${x.groups[0]?.group || 'none'} at ${x.largest_share}%; warehouses ${x.warehouses.join(' and ')}`, state: t ? `Task drafted: ${t.cause}` : p.questions[k] && !p.answers[k] ? 'Asked Priya' : p.answers[k] ? 'Priya answered' : 'Open', closed: !!t }; });
    const sc = scorecard(db, s); rows.push({ id: 'explanation', record: 'explanation', what: sc ? `Official ${sc.official_pct} against network-calculated ${sc.network_pct}; ${sc.failing_lines} failing lines` : 'No scorecard', state: p.accepted ? (p.accepted === 'yes' ? 'Accepted by Jordan Ellis' : 'Not accepted by Jordan Ellis') : p.shared ? 'Shared; awaiting Jordan Ellis' : 'Open', closed: !!p.accepted });
    return { as_of: fmtET(iso(s.clock)), rows }; },
  reads: {
    read_scorecard: { description: 'Northfield’s published scorecard at the session clock: period, definition, official score, cases, failing lines, the network-calculated score and what explains the difference.', input: {}, run: (db, s) => scorecard(db, s) || { found: false } },
    read_short_shipments: { description: 'Short-shipped lines in a period (quarter or week_nov22), grouped by item and Kinross warehouse, with the share of the largest group and every line with its pick note.', input: { record: z.enum(Object.keys(PERIODS)) }, run: (db, s, a) => shorts(db, s, a.record) },
    read_answers: { description: 'Priya’s answers to questions asked in this session.', input: {}, run: (db, s) => ({ answers: st(s).answers, questions: st(s).questions }) },
  },
  validate: (db, s, action, a) => { const p = st(s);
    if (action === 'share_explanation') { if (a.record !== 'explanation') return 'Use record "explanation".'; if (p.shared) return 'The explanation is already shared.'; return null; }
    if (!PERIODS[a.record]) return `record is one of: ${Object.keys(PERIODS).join(', ')}.`;
    if (action === 'ask_priya') { if (!a.question || a.question.length > 400) return 'Give the question (at most 400 characters).'; if (p.questions[a.record]) return 'Priya was already asked about this period.'; return null; }
    if (action === 'draft_corrective_task') { if (p.tasks[a.record]) return 'A task is already drafted for this period.'; if (!a.cause || !a.owner) return 'Give the cause and the owner.'; return null; }
    return null; },
  execute: (db, s, p, by, ctx) => { const a = p.args; const q = st(s);
    if (p.action === 'ask_priya') { q.questions[a.record] = { question: a.question, at: fmtET(iso(s.clock)) }; s.clock += MIN;
      const ans = { groveport: 'Groveport leads: the ASH-NAP-4 stock count there is wrong; Joliet’s honey shortfall is a supplier delivery issue I am handling separately.', joliet: 'Joliet leads: fix the honey replenishment first; Groveport’s napkin lines were a one-off count error already corrected.', both_separately: 'Draft one task for each warehouse; they have different causes.' }[s.facts.priya_answer_week];
      ctx.schedule(s, { key: `ans:${a.record}`, at: iso(s.clock + 20 * MIN), record: a.record, actor: 'Priya Raman (synthetic)', synthetic: true, what: `Priya Raman answered: ${ans}`, on: () => { q.answers[a.record] = ans; } });
      return { state: 'Delivered', response: 'Question sent to Priya Raman' }; }
    if (p.action === 'draft_corrective_task') { s.clock += 2 * MIN; q.tasks[a.record] = { cause: a.cause, owner: a.owner, at: fmtET(iso(s.clock)), after_answer: !!q.answers[a.record] }; return { state: 'Completed', response: `Corrective task drafted for ${PERIODS[a.record].label}: ${a.cause}; owner ${a.owner}` }; }
    if (p.action === 'share_explanation') { s.clock += 2 * MIN; q.shared = { at: fmtET(iso(s.clock)) };
      ctx.schedule(s, { key: 'nf-accept', at: iso(s.clock + 24 * H), record: 'explanation', actor: 'Northfield (synthetic)', synthetic: true, what: s.facts.northfield_accepts === 'yes' ? 'Jordan Ellis accepted the explanation; the official score stays 91.0%' : 'Jordan Ellis did not accept the explanation and asked for the receiving advice to be revised first', on: () => { q.accepted = s.facts.northfield_accepts; } });
      return { state: 'Sent', response: 'Explanation shared with Jordan Ellis; Northfield’s official score is unchanged' }; }
    return { state: 'Refused', response: 'Unknown action' }; },
  baseline: (db, s, act) => { const p = st(s);
    for (const k of Object.keys(PERIODS)) if (!p.tasks[k]) { const x = shorts(db, s, k); if (x.groups[0]) act('draft_corrective_task', { record: k, cause: `${x.groups[0].group}: stock below the available-to-promise figure`, owner: x.groups[0].warehouse }); } },
  outcome: (db, s) => { const p = st(s); const violations = [];
    for (const [k, t] of Object.entries(p.tasks)) { const x = shorts(db, s, k); if (!x.one_cause && !t.after_answer) violations.push(`Task drafted for ${PERIODS[k].label} on a split cause without asking Priya`); }
    return { as_of: fmtET(iso(s.clock)), tasks: p.tasks, questions: p.questions, answers: p.answers, explanation: p.shared ? { shared: p.shared.at, northfield: p.accepted || 'Awaiting' } : 'Not shared', official_score_changed: false, violations,
      synthetic: 'Priya’s answer and Northfield’s acceptance are synthetic, from src/pace.js; the scorecard and short-pick records are recorded.' }; },
};
export const Pace = makeRuntime(spec);
