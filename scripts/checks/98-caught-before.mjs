// P22 Caught before shipment (change list of 20 November, sixth; carried out 23 November 2026, rebuild plan Step 4 Bucket 3):
// the finding log records, for each Ashby finding closed before its document left, the rule, the charge Northfield's guide
// schedules for that failure and the record that closed it. Each figure recomputes from the rows; nothing is added to deductions.
import { findingOutcomes, scheduledCharge, CAUGHT_CAUSES } from '../../src/findings.js';

export default function ({ db, ash, nf, ok, eq }) {
  const T = new Date('2027-01-09T22:00:00.000Z'); // P22's moment
  const rows = db.prepare("SELECT c.*, f.side, f.period, f.raised_at FROM findings_caught c JOIN findings f USING (finding_id)").all();
  eq('caught.ashby_only', [...new Set(rows.map((r) => r.side))], ['Ashby']);
  eq('caught.every_cause_is_named', rows.filter((r) => !CAUGHT_CAUSES.includes(r.cause)).length, 0);
  eq('caught.charge_recomputes_from_the_rule_text', rows.filter((r) => scheduledCharge(db.prepare('SELECT charge FROM rules WHERE id = ?').get(r.rule)?.charge, r.cartons || 0) !== r.scheduled_charge).map((r) => r.finding_id), []);
  eq('caught.closed_before_or_as_the_document_left', rows.filter((r) => r.closed_at > r.document_left_at || r.closed_at < r.raised_at).map((r) => r.finding_id), []);
  eq('caught.no_ship_notice_that_left_was_rejected_or_late', rows.filter((r) => /^ASN-/.test(r.document) && (db.prepare("SELECT count(*) n FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE d.reference = ?").get(r.document).n
    || db.prepare("SELECT 1 x FROM events WHERE kind = 'tg.late_document' AND json_extract(data, '$.document') = ?").get(r.document))).map((r) => r.finding_id), []);
  const c = findingOutcomes(db, 'Ashby', { asOf: T }).caught_before_shipment;
  eq('caught.quarter_totals', [c.findings, c.orders, c.scheduled_charge], [17, 12, 3881]);
  eq('caught.quarter_by_cause', c.by_cause.map((b) => `${b.cause}:${b.findings}:${b.orders}:${b.scheduled_charge}`),
    ['Ship notice held and corrected:8:6:3041', 'Invoice corrected before the batch:1:1:100', 'Missing document sent before its deadline:7:6:740', 'Order changed before shipment:1:1:0']);
  ok('caught.kept_apart_from_value_proven', !JSON.stringify(findingOutcomes(db, 'Ashby', { asOf: T }).value_proven).includes('caught') && /Never added/.test(c.kept_apart));
  eq('caught.ashby_copy_holds_the_same_rows', ash.prepare('SELECT count(*) n FROM findings_caught').get().n, rows.length);
  eq('caught.northfield_copy_holds_none', nf.prepare('SELECT count(*) n FROM findings_caught').get().n, 0);
  ok('caught.northfield_read_has_no_caught_section', !('caught_before_shipment' in findingOutcomes(db, 'Northfield', { asOf: T })));
}
