// Drift check for the TG for Retail Build Guide.
// Usage: node scripts/guide-check.mjs [docs/build-guide.md]
// The guide is a Claude doc; docs/build-guide.md is its Markdown export (doc menu > Export > Markdown).
// Fails (exit 1) when the guide is stale or repeats itself. Cross-doc overlap is reported, not failed.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { sectionItems, key } from './lib/sections.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const file = process.argv[2] || join(ROOT, 'docs/build-guide.md');
const md = readFileSync(file, 'utf8').replace(/\\_/g, '_');
const results = [];
const check = (name, problems, info) => results.push({ name, ok: problems.length === 0, problems, info });
const sh = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Sections and tables
const section = (h) => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 4); return md.slice(i, j < 0 ? undefined : j); };
const tables = (s) => { const out = []; let cur = null; for (const l of s.split('\n')) { if (l.startsWith('|')) { const cells = l.slice(1, -1).split('|').map((c) => c.trim()); if (!cur) { cur = { head: cells, rows: [] }; out.push(cur); } else if (!/^-+$/.test(cells[0].replace(/\s/g, ''))) cur.rows.push(cells); } else cur = null; } return out; };

// 1. As-of commit: no behaviour change in the repo since the commit the guide states
{ const m = md.match(/as of repo commit ([0-9a-f]{7})/); const p = [];
  if (!m) p.push('no "as of repo commit" line');
  else { try { sh(`git cat-file -e ${m[1]}^{commit}`); } catch { p.push(`commit ${m[1]} not found`); }
    const changed = sh(`git diff --name-only ${m[1]} HEAD -- src world registry scripts contract validator openapi package.json`).split('\n').filter((f) => f && !['scripts/guide-check.mjs', 'scripts/guide-tabs.mjs', 'scripts/lib/sections.mjs', 'scripts/guide-pack.mjs'].includes(f));
    if (changed.length) p.push(`changed since ${m[1]}: ${changed.join(', ')}`); }
  check('as_of_commit_current', p, m && m[1]); }

// 2. Every commit named exists
{ const p = []; for (const [, c] of md.matchAll(/[Cc]ommit ([0-9a-f]{7})\b/g)) { try { sh(`git cat-file -e ${c}^{commit}`); } catch { p.push(c); } } check('commits_exist', p); }

