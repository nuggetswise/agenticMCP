// Agent decisions as pure functions over the timeline. Each reads records, matches one row of its decision table and
// returns the next step, the evidence it used and what the simplest rule would have done. Nothing here sends or changes anything.
import { fmtET } from '../world/lib.js';
import { normPo, rule, deductionCase, storyClock } from './domain.js';

const J = (s) => (s ? JSON.parse(s) : {});
const H = 3600000;
const evs = (db, po, t) => db.prepare('SELECT * FROM events WHERE po = ? AND at <= ? ORDER BY at').all(po, t).map((e) => ({ ...e, d: J(e.data) }));
const out = (job, agent, record, asOf, o) => ({ job, agent, acting_for: 'Priya Raman', record, as_of: fmtET(asOf), ...o, authority: o.authority || 'Priya Raman approves before anything is sent', changes_nothing: true });

/** Watch Agent: a required document is missing or rejected. What do the source records say, and what happens next? */
export function watchDecision(db, poIn, asOf = storyClock()) {
  const po = normPo(poIn); const t = asOf.toISOString();
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po); if (!o) return { found: false, message: `No order ${po}` };
  const e = evs(db, po, t); const has = (k) => e.filter((x) => x.kind === k).pop();
  const docs = db.prepare('SELECT * FROM documents WHERE po = ? AND sent_at <= ? ORDER BY sent_at').all(po, t);
  const asn = docs.filter((d) => d.doc_type === '856'); const fulfil = has('erp.fulfilment_posted'), dep = has('wms.departure_scan'), load = has('wms.load_scan');
  const wh = db.prepare('SELECT * FROM warehouse_orders WHERE po = ? AND sent_at <= ?').get(po, t); const advice = wh && wh.advice_at && wh.advice_at <= t;
  const rej = asn.map((d) => db.prepare('SELECT e.*, r.sent_at rat, c.sent_at cat FROM errors e JOIN documents r ON r.doc_id = e.reported_by LEFT JOIN documents c ON c.doc_id = e.corrected_by WHERE e.doc_id = ?').all(d.doc_id).find((x) => x.rat <= t && !(x.cat && x.cat <= t))).find(Boolean);
  const evidence = { supplier_erp_fulfilment: fulfil ? `Posted ${fmtET(fulfil.at)}` : 'Not posted', warehouse_shipping_advice_945: wh ? (advice ? `Received ${fmtET(wh.advice_at)}` : 'Not received') : 'Not a warehouse order', load_scan: load ? `${load.d.cartons_loaded} of ${load.d.cartons_expected} cartons${load.d.trailer_state ? `; ${load.d.trailer_state}` : ''}` : 'None', departure_scan: dep ? fmtET(dep.at) : 'None', ship_notice: asn.length ? `${asn[asn.length - 1].reference} sent ${fmtET(asn[asn.length - 1].sent_at)}` : 'Not sent' };
  let row, next, detail = {};
  if (rej) { row = 'Ship notice sent and rejected'; next = 'show_rejection_and_draft_correction'; detail = { rejection: rej.cause, rule: rule(db, rej.rule_id), draft: 'Corrected ship notice from the current PO revision' }; }
  else if (asn.length) { row = 'Ship notice delivered'; next = 'nothing_to_do'; }
  else if (dep) { const late = asOf - new Date(dep.at) > H; row = 'Fulfilment posted and departure scanned'; next = 'draft_ship_notice_from_load_scan'; detail = { state_after_sending: late ? 'Late; stays Late after it is sent' : 'On time', rule: rule(db, 'NF-4.2') }; }
  else if (fulfil) { row = 'Fulfilment posted, but no shipping advice and the trailer has not departed'; next = 'hold_draft_and_ask_warehouse'; detail = { flag: 'Fulfilment posted early on the Supplier ERP record', draft_when: 'Departure is scanned' }; }
  else if (wh && !advice) { row = 'No fulfilment, no shipping advice, no departure'; next = 'ask_warehouse_for_status'; detail = { send_to_northfield: 'Nothing', warehouse_status: 'Unknown', rule: rule(db, 'KX-945') }; }
  else { row = 'Not shipped yet'; next = 'nothing_to_do'; }
  return out('missing_document', 'Watch Agent', po, asOf, { evidence, decision_row: row, next_step: next, ...detail, rule_baseline: 'Lists the missing document and its deadline; Priya checks each source herself', confirmed_by: 'Northfield receiving advice (861) for a ship notice; the 945 for a warehouse request' });
}

