// Answer logic shared by the MCP tools, the record pages and the checks.
// One timeline. Record lookups return the record's whole history; questions about "now" take an as-of time.
import { PRECEDENCE } from '../world/ref.js';
import { fmtET, et } from '../world/lib.js';

export const COMPANY = 'ASHBY';
export const NOT_AVAILABLE = 'Not available to Ashby';
const H = 3600000;
/** The story clock: what "now" means when a question gives no as-of time. Default: P10, Tuesday 17 November 11:00 Eastern. */
export const storyClock = () => new Date(process.env.STORY_CLOCK || '2026-11-17T16:00:00.000Z');
export const asOfDate = (v) => { if (!v) return storyClock(); const d = new Date(/T/.test(v) ? v : `${v}T23:59:00-05:00`); if (Number.isNaN(d.getTime())) throw new Error('as_of must be an ISO date or date-time'); return d; };

export function timeLeft(deadline, clock) {
  const ms = deadline - clock;
  if (ms < 0) { const h = Math.round(-ms / H); return h >= 24 ? `Overdue by ${Math.floor(h / 24)} day${h >= 48 ? 's' : ''}` : h >= 1 ? `Overdue by ${h} hour${h === 1 ? '' : 's'}` : `Overdue by ${Math.max(1, Math.round(-ms / 60000))} minutes`; }
  const h = Math.floor(ms / H);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'} left`; }
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'} left`;
  return `${Math.max(1, Math.round(ms / 60000))} minutes left`;
}
const J = (s) => (s ? JSON.parse(s) : null);
/** A threshold from the rule catalogue. Agents read their numbers here, never from their own constants. */
/** A proposed rule change replayed before it goes live (T2.3): values here stand in for the catalogue's while `withRuleChange` runs. */
let RULE_CHANGE = null;
export const withRuleChange = (change, fn) => { const before = RULE_CHANGE; RULE_CHANGE = change; try { return fn(); } finally { RULE_CHANGE = before; } };
export const param = (db, id, key) => { if (RULE_CHANGE && RULE_CHANGE.rule === id && key in RULE_CHANGE.params) return RULE_CHANGE.params[key]; const r = db.prepare('SELECT params FROM rules WHERE id = ?').get(id); const p = r && r.params ? JSON.parse(r.params) : {}; if (!(key in p)) throw new Error(`Rule ${id} has no parameter ${key}`); return p[key]; };
// ── Dated values (T1.11) ────────────────────────────────────────────────────────────────────────────────────────────
// A rule, price or item attribute is read as of the date of the document it judges: valid_from at or before it, and
// valid_to (exclusive) after it or open. ERPNext reads an Item Price this way; SAP reads a condition record this way.
const isoOf = (at) => (typeof at === 'string' ? at : at.toISOString());
const DATED = (table, keySql) => `SELECT * FROM ${table} WHERE ${keySql} AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC`;
/** The version of a rule in force at a time, with the rule set it belongs to. */
export const ruleAt = (db, id, at) => db.prepare(DATED('rule_versions', 'rule_id = ?')).get(id, isoOf(at), isoOf(at)) || null;
/** A rule's threshold as it stood at a time. A proposed change being replayed (withRuleChange) still stands in for it. */
export const paramAt = (db, id, key, at) => { if (RULE_CHANGE && RULE_CHANGE.rule === id && key in RULE_CHANGE.params) return RULE_CHANGE.params[key]; const v = ruleAt(db, id, at); if (!v) throw new Error(`Rule ${id} was not in force at ${isoOf(at)}`); const p = v.params ? JSON.parse(v.params) : {}; if (!(key in p)) throw new Error(`Rule ${id} has no parameter ${key}`); return p[key]; };
/** An item's price on a named list at a time, such as Northfield cost. */
export const priceAt = (db, sku, list, at) => db.prepare(DATED('item_prices', 'sku = ? AND price_list = ?')).get(sku, list, isoOf(at), isoOf(at)) || null;
/** What an item was at a time: description, pack and units per case, and whether Northfield had accepted that version. */
export const itemAt = (db, sku, at) => db.prepare(DATED('item_versions', 'sku = ?')).get(sku, isoOf(at), isoOf(at)) || null;
/** The document flow around one document: what it was created from, back to its origin, and what was created from it. */
export function documentFlow(db, docId) {
  const one = (id) => db.prepare('SELECT doc_id, doc_type, name, reference, sent_at, status FROM documents WHERE doc_id = ?').get(id);
  const up = []; const seen = new Set([docId]); let frontier = [docId];
  while (frontier.length) { const next = []; for (const id of frontier) for (const l of db.prepare('SELECT prev_doc_id, kind FROM document_links WHERE doc_id = ?').all(id)) if (!seen.has(l.prev_doc_id)) { seen.add(l.prev_doc_id); up.push({ ...one(l.prev_doc_id), link: l.kind, from: id }); next.push(l.prev_doc_id); } frontier = next; }
  const down = db.prepare('SELECT l.doc_id, l.kind FROM document_links l WHERE l.prev_doc_id = ?').all(docId).map((l) => ({ ...one(l.doc_id), link: l.kind }));
  return { document: one(docId), created_from: up, created_next: down };
}
/** The charge a rule carries, in dollars, for a number of cartons: "$150", "$150 plus $1 per carton". */
export const chargeOf = (db, code, cartons = 0) => { const r = db.prepare('SELECT charge FROM rules WHERE charge_code = ? AND charge IS NOT NULL ORDER BY id').get(code); if (!r) throw new Error(`No charge ${code}`); const m = r.charge.match(/\$(\d+(?:\.\d+)?)(?: plus \$(\d+(?:\.\d+)?) per carton)?/); if (!m) throw new Error(`Charge ${code} is not a fixed amount`); return Number(m[1]) + (m[2] ? Number(m[2]) * cartons : 0); };
export const rule = (db, id) => { if (!id) return null; const r = db.prepare('SELECT id, owner, statement, source, basis FROM rules WHERE id = ?').get(id); return r ? { ...r } : null; };
const nameOf = (db, id) => db.prepare('SELECT name FROM parties WHERE id = ?').get(id)?.name || id;
const docRow = (db, d) => ({ reference: d.reference, document: `${d.name} (${d.doc_type})`, sent: fmtET(d.sent_at), from: nameOf(db, d.sender_id), to: nameOf(db, d.receiver_id), status: d.status, link: `document/${encodeURIComponent(d.doc_id)}` });
// A NetSuite order keeps its own number (PO-104912); every other Northfield order is NR-.
export const normPo = (raw) => { const s = String(raw).trim().toUpperCase(); return /^PO-\d+$/.test(s) ? s : s.replace(/^PO\s*/, '').replace(/^(\d)/, 'NR-$1'); };