// 3. Every repo path in backticks exists; every npm script exists; every gate check name exists
{ const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts; const gate = readFileSync(join(ROOT, 'scripts/check.js'), 'utf8'); const tools = readFileSync(join(ROOT, 'src/tools.js'), 'utf8') + readFileSync(join(ROOT, 'src/server.js'), 'utf8'); const p = [];
  for (const [, s] of md.matchAll(/`([^`\n]+)`/g)) {
    if (/^npm run /.test(s)) { if (!pkg[s.slice(8)]) p.push(`npm script ${s}`); continue; }
    if (s.startsWith('/')) continue; // a URL path on the server, not a repo path
    if (existsSync(join(ROOT, s))) continue;
    if (/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(s)) { if (!gate.includes(`'${s}'`)) p.push(`gate check ${s}`); continue; }
    if (/^[a-z]+(_[a-z]+)+$/.test(s)) { if (!tools.includes(`name: '${s}'`)) p.push(`tool ${s}`); continue; }
    if (/^[\w.\-/]+$/.test(s) && (s.includes('/') || /\.(json|md|js|mjs|db)$/.test(s))) { if (!existsSync(join(ROOT, s))) p.push(`path ${s}`); } }
  check('paths_scripts_gate_checks_tools_exist', p); }

// 4. Every rule id exists in the catalogue mirror
{ const ids = new Set(JSON.parse(readFileSync(join(ROOT, 'registry/catalogue-pack.json'), 'utf8')).rules.map((r) => r.id));
  const p = [...new Set([...md.matchAll(/\b(?:AP|NF|AM)-\d+(?:\.\d+)?\b/g)].map((m) => m[0]))].filter((i) => !ids.has(i)); check('rule_ids_in_catalogue', p); }

// 5. Every CALLS number exists in the calls log
{ const n = (readFileSync(join(ROOT, 'docs/build-log/CALLS.md'), 'utf8').match(/^\d+\. \*\*/gm) || []).length; const p = [];
  for (const [ref] of md.matchAll(/CALLS \d+(?:(?:, | and | to )\d+)*/g)) for (const [x] of ref.matchAll(/\d+/g)) if (+x > n || +x < 1) p.push(ref);
  check('calls_refs_exist', p, `${n} calls logged`); }

// 6. Inventory covers the registry; grid covers the inventory; no blank or unknown cell
{ const reg = JSON.parse(readFileSync(join(ROOT, 'registry/registry.json'), 'utf8')).prototypes.map((x) => x.id);
  const inv = tables(section('Inventory'))[0]; const grid = tables(section('Coverage grid'))[0]; const p = [];
  const invIds = inv.rows.map((r) => r[0]); const regIdOf = (x) => x.split(' ')[0]; const gridIds = grid.rows.flatMap((r) => r[0].split(/,\s*/));
  for (const id of reg) if (!invIds.map(regIdOf).includes(id)) p.push(`registry ${id} missing from Inventory`);
  for (const id of invIds) if (!gridIds.includes(id)) p.push(`inventory ${id} missing from grid`);
  const other = Object.fromEntries((JSON.parse(readFileSync(join(ROOT, 'registry/registry.json'), 'utf8')).other_inventory || []).map((x) => [x.id, x.status]));
  for (const r of inv.rows) { if (!reg.includes(regIdOf(r[0])) && !(r[0] in other)) p.push(`inventory ${r[0]} is not in the registry`); if (r[0] in other && other[r[0]] !== r[3]) p.push(`${r[0]} registry status ${other[r[0]]}, guide ${r[3]}`); }
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const stated = section('Inventory').match(/has (\w+) items/); if (!stated || words.indexOf(stated[1]) !== inv.rows.length) p.push(`Inventory says ${stated && stated[1]} items, table has ${inv.rows.length}`);
  const allowed = new Set(['Done', 'Partly', 'Not done', 'N/A']);
  for (const r of grid.rows) { if (r.length !== grid.head.length) p.push(`grid row ${r[0]} has ${r.length} cells`); r.slice(1).forEach((c, i) => { if (!allowed.has(c)) p.push(`grid ${r[0]} ${grid.head[i + 1]}: "${c}"`); }); }
  const regStatus = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'registry/registry.json'), 'utf8')).prototypes.map((x) => [x.id, x.status]));
  for (const r of inv.rows) if (regStatus[regIdOf(r[0])] && regStatus[regIdOf(r[0])] !== r[3]) p.push(`${r[0]} registry status ${regStatus[r[0]]}, guide ${r[3]}`);
  // Every Inventory row states the prototype's job and the record that ends it (R06)
  const jobCol = inv.head.indexOf('Job, and where it ends');
  if (jobCol < 0) p.push('Inventory has no "Job, and where it ends" column');
  else for (const r of inv.rows) { const c = (r[jobCol] || '').trim(); if (!c || /^(—|-|tbd|n\/a)$/i.test(c)) p.push(`${r[0]}: blank "Job, and where it ends"`); }
  check('inventory_and_grid_complete', p, `${inv.rows.length} inventory rows, ${grid.rows.length} grid rows`); }

// 7. No copied world values: money, percentages, thousands, long numbers (outside IDs, the GS1 prefix and years)
{ const p = []; const body = md.replace(/https?:\/\/\S+/g, '');
  for (const re of [/\$\s?\d[\d,.]*/g, /\b\d+(?:\.\d+)?%/g, /\b\d{1,3}(?:,\d{3})+\b/g, /(?<![\w-])\d{4,}(?![\w-])/g])
    for (const [v] of body.matchAll(re)) if (!['0614141', '2026', '2027'].includes(v)) p.push(v);
  check('no_copied_world_values', [...new Set(p)]); }

// 8. Proof counts in the guide equal a fresh run
{ const p = []; const proofs = section('Proofs, open items and drift control');
  const run = (cmd) => { try { return sh(cmd); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
  const pairs = [['npm run build', /(\d+) checks passed, (\d+) failed/, 'node --no-warnings scripts/check.js'], ['npm run smoke', /(\d+) smoke checks passed, (\d+) failed/, 'node --no-warnings scripts/smoke.js']];
  for (const [label, re, cmd] of pairs) { const line = proofs.split('\n').find((l) => l.includes(`\`${label}\``)); const g = line && line.match(/(\d+) passed, (\d+) failed/); const f = run(cmd).match(re);
    if (!g) p.push(`${label}: no count in guide`); else if (!f) p.push(`${label}: no count from run`); else if (g[1] !== f[1] || g[2] !== f[2]) p.push(`${label}: guide ${g[1]}/${g[2]}, run ${f[1]}/${f[2]}`); }
  check('proof_counts_current', p); }

// 9. Every claude.ai link was verified
{ const v = JSON.parse(readFileSync(join(ROOT, 'docs/guide/artifacts-verified.json'), 'utf8')).artifacts;
  const p = [...new Set([...md.matchAll(/claude\.ai\/artifact\/([A-Za-z0-9]+)/g)].map((m) => m[1]))].filter((s) => !v[s]); check('artifact_links_verified', p); }

