// Tests for the shared agent runtime and its five agents (Claim, Review, Pace, Shelf, Chase). Each agent's rule baseline must
// reach its decision table's simplest-rule result, the agent's correct path must reach a different, better result on the
// records where the decision table says an agent is needed (D61), the server must gate approvals, and the model loop must
// stop after two refusals. No model is called: a stub model drives the loop.
import { DatabaseSync } from 'node:sqlite';
import { Claim } from '../src/claim.js';
import { Review } from '../src/review.js';
import { Pace } from '../src/pace.js';
import { Shelf } from '../src/shelf.js';
import { Chase } from '../src/chase.js';

const db = new DatabaseSync(new URL('../build/tg.db', import.meta.url).pathname, { readOnly: true });
const nf = new DatabaseSync(new URL('../build/northfield.db', import.meta.url).pathname, { readOnly: true });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const act = (rt, d, s, by = 'Test agent') => (action, args) => { const r = rt.propose(d, s, by, action, args); return r.state === 'Awaiting approval' ? rt.decide(d, s, r.proposal, 'approve') : r; };

// ---------- Claim ----------
{ const s = Claim.startSession(db, { variation: Claim.branchWith('december_28') }); const o = Claim.runBaseline(db, s);
  ok(o.accepted_amount === 290.4 && o.recovered_and_matched === 0, 'claim baseline accepts all three 28 Dec charges');
  const a = Claim.startSession(db, { variation: Claim.branchWith('december_28') }); const go = act(Claim, db, a);
  ok(Claim.propose(db, a, 'x', 'submit_dispute', { record: 'DC-41102' }).state === 'Refused', 'claim: no dispute without the NF-7.4 pack');
  go('request_evidence', { record: 'DC-41102', evidence: 'load_scan' }); go('request_evidence', { record: 'DC-41102', evidence: 'proof_of_delivery' });
  go('request_evidence', { record: 'DC-41118', evidence: 'load_tally' }); go('request_evidence', { record: 'DC-41118', evidence: 'proof_of_delivery' });
  ok(Claim.propose(db, a, 'x', 'request_evidence', { record: 'DC-41131', evidence: 'load_scan' }).state === 'Refused', 'claim: nobody holds a scan for DC-41131');
  go('accept_charge', { record: 'DC-41131' }); Claim.advance(db, a, { minutes: 120 });
  go('submit_dispute', { record: 'DC-41102' }); go('submit_dispute', { record: 'DC-41118' });
  ok(Claim.propose(db, a, 'x', 'match_repayment', { record: 'DC-41102' }).state === 'Refused', 'claim: nothing matched before repayment');
  Claim.advance(db, a, { minutes: 60 * 24 * 13 }); go('match_repayment', { record: 'DC-41102' }); go('match_repayment', { record: 'DC-41118' });
  const o2 = Claim.outcome(db, a); ok(o2.recovered_and_matched === 193.6 && o2.accepted_amount === 96.8 && !o2.violations.length, `claim agent path recovers $193.60 the baseline gives up (${o2.recovered_and_matched})`);
  const c = Claim.startSession(db, {}); const r = Claim.propose(db, c, 'x', 'submit_dispute', { record: 'DC-40877' }); ok(r.state === 'Executed', 'claim: AP-4.1 disputes DC-40877 without asking (proof on hand, under $250)');
  const u = Claim.startSession(db, { variation: Claim.branchWith('kinross_unreachable') }); act(Claim, db, u)('request_evidence', { record: 'DC-41118', evidence: 'load_tally' }); Claim.advance(db, u, { minutes: 120 });
  ok(Claim.queue(db, u).rows.find((x) => x.record === 'DC-41118').evidence['Load tally by SSCC'].startsWith('Held by'), 'claim: Kinross unreachable leaves the tally held');
  const dc = Claim.startSession(db, {}); const go2 = act(Claim, db, dc); go2('accept_charge', { record: 'DC-40931' }); go2('file_carrier_claim', { record: 'DC-40931' });
  ok(Claim.outcome(db, dc).carrier_claims[0]?.claim === 'CR-2026-031', 'claim: carrier claim filed on prepaid damage'); }

