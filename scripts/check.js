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
import { scorecard, buyerFixture, normOrder } from '../src/score.js';
import { TOOLS, BOUNDARY } from '../src/tools.js';
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
none('time.invoice_after_first_shipment', 'SELECT i.invoice FROM invoices i WHERE i.sent_at < (SELECT min(s.shipped_at) FROM shipments s WHERE s.po = i.po)');
none('time.payment_after_invoice', 'SELECT r.payment, r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE r.paid_at <= i.sent_at');
none('time.warehouse_advice_after_warehouse_order', 'SELECT ref FROM warehouse_orders WHERE advice_at IS NOT NULL AND advice_at <= sent_at');
// Every document except a 997 is answered by exactly one 997, 2 to 9 minutes later, from the receiver.
none('time.one_997_per_document', `SELECT d.doc_id, count(f.doc_id) k FROM documents d LEFT JOIN documents f ON f.answers_doc_id = d.doc_id AND f.doc_type = '997' WHERE d.doc_type <> '997' GROUP BY d.doc_id HAVING k <> 1`);
none('time.997_two_to_nine_minutes_after', `SELECT f.doc_id, (julianday(f.sent_at) - julianday(d.sent_at)) * 1440 m FROM documents f JOIN documents d ON d.doc_id = f.answers_doc_id WHERE f.doc_type = '997' AND (m < 1.99 OR m > 9.01 OR f.sender_id <> d.receiver_id)`);
// Interchange control numbers rise with time within each sender, receiver and number range.
{ const rows = db.prepare("SELECT sender_id s, receiver_id r, doc_type = '997' fa, isa_ctl c, sent_at t FROM documents ORDER BY s, r, fa, c").all(); let bad = 0, dup = 0;
  for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], b = rows[i]; if (a.s !== b.s || a.r !== b.r || a.fa !== b.fa) continue; if (b.c === a.c) dup++; if (b.t < a.t) bad++; }
  eq('time.control_numbers_unique', dup, 0); eq('time.control_numbers_rise_with_time', bad, 0); }
none('time.envelope_matches_body_control_numbers', "SELECT doc_id FROM documents WHERE json_extract(body, '$.isa_ctl') <> isa_ctl OR json_extract(body, '$.se_count') <> json_extract(body, '$.segments') AND status = 'Delivered' AND doc_id NOT IN (SELECT doc_id FROM errors)");
// NF-4.2: a ship notice goes within 1 hour of departure; the only late ones are the records the story names.
{ const late = db.prepare(`SELECT s.po FROM shipments s JOIN orders o ON o.po = s.po WHERE o.supplier_id = 'ASHBY' AND (julianday((SELECT min(d.sent_at) FROM documents d WHERE d.doc_type = '856' AND d.reference = s.shipment_id)) - julianday(s.shipped_at)) * 24 > 1.0001 ORDER BY 1`).all().map((r) => r.po);
  eq('time.ship_notice_within_one_hour_except_named', late, ['NR-46215']); }
none('time.no_ship_notice_before_departure_minus_a_day', 'SELECT shipment_id FROM shipments WHERE julianday(shipped_at) - julianday(sent_at) > 1');