export function ownsOrder(db, po) { const o = db.prepare('SELECT supplier_id FROM orders WHERE po = ?').get(po); return !o ? 'missing' : o.supplier_id === COMPANY ? 'own' : 'other'; }

/** Rejections on a document as they stood at a time: open until the corrected document was sent. */
function openErrors(db, docId, t) {
  return db.prepare('SELECT e.*, r.sent_at reported_at, c.sent_at corrected_at FROM errors e JOIN documents r ON r.doc_id = e.reported_by LEFT JOIN documents c ON c.doc_id = e.corrected_by WHERE e.doc_id = ?').all(docId)
    .filter((e) => e.reported_at <= t && !(e.corrected_at && e.corrected_at <= t));
}
const dockOpen = (o) => et(o.requested_delivery, o.ship_to === 'DC4' ? '07:00' : '06:00');

/**
 * Orders needing attention at a time: rejected documents, and required documents not sent as their deadline nears.
 * Northfield documents only unless warehouse is true, which adds the Kinross shipping advice, due kinrossHours after the 940
 * (KX-945's 24 by default; P13's Watch Agent passes Priya's window).
 */
export function attention(db, asOf = storyClock(), { warehouse = false, kinrossHours = null } = {}) {
  const t = asOf.toISOString(); const out = []; const checked = []; const watching = [];
  // The Kinross window: the agreement (KX-945, 48 hours) and Ashby's own tighter rule (AP-7.2, 24 hours), which applies
  // unless the caller asks for another window. A missing warehouse advice is flagged when AP-3.4's hours are left.
  const agreed = param(db, 'KX-945', 'hours'); const own = param(db, 'AP-7.2', 'hours'); const win = kinrossHours ?? own; const flagH = param(db, 'AP-3.4', 'hours_left');
  const winRule = win === own ? 'AP-7.2' : 'KX-945';
  const since = new Date(asOf.getTime() - 12 * 24 * H).toISOString();
  const orders = db.prepare("SELECT * FROM orders WHERE supplier_id = ? AND stream <> 'store' AND received_at <= ? AND received_at >= ? ORDER BY po").all(COMPANY, t, since);
  const docsOf = db.prepare('SELECT doc_id, reference, doc_type, sent_at FROM documents WHERE po = ? AND sent_at <= ? AND test = 0 ORDER BY sent_at');
  const evOf = db.prepare("SELECT at FROM events WHERE po = ? AND at <= ? AND kind = 'wms.departure_scan' ORDER BY at");
  const anyErr = db.prepare('SELECT 1 x FROM errors e JOIN documents r ON r.doc_id = e.reported_by WHERE e.doc_id = ? AND r.sent_at <= ?');
  for (const o of orders) {
    const docs = docsOf.all(o.po, t);
    const of = (ty) => docs.filter((d) => d.doc_type === ty);
    const good = (ty) => of(ty).some((d) => !anyErr.get(d.doc_id, t));
    const firstOpen = (ty) => { for (const d of of(ty)) { const e = openErrors(db, d.doc_id, t)[0]; if (e) return { d, e }; } return null; };
    const add = (reason, ruleId, deadline, records, extra = {}) => out.push({ po: o.po, reason, rule: rule(db, ruleId), deadline: fmtET(deadline), time_left: timeLeft(deadline, asOf), _t: deadline.getTime(), records, link: `order/${encodeURIComponent(o.po)}`, ...extra });
    if (!of('855').length && !of('865').length) { const due = new Date(Date.parse(o.received_at) + 24 * H); if (due - asOf <= 8 * H) add('Order acknowledgment not sent', 'NF-1.4', due, [o.po]); }
    const dep = evOf.all(o.po, t).pop();
    if (dep) {
      const departed = new Date(dep.at);
      if (!good('856')) {
        const rej = firstOpen('856');
        if (rej) { const adv = db.prepare('SELECT doc_id, reference, sent_at FROM documents WHERE doc_id = ?').get(rej.e.reported_by); const fa = adv && db.prepare("SELECT reference, sent_at FROM documents WHERE doc_type = '997' AND answers_doc_id = ? AND sent_at <= ?").get(adv.doc_id, t);
          add(`Ship notice rejected: ${rej.e.cause}`, rej.e.rule_id || 'NF-4.2', dockOpen(o), [rej.d.reference], { rejected: rej.d.reference, corrected_ship_notice_due: 'Before the shipment reaches the DC', truck_left: fmtET(departed),
            ...(adv && rej.e.channel === 'Application advice (824)' ? { rejected_on: `Application advice (824) ${adv.reference}, ${fmtET(adv.sent_at)}`, acknowledged_by_ashby: fa ? `Technical acknowledgment (997) ${fa.reference}, ${fmtET(fa.sent_at)}` : 'Not yet', correction: 'Due: the corrected ship notice (856) is not sent', sent_value: rej.e.sent_value, allowed: rej.e.allowed } : {}) }); }
        else if (!of('856').length) add('Ship notice not sent; the truck has left', 'NF-4.2', new Date(departed.getTime() + H), [o.po], { truck_left: fmtET(departed), ...(asOf - departed > H ? { state: 'Late' } : {}) });
      }
      if (!good('810')) {
        const rej = firstOpen('810'); const due = new Date(departed.getTime() + 48 * H);
        if (rej) add(`Invoice rejected: ${rej.e.cause}`, rej.e.rule_id || 'NF-7.9', due, [rej.d.reference], { rejected: rej.d.reference, shipped: fmtET(departed) });
        else if (!of('810').length && due - asOf <= 24 * H) add('Invoice not sent', 'NF-7.9', due, [o.po], { shipped: fmtET(departed) });
      }
    }
    // A ship notice Trading Grid holds: the Supplier ERP shows the shipment fulfilled and the warehouse has not scanned the departure.
    if (!dep && !of('856').length) {
      const hold = db.prepare("SELECT at, data FROM events WHERE po = ? AND kind = 'tg.hold' AND at <= ? AND json_extract(data, '$.state') = 'Held' ORDER BY at DESC").get(o.po, t);
      if (hold && !db.prepare("SELECT 1 x FROM events WHERE po = ? AND kind = 'tg.release' AND at >= ? AND at <= ?").get(o.po, hold.at, t)) { const h = J(hold.data);
        const plan = db.prepare("SELECT data FROM events WHERE po = ? AND kind = 'erp.shipment_planned' AND at <= ? ORDER BY at DESC").get(o.po, t); const planned = plan ? J(plan.data).planned_departure : null;
        add('Ship notice held: the Supplier ERP shows the shipment fulfilled and Kinross has not scanned the departure', h.rule || 'NF-4.2', new Date(Date.parse(planned || hold.at) + H), [h.document],
          { state: 'Held', finding: h.finding, owner: h.owner, fix_in: h.fix_in, closes_on: h.closes_on, held_since: fmtET(hold.at), ...(planned ? { planned_departure: fmtET(planned), deadline_basis: 'One hour after the planned departure (NF-4.2)' } : {}), sent_to_northfield: 'Nothing' }); }
    }
    if (warehouse) {
      const w = db.prepare('SELECT * FROM warehouse_orders WHERE po = ? AND sent_at <= ?').get(o.po, t);
      if (w && !(w.advice_at && w.advice_at <= t)) { const due = new Date(Date.parse(w.sent_at) + win * H); const left = due - asOf;
        const read = db.prepare("SELECT at, data FROM events WHERE po = ? AND kind = 'tg.status_read' AND at <= ? ORDER BY at DESC").get(o.po, t);
        const facts = { warehouse_status: 'Unknown', warehouse_order_sent: fmtET(w.sent_at), window: `${win} hours after the warehouse shipping order`, ...(read ? { status_read: `${fmtET(read.at)}: ${J(read.data).response} from the ${J(read.data).target}` } : {}) };
        if (left <= flagH * H) add('Warehouse shipping advice (945) not received from Kinross', winRule, due, [w.ref], { state: left < 0 ? 'Overdue' : 'Missing', ...facts, owner: 'Kinross Logistics', closes_on: 'Kinross warehouse shipping advice (945)', drafted: 'Nothing', flagged_under: rule(db, 'AP-3.4') });
        else watching.push({ po: o.po, document: 'Warehouse shipping advice (945)', warehouse_order: w.ref, due: fmtET(due), time_left: timeLeft(due, asOf), ...facts, why_not_flagged: `More than ${flagH} hours left in the ${win}-hour window (${winRule})` }); }
    }
    const cha = of('865').pop();
    if (cha && asOf - new Date(cha.sent_at) <= 48 * H) checked.push({ po: o.po, item: 'Business acceptance of the change acknowledgment', state: 'Not expected', rule: rule(db, 'NF-1.5'), evidence: 'Technical acknowledgment (997) received', link: `order/${encodeURIComponent(o.po)}` });
  }
  out.sort((a, b) => a._t - b._t); out.forEach((x) => delete x._t);
  return { as_of: fmtET(asOf), retailer: 'Northfield Retailer', scope: warehouse ? 'Northfield documents and the Kinross shipping advice' : 'Northfield documents', orders_needing_attention: out.length, items: out, checked_nothing_to_chase: checked,
    ...(warehouse ? { kinross_window: { hours: win, rule: rule(db, winRule), agreement_with_kinross_hours: agreed, ashby_rule_hours: own, flag_when_hours_left: flagH }, watching_not_flagged: watching } : {}) };
}

