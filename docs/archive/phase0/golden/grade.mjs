// Grades the no-context runs against expected.json (built from SQL alone). Each question passes when every
// required value derived from its SQL row appears in the answer. No reading, no judgment.
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const money = (n) => [n.toFixed(2), n.toLocaleString('en-US', { minimumFractionDigits: 2 })];
const pct = (x) => [(x * 100).toFixed(1) + '%', String(x)];
const site = (s) => ({ 'KIN-JOL': ['Joliet', 'KIN-JOL'], 'KIN-GRV': ['Groveport', 'KIN-GRV'] }[s]);
const date = (d) => { const [y, m, dd] = d.split('-'); const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]; return [d, `${+dd} ${mon} ${y}`, `${mon} ${+dd}, ${y}`]; };
const n = (v) => [String(v), Number(v).toLocaleString('en-US')];
const R = {
  S1: (r) => [pct(r.official), n(r.cases), n(r.compliant), n(r.failing_lines)],
  S2: (r) => [n(r.total), [r.sku], site(r.site), n(r.lines), n(r.cases)],
  A1: (r) => [[r.next_step], [r.sku], site(r.site)],
  D1: (r) => [r.n === 0 ? ['0', 'no ', 'none', 'zero'] : n(r.n)],
  D2: (r) => [[String(r.n), 'five'], money(r.total)],
  D3: (r) => [[r.charge], money(r.amount), [r.deduction], date(r.deadline)],
  D4: (r) => [...r.decisions.split(';').map((x) => [x.split(':')[1]]), money(r.repaid), [r.payment]],
  A2: (r) => [[r.next_step]],
  A3: (r) => [[r.next_step], [r.delivery_exception]],
  A4: (r) => [n(r.loaded), n(r.expected), [r.next_step]],
};
const runs = fs.readdirSync(new URL('./runs/', import.meta.url)).filter((f) => f.endsWith('.json')).sort();
const out = {}; let total = 0, pass = 0;
for (const f of runs) { const a = JSON.parse(fs.readFileSync(new URL('./runs/' + f, import.meta.url))); out[f] = {};
  for (const [q, rule] of Object.entries(R)) { const need = rule(E[q][0]); const t = String(a[q] || ''); const miss = need.filter((alts) => !alts.some((x) => t.toLowerCase().includes(String(x).toLowerCase())));
    out[f][q] = miss.length ? { pass: false, missing: miss.map((m) => m[0]) } : { pass: true }; total++; if (!miss.length) pass++; } }
fs.writeFileSync(new URL('./grade-report.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`${pass} of ${total}`); for (const [f, r] of Object.entries(out)) console.log(f, Object.entries(r).filter(([, v]) => !v.pass).map(([q, v]) => `${q} missing ${v.missing.join(', ')}`).join('; ') || 'all pass');
