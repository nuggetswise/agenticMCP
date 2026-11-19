// Fill rate and timely ship notices, calculated by Trading Grid from the start of trading to a point in time (P22, P7).
// Fill rate is Trading Grid's own calculation, not a Northfield guide measure: cases shipped on the supplier's ship notices
// against cases ordered after accepted order changes, per order line. It reads only the purchase order, order changes,
// order acknowledgment, ship notices and invoices, so it needs no retailer record. The invoiced quantity is shown beside it
// as a cross-check. Timely ship notices applies Northfield's guide (NF-4.2): the ship notice's first transmission is sent
// within the rule's window after departure. Ashby measures departure by its own departure scan; Northfield, which cannot
// read the supplier's warehouse records, measures it by the ship time on the ship notice itself.
// Neither figure waits for the quarter to close: each is calculated over the lines due up to the day before as_of.
import { fmtET, etDay, addD } from '../world/lib.js';

const UNIT = { CA: 'Cases', EA: 'Each', PR: 'Pairs' };
const n0 = (n) => n.toLocaleString('en-US');
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : null);
const nameOf = (db, id) => db.prepare('SELECT name FROM parties WHERE id = ?').get(id)?.name || id;
const supplierId = (db, s) => { if (!s) return null; const r = db.prepare('SELECT id FROM parties WHERE lower(id) = lower(?) OR lower(name) = lower(?) OR lower(name) LIKE lower(?)').get(s, s, `%${s}%`); return r ? r.id : null; };

/** The order lines a supplier's rate counts: due in the window, sent by as_of, not cancelled. Ashby's are its DC replenishment programme, as in on-time, in-full. */
function window(db, supplier, asOf, period) {
  const T = asOf.toISOString(); const own = supplier === 'ASHBY';
  const first = db.prepare(`SELECT min(requested_delivery) d FROM orders WHERE supplier_id = ? ${own ? "AND stream = 'replenishment'" : ''}`).get(supplier).d;
  const lastDue = etDay(addD(asOf, -1));
  const from = period?.from && period.from > first ? period.from : first; const to = period?.to && period.to < lastDue ? period.to : lastDue;
  const lines = from && to && from <= to ? db.prepare(`SELECT l.po, l.line, l.sku, l.uom, l.qty_ordered, l.qty_accepted, o.requested_delivery FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.supplier_id = ? ${own ? "AND o.stream = 'replenishment'" : ''} AND o.requested_delivery >= ? AND o.requested_delivery <= ? AND o.received_at <= ? AND l.qty_ordered > 0`).all(supplier, from, to, T) : [];
  return { T, from, to, first, lines, covered: { from, to, counts: 'Order lines with a delivery date in the period, up to the day before as_of', basis: period ? period.basis : 'From the start of trading' } };
}

/** Cases where the order is in cases, or the item has a Case packaging level; otherwise the unit on the order. No case size is assumed. */
function counter(db, T) {
  const packs = new Map(); for (const p of db.prepare("SELECT sku, units FROM packaging_levels WHERE level = 'Case' AND units > 0 AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from").all(T, T)) packs.set(p.sku, p.units);
  return { unit: (l) => (l.uom === 'CA' || (l.uom === 'EA' && packs.has(l.sku)) ? 'Cases' : UNIT[l.uom] || l.uom), q: (l, v) => (l.uom === 'EA' && packs.has(l.sku) ? Math.ceil(v / packs.get(l.sku)) : v) };
}

