// CALLS 66. Runs P8's own engine on (a) the page's order records and (b) orders picked from the world by a stated rule,
// to show which definitions the shared records need before they reproduce the screen. Run from the repo root after `npm run build`:
//   node --no-warnings docs/phase0/walks/P8/definitions-check.mjs
import { readFileSync } from 'node:fs'; import vm from 'node:vm'; import { DatabaseSync } from 'node:sqlite';
import { buyerFixture } from '../../../../src/score.js';
const sb = { module: { exports: {} } }; vm.runInNewContext(readFileSync('docs/phase0/walks/P8/mim-engine.js', 'utf8'), sb); const E = sb.module.exports;
const fx = JSON.parse(readFileSync('world/data/buyer-orders.json', 'utf8')); const db = new DatabaseSync('build/tg.db');
const supOf = (po) => db.prepare('SELECT supplier_id s FROM orders WHERE po = ?').get(po).s;
const supIdx = {}; for (const p of fx.pos) supIdx[supOf(p.id)] = p.s;
const line = (name, n, f) => { const o = E.compute(f, 0), r = E.replay(f, 0, 'A', 90); const c = (v) => (v / 100).toFixed(2);
  console.log(`${name}\n  orders in set ${n} · open ${o.openPOs} · ordered ${c(o.buckets.ord)} · confirmed ${c(o.buckets.con)} · in transit ${c(o.buckets.tra)} · received ${c(o.buckets.rec)} · invoiced ${c(o.buckets.inv)}\n  billed above received: ${o.gaps.g4.length} orders, ${c(o.gapTotals.g4)} · released at acknowledgment: ${c(r.released)} over ${r.orders} orders, ${r.daysEarlier.toFixed(1)} days earlier`); };
line('Screen: the page\'s own order records', fx.pos.length, fx);
const END = "received_at < '2026-11-09T05:00:00Z'";
for (const [name, where] of [['Records: buyer orders placed 13 July to 8 November', `stream = 'buyer' AND received_at >= '2026-07-13' AND ${END}`], ['Records: every buyer order to 8 November', `stream = 'buyer' AND ${END}`], ['Records: every order to 8 November, replenishment included', END]]) {
  const ids = db.prepare(`SELECT po FROM orders WHERE ${where} ORDER BY po`).all().map((r) => r.po);
  line(name, ids.length, { sup: fx.sup, pos: buyerFixture(db, ids, '2026-11-08').map((p) => ({ ...p, s: supIdx[supOf(p.id)] })) }); }
