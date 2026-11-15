// T1.11: declared keys hold, dated values do not overlap and are read by document date, and every document names the
// document it was created from.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { threeWayMatch } from '../../src/retailer.js';
import { ORIGINS } from '../../world/typed.js';

export default function ({ db, ash, nf, ok, eq, none, n, D, ROOT }) {
  // Declared keys: the main database holds no reference without a row to point at (the build also refuses one).
  eq('model.declared_keys_hold', db.prepare('PRAGMA foreign_key_check').all().length, 0);
  const declared = db.prepare("SELECT count(*) n FROM sqlite_master m, pragma_foreign_key_list(m.name) WHERE m.type = 'table'").get().n;
  ok('model.keys_declared_on_documents_orders_items_locations_parties', declared >= 60, `${declared} declared`);
  // One master per thing: every order line names an item, every store in product activity a location, every ship-from a location.
  none('model.order_lines_name_a_master_item', 'SELECT po, line FROM order_lines WHERE sku NOT IN (SELECT sku FROM items)');
  none('model.store_activity_names_a_store', 'SELECT store FROM store_activity WHERE store NOT IN (SELECT store_number FROM locations WHERE store_number IS NOT NULL)');
  // Dated values: no two versions of the same thing overlap, and the open version is the one the catalogue holds.
  for (const [t, key] of [['rule_versions', 'rule_id'], ['item_versions', 'sku'], ['item_prices', "sku || '|' || price_list"]])
    none(`model.${t}_do_not_overlap`, `SELECT a.${key.includes('|') ? 'sku' : key} FROM ${t} a JOIN ${t} b ON (${key.replaceAll('sku', 'a.sku').replaceAll('price_list', 'a.price_list').replace(/^rule_id$/, 'a.rule_id')}) = (${key.replaceAll('sku', 'b.sku').replaceAll('price_list', 'b.price_list').replace(/^rule_id$/, 'b.rule_id')}) AND a.rowid < b.rowid AND a.valid_from < coalesce(b.valid_to, '9999') AND b.valid_from < coalesce(a.valid_to, '9999')`);
  none('model.rule_in_force_today_is_the_catalogue_rule', "SELECT r.id FROM rules r JOIN rule_versions v ON v.rule_id = r.id AND v.valid_to IS NULL WHERE v.statement <> r.statement OR coalesce(v.params, '') <> coalesce(r.params, '')");
  none('model.every_rule_has_a_version_in_force_now', 'SELECT id FROM rules WHERE id NOT IN (SELECT rule_id FROM rule_versions WHERE valid_to IS NULL)');
  none('model.northfield_2026_1_covers_every_northfield_rule', "SELECT id FROM rules WHERE rule_set = 'northfield-2026.2' AND id NOT IN (SELECT rule_id FROM rule_versions WHERE rule_set = 'northfield-2026.1')");
  // A rule is read by the date of the document it judges: NF-7.11 allowed 1% under guide 2026.1 and 0.5% from 1 August.
  eq('model.rule_read_by_document_date', [D.paramAt(db, 'NF-7.11', 'tolerance', '2026-06-15T15:00:00.000Z'), D.paramAt(db, 'NF-7.11', 'tolerance', '2026-11-10T15:00:00.000Z'), D.ruleAt(db, 'NF-7.11', '2026-07-31T23:59:00.000Z').rule_set, D.ruleAt(db, 'NF-7.11', '2026-08-01T00:00:00.000Z').rule_set], [0.01, 0.005, 'northfield-2026.1', 'northfield-2026.2']);
  // The three-way match judges an invoice with the tolerance in force when it was sent: the same 0.8% variance is
  // inside tolerance on a June invoice and held on a November one. Run on a scratch copy holding one invoice twice.
  {
    const s = new DatabaseSync(':memory:'); s.exec(`ATTACH DATABASE '${join(ROOT, 'build', 'northfield.db')}' AS m`);
    for (const t of ['orders', 'order_lines', 'order_changes', 'invoices', 'invoice_lines', 'shipments', 'shipment_lines', 'receipts', 'rules', 'rule_versions']) s.exec(`CREATE TABLE ${t} AS SELECT * FROM m.${t} WHERE 0`);
    s.exec("INSERT INTO rules SELECT * FROM m.rules; INSERT INTO rule_versions SELECT * FROM m.rule_versions");
    const base = { po: 'NR-T111', when: (m) => `2026-${m}-10T15:00:00.000Z` };
    const judge = (month) => {
      for (const t of ['orders', 'order_lines', 'invoices', 'invoice_lines', 'shipments', 'shipment_lines', 'receipts']) s.exec(`DELETE FROM ${t}`);
      const at = base.when(month);
      s.prepare("INSERT INTO orders (po, supplier_id, retailer_id, programme, stream, ship_to, received_at, requested_delivery, order_value) VALUES (?, 'ASHBY', 'NORTHFIELD', 'Wholesale', 'buyer', 'DC2', ?, ?, 540)").run(base.po, at, at.slice(0, 10));
      s.prepare("INSERT INTO order_lines (po, line, sku, qty_original, qty_ordered, qty_accepted, price, uom, price_original) VALUES (?, 1, 'ASH-MUG-12', 10, 10, 10, 54, 'CA', 54)").run(base.po);
      s.prepare("INSERT INTO shipments (shipment_id, po, doc_id, sent_at, shipped_at, cartons, complete) VALUES ('S1', ?, 'x', ?, ?, 10, 1)").run(base.po, at, at);
      s.prepare("INSERT INTO shipment_lines (shipment_id, po, line, qty) VALUES ('S1', ?, 1, 10)").run(base.po);
      s.prepare("INSERT INTO receipts (receipt, po, shipment_id, received_at, line, qty, short) VALUES ('R1', ?, 'S1', ?, 1, 10, 0)").run(base.po, at);
      s.prepare("INSERT INTO invoices (invoice, po, doc_id, sent_at, total, status) VALUES ('INV-T111', ?, 'x', ?, 544.32, 'Delivered')").run(base.po, at);
      s.prepare("INSERT INTO invoice_lines (invoice, po, line, qty, price) VALUES ('INV-T111', ?, 1, 10, 54.432)").run(base.po);
      return threeWayMatch(s, 'INV-T111', new Date('2026-12-31T00:00:00Z')).lines?.[0]?.origin;
    };
    eq('model.three_way_match_uses_the_tolerance_of_the_invoice_date', [judge('06'), judge('11')], ['matches', 'price: beyond the NF-7.11 tolerance']);
  }
  // Prices and item versions are read as of a date.
  eq('model.price_and_item_read_by_date', [D.priceAt(db, 'ASH-MUG-12', 'Northfield cost', '2026-11-01T12:00:00Z')?.amount, D.itemAt(db, 'ASH-MUG-12', '2026-11-01T12:00:00Z')?.units_per_case, D.priceAt(db, 'AHP-8820', 'Northfield cost', '2026-09-01T12:00:00Z')], [54, 12, null]);
  none('model.northfield_cost_matches_item_master_in_force_now', "SELECT i.sku FROM items i JOIN item_prices p ON p.sku = i.sku AND p.price_list = 'Northfield cost' AND p.valid_to IS NULL WHERE p.amount <> i.case_price");
  // The document flow: every document except an origin names the document it was created from, and that document came first.
  const origins = [...ORIGINS];
  none('model.every_document_names_the_one_before_it', `SELECT doc_id FROM documents d WHERE doc_type NOT IN (${origins.map((o) => `'${o}'`).join(',')}) AND NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = d.doc_id)`);
  none('model.the_document_before_came_first', 'SELECT l.doc_id FROM document_links l JOIN documents a ON a.doc_id = l.doc_id JOIN documents b ON b.doc_id = l.prev_doc_id WHERE b.sent_at > a.sent_at');
  none('model.receiving_advice_follows_its_ship_notice', "SELECT d.doc_id FROM documents d JOIN document_links l ON l.doc_id = d.doc_id AND l.kind = 'receives' JOIN documents p ON p.doc_id = l.prev_doc_id WHERE d.doc_type = '861' AND (p.doc_type <> '856' OR p.reference <> json_extract(d.body, '$.asn_ref'))");
  none('model.every_paid_invoice_links_from_its_remittance', "SELECT r.payment, r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.doc_id WHERE l.prev_doc_id = i.doc_id AND l.kind = 'pays' AND p.reference = r.payment)");
  const flow = D.documentFlow(db, n("SELECT doc_id n FROM documents WHERE doc_type = '820' AND reference = 'PMT-990877'"));
  ok('model.flow_runs_from_payment_back_to_the_order', ['810', '856', '850'].every((t) => flow.created_from.some((x) => x.doc_type === t)), JSON.stringify(flow.created_from.map((x) => x.doc_type)));
  // Typed records read from the event log: one row per event of each kind, nothing lost.
  eq('model.typed_records_match_the_event_log', [n("SELECT count(*) n FROM events WHERE kind = 'erp.shipment_planned'"), n("SELECT count(*) n FROM events WHERE kind LIKE 'wms.%' AND kind <> 'wms.inventory'"), n("SELECT count(*) n FROM events WHERE kind LIKE 'carrier.%'")],
    [n('SELECT count(*) n FROM shipment_plans'), n('SELECT count(*) n FROM warehouse_scans'), n('SELECT count(*) n FROM carrier_events')]);
  // Scoped copies: neither company sees another supplier's master rows or another company's flow.
  eq('model.ashby_sees_no_other_supplier_master', [ash.prepare("SELECT count(*) n FROM items WHERE supplier_id <> 'ASHBY'").get().n, ash.prepare("SELECT count(*) n FROM locations WHERE party_id NOT IN ('NORTHFIELD','ASHBY','KINROSS','LAKELINE')").get().n], [0, 0]);
  eq('model.northfield_flow_holds_no_warehouse_documents', nf.prepare("SELECT count(*) n FROM document_links l JOIN documents d ON d.doc_id = l.doc_id WHERE d.doc_type IN ('940','945')").get().n, 0);
}
