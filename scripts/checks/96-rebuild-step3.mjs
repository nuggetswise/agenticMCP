// Prototype rebuild plan, Step 3 (23 November 2026): the demo-world prerequisites, each checked from the records.
import * as A from '../../src/agents.js';
import * as D from '../../src/domain.js';
import * as NR from '../../src/retailer.js';

export default function ({ db, ash, nf, ok, eq }) {
  // 1. P9: units received per store per week, transfers in and out apart, one opening balance. Sell-through recomputes.
  const rows = db.prepare("SELECT * FROM store_activity WHERE sku = 'ASH-TRL-09' ORDER BY store, period_end").all();
  eq('step3.p9_received_on_every_report_row', [rows.length, rows.filter((r) => r.received == null || r.transfer_in == null || r.transfer_out == null || r.received < 0).length], [240, 0]);
  { let bad = 0; const prev = {}; for (const r of rows) { if (prev[r.store] != null && prev[r.store] + r.received + r.transfer_in - r.transfer_out - r.sold !== r.on_hand) bad++; prev[r.store] = r.on_hand; }
    eq('step3.p9_stock_balances_hold_week_to_week', bad, 0); }
  eq('step3.p9_transfer_207_to_118_and_store_114_receipt', db.prepare("SELECT store, received, transfer_in, transfer_out FROM store_activity WHERE period_end = '2026-10-31' AND store IN ('114','118','207') ORDER BY store").all().map((r) => `${r.store}:${r.received}/${r.transfer_in}/${r.transfer_out}`), ['114:40/0/0', '118:0/24/0', '207:0/0/24']);
  eq('step3.p9_opening_balance_114_and_207', db.prepare("SELECT store, on_hand + sold - received o FROM store_activity WHERE period_end = '2026-09-26' AND store IN ('114','207') ORDER BY store").all().map((r) => r.o), [180, 63]);
  { const byStore = {}; for (const r of rows) (byStore[r.store] ||= []).push(r);
    const recomputed = [], read = [];
    for (const list of Object.values(byStore)) list.forEach((r, i) => { const s4 = list.slice(Math.max(0, i - 3), i + 1).reduce((a, x) => a + x.sold, 0); recomputed.push(s4 + r.on_hand ? Math.round((s4 / (s4 + r.on_hand)) * 1000) / 10 : null); read.push(A.sellThrough(db, r).sell_through); });
    eq('step3.p9_sell_through_recomputes_from_records', recomputed.every((v, i) => v === read[i]) && recomputed.length === 240, true);
    eq('step3.p9_sell_through_never_above_100', read.every((v) => v == null || (v >= 0 && v <= 100)), true); }

  // 2. P9 reads on both sides: the rate with its flag; Northfield's leaves Ashby's stock out.
  { const at = new Date('2026-11-01T12:00:00Z');
    const a = A.shelfDecision(ash, '114', at).evidence; const n = A.storeSellThroughNF(nf, '114', at);
    eq('step3.p9_both_sides_return_the_rate', [a.sell_through, n.sell_through], [n.sell_through, n.sell_through]);
    { const s = A.storeShelvesAshby(ash, null, new Date('2026-10-26T12:07:00Z')); eq('step3.p9_all_stores_and_bands_on_the_opening_report', [s.sell_through_all_stores, s.stores_by_band['Above target'], s.stores_by_band['On target'], s.stores_by_band['Below target']], [44.9, 1, 32, 7]); }
    eq('step3.p9_northfield_read_has_no_ashby_target', /target|band/.test(JSON.stringify(n)), false);
    eq('step3.p9_northfield_read_leaves_out_ashby_stock', [n.ashby_available_stock, n.ashby_recommendation, JSON.stringify(n).includes('980'), JSON.stringify(n).includes('ashby_available"')], ['Not available to Northfield', 'Not available to Northfield', false, false]); }

  // 3. P13: a charge per missing document, each on its rule.
  eq('step3.p13_three_charges_on_their_rules', ['NF-1.4', 'NF-4.2', 'NF-7.9'].map((id) => D.rules(db, { id, viewer: 'ASHBY' })).map((r) => (r.rules ? r.rules[0] : r).charge),
    ['$100 per order', '$7.50 per carton, $50 minimum per order', '$100 per invoice']);

  // 4. P25: the trail runner's NRF size code.
  eq('step3.p25_trail_runner_size', db.prepare("SELECT size_code || ' ' || size s FROM catalogue_records WHERE sku = 'ASH-TRL-09'").get()?.s, '50555 11 Medium');

  // 5. Calendar moments.
  eq('step3.calendar_p5_p23', db.prepare("SELECT id, as_of FROM calendar WHERE id IN ('P5','P23') ORDER BY id").all().map((r) => `${r.id} ${r.as_of}`), ['P23 2026-11-02T20:30:00.000Z', 'P5 2026-12-08T22:21:00.000Z']);
  eq('step3.p5_damage_scan_on_page_at_opening', db.prepare("SELECT count(*) n FROM events WHERE po = 'NR-460207' AND kind = 'wms.damage_scan' AND at <= '2026-12-08T22:21:00.000Z'").get().n, 1);
  eq('step3.p23_change_3_and_stock_read_at_opening', [db.prepare("SELECT count(DISTINCT seq) n FROM order_changes WHERE po = 'NR-450118' AND seq = 3 AND sent_at <= '2026-11-02T20:30:00.000Z'").get()?.n ?? -1, db.prepare("SELECT count(*) n FROM events WHERE po = 'NR-450118' AND kind = 'erp.inventory_read' AND at <= '2026-11-02T20:30:00.000Z'").get().n], [1, 1]);

  // 7. P6: the week's other disputes on Jordan's side, awaiting his decision; Ashby sees none of them.
  { const cs = NR.casesNF(nf, new Date('2026-12-01T14:00:00Z')).cases.filter((c) => c.supplier !== 'Ashby Supplier');
    eq('step3.p6_other_disputes_on_jordans_list', [cs.length, cs.every((c) => c.charges.some((x) => /awaiting/.test(x.state)))], [8, true]);
    eq('step3.p6_ashby_sees_none', ash.prepare("SELECT count(*) n FROM events WHERE json_extract(data, '$.case') BETWEEN 'DC-48001' AND 'DC-48999'").get().n, 0); }

  // 8. P21: no rule sends email or asks Northfield to act.
  { const all = D.rules(db, { viewer: 'ASHBY' }); const list = all.rules || all;
    eq('step3.p21_no_rule_sends_email_or_asks_northfield', list.filter((r) => /\bemail\b|ask the buyer|ask northfield/i.test(r.statement)).map((r) => r.id), []); }
}
