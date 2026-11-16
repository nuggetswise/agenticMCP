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
{ const b = Pace.startSession(db, {}); const o = Pace.runBaseline(db, b); ok(o.violations.some((v) => /split cause/.test(v)), 'pace baseline drafts the split week without asking');
  const a = Pace.startSession(db, {}); const go = act(Pace, db, a);
  ok(Pace.read(db, a, 'read_short_shipments', { record: 'quarter' }).one_cause === true && Pace.read(db, a, 'read_short_shipments', { record: 'week_nov22' }).one_cause === false, 'pace: quarter has one cause, the week splits');
  go('draft_corrective_task', { record: 'quarter', cause: 'ASH-MUG-12 at Kinross Joliet: stock below the available-to-promise figure', owner: 'Kinross Joliet' });
  go('ask_priya', { record: 'week_nov22', question: 'Joliet or Groveport first?' }); Pace.advance(db, a, { minutes: 30 });
  go('draft_corrective_task', { record: 'week_nov22', cause: 'ASH-NAP-4 count at Kinross Groveport', owner: 'Kinross Groveport' }); go('share_explanation', { record: 'explanation' }); Pace.advance(db, a, { minutes: 60 * 25 });
  const o2 = Pace.outcome(db, a); ok(!o2.violations.length && o2.explanation.northfield === 'yes' && !o2.official_score_changed, 'pace agent path: asked first, shared, accepted'); }

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
