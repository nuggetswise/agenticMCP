// P26 Lot data and recall reach (world/stages/lot-trace.js, world/lots.js): a lot and a best-before date on every honey
// carton and on the matching receiving advice line, the hold on a ship notice whose cartons carry neither, the fix, the
// corrected ship notice, the receiving advice, the recalled lot's reach by DC, and nothing dated before P25's last record.
import { lotOf } from '../../world/lots.js';
import { P26_LOT, RECALLED, lotCharge } from '../../world/stages/lot-trace.js';
import { P26_SECOND } from '../../world/stages/lot-hold.js';
import * as NR from '../../src/retailer.js';

export default function ({ db, ash, nf, ok, eq, none, n }) {
  const P25_AT = db.prepare("SELECT as_of FROM calendar WHERE id = 'P25'").get().as_of;
  const cal = db.prepare("SELECT * FROM calendar WHERE id = 'P26'").get();
  eq('p26.calendar_row', [cal?.stage, cal?.seen_by, cal?.anchor, cal?.as_of > P25_AT], ['Fulfillment', 'Priya Raman, then Jordan Ellis', 'NR-47400', true]);
  const POS = "('NR-47400','NR-47403','NR-47407','NR-47414')";
  const LAST = db.prepare("SELECT max(sent_at) t FROM documents WHERE po IN ('NR-47300','NR-47304','NR-47311','NR-47318')").get().t;
  none('p26.no_record_before_p25_ends', `SELECT doc_id FROM documents WHERE po IN ${POS} AND sent_at <= '${LAST}' UNION ALL SELECT id FROM events WHERE id BETWEEN 6000001 AND 6999999 AND at <= '${LAST}'`);

  // Every honey carton carries a lot and a best-before date, read back from the ship notice; nothing else does.
  none('p26.every_honey_carton_has_a_lot', "SELECT c.sscc FROM cartons c WHERE c.sku = 'ASH-HNY-340' AND NOT EXISTS (SELECT 1 FROM carton_lots l WHERE l.sscc = c.sscc AND l.shipment_id = c.shipment_id AND l.lot <> '' AND l.best_before IS NOT NULL)");
  none('p26.only_food_cartons_carry_a_lot', "SELECT sscc FROM carton_lots WHERE sku <> 'ASH-HNY-340'");
  eq('p26.carton_lots_match_cartons', n('SELECT count(*) n FROM carton_lots'), n("SELECT count(*) n FROM cartons WHERE sku = 'ASH-HNY-340'"));
  // The matching receiving advice line carries the same lot and date as the ship notice it was received against.
  none('p26.every_honey_receipt_line_has_a_lot', "SELECT r.receipt FROM receipts r JOIN order_lines l ON l.po = r.po AND l.line = r.line WHERE l.sku = 'ASH-HNY-340' AND NOT EXISTS (SELECT 1 FROM receipt_lots x WHERE x.receipt = r.receipt AND x.line = r.line)");
  none('p26.receipt_lot_is_the_ship_notice_lot', 'SELECT r.receipt FROM receipt_lots r WHERE NOT EXISTS (SELECT 1 FROM carton_lots c WHERE c.shipment_id = r.shipment_id AND c.line = r.line AND c.lot = r.lot AND c.best_before = r.best_before)');
  // The lot follows the ship date (world/lots.js), so the same shipment always gives the same lot.
  { const bad = db.prepare('SELECT DISTINCT c.shipment_id, c.lot, c.best_before, s.shipped_at FROM carton_lots c JOIN shipments s ON s.shipment_id = c.shipment_id').all().filter((r) => { const x = lotOf('ASH-HNY-340', r.shipped_at); return x.lot !== r.lot || x.best_before !== r.best_before; });
    eq('p26.lot_follows_the_ship_date', bad.map((r) => r.shipment_id), []); }
  // No quantity, order or charge moved: the lot rides on documents that already existed.
  eq('p26.quarter_honey_volume_unchanged', db.prepare("SELECT count(DISTINCT s.shipment_id) ships, sum(l.qty) cases FROM shipments s JOIN shipment_lines l ON l.shipment_id = s.shipment_id WHERE l.sku = 'ASH-HNY-340' AND s.sent_at <= ?").get(LAST), { ships: 1160, cases: 17196 });

  // The rule: in Northfield's guide, invented charge.
  eq('p26.lot_rule', db.prepare("SELECT charge_code, charge, basis, doc_type FROM rules WHERE id = 'NF-4.17'").get(), { charge_code: 'LT01', charge: '$150 per ship notice plus $5 per carton without a lot', basis: 'invented', doc_type: '856' });

  // The hold: one finding, 12 of 60 cartons, Kinross owns the fix, the charge at stake from the rule.
  const hold = JSON.parse(db.prepare("SELECT data FROM events WHERE kind = 'tg.hold' AND po = 'NR-47400'").get().data); const f = hold.findings[0];
  eq('p26.hold', [hold.findings.length, hold.sent_to_northfield, f.rule, f.cartons.length, f.cartons_checked, f.owner, f.fix_in, f.exposure_estimate, lotCharge(12)], [1, false, 'NF-4.17', 12, 60, 'Kinross Logistics', 'Kinross shipping advice (945)', 210, 210]);
  const v = db.prepare("SELECT data FROM events WHERE kind = 'erp.ship_notice' AND po = 'NR-47400' ORDER BY at").all().map((e) => JSON.parse(e.data));
  eq('p26.first_version_misses_12_lots_corrected_misses_none', v.map((x) => [x.version, x.carton_lots.filter((c) => !c.lot || !c.best_before).length]), [[1, 12], [2, 0]]);
  eq('p26.held_cartons_are_the_ones_with_no_lot', v[0].carton_lots.filter((c) => !c.lot).map((c) => c.sscc), f.cartons);
  // 27 November 2026: the draft is built from the 11:28 945 and held the same minute; no API departure scan follows.
  const seq = db.prepare("SELECT kind FROM events WHERE po = 'NR-47400' AND id >= 6000001 AND at >= (SELECT at FROM events WHERE kind = 'tg.hold' AND po = 'NR-47400') ORDER BY at, id").all().map((e) => e.kind);
  eq('p26.fix_then_corrected_notice_then_check_then_release', seq, ['erp.ship_notice', 'tg.hold', 'erp.correction', 'erp.ship_notice', 'tg.check', 'approval']);
  none('p26.no_api_warehouse_scans', "SELECT id FROM events WHERE kind IN ('wms.load_scan', 'wms.departure_scan') AND po IN ('NR-47400', 'NR-47403')");
  // The ship notice Northfield receives carries the lot on all 60 cartons, within the hour, and the receipt matches it.
  eq('p26.sent_ship_notice', [n("SELECT count(*) n FROM carton_lots WHERE shipment_id = 'ASN-47400' AND lot = ?".replace('?', `'${P26_LOT.lot}'`)), n("SELECT count(*) n FROM documents WHERE reference = 'ASN-47400' AND doc_type = '856'"),
    db.prepare("SELECT (julianday(sent_at) - julianday(shipped_at)) * 24 < 1 ok FROM shipments WHERE shipment_id = 'ASN-47400'").get().ok], [60, 1, 1]);
  eq('p26.receipt_matches', db.prepare("SELECT r.qty qty, r.short short, x.lot lot FROM receipts r JOIN receipt_lots x ON x.receipt = r.receipt AND x.line = r.line WHERE r.receipt = 'RCV-DC2-47400'").all().map((r) => `${r.qty} ${r.short} ${r.lot}`), [`60 0 ${P26_LOT.lot}`]);
  none('p26.no_lot_charge', `SELECT po FROM adjustments WHERE po IN ${POS} UNION ALL SELECT po FROM events WHERE kind = 'case.opened' AND po IN ${POS}`);
  // The open orders are allocated from the same lot and have not shipped.
  eq('p26.open_orders_same_lot_not_shipped', db.prepare(`SELECT po, data FROM events WHERE kind = 'wms.lot_allocation' AND po NOT IN ('NR-47400', '${P26_SECOND}') ORDER BY po`).all().map((e) => `${e.po} ${JSON.parse(e.data).lot} ${n(`SELECT count(*) n FROM shipments WHERE po = '${e.po}'`)}`), [`NR-47407 ${P26_LOT.lot} 0`, `NR-47414 ${P26_LOT.lot} 0`]);

  // The second hold: a mixed honey and napkin order to DC 4. The lot is on every honey carton and the best-before date on
  // none, because Ashby's ship notice map leaves it off on a ship notice with more than one item. Owner EDI operations.
  const h2 = JSON.parse(db.prepare('SELECT data FROM events WHERE kind = ? AND po = ?').get('tg.hold', P26_SECOND).data); const f2 = h2.findings[0];
  eq('p26.second_hold', [h2.findings.length, h2.sent_to_northfield, f2.rule, f2.cartons.length, f2.cartons_checked, f2.owner, f2.fix_in, f2.exposure_estimate, lotCharge(36)], [1, false, 'NF-4.17', 36, 36, 'EDI operations', 'Ashby’s ship notice map', 330, 330]);
  const v2 = db.prepare("SELECT data FROM events WHERE kind = 'erp.ship_notice' AND po = ? ORDER BY at").all(P26_SECOND).map((e) => JSON.parse(e.data));
  eq('p26.second_first_version_has_lots_and_no_dates', v2.map((x) => [x.version, x.carton_lots.filter((c) => !c.lot).length, x.carton_lots.filter((c) => !c.best_before).length]), [[1, 0, 36], [2, 0, 0]]);
  // P26 opens at the hold itself, 10:13 (owner, 27 November 2026), so the hold may equal the moment.
  ok('p26.second_hold_open_at_the_moment', db.prepare('SELECT at FROM events WHERE kind = ? AND po = ?').get('tg.hold', P26_SECOND).at <= cal.as_of && db.prepare("SELECT min(at) t FROM events WHERE kind = 'erp.correction' AND po = ?").get(P26_SECOND).t > cal.as_of);
  const seq2 = db.prepare("SELECT kind FROM events WHERE po = ? AND id >= 6000001 AND at >= (SELECT at FROM events WHERE kind = 'tg.hold' AND po = ?) ORDER BY at, id").all(P26_SECOND, P26_SECOND).map((e) => e.kind);
  eq('p26.second_fix_then_corrected_notice_then_check_then_release', seq2, ['tg.hold', 'erp.correction', 'erp.ship_notice', 'tg.check', 'approval']);
  eq('p26.second_receipt_matches', db.prepare("SELECT r.line line, r.qty qty, r.short short FROM receipts r WHERE r.receipt = 'RCV-DC4-47403' ORDER BY r.line").all().map((r) => `${r.line} ${r.qty} ${r.short}`), ['1 36 0', '2 12 0']);
  eq('p26.second_sent_ship_notice_carries_lot_and_date', n(`SELECT count(*) n FROM carton_lots WHERE shipment_id = 'ASN-47403' AND lot = '${P26_LOT.lot}' AND best_before = '${P26_LOT.best_before}'`), 36);
  ok('p26.map_change_ashby_only', ash.prepare("SELECT count(*) n FROM events WHERE kind = 'erp.map_change'").get().n === 1 && nf.prepare("SELECT count(*) n FROM events WHERE kind = 'erp.map_change'").get().n === 0);

  // Recall reach: the recalled lot, by DC, each row traced to its receiving advice; more than one DC; other lots listed.
  const at = new Date(cal.as_of); const r = NR.lotReach(nf, { lot: RECALLED.lot, asOf: at });
  const want = db.prepare('SELECT s.ship_to dc, count(DISTINCT c.shipment_id) ships, sum(c.qty) cases FROM carton_lots c JOIN shipments s ON s.shipment_id = c.shipment_id WHERE c.lot = ? GROUP BY s.ship_to ORDER BY cases DESC').all(RECALLED.lot);
  ok('p26.reach_found_with_notice', r.found && r.recall_notice && r.recall_notice.told_by === 'Ashby Supplier' && r.best_before === RECALLED.best_before, JSON.stringify(r).slice(0, 200));
  eq('p26.reach_by_dc', r.by_dc.map((g) => [g.ship_notices, g.cases_shipped, g.receiving_advices, g.cases_received, g.cases_in_transit]), want.map((w) => [w.ships, w.cases, w.ships, w.cases, 0]));
  ok('p26.reach_more_than_one_dc', r.by_dc.length > 1 && r.totals.dcs === r.by_dc.length);
  ok('p26.every_shipment_traced_to_its_receiving_advice', r.by_dc.every((g) => g.shipments.every((x) => x.receiving_advice && x.cases_received === x.cases_shipped)));
  ok('p26.other_lots_listed_and_exclude_the_recalled_one', r.other_lots.length === n('SELECT count(DISTINCT lot) n FROM carton_lots WHERE shipment_id IN (SELECT shipment_id FROM shipments WHERE sent_at <= ?)'.replace('?', `'${cal.as_of}'`)) - 1 && !r.other_lots.some((l) => l.lot === RECALLED.lot));
  ok('p26.reach_is_deterministic', JSON.stringify(NR.lotReach(nf, { lot: RECALLED.lot, asOf: at })) === JSON.stringify(r));
  ok('p26.unknown_lot_not_found', NR.lotReach(nf, { lot: 'WH9999', asOf: at }).found === false);
  // Ashby does not see the recall notice Northfield recorded; both see the lots on the documents they exchanged.
  eq('p26.views', [ash.prepare("SELECT count(*) n FROM events WHERE kind = 'recall.notice'").get().n, nf.prepare("SELECT count(*) n FROM events WHERE kind = 'recall.notice'").get().n, ash.prepare('SELECT count(*) n FROM carton_lots').get().n, nf.prepare('SELECT count(*) n FROM carton_lots').get().n], [0, 1, n('SELECT count(*) n FROM carton_lots'), n('SELECT count(*) n FROM carton_lots')]);
}
