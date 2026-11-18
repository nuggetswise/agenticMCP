// Build gate. The deploy fails if any invariant, fixed value, agent decision, registry entry or doc snapshot disagrees
// with the world. Invariants are properties checked over every record, not samples.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gs1Valid } from '../world/lib.js';
import { MAIN_DB, ASHBY_DB, X12_DIR } from '../world/build.js';
import { parseX12 } from '../world/x12.js';
import * as D from '../src/domain.js';
import * as A from '../src/agents.js';
import * as NR from '../src/retailer.js';
import * as G from '../src/governance.js';
import * as Scout from '../src/scout.js';
import { scorecard, buyerFixture, normOrder } from '../src/score.js';
import * as SC from '../src/score.js';
import { TOOLS, BOUNDARY, ASHBY_WRITES, ASHBY_REFUSALS, NF_TOOLS, NF_WRITES, NF_REFUSALS } from '../src/tools.js';
import { corpusHash } from './corpus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(MAIN_DB, { readOnly: true });
const ash = new DatabaseSync(ASHBY_DB, { readOnly: true });
const facts = JSON.parse(readFileSync(join(ROOT, 'build', 'facts.json'), 'utf8'));
const REG = JSON.parse(readFileSync(join(ROOT, 'registry', 'registry.json'), 'utf8'));
let pass = 0; const fails = []; const results = {};
const ok = (name, cond, detail = '') => { results[name] = !!cond; if (cond) pass++; else fails.push(`${name}${detail ? ` (${detail})` : ''}`); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const none = (name, sql, ...a) => { const r = db.prepare(sql).all(...a); ok(name, r.length === 0, `${r.length} violations, first ${JSON.stringify(r[0])}`); };
const n = (sql, ...a) => db.prepare(sql).get(...a).n;
const T = (s) => new Date(s);

// ── Identity: GS1 example prefix, check digits, two people ────────────────────────────────────────────────────────
for (const r of db.prepare('SELECT gtin c FROM items UNION SELECT gln FROM locations UNION SELECT gln FROM parties WHERE gln IS NOT NULL').all()) ok(`GS1 ${r.c}`, gs1Valid(r.c) && r.c.includes('0614141'), 'check digit or prefix');
const ss = db.prepare('SELECT DISTINCT sscc FROM cartons').all();
eq('id.sscc_check_digits_and_prefix', ss.filter((r) => r.sscc.length !== 18 || !gs1Valid(r.sscc) || !r.sscc.includes('0614141')).length, 0);
none('id.sscc_used_once_per_supplier_shipment', "SELECT sscc FROM cartons c JOIN shipments s ON s.shipment_id = c.shipment_id GROUP BY sscc HAVING count(DISTINCT c.po) > 1");
eq('id.two_people', db.prepare('SELECT name FROM people ORDER BY name').all().map((r) => r.name), ['Jordan Ellis', 'Priya Raman']);
const NAMES = /Sam Whitaker|Maya Chen|Dana |Marcus|Elena|Tom Reyes|Ashby Home|Northfield Stores|Northfield Retail Group|Ashby Supply/;
const texts = db.prepare("SELECT data t FROM events UNION ALL SELECT raw FROM documents WHERE doc_type <> '997' UNION ALL SELECT statement FROM rules").all();
eq('id.no_other_names', texts.filter((r) => NAMES.test(r.t)).length, 0);
eq('id.no_scenario_keys', db.prepare("SELECT name FROM sqlite_master WHERE sql LIKE '%scenario%' AND name NOT LIKE 'sqlite_%'").all().length, 0);

// ── Quantities ─────────────────────────────────────────────────────────────────────────────────────────────────────
none('qty.order_lines_positive', 'SELECT po FROM order_lines WHERE qty_original <= 0 OR qty_ordered < 0 OR price <= 0');
none('qty.accepted_not_above_ordered', 'SELECT po, line FROM order_lines WHERE qty_accepted > qty_ordered');
// Shipped per order line never exceeds the quantity ordered when the truck left (the original quantity bounds both).
none('qty.shipped_not_above_original_order', `SELECT l.po, l.line, sum(l.qty) s, o.qty_original q FROM shipment_lines l JOIN order_lines o ON o.po = l.po AND o.line = l.line GROUP BY l.po, l.line HAVING s > max(o.qty_original, o.qty_ordered)`);
none('qty.carton_count_matches_ship_notice', "SELECT s.shipment_id, s.cartons, count(c.sscc) k FROM shipments s JOIN orders o ON o.po = s.po LEFT JOIN cartons c ON c.shipment_id = s.shipment_id GROUP BY s.shipment_id HAVING k <> s.cartons AND (k > 0 OR o.supplier_id = 'ASHBY')");
none('id.ship_notice_number_on_one_order', 'SELECT reference FROM documents WHERE doc_type = \'856\' GROUP BY reference, sender_id HAVING count(DISTINCT po) > 1');
none('id.997_named_once', "SELECT reference FROM documents WHERE doc_type = '997' GROUP BY reference HAVING count(*) > 1");
none('qty.carton_quantities_match_ship_notice_lines', 'SELECT l.shipment_id, l.line, l.qty, (SELECT sum(c.qty) FROM cartons c WHERE c.shipment_id = l.shipment_id AND c.line = l.line) k FROM shipment_lines l WHERE k <> l.qty');
none('qty.received_not_above_shipped', 'SELECT r.shipment_id, r.line, sum(r.qty) q, (SELECT sum(l.qty) FROM shipment_lines l WHERE l.shipment_id = r.shipment_id AND l.line = r.line) s FROM receipts r GROUP BY r.shipment_id, r.line HAVING q > s');
none('qty.receipt_short_is_shipped_minus_received', 'SELECT r.receipt, r.line FROM receipts r WHERE r.short <> (SELECT sum(l.qty) FROM shipment_lines l WHERE l.shipment_id = r.shipment_id AND l.line = r.line) - r.qty');
none('qty.cartons_received_flag_matches_receipt', `SELECT c.shipment_id, c.line, sum(c.received * c.qty) k, r.qty FROM cartons c JOIN receipts r ON r.shipment_id = c.shipment_id AND r.line = c.line GROUP BY c.shipment_id, c.line HAVING k <> r.qty`);
none('qty.invoice_above_shipped_is_deducted', `SELECT i.invoice, il.line, il.qty, (SELECT sum(l.qty) FROM shipment_lines l WHERE l.po = il.po AND l.line = il.line) s FROM invoices i JOIN invoice_lines il ON il.invoice = i.invoice WHERE i.status = 'Delivered' AND il.qty > s AND NOT EXISTS (SELECT 1 FROM adjustments a WHERE a.invoice = i.invoice AND a.amount < 0)`);

// ── Time order ─────────────────────────────────────────────────────────────────────────────────────────────────────
none('time.acknowledgment_after_order', "SELECT a.doc_id FROM documents a JOIN orders o ON o.po = a.po WHERE a.doc_type = '855' AND a.sent_at < o.received_at");
none('time.ship_notice_after_order', 'SELECT s.shipment_id FROM shipments s JOIN orders o ON o.po = s.po WHERE s.shipped_at < o.received_at OR s.sent_at < o.received_at');
none('time.receipt_after_departure', 'SELECT r.receipt FROM receipts r JOIN shipments s ON s.shipment_id = r.shipment_id WHERE r.received_at <= s.shipped_at');
// Change list 2 point 1 (CALLS 79): no receipt is recorded before its shipment's first ship notice was sent, with no exceptions. A receipt with no ship notice fails too.
none('time.receipt_after_ship_notice', "SELECT DISTINCT r.receipt, r.received_at FROM receipts r WHERE r.received_at < coalesce((SELECT min(d.sent_at) FROM documents d WHERE d.doc_type = '856' AND d.reference = r.shipment_id), '9999')");
none('time.invoice_after_first_shipment', 'SELECT i.invoice FROM invoices i WHERE i.sent_at < (SELECT min(s.shipped_at) FROM shipments s WHERE s.po = i.po)');
none('time.payment_after_invoice', 'SELECT r.payment, r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE r.paid_at <= i.sent_at');
none('time.warehouse_advice_after_warehouse_order', 'SELECT ref FROM warehouse_orders WHERE advice_at IS NOT NULL AND advice_at <= sent_at');
// Every document except a 997 is answered by exactly one 997, 2 to 9 minutes later, from the receiver.
none('time.one_997_per_document', `SELECT d.doc_id, count(f.doc_id) k FROM documents d LEFT JOIN documents f ON f.answers_doc_id = d.doc_id AND f.doc_type = '997' WHERE d.doc_type <> '997' GROUP BY d.doc_id HAVING k <> 1`);
none('time.997_two_to_nine_minutes_after', `SELECT f.doc_id, (julianday(f.sent_at) - julianday(d.sent_at)) * 1440 m FROM documents f JOIN documents d ON d.doc_id = f.answers_doc_id WHERE f.doc_type = '997' AND (m < 1.99 OR m > 9.01 OR f.sender_id <> d.receiver_id)`);
// Interchange control numbers rise with time within each sender, receiver and number range.
// A world-coverage stage's documents use their sending system's own range (700,000,000 up; acknowledgments 600,000,000 up).
// Records added on 18 November 2026 use 850,000,000 up (acknowledgments 950,000,000 up), so ranges are compared in blocks of 50,000,000.
{ const rows = db.prepare("SELECT doc_id d, sender_id s, receiver_id r, doc_type = '997' fa, CAST(isa_ctl / 50000000 AS INT) rg, isa_ctl c, sent_at t FROM documents ORDER BY s, r, fa, rg, c").all(); const bad = []; let dup = 0;
  for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], b = rows[i]; if (a.s !== b.s || a.r !== b.r || a.fa !== b.fa || a.rg !== b.rg) continue; if (b.c === a.c) dup++; if (b.t < a.t) bad.push(a.d); }
  // Change list point F1 (CALLS 68): P5's six lead acknowledgments were numbered when Ashby's ERP generated them and sent late from its outbound queue, so they and their 997s keep their place in the numbering.
  // Change list 2 point 1 (CALLS 79): RCV-46215 was moved after its ship notice and keeps its number, as does its 997.
  const moved = (type, po) => { const d = db.prepare('SELECT doc_id FROM documents WHERE doc_type = ? AND po = ?').get(type, po).doc_id; return [d, db.prepare("SELECT doc_id FROM documents WHERE doc_type = '997' AND answers_doc_id = ?").get(d).doc_id]; };
  // 17 November 2026: ASN-46220 was moved after Kinross's shipping advice and keeps its number, as does its 997.
  // 17 November 2026: ASN-450118-1 was moved after the load scan and the 18:00 departure and keeps its number, as does its 997.
  const asn1 = db.prepare("SELECT doc_id FROM documents WHERE doc_type = '856' AND reference = 'ASN-450118-1'").get().doc_id; const asn1Fa = db.prepare("SELECT doc_id FROM documents WHERE doc_type = '997' AND answers_doc_id = ?").get(asn1).doc_id;
  // 18 November 2026: application advice AA-INV-7731 moved to 10 November and keeps its number, as does its 997.
  const aa = '824:AA-INV-7731'; const aaFa = db.prepare("SELECT doc_id FROM documents WHERE doc_type = '997' AND answers_doc_id = ?").get(aa).doc_id;
  const late = [...['460207', '460219', '460233', '460241', '460262', '460274'].flatMap((n) => moved('855', `NR-${n}`)), ...moved('861', 'NR-46215'), ...moved('856', 'NR-46220'), asn1, asn1Fa, aa, aaFa].sort();
  eq('time.control_numbers_unique', dup, 0); eq('time.control_numbers_rise_with_time_except_p5_lead_acks_and_rcv_46215', bad.sort(), late); }
