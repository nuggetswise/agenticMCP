// Agent decisions as pure functions over the timeline. Each reads records, matches one row of its decision table and
// returns the next step, the evidence it used and what the simplest rule would have done. Nothing here sends or changes anything.
import { fmtET } from '../world/lib.js';
import { normPo, rule, deductionCase, storyClock, param, chargeOf, withRuleChange } from './domain.js';
import { foundBy } from './credit.js';

const J = (s) => (s ? JSON.parse(s) : {});
const H = 3600000;
const evs = (db, po, t) => db.prepare('SELECT * FROM events WHERE po = ? AND at <= ? ORDER BY at').all(po, t).map((e) => ({ ...e, d: J(e.data) }));
/** A rule's time window in hours, as the catalogue states it (R22). */
const windowHours = (db, id) => { const r = db.prepare('SELECT window_hours FROM rules WHERE id = ?').get(id); if (!r || r.window_hours == null) throw new Error(`Rule ${id} has no time window`); return r.window_hours; };
/** One finding, credited to the rule that found it (`found_by`): the rule the matched row names, else the rule set's lead rule. No agent is named. */
const out = (job, agent, record, asOf, o) => ({ job, found_by: foundBy(agent, o.credit || o.rule?.id || (o.rules || [])[0]), acting_for: 'Priya Raman', record, as_of: fmtET(asOf), ...(({ credit, ...rest }) => rest)(o), authority: o.authority || 'Priya Raman approves before anything is sent', changes_nothing: true });

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
  else if (dep) { const late = asOf - new Date(dep.at) > windowHours(db, 'NF-4.2') * H; row = 'Fulfilment posted and departure scanned'; next = 'draft_ship_notice_from_load_scan'; detail = { state_after_sending: late ? 'Late; stays Late after it is sent' : 'On time', rule: rule(db, 'NF-4.2') }; }
  else if (fulfil) { row = 'Fulfilment posted, but no shipping advice and the trailer has not departed'; next = 'hold_draft_and_ask_warehouse'; detail = { flag: 'Fulfilment posted early on the Supplier ERP record', draft_when: 'Departure is scanned' }; }
  else if (wh && !advice) { row = 'No fulfilment, no shipping advice, no departure'; next = 'ask_warehouse_for_status'; detail = { send_to_northfield: 'Nothing', warehouse_status: 'Unknown', rule: rule(db, 'KX-945') }; }
  else { row = 'Not shipped yet'; next = 'nothing_to_do'; }
  return out('missing_document', 'Watch Agent', po, asOf, { evidence, decision_row: row, next_step: next, ...detail, rule_baseline: 'Lists the missing document and its deadline; Priya checks each source herself', confirmed_by: 'Northfield receiving advice (861) for a ship notice; the 945 for a warehouse request' });
}

