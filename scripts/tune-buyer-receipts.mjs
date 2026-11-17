// One-off, deterministic transform of the Money in Motion fixture (world/data/buyer-orders.json) for the other suppliers'
// on-time, in-full rates (P7, 17 November 2026). Ashby (s = 0) is not touched. Northfield's delivery window and the rate's
// formula are unchanged. Collect failures stay on Ashby's lines only: another supplier's would need Northfield's routing
// records behind Lakeline's missed pickup. The rest of the formula is unchanged: only the other suppliers' shipping and receiving records move, so each rate reproduces from them.
//   1. Every receipt that arrived after the order's delivery date is moved to the delivery date, and its ship notice to
//      no later than the day before (never before the order, its acknowledgment or a change).
//   2. Each supplier then gets the failures its plan names, from the reasons the rate produces:
//      late       a receipt after the delivery date (Prepaid arrived outside window)
//      below      fewer cases received than the ship notice listed (Received below ship notice)
//      short      a ship notice below the order with the remainder cancelled (Short shipped, remainder cancelled);
//                 the invoice and its payment follow the shipped quantity.
// Run once, on the fixture as it stood before 17 November 2026 (commit e2fc16f): node scripts/tune-buyer-receipts.mjs [in] [out].
import { readFileSync, writeFileSync } from 'node:fs';
const IN = process.argv[2] || new URL('../world/data/buyer-orders.json', import.meta.url).pathname; const OUT = process.argv[3] || IN;
const j = JSON.parse(readFileSync(IN, 'utf8'));
const Q = { from: -42, to: 48 }; // 27 September and 26 December 2026, as days from 8 November
// Plan per supplier index: target rate and the reason that produces most failing cases. Most land 85% to 98%, three lower.
const PLAN = { 1: [0.94, 'late'], 2: [0.74, 'late'], 3: [0.91, 'short'], 4: [0.96, 'below'], 5: [0.78, 'late'], 6: [0.92, 'short'],
  7: [0.97, 'below'], 8: [0.89, 'short'], 9: [0.95, 'late'], 10: [0.93, 'below'], 11: [0.88, 'below'], 12: [0.71, 'short'],
  15: [0.90, 'late'], 16: [0.86, 'below'], 17: [0.98, 'short'], 18: [0.93, 'late'], 19: [0.87, 'late'], 20: [0.96, 'short'], 21: [0.90, 'below'], 22: [0.85, 'late'] };
const due = (p) => p.d0 + j.sup[p.s].lead + j.sup[p.s].transit;
const inQ = (p) => p.s !== 0 && due(p) >= Q.from && due(p) <= Q.to && p.d0 <= 50;
const price = (p, k) => p.lines.find((l) => l.k === k).p;
const floorDay = (p, before) => Math.max(p.d0, ...p.ev.filter((e) => (e[0] === 'ack' || e[0] === 'chg') && e[1] <= before).map((e) => e[1]));
const changes = [];

// 1. On time unless planned otherwise.
for (const p of j.pos.filter(inQ)) {
  if (p.ev.some((e) => e[0] === 'miss')) continue; const d = due(p);
  for (const r of p.ev.filter((e) => e[0] === 'rcv' && e[1] > d)) {
    const a = p.ev.find((e) => e[0] === 'asn' && e[2] === r[2]); let to = d;
    if (a && a[1] >= to) { const lo = floorDay(p, a[1]) + 1; if (lo <= to - 1) { changes.push([p.id, `ship notice ${a[2]} day ${a[1]} to ${to - 1}`]); a[1] = to - 1; } else to = a[1] + 1; }
    if (to < r[1]) { changes.push([p.id, `receipt ${r[2]} day ${r[1]} to ${to}`]); r[1] = to; }
  }
  p.ev.sort((x, y) => x[1] - y[1]);
}

