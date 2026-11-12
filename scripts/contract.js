// Contract test: every record number, person, company and rule a built screen shows must exist in the world.
// Screen sources are fetched from the published prototypes into contract/screens/<id>.html (not committed);
// curated numbers per prototype live in contract/claims.json. Reports per prototype; exit 1 on any difference.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MAIN_DB } from '../world/build.js';
import { buyerFixture, normOrder } from '../src/score.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.env.SCREENS || join(ROOT, 'contract', 'screens');
const db = new DatabaseSync(MAIN_DB, { readOnly: true });
const CLAIMS = JSON.parse(readFileSync(join(ROOT, 'contract', 'claims.json'), 'utf8'));
const has = (sql, v) => !!db.prepare(sql).get(v);
const known = {
  po: (v) => has('SELECT 1 FROM orders WHERE po = ?', v),
  doc: (v) => has('SELECT 1 FROM documents WHERE reference = ?', v) || has('SELECT 1 FROM invoices WHERE invoice = ?', v) || has("SELECT 1 FROM events WHERE data LIKE ?", `%${v}%`),
  pay: (v) => has('SELECT 1 FROM remittance_items WHERE payment = ?', v),
  misc: (v) => has("SELECT 1 FROM events WHERE data LIKE ?", `%${v}%`) || has('SELECT 1 FROM adjustments WHERE reference = ? OR note LIKE ?', v) || has('SELECT 1 FROM documents WHERE raw LIKE ?', `%${v}%`),
  rule: (v) => has('SELECT 1 FROM rules WHERE id = ? OR charge_code = ?', v),
  sscc: (v) => has('SELECT 1 FROM cartons WHERE sscc = ?', v),
};
known.misc = (v) => has("SELECT 1 FROM events WHERE data LIKE ?", `%${v}%`) || !!db.prepare('SELECT 1 FROM adjustments WHERE reference = ? OR note LIKE ?').get(v, `%${v}%`);
known.rule = (v) => !!db.prepare('SELECT 1 FROM rules WHERE id = ? OR charge_code = ?').get(v, v);
const PATTERNS = [[/\bNR-\d{5,6}\b/g, 'po'], [/\b(?:ASN|INV|RCV|ACK)-[0-9][0-9A-Z-]*\b/g, 'doc'], [/\bPMT-\d+\b/g, 'pay'], [/\b(?:DC|DM|BOL|CR|CI-NF|SL)-[0-9][0-9A-Z-]*\b/g, 'misc'], [/\bNF-\d+\.\d+\b/g, 'rule'], [/\b00?0614141\d{9,10}\b/g, 'sscc']];
const WRONG = [/Sam Whitaker/, /Maya [A-Z]\w+/, /Northfield Stores/, /Northfield Retail Group/, /Ashby Home\w*/, /Ashby Supply\b/, /ASHBYSUPPLY/, /before the truck leaves/i, /\b[A-Z][a-z]+ (?:Okafor|Nguyen|Patel|Garcia|Kim|Lopez|Brooks|Reyes|Chen|Morgan|Diaz|Shah)\b/];
const report = {}; let bad = 0;
for (const [id, c] of Object.entries(CLAIMS)) {
  const f = join(DIR, `${id}.html`); if (!existsSync(f)) { report[id] = { screen: 'not fetched' }; bad++; continue; }
  const src = readFileSync(f, 'utf8'); const r = { unknown_records: [], wrong_names: [], numbers: [] };
  for (const [re, kind] of PATTERNS) for (const v of new Set(src.match(re) || [])) { if ((c.ignore || []).some((x) => v.startsWith(x))) continue; if (!known[kind](v)) r.unknown_records.push(v); }
  for (const re of WRONG) for (const v of new Set(src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [])) if (!['Priya Raman', 'Jordan Ellis'].includes(v)) r.wrong_names.push(v);
  for (const n of c.numbers || []) { const got = db.prepare(n.sql).get(); const world = String(Object.values(got || { v: null })[0]); const shown = src.includes(n.shown); if (!shown || world !== String(n.world)) r.numbers.push({ claim: n.name, on_screen: shown ? n.shown : `"${n.shown}" not on screen`, world }); }
  if (c.engine === 'money-in-motion') {
    const at = src.search(/\bFX\s*=\s*\{/); let m = null;
    if (at >= 0) { const st = src.indexOf('{', at); let d = 0, i = st, q = false; for (; i < src.length; i++) { const ch = src[i]; if (q) { if (ch === '\\') i++; else if (ch === '"') q = false; } else if (ch === '"') q = true; else if (ch === '{') d++; else if (ch === '}' && --d === 0) break; } m = [null, src.slice(st, i + 1)]; }
    if (!m) r.numbers.push({ claim: 'fixture', on_screen: 'fixture not found in source', world: '' });
    else { const fx = JSON.parse(m[1]);
      const mine = buyerFixture(db, fx.pos.map((p) => p.id), c.today); const norm = normOrder; const diff = fx.pos.filter((p, i) => norm(p) !== norm(mine[i])).map((p) => p.id);
      r.engine = { orders: fx.pos.length, identical_to_world: fx.pos.length - diff.length, differ: diff.slice(0, 12) }; if (diff.length) r.numbers.push({ claim: 'order records', on_screen: `${diff.length} orders differ`, world: diff.slice(0, 6).join(', ') }); }
  }
  r.pass = !r.unknown_records.length && !r.wrong_names.length && !r.numbers.length; if (!r.pass) bad++; report[id] = r;
}
writeFileSync(join(ROOT, 'build', 'contract-report.json'), JSON.stringify(report, null, 1));
for (const [id, r] of Object.entries(report)) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${id}${r.pass ? '' : ` · unknown records ${r.unknown_records?.length ?? '-'}: ${(r.unknown_records || []).slice(0, 8).join(' ')} · names ${(r.wrong_names || []).join(', ')} · numbers ${(r.numbers || []).map((n) => `${n.claim} [${n.on_screen} vs ${n.world}]`).join('; ')}`}`);
process.exit(bad ? 1 : 0);
