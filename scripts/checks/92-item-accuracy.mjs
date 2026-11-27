// P25 Unknown item on a ship notice (world/stages/item-accuracy.js): the catalogue Northfield receives, the hold on three
// lines with the check each failed, the owners' fixes, the corrected ship notice carrying UPCs Northfield holds, the
// receiving advice line for line, no item accuracy charge, and nothing dated before P22's moment.
import { gs1Valid } from '../../world/lib.js';

export default function ({ db, ash, nf, ok, eq, none, n }) {
  const P22_AT = db.prepare("SELECT as_of FROM calendar WHERE id = 'P22'").get().as_of;
  const cal = db.prepare("SELECT * FROM calendar WHERE id = 'P25'").get();
  eq('p25.calendar_row', [cal?.stage, cal?.seen_by, cal?.anchor, cal?.as_of > P22_AT], ['Fulfillment', 'Priya Raman', 'NR-47300', true]);
  const POS = "('NR-47300','NR-47304','NR-47311','NR-47318')";

  // Nothing this stage adds is dated at or before P22's moment, so no other prototype's moment sees it.
  none('p25.no_record_before_p22', `SELECT doc_id FROM documents WHERE (po IN ${POS} OR reference = 'CAT-ASH-2027-01') AND sent_at <= '${P22_AT}'
    UNION ALL SELECT id FROM events WHERE id BETWEEN 5000001 AND 5999999 AND at <= '${P22_AT}'`);
  none('p25.items_set_up_after_p22', `SELECT sku FROM item_versions WHERE sku IN ('ASH-SHT-M','ASH-SHT-L') AND valid_from <= substr('${P22_AT}', 1, 10)`);

  // The catalogue records Northfield receives: four, each a valid 12-digit UPC under Ashby's prefix, each its own item's.
  const recs = db.prepare('SELECT * FROM catalogue_records ORDER BY item_number').all();
  eq('p25.catalogue_records', recs.map((r) => `${r.item_number} ${r.product} ${r.colour_code} ${r.colour} ${r.size_code} ${r.size}`),
    ['614141000135 Linen napkin 4-pack 260 Ivory 30001 One size', '614141000166 Trail runner 001 Black 50555 11 Medium', '614141000197 Shirt 410 Navy 10970 Medium', '614141000203 Shirt 410 Navy 10975 Large']);
  none('p25.catalogue_upcs_valid', "SELECT item_number FROM catalogue_records WHERE length(item_number) <> 12 OR substr(item_number, 1, 6) <> '614141'");
  eq('p25.catalogue_upcs_check_digit', recs.filter((r) => !gs1Valid(r.item_number)).map((r) => r.item_number), []);
  none('p25.catalogue_upc_is_the_each_level', "SELECT r.sku FROM catalogue_records r WHERE NOT EXISTS (SELECT 1 FROM packaging_levels p WHERE p.sku = r.sku AND p.level = 'Each' AND p.gtin = '00' || r.item_number)");
  eq('p25.shirt_catalogue_accepted', db.prepare("SELECT sku || ' ' || status || ' v' || item_version r FROM item_setup_messages WHERE message = 'CAT-ASH-2027-01' ORDER BY sku").all().map((r) => r.r), ['ASH-NAP-4 Accepted v1', 'ASH-SHT-L Accepted v1', 'ASH-SHT-M Accepted v1', 'ASH-TRL-09 Accepted v1']); // the trail runner and napkin join (26 November 2026)
  eq('p25.x_large_never_published', [n("SELECT count(*) n FROM catalogue_records WHERE item_number = '614141000210'"), n("SELECT count(*) n FROM items WHERE gtin LIKE '%000217'"), n("SELECT count(*) n FROM supplier_item_records WHERE sku = 'ASH-SHT-XL'")], [0, 0, 1]);

  // The hold: three lines, the check each failed, the ordered item, one owner and where to fix it.
  const hold = db.prepare("SELECT at, data FROM events WHERE kind = 'tg.hold' AND po = 'NR-47300'").get(); const h = JSON.parse(hold.data);
  eq('p25.hold_findings', h.findings.map((f) => `${f.line} ${f.check} ${f.sent} ${f.ordered_upc} ${f.rule} ${f.owner} | ${f.fix_in}`), [
    '1 Length 0614141000197 614141000197 GS1-1 EDI operations | Ashby’s ship notice map',
    '2 Published to Northfield 614141000210 614141000203 NF-4.16 Master-data operations | Supplier ERP item mapping',
    '3 Check digit 614141000167 614141000166 GS1-1 Master-data operations | Supplier ERP item master']);
  eq('p25.hold_not_sent_to_northfield', [h.sent_to_northfield, n("SELECT count(*) n FROM documents WHERE po = 'NR-47300' AND doc_type = '856' AND sent_at < ?", hold.at)], [false, 0]);
  // Line values counted short at receiving if the lines went unmatched: computed from the order, not stored on the page.
  eq('p25.money_at_stake', [h.findings.map((f) => f.exposure_estimate), n("SELECT sum(qty_ordered * price) n FROM order_lines WHERE po = 'NR-47300'"), n("SELECT count(*) n FROM cartons WHERE po = 'NR-47300'")], [[4320, 4320, 456], 9096, 60]);
  eq('p25.item_accuracy_rule', db.prepare("SELECT charge_code, charge, basis FROM rules WHERE id = 'NF-4.16'").get() && Object.values(db.prepare("SELECT charge_code, charge, basis FROM rules WHERE id = 'NF-4.16'").get()), ['IA01', '$100 per order plus $1 per carton', 'adapted']);

  // Each owner's fix names its line; the item mapping change carries Priya Raman's confirmation (AP-2.3).
  eq('p25.one_fix_per_line', db.prepare("SELECT json_extract(data, '$.line') l, json_extract(data, '$.rule') r, json_extract(data, '$.confirmed_by') c FROM events WHERE kind = 'erp.correction' AND po = 'NR-47300' ORDER BY at").all().map((x) => `${x.l} ${x.r} ${x.c ?? '-'}`),
    ['1 GS1-1 -', '2 NF-4.16 Priya Raman', '3 GS1-1 -']);

  // The corrected ship notice: every line's UPC (UP) is the catalogue record of the item ordered on that line.
  const asn = db.prepare("SELECT body, raw, sent_at FROM documents WHERE doc_type = '856' AND po = 'NR-47300'").all();
  eq('p25.one_ship_notice_sent', asn.length, 1);
  const lines = JSON.parse(asn[0].body).lines; const held = new Map(recs.map((r) => [r.item_number, r.sku]));
  eq('p25.corrected_lines_carry_held_upcs', lines.map((l) => `${l.line} ${l.sku} ${l.upc} ${held.get(l.upc) === l.sku}`), ['1 ASH-SHT-M 614141000197 true', '2 ASH-SHT-L 614141000203 true', '3 ASH-TRL-09 614141000166 true']);
  eq('p25.up_written_in_x12', (asn[0].raw.match(/\*UP\*\d+/g) || []).length > 0, true);
  none('p25.no_other_document_carries_up', "SELECT doc_id FROM documents WHERE doc_type IN ('850','855','856','810','861','860','865') AND raw LIKE '%*UP*%' AND po <> 'NR-47300'");
  const rel = db.prepare("SELECT at FROM events WHERE kind = 'approval' AND po = 'NR-47300'").get(); const fixed = db.prepare("SELECT max(at) t FROM events WHERE kind = 'erp.correction' AND po = 'NR-47300'").get().t;
  const dep = db.prepare("SELECT at FROM events WHERE kind = 'wms.departure_scan' AND po = 'NR-47300'").get().at;
  eq('p25.released_after_every_fix_and_sent_within_the_hour', [rel.at > fixed, asn[0].sent_at > dep && Date.parse(asn[0].sent_at) - Date.parse(dep) <= 3600000], [true, true]);

  // Northfield's receiving advice matches the ship notice line for line, and no item accuracy charge is raised.
  eq('p25.receipt_matches_line_for_line', db.prepare("SELECT l.line, l.qty FROM shipment_lines l WHERE l.po = 'NR-47300' ORDER BY l.line").all().map((r) => [r.line, r.qty]),
    db.prepare("SELECT line, qty FROM receipts WHERE po = 'NR-47300' AND short = 0 ORDER BY line").all().map((r) => [r.line, r.qty]));
  none('p25.no_item_accuracy_charge', "SELECT data FROM events WHERE (data LIKE '%IA01%' OR kind = 'case.opened' AND po IN " + POS + ") UNION ALL SELECT note FROM adjustments WHERE note LIKE '%IA01%' OR po IN " + POS);

  // Ashby's other open orders for the same items: ordered and acknowledged, not shipped.
  eq('p25.other_open_orders', db.prepare(`SELECT o.po, (SELECT count(*) FROM documents d WHERE d.po = o.po AND d.doc_type = '855') a, (SELECT count(*) FROM shipments s WHERE s.po = o.po) s FROM orders o WHERE o.po IN ${POS} AND o.po <> 'NR-47300' ORDER BY o.po`).all().map((r) => `${r.po} ${r.a} ${r.s}`),
    ['NR-47304 1 0', 'NR-47311 1 0', 'NR-47318 1 0']);

  // Views: Ashby sees its own item records; Northfield sees the catalogue records and none of Ashby's ERP records.
  eq('p25.views', [ash.prepare('SELECT count(*) n FROM catalogue_records').get().n, ash.prepare('SELECT count(*) n FROM supplier_item_records').get().n, nf.prepare('SELECT count(*) n FROM catalogue_records').get().n,
    nf.prepare('SELECT count(*) n FROM supplier_item_records').get().n], [4, 9, 4, 0]);
}
