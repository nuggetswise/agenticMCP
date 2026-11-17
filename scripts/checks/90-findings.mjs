// P22: the finding log. Every total of finding_outcomes reproduces from the rows of findings and finding_actions, each
// side reads only its own findings, the read is deterministic, and NR-46215 reads decided 14 h 30 m after its deadline.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { findingOutcomes, STAGES, USE_CASES } from '../../src/findings.js';
export default function ({ db, ok, eq }) {
  const T = new Date('2027-01-09T22:00:00.000Z'); const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const open = (f) => new DatabaseSync(fileURLToPath(new URL(`../../build/${f}.db`, import.meta.url)), { readOnly: true });
  const ash = open('ashby'), nf = open('northfield');
  for (const [side, scoped] of [['Ashby', ash], ['Northfield', nf]]) {
    const key = side.toLowerCase(); const o = findingOutcomes(db, side, { asOf: T }); const again = findingOutcomes(db, side, { asOf: T }); const own = findingOutcomes(scoped, side, { asOf: T });
    ok(`findings.${key}_read_is_deterministic`, JSON.stringify(o) === JSON.stringify(again));
    ok(`findings.${key}_scoped_copy_gives_the_same_figures`, JSON.stringify(o) === JSON.stringify(own));
    const base = "FROM findings f WHERE f.side = ? AND f.period = 'Quarter' AND f.raised_at <= ?"; const st = (s) => n(`SELECT count(*) n ${base} AND EXISTS (SELECT 1 FROM finding_actions a WHERE a.finding_id = f.finding_id AND a.stage = ? AND a.at <= ?)`, side, T.toISOString(), s, T.toISOString());
    eq(`findings.${key}_stage_totals_reproduce_from_the_rows`, Object.values(o.stages), STAGES.map(st));
    eq(`findings.${key}_use_case_totals_reproduce_from_the_rows`, o.by_use_case.map((u) => [u.use_case, u.raised]), USE_CASES.map((u) => [u, n(`SELECT count(*) n ${base} AND f.use_case = ?`, side, T.toISOString(), u)]).filter((x) => x[1]));
    eq(`findings.${key}_leaks_reproduce_from_the_rows`, [o.leaks.decided_after_deadline, o.leaks.no_confirming_record],
      [n(`SELECT count(*) n ${base} AND f.deadline IS NOT NULL AND EXISTS (SELECT 1 FROM finding_actions a WHERE a.finding_id = f.finding_id AND a.stage = 'Decided' AND a.at <= ? AND a.at > f.deadline)`, side, T.toISOString(), T.toISOString()),
        n(`SELECT count(*) n ${base} AND NOT EXISTS (SELECT 1 FROM finding_actions a WHERE a.finding_id = f.finding_id AND a.stage = 'Confirmed' AND a.at <= ?)`, side, T.toISOString(), T.toISOString())]);
    eq(`findings.${key}_owner_response_counts_only_records_that_arrived`, o.owner_response.reduce((t, x) => t + x.with_a_record, 0), st('Owner fixed'));
    ok(`findings.${key}_copy_holds_only_its_own_side`, scoped.prepare('SELECT count(*) n FROM findings WHERE side <> ?').get(side).n === 0 && scoped.prepare('SELECT count(*) n FROM finding_actions WHERE finding_id NOT IN (SELECT finding_id FROM findings)').get().n === 0 && scoped.prepare('SELECT count(*) n FROM findings').get().n > 0);
    ok(`findings.${key}_every_finding_is_raised_once_and_stages_follow_in_time`, n("SELECT count(*) n FROM findings f WHERE f.side = ? AND (SELECT count(*) FROM finding_actions a WHERE a.finding_id = f.finding_id AND a.stage = 'Raised') <> 1", side) === 0
      && n("SELECT count(*) n FROM finding_actions a JOIN finding_actions r ON r.finding_id = a.finding_id AND r.stage = 'Raised' JOIN findings f ON f.finding_id = a.finding_id WHERE f.side = ? AND a.at < r.at", side) === 0);
  }
  const a = findingOutcomes(db, 'Ashby', { asOf: T, finding: 'NR-46215' }).findings?.[0];
  eq('findings.nr46215_decided_14h30_late_and_confirmed_by_rcv46215', [a?.decided_against_deadline, a?.decided_late, a?.confirmed_by, a?.decision], ['14 h 30 m after its deadline', true, 'RCV-46215', 'Approved as suggested']);
  ok('findings.each_side_is_refused_the_other_sides_findings', findingOutcomes(db, 'Northfield', { asOf: T, finding: 'NR-46215' }).found === false && /Not available to Northfield/.test(findingOutcomes(db, 'Northfield', { asOf: T, finding: 'NR-46215' }).message)
    && /Not available to Ashby/.test(findingOutcomes(db, 'Ashby', { asOf: T, finding: 'NFD-1' }).message));
  // Value is proven only by a record: every matched repayment is a receivables match, every repaid reversal a remittance adjustment.
  const va = findingOutcomes(db, 'Ashby', { asOf: T }).value_proven.repayments_matched; const vn = findingOutcomes(db, 'Northfield', { asOf: T }).value_proven.charges_reversed_and_repaid;
  eq('findings.ashby_value_is_the_receivables_matches', [va.count, va.amount], [n("SELECT count(*) n FROM events WHERE kind = 'erp.receivables_match' AND at <= ?", T.toISOString()), db.prepare("SELECT round(sum(json_extract(data, '$.amount')), 2) n FROM events WHERE kind = 'erp.receivables_match' AND at <= ?").get(T.toISOString()).n]);
  ok('findings.northfield_value_is_repaid_reversals', vn.records.every((r) => db.prepare('SELECT 1 x FROM deduction_repayments WHERE repayment_payment = ? AND abs(repaid_amount - ?) < 0.005').get(r.proof, r.amount)));
  ok('findings.written_history_is_only_opened_and_approvals', n("SELECT count(*) n FROM finding_actions WHERE written = 1 AND stage NOT IN ('Opened','Decided','Confirmed')") === 0 && n("SELECT count(*) n FROM finding_actions WHERE written = 1 AND stage = 'Confirmed' AND record_kind <> 'Trading Grid deductions'") === 0);
  ash.close(); nf.close();
}
