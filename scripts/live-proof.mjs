// Live proof against the deployed server on Gemini: free-text requests per side, the message and wrong-line cases, one
// Approve per side (writes once, double press records once, the view reflects it in the session), a second viewer, the
// outside-Trading-Grid refusals and the rate limit. Writes docs/live-proof/<version>.md and .json.
// Usage: node scripts/live-proof.mjs [base]   (default https://tg-retail-demo-mcp.onrender.com)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'https://tg-retail-demo-mcp.onrender.com';
const PAGES = JSON.parse(readFileSync(new URL('../pages/pages.json', import.meta.url), 'utf8')).pages;
const NF = { page: 'p14', token: PAGES.p14.token }, AS = { page: 'p9', token: PAGES.p9.token };
const health = await (await fetch(`${BASE}/healthz`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; const sess = {}; let repeat = null;
const post = async (path, body, headers = {}) => { const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch { } return { status: r.status, ...j }; };
const pub = async (side, tool, q, session) => (await fetch(`${BASE}/public/${side}/tools/${tool}?${new URLSearchParams({ ...q, ...(session ? { session } : {}) })}`)).json();
let lastAsk = 0;
async function ask(P, side, question, as_of, context, sessionKey = P.page) {
  const wait = 3500 - (Date.now() - lastAsk); if (wait > 0) await sleep(wait); // under 20 questions a minute per address
  let r; for (let i = 0; i < 3; i++) { r = await post(`/aviator/${P.token}`, { question, side, ...(as_of ? { as_of } : {}), ...(context ? { context } : {}), ...(sess[sessionKey] ? { session: sess[sessionKey] } : {}) }); lastAsk = Date.now();
    if (r.status !== 429 && r.status !== 503) break; await sleep(15000); }
  if (r.session) sess[sessionKey] = r.session; return r;
}
const sends = (c) => (c ? (c.x12 ? c.x12.split('~').map((s) => s.trim()).filter((s) => /^(TED|NTE)/.test(s)).join(' · ') : `${c.label}: ${c.record}${c.detail ? ` ${JSON.stringify(c.detail)}` : ''}`) : '');
function row(request, side, P, r, verdict, expect) {
  const c = r.cards?.[0];
  verdict = verdict && (r.ok ? r.answer_from === 'model' : false);
  rows.push({ request, side, token: P.token, answer_from: r.answer_from || (r.error ? `error ${r.error}` : null), outcome: c ? `Card: ${c.action}${c.offered_instead ? ` (line ${c.offered_instead.asked_line} refused; line ${c.offered_instead.line} offered)` : ''}` : r.outside_trading_grid ? `Refused: outside Trading Grid, owner ${r.outside_trading_grid.owner}` : r.ok === false || r.status >= 400 ? `Error ${r.status}: ${r.error}` : 'Answer, no card',
    sends: c ? sends(c) : '', answer: r.answer || '', expected: expect, result: verdict ? 'Passed' : 'Failed', card: c || null });
  console.log(`${verdict ? 'PASS' : 'FAIL'} [${side}] ${request} → ${rows.at(-1).outcome}`); return c;
}
const isCard = (r, a) => r.cards?.length >= 1 && r.cards[0].action === a && !('says' in r.cards[0]) && /approve/i.test(r.answer || '');
const noCard = (r) => r.ok && !r.cards?.length;
const outside = (r, owner) => noCard(r) && r.outside_trading_grid?.owner === owner && /outside Trading Grid/.test(r.answer);

// ---- Northfield, P14 (opening 10 Nov 09:00) ----
const N = [
  ['Reject INV-7731 and tell Ashby they billed more cases than received', null, null, (r) => { const c = r.cards?.[0]; const teds = (c?.x12 || '').split('~').map((s) => s.trim()).filter((s) => s.startsWith('TED'));
    return isCard(r, 'send_application_advice') && teds.length >= 1 && teds.every((t) => t.split('*')[2] === 'They billed more cases than received') && /NTE\*GEN\*Invoice quantity above accepted quantity/.test(c.x12) && /they billed more cases than received/i.test(r.answer); }, 'A: 824 card; the words in TED02 of each error they concern, rule cause in a note; Gemini gives the message word for word'],
  ['Reject INV-7790 and tell Ashby line 3 is overbilled', '2026-11-18T15:00:00-05:00', null, (r) => { const c = r.cards?.[0]; return isCard(r, 'send_application_advice') && c.offered_instead?.asked_line === 3 && c.offered_instead.line === 1 && !c.message && !/overbilled/i.test(c.x12 || '') && /line 1/i.test(r.answer); }, 'Line 3 refused; card for line 1 with no message; the words unchanged'],
  ['can you handle it', '2026-11-18T15:00:00-05:00', 'Invoice INV-7790 held on line 1', (r) => isCard(r, 'send_application_advice'), '824 card on INV-7790'],
  ['fix the invoice', null, 'Invoice INV-7731 held', (r) => isCard(r, 'send_application_advice'), '824 card on INV-7731'],
  ['Reverse the shortage charge on DC-40877', '2026-12-03T09:00:00-05:00', null, (r) => isCard(r, 'decide_charge') && r.cards[0].detail?.decision === 'Reversed', 'Charge decision card: reverse'],
  ['sort this out', '2026-12-03T09:00:00-05:00', 'Deduction case DC-40877, shortage charge disputed', (r) => isCard(r, 'decide_charge') || (noCard(r) && /revers|uphold/i.test(r.answer)), 'Charge decision card, or a question: reverse or uphold'],
  ['Apply the readiness chargeback on NR-46602', '2026-12-09T17:30:00-05:00', null, (r) => isCard(r, 'decide_chargeback'), 'Readiness chargeback card'],
  ['Publish NFD-1', '2026-12-28T11:00:00-05:00', null, (r) => isCard(r, 'publish_rule'), 'Publish card citing publish-after-replay'],
  ['Why is INV-7731 held?', null, null, (r) => noCard(r) && r.answer.length > 20, 'Answer, no card'],
  ['tell Kinross to repick', '2026-11-18T15:00:00-05:00', null, (r) => outside(r, 'Kinross'), 'Refused, owner Kinross'],
  ['Email Kinross about the short cartons on NR-462410', '2026-11-18T15:00:00-05:00', null, (r) => outside(r, 'Kinross'), 'Refused, owner Kinross'],
  ['Change the ship-to in Ashby’s ERP for NR-460207', '2026-12-08T18:00:00-05:00', null, (r) => noCard(r) && /outside Trading Grid/.test(r.answer), 'Refused, owner named'],
];
let nfApprove = null;
for (const [q, as_of, ctx, test, expect] of N) { const r = await ask(NF, 'northfield', q, as_of, ctx); const c = row(q, 'northfield', NF, r, test(r), expect); if (q.startsWith('Reject INV-7731') && c) nfApprove = c; }

// ---- Ashby, P9 (opening 26 Oct) ----
const A = [
  ['fix the invoice', '2026-11-10T09:30:00-05:00', 'Invoice INV-7731 rejected by Northfield’s application advice', (r) => isCard(r, 'answer_application_advice'), '997 + corrected invoice card'],
  ['sort this out', '2026-11-18T15:10:00-05:00', 'Ship notice ASN-462410 held', (r) => isCard(r, 'release_held_ship_notice'), 'Release card'],
  ['can you handle it', '2026-11-18T09:00:00-05:00', 'Order NR-46210 has no acknowledgment', (r) => isCard(r, 'send_acknowledgment'), 'Acknowledgment card'],
  ['Send the ship notice for NR-46215', '2026-11-18T09:00:00-05:00', null, (r) => isCard(r, 'send_ship_notice') || (noCard(r) && /scan|depart/i.test(r.answer)), 'Ship notice card, or the record it still needs'],
  ['Invoice NR-46226', '2026-11-18T09:00:00-05:00', null, (r) => isCard(r, 'send_invoice'), 'Invoice card'],
  ['Dispute DC-40877 and tell Northfield the seal was intact on delivery', '2026-12-01T09:00:00-05:00', null, (r) => isCard(r, 'open_dispute') && /The seal was intact on delivery/i.test(r.cards[0].detail?.note || ''), 'Dispute card with the note'],
  ['Send an 824 to Northfield for AA-INV-7731', '2026-11-10T09:05:00-05:00', null, (r) => isCard(r, 'answer_application_advice'), '997 + corrected invoice instead'],
  ['Accept order change 3 on NR-450118', '2026-11-02T14:00:00-05:00', null, (r) => isCard(r, 'answer_order_change'), 'Change acknowledgment card'],
  ['message Jordan the ship notice is late', '2026-11-18T15:00:00-05:00', null, (r) => outside(r, 'Northfield'), 'Refused, owner Northfield'],
  ['Email Kinross and ask for the load scan', '2026-11-18T15:00:00-05:00', null, (r) => outside(r, 'Kinross'), 'Refused, owner Kinross'],
  ['What is the state of DC-40877?', '2026-12-01T09:00:00-05:00', null, (r) => noCard(r) && r.answer.length > 20, 'Answer, no card'],
  ['Update NetSuite with the new ship date for NR-46215', '2026-11-18T09:00:00-05:00', null, (r) => noCard(r) && /outside Trading Grid/.test(r.answer), 'Refused, owner named'],
];
let asApprove = null;
for (const [q, as_of, ctx, test, expect] of A) { const r = await ask(AS, 'ashby', q, as_of, ctx); const c = row(q, 'ashby', AS, r, test(r), expect); if (q.startsWith('Dispute DC-40877') && c) asApprove = c; }

// ---- The same request twice: Gemini writes each answer, so the wording differs ----
{ const q = 'Why is INV-7731 held?'; const a1 = await ask(NF, 'northfield', q, null, null, 'rep1'); const a2 = await ask(NF, 'northfield', q, null, null, 'rep2');
  const differ = a1.ok && a2.ok && a1.answer !== a2.answer && a1.answer_from === 'model' && a2.answer_from === 'model';
  repeat = { request: q, first: a1.answer, second: a2.answer, result: differ ? 'Passed' : 'Failed' }; console.log(`${differ ? 'PASS' : 'FAIL'} same request twice differs`); }

// ---- Approve one card per side; double press; the view in the session; a second viewer ----
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, result: pass ? 'Passed' : 'Failed', detail: String(detail).slice(0, 300) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`); };
if (nfApprove) {
  const p1 = await post(`/aviator/${NF.token}/cards/${nfApprove.id}`, { session: sess.p14, decision: 'approve' }); const p2 = await post(`/aviator/${NF.token}/cards/${nfApprove.id}`, { session: sess.p14, decision: 'approve' });
  check('Northfield Approve writes the 824 once', p1.ok && p1.card?.state === 'Approved' && /TED\*QTY\*They billed more cases than received/i.test(p1.record?.x12 || ''), JSON.stringify(p1.result));
  check('Northfield double press records once', p2.ok && p2.already_recorded === true, JSON.stringify(p2).slice(0, 200));
  const m = await pub('northfield', 'three_way_match', { reference: 'INV-7731', as_of: '2026-11-10T09:01:00-05:00' }, sess.p14);
  const adv = (m.application_advice || []).filter((a) => a.advice === p1.result?.document);
  check('Northfield view in the session lists the 824 once, with the message', adv.length === 1 && adv[0].errors.some((e) => /They billed more cases than received/i.test(e.message)), JSON.stringify(m.application_advice));
  const o = await post(`/aviator/${NF.token}`, { question: 'hello', side: 'northfield' }); const m2 = await pub('northfield', 'three_way_match', { reference: 'INV-7731', as_of: '2026-11-10T09:01:00-05:00' }, o.session);
  check('A second viewer sees nothing changed', o.session && o.session !== sess.p14 && !(m2.application_advice || []).length, JSON.stringify(m2.application_advice));
} else check('Northfield Approve', false, 'no card to approve');
if (asApprove) {
  const p1 = await post(`/aviator/${AS.token}/cards/${asApprove.id}`, { session: sess.p9, decision: 'approve' }); const p2 = await post(`/aviator/${AS.token}/cards/${asApprove.id}`, { session: sess.p9, decision: 'approve' });
  check('Ashby Approve opens the dispute once', p1.ok && p1.card?.state === 'Approved', JSON.stringify(p1.result));
  check('Ashby double press records once', p2.ok && p2.already_recorded === true, JSON.stringify(p2).slice(0, 200));
  const c = await pub('ashby', 'get_deduction_case', { case: 'DC-40877', as_of: '2026-12-01T12:00:00-05:00' }, sess.p9); const d = (c.history || []).filter((h) => h.record === 'case.dispute' && h.via === 'action card');
  check('Ashby view in the session shows one dispute, with the note', d.length === 1 && /seal was intact/i.test(JSON.stringify(d)), JSON.stringify(d).slice(0, 300));
  const o = await post(`/aviator/${AS.token}`, { question: 'hello', side: 'ashby', as_of: '2026-12-01T09:00:00-05:00' }); const c2 = await pub('ashby', 'get_deduction_case', { case: 'DC-40877', as_of: '2026-12-01T12:00:00-05:00' }, o.session);
  check('A second Ashby viewer sees no dispute', o.session && !(c2.history || []).some((h) => h.record === 'case.dispute' && h.via === 'action card'), JSON.stringify(c2.history || []).slice(0, 200));
} else check('Ashby Approve', false, 'no card to approve');

// ---- Rate limit: 429 from one address on Aviator (20 a minute), no bypass through spoofed headers. Empty questions are
// counted by the limit before anything reads or calls the model, so this costs no model calls. ----
await sleep(61000); let first429 = null;
for (let i = 1; i <= 30 && !first429; i++) { const r = await post(`/aviator/${NF.token}`, { question: '', side: 'northfield' }); if (r.status === 429) first429 = i; }
const spoofs = [{ 'X-Forwarded-For': '198.51.100.7' }, { 'CF-Connecting-IP': '198.51.100.8' }, { 'True-Client-IP': '198.51.100.9' }, { 'X-Forwarded-For': '198.51.100.10', 'CF-Connecting-IP': '198.51.100.11', 'True-Client-IP': '198.51.100.12' }];
const spoofed = []; for (const h of spoofs) spoofed.push((await post(`/aviator/${NF.token}`, { question: '', side: 'northfield' }, h)).status);
const lim = await (await fetch(`${BASE}/limits`)).json();
check('Aviator per-minute limit is 20 and answers 429 from one address', lim.aviator_per_address_per_minute === 20 && first429 === 21 && !('aviator_per_address_per_day' in lim), `limit ${lim.aviator_per_address_per_minute}, first 429 at request ${first429}, model cap ${lim.model_calls?.cap}`);
check('No bypass through spoofed X-Forwarded-For, CF-Connecting-IP or True-Client-IP', spoofed.every((x) => x === 429), spoofed.join(','));

const ver = health.version; mkdirSync(new URL('../docs/live-proof/', import.meta.url), { recursive: true });
const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = [`# Live proof ${ver}, ${new Date().toISOString()}`, '', `Server ${BASE}, model ${health.model_routes?.join(', ')}.`, '',
  '| Request | Side | Token | answer_from | Card raised or refused | What the card sends | Result |', '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${esc(r.request)} | ${r.side} | ${r.token} | ${r.answer_from} | ${esc(r.outcome)} | ${esc(r.sends).slice(0, 260)} | ${r.result} |`), '',
  '## Same request twice', '', `Request: ${repeat?.request}. ${repeat?.result}.`, '', `1. ${esc(repeat?.first)}`, '', `2. ${esc(repeat?.second)}`, '',
  '## Answers', '', ...rows.map((r, i) => `${i + 1}. **${esc(r.request)}** (${r.side}): ${esc(r.answer)}`), '',
  '| Check | Result | Detail |', '|---|---|---|', ...checks.map((c) => `| ${esc(c.name)} | ${c.result} | ${esc(c.detail).slice(0, 200)} |`), ''].join('\n');
writeFileSync(new URL(`../docs/live-proof/${ver}.md`, import.meta.url), md); writeFileSync(new URL(`../docs/live-proof/${ver}.json`, import.meta.url), JSON.stringify({ health, rows, checks, repeat }, null, 1));
const failed = rows.filter((r) => r.result === 'Failed').length + checks.filter((c) => c.result === 'Failed').length + (repeat?.result === 'Passed' ? 0 : 1);
console.log(`${failed ? 'FAILED' : 'All live checks passed'}: ${failed} failed`); process.exit(failed ? 1 : 0);