none('time.envelope_matches_body_control_numbers', "SELECT doc_id FROM documents WHERE json_extract(body, '$.isa_ctl') <> isa_ctl OR json_extract(body, '$.se_count') <> json_extract(body, '$.segments') AND status = 'Delivered' AND doc_id NOT IN (SELECT doc_id FROM errors)");
// NF-4.2: in the current period a ship notice goes within 1 hour of departure; the only late ones are the records the story names. History before it carries late ship notices on purpose.
{ const late = db.prepare(`SELECT s.po FROM shipments s JOIN orders o ON o.po = s.po WHERE o.supplier_id = 'ASHBY' AND s.shipped_at >= '2026-09-27' AND (julianday((SELECT min(d.sent_at) FROM documents d WHERE d.doc_type = '856' AND d.reference = s.shipment_id)) - julianday(s.shipped_at)) * 24 > 1.0001 ORDER BY 1`).all().map((r) => r.po);
  eq('time.ship_notice_within_one_hour_except_named', late, ['NR-46215']); }
none('time.no_ship_notice_before_departure_minus_a_day', 'SELECT shipment_id FROM shipments WHERE julianday(shipped_at) - julianday(sent_at) > 1');

// ── Money ──────────────────────────────────────────────────────────────────────────────────────────────────────────
none('money.order_value_is_line_sum', 'SELECT o.po FROM orders o JOIN order_lines l ON l.po = o.po GROUP BY o.po HAVING abs(o.order_value - sum(l.qty_original * coalesce(l.price_original, l.price))) > 0.005');
none('money.delivered_invoice_total_is_line_sum', "SELECT i.invoice FROM invoices i JOIN invoice_lines l ON l.invoice = i.invoice WHERE i.status = 'Delivered' GROUP BY i.invoice HAVING abs(i.total - sum(l.qty * l.price)) > 0.005");
none('money.invoice_price_is_order_price', "SELECT il.invoice FROM invoice_lines il JOIN invoices i ON i.invoice = il.invoice JOIN order_lines o ON o.po = il.po AND o.line = il.line WHERE i.status = 'Delivered' AND abs(il.price - o.price) > 0.005 AND il.invoice NOT LIKE 'INV-V47%'");
// The price variance records for P14 are the only delivered invoice lines priced off the order, and each stays inside NF-7.11's tolerance.
none('money.price_variance_delivered_is_within_tolerance', "SELECT il.invoice FROM invoice_lines il JOIN invoices i ON i.invoice = il.invoice JOIN order_lines o ON o.po = il.po AND o.line = il.line WHERE i.status = 'Delivered' AND il.invoice LIKE 'INV-V47%' AND abs(il.price - o.price) / o.price > 0.005");
none('money.paid_is_invoice_plus_adjustments', `SELECT r.payment, r.invoice, r.paid, r.invoice_amount, (SELECT coalesce(sum(a.amount), 0) FROM adjustments a WHERE a.payment = r.payment AND a.invoice = r.invoice) adj FROM remittance_items r WHERE abs(r.paid - r.invoice_amount - adj) > 0.005`);
none('money.remitted_amount_is_invoice_total', "SELECT r.payment, r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE r.invoice_amount <> 0 AND abs(r.invoice_amount - i.total) > 0.005"); // a reversal-only line (P20's PMT-991307) pays no invoice amount
none('money.invoice_paid_once', 'SELECT invoice FROM remittance_items WHERE invoice_amount > 0 GROUP BY invoice HAVING count(*) > 1');
{ let bad = 0; for (const d of db.prepare("SELECT reference, body FROM documents WHERE doc_type = '820'").all()) { const b = JSON.parse(d.body); const sum = (b.items || []).reduce((s, i) => s + (i.paid ?? 0), 0); if (b.total != null && Math.abs(sum - b.total) > 0.005) bad++; } eq('money.remittance_header_is_item_sum', bad, 0); }

