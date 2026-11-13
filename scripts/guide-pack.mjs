// One page of context for one prototype, assembled from the Build Guide and the registry.
// Usage: node scripts/guide-pack.mjs P5   -> prints the pack and writes build/pack-P5.md
// Nothing here is a source: every line is copied from docs/build-guide.md or registry/registry.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const id = process.argv.slice(2).join(' ').trim();
if (!id) { console.error('Usage: node scripts/guide-pack.mjs <prototype ID, e.g. P5>'); process.exit(2); }
const md = readFileSync(join(ROOT, 'docs/build-guide.md'), 'utf8');
const reg = JSON.parse(readFileSync(join(ROOT, 'registry/registry.json'), 'utf8'));
const section = (h) => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 4); return md.slice(i, j < 0 ? undefined : j); };
const tables = (s) => { const out = []; let cur = null; for (const l of s.split('\n')) { if (l.startsWith('|')) { const cells = l.slice(1, -1).split('|').map((c) => c.trim()); if (!cur) { cur = { head: cells, rows: [] }; out.push(cur); } else if (!/^-+$/.test(cells[0].replace(/\s/g, ''))) cur.rows.push(cells); } else cur = null; } return out; };
const obj = (t, r) => Object.fromEntries(t.head.map((h, i) => [h, r[i] || '']));
const names = (cell) => cell.split(/,\s*/).map((x) => x.trim());
const mentions = (text) => new RegExp(`(^|[^\\w])${id.replace(/ /g, '\\s')}(?![\\w])`).test(text);

const inv = tables(section('Inventory'))[0]; const row = inv.rows.find((r) => r[0] === id);
if (!row) { console.error(`${id} is not in Inventory. Known: ${inv.rows.map((r) => r[0]).join(', ')}`); process.exit(1); }
const I = obj(inv, row);
const R = reg.prototypes.find((p) => p.id === id.split(' ')[0]) || null;
const other = (reg.other_inventory || []).find((p) => p.id === id);
const hasAgent = !!(R && R.agency && R.agency.verdict === 'agent');
const isServer = /Server/.test(I.Class);

// Rules: every rule applies except the agent block (agents only) and customer-agent access (server scopes only)
const rules = [...section('Rules every build follows').matchAll(/^- \*\*(R\d+)\*\* (.*(?:\n {2,}.*)*)/gm)].map((m) => ({ id: m[1], n: +m[1].slice(1), text: m[2] }));
const applies = (r) => (r.n >= 14 && r.n <= 22 ? hasAgent || r.n === 20 || r.n === 21 : r.n >= 23 && r.n <= 28 ? isServer : true);
const grid = tables(section('Coverage grid'))[0]; const g = grid.rows.find((r) => names(r[0]).includes(id));
const decisions = tables(section('Decisions')).flatMap((t) => t.rows.filter((r) => mentions(r.join(' '))).map((r) => `- ${t.head[0] === '#' ? 'Approved item ' : ''}${r[0]}: ${r[1]}${t.head[0] === '#' ? ` (${r[3]})` : ''}`));
const questions = [...section('Decisions').matchAll(/^\d+\. .*$/gm)].map((m) => m[0]).filter(mentions);
const tasks = tables(section('Tasks')).flatMap((t) => t.rows.map((r) => obj(t, r))).filter((t) => names(t.Prototype).includes(id) || (/^All screens$/.test(t.Prototype) && /Screen/.test(I.Class)));
const done = new Set(tables(section('Tasks')).flatMap((t) => t.rows.map((r) => obj(t, r))).filter((t) => t.Status === 'Done').map((t) => t.ID));
const ready = (t) => t.Status === 'Open' && (t['Depends on'].match(/T\d+\.\d+/g) || []).every((d) => done.has(d));