/** Why a document was rejected, its rule, its correction, and later documents that failed for the same cause. */
export function explainRejection(db, reference) {
  const ref = reference.trim().toUpperCase();
  const docs = db.prepare("SELECT * FROM documents WHERE (upper(reference) = ? OR upper(doc_id) = ? OR upper(po) = ?) AND doc_type NOT IN ('997','824') ORDER BY sent_at").all(ref, ref, ref);
  if (!docs.length) return { found: false, message: `No document ${reference} in Ashby’s records` };
  if (docs.every((d) => d.supplier_id !== COMPANY)) return { found: false, not_available: true, message: NOT_AVAILABLE };
  const errs = []; for (const d of docs.filter((x) => x.supplier_id === COMPANY)) for (const e of db.prepare('SELECT * FROM errors WHERE doc_id = ?').all(d.doc_id)) errs.push({ d, e });
  if (!errs.length) return { found: true, rejected: false, documents: docs.map((d) => docRow(db, d)), message: `${reference} has no rejection on record` };
  return {
    found: true, rejected: true,
    rejections: errs.map(({ d, e }) => {
      const rep = db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(e.reported_by);
      const fix = e.corrected_by ? db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(e.corrected_by) : null;
      const later = db.prepare('SELECT e.status est, d.* FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE e.cause = ? AND d.supplier_id = ? AND d.sent_at > ? AND d.sent_at <= ? ORDER BY d.sent_at').all(e.cause, COMPANY, d.sent_at, new Date(Date.parse(d.sent_at) + 7 * 24 * H).toISOString());
      const root = db.prepare("SELECT data FROM events WHERE po = ? AND kind IN ('erp.setting','erp.substitution') ORDER BY at LIMIT 1").get(d.po);
      return {
        document: { reference: d.reference, type: `${d.name} (${d.doc_type})`, po: d.po, sent: fmtET(d.sent_at), link: `document/${encodeURIComponent(d.doc_id)}` },
        rejected_by: { document: `${rep.name} (${rep.doc_type})`, reference: rep.reference, at: fmtET(rep.sent_at), link: `document/${encodeURIComponent(rep.doc_id)}` },
        cause: e.cause, field: e.field, sent_value: e.sent_value, sent_length: e.cause.startsWith('PO reference') && e.sent_value ? `${e.sent_value.length} characters` : undefined,
        allowed: e.allowed, rule: rule(db, e.rule_id), root_cause: root ? J(root.data).note : null,
        status: e.status, correction: fix ? { resent: fmtET(fix.sent_at), status: fix.status } : null,
        same_cause_later: later.map((x) => ({ reference: x.reference, document: `${x.name} (${x.doc_type})`, po: x.po, sent: fmtET(x.sent_at), status: x.est === 'Open' ? 'Open: not corrected' : 'Corrected and accepted', link: `order/${encodeURIComponent(x.po)}` })),
        link: `order/${encodeURIComponent(d.po)}`,
      };
    }),
  };
}

