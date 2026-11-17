// Walks P13 (rebuilt with no agent, D75) in Chrome, twice: through a live connection to a local demo server (the page's
// connector stood in by a bridge to REST) and with no connector (the rules' recorded run, under Simulated).
// The click map is the five approvals of the build prompts doc; each click's expected state is checked after it.
// Usage: start the server with MCP_TOKEN=ash NF_TOKEN=nf PORT=3111, then node scripts/walk-p13.mjs [--offline-only]
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const SHOTS = join(ROOT, 'docs/phase3/p13');
const BASE = process.env.WALK_BASE || 'http://localhost:3111';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + String(d).slice(0, 400)}`); if (!c) fails++; };
const MAP = [ // click, the order it is made on, and the state expected after it
  ['NR-46215', /Sent Late|Closed · sent Late/, 'ship notice sent and recorded Late'],
  ['NR-46220', /Asked Kinross|Ready for review/, 'Kinross asked for status'],
  ['NR-46210', /Sent|Closed/, 'order acknowledgment sent before its deadline'],
  ['NR-46226', /Sent|Closed/, 'invoice created in Supplier ERP and sent'],
  ['NR-46220', /Sent|Closed/, 'ship notice drafted from the load scan and sent'],
];

async function run(live) {
  const calls = []; const p = await b.newPage({ viewport: { width: 1440, height: 860 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  if (live) {
    await p.exposeFunction('__tgCall', async (server, tool, input) => { calls.push(tool); const r = await fetch(`${BASE}/api/ash/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input || {}) }); return r.json(); });
    await p.addInitScript(() => { window.claude = { use: async () => ({ callTool: async (server, tool, input) => ({ payload: await window.__tgCall(server, tool, input) }) }) }; });
  }
  const T = live ? 'live' : 'offline'; const txt = () => p.evaluate(() => document.body.innerText);
  const chip = (po) => p.$$eval('.tgk-qrow', (rows, po) => rows.filter((r) => r.querySelector('.ref').textContent === po).map((r) => r.querySelector('.tgk-chip').textContent).join(' | '), po);
  await p.goto('file://' + join(ROOT, 'build/pages/p13/index.html')); await p.waitForTimeout(live ? 1500 : 600);
  const t0 = await txt(); const main = t0.split('Aviator')[0];
  ok(`${T}: opens on NR-46215 with proposed actions ready and no start button`, /4 Northfield orders are missing a required document/.test(t0) && (await p.$eval('.tgk-rhead h2', (h) => h.textContent)) === 'NR-46215' && /Trading Grid suggestion/.test(t0) && !/\b(Start|Run|Play)\b/.test(main), t0.slice(0, 300));
  ok(`${T}: no agent name and no automation label`, !/\bAgents?\b|Watch Agent|automation/i.test(main), (main.match(/.{20}(Agents?|automation).{20}/i) || [])[0]);
  ok(`${T}: Simulated shows only without a connection`, /Simulated/.test(t0) === !live);
  ok(`${T}: first viewport shows queue, record, proposal and decision`, await p.evaluate(() => { const b = document.querySelector('.tgk-bar .btns'); return !!b && b.getBoundingClientRect().bottom <= 860; }));
  ok(`${T}: exactly Approve and Edit suggestion`, JSON.stringify(await p.$$eval('.tgk-bar .btns button', (x) => x.map((y) => y.textContent))) === '["Approve","Edit suggestion"]');
  ok(`${T}: every queue row states its own problem`, await p.$$eval('.tgk-qrow .line', (l) => l.every((x) => x.textContent.trim().length > 12)));
  ok(`${T}: at most one queue row shows a clock`, (await p.$$('.tgk-qrow .clock')).length <= 1);
  ok(`${T}: NR-46231 is left alone`, /Nothing to chase/.test(await chip('NR-46231')));
  ok(`${T}: the approve sentence names Northfield`, /Approve sends the ship notice to Northfield Retailer\./.test(t0), (t0.match(/Approve sends[^\n]*/) || [])[0]);
  if (live) await p.screenshot({ path: join(SHOTS, 'open.png') });
  await p.locator('.tgk-tag[data-doc]').first().click(); await p.waitForTimeout(300);
  ok(`${T}: a fact's tag opens the readable document`, !!(await p.$('.tgk-drawer[data-open] .tgk-doc'))); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  for (const [i, [po, want, what]] of MAP.entries()) {
    const open = await p.$eval('.tgk-rhead h2', (h) => h.textContent);
    if (open !== po) { await p.click(`.tgk-qrow:has(.ref:text-is("${po}"))`); await p.waitForTimeout(200); }
    if (po === 'NR-46226') ok(`${T}: the invoice approval names both steps`, /Approve sends an invoice in the Supplier ERP and the invoice to Northfield Retailer\./.test(await txt()), ((await txt()).match(/Approve sends[^\n]*/) || [])[0]);
    if (i === 0) await p.dblclick('.tgk-bar button:has-text("Approve")'); else await p.click('.tgk-bar button:has-text("Approve")');
    await p.waitForTimeout(live ? 4500 : 3000);
    const c = await chip(po); ok(`${T}: click ${i + 1}, ${what}`, want.test(c), c);
  }
  const t = await txt();
  ok(`${T}: NR-46215 stays Late and closes on Northfield's receiving advice`, /Closed · sent Late/.test(await chip('NR-46215')), await chip('NR-46215'));
  ok(`${T}: the Kinross ask closes on the 945`, /Closed/.test((await chip('NR-46220')).split(' | ')[0]), await chip('NR-46220'));
  ok(`${T}: no proposal is left waiting`, !/Ready for review/.test(t));
  ok(`${T}: a 997 never reads as acceptance`, !/accepted by Northfield|business acceptance received/i.test(t));
  ok(`${T}: no date on screen`, !/\b20\d\d-\d\d-\d\d\b|\b\d{1,2} (Nov|Dec|November|December)\b/.test(t), (t.match(/.{15}20\d\d-\d\d-\d\d.{10}/) || [])[0]);
  if (live) { await p.click('.tgk-qrow:has(.ref:text-is("NR-46215"))'); await p.waitForTimeout(200); await p.screenshot({ path: join(SHOTS, 'approved.png') });
    ok('live: one approval was sent per click, the double-click included', calls.filter((c) => c === 'watch_decide').length === 5, String(calls.filter((c) => c === 'watch_decide').length));
    ok('live: the session ran by the rules; the model was never asked', !calls.includes('watch_replay') && !calls.includes('watch_setup')); }
  ok(`${T}: no script errors`, errs.length === 0, errs.join(' | ')); await p.close();
}
if (!process.argv.includes('--offline-only')) await run(true);
await run(false);