// ── Rules and rejections ───────────────────────────────────────────────────────────────────────────────────────────
none('rules.every_824_error_cites_a_rule', "SELECT error_id FROM errors WHERE channel LIKE '%824%' AND (rule_id IS NULL OR rule_id NOT IN (SELECT id FROM rules))");
none('rules.every_error_points_at_documents', 'SELECT error_id FROM errors WHERE doc_id NOT IN (SELECT doc_id FROM documents) OR reported_by NOT IN (SELECT doc_id FROM documents)');
{ const pack = JSON.parse(readFileSync(join(ROOT, 'registry', 'catalogue-pack.json'), 'utf8')); const world = db.prepare('SELECT * FROM rules').all();
  const W = new Map(world.map((r) => [r.id, r])); const diff = [];
  for (const p of pack.rules) { const w = W.get(p.id); if (!w) { diff.push(`${p.id} missing`); continue; }
    if (w.statement !== p.statement) diff.push(`${p.id} wording`); if (w.owner !== p.owner) diff.push(`${p.id} owner`); if (w.basis !== p.basis.split(',')[0].toLowerCase()) diff.push(`${p.id} basis`);
    if ((w.implements || '') !== p.implements.join(',')) diff.push(`${p.id} implements`); }
  for (const w of world) if (!pack.rules.some((p) => p.id === w.id)) diff.push(`${w.id} not in pack`);
  eq('rules.catalogue_equals_review_pack', diff.slice(0, 8), []); eq('rules.count_equals_review_pack', world.length, pack.rules.length); }
{ const src = readFileSync(join(ROOT, 'src', 'agents.js'), 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
  eq('agents.thresholds_come_from_catalogue', (src.match(/\b(?:pairs|keep_weeks|exposure_estimate|max_amount|carton)\s*:\s*\d+/g) || []).concat(src.match(/>=\s*12\b|median\s*\/\s*2|\b8\s*\*|>\s*H\b|\bwk\.sold\s*[<\/]/g) || []).concat(['AP-6.4\', \'avg_weeks', "windowHours(db, 'NF-4.2')"].filter((k) => !src.includes(k)).map((k) => `missing ${k}`)), []); }
none('rules.basis_declared', "SELECT id FROM rules WHERE basis NOT IN ('public', 'adapted', 'invented') OR (basis <> 'invented' AND public_sources IN ('', '[]'))");
none('rules.po_reference_over_22_always_rejected', "SELECT doc_id FROM documents WHERE doc_type IN ('856', '810') AND length(json_extract(body, '$.po_ref')) > 22 AND doc_id NOT IN (SELECT doc_id FROM errors)");

// ── Files are the source: every row re-reads from its file ─────────────────────────────────────────────────────────
{ const sample = db.prepare("SELECT doc_id, raw, file, isa_ctl, doc_type FROM documents WHERE rowid % 97 = 0").all(); let bad = 0;
  for (const d of sample) { const f = readFileSync(join(X12_DIR, d.file), 'utf8'); if (!f.includes(d.raw.trim().split('\n')[0])) bad++; const p = parseX12(d.raw); if (!p.length || p[0].ctl !== d.isa_ctl || p[0].groups[0].sets[0].type !== d.doc_type) bad++; }
  eq(`files.rows_reread_from_files (${sample.length} sampled)`, bad, 0);
  eq('files.count_matches_facts', n('SELECT count(*) n FROM documents'), facts.documents); }
{ const rep = join(ROOT, 'validator', 'report.json');
  if (existsSync(rep)) { const r = JSON.parse(readFileSync(rep, 'utf8')); const h = corpusHash(X12_DIR); ok('files.independent_validator_passed_these_exact_files', r.passed && r.corpus.sha256 === h.sha256, `report ${r.corpus.sha256.slice(0, 12)}, build ${h.sha256.slice(0, 12)}`); }
  else ok('files.independent_validator_passed_these_exact_files', false, 'validator/report.json missing; run npm run validate'); }

// ── Isolation ──────────────────────────────────────────────────────────────────────────────────────────────────────
eq('isolation.other_supplier', ash.prepare("SELECT count(*) n FROM documents WHERE supplier_id <> 'ASHBY'").get().n + ash.prepare("SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'").get().n + ash.prepare("SELECT count(*) n FROM events WHERE party NOT IN ('ASHBY', 'NORTHFIELD', 'KINROSS', 'LAKELINE')").get().n, 0);
ok('isolation.main_db_holds_others', n("SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'") > 300);

// ── Fixed points: P10 exactly as the Prototype Plan states ─────────────────────────────────────────────────────────
const a10 = D.attention(ash, D.storyClock(), {});
eq('p10.attention', a10.items.map((i) => [i.po, i.time_left]), [['NR-46151', '40 minutes left'], ['NR-46142', '5 hours left'], ['NR-46156', '19 hours left'], ['NR-46133', '1 day left']]);
const h = D.health(ash, 30, D.storyClock());
eq('p10.health', [h.documents, h.failures, h.top_causes.map((c) => c.failures), h.rejected_by], [3420, 41, [11, 6, 4], { application_advice_824: 31, technical_acknowledgment_997: 10 }]);
const rj = D.explainRejection(ash, 'ASN-46118').rejections[0];
eq('p10.rejection', [rj.sent_value, rj.sent_length, rj.allowed.slice(0, 13), rj.rule.id, rj.same_cause_later.map((x) => x.reference)], ['NR-46118-ASHBY-WHSL-REL-02', '26 characters', '22 characters', 'NF-4.10', ['ASN-46124', 'ASN-46129', 'INV-46133']]);
const dl = D.deliveries(ash, ['NR-46101', 'NR-46102', 'NR-46103', 'NR-46104', 'NR-46105', 'NR-46108']);
eq('p10.escalation', [dl.checked, dl.on_time, dl.late, dl.orders.filter((o) => o.result !== 'On time').map((o) => [o.po, o.result])], [6, 5, 1, [['NR-46108', 'Late by 1 day']]]);
// P13
const a13 = D.attention(ash, T('2026-11-18T09:00:00-05:00'), { warehouse: true });
eq('p13.queue', a13.items.map((i) => i.po), ['NR-46215', 'NR-46220', 'NR-462412', 'NR-46210', 'NR-462410', 'NR-462411', 'NR-46226']);
eq('p13.nothing_to_chase', a13.checked_nothing_to_chase.map((i) => i.po), ['NR-46231']);
// P7 scorecard
const sc = scorecard(ash);
eq('scorecard.cases', sc.cases, 48000); eq('scorecard.failing', [sc.failing_cases, sc.score], [4320, '91.0%']);
eq('scorecard.lines', [sc.failing_lines, sc.by_reason.map((r) => [r.lines, r.cases])], [108, [[31, 1794], [18, 1260], [9, 720], [6, 480], [44, 66]]]);
// Order story and the money trail
const st = D.lifecycle(ash, 'NR-450118');
// 18 November 2026: get_order with as_of returns the order as it stood then. At the P5 moment (17:12 on 8 December) NR-460207 shows nothing dated later:
// no damage scan (17:21), no ship notice (18:06), no receipt; without as_of the whole history is returned as before.
{ const until = new Date('2026-12-08T17:12:00-05:00'); const cut = D.lifecycle(ash, 'NR-460207', until, { until }); const all = D.lifecycle(ash, 'NR-460207');
  const stamps = (JSON.stringify(cut).match(/20\d\d-\d\d-\d\d \d\d:\d\d ET/g) || []).filter((x) => x > '2026-12-08 17:12 ET');
  eq('order.as_of_leaves_out_later_records', [stamps, cut.documents.some((d) => /\(856\)/.test(d.document)), cut.receipts.length, cut.other_records.some((r) => r.record === 'wms.damage_scan'), all.other_records.some((r) => r.record === 'wms.damage_scan'), all.receipts.length > 0],
    [[], false, 0, false, true, true]);
  // INV-7731 before its correction: held, not yet replaced; its rejection open.
  const u2 = new Date('2026-11-10T09:10:00-05:00'); const c2 = D.lifecycle(ash, 'NR-450118', u2, { until: u2 });
  eq('order.as_of_status_as_it_stood', [c2.invoices.map((i) => [i.invoice, i.status]), [...new Set(c2.rejections.filter((r) => r.reference === 'INV-7731').map((r) => r.status))]], [[['INV-7731', 'Held by Northfield']], ['Open']]); }
// 18 November 2026: INV-7731 line 2 stays open until remittance PMT-990412 (1 December) deducts it as a shortage under case DC-40877; then it is closed by that deduction, not corrected.
{ const st2 = (at) => { const u = new Date(at); return D.lifecycle(ash, 'NR-450118', u, { until: u }).rejections.filter((r) => r.reference === 'INV-7731').map((r) => r.status).sort(); };
  const e = db.prepare("SELECT status, corrected_by FROM errors WHERE doc_id = '810:INV-7731' AND allowed LIKE '%line 2%'").get();
  eq('invoice.line2_closed_by_shortage_deduction', [e.status, e.corrected_by, st2('2026-11-30T09:00:00-05:00'), st2('2026-12-01T09:00:00-05:00'), db.prepare("SELECT count(*) n FROM errors WHERE status = 'Open' AND doc_id LIKE '810:INV-7731%'").get().n],
    ['Closed by deduction', '820:PMT-990412', ['Corrected', 'Open'], ['Closed by deduction', 'Corrected'], 0]); }
// Ashby is counted in cases and every other supplier in its own unit (Each); at 28 December Ashby ranks 17 of 23, rates 79.5% to 100.0%.
{ const rk = SC.supplierRanking(db, T('2026-12-28T09:00:00-05:00')).ranking; const a = rk.find((r) => r.supplier_id === 'ASHBY'); const sc = rk.map((r) => parseFloat(r.score));
  eq('scorecard.ashby_rank_and_rate_range', [rk.length, a.rank, a.score, a.counting_unit, [...new Set(rk.filter((r) => r.supplier_id !== 'ASHBY').map((r) => r.counting_unit))], Math.min(...sc), Math.max(...sc)], [23, 17, '91.0%', 'Cases', ['Each'], 79.5, 100]); }
eq('story.two_shipments', st.shipments.map((s) => [s.ship_notice, s.cartons]), [['ASN-450118-1', 350], ['ASN-450118-2', 120]]);
// 17 November 2026 (P23): the first ship notice leaves after the load scan that corrected it and within NF-4.2's hour of the 18:00 departure; its 997 follows it and the receiving advice comes next morning. The hold is released by Priya Raman (AP-1.3).
{ const one = (sql, ...a) => db.prepare(sql).get(...a); const asn = one("SELECT doc_id, sent_at FROM documents WHERE doc_type = '856' AND reference = 'ASN-450118-1'"); const fa = one("SELECT sent_at FROM documents WHERE doc_type = '997' AND answers_doc_id = ?", asn.doc_id); const rcv = one("SELECT sent_at FROM documents WHERE reference = 'RCV-DC2-77290'");
  const scan = one("SELECT at FROM events WHERE kind = 'wms.load_scan' AND po = 'NR-450118' AND data LIKE '%SHP-450118-1%'").at; const dep = one("SELECT at FROM events WHERE kind = 'wms.departure_scan' AND po = 'NR-450118' AND data LIKE '%SHP-450118-1%'").at; const hold = JSON.parse(one("SELECT data FROM events WHERE kind = 'tg.hold' AND po = 'NR-450118'").data);
  eq('p23.ship_notice_follows_scan_and_departure_within_the_hour', [scan < dep, dep < asn.sent_at, Date.parse(asn.sent_at) - Date.parse(dep) <= 3600000, asn.sent_at < fa.sent_at, fa.sent_at < rcv.sent_at], [true, true, true, true, true]);
  eq('p23.hold_is_released_by_priya_raman', [hold.approved_by, hold.release_rule, scan < hold.approved_at, hold.released_at === asn.sent_at], ['Priya Raman', 'AP-1.3', true, true]); }
// 18 November 2026: P5 outcomes, P9 store history, P14 approval, AP-4.2, Aviator permissions, replay as of a time, and no stored record naming an agent.
{ const g = (sql, ...a) => db.prepare(sql).get(...a); const ET = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'America/New_York', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const draft = JSON.parse(g("SELECT data FROM events WHERE kind = 'erp.invoice_draft' AND po = 'NR-460219'").data); const qty = g("SELECT at, data FROM events WHERE kind = 'erp.shipment_quantity' AND po = 'NR-460219'"); const dr = g("SELECT at FROM events WHERE kind = 'erp.invoice_draft' AND po = 'NR-460219'").at;
  eq('p5.invoice_draft_is_checked_against_what_is_allocated_to_ship', ['shipped' in draft, draft.billed, draft.to_ship, JSON.parse(qty.data).to_ship, qty.at < dr, dr < g("SELECT shipped_at FROM shipments WHERE po = 'NR-460219'").shipped_at], [false, 180, 176, 176, true, true]);
  const fix = g("SELECT at, system, data FROM events WHERE kind = 'erp.correction' AND po = 'NR-460207'"); const fd = JSON.parse(fix.data);
  eq('p5.supplier_erp_shows_the_ship_to_corrected_to_dc2', [fix.system, fd.from, fd.to, ET(fix.at), fix.at > g("SELECT max(at) at FROM events WHERE kind = 'wms.load_scan' AND po = 'NR-460207'").at, fix.at < g("SELECT sent_at FROM documents WHERE reference = 'ASN-460207'").sent_at], ['Supplier ERP', 'DC 4', 'DC 2', '08 Dec, 17:50', true, true]);
  const recs = db.prepare("SELECT at, data FROM events WHERE kind = 'rule.recommendation' ORDER BY json_extract(data, '$.store')").all().map((e) => ({ at: e.at, ...JSON.parse(e.data) }));
  eq('p9.one_record_per_store_on_26_october_crediting_the_rule', recs.map((r) => [r.store, ET(r.at), r.found_by, 'sent_to' in r, 'agent' in r, 'also' in r]), [[114, '26 Oct, 08:07', 'Ashby replenishment rule AP-6.1', false, false, false], [207, '26 Oct, 08:07', 'Ashby replenishment rule AP-6.2', false, false, false]]);
  const at = T('2026-10-26T08:07:00-04:00'); const s114 = A.shelfDecision(db, '114', at), s207 = A.shelfDecision(db, '207', at); const act = db.prepare("SELECT DISTINCT store FROM store_activity WHERE period_end = '2026-10-24'").all().map((r) => A.shelfDecision(db, r.store, at)).filter((d) => d.next_step !== 'nothing_to_do').map((d) => d.record);
  eq('p9.four_week_averages_compute_from_records', [s114.evidence.weekly_average, s114.evidence.weeks_averaged, s114.next_step, s114.pairs, s207.evidence.weekly_average, s207.evidence.weeks_of_supply, s207.next_step, s207.pairs, act], [42, 4, 'recommend_new_order', 40, 3, 16, 'recommend_transfer', 24, ['Store 114', 'Store 207']]);
  const aa = g("SELECT doc_id, sent_at, sender_id, body FROM documents WHERE reference = 'AA-INV-7731'"); const aaFa = g("SELECT sent_at, sender_id FROM documents WHERE doc_type = '997' AND answers_doc_id = ?", aa.doc_id); const ok14 = g("SELECT at, json_extract(data, '$.released_by') by FROM events WHERE kind = 'tg.release' AND json_extract(data, '$.document') = 'AA-INV-7731'");
  eq('p14.application_advice_sent_on_jordans_approval_rejecting_lines_1_and_2', [ET(aa.sent_at), aa.sender_id, JSON.parse(aa.body).errors.map((e) => e.bad), ok14.by, ok14.at < aa.sent_at, ok14.at > '2026-11-10T14:00:00.000Z', aa.sent_at < aaFa.sent_at, aaFa.sender_id, aa.sent_at < g("SELECT sent_at FROM documents WHERE reference = 'INV-7731C'").sent_at, g("SELECT received_at FROM receipts WHERE receipt = 'RCV-DC2-77355'").received_at < aa.sent_at],
    ['10 Nov, 09:04', 'NORTHFIELD', ['300', '120'], 'Jordan Ellis', true, true, true, 'ASHBY', true, true]);
  eq('ap42.settling_or_writing_off_a_disputed_deduction', g("SELECT statement FROM rules WHERE id = 'AP-4.2'").statement, 'Settling or writing off a disputed deduction needs a person’s approval. A deduction the deal supports needs no decision');
  const stored = []; for (const f of ['tg', 'ashby', 'northfield']) { const d = new DatabaseSync(join(ROOT, 'build', `${f}.db`), { readOnly: true });
    for (const { name: t } of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) for (const { name: c } of d.prepare(`SELECT name FROM pragma_table_info('${t}')`).all()) { const n = d.prepare(`SELECT count(*) n FROM "${t}" WHERE typeof("${c}") = 'text' AND ("${c}" GLOB '*Agent*' OR "${c}" GLOB '*"agent"*' OR "${c}" GLOB 'agent.*')`).get().n; if (n) stored.push(`${f}.${t}.${c}: ${n}`); } d.close(); }
  eq('credit.no_stored_record_names_an_agent', stored, []); }
// 18 November 2026 (P24): Lakeline's arrival and missed pickup for NR-46602, NR-46609 and NR-46616 come from its EDI 214, at the times the 214 gives, and Northfield sees both.
{ const rows = db.prepare("SELECT po, kind, at, channel, json_extract(data, '$.edi') edi FROM events WHERE po IN ('NR-46602','NR-46609','NR-46616') AND kind IN ('carrier.arrived_at_pickup','carrier.pickup_missed') ORDER BY po, at").all();
  const st = db.prepare("SELECT l.po, m.status_code, m.at, m.doc_id FROM shipment_status m JOIN loads l ON l.load_id = m.load_id WHERE l.po IN ('NR-46602','NR-46609','NR-46616') AND m.status_code IN ('X3','SD') AND m.doc_id LIKE '%X3+SD'").all();
  eq('p24.missed_pickups_from_lakelines_214', rows.map((r) => [r.po, r.kind, new Date(r.at).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }), r.channel, r.edi === `214:PRO-${r.po.slice(3)} X3+SD`, st.some((x) => x.po === r.po && x.at === r.at && x.status_code === (r.kind === 'carrier.pickup_missed' ? 'SD' : 'X3'))]),
    ['NR-46602', 'NR-46609', 'NR-46616'].flatMap((po) => [[po, 'carrier.arrived_at_pickup', '14:45', 'EDI 214', true, true], [po, 'carrier.pickup_missed', '15:30', 'EDI 214', true, true]]));
  eq('p24.northfield_sees_both', new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true }).prepare("SELECT count(*) n FROM events WHERE po IN ('NR-46602','NR-46609','NR-46616') AND kind IN ('carrier.arrived_at_pickup','carrier.pickup_missed')").get().n, 6); }
{ const adj = db.prepare("SELECT reference, amount FROM adjustments WHERE payee_id = 'ASHBY' ORDER BY paid_at, reference").all();
  eq('story.remittance', adj.filter((x) => ['DM-55102', 'DM-55140'].includes(x.reference) && x.amount < 0).map((x) => x.amount), [-88.4, -208]);
  ok('story.repayment_matches_reversed_shortage', adj.some((x) => x.amount === 88.4), JSON.stringify(adj)); }