/** Claim Agent: a charge was withheld. Is the proof in the case, held elsewhere, replaceable, or absent? */
export function claimDecision(db, ref, asOf = storyClock()) {
  const c = deductionCase(db, ref, asOf); if (!c.found) return c;
  const st = Object.fromEntries(c.evidence.map((v) => [v.kind, v.state]));
  const scan = st['wms.load_scan'], tally = st['wms.load_tally']; const pod = db.prepare("SELECT data FROM events WHERE po = ? AND kind = 'carrier.delivery_receipt' ORDER BY at DESC").get(c.po);
  const exception = pod ? J(pod.data).exceptions : null;
  let row, next, detail = {};
  if (exception && exception !== 'None') { row = 'The delivery receipt notes damage in transit'; next = 'recommend_accept_and_file_carrier_claim'; detail = { delivery_exception: exception, rule: rule(db, 'NF-10.2') }; }
  else if (scan === 'In the case') { row = 'Load scan by SSCC is in the case'; next = 'dispute_now'; }
  else if (scan && scan.startsWith('Held by')) { row = 'Load scan is not in the case; the warehouse holds it'; next = 'request_load_scan_then_dispute'; detail = { request_from: scan.replace('Held by ', '') }; }
  else if (tally && tally !== 'Not found') { row = 'No load scan; the warehouse holds a load tally by SSCC'; next = 'attach_load_tally_and_dispute'; detail = { accepted_by: rule(db, 'NF-5.3') }; }
  else { row = 'No load scan or load tally anywhere'; next = 'recommend_accept'; detail = { reason: 'A dispute without the required evidence is not reviewed and draws ID01 $150', rule: rule(db, 'NF-7.5') }; }
  const baseline = scan === 'In the case' ? 'Dispute' : 'Accept the charge';
  return out('deduction', 'Claim Agent', c.case, asOf, { po: c.po, charge: c.charge, amount: c.amount, dispute_window: c.dispute_window, evidence: Object.fromEntries(c.evidence.map((v) => [v.evidence, v.state])), decision_row: row, next_step: next, ...detail, rule_baseline: baseline, dollars_the_rule_gives_up: baseline === 'Accept the charge' && next !== 'recommend_accept' && !next.startsWith('recommend_accept_and') ? c.amount : 0, confirmed_by: 'The repayment matched in Ashby’s receivables' });
}

/** Test Agent: a test ship notice failed the pack rule. Is the Supplier ERP record wrong, or the map? */
export function testDecision(db, document, asOf = storyClock()) {
  const t = db.prepare("SELECT * FROM events WHERE kind = 'test.ship_notice' AND at <= ? ORDER BY at").all(asOf.toISOString()).map((e) => ({ ...e, d: J(e.data) })).filter((e) => e.d.document === document.trim().toUpperCase());
  if (!t.length) return { found: false, message: `No test ship notice ${document} on record at ${fmtET(asOf)}` };
  const a = t[t.length - 1].d; const evidence = { ship_notice_pack: a.pack_sent, northfield_requires: a.pack_required, netsuite_item_pack: a.netsuite_item_pack, map_reads: a.map_field, attempt: a.attempt, delivered_to_northfield: a.delivered_to_northfield };
  let row, next, detail = {};
  if (a.result === 'Passed') { row = 'The test passes'; next = 'request_activation'; detail = { approver: 'Jordan Ellis' }; }
  else if (a.netsuite_item_pack !== a.pack_required) { row = 'NetSuite item pack differs from Northfield’s requirement'; next = 'propose_netsuite_item_change'; detail = { diagnosis: 'Data defect in the NetSuite item setup', record: 'NetSuite item', map: 'Unchanged' }; }
  else { row = 'NetSuite item pack is right; the ship notice still carries the wrong pack'; next = 'propose_map_correction'; detail = { diagnosis: 'Mapping defect: the map reads the wrong pack field', record: 'Ship notice map', netsuite: 'Unchanged' }; }
  return out('trade_test', 'Test Agent', a.document, asOf, { evidence, decision_row: row, next_step: next, ...detail, rule: rule(db, 'NF-4.9'), rule_baseline: 'Shows "Pack 12 submitted, 6 expected" and one fixed suggestion: change the pack configuration', confirmed_by: 'A passed retest, then the receiving advice on the first live shipment' });
}

