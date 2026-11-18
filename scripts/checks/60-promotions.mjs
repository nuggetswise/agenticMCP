// T1.13 Promotions. Owner's test: "Both X12 checks pass, and gate checks match each promotion deduction to its deal or
// show it unauthorised." The X12 checks run in npm run validate and botscheck.py; these checks hold every promotion
// deduction to its deal, recompute its amount from the records, and show the decision change when the deal changes.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { settleFromDb, DEALS_AS_OF, PROMOTION_REASONS } from '../../world/stages/promotions.js';
import { P10_WINDOW } from '../../world/generate.js';
import { ORIGINS } from '../../world/typed.js';
import { etDay } from '../../world/lib.js';

const REASONS = PROMOTION_REASONS.map((r) => `'${r}'`).join(',');

export default function ({ db, ash, nf, ok, eq, none, n, ROOT }) {
  // ---------- deals read from the 889 ----------
  const deals = n('SELECT count(*) n FROM deals');
  eq('promotions.one_deal_per_889_line', deals, n("SELECT count(*) n FROM documents d, json_each(json_extract(d.body, '$.lines')) WHERE d.doc_type = '889' AND d.status <> 'Rejected'"));
  none('promotions.deal_announced_by_its_889', `SELECT x.deal_id FROM deals x JOIN documents d ON d.doc_id = x.announced_doc_id
    WHERE d.doc_type <> '889' OR d.reference <> x.deal_id OR d.sender_id <> x.supplier_id OR d.receiver_id <> 'NORTHFIELD' OR d.status <> 'Delivered'
       OR json_extract(d.body, '$.period_start') <> x.period_start OR json_extract(d.body, '$.order_end') <> x.order_end OR instr(d.raw, 'G62*29*' || replace(x.period_start, '-', '') || '~') = 0`);
  eq('promotions.three_kinds_of_deal', db.prepare('SELECT DISTINCT kind FROM deals ORDER BY 1').all().map((r) => r.kind), ['Bill-back', 'Off-invoice', 'Scan-based']);
  none('promotions.deal_status_follows_its_dates', `SELECT deal_id FROM deals WHERE status <> CASE WHEN ? < period_start AND ? < order_start THEN 'Announced' WHEN ? > period_end AND ? > order_end THEN 'Ended' ELSE 'Active' END`, DEALS_AS_OF, DEALS_AS_OF, DEALS_AS_OF, DEALS_AS_OF);
  none('promotions.no_889_in_p10_window', "SELECT doc_id FROM documents WHERE doc_type = '889' AND ((sender_id = 'ASHBY' AND receiver_id = 'NORTHFIELD') OR (sender_id = 'NORTHFIELD' AND receiver_id = 'ASHBY')) AND sent_at > ? AND sent_at <= ?",
    new Date(P10_WINDOW.start).toISOString(), new Date(P10_WINDOW.end).toISOString());
  // prev(): the 889 is an origin (the deal is agreed off EDI) and names nothing before it.
  ok('promotions.889_is_an_origin', ORIGINS.has('889') && n("SELECT count(*) n FROM document_links l JOIN documents d ON d.doc_id = l.doc_id WHERE d.doc_type = '889'") === 0);

  // ---------- every promotion deduction is settled against its deal ----------
  const promo = n(`SELECT count(*) n FROM adjustments WHERE amount < 0 AND reason IN (${REASONS})`);
  ok('promotions.some_promotion_deductions', promo >= 5, `${promo}`);
  none('promotions.every_promotion_deduction_has_a_settlement', `SELECT a.reference FROM adjustments a WHERE a.amount < 0 AND a.reason IN (${REASONS}) AND NOT EXISTS (SELECT 1 FROM deal_settlements s WHERE s.deduction_ref = a.reference AND s.payment = a.payment AND s.invoice = a.invoice AND abs(s.claimed_amount + a.amount) < 0.005)`);
  eq('promotions.one_settlement_per_deduction', n('SELECT count(*) n FROM deal_settlements'), promo);
  // A matched deduction names its deal, its item, a period inside the promoted period (or an order inside the order
  // window), the agreed rate, and a quantity and amount that recompute from the records.
  none('promotions.matched_deduction_agrees_with_its_deal', `SELECT s.deduction_ref FROM deal_settlements s LEFT JOIN deals x ON x.deal_id = s.deal_id WHERE s.decision = 'Matched' AND (x.deal_id IS NULL OR x.supplier_id <> s.supplier_id OR x.sku <> s.sku
    OR s.claimed_rate <> x.rate OR s.agreed_rate <> x.rate OR s.claimed_uom <> x.rate_uom OR s.claimed_qty <> s.recomputed_qty OR abs(s.claimed_amount - round(s.recomputed_qty * x.rate, 2)) > 0.005
    OR s.unauthorised_amount <> 0 OR (x.kind <> 'Off-invoice' AND (s.claim_from < x.period_start OR s.claim_to > x.period_end)))`);
  none('promotions.unauthorised_deduction_states_its_reason', "SELECT deduction_ref FROM deal_settlements WHERE decision = 'Unauthorised' AND (reason IS NULL OR length(reason) < 20 OR unauthorised_amount <= 0)");
  // The gate's own recompute, read from the database, decides every deduction as the build did.
  const rows = db.prepare('SELECT * FROM deal_settlements ORDER BY deduction_ref').all();
  { const bad = rows.filter((r) => { const s = settleFromDb(db, r.deduction_ref); return !s || s.decision !== r.decision || s.reason !== r.reason || Math.abs(s.authorised_amount - r.authorised_amount) > 0.005 || s.recomputed_qty !== r.recomputed_qty; }).map((r) => r.deduction_ref);
    ok('promotions.settlement_recomputes_from_the_records', rows.length > 0 && bad.length === 0, JSON.stringify(bad)); }
  // The quarter's five: two matched, three unauthorised (a week with no 852, a rate above the deal, an order outside the window).
  eq('promotions.decisions', rows.map((r) => [r.deduction_ref, r.deal_id, r.decision]), [
    ['PD-2701-01', 'NFP-2610-01', 'Matched'], ['PD-2701-02', 'NFP-2610-01', 'Unauthorised'], ['PD-2701-03', 'NFP-2611-02', 'Matched'], ['PD-2701-04', 'NFP-2612-03', 'Unauthorised'], ['PD-2701-05', 'NFP-2702-04', 'Unauthorised']]);
  eq('promotions.unauthorised_reasons', rows.filter((r) => r.decision === 'Unauthorised').map((r) => r.reason.split(/[;,]/)[0].replace(/[\d.-]+/g, '#')), [
    'No product activity (#) on record for # to #', 'Rate # per CA is above the # agreed on deal NFP#', 'Order NR# was placed on #']);
  // Scan-based: units recomputed from Northfield's 852 store sales; only the two reported weeks (18 to 31 October) exist.
  eq('promotions.scan_units_from_852', [rows[0].recomputed_qty, rows[1].recomputed_qty], [n("SELECT sum(sold) n FROM store_activity WHERE sku = 'ASH-TRL-09' AND period_start >= '2026-10-18' AND period_end <= '2026-10-31'"), 0]);
  eq('promotions.852_weeks_on_record', db.prepare("SELECT DISTINCT period_start FROM store_activity WHERE sku = 'ASH-TRL-09' ORDER BY 1").all().map((r) => r.period_start), ['2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']); // four prior weeks added on 18 November 2026 for P9's 4-week averages
  // Bill-back: cases shipped on Ashby's ship notices in the promoted period (Eastern ship date).
  {
    const shipped = (sku, from, to) => db.prepare("SELECT s.shipped_at, l.qty FROM shipment_lines l JOIN shipments s ON s.shipment_id = l.shipment_id JOIN orders o ON o.po = l.po WHERE o.supplier_id = 'ASHBY' AND l.sku = ? AND l.uom = 'CA'").all(sku)
      .filter((r) => { const d = etDay(new Date(r.shipped_at)); return d >= from && d <= to; }).reduce((a, r) => a + r.qty, 0);
    eq('promotions.billback_cases_from_ship_notices', [rows[2].recomputed_qty, rows[3].recomputed_qty], [shipped('ASH-MUG-12', '2026-11-22', '2026-11-28'), shipped('ASH-HNY-340', '2026-12-13', '2026-12-19')]);
    ok('promotions.over_rate_deduction_authorised_at_the_agreed_rate', Math.abs(rows[3].authorised_amount - Math.round(rows[3].recomputed_qty * 0.5 * 100) / 100) < 0.005 && Math.abs(rows[3].unauthorised_amount - Math.round(rows[3].recomputed_qty * 0.1 * 100) / 100) < 0.005, JSON.stringify(rows[3]));
  }
  // Each deduction document links to the deal announcement and to the records it settles against.
  none('promotions.deduction_links_to_its_deal', `SELECT s.deduction_ref FROM deal_settlements s WHERE s.deal_doc_id IS NULL OR NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = s.doc_id AND l.prev_doc_id = s.deal_doc_id AND l.kind = 'settles deal')`);
  none('promotions.deduction_links_to_what_it_settles_against', `SELECT s.deduction_ref FROM deal_settlements s WHERE NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = s.doc_id
    AND ((s.reason_code = 'SP' AND l.kind = 'settles against product activity' AND p.doc_type = '852') OR (s.reason_code = 'GH' AND l.kind = 'settles against ship notice' AND p.doc_type = '856') OR (s.reason_code = 'A8' AND l.kind IN ('pays', 'settles against invoice') AND p.doc_type = '810' AND p.reference = s.invoice)))`);
  // (An off-invoice claim sits on the invoice it names, which the same remittance pays: one link per pair, kind 'pays'.)
  eq('promotions.billback_links_every_ship_notice_counted', db.prepare("SELECT deduction_ref, json_array_length(records) k FROM deal_settlements WHERE reason_code = 'GH' ORDER BY 1").all().map((r) => r.k),
    db.prepare("SELECT s.deduction_ref, (SELECT count(*) FROM document_links l WHERE l.doc_id = s.doc_id AND l.kind = 'settles against ship notice' AND l.prev_doc_id IN (SELECT value FROM json_each(s.records))) k FROM deal_settlements s WHERE reason_code = 'GH' ORDER BY 1").all().map((r) => r.k));
  // The remittance that settles them pays the invoices due that day, 30 days after each was sent.
  none('promotions.settlement_remittance_pays_invoices_due_that_day', "SELECT r.invoice FROM remittance_items r JOIN invoices i ON i.invoice = r.invoice WHERE r.payment = 'PMT-990168' AND date(i.sent_at, '-5 hours', '+30 days') <> '2027-01-06'");

  // ---------- the decision follows the deal record: change the deal on a scratch copy and the decision changes ----------
  {
    const s = new DatabaseSync(':memory:'); s.exec(`ATTACH DATABASE '${join(ROOT, 'build', 'tg.db')}' AS m`);
    for (const t of ['deals', 'adjustments', 'store_activity', 'shipments', 'shipment_lines', 'orders', 'order_lines', 'invoices', 'invoice_lines']) s.exec(`CREATE TABLE ${t} AS SELECT * FROM m.${t}`);
    s.exec('DETACH DATABASE m');
    const d = (ref) => settleFromDb(s, ref).decision;
    const before = ['PD-2701-03', 'PD-2701-04', 'PD-2701-05', 'PD-2701-01'].map(d);
    s.exec("UPDATE deals SET rate = 1.0 WHERE deal_id = 'NFP-2611-02'"); // bill-back agreed at 1.00, not 1.20: the 1.20 claim is now above the deal
    s.exec("UPDATE deals SET rate = 0.6 WHERE deal_id = 'NFP-2612-03'"); // honey agreed at 0.60: the claim now matches
    s.exec("UPDATE deals SET order_start = '2026-11-15', order_end = '2026-12-12' WHERE deal_id = 'NFP-2702-04'"); // napkin window moved over the December order
    s.exec("UPDATE deals SET period_end = '2026-10-24' WHERE deal_id = 'NFP-2610-01'"); // scan deal shortened to one week: the two-week claim falls outside it
    const after = ['PD-2701-03', 'PD-2701-04', 'PD-2701-05', 'PD-2701-01'].map(d);
    eq('promotions.decision_flips_when_the_deal_changes', [before, after], [['Matched', 'Unauthorised', 'Unauthorised', 'Matched'], ['Unauthorised', 'Matched', 'Matched', 'Unauthorised']]);
    s.close();
  }

  // ---------- who sees what ----------
  // Deal terms are shared: both sides see Ashby's 889s, its deals and the promotion deductions. Ashby never sees another
  // supplier's deal, its 889 or the acknowledgment of it.
  const ashbyDeals = n("SELECT count(*) n FROM deals WHERE supplier_id = 'ASHBY'");
  eq('promotions.ashby_sees_its_deals_and_889s', [ash.prepare('SELECT count(*) n FROM deals').get().n, ash.prepare("SELECT count(*) n FROM documents WHERE doc_type = '889'").get().n, ash.prepare('SELECT count(*) n FROM deal_settlements').get().n,
    ash.prepare(`SELECT count(*) n FROM adjustments WHERE amount < 0 AND reason IN (${REASONS})`).get().n], [ashbyDeals, ashbyDeals, n("SELECT count(*) n FROM deal_settlements WHERE supplier_id = 'ASHBY'"), promo]);
  eq('promotions.ashby_never_sees_another_suppliers_deal', [ash.prepare("SELECT count(*) n FROM deals WHERE supplier_id <> 'ASHBY'").get().n, ash.prepare("SELECT count(*) n FROM documents WHERE raw LIKE '%NFP-2701-05%' OR (doc_type = '997' AND answers_doc_id LIKE '889:NFP-2701-05%')").get().n,
    ash.prepare("SELECT count(*) n FROM document_links WHERE doc_id LIKE '889:NFP-2701-05%' OR prev_doc_id LIKE '889:NFP-2701-05%'").get().n], [0, 0, 0]);
  ok('promotions.another_suppliers_deal_exists', n("SELECT count(*) n FROM deals WHERE supplier_id <> 'ASHBY'") >= 1);
  eq('promotions.northfield_sees_every_deal_and_settlement', [nf.prepare('SELECT count(*) n FROM deals').get().n, nf.prepare("SELECT count(*) n FROM documents WHERE doc_type = '889'").get().n, nf.prepare('SELECT count(*) n FROM deal_settlements').get().n,
    nf.prepare("SELECT count(*) n FROM document_links l JOIN deal_settlements s ON s.doc_id = l.doc_id AND l.prev_doc_id = s.deal_doc_id").get().n], [deals, deals, promo, promo]);
}
