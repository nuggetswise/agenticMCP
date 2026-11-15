// Grades five no-context runs of the agent governance questions (T2.3) answered through the live connectors only.
// Expected values come from the built world's governance code (src/governance.js, src/scout.js) and CALLS 78.
import fs from 'fs';
const E = JSON.parse(fs.readFileSync(new URL('./expected.json', import.meta.url)));
const has = (t, s) => t.toLowerCase().includes(String(s).toLowerCase());
const num = (t, v) => new RegExp(`(^|[^\\d.,])\\$?${String(v).replace('.', '\\.')}([^\\d]|$)`).test(t.replace(/,/g, ''));
const R = {
  GQ1: (t, e) => [...e.agents.map((a) => [a, has(t, a)]), ['AP-4.1', has(t, e.rule)], ['$250', num(t, e.limit)]],
  GQ2: (t, e) => [['DC-40877', has(t, 'DC-40877')], ['$88.40', num(t, '88.40') || num(t, '88.4')], ['no next step changes', /no (case'?s? )?next step|next steps? (do(es)? not|would not|stay|unchanged)|none of the next steps|no change (to|in) (the )?next step/i.test(t)]],
  GQ3: (t, e) => [...e.locked.map((r) => [`locked ${r}`, has(t, r)]), ...e.guardrails.map((r) => [`guardrail ${r}`, has(t, r)]), ['an editable action named', e.editable_examples.some((w) => has(t, w))]],
  GQ4: (t, e) => [['659 of 660', num(t, 659)], ['no recorded record changed', /(no|not|unchanged|without)\b[^.]{0,80}(record|world)|(record|world)[^.]{0,60}(unchanged|not changed|untouched)/i.test(t)]],
  GQ5: (t, e) => [...e.agents.map((a) => [a, has(t, a)]), ['NF-7.7', has(t, e.rule)], ['can pause', /can pause|may pause|able to pause|pause_agent/i.test(t)], ['cannot resume', /(cannot|can't|can ?not|may not|does not|no tool to|not able to) resume|resum\w* [^.]{0,60}(person|admin)/i.test(t)]],
};
const runs = fs.readdirSync(new URL('./runs/', import.meta.url)).filter((f) => f.endsWith('.json')).sort();
const out = { runs: runs.length, questions: {} };
for (const id of Object.keys(R)) {
  out.questions[id] = { passed: 0, misses: [] };
  for (const f of runs) { const a = JSON.parse(fs.readFileSync(new URL(`./runs/${f}`, import.meta.url)))[id] || ''; const res = R[id](a, E[id]); if (res.every(([, ok]) => ok)) out.questions[id].passed++; else out.questions[id].misses.push({ run: f, missing: res.filter(([, ok]) => !ok).map(([n]) => n) }); }
}
fs.writeFileSync(new URL('./grade-report.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
for (const [id, q] of Object.entries(out.questions)) console.log(`${id}: ${q.passed} of ${runs.length}${q.misses.length ? ' · ' + JSON.stringify(q.misses) : ''}`);