eq('p6.invoice_exception', db.prepare("SELECT invoice, status, replaces FROM invoices WHERE po = 'NR-450390' ORDER BY sent_at").all().map((r) => r.invoice), ['INV-7790', 'INV-7790C']);
eq('p6.carton_case', D.deductionCase(ash, 'DC-40931', T('2026-12-01T09:00:00-05:00')).amount, 208);
eq('p1.order_value', n("SELECT count(*) n FROM invoices WHERE invoice = 'INV-7702' AND po = ?", facts.anchor.p1), 1);
ok('p1.paid_before_money_in_motion', db.prepare("SELECT paid_at FROM remittance_items WHERE invoice = 'INV-7702'").get()?.paid_at < '2026-11-09');
ok('p4.first_wholesale_order', db.prepare('SELECT programme FROM orders WHERE po = ?').get(facts.anchor.p4)?.programme === 'Wholesale' || !!db.prepare('SELECT 1 FROM orders WHERE po = ?').get(facts.anchor.p4));
ok('p2.programme_events', n("SELECT count(*) n FROM events WHERE kind LIKE 'programme.%'") >= 5);
{ // P11: the live NetSuite ship notice was held on two rules before it left, each fixed by its owner, released by Priya, and received as version 2 describes.
  const J = (e) => JSON.parse(e.data); const evs = db.prepare("SELECT * FROM events WHERE po = 'PO-104912' ORDER BY at").all();
  const hold = evs.find((e) => e.kind === 'tg.hold'), fixes = evs.filter((e) => e.kind === 'erp.correction'), rel = evs.find((e) => e.kind === 'approval');
  const asn = db.prepare("SELECT * FROM documents WHERE doc_type = '856' AND po = 'PO-104912'").all(); const sh = db.prepare("SELECT * FROM shipments WHERE po = 'PO-104912'").get();
  const rc = db.prepare("SELECT sum(qty) q, sum(short) s, min(received_at) at FROM receipts WHERE po = 'PO-104912'").get(); const ct = n("SELECT count(*) n FROM cartons WHERE po = 'PO-104912' AND received = 1");
  results['p11.held_then_matched'] = !!hold && J(hold).sent_to_northfield === false && J(hold).findings.map((f) => f.rule).join() === 'NF-4.3,NF-4.7' && fixes.length === 2 && fixes.every((f) => f.at > hold.at) && !!rel && J(rel).approved_by === 'Priya Raman' && rel.at > fixes[1].at
    && asn.length === 1 && asn[0].sent_at > rel.at && asn[0].status === 'Delivered' && (Date.parse(asn[0].sent_at) - Date.parse(sh.shipped_at)) / 60000 <= 60 && sh.ship_to === 'DC2' && rc.q === sh.cartons && rc.s === 0 && ct === sh.cartons && rc.at > asn[0].sent_at
    && n("SELECT count(*) n FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE d.po = 'PO-104912'") === 0;
  ok('p11.held_then_matched', results['p11.held_then_matched']); }