/** Shelf Agent: a store shelf is empty or slow. Order, transfer, or wait for goods already on the way? */
export function shelfDecision(db, store, asOf = storyClock()) {
  const t = asOf.toISOString(); const s = String(store);
  const wk = db.prepare('SELECT * FROM store_activity WHERE store = ? AND sent_at <= ? ORDER BY period_end DESC').get(s, t);
  if (!wk) return { found: false, message: `No product activity for store ${store} at ${fmtET(asOf)}` };
  const all = db.prepare('SELECT * FROM store_activity WHERE period_end = ? AND sku = ?').all(wk.period_end, wk.sku);
  const sold = all.map((r) => r.sold).sort((a, b) => a - b); const median = sold[sold.length >> 1];
  const gln = db.prepare("SELECT id FROM locations WHERE name = ?").get(`Northfield Store ${s}`)?.id;
  const transit = gln ? db.prepare("SELECT sh.shipment_id, sh.sent_at FROM shipments sh JOIN orders o ON o.po = sh.po WHERE o.supplier_id = 'ASHBY' AND sh.ship_to = ? AND sh.sent_at <= ? AND EXISTS (SELECT 1 FROM shipment_lines l WHERE l.shipment_id = sh.shipment_id AND l.sku = ?) AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.shipment_id = sh.shipment_id AND r.received_at <= ?)").get(gln, t, wk.sku, t) : null;
  const stock = db.prepare("SELECT data FROM events WHERE kind = 'erp.inventory_read' AND at <= ? AND data LIKE ? ORDER BY at DESC").get(t, `%${wk.sku}%`);
  const weeks = wk.sold ? wk.on_hand / wk.sold : Infinity;
  const evidence = { week_ending: wk.period_end, sold: wk.sold, on_hand: wk.on_hand, chain_median_sold: median, weeks_of_supply: Number.isFinite(weeks) ? Math.round(weeks * 10) / 10 : null, ship_notice_in_transit: transit ? transit.shipment_id : 'None', ashby_available: stock ? J(stock.data).available : 'Not read' };
  let row, next, detail = {};
  if (wk.on_hand === 0 && transit) { row = 'Empty shelf, and a ship notice to this store is already in transit'; next = 'wait_for_goods_in_transit'; detail = { in_transit: transit.shipment_id }; }
  else if (wk.on_hand === 0) { row = 'Empty shelf, nothing in transit, Ashby has stock'; next = 'recommend_new_order'; detail = { to: 'Jordan Ellis', pairs: 40 }; }
  else if (weeks >= 12 && wk.sold < median / 2) { row = 'Slow sell-through with more than 12 weeks of supply'; next = 'recommend_transfer'; detail = { pairs: wk.on_hand - Math.round(8 * wk.sold), keep_weeks: 8 }; }
  else { row = 'Selling and in stock'; next = 'nothing_to_do'; }
  return out('shelf', 'Shelf Agent', `Store ${s}`, asOf, { evidence, decision_row: row, next_step: next, ...detail, authority: 'Priya Raman approves the recommendation; Jordan Ellis decides the order', rule_baseline: 'Flags the empty shelf and recommends a carton multiple', confirmed_by: 'The next week’s product activity (852)' });
}

