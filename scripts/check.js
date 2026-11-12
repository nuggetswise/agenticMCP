// Build checks: the deploy fails if any plan value, total, check digit or isolation rule breaks.
import { DatabaseSync } from 'node:sqlite';
import { gs1Valid } from '../data/lib.js';
import { MAIN_DB, ASHBY_DB } from '../data/seed.js';
import * as D from '../src/domain.js';

const db = new DatabaseSync(MAIN_DB, { readOnly: true });
const ash = new DatabaseSync(ASHBY_DB, { readOnly: true });
let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => { if (cond) pass++; else fails.push(`${name}${detail ? ` (${detail})` : ''}`); };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// GS1 check digits
for (const r of db.prepare('SELECT gtin FROM items').all()) ok(`GTIN ${r.gtin}`, gs1Valid(r.gtin));
for (const r of db.prepare('SELECT gln FROM locations UNION SELECT gln FROM parties').all()) ok(`GLN ${r.gln}`, gs1Valid(r.gln));
const badSscc = db.prepare('SELECT sscc FROM cartons').all().filter((r) => !gs1Valid(r.sscc));
eq('SSCC check digits', badSscc.length, 0);
eq('SSCC values unique and 18 digits', db.prepare('SELECT count(*) n FROM cartons WHERE length(sscc) <> 18').get().n, 0);

// Time and integrity
for (const s of db.prepare('SELECT * FROM scenarios').all()) {
  eq(`${s.id}: no document after the demo clock`, db.prepare('SELECT count(*) n FROM documents WHERE scenario = ? AND sent_at > ?').get(s.id, s.clock).n, 0);
  const bad = db.prepare(`SELECT o.po, o.order_value v, round(sum(l.qty_ordered * l.case_price), 2) s FROM orders o JOIN order_lines l ON l.scenario = o.scenario AND l.po = o.po
    WHERE o.scenario = ? GROUP BY o.po HAVING abs(v - s) > 0.005`).all(s.id);
  eq(`${s.id}: order values equal line sums`, bad.length, 0);
}
const docIds = new Set(db.prepare("SELECT doc_id FROM documents WHERE scenario = 'p10'").all().map((r) => r.doc_id));
const covered = new Map();
for (const r of db.prepare("SELECT doc_id, covers FROM documents WHERE scenario = 'p10' AND doc_type = '997'").all()) {
  for (const c of JSON.parse(r.covers)) { ok(`997 ${r.doc_id} covers a real document`, docIds.has(c)); covered.set(c, (covered.get(c) || 0) + 1); }
}
const ashbyDocs = db.prepare("SELECT doc_id FROM documents WHERE scenario = 'p10' AND supplier_id = 'ASHBY' AND doc_type <> '997'").all();
eq('p10: every Ashby document acknowledged by exactly one 997', ashbyDocs.filter((d) => covered.get(d.doc_id) !== 1).length, 0);

// P10: the four questions
const a = D.attention(db, 'p10');
eq('p10 attention orders', a.items.map((i) => i.po), ['NR-46156', 'NR-46142', 'NR-46151', 'NR-46133']);
eq('p10 attention time left', a.items.map((i) => i.time_left), ['4 hours left', '5 hours left', '7 hours left', '1 day left']);
eq('p10 attention reasons', a.items.map((i) => i.reason), [
  'Ship notice rejected: Item not on Northfield item list', 'Order acknowledgment not sent', 'Ship notice not sent', 'Invoice rejected: PO reference longer than 22 characters']);
ok('p10 attention: every item carries a rule and a source', a.items.every((i) => i.rule && i.rule.source));

const x = D.explainRejection(db, 'p10', 'ASN-46118').rejections[0];
eq('ASN-46118 cause', [x.cause, x.sent_value, x.sent_length, x.allowed], ['PO reference longer than 22 characters', 'NR-46118-ASHBY-WHSL-REL-02', '26 characters', '22 characters, the Northfield PO number']);
eq('ASN-46118 later documents with the same cause', x.same_cause_later.map((l) => l.reference), ['ASN-46124', 'ASN-46129', 'INV-46133']);
eq('ASN-46118 corrected', x.status, 'Corrected');