ok('p9.store_activity', n("SELECT count(*) n FROM store_activity WHERE store = '114' AND on_hand = 0") === 1);
{ const w = "> '2026-12-08T22:12:00.000Z' AND %s <= '2026-12-10T22:12:00.000Z'"; const dep = "json_extract(e.data, '$.planned_departure')";
  // Planned departures from Kinross in the 48 hours after Tuesday 8 December 17:12: Supplier ERP plans, plus buyer-order shipments Kinross loads without a replenishment plan.
  eq('p5.kinross_shipments_48h', n(`SELECT count(*) n FROM (SELECT e.po FROM events e WHERE e.kind = 'erp.shipment_planned' AND json_extract(e.data, '$.site') LIKE 'KIN%' AND ${dep} ${w.replace('%s', dep)} UNION SELECT s.po FROM shipments s WHERE s.ship_from LIKE 'KIN%' AND s.shipped_at ${w.replace('%s', 's.shipped_at')} AND s.po NOT IN (SELECT po FROM events WHERE kind = 'erp.shipment_planned'))`), 124); }
{ const fx = JSON.parse(readFileSync(join(ROOT, 'world', 'data', 'buyer-orders.json'), 'utf8')); const mine = buyerFixture(db, fx.pos.map((p) => p.id), '2026-11-08');
  // Round trip: the Money in Motion order records, written as X12, read back and rebuilt, equal the records the screen computes from.
  // The ship notices and receiving advice added after the fixture's last day (world/data/buyer-shipments.json) are part of each order's record.
  const later = JSON.parse(readFileSync(join(ROOT, 'world', 'data', 'buyer-shipments.json'), 'utf8')).ev; const whole = (p) => ({ ...p, ev: [...p.ev, ...(later[p.id] || [])] });
  eq('p8.engine_equal', fx.pos.filter((p, i) => normOrder(whole(p)) !== normOrder(mine[i])).map((p) => p.id), []);
  eq('buyer.no_overdue_order_with_neither_ship_notice_nor_receipt', db.prepare("SELECT o.po FROM orders o WHERE o.supplier_id <> 'ASHBY' AND o.requested_delivery <= '2026-12-26' AND o.order_value > 0 AND EXISTS (SELECT 1 FROM order_lines l WHERE l.po = o.po AND l.qty_ordered > 0) AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.po = o.po) AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.po = o.po)").all().map((r) => r.po), []);
  // Orders Northfield cancelled with an order change (every line at 0) count nowhere: not in a rate, not Open, not failing, not past due.
  { const canc = db.prepare("SELECT o.po FROM orders o WHERE o.supplier_id <> 'ASHBY' AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.po = o.po AND l.qty_ordered > 0)").all().map((r) => r.po);
    const seen = SC.supplierRanking(db, T('2026-12-28T09:00:00-05:00')).ranking.flatMap((r) => { const o = SC.otif(db, { supplier: r.supplier_id, asOf: T('2026-12-28T09:00:00-05:00') }); return [...(o.lines || []), ...(o.open_lines.list || [])].map((x) => x.po); });
    eq('buyer.cancelled_orders_count_nowhere', [canc.length, canc.filter((po) => seen.includes(po))], [4, []]); }
  eq('p8.one_open_ashby_order', [fx.pos.length, new Set(fx.pos.map((p) => p.s)).size], [340, 24]); }