// ---------- Claim, promotion deductions (P20) ----------
{ const b = Claim.startSession(db, { variation: Claim.branchWith('promotions') }); const ob = Claim.runBaseline(db, b);
  ok(ob.accepted.length === 5 && ob.recovered_and_matched === 0, `claim promotions baseline accepts all five (${ob.accepted.length})`);
  const a = Claim.startSession(db, { variation: Claim.branchWith('promotions') }); const go = act(Claim, db, a);
  ok(Claim.queue(db, a).rows.length === 5, 'claim promotions: five deductions in the queue');
  ok(Claim.propose(db, a, 'x', 'submit_dispute', { record: 'PD-2701-04' }).state === 'Refused', 'claim promotions: no dispute before Vividly\'s match');
  const m = Object.fromEntries(['PD-2701-01', 'PD-2701-02', 'PD-2701-03', 'PD-2701-04', 'PD-2701-05'].map((r) => [r, Claim.read(db, a, 'vividly_match', { record: r })]));
  ok(m['PD-2701-04'].match === 'Rate above the deal' && m['PD-2701-04'].unsupported_amount === 266.7 && m['PD-2701-04'].synthetic === true, 'vividly_match: rate above the deal, $266.70, labelled synthetic');
  ok(m['PD-2701-02'].match === 'No store activity report for the claimed period' && m['PD-2701-05'].match === "Outside the deal's order window", 'vividly_match: no 852 week; outside the order window');
  ok(Claim.propose(db, a, 'x', 'submit_dispute', { record: 'PD-2701-01' }).state === 'Refused', 'claim promotions: a matched deduction is never disputed');
  go('accept_charge', { record: 'PD-2701-01' }); go('accept_charge', { record: 'PD-2701-03' });
  for (const r of ['PD-2701-04', 'PD-2701-02', 'PD-2701-05']) go('submit_dispute', { record: r });
  Claim.advance(db, a, { minutes: 60 * 24 * 13 }); for (const r of ['PD-2701-04', 'PD-2701-02', 'PD-2701-05']) go('match_repayment', { record: r });
  const o = Claim.outcome(db, a); ok(o.recovered_and_matched === 677.2 && o.accepted_amount === 1442 && !o.violations.length, `claim promotions agent path recovers $677.20 and accepts the two matched (${o.recovered_and_matched}, ${o.accepted_amount})`);
  ok(Claim.read(db, a, 'read_promotion_deduction', { record: 'PD-2701-04' }).deal_on_the_889.rate === 0.5, 'claim promotions: the deal on the 889 pays 0.50 a case'); }

// ---------- Review ----------
{ const b = Review.startSession(nf, { variation: Review.branchWith('tally_count_only') }); Review.runBaseline(nf, b);
  ok(Review.outcome(nf, b).charges[0].state === 'Reversed by Jordan Ellis', 'review baseline reverses on the label "load tally"');
  const a = Review.startSession(nf, { variation: Review.branchWith('tally_count_only') }); const ev = Review.read(nf, a, 'read_evidence', { record: 'DC-41118', charge: 'SH01' });
  ok(ev.evidence['Load tally by SSCC'].by_sscc === false, 'review: the tally read shows no SSCCs');
  act(Review, nf, a)('mark_not_reviewed', { record: 'DC-41118', charge: 'SH01' }); ok(Review.outcome(nf, a).charges[0].state === 'Not reviewed by Jordan Ellis', 'review agent path: count-only tally not reviewed (NF-5.3, NF-7.5)');
  const c = Review.startSession(nf, {}); const p = Review.propose(nf, c, 'Review Agent', 'reverse_charge', { record: 'DC-40877', charge: 'SH01' }); ok(p.state === 'Awaiting approval', 'review: every decision waits for Jordan');
  Review.decide(nf, c, p.proposal, 'approve'); Review.advance(nf, c, { minutes: 60 * 24 * 40 }); ok(Review.outcome(nf, c).repaid[0]?.payment === 'PMT-991204', 'review: recorded repayment PMT-991204 revealed');
  const s2 = Review.startSession(nf, { variation: Review.branchWith('as02') }); Review.runBaseline(nf, s2); ok(Review.outcome(nf, s2).charges[0].state === 'Upheld by Jordan Ellis', 'review: AS02 upheld (NF-5.5)'); }