function fillOf(db, supplier, asOf, period, withLines) {
  const w = window(db, supplier, asOf, period); const c = counter(db, w.T);
  const pos = `(SELECT po FROM orders WHERE supplier_id = '${supplier.replace(/'/g, '')}')`;
  const sh = new Map(); for (const r of db.prepare(`SELECT l.po, l.line, sum(l.qty) q, group_concat(DISTINCT l.shipment_id) asn FROM shipment_lines l JOIN shipments s ON s.shipment_id = l.shipment_id WHERE s.sent_at <= ? AND l.po IN ${pos} GROUP BY l.po, l.line`).all(w.T)) sh.set(`${r.po}|${r.line}`, r);
  // The invoice that stands at as_of: one not replaced by a later invoice sent by then.
  const inv = new Map(); for (const r of db.prepare(`SELECT il.po, il.line, sum(il.qty) q FROM invoice_lines il JOIN invoices i ON i.invoice = il.invoice WHERE i.sent_at <= ? AND il.po IN ${pos} AND i.invoice NOT IN (SELECT replaces FROM invoices WHERE replaces IS NOT NULL AND sent_at <= ?) GROUP BY il.po, il.line`).all(w.T, w.T)) inv.set(`${r.po}|${r.line}`, r.q);
  let ordered = 0, shipped = 0, invoiced = 0; const units = new Set(); const short = [];
  for (const l of w.lines) {
    const k = `${l.po}|${l.line}`; const s = sh.get(k); const o = c.q(l, l.qty_ordered); const got = Math.min(c.q(l, s ? s.q : 0), o); const b = inv.has(k) ? c.q(l, inv.get(k)) : 0;
    ordered += o; shipped += got; invoiced += Math.min(b, o); units.add(c.unit(l));
    if (got < o) short.push({ po: l.po, line: l.line, item: l.sku, delivery_date: l.requested_delivery, ordered: o, shipped: got, invoiced: b, cases_short: o - got,
      reason: !s ? 'Not shipped' : l.qty_accepted != null && l.qty_accepted < l.qty_ordered ? 'Cut at acknowledgment' : 'Short shipped, remainder cancelled', ship_notice: s ? s.asn : null });
  }
  const by = {}; for (const s of short) { (by[s.reason] ||= { reason: s.reason, lines: 0, cases: 0 }); by[s.reason].lines++; by[s.reason].cases += s.cases_short; }
  const unit = [...units].join(', ') || 'Cases';
  return { supplier: nameOf(db, supplier), supplier_id: supplier, period_covered: w.covered, counting_unit: unit, order_lines: w.lines.length, cases_ordered: ordered, cases_shipped: shipped, cases_invoiced: invoiced, rate: pct(shipped, ordered),
    formula: ordered ? `${n0(shipped)} ÷ ${n0(ordered)} = ${pct(shipped, ordered)}` : null, short_lines: short.length, short_cases: ordered - shipped, by_reason: Object.values(by).sort((a, b) => b.cases - a.cases),
    ...(withLines ? { lines: short.sort((a, b) => b.cases_short - a.cases_short) } : {}) };
}

const FILL_DEF = 'Calculated by Trading Grid from the start of trading: cases shipped on the supplier’s ship notices (856) ÷ cases ordered on the purchase order after accepted order changes (850, 860), per order line, capped at the quantity ordered. Read from documents the supplier received or sent; no retailer record is needed. The invoiced quantity (810, the invoice that stands) is shown as a cross-check. This is Trading Grid’s calculation, not a measure in Northfield’s supplier guide.';

/** Fill rate for one supplier, or (Northfield, no supplier) every supplier ranked. */
export function fillRate(db, { supplier = null, asOf, period = null, lines = false, viewer = 'ASHBY' } = {}) {
  const base = { as_of: fmtET(asOf), calculated_by: 'Trading Grid', definition: FILL_DEF };
  if (viewer === 'ASHBY') return { ...base, ...fillOf(db, 'ASHBY', asOf, period, lines) };
  if (supplier) { const id = supplierId(db, supplier); if (!id) return { ...base, found: false, message: `No supplier ${supplier}` }; return { ...base, ...fillOf(db, id, asOf, period, lines) }; }
  const ids = db.prepare("SELECT DISTINCT supplier_id id FROM orders WHERE supplier_id IS NOT NULL").all().map((r) => r.id);
  const rows = ids.map((id) => fillOf(db, id, asOf, period, false)).filter((r) => r.cases_ordered > 0).map(({ supplier, supplier_id, counting_unit, order_lines, cases_ordered, cases_shipped, cases_invoiced, rate, formula, short_lines, short_cases, by_reason }) =>
    ({ supplier, supplier_id, counting_unit, order_lines, cases_ordered, cases_shipped, cases_invoiced, rate, formula, short_lines, short_cases, top_reason: by_reason[0] || null, _v: cases_shipped / cases_ordered }))
    .sort((a, b) => b._v - a._v || b.cases_ordered - a.cases_ordered || a.supplier.localeCompare(b.supplier));
  rows.forEach((r, i) => { r.rank = i + 1; delete r._v; });
  return { ...base, note: 'Each supplier is counted in its own unit: cases where the order is in cases or the item has a case pack on record, otherwise the unit on the order.', suppliers: rows.length, ranking: rows };
}