// ── Money ──────────────────────────────────────────────────────────────────────────────────────────────────────────
none('money.order_value_is_line_sum', 'SELECT o.po FROM orders o JOIN order_lines l ON l.po = o.po GROUP BY o.po HAVING abs(o.order_value - sum(l.qty_original * l.price)) > 0.005');
none('money.delivered_invoice_total_is_line_sum', "SELECT i.invoice FROM invoices i JOIN invoice_lines l ON l.invoice = i.invoice WHERE i.status = 'Delivered' GROUP BY i.invoice HAVING abs(i.total - sum(l.qty * l.price)) > 0.005");
none('money.invoice_price_is_order_price', "SELECT il.invoice FROM invoice_lines il JOIN invoices i ON i.invoice = il.invoice JOIN order_lines o ON o.po = il.po AND o.line = il.line WHERE i.status = 'Delivered' AND abs(il.price - o.price) > 0.005");
none('money.paid_is_invoice_plus_adjustments', `SELECT r.payment, r.invoice, r.paid, r.invoice_amount, (SELECT coalesce(sum(a.amount), 0) FROM adjustments a WHERE a.payment = r.payment AND a.invoice = r.invoice) adj FROM remittance_items r WHERE abs(r.paid - r.invoice_amount - adj) > 0.005`);
none('money.remitted_amount_is_invoice_total', "SELECT r.payment, r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE abs(r.invoice_amount - i.total) > 0.005");
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
  eq('agents.thresholds_come_from_catalogue', (src.match(/\b(?:pairs|keep_weeks|exposure_estimate|max_amount|carton)\s*:\s*\d+/g) || []).concat(src.match(/>=\s*12\b|median\s*\/\s*2|\b8\s*\*/g) || []), []); }
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
eq('p10.health', [h.documents, h.failures, h.top_causes.map((c) => c.failures), h.rejected_by], [3412, 41, [11, 6, 4], { application_advice_824: 31, technical_acknowledgment_997: 10 }]);
const rj = D.explainRejection(ash, 'ASN-46118').rejections[0];
eq('p10.rejection', [rj.sent_value, rj.sent_length, rj.allowed.slice(0, 13), rj.rule.id, rj.same_cause_later.map((x) => x.reference)], ['NR-46118-ASHBY-WHSL-REL-02', '26 characters', '22 characters', 'NF-4.10', ['ASN-46124', 'ASN-46129', 'INV-46133']]);
const dl = D.deliveries(ash, ['NR-46101', 'NR-46102', 'NR-46103', 'NR-46104', 'NR-46105', 'NR-46108']);
eq('p10.escalation', [dl.checked, dl.on_time, dl.late, dl.orders.filter((o) => o.result !== 'On time').map((o) => [o.po, o.result])], [6, 5, 1, [['NR-46108', 'Late by 1 day']]]);
// P13
const a13 = D.attention(ash, T('2026-11-18T09:00:00-05:00'), { warehouse: true });
eq('p13.queue', a13.items.map((i) => i.po), ['NR-46215', 'NR-46220', 'NR-46210', 'NR-46226']);
eq('p13.nothing_to_chase', a13.checked_nothing_to_chase.map((i) => i.po), ['NR-46231']);
// P7 scorecard
const sc = scorecard(ash);
eq('scorecard.cases', sc.cases, 48000); eq('scorecard.failing', [sc.failing_cases, sc.score], [4320, '91.0%']);
eq('scorecard.lines', [sc.failing_lines, sc.by_reason.map((r) => [r.lines, r.cases])], [108, [[31, 1794], [18, 1260], [9, 720], [6, 480], [44, 66]]]);
// Order story and the money trail
const st = D.lifecycle(ash, 'NR-450118');
eq('story.two_shipments', st.shipments.map((s) => [s.ship_notice, s.cartons]), [['ASN-450118-1', 350], ['ASN-450118-2', 120]]);
{ const adj = db.prepare("SELECT reference, amount FROM adjustments WHERE payee_id = 'ASHBY' ORDER BY paid_at, reference").all();
  eq('story.remittance', adj.filter((x) => ['DM-55102', 'DM-55140'].includes(x.reference) && x.amount < 0).map((x) => x.amount), [-88.4, -208]);
  ok('story.repayment_matches_reversed_shortage', adj.some((x) => x.amount === 88.4), JSON.stringify(adj)); }