/** Claim Agent: a charge was withheld. Is the proof in the case, held elsewhere, replaceable, or absent? */
export function claimDecision(db, ref, asOf = storyClock()) {
  const c = deductionCase(db, ref, asOf); if (!c.found) return c;
  // A promotion deduction (P20): dispute only what the deal does not support, with the record that contradicts it.
  if (c.promotion) { const u = c.promotion.unsupported_amount;
    return out('deduction', 'Claim Agent', c.case, asOf, { credit: u > 0 ? 'AP-4.1' : 'AP-4.2', authority: u > 0 ? 'Priya Raman approves each dispute (AP-4.1)' : 'No decision needed: the deal supports the deduction (AP-4.2)', policy: rule(db, 'AP-4.1'), po: c.po, charge: c.charge, amount: c.amount, dispute_window: c.dispute_window, evidence: c.promotion.records,
      decision_row: u > 0 ? 'The deal does not support the whole deduction' : 'The deduction matches its deal', next_step: u > 0 ? 'dispute_unsupported_amount' : 'no_decision_needed', dispute_amount: u, stands: c.promotion.supported_amount, reason: c.promotion.reason,
      rule_baseline: 'Accept every deduction carrying a promotion reason code', dollars_the_rule_gives_up: u, confirmed_by: 'The repayment matched in Ashby’s receivables' }); }
  // A compliance chargeback (Northfield's January batch): Ashby's evidence rules are written for shortages, so they propose
  // nothing; Priya Raman decides whether to dispute or accept, from the evidence Northfield put in the case.
  if (c.kind === 'Compliance chargeback') return out('deduction', 'Claim Agent', c.case, asOf, { credit: null, authority: 'Priya Raman decides whether to dispute or accept the charge (AP-4.1)', policy: rule(db, 'AP-4.1'), po: c.po, charge: c.charge, amount: c.amount,
    dispute_window: c.dispute_window, cause: c.cause, rule: c.rule, evidence: c.evidence, decision_row: 'Ashby’s evidence rules cover shortage charges; this compliance chargeback has no rule to propose a step', next_step: null });
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
  // AP-4.1: every dispute needs Priya Raman's approval, whatever the amount and wherever the proof sits.
  const authority = next.startsWith('recommend_accept') ? 'Priya Raman decides whether to accept the charge; nothing is disputed' : 'Priya Raman approves each dispute and decides between dispute and write-off (AP-4.1)';
  return out('deduction', 'Claim Agent', c.case, asOf, { credit: next.startsWith('recommend_accept') ? null : 'AP-4.1', authority, policy: rule(db, 'AP-4.1'), po: c.po, charge: c.charge, amount: c.amount, dispute_window: c.dispute_window, evidence: Object.fromEntries(c.evidence.map((v) => [v.evidence, v.state])), decision_row: row, next_step: next, ...detail, rule_baseline: baseline, dollars_the_rule_gives_up: baseline === 'Accept the charge' && next !== 'recommend_accept' && !next.startsWith('recommend_accept_and') ? c.amount : 0, confirmed_by: 'The repayment matched in Ashby’s receivables' });
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

/** Sell-through for one store's report week (rebuild plan Step 3, decided 23 November 2026): units sold ÷ units received
 *  in the week, from Northfield's store activity report (852 QS and QR). Transfers between stores are recorded apart and
 *  are not receipts. Measured when every figure is the report's own; Estimated for the first week on record, whose
 *  receipts rest on the set opening balance. No rate when nothing was received that week. Shared by both sides. */
export function sellThrough(db, wk) {
  if (!wk || wk.received == null) return { sell_through: null, sell_through_basis: 'Not available', sell_through_reason: 'The report carries no units received' };
  const first = db.prepare('SELECT min(period_end) p FROM store_activity WHERE sku = ? AND store = ?').get(wk.sku, wk.store).p;
  const flows = { received: wk.received, transfer_in: wk.transfer_in, transfer_out: wk.transfer_out }; const unitsSold = wk.sold; // a measure, not a threshold
  if (!wk.received) return { ...flows, sell_through: null, sell_through_basis: 'Not available', sell_through_reason: 'Nothing received that week', formula: 'Units sold ÷ units received in the week' };
  return { ...flows, sell_through: Math.round((unitsSold / wk.received) * 1000) / 10, sell_through_unit: 'percent', sell_through_basis: wk.period_end === first ? 'Estimated' : 'Measured',
    ...(wk.period_end === first ? { sell_through_reason: 'First week on record: units received rest on the set opening balance' } : {}), formula: 'Units sold ÷ units received in the week' };
}

/** Northfield's store read (P9): one store's or every store's figures from Northfield's own store activity reports, with
 *  sell-through and weeks of supply. Ashby's stock and Ashby's rule recommendations are Ashby's records. */
export function storeSellThroughNF(db, store, asOf = storyClock()) {
  const t = asOf.toISOString();
  const latest = db.prepare('SELECT max(period_end) p FROM store_activity WHERE sent_at <= ?').get(t).p;
  if (!latest) return { found: false, message: `No store activity report at ${fmtET(asOf)}` };
  const avgOf = (st, sku, end) => db.prepare('SELECT avg(sold) a, count(*) n FROM (SELECT sold FROM store_activity WHERE store = ? AND sku = ? AND period_end < ? AND sent_at <= ? ORDER BY period_end DESC LIMIT 4)').get(st, sku, end, t);
  const row = (wk) => { const a = avgOf(wk.store, wk.sku, wk.period_end); const avg = a.n ? a.a : wk.sold; const weeks = avg ? wk.on_hand / avg : null;
    return { store: wk.store, sku: wk.sku, week: `${wk.period_start} to ${wk.period_end}`, report_sent: fmtET(wk.sent_at), sold: wk.sold, on_hand: wk.on_hand, ...sellThrough(db, wk),
      weekly_average: Math.round(avg * 10) / 10, weeks_averaged: a.n || 1, weeks_of_supply: weeks == null ? null : Math.round(weeks * 10) / 10 }; };
  const NA = { ashby_available_stock: 'Not available to Northfield', ashby_recommendation: 'Not available to Northfield' };
  if (store != null) { const s = String(store).replace(/^store\s*/i, '');
    const wk = db.prepare('SELECT * FROM store_activity WHERE store = ? AND sent_at <= ? ORDER BY period_end DESC').get(s, t);
    if (!wk) return { found: false, message: `No store activity for store ${s} at ${fmtET(asOf)}` };
    const weeks = db.prepare('SELECT * FROM store_activity WHERE store = ? AND sku = ? AND sent_at <= ? ORDER BY period_end').all(s, wk.sku, t).map((w) => ({ week: `${w.period_start} to ${w.period_end}`, sold: w.sold, on_hand: w.on_hand, ...sellThrough(db, w) }));
    return { as_of: fmtET(asOf), source: 'Northfield store activity reports (EDI 852)', ...row(wk), weeks, ...NA }; }
  const stores = db.prepare('SELECT * FROM store_activity WHERE period_end = ? ORDER BY store').all(latest).map(row);
  return { as_of: fmtET(asOf), source: 'Northfield store activity reports (EDI 852)', week_ending: latest, count: stores.length, stores, ...NA };
}

/** Shelf Agent: a store shelf is empty or slow. Order, transfer, or wait for goods already on the way? */
export function shelfDecision(db, store, asOf = storyClock()) {
  const t = asOf.toISOString(); const s = String(store);
  const wk = db.prepare('SELECT * FROM store_activity WHERE store = ? AND sent_at <= ? ORDER BY period_end DESC').get(s, t);
  if (!wk) return { found: false, message: `No product activity for store ${store} at ${fmtET(asOf)}` };
  // AP-6.1 and AP-6.4 speak of a weekly average over AP-6.4's weeks: the weeks before the report week (18 November 2026), as
  // many as the records hold. With no earlier week on record the report week stands in.
  const avgWeeks = param(db, 'AP-6.4', 'avg_weeks');
  const periods = db.prepare('SELECT DISTINCT period_end FROM store_activity WHERE sku = ? AND sent_at <= ? AND period_end < ? ORDER BY period_end DESC LIMIT ?').all(wk.sku, t, wk.period_end, avgWeeks).map((r) => r.period_end); if (!periods.length) periods.push(wk.period_end);
  const avgOf = (st) => { const r = db.prepare(`SELECT avg(sold) a FROM store_activity WHERE store = ? AND sku = ? AND period_end IN (${periods.map(() => '?').join(',')})`).get(st, wk.sku, ...periods); return r.a ?? 0; };
  const avg = avgOf(s);
  const all = db.prepare('SELECT DISTINCT store FROM store_activity WHERE period_end = ? AND sku = ?').all(wk.period_end, wk.sku);
  const sold = all.map((r) => avgOf(r.store)).sort((a, b) => a - b); const median = sold[sold.length >> 1];
  const gln = db.prepare("SELECT id FROM locations WHERE name = ?").get(`Northfield Store ${s}`)?.id;
  const transit = gln ? db.prepare("SELECT sh.shipment_id, sh.sent_at FROM shipments sh JOIN orders o ON o.po = sh.po WHERE o.supplier_id = 'ASHBY' AND sh.ship_to = ? AND sh.sent_at <= ? AND EXISTS (SELECT 1 FROM shipment_lines l WHERE l.shipment_id = sh.shipment_id AND l.sku = ?) AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.shipment_id = sh.shipment_id AND r.received_at <= ?)").get(gln, t, wk.sku, t) : null;
  const stock = db.prepare("SELECT data FROM events WHERE kind = 'erp.inventory_read' AND at <= ? AND data LIKE ? ORDER BY at DESC").get(t, `%${wk.sku}%`);
  const weeks = avg ? wk.on_hand / avg : Infinity;
  const evidence = { week_ending: wk.period_end, sold: wk.sold, weekly_average: Math.round(avg * 10) / 10, weeks_averaged: periods.length, on_hand: wk.on_hand, chain_median_weekly_average: median, weeks_of_supply: Number.isFinite(weeks) ? Math.round(weeks * 10) / 10 : null, ship_notice_in_transit: transit ? transit.shipment_id : 'None', ashby_available: stock ? J(stock.data).available : 'Not read', ...sellThrough(db, wk) };
  let row, next, detail = {};
  const minAvg = param(db, 'AP-6.1', 'min_weekly_avg'), slowWeeks = param(db, 'AP-6.2', 'min_weeks_supply'), slowPct = param(db, 'AP-6.2', 'pct_of_median') / 100, keep = param(db, 'AP-6.3', 'keep_weeks'), carton = param(db, 'AP-6.4', 'carton');
  if (wk.on_hand === 0 && avg < minAvg) { row = 'Empty shelf below the minimum weekly sales'; next = 'nothing_to_do'; }
  else if (wk.on_hand === 0 && transit) { row = 'Empty shelf, and a ship notice to this store is already in transit'; next = 'wait_for_goods_in_transit'; detail = { in_transit: transit.shipment_id }; }
  else if (wk.on_hand === 0) { row = 'Empty shelf, nothing in transit, Ashby has stock'; next = 'recommend_new_order'; detail = { to: 'Jordan Ellis', pairs: Math.max(carton, Math.round(avg / carton) * carton), rules: ['AP-6.1', 'AP-6.4'] }; } // the whole cartons nearest one week's average, at least one
  else if (weeks >= slowWeeks && avg < median * slowPct) { row = `Slow sell-through with ${slowWeeks} or more weeks of supply`; next = 'recommend_transfer'; detail = { pairs: wk.on_hand - Math.round(keep * avg), keep_weeks: keep, rules: ['AP-6.2', 'AP-6.3'] }; }
  else { row = 'Selling and in stock'; next = 'nothing_to_do'; }
  return out('shelf', 'Shelf Agent', `Store ${s}`, asOf, { evidence, decision_row: row, next_step: next, ...detail, authority: 'Priya Raman approves the recommendation; Jordan Ellis decides the order', rule_baseline: 'Flags the empty shelf and recommends a carton multiple', confirmed_by: 'The next week’s product activity (852)' });
}

/** Scout Agent: a shipment is about to break a rule. Which records disagree, and who has to act first? */
export function scoutDecision(db, poIn, asOf = storyClock()) {
  const po = normPo(poIn); const t = asOf.toISOString();
  const o = db.prepare('SELECT * FROM orders WHERE po = ?').get(po); if (!o) return { found: false, message: `No order ${po}` };
  const e = evs(db, po, t); const last = (k) => e.filter((x) => x.kind === k).pop();
  const load = last('wms.load_scan'), fulfil = last('erp.fulfilment_posted'), dep = last('wms.departure_scan'), inv = last('erp.invoice_draft'), route = last('routing.request'), stock = last('wms.inventory'), label = last('wms.label_scan');
  const change = db.prepare('SELECT count(*) n FROM order_changes WHERE po = ? AND sent_at <= ?').get(po, t).n;
  const evidence = { load_scan: load ? `${load.d.cartons_loaded} of ${load.d.cartons_expected}${load.d.trailer_state ? `; ${load.d.trailer_state}` : ''}${load.d.missing_state ? `; one carton ${load.d.missing_state.toLowerCase()}` : ''}` : 'None', supplier_erp_fulfilment: fulfil ? `Posted ${fmtET(fulfil.at)}` : 'Not posted', departure_scan: dep ? fmtET(dep.at) : 'None', order_changes: change };
  let row, next, detail = {};
  if (fulfil && !dep && load && /not departed/i.test(load.d.trailer_state || '')) { row = 'The Supplier ERP says shipped and the Kinross load scan says not departed'; next = 'check_departure_scan_and_ask_kinross'; detail = { before: 'Any ship notice is built', flag: 'Fulfilment posted before departure' }; }
  else if (load && load.d.cartons_loaded < load.d.cartons_expected && !dep) { row = 'A carton is staged but not on the trailer'; next = 'send_load_task_to_kinross'; detail = { carton: load.d.missing, cutoff: `Trailer seals in ${load.d.seals_in_minutes} minutes`, exposure_estimate: chargeOf(db, 'AS02', 1) + chargeOf(db, 'AS03') + chargeOf(db, 'AS04'), rules: ['NF-4.5', 'NF-4.7', 'NF-4.8'] }; }
  else if (inv && inv.d.billed > inv.d.to_ship) { row = 'The invoice draft bills more than is allocated to ship'; next = 'propose_invoice_correction_in_supplier_erp'; detail = { billed: inv.d.billed, to_ship: inv.d.to_ship, exposure_estimate: chargeOf(db, 'IV01'), rule: rule(db, 'NF-7.8') }; }
  else if (route && route.d.state === 'Missing') { row = 'No routing request for collect freight'; next = 'draft_routing_request'; detail = { exposure_estimate: chargeOf(db, 'RT01'), rule: rule(db, 'NF-3.2') }; }
  else if (stock && stock.d.available < stock.d.ordered_across_orders) { row = 'The warehouse has less stock than the orders need'; next = 'ask_priya_which_order_ships_short'; detail = { available: stock.d.available, ordered: stock.d.ordered_across_orders, rule: rule(db, 'NF-2.1') }; }
  else if (label && label.d.reused_sscc) { row = 'Cartons carry SSCCs already used'; next = 'send_relabel_task_to_kinross'; detail = { cartons: label.d.reused_sscc, exposure_estimate: chargeOf(db, 'LB01', Array.isArray(label.d.reused_sscc) ? label.d.reused_sscc.length : label.d.reused_sscc), rule: rule(db, 'NF-4.1') }; }
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
  // P7 (17 November 2026): Pace Agent explains; it drafts no corrective plan and no task. One cause is named as one; a split is shown as its causes.
  const sites = [...new Set(ranked.map((x) => x.key.split(' at ')[1]))];
  if (rows.length >= 4 && share >= 0.7) { row = 'One item at one warehouse carries most of the short shipments'; next = 'show_one_cause'; detail = { cause: `${ranked[0].key}: stock below the available-to-promise figure`, attributed_to: 'Kinross' }; }
  else { row = 'Short shipments are split across warehouses or too few to tell'; next = 'show_each_cause'; detail = { causes: ranked.map((x) => ({ cause: x.key, lines: x.lines, cases: x.cases })), warehouses: sites }; }
  return out('scorecard', 'Pace Agent', `${from} to ${to}`, asOf, { evidence: { short_shipped_lines: rows.length, by_item_and_warehouse: ranked, largest_share: `${Math.round(share * 100)}%` }, decision_row: row, next_step: next, ...detail, rule_baseline: 'Groups failing lines by reason code only, with no attribution to the record where each first went wrong', confirmed_by: 'The ship notice and receiving advice each line names; nothing is sent and no later rate is claimed' });
}

export const JOBS = { missing_document: (db, r, t) => watchDecision(db, r, t), deduction: (db, r, t) => claimDecision(db, r, t), trade_test: (db, r, t) => testDecision(db, r, t), shelf: (db, r, t) => shelfDecision(db, r, t), shipment_risk: (db, r, t) => scoutDecision(db, r, t), scorecard: (db, r, t) => { const [from, to] = String(r || '').split(/\s+to\s+/); return paceDecision(db, from && to ? { from, to } : {}, t); } };

/** Replays a proposed change to an agent's rule against every record the agent would see at one time, beside the rule in force (T2.3).
 *  `change` is { rule, params }; only parameters the catalogue already holds can change. Nothing is stored or sent. */
export function replayAgentRule(db, { job, change, records, asOf }) {
  const f = JOBS[job]; if (!f) return { found: false, message: `No rule job ${job}` };
  // Compared on the next step and on who may act: a change to an authority limit moves the second, not the first.
  const pick = (r) => ({ next_step: r.next_step, authority: r.authority });
  const now = records.map((r) => pick(f(db, r, asOf)));
  const proposed = withRuleChange(change, () => records.map((r) => pick(f(db, r, asOf))));
  const rows = records.map((r, i) => ({ record: r, now: now[i], with_change: proposed[i] }));
  // Who may act is the part of the authority before its reason; a limit restated in the reason alone moves nothing.
  const who = (a) => String(a || '').split(':')[0].trim();
  const differs = (x) => x.now.next_step !== x.with_change.next_step || who(x.now.authority) !== who(x.with_change.authority);
  return { found: true, job, change, as_of: fmtET(asOf), records: rows.length, changed: rows.filter(differs), unchanged: rows.filter((x) => !differs(x)).length, rows: rows.map((x) => ({ ...x, changes: differs(x) })), changes_nothing: true };
}
