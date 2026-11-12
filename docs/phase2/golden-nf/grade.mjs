// Grades Northfield-scope runs against expected.json (SQL only, on build/northfield.db). A question passes when every
// value derived from its SQL row appears in the answer.
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const money = (n) => [n.toFixed(2), n.toLocaleString('en-US', { minimumFractionDigits: 2 }), n.toLocaleString('en-US')];
const n = (v) => [String(v), Number(v).toLocaleString('en-US')];
const R = {
  N1: (r) => [n(r.n), money(r.total)],
  N2: (r) => [n(r.billed), n(r.shipped), [r.next_step]],
  N3: (r) => [[r.corrected], [r.next_step]],
  N4: (r) => [n(r.now), n(r.draft), ['Ashby'], money(r.exposure)],
  N5: (r) => [r.failing === 0 ? ['0', 'no ', 'none', 'nothing'] : n(r.failing)],
  N6: (r) => [n(r.docs), n(r.fails), n(r.ch824), n(r.fails - r.ch824)],
  N7: (r) => [['Bill of lading'], ['Delivery receipt'], ['Load scan'], [r.next_step]],
  N8: (r) => [r.visible === 0 ? ['Not available to Northfield'] : ['WSA-45620']],
  N9: (r) => [['91.0%', '91%', '0.91'], n(r.lines)],
  N10: (r) => [...r.decisions.split(';').map((x) => [x.split(':')[1]]), [r.decided_by]],
};
const dir = new URL('./runs/', import.meta.url); const runs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const out = {}; let total = 0, pass = 0;
for (const f of runs) { const a = JSON.parse(fs.readFileSync(new URL(f, dir))); out[f] = {};
  for (const [q, rule] of Object.entries(R)) { const need = rule(E[q][0]); const t = String(a[q] || '').toLowerCase(); const miss = need.filter((alts) => !alts.some((x) => t.includes(String(x).toLowerCase())));
    out[f][q] = miss.length ? { pass: false, missing: miss.map((m) => m[0]) } : { pass: true }; total++; if (!miss.length) pass++; } }
fs.writeFileSync(new URL('./grade-report.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`${pass} of ${total}`); for (const [f, r] of Object.entries(out)) console.log(f, Object.entries(r).filter(([, v]) => !v.pass).map(([q, v]) => `${q} missing ${v.missing.join(', ')}`).join('; ') || 'all pass');
