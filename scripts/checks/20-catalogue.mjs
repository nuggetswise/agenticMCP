// T1.12 Catalogue as evidence: the GS1 hierarchy holds together, every catalogue message carries Northfield's decision
// and links to what it updates, every value is marked in the EDI Review Pack, each company sees only its own catalogue,
// and a pack (NF-4.9, case-label GTIN) and a price question are settled from the catalogue in force at the ship date.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gs1Valid } from '../../world/lib.js';
import { items as REF_ITEMS } from '../../world/ref.js';
import { settlePack, settlePrice, packagingLevels } from '../../world/stages/catalogue.js';

export default function ({ db, ash, nf, ok, eq, none, n, D, ROOT }) {
  const refSkus = REF_ITEMS.map((i) => i.sku); const inRef = `(${refSkus.map((s) => `'${s}'`).join(',')})`;
  // ---------- the hierarchy ----------
  eq('catalogue.every_ref_item_has_a_hierarchy', db.prepare(`SELECT DISTINCT sku FROM packaging_levels ORDER BY sku`).all().map((r) => r.sku), [...refSkus].sort());
  { const bad = db.prepare('SELECT gtin FROM packaging_levels').all().filter((r) => r.gtin.length !== 14 || !gs1Valid(r.gtin) || r.gtin.slice(1, 8) !== '0614141'); eq('catalogue.gtins_valid_gs1_prefix_0614141', bad.map((r) => r.gtin), []); }
  // Unique across the world: a level's GTIN is no other item's GTIN, and the case level in force in the quarter is items.gtin.
  none('catalogue.gtin_unique_across_the_world', `SELECT p.gtin FROM packaging_levels p JOIN items i ON i.gtin = p.gtin WHERE i.sku <> p.sku OR p.level <> 'Case'`);
  none('catalogue.case_gtin_in_force_is_the_item_master_gtin', `SELECT i.sku FROM items i WHERE i.sku IN ${inRef} AND i.gtin <> (SELECT gtin FROM packaging_levels p WHERE p.sku = i.sku AND p.level = 'Case' AND p.valid_from <= '2026-12-26' AND (p.valid_to IS NULL OR p.valid_to > '2026-12-26'))`);
  none('catalogue.each_gtin_is_the_upc_in_product_activity', "SELECT s.sku FROM (SELECT DISTINCT json_extract(value, '$.sku') sku, json_extract(value, '$.upc') upc FROM documents, json_each(json_extract(body, '$.items')) WHERE doc_type = '852') s JOIN packaging_levels p ON p.sku = s.sku AND p.level = 'Each' WHERE '00' || s.upc <> p.gtin");
  none('catalogue.each_level_points_at_the_level_below', "SELECT a.gtin FROM packaging_levels a LEFT JOIN packaging_levels b ON b.gtin = a.child_gtin WHERE (a.level = 'Each') <> (a.child_gtin IS NULL) OR (a.child_gtin IS NOT NULL AND (b.sku <> a.sku OR a.units <> a.child_qty * b.units OR b.valid_from > a.valid_from))");
  none('catalogue.gross_weight_covers_the_contents', "SELECT a.gtin FROM packaging_levels a JOIN packaging_levels b ON b.gtin = a.child_gtin WHERE a.gross_weight < a.child_qty * b.gross_weight");
  none('catalogue.pallet_carries_ti_times_hi', "SELECT gtin FROM packaging_levels WHERE (level = 'Pallet') <> (pallet_ti IS NOT NULL AND pallet_hi IS NOT NULL) OR (level = 'Pallet' AND child_qty <> pallet_ti * pallet_hi)");
  none('catalogue.case_footprint_fits_its_pallet', "SELECT p.gtin FROM packaging_levels p JOIN packaging_levels c ON c.gtin = p.child_gtin WHERE p.level = 'Pallet' AND (p.pallet_ti * c.length * c.width > p.length * p.width OR p.height < p.pallet_hi * c.height)");
  none('catalogue.dimensions_follow_gs1_width_shorter_than_length', "SELECT gtin FROM packaging_levels WHERE width > length OR dim_uom <> 'IN' OR weight_uom <> 'LB'");
  none('catalogue.one_case_level_per_item_at_a_time', "SELECT a.gtin FROM packaging_levels a JOIN packaging_levels b ON a.sku = b.sku AND a.level = 'Case' AND b.level = 'Case' AND a.gtin < b.gtin AND a.valid_from < coalesce(b.valid_to, '9999') AND b.valid_from < coalesce(a.valid_to, '9999') WHERE NOT (a.sku = 'AHP-8820' AND (a.valid_to = '2026-11-23' OR b.valid_to = '2026-11-23'))");
  // Units per case in Northfield's item setup equal the eaches in the case level in force, on every day a version holds.
  none('catalogue.item_version_units_match_the_case_level', "SELECT v.sku, v.version FROM item_versions v WHERE v.sku IN (SELECT sku FROM packaging_levels) AND v.units_per_case <> (SELECT units FROM packaging_levels p WHERE p.sku = v.sku AND p.level = 'Case' AND p.valid_from <= v.valid_from AND (p.valid_to IS NULL OR p.valid_to > v.valid_from) ORDER BY (p.gtin = (SELECT gtin FROM items WHERE sku = v.sku)) DESC LIMIT 1)");
  // The master equals what the messages carried (X12 read back), level by level.
  { const sent = new Map(); for (const d of db.prepare("SELECT body FROM documents WHERE doc_type IN ('832','888')").all()) for (const it of JSON.parse(d.body).items) for (const l of it.levels) sent.set(l.gtin, l);
    const diff = db.prepare('SELECT * FROM packaging_levels').all().filter((p) => sent.has(p.gtin)).filter((p) => { const s = sent.get(p.gtin); return s.level !== p.level || s.sku !== p.sku || s.length !== p.length || s.width !== p.width || s.height !== p.height || s.gross_weight !== p.gross_weight || (s.child_qty ?? null) !== p.child_qty || (s.pallet_ti ?? null) !== p.pallet_ti; });
    eq('catalogue.master_equals_the_levels_sent_in_832_and_888', diff.map((p) => p.gtin), []); }

  // ---------- the messages and Northfield's decisions ----------
  eq('catalogue.documents', db.prepare("SELECT doc_type, reference, sender_id, receiver_id, status FROM documents WHERE doc_type IN ('832','888','879') ORDER BY sent_at").all().map((r) => `${r.doc_type} ${r.reference} ${r.sender_id}>${r.receiver_id} ${r.status}`),
    ['832 CAT-ASH-2026-01 ASHBY>NORTHFIELD Delivered', '888 IM-ASH-2026-12-29 ASHBY>NORTHFIELD Delivered', '879 PL-ASH-2027-02 ASHBY>NORTHFIELD Delivered']);
  none('catalogue.every_message_line_has_a_northfield_decision', "SELECT message, sku FROM item_setup_messages WHERE decided_by IS NULL OR decided_at IS NULL OR status NOT IN ('Accepted','Not accepted','Returned') OR decided_at < sent_at");
  none('catalogue.every_accepted_ashby_version_has_its_accepted_message', "SELECT v.sku, v.version FROM item_versions v JOIN items i ON i.sku = v.sku AND i.supplier_id = 'ASHBY' AND i.sku IN " + inRef + " WHERE v.accepted_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_setup_messages m WHERE m.sku = v.sku AND m.status = 'Accepted' AND m.decided_at = v.accepted_at AND (m.item_version IS NULL OR m.item_version = v.version))");
  none('catalogue.item_not_on_the_list_is_not_accepted', "SELECT m.sku FROM item_setup_messages m JOIN items i ON i.sku = m.sku WHERE i.on_northfield_list = 0 AND m.status = 'Accepted'");
  // AHP-8820 (P4, P11): the case of 12 Ashby submitted on 27 Sep was returned with "Case of 6 required", the case of 6
  // was accepted on 24 Nov when the programme was activated, and the trade test's failed pack (12) is the returned case.
  eq('catalogue.ahp_8820_conflict_is_evidence', db.prepare("SELECT channel || ' ' || substr(sent_at, 1, 10) || ' ' || units_per_case || ' ' || status || coalesce(' v' || item_version, '') r FROM item_setup_messages WHERE sku = 'AHP-8820' ORDER BY sent_at").all().map((r) => r.r),
    ['Trading Grid item setup 2026-09-27 12 Returned', 'Trading Grid item setup 2026-11-23 6 Accepted v2', 'EDI 888 2026-12-29 6 Accepted v2']);
  { const act = db.prepare("SELECT at FROM events WHERE kind = 'programme.activated' AND json_extract(data, '$.programme') = 'Wholesale, item AHP-8820'").get()?.at; const v2 = D.itemAt(db, 'AHP-8820', '2026-11-30T20:00:00Z');
    const failed = db.prepare("SELECT json_extract(data, '$.pack_sent') p FROM events WHERE kind = 'test.ship_notice' AND json_extract(data, '$.result') = 'Failed' AND po = 'PO-104728'").get()?.p;
    const returned = db.prepare("SELECT units_per_case u FROM item_setup_messages WHERE sku = 'AHP-8820' AND status = 'Returned'").get()?.u;
    eq('catalogue.ahp_8820_accepted_when_the_programme_was_activated', [v2?.accepted_at, v2?.units_per_case, D.itemAt(db, 'AHP-8820', '2026-10-01T12:00:00Z')?.accepted_by ?? null, failed === returned], [act, 6, null, true]); }
  // The 27 Sep conflict event is about ASH-NAP-4's Marketplace GTIN: the wholesale GTIN it names is the case level, and
  // the Marketplace GTIN (another company prefix) is not in Northfield's catalogue.
  { const c = db.prepare("SELECT data FROM events WHERE kind = 'catalogue.item_conflict'").get(); const x = JSON.parse(c.data);
    eq('catalogue.item_conflict_event_agrees_with_the_hierarchy', [x.sku, db.prepare('SELECT level FROM packaging_levels WHERE gtin = ?').get(x.wholesale_gtin)?.level, n('SELECT count(*) n FROM packaging_levels WHERE gtin = ?', x.marketplace_gtin)], ['ASH-NAP-4', 'Case', 0]); }
  // Versions and prices the stage added equal what the 888 and 879 carried.
  { const im = JSON.parse(db.prepare("SELECT body FROM documents WHERE doc_type = '888'").get().body); const pi = JSON.parse(db.prepare("SELECT body FROM documents WHERE doc_type = '879'").get().body);
    eq('catalogue.versions_and_prices_equal_their_messages', [im.items.map((it) => [it.levels.find((l) => l.level === 'Case').gtin, it.levels.find((l) => l.level === 'Case').child_qty, D.itemAt(db, it.levels[0].sku, `${it.first_ship}T12:00:00Z`)?.units_per_case]), pi.items.map((it) => [it.sku, it.cost, D.priceAt(db, it.sku, 'Northfield cost', `${it.first_order}T12:00:00Z`)?.amount])],
      [[['10614141000187', 6, 6], ['20614141000146', 6, 6]], [['ASH-MUG-12', 55.62, 55.62], ['ASH-HNY-340', 23.4, 23.4]]]); }
  // Current-quarter prices stand: every invoice in the world is priced at the cost in force when it was sent.
  none('catalogue.quarter_invoices_priced_at_the_cost_in_force', `SELECT i.invoice, l.line FROM invoices i JOIN invoice_lines l ON l.invoice = i.invoice JOIN order_lines o ON o.po = l.po AND o.line = l.line WHERE o.sku IN ${inRef} AND i.status NOT LIKE 'Held%' AND l.price <> (SELECT amount FROM item_prices p WHERE p.sku = o.sku AND p.price_list = 'Northfield cost' AND p.valid_from <= i.sent_at AND (p.valid_to IS NULL OR p.valid_to > i.sent_at))`);

  // ---------- the document flow ----------
  eq('catalogue.flow_888_and_879_link_to_the_catalogue', db.prepare("SELECT d.doc_type, l.kind, p.doc_type pt, p.reference FROM document_links l JOIN documents d ON d.doc_id = l.doc_id JOIN documents p ON p.doc_id = l.prev_doc_id WHERE d.doc_type IN ('832','888','879') ORDER BY d.sent_at").all().map((r) => `${r.doc_type} ${r.kind} ${r.pt} ${r.reference}`),
    ['888 updates catalogue 832 CAT-ASH-2026-01', '879 reprices catalogue 832 CAT-ASH-2026-01']);
  // P10's window and the numbering: catalogue documents sit before the history range and after the quarter.
  none('catalogue.no_catalogue_document_in_p10_window', "SELECT doc_id FROM documents WHERE doc_type IN ('832','888','879') AND sent_at > '2026-10-18T15:00:00Z' AND sent_at <= '2026-11-17T16:00:00Z'");

  // ---------- views ----------
  eq('catalogue.ashby_sees_only_its_own_catalogue', [ash.prepare("SELECT count(*) n FROM packaging_levels WHERE supplier_id <> 'ASHBY'").get().n, ash.prepare("SELECT count(*) n FROM item_setup_messages WHERE supplier_id <> 'ASHBY'").get().n,
    ash.prepare('SELECT count(*) n FROM packaging_levels').get().n, ash.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('832','888','879')").get().n], [0, 0, n("SELECT count(*) n FROM packaging_levels WHERE supplier_id = 'ASHBY'"), 3]);
  eq('catalogue.northfield_sees_every_catalogue', [nf.prepare('SELECT count(*) n FROM packaging_levels').get().n, nf.prepare('SELECT count(*) n FROM item_setup_messages').get().n, nf.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('832','888','879')").get().n],
    [n('SELECT count(*) n FROM packaging_levels'), n('SELECT count(*) n FROM item_setup_messages'), 3]);

  // ---------- the EDI Review Pack marks every value ----------
  { const pack = JSON.parse(readFileSync(join(ROOT, 'registry', 'catalogue-pack.json'), 'utf8')).catalogue || {};
    const fields = ['gtin', 'level', 'child_qty', 'length', 'width', 'height', 'gross_weight', 'pallet_ti', 'pallet_hi', 'packaging_code', 'valid_from', 'item_versions', 'item_prices', 'segments'];
    const missing = fields.filter((f) => !pack.values?.some((v) => v.field === f && v.basis && (v.basis === 'Invented' ? v.why : v.links?.length)));
    eq('catalogue.every_value_cited_or_marked_invented_in_the_pack', missing, []);
    eq('catalogue.pack_basis_matches_the_master', [...new Set(packagingLevels().map((l) => l.basis))], ['Invented']); }

  // ---------- gate: settle a pack, case-label GTIN and price question from the catalogue in force ----------
  // Pack and case label, the first live AHP-8820 ship notice (P11): at its ship date version 2 (case of 6, accepted
  // 24 Nov) is in force and the notice's case GTIN is that case, so no NF-4.9 charge; read against the catalogue of
  // 20 Nov, version 1 had not been accepted, so the same notice would have been held.
  { const at = settlePack(db, 'ASN-78260'); const before = settlePack(db, 'ASN-78260', '2026-11-20T12:00:00.000Z');
    eq('catalogue.gate_ahp_8820_pack_settled_at_ship_date', [at.decision, at.lines[0].item_version, at.lines[0].units_in_gtin, before.decision, before.lines[0].item_version], ['No charge', 2, 6, 'Held: the item version in force was not accepted by Northfield', 1]); }
  // A real December honey ship notice: at its ship date the case of 12 is the case in force, no charge; read against the
  // catalogue of 1 February 2027 (888: case of 6, new GTIN) the same notice carries a retired case GTIN with 12 units: NF-4.9.
  { const s = db.prepare("SELECT s.shipment_id FROM shipments s JOIN shipment_lines l ON l.shipment_id = s.shipment_id JOIN orders o ON o.po = s.po WHERE l.sku = 'ASH-HNY-340' AND o.supplier_id = 'ASHBY' AND s.shipped_at >= '2026-12-01' ORDER BY s.shipped_at, s.shipment_id LIMIT 1").get().shipment_id;
    const at = settlePack(db, s); const later = settlePack(db, s, '2027-02-01T12:00:00.000Z');
    eq('catalogue.gate_honey_pack_flips_with_the_version_in_force', [at.decision, later.decision, later.rule, later.charge, later.lines.find((l) => l.sku === 'ASH-HNY-340').units_in_gtin, later.lines.find((l) => l.sku === 'ASH-HNY-340').units_per_case_set_up], ['No charge', 'Charge', 'NF-4.9', '$150 per ship notice', 12, 6]); }
  // A real December mug invoice: priced at the cost in force on its ship date; read against the cost from 1 February
  // 2027 (879) it is 2.9% off, beyond NF-7.11's 0.5%, and would be held.
  { const r = db.prepare("SELECT i.invoice, l.line FROM invoices i JOIN invoice_lines l ON l.invoice = i.invoice JOIN order_lines o ON o.po = l.po AND o.line = l.line JOIN orders od ON od.po = i.po WHERE o.sku = 'ASH-MUG-12' AND od.supplier_id = 'ASHBY' AND i.sent_at >= '2026-12-01' AND i.status = 'Delivered' ORDER BY i.sent_at, i.invoice LIMIT 1").get();
    const at = settlePrice(db, r.invoice, r.line); const later = settlePrice(db, r.invoice, r.line, '2027-02-01T12:00:00.000Z');
    eq('catalogue.gate_price_flips_with_the_cost_in_force', [at.decision, at.catalogue_cost, later.decision, later.catalogue_cost, later.variance], ['Matches the catalogue cost in force', 54, 'Held: beyond the NF-7.11 tolerance of the catalogue cost in force', 55.62, 0.0291]); }
  // Over the whole world: no Ashby ship notice of a catalogue item draws an NF-4.9 charge at its ship date (none was
  // ever charged), and no invoice line is off the catalogue cost in force when its goods shipped.
  { const ships = db.prepare(`SELECT DISTINCT s.shipment_id FROM shipments s JOIN shipment_lines l ON l.shipment_id = s.shipment_id JOIN orders o ON o.po = s.po WHERE o.supplier_id = 'ASHBY' AND l.sku IN ${inRef}`).all();
    const bad = ships.map((r) => settlePack(db, r.shipment_id)).filter((x) => x.decision !== 'No charge');
    eq('catalogue.every_ashby_ship_notice_settles_without_charge', bad.slice(0, 3).map((x) => `${x.shipment} ${x.decision}`), []);
    ok('catalogue.settled_over_many_ship_notices', ships.length > 1500, `${ships.length}`); }
}
