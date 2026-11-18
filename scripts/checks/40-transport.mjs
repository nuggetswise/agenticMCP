// T1.15 Transport: routing (753, 754), load tender (204), carrier milestones (214) and freight invoice (210) agree with
// the world's existing records, and an RT01 routing charge or an on-time result is decided from carrier milestones as of
// the event date.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { decideRoutingCharge, decideOnTime, COLLECT_FROM, freightCharge } from '../../world/stages/transport.js';
import { P10_WINDOW } from '../../world/generate.js';
import { et, etDay } from '../../world/lib.js';

/** The end of the Eastern day of an event: what was on record by then. */
const endOfEtDay = (iso) => et(etDay(new Date(iso)), '23:59').toISOString();

export default function ({ db, ash, nf, ok, eq, none, n, ROOT }) {
  // Lakeline has an interchange id, and every transport document travels on the pair and X12 version it should.
  eq('transport.lakeline_has_interchange_id', n("SELECT count(*) n FROM parties WHERE id = 'LAKELINE' AND isa = 'LAKELINE'"), 1);
  none('transport.documents_on_their_pair', `SELECT doc_id FROM documents WHERE (doc_type = '753' AND (sender_id, receiver_id) <> ('ASHBY', 'NORTHFIELD')) OR (doc_type = '754' AND (sender_id, receiver_id) <> ('NORTHFIELD', 'ASHBY'))
    OR (doc_type = '204' AND (sender_id, receiver_id) <> ('ASHBY', 'LAKELINE')) OR (doc_type IN ('214', '210') AND (sender_id, receiver_id) <> ('LAKELINE', 'ASHBY'))`);
  none('transport.753_754_are_004030_others_004010', `SELECT doc_id FROM documents WHERE (doc_type IN ('753','754') AND raw NOT LIKE '%*X*004030~%') OR (doc_type IN ('204','214','210') AND raw NOT LIKE '%*X*004010~%')`);
  none('transport.every_transport_document_delivered', "SELECT doc_id, status FROM documents WHERE doc_type IN ('753','754','204','214','210') AND status <> 'Delivered'");
  none('transport.no_routing_document_in_p10_window', 'SELECT doc_id FROM documents WHERE doc_type IN (\'753\',\'754\') AND sent_at > ? AND sent_at <= ?', new Date(P10_WINDOW.start).toISOString(), new Date(P10_WINDOW.end).toISOString());

  // Routing: every collect shipment (Kinross replenishment, pickup from 6 Dec) has one 753, answered by one 754, sent by NF-3.2's time.
  const collect = `SELECT s.shipment_id, s.po FROM shipments s JOIN orders o ON o.po = s.po JOIN shipment_plans p ON p.po = s.po
    WHERE o.stream = 'replenishment' AND s.ship_from IN ('KIN-GRV','KIN-JOL') AND p.planned_departure >= '${new Date(`${COLLECT_FROM}T05:00:00Z`).toISOString()}'`;
  none('transport.routing_request_per_collect_shipment', `SELECT c.po FROM (${collect}) c WHERE (SELECT count(*) FROM routing_requests r WHERE r.po = c.po AND r.shipment_id = c.shipment_id AND r.status = 'Routed') <> 1`);
  none('transport.routing_only_for_collect_shipments', `SELECT request_id FROM routing_requests WHERE po NOT IN (SELECT po FROM (${collect})) AND request_id <> 'RR-460241'`); // RR-460241 is P5's wholesale collect order, routed on Priya Raman's approval (18 November 2026)
  none('transport.routing_requested_before_due', 'SELECT request_id, sent_at, due_by FROM routing_requests WHERE sent_at >= due_by');
  none('transport.instructions_follow_request_and_precede_pickup', 'SELECT request_id FROM routing_requests WHERE routed_at <= sent_at OR routed_at >= pickup_from OR pickup_from <> ready_at OR scac <> \'LKLF\' OR carrier_id <> \'LAKELINE\'');
  // P5 shows NR-460241's routing request as missing at its clock (17:12 ET, 8 December). Priya Raman approves it at 17:18; Trading Grid
  // sends it at 17:19, Northfield acknowledges it and answers with routing instructions before its 10:00 deadline next morning.
  { const g = (sql) => db.prepare(sql).get(); const rr = g("SELECT doc_id, sent_at FROM documents WHERE doc_type = '753' AND po = 'NR-460241'"); const fa = g(`SELECT sent_at, sender_id FROM documents WHERE doc_type = '997' AND answers_doc_id = '${rr.doc_id}'`); const ri = g("SELECT sent_at, sender_id FROM documents WHERE doc_type = '754' AND po = 'NR-460241'"); const ap = g("SELECT at, json_extract(data, '$.released_by') by FROM events WHERE kind = 'tg.release' AND po = 'NR-460241'"); const r = g("SELECT status, load_id, due_by, pickup_from FROM routing_requests WHERE request_id = 'RR-460241'");
    eq('transport.p5_routing_request_sent_on_approval_and_answered', [n("SELECT count(*) n FROM documents WHERE doc_type = '753' AND po = 'NR-460241' AND sent_at <= '2026-12-08T22:12:00.000Z'"), ap.by, ap.at < rr.sent_at, rr.sent_at, rr.sent_at < fa.sent_at, fa.sender_id, fa.sent_at < ri.sent_at, ri.sender_id, ri.sent_at < '2026-12-09T15:00:00.000Z', r.status, r.load_id, rr.sent_at < r.due_by, r.pickup_from],
      [0, 'Priya Raman', true, '2026-12-08T22:19:00.000Z', true, 'NORTHFIELD', true, 'NORTHFIELD', true, 'Routed', 'NRL-460241', true, '2026-12-10T20:00:00.000Z']); }
  // The assigned pickup on the 754 is the one Lakeline's pickup_missed record names, for all 18 cases.
  const missed = db.prepare("SELECT c.po, c.at, c.assigned_pickup FROM carrier_events c WHERE c.kind = 'pickup_missed' ORDER BY c.po").all();
  eq('transport.assigned_pickup_matches_carrier_record', [missed.length, missed.filter((m) => n('SELECT count(*) n FROM routing_requests WHERE po = ? AND pickup_from = ?', m.po, m.assigned_pickup) === 1).length], [18, 18]);

  // Load tenders: every prepaid Ashby shipment from its own warehouse with a pickup in the quarter has one 204, sent before pickup.
  const prepaid = `SELECT s.shipment_id, s.po FROM shipments s JOIN orders o ON o.po = s.po JOIN shipment_plans p ON p.po = s.po
    WHERE o.stream = 'replenishment' AND s.ship_from = 'ASH-WH1' AND p.planned_departure >= '2026-09-27T04:00:00.000Z' AND p.planned_departure < '2026-12-27T05:00:00.000Z'`;
  none('transport.load_tender_per_prepaid_shipment', `SELECT p.po FROM (${prepaid}) p WHERE (SELECT count(*) FROM loads l WHERE l.po = p.po AND l.shipment_id = p.shipment_id AND l.terms = 'Prepaid' AND l.tendered_by = 'ASHBY') <> 1`);
  none('transport.loads_are_prepaid_or_routed_collect', `SELECT load_id FROM loads WHERE NOT ((terms = 'Prepaid' AND po IN (SELECT po FROM (${prepaid}))) OR (terms = 'Collect' AND request_id IN (SELECT request_id FROM routing_requests)))`);
  none('transport.tender_before_pickup_and_after_plan', "SELECT l.load_id FROM loads l JOIN documents d ON d.doc_id = l.source_doc_id JOIN shipment_plans p ON p.po = l.po WHERE l.terms = 'Prepaid' AND (d.sent_at >= l.pickup_at OR d.sent_at < p.at OR l.pickup_at <> p.planned_departure)");

  // Milestones agree with the warehouse departure scan and the 856, Lakeline's delivery receipt and the 861.
  none('transport.departure_milestone_is_the_departure_scan_and_856', `SELECT l.load_id FROM loads l JOIN shipments s ON s.shipment_id = l.shipment_id
    WHERE l.load_id <> 'NRL-460241' AND ((SELECT count(*) FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'AF') <> 1
       OR (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'AF') <> s.shipped_at
       OR NOT EXISTS (SELECT 1 FROM warehouse_scans w WHERE w.po = l.po AND w.kind = 'departure_scan' AND w.at = s.shipped_at))`); // NRL-460241 (P5) has routing instructions only: no carrier status was asked for or added
  none('transport.delivery_milestone_is_the_delivery_receipt_before_861', `SELECT l.load_id FROM loads l
    WHERE (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'D1') IS NOT (SELECT max(c.at) FROM carrier_events c WHERE c.po = l.po AND c.kind = 'delivery_receipt')
       OR (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'D1') >= (SELECT min(r.received_at) FROM receipts r WHERE r.shipment_id = l.shipment_id)`);
  none('transport.milestones_in_order', `SELECT l.load_id FROM loads l WHERE NOT ((SELECT max(at) FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'X3') < (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'AF')
    AND (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'AF') < (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'X1')
    AND (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'X1') < (SELECT at FROM shipment_status m WHERE m.load_id = l.load_id AND m.status_code = 'D1'))`);
  none('transport.status_sent_after_it_happened', 'SELECT doc_id, seq FROM shipment_status WHERE sent_at < at');
  none('transport.missed_pickup_only_where_carrier_record_says_so', "SELECT DISTINCT l.po FROM shipment_status m JOIN loads l ON l.load_id = m.load_id WHERE m.status_code = 'SD' AND l.terms = 'Collect' AND l.po NOT IN (SELECT po FROM carrier_events WHERE kind = 'pickup_missed')");

  // Freight invoices: one per prepaid load, after delivery, at Lakeline's rate card in force on the pickup date.
  none('transport.freight_invoice_per_prepaid_load', "SELECT load_id FROM loads WHERE terms = 'Prepaid' AND (SELECT count(*) FROM freight_invoices f WHERE f.load_id = loads.load_id) <> 1");
  none('transport.freight_invoice_after_delivery', "SELECT f.invoice FROM freight_invoices f WHERE f.sent_at <= (SELECT at FROM shipment_status m WHERE m.load_id = f.load_id AND m.status_code = 'D1')");
  { let bad = 0; for (const f of db.prepare('SELECT f.*, l.ship_from, l.ship_to, l.pickup_at, l.cartons FROM freight_invoices f JOIN loads l ON l.load_id = f.load_id').all()) {
      const c = freightCharge(f.ship_from, f.ship_to, etDay(new Date(f.pickup_at)), f.cartons);
      if (!c || c.total !== f.total || Math.abs(f.linehaul + f.fuel - f.total) > 0.005 || f.status !== 'Matches rate card') bad++; }
    eq('transport.freight_invoice_matches_rate_at_pickup_date', bad, 0);
    // The fuel surcharge changed on 1 Nov: an invoice before and after reads the rate in force on its own pickup date.
    const fuelPct = db.prepare("SELECT round(f.fuel / f.linehaul, 2) p FROM freight_invoices f JOIN loads l ON l.load_id = f.load_id WHERE l.pickup_at < '2026-11-01' LIMIT 1").get()?.p;
    const fuelPct2 = db.prepare("SELECT round(f.fuel / f.linehaul, 2) p FROM freight_invoices f JOIN loads l ON l.load_id = f.load_id WHERE l.pickup_at > '2026-11-02' LIMIT 1").get()?.p;
    eq('transport.freight_rate_read_by_pickup_date', [fuelPct, fuelPct2], [0.18, 0.21]); }

  // Document flow: 753 from the 855, 754 from its 753, 204 from the 850, 214 from its 204 or 754, 210 from its 204.
  const want = { 753: ['855', 'requests routing for'], 754: ['753', 'routes'], 204: ['850', 'tenders freight for'], 210: ['204', 'bills freight for'] };
  for (const [t, [p, k]] of Object.entries(want)) none(`transport.flow_${t}_from_${p}`, `SELECT d.doc_id FROM documents d WHERE d.doc_type = '${t}' AND NOT EXISTS (SELECT 1 FROM document_links x JOIN documents q ON q.doc_id = x.prev_doc_id WHERE x.doc_id = d.doc_id AND q.doc_type = '${p}' AND x.kind = '${k}' AND q.po = d.po)`);
  none('transport.flow_214_from_its_tender_or_instructions', `SELECT d.doc_id FROM documents d WHERE d.doc_type = '214' AND NOT EXISTS (SELECT 1 FROM document_links x JOIN documents q ON q.doc_id = x.prev_doc_id
    WHERE x.doc_id = d.doc_id AND x.kind = 'reports status on' AND q.doc_type IN ('204','754') AND q.reference = json_extract(d.body, '$.load'))`);

  // The dispute the gate settles: RT01 for each pickup_missed case, from Lakeline's 214s as known at the end of that day.
  const decisions = missed.map((m) => decideRoutingCharge(db, m.po, endOfEtDay(m.at)));
  eq('transport.rt01_stands_for_every_pickup_missed_case', decisions.filter((d) => d.stands && d.freight_not_ready && d.carrier_arrived <= d.assigned_pickup).length, 18);
  // As of the morning before the pickup, the milestones were not yet known: nothing to charge.
  eq('transport.rt01_not_decided_before_the_milestones', missed.filter((m) => decideRoutingCharge(db, m.po, new Date(new Date(m.assigned_pickup).getTime() - 3 * 3600000).toISOString()).stands).length, 0);
  // Every other collect shipment left inside its window: no RT01.
  eq('transport.no_rt01_where_freight_left_in_window', db.prepare("SELECT po, pickup_to FROM routing_requests WHERE po NOT IN (SELECT po FROM carrier_events WHERE kind = 'pickup_missed')").all().filter((r) => decideRoutingCharge(db, r.po, endOfEtDay(r.pickup_to)).stands).length, 0);
  // Mutation on a scratch copy: the 214 now shows Lakeline arriving after the pickup window. RT01 no longer stands.
  {
    const s = new DatabaseSync(':memory:'); s.exec(`ATTACH DATABASE '${join(ROOT, 'build', 'tg.db')}' AS m`);
    s.exec("CREATE TABLE routing_requests AS SELECT * FROM m.routing_requests WHERE po IN (SELECT po FROM m.carrier_events WHERE kind = 'pickup_missed'); CREATE TABLE shipment_status AS SELECT * FROM m.shipment_status WHERE load_id IN (SELECT load_id FROM routing_requests)");
    s.exec("UPDATE shipment_status SET at = strftime('%Y-%m-%dT%H:%M:%S.000Z', (SELECT pickup_to FROM routing_requests r WHERE r.load_id = shipment_status.load_id), '+3 hours') WHERE status_code IN ('X3','SD') AND at < (SELECT pickup_to FROM routing_requests r WHERE r.load_id = shipment_status.load_id)");
    const late = missed.map((m) => decideRoutingCharge(s, m.po, endOfEtDay(m.at)));
    eq('transport.rt01_falls_when_carrier_late', [late.filter((d) => !d.stands && /late/.test(d.why)).length, late.filter((d) => d.stands).length], [18, 0]);
    s.close();
  }
  // On time for prepaid loads (NF-8.1): decided from the 214 arrival, as known on the date asked; it agrees with the 861.
  { const rows = db.prepare("SELECT l.load_id, l.po, l.deliver_by, (SELECT min(received_at) FROM receipts r WHERE r.shipment_id = l.shipment_id) rcv FROM loads l WHERE l.terms = 'Prepaid'").all();
    const dis = rows.filter((r) => { const d = decideOnTime(db, r.load_id, '2027-01-10T00:00:00.000Z'); return d.on_time !== (r.rcv <= r.deliver_by); });
    eq('transport.on_time_from_milestones_agrees_with_receipt', dis.length, 0);
    // Every prepaid load arrived in time; a scratch copy whose 214 puts LT-46101's DC arrival an hour past its deadline is judged late.
    eq('transport.on_time_prepaid_loads', rows.filter((r) => decideOnTime(db, r.load_id, '2027-01-10T00:00:00.000Z').on_time === true).length, rows.length);
    const s = new DatabaseSync(':memory:'); s.exec(`ATTACH DATABASE '${join(ROOT, 'build', 'tg.db')}' AS m`);
    s.exec("CREATE TABLE loads AS SELECT * FROM m.loads WHERE load_id = 'LT-46101'; CREATE TABLE shipment_status AS SELECT * FROM m.shipment_status WHERE load_id = 'LT-46101'");
    s.exec("UPDATE shipment_status SET at = strftime('%Y-%m-%dT%H:%M:%S.000Z', (SELECT deliver_by FROM loads), '+1 hours') WHERE status_code = 'X1'");
    const sent = n("SELECT min(sent_at) n FROM shipment_status WHERE load_id = 'LT-46101'");
    eq('transport.on_time_decided_from_milestones', [decideOnTime(db, 'LT-46101', '2026-12-01T00:00:00.000Z').on_time, decideOnTime(s, 'LT-46101', '2026-12-01T00:00:00.000Z').on_time, decideOnTime(db, 'LT-46101', sent.slice(0, 10) + 'T00:00:00.000Z').on_time], [true, false, null]);
    s.close(); }

  // Scoped copies: Ashby sees every transport record; Northfield sees only the routing it exchanged.
  const cnt = (d, t) => d.prepare(`SELECT count(*) n FROM ${t}`).get().n;
  eq('transport.ashby_sees_all_transport_records', ['routing_requests', 'loads', 'shipment_status', 'freight_invoices', 'carrier_rates', 'freight_terms'].map((t) => cnt(ash, t)),
    ['routing_requests', 'loads', 'shipment_status', 'freight_invoices', 'carrier_rates', 'freight_terms'].map((t) => cnt(db, t)));
  eq('transport.ashby_sees_its_carrier_documents', ash.prepare("SELECT count(*) n FROM documents WHERE partner_id = 'LAKELINE'").get().n, n("SELECT count(*) n FROM documents WHERE partner_id = 'LAKELINE'"));
  eq('transport.northfield_sees_routing_only', [cnt(nf, 'routing_requests'), cnt(nf, 'loads'), cnt(nf, 'shipment_status'), cnt(nf, 'freight_invoices'), cnt(nf, 'carrier_rates'), nf.prepare("SELECT count(*) n FROM freight_terms WHERE terms <> 'Collect'").get().n],
    [cnt(db, 'routing_requests'), 0, 0, 0, 0, 0]);
  // On collect freight Northfield routes the load and Lakeline is its carrier (NF-3.3), so Lakeline's 214 on a routed load is
  // Northfield's record (P19, owner 16 Nov). Tenders (204), freight invoices (210) and every carrier document on prepaid loads stay Ashby's.
  eq('transport.northfield_sees_status_on_routed_loads_only', [nf.prepare("SELECT count(*) n FROM documents WHERE doc_type = '214' AND po IN (SELECT po FROM routing_requests)").get().n, nf.prepare("SELECT count(*) n FROM documents WHERE partner_id = 'LAKELINE' AND (doc_type <> '214' OR po NOT IN (SELECT po FROM routing_requests))").get().n],
    [n("SELECT count(*) n FROM documents WHERE doc_type = '214' AND partner_id = 'LAKELINE' AND po IN (SELECT po FROM routing_requests)"), 0]);
  eq('transport.northfield_never_sees_carrier_documents', [nf.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('204','210') OR (partner_id = 'LAKELINE' AND doc_type <> '214')").get().n, nf.prepare("SELECT count(*) n FROM document_links l JOIN documents d ON d.doc_id = l.prev_doc_id WHERE d.doc_type IN ('204','214','210')").get().n,
    nf.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('753','754')").get().n], [0, 0, n("SELECT count(*) n FROM documents WHERE doc_type IN ('753','754')")]);
}
