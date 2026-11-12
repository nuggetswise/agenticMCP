// Derived views: Northfield's 13-week scorecard over the replenishment programme, and the open-order view behind Money in Motion.
import { fmtET, etDay } from '../world/lib.js';

const J = (s) => (s ? JSON.parse(s) : {});
export const QUARTER = { start: '2026-09-27', end: '2026-12-26' };

/** In-full and on-time by order line, cases as the counting unit (NF-8.2, NF-8.3). */
export function scorecard(db, { from = QUARTER.start, to = QUARTER.end } = {}) {
  const lines = db.prepare("SELECT l.po, l.line, l.sku, l.qty_ordered, o.requested_delivery, o.ship_to FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.supplier_id = 'ASHBY' AND o.stream = 'replenishment' AND o.requested_delivery >= ? AND o.requested_delivery <= ?").all(from, to);
  const rc = new Map(); for (const r of db.prepare('SELECT po, line, sum(qty) q, max(received_at) at FROM receipts GROUP BY po, line').all()) rc.set(`${r.po}|${r.line}`, r);
  const missed = new Set(db.prepare("SELECT po FROM events WHERE kind = 'carrier.pickup_missed'").all().map((r) => r.po));
  const short = new Set(db.prepare("SELECT po FROM events WHERE kind = 'wms.short_pick'").all().map((r) => r.po));
  const cut = new Set(db.prepare("SELECT po FROM events WHERE kind = 'erp.allocation'").all().map((r) => r.po));
  const sites = new Map(db.prepare('SELECT po, ship_from FROM shipments').all().map((r) => [r.po, r.ship_from]));
  let cases = 0, failing = 0; const rows = [];
  for (const l of lines) {
    cases += l.qty_ordered; const r = rc.get(`${l.po}|${l.line}`); const got = r ? r.q : 0; let reason = null, bad = 0;
    const et = r ? fmtET(r.at) : null; const hour = et ? Number(et.slice(11, 13)) + Number(et.slice(14, 16)) / 60 : null; const [open, close] = l.ship_to === 'DC4' ? [7, 15] : [6, 14];
    if (missed.has(l.po)) { reason = 'Collect freight not ready'; bad = l.qty_ordered; }
    else if (r && (etDay(new Date(r.at)) > l.requested_delivery || hour < open || hour > close)) { reason = 'Prepaid arrived outside window'; bad = l.qty_ordered; }
    else if (got < l.qty_ordered) { bad = l.qty_ordered - got; reason = cut.has(l.po) ? 'Allocation cut' : short.has(l.po) ? 'Short shipped, remainder cancelled' : 'Received below ship notice'; }
    if (bad) { failing += bad; rows.push({ po: l.po, line: l.line, item: l.sku, site: sites.get(l.po) || null, dc: l.ship_to === 'DC4' ? 'DC 4' : 'DC 2', reason, cases: bad }); }
  }
  const by = {}; for (const r of rows) { (by[r.reason] ||= { reason: r.reason, lines: 0, cases: 0 }); by[r.reason].lines++; by[r.reason].cases += r.cases; }
  const pub = db.prepare("SELECT data FROM events WHERE kind = 'scorecard.published' AND data LIKE '%13 weeks%'").get();
  return { period: `${from} to ${to}`, definition: 'OTIF-2026.2: compliant cases over all cases, per order line', programme: 'DC replenishment', cases, failing_cases: failing, compliant_cases: cases - failing, score: `${((1 - failing / cases) * 100).toFixed(1)}%`, failing_lines: rows.length, by_reason: Object.values(by).sort((a, b) => b.cases - a.cases), northfield_published: pub ? J(pub.data) : null, lines: rows.sort((a, b) => b.cases - a.cases) };
}

/** Rebuilds the Money in Motion order records from the world, in that prototype's fixture shape, for the contract test. */
export function buyerFixture(db, pos, T = '2026-11-08') {
  const day = (iso) => Math.round((Date.parse(`${etDay(new Date(iso))}T00:00:00Z`) - Date.parse(`${T}T00:00:00Z`)) / 86400000);
  return pos.map((po) => {
    const lines = db.prepare('SELECT * FROM order_lines WHERE po = ? ORDER BY line').all(po); const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po);
    const k = (line) => `L${line}`; const ev = []; const cur = Object.fromEntries(lines.map((l) => [l.line, l.qty_original]));
    const docs = db.prepare("SELECT * FROM documents WHERE po = ? AND doc_type NOT IN ('997','824','850') AND status <> 'Rejected' ORDER BY sent_at").all(po);
    for (const d of docs) { const b = J(d.body); const dd = day(d.sent_at);
      if (d.doc_type === '860') { const ch = b.changes.filter((c) => c.qty !== cur[c.line]); for (const c of ch) cur[c.line] = c.qty; ev.push(['chg', dd, Object.fromEntries(ch.map((c) => [k(c.line), c.qty]))]); }
      else if (d.doc_type === '855' || d.doc_type === '865') ev.push(['ack', dd, Object.fromEntries(b.lines.map((l) => [k(l.line), l.backorder ? [l.qty, l.code, l.backorder] : [l.qty, l.code]]))]);
      else if (d.doc_type === '856') ev.push(['asn', dd, b.ref, Object.fromEntries(b.lines.map((l) => [k(l.line), l.qty])), b.complete ? 1 : 0]);
      else if (d.doc_type === '861') ev.push(['rcv', dd, b.asn_ref, Object.fromEntries(b.lines.map((l) => [k(l.line), l.qty]))]);
      else if (d.doc_type === '810') ev.push(['inv', dd, b.replaces || b.ref, Object.fromEntries(b.lines.map((l) => [k(l.line), l.qty]))]);
    }
    for (const p of db.prepare('SELECT * FROM remittance_items WHERE po = ? ORDER BY paid_at').all(po)) { const ded = db.prepare('SELECT coalesce(sum(amount),0) a FROM adjustments WHERE payment = ? AND invoice = ? AND po = ? AND amount < 0').get(p.payment, p.invoice, po).a; const rep = db.prepare('SELECT replaces FROM invoices WHERE invoice = ?').get(p.invoice)?.replaces; ev.push(['pay', day(p.paid_at), rep || p.invoice, Math.round(p.paid * 100), Math.round(-ded * 100)]); }
    for (const e of db.prepare("SELECT at, data FROM events WHERE po = ? AND kind = 'case.decision' AND data LIKE '%Reversed%'").all(po)) ev.push(['rev', day(e.at), Math.round(J(e.data).amount * 100)]);
    ev.sort((a, b) => a[1] - b[1]);
    return { id: po, d0: day(o.received_at), lines: lines.map((l) => ({ k: k(l.line), p: Math.round(l.price * 100), q: l.qty_original })), ev };
  });
}

/** Order record in comparison form: same-day events in a fixed order, ship notice numbers left out (the world renames 18 the fixture reuses). */
const ORD = ['chg', 'ack', 'asn', 'inv', 'rcv', 'pay', 'rev'];
export const normOrder = (p) => JSON.stringify({ id: p.id, d0: p.d0, lines: p.lines.map((l) => ({ k: l.k, p: l.p, q: l.q })), ev: [...p.ev].map((e, i) => [e, i]).sort((a, b) => a[0][1] - b[0][1] || ORD.indexOf(a[0][0]) - ORD.indexOf(b[0][0]) || a[1] - b[1]).map((x) => x[0]).map((e) => (e[0] === 'asn' ? [e[0], e[1], e[3], e[4]] : e[0] === 'rcv' ? [e[0], e[1], e[3]] : e)) });