// Edit suggestion: Priya takes the order over; the rules leave it alone until a new record arrives.
if (!process.argv.includes('--offline-only')) {
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
  await p.exposeFunction('__tgCall', async (server, tool, input) => (await fetch(`${BASE}/api/ash/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input || {}) })).json());
  await p.addInitScript(() => { window.claude = { use: async () => ({ callTool: async (server, tool, input) => ({ payload: await window.__tgCall(server, tool, input) }) }) }; });
  await p.goto('file://' + join(ROOT, 'build/pages/p13/index.html')); await p.waitForTimeout(1500);
  await p.click('.tgk-bar button:has-text("Edit suggestion")'); await p.waitForTimeout(200); await p.click('.tgk-na .rm'); await p.waitForTimeout(200);
  ok('edit: removing every row leaves a manual task', /Approve sends nothing; this order stays a manual task for Priya Raman\./.test(await p.evaluate(() => document.body.innerText)));
  await p.click('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(1500); const t = await p.evaluate(() => document.body.innerText);
  ok('edit: the takeover is recorded as Priya Raman’s and nothing is proposed again on that order', /Taken over by Priya Raman/.test(t) && /Edited by Priya Raman/.test(t) && !/NR-46215[^\n]*\n?Ready for review/.test(t), t.slice(0, 500));
  await p.close();
}
// Widths and themes, with no connection
for (const [w, h] of [[1440, 860], [960, 800], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + join(ROOT, 'build/pages/p13/index.html')); await p.waitForTimeout(500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${w}px ${scheme}: no horizontal page scroll, no script errors`, over <= 0 && !errs.length, `${over} ${errs.join('|')}`); await p.close();
}
console.log('Main path: 5 approvals; the queue advances by itself');
await b.close(); process.exit(fails ? 1 : 0);