/** EDI health for Ashby with Northfield over N days ending at a time. */
export function health(db, days = 30, asOf = storyClock()) {
  const end = asOf.toISOString(), start = new Date(asOf.getTime() - days * 24 * H).toISOString();
  const where = "supplier_id = ? AND partner_id = 'NORTHFIELD' AND test = 0 AND sent_at > ? AND sent_at <= ?";
  const byType = db.prepare(`SELECT doc_type, name, count(*) n FROM documents WHERE ${where} GROUP BY doc_type, name ORDER BY n DESC`).all(COMPANY, start, end);
  const total = byType.reduce((a, r) => a + r.n, 0);
  const all = db.prepare(`SELECT e.cause, e.channel, d.reference, d.status dst, c.sent_at corrected_at FROM errors e JOIN documents d ON d.doc_id = e.doc_id LEFT JOIN documents c ON c.doc_id = e.corrected_by
    WHERE d.supplier_id = ? AND d.partner_id = 'NORTHFIELD' AND d.test = 0 AND d.sent_at > ? AND d.sent_at <= ?`).all(COMPANY, start, end);
  const fails = all.filter((f) => !/^Held/.test(f.dst)); const holds = all.filter((f) => /^Held/.test(f.dst));
  const open = (f) => !(f.corrected_at && f.corrected_at <= end);
  const causes = {};
  for (const f of fails) { (causes[f.cause] ||= { cause: f.cause, failures: 0, open: 0 }); causes[f.cause].failures++; if (open(f)) causes[f.cause].open++; }
  const ranked = Object.values(causes).sort((a, b) => b.failures - a.failures || a.cause.localeCompare(b.cause));
  const top = ranked.slice(0, 3), rest = ranked.slice(3);
  return {
    partner: 'Northfield Retailer', period: `${days} days ending ${fmtET(asOf)}`, connection: 'Live',
    documents: total, by_type: byType.map((r) => ({ document: `${r.name} (${r.doc_type})`, count: r.n })),
    failures: fails.length, failure_rate: total ? `${((fails.length / total) * 100).toFixed(1)}%` : '0%',
    rejected_by: { application_advice_824: fails.filter((f) => f.channel.includes('824')).length, technical_acknowledgment_997: fails.filter((f) => f.channel.includes('997')).length },
    open_failures: fails.filter(open).map((f) => f.reference), top_causes: top,
    other_causes: { causes: rest.length, failures: rest.reduce((a, r) => a + r.failures, 0), largest: rest.length ? Math.max(...rest.map((r) => r.failures)) : 0 },
    invoices_held_not_rejected: holds.map((h) => h.reference),
  };
}

