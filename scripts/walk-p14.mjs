// Walks P14's main path in Chrome with no connector, on the recorded real run built into the page: the queue opens on a
// record with Watch Agent's suggestion ready, Approve on each record in turn, the queue advancing by itself, a fact's tag
// Usage: node scripts/walk-p13.mjs [page.html]   (defaults to build/pages/p14/index.html)
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname, resolve } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page0 = resolve(process.argv[2] || join(ROOT, 'build/pages/p14/index.html'));
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('file://' + page0); await p.waitForTimeout(600);
let fails = 0, clicks = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + d}`); if (!c) fails++; };
const txt = () => p.evaluate(() => document.body.innerText);
const t0 = await txt();
ok('opens on a record with Match Agent’s suggestion ready, no start button', /Match Agent suggestion/.test(t0) && !/\b(Start|Run Match Agent|Play)\b/.test(t0.split('Aviator')[0]), t0.slice(0, 300));
ok('the recorded run is labelled Simulated', /Simulated/.test(t0));
ok('every queue row states its own problem', (await p.$$eval('.tgk-qrow .line', (l) => l.every((x) => x.textContent.trim().length > 12))));
await p.screenshot({ path: join(ROOT, 'docs/phase3/p14/open.png') });
const tag = p.locator('.tgk-tag[data-doc]').first(); await tag.click(); await p.waitForTimeout(300);
ok('a fact’s tag opens the readable document', !!(await p.$('.tgk-drawer[data-open] .tgk-doc')));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
let approvals = 0;
for (let i = 0; i < 8 && /Match Agent suggestion/.test(await txt()); i++) {
  const ref = await p.$eval('.tgk-rhead h2', (h) => h.textContent);
  await p.click('.tgk-bar button:has-text("Approve")'); clicks++; approvals++; await p.waitForTimeout(3200);
  const t = await txt(); ok(`Approve on ${ref} replaces the decision bar with the present state`, !/Match Agent suggestion/.test(t) || (await p.$eval('.tgk-rhead h2', (h) => h.textContent)) !== ref);
}
await p.screenshot({ path: join(ROOT, 'docs/phase3/p14/approved.png') });
ok('no payment reads as released', !/payment released|paid to/i.test(await txt()));
ok('no script errors', errs.length === 0, errs.join(' | '));
console.log(`clicks on the main path: ${clicks} (Approve on each of ${approvals} records; the queue advances by itself)`);
await b.close(); process.exit(fails ? 1 : 0);
