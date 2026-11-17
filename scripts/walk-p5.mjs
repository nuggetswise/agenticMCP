// Walks P5 in Chrome. Pass 1 (live path): the page talks to the local server through a stubbed connector bridge; the server runs the
// Scout runtime with a scripted stand-in for the model (LOCAL_TEST_SCRIPTED_SCOUT=1), so every server step is real and only the model's
// choices are scripted. Pass 2: the recorded real run built into the page (docs/phase4/runs/scout.json), under Simulated.
// Usage: node scripts/walk-p5.mjs   (needs the local server on PORT=3111 with MCP_TOKEN=ash and LOCAL_TEST_SCRIPTED_SCOUT=1)
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const SHOTS = join(ROOT, 'docs/phase3/p5'); const PAGE = 'file://' + join(ROOT, 'build/pages/p5/index.html');
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + String(d).slice(0, 600)}`); if (!c) fails++; };
const bridge = async (q) => { await q.exposeFunction('__tgCall', async (server, tool, input) => { try { return await (await fetch(`http://localhost:3111/api/ash/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input || {}) })).json(); } catch { throw new Error('unreachable'); } });
  await q.addInitScript(() => { window.claude = { use: async () => ({ callTool: async (server, tool, input) => ({ payload: await window.__tgCall(server, tool, input) }) }) }; }); };
