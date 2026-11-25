// P21 rule documents, Northfield's guide 2026.3 and P8's Ashby side (24 November 2026).
import * as RD from '../../src/ruledocs.js';

export default function ({ db, ok, eq }) {
  const r = db.prepare("SELECT id, rule_set, charge, charge_code FROM rules WHERE id = 'NF-4.18'").get();
  eq('guide.trip_rule', r, { id: 'NF-4.18', rule_set: 'northfield-2026.3', charge: '$150 per ship notice', charge_code: 'TI01' });
  eq('p21.rule_documents', db.prepare('SELECT count(*) n FROM rule_documents').get().n, 6);
  eq('p21.kinross_sections', db.prepare("SELECT rule_id FROM rule_sections WHERE doc_id = 'AGR-ASHBY-KINROSS' ORDER BY section").all().map((x) => x.rule_id), ['KX-945', 'AP-7.1']);
  eq('guide.one_new_requirement', db.prepare("SELECT rule_id FROM rule_sections WHERE doc_id = 'GUIDE-NF-2026.3' AND new_in_version = 1").all().map((x) => x.rule_id), ['NF-4.18']);
  // Ashby's ship notices carry the trip ID only from the map fix; every other supplier's from the start date.
  const ash = (op, at) => db.prepare(`SELECT count(*) n FROM documents d JOIN orders o ON o.po = d.po WHERE o.supplier_id = 'ASHBY' AND d.doc_type = '856' AND d.sent_at ${op} ? AND json_extract(d.body, '$.trip_id') IS NOT NULL`).get(at).n;
  eq('guide.no_trip_before_fix', ash('<', '2026-11-27T19:00:00.000Z'), 0);
  ok('guide.trip_after_fix', ash('>=', '2026-11-30T05:00:00.000Z') > 0);
  eq('guide.no_supplier_without_trip_after_start', db.prepare("SELECT count(*) n FROM documents WHERE doc_type = '856' AND test = 0 AND json_extract(body, '$.shipped_at') >= '2026-11-30T05:00:00.000Z' AND json_extract(body, '$.shipped_at') < '2026-13' AND json_extract(body, '$.trip_id') IS NULL").get().n, 0);
  // Drafts from a document: the Kinross agreement on Ashby's side, the revised guide on Northfield's.
  const k = RD.extractRules(db, 'ashby', { document: 'AGR-ASHBY-KINROSS', as_of: '2026-11-17T16:00:00.000Z' });
  eq('p21.kinross_drafts', k.drafts.map((d) => [d.source.section, d.charge, d.replay.replayed]), [['3.1', 'To set', true], ['5.2', 'To set', false]]);
  const n = RD.extractRules(db, 'northfield', { document: 'GUIDE-NF-2026.3', as_of: '2026-11-20T16:00:00.000Z' });
  eq('p21.guide_drafts', n.drafts.map((d) => [d.source.section, d.charge, d.replay.replayed]), [['4.18', '$150 per ship notice', true]]);
  eq('p21.agreements_not_northfields', RD.extractRules(db, 'northfield', { document: 'AGR-ASHBY-KINROSS' }).found, false);
  // P8, Ashby side, at 9 December 17:30: paid short reconciles to the remittance, stages to the open orders.
  const m = RD.ashbyMoney(db, new Date('2026-12-09T22:30:00.000Z'));
  eq('p8.ashby_paid_short', [m.paid_short.invoices, m.paid_short.gap], [5, 586.8]);
  eq('p8.ashby_stages_reconcile', m.reconciles.stage_total, m.reconciles.open_value);
}