/** Delivery check for a list of POs: the requested delivery date against the receiving advice. */
export function deliveries(db, pos) {
  const rows = pos.map((raw) => {
    const po = normPo(raw); const own = ownsOrder(db, po);
    if (own === 'missing') return { po, result: 'No order found in Ashby’s records' };
    if (own === 'other') return { po, result: NOT_AVAILABLE };
    const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po);
    const sh = db.prepare('SELECT * FROM shipments WHERE po = ? ORDER BY shipped_at').all(po);
    const dep = db.prepare("SELECT at FROM events WHERE po = ? AND kind = 'wms.departure_scan' ORDER BY at").all(po);
    const rc = db.prepare('SELECT receipt, received_at, sum(qty) q FROM receipts WHERE po = ? GROUP BY receipt, received_at ORDER BY received_at').all(po);
    let result = 'No receipt record';
    if (rc.length) { const day = fmtET(rc[rc.length - 1].received_at).slice(0, 10); const late = Math.round((Date.parse(day) - Date.parse(o.requested_delivery)) / (24 * H)); result = late <= 0 ? 'On time' : `Late by ${late} day${late === 1 ? '' : 's'}`; }
    else if (sh.length) result = 'Shipped; no receipt recorded yet';
    return { po, result, requested_delivery: o.requested_delivery, truck_left: dep.length ? fmtET(dep[dep.length - 1].at) : null,
      ship_notices: sh.map((s) => ({ reference: s.shipment_id, sent: fmtET(s.sent_at), cartons: s.cartons })), receipts: rc.map((r) => ({ reference: r.receipt, received: fmtET(r.received_at), quantity: r.q })), link: `order/${encodeURIComponent(po)}` };
  });
  const own = rows.filter((r) => r.requested_delivery);
  return { basis: 'Requested delivery date on the purchase order against the date on Northfield’s receiving advice (861)', checked: rows.length, on_time: own.filter((r) => r.result === 'On time').length, late: own.filter((r) => r.result.startsWith('Late')).length, no_receipt: own.filter((r) => /receipt/.test(r.result)).length, orders: rows };
}

