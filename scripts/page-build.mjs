// Builds a prototype page for publishing: fills its recorded-data slot from the built world and inlines the agent kit.
// Recorded data is shown only when the viewer's connector cannot be reached, under the Simulated label.
// Usage: node scripts/page-build.mjs p15   →   build/pages/p15/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = process.argv[2];
const NR = await import('../src/retailer.js');
const DATA = {
  p15: () => { const db = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true });
    const rule = (id) => db.prepare('SELECT id, statement FROM rules WHERE id = ?').get(id);
    const drafts = NR.draftRules(db).drafts;
    return { drafts, replays: Object.fromEntries(drafts.map((d) => [d.id, NR.replayRule(db, { draft: d.id })])), rules: { 'NF-4.2': { ...rule('NF-4.2') }, 'NF-7.11': { ...rule('NF-7.11') } } }; },
};
if (!DATA[page]) { console.error(`No page ${page}`); process.exit(1); }
const out = join(ROOT, 'build', 'pages', page); mkdirSync(out, { recursive: true });
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
const html = readFileSync(join(ROOT, 'ui', `${page}.html`), 'utf8').replace('__P15_DATA__', JSON.stringify(DATA[page]()).replace(/</g, '\\u003c')).replace('(build at the commit named in the page source note)', `(world at commit ${commit})`);
writeFileSync(join(out, 'src.html'), html);
execFileSync('node', [join(ROOT, 'scripts', 'kit-inline.mjs'), join(out, 'src.html'), join(out, 'index.html')]);
console.log(`Built ${join(out, 'index.html')}`);
