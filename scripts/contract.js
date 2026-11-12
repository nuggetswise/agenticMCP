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
// Names: only Priya Raman and Jordan Ellis may be named. Two nets: a list of common first names, and any capitalised
// pair that follows a cue such as "Awaiting" or "Approved by". Style blocks are ignored. A name outside both nets passes.
const FIRST = 'Sam|Rae|Kim|Dana|Maya|Marcus|Elena|Tom|Theo|Alex|Chris|Pat|Lee|Morgan|Taylor|Jamie|Casey|Riley|Avery|Quinn|Drew|Robin|Noah|Liam|Emma|Olivia|Ava|Mia|Zoe|Ian|Omar|Nina|Lena|Ravi|Anil|Wei|Mei|Sara|Sarah|Laura|Linda|Mark|Paul|Peter|John|James|David|Maria|Ana|Luis|Carlos|Diego|Sofia|Grace|Hannah|Ethan|Lucas|Owen|Ruth|Nora|Hugo|Felix|Jonas|Ben|Dan|Joe|Tim|Jim|Bob|Amy|Eva|Ivy|Kai|Leo|Eli|Ada|Uma|Tara|Asha|Devi|Arun|Kofi|Tariq|Layla|Yusuf|Aisha|Hana|Kenji|Yuki|Andre|Nadia|Irene|Victor|Monica|Rachel|Kevin|Brian|Eric|Greg|Jeff|Scott|Sean|Todd|Troy|Wade|Neil|Carl|Dale|Earl|Gary|Glen|Hank|Jack|Kent|Kurt|Lars|Luke|Matt|Nick|Phil|Rick|Ross|Seth|Ted|Walt|Zack|Anna|Kate|Jane|Mary|Lisa|Emily|Susan|Karen|Helen|Priya|Jordan';
const NOT_PEOPLE = /^(Northfield|Ashby|Kinross|Lakeline|Trading|Scout|Claim|Pace|Watch|Shelf|Vet|Test|Reuse|Supplier|Warehouse|Master|NetSuite|Order|Ship|Purchase|Sales|Item|Technical|Receiving|Application|Customer|Retail|Wholesale|Marketplace|Drop|Your|The|This|Its|Line|Version|Carton|Store|Week|Rule|Rules|Priya Raman|Jordan Ellis)\b/;
function otherNames(src) { const t = src.replace(/<style[\s\S]*?<\/style>/g, ' '); const out = new Set();
  for (const m of t.matchAll(new RegExp(`\\b(?:${FIRST})\\b(?:[’']s)?(?: [A-Z][a-z]{2,})?`, 'g'))) { const v = m[0].replace(/[’']s$/, ''); if (!/^(Priya|Jordan)( Raman| Ellis)?$/.test(v) && !/^(Mark|Pat|Dale|Grace|May|Will|Bill|Ray|Dan|Jack|Ross|Kent|Glen|Earl|Ivy|Ada|Ted|Rick) (?![A-Z])/.test(m[0] + ' ') || /^(Priya|Jordan) (?!Raman|Ellis)[A-Z]/.test(v)) out.add(v); }
  for (const m of t.matchAll(/\b(?:Awaiting|Waiting for|Approved by|Accepted by|Activated by|Sent by|Confirmed by|Rejected by|Owned by|delegate|Contact|Dear|Thanks,|Regards,)\s+([A-Z][a-z]+ [A-Z][a-z]+)/g)) if (!NOT_PEOPLE.test(m[1])) out.add(m[1]);
  return [...out]; }
const report = {}; let bad = 0;
for (const [id, c] of Object.entries(CLAIMS)) {
  const f = join(DIR, `${id}.html`); if (!existsSync(f)) { report[id] = { screen: 'not fetched' }; bad++; continue; }
  const src = readFileSync(f, 'utf8'); const r = { unknown_records: [], wrong_names: [], numbers: [] };
  for (const [re, kind] of PATTERNS) for (const v of new Set(src.match(re) || [])) { if ((c.ignore || []).some((x) => v.startsWith(x))) continue; if (!known[kind](v)) r.unknown_records.push(v); }
  for (const re of WRONG) for (const v of new Set(src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [])) if (!['Priya Raman', 'Jordan Ellis'].includes(v)) r.wrong_names.push(v);
  for (const v of otherNames(src)) if (!r.wrong_names.includes(v)) r.wrong_names.push(v);
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