// Current lines of a supplier in the quarter with a receipt.
function lines(s) { const out = [];
  for (const p of j.pos.filter((x) => x.s === Number(s) && inQ(x))) { const ord = Object.fromEntries(p.lines.map((l) => [l.k, l.q])); for (const e of p.ev) if (e[0] === 'chg') Object.assign(ord, e[2]);
    for (const l of p.lines) { const q = ord[l.k]; const rc = p.ev.filter((e) => e[0] === 'rcv' && e[3][l.k] != null); if (q && rc.length) out.push({ p, k: l.k, q, rc }); } }
  return out; }
const fails = (s) => { const L = lines(s); const tot = L.reduce((a, x) => a + x.q, 0); return { L, tot }; };

// 2. The planned failures.
for (const [s, [target, how]] of Object.entries(PLAN)) {
  const { L, tot } = fails(s); if (!L.length) continue; const need = Math.round(tot * (1 - target));
  if (how === 'late' || how === 'collect') {
    // One whole line fails: the order whose cases come closest to the shortfall, skipping orders with more than one receipt.
    const c = L.filter((x) => x.p.ev.filter((e) => e[0] === 'rcv').length === 1).map((x) => ({ x, cases: L.filter((y) => y.p === x.p).reduce((a, y) => a + y.q, 0) })).sort((a, b) => Math.abs(a.cases - need) - Math.abs(b.cases - need))[0];
    if (!c) continue; const p = c.x.p; const r = p.ev.find((e) => e[0] === 'rcv'); const a = p.ev.find((e) => e[0] === 'asn' && e[2] === r[2]);
    if (how === 'late') { const to = due(p) + 1 + Math.abs(p.d0 % 2); const inv = Math.min(...p.ev.filter((e) => e[0] === 'inv').map((e) => e[1]), Infinity); if (r[1] < to) { changes.push([p.id, `receipt ${r[2]} day ${r[1]} to ${to} (late)`]); r[1] = to; if (inv < to) for (const e of p.ev) if (e[0] === 'inv' || e[0] === 'pay') e[1] += to - inv; } }
    else if (!p.ev.some((e) => e[0] === 'miss')) { const at = Math.max(floorDay(p, (a ? a[1] : r[1]) - 1) + 1, (a ? a[1] : r[1]) - 1); if (a && at >= a[1]) continue; p.ev.push(['miss', at]); changes.push([p.id, `missed collect pickup day ${at}`]); }
  } else {
    // Part of one line fails: the largest single-receipt line in the period, short by the planned cases (at most 30% of it).
    const x = L.filter((y) => y.rc.length === 1).sort((a, b) => b.q - a.q || a.p.id.localeCompare(b.p.id))[0]; if (!x) continue;
    const cut = Math.max(1, Math.min(need, Math.floor(x.q * 0.3))); const r = x.rc[0]; const got = r[3][x.k] - cut;
    if (how === 'below') { changes.push([x.p.id, `receipt ${r[2]} ${x.k} ${r[3][x.k]} to ${got} (below ship notice)`]); r[3][x.k] = got; }
    else { const a = x.p.ev.find((e) => e[0] === 'asn' && e[2] === r[2]); const inv = x.p.ev.find((e) => e[0] === 'inv' && e[3][x.k] != null);
      changes.push([x.p.id, `ship notice ${a[2]} ${x.k} ${a[3][x.k]} to ${got}, remainder cancelled; receipt and invoice follow`]);
      a[3][x.k] = got; a[4] = 1; r[3][x.k] = got;
      if (inv) { const was = inv[3][x.k]; inv[3][x.k] = got; const pay = x.p.ev.find((e) => e[0] === 'pay' && e[2] === inv[2]); if (pay) pay[3] -= (was - got) * price(x.p, x.k); } }
  }
  for (const p of j.pos) p.ev.sort((x, y) => x[1] - y[1]);
}
writeFileSync(OUT, JSON.stringify(j));
console.log(`${changes.length} changes`); for (const c of changes) console.log(c.join(': '));