function timelyOf(db, supplier, asOf, period, viewer, withLines) {
  const w = window(db, supplier, asOf, period); const hours = db.prepare("SELECT window_hours h FROM rules WHERE id = 'NF-4.2'").get()?.h ?? 1;
  const pos = [...new Set(w.lines.map((l) => l.po))]; const own = viewer === 'ASHBY';
  const ship = db.prepare('SELECT s.shipment_id, s.po, s.shipped_at, d.reference FROM shipments s LEFT JOIN documents d ON d.doc_id = s.doc_id WHERE s.po = ? AND s.sent_at <= ?');
  const first = db.prepare("SELECT min(sent_at) at FROM documents WHERE doc_type = '856' AND reference = ? AND sent_at <= ?");
  const deps = db.prepare("SELECT at FROM warehouse_scans WHERE kind = 'departure_scan' AND po = ? AND at <= ? ORDER BY at");
  let total = 0, timely = 0, unknown = 0; const late = [];
  for (const po of pos) for (const s of ship.all(po, w.T)) {
    const ref = s.reference || s.shipment_id; const sent = first.get(ref, w.T).at;
    let dep = null; if (own) { const sa = Date.parse(s.shipped_at); for (const d of deps.all(po, w.T)) if (!dep || Math.abs(Date.parse(d.at) - sa) < Math.abs(Date.parse(dep) - sa)) dep = d.at; } else dep = s.shipped_at;
    if (!sent || !dep) { unknown++; continue; }
    total++; const mins = Math.round((Date.parse(sent) - Date.parse(dep)) / 60000);
    if (mins <= hours * 60) timely++; else late.push({ ship_notice: ref, po, departed: fmtET(new Date(dep)), first_sent: fmtET(new Date(sent)), after_departure: `${Math.floor(mins / 60)} h ${mins % 60} m`, late_by_minutes: mins - hours * 60 });
  }
  return { supplier: nameOf(db, supplier), supplier_id: supplier, period_covered: w.covered, ship_notices: total, timely, late: late.length, departure_unknown: unknown, rate: pct(timely, total), formula: total ? `${n0(timely)} ÷ ${n0(total)} = ${pct(timely, total)}` : null,
    measured_against: own ? 'The departure scan in Ashby’s and Kinross’s own records' : 'The ship time on the ship notice (the supplier’s departure scan is not available to Northfield)', window_hours: hours,
    ...(withLines || late.length <= 50 ? { late_ship_notices: late.sort((a, b) => b.late_by_minutes - a.late_by_minutes) } : {}) };
}

const TIMELY_DEF = (h) => `Northfield supplier guide 2026.2 (NF-4.2): send the ship notice within ${h} hour of departure. Calculated by Trading Grid from the start of trading, per ship notice on its first transmission; a corrected resend does not change it.`;

/** Timely ship notices for one supplier, or (Northfield, no supplier) every supplier ranked. */
export function shipNoticeTimeliness(db, { supplier = null, asOf, period = null, lines = false, viewer = 'ASHBY' } = {}) {
  const h = db.prepare("SELECT window_hours h FROM rules WHERE id = 'NF-4.2'").get()?.h ?? 1; const base = { as_of: fmtET(asOf), calculated_by: 'Trading Grid', definition: TIMELY_DEF(h) };
  if (viewer === 'ASHBY') return { ...base, ...timelyOf(db, 'ASHBY', asOf, period, 'ASHBY', lines) };
  if (supplier) { const id = supplierId(db, supplier); if (!id) return { ...base, found: false, message: `No supplier ${supplier}` }; return { ...base, ...timelyOf(db, id, asOf, period, 'NORTHFIELD', lines) }; }
  const ids = db.prepare("SELECT DISTINCT supplier_id id FROM orders WHERE supplier_id IS NOT NULL").all().map((r) => r.id);
  const rows = ids.map((id) => timelyOf(db, id, asOf, period, 'NORTHFIELD', false)).filter((r) => r.ship_notices > 0).map(({ supplier, supplier_id, ship_notices, timely, late, rate, formula }) => ({ supplier, supplier_id, ship_notices, timely, late, rate, formula, _v: timely / ship_notices }))
    .sort((a, b) => b._v - a._v || b.ship_notices - a.ship_notices || a.supplier.localeCompare(b.supplier));
  rows.forEach((r, i) => { r.rank = i + 1; delete r._v; });
  return { ...base, measured_against: 'The ship time on each ship notice', suppliers: rows.length, ranking: rows };
}
