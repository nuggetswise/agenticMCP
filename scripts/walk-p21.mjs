// Walks P21 Admin and rules in Chrome, twice: through a live connection to a local demo server (the page's connector is
// stood in by a bridge to REST, same tools and tokens), and with no connector (recorded answers under Simulated).
// Usage: start the server with MCP_TOKEN=ash NF_TOKEN=nf PORT=3111, then node scripts/walk-p21.mjs [--offline-only]
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; import { mkdirSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const SHOTS = join(ROOT, 'docs/phase3/p21'); mkdirSync(SHOTS, { recursive: true });
const BASE = process.env.WALK_BASE || 'http://localhost:3111'; const TOK = { RetailStrategy: 'ash', SupplierRetail: 'nf' };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let fails = 0; const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' · ' + String(d).slice(0, 300)}`); if (!c) fails++; };
const calls = [];

async function open(live, viewport = { width: 1440, height: 860 }, scheme = 'light') {
  const p = await b.newPage({ viewport, colorScheme: scheme }); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  if (live) {
    await p.exposeFunction('__tgCall', async (server, tool, input) => { calls.push(tool); const r = await fetch(`${BASE}/api/${TOK[server]}/tools/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input || {}) }); return r.json(); });
    await p.addInitScript(() => { window.claude = { use: async () => ({ callTool: async (server, tool, input) => ({ payload: await window.__tgCall(server, tool, input) }) }) }; });
  }
  await p.goto('file://' + join(ROOT, 'build/pages/p21/index.html')); await p.waitForTimeout(live ? 1500 : 600);
  return { p, errs, txt: () => p.evaluate(() => document.body.innerText) };
}

