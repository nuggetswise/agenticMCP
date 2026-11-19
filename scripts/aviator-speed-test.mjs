// Aviator's call count, tested without a network (19 November 2026). Each model call on the free tier waits seconds, so
// the server reads the record on screen before the first call, accepts "quarter" as a period, reads "the next two weeks",
// and skips a route Google reports spent for the day. A stand-in model counts the calls; it does not prove a live answer.
process.env.NO_LISTEN = '1';
import { DatabaseSync } from 'node:sqlite';
const { ask, resetSpentRoutes, dailyQuotaSpent } = await import('../src/aviator.js');
const { TOOLS } = await import('../src/tools.js');
const { resolvePeriod } = await import('../src/domain.js');
const { askedPeriod, prereadFor } = await import('../src/server.js');
const db = new DatabaseSync(new URL('../build/ashby.db', import.meta.url).pathname, { readOnly: true });
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const callTool = (name, args) => TOOLS.find((t) => t.name === name).run(db, args);
const side = { person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer' };
const reply = (parts) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }), text: async () => '' });
const names = new Set(TOOLS.map((t) => t.name));

// 1. The record on screen, read before the first model call: a question about it takes one model call.
const pre = prereadFor('ashby', 'Why is NR-46215 Late?', 'Purchase order NR-46210', names);
ok('the reference in the question wins over the record in the context', pre && pre.tool === 'get_order' && pre.arguments.po === 'NR-46215', JSON.stringify(pre));
ok('a quarter-wide question reads no single record from the context', prereadFor('ashby', 'How many Northfield orders missed a required document this quarter?', 'Purchase order NR-46210', names) === null);
ok('a question about the open record reads it from the context', prereadFor('ashby', 'Why is it held?', 'Purchase order NR-460207', names)?.arguments.po === 'NR-460207');
ok('Northfield reads an invoice with the three-way match', prereadFor('northfield', 'Why is INV-7731 held?', '', new Set(['three_way_match']))?.tool === 'three_way_match');
let calls = 0; const one = async (url, init) => { calls++; const b = JSON.parse(init.body); ok('no forced tool call when a record was read for the model', b.toolConfig.functionCallingConfig.mode !== 'ANY'); return reply([{ text: 'Purchase order NR-46215 is late because ship notice ASN-46215 went after the departure scan.' }]); };
const r = callTool('get_order', { po: 'NR-46215', as_of: '2026-11-18T09:45:00-05:00' });
const a = await ask({ question: 'Why is NR-46215 Late?', prereadText: ` The record on screen, read for you: ${JSON.stringify(r)}`, preread: [pre], tools: TOOLS, callTool, side, clock: 'x', apiKey: 'k', fetchImpl: one, models: ['m'] });
ok('answers in one model call', a.ok && calls === 1 && a.answered_from_tools === true, JSON.stringify(a).slice(0, 200));

// 2. "quarter" is a period meaning the whole quarter, the same as naming none.
ok('period quarter resolves to the whole quarter', resolvePeriod({ period: 'quarter' }) === null);
const q = TOOLS.find((t) => t.name === 'get_scorecard').run(db, { period: 'quarter', as_of: '2026-12-28T09:00:00-05:00' });
ok('get_scorecard answers period quarter instead of refusing it', q.calculated === true && !q.error, JSON.stringify(q).slice(0, 200));
ok('get_scorecard sends every line only when asked', q.lines === undefined && Array.isArray(TOOLS.find((t) => t.name === 'get_scorecard').run(db, { lines: true, as_of: '2026-12-28T09:00:00-05:00' }).lines));

// 3. "The next two weeks" runs from the as-of day through fourteen days.
const p = askedPeriod('How much open-order value falls due in the next two weeks, by supplier?', new Date('2026-11-09T04:59:00Z'));
ok('"the next two weeks" is read as fourteen days from the as-of day', p && p.from === '2026-11-08' && p.to === '2026-11-21', JSON.stringify(p));

// 4. A route Google reports spent for the day is skipped, not retried; per-minute limits still retry.
ok('a daily quota message is recognised', dailyQuotaSpent(429, 'Generate content requests per day limit exceeded on Free Tier') && !dailyQuotaSpent(429, 'requests per minute'));
resetSpentRoutes(); let hits = 0;
const spent = async () => { hits++; return { ok: false, status: 429, text: async () => 'Quota exceeded: requests per day limit exceeded. Please retry in 14h23m51s.', json: async () => ({}) }; };
const s1 = await ask({ question: 'q', tools: TOOLS, callTool, side, clock: 'x', routes: [{ key: 'k', model: 'm', route: 'primary' }], fetchImpl: spent, wait: 1 });
ok('a spent route answers at once with the cap, after one call', !s1.ok && s1.capped && hits === 1, `${hits} ${JSON.stringify(s1)}`);
const s2 = await ask({ question: 'q', tools: TOOLS, callTool, side, clock: 'x', routes: [{ key: 'k', model: 'm', route: 'primary' }], fetchImpl: spent, wait: 1 });
ok('the next question does not call a spent route again', !s2.ok && s2.capped && hits === 1, `${hits}`);
resetSpentRoutes();

console.log(`${pass} Aviator speed checks passed, ${fail} failed`); process.exit(fail ? 1 : 0);
