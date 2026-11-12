// Server-rendered pages: order record, admin (scopes and access log), home. Colours from the TG for Retail tokens.
import { fmtET } from '../data/lib.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CSS = `
:root{--bg:#F4F6F5;--card:#FFFFFF;--subtle:#FBFBFC;--ink:#0F1B2D;--body:#373848;--muted:#66677B;--divider:#E7E9EC;--brand:#00008A;--action:#1968FF;--soft-action:#E8F0FF;--amber:#E6C766;--amber-text:#8A6D1F;--soft-amber:#FBEFD0;--red:#C0392B;--soft-red:#FBEAEA;--gfrom:#00008B;--gto:#1A6AFF;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0B1220;--card:#131E33;--subtle:#17233A;--ink:#E7EAEF;--body:#C9CFD9;--muted:#9AA6B8;--divider:#2B3A52;--brand:#9A9CFF;--action:#5C93FF;--soft-action:#12264A;--amber:#E3BE52;--amber-text:#E3BE52;--soft-amber:#3A2E12;--red:#F07167;--soft-red:#3A1A18;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--body);font:14px/1.5 Inter,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.wrap{max-width:1080px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-left))}
header.top{background:var(--card);border-bottom:1px solid var(--divider)}header.top .wrap{display:flex;gap:10px;align-items:center;padding-block:12px}
.mark{display:flex;gap:8px;align-items:center;font-weight:700;color:var(--ink)}.mark i{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--gfrom),var(--gto))}
h1{font-size:22px;margin:4px 0;color:var(--ink)}h2{font-size:14px;margin:0 0 8px;color:var(--ink)}
.meta{color:var(--muted);font-size:13px}.card{background:var(--card);border:1px solid var(--divider);border-radius:12px;padding:14px 16px;margin-top:12px;overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:1px solid var(--divider);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid var(--divider);vertical-align:top}tr:last-child td{border-bottom:0}tr:target td{background:var(--soft-action)}
.chip{display:inline-block;height:22px;line-height:20px;padding:0 9px;border-radius:999px;font-size:11.5px;border:1px solid var(--divider);white-space:nowrap}
.chip.red{background:var(--soft-red);color:var(--red);border-color:var(--red)}.chip.amb{background:var(--soft-amber);color:var(--amber-text);border-color:var(--amber)}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}.lbl{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);font-weight:600}
button{font:inherit;background:var(--action);color:#FFFFFF;border:0;border-radius:9px;height:36px;padding:0 16px;font-weight:600;cursor:pointer}button.sec{background:var(--card);color:var(--action);border:1px solid var(--action)}
label.sc{display:inline-flex;gap:6px;align-items:center;margin-right:16px}code{font-size:12px;overflow-wrap:anywhere}`;

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><header class="top"><div class="wrap"><span class="mark"><i></i>Trading Grid</span><span class="meta">Ashby Supplier</span></div></header><main class="wrap">${body}</main></body></html>`;

export function recordPage(o, sc) {
  if (!o.found) return shell('Record', `<h1>${esc(o.not_available ? 'Not available to Ashby' : 'Record not found')}</h1><p class="meta">${esc(o.message)}</p>`);
  const statusChip = (s) => (/Rejected|Held/.test(s) ? `<span class="chip red">${esc(s)}</span>` : /Superseded|Corrected/.test(s) ? `<span class="chip">${esc(s)}</span>` : esc(s));
  return shell(`PO ${o.po}`, `
<div class="lbl">Order record · as of ${esc(o.as_of)}</div>
<h1>PO ${esc(o.po)}</h1>
<div class="meta">Northfield Retailer · ${esc(o.programme)} · ship-to ${esc(o.ship_to)} · received ${esc(o.received)} · requested delivery ${esc(o.requested_delivery)} · ${money(o.order_value)}</div>
<div class="card"><h2>Lines</h2><table><thead><tr><th>Line</th><th>SKU</th><th>Ordered</th><th>Accepted</th><th>Case price</th></tr></thead><tbody>
${o.lines.map((l) => `<tr><td>${l.line}</td><td class="mono">${esc(l.sku)}</td><td>${l.qty_ordered}</td><td>${l.qty_accepted ?? 'Not acknowledged'}</td><td>${money(l.case_price)}</td></tr>`).join('')}</tbody></table></div>
${o.shipments.length ? `<div class="card"><h2>Shipments</h2><table><thead><tr><th>Shipment</th><th>Truck planned</th><th>Truck left</th><th>Cartons</th></tr></thead><tbody>${o.shipments.map((s) => `<tr><td class="mono">${esc(s.shipment)}</td><td>${esc(s.truck_planned)}</td><td>${esc(s.truck_left)}</td><td>${s.cartons}</td></tr>`).join('')}</tbody></table></div>` : ''}
<div class="card"><h2>Documents</h2><table><thead><tr><th>Sent</th><th>Document</th><th>Reference</th><th>From → To</th><th>Status</th></tr></thead><tbody>
${Array.isArray(o.documents) ? o.documents.map((d) => `<tr id="${esc(d.doc_id)}"><td>${esc(d.sent)}</td><td>${esc(d.document)}</td><td class="mono">${esc(d.reference)}</td><td>${esc(d.from)} → ${esc(d.to)}</td><td>${statusChip(d.status)}</td></tr>`).join('') : `<tr><td colspan="5">${esc(o.documents)}</td></tr>`}</tbody></table></div>
${Array.isArray(o.rejections) && o.rejections.length ? `<div class="card"><h2>Rejections</h2><table><thead><tr><th>Document</th><th>Cause</th><th>Status</th></tr></thead><tbody>${o.rejections.map((r) => `<tr><td class="mono">${esc(r.reference)}</td><td>${esc(r.cause)}</td><td>${r.status === 'Open' ? '<span class="chip red">Open</span>' : 'Corrected'}</td></tr>`).join('')}</tbody></table></div>` : ''}
${o.outside_confirmations.length ? `<div class="card"><h2>Outside confirmations</h2>${o.outside_confirmations.map((c) => `<p>Business acceptance: confirmed by ${esc(c.method.toLowerCase())} · ${esc(c.confirmed_by)} · recorded by ${esc(c.recorded_by)} · ${esc(c.at)}<br><span class="meta">${esc(c.scope)}</span></p>`).join('')}</div>` : ''}
${o.deductions.length ? `<div class="card"><h2>Deductions</h2><table><thead><tr><th>Case</th><th>Amount</th><th>Reason</th><th>Decision</th></tr></thead><tbody>${o.deductions.map((d) => `<tr><td class="mono">${esc(d.case)}</td><td>${money(d.amount)}</td><td>${esc(d.reason)}</td><td>${esc(d.decision || 'Open')}</td></tr>`).join('')}</tbody></table></div>` : ''}`);
}

export function adminPage({ connection, rows, allScopes, token, mcpUrl }) {
  const labels = { orders: 'Orders', documents: 'Documents', errors: 'Errors', rules: 'Retailer rules' };
  return shell('Assistant connection', `
<div class="lbl">Ashby IT admin</div><h1>Company AI assistant connection</h1>
<div class="meta">Read only · user ${esc(connection.user_name)} · last changed ${esc(fmtET(connection.configured_at))}</div>
<div class="card"><h2>Read scopes</h2><form method="post" action="/admin/${esc(token)}/scopes">
${allScopes.map((s) => `<label class="sc"><input type="checkbox" name="${s}" ${connection.scopes.includes(s) ? 'checked' : ''}> ${labels[s]}</label>`).join('')}
<p><button type="submit">Save scopes</button></p></form>
<p class="meta">Connector URL</p><code>${esc(mcpUrl)}</code></div>
<div class="card"><h2>Access log · ${rows.length} call${rows.length === 1 ? '' : 's'}</h2>
<table><thead><tr><th>Time</th><th>User</th><th>Tool</th><th>Scopes</th><th>Result</th><th>Records</th></tr></thead><tbody>
${rows.map((r) => `<tr><td>${esc(fmtET(r.at))}</td><td>${esc(r.user_name)}</td><td class="mono">${esc(r.tool)}</td><td>${esc(JSON.parse(r.scopes_used).join(', '))}</td><td>${/Not available|Scope not granted|Action not available|Invalid/.test(r.result) ? `<span class="chip amb">${esc(r.result)}</span>` : esc(r.result)}</td><td class="mono">${esc(JSON.parse(r.records).slice(0, 8).join(', '))}</td></tr>`).join('') || '<tr><td colspan="6">No calls yet</td></tr>'}
</tbody></table>
<form method="post" action="/admin/${esc(token)}/clear-log" style="margin-top:12px"><button class="sec" type="submit">Clear access log</button></form></div>`);
}

export function homePage() {
  return shell('Trading Grid demo', `<h1>Trading Grid · Ashby Supplier</h1><p class="meta">Read-only demo connection for a company AI assistant. All data is fictional.</p>`);
}