// ---------- Pace ----------
{ const b = Pace.startSession(db, {}); const o = Pace.runBaseline(db, b);
  ok(o.rate === '91.0%' && o.formula === '43,680 ÷ 48,000 = 91.0%' && o.failing_lines === 108 && o.unattributed.length === 6 && o.sent === 'Nothing' && !o.plan_or_task_drafted, `pace baseline groups by reason code only: nothing attributed, drafted or sent (${o.rate}, ${o.unattributed.length} open)`);
  const a = Pace.startSession(db, {}); const go = act(Pace, db, a);
  ok(Object.keys(Pace.ACTIONS).join() === 'record_attribution' && Pace.ACTIONS.record_attribution.mode === 'policy', 'pace: one action, an attribution on Ashby’s own view; no task, plan or message');
  ok(Pace.propose(db, a, 'x', 'record_attribution', { record: 'short_shipped', attributed_to: 'Kinross', first_record: 'Kinross short pick', basis: 'x' }).state === 'Refused', 'pace: no attribution before the records are read');
  const g = Pace.read(db, a, 'read_failing_lines', { record: 'short_shipped' }); ok(g.lines === 31 && g.cases === 1794 && g.records_on_these_lines.kinross_short_pick === 31, `pace: 31 short-shipped lines, 1,794 cases, each with a Kinross short pick (${g.lines}, ${g.cases}, ${g.records_on_these_lines.kinross_short_pick})`);
  const rb = Pace.read(db, a, 'read_failing_lines', { record: 'received_below' }); ok(rb.lines === 44 && rb.cases === 66 && rb.records_on_these_lines.kinross_short_pick === 0, 'pace: 44 lines received below the ship notice, none with a short pick');
  ok(Pace.read(db, a, 'read_short_shipments', { record: 'quarter' }).one_cause === true && Pace.read(db, a, 'read_short_shipments', { record: 'week_nov22' }).one_cause === false, 'pace: quarter has one cause, the week splits');
  const one = Pace.propose(db, a, 'x', 'record_attribution', { record: 'week_nov22', attributed_to: 'Kinross', first_record: 'Kinross short pick', basis: 'One cause' });
  ok(one.state === 'Refused' && /split across Kinross/.test(one.message), 'pace: one cause for the split week is refused; each warehouse is shown');
  for (const k of ['collect_not_ready', 'allocation_cut', 'outside_window']) Pace.read(db, a, 'read_failing_lines', { record: k });
  go('record_attribution', { record: 'short_shipped', attributed_to: 'Kinross', first_record: 'Kinross short pick before the ship notice', basis: 'Every line carries a Kinross short pick below the order quantity' });
  go('record_attribution', { record: 'collect_not_ready', attributed_to: 'Ashby', first_record: 'Carrier pickup record', basis: 'The carrier found the collect load not ready at the assigned pickup' });
  go('record_attribution', { record: 'allocation_cut', attributed_to: 'Ashby', first_record: 'Supplier ERP allocation', basis: 'The Supplier ERP allocated less than ordered' });
  go('record_attribution', { record: 'outside_window', attributed_to: 'Ashby', first_record: 'Receiving advice', basis: 'Received in full after the delivery window' });
  go('record_attribution', { record: 'received_below', attributed_to: 'Northfield receiving', first_record: 'Receiving advice', basis: 'Ship notice, load scan and delivery receipt agree; the receiving advice counts less' });
  go('record_attribution', { record: 'week_nov22', causes: [{ warehouse: 'Kinross Joliet', cause: 'Short picks' }, { warehouse: 'Kinross Groveport', cause: 'Short picks' }] });
  const o2 = Pace.outcome(db, a); ok(!o2.violations.length && !o2.unattributed.length && o2.attributions.week_nov22.causes.length === 2 && o2.sent === 'Nothing' && !o2.improvement_claimed && a.proposals.every((p) => p.needs === 'policy'), `pace agent path: six groups attributed across systems, the split week as two causes, nothing sent (${JSON.stringify(o2.violations)})`);
  const m = Pace.startSession(db, { variation: Pace.branchWith('end_november') }); const om = Pace.outcome(db, m); ok(om.rate !== '91.0%' && om.failing_lines < 108 && om.failing_lines > 0, `pace: at 30 November the rate to date differs from the quarter (${om.rate}, ${om.failing_lines} lines)`); }