/** One order: lines, changes, every document in order, shipments, receipts, invoices, payments, charges and other records. */
/** An order that Northfield has not yet sent does not exist at that time (CALLS 72). */
export const notYet = (po, asOf) => ({ found: false, po, as_of: fmtET(asOf), message: `No such order as of ${fmtET(asOf)}: ${po}` });

export function lifecycle(db, poIn, asOf = null) {
  const po = normPo(poIn); const own = ownsOrder(db, po);
  if (own === 'missing') return { found: false, message: `No order ${po} in Ashby’s records` };
  if (own === 'other') return { found: false, not_available: true, message: NOT_AVAILABLE };
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po);
  if (asOf && o.received_at > asOf.toISOString()) return notYet(po, asOf);
  const locName = (id) => db.prepare('SELECT name FROM locations WHERE id = ?').get(id)?.name || id;
  return {
    found: true, po, retailer: 'Northfield Retailer', programme: o.programme, ship_to: locName(o.ship_to),
    received: fmtET(o.received_at), requested_delivery: o.requested_delivery, order_value: o.order_value, accepted_value: o.accepted_value,
    lines: db.prepare('SELECT line, sku, qty_original ordered_first, qty_ordered ordered_now, qty_accepted accepted, price, uom, delivery_date FROM order_lines WHERE po = ? ORDER BY line').all(po).map((r) => ({ ...r })),
    changes: db.prepare('SELECT seq change, line, code, qty, delivery_date, state, sent_at FROM order_changes WHERE po = ? ORDER BY seq, line').all(po).map((c) => ({ ...c, sent_at: fmtET(c.sent_at) })),
    shipments: db.prepare('SELECT * FROM shipments WHERE po = ? ORDER BY shipped_at').all(po).map((s) => ({ ship_notice: s.shipment_id, sent: fmtET(s.sent_at), truck_left: fmtET(s.shipped_at), cartons: s.cartons, ship_from: locName(s.ship_from), bill_of_lading: s.bol, seal: s.seal })),
    receipts: db.prepare('SELECT receipt, received_at, line, qty, short FROM receipts WHERE po = ? ORDER BY received_at, line').all(po).map((r) => ({ ...r, received_at: fmtET(r.received_at) })),
    invoices: db.prepare('SELECT invoice, sent_at, total, status, replaces FROM invoices WHERE po = ? ORDER BY sent_at').all(po).map((i) => ({ ...i, sent_at: fmtET(i.sent_at) })),
    payments: db.prepare('SELECT * FROM remittance_items WHERE po = ? ORDER BY paid_at').all(po).map((p) => ({ payment: p.payment, paid: fmtET(p.paid_at), invoice: p.invoice, amount: p.paid, invoice_amount: p.invoice_amount })),
    charges: db.prepare('SELECT * FROM adjustments WHERE po = ? ORDER BY paid_at').all(po).map((a) => ({ payment: a.payment, at: fmtET(a.paid_at), amount: a.amount, reference: a.reference, note: a.note })),
    documents: db.prepare('SELECT * FROM documents WHERE po = ? ORDER BY sent_at').all(po).map((d) => docRow(db, d)),
    rejections: db.prepare('SELECT e.cause, e.status, d.reference FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE d.po = ?').all(po).map((e) => ({ ...e })),
    other_records: db.prepare('SELECT at, kind, system, channel, data FROM events WHERE po = ? ORDER BY at').all(po).map((e) => ({ at: fmtET(e.at), record: e.kind, system: e.system, channel: e.channel, ...J(e.data) })),
    link: `order/${encodeURIComponent(po)}`,
  };
}

/** One document with its X12 text. */
export function document(db, reference) {
  const ref = reference.trim().toUpperCase();
  const d = db.prepare('SELECT * FROM documents WHERE upper(doc_id) = ? OR upper(reference) = ? ORDER BY sent_at DESC').get(ref, ref);
  if (!d) return { found: false, message: `No document ${reference} in Ashby’s records` };
  if (d.supplier_id !== COMPANY) return { found: false, not_available: true, message: NOT_AVAILABLE };
  const versions = db.prepare('SELECT doc_id, sent_at, status FROM documents WHERE reference = ? AND doc_type = ? ORDER BY sent_at').all(d.reference, d.doc_type);
  const body = J(d.body); delete body.lines; delete body.segments;
  return { found: true, ...docRow(db, d), po: d.po, control_numbers: { interchange: d.isa_ctl, group: d.gs_ctl, transaction_set: d.st_ctl }, file: `build/x12/${d.file}`, versions: versions.map((v) => ({ id: v.doc_id, sent: fmtET(v.sent_at), status: v.status })), x12: d.raw.length > 6000 ? `${d.raw.slice(0, 6000)}\n... (${d.raw.length} characters in the file)` : d.raw };
}