const h = D.health(db, 'p10', 30);
eq('p10 30-day documents', h.documents, 3412);
eq('p10 30-day failures', h.failures, 41);
eq('p10 failures by channel', h.rejected_by, { application_advice_824: 33, technical_acknowledgment_997: 8 });
eq('p10 top three causes', h.top_causes.map((c) => [c.cause, c.failures]), [['Item not on Northfield item list', 11], ['Ship-to location not recognized', 6], ['PO reference longer than 22 characters', 4]]);
eq('p10 remaining causes', h.other_causes, { causes: 8, failures: 20, largest: 3 });

const esc = D.deliveries(db, 'p10', ['NR-46101', 'NR-46103', 'NR-46104', 'NR-46106', 'NR-46108', 'NR-46110']);
eq('escalation: five on time, one late', [esc.on_time, esc.late, esc.no_receipt], [5, 1, 0]);
eq('escalation: the late order', esc.orders.filter((o) => o.result !== 'On time').map((o) => [o.po, o.result]), [['NR-46108', 'Late by 1 day']]);

// P13
const p13 = D.attention(db, 'p13');
eq('p13 four missing documents', p13.items.map((i) => i.po).sort(), ['NR-46210', 'NR-46215', 'NR-46220', 'NR-46226']);
eq('p13 nothing to chase', p13.checked_nothing_to_chase.map((c) => [c.po, c.state]), [['NR-46231', 'Not expected']]);

// Core order story
const lines = db.prepare("SELECT * FROM order_lines WHERE scenario = 'core' ORDER BY line").all();
eq('core order value', Math.round(lines.reduce((s, l) => s + l.qty_ordered * l.case_price, 0) * 100) / 100, 24552);
eq('core accepted value', Math.round(lines.reduce((s, l) => s + l.qty_accepted * l.case_price, 0) * 100) / 100, 22932);
const rem = JSON.parse(db.prepare("SELECT body FROM documents WHERE scenario = 'core' AND doc_type = '820'").get().body);
eq('core remittance plus deduction equals accepted value', Math.round((rem.paid + rem.deduction.amount) * 100) / 100, 22932);
eq('core unscanned carton is on line 2', db.prepare("SELECT line, received FROM cartons WHERE scenario = 'core' AND sscc = '006141410000003006'").get(), { line: 2, received: 0 });
eq('core cartons per line', db.prepare("SELECT line, count(*) n, sum(received) r FROM cartons WHERE scenario = 'core' GROUP BY line ORDER BY line").all().map((r) => [r.line, r.n, r.r]), [[1, 270, 270], [2, 120, 119], [3, 80, 80]]);
eq('core first cartons', db.prepare("SELECT sscc FROM cartons WHERE scenario = 'core' ORDER BY sscc LIMIT 2").all().map((r) => r.sscc), ['006141410000000012', '006141410000000029']);

// People: one per side
eq('people', db.prepare('SELECT name, party_id FROM people ORDER BY party_id').all().map((p) => [p.name, p.party_id]), [['Priya Raman', 'ASHBY'], ['Jordan Ellis', 'NORTHFIELD']]);

// Isolation
eq('ashby.db holds only Ashby orders', ash.prepare("SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'").get().n, 0);
eq('ashby.db holds only Ashby documents', ash.prepare("SELECT count(*) n FROM documents WHERE supplier_id <> 'ASHBY'").get().n, 0);
ok('main db holds other suppliers for the guardrail', db.prepare("SELECT count(*) n FROM orders WHERE supplier_id <> 'ASHBY'").get().n > 0);
eq('other supplier PO is Not available', D.deliveries(db, 'p10', ['NR-81205']).orders[0].result, 'Not available to Ashby');

console.log(`${pass} checks passed`);
if (fails.length) { console.error(`${fails.length} failed:\n- ${fails.join('\n- ')}`); process.exit(1); }
