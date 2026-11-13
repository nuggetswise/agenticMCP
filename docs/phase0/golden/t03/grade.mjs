// Grades the T0.3 no-context runs against expected.json. Codes and ids must appear verbatim.
// Money passes when some dollar figure in the answer is within 0.5% of the expected value; counts and days must appear as numbers.
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const dollars = (t) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*([KkMm])?/g)].map((m) => parseFloat(m[1].replace(/,/g, '')) * (/[Mm]/.test(m[2] || '') ? 1e6 : /[Kk]/.test(m[2] || '') ? 1e3 : 1));
const money = (v) => ({ name: '$' + v, ok: (t) => dollars(t).some((x) => Math.abs(x - v) <= v * 0.005) });
const word = (...alts) => ({ name: alts[0], ok: (t) => alts.some((a) => t.toLowerCase().includes(String(a).toLowerCase())) });
const num = (v) => ({ name: String(v), ok: (t) => new RegExp(`(^|[^\\d.,])${v}([^\\d]|$)`).test(t.replace(/,/g, '')) });
const R = {
  G5a: (e) => [word(e.next_step), word('not departed', 'not yet departed', 'has not departed', 'no departure'), word('fulfil', 'fulfill')],
  G5b: (e) => [word(e.next_step), word(e.rule), num(e.billed), num(e.shipped)],
  G9a: (e) => [word(e.next_step), word(e.in_transit)],
  G9b: (e) => [word(e.next_step), num(e.pairs)],
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
