// Live proof of the two 0.4.8 fixes on the deployed server, ten asks each on the P14 token:
//  1. "Why is INV-7731 held?": every record reference the answer names was returned by a tool this turn (it is in `read`).
//  2. "Reject INV-7731 line 3 and tell Ashby it is overbilled": answered every time (no no_answer); line 3 refused, the
//     card for lines 1 and 2 raised with no message.
// Writes docs/live-proof/<version>-two-fixes.md. Usage: node scripts/live-ten.mjs [base]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'https://tg-retail-demo-mcp.onrender.com';
const T = JSON.parse(readFileSync(new URL('../pages/pages.json', import.meta.url), 'utf8')).pages.p14.token;
const health = await (await fetch(`${BASE}/healthz`)).json(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REF = /\b[A-Z]{2,5}(?:-[A-Z0-9]+)*-\d[A-Z0-9]*(?:-[A-Z0-9]+)*\b(?!\.\d)/g;
const ask = async (question) => { const r = await fetch(`${BASE}/aviator/${T}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, side: 'northfield' }) }); return { status: r.status, ...(await r.json()) }; };
const rows = [];
for (const [q, test] of [
  ['Why is INV-7731 held?', (r) => { const cited = [...new Set(r.answer?.match(REF) || [])]; const unread = cited.filter((x) => !r.read.some((y) => y.record === x));
    return { pass: r.ok && r.answer_from === 'model' && cited.length > 0 && !unread.length, detail: `cited ${cited.join(', ') || 'none'}${unread.length ? `; not returned: ${unread.join(', ')}` : '; all returned this turn'}` }; }],
  ['Reject INV-7731 line 3 and tell Ashby it is overbilled', (r) => { const c = r.cards?.[0];
    return { pass: r.ok && r.answer_from === 'model' && c?.action === 'send_application_advice' && c.offered_instead?.asked_lines?.join() === '3' && c.offered_instead.lines.join() === '1,2' && !c.message && /line 3/i.test(r.answer) && /line 1/i.test(r.answer) && /line 2/i.test(r.answer),
      detail: r.ok ? `card ${c?.action || 'none'}; refused line ${c?.offered_instead?.asked_lines?.join() || '-'}; card lines ${c?.offered_instead?.lines?.join(', ') || '-'}; message ${c?.message ? `"${c.message.text}"` : 'none'}; rechecked ${r.rechecks ?? '-'}` : `error ${r.error}${r.cause ? ` (${r.cause})` : ''}${r.checks ? `: ${r.checks.join(', ')}` : ''}` }; }],
]) for (let i = 1; i <= 10; i++) { const r = await ask(q); const t = test(r); rows.push({ q, i, status: r.status, answer_from: r.answer_from || r.error, ...t, answer: r.answer || '' }); console.log(`${t.pass ? 'PASS' : 'FAIL'} ${q} #${i}: ${t.detail}`); await sleep(3500); }
const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
mkdirSync(new URL('../docs/live-proof/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../docs/live-proof/${health.version}-two-fixes.md`, import.meta.url), [`# Live proof of the two fixes, ${health.version}, ${new Date().toISOString()}`, '', `P14 token ${T}, Northfield, opening moment 10 Nov 09:00. Model ${health.model_routes?.join(', ')}.`, '',
  '| Request | # | answer_from | Detail | Result |', '|---|---|---|---|---|', ...rows.map((r) => `| ${esc(r.q)} | ${r.i} | ${r.answer_from} | ${esc(r.detail)} | ${r.pass ? 'Passed' : 'Failed'} |`), '', '## Answers', '', ...rows.map((r) => `- ${esc(r.q)} #${r.i}: ${esc(r.answer)}`), ''].join('\n'));
const failed = rows.filter((r) => !r.pass).length; console.log(`${failed ? 'FAILED' : 'All passed'}: ${failed} of ${rows.length} failed`); process.exit(failed ? 1 : 0);
