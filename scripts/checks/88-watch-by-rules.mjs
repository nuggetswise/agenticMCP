// P13 rebuilt with no agent (D75): the decision table works the open-order queue, Priya approves, the records answer.
// No model is involved, so the run is deterministic and checked here.
import * as W from '../../src/watch.js';
export default function ({ db, ok, eq }) {
  const rec = W.rulesRecording(db); const again = W.rulesRecording(db);
  const strip = (x) => JSON.stringify(x).replace(/WS-[0-9a-f]{10}/g, '').replace(/W[0-9A-F]{4,6}\b/g, '');
  ok('watch_rules.run_is_deterministic', strip(rec) === strip(again));
  eq('watch_rules.queue_at_the_morning_check', rec.start.queue.rows.map((r) => `${r.po} ${r.document}`), ['NR-46215 856', 'NR-46220 945', 'NR-462412 945', 'NR-46210 855', 'NR-462410 856', 'NR-462411 856', 'NR-46226 810']);
  eq('watch_rules.nothing_to_chase', rec.start.queue.nothing_to_chase.map((r) => r.po), ['NR-46231']);
  eq('watch_rules.one_proposal_per_order_waits_for_priya', rec.start.awaiting.map((p) => `${p.args.po} ${p.action}${p.then ? ' then ' + p.then.action : ''}`),
    ['NR-46215 release_document', 'NR-46220 ask_kinross_status', 'NR-462412 ask_kinross_status', 'NR-46210 release_document', 'NR-462410 flag_erp_record then ask_kinross_status', 'NR-462411 release_document', 'NR-46226 draft_invoice_in_erp then release_document']);
  ok('watch_rules.no_step_is_an_agents', rec.start.trace.every((t) => t.type !== 'ai' && t.actor !== 'Watch Agent') && Object.values(rec.steps).flat().every((s) => s.trace.every((t) => t.type !== 'ai' && t.actor !== 'Watch Agent')));
  const last = (po) => rec.steps[po].at(-1).rows.map((r) => `${r.document} ${r.state}`);
  eq('watch_rules.five_approvals_reach_the_ending', [rec.steps['NR-46215'].length + rec.steps['NR-46220'].length + rec.steps['NR-46210'].length + rec.steps['NR-46226'].length, last('NR-46215'), last('NR-46220'), last('NR-46210'), last('NR-46226')],
    [5, ['856 Closed; sent Late'], ['945 Closed', '856 Sent'], ['855 Sent'], ['810 Sent']]);
  // Edit suggestion: Priya takes an order over; the rules leave it alone until a new record arrives on it.
  const s = W.startRules(db, {}); const p = s.proposals.find((x) => x.state === 'Awaiting approval' && x.args.po === 'NR-46220');
  W.decideRules(db, s, p.id, 'edit', 'Priya Raman', 'by hand');
  ok('watch_rules.a_takeover_is_not_proposed_again', !s.proposals.some((x) => x.state === 'Awaiting approval' && x.args.po === 'NR-46220') && s.proposals.find((x) => x.id === p.id).taken_over_by === 'Priya Raman');
  // The Kinross window is Priya's rule in the catalogue: at 48 hours NR-46220 is inside the window and not flagged.
  const wide = W.rulesView(db, W.startRules(db, { variation: { kinross_window_hours: 48 } }));
  ok('watch_rules.kinross_window_changes_which_rows_are_flagged', !wide.queue.rows.some((r) => r.po === 'NR-46220') && rec.start.queue.rows.some((r) => r.po === 'NR-46220'));
}