// ---------- live ----------
if (!process.argv.includes('--offline-only')) {
  await fetch(`${BASE}/admin/ash/reset`, { method: 'POST', redirect: 'manual' });
  const { p, errs, txt } = await open(true);
  let t = await txt();
  ok('opens on Ashby settings, Ashby manual rules, 21 rules', /Ashby’s rules and agent authority/.test(t) && /AP-4\.1/.test(t) && /Ashby manual rules\s*21/.test(t), t.slice(0, 400));
  ok('no Simulated label when the connection answers', !/Simulated/.test(t));
  const vh = await p.evaluate(() => ({ title: document.querySelector('h1').getBoundingClientRect().bottom < 860, change: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Change'); return b && b.getBoundingClientRect().bottom < 860; })() }));
  ok('first viewport shows the title and a Change control at 1440x860', vh.title && vh.change, JSON.stringify(vh));
  await p.screenshot({ path: join(SHOTS, 'ashby-rules.png') });
  // AP-4.1: $250 to $150, effect first, then save (click 1, 2, 3)
  await p.click('tr:has-text("AP-4.1") button:has-text("Change")'); await p.waitForTimeout(200);
  await p.fill('.params input[data-k=max_amount]', '150');
  await p.click('button:has-text("Check effect")'); await p.waitForTimeout(1500); t = await txt();
  ok('effect shown before saving: 5 open deductions, none change who may dispute', /Open records checked\s*5/.test(t) && /Change next step or authority\s*0/.test(t) && /DC-40877/.test(t), t.slice(t.indexOf('AP-4.1'), t.indexOf('AP-4.1') + 700));
  ok('DC-40877 still disputes without asking', /DC-40877\s*Dispute now · Claim Agent may dispute without asking\s*Unchanged/.test(t), t.slice(t.indexOf('DC-40877') - 20, t.indexOf('DC-40877') + 200));
  await p.screenshot({ path: join(SHOTS, 'ashby-effect.png') });
  await p.dblclick('button:has-text("Save change")'); await p.waitForTimeout(1500); t = await txt();
  ok('saved by Priya Raman; the rule reads $150', /Saved by Priya Raman · AP-4\.1 now reads: .*\$150/.test(t), t.slice(0, 600));
  const cl = await (await fetch(`${BASE}/api/ash/tools/get_change_list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  ok('double-click saved once: one rule change on the change list', cl.entries.filter((e) => e.kind === 'rule_change').length === 1, JSON.stringify(cl.entries.map((e) => e.kind)));
  // The next run's authority moves when the limit moves below the charge: AP-4.1 at $80, effect only
  await p.click('tr:has-text("AP-4.1") button:has-text("Change")'); await p.fill('.params input[data-k=max_amount]', '80'); await p.click('button:has-text("Check effect")'); await p.waitForTimeout(1500); t = await txt();
  ok('a limit below $88.40 moves DC-40877 to Priya Raman', /Change next step or authority\s*1/.test(t) && /DC-40877[^\n]*\n?[^\n]*Priya Raman/.test(t), t.slice(t.indexOf('DC-40877') - 20, t.indexOf('DC-40877') + 260));
  await p.click('button:has-text("Cancel")');
  // Agent authority: Shelf Agent's recommend order to Suggest only (click 4, 5)
  await p.click('[role=tab]:has-text("Agent authority")'); await p.waitForTimeout(300);
  t = await txt(); ok('agent authority lists Claim, Scout, Shelf and Pace, with locked actions', ['Claim Agent', 'Scout Agent', 'Shelf Agent', 'Pace Agent'].every((a) => t.includes(a)) && /Locked · Ask before acting/.test(t) && !/Watch Agent/.test(t));
  await p.selectOption('section[aria-label="Shelf Agent"] tr:has-text("Recommend a new order") select', 'suggest'); await p.waitForTimeout(200);
  t = await txt(); ok('the change shows what saving does before it is saved', /Saves 1 change for Shelf Agent: Recommend a new order to Jordan Ellis set to suggest only/.test(t), t.slice(t.indexOf('Saves'), t.indexOf('Saves') + 200));
  await p.click('section[aria-label="Shelf Agent"] button:has-text("Save changes")'); await p.waitForTimeout(1200);
  const st = await (await fetch(`${BASE}/api/ash/tools/get_change_list`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  ok('Shelf Agent recommend order is suggest only on the change list', st.entries.some((e) => e.kind === 'mode' && e.agent === 'Shelf Agent' && e.change.action === 'recommend_order' && e.change.to === 'suggest'));
  await p.screenshot({ path: join(SHOTS, 'ashby-agents.png') });
  // Pause and resume Scout Agent
  await p.click('section[aria-label="Scout Agent"] button:has-text("Pause")'); await p.waitForTimeout(800); t = await txt();
  ok('Scout Agent paused', /Scout Agent\s*Paused/.test(t));
  await p.click('section[aria-label="Scout Agent"] button:has-text("Resume")'); await p.waitForTimeout(800); t = await txt();
  ok('Scout Agent resumed', /Scout Agent\s*Active/.test(t));
  // Change list (click 6)
  await p.click('[role=tab]:has-text("Change list")'); await p.waitForTimeout(300); t = await txt();
  ok('change list shows each change with who made it', /AP-4\.1 changed\s*Limit 250\s*Limit 150\s*Priya Raman/.test(t) && /Shelf Agent approval mode/.test(t) && /Scout Agent paused/.test(t) && /Scout Agent resumed/.test(t), t.slice(t.indexOf('Change list'), t.indexOf('Change list') + 600));
  ok('no date on screen', !/\b(20\d\d-\d\d-\d\d|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b|\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December))/.test(t));
  // Northfield: rules, draft rules, replay and publish NFD-1 (clicks 7 to 10)
  await p.click('#sw-n'); await p.waitForTimeout(1500); t = await txt();
  ok('Northfield admin opens on its guide with 64 rules, 13 in force next quarter', /Northfield guide\s*64/.test(t) && (t.match(/In force next quarter/g) || []).length === 13, t.slice(0, 500));
  ok('Northfield sees no Ashby manual rule', !/AP-4\.1/.test(t));
  await p.screenshot({ path: join(SHOTS, 'northfield-rules.png') });
  await p.click('[role=tab]:has-text("Draft rules")'); await p.waitForTimeout(300); t = await txt();
  ok('draft list holds NFD-1 and NFD-2 only', /NFD-1/.test(t) && /NFD-2/.test(t) && !/NFD-3\b/.test(t));
  await p.click('button:has-text("Replay against the quarter")'); await p.waitForTimeout(2500); t = await txt();
  ok('replay: 32 failing now, 541 with the draft, $76,350', /Failing now\s*32/.test(t) && /With the draft\s*541/.test(t) && /\$76,350/.test(t), t.slice(0, 700));
  ok('publish, revise and keep offered after the replay', ['Publish to suppliers', 'Revise draft', 'Keep as draft'].every((x) => t.includes(x)));
  await p.dblclick('button:has-text("Publish to suppliers")'); await p.waitForTimeout(1500); t = await txt();
  ok('publish recorded for Jordan Ellis’s approval', /Publish recorded for Jordan Ellis’s approval in Trading Grid/.test(t), t.slice(0, 600));
  await p.screenshot({ path: join(SHOTS, 'northfield-publish.png') });
  await p.click('[role=tab]:has-text("Agents")'); await p.waitForTimeout(300); t = await txt();
  ok('Northfield agents: Review, Match and Chase', ['Review Agent', 'Match Agent', 'Chase Agent'].every((a) => t.includes(a)) && !/Claim Agent/.test(t));
  await p.click('[role=tab]:has-text("Connected assistant")'); await p.waitForTimeout(300); t = await txt();
  ok('connected assistant lists its scopes and recent use in business words', /Scopes allowed/i.test(t) && /Draft rules/.test(t) && /Replayed a draft rule/.test(t) && !/replay_draft_rule|list_rules_by_source/.test(t), t.slice(t.toLowerCase().indexOf('scopes'), t.toLowerCase().indexOf('scopes') + 500));
  await p.click('[role=tab]:has-text("Change list")'); await p.waitForTimeout(300); t = await txt();
  ok('Northfield change list does not show Ashby’s changes', !/AP-4\.1/.test(t));
  await p.click('#sw-a'); await p.waitForTimeout(800); t = await txt(); ok('switching back keeps Ashby’s saved change', /Ashby manual rules/.test(t));
  // Keyboard: Tab to the first Change and press Enter
  await p.keyboard.press('Home'); ok('no script errors (live)', errs.length === 0, errs.join(' | '));
  await p.close();
  // Leave the server's world as it was: the walk's changes are undone so a recorded page never carries them.
  for (const t of ['ash', 'nf']) await fetch(`${BASE}/admin/${t}/reset`, { method: 'POST', redirect: 'manual' });
  const banned = calls.filter((c) => /^(scout|claim|shelf|pace|review|match|chase|watch)_(start|decide)$/.test(c));
  ok('the page starts no agent run', banned.length === 0, banned.join(','));
}

// ---------- offline: recorded answers under Simulated ----------
{
  const { p, errs, txt } = await open(false); let t = await txt();
  ok('offline: Simulated label and the recorded rules', /Simulated/.test(t) && /AP-4\.1/.test(t));
  await p.click('tr:has-text("AP-4.1") button:has-text("Change")'); await p.fill('.params input[data-k=max_amount]', '150'); await p.click('button:has-text("Check effect")'); await p.waitForTimeout(600); t = await txt();
  ok('offline: the recorded effect of $150 shows', /Change next step or authority\s*0/.test(t));
  await p.click('button:has-text("Save change")'); await p.waitForTimeout(600); t = await txt();
  ok('offline: nothing is saved and the page says so', /nothing was saved/.test(t));
  ok('no script errors (offline)', errs.length === 0, errs.join(' | ')); await p.close();
}

// ---------- widths and themes ----------
for (const [w, h] of [[1440, 860], [960, 800], [390, 844]]) for (const scheme of ['light', 'dark']) {
  const { p, errs } = await open(false, { width: w, height: h }, scheme);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${w}px ${scheme}: no horizontal page scroll`, over <= 0, String(over));
  if (w === 390) await p.screenshot({ path: join(SHOTS, `mobile-${scheme}.png`), fullPage: false });
  ok(`${w}px ${scheme}: no script errors`, errs.length === 0, errs.join(' | ')); await p.close();
}
{ const { p } = await open(false, { width: 1440, height: 860 }, 'dark'); await p.screenshot({ path: join(SHOTS, 'ashby-rules-dark.png') }); await p.close(); }
console.log('Main path: 10 actions (Change, Check effect, Save change; mode select, Save changes; Change list; switch, Draft rules, Replay, Publish)');
await b.close(); process.exit(fails ? 1 : 0);