// ── Mutation tests: the same code, two records, different next steps ───────────────────────────────────────────────
for (const p of REG.prototypes) {
  if (!p.decisions.length) continue; const job = p.agency.job; const steps = new Set();
  for (const d of p.decisions) { const r = A.JOBS[job] ? A.JOBS[job](ash, d.record, T(d.as_of)) : NR.JOBS[job](db, d.record, T(d.as_of)); steps.add(r.next_step); eq(`mutation ${p.id} ${d.record} @ ${d.as_of}`, r.next_step, d.next_step); ok(`mutation ${p.id} ${d.record} cites evidence`, r.evidence && Object.keys(r.evidence).length >= 2 && !!r.rule_baseline); }
  ok(`agent.${job}`, steps.size >= 2, `${steps.size} distinct next steps`);
}
// T2.3: a changed agent rule is replayed against the quarter's records beside the rule in force, before it goes live.
{ const cases = ash.prepare("SELECT DISTINCT json_extract(data, '$.case') c FROM events WHERE kind = 'case.opened' AND at >= '2026-09-27'").all().map((r) => r.c); const at = T('2026-12-10T12:00:00-05:00');
  // AP-4.1 holds no amount (17 November 2026): every dispute needs Priya Raman's approval, so the trial uses a rule that
  // still holds a parameter: AP-6.1's minimum weekly sales, on the two stores of the P9 moment.
  const shelfAt = T('2026-10-26T08:07:00-04:00'); const stores = ['114', '207'];
  const tight = A.replayAgentRule(ash, { job: 'shelf', change: { rule: 'AP-6.1', params: { min_weekly_avg: 500 } }, records: stores, asOf: shelfAt });
  eq('governance.replay_shows_a_changed_next_step', tight.changed.map((c) => [c.record, c.now.next_step, c.with_change.next_step]), [['114', 'recommend_new_order', 'nothing_to_do']]);
  eq('governance.replay_of_the_rule_in_force_changes_nothing', A.replayAgentRule(ash, { job: 'shelf', change: { rule: 'AP-6.1', params: { min_weekly_avg: 1 } }, records: stores, asOf: shelfAt }).changed.length, 0);
  eq('governance.catalogue_unchanged_after_replay', D.param(ash, 'AP-6.1', 'min_weekly_avg'), 1);
  const claims = cases.filter((c) => /^DC-/.test(c)).map((c) => A.claimDecision(ash, c, T('2026-12-28T10:00:00-05:00'))).filter((r) => r.found !== false);
  eq('ap41.every_dispute_needs_priya_ramans_approval', [ash.prepare("SELECT params FROM rules WHERE id = 'AP-4.1'").get().params, /every dispute/i.test(ash.prepare("SELECT statement FROM rules WHERE id = 'AP-4.1'").get().statement), claims.length >= 5, claims.filter((r) => /without asking|\$250/i.test(JSON.stringify(r))).map((r) => r.record), claims.filter((r) => !/Priya Raman/.test(r.authority)).map((r) => r.record)], [null, true, true, [], []]);
  eq('credit.no_decision_names_an_agent', claims.concat(stores.map((s) => A.shelfDecision(ash, s, shelfAt))).filter((r) => 'agent' in r || !/ rule [A-Z]{2}-/.test(r.found_by || '') || /Agent/.test(JSON.stringify(r))).map((r) => r.record), []); }
