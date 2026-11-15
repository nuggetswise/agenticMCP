// T1.16: stock transfers into Kinross (943, 944) and carton-level receiving discrepancies (861). Owner's test:
// "Both X12 checks pass, and every discrepancy names its SSCC." The X12 checks run in npm run validate and botscheck.py;
// these checks hold the records to the documents they were read from.
export default function ({ db, ash, nf, ok, eq, none, n }) {
  // ---------- receiving discrepancies ----------
  // Every discrepancy names an SSCC, and that SSCC is on the ship notice the 861 received against (its document-flow link),
  // in the X12 text itself (HL P level, MAN*GM).
  none('warehouse.every_discrepancy_names_an_sscc', "SELECT discrepancy_id FROM receiving_discrepancies WHERE sscc IS NULL OR length(sscc) <> 18");
  none('warehouse.discrepancy_sscc_is_on_the_ship_notice_received_against', `SELECT r.discrepancy_id FROM receiving_discrepancies r JOIN documents a ON a.doc_id = r.ship_notice_doc_id
    WHERE a.doc_type <> '856' OR a.reference <> r.shipment_id OR instr(a.raw, 'MAN*GM*' || r.sscc || '~') = 0
       OR NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = r.receipt_doc_id AND l.prev_doc_id = r.ship_notice_doc_id AND l.kind = 'receives')
       OR NOT EXISTS (SELECT 1 FROM cartons c WHERE c.sscc = r.sscc AND c.shipment_id = r.shipment_id AND c.line = r.line)`);
  none('warehouse.discrepancy_sscc_named_on_the_861_or_found_unreceived', `SELECT r.discrepancy_id FROM receiving_discrepancies r JOIN documents d ON d.doc_id = r.receipt_doc_id
    WHERE NOT (instr(d.raw, 'MAN*GM*' || r.sscc || '~') > 0 AND r.found_by LIKE '861 MAN%') AND NOT (r.found_by LIKE 'Cartons table%' AND (SELECT received FROM cartons c WHERE c.sscc = r.sscc AND c.shipment_id = r.shipment_id) = 0)`);
  // Quantity expected minus received, summed per receipt line, equals the shortage on the 861 (RCD06).
  none('warehouse.expected_minus_received_equals_861_short', `SELECT r.receipt, r.line, r.short, (SELECT sum(x.qty_expected - x.qty_received) FROM receiving_discrepancies x WHERE x.receipt = r.receipt AND x.line = r.line) k
    FROM receipts r WHERE (r.short > 0 AND EXISTS (SELECT 1 FROM cartons c WHERE c.shipment_id = r.shipment_id)) OR EXISTS (SELECT 1 FROM receiving_discrepancies x WHERE x.receipt = r.receipt AND x.line = r.line) GROUP BY r.receipt, r.line HAVING coalesce(k, 0) <> r.short`);
  none('warehouse.every_ashby_shortage_has_its_cartons', "SELECT r.receipt, r.line FROM receipts r JOIN orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY' AND r.short > 0 AND NOT EXISTS (SELECT 1 FROM receiving_discrepancies x WHERE x.receipt = r.receipt AND x.line = r.line)");
  // Shortages that cannot name an SSCC: the ship notice lists no cartons and the 861 names none. All are other suppliers'.
  const noCartons = db.prepare("SELECT o.supplier_id s, count(*) k FROM receipts r JOIN orders o ON o.po = r.po WHERE r.short > 0 AND NOT EXISTS (SELECT 1 FROM cartons c WHERE c.shipment_id = r.shipment_id) GROUP BY 1").all();
  ok('warehouse.shortages_without_an_sscc_are_only_on_ship_notices_without_cartons', noCartons.every((r) => r.s !== 'ASHBY') && n("SELECT count(*) n FROM receipts r WHERE r.short > 0 AND NOT EXISTS (SELECT 1 FROM cartons c WHERE c.shipment_id = r.shipment_id) AND instr((SELECT raw FROM documents WHERE doc_type = '861' AND reference = r.receipt), 'MAN*') > 0") === 0,
    JSON.stringify(noCartons));
  // A dispute settled from the world's own records: the one-case shortage on ASN-450118-2 names the carton Northfield did not scan.
  eq('warehouse.shortage_on_rcv_dc2_77355_names_its_carton', db.prepare("SELECT sscc, line, qty_expected, qty_received, kind FROM receiving_discrepancies WHERE receipt = 'RCV-DC2-77355'").all().map((r) => ({ ...r })),
    [{ sscc: '006141410000003006', line: 2, qty_expected: 1, qty_received: 0, kind: 'Not scanned' }]);

  // ---------- stock transfers ----------
  const transfers = n('SELECT count(*) n FROM stock_transfers');
  ok('warehouse.a_few_transfers', transfers >= 4 && transfers <= 12, `${transfers}`);
  eq('warehouse.transfer_statuses', db.prepare('SELECT status, count(*) k FROM stock_transfers GROUP BY 1 ORDER BY 1').all().map((r) => r.status), ['In transit', 'Received', 'Received short']);
  none('warehouse.944_never_above_943', 'SELECT transfer_order, line FROM transfer_lines WHERE qty_received > qty_shipped OR qty_received < 0');
  none('warehouse.short_944_line_carries_its_exception', "SELECT transfer_order, line FROM transfer_lines WHERE qty_received IS NOT NULL AND (qty_short <> qty_shipped - qty_received OR (qty_short > 0) <> (coalesce(condition_code, '') = '02'))");
  none('warehouse.short_944_has_a_discrepancy_line_in_its_x12', `SELECT l.transfer_order, l.line FROM transfer_lines l JOIN stock_transfers t ON t.transfer_order = l.transfer_order JOIN documents d ON d.doc_id = t.receipt_doc_id
    WHERE l.qty_short > 0 AND instr(d.raw, 'N9*LI*' || l.line || '~' || char(10) || 'W13*' || l.qty_short || '*CA*02~') = 0`);
  none('warehouse.status_follows_the_documents', `SELECT t.transfer_order FROM stock_transfers t WHERE t.status <> CASE WHEN t.receipt_doc_id IS NULL THEN 'In transit'
    WHEN EXISTS (SELECT 1 FROM transfer_lines l WHERE l.transfer_order = t.transfer_order AND l.qty_short > 0) THEN 'Received short' ELSE 'Received' END
    OR t.qty_shipped <> (SELECT sum(qty_shipped) FROM transfer_lines l WHERE l.transfer_order = t.transfer_order) OR coalesce(t.qty_received, -1) <> coalesce((SELECT sum(qty_received) FROM transfer_lines l WHERE l.transfer_order = t.transfer_order), -1)`);
  // prev(): the 943 is an origin (its transfer order is an ERP record, not a document); each 944 links to its 943.
  none('warehouse.944_links_to_its_943', `SELECT t.transfer_order FROM stock_transfers t WHERE t.receipt_doc_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = t.receipt_doc_id AND l.prev_doc_id = t.shipment_doc_id AND l.kind = 'receives transfer')`);
  none('warehouse.transfers_ship_from_ashby_into_kinross', "SELECT t.transfer_order FROM stock_transfers t JOIN locations f ON f.id = t.from_location JOIN locations w ON w.id = t.to_location WHERE f.party_id <> 'ASHBY' OR w.party_id <> 'KINROSS' OR t.received_at <= t.shipped_at");
  // Quantities make sense against what each Kinross site ships: every line is one to three weeks of the site's average
  // weekly 945 shipments of that item over the quarter (13 weeks).
  none('warehouse.transfer_lines_sized_against_945_shipments', `SELECT l.transfer_order, l.line, l.qty_shipped, (SELECT sum(qty) / 13.0 FROM transfer_stock_moves m WHERE m.site = t.to_location AND m.sku = l.sku AND m.kind = 'Shipped (945)') wk
    FROM transfer_lines l JOIN stock_transfers t ON t.transfer_order = l.transfer_order WHERE wk IS NULL OR l.qty_shipped < 0.9 * wk OR l.qty_shipped > 3.1 * wk`);
  // The stock moves add up to the 945s and 944s they were read from.
  none('warehouse.stock_moves_match_945s', `SELECT site, sku, s, k FROM (SELECT w.id site, json_extract(l.value, '$.sku') sku, sum(json_extract(l.value, '$.shipped')) s FROM documents d JOIN locations w ON w.gln = json_extract(d.body, '$.parties.WH.gln') AND w.party_id = 'KINROSS', json_each(json_extract(d.body, '$.lines')) l
    WHERE d.doc_type = '945' AND d.status <> 'Rejected' GROUP BY 1, 2) x LEFT JOIN (SELECT site s2, sku k2, sum(qty) k FROM transfer_stock_moves WHERE kind = 'Shipped (945)' GROUP BY 1, 2) y ON y.s2 = x.site AND y.k2 = x.sku WHERE coalesce(k, -1) <> s`);
  eq('warehouse.stock_moves_match_944s', n("SELECT coalesce(sum(qty), 0) n FROM transfer_stock_moves WHERE kind = 'Transfer received (944)'"), n('SELECT coalesce(sum(qty_received), 0) n FROM transfer_lines'));

  // ---------- who sees what ----------
  eq('warehouse.ashby_sees_its_transfers_and_discrepancies', [ash.prepare('SELECT count(*) n FROM stock_transfers').get().n, ash.prepare('SELECT count(*) n FROM transfer_lines').get().n, ash.prepare('SELECT count(*) n FROM receiving_discrepancies').get().n],
    [transfers, n('SELECT count(*) n FROM transfer_lines'), n("SELECT count(*) n FROM receiving_discrepancies r JOIN orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY'")]);
  eq('warehouse.ashby_sees_no_other_supplier_discrepancy', ash.prepare("SELECT count(*) n FROM receiving_discrepancies r WHERE r.po NOT IN (SELECT po FROM orders WHERE supplier_id = 'ASHBY')").get().n, 0);
  eq('warehouse.northfield_sees_its_receiving_discrepancies', nf.prepare('SELECT count(*) n FROM receiving_discrepancies').get().n, n('SELECT count(*) n FROM receiving_discrepancies'));
  eq('warehouse.northfield_never_sees_943_or_944', [
    nf.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('943','944') OR name LIKE 'Warehouse stock transfer%'").get().n,
    nf.prepare("SELECT count(*) n FROM documents WHERE answers_doc_id LIKE '943:%' OR answers_doc_id LIKE '944:%'").get().n,
    nf.prepare("SELECT count(*) n FROM documents WHERE raw LIKE '%ST*943*%' OR raw LIKE '%ST*944*%' OR raw LIKE '%AK2*943*%' OR raw LIKE '%AK2*944*%'").get().n,
    nf.prepare("SELECT count(*) n FROM document_links WHERE doc_id LIKE '943:%' OR doc_id LIKE '944:%' OR prev_doc_id LIKE '943:%' OR prev_doc_id LIKE '944:%'").get().n,
    nf.prepare('SELECT (SELECT count(*) FROM stock_transfers) + (SELECT count(*) FROM transfer_lines) + (SELECT count(*) FROM transfer_stock_moves) n').get().n], [0, 0, 0, 0, 0]);
}
