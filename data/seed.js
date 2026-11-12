// Builds build/tg.db (all scenarios, all parties) and build/ashby.db (only what Ashby may see, for read-only SQL).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ref from './reference.js';
import { buildP10 } from './scenarios/p10.js';
import { buildP13 } from './scenarios/p13.js';
import { buildCore } from './scenarios/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD = join(ROOT, 'build');
export const MAIN_DB = join(BUILD, 'tg.db');
export const ASHBY_DB = join(BUILD, 'ashby.db');

function insert(db, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const st = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
  for (const r of rows) st.run(...cols.map((c) => {
    const v = r[c];
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }));
}

export function seed() {
  mkdirSync(BUILD, { recursive: true });
  for (const f of [MAIN_DB, ASHBY_DB]) if (existsSync(f)) rmSync(f);
  const db = new DatabaseSync(MAIN_DB);
  db.exec(readFileSync(join(ROOT, 'data', 'schema.sql'), 'utf8'));
  db.exec('BEGIN');
  insert(db, 'parties', ref.parties);
  insert(db, 'people', ref.people);
  insert(db, 'locations', ref.locations);
  insert(db, 'items', ref.items);
  insert(db, 'rules', ref.rules);

  const scenarios = [buildP10(), buildP13(), buildCore()];
  for (const S of scenarios) {
    insert(db, 'scenarios', [{ id: S.meta.id, name: S.meta.name, clock: S.meta.clock, rule_set: S.meta.rule_set, summary: S.meta.summary }]);
    insert(db, 'orders', S.orders);
    insert(db, 'order_lines', S.lines);
    insert(db, 'shipments', S.shipments);
    insert(db, 'documents', S.docs);
    insert(db, 'errors', S.errors);
    insert(db, 'warehouse_orders', S.warehouse);
    insert(db, 'confirmations', S.confirmations);
    insert(db, 'deductions', S.deductions);
    insert(db, 'cartons', S.cartons);
    insert(db, 'scorecards', S.scorecards);
  }
  insert(db, 'connections', [{
    id: 'ashby-assistant', company_id: 'ASHBY', user_name: 'Priya Raman',
    scopes: JSON.stringify(['orders', 'documents', 'errors', 'rules']), read_only: 1,
    configured_by: 'Ashby IT admin', configured_at: scenarios[0].meta.clock.toISOString(),
  }]);
  db.exec('COMMIT');
  db.close();
  buildAshbyView();
  return scenarios;
}

/** A copy holding only Ashby's own records and the reference data Ashby may read. */
function buildAshbyView() {
  const db = new DatabaseSync(ASHBY_DB);
  db.exec(readFileSync(join(ROOT, 'data', 'schema.sql'), 'utf8'));
  db.exec(`ATTACH DATABASE '${MAIN_DB.replace(/'/g, "''")}' AS m`);
  db.exec(`BEGIN;
    INSERT INTO scenarios SELECT * FROM m.scenarios;
    INSERT INTO parties SELECT * FROM m.parties;
    INSERT INTO people SELECT * FROM m.people;
    INSERT INTO locations SELECT * FROM m.locations;
    INSERT INTO items SELECT * FROM m.items WHERE supplier_id = 'ASHBY';
    INSERT INTO rules SELECT * FROM m.rules;
    INSERT INTO orders SELECT * FROM m.orders WHERE supplier_id = 'ASHBY';
    INSERT INTO order_lines SELECT l.* FROM m.order_lines l JOIN m.orders o ON o.scenario = l.scenario AND o.po = l.po WHERE o.supplier_id = 'ASHBY';
    INSERT INTO shipments SELECT s.* FROM m.shipments s JOIN m.orders o ON o.scenario = s.scenario AND o.po = s.po WHERE o.supplier_id = 'ASHBY';
    INSERT INTO documents SELECT * FROM m.documents WHERE supplier_id = 'ASHBY';
    INSERT INTO errors SELECT e.* FROM m.errors e JOIN m.documents d ON d.scenario = e.scenario AND d.doc_id = e.doc_id WHERE d.supplier_id = 'ASHBY';
    INSERT INTO warehouse_orders SELECT * FROM m.warehouse_orders;
    INSERT INTO confirmations SELECT * FROM m.confirmations;
    INSERT INTO deductions SELECT * FROM m.deductions;
    INSERT INTO cartons SELECT * FROM m.cartons;
    INSERT INTO scorecards SELECT * FROM m.scorecards;
    COMMIT;`);
  db.exec('DETACH DATABASE m');
  db.exec('DROP TABLE connections; DROP TABLE access_log;');
  db.exec('VACUUM');
  db.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sc = seed();
  for (const S of sc) console.log(`${S.meta.id}: ${S.orders.length} orders, ${S.docs.length} documents, ${S.errors.length} errors`);
  console.log(`Wrote ${MAIN_DB} and ${ASHBY_DB}`);
}
