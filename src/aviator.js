// Aviator: Trading Grid's own assistant for a company that connects no assistant of its own (Build Guide D56).
// It answers from the same read tools, scopes, refusals and access log as that company's connection, and it never writes:
// an action goes back to the Trading Grid screen for the person's approval (R24). The model is called on the server,
// so the key never reaches a page. Nothing here knows any record: every fact in an answer comes from a tool result.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { takeModelCall, MESSAGES } from './limits.js';

// GEMINI_API_BASE points a local test at a stand-in model; the server uses Google's endpoint.
export const modelApi = () => (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta/models').replace(/\/$/, '');
// Model routes in order: the primary key with its models, then the secondary key with its model. A quota (429) or busy (503)
// answer moves to the next route, so a spent primary key falls back to the secondary. Keys never leave the server.
export const modelRoutes = (env = process.env) => [
  ...(env.GEMINI_API_KEY ? (env.GEMINI_MODEL || 'gemini-3.5-flash-lite').split(',').map((m) => ({ key: env.GEMINI_API_KEY, model: m.trim(), route: 'primary' })) : []),
  ...(env.GEMINI_API_KEY_SECONDARY ? (env.GEMINI_MODEL_SECONDARY || 'gemini-3.8-flash').split(',').map((m) => ({ key: env.GEMINI_API_KEY_SECONDARY, model: m.trim(), route: 'secondary' })) : []),
].filter((r) => r.model);
export const AVIATOR_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);

// Tool schemas for the model. The model reads a subset of OpenAPI 3 and takes enums only as strings, so every tool on
// both connections, and every runtime's own tools, goes through `toModel` here, and every call the model makes goes back
// through `modelArgs` before a tool runs. Nothing else converts a schema for the model.
//   - Keys outside the model's subset are dropped.
//   - A non-string enum, a const, or a union of literals (z.union([z.literal(24), z.literal(48)])) becomes a string enum
//     ("24", "48"); `modelArgs` gives the tool the original value (24) back.
//   - A union of other schemas keeps anyOf, each branch converted.
//   - A free-form object (z.record: no named properties) is sent as a JSON string, and parsed back.
const KEEP = new Set(['type', 'format', 'title', 'description', 'nullable', 'enum', 'items', 'properties', 'required', 'minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength', 'anyOf', 'propertyOrdering']);
const FORMATS = { string: ['date-time', 'enum'], number: ['float', 'double'], integer: ['int32', 'int64'] };
const raw = (t) => zodToJsonSchema(z.object(t.input || {}), { target: 'openApi3' });
const literalsOf = (s) => (s.enum ? s.enum : 'const' in s ? [s.const] : s.anyOf && s.anyOf.every((b) => b.enum || 'const' in b) ? s.anyOf.flatMap(literalsOf) : null);
const freeObject = (s) => s.type === 'object' && !Object.keys(s.properties || {}).length;
export function toModel(s) {
  if (!s || typeof s !== 'object') return s;
  const lits = literalsOf(s); const desc = s.description ? { description: s.description } : {};
  if (lits) { const strs = [...new Set(lits.filter((v) => v !== null).map(String))]; return { type: 'string', ...desc, enum: strs, ...(lits.includes(null) || s.nullable ? { nullable: true } : {}) }; }
  if (freeObject(s)) return { type: 'string', description: `${s.description ? `${s.description}. ` : ''}A JSON object, written as text.` };
  if (Array.isArray(s.type)) { const t = s.type.filter((x) => x !== 'null'); return toModel({ ...s, type: t[0] || 'string', ...(s.type.includes('null') ? { nullable: true } : {}) }); }
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (!KEEP.has(k)) continue;
    if (k === 'properties') o.properties = Object.fromEntries(Object.entries(v).map(([p, x]) => [p, toModel(x)]));
    else if (k === 'items') o.items = toModel(v);
    else if (k === 'anyOf') o.anyOf = v.map(toModel);
    else if (k === 'format') { if ((FORMATS[s.type] || []).includes(v)) o.format = v; }
    else o[k] = v;
  }
  return o;
}
/** The model's arguments as the tool's own schema reads them: "24" back to 24, "true" to true, a JSON string to its object. */
function restore(s, v) {
  if (!s || v === undefined || v === null) return v;
  const lits = literalsOf(s); if (lits && typeof v === 'string') { const hit = lits.find((x) => String(x) === v); return hit === undefined ? v : hit; }
  if (freeObject(s) && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  if (s.anyOf) { for (const b of s.anyOf) { const r = restore(b, v); if (r !== v) return r; } return v; }
  const type = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
  if ((type === 'number' || type === 'integer') && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (type === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  if (type === 'array' && Array.isArray(v)) return v.map((x) => restore(s.items, x));
  if (type === 'object' && v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(s.properties?.[k], x)]));
  return v;
}
export const modelArgs = (tools, name, args) => { const t = tools.find((x) => x.name === name); return t ? restore(raw(t), args || {}) : (args || {}); };
/** Every place a declaration leaves the model's subset, as path: problem. Empty when the model will accept it. */
export function modelSchemaProblems(decl) {
  const out = []; const TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];
  const walk = (s, p) => {
    for (const k of Object.keys(s)) if (!KEEP.has(k)) out.push(`${p}: key ${k}`);
    if (!TYPES.includes(s.type) && !s.anyOf) out.push(`${p}: type ${JSON.stringify(s.type)}`);
    if (s.enum && (s.type !== 'string' || s.enum.some((v) => typeof v !== 'string'))) out.push(`${p}: enum ${JSON.stringify(s.enum)} on type ${s.type}`);
    if (s.format && !(FORMATS[s.type] || []).includes(s.format)) out.push(`${p}: format ${s.format}`);
    if (s.type === 'object') { if (!Object.keys(s.properties || {}).length) out.push(`${p}: object with no properties`); for (const r of s.required || []) if (!s.properties?.[r]) out.push(`${p}: required ${r} is not a property`); }
    if (s.type === 'array' && !s.items) out.push(`${p}: array with no items`);
    for (const [k, v] of Object.entries(s.properties || {})) walk(v, `${p}.${k}`);
    if (s.items) walk(s.items, `${p}[]`); (s.anyOf || []).forEach((b, i) => walk(b, `${p}|${i}`));
  };
  for (const d of decl) { if (!/^[a-zA-Z_][\w.-]{0,63}$/.test(d.name)) out.push(`${d.name}: name`); if (d.parameters) walk(d.parameters, d.name); }
  return out;
}
export const declarations = (tools) => tools.map((t) => { const p = toModel(raw(t)); return { name: t.name, description: t.description.slice(0, 1000), ...(Object.keys(p.properties || {}).length ? { parameters: p } : {}) }; });

