// One-off, deterministic: writes world/data/buyer-shipments.json, the ship notices and receiving advice for the other
// suppliers' buyer orders that were past their delivery dates with neither (17 November 2026; P24 and P7 need them).
// Source: world/data/buyer-orders.json, the Money in Motion fixture, which stops on 8 November. Ashby (s = 0) is not touched,
// and nothing already in the fixture changes: the new records sit in their own file and are written by the `records` stage.
//   - An order Northfield cancelled with an order change (every line at 0) ships nothing and gets nothing.
//   - Every other order ships what its acknowledgment accepted (the ordered quantity where the supplier sends no
//     acknowledgment), on the supplier's lead time, and is received after the supplier's transit time, on the delivery date.
//   - A backordered quantity ships separately, later.
//   - PLAN names the few that go wrong, each with the reason the on-time, in-full rate reads from the documents.
// Days count from 8 November 2026, as in the fixture. Usage: node scripts/add-buyer-shipments.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const DIR = new URL('../world/data/', import.meta.url).pathname;
const j = JSON.parse(readFileSync(`${DIR}buyer-orders.json`, 'utf8'));
const PLAN = {
  'NR-450020': { late_ship: 2, why: 'Shipped two days after the planned ship date; received two days after the delivery date' },
  'NR-450090': { late_transit: 1, why: 'Shipped on the planned date; the carrier delivered a day after the delivery date' },
  'NR-450188': { short_ship: { L1: 24 }, why: 'Ship notice one case (24 each) below the order; remainder cancelled' },
  'NR-450279': { short_ship: { L1: 120 }, why: 'Ship notice five cases (120 each) below the order; remainder cancelled' },
  'NR-450181': { short_receipt: { L1: 24 }, why: 'One case (24 each) on the ship notice not received at the DC' },
};
const used = new Set(j.pos.flatMap((p) => p.ev.filter((e) => e[0] === 'asn').map((e) => e[2])));
const ref = (p, day) => { let r = `SN${String(p.s).padStart(2, '0')}-${300 + day}`; if (used.has(r)) r = `${r}-${p.id.slice(3)}`; used.add(r); return r; };
const out = {}; const notes = {};
for (const p of j.pos) {
  if (p.s === 0 || p.ev.some((e) => e[0] === 'asn' || e[0] === 'rcv')) continue;
  const qty = Object.fromEntries(p.lines.map((l) => [l.k, l.q])); for (const e of p.ev) if (e[0] === 'chg') Object.assign(qty, e[2]);
  if (Object.values(qty).every((q) => q === 0)) continue; // cancelled by Northfield
  const back = {}; for (const e of p.ev) if (e[0] === 'ack') for (const [k, a] of Object.entries(e[2])) { qty[k] = a[0]; if (a[2]) { back[k] = a[2]; qty[k] = a[0] - a[2]; notes[p.id] = `Acknowledged with ${a[2]} each backordered; the backorder shipped nine days later and arrived after the delivery date`; } else if (a[1] === 'IQ') notes[p.id] = 'Ships the quantity the acknowledgment accepted, below the order'; }
  const f = j.sup[p.s]; const plan = PLAN[p.id] || {}; if (plan.why) notes[p.id] = plan.why;
  const ship = p.d0 + f.lead + (plan.late_ship || 0); const rcv = ship + f.transit + (plan.late_transit || 0);
  const sent = { ...qty }; for (const [k, n] of Object.entries(plan.short_ship || {})) sent[k] -= n;
  const got = { ...sent }; for (const [k, n] of Object.entries(plan.short_receipt || {})) got[k] -= n;
  const ev = []; const r1 = ref(p, ship); const whole = !Object.keys(back).length;
  ev.push(['asn', ship, r1, sent, whole ? 1 : 0], ['rcv', rcv, r1, got]);
  if (!whole) { const r2 = ref(p, ship + 9); ev.push(['asn', ship + 9, r2, back, 1], ['rcv', ship + 9 + f.transit, r2, back]); }
  out[p.id] = ev.sort((a, b) => a[1] - b[1]);
}
writeFileSync(`${DIR}buyer-shipments.json`, `${JSON.stringify({ note: 'Ship notices and receiving advice added on 17 November 2026 for the other suppliers’ buyer orders that had neither. Same event shape as buyer-orders.json. Written by scripts/add-buyer-shipments.mjs.', why: notes, ev: out }, null, 1)}\n`);
const val = (p) => p.lines.reduce((a, l) => a + l.p * l.q, 0) / 100;
const pos = j.pos.filter((p) => out[p.id]);
console.log(`${pos.length} orders from ${new Set(pos.map((p) => p.s)).size} suppliers, $${Math.round(pos.reduce((a, p) => a + val(p), 0)).toLocaleString('en-US')}; days ${Math.min(...Object.values(out).flat().map((e) => e[1]))} to ${Math.max(...Object.values(out).flat().map((e) => e[1]))}`);
for (const [po, w] of Object.entries(notes)) console.log(po, w);
