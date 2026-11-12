// Emits the OpenAPI draft from the same tool list the MCP server registers. One list, two surfaces.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { TOOLS, BOUNDARY } from '../src/tools.js';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {};
for (const t of [...TOOLS, ...BOUNDARY]) {
  const [method, path] = t.rest; const schema = zodToJsonSchema(z.object(t.input), { target: 'openApi3' }); const props = schema.properties || {}; const req = new Set(schema.required || []);
  const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const op = { operationId: t.name, summary: t.title, description: t.description, tags: [t.job || 'Boundary'], 'x-mcp-tool': t.name, 'x-required-scopes': t.required || [], 'x-optional-scopes': t.optional || [], 'x-read-only': t.name !== 'request_change',
    parameters: [], responses: { 200: { description: 'Result. Fields outside the connection’s scopes are returned as "Not shared".', content: { 'application/json': { schema: { type: 'object' } } } }, 403: { description: 'A required scope is not granted on this connection' }, 404: { description: 'Record not found, or not Ashby’s' } } };
  for (const k of inPath) op.parameters.push({ name: k, in: 'path', required: true, schema: props[k], description: props[k]?.description });
  const rest = Object.keys(props).filter((k) => !inPath.includes(k));
  if (method === 'GET') for (const k of rest) op.parameters.push({ name: k, in: 'query', required: req.has(k), schema: props[k], description: props[k]?.description });
  else if (rest.length) op.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object', properties: Object.fromEntries(rest.map((k) => [k, props[k]])), required: rest.filter((k) => req.has(k)) } } } };
  if (!op.parameters.length) delete op.parameters;
  (paths[path] ||= {})[method.toLowerCase()] = op;
}
const doc = { openapi: '3.0.3', info: { title: 'Trading Grid for Retail: supplier connection (draft)', version: '0.2.0-draft', description: 'Draft API behind the customer-assistant connection. Generated from the tool list the demo MCP server registers, so the two cannot drift. Every operation is read-only except POST /v1/proposals, which records an approval-gated proposal and changes nothing until an authorized user approves it in Trading Grid. All data is fictional.' },
  servers: [{ url: 'https://tg-retail-demo-mcp.onrender.com/api/{token}', variables: { token: { default: 'TOKEN', description: 'Connection token' } } }], paths };
mkdirSync(join(ROOT, 'openapi'), { recursive: true });
writeFileSync(join(ROOT, 'openapi', 'openapi.json'), JSON.stringify(doc, null, 1));
console.log(`OpenAPI draft: ${Object.keys(paths).length} paths, ${[...TOOLS, ...BOUNDARY].length} operations`);
