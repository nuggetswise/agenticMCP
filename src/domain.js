// Answer logic shared by the MCP tools, the record pages and the build checks.
// Every answer is computed from the database at the scenario's fixed demo clock.
import { fmtET } from '../data/lib.js';

export const COMPANY = 'ASHBY';
export const NOT_AVAILABLE = 'Not available to Ashby';
const H = 3600000;
const NAME = { NORTHFIELD: 'Northfield Retailer', ASHBY: 'Ashby Supplier', KINROSS: 'Kinross Logistics', BROOKLINE: 'Brookline Goods', CEDARPINE: 'Cedar & Pine Home' };
const nm = (id) => NAME[id] || id;

export function scenario(db, id) {
  const s = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id);
  if (!s) return null;
  const override = process.env[`CLOCK_${id.toUpperCase()}`];
  return { ...s, clockDate: new Date(override || s.clock) };
}

export function timeLeft(deadline, clock) {
  const ms = deadline - clock;
  if (ms < 0) {
    const h = Math.round(-ms / H);
    return h >= 24 ? `Overdue by ${Math.floor(h / 24)} day${h >= 48 ? 's' : ''}` : `Overdue by ${h} hour${h === 1 ? '' : 's'}`;
  }
  const h = Math.floor(ms / H);
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} day${d === 1 ? '' : 's'} left`; }
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'} left`;
  return `${Math.max(1, Math.round(ms / 60000))} minutes left`;
}

function endOfDay(clock) {
  const s = fmtET(clock).slice(0, 10);
  // 23:59 Eastern on the clock's day
  const probe = new Date(clock.getTime());
  for (let k = 0; k < 48; k++) { const t = new Date(probe.getTime() + k * 30 * 60000); if (fmtET(t).slice(0, 10) !== s) return new Date(t.getTime() - 60000); }
  return new Date(clock.getTime() + 12 * H);
}

const rule = (db, id) => (id ? db.prepare('SELECT id, statement, source FROM rules WHERE id = ?').get(id) : null);
const docRow = (d) => ({ doc_id: d.doc_id, reference: d.reference, document: `${d.name} (${d.doc_type})`, sent: fmtET(d.sent_at), from: nm(d.sender_id), to: nm(d.receiver_id), status: d.status, link: `order/${encodeURIComponent(d.po || '')}#${encodeURIComponent(d.doc_id)}` });

export function ownsOrder(db, sc, po) {
  const o = db.prepare('SELECT supplier_id FROM orders WHERE scenario = ? AND po = ?').get(sc, po);
  if (!o) return 'missing';
  return o.supplier_id === COMPANY ? 'own' : 'other';
}

