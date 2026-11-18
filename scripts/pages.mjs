// The prototypes are the pages served at /p/<id> from pages/<id>.html. The build chat owns pages/<id>.html (branch
// build/pages); this repo's server work never edits a page. pages/pages.json binds each page to its Aviator token, the sides
// it shows, its opening moment (calendar) and its window end (through).
//
//   npm run pages          checks every page in pages/ against pages.json and the checks below.
//
// A page passes when it posts to the relative /aviator/ address with its own token from pages.json (questions, and its
// action cards' Approve or Cancel), reads only the relative /public/ route, and makes no other server call: no
// window.claude, no MCP or REST route, no XMLHttpRequest, WebSocket or EventSource, no script or style from another host,
// and no model key.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'pages');
const REG = JSON.parse(readFileSync(join(DIR, 'pages.json'), 'utf8'));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const stripData = (s) => s.replace(/data:[^"')\s]{200,}/g, 'data:…');

export function checkPage(id, html) {
  const p = REG.pages[id]; if (!p) return [`${id}: not in pages/pages.json`];
  const out = []; const s = stripData(html);
  if (!s.includes(p.token)) out.push('the page does not carry its own Aviator token');
  for (const [other, o] of Object.entries(REG.pages)) if (other !== id && s.includes(o.token)) out.push(`carries the token of ${other}`);
  if (/window\.claude/.test(s)) out.push('window.claude present');
  if (/XMLHttpRequest|new WebSocket|EventSource|sendBeacon/.test(s)) out.push('XMLHttpRequest, WebSocket, EventSource or sendBeacon present');
  const fetches = s.match(/\bfetch\s*\(([^,)]{0,80})/g) || [];
  if (!fetches.length) out.push('no Aviator post found');
  for (const f of fetches) if (!/fetch\s*\(\s*["'`]\/(aviator|public)\//.test(f) && !/fetch\s*\(\s*[A-Za-z_$][\w$.]*\s*$/.test(f)) out.push(`a fetch that is not to the relative /aviator/ or /public/ route: ${f}`);
  if (/\/mcp\/|\/api\/[A-Za-z0-9_-]{8,}\/|\/admin\//.test(s)) out.push('an MCP, REST or admin route appears in the page');
  if (/<script[^>]+src=["']https?:|<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/(?!fonts\.googleapis\.com)|@import\s+url\(["']?https?:/.test(s)) out.push('loads a script or style from another host');
  if (/GEMINI|AIza[0-9A-Za-z_-]{20,}/.test(html)) out.push('a model key name or key appears');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => a !== 'check'); let fails = 0, n = 0;
  for (const id of args.length ? args : Object.keys(REG.pages)) { const f = join(DIR, `${id}.html`); if (!existsSync(f)) { console.log(`NOT IN pages/ ${id}`); continue; } n++;
    const problems = checkPage(id, readFileSync(f, 'utf8'));
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${id}${problems.length ? ': ' + problems.join('; ') : ` · sha256 ${sha(f)}`}`); if (problems.length) fails++; }
  console.log(`${n} page(s) checked, ${fails} failed`); process.exit(fails ? 1 : 0);
}
