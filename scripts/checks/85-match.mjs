// P14 Match Agent runtime (src/match.js): sessions on Northfield's records branched at the P14 story moment.
// The queue at the moment, the rule baseline against the decision table in every variation, no read after the branch,
// no recorded row changed, the server's guards, and story 4 (Ashby sees shared documents only).
import { createHash } from 'node:crypto';
import * as M from '../../src/match.js';

export default function ({ ash, nf, ok, eq }) {
  const moment = M.storyMoment(nf);
  const later = nf.prepare("SELECT invoice, sent_at FROM invoices WHERE replaces = ?").get(moment.anchor);
  eq('match.story_moment_before_the_recorded_correction', [moment.at, moment.anchor, later?.invoice, later?.sent_at > moment.at], ['2026-11-10T14:00:00.000Z', 'INV-7731', 'INV-7731C', true]);

  // Hash of the recorded rows a session reads, before and after every session in this file.
  const rowsHash = () => createHash('sha1').update(JSON.stringify(['invoices', 'invoice_lines', 'errors', 'order_changes', 'receipts', 'shipment_lines'].map((t) => nf.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all())
    .concat([nf.prepare("SELECT doc_id, status, sent_at FROM documents WHERE doc_type IN ('810','824','861','856','865','997') ORDER BY doc_id").all()]))).digest('hex');
  const h0 = rowsHash();

  // Story 1: the queue at the moment lists each held invoice with the rule that held it and the three documents compared.
  const s0 = M.startSession(nf); const q = M.read(nf, s0, 'read_queue').held;
  eq('match.queue_at_moment', q.map((x) => [x.invoice, x.holds.map((h) => `${h.rule}:${h.advice}`), x.compared.purchase_order, x.compared.receiving_advice.length > 0, x.state]), [['INV-7731', ['NF-7.8:AA-INV-7731'], 'NR-450118', true, 'Held']]);
  eq('match.queue_equals_recorded_holds', M.heldAt(nf, moment.at).map((x) => [x.invoice, x.rule]), q.flatMap((x) => x.holds.map((h) => [x.invoice, h.rule])));
  // The same rule engine, later in the quarter, holds other suppliers' invoices under NF-7.11 and NF-7.10 (T1.6).
  eq('match.rule_engine_holds_t16_variances', M.heldAt(nf, '2026-11-24T19:00:00.000Z').map((x) => `${x.invoice}:${x.rule}`), ['INV-V470001:NF-7.11', 'INV-V470004:NF-7.10']);

  // Story 2 and the decision table: the baseline's first step, the lines it proposes as clear, and the lines left with their settling record.
  const EXPECT = {
    canonical: ['request_credit_or_corrected_invoice', '1,3', '2:above_received'],
    correction_on_file: ['match_corrected_invoice', '1,3', '2:above_received'],
    price_set_by_change: ['clear_line_by_accepted_change', '1,2,3', ''],
    price_beyond_tolerance: ['request_credit_or_corrected_invoice', '1,2,3', ''],
    total_differs: ['reject_document_fault', '1,2,3', ''],
    triple_mismatch: ['request_credit_or_corrected_invoice', '3', '1:above_received,2:above_received'],
    ashby_free_text: ['request_credit_or_corrected_invoice', '1,3', '2:above_received'],
    ashby_dispute: ['request_credit_or_corrected_invoice', '3', '1:above_shipped,2:above_received'],
    ashby_no_answer: ['request_credit_or_corrected_invoice', '3', '1:above_shipped,2:above_received'],
  };
  const runs = {}; const leaks = []; const viol = [];
  for (const [name, facts] of Object.entries(M.VARIATIONS)) {
    const s = M.startSession(nf, { facts, label: `check ${name}` }); const o = M.runBaseline(nf, s); runs[name] = { s, o };
    eq(`match.baseline.${name}`, [o.first_step, o.proposed_clear_for_payment.join(), o.lines.filter((l) => l.status !== 'clear').map((l) => `${l.line}:${l.status}`).join(), o.payment_released, o.actions_refused], [...EXPECT[name], false, 0]);
    // No read returned a record dated after the clock it was read at (every Eastern timestamp in the output is at or before it).
    for (const r of s.reads) { const late = [...r.out.matchAll(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} ET/g)].map((m) => m[0]).filter((t) => t > r.clock); if (late.length) leaks.push(`${name} ${r.name} at ${r.clock}: ${late[0]}`); }
    if (o.violations.length || JSON.stringify(s.cases[s.anchor].invoice) !== JSON.stringify(s.cases[s.anchor].original)) viol.push(`${name}: ${o.violations.join('; ') || 'invoice changed'}`);
  }
  const triple = runs.triple_mismatch.s; const tr = triple.reads.map((r) => r.name);
  ok('match.triple_mismatch_reads_receiving_advice_first', tr.indexOf('read_receipts') >= 0 && tr.indexOf('read_receipts') < tr.indexOf('read_invoice') && /Receiving advice RCV-/.test(runs.triple_mismatch.o.lines.find((l) => l.line === 1).settling_record), tr.join());
  ok('match.mutation_next_step_follows_the_record', runs.canonical.o.first_step !== runs.correction_on_file.o.first_step && runs.canonical.o.lines[0].status !== runs.triple_mismatch.o.lines[0].status);
  eq('match.simplest_baseline_shows_held_with_rule', runs.canonical.s.simplest.map((x) => [x.invoice, x.shows, x.rules]), [['INV-7731', 'Held', ['NF-7.8']]]);
  eq('match.no_read_after_the_branch', leaks, []);
  // The recorded corrected invoice is hidden until the clock passes its time, then revealed as recorded.
  { const s = M.startSession(nf); const pre = JSON.stringify([M.read(nf, s, 'read_corrections', { invoice: 'INV-7731' }), M.read(nf, s, 'read_order', { po: 'NR-450118' }), M.read(nf, s, 'read_invoice', { invoice: 'INV-7731' })]);
    const rq = M.propose(nf, s, 'Check', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); M.decide(nf, s, rq.proposal, 'approve', 'Check approver');
    const post = M.read(nf, s, 'read_corrections', { invoice: 'INV-7731' });
    eq('match.recorded_correction_revealed_only_after_its_time', [/INV-7731C|FA-N1396/.test(pre), post.corrections.map((c) => [c.reference, c.source, c.at])], [false, [['INV-7731C', 'recorded', '2026-11-10 15:30 ET']]]); }

  // Guards the server enforces, whoever proposes.
  { const s = M.startSession(nf);
    const g = [M.propose(nf, s, 'Check', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1], qty: 270 }).state,
      M.propose(nf, s, 'Check', 'release_for_payment_proposal', { invoice: 'INV-7731', lines: [1, 3] }).state,
      M.propose(nf, s, 'Check', 'release_for_payment_proposal', { invoice: 'INV-7731', lines: [3] }).state,
      M.propose(nf, s, 'Check', 'reject_document_fault', { invoice: 'INV-7731' }).state,
      M.propose(nf, s, 'Check', 'clear_line_by_accepted_change', { invoice: 'INV-7731', line: 1 }).state,
      M.startSession(nf, { policy: { release_for_payment_proposal: 'policy', request_credit_or_corrected_invoice: 'policy', match_corrected_invoice: 'approve' } }).modes];
    const p = M.propose(nf, s, 'Check', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); M.decide(nf, s, p.proposal, 'approve', 'Check approver');
    eq('match.guards', [...g.slice(0, 5), g[5].release_for_payment_proposal, g[5].request_credit_or_corrected_invoice, g[5].match_corrected_invoice, p.state, M.decide(nf, s, p.proposal, 'approve').state],
      ['Refused', 'Refused', 'Suggested', 'Refused', 'Refused', 'suggest', 'approve', 'approve', 'Awaiting approval', 'Refused']);
    const n = runs.ashby_no_answer.s; eq('match.technical_acknowledgment_is_not_acceptance', [M.read(nf, n, 'read_requests').requests.map((r) => [r.state, r.answer]), runs.ashby_no_answer.o.lines[0].status], [[['Acknowledged (997), not answered', 'No answer']], 'above_shipped']);
    let threw = 0; for (const f of [{ billed_line1: 9999 }, { ashby_answer: 'pay' }, { po: 'NR-1' }, { ashby_note: 'x'.repeat(301) }]) { try { M.startSession(nf, { facts: f }); } catch { threw++; } } eq('match.facts_out_of_range_refused', threw, 4); }

  // Story 4: Ashby sees the hold and any request on the shared documents only; Ashby's copy holds no Northfield accounts payable records.
  { const v = M.supplierView(runs.canonical.s);
    eq('match.ashby_sees_shared_documents_only', [v.invoices[0].application_advice.map((a) => a.reference), v.requests_received.map((r) => r.kind), /"(proposals?|payment_released|settling_record|matching|state)":/.test(JSON.stringify(v)), ash.prepare("SELECT count(*) n FROM documents WHERE reference = 'AA-INV-7731'").get().n,
      ash.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('review_notes','draft_rules','rule_replays','proposals')").get().n], [['AA-INV-7731'], ['correction'], false, 1, 0]); }

  eq('match.sessions_change_no_recorded_row', [viol, rowsHash() === h0], [[], true]);
}