/** Orders needing attention: open rejections and required documents not yet sent, with the rule and time left. */
export function attention(db, sc) {
  const S = scenario(db, sc); const clock = S.clockDate; const eod = endOfDay(clock);
  const out = []; const checked = [];
  const orders = db.prepare('SELECT * FROM orders WHERE scenario = ? AND supplier_id = ? ORDER BY po').all(sc, COMPANY);
  const docsOf = db.prepare('SELECT * FROM documents WHERE scenario = ? AND po = ? AND sent_at <= ? ORDER BY sent_at');
  const errOf = db.prepare("SELECT * FROM errors WHERE scenario = ? AND doc_id = ? AND status = 'Open'");
  const shipOf = db.prepare('SELECT * FROM shipments WHERE scenario = ? AND po = ?');
  const whOf = db.prepare('SELECT * FROM warehouse_orders WHERE scenario = ? AND po = ?');
  for (const o of orders) {
    const docs = docsOf.all(sc, o.po, clock.toISOString());
    const has = (t) => docs.some((d) => d.doc_type === t && d.status === 'Delivered');
    const openErr = (t) => { for (const d of docs.filter((x) => x.doc_type === t)) { const e = errOf.get(sc, d.doc_id); if (e) return { d, e }; } return null; };
    const add = (reason, ruleId, deadline, records, extra = {}) => out.push({
      po: o.po, reason, rule: rule(db, ruleId), deadline: fmtET(deadline), time_left: timeLeft(deadline, clock), _t: deadline.getTime(),
      records, link: `order/${encodeURIComponent(o.po)}`, ...extra,
    });
    const received = new Date(o.received_at);
    if (!docs.some((d) => d.doc_type === '855')) add('Order acknowledgment not sent', 'NF-ACK', new Date(received.getTime() + 24 * H), [o.po]);
    const sh = shipOf.get(sc, o.po);
    if (sh) {
      const planned = new Date(sh.planned_departure); const departed = sh.departed_at ? new Date(sh.departed_at) : null;
      if (!has('856')) {
        const rej = openErr('856');
        if (rej) add(`Ship notice rejected: ${rej.e.cause}`, rej.e.rule_id, planned, [rej.d.reference], { rejected: rej.d.reference, truck: fmtET(planned) });
        else if (departed) add('Ship notice not sent; truck has left', 'NF-ASN', departed, [o.po], { truck: fmtET(departed), state: 'Late' });
        else if (planned <= eod) add('Ship notice not sent', 'NF-ASN', planned, [o.po], { truck: fmtET(planned) });
      }
      if (departed && !has('810')) {
        const rej = openErr('810'); const due = new Date(departed.getTime() + 48 * H);
        if (rej) add(`Invoice rejected: ${rej.e.cause}`, rej.e.rule_id, due, [rej.d.reference], { rejected: rej.d.reference, shipped: fmtET(departed) });
        else add('Invoice not sent', 'NF-INV', due, [o.po], { shipped: fmtET(departed) });
      }
    }
    const wh = whOf.get(sc, o.po);
    if (wh && !wh.advice_at) {
      const due = new Date(new Date(wh.order_sent_at).getTime() + 24 * H);
      if (due <= eod) add('Warehouse shipping advice (945) not received from Kinross', 'KX-945', due, [o.po], { warehouse_status: 'Unknown', order_sent: fmtET(wh.order_sent_at) });
    }
    const cha = docs.find((d) => d.doc_type === '865');
    if (cha) checked.push({ po: o.po, item: 'Business acceptance of the change acknowledgment', state: 'Not expected', rule: rule(db, 'NF-997'), evidence: 'Technical acknowledgment (997) received', link: `order/${encodeURIComponent(o.po)}` });
  }
  out.sort((a, b) => a._t - b._t);
  out.forEach((x) => delete x._t);
  return { scenario: sc, as_of: fmtET(clock), retailer: 'Northfield Retailer', orders_needing_attention: out.length, items: out, checked_nothing_to_chase: checked };
}

/** Why a document was rejected, its rule, its correction, and later documents with the same cause. */
export function explainRejection(db, sc, reference) {
  const S = scenario(db, sc);
  const ref = reference.trim().toUpperCase();
  const docs = db.prepare('SELECT * FROM documents WHERE scenario = ? AND (upper(reference) = ? OR upper(doc_id) = ? OR upper(po) = ?) ORDER BY sent_at').all(sc, ref, ref, ref);
  if (!docs.length) return { found: false, message: `No document ${reference} in Ashby’s records` };
  if (docs.every((d) => d.supplier_id !== COMPANY)) return { found: false, not_available: true, message: NOT_AVAILABLE };
  const own = docs.filter((d) => d.supplier_id === COMPANY);
  const errs = [];
  for (const d of own) for (const e of db.prepare('SELECT * FROM errors WHERE scenario = ? AND doc_id = ?').all(sc, d.doc_id)) errs.push({ d, e });
  if (!errs.length) return { found: true, rejected: false, documents: own.map(docRow), message: `${reference} has no rejection on record` };
  return {
    found: true, rejected: true, as_of: fmtET(S.clockDate),
    rejections: errs.map(({ d, e }) => {
      const rep = db.prepare('SELECT * FROM documents WHERE scenario = ? AND doc_id = ?').get(sc, e.reported_by);
      const fix = e.corrected_by ? db.prepare('SELECT * FROM documents WHERE scenario = ? AND doc_id = ?').get(sc, e.corrected_by) : null;
      const later = db.prepare(`SELECT e.*, d.reference, d.doc_type, d.name, d.sent_at, d.po FROM errors e JOIN documents d ON d.scenario = e.scenario AND d.doc_id = e.doc_id
        WHERE e.scenario = ? AND e.cause = ? AND d.supplier_id = ? AND d.sent_at > ? ORDER BY d.sent_at`).all(sc, e.cause, COMPANY, d.sent_at);
      return {
        document: { reference: d.reference, type: `${d.name} (${d.doc_type})`, po: d.po, sent: fmtET(d.sent_at) },
        rejected_by: { document: `${rep.name} (${rep.doc_type})`, reference: rep.reference, at: fmtET(rep.sent_at) },
        cause: e.cause, field: e.field, sent_value: e.sent_value,
        sent_length: e.field.includes('PO reference') && e.sent_value ? `${e.sent_value.length} characters` : undefined,
        allowed: e.allowed, rule: rule(db, e.rule_id), root_cause: e.root_cause,
        status: e.status, correction: fix ? { resent: fmtET(fix.sent_at), status: fix.status } : null,
        same_cause_later: later.map((x) => ({ reference: x.reference, document: `${x.name} (${x.doc_type})`, po: x.po, sent: fmtET(x.sent_at), status: x.status === 'Open' ? 'Open: not corrected' : 'Corrected and accepted', link: `order/${encodeURIComponent(x.po)}` })),
        link: `order/${encodeURIComponent(d.po)}`,
      };
    }),
  };
}