export function rules(db, { topic, document: doc, id, viewer = 'ASHBY' } = {}) {
  let rows = db.prepare('SELECT * FROM rules ORDER BY rule_set, id').all();
  // Ashby's policies and agreements are Ashby's own records; Northfield sees its guide, industry rules and law.
  if (viewer === 'NORTHFIELD') rows = rows.filter((r) => !/^Ashby/.test(r.owner));
  if (id) rows = rows.filter((r) => r.id.toLowerCase() === id.toLowerCase() || (r.charge_code || '').toLowerCase() === id.toLowerCase());
  if (topic) rows = rows.filter((r) => `${r.id} ${r.topic} ${r.statement} ${r.charge_code || ''}`.toLowerCase().includes(topic.toLowerCase()));
  if (doc) rows = rows.filter((r) => (r.doc_type || '').split(',').includes(String(doc)));
  return { catalogue: 'Northfield supplier guide 2026.2, industry and legal rules' + (viewer === 'NORTHFIELD' ? '' : ', and Ashby’s own policies and agreements'), precedence: PRECEDENCE, count: rows.length,
    rules: rows.map((r) => ({ id: r.id, owner: r.owner, implements: r.implements ? r.implements.split(',') : [], topic: r.topic, document: r.doc_type, rule: r.statement, window_hours: r.window_hours, limit: r.limit_value, charge_code: r.charge_code, charge: r.charge, basis: r.basis, source: r.source })) };
}

/** One promotion deduction against its deal, from the settlement Trading Grid recomputes (deal 889, 852, 856, 810). */
export function promotionOf(db, deduction) {
  const r = db.prepare('SELECT * FROM deal_settlements WHERE deduction_ref = ?').get(deduction); if (!r) return null;
  const deal = r.deal_id ? db.prepare('SELECT deal_id, kind, sku, rate, rate_uom, period_start, period_end, order_start, order_end, terms FROM deals WHERE deal_id = ?').get(r.deal_id) : null;
  return { deal: r.claimed_deal, deal_terms: deal ? { ...deal } : null, claimed: { from: r.claim_from, to: r.claim_to, qty: r.claimed_qty, uom: r.claimed_uom, rate: r.claimed_rate, amount: r.claimed_amount }, agreed_rate: r.agreed_rate, recomputed_qty: r.recomputed_qty,
    supported_amount: r.authorised_amount, unsupported_amount: r.unauthorised_amount, finding: r.decision === 'Matched' ? 'Supported by the deal' : 'Not supported by the deal', reason: r.reason,
    records: [...(r.deal_doc_id ? [`Promotion announcement (889) ${r.claimed_deal}`] : []), ...(J(r.records) || []).slice(0, 8), ...((J(r.records) || []).length > 8 ? [`and ${(J(r.records) || []).length - 8} more`] : [])] };
}

