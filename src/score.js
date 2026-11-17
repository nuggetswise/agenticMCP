// Derived views: Northfield's 13-week scorecard over the replenishment programme, and the open-order view behind Money in Motion.
import { fmtET, etDay, addD } from '../world/lib.js';

const J = (s) => (s ? JSON.parse(s) : {});
export const QUARTER = { start: '2026-09-27', end: '2026-12-26' };

const money0 = (n) => n.toLocaleString('en-US');
const supplierOf = (db, id) => db.prepare('SELECT id, name FROM parties WHERE id = ?').get(id);

/**
 * On-time, in-full as Trading Grid calculates it from the documents it carries (P7): compliant cases ÷ all cases, counted
 * per order line, on Northfield's definition (NF-8.2, NF-8.3). A line's cases are compliant when Northfield's receiving
 * advice (861) shows them received inside the purchase order's delivery window and in full against the quantity after
 * accepted order changes (850, 860). Each failing line's reason is read from documents both companies hold: the order
 * acknowledgment (855), the ship notice (856), the receiving advice (861) and, on collect freight, the missed pickup.
 * Ashby's rate covers its DC replenishment programme, in cases; every other supplier's covers its orders in the order's unit.
 */
export function otif(db, { supplier = 'ASHBY', from = QUARTER.start, to = QUARTER.end, asOf = null } = {}) {
  const T = asOf ? asOf.toISOString() : '9999'; const own = supplier === 'ASHBY';
  // Read before the period ends, the rate covers the lines due up to the day before: a line not yet due has not failed.
  if (asOf && etDay(asOf) <= to) to = etDay(addD(asOf, -1));
  const lines = db.prepare(`SELECT l.po, l.line, l.sku, l.uom, l.qty_ordered, l.qty_accepted, o.requested_delivery, o.ship_to FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.supplier_id = ? ${own ? "AND o.stream = 'replenishment'" : ''} AND o.requested_delivery >= ? AND o.requested_delivery <= ? AND o.received_at <= ?`).all(supplier, from, to, T);
  const pos = `(SELECT po FROM orders WHERE supplier_id = '${supplier.replace(/'/g, '')}')`;
  const rc = new Map(); for (const r of db.prepare(`SELECT po, line, sum(qty) q, max(received_at) at, min(receipt) receipt FROM receipts WHERE received_at <= ? AND po IN ${pos} GROUP BY po, line`).all(T)) rc.set(`${r.po}|${r.line}`, r);
  const sh = new Map(); for (const r of db.prepare(`SELECT l.po, l.line, sum(l.qty) q, min(l.shipment_id) asn FROM shipment_lines l JOIN shipments s ON s.shipment_id = l.shipment_id WHERE s.sent_at <= ? AND l.po IN ${pos} GROUP BY l.po, l.line`).all(T)) sh.set(`${r.po}|${r.line}`, r);
  const missed = new Set(db.prepare("SELECT po FROM events WHERE kind = 'carrier.pickup_missed' AND at <= ?").all(T).map((r) => r.po));
  const sites = new Map(db.prepare(`SELECT po, ship_from FROM shipments WHERE po IN ${pos}`).all().map((r) => [r.po, r.ship_from]));
  let cases = 0, failing = 0; const rows = []; const units = new Set();
  for (const l of lines) {
    cases += l.qty_ordered; units.add(l.uom); const k = `${l.po}|${l.line}`; const r = rc.get(k); const got = r ? r.q : 0; const s = sh.get(k); let reason = null, bad = 0, first = null;
    const et = r ? fmtET(r.at) : null; const hour = et ? Number(et.slice(11, 13)) + Number(et.slice(14, 16)) / 60 : null; const [open, close] = l.ship_to === 'DC4' ? [7, 15] : [6, 14];
    if (missed.has(l.po)) { reason = 'Collect freight not ready'; bad = l.qty_ordered; first = 'Carrier pickup record'; }
    else if (r && (etDay(new Date(r.at)) > l.requested_delivery || hour < open || hour > close)) { reason = own ? 'Prepaid arrived outside window' : 'Arrived outside the delivery window'; bad = l.qty_ordered; first = `Receiving advice ${r.receipt}`; }
    else if (got < l.qty_ordered) { bad = l.qty_ordered - got;
      if (!r) { reason = s ? 'Shipped, no receiving advice' : 'No ship notice or receiving advice'; first = s ? `Ship notice ${s.asn}` : 'Purchase order'; }
      else if (l.qty_accepted != null && l.qty_accepted < l.qty_ordered) { reason = 'Allocation cut'; first = 'Order acknowledgment'; }
      else if (s && s.q < l.qty_ordered) { reason = 'Short shipped, remainder cancelled'; first = `Ship notice ${s.asn}`; }
      else { reason = 'Received below ship notice'; first = `Receiving advice ${r.receipt}`; } }
    if (bad) { failing += bad; rows.push({ po: l.po, line: l.line, item: l.sku, site: sites.get(l.po) || null, dc: l.ship_to === 'DC4' ? 'DC 4' : l.ship_to === 'DC2' ? 'DC 2' : l.ship_to, reason, cases: bad, ordered: l.qty_ordered, shipped: s ? s.q : 0, received: got, first_record: first, ship_notice: s ? s.asn : null, receiving_advice: r ? r.receipt : null }); }
  }
  const by = {}; for (const r of rows) { (by[r.reason] ||= { reason: r.reason, lines: 0, cases: 0 }); by[r.reason].lines++; by[r.reason].cases += r.cases; }
  const compliant = cases - failing; const score = cases ? `${((compliant / cases) * 100).toFixed(1)}%` : null;
  return { calculated_by: 'Trading Grid', period: `${from} to ${to}`, definition: 'Northfield supplier guide 2026.2 (NF-8.2, NF-8.3): compliant cases ÷ all cases, counted per order line', programme: own ? 'DC replenishment' : 'All orders with a delivery date in the period',
    counting_unit: own ? 'Cases' : [...units].map((u) => ({ CA: 'Cases', EA: 'Each', PR: 'Pairs' }[u] || u)).join(', ') || 'Cases', order_lines: lines.length, cases, failing_cases: failing, compliant_cases: compliant, score,
    formula: cases ? `${money0(compliant)} ÷ ${money0(cases)} = ${score}` : null, failing_lines: rows.length, by_reason: Object.values(by).sort((a, b) => b.cases - a.cases), lines: rows.sort((a, b) => b.cases - a.cases) };
}

