// P14 Match Agent runtime (src/match.js): sessions on Northfield's records branched at the P14 story moment.
// The queue at the moment, the rule baseline against the decision table in every variation, no read after the branch,
// no recorded row changed, the server's guards, and story 4 (Ashby sees shared documents only).
import { createHash } from 'node:crypto';
import * as M from '../../src/match.js';
import { ASHBY_PRIVATE, ASHBY_REFUSALS, refusalText } from '../../src/tools.js';
import { NOT_AVAILABLE } from '../../src/domain.js';

export default function ({ ash, nf, ok, eq }) {
  const moment = M.storyMoment(nf);
  const later = nf.prepare("SELECT invoice, sent_at FROM invoices WHERE replaces = ?").get(moment.anchor);
  eq('match.story_moment_before_the_recorded_correction', [moment.at, moment.anchor, later?.invoice, later?.sent_at > moment.at], ['2026-11-10T14:00:00.000Z', 'INV-7731', 'INV-7731C', true]);

  // Hash of the recorded rows a session reads, before and after every session in this file.
  const rowsHash = () => createHash('sha1').update(JSON.stringify(['invoices', 'invoice_lines', 'errors', 'order_changes', 'receipts', 'shipment_lines', 'remittance_items', 'adjustments'].map((t) => nf.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all())
    .concat([nf.prepare("SELECT doc_id, status, sent_at FROM documents WHERE doc_type IN ('810','824','861','856','865','997') ORDER BY doc_id").all()]))).digest('hex');
  const h0 = rowsHash();

  // Story 1: the queue at the moment lists each held invoice with the rule that held it and the three documents compared.
  const s0 = M.startSession(nf); const q = M.read(nf, s0, 'read_queue').held;
  eq('match.queue_at_moment', q.map((x) => [x.invoice, x.holds.map((h) => `${h.rule}:${h.advice}`), x.compared.purchase_order.reference, x.compared.receiving_advice.length > 0, x.state]), [['INV-7731', ['NF-7.8:Rule engine (this session)'], 'NR-450118', true, 'Held']]); // 18 November 2026: at 09:00 the matching rule holds the invoice; the application advice leaves at 09:04 on Jordan Ellis's approval
  // Story 1: every hold, in every preset, names its rule, and the hold links the PO, each receiving advice and the invoice.
  { const bad = []; for (const [name, facts] of Object.entries(M.VARIATIONS)) { const s = M.startSession(nf, { facts }); for (const h of M.read(nf, s, 'read_queue').held) {
      const c = h.compared; if (!h.holds.length || h.holds.some((x) => !['NF-7.8', 'NF-7.10', 'NF-7.11'].includes(x.rule) || !x.finding)) bad.push(`${name} ${h.invoice}: hold without its rule`);
      if (c.purchase_order.link !== `order/${h.po}` || c.invoice.link !== `document/${h.invoice}` || !c.receiving_advice.length || c.receiving_advice.some((r) => r.link !== `document/${r.reference}` && !(r.link === null && /^synthetic/.test(r.source)))) bad.push(`${name} ${h.invoice}: ${JSON.stringify(c)}`);
      if (h.holds.some((x) => x.advice !== 'Rule engine (this session)' && x.link !== `document/${x.advice}`)) bad.push(`${name} ${h.invoice}: advice not linked`); } }
    eq('match.story1_each_hold_names_its_rule_and_links_po_receipt_invoice', bad, []);
    const rv = M.startSession(nf).cases[moment.anchor].receipts.map((r) => r.reference); const known = rv.filter((ref) => nf.prepare("SELECT 1 FROM documents WHERE reference = ? AND doc_type = '861'").get(ref));
    eq('match.story1_linked_receiving_advice_is_a_recorded_861', [rv.length > 0, known.length === rv.length], [true, true]); }
  eq('match.recorded_holds_follow_the_application_advice', [M.heldAt(nf, moment.at).length, M.heldAt(nf, '2026-11-10T14:10:00.000Z').map((x) => [x.invoice, x.rule, x.sent_value])], [0, [['INV-7731', 'NF-7.8', '300'], ['INV-7731', 'NF-7.8', '120']]]);
  // The same rule engine, later in the quarter, holds other suppliers' invoices under NF-7.11 and NF-7.10 (T1.6).
  eq('match.rule_engine_holds_t16_variances', M.heldAt(nf, '2026-11-24T19:00:00.000Z').map((x) => `${x.invoice}:${x.rule}`), ['INV-V470001:NF-7.11', 'INV-V470004:NF-7.10']);

  // Story 2 and the decision table: the baseline's first step, the lines it proposes as clear, and the lines left with their settling record.
  const EXPECT = {
    canonical: ['request_credit_or_corrected_invoice', '1,3', '2:short_pay_decided'],
    correction_on_file: ['match_corrected_invoice', '1,3', '2:short_pay_decided'],
    price_set_by_change: ['clear_line_by_accepted_change', '1,2,3', ''],
    price_beyond_tolerance: ['request_credit_or_corrected_invoice', '1,2,3', ''],
    total_differs: ['reject_document_fault', '1,2,3', ''],
    triple_mismatch: ['request_credit_or_corrected_invoice', '3', '1:short_pay_decided,2:short_pay_decided'],
    ashby_free_text: ['request_credit_or_corrected_invoice', '1,3', '2:short_pay_decided'],
    ashby_free_text_proved: ['request_credit_or_corrected_invoice', '1,3', '2:short_pay_decided'],
    ashby_dispute: ['request_credit_or_corrected_invoice', '3', '1:short_pay_decided,2:short_pay_decided'],
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
  // A supplier's delivery claim: the baseline short-pays and leaves it open; asking for proof closes it (withdrawn) or refers the line to receiving (proved).
  { const claim = (name) => runs[name].o.supplier_claims.map((x) => `${x.line}:${x.state.split(':')[0]}`).join();
    const followed = (facts) => { const s = M.startSession(nf, { facts }); const st = (a, args) => { const r = M.propose(nf, s, 'Check', a, args); return r.state === 'Awaiting approval' ? M.decide(nf, s, r.proposal, 'approve', 'Check approver') : r; };
      st('request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); const pr = st('request_proof_of_delivery', { invoice: 'INV-7731', lines: [2] }); const sp = M.propose(nf, s, 'Check', 'short_pay_at_payment', { invoice: 'INV-7731', lines: [2] });
      return [pr.state, sp.state, M.outcome(nf, s).supplier_claims.map((x) => `${x.line}:${x.state.split(':')[0]}`).join()]; };
    eq('match.claim_open_when_baseline_short_pays', [claim('ashby_free_text'), claim('canonical')], ['2:Open', '']);
    eq('match.proof_request_closes_or_refers_the_claim', [followed(M.VARIATIONS.ashby_free_text), followed(M.VARIATIONS.ashby_free_text_proved)], [['Executed', 'Awaiting approval', '2:Closed'], ['Executed', 'Refused', '2:Proof received']]);
    eq('match.proof_request_needs_a_supplier_statement', M.propose(nf, M.startSession(nf), 'Check', 'request_proof_of_delivery', { invoice: 'INV-7731', lines: [2] }).state, 'Refused'); }
  const triple = runs.triple_mismatch.s; const tr = triple.reads.map((r) => r.name);
  ok('match.triple_mismatch_reads_receiving_advice_first', tr.indexOf('read_receipts') >= 0 && tr.indexOf('read_receipts') < tr.indexOf('read_invoice') && /Receiving advice RCV-|the receiving advice stands/.test(runs.triple_mismatch.o.lines.find((l) => l.line === 1).settling_record), tr.join());
  // Story 2, the mutation test: change one record and the next step switches, following the decision table.
  { const step = (facts) => { const s = M.startSession(nf, { facts }); const n = M.nextStep(nf, s, moment.anchor); return `${n.action}${n.args?.lines ? ' ' + n.args.lines.join(',') : ''}${n.args?.line ? ' ' + n.args.line : ''}`; };
    const one = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const V = M.VARIATIONS;
    eq('match.story2_mutation_accepted_order_change_switches_hold_to_clear', [one(V.price_beyond_tolerance, V.price_set_by_change), step(V.price_beyond_tolerance), step(V.price_set_by_change)], [['price_change_line3'], 'request_credit_or_corrected_invoice 3', 'clear_line_by_accepted_change 3']);
    // Row 5 (all three disagree): once the corrected invoice is matched, a changed receiving advice decides line 1, and the lines proposed clear change.
    eq('match.story2_mutation_receiving_advice_changes_the_settling_record', [one(V.canonical, V.triple_mismatch), ...[V.canonical, V.triple_mismatch].map((f) => { const o = M.runBaseline(nf, M.startSession(nf, { facts: f })); const l = o.lines[0]; return `${l.status} ${/^Receiving advice RCV-/.test(l.settling_record || '') ? 'receiving advice' : l.settling_record}; clear ${o.proposed_clear_for_payment.join(',')}`; })],
      [['received_line1'], 'clear null; clear 1,3', 'short_pay_decided Jordan Ellis decided to short-pay line 1 by 8 cases at payment; the receiving advice stands (NF-5.5); clear 3']);  // the uncorrected line now goes to Jordan's short-pay decision (Phase 3 step 4)
    eq('match.story2_mutation_total_switches_to_reject', [one({ billed_line1: 270, received_line2: 120 }, V.total_differs), step({ billed_line1: 270, received_line2: 120 }), step(V.total_differs)], [['total_offset'], 'release_for_payment_proposal 1,2,3', 'reject_document_fault']);
    // The recorded world itself: before INV-7731C is on file the next step is a request; once the clock passes its recorded time the next step matches it.
    const s = M.startSession(nf); const before = M.nextStep(nf, s, moment.anchor); const p = M.propose(nf, s, 'Check', before.action, before.args); M.decide(nf, s, p.proposal, 'approve', 'Jordan Ellis'); const after = M.nextStep(nf, s, moment.anchor);
    eq('match.story2_mutation_recorded_corrected_invoice_switches_request_to_match', [before.action, after.action, after.args?.correction], ['request_credit_or_corrected_invoice', 'match_corrected_invoice', 'INV-7731C']); }
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

  // Story 3: approval names the person and the record, and changes no payment state, in the session or in the recorded world.
  { const s = M.startSession(nf); const p = M.propose(nf, s, 'Match Agent', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); const before = JSON.stringify(M.outcome(nf, s).payment_released);
    const d = M.decide(nf, s, p.proposal, 'approve', 'Jordan Ellis'); const a = s.audit.filter((x) => x.proposal === p.proposal).at(-1); const t = s.trace.find((x) => x.type === 'human');
    const pay = nf.prepare("SELECT (SELECT group_concat(status) FROM invoices WHERE po = 'NR-450118') st, (SELECT count(*) FROM remittance_items WHERE invoice LIKE 'INV-7731%') r").get();
    eq('match.story3_approval_names_person_and_record', [d.approval?.by, d.approval?.record, a.approver, a.record, t.actor, /INV-7731/.test(t.what), t.detail.record], ['Jordan Ellis', 'INV-7731', 'Jordan Ellis', 'INV-7731', 'Jordan Ellis', true, 'INV-7731']);
    eq('match.story3_approval_changes_no_payment_state', [d.approval?.payment, before, M.outcome(nf, s).payment_released, Object.values(M.ACTIONS).filter((x) => /payment/i.test(x.label)).map((x) => [x.mode, x.editable]), M.startSession(nf, { policy: { release_for_payment_proposal: 'approve' } }).modes.release_for_payment_proposal, [pay.st, pay.r]],
      [M.PAYMENT_UNCHANGED, 'false', false, [['suggest', false], ['approve', false]], 'suggest',  // release stays a suggestion; the short-pay decision is Jordan's approval and releases nothing
      ['Held, then replaced by INV-7731C,Delivered', nf.prepare("SELECT count(*) n FROM remittance_items WHERE invoice LIKE 'INV-7731%'").get().n]]);
    const r = M.startSession(nf); const rp = M.propose(nf, r, 'Match Agent', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); const rj = M.decide(nf, r, rp.proposal, 'reject', 'Jordan Ellis');
    eq('match.story3_rejection_names_person_and_sends_nothing', [rj.state, r.audit.at(-1).approver, r.audit.at(-1).record, r.requests.length], ['Rejected', 'Jordan Ellis', 'INV-7731', 0]); }

  // Story 4: Ashby sees the hold and any request on the shared documents only; Ashby's copy holds no Northfield accounts payable records.
  { const v = M.supplierView(runs.canonical.s);
    eq('match.ashby_sees_shared_documents_only', [v.invoices[0].application_advice.map((a) => a.reference), v.requests_received.map((r) => r.kind), /"(proposals?|payment_released|settling_record|matching|state)":/.test(JSON.stringify(v)), ash.prepare("SELECT count(*) n FROM documents WHERE reference = 'AA-INV-7731'").get().n,
      ash.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('review_notes','draft_rules','rule_replays','proposals')").get().n], [['AA-INV-7731', 'AA-INV-7731'], ['correction'], false, 1, 0]); }

  // Story 4: Ashby's scope refuses Northfield's accounts payable records and notes with its own refusal text (the server reads the same values).
  { const s = M.startSession(nf); const p = M.propose(nf, s, 'Match Agent', 'request_credit_or_corrected_invoice', { invoice: 'INV-7731', lines: [1, 2] }); M.decide(nf, s, p.proposal, 'edit', 'Jordan Ellis', 'Private AP note: call the buyer first');
    const v = JSON.stringify(M.supplierView(s));
    eq('match.story4_ashby_refuses_ap_records_and_notes_with_its_own_text', [refusalText(NOT_AVAILABLE, ASHBY_PRIVATE.what, 'Northfield Retailer'), ['SELECT * FROM review_notes', 'SELECT * FROM draft_rules'].map((q) => ASHBY_PRIVATE.tables.test(q)),
      /accounts payable/.test(ASHBY_REFUSALS.find((t) => t.name === 'read_retailer_records').description), ash.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('review_notes','draft_rules')").get().n, /Private AP note|MP-\d|Jordan Ellis|Taken over/.test(v)],
      ['Not available to Ashby: Northfield’s accounts payable, draft rules and claims reviewer notes belong to Northfield Retailer.', [true, true], true, 0, false]); }

  // Nothing meant for a screen carries raw X12: reads, traces, outcomes, the supplier's view and setup link documents only (D63).
  { const X12 = /ISA\*|GS\*|ST\*\d{3}\*|IEA\*|SE\*\d+\*|~\s*(BIG|IT1|TDS|BAK|BSN)\*/; const hits = [];
    for (const [name, { s, o }] of Object.entries(runs)) for (const [what, v] of [['reads', s.reads.map((r) => r.out)], ['trace', s.trace], ['outcome', o], ['supplier view', M.supplierView(s)], ['audit', s.audit]]) if (X12.test(JSON.stringify(v))) hits.push(`${name} ${what}`);
    if (X12.test(JSON.stringify(M.setup(nf)))) hits.push('setup');
    eq('match.no_raw_x12_on_any_screen_output', hits, []); }

  eq('match.sessions_change_no_recorded_row', [viol, rowsHash() === h0], [[], true]);
}