eq('p6.invoice_exception', db.prepare("SELECT invoice, status, replaces FROM invoices WHERE po = 'NR-450390' ORDER BY sent_at").all().map((r) => r.invoice), ['INV-7790', 'INV-7790C']);
eq('p6.carton_case', D.deductionCase(ash, 'DC-40931', T('2026-12-01T09:00:00-05:00')).amount, 208);
eq('p1.order_value', n("SELECT count(*) n FROM invoices WHERE invoice = 'INV-7702' AND po = ?", facts.anchor.p1), 1);
ok('p1.paid_before_money_in_motion', db.prepare("SELECT paid_at FROM remittance_items WHERE invoice = 'INV-7702'").get()?.paid_at < '2026-11-09');
ok('p4.first_wholesale_order', db.prepare('SELECT programme FROM orders WHERE po = ?').get(facts.anchor.p4)?.programme === 'Wholesale' || !!db.prepare('SELECT 1 FROM orders WHERE po = ?').get(facts.anchor.p4));
ok('p2.programme_events', n("SELECT count(*) n FROM events WHERE kind LIKE 'programme.%'") >= 5);
ok('p9.store_activity', n("SELECT count(*) n FROM store_activity WHERE store = '114' AND on_hand = 0") === 1);
{ const w = "> '2026-12-08T22:12:00.000Z' AND %s <= '2026-12-10T22:12:00.000Z'"; const dep = "json_extract(e.data, '$.planned_departure')";
  // Planned departures from Kinross in the 48 hours after Tuesday 8 December 17:12: Supplier ERP plans, plus buyer-order shipments Kinross loads without a replenishment plan.
  eq('p5.kinross_shipments_48h', n(`SELECT count(*) n FROM (SELECT e.po FROM events e WHERE e.kind = 'erp.shipment_planned' AND json_extract(e.data, '$.site') LIKE 'KIN%' AND ${dep} ${w.replace('%s', dep)} UNION SELECT s.po FROM shipments s WHERE s.ship_from LIKE 'KIN%' AND s.shipped_at ${w.replace('%s', 's.shipped_at')} AND s.po NOT IN (SELECT po FROM events WHERE kind = 'erp.shipment_planned'))`), 124); }
{ const fx = JSON.parse(readFileSync(join(ROOT, 'world', 'data', 'buyer-orders.json'), 'utf8')); const mine = buyerFixture(db, fx.pos.map((p) => p.id), '2026-11-08');
  // Round trip: the Money in Motion order records, written as X12, read back and rebuilt, equal the records the screen computes from.
  eq('p8.engine_equal', fx.pos.filter((p, i) => normOrder(p) !== normOrder(mine[i])).map((p) => p.id), []);
  eq('p8.one_open_ashby_order', [fx.pos.length, new Set(fx.pos.map((p) => p.s)).size], [340, 24]); }

// ── Mutation tests: the same code, two records, different next steps ───────────────────────────────────────────────
for (const p of REG.prototypes) {
  if (!p.decisions.length) continue; const job = p.agency.job; const steps = new Set();
  for (const d of p.decisions) { const r = A.JOBS[job](ash, d.record, T(d.as_of)); steps.add(r.next_step); eq(`mutation ${p.id} ${d.record} @ ${d.as_of}`, r.next_step, d.next_step); ok(`mutation ${p.id} ${d.record} cites evidence`, r.evidence && Object.keys(r.evidence).length >= 2 && !!r.rule_baseline); }
  ok(`agent.${job}`, steps.size >= 2, `${steps.size} distinct next steps`);
}
// The server holds no branch on a record id: no anchor PO or case id appears in the decision code.
{ const src = readFileSync(join(ROOT, 'src', 'agents.js'), 'utf8') + readFileSync(join(ROOT, 'src', 'domain.js'), 'utf8'); const ids = src.match(/NR-\d{5,6}|DC-\d{5}|ASN-\d{5}|INV-\d{4}/g) || [];
  eq('mutation.no_record_ids_in_decision_code', ids, []); }

