// T1.14: planning schedules (830), Kinross inventory advice (846) and order status reports (870). The forecast versions
// supersede each other, the stock positions agree with every warehouse and ERP record already in the world, and a
// short-ship charge (NF-2.1, OT01) is judged against the forecast in force and the stock at the pick.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { judgeShortShip, PICK_LEAD_H } from '../../world/stages/planning.js';

const J = (s) => (typeof s === 'string' ? JSON.parse(s) : s);
const minus = (iso, h) => new Date(Date.parse(iso) - h * 3600000).toISOString();

export default function ({ db, ash, nf, ok, eq, none, n, ROOT }) {
  // ---- documents, both X12 checks run over them in validate and botscheck ----
  const count = (t) => n('SELECT count(*) n FROM documents WHERE doc_type = ? AND test = 0', t);
  eq('planning.documents_exchanged', [count('830'), count('846'), count('870')], [6, 365, 40]);
  none('planning.every_document_accepted', "SELECT doc_id, status FROM documents WHERE doc_type IN ('830','846','870') AND status <> 'Delivered'");
  none('planning.parties_as_designed', "SELECT doc_id FROM documents WHERE (doc_type = '830' AND NOT (sender_id = 'NORTHFIELD' AND receiver_id = 'ASHBY')) OR (doc_type = '846' AND NOT ((sender_id = 'KINROSS' AND receiver_id = 'ASHBY') OR (sender_id = 'ASHBY' AND receiver_id = 'NORTHFIELD'))) OR (doc_type = '870' AND NOT (sender_id = 'ASHBY' AND receiver_id = 'NORTHFIELD'))");
  // Round plan, 26 November 2026 (EDI first): Ashby sends Northfield a daily 846 per 3PL site (R30), one for each of Kinross's
  // daily 846s; Kinross's intraday read at Groveport on 8 December (P5) is one more 846 to Ashby.
  const ash846 = n("SELECT count(*) n FROM documents WHERE doc_type = '846' AND sender_id = 'ASHBY' AND receiver_id = 'NORTHFIELD'");
  eq('planning.ashby_846_to_northfield_daily', [ash846, n("SELECT count(*) n FROM documents WHERE doc_type = '846' AND sender_id = 'KINROSS'")], [182, 183]);
  // P10's window: no 830 or 870, and no 997 answering one, between 18 Oct 11:00 ET and 17 Nov 11:00 ET.
  none('planning.nothing_in_p10_window', "SELECT d.doc_id FROM documents d LEFT JOIN documents a ON a.answers_doc_id = d.doc_id AND a.doc_type = '997' WHERE d.doc_type IN ('830','870') AND ((d.sent_at > '2026-10-18T15:00:00.000Z' AND d.sent_at <= '2026-11-17T16:00:00.000Z') OR (a.sent_at > '2026-10-18T15:00:00.000Z' AND a.sent_at <= '2026-11-17T16:00:00.000Z'))");

  // ---- forecast versions ----
  eq('planning.one_forecast_current', db.prepare("SELECT forecast_id FROM forecasts WHERE status = 'Current'").all().map((r) => r.forecast_id), ['FC-20261129']);
  none('planning.superseded_forecast_ends_when_the_next_begins', "SELECT a.forecast_id FROM forecasts a LEFT JOIN forecasts b ON b.forecast_id = a.superseded_by WHERE a.status = 'Superseded' AND (b.forecast_id IS NULL OR a.valid_to <> b.valid_from OR b.supersedes <> a.forecast_id)");
  none('planning.forecast_versions_do_not_overlap', "SELECT a.forecast_id FROM forecasts a JOIN forecasts b ON a.forecast_id < b.forecast_id AND a.valid_from < coalesce(b.valid_to, '9999') AND b.valid_from < coalesce(a.valid_to, '9999')");
  eq('planning.revision_after_p10_window', n("SELECT count(*) n FROM forecasts WHERE issued_at > '2026-11-17T16:00:00.000Z' AND issued_at < '2026-11-29T00:00:00.000Z'"), 1);
  // Consistent with the replenishment orders: each week's forecast is between half and 1.4 times the cases Northfield then ordered.
  none('planning.forecast_consistent_with_orders', `SELECT f.forecast_id, f.sku, f.location, f.week_start, f.qty, a.n FROM forecast_lines f JOIN (SELECT l.sku, o.ship_to, date(o.requested_delivery, '-' || strftime('%w', o.requested_delivery) || ' days') wk, sum(l.qty_original) n
    FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.stream = 'replenishment' GROUP BY 1, 2, 3) a ON a.sku = f.sku AND a.ship_to = f.location AND a.wk = f.week_start WHERE f.qty < 0.5 * a.n OR f.qty > 1.4 * a.n`);
  none('planning.forecast_lines_name_masters', 'SELECT forecast_id FROM forecast_lines WHERE sku NOT IN (SELECT sku FROM items) OR location NOT IN (SELECT id FROM locations)');

  // ---- stock positions agree with the records already in the world ----
  // Kinross's inventory read on 8 December (P5): 610 ASH-MUG-12 at Groveport, and the 846 that evening says the same.
  const inv = db.prepare("SELECT id, at, data FROM events WHERE kind = 'wms.inventory'").get(); const iv = J(inv.data);
  const eod = db.prepare("SELECT available, on_hand FROM stock_positions WHERE site = 'KIN-GRV' AND sku = ? AND kind = 'End of day' AND as_of > ? ORDER BY as_of LIMIT 1").get(iv.sku, inv.at);
  const read = db.prepare('SELECT available FROM stock_positions WHERE event_id = ?').get(inv.id);
  const between = n("SELECT count(*) n FROM stock_positions WHERE site = 'KIN-GRV' AND sku = ? AND kind = 'Pick wave' AND as_of > ? AND as_of <= ?", iv.sku, inv.at, `${inv.at.slice(0, 10)}T23:30:00.000Z`);
  eq('planning.stock_agrees_with_kinross_read', [iv.available, read?.available, eod?.available, eod?.on_hand, between], [610, 610, 610, 611, 0]);
  // Ashby's ERP reads (Northfield's API read among them) are kept as they were read.
  none('planning.stock_agrees_with_erp_reads', "SELECT e.id FROM events e LEFT JOIN stock_positions s ON s.event_id = e.id WHERE e.kind = 'erp.inventory_read' AND (s.event_id IS NULL OR coalesce(s.on_hand, -1) <> coalesce(json_extract(e.data, '$.on_hand'), -1) OR coalesce(s.available, -1) <> coalesce(json_extract(e.data, '$.available'), -1) OR coalesce(s.committed, -1) <> coalesce(json_extract(e.data, '$.committed'), -1) OR s.sku <> json_extract(e.data, '$.sku'))");
  // Every Kinross pick wave: the 846 states the stock at the wave, it covers what the ship notices say was shipped, and
  // where Kinross short-picked it equals what was picked and is below what the wave's orders asked for ("stock below
  // the available-to-promise figure").
  const picks = db.prepare("SELECT w.po, w.site, w.shipped_at, s.sku, sum(s.qty) qty FROM warehouse_orders w JOIN shipment_lines s ON s.po = w.po GROUP BY w.po, s.sku").all();
  const need = new Map(db.prepare('SELECT po, sku, sum(qty_ordered) n FROM order_lines GROUP BY po, sku').all().map((r) => [`${r.po}|${r.sku}`, r.n]));
  const waves = new Map(); for (const p of picks) { const k = `${p.site}|${p.sku}|${minus(p.shipped_at, PICK_LEAD_H)}`; const w = waves.get(k) || waves.set(k, { qty: 0, need: 0, pos: [] }).get(k); w.qty += p.qty; w.need += need.get(`${p.po}|${p.sku}`) || p.qty; w.pos.push(p.po); }
  const waveRow = db.prepare("SELECT available FROM stock_positions WHERE site = ? AND sku = ? AND as_of = ? AND kind = 'Pick wave'");
  const missing = [], uncovered = [];
  for (const [k, w] of waves) { const [site, sku, at] = k.split('|'); const r = waveRow.get(site, sku, at); if (!r) missing.push(k); else if (r.available < w.qty) uncovered.push(k); }
  eq('planning.every_pick_wave_has_a_stock_position', [missing.length, n("SELECT count(*) n FROM stock_positions WHERE kind = 'Pick wave'")], [0, waves.size]);
  eq('planning.stock_covers_what_was_shipped', uncovered, []);
  none('planning.stock_never_negative', 'SELECT site, sku, as_of FROM stock_positions WHERE available < 0 OR on_hand < 0');
  const sp = db.prepare("SELECT e.po, e.data, w.site, w.shipped_at FROM events e JOIN warehouse_orders w ON w.po = e.po WHERE e.kind = 'wms.short_pick'").all();
  const spBad = sp.filter((e) => { const d = J(e.data); const k = `${e.site}|${d.sku}|${minus(e.shipped_at, PICK_LEAD_H)}`; const r = waveRow.get(e.site, d.sku, minus(e.shipped_at, PICK_LEAD_H)); return !r || r.available !== waves.get(k).qty || r.available >= waves.get(k).need || d.site !== e.site; });
  eq('planning.stock_agrees_with_short_picks', [sp.length, spBad.map((e) => e.po)], [31, []]);
  // 18 November 2026: every Kinross shipping advice (945) reports the quantity Kinross picked and loaded, the same figure its
  // pick record, load scan and the ship notice carry. Until then 40 short-shipped and allocation-cut lines reported the ordered quantity.
  const w945 = []; for (const d of db.prepare("SELECT po, body FROM documents WHERE doc_type = '945'").all()) for (const l of J(d.body).lines) w945.push({ po: d.po, ...l });
  const shipQ = new Map(picks.map((p) => [`${p.po}|${p.sku}`, p.qty]));
  const contra = w945.filter((l) => shipQ.get(`${l.po}|${l.sku}`) !== l.shipped);
  eq('planning.945_shipped_agrees_with_every_pick', [contra.length, w945.filter((l) => l.shipped < l.ordered).length], [0, 40]);
  { const asn = new Map(db.prepare("SELECT sl.po, sl.sku, sum(sl.qty) q FROM shipment_lines sl JOIN warehouse_orders w ON w.po = sl.po GROUP BY sl.po, sl.sku").all().map((r) => [`${r.po}|${r.sku}`, r.q]));
    const scan = new Map(db.prepare("SELECT po, json_extract(data,'$.cartons_loaded') n FROM events WHERE kind = 'wms.load_scan'").all().map((r) => [r.po, r.n])); const byPo = new Map(); for (const l of w945) byPo.set(l.po, (byPo.get(l.po) || 0) + l.shipped);
    const short = w945.filter((l) => l.shipped < l.ordered);
    eq('planning.945_short_lines_match_ship_notice_and_load_scan', [short.filter((l) => asn.get(`${l.po}|${l.sku}`) !== l.shipped).map((l) => l.po), short.filter((l) => scan.has(l.po) && scan.get(l.po) !== byPo.get(l.po)).map((l) => l.po)], [[], []]); }

  // ---- order status ----
  none('planning.every_order_at_risk_has_a_status_report', "SELECT e.po FROM events e WHERE e.kind IN ('wms.short_pick','erp.allocation') AND NOT EXISTS (SELECT 1 FROM order_status s WHERE s.po = e.po AND s.state = 'Latest')");
  none('planning.status_report_quantity_is_what_shipped', "SELECT s.po FROM order_status s WHERE s.qty_to_ship <> (SELECT sum(qty) FROM shipment_lines x WHERE x.po = s.po AND x.line = s.line) OR s.qty_ordered <> (SELECT qty_original FROM order_lines l WHERE l.po = s.po AND l.line = s.line)");
  none('planning.status_report_before_the_ship_notice', "SELECT s.po FROM order_status s JOIN shipments x ON x.po = s.po WHERE s.reported_at > x.sent_at");

  // ---- the document flow ----
  none('planning.870_reports_on_its_850', "SELECT d.doc_id FROM documents d WHERE d.doc_type = '870' AND NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = d.doc_id AND l.kind = 'reports on' AND p.doc_type = '850' AND p.po = d.po)");
  none('planning.830_names_the_830_it_supersedes', "SELECT f.forecast_id FROM forecasts f JOIN forecasts p ON p.forecast_id = f.supersedes WHERE NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = f.doc_id AND l.prev_doc_id = p.doc_id AND l.kind = 'supersedes')");
  eq('planning.846_follows_the_previous_from_its_site', n("SELECT count(*) n FROM document_links l JOIN documents d ON d.doc_id = l.doc_id JOIN documents p ON p.doc_id = l.prev_doc_id WHERE d.doc_type = '846' AND p.doc_type = '846' AND l.kind = 'follows' AND json_extract(d.body, '$.parties.WH.gln') = json_extract(p.body, '$.parties.WH.gln')"), count('846') - 4);

  // ---- who sees what ----
  const v = (x, sql) => x.prepare(sql).get().n;
  eq('planning.northfield_sees_830_870_and_ashby_846', [v(nf, "SELECT count(*) n FROM documents WHERE doc_type = '830'"), v(nf, "SELECT count(*) n FROM documents WHERE doc_type = '870'"), v(nf, "SELECT count(*) n FROM documents WHERE doc_type = '846'"),
    v(nf, "SELECT count(*) n FROM documents d JOIN documents a ON a.doc_id = d.answers_doc_id WHERE a.doc_type = '846'"), v(nf, "SELECT count(*) n FROM document_links WHERE doc_id LIKE '846:%' OR prev_doc_id LIKE '846:%'"), v(nf, 'SELECT count(*) n FROM stock_positions'),
    v(nf, 'SELECT count(*) n FROM forecasts'), v(nf, 'SELECT count(*) n FROM order_status')],
  [count('830'), count('870'), ash846, ash846, 2 * ash846 - 2, 0, n('SELECT count(*) n FROM forecasts'), n('SELECT count(*) n FROM order_status')]);
  eq('planning.ashby_sees_all_of_its_own', [v(ash, "SELECT count(*) n FROM documents WHERE doc_type IN ('830','846','870')"), v(ash, 'SELECT count(*) n FROM stock_positions'), v(ash, 'SELECT count(*) n FROM forecast_lines'), v(ash, 'SELECT count(*) n FROM order_status')],
    [n("SELECT count(*) n FROM documents WHERE doc_type IN ('830','846','870')"), n('SELECT count(*) n FROM stock_positions'), n('SELECT count(*) n FROM forecast_lines'), n('SELECT count(*) n FROM order_status')]);

  // ---- the gate: each short-ship judged against the forecast in force and the stock at the pick ----
  // The in-full misses (NF-2.1, OT01) in the world: Kinross short picks (P7 pattern A) and allocation cuts (pattern D).
  const cases = db.prepare("SELECT l.po, l.line FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.supplier_id = 'ASHBY' AND o.po IN (SELECT po FROM events WHERE kind IN ('wms.short_pick','erp.allocation')) ORDER BY o.received_at").all();
  const judged = cases.map((c) => judgeShortShip(db, c.po, c.line));
  const by = {}; for (const j of judged) by[j.outcome] = (by[j.outcome] || 0) + 1;
  ok('planning.short_ships_judged_against_forecast_and_stock', judged.length === 40 && judged.every((j) => j.short_by > 0 && j.forecast_id && j.forecast > 0 && j.stock_at_pick != null && j.outcome !== 'unknown'), JSON.stringify(by));
  // A Kinross short pick had stock below the order at the pick; an allocation cut is judged on its own stock reading.
  { const spj = judged.filter((j) => sp.some((e) => e.po === j.po)); ok('planning.short_picks_were_stock_shortages', spj.length === 31 && spj.every((j) => j.stock_short), JSON.stringify(spj.filter((j) => !j.stock_short).map((j) => j.po))); }
  ok('planning.judgements_differ_by_the_records', Object.keys(by).length >= 2, JSON.stringify(by));
  // The judgement follows the records: on a scratch copy, change the forecast line or the stock position of one case
  // and the verdict changes.
  {
    const s = new DatabaseSync(':memory:'); s.exec(`ATTACH DATABASE '${join(ROOT, 'build', 'tg.db')}' AS m`);
    for (const t of ['orders', 'order_lines', 'shipment_lines', 'forecasts', 'forecast_lines', 'warehouse_orders', 'stock_positions']) s.exec(`CREATE TABLE ${t} AS SELECT * FROM m.${t}`);
    const c = judged.find((j) => j.outcome === 'forecastable') || judged.find((j) => j.stock_short);
    const base = judgeShortShip(s, c.po, c.line).outcome;
    s.prepare('UPDATE forecast_lines SET qty = ? WHERE forecast_id = ? AND sku = ? AND location = ? AND week_start = ?').run(c.over_forecast > 0 ? c.week_ordered + 5 : Math.max(1, c.week_ordered - 5), c.forecast_id, c.sku, c.dc, c.week);
    const afterForecast = judgeShortShip(s, c.po, c.line).outcome;
    s.prepare("UPDATE stock_positions SET available = ? WHERE site = ? AND sku = ? AND as_of = ? AND kind = 'Pick wave'").run(c.wave_needed, c.site, c.sku, c.pick_at);
    const afterStock = judgeShortShip(s, c.po, c.line).outcome;
    s.close();
    eq('planning.judgement_follows_forecast_and_stock_records', [base, afterForecast, afterStock], [c.outcome, c.over_forecast > 0 ? 'forecastable' : 'not_forecastable', 'not_stock']);
  }
}