export function deductionCase(db, ref, asOf = storyClock()) {
  const key = ref.trim().toUpperCase();
  const opened = db.prepare("SELECT * FROM events WHERE kind = 'case.opened'").all().map((e) => ({ ...e, d: J(e.data) })).find((e) => e.d.case === key || e.d.deduction === key || e.po === normPo(key));
  if (!opened) return { found: false, message: `No deduction case ${ref} in Ashby’s records` };
  if (ownsOrder(db, opened.po) !== 'own') return { found: false, not_available: true, message: NOT_AVAILABLE };
  if (opened.at > asOf.toISOString()) return { found: false, message: `Case ${opened.d.case} was not yet opened at ${fmtET(asOf)}` };
  const T = asOf.toISOString();
  const c = opened.d; const po = opened.po;
  const adj = db.prepare('SELECT * FROM adjustments WHERE reference = ? AND paid_at <= ? ORDER BY paid_at').all(c.deduction, T);
  const taken = adj.find((a) => a.amount < 0); const repaid = adj.find((a) => a.amount > 0);
  const evs = db.prepare('SELECT * FROM events WHERE po = ? AND at <= ? ORDER BY at').all(po, T).map((e) => ({ ...e, d: J(e.data) }));
  const kinds = { 'carrier.bill_of_lading': 'Bill of lading with seal', 'carrier.delivery_receipt': 'Proof of delivery', 'wms.load_scan': 'Load scan by SSCC', 'wms.load_tally': 'Load tally by SSCC' };
  const evidence = Object.entries(kinds).map(([kind, name]) => { const e = evs.filter((x) => x.kind === kind).pop(); return { evidence: name, kind, state: !e ? 'Not found' : e.d.in_case === c.case ? 'In the case' : `Held by ${e.system}`, holder: e ? e.system : null, at: e ? fmtET(e.at) : null }; });
  const due = taken ? new Date(Date.parse(taken.paid_at) + 60 * 24 * H) : null;
  // A promotion deduction (P20): the evidence is the deal Northfield announced and the records the claimed amount is recomputed from.
  const promo = c.charge === 'PROMO' ? promotionOf(db, c.deduction) : null;
  if (promo) return { found: true, case: c.case, po, charge: c.charge, kind: 'Promotion deduction', amount: c.amount, deduction: c.deduction, deal: promo.deal, promotion: promo, dispute_amount: promo.unsupported_amount, evidence_rule: rule(db, 'NF-7.3'),
    withheld_on: taken ? { payment: taken.payment, at: fmtET(taken.paid_at), invoice: taken.invoice } : null, dispute_deadline: due ? fmtET(due) : null, dispute_window: due && asOf >= new Date(taken.paid_at) ? timeLeft(due, asOf) : null,
    evidence: promo.records.map((r) => ({ evidence: r, kind: 'document', state: 'On record in Trading Grid', holder: 'Trading Grid', at: null })),
    history: evs.filter((e) => (e.kind.startsWith('case.') || e.kind === 'erp.receivables_match') && (e.d.case === c.case || e.d.matched_to === c.deduction)).map((e) => ({ at: fmtET(e.at), record: e.kind, ...e.d })),
    repaid_on: repaid ? { payment: repaid.payment, at: fmtET(repaid.paid_at), amount: repaid.amount } : null, as_of: fmtET(asOf), other_charges_on_this_order: [], link: `order/${encodeURIComponent(po)}` };
  return { found: true, case: c.case, po, charge: c.charge, amount: c.amount, line: c.line, cartons: c.cartons, deduction: c.deduction, rule: rule(db, 'SH01'), evidence_rule: rule(db, 'NF-7.4'),
    withheld_on: taken ? { payment: taken.payment, at: fmtET(taken.paid_at) } : null, dispute_deadline: due ? fmtET(due) : null, dispute_window: due && asOf >= new Date(taken.paid_at) ? timeLeft(due, asOf) : null,
    evidence, history: evs.filter((e) => e.kind.startsWith('case.') || e.kind === 'erp.receivables_match' || e.kind === 'carrier.claim_filed').map((e) => ({ at: fmtET(e.at), record: e.kind, ...e.d })),
    repaid_on: repaid ? { payment: repaid.payment, at: fmtET(repaid.paid_at), amount: repaid.amount } : null,
    as_of: fmtET(asOf), other_charges_on_this_order: db.prepare('SELECT * FROM adjustments WHERE po = ? AND reference <> ? AND paid_at <= ? ORDER BY paid_at').all(po, c.deduction, T).map((a) => ({ payment: a.payment, at: fmtET(a.paid_at), amount: a.amount, reference: a.reference, note: a.note })), link: `order/${encodeURIComponent(po)}` };
}

export function deductions(db, asOf = storyClock(), from = null) {
  const start = from ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00-04:00` : from).toISOString() : et('2026-09-27', '00:00').toISOString();
  const rows = db.prepare("SELECT * FROM events WHERE kind = 'case.opened' AND at <= ? AND at >= ? ORDER BY at").all(asOf.toISOString(), start).map((e) => ({ ...J(e.data), po: e.po, opened: fmtET(e.at) })).filter((c) => ownsOrder(db, c.po) === 'own');
  const total = Math.round(rows.reduce((t, c) => t + c.amount, 0) * 100) / 100;
  return { as_of: fmtET(asOf), opened_from: fmtET(start), count: rows.length, total_amount: total, cases: rows.map((c) => ({ case: c.case, po: c.po, charge: c.charge, amount: c.amount, opened: c.opened, link: `order/${encodeURIComponent(c.po)}` })) };
}

export function calendar(db) { return { quarter: 'Sunday 27 September to Saturday 26 December 2026', history: 'Closed history from 29 March to 27 June 2026, settled by 7 August: orders, documents and decided deduction cases. Lists and replays cover the current quarter unless a from date reaches back.', story_clock: fmtET(storyClock()), moments: db.prepare('SELECT * FROM calendar ORDER BY as_of').all().map((m) => ({ ...m, as_of_eastern: fmtET(m.as_of) })) }; }
