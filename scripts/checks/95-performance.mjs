// P22 and P7: fill rate and timely ship notices. Each reproduces from the documents, reconciles with on-time, in-full, reads
// the same on both sides, and Northfield's figures come from shared documents only.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { fillRate, shipNoticeTimeliness } from '../../src/performance.js';
import { scorecard } from '../../src/score.js';
export default function ({ db, ok, eq }) {
  const T = new Date('2027-01-09T22:00:00.000Z'); const Q = { from: '2026-09-27', to: '2026-12-26', basis: 'The quarter' };
  const nf = new DatabaseSync(fileURLToPath(new URL('../../build/northfield.db', import.meta.url)), { readOnly: true });
  const f = fillRate(db, { asOf: T, period: Q }); const again = fillRate(db, { asOf: T, period: Q });
  ok('performance.fill_rate_is_deterministic', JSON.stringify(f) === JSON.stringify(again));
  eq('performance.fill_rate_quarter', [f.cases_shipped, f.cases_ordered, f.rate, f.short_lines], [45486, 48000, '94.8%', 40]);
  eq('performance.fill_rate_invoices_agree_with_ship_notices', f.cases_invoiced, f.cases_shipped);
  // The fill-rate shortfall is exactly on-time, in-full's short-shipped and allocation-cut lines: same cases, same base.
  const s = scorecard(db); const of = (r) => s.by_reason.find((x) => x.reason === r) || { lines: 0, cases: 0 };
  eq('performance.fill_rate_reconciles_with_on_time_in_full', [f.cases_ordered, f.short_cases], [s.cases, of('Short shipped, remainder cancelled').cases + of('Allocation cut').cases]);
  const t = shipNoticeTimeliness(db, { asOf: T, period: Q });
  eq('performance.timely_ship_notices_quarter', [t.timely, t.ship_notices, t.rate, t.late_ship_notices.map((x) => x.ship_notice)], [1561, 1562, '99.9%', ['ASN-46215']]);
  const tn = shipNoticeTimeliness(nf, { asOf: T, period: Q, supplier: 'Ashby Supplier', viewer: 'NORTHFIELD' });
  eq('performance.northfield_reads_the_same_timeliness_from_shared_documents', [tn.timely, tn.ship_notices], [t.timely, t.ship_notices]);
  const fn = fillRate(nf, { asOf: T, period: Q, supplier: 'Ashby Supplier', viewer: 'NORTHFIELD' });
  eq('performance.northfield_reads_the_same_fill_rate', [fn.cases_shipped, fn.cases_ordered], [f.cases_shipped, f.cases_ordered]);
  ok('performance.northfield_ranks_every_supplier', fillRate(nf, { asOf: T, period: Q, viewer: 'NORTHFIELD' }).ranking.some((r) => r.supplier_id === 'ASHBY'));
  ok('performance.calculated_from_the_start_of_trading_before_the_quarter_closes', !!fillRate(db, { asOf: new Date('2026-11-18T14:00:00Z') }).rate);
}