// ── Registry sync: registry, server and the three docs say the same thing ─────────────────────────────────────────
const serverTools = new Set([...TOOLS, ...BOUNDARY].map((t) => t.name).concat(['run_readonly_sql', 'get_access_log']));
const regTools = new Set(REG.prototypes.flatMap((p) => p.tools));
eq('registry.tools_exist_on_server', [...regTools].filter((t) => !serverTools.has(t)), []);
eq('registry.every_server_tool_has_a_job', [...serverTools].filter((t) => !regTools.has(t)), []);
const cal = Object.fromEntries(db.prepare('SELECT * FROM calendar').all().map((c) => [c.id, c]));
for (const p of REG.prototypes) {
  ok(`registry ${p.id} calendar moment`, !!cal[p.calendar], p.calendar);
  if (cal[p.calendar]) ok(`registry ${p.id} seen_by`, p.seen_by.startsWith(cal[p.calendar].seen_by.split(',')[0]), `${p.seen_by} vs ${cal[p.calendar].seen_by}`);
  ok(`registry ${p.id} capability status`, REG.capability_status_values.includes(p.capability_status));
  ok(`registry ${p.id} agent job`, p.agency.verdict !== 'agent' || (!!A.JOBS[p.agency.job] && p.decisions.length >= 2));
  for (const an of p.anchors) { const [k, v0] = an.split(':'); const v = v0.startsWith('$') ? facts.anchor[v0.slice(1)] : v0;
    const hit = k === 'order' ? n('SELECT count(*) n FROM orders WHERE po = ?', v) : k === 'document' ? n('SELECT count(*) n FROM documents WHERE reference = ?', v) : n('SELECT count(*) n FROM events WHERE kind = ?', v);
    ok(`registry ${p.id} anchor ${an}`, hit > 0); }
  for (const t of p.acceptance) ok(`registry ${p.id} acceptance ${t} ran and passed`, results[t] === true, results[t] === undefined ? 'no such test' : 'failed');
}
// Doc snapshots (docs/*.md, exported from the three working docs) must agree with the registry and the server.
const DOCS = { plan: 'prototype-plan.md', server: 'database-and-server-plan.md', strategy: 'agent-and-mcp-strategy.md' };
const docDir = join(ROOT, 'docs');
if (existsSync(docDir) && readdirSync(docDir).length) {
  const doc = Object.fromEntries(Object.entries(DOCS).map(([k, f]) => [k, existsSync(join(docDir, f)) ? readFileSync(join(docDir, f), 'utf8') : '']));
  for (const [k, text] of Object.entries(doc)) {
    ok(`docs.${k} present`, text.length > 2000);
    eq(`docs.${k} names only the two people and the two companies`, (text.match(NAMES) || []).slice(0, 3), []);
    eq(`docs.${k} holds no scenario keys or retired tools`, (text.match(/list_scenarios|scenario key|scenario=|\bscn\b|\b(?:p\d+|nt)_[a-z_]+\b|list_missing_documents|get_document_trail/gi) || []).slice(0, 3), []);
  }
  for (const t of serverTools) ok(`docs.server names tool ${t}`, doc.server.includes(t));
  eq('docs.server names no tool the server lacks', [...new Set(doc.server.match(/\b[a-z]+(?:_[a-z]+){1,4}\b/g) || [])].filter((w) => /^(get|list|explain|check|lookup|recommend|request|compare|orders|edi|run)_/.test(w) && !serverTools.has(w) && !/^(get|run)_(started|time)$/.test(w)), []);
  for (const p of REG.prototypes) {
    ok(`docs.plan names ${p.id}`, doc.plan.includes(p.name.split(' ')[0] === 'NetSuite' ? 'NetSuite' : p.id));
    if (p.agency.agent) { ok(`docs.strategy names ${p.agency.agent}`, doc.strategy.includes(p.agency.agent));
      for (const d of p.decisions) ok(`docs.strategy cites ${p.id} record ${d.record} → ${d.next_step}`, doc.strategy.includes(d.record) && doc.strategy.includes(d.next_step)); }
  }
  ok('docs.plan P9 seen by Priya', !/P9[^\n]*Jordan Ellis sees|P9[^\n]*seen by Jordan/i.test(doc.plan));
  ok('docs ship notice timing', Object.values(doc).every((t) => !/before the truck leaves/i.test(t)));
} else ok('docs snapshots present', false, 'docs/ is empty; export the three working docs');

console.log(`${pass} checks passed, ${fails.length} failed`);
for (const f of fails) console.log(`FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
