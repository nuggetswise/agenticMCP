// Checks the agent kit in a real browser: every piece renders without a script error, the decision bar offers exactly
// Approve and Edit suggestion, Edit suggestion makes the proposal editable, Aviator opens closed-by-default and, with no
// connector in this view, says so instead of inventing an answer; no green and no banned control appears anywhere.
// No raw X12 anywhere: not in the page source, not in its visible text, and not in any drawer an interface tag opens.
// A tag opens the readable document only: a title and business values, with no format tabs.
// Usage: node scripts/kit-check.mjs [page.html]   (defaults to ui/kit-gallery.html)
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; } // playwright is a dev tool, not a dependency
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const RETAILER = args.includes('--retailer'); // a retailer screen: its controls are the business decision, no agent proposal
const page0 = resolve(args.find((a) => !a.startsWith('--')) || join(ROOT, 'ui', 'kit-gallery.html'));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text()); });
await page.goto('file://' + page0); await page.waitForTimeout(400);
// Raw X12: a segment id (ISA, GS, ST, BEG, W06 …) followed by element separators, or an X12 envelope header.
const RAW_X12 = /(^|[^A-Za-z0-9\\])(?:ISA|GS|ST|SE|GE|IEA|[A-Z][A-Z0-9]{1,2})\*[^\n<]{0,80}?\*/m;
const rawHit = (t) => { const m = String(t || '').match(RAW_X12); return m ? m[0].trim().slice(0, 60) : null; };
let fails = 0; const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` · ${detail}`}`); if (!cond) fails++; };
ok('no script errors', errors.length === 0, errors.join(' | '));
const text = await page.evaluate(() => document.body.innerText);
ok('no banned decision control', !/\b(Take over|Snooze|Handle it myself|Dismiss)\b/.test(text), text.match(/Take over|Snooze|Handle it myself|Dismiss/)?.[0]);
const bars = await page.$$eval('.tgk-bar .btns', (bs) => bs.map((b) => [...b.querySelectorAll('button')].map((x) => x.textContent)));
ok(RETAILER ? 'a decision bar is on screen' : 'agent decision bar has exactly Approve and Edit suggestion', RETAILER ? bars.length > 0 : bars.some((b) => JSON.stringify(b) === '["Approve","Edit suggestion"]'), JSON.stringify(bars));
const green = await page.evaluate(() => [...document.querySelectorAll('*')].some((n) => { const c = getComputedStyle(n); return [c.color, c.backgroundColor, c.borderColor].some((v) => { const m = v.match(/rgba?\((\d+), (\d+), (\d+)/); return m && +m[2] > +m[1] + 40 && +m[2] > +m[3] + 40; }); }));
ok('no green anywhere', !green);
ok('no tick characters', !/[✓✔✅]/.test(text));
const src = readFileSync(page0, 'utf8');
ok('no raw X12 in the page source', !rawHit(src), rawHit(src));
ok('no raw X12 in the visible text', !rawHit(text) && !/\braw X12\b/i.test(text), rawHit(text) || 'raw X12 label');
if (!RETAILER) {
await page.click('.tgk-bar button:has-text("Edit suggestion")'); await page.waitForTimeout(100);
ok('Edit suggestion makes the proposal editable and marks it as the person’s', (await page.$$('.tgk-na [contenteditable=true]')).length > 0 && /Edited by you/.test(await page.evaluate(() => document.body.innerText)));
const before = (await page.$$('.tgk-sugg tbody tr')).length; await page.click('.tgk-na .rm'); await page.waitForTimeout(100); const left = (await page.$$('.tgk-sugg tbody tr')).length;
ok('a row can be removed', left === before - 1, `${before} to ${left} rows`);
}
ok('Aviator is closed on load', !(await page.$('.tgk-av-panel[data-open]')));
await page.click('.tgk-av-btn'); ok('Aviator opens from the bottom-right control', !!(await page.$('.tgk-av-panel[data-open]')));
const box = await page.$eval('.tgk-av-btn', (b) => { const r = b.getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
ok('Aviator control sits at the bottom right', box.right <= 40 && box.bottom <= 40, JSON.stringify(box));
await page.fill('.tgk-av-form input', 'What is the order value of NR-450118?'); await page.click('.tgk-av-form button'); await page.waitForTimeout(11500);
const said = await page.$$eval('.tgk-av-msg[data-role=model]', (m) => m.map((x) => x.textContent).pop());
ok('Aviator without a connector says so and invents nothing', /connector/.test(said || '') && !/\$/.test(said || ''), said);
await page.click('.tgk-av-btn');
const tags = await page.locator('.tgk-tag[data-doc]').count(); let opened = 0, tabbed = 0, raw = null, empty = 0;
for (let i = 0; i < tags; i++) {
  const t = page.locator('.tgk-tag[data-doc]').nth(i); if (!(await t.isVisible())) continue;
  await t.click(); await page.waitForTimeout(260);
  const d = await page.$('.tgk-drawer[data-open]'); if (!d) continue; opened++;
  const info = await d.evaluate((n) => ({ tabs: n.querySelectorAll('[role=tab], [role=tablist], pre').length, body: n.querySelector('.body')?.innerText || '', html: n.innerHTML }));
  if (info.tabs) tabbed++; if (!info.body.trim()) empty++; raw = raw || rawHit(info.html) || (/\braw\b/i.test(info.body) ? 'raw label' : null);
  await page.keyboard.press('Escape'); await page.waitForTimeout(260);
}
ok('every interface tag opens a readable document', tags === 0 || (opened > 0 && empty === 0), `${opened} of ${tags} opened, ${empty} empty`);
ok('no drawer has format tabs or raw text', tabbed === 0 && !raw, `${tabbed} with tabs; ${raw || ''}`);
await page.screenshot({ path: args.includes('--shot') ? args[args.indexOf('--shot') + 1] : join(ROOT, 'docs', 'phase2', 'kit-gallery.png'), fullPage: true });
await browser.close();
console.log(fails ? `${fails} kit checks failed` : 'All kit checks passed'); process.exit(fails ? 1 : 0);