/** EDI health for Ashby with one retailer over N days ending at the clock. */
export function health(db, sc, days = 30) {
  const S = scenario(db, sc); const end = S.clockDate; const start = new Date(end.getTime() - days * 24 * H);
  const args = [sc, COMPANY, start.toISOString(), end.toISOString()];
  const where = 'scenario = ? AND supplier_id = ? AND retailer_id = \'NORTHFIELD\' AND sent_at > ? AND sent_at <= ?';
  const byType = db.prepare(`SELECT doc_type, name, count(*) n FROM documents WHERE ${where} GROUP BY doc_type, name ORDER BY n DESC`).all(...args);
  const total = byType.reduce((a, r) => a + r.n, 0);
  const fails = db.prepare(`SELECT e.cause, e.channel, d.reference, d.doc_type, e.status FROM errors e JOIN documents d ON d.scenario = e.scenario AND d.doc_id = e.doc_id WHERE d.scenario = ? AND d.supplier_id = ? AND d.retailer_id = 'NORTHFIELD' AND d.sent_at > ? AND d.sent_at <= ?`).all(...args);
  const causes = {};
  for (const f of fails) (causes[f.cause] ||= { cause: f.cause, failures: 0, open: 0 }), causes[f.cause].failures++, f.status === 'Open' && causes[f.cause].open++;
  const ranked = Object.values(causes).sort((a, b) => b.failures - a.failures || a.cause.localeCompare(b.cause));
  const top = ranked.slice(0, 3); const rest = ranked.slice(3);
  return {
    scenario: sc, partner: 'Northfield Retailer', period: `${days} days ending ${fmtET(end)}`, connection: 'Live',
    documents: total, by_type: byType.map((r) => ({ document: `${r.name} (${r.doc_type})`, count: r.n })),
    failures: fails.length, failure_rate: total ? `${((fails.length / total) * 100).toFixed(1)}%` : '0%',
    rejected_by: { application_advice_824: fails.filter((f) => f.channel.includes('824')).length, technical_acknowledgment_997: fails.filter((f) => f.channel.includes('997')).length },
    open_failures: fails.filter((f) => f.status === 'Open').map((f) => f.reference),
    top_causes: top,
    other_causes: { causes: rest.length, failures: rest.reduce((a, r) => a + r.failures, 0), largest: rest.length ? Math.max(...rest.map((r) => r.failures)) : 0 },
  };
}

/** Delivery check for a list of POs: requested date against the receiving advice. */
export function deliveries(db, sc, pos) {
  const rows = pos.map((raw) => {
    const po = raw.trim().toUpperCase().replace(/^PO\s*/, '').replace(/^(\d)/, 'NR-$1');
    const own = ownsOrder(db, sc, po);
    if (own === 'missing') return { po, result: 'No order found in Ashby’s records' };
    if (own === 'other') return { po, result: NOT_AVAILABLE };
    const o = db.prepare('SELECT * FROM orders WHERE scenario = ? AND po = ?').get(sc, po);
    const sh = db.prepare('SELECT * FROM shipments WHERE scenario = ? AND po = ?').get(sc, po);
    const asn = db.prepare("SELECT * FROM documents WHERE scenario = ? AND po = ? AND doc_type = '856' AND status = 'Delivered' ORDER BY sent_at LIMIT 1").get(sc, po);
    const rcv = db.prepare("SELECT * FROM documents WHERE scenario = ? AND po = ? AND doc_type = '861' ORDER BY sent_at LIMIT 1").get(sc, po);
    const body = rcv ? JSON.parse(rcv.body) : null;
    let result = 'No receipt record';
    if (body) {
      const late = Math.round((Date.parse(body.received_day) - Date.parse(o.requested_delivery)) / (24 * H));
      result = late <= 0 ? 'On time' : `Late by ${late} day${late === 1 ? '' : 's'}`;
    }
    return {
      po, result, requested_delivery: o.requested_delivery,
      truck_planned: sh ? fmtET(sh.planned_departure) : null, truck_left: sh && sh.departed_at ? fmtET(sh.departed_at) : null,
      ship_notice: asn ? { reference: asn.reference, sent: fmtET(asn.sent_at) } : null,
      receipt: rcv ? { reference: rcv.reference, received: body.received_day, at: fmtET(rcv.sent_at), cases: body.lines.reduce((a, l) => a + l.cases, 0) } : null,
      link: `order/${encodeURIComponent(po)}`,
    };
  });
  const own = rows.filter((r) => r.requested_delivery);
  return {
    scenario: sc, basis: 'Requested delivery date on the purchase order against the receiving advice (861) date',
    checked: rows.length, on_time: own.filter((r) => r.result === 'On time').length,
    late: own.filter((r) => r.result.startsWith('Late')).length, no_receipt: own.filter((r) => r.result === 'No receipt record').length,
    orders: rows,
  };
}

