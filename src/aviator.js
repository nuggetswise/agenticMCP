// Aviator: Trading Grid's own assistant for a company that connects no assistant of its own (Build Guide D56).
// It answers from the same read tools, scopes, refusals and access log as that company's connection, and it never writes:
// an action goes back to the Trading Grid screen for the person's approval (R24). The model is called on the server,
// so the key never reaches a page. Nothing here knows any record: every fact in an answer comes from a tool result.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Model routes in order: the primary key with its models, then the secondary key with its model. A quota (429) or busy (503)
// answer moves to the next route, so a spent primary key falls back to the secondary. Keys never leave the server.
export const modelRoutes = (env = process.env) => [
  ...(env.GEMINI_API_KEY ? (env.GEMINI_MODEL || 'gemini-3.5-flash-lite').split(',').map((m) => ({ key: env.GEMINI_API_KEY, model: m.trim(), route: 'primary' })) : []),
  ...(env.GEMINI_API_KEY_SECONDARY ? (env.GEMINI_MODEL_SECONDARY || 'gemini-3.8-flash').split(',').map((m) => ({ key: env.GEMINI_API_KEY_SECONDARY, model: m.trim(), route: 'secondary' })) : []),
].filter((r) => r.model);
export const AVIATOR_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);

const strip = (s) => { if (Array.isArray(s)) return s.map(strip); if (!s || typeof s !== 'object') return s; const o = {}; for (const [k, v] of Object.entries(s)) if (!['$schema', 'additionalProperties', 'default'].includes(k)) o[k] = strip(v); return o; };
export const declarations = (tools) => tools.map((t) => { const p = strip(zodToJsonSchema(z.object(t.input || {}), { target: 'openApi3' })); return { name: t.name, description: t.description.slice(0, 1000), ...(Object.keys(p.properties || {}).length ? { parameters: p } : {}) }; });

export const instruction = ({ person, company, other, clock }) => `You are Aviator, the assistant inside Trading Grid, acting for ${person} at ${company}. All data is fictional.
Answer only from the results of the tools you call in this conversation. If the tools do not hold the answer, say so; never estimate, and never answer from general knowledge about a record.
Name every record you used (PO number, document reference, case id). Unless the question gives a time, answer as of ${clock}.
A technical acknowledgment (997) is not business acceptance. Records that belong to ${other}, or to any company other than ${company}, are not available to ${company}. If the question names another company, pass it to the tool's supplier field when the tool has one and give the tool's refusal as it reads; otherwise answer "Not available to ${company}" and stop. Never answer a question about another company with ${company}'s own records.
An order or document that ${company} is itself a party to is ${company}'s own: look it up before answering, and answer from what the tools return. Only when the tools return nothing about the event asked about, because it happened inside ${other} before anything reached ${company} (a hold, a correction, an approval), say in one sentence that this part is not available to ${company}, then list what ${company}'s own records show for that order: each document it sent or received, with its reference and its date. Never say a part is not available when a tool returned it.
You cannot send, approve, dispute or change anything. When asked to act, say what would be proposed and that ${person} approves it on the Trading Grid screen.
Keep answers short: the answer first, then the records. Write no calendar dates: the screen shows none, so give the record and, where timing matters, the weekday and time.`;

/** One question, answered by the model calling the connection's read tools. `callTool(name, args)` runs a tool exactly as the connection would. */
export async function ask({ question, history = [], tools, callTool, side, clock, apiKey, fetchImpl = fetch, models = AVIATOR_MODELS, routes, maxTurns = 8 }) {
  routes ||= apiKey ? models.map((m) => ({ key: apiKey, model: m })) : [];
  if (!routes.length) return { ok: false, status: 503, message: 'Aviator has no model key on this server.' };
  if (!question || !String(question).trim()) return { ok: false, status: 400, message: 'Ask a question.' };
  const contents = [...history.slice(-8).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 4000) }] })), { role: 'user', parts: [{ text: String(question).slice(0, 4000) }] }];
  // On the last step the model may call no more tools, so it answers from what it has already read.
  const body = (last) => ({ systemInstruction: { parts: [{ text: instruction({ ...side, clock }) }] }, contents, tools: [{ functionDeclarations: declarations(tools) }], toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : 'AUTO' } }, generationConfig: { temperature: 0 } });
  const called = []; let model = null;
  for (let turn = 0; turn < maxTurns; turn++) {
    let data = null, err = null;
    for (const rt of model ? [model, ...routes.filter((x) => x !== model)] : routes) {
      const r = await fetchImpl(`${API}/${rt.model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': rt.key }, body: JSON.stringify(body(turn === maxTurns - 1)) });
      if (r.ok) { data = await r.json(); model = rt; break; }
      err = { status: r.status, text: (await r.text()).slice(0, 300) }; if (![404, 429, 500, 503].includes(r.status)) break; // unknown or busy model: try the next one
    }
    if (!data) return { ok: false, status: 502, message: `The model did not answer (${err?.status}).`, detail: err?.text, tools_called: called };
    const content = data.candidates?.[0]?.content; const parts = content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) { const text = parts.map((p) => p.text || '').join('').trim(); return { ok: true, answer: text || 'No answer.', answered_from_tools: called.length > 0, tools_called: called, model: model.model, route: model.route }; }
    contents.push(content);
    const known = new Set(tools.map((t) => t.name));
    contents.push({ role: 'user', parts: calls.map(({ functionCall: f }) => { const result = known.has(f.name) ? callTool(f.name, f.args || {}) : { result: 'Refused', message: `Aviator has no tool ${f.name}` }; called.push({ tool: f.name, arguments: f.args || {} }); return { functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } }; }) });
  }
  return { ok: false, status: 502, message: 'Aviator stopped after too many steps without an answer.', tools_called: called };
}
