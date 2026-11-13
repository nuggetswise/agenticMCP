// Aviator: Trading Grid's own assistant for a company that connects no assistant of its own (Build Guide D56).
// It answers from the same read tools, scopes, refusals and access log as that company's connection, and it never writes:
// an action goes back to the Trading Grid screen for the person's approval (R24). The model is called on the server,
// so the key never reaches a page. Nothing here knows any record: every fact in an answer comes from a tool result.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
export const AVIATOR_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-2.5-flash').split(',').map((s) => s.trim()).filter(Boolean);

const strip = (s) => { if (Array.isArray(s)) return s.map(strip); if (!s || typeof s !== 'object') return s; const o = {}; for (const [k, v] of Object.entries(s)) if (!['$schema', 'additionalProperties', 'default'].includes(k)) o[k] = strip(v); return o; };
export const declarations = (tools) => tools.map((t) => { const p = strip(zodToJsonSchema(z.object(t.input || {}), { target: 'openApi3' })); return { name: t.name, description: t.description.slice(0, 1000), ...(Object.keys(p.properties || {}).length ? { parameters: p } : {}) }; });

export const instruction = ({ person, company, other, clock }) => `You are Aviator, the assistant inside Trading Grid, acting for ${person} at ${company}. All data is fictional.
Answer only from the results of the tools you call in this conversation. If the tools do not hold the answer, say so; never estimate, and never answer from general knowledge about a record.
Name every record you used (PO number, document reference, case id). Unless the question gives a time, answer as of ${clock}.
A technical acknowledgment (997) is not business acceptance. Records that belong to ${other} are not available: give the tool's refusal as it reads.
You cannot send, approve, dispute or change anything. When asked to act, say what would be proposed and that ${person} approves it on the Trading Grid screen.
Keep answers short: the answer first, then the records.`;

/** One question, answered by the model calling the connection's read tools. `callTool(name, args)` runs a tool exactly as the connection would. */
export async function ask({ question, history = [], tools, callTool, side, clock, apiKey, fetchImpl = fetch, models = AVIATOR_MODELS, maxTurns = 8 }) {
  if (!apiKey) return { ok: false, status: 503, message: 'Aviator has no model key on this server.' };
  if (!question || !String(question).trim()) return { ok: false, status: 400, message: 'Ask a question.' };
  const contents = [...history.slice(-8).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 4000) }] })), { role: 'user', parts: [{ text: String(question).slice(0, 4000) }] }];
  // On the last step the model may call no more tools, so it answers from what it has already read.
  const body = (last) => ({ systemInstruction: { parts: [{ text: instruction({ ...side, clock }) }] }, contents, tools: [{ functionDeclarations: declarations(tools) }], toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : 'AUTO' } }, generationConfig: { temperature: 0 } });
  const called = []; let model = null;
  for (let turn = 0; turn < maxTurns; turn++) {
    let data = null, err = null;
    for (const m of model ? [model] : models) {
      const r = await fetchImpl(`${API}/${m}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body(turn === maxTurns - 1)) });
      if (r.ok) { data = await r.json(); model = m; break; }
      err = { status: r.status, text: (await r.text()).slice(0, 300) }; if (![404, 429, 500, 503].includes(r.status)) break; // unknown or busy model: try the next one
    }
    if (!data) return { ok: false, status: 502, message: `The model did not answer (${err?.status}).`, detail: err?.text, tools_called: called };
    const content = data.candidates?.[0]?.content; const parts = content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) { const text = parts.map((p) => p.text || '').join('').trim(); return { ok: true, answer: text || 'No answer.', answered_from_tools: called.length > 0, tools_called: called, model }; }
    contents.push(content);
    const known = new Set(tools.map((t) => t.name));
    contents.push({ role: 'user', parts: calls.map(({ functionCall: f }) => { const result = known.has(f.name) ? callTool(f.name, f.args || {}) : { result: 'Refused', message: `Aviator has no tool ${f.name}` }; called.push({ tool: f.name, arguments: f.args || {} }); return { functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } }; }) });
  }
  return { ok: false, status: 502, message: 'Aviator stopped after too many steps without an answer.', tools_called: called };
}