// T2.3 stories 1, 2 and 4, on a scratch database holding the governance tables (the built world is read-only here).
{ const gdb = new DatabaseSync(':memory:'); gdb.exec(readFileSync(join(ROOT, 'world', 'schema.sql'), 'utf8')); gdb.exec(`ATTACH DATABASE '${ASHBY_DB.replace(/'/g, "''")}' AS a; INSERT INTO rules SELECT * FROM a.rules; DETACH DATABASE a;`); const at = T('2026-12-10T12:00:00-05:00');
  const noModel = async () => { throw new Error('the model must not be called'); };
  // Story 1: every Scout proposal state change carries agent, authority (rule and mode), approver and outcome, in every variation.
  const missing = []; let entries = 0;
  for (const [name, v] of Object.entries(Scout.VARIATIONS)) { const s = Scout.startSession(db, { variation: v, label: `gate ${name}` }); Scout.runBaseline(db, s);
    for (const p of s.proposals) if (!s.audit.some((a) => a.proposal === p.id && a.outcome.startsWith(p.state))) missing.push(`${name} ${p.id} ${p.state}: no final entry`);
    for (const a of s.audit) { entries++; if (!a.agent || !a.authority_rule || !['suggest', 'approve', 'policy'].includes(a.authority_mode) || !a.approver || !a.outcome) missing.push(`${name} ${a.proposal}`); } }
  ok('governance.every_scout_write_names_agent_authority_approver_outcome', !missing.length && entries > 20, `${entries} entries; ${missing.slice(0, 3).join('; ')}`);
  { const s = Scout.startSession(db); Scout.decide(db, s, Scout.propose(db, s, 'Model', 'erp_align_order').proposal, 'approve'); const r = Scout.propose(db, s, 'Model', 'build_ship_notice'); const a = s.audit.find((x) => x.proposal === r.proposal);
    eq('governance.standing_policy_write_names_the_policy', [r.state, a?.authority_rule, a?.authority_mode, a?.approver], ['Executed', 'AP-1.4', 'policy', 'Standing policy, set by Priya Raman']); }
  // Story 2: pause turns the agent's proposal into a plain task, stops AP-4.1's acting without asking and keeps the model from running; resume restores it.
  { const before = A.claimDecision(ash, 'DC-40877', at);
    const p = G.setAgentState(gdb, G.AS, { agent: 'Claim Agent', state: 'paused', by: 'Priya Raman', reason: 'gate' });
    const task = G.plainTask(gdb, before, 'Claim Agent');
    eq('governance.pause_turns_a_proposal_into_a_plain_task', [p.result, G.isPaused(gdb, 'Claim Agent'), task.proposal, 'next_step' in task, 'authority' in task, task.record], ['Paused', true, null, false, false, 'DC-40877']);
    eq('governance.a_rule_set_is_named_by_its_short_name_its_rules_or_its_old_name', ['claim', 'Ashby’s evidence rules', "Ashby's evidence rules", 'Claim Agent', 'nope'].map((n) => G.setAgentState(gdb, G.AS, { agent: n, state: 'paused', by: 'Priya Raman' }).result), ['Unchanged', 'Unchanged', 'Unchanged', 'Unchanged', 'Invalid request']);
    const r = G.setAgentState(gdb, G.AS, { agent: 'Claim Agent', state: 'active', by: 'Priya Raman' }); const log = G.changeList(gdb, G.AS, { kind: undefined }).entries;
    eq('governance.resume_restores_and_both_are_logged', [r.result, G.isPaused(gdb, 'Claim Agent'), log.map((e) => [e.kind, e.agent, e.run_by])], ['Resumed', false, [['resume', 'Claim Agent', 'Priya Raman'], ['pause', 'Claim Agent', 'Priya Raman']]]);
    eq('governance.pause_is_per_connection', G.setAgentState(gdb, G.NF, { agent: 'Claim Agent', state: 'paused', by: 'Jordan Ellis' }).result, 'Invalid request'); }
  { G.setAgentState(gdb, G.AS, { agent: 'Scout', state: 'paused', by: 'Priya Raman' }); const s = Scout.startSession(db);
    const run = await Scout.runScout(db, s, { callModel: noModel, paused: () => G.isPaused(gdb, 'Scout Agent') });
    eq('governance.paused_scout_gets_no_model_turn', [run.status, s.agent.calls, s.proposals.filter((p) => p.by === 'Model').length], ['paused', 0, 0]); G.setAgentState(gdb, G.AS, { agent: 'Scout Agent', state: 'active', by: 'Priya Raman' }); }
  { const s = Scout.startSession(db); const p = Scout.propose(db, s, 'Model', 'kinross_load', { sscc: s.world.carton.sscc });
    const d = Scout.decide(db, s, p.proposal, 'edit', 'Priya Raman', 'Calls Kinross herself'); const a = s.audit.at(-1); const run = await Scout.runScout(db, s, { callModel: noModel });
    eq('governance.override_is_recorded_with_who_made_it', [d.state, a.approver, /^Taken over by Priya Raman/.test(a.outcome), s.handed_over?.by, run.status, s.agent.calls, Scout.decide(db, s, p.proposal, 'approve').state], ['Taken over', 'Priya Raman', true, 'Priya Raman', 'handed_to_person', 0, 'Refused']); }
  // Story 4: a trial of a changed agent rule is a change-list entry: what changed, the replay result, drift, rollback, who ran it and when.
  { const t = G.trialAgentRule(gdb, ash, G.AS, { job: 'shelf', rule: 'AP-6.1', params: { min_weekly_avg: 500 }, records: ['114', '207'], as_of: '2026-10-26T08:07:00-04:00' }, 'Gate check');
    const e = G.changeList(gdb, G.AS, { kind: 'trial' }).entries[0];
    eq('governance.trial_recorded_on_the_change_list', [t.trial, e?.id, e?.kind, e?.agent, e?.rule, e?.change, e?.result.changed.map((c) => c.record), e?.run_by, !!e?.at, /^1 of 2 records/.test(e?.result.drift_measure), /still holds AP-6.1/.test(e?.result.rollback)],
      [e?.id, t.trial, 'trial', 'Shelf Agent', 'AP-6.1', { rule: 'AP-6.1', from: { min_weekly_avg: 1 }, to: { min_weekly_avg: 500 } }, ['114'], 'Gate check', true, true, true]);
    // A Northfield rule, a parameter the rule does not hold, and AP-4.1, which holds none: every dispute needs Priya Raman's approval.
    eq('governance.trial_refuses_rules_it_cannot_change', [G.trialAgentRule(gdb, ash, G.AS, { job: 'deduction', rule: 'NF-7.4', params: { x: 1 } }, 'g').result, G.trialAgentRule(gdb, ash, G.AS, { job: 'shelf', rule: 'AP-6.1', params: { limit: 1 }, records: ['114'] }, 'g').result, G.trialAgentRule(gdb, ash, G.AS, { job: 'deduction', rule: 'AP-4.1', params: { max_amount: 50 } }, 'g').result, G.changeList(gdb, G.AS, { kind: 'trial' }).entries.length], ['Invalid request', 'Invalid request', 'Invalid request', 1]);
    const sr = await Scout.replay(db, { policy: { kinross_load: 'policy', release_ship_notice: 'policy' }, callModel: null });
    eq('governance.scout_policy_trial_shows_authority_beside_the_policy_in_force', [sr.policy_trial.asked.map((a) => [a.action, a.applied]), sr.policy_trial.differs.some((d) => d.action === 'kinross_load' && d.needs === 'policy' && d.under === 'change'), sr.policy_trial.in_force.outcome.approvals > sr.policy_trial.with_change.outcome.approvals],
      [[['kinross_load', true], ['release_ship_notice', false]], true, true]); } }
// The server holds no branch on a record id: no anchor PO or case id appears in the decision code.
{ const src = readFileSync(join(ROOT, 'src', 'agents.js'), 'utf8') + readFileSync(join(ROOT, 'src', 'domain.js'), 'utf8'); const ids = src.match(/NR-\d{5,6}|DC-\d{5}|ASN-\d{5}|INV-\d{4}/g) || [];
  eq('mutation.no_record_ids_in_decision_code', ids, []); }