/** Ashby's rate for the quarter (the figure every existing check reads). */
export function scorecard(db, { from = QUARTER.start, to = QUARTER.end } = {}) { return otif(db, { supplier: 'ASHBY', from, to }); }

/** When the quarter's last receiving advice posts: Trading Grid calculates the quarter's rate from then on. */
export function quarterClosedAt(db, supplier = 'ASHBY') {
  const r = db.prepare(`SELECT max(r.received_at) at FROM receipts r JOIN orders o ON o.po = r.po WHERE o.supplier_id = ? ${supplier === 'ASHBY' ? "AND o.stream = 'replenishment'" : ''} AND o.requested_delivery >= ? AND o.requested_delivery <= ?`).get(supplier, QUARTER.start, QUARTER.end);
  return r && r.at ? r.at : null;
}

/** The quarter's rate as Trading Grid has calculated it at a point in time. Before the quarter's last receiving advice it gives no figure. */
export function scorecardAsOf(db, asOf, supplier = 'ASHBY') {
  const closed = quarterClosedAt(db, 'ASHBY');
  if (closed && closed <= asOf.toISOString()) { const s = otif(db, { supplier, asOf }); delete s.lines; return { as_of: fmtET(asOf), calculated: true, ...s }; }
  return { as_of: fmtET(asOf), calculated: false, calculated_by: 'Trading Grid', message: `Trading Grid calculates the on-time, in-full rate for ${QUARTER.start} to ${QUARTER.end} when the quarter's last receiving advice arrives${closed ? `, ${fmtET(closed)}` : ''}. It is not calculated at ${fmtET(asOf)}.` };
}