// 10. Redundancy inside the guide: no 8-word passage appears twice (status-only grid cells ignored)
const words = (t) => t.replace(/\|\s*(Done|Partly|Not done|N\/A|Open|Blocked)\s*(?=\|)/g, '|').replace(/[`*#>\[\]()|_]/g, ' ').replace(/https?:\/\/\S+/g, ' ').toLowerCase().match(/[a-z0-9][a-z0-9.\-']*/g) || [];
// Shingles are taken per line (a paragraph, list item or table row), so table columns never join into false passages.
const shingles = (text, k = 8) => { const m = new Map(); const ls = text.split('\n'); for (const [n, line] of ls.entries()) { if (/^\|[\s\-|]+\|$/.test(ls[n + 1] || '')) continue; /* table header rows repeat by design */ const w = words(line); for (let i = 0; i + k <= w.length; i++) { const s = w.slice(i, i + k).join(' '); m.set(s, (m.get(s) || 0) + 1); } } return m; };
{ const own = shingles(md); const p = [...own].filter(([, c]) => c > 1).map(([s]) => s); check('no_repeated_passages', p); }

// 11. Overlap with the docs this guide replaces (report only; these passages leave those docs)
{ const g = new Set(shingles(md).keys()); const info = {};
  for (const d of ['docs/prototype-plan.md', 'docs/database-and-server-plan.md', 'docs/agent-and-mcp-strategy.md']) { const o = [...shingles(readFileSync(join(ROOT, d), 'utf8')).keys()].filter((s) => g.has(s)); info[d] = { shared_8word_passages: o.length, sample: o.slice(0, 3) }; }
  results.push({ name: 'overlap_with_replaced_docs', ok: true, problems: [], info }); }


// 12. Omission check: every item in a retired governing section has a home in the guide (docs/guide/coverage.json)
{ const cov = JSON.parse(readFileSync(join(ROOT, 'docs/guide/coverage.json'), 'utf8')).items; const p = [];
  const sections = [...new Set(cov.map((c) => `${c.doc}\u0000${c.section}`))];
  for (const s of sections) { const [doc, heading] = s.split('\u0000'); const items = sectionItems(join(ROOT, doc), heading);
    if (!items) { p.push(`section gone: ${doc} ${heading}`); continue; }
    for (const it of items) if (!cov.some((c) => c.doc === doc && c.section === heading && c.key === key(it))) p.push(`unmapped: ${doc} ${heading}: ${it.slice(0, 50)}`); }
  for (const c of cov) { if (/^(pointer|superseded):/.test(c.to)) continue;
    const homes = [`**${c.to}**`, `| ${c.to} |`, `## ${c.to}`, `**${c.to}**`]; if (!homes.some((h) => md.includes(h))) p.push(`no home for ${c.to} (${c.item.slice(0, 40)})`); }
  const n = (k) => cov.filter((c) => (k === 'home' ? !/^(pointer|superseded):/.test(c.to) : c.to.startsWith(k))).length;
  check('retired_rules_have_a_home', p, `${cov.length} items: ${n('home')} placed in the guide, ${n('pointer')} pointed to their owner, ${n('superseded')} superseded by owner decisions`); }

// 13. Every task row has an ID, a read-first, a done-when and a known status; dependencies exist
{ const p = []; const ts = tables(section('Tasks')); const rows = ts.flatMap((t) => t.rows.map((r) => Object.fromEntries(t.head.map((h, i) => [h, r[i] || '']))));
  const ids = new Set(rows.map((r) => r.ID));
  for (const r of rows) { if (!/^T\d+\.\d+$/.test(r.ID)) p.push(`bad ID: ${r.ID}`);
    for (const c of ['Prototype', 'Task', 'Read first', 'Done when']) if (!r[c]) p.push(`${r.ID}: no ${c}`);
    if (!['Open', 'Done', 'Blocked'].includes(r.Status)) p.push(`${r.ID}: status "${r.Status}"`);
    if (r.Status === 'Done' && !/commit [0-9a-f]{7}|CALLS \d+/.test(r['Done when'])) p.push(`${r.ID}: Done without commit or CALLS evidence`);
    for (const [d] of (r['Depends on'] || '').matchAll(/T\d+\.\d+/g)) if (!ids.has(d)) p.push(`${r.ID} depends on missing ${d}`);
    if (r.Status === 'Blocked' && !/question|[Oo]wner/.test(r['Depends on']) && !(r['Depends on'].match(/T\d+\.\d+/g) || []).some((d) => rows.find((x) => x.ID === d && x.Status === 'Blocked'))) p.push(`${r.ID}: Blocked but names no owner answer`); }
  if (rows.length === 0) p.push('no task tables');
  check('tasks_have_ids_and_done_when', p, `${rows.length} tasks: ${rows.filter((r) => r.Status === 'Done').length} done, ${rows.filter((r) => r.Status === 'Blocked').length} blocked`); }

const report = { file, ran_at_head: sh('git rev-parse --short HEAD').trim(), results };
writeFileSync(join(ROOT, 'docs/guide/check-report.json'), JSON.stringify(report, null, 1) + '\n');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.problems.length ? ': ' + r.problems.slice(0, 6).join('; ') : ''}${r.info ? '  [' + (typeof r.info === 'string' ? r.info : JSON.stringify(r.info)) + ']' : ''}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
