// Grades the second T0.3 round (14 November) against expected.json. Codes and ids verbatim; money within 0.5%; counts as numbers.
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const dollars = (t) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*([KkMm])?/g)].map((m) => parseFloat(m[1].replace(/,/g, '')) * (/[Mm]/.test(m[2] || '') ? 1e6 : /[Kk]/.test(m[2] || '') ? 1e3 : 1));
const money = (v) => ({ name: '$' + v, ok: (t) => dollars(t).some((x) => Math.abs(x - v) <= v * 0.005) });
const word = (...alts) => ({ name: alts[0], ok: (t) => alts.some((a) => t.toLowerCase().includes(String(a).toLowerCase())) });
const num = (v) => ({ name: String(v), ok: (t) => new RegExp(`(^|[^\\d.,])${v}([^\\d]|$)`).test(t.replace(/,/g, '')) });
const none = (s) => ({ name: `not ${s}`, ok: (t) => !t.includes(s) });
const zero = { name: '0 or none', ok: (t) => num(0).ok(t) || /\b(no|none|zero)\b/i.test(t) };
const R = {
  D1: () => [zero],
  D2: (e) => [num(e.n), money(e.total)],
  N1: (e) => [num(e.n), money(e.total)],
  N4: (e) => [num(e.now), num(e.draft), num(e.suppliers), money(e.exposure)],
  N5: (e) => [num(e.now), num(e.draft)],
  P11a: (e) => [word(e.rules[0]), word(e.rules[1]), word(e.fulfillment), word(e.by), word(e.rule)],
  P11b: (e) => [word(e.asn), word(e.rcv), num(e.cartons), word('no short', 'not short', '0 short', 'short 0', 'shortage: 0', 'no shortage', 'shortage: none', 'zero short', 'in full', 'none short', 'without short', 'nothing short', 'shortage: 0')],
  P11c: (e) => [none(e.absent), word('no such order', 'did not exist', 'does not exist', 'not yet', 'no order', 'had not been', 'before', 'none')],
  G8a: (e) => [money(e.ordered), money(e.confirmed), money(e.in_transit), money(e.received), money(e.invoiced)],
  G8b: (e) => [num(e.count), money(e.total)],
  G8c: (e) => [money(e.released), num(e.orders), { name: `${e.days} days (±1)`, ok: (t) => [e.days - 1, e.days, e.days + 1].some((d) => num(d).ok(t)) }],
};
const dir = new URL('./runs/', import.meta.url);
const runs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const out = {}; const byQ = {};
for (const f of runs) { const a = JSON.parse(fs.readFileSync(new URL(f, dir))); out[f] = {};
  for (const [q, rule] of Object.entries(R)) { const miss = rule(E[q]).filter((c) => !c.ok(String(a[q] || ''))).map((c) => c.name);
    out[f][q] = miss.length ? { pass: false, missing: miss } : { pass: true }; byQ[q] = (byQ[q] || 0) + (miss.length ? 0 : 1); } }
fs.writeFileSync(new URL('./grade-report.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.entries(byQ).map(([q, n]) => `${q} ${n}/${runs.length}`).join('  '));
for (const [f, r] of Object.entries(out)) console.log(f, Object.entries(r).filter(([, v]) => !v.pass).map(([q, v]) => `${q} missing ${v.missing.join(', ')}`).join('; ') || 'all pass');
