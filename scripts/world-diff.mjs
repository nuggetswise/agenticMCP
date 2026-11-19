// Proof that a world change keeps every existing record: builds the world at a base commit (default: the commit
// before world coverage, e8f0e93) and compares it with the current build, table by table, in all three databases.
// A row present at the base and absent now (on the columns both share) is a changed or lost record, and fails unless
// docs/archive/phase1/rebaseline.json names that table with the reason it was re-baselined on purpose. Added rows are listed.
// Usage: node scripts/world-diff.mjs [base-commit] [--report path]
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const ri = args.indexOf('--report'); const report = ri >= 0 ? args.splice(ri, 2)[1] : null;
const REF = args[0] || 'e8f0e93';
const BASE = `/tmp/world-base-${REF}`;
if (!existsSync(join(BASE, 'build', 'tg.db'))) {
  mkdirSync(BASE, { recursive: true });
  execSync(`git -C "${ROOT}" archive ${REF} | tar -x -C "${BASE}"`);
  if (!existsSync(join(BASE, 'node_modules'))) symlinkSync(join(ROOT, 'node_modules'), join(BASE, 'node_modules'));
  execSync('node --no-warnings world/build.js', { cwd: BASE, stdio: 'ignore' });
}
const ALLOW = join(ROOT, 'docs', 'archive', 'phase1', 'rebaseline.json');
const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : {};
const SKIP = new Set(['connections', 'access_log', 'proposals', 'agent_changes', 'rule_replays']);
const out = { base: REF, tables: {} }; let bad = 0;
for (const f of ['tg.db', 'ashby.db', 'northfield.db']) {
  const db = new DatabaseSync(join(ROOT, 'build', f), { readOnly: true });
  db.exec(`ATTACH DATABASE '${join(BASE, 'build', f)}' AS b`);
  const tables = db.prepare("SELECT name FROM b.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  for (const t of tables) {
    if (SKIP.has(t)) continue; const key = `${f.replace('.db', '')}.${t}`;
    const now = db.prepare(`SELECT name FROM pragma_table_info('${t}', 'main')`).all().map((r) => r.name);
    if (!now.length) { out.tables[key] = { gone: true }; if (!allow[key]) bad++; continue; }
    const cols = db.prepare(`SELECT name FROM pragma_table_info('${t}', 'b')`).all().map((r) => r.name).filter((c) => now.includes(c)).map((c) => `"${c}"`).join(',');
    const lost = db.prepare(`SELECT count(*) n FROM (SELECT ${cols} FROM b."${t}" EXCEPT SELECT ${cols} FROM main."${t}")`).get().n;
    const added = db.prepare(`SELECT count(*) n FROM (SELECT ${cols} FROM main."${t}" EXCEPT SELECT ${cols} FROM b."${t}")`).get().n;
    const rows = db.prepare(`SELECT count(*) n FROM b."${t}"`).get().n;
    out.tables[key] = { base_rows: rows, changed_or_lost: lost, added, ...(lost && allow[key] ? { rebaselined: allow[key] } : {}) };
    if (lost && !allow[key]) bad++;
  }
  db.close();
}
const lines = Object.entries(out.tables).filter(([, v]) => v.gone || v.changed_or_lost || v.added).map(([k, v]) => `${k}: ${v.gone ? 'gone' : `${v.changed_or_lost} changed or lost, ${v.added} added${v.rebaselined ? ` (re-baselined: ${v.rebaselined})` : ''}`}`);
const kept = Object.values(out.tables).filter((v) => !v.gone && !v.changed_or_lost).length;
out.summary = `${kept} of ${Object.keys(out.tables).length} base tables keep every row; ${bad} changed without a re-baseline`;
console.log(lines.join('\n')); console.log(out.summary);
if (report) writeFileSync(join(ROOT, report), JSON.stringify(out, null, 1) + '\n');
process.exit(bad ? 1 : 0);