export function lifecycle(db, sc, poIn) {
  const po = poIn.trim().toUpperCase().replace(/^(\d)/, 'NR-$1');
  const own = ownsOrder(db, sc, po);
  if (own === 'missing') return { found: false, message: `No order ${po} in Ashby’s records` };
  if (own === 'other') return { found: false, not_available: true, message: NOT_AVAILABLE };
  const S = scenario(db, sc);
  const o = db.prepare('SELECT * FROM orders WHERE scenario = ? AND po = ?').get(sc, po);
  const lines = db.prepare('SELECT line, sku, qty_ordered, qty_accepted, case_price FROM order_lines WHERE scenario = ? AND po = ? ORDER BY line').all(sc, po);
  const docs = db.prepare('SELECT * FROM documents WHERE scenario = ? AND po = ? AND sent_at <= ? ORDER BY sent_at').all(sc, po, S.clockDate.toISOString());
  const errors = db.prepare('SELECT e.*, d.reference FROM errors e JOIN documents d ON d.scenario = e.scenario AND d.doc_id = e.doc_id WHERE e.scenario = ? AND d.po = ?').all(sc, po);
  const sh = db.prepare('SELECT * FROM shipments WHERE scenario = ? AND po = ?').all(sc, po);
  const conf = db.prepare('SELECT * FROM confirmations WHERE scenario = ? AND po = ?').all(sc, po);
  const ded = db.prepare('SELECT * FROM deductions WHERE scenario = ? AND po = ?').all(sc, po);
  return {
    found: true, as_of: fmtET(S.clockDate), po, retailer: 'Northfield Retailer', programme: o.programme, ship_to: (db.prepare('SELECT name FROM locations WHERE id = ?').get(o.ship_to) || { name: o.ship_to }).name,
    received: fmtET(o.received_at), requested_delivery: o.requested_delivery, order_value: o.order_value, lines,
    shipments: sh.map((s) => ({ shipment: s.shipment_id, truck_planned: fmtET(s.planned_departure), truck_left: s.departed_at ? fmtET(s.departed_at) : 'Not departed', cartons: s.cartons })),
    documents: docs.map(docRow), rejections: errors.map((e) => ({ reference: e.reference, cause: e.cause, status: e.status })),
    outside_confirmations: conf.map((c) => ({ method: c.method, confirmed_by: c.confirmed_by, recorded_by: c.recorded_by, at: fmtET(c.at), scope: c.scope })),
    deductions: ded.map((d) => ({ case: d.case_id, amount: d.amount, reason: d.reason, decision: d.decision, decided: d.decided_at ? fmtET(d.decided_at) : null })),
    link: `order/${encodeURIComponent(po)}`,
  };
}

export function rules(db, { topic, document } = {}) {
  let rows = db.prepare('SELECT * FROM rules ORDER BY rule_set DESC, id').all();
  if (topic) rows = rows.filter((r) => `${r.topic} ${r.statement}`.toLowerCase().includes(topic.toLowerCase()));
  if (document) rows = rows.filter((r) => (r.doc_type || '').split(',').includes(String(document)));
  return {
    retailer: 'Northfield Retailer',
    rules: rows.map((r) => ({ id: r.id, applies_to: r.rule_set === 'kinross' ? 'Kinross Logistics (3PL)' : 'Northfield Retailer', topic: r.topic, document: r.doc_type, rule: r.statement, window_hours: r.window_hours, limit: r.limit_value, source: r.source })),
  };
}
