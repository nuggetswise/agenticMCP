// Aviator, tested without a network: a stand-in for the model asks for a tool, the real tool runs on the built world,
// and the answer is whatever the stand-in says after seeing the tool result. Proves the loop, the tool declarations,
// the model fallback and the refusals; it does not prove a live model call.
import { DatabaseSync } from 'node:sqlite';
import { ask, declarations } from '../src/aviator.js';
import { TOOLS, NF_TOOLS } from '../src/tools.js';
const db = new DatabaseSync(new URL('../build/ashby.db', import.meta.url).pathname, { readOnly: true });
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const callTool = (name, args) => TOOLS.find((t) => t.name === name).run(db, args);
const side = { person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer' };
const reply = (parts) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts } }] }), text: async () => '' });
const seen = [];
const model = async (url, init) => { const b = JSON.parse(init.body); seen.push({ url, b, key: init.headers['x-goog-api-key'] });
  if (url.includes('first-model')) return { ok: false, status: 404, text: async () => 'no such model', json: async () => ({}) };
  const last = b.contents[b.contents.length - 1]; const fr = last.parts.find((p) => p.functionResponse);
  if (!fr) return reply([{ functionCall: { name: 'list_deductions', id: 'c1', args: { as_of: '2026-12-10' } } }]);
  const r = fr.functionResponse.response.result; return reply([{ text: `${r.count} cases, $${r.total_amount}: ${r.cases.map((c) => c.case).join(', ')}` }]); };
const a = await ask({ question: 'How many deduction cases this quarter?', tools: TOOLS, callTool, side, clock: 'the story clock', apiKey: 'k', fetchImpl: model, models: ['first-model', 'second-model'] });
ok('answers from the tool result', a.ok && /^5 cases, \$586.8: DC-40877/.test(a.answer), JSON.stringify(a).slice(0, 200));
ok('records the tool it called', a.tools_called.length === 1 && a.tools_called[0].tool === 'list_deductions' && a.answered_from_tools === true);
ok('falls back when a model name is unknown', a.model === 'second-model' && seen[0].url.includes('first-model'));
ok('sends the key in the header, never in the URL', seen.every((s) => s.key === 'k' && !s.url.includes('key=')));
ok('declares every read tool and no write', seen[1].b.tools[0].functionDeclarations.length === TOOLS.length && !seen[1].b.tools[0].functionDeclarations.some((d) => /submit|release|request_change|decide|publish/.test(d.name)));
ok('returns the call id with the result', seen[2].b.contents.at(-1).parts[0].functionResponse.id === 'c1');
ok('tells the model to answer only from tools', /only from the results of the tools/.test(seen[1].b.systemInstruction.parts[0].text));
ok('no key, no answer', (await ask({ question: 'x', tools: TOOLS, callTool, side, clock: '', apiKey: '', fetchImpl: model })).status === 503);
ok('empty question refused', (await ask({ question: ' ', tools: TOOLS, callTool, side, clock: '', apiKey: 'k', fetchImpl: model })).status === 400);
const rogue = async () => reply([{ functionCall: { name: 'submit_dispute', args: {} } }]);
const r = await ask({ question: 'dispute it', tools: TOOLS, callTool: () => { throw new Error('a write ran'); }, side, clock: '', apiKey: 'k', fetchImpl: rogue, models: ['m'], maxTurns: 2 });
ok('a write the model asks for never runs', r.ok === false && r.tools_called.every((c) => c.tool === 'submit_dispute'));
ok('Northfield declarations build', declarations(NF_TOOLS).length === NF_TOOLS.length && declarations(NF_TOOLS).every((d) => d.name && d.description));
console.log(`${pass} Aviator checks passed, ${fail} failed`); process.exit(fail ? 1 : 0);