/** Scout Agent: a shipment is about to break a rule. Which records disagree, and who has to act first? */
export function scoutDecision(db, poIn, asOf = storyClock()) {
  const po = normPo(poIn); const t = asOf.toISOString();
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po); if (!o) return { found: false, message: `No order ${po}` };
  const e = evs(db, po, t); const last = (k) => e.filter((x) => x.kind === k).pop();
  const load = last('wms.load_scan'), fulfil = last('erp.fulfilment_posted'), dep = last('wms.departure_scan'), phone = last('outside_confirmation'), inv = last('erp.invoice_draft'), route = last('routing.request'), stock = last('wms.inventory'), label = last('wms.label_scan');
  const change = db.prepare('SELECT count(*) n FROM order_changes WHERE po = ? AND sent_at <= ?').get(po, t).n;
  const evidence = { load_scan: load ? `${load.d.cartons_loaded} of ${load.d.cartons_expected}${load.d.trailer_state ? `; ${load.d.trailer_state}` : ''}${load.d.missing_state ? `; one carton ${load.d.missing_state.toLowerCase()}` : ''}` : 'None', supplier_erp_fulfilment: fulfil ? `Posted ${fmtET(fulfil.at)}` : 'Not posted', departure_scan: dep ? fmtET(dep.at) : 'None', order_changes: change };
  let row, next, detail = {};
  if (fulfil && !dep && load && /not departed/i.test(load.d.trailer_state || '')) { row = 'The Supplier ERP says shipped and the Kinross load scan says not departed'; next = 'check_departure_scan_and_ask_kinross'; detail = { before: 'Any ship notice is built', flag: 'Fulfilment posted before departure' }; }
  else if (load && load.d.cartons_loaded < load.d.cartons_expected && !dep) { row = 'A carton is staged but not on the trailer'; next = 'send_load_task_to_kinross'; detail = { carton: load.d.missing, cutoff: `Trailer seals in ${load.d.seals_in_minutes} minutes`, exposure_estimate: 451, rules: ['NF-4.5', 'NF-4.7', 'NF-4.8'] }; }
  else if (inv && inv.d.billed > inv.d.shipped) { row = 'The invoice draft bills more than shipped'; next = 'propose_invoice_correction_in_supplier_erp'; detail = { billed: inv.d.billed, shipped: inv.d.shipped, exposure_estimate: 100, rule: rule(db, 'NF-7.8') }; }
  else if (route && route.d.state === 'Missing') { row = 'No routing request for collect freight'; next = 'draft_routing_request'; detail = { exposure_estimate: 150, rule: rule(db, 'NF-3.2') }; }
  else if (stock && stock.d.available < stock.d.ordered_across_orders) { row = 'The warehouse has less stock than the orders need'; next = 'ask_priya_which_order_ships_short'; detail = { available: stock.d.available, ordered: stock.d.ordered_across_orders, rule: rule(db, 'NF-2.1') }; }
  else if (label && label.d.reused_sscc) { row = 'Cartons carry SSCCs already used'; next = 'send_relabel_task_to_kinross'; detail = { cartons: label.d.reused_sscc, exposure_estimate: 162, rule: rule(db, 'NF-4.1') }; }
  else if (phone && !change) { row = 'A quantity agreed by phone is not on an order change'; next = 'ask_buyer_for_order_change'; detail = { to: 'Jordan Ellis', rule: rule(db, 'NF-1.1') }; }
  else { row = 'Records agree'; next = 'nothing_to_do'; }
  return out('shipment_risk', 'Scout Agent', po, asOf, { evidence, decision_row: row, next_step: next, ...detail, rule_baseline: 'Flags the rule that would break; Priya works out which record is wrong and who must act', confirmed_by: 'Northfield receiving advice (861) matching the ship notice' });
}

/** Pace Agent: the scorecard fell. Do the short shipments in a period share one cause? */
export function paceDecision(db, { from = '2026-09-27', to = '2026-12-26' } = {}, asOf = storyClock()) {
  const rows = db.prepare("SELECT * FROM events WHERE kind = 'wms.short_pick' AND at >= ? AND at <= ?").all(`${from}T00:00:00.000Z`, `${to}T23:59:59.000Z`).map((e) => J(e.data));
  if (!rows.length) return { found: false, message: `No short shipments between ${from} and ${to}` };
  const g = {}; for (const r of rows) { const k = `${r.sku} at ${r.site === 'KIN-JOL' ? 'Kinross Joliet' : 'Kinross Groveport'}`; (g[k] ||= { key: k, lines: 0, cases: 0 }); g[k].lines++; g[k].cases += r.ordered - r.picked; }
  const ranked = Object.values(g).sort((a, b) => b.lines - a.lines); const share = ranked[0].lines / rows.length;
  let row, next, detail = {};
  if (rows.length >= 4 && share >= 0.7) { row = 'One item at one warehouse carries most of the short shipments'; next = 'draft_corrective_task'; detail = { cause: `${ranked[0].key}: stock below the available-to-promise figure`, task: 'Correct the available-to-promise feed; Kinross checks stock before picking' }; }
  else { row = 'Short shipments are split across warehouses or too few to tell'; next = 'ask_priya_before_drafting'; detail = { cause: 'Uncertain', deciding_record: 'Pick records by day at both warehouses' }; }
  return out('scorecard', 'Pace Agent', `${from} to ${to}`, asOf, { evidence: { short_shipped_lines: rows.length, by_item_and_warehouse: ranked, largest_share: `${Math.round(share * 100)}%` }, decision_row: row, next_step: next, ...detail, rule_baseline: 'Lists failing lines by reason code; Priya looks for the pattern', confirmed_by: 'Northfield’s next published scorecard on the same definition' });
}

export const JOBS = { missing_document: (db, r, t) => watchDecision(db, r, t), deduction: (db, r, t) => claimDecision(db, r, t), trade_test: (db, r, t) => testDecision(db, r, t), shelf: (db, r, t) => shelfDecision(db, r, t), shipment_risk: (db, r, t) => scoutDecision(db, r, t), scorecard: (db, r, t) => { const [from, to] = String(r || '').split(/\s+to\s+/); return paceDecision(db, from && to ? { from, to } : {}, t); } };