const out = [];
out.push(`# Pack for ${id} · ${I.Prototype}`, '', `Generated from docs/build-guide.md (as of ${(md.match(/as of repo commit ([0-9a-f]{7})/) || [])[1]}) and registry/registry.json. Read this page and the prototype's source; open the guide only for a rule or decision named here.`, '');
out.push('## Job, ending and business problem', '', `- Class and status: ${I.Class}, ${I['Registry status']}`, `- Source: ${I.Link}`, `- Job, and where it ends: ${I['Job, and where it ends']}`);
out.push(`- Business problem: read the v8 section named above in TG_for_Retail_Feature_Requirements_v8.docx (Why, What, Boundary, and the Journey composition table), and nothing else (R40). If v8 has no section or disagrees with the screen, ask the owner before proposing a change list.`);
out.push(`- Story: its task card or portfolio row in the Prototype Plan (R06, R41).`, '');
out.push('## Agent, tools and records (registry)', '');
if (R) {
  out.push(`- Seen by: ${R.seen_by}`, `- Agency verdict: ${R.agency.verdict}${R.agency.agent ? `, ${R.agency.agent}` : ''}. ${R.agency.reason}`, `- Would reverse the verdict: ${R.agency.would_reverse}`);
  if (R.decisions.length) out.push('- Decisions the agent must reach from records:', ...R.decisions.map((d) => `    - ${d.record} as of ${d.as_of}: ${d.next_step}`));
  out.push(`- Customer's own assistant: supplier side, ${R.customer_agent.supplier}; retailer side, ${R.customer_agent.retailer}`, `- ERP placement: ${R.erp_placement}`);
  out.push(`- Server tools, Ashby: ${R.tools.join(', ') || 'none'}`, `- Server tools, Northfield: ${(R.tools_northfield || []).join(', ') || 'none'}`, `- Anchor records: ${R.anchors.join(', ') || 'none'}`, `- Gate checks that must keep passing: ${R.acceptance.join(', ') || 'none'}`);
  if (R.ends_at) out.push(`- Ending as the registry holds it: ${R.ends_at}`);
  out.push('- How the server works: the Server reference section of the guide (connections, scopes, refusals, writes).');
} else out.push(other ? `- Listed outside the story calendar: ${other.status}${other.reason ? `. ${other.reason}` : ''}` : '- Not in the registry.');
out.push('', '## Rules that apply', '', ...rules.filter(applies).map((r) => `- ${r.id} ${r.text.replace(/\n\s+/g, ' ')}`));
const skipped = rules.filter((r) => !applies(r)).map((r) => r.id);
if (skipped.length) out.push('', `Left out because they do not apply here: ${skipped.join(', ')} (${hasAgent ? '' : 'no agent; '}${isServer ? '' : 'not a server scope'}).`);
out.push('', '## Decisions and open questions that name it', '', ...(decisions.length ? decisions : ['- None']), ...questions.map((q) => `- Open question ${q}`));
if (g) out.push('', '## Coverage grid row', '', ...grid.head.slice(1).map((h, i) => `- ${h}: ${g[i + 1]}`));
out.push('', '## Tasks, in order', '', ...(tasks.length ? tasks.map((t) => `- ${t.ID} [${t.Status}${ready(t) ? ', ready' : ''}] ${t.Task}. Depends on: ${t['Depends on']}. Read first: ${t['Read first']}. Done when: ${t['Done when']}`) : ['- None']));
out.push('', '## Alignment check before any change list', '', '1. The problem line on screen states the business problem v8 gives for this job.', '2. The turn shows the solution acting, and the result is the record named under Job, and where it ends.', '3. Nothing on screen runs past that record.', '4. Every click is on the click map with the beat it serves; the main path stays inside the budget (R42).', '5. Each beat\'s screen reads as a still frame (R41).', hasAgent ? '6. The agent passes all six tests in R21, on the decisions listed above.' : '6. No agent label appears; behaviour reads as rule-based (R21).');
const text = out.join('\n') + '\n';
mkdirSync(join(ROOT, 'build'), { recursive: true });
writeFileSync(join(ROOT, `build/pack-${id.replace(/\s+/g, '-')}.md`), text);
process.stdout.write(text);
