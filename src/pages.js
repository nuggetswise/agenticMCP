// Server-rendered pages: order record, admin (scopes and access log), home. Colours from the TG for Retail tokens.
import { fmtET } from '../world/lib.js';

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

const tbl = (heads, rows) => `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const statusChip = (s) => (/Rejected|Held/.test(s) ? `<span class="chip red">${esc(s)}</span>` : /Superseded|Corrected/.test(s) ? `<span class="chip">${esc(s)}</span>` : esc(s));

export function recordPage(o) {
  if (!o.found) return shell('Record', `<h1>${esc(o.not_available ? 'Not available to Ashby' : 'Record not found')}</h1><p class="meta">${esc(o.message)}</p>`);
  const card = (title, body) => `<div class="card"><h2>${esc(title)}</h2>${body}</div>`;
  return shell(`PO ${o.po}`, `
<div class="lbl">Order record</div><h1>PO ${esc(o.po)}</h1>
<div class="meta">Northfield Retailer · ${esc(o.programme)} · ship-to ${esc(o.ship_to)} · received ${esc(o.received)} · requested delivery ${esc(o.requested_delivery)} · ${money(o.order_value)}${o.accepted_value != null && o.accepted_value !== o.order_value ? ` · accepted ${money(o.accepted_value)}` : ''}</div>
${card('Lines', tbl(['Line', 'Item', 'First ordered', 'Ordered now', 'Accepted', 'Price', 'Delivery'], o.lines.map((l) => [l.line, `<span class="mono">${esc(l.sku)}</span>`, l.ordered_first, l.ordered_now, l.accepted ?? 'Not acknowledged', money(l.price), esc(l.delivery_date)])))}
${o.changes.length ? card('Order changes', tbl(['Change', 'Sent', 'Line', 'Quantity', 'Delivery', 'State'], o.changes.map((c) => [c.change, esc(c.sent_at), c.line, c.qty, esc(c.delivery_date || ''), statusChip(c.state)]))) : ''}
${o.shipments.length ? card('Shipments', tbl(['Ship notice', 'Sent', 'Truck left', 'Cartons', 'Ship from', 'Bill of lading', 'Seal'], o.shipments.map((s) => [`<span class="mono">${esc(s.ship_notice)}</span>`, esc(s.sent), esc(s.truck_left), s.cartons, esc(s.ship_from), esc(s.bill_of_lading || ''), esc(s.seal || '')]))) : ''}
${o.receipts.length ? card('Receipts', tbl(['Receiving advice', 'Received', 'Line', 'Quantity', 'Short'], o.receipts.map((r) => [`<span class="mono">${esc(r.receipt)}</span>`, esc(r.received_at), r.line, r.qty, r.short || '']))) : ''}
${o.invoices.length ? card('Invoices', tbl(['Invoice', 'Sent', 'Total', 'Status', 'Replaces'], o.invoices.map((i) => [`<span class="mono">${esc(i.invoice)}</span>`, esc(i.sent_at), money(i.total), statusChip(i.status), esc(i.replaces || '')]))) : ''}
${Array.isArray(o.payments) && o.payments.length ? card('Payments and charges', tbl(['Payment', 'Date', 'Invoice', 'Paid', 'Invoice amount'], o.payments.map((p) => [`<span class="mono">${esc(p.payment)}</span>`, esc(p.paid), esc(p.invoice), money(p.amount), money(p.invoice_amount)])) + (Array.isArray(o.charges) && o.charges.length ? tbl(['Payment', 'Date', 'Amount', 'Reference', 'Note'], o.charges.map((c) => [`<span class="mono">${esc(c.payment)}</span>`, esc(c.at), money(c.amount), esc(c.reference), esc(c.note || '')])) : '')) : ''}
${card('Documents', Array.isArray(o.documents) ? tbl(['Sent', 'Document', 'Reference', 'From → To', 'Status'], o.documents.map((d) => [esc(d.sent), esc(d.document), `<a class="mono" href="/records/${esc(d.link)}">${esc(d.reference)}</a>`, `${esc(d.from)} → ${esc(d.to)}`, statusChip(d.status)])) : esc(o.documents))}
${Array.isArray(o.rejections) && o.rejections.length ? card('Rejections', tbl(['Document', 'Cause', 'Status'], o.rejections.map((r) => [`<span class="mono">${esc(r.reference)}</span>`, esc(r.cause), r.status === 'Open' ? '<span class="chip red">Open</span>' : 'Corrected']))) : ''}
${o.other_records.length ? card('Other records', tbl(['Time', 'Record', 'System', 'Channel', 'Detail'], o.other_records.map((e) => { const { at, record, system, channel, ...rest } = e; return [esc(at), `<span class="mono">${esc(record)}</span>`, esc(system), esc(channel), esc(Object.entries(rest).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '))]; }))) : ''}`);
}

export function documentPage(d) {
  if (!d.found) return shell('Document', `<h1>${esc(d.not_available ? 'Not available to Ashby' : 'Document not found')}</h1><p class="meta">${esc(d.message)}</p>`);
  return shell(d.reference, `<div class="lbl">${esc(d.document)}</div><h1>${esc(d.reference)}</h1>
<div class="meta">${esc(d.from)} → ${esc(d.to)} · sent ${esc(d.sent)} · ${esc(d.status)}${d.po ? ` · <a href="/records/order/${esc(encodeURIComponent(d.po))}">PO ${esc(d.po)}</a>` : ''}</div>
<div class="card"><h2>Versions</h2>${tbl(['Id', 'Sent', 'Status'], d.versions.map((v) => [`<span class="mono">${esc(v.id)}</span>`, esc(v.sent), statusChip(v.status)]))}</div>
<div class="card"><h2>X12 as exchanged</h2><pre class="mono" style="white-space:pre-wrap;margin:0">${esc(d.x12)}</pre><p class="meta">Interchange ${d.control_numbers.interchange} · group ${d.control_numbers.group} · ${esc(d.file)}</p></div>`);
}

export function adminPage({ connection, rows, allScopes, token, mcpUrl, writes, proposals }) {
  const labels = { orders: 'Orders', documents: 'Documents', errors: 'Errors', rules: 'Retailer rules', deductions: 'Deductions' };
  return shell('Assistant connection', `
<div class="lbl">Ashby administration</div><h1>Company AI assistant connection</h1>
<div class="meta">${writes ? 'Reads, and proposals that need approval here' : 'Read only'} · user ${esc(connection.user_name)} · last changed ${esc(fmtET(connection.configured_at))}</div>
<div class="card"><h2>Read scopes</h2><form method="post" action="/admin/${esc(token)}/scopes">
${allScopes.map((s) => `<label class="sc"><input type="checkbox" name="${s}" ${connection.scopes.includes(s) ? 'checked' : ''}> ${labels[s]}</label>`).join('')}
<p><button type="submit">Save scopes</button></p></form>
<p class="meta">Connector URL</p><code>${esc(mcpUrl)}</code></div>
${writes ? `<div class="card"><h2>Proposals · ${proposals.length}</h2>${tbl(['Proposal', 'Created', 'By', 'Action', 'Record', 'State', ''], proposals.map((p) => [`<span class="mono">${esc(p.id)}</span>`, esc(fmtET(p.created_at)), esc(p.created_by), esc(p.action), `<span class="mono">${esc(p.target)}</span>`, p.state === 'Awaiting approval' ? `<span class="chip amb">${esc(p.state)}</span>` : esc(`${p.state} by ${p.decided_by}`), p.state === 'Awaiting approval' ? `<form method="post" action="/admin/${esc(token)}/proposals/${esc(p.id)}/approve" style="display:inline"><button type="submit">Approve</button></form> <form method="post" action="/admin/${esc(token)}/proposals/${esc(p.id)}/reject" style="display:inline"><button class="sec" type="submit">Reject</button></form>` : '']))}</div>` : ''}
<div class="card"><h2>Access log · ${rows.length} call${rows.length === 1 ? '' : 's'}</h2>
${tbl(['Time', 'User', 'Tool', 'Scopes', 'Result', 'Records'], rows.map((r) => [esc(fmtET(r.at)), esc(r.user_name), `<span class="mono">${esc(r.tool)}</span>`, esc(JSON.parse(r.scopes_used).join(', ')), /Not available|Scope not granted|Action not available|Invalid|Proposal/.test(r.result) ? `<span class="chip amb">${esc(r.result)}</span>` : esc(r.result), `<span class="mono">${esc(JSON.parse(r.records).slice(0, 8).join(', '))}</span>`]))}
<form method="post" action="/admin/${esc(token)}/clear-log" style="margin-top:12px;display:inline-block"><button class="sec" type="submit">Clear access log</button></form>
<form method="post" action="/admin/${esc(token)}/reset" style="margin-top:12px;display:inline-block"><button class="sec" type="submit">Reset to baseline</button></form></div>`);
}

export function homePage() {
  return shell('Trading Grid demo', `<h1>Trading Grid · Ashby Supplier</h1><p class="meta">Read-only demo connection for a company AI assistant. All data is fictional.</p>`);
}
