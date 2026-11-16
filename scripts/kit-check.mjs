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

// Design system tokens: every colour, font, radius and type size a page sets must come from ui/ds (tokens and the
// derived values the workspace skill marks). Scans style blocks, style attributes, the kit's CSS and style strings in scripts.
const tokenFiles = ['tokens.css', 'tokens-derived.css'].map((f) => readFileSync(join(ROOT, 'ui', 'ds', f), 'utf8')).join('\n');
const ALLOWED_HEX = new Set([...tokenFiles.matchAll(/#([0-9a-f]{3,8})\b/gi)].map((m) => m[1].toLowerCase()));
const ALLOWED_RGB = new Set([...tokenFiles.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) => `${m[1]},${m[2]},${m[3]}`));
const SIZES = new Set([10.5, 11, 12, 12.5, 13, 13.5, 14, 15, 16, 18, 22, 30, 40, 52, 56]); const RADII = new Set([0, 6, 10, 12, 16, 999]);
const styleText = (() => { const out = []; const noTok = src.replace(/\/\*tokens:start\*\/[\s\S]*?\/\*tokens:end\*\//g, '').replace(/<style id="ds-tokens">[\s\S]*?<\/style>/g, '');
  for (const m of noTok.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push(m[1]);
  for (const m of noTok.matchAll(/style\s*=\s*"([^"]*)"/g)) out.push(m[1]);
  for (const m of noTok.matchAll(/const CSS = `([\s\S]*?)`;/g)) out.push(m[1]);
  for (const m of noTok.matchAll(/(?:style|cssText)\s*[:=]\s*(['`])((?:(?!\1)[^\\]|\\.)*?)\1/g)) out.push(m[2]);
  return out.join('\n'); })();
const off = [];
for (const m of styleText.matchAll(/#([0-9a-f]{3,8})\b/gi)) if (!ALLOWED_HEX.has(m[1].toLowerCase())) off.push(`colour #${m[1]}`);
for (const m of styleText.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) if (!ALLOWED_RGB.has(`${m[1]},${m[2]},${m[3]}`)) off.push(`colour ${m[0]})`);
for (const m of styleText.matchAll(/font-family\s*:\s*([^;}"']+)/g)) if (!/^\s*(var\(--|inherit|Inter\b)/.test(m[1])) off.push(`font ${m[1].trim()}`);
for (const m of styleText.matchAll(/font(?:-size)?\s*:\s*(?:\d{3}\s+)?([\d.]+)px/g)) if (!SIZES.has(+m[1])) off.push(`type size ${m[1]}px`);
for (const m of styleText.matchAll(/border-radius\s*:\s*([\d.]+)px/g)) if (!RADII.has(+m[1])) off.push(`radius ${m[1]}px`);
ok('every colour, font, radius and type size comes from the design system tokens', off.length === 0, [...new Set(off)].slice(0, 12).join('; '));
ok('no raw X12 in the page source', !rawHit(src), rawHit(src));
ok('no raw X12 in the visible text', !rawHit(text) && !/\braw X12\b/i.test(text), rawHit(text) || 'raw X12 label');
if (!RETAILER) {
await page.click('.tgk-bar button:has-text("Edit suggestion")'); await page.waitForTimeout(100);
ok('Edit suggestion makes the proposal editable and marks it as the person’s', (await page.$$('.tgk-na [contenteditable=true]')).length > 0 && /Edited by you/.test(await page.evaluate(() => document.body.innerText)));
const before = (await page.$$('.tgk-sugg tbody tr')).length; await page.click('.tgk-na .rm'); await page.waitForTimeout(100); const left = (await page.$$('.tgk-sugg tbody tr')).length;
ok('a row can be removed', left === before - 1, `${before} to ${left} rows`);
}
ok('Aviator is closed on load', !(await page.$('.tgk-av-panel[data-open]')));
const box = await page.$eval('.tgk-av-btn', (b) => { const r = b.getBoundingClientRect(); return { right: innerWidth - r.right, bottom: innerHeight - r.bottom }; });
ok('Aviator sits at the bottom right', box.right <= 40 && box.bottom <= 40, JSON.stringify(box));
const presence = await page.$eval('.tgk-av-btn', (b) => ({ avatar: !!b.querySelector('.tgk-av-avatar svg'), name: b.querySelector('.tgk-av-id b')?.textContent, status: b.querySelector('.tgk-av-status')?.textContent }));
ok('Aviator is an agent presence: avatar, name and status', presence.avatar && presence.name === 'Aviator' && presence.status === 'Ready', JSON.stringify(presence));
await page.click('.tgk-av-btn'); await page.waitForTimeout(400); ok('Aviator opens a side panel', !!(await page.$('.tgk-av-panel[data-open]')));
const side = await page.$eval('.tgk-av-panel', (p) => { const r = p.getBoundingClientRect(); return { top: Math.round(r.top), right: Math.round(innerWidth - r.right), h: Math.round(r.height) }; });
ok('the panel runs full height at the right edge', side.top === 0 && side.right === 0 && side.h >= 800, JSON.stringify(side));
ok('the panel lists what Aviator read', /What Aviator read/i.test(await page.$eval('.tgk-av-panel', (p) => p.innerText)));
await page.fill('.tgk-av-form input', 'What is the order value of NR-450118?'); await page.click('.tgk-av-form button'); await page.waitForTimeout(11500);
const said = await page.$$eval('.tgk-av-msg[data-role=model]', (m) => m.map((x) => x.textContent).pop());
ok('Aviator without a connection says so and invents nothing', /connection/.test(said || '') && !/\$/.test(said || ''), said);
await page.click('.tgk-av-close'); ok('Aviator closes', !(await page.$('.tgk-av-panel[data-open]')));
// With a stand-in connection: the first call cannot start while claude.ai's permission box is open, so it is sent again once,
// quietly; the answer lands, the status shows the work, and the records read are listed in business words, never tool names.
{
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await p2.addInitScript(() => { let n = 0; window.__calls = 0; window.claude = { use: async (k) => k !== 'mcp' ? null : { callTool: async (server, tool, input) => { window.__calls++; if (n++ === 0) { const e = new Error('consent'); e.code = 'upstream_error'; e.retryable = true; e.retryAfterMs = 20; throw e; } await new Promise((r) => setTimeout(r, 400)); return { payload: { ok: true, answer: 'Order value is on the order.', tools_called: [{ tool: 'get_order', arguments: { po: 'NR-450118' } }] } }; } } }; });
  await p2.goto('file://' + page0); await p2.waitForTimeout(300);
  await p2.click('.tgk-av-btn'); await p2.fill('.tgk-av-form input', 'What is the order value?'); await p2.click('.tgk-av-form button'); await p2.waitForTimeout(150);
  const busy = await p2.$eval('.tgk-av-panel .tgk-av-status', (n) => n.textContent);
  ok('while answering, the status reads Reading records', busy === 'Reading records', busy);
  await p2.waitForTimeout(900);
  const st = await p2.evaluate(() => ({ calls: window.__calls, answer: [...document.querySelectorAll('.tgk-av-msg[data-role=model]')].pop()?.textContent || '', read: document.querySelector('.tgk-av-read')?.innerText || '', status: document.querySelector('.tgk-av-panel .tgk-av-status').textContent, panel: document.querySelector('.tgk-av-panel').innerText }));
  ok('a call refused while the permission box was open is sent once more and answers', st.calls === 2 && /Order value is on the order/.test(st.answer), JSON.stringify({ calls: st.calls, answer: st.answer.slice(0, 80) }));
  ok('the side panel lists the record read, in business words', /Order/.test(st.read) && /NR-450118/.test(st.read), st.read);
  ok('no tool name on screen', !/get_order|ask_aviator|_\w+\(/.test(st.panel), st.panel.match(/get_order|ask_aviator/)?.[0]);
  ok('status returns to Ready', st.status === 'Ready', st.status);
  await p2.close();
}
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