// ---------- Shelf ----------
{ const b = Shelf.startSession(db, { variation: Shelf.branchWith('in_transit') }); Shelf.runBaseline(db, b); ok(Shelf.outcome(db, b).violations.length > 0, 'shelf baseline orders while goods are in transit');
  const w = Shelf.startSession(db, { variation: Shelf.branchWith('in_transit') }); act(Shelf, db, w)('wait_for_transit', { record: '114' }); ok(!Shelf.outcome(db, w).violations.length, 'shelf agent path waits at 17:30');
  const a = Shelf.startSession(db, {}); const go = act(Shelf, db, a);
  ok(Shelf.propose(db, a, 'x', 'create_sales_order', { record: '114' }).state === 'Refused', 'shelf: no sales order before the purchase order');
  go('recommend_order', { record: '114', pairs: 40 }); ok(Shelf.queue(db, a).rows.some((r) => r.record === '207'), 'shelf: store 207 is in the queue');
  go('recommend_transfer', { record: '207', pairs: 24, to_store: '118' }); Shelf.advance(db, a, { minutes: 60 * 3 }); go('create_sales_order', { record: '114' }); Shelf.advance(db, a, { minutes: 60 * 24 * 7 });
  ok(Shelf.outcome(db, a).refilled.length === 1, 'shelf: the next store activity report shows store 114 refilled'); }

// ---------- Chase ----------
{ const b = Chase.startSession(nf, {}); const ob = Chase.runBaseline(nf, b); ok(ob.violations.length >= 9, `chase baseline chases ship notices for loads that never left (${ob.violations.length})`);
  const a = Chase.startSession(nf, { variation: Chase.branchWith('mixed_trails') }); const kinds = Object.fromEntries(Chase.queue(nf, a).rows.map((r) => [r.record, r.kind]));
  ok(kinds['NR-46602'] === 'asn_missing' && kinds['NR-46609'] === 'carrier_silent' && kinds['NR-46616'] === 'disagree' && kinds['NR-46574'] === 'not_ready', `chase: four trails give four kinds ${JSON.stringify(kinds)}`);
  const go = act(Chase, nf, a); go('request_ship_notice', { record: 'NR-46602' }); go('ask_carrier_status', { record: 'NR-46609' }); go('ask_ship_notice_correction', { record: 'NR-46616' }); go('ask_ready_time', { record: 'NR-46574' }); go('record_readiness_failure', { record: 'NR-46574' });
  ok(!Chase.outcome(nf, a).violations.length, 'chase agent path: no load-never-left chases'); Chase.advance(nf, a, { minutes: 60 * 40 });
  ok(Chase.queue(nf, a).rows.find((r) => r.record === 'NR-46574').kind === 'received', 'chase: NR-46574 closes on its recorded receiving advice'); }

// ---------- Engine: approval gate, edit, two refusals stop the model loop ----------
{ const s = Claim.startSession(db, { variation: Claim.branchWith('december_28') });
  const p = Claim.propose(db, s, 'Claim Agent', 'request_evidence', { record: 'DC-41102', evidence: 'load_scan' }); ok(p.state === 'Awaiting approval', 'engine: approve mode waits');
  ok(Claim.decide(db, s, p.proposal, 'edit', 'Priya Raman', 'I call Kinross').state === 'Taken over', 'engine: edit takes over');
  let n = 0; const stub = async () => { n++; return { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'propose_action', args: { action: 'submit_dispute', record: 'DC-41131', rationale: 'test' } } }] } }] }; };
  const s2 = Claim.startSession(db, { variation: Claim.branchWith('december_28') }); const r = await Claim.runAgent(db, s2, { callModel: stub });
  ok(r.status === 'waiting_for_person' && n === 2 && s2.trace.some((t) => /Waiting for Priya Raman/.test(t.what)), 'engine: two refusals stop the agent and report waiting for Priya Raman');
  const s3 = Claim.startSession(db, {}); ok((await Claim.runAgent(db, s3, {})).ok === false, 'engine: no model, nothing simulated'); }

console.log(`runtime: ${pass} pass, ${fail} fail`); if (fail) process.exit(1);
