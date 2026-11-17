// Walks P14 in Chrome on the recorded real run built into the page (docs/phase4/runs/match-steps.json): three approvals,
// each click's expected state checked after it. Then once more with a connection whose server has no model, to show the
// page falls back to the recorded run instead of inventing steps.
// Usage: node scripts/walk-p14.mjs   (the fallback pass needs the local server on PORT=3111 with NF_TOKEN=nf)
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const SHOTS = join(ROOT, 'docs/phase3/p14'); const PAGE = 'file://' + join(ROOT, 'build/pages/p14/index.html');
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + String(d).slice(0, 500)}`); if (!c) fails++; };
const p = await b.newPage({ viewport: { width: 1440, height: 860 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(PAGE); await p.waitForTimeout(600); const txt = () => p.evaluate(() => document.body.innerText); const says = async () => ((await txt()).match(/(Sends|Marks)[^\n]*/) || [''])[0];
let t = await txt(); const main = t.split('Aviator')[0];
ok('opens on INV-7731 held on 2 lines with the proposal ready, no start button', /Invoice INV-7731 is held on 2 lines/.test(t) && /suggestion/.test(t) && !/\b(Start|Play)\b/.test(main), t.slice(0, 300));
ok('the recorded run is labelled Simulated', /Simulated/.test(t));
ok('exactly Approve and Edit suggestion', JSON.stringify(await p.$$eval('.tgk-bar .btns button', (x) => x.map((y) => y.textContent))) === '["Approve","Edit suggestion"]');
ok('first viewport shows the decision', await p.evaluate(() => document.querySelector('.tgk-bar .btns').getBoundingClientRect().bottom <= 860));
ok('click 1 is offered as one request for lines 1 and 2, with no agent credit', /Sends 1 request to Ashby Supplier for a corrected invoice on lines 1 and 2\. Payment stays held\./.test(await says()) && /Trading Grid suggestion/.test(t), await says());
await p.screenshot({ path: join(SHOTS, 'open.png') });
await p.locator('.tgk-tag[data-doc]').first().click(); await p.waitForTimeout(300); ok('a fact’s tag opens the readable document', !!(await p.$('.tgk-drawer[data-open] .tgk-doc'))); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.dblclick('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(1200); t = await txt();
ok('after click 1: the corrected invoice is matched and Match Agent asks for proof of the later delivery', /Match Agent suggestion/.test(t) && /Sends 1 request to Ashby Supplier for the later ship notice and the carrier's delivery receipt on line 2\. Payment stays held\./.test(await says()) && /INV-7731C-S/.test(t), await says());
ok('a double-click approved once', /Ask for the later ship notice/.test(t));
await p.screenshot({ path: join(SHOTS, 'proof.png') });
await p.click('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(1200); t = await txt();
ok('after click 2: Ashby withdraws the claim and short-pay of line 2 is proposed, with no agent credit', /Withdraws its delivery claim/.test(t) && /Trading Grid suggestion/.test(t) && /Marks line 2 to short-pay at payment by the cases the receiving advice does not show\. Payment release stays in accounts payable\./.test(await says()), await says());
await p.click('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(1200); t = await txt();
ok('after click 3: corrected invoice matched, line 2 decided, no supplier claim open', /INV-7731C-S matched/.test(t) && /short-pay decided by Jordan Ellis/.test(t) && /no supplier claim open/.test(t) && /Short-pay decided/.test(t) && !(await p.$('.tgk-bar .btns')), t.slice(0, 600));
ok('the timeline ends at the matched corrected invoice', /INV-7731C-S matched; every held line settled or decided; no supplier claim open/.test(t));
await p.screenshot({ path: join(SHOTS, 'approved.png') });
await p.click('details.ev summary'); await p.waitForTimeout(200); t = await txt();
ok('no payment reads as released', !/payment released|paid to/i.test(t));
ok('no tool name, proposal code or date on screen', !/request_change|release_for_payment|MP-\d|\b20\d\d-\d\d-\d\d\b|\b\d{1,2} November\b/.test(t), (t.match(/.{25}(request_change|release_for_payment|MP-\d|20\d\d-\d\d-\d\d|\d{1,2} November).{20}/) || [])[0]);
ok('the supplier’s answers are marked synthetic in the evidence', /synthetic answer/.test(t));
ok('Ashby sees only the shared documents', /Ashby Supplier sees the shared documents only/.test(t));
ok('no script errors', errs.length === 0, errs.join(' | ')); await p.close();
// A connection that cannot run the model: the page plays the recorded run, labelled, and invents nothing.
{ const q = await b.newPage({ viewport: { width: 1440, height: 860 } });
  await q.exposeFunction('__tgCall', async (server, tool, input) => { try { return await (await fetch(`http://localhost:3111/api/nf/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input || {}) })).json(); } catch { throw new Error('unreachable'); } });
  await q.addInitScript(() => { window.claude = { use: async () => ({ callTool: async (server, tool, input) => ({ payload: await window.__tgCall(server, tool, input) }) }) }; });
  await q.goto(PAGE); await q.waitForTimeout(2500); const tq = await q.evaluate(() => document.body.innerText);
  ok('with no model behind the connection the recorded run plays under Simulated', /Simulated/.test(tq) && /Invoice INV-7731 is held on 2 lines/.test(tq)); await q.close(); }
for (const [w, h] of [[1440, 860], [960, 800], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const q = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme }); const e = []; q.on('pageerror', (x) => e.push(x.message)); await q.goto(PAGE); await q.waitForTimeout(500);
  const over = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${w}px ${scheme}: no horizontal page scroll, no script errors`, over <= 0 && !e.length, `${over} ${e.join('|')}`); await q.close(); }
console.log('Main path: 3 approvals'); await b.close(); process.exit(fails ? 1 : 0);
