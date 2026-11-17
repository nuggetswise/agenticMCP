// Builds a prototype page for publishing: fills its recorded-data slot from the built world and inlines the agent kit.
// Recorded data is shown only when the viewer's connector cannot be reached, under the Simulated label.
// Usage: node scripts/page-build.mjs p15   →   build/pages/p15/index.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = process.argv[2];
const NR = await import('../src/retailer.js');
const DATA = {
  p15: () => { const db = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true });
    const rule = (id) => db.prepare('SELECT id, statement FROM rules WHERE id = ?').get(id);
    const drafts = NR.draftRules(db).drafts;
    return { drafts, replays: Object.fromEntries(drafts.map((d) => [d.id, NR.replayRule(db, { draft: d.id })])), rules: { 'NF-4.2': { ...rule('NF-4.2') }, 'NF-7.11': { ...rule('NF-7.11') } } }; },
  // P13: the last recorded real run through Ashby's connector (docs/phase3/p13/recorded-run.json), never a scripted one.
  p13: async () => { const W = await import('../src/watch.js'); const f = join(ROOT, 'docs', 'phase3', 'p13', 'recorded-run.json');
    const rec = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; return { start: rec.start || null, final: rec.final || null, recorded_at: rec.recorded_at || null, setup: W.setup() }; },
  // P14: the last recorded real run through Northfield's connector (docs/phase3/p14/recorded-run.json).
  p14: async () => { const M = await import('../src/match.js'); const f = join(ROOT, 'docs', 'phase3', 'p14', 'recorded-run.json'); const db = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true });
    const rec = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}; return { steps: rec.steps || [], recorded_at: rec.recorded_at || null, setup: M.setup(db) }; },
  // P21: what each side's connection answers at the start of the demo, for a viewer whose connector cannot be reached (Simulated).
  p21: async () => { const G = await import('../src/governance.js'); const db = new DatabaseSync(join(ROOT, 'build', 'tg.db'), { readOnly: true }); const nf = new DatabaseSync(join(ROOT, 'build', 'northfield.db'), { readOnly: true });
    const { Claim } = await import('../src/claim.js'); const { Pace } = await import('../src/pace.js'); const { Shelf } = await import('../src/shelf.js'); const { Review } = await import('../src/review.js'); const { Chase } = await import('../src/chase.js');
    const Scout = await import('../src/scout.js'); const Match = await import('../src/match.js');
    const conn = (id) => { const c = db.prepare('SELECT * FROM connections WHERE id = ?').get(id); return { configured_by: c.configured_by || 'Jordan Ellis', scopes: JSON.parse(c.scopes), writes: 'Proposals a person approves', calls: [] }; };
    const rule = (id) => db.prepare('SELECT id, statement FROM rules WHERE id = ?').get(id);
    const drafts = NR.draftRules(nf).drafts;
    return {
      ashby: { rules: G.rulesBySource(db, db, G.AS), changes: G.changeList(db, G.AS), setups: { 'Claim Agent': Claim.setup(), 'Scout Agent': Scout.setup(), 'Shelf Agent': Shelf.setup(), 'Pace Agent': Pace.setup() },
        effects: { 'AP-4.1:{"max_amount":150}': G.updateSupplierRule(db, G.AS, { rule: 'AP-4.1', params: { max_amount: 150 } }, 'Priya Raman') } },
      northfield: { rules: G.rulesBySource(db, nf, G.NF), changes: G.changeList(db, G.NF), setups: { 'Review Agent': Review.setup(), 'Match Agent': Match.setup(nf), 'Chase Agent': Chase.setup() },
        access: conn(G.NF), drafts, replays: Object.fromEntries(drafts.filter((d) => d.state === 'Draft').map((d) => [d.id, NR.replayRule(nf, { draft: d.id })])),
        in_force: { ship_notice_minutes: rule('NF-4.2'), price_tolerance_pct: rule('NF-7.11') } } }; },
};
if (!DATA[page]) { console.error(`No page ${page}`); process.exit(1); }
const out = join(ROOT, 'build', 'pages', page); mkdirSync(out, { recursive: true });
const commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
const data = await DATA[page]();
const html = readFileSync(join(ROOT, 'ui', `${page}.html`), 'utf8').replace(`__${page.toUpperCase()}_DATA__`, () => JSON.stringify(data).replace(/</g, '\\u003c')).replace('(build at the commit named in the page source note)', `(world at commit ${commit})`);
writeFileSync(join(out, 'src.html'), html);
execFileSync('node', [join(ROOT, 'scripts', 'kit-inline.mjs'), join(out, 'src.html'), join(out, 'index.html')]);
console.log(`Built ${join(out, 'index.html')}`);
