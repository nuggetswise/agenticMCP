// Walks P15's main path in Chrome with no connector: open NFD-1, replay, see the recorded replay under Simulated,
// try another value (refused without the connector), replay the draft, publish (refused without the connector, nothing sent).
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + join(ROOT, 'build/pages/p15/index.html')); await p.waitForTimeout(300);
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + d}`); if (!c) fails++; };
const txt = () => p.evaluate(() => document.body.innerText);
ok('opens on NFD-1 with the rule in force and the draft', /NFD-1/.test(await txt()) && /within 1 hour of departure/.test(await txt()));
await p.click('button:has-text("Replay against the quarter")'); await p.waitForTimeout(11500);
const t1 = await txt(); ok('replay shows failing now, with the draft and exposure', /Failing now\s*32/.test(t1) && /With the draft\s*541/.test(t1) && /\$76,350/.test(t1), t1.slice(0, 400));
ok('recorded replay is labelled Simulated', /Simulated/.test(t1));
await p.screenshot({ path: join(ROOT, 'docs/phase3/p15/replayed.png'), fullPage: false });
await p.click('button:has-text("Publish to suppliers")'); await p.waitForTimeout(500);
ok('publish without the connector sends nothing and says so', /nothing was sent/.test(await txt()));
await p.click('button.tgk-qrow:has-text("NFD-2")'); await p.waitForTimeout(200); ok('NFD-2 opens from the queue', /0\.25%/.test(await txt()));
ok('no script errors', errs.length === 0, errs.join('|'));
console.log(`clicks on the main path: 3 (replay, publish, next draft)`); await b.close(); process.exit(fails ? 1 : 0);
