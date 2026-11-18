import * as AV from '../src/aviator.js';
import { z } from 'zod';
const tools = [{ name: 'get_order', description: 'x', input: { po: z.string() } }];
let n = 0; const seq = [503, 429, 'text', 'call', 'final'];
const fetchImpl = async (url, o) => { const step = seq[n++]; const b = JSON.parse(o.body); const mode = b.toolConfig.functionCallingConfig.mode;
  if (typeof step === 'number') return { ok: false, status: step, text: async () => 'busy' };
  if (step === 'text') return { ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Not available.' }] } }] }) };
  if (step === 'call') { if (mode !== 'ANY') throw new Error('expected ANY, got ' + mode); return { ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'get_order', args: { po: 'NR-1' } } }] } }] }) }; }
  return { ok: true, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: 'Answer from NR-1.' }] } }] }) }; };
const out = await AV.ask({ question: 'q', tools, callTool: () => ({ found: true }), side: { person: 'P', company: 'C', other: 'O' }, clock: 'now', routes: [{ key: 'k', model: 'm', route: 'primary' }], fetchImpl, wait: 5 });
console.log(JSON.stringify(out), 'calls', n);
if (!(out.ok && out.answered_from_tools && n === 5)) { console.error('FAIL aviator retry and forced tool call'); process.exit(1); } console.log('PASS aviator: busy answers retried, an answer before any tool call asked again with a tool required');