export const instruction = ({ person, company, other, clock, cards = false }) => `You are Aviator, the assistant inside Trading Grid, acting for ${person} at ${company}. All data is fictional.
Answer only from the results of the tools you call in this conversation. If the tools do not hold the answer, say so; never estimate, and never answer from general knowledge about a record.
Name every record you used (PO number, document reference, case id). Unless the question gives a time, answer as of ${clock}.
When the question or its context gives a time (as_of, or "As of"), that is now: pass it as as_of to every tool that takes one, and never mention a record, a status or an outcome dated after it, even when a tool returns one.
A technical acknowledgment (997) is not business acceptance. Records that belong to ${other}, or to any company other than ${company}, are not available to ${company}. If the question names another company, pass it to the tool's supplier field when the tool has one and give the tool's refusal as it reads; otherwise answer "Not available to ${company}" and stop. Never answer a question about another company with ${company}'s own records.
An order or document that ${company} is itself a party to is ${company}'s own: look it up before answering, and answer from what the tools return. Only when the tools return nothing about the event asked about, because it happened inside ${other} before anything reached ${company} (a hold, a correction, an approval), say in one sentence that this part is not available to ${company}, then list what ${company}'s own records show for that order: each document it sent or received, with its reference and its date. Never say a part is not available when a tool returned it.
${cards ? `You never act yourself. When ${person} asks you to do something Trading Grid does (send a business document, open a dispute, release a held ship notice, decide a charge or a chargeback, reject a document with an application advice, publish a rule), call propose_action with the action and the record it concerns. The server builds a card that says what happens, to whom and under which rule, and nothing happens until ${person} presses Approve. Say the card is ready; never say it is done. Propose only what was asked, never unasked. If asked to email, call, message or instruct anyone, or to change another company's system, say plainly that it is done outside Trading Grid, name who owns it and where, and propose nothing.` : `You cannot send, approve, dispute or change anything. When asked to act, say what would be proposed and that ${person} approves it on the Trading Grid screen.`}
Give every quantity in the unit the record names (quantities_in, counting_unit, or a line's uom: CA is cases, EA is each); never call a quantity units. Ashby's orders with Northfield are in cases.
Write for a business reader: name a record by its reference and what it is (ship notice ASN-46215, Kinross load scan), never by a field name or a record kind such as wms.load_scan, and write cases or each, never CA or EA.
A week runs Sunday to Saturday. "This week", "last week" and "next week" are counted from the as-of time, never from today's date. When the question names a week, dates or a period, pass it to every tool that takes from and to (or period), answer for that period only, and say which days the answer covers; when it names a warehouse, pass it. Never give a quarter's figure for a week, or one record for a question about all of them.
Keep answers short: the answer first, then the records, in plain sentences with no markdown. Write no calendar dates and work out no weekday: where timing matters give the time as the record shows it (17:21 ET), and say the day before or the next day when it is not the day asked about.`;

/** One question, answered by the model calling the connection's read tools. `callTool(name, args)` runs a tool exactly as the connection would. */
export async function ask({ question, history = [], tools, callTool, side, clock, cards = false, apiKey, fetchImpl = fetch, models = AVIATOR_MODELS, routes, maxTurns = 8, wait = 2500 }) {
  routes ||= apiKey ? models.map((m) => ({ key: apiKey, model: m })) : [];
  if (!routes.length) return { ok: false, status: 503, message: 'Aviator has no model key on this server.' };
  if (!question || !String(question).trim()) return { ok: false, status: 400, message: 'Ask a question.' };
  const contents = [...history.slice(-8).map((h) => ({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text).slice(0, 4000) }] })), { role: 'user', parts: [{ text: String(question).slice(0, 4000) }] }];
  // On the last step the model may call no more tools, so it answers from what it has already read.
  const body = (last) => ({ systemInstruction: { parts: [{ text: instruction({ ...side, clock, cards }) }] }, contents, tools: [{ functionDeclarations: declarations(tools) }], toolConfig: { functionCallingConfig: { mode: last ? 'NONE' : force ? 'ANY' : 'AUTO' } }, generationConfig: { temperature: 0 } });
  const called = []; let model = null; let force = false;
  // A busy (503) or rate-limited (429) answer on every route is retried twice after a short wait; one model call never waits past 60 seconds.
  // Every model call counts against the daily cap; once it is reached the question gets the cap's plain message.
  const post = async (rt, last) => { if (!takeModelCall()) return { ok: false, status: 429, capped: true, text: async () => MESSAGES.cap }; try { return await fetchImpl(`${modelApi()}/${rt.model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': rt.key }, body: JSON.stringify(body(last)), signal: AbortSignal.timeout(60000) }); } catch (e) { return { ok: false, status: 503, text: async () => `No answer from the model in time (${e.name})` }; } };
  for (let turn = 0; turn < maxTurns; turn++) {
    let data = null, err = null;
    for (let round = 0; round < 3 && !data; round++) {
    if (round) await new Promise((res) => setTimeout(res, wait * round));
    for (const rt of model ? [model, ...routes.filter((x) => x !== model)] : routes) {
      const r = await post(rt, turn === maxTurns - 1);
      if (r.ok) { data = await r.json(); model = rt; break; }
      if (r.capped) return { ok: false, status: 429, capped: true, message: MESSAGES.cap, tools_called: called };
      err = { status: r.status, text: (await r.text()).slice(0, 300) }; if (![404, 429, 500, 503].includes(r.status)) break; // unknown or busy model: try the next one
    }
    if (err && ![429, 503].includes(err.status)) break;
    }
    if (!data) return { ok: false, status: 502, message: `The model did not answer (${err?.status}).`, detail: err?.text, tools_called: called };
    const content = data.candidates?.[0]?.content; const parts = content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    // An answer given before any record was read is not an answer from the records: ask once more, requiring a tool call.
    if (!calls.length && !called.length && !force && turn < maxTurns - 1) { force = true; continue; }
    force = false;
    if (!calls.length) { const text = parts.map((p) => p.text || '').join('').trim(); return { ok: true, answer: text || 'No answer.', answered_from_tools: called.length > 0, tools_called: called, model: model.model, route: model.route }; }
    contents.push(content);
    const known = new Set(tools.map((t) => t.name));
    contents.push({ role: 'user', parts: calls.map(({ functionCall: f }) => { const result = known.has(f.name) ? callTool(f.name, modelArgs(tools, f.name, f.args)) : { result: 'Refused', message: `Aviator has no tool ${f.name}` }; called.push({ tool: f.name, arguments: modelArgs(tools, f.name, f.args) }); return { functionResponse: { name: f.name, ...(f.id ? { id: f.id } : {}), response: { result } } }; }) });
  }
  return { ok: false, status: 502, message: 'Aviator stopped after too many steps without an answer.', tools_called: called };
}
