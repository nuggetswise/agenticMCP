// T1.17 Adjustments and returns. Owner's test: "Both X12 checks pass, and every repayment points to the deduction it
// reverses." The X12 checks run in npm run validate and botscheck.py; these checks hold every repayment to its original
// deduction, every return-to-vendor deduction to its 180, and every credit memo (812) to the invoice and deduction it adjusts.
import { KNOWN_EARLY_REPAYMENTS, parseReturnDeduction } from '../../world/stages/returns.js';
import { P10_WINDOW } from '../../world/generate.js';

export default function ({ db, ash, nf, ok, eq, none, n }) {
  // ---------- every repayment names the deduction it reverses ----------
  const repayments = n('SELECT count(*) n FROM adjustments WHERE amount > 0');
  ok('returns.repayments_in_the_world', repayments >= 15, `${repayments}`);
  eq('returns.one_link_per_repayment', n('SELECT count(*) n FROM deduction_repayments'), repayments);
  none('returns.every_repayment_names_its_deduction', `SELECT a.payment, a.reference FROM adjustments a WHERE a.amount > 0 AND NOT EXISTS (SELECT 1 FROM deduction_repayments r JOIN adjustments o ON o.payment = r.original_payment AND o.invoice = r.original_invoice AND o.reference = r.reference AND o.amount = r.original_amount
    WHERE r.repayment_payment = a.payment AND r.repayment_invoice = a.invoice AND r.reference = a.reference AND r.repaid_amount = a.amount AND o.amount < 0 AND o.payee_id = a.payee_id)`);
  none('returns.every_repayment_names_its_case', 'SELECT repayment_payment, reference FROM deduction_repayments WHERE case_id IS NULL');
  none('returns.repayment_never_exceeds_its_deduction', 'SELECT reference, sum(repaid_amount) s, min(original_amount) o FROM deduction_repayments GROUP BY reference HAVING sum(repaid_amount) > -min(original_amount) + 0.005');
  // Dates follow the deduction: a repayment is on a later remittance than the one that took the deduction (NF-7.6).
  // Thirteen history repayments (world/history.js) are dated before their deduction; they are records this stage may
  // not change, so they are named here and nothing else may join them.
  none('returns.repayment_follows_its_deduction', `SELECT repayment_payment, reference FROM deduction_repayments WHERE repaid_at <= deducted_at AND reference NOT IN (${KNOWN_EARLY_REPAYMENTS.map((r) => `'${r}'`).join(',')})`);
  eq('returns.known_early_history_repayments', db.prepare('SELECT reference FROM deduction_repayments WHERE dated_after_deduction = 0 ORDER BY reference').all().map((r) => r.reference), KNOWN_EARLY_REPAYMENTS);
  none('returns.dated_flag_matches_the_dates', 'SELECT reference FROM deduction_repayments WHERE dated_after_deduction <> (repaid_at > deducted_at)');
  // The repayment's remittance names the remittance that took the deduction, whenever that came first.
  none('returns.repayment_links_to_the_deduction_remittance', "SELECT r.reference FROM deduction_repayments r WHERE r.dated_after_deduction = 1 AND NOT EXISTS (SELECT 1 FROM document_links l WHERE l.doc_id = r.repayment_doc_id AND l.prev_doc_id = r.original_doc_id AND l.kind = 'repays deduction')");
  // The existing P6 repayment and the new return reversal.
  eq('returns.dc_40877_repayment_names_dm_55102', db.prepare("SELECT repayment_payment, original_payment, repaid_amount, original_amount, case_id FROM deduction_repayments WHERE reference = 'DM-55102'").all().map((r) => ({ ...r })),
    [{ repayment_payment: 'PMT-991204', original_payment: 'PMT-990412', repaid_amount: 88.4, original_amount: -88.4, case_id: 'DC-40877' }]);

  // ---------- returns to vendor (180) ----------
  const rtvs = n('SELECT count(*) n FROM return_authorisations');
  ok('returns.a_few_returns', rtvs >= 2 && rtvs <= 6, `${rtvs}`);
  none('returns.180_from_northfield_to_the_supplier', "SELECT doc_id FROM documents WHERE doc_type = '180' AND (sender_id <> 'NORTHFIELD' OR status <> 'Delivered')");
  none('returns.no_180_or_812_in_p10_window', "SELECT doc_id FROM documents WHERE doc_type IN ('180','812') AND sent_at > ? AND sent_at <= ?", new Date(P10_WINDOW.start).toISOString(), new Date(P10_WINDOW.end).toISOString());
  // prev(): the 180 names the receiving advice of the goods returned and the invoice that billed them.
  none('returns.180_links_to_its_receipt_and_invoice', `SELECT r.rtv FROM return_authorisations r WHERE NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = r.doc_id AND l.kind = 'returns goods received on' AND p.doc_type = '861' AND p.reference = r.receipt AND p.po = r.po)
    OR NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = r.doc_id AND l.kind = 'returns goods billed on' AND p.doc_type = '810' AND p.reference = r.invoice)`);
  // Nothing is returned that was not received and billed, and the return is priced at the invoice price.
  none('returns.returned_not_above_received_and_billed', `SELECT l.rtv, l.line FROM return_lines l JOIN return_authorisations r ON r.rtv = l.rtv WHERE l.qty > coalesce((SELECT sum(qty) FROM receipts x WHERE x.receipt = r.receipt AND x.po = r.po AND x.line = l.line), 0)
    OR NOT EXISTS (SELECT 1 FROM invoice_lines i WHERE i.invoice = r.invoice AND i.line = l.line AND i.qty >= l.qty AND abs(i.price - l.price) < 0.005)`);
  // Every return-to-vendor deduction names its 180, on the same order, for the return's value, and links to it.
  const rtvDed = db.prepare("SELECT * FROM adjustments WHERE amount < 0 AND reason = '72'").all();
  ok('returns.every_rtv_deduction_names_its_180', rtvDed.length === rtvs && rtvDed.every((a) => { const c = parseReturnDeduction(a); if (!c) return false;
    const r = db.prepare('SELECT r.*, (SELECT sum(amount) FROM return_lines l WHERE l.rtv = r.rtv) amount FROM return_authorisations r WHERE r.rtv = ?').get(c.rtv);
    return r && r.po === c.po && a.po === r.po && Math.abs(r.amount + a.amount) < 0.005 && r.deduction_ref === a.reference && a.paid_at > r.requested_at
      && n(`SELECT count(*) n FROM document_links l JOIN documents d ON d.doc_id = l.doc_id WHERE d.doc_type = '820' AND d.reference = '${a.payment}' AND l.prev_doc_id = '${r.doc_id}' AND l.kind = 'deducts return'`) === 1; }), JSON.stringify(rtvDed.map((a) => a.note)));

  // ---------- credit and debit adjustments (812) ----------
  // Northfield sends no debit memos (NF-7.2): every 812 is the supplier's credit memo.
  none('returns.812_is_a_supplier_credit_memo', "SELECT adjustment_id FROM credit_debit_adjustments WHERE issued_by = 'NORTHFIELD' OR credit_debit <> 'Credit'");
  // prev(): an 812 names the invoice it credits (a credit note against the original invoice) and the deduction it settles.
  none('returns.812_links_to_invoice_and_deduction', `SELECT c.adjustment_id FROM credit_debit_adjustments c WHERE NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = c.doc_id AND l.kind = 'credits invoice' AND p.doc_type = '810' AND p.reference = c.invoice)
    OR NOT EXISTS (SELECT 1 FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id JOIN adjustments a ON a.payment = p.reference AND a.reference = c.deduction_ref AND a.amount < 0 WHERE l.doc_id = c.doc_id AND l.kind = 'settles deduction' AND p.doc_type = '820')`);
  // A credit note copies the original invoice's lines and rates and never credits more than was billed or kept.
  none('returns.812_lines_from_the_original_invoice', `SELECT c.adjustment_id, c.line FROM credit_debit_lines c JOIN credit_debit_adjustments h ON h.adjustment_id = c.adjustment_id
    WHERE NOT EXISTS (SELECT 1 FROM invoice_lines i WHERE i.invoice = h.invoice AND i.line = c.line AND i.qty >= c.qty AND abs(i.price - c.price) < 0.005) OR abs(c.qty * c.price - c.amount) > 0.005`);
  none('returns.812_total_is_its_lines', 'SELECT h.adjustment_id FROM credit_debit_adjustments h WHERE abs(h.amount - (SELECT sum(amount) FROM credit_debit_lines l WHERE l.adjustment_id = h.adjustment_id)) > 0.005');
  none('returns.credit_never_above_deduction_kept', `SELECT h.adjustment_id FROM credit_debit_adjustments h JOIN return_authorisations r ON r.rtv = h.return_ref WHERE h.amount > r.deducted_amount - r.reversed_amount + 0.005 OR h.issued_at <= r.deducted_at`);
  // The return dispute settled from the world's records: Ashby received 5 of the 6 cases (its receipt, shared into the
  // case), so one case is reversed and repaid; the credit memo credits the five Northfield kept.
  eq('returns.disputed_return_settled', db.prepare("SELECT rtv, status, deducted_amount, reversed_amount, credit_memo, credited_amount FROM return_authorisations ORDER BY rtv").all().map((r) => [r.rtv, r.status, r.deducted_amount, r.reversed_amount, r.credited_amount]),
    [['RTV-NF-26101', 'Credited', 216, 0, 216], ['RTV-NF-26102', 'Credited', 280.8, 46.8, 234], ['RTV-NF-26103', 'Deducted', 115.2, 0, null]]);
  { const rec = db.prepare("SELECT data FROM events WHERE kind = 'erp.return_received' AND json_extract(data, '$.rtv') = 'RTV-NF-26102'").get(); const d = JSON.parse(rec.data);
    const rep = db.prepare("SELECT repaid_amount, case_id FROM deduction_repayments WHERE reference = (SELECT deduction_ref FROM return_authorisations WHERE rtv = 'RTV-NF-26102')").get();
    const price = db.prepare("SELECT price FROM return_lines WHERE rtv = 'RTV-NF-26102'").get().price;
    eq('returns.reversal_equals_cases_not_received', [rep.repaid_amount, rep.case_id], [Math.round((d.qty_expected - d.qty_received) * price * 100) / 100, d.in_case]); }

  // ---------- who sees what ----------
  eq('returns.ashby_sees_its_returns_credits_and_repayments', [ash.prepare('SELECT count(*) n FROM return_authorisations').get().n, ash.prepare('SELECT count(*) n FROM return_lines').get().n, ash.prepare('SELECT count(*) n FROM credit_debit_adjustments').get().n,
    ash.prepare('SELECT count(*) n FROM deduction_repayments').get().n, ash.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('180','812')").get().n],
  [rtvs, n('SELECT count(*) n FROM return_lines'), n('SELECT count(*) n FROM credit_debit_adjustments'), n("SELECT count(*) n FROM deduction_repayments WHERE payee_id = 'ASHBY'"), n("SELECT count(*) n FROM documents WHERE doc_type IN ('180','812') AND supplier_id = 'ASHBY'")]);
  eq('returns.northfield_sees_returns_and_credit_memos', [nf.prepare('SELECT count(*) n FROM return_authorisations').get().n, nf.prepare('SELECT count(*) n FROM credit_debit_adjustments').get().n, nf.prepare('SELECT count(*) n FROM deduction_repayments').get().n, nf.prepare("SELECT count(*) n FROM documents WHERE doc_type IN ('180','812')").get().n],
    [rtvs, n('SELECT count(*) n FROM credit_debit_adjustments'), repayments, n("SELECT count(*) n FROM documents WHERE doc_type IN ('180','812')")]);
  // Ashby's own return records stay Ashby's: Northfield sees only the receipt Ashby shared into the disputed case.
  eq('returns.northfield_sees_only_the_shared_return_receipt', nf.prepare("SELECT json_extract(data, '$.rtv') r FROM events WHERE kind LIKE 'erp.return%' ORDER BY 1").all().map((r) => r.r), ['RTV-NF-26102']);
}