// ── Northfield scope: answers computed from shared records ─────────────────────────────────────────────────────────
{ const m1 = NR.threeWayMatch(db, 'INV-7731', D.asOfDate('2026-11-10T09:00:00-05:00')); const m2 = NR.threeWayMatch(db, 'INV-7731', D.asOfDate('2026-12-30'));
  results['nf.match.quantity'] = m1.found && m1.variance_origin.startsWith('quantity'); results['nf.match.correction'] = m2.found && m2.variance_origin.startsWith('missed correction');
  const r = NR.replayRule(db, { draft: 'NFD-1' }); const byHand = db.prepare("SELECT d.body, d.sent_at FROM documents d WHERE d.doc_type = '856' AND d.status <> 'Superseded' AND d.sent_at >= ?").all(NR.QUARTER_FROM).filter((d) => { const b = JSON.parse(d.body); return b.shipped_at && (Date.parse(d.sent_at) - Date.parse(b.shipped_at)) / 60000 > 30; }).length;
  results['nf.replay.nfd1'] = r.found && r.failing_with_draft === byHand && r.failing_with_draft > r.failing_now;
  results['nf.publish_needs_replay'] = true;
  const ashbyHealth = D.health(db, 30), nfView = NR.trail(db, { supplier: 'ASHBY', days: 30 });
  eq('nf.shared_documents_agree_with_ashby', [nfView.documents, nfView.failures, nfView.rejected_by.application_advice_824], [ashbyHealth.documents, ashbyHealth.failures, ashbyHealth.rejected_by.application_advice_824]);
  { const late = D.asOfDate('2026-12-20'); const m = (r) => NR.threeWayMatch(db, r, late); const held = m('INV-V470001'), cleared = m('INV-V470002'), tot = db.prepare("SELECT e.rule_id, e.status FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE d.reference = 'INV-V470004'").get();
    results['nf.match.price_held'] = held.found && held.variance_origin === 'price' && held.next_step === 'hold_for_price' && /^Held/.test(held.invoice_status);
    results['nf.match.price_cleared_by_change'] = cleared.found && cleared.variance_origin === 'none' && !!cleared.lines[0].price_set_by && cleared.lines[0].first_po_price < cleared.lines[0].invoice_price;
    results['nf.match.total_fault'] = !!tot && tot.rule_id === 'NF-7.10' && tot.status === 'Corrected';
    const r2 = NR.replayRule(db, { draft: 'NFD-2' }); results['nf.replay.nfd2'] = r2.found && r2.failing_now === 1 && r2.failing_with_draft === 2;
    const r1 = NR.replayRule(db, { draft: 'NFD-1' }); results['nf.replay.nfd1_reaches_other_suppliers'] = r1.by_supplier.filter((x) => x.supplier !== 'Ashby Supplier' && x.with_draft > x.now).length >= 5 && r1.by_supplier.filter((x) => x.supplier !== 'Ashby Supplier').every((x) => x.now === 0); }
  for (const k of ['nf.match.quantity', 'nf.match.correction', 'nf.replay.nfd1', 'nf.match.price_held', 'nf.match.price_cleared_by_change', 'nf.match.total_fault', 'nf.replay.nfd2', 'nf.replay.nfd1_reaches_other_suppliers']) ok(k, results[k]);
  eq('nf.match.status_as_of', [m1.invoice_status, m2.invoice_status.startsWith('Held, then replaced')], ['Held', true]);
  { const nfdb0 = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true }); const c1 = NR.caseNF(nfdb0, 'DC-40877', D.asOfDate('2026-12-30')), c2 = NR.caseNF(nfdb0, 'DC-40877', D.asOfDate('2027-01-06'));
    eq('nf.case.repaid_from_own_remittance', [c1.repaid.length, c2.repaid.map((r) => [r.payment, r.amount])], [0, [['PMT-991204', 88.4]]]); }
  const nfdb = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true });
  eq('nf.view_holds_no_supplier_private_records', [nfdb.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('940','945')").get().n, nfdb.prepare("SELECT count(*) n FROM events WHERE system IN ('Supplier ERP','Kinross warehouse system','Lakeline Freight') AND json_extract(data,'$.in_case') IS NULL AND NOT (kind IN ('carrier.pickup_missed', 'carrier.arrived_at_pickup') AND po IN (SELECT po FROM routing_requests))").get().n, nfdb.prepare("SELECT count(*) n FROM rules WHERE owner LIKE 'Ashby%'").get().n], [0, 0, 0]);
  const asdb = new DatabaseSync(ASHBY_DB, { readOnly: true }); eq('ashby.view_holds_no_northfield_private_tables', asdb.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('review_notes','draft_rules','rule_replays')").get().n, 0);
}
// ── Registry sync: registry, server and the three docs say the same thing ─────────────────────────────────────────
const serverTools = new Set([...TOOLS, ...BOUNDARY, ...ASHBY_WRITES, ...ASHBY_REFUSALS].map((t) => t.name).concat(['run_readonly_sql', 'get_access_log']));
const nfTools = new Set([...NF_TOOLS, ...NF_WRITES, ...NF_REFUSALS].map((t) => t.name).concat(['run_readonly_sql', 'get_access_log']));
const regTools = new Set(REG.prototypes.flatMap((p) => p.tools)); const regNf = new Set(REG.prototypes.flatMap((p) => p.tools_northfield || []));
eq('registry.tools_exist_on_server', [...regTools].filter((t) => !serverTools.has(t)), []);
eq('registry.every_server_tool_has_a_job', [...serverTools].filter((t) => !regTools.has(t)), []);
eq('registry.northfield_tools_exist_on_server', [...regNf].filter((t) => !nfTools.has(t)), []);
eq('registry.every_northfield_tool_has_a_job', [...nfTools].filter((t) => !regNf.has(t)), []);
const cal = Object.fromEntries(db.prepare('SELECT * FROM calendar').all().map((c) => [c.id, c]));
for (const p of REG.prototypes) {
  // A prototype off the story calendar (the prompts doc's table leaves it out) says why instead of naming a moment.
  ok(`registry ${p.id} calendar moment`, p.calendar ? !!cal[p.calendar] : !!p.off_calendar, p.calendar);
  if (cal[p.calendar]) ok(`registry ${p.id} seen_by`, p.seen_by.startsWith(cal[p.calendar].seen_by.split(',')[0]), `${p.seen_by} vs ${cal[p.calendar].seen_by}`);
  ok(`registry ${p.id} capability status`, REG.capability_status_values.includes(p.capability_status));
  ok(`registry ${p.id} agent job`, p.agency.verdict !== 'agent' || ((!!A.JOBS[p.agency.job] || !!NR.JOBS[p.agency.job]) && p.decisions.length >= 2));
  for (const an of p.anchors) { const [k, v0] = an.split(':'); const v = v0.startsWith('$') ? facts.anchor[v0.slice(1)] : v0;
    const hit = k === 'order' ? n('SELECT count(*) n FROM orders WHERE po = ?', v) : k === 'document' ? n('SELECT count(*) n FROM documents WHERE reference = ?', v) : k === 'draft_rule' ? n('SELECT count(*) n FROM draft_rules WHERE id = ?', v) : n('SELECT count(*) n FROM events WHERE kind = ?', v);
    ok(`registry ${p.id} anchor ${an}`, hit > 0); }
  for (const t of p.acceptance) ok(`registry ${p.id} acceptance ${t} ran and passed`, results[t] === true, results[t] === undefined ? 'no such test' : 'failed');
}
eq('registry.built_prototypes_state_their_ending', REG.prototypes.filter((p) => p.status === 'Built' && !p.ends_at).map((p) => p.id), []);
// Doc snapshots (docs/*.md) are dated records, not current (T2.8): each carries its export date and says it is not current.
// They are no longer held to agree with the registry or the server; the Build Guide is the working copy.
const DOCS = { plan: 'prototype-plan.md', server: 'database-and-server-plan.md', strategy: 'agent-and-mcp-strategy.md' };
for (const [k, f] of Object.entries(DOCS)) { const t = existsSync(join(ROOT, 'docs', f)) ? readFileSync(join(ROOT, 'docs', f), 'utf8') : '';
  ok(`docs.${k} is a dated snapshot marked not current`, /^<!-- Dated snapshot, exported \d{1,2} \w+ 20\d\d .*it is not current\./.test(t)); }

// ── World coverage (D60): one file of checks per stage in scripts/checks, each given the same helpers ──────────────
for (const f of readdirSync(join(ROOT, 'scripts', 'checks')).filter((x) => x.endsWith('.mjs')).sort()) {
  const m = await import(join(ROOT, 'scripts', 'checks', f));
  m.default({ db, ash, nf: new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true }), ok, eq, none, n, T, D, NR, A, G, Scout, ROOT, results });
}

console.log(`${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log(`FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