const CODES = /\b(AP|NF)-\d+\.\d+|\bSP-\d|\bKT-\d|scout_|kinross_|erp_|\b20\d\d-\d\d-\d\d\b|\b\d{1,2} December\b|synthetic\)/;
async function walk(live) {
  const p = await b.newPage({ viewport: { width: 1440, height: 860 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); if (live) await bridge(p);
  await p.goto(PAGE); await p.waitForTimeout(live ? 4500 : 3500); const txt = () => p.evaluate(() => document.body.innerText); const says = async () => await p.$eval('.tgk-bar .says', (x) => x.textContent).catch(() => '');
  const approve = async () => { await p.click('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(live ? 1800 : 900); return txt(); };
  const tag = live ? 'live' : 'recorded'; let t = await txt(); const main = t.split('Aviator')[0];
  ok(`${tag}: opens at 17:12 on NR-460207 with six rows, no start button`, /6 Northfield shipments break a rule/.test(t) && /17:12/.test(t) && (await p.$$('.tgk-qrow')).length === 6 && /NR-460207/.test(await p.$eval('.tgk-rhead h2', (x) => x.textContent)) && !/\b(Start|Play)\b/.test(main), t.slice(0, 300));
  ok(`${tag}: ${live ? 'no Simulated label on a live run' : 'the recorded run is labelled Simulated'}`, /Simulated/.test(t) !== live);
  ok(`${tag}: exactly Approve and Edit suggestion`, JSON.stringify(await p.$$eval('.tgk-bar .btns button', (x) => x.map((y) => y.textContent))) === '["Approve","Edit suggestion"]');
  ok(`${tag}: first viewport shows the decision`, await p.evaluate(() => document.querySelector('.tgk-bar .btns').getBoundingClientRect().bottom <= 860), await p.evaluate(() => document.querySelector('.tgk-bar .btns').getBoundingClientRect().bottom));
  ok(`${tag}: only NR-460207 carries a running cutoff`, (await p.$$('.tgk-qrow [data-running]')).length === 1);
  ok(`${tag}: click 1 sends the load task and asks the order desk to correct the ship-to; nothing to Northfield`, /Sends 1 task to Kinross and asks the Ashby order desk to correct the ship-to\. Nothing goes to Northfield\./.test(await says()) && /No decision before the seal: the order ships 659 of 660 cartons\./.test(t), await says());
  ok(`${tag}: Groveport reads 590 against 619, 29 short, before the load takes a case`, /590 cases ASH-MUG-12 against 619 ordered on 3 orders; 29 short/.test(t));
  if (live) await p.screenshot({ path: join(SHOTS, 'open.png') });
  await p.locator('.tgk-tag[data-doc]').first().click(); await p.waitForTimeout(300); ok(`${tag}: a fact’s tag opens the readable document`, !!(await p.$('.tgk-drawer[data-open] .tgk-doc'))); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  t = await approve();
  ok(`${tag}: after click 1 Kinross reports the carton crushed and Scout Agent proposes a replacement case`, /Carton crushed; it cannot be loaded/.test(t) && /Scout Agent suggestion/.test(t) && /replacement case of ASH-MUG-12/.test(t) && /659 of 660 loaded/.test(t) && !/660 of 660 cartons loaded/.test(t), (await says()));
  if (live) await p.screenshot({ path: join(SHOTS, 'replan.png') });
  t = await approve();
  ok(`${tag}: after click 2 Kinross confirms 660 of 660 and the ship notice waits for Priya`, /Replacement case loaded/.test(t) && /660 of 660/.test(t) && /Release ship notice for 660 cartons/.test(t) && /sends the ship notice to Northfield once the trailer departs/i.test(await says()), await says());
  ok(`${tag}: Groveport now reads 589 against 619, 30 short`, /589 cases ASH-MUG-12 against 619 ordered on 3 orders; 30 short/.test(t));
  t = await approve();
  await p.waitForTimeout(300); const head = await p.$eval('.tgk-rhead h2', (x) => x.textContent);
  ok(`${tag}: the queue moved on by itself`, head !== 'NR-460207', head);
  await p.click('.tgk-qrow:has-text("NR-460207")'); await p.waitForTimeout(200); t = await txt();
  ok(`${tag}: after click 3 the timeline ends at Northfield’s receiving advice matching the ship notice`, /Northfield receiving advice RCV-DC2-\S+: 660 cartons at DC 2, matching ship notice/.test(t) && /Received at DC 2 · 660 cartons/.test(t), t.slice(600, 1500));
  await p.click('.tgk-qrow:has-text("NR-460219")'); await p.waitForTimeout(200); t = await txt();
  ok(`${tag}: NR-460219 is a rule fix with no agent credit`, /Trading Grid suggestion/.test(t) && /asks the Ashby billing desk to correct the invoice line\. Nothing goes to Northfield\./i.test(await says()), await says());
  t = await approve(); ok(`${tag}: after click 4 the invoice line is corrected`, /Corrected by Ashby billing desk/.test(t));
  await p.click('.tgk-qrow:has-text("NR-460262")'); await p.waitForTimeout(200); t = await txt();
  ok(`${tag}: NR-460262 drafts one request to the Ashby order desk, no allocation plan by Scout`, !(await p.$('.tgk-opt')) && /Trading Grid suggestion/.test(t) && /Asks the Ashby order desk which order ships short\. Nothing goes to Northfield\./.test(await says()) && /30 cases short/.test(t), await says());
  if (live) await p.screenshot({ path: join(SHOTS, 'shortage.png') });
  t = await approve(); ok(`${tag}: after click 5 NR-460262 waits for the order desk`, /Awaiting Ashby order desk/.test(t));
  await p.click('.tgk-qrow:has-text("NR-460274")'); await p.waitForTimeout(200); t = await approve();
  ok(`${tag}: after click 6 NR-460274 reads Awaiting Jordan Ellis`, /Awaiting Jordan Ellis/.test(t));
  if (live) await p.screenshot({ path: join(SHOTS, 'done.png'), fullPage: true });
  await p.click('#hist'); await p.waitForTimeout(400); t = await txt();
  ok(`${tag}: history shows who recommended, authorised and carried out`, /Recommended by/.test(t) && /Authorised by\s*Priya Raman/.test(t) && /Carried out by\s*Kinross/.test(t));
  ok(`${tag}: Kinross and Northfield answers are marked synthetic`, /synthetic answer/.test(t));
  ok(`${tag}: no write to the Supplier ERP is credited to Scout or Trading Grid`, !/Carried out by\s*Supplier ERP/.test(t) && /Carried out by\s*Ashby order desk/.test(t));
  ok(`${tag}: no rule, proposal or tool code and no date on screen`, !CODES.test(t), (t.match(new RegExp(`.{30}(${CODES.source}).{20}`)) || [])[0]);
  ok(`${tag}: no green tick or success label`, !/[✓✔]|\bSuccess\b|\bCompleted\b/.test(t), (t.match(/.{20}(Completed|Success).{20}/) || [])[0]);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.click('#agents'); await p.waitForTimeout(live ? 800 : 300); t = await txt();
  ok(`${tag}: the setup view lists the facts and locked actions, with no free-text note`, /Scout Agent setup/.test(t) && /Condition of the staged carton/.test(t) && /Always asks/.test(t) && !/note Kinross adds/i.test(t) && !(await p.$('.tgk-drawer textarea')));
  ok(`${tag}: no script errors`, errs.length === 0, errs.join(' | ')); await p.close();
}
await walk(true);
{ const has = await (async () => { const q = await b.newPage(); await q.goto(PAGE); await q.waitForTimeout(3000); const t = await q.evaluate(() => document.body.innerText); await q.close(); return /Simulated/.test(t); })();
  if (has) await walk(false); else ok('recorded: a recorded real run is built into the page', false, 'docs/phase4/runs/scout.json has no steps yet'); }
// Edit suggestion on the live path: the edit is Priya's and the agent's proposal is set aside.
{ const p = await b.newPage({ viewport: { width: 1440, height: 860 } }); await bridge(p); await p.goto(PAGE); await p.waitForTimeout(4500);
  await p.click('.tgk-bar button:has-text("Edit suggestion")'); await p.waitForTimeout(200); await p.locator('.tgk-na .rm').nth(1).click(); await p.waitForTimeout(200);
  ok('edit: the table is editable and a row can be removed', (await p.$$('.tgk-na tbody tr')).length === 1 && /Edited by you/.test(await p.evaluate(() => document.body.innerText)));
  await p.click('.tgk-bar button:has-text("Approve")'); await p.waitForTimeout(1500); const t = await p.evaluate(() => document.body.innerText);
  ok('edit: the timeline records the edit as Priya’s and names what Scout Agent watches for', /Edited by Priya Raman · Scout Agent watching for the Kinross rescan/.test(t) && /Taken over by Priya Raman/.test(t)); await p.close(); }
for (const [w, h] of [[1440, 860], [960, 800], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const q = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme }); const e = []; q.on('pageerror', (x) => e.push(x.message)); await bridge(q); await q.goto(PAGE); await q.waitForTimeout(4200);
  const over = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(`${w}px ${scheme}: no horizontal page scroll, no script errors`, over <= 0 && !e.length, `${over} ${e.join('|')}`); await q.close(); }
console.log('Main path: 6 approvals'); await b.close(); process.exit(fails ? 1 : 0);
