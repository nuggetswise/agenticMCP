// Writes the one-page EDI practitioner review pack: three raw documents and the rule catalogue.
import { DatabaseSync } from 'node:sqlite'; import { writeFileSync } from 'node:fs'; import { MAIN_DB } from '../world/build.js';
const db = new DatabaseSync(MAIN_DB, { readOnly: true }); const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const doc = (ref, type) => db.prepare('SELECT * FROM documents WHERE reference = ? AND doc_type = ? ORDER BY sent_at').get(ref, type);
const D = [[doc('ASN-450118-2', '856'), 'Ship notice (856), second shipment of PO NR-450118', 'Pack level detail: 120 cartons, each with an SSCC. Check the hierarchy, the SN1 and PO4 use, and whether BSN and TD segments read as a real partial shipment.'],
  [doc('RCV-DC2-77355', '861'), 'Receiving advice (861) for that shipment', 'Northfield received 119 of 120 and names the carton it did not scan. Check whether RCD and the MAN reference are how a retailer would report one unscanned carton.'],
  [db.prepare("SELECT d.* FROM documents d WHERE d.doc_type = '824' AND d.po = 'NR-46156' ORDER BY sent_at").get(), 'Application advice (824) rejecting ship notice ASN-46156', 'A substitute item not on the retailer’s list. Check OTI and TED use, and whether an 824 rather than a 997 is the right channel for this error.']];
const rules = db.prepare('SELECT * FROM rules ORDER BY rule_set, CAST(substr(id, 4) AS REAL), id').all();
const src = (r) => { const p = JSON.parse(r.public_sources || '[]'); return p.map((x) => x.url ? `<a href="${esc(x.url)}">${esc(x.title)}</a>` : esc(x.title)).join('; '); };
const n = (b) => rules.filter((r) => r.basis === b).length;
const html = `<title>EDI Review Pack</title><meta name="claude:viewport-fit-sides" content="cover">
<style>
/* One column, document first: three raw X12 documents, then the rule table. */
:root{--bg:#f6f7f5;--panel:#ffffff;--fg:#18211d;--mute:#5d6b64;--line:#d5dbd6;--accent:#0b6e4f;--code:#eef1ee;--pub:#0b6e4f;--ada:#8a5a00;--inv:#5d6b64}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#111614;--panel:#18201c;--fg:#e6ece8;--mute:#9aa8a1;--line:#2b3731;--accent:#5fd0a5;--code:#0d1210;--pub:#5fd0a5;--ada:#e0b35a;--inv:#9aa8a1;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111614;--panel:#18201c;--fg:#e6ece8;--mute:#9aa8a1;--line:#2b3731;--accent:#5fd0a5;--code:#0d1210;--pub:#5fd0a5;--ada:#e0b35a;--inv:#9aa8a1;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.55 Inter,system-ui,sans-serif;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px}
main{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:22px}
h1{font:600 26px/1.2 "Space Grotesk",Inter,sans-serif;margin:0;text-wrap:balance}h2{font:600 18px/1.3 "Space Grotesk",Inter,sans-serif;margin:0}h3{font:600 15px/1.3 Inter,sans-serif;margin:0}
p{margin:0;max-width:70ch}.mute{color:var(--mute)}a{color:var(--accent)}
section{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:18px;display:flex;flex-direction:column;gap:10px;min-width:0}
pre{background:var(--code);border:1px solid var(--line);border-radius:4px;padding:12px;margin:0;overflow-x:auto;font:12.5px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:340px}
ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;vertical-align:top;padding:7px 9px;border-bottom:1px solid var(--line)}th{color:var(--mute);font-weight:600;font-size:12px;letter-spacing:.04em;text-transform:uppercase}
td.id{font-family:ui-monospace,Menlo,monospace;white-space:nowrap}.b{font-weight:600;white-space:nowrap}.b.public{color:var(--pub)}.b.adapted{color:var(--ada)}.b.invented{color:var(--inv)}
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk:wght@600&display=swap">
<main>
<header style="display:flex;flex-direction:column;gap:8px"><h1>EDI review pack: Ashby Supplier and Northfield Retailer</h1>
<p>Three X12 004010 documents and the rule catalogue from a fictional demo world. Every company, person, number and identifier is invented; identifiers use the GS1 example prefix 0614141. Please read them as you would a new trading partner’s test files and tell us what a practitioner would not believe.</p></header>
<section><h2>What we would like you to check</h2><ol>
<li>Would each document pass at a retailer you know? Name any segment, qualifier or code that reads wrong.</li>
<li>Is each error on the right channel: syntax on the 997, business errors on the 824?</li>
<li>Are the deadlines and charges in the rule table within the range real supplier guides use?</li>
<li>Which invented rules would no retailer write?</li>
<li>What is missing that a supplier meets in the first month of trading?</li></ol>
<p class="mute">Known limits: one transaction set per interchange; envelope times are UTC; the schemas used to validate these files take element types and lengths from X12 004010, but which segments are mandatory was decided for this demo.</p></section>
${D.map(([d, t, ask], i) => `<section><h2>Document ${i + 1}. ${esc(t)}</h2><p class="mute">${esc(d.reference)} · sent ${esc(d.sent_at.slice(0, 16).replace('T', ' '))} UTC · interchange control ${d.isa_ctl}</p><p>${esc(ask)}</p><pre>${esc(d.raw.trim())}</pre></section>`).join('\n')}
<section><h2>Rule catalogue: Northfield supplier guide 2026.2</h2><p>${rules.length} rules: ${n('public')} public, ${n('adapted')} adapted from a public guide, ${n('invented')} invented. A public or adapted rule names its source.</p>
<div class="tw"><table><thead><tr><th>Rule</th><th>Statement</th><th>Charge</th><th>Basis</th><th>Source</th></tr></thead><tbody>
${rules.map((r) => `<tr><td class="id">${esc(r.id)}</td><td>${esc(r.statement)}</td><td>${esc([r.charge_code, r.charge].filter(Boolean).join(' '))}</td><td class="b ${r.basis}">${r.basis[0].toUpperCase() + r.basis.slice(1)}</td><td>${src(r)}</td></tr>`).join('\n')}
</tbody></table></div></section></main>`;
writeFileSync(process.argv[2], html); console.log('review pack', html.length, 'bytes', rules.length, 'rules', D.map(([d]) => d?.reference).join(', '));
