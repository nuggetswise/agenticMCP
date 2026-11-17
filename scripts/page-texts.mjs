// Rendered text of the built pages for the contract test (TEXTS=<dir>): each page opened with no connection and walked
// through its main path, one text file per frame. Usage: node scripts/page-texts.mjs <out dir>
let chromium; try { ({ chromium } = await import('playwright')); } catch { const m = await import(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright/index.js'); chromium = m.chromium || m.default.chromium; }
import { join, dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; import { mkdirSync, writeFileSync } from 'node:fs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const OUT = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function frames(id, steps) { const p = await b.newPage({ viewport: { width: 1440, height: 860 } }); await p.goto('file://' + join(ROOT, 'build/pages', id, 'index.html')); await p.waitForTimeout(600);
  const dir = join(OUT, id.toUpperCase()); mkdirSync(dir, { recursive: true }); let n = 0; const snap = async () => writeFileSync(join(dir, `${++n}.txt`), `${id}\nframe ${n}\n` + await p.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); return document.body.innerText; }));
  await snap(); for (const s of steps) { try { await s(p); } catch {} await p.waitForTimeout(600); await snap(); } await p.close(); }
const click = (sel, wait = 0) => async (p) => { await p.click(sel, { timeout: 2000 }); if (wait) await p.waitForTimeout(wait); };
const row = (ref) => click(`.tgk-qrow:has(.ref:text-is("${ref}"))`); const approve = click('.tgk-bar button:has-text("Approve")', 2600);
await frames('p13', ['NR-46215', 'NR-46220', 'NR-46210', 'NR-46226', 'NR-46220'].flatMap((po) => [row(po), approve]).concat([row('NR-46215'), row('NR-46231')]));
await frames('p14', [approve, approve, approve]);
await frames('p15', [click('button:has-text("Replay against the quarter")', 11500), click('button:has-text("Revise draft")'), row('NFD-2')]);
const tab = (t) => click(`[role=tab]:has-text("${t}")`);
await frames('p21', [click('tr:has-text("AP-4.1") button:has-text("Change")'), click('button:has-text("Check effect")'), click('button:has-text("Cancel")'), row('Northfield guide'), row('Standards and law'), tab('Agent authority'), tab('Change list'), click('#sw-n', 600), row('Standards and law'), tab('Draft rules'), click('button:has-text("Replay against the quarter")', 800), tab('Agents'), tab('Connected assistant'), tab('Change list')]);
await b.close(); console.log('texts written to', OUT);
