// Grades five no-context runs for P8 (definitions stated in the question) and P11 (new set on PO-104912).
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const dollars = (t) => [...t.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*([KkMm])?/g)].map((m) => parseFloat(m[1].replace(/,/g, '')) * (/[Mm]/.test(m[2] || '') ? 1e6 : /[Kk]/.test(m[2] || '') ? 1e3 : 1));
const money = (v) => ({ name: '$' + v, ok: (t) => dollars(t).some((x) => Math.abs(x - v) <= v * 0.005) });
const word = (...alts) => ({ name: alts[0], ok: (t) => alts.some((a) => t.toLowerCase().includes(String(a).toLowerCase())) });
const num = (v) => ({ name: String(v), ok: (t) => new RegExp(`(^|[^\\d.,])${v}([^\\d]|$)`).test(t.replace(/,/g, '')) });
const R = {
  G8a: (e) => [money(e.ordered), money(e.confirmed), money(e.in_transit), money(e.received), money(e.invoiced)],
  G8b: (e) => [num(e.count), money(e.total)],
  G8c: (e) => [money(e.released), num(e.orders), { name: `${e.days} days (±1)`, ok: (t) => [e.days - 1, e.days, e.days + 1].some((d) => num(d).ok(t)) }],
  G11a: (e) => [...e.rules.map((r) => word(r)), ...e.owners.map((o) => word(o)), word('held', 'not sent', 'hold')],
  G11b: (e) => [word(e.by), word(e.rule), word(e.sent, '3:12')],
  G11c: (e) => [word(e.receipt, 'match'), num(e.cartons), word('no charge', 'no deduction', 'none', 'no charges', 'no deductions'), money(e.paid)],
};
const dir = new URL('./runs/', import.meta.url); const runs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const out = {}; const byQ = {};
for (const f of runs) { const a = JSON.parse(fs.readFileSync(new URL(f, dir))); out[f] = {};
  for (const [q, rule] of Object.entries(R)) { const miss = rule(E[q]).filter((c) => !c.ok(String(a[q] || ''))).map((c) => c.name);
    out[f][q] = miss.length ? { pass: false, missing: miss } : { pass: true }; byQ[q] = (byQ[q] || 0) + (miss.length ? 0 : 1); } }
fs.writeFileSync(new URL('./grade-report.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.entries(byQ).map(([q, n]) => `${q} ${n}/${runs.length}`).join('  '));
for (const [f, r] of Object.entries(out)) console.log(f, Object.entries(r).filter(([, v]) => !v.pass).map(([q, v]) => `${q} missing ${v.missing.join(', ')}`).join('; ') || 'all pass');
