// Hosted prototype pages: pages/<id>.html is served at /p/<id>, the link shared with viewers. The claude.ai artifact is the
// build and review copy, owned by the build chat; this repo never changes it. A page is synced only when Mandip says it is ready.
//
// The sync routine, for one page:
//   1. Read the page's published artifact (pages/pages.json has the link) with the claude-artifacts read_file tool,
//      paths ["index.html"]. The tool saves the file and reports its sha256.
//   2. npm run sync -- <id> <saved file> <that sha256>
//      Refuses unless the saved file has exactly that sha256, so the hosted copy is byte for byte the published artifact,
//      and unless the page passes the checks below. Then it saves pages/<id>.html and records the hash in pages/hashes.json.
//   3. Run the tests (npm run build, validate, smoke, the rule suites, npm run hosted), then push.
//   npm run pages          checks every synced page against its recorded hash and the checks below.
//
// A page passes when it posts Aviator questions to the relative /aviator/ address with its own token from pages.json and
// makes no other server call: no window.claude, no MCP or REST route, no XMLHttpRequest, WebSocket or EventSource, no
// script or style from another host, and no model key.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'pages');
const REG = JSON.parse(readFileSync(join(DIR, 'pages.json'), 'utf8'));
const HASHES_FILE = join(DIR, 'hashes.json');
const hashes = () => (existsSync(HASHES_FILE) ? JSON.parse(readFileSync(HASHES_FILE, 'utf8')) : {});
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
  for (const f of fetches) if (!/fetch\s*\(\s*["'`]\/aviator\//.test(f)) out.push(`a fetch that is not Aviator's relative post: ${f}`);
  if (/\/mcp\/|\/api\/[A-Za-z0-9_-]{8,}\/|\/admin\//.test(s)) out.push('an MCP, REST or admin route appears in the page');
  if (/<script[^>]+src=["']https?:|<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:\/\/(?!fonts\.googleapis\.com)|@import\s+url\(["']?https?:/.test(s)) out.push('loads a script or style from another host');
  if (/GEMINI|AIza[0-9A-Za-z_-]{20,}/.test(html)) out.push('a model key name or key appears');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'sync') {
    const [id, file, want] = args;
    if (!id || !file || !want || !existsSync(file)) { console.error('Usage: npm run sync -- <id> <file read from the artifact> <sha256 the artifact reports>'); process.exit(2); }
    const got = sha(file);
    if (got !== want.toLowerCase()) { console.error(`FAIL ${id}: the file's sha256 ${got} is not the artifact's ${want}. Nothing saved.`); process.exit(1); }
    const problems = checkPage(id, readFileSync(file, 'utf8'));
    if (problems.length) { console.error(`FAIL ${id}: ${problems.join('; ')}. Nothing saved.`); process.exit(1); }
    copyFileSync(file, join(DIR, `${id}.html`)); const h = hashes(); h[id] = { sha256: got, artifact: REG.pages[id].artifact, synced_at: new Date().toISOString() };
    writeFileSync(HASHES_FILE, JSON.stringify(h, null, 1) + '\n');
    console.log(`Synced ${id}: pages/${id}.html sha256 ${got}, equal to the published artifact ${REG.pages[id].artifact}`);
  } else if (cmd === 'check' || !cmd) {
    const h = hashes(); const ids = (args.length ? args : Object.keys(REG.pages)).filter((id) => id !== '_test'); let fails = 0, n = 0;
    for (const id of ids) { const f = join(DIR, `${id}.html`); if (!existsSync(f)) { console.log(`NOT SYNCED ${id}`); continue; } n++;
      const problems = checkPage(id, readFileSync(f, 'utf8')); if (!h[id] || h[id].sha256 !== sha(f)) problems.push('file differs from the hash recorded at sync');
      console.log(`${problems.length ? 'FAIL' : 'PASS'} ${id}${problems.length ? ': ' + problems.join('; ') : ` · sha256 ${sha(f)}`}`); if (problems.length) fails++; }
    const t = checkPage('_test', readFileSync(join(DIR, '_test.html'), 'utf8')); console.log(`${t.length ? 'FAIL' : 'PASS'} _test${t.length ? ': ' + t.join('; ') : ''}`); if (t.length) fails++;
    console.log(`${n} page(s) synced, ${fails} failed`); process.exit(fails ? 1 : 0);
  } else { console.error(`Unknown command ${cmd}`); process.exit(2); }
}