/** Every supplier with a rate for the quarter, ranked, each with its failing lines and top reason (Northfield's view, P7). */
export function supplierRanking(db, asOf) {
  const closed = quarterClosedAt(db, 'ASHBY');
  if (!closed || closed > asOf.toISOString()) return { as_of: fmtET(asOf), calculated: false, calculated_by: 'Trading Grid', message: `Trading Grid calculates the on-time, in-full rates for ${QUARTER.start} to ${QUARTER.end} when the quarter's last receiving advice arrives${closed ? `, ${fmtET(closed)}` : ''}. They are not calculated at ${fmtET(asOf)}.` };
  const ids = db.prepare("SELECT DISTINCT o.supplier_id id FROM orders o WHERE o.requested_delivery >= ? AND o.requested_delivery <= ? AND (o.supplier_id <> 'ASHBY' OR o.stream = 'replenishment')").all(QUARTER.start, QUARTER.end).map((r) => r.id);
  const rows = ids.map((id) => { const s = otif(db, { supplier: id, asOf }); return { supplier: supplierOf(db, id)?.name || id, supplier_id: id, score: s.score, _v: s.cases ? s.compliant_cases / s.cases : -1, counting_unit: s.counting_unit, order_lines: s.order_lines, cases: s.cases, compliant_cases: s.compliant_cases, formula: s.formula,
    failing_lines: s.failing_lines, failing_cases: s.failing_cases, top_reason: s.by_reason[0] ? { reason: s.by_reason[0].reason, lines: s.by_reason[0].lines, cases: s.by_reason[0].cases } : null }; }).filter((r) => r.cases > 0)
    .sort((a, b) => b._v - a._v || b.cases - a.cases || a.supplier.localeCompare(b.supplier));
  rows.forEach((r, i) => { r.rank = i + 1; delete r._v; });
  return { as_of: fmtET(asOf), calculated: true, calculated_by: 'Trading Grid', period: `${QUARTER.start} to ${QUARTER.end}`, definition: 'Northfield supplier guide 2026.2 (NF-8.2, NF-8.3): compliant cases ÷ all cases, counted per order line, the same formula for every supplier',
    note: 'Each rate is calculated from the purchase orders, order changes, ship notices and receiving advice Trading Grid carries for that supplier. A line with no receiving advice inside its delivery window is not compliant.', suppliers: rows.length, ranking: rows };
}

/** In-full component and its OT01 charge (NF-8.2, NF-2.1): 3% of the goods value of in-full failing cases, by month of delivery, months under $1,000 waived. */
export function inFull(db, opts = {}) {
  const s = scorecard(db, opts); const IN = ['Short shipped, remainder cancelled', 'Received below ship notice', 'Allocation cut'];
  const bad = s.lines.filter((l) => IN.includes(l.reason)); const failing = bad.reduce((t, l) => t + l.cases, 0);
  const month = {}; for (const l of bad) { const p = db.prepare('SELECT price FROM order_lines WHERE po = ? AND line = ?').get(l.po, l.line).price; const m = db.prepare('SELECT requested_delivery d FROM orders WHERE po = ?').get(l.po).d.slice(0, 7); month[m] = (month[m] || 0) + p * l.cases * 0.03; }
  const billed = Object.values(month).filter((v) => v >= 1000).reduce((a, b) => a + b, 0);
  return { pct: `${((1 - failing / s.cases) * 100).toFixed(2)}%`, failing_cases: failing, ot01_by_month: month, ot01: `$${Math.round(billed).toLocaleString('en-US')}` };
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
