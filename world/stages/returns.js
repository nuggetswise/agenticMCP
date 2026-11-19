// T1.17 Adjustments and returns: Northfield's return-to-vendor requests (180), the deductions it takes for them on its
// remittance (820), Ashby's credit memos (812), and the repayment of a waived deduction, each linked to what it adjusts.
// Every repayment in the world, the ones already there and the new one, names the deduction it repays.
//
// Borrowed (pages opened 15 Nov 2026):
//  - ERPNext Credit Note: "a Sales Invoice marked as a return", created from the original submitted invoice with
//    Create > Return / Credit Note, keeping the return reference and the original items and rates, with negative
//    quantities, reducing the customer's outstanding balance. https://docs.frappe.io/erpnext/credit-note . Here Ashby's
//    credit memo (812) names the original invoice (BCD07), as a credit note names Return Against, and credits only lines
//    of it; a sales return keeps Return Against the same way (https://docs.frappe.io/erpnext/sales-return-use-cases,
//    cited in docs/phase1/world-model.md).
//  - NetSuite return authorisation: an item receipt can be created from a return authorisation (the supplier's receipt
//    of the returned goods), https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3681685.html (cited in
//    docs/phase1/world-model.md). Ashby's receipt of returned goods is an Ashby ERP record (event erp.return_received).
//  - X12 180 as a retailer sends it, from a public retailer-side guide: BookNet Canada 180N Return Merchandise
//    Notification, the retailer's request to return goods, which the supplier answers. BGN01 13 request, BGN02 the
//    retailer's return number; N1 BT/ST/VN; DTM*244 estimated start of the return; per line BLI with the GTIN-14 (UK),
//    quantity and unit, N9*OI the original invoice, PID*F description, RDR02 reason (DA damaged on receipt, EI excess
//    inventory). https://booknetcanada.atlassian.net/wiki/download/attachments/1378400/180N_dec_2005.pdf?api=v2
//    X12 004010 order is BLI01 qualifier, BLI02 id, BLI03 quantity, BLI04 unit, BLI05 price identifier, BLI06 price
//    (bots-grammars x12/4010 records); the BookNet sample puts the price before NET, so the world follows the grammar.
//    Northfield adds N9*RV (receiving number) and N9*LI (PO line), qualifiers Walmart's 812 uses.
//  - X12 812 as a public guide uses it: Walmart 812 claims guide. BCD01 date, BCD02 adjustment number, BCD03 A "off
//    invoice (deduction from original invoice)", BCD04 amount, BCD05 C credit, BCD07 invoice number; N1 per party; CDD01
//    adjustment reason (element 426), CDD02 C, CDD03 assigned id, CDD04 amount, CDD07 quantity, CDD08 unit, CDD10 UCP
//    and CDD11 unit price; LIN with the item ids. https://edi.jobisez.com/edi-igs/Walmart/812claims5010.pdf
//    Walmart sends its 812s; Northfield sends none (NF-7.2, "supplier corrections travel as a credit memo"), so in this
//    world the 812 is Ashby's credit memo. BCD03 codes, element 305: https://www.stedi.com/edi/x12-003050/element/305
//  - Reason code 72 "Authorized Return" (element 426) on the deduction (ADX02) and the credit (CDD01).
//    https://www.stedi.com/edi/x12-004010/element/426
// Return numbers, items, quantities, the case missing from one return and the dates are Invented for this world.
//
// Dates. Every 180 and 812 between Ashby and Northfield is outside P10's window (18 October 11:00 to 17 November 11:00
// ET): returns are requested on 1 to 3 December 2026, after it, against goods received from 18 November; deductions,
// credits and the repayment follow in January 2027. The deductions and the repayment travel on new remittances,
// PMT-990169 to PMT-990171 (7 to 9 January 2027), each paying the invoices due that day as every Northfield remittance
// does; no existing remittance is edited.
//
// Existing repayments. The world already holds 14 repayments of waived SH01 shortages (13 in the history period and
// DC-40877's on PMT-991204). Each names its deduction by the deduction reference in ADX04 and the case in its note, so
// `deduction_repayments` links each to its original. Thirteen of the history repayments are dated before the remittance
// that took their deduction (world/history.js schedules a repayment a week after the decision without waiting for the
// payment day of the deduction). Those records may not change here (world-diff); the gate names them as a known defect.
import { seg, d8, t4, money, clean, n1, first, day8 } from '../x12.js';
import { et, etDay, addD } from '../lib.js';
import { PARTY, ITEM, locations, locByGln } from '../ref.js';

const NF = PARTY.NORTHFIELD, ASH = PARTY.ASHBY; const LOC = Object.fromEntries(locations.map((l) => [l.id, l]));
const cents = (x) => String(Math.round(x * 100));
const r2 = (x) => Math.round(x * 100) / 100;
const RETURN_REASON = { DA: 'Damaged product on receipt', EI: 'Excess inventory' };
/** The repayments already in the world dated before the deduction they repay (history period); see the header. */
export const KNOWN_EARLY_REPAYMENTS = ['DM-41001', 'DM-41002', 'DM-41006', 'DM-41007', 'DM-41008', 'DM-41009', 'DM-41011', 'DM-41012', 'DM-41013', 'DM-41014', 'DM-41015', 'DM-41017', 'DM-41019'];

// ---------- 180 ----------
const doc180 = {
  func: 'AN', name: 'Return merchandise authorization',
  body: (d) => [
    seg('BGN', '13', d.ref, d8(d.at), t4(d.at)),
    seg('PRF', d.po),
    seg('DTM', '244', d8(d.return_on)),
    seg('N1', 'BY', clean(NF.name), 'UL', NF.gln), seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln),
    seg('N1', 'SF', clean(d.from_name), 'UL', d.from_gln), seg('N1', 'ST', clean(d.to_name), 'UL', d.to_gln),
    ...d.lines.flatMap((l) => [seg('BLI', 'UK', l.gtin, l.qty, 'CA', 'NET', money(l.price), '', 'VN', l.sku), seg('N9', 'LI', l.line), seg('N9', 'OI', d.invoice), seg('N9', 'RV', d.receipt),
      seg('PID', 'F', '', '', '', clean(ITEM[l.sku].description)), seg('RDR', '', l.reason)]),
  ],
  read: (S) => {
    const b = first(S, 'BGN'); const lines = []; let invoice = null, receipt = null;
    for (const e of S) {
      if (e[0] === 'BLI') lines.push({ gtin: e[2], qty: +e[3], uom: e[4], price: +e[6], sku: e[9] });
      else if (e[0] === 'N9' && lines.length) { if (e[1] === 'LI') lines[lines.length - 1].line = +e[2]; if (e[1] === 'OI') invoice = e[2]; if (e[1] === 'RV') receipt = e[2]; }
      else if (e[0] === 'RDR') lines[lines.length - 1].reason = e[2];
    }
    return { ref: b[2], po: first(S, 'PRF')[1], return_on: day8(first(S, 'DTM', '244')?.[2]), parties: n1(S), invoice, receipt, lines };
  },
};

// ---------- 812 ----------
const doc812 = {
  func: 'CD', name: 'Credit or debit adjustment',
  body: (d) => [
    seg('BCD', d8(d.at), d.ref, 'A', cents(d.amount), d.flag, '', d.invoice),
    seg('N9', 'PO', d.po), ...(d.return_ref ? [seg('N9', 'RZ', d.return_ref)] : []), ...(d.deduction ? [seg('N9', 'D9', d.deduction)] : []),
    seg('N1', 'SU', clean(ASH.name), 'UL', ASH.gln), seg('N1', 'BY', clean(NF.name), 'UL', NF.gln),
    ...d.lines.flatMap((l, i) => [seg('CDD', l.reason, d.flag, String(i + 1).padStart(3, '0'), cents(l.amount), '', '', l.qty, 'CA', '', 'UCP', money(l.price)),
      seg('LIN', '', 'VN', l.sku, 'UK', l.gtin), seg('N9', 'LI', l.line)]),
  ],
  read: (S) => {
    const b = first(S, 'BCD'); const n9 = (q) => S.find((e) => e[0] === 'N9' && e[1] === q)?.[2] || null; const lines = [];
    for (const e of S) {
      if (e[0] === 'CDD') lines.push({ reason: e[1], flag: e[2], amount: +e[4] / 100, qty: +e[7], uom: e[8], price: +e[11] });
      else if (e[0] === 'LIN' && lines.length) Object.assign(lines[lines.length - 1], { sku: e[3], gtin: e[5] });
      else if (e[0] === 'N9' && e[1] === 'LI' && lines.length) lines[lines.length - 1].line = +e[2];
    }
    return { ref: b[2], po: n9('PO'), handling: b[3], amount: +b[4] / 100, flag: b[5], invoice: b[7] || null, return_ref: n9('RZ'), deduction: n9('D9'), parties: n1(S), lines };
  },
};

// ---------- generating ----------
const RETURNS = [
  // ref, item, cases returned, reason, request time, what Ashby receives back
  { ref: 'RTV-NF-26101', sku: 'ASH-MUG-12', qty: 4, reason: 'DA', at: ['2026-12-01', '10:00'], received: 4, credit: ['2027-01-08', '10:00'] },
  { ref: 'RTV-NF-26102', sku: 'ASH-HNY-340', qty: 6, reason: 'EI', at: ['2026-12-02', '10:30'], received: 5, credit: ['2027-01-09', '11:00'], disputed: true },
  { ref: 'RTV-NF-26103', sku: 'ASH-NAP-4', qty: 3, reason: 'DA', at: ['2026-12-03', '09:45'], received: 3 },
];
const latest = (docs, f) => docs.filter(f).sort((a, b) => (a.at < b.at ? -1 : 1)).pop();

function generate(L, { G }) {
  const due = (day) => G.life.filter((O) => O.invAt && etDay(addD(O.invAt, 30)) === day).map((O) => ({ invoice: O.invRef, po: O.po, paid: O.invTotal, invoice_amount: O.invTotal, adjustments: [] }));
  const remit = (day, ref, items) => { for (const i of items) i.paid = r2(i.invoice_amount + i.adjustments.reduce((a, x) => a + x.amount, 0));
    return L.doc({ type: '820', from: 'NORTHFIELD', to: 'ASHBY', at: et(day, '08:00'), ref, amount: r2(items.reduce((a, i) => a + i.paid, 0)), payer_name: NF.name, payer_gln: NF.gln, payee_name: ASH.name, payee_gln: ASH.gln, items: items.sort((a, b) => b.paid - a.paid) }); };
  const ev = (at, kind, po, party, system, data) => L.event({ at, kind, po, system, party, channel: 'API', data });
  const used = new Set();
  const picked = RETURNS.map((r) => {
    // Goods received at a Northfield DC from 18 November, invoiced, and paid before the return is deducted.
    // Orders named in a prototype story are left alone: P10's six (NR-46101 to NR-46156) and P13's (NR-46210 to NR-46231).
    const O = G.life.filter((x) => !used.has(x.po) && +x.po.slice(3) > 46160 && !(+x.po.slice(3) >= 46205 && +x.po.slice(3) <= 46235) && x.rcvAt && x.rcvAt >= et('2026-11-18', '12:00') && x.rcvAt < et('2026-11-26', '00:00') && x.invRef && !x.pattern && !x.claim)
      .map((x) => ({ x, rcv: latest(L.docs, (d) => d.type === '861' && d.po === x.po && !d.test), inv: latest(L.docs, (d) => d.type === '810' && d.ref === x.invRef && !d.test && !d.fault) }))
      .find(({ rcv, inv }) => rcv && inv && rcv.lines.some((l) => l.sku === r.sku && l.qty >= r.qty + 2) && inv.lines.some((l) => l.sku === r.sku));
    if (!O) throw new Error(`returns: no receipt of ${r.sku} to return`);
    used.add(O.x.po); const rl = O.rcv.lines.find((l) => l.sku === r.sku); const il = O.inv.lines.find((l) => l.line === rl.line);
    return { ...r, O: O.x, rcv: O.rcv, inv: O.inv, line: rl.line, gtin: ITEM[r.sku].gtin, price: il.price, from: locByGln[O.rcv.location_gln] };
  });
  for (const p of picked) {
    const at = et(...p.at); const to = LOC['ASH-WH1'];
    L.doc({ type: '180', from: 'NORTHFIELD', to: 'ASHBY', at, ref: p.ref, po: p.O.po, return_on: etDay(addD(at, 7)), vendor_name: ASH.name, vendor_gln: ASH.gln, from_name: p.from.name, from_gln: p.from.gln, to_name: to.name, to_gln: to.gln,
      invoice: p.inv.ref, receipt: p.rcv.ref, lines: [{ line: p.line, sku: p.sku, gtin: p.gtin, qty: p.qty, price: p.price, reason: p.reason }] });
    ev(et(etDay(addD(at, 1)), '09:00'), 'erp.return_authorised', p.O.po, 'ASHBY', 'Supplier ERP', { rtv: p.ref, return_authorisation: `RA-${p.ref.slice(-5)}`, sku: p.sku, qty: p.qty });
    ev(et(etDay(addD(at, 9)), '14:00'), 'erp.return_received', p.O.po, 'ASHBY', 'Supplier ERP', { rtv: p.ref, return_authorisation: `RA-${p.ref.slice(-5)}`, site: 'ASH-WH1', sku: p.sku, qty_expected: p.qty, qty_received: p.received, ...(p.disputed ? { in_case: `RC-${p.ref.slice(-5)}` } : {}) });
  }
  // 7 January: Northfield pays the invoices due and deducts each return at the invoice price of the goods returned.
  const d7 = due('2027-01-07'); const big = [...d7].sort((a, b) => b.paid - a.paid);
  picked.forEach((p, k) => { p.ded = `RD-2701-0${k + 1}`; p.amount = r2(p.qty * p.price); big[k].adjustments.push({ amount: -p.amount, reason: '72', ref: p.ded, note: `Return ${p.ref} PO ${p.O.po} ${p.qty} CA ${p.sku} x ${money(p.price)}` }); });
  remit('2027-01-07', 'PMT-990169', d7);
  // The disputed return: Ashby received 5 of the 6 cases; it shares its receipt into the case and disputes one case.
  // Jordan Ellis waives one case (NF-7.7); the repayment follows on the next remittance after the decision (NF-7.6).
  const q = picked.find((p) => p.disputed); const caseId = `RC-${q.ref.slice(-5)}`; const back = r2((q.qty - q.received) * q.price);
  ev(et('2027-01-07', '14:00'), 'return.dispute', q.O.po, 'ASHBY', 'Northfield deduction case', { case: caseId, rtv: q.ref, deduction: q.ded, amount: back, approved_by: 'Priya Raman', evidence: ['Ashby return receipt: 5 of 6 cases'], in_case: caseId });
  ev(et('2027-01-08', '10:00'), 'return.decision', q.O.po, 'NORTHFIELD', 'Northfield deduction case', { case: caseId, rtv: q.ref, deduction: q.ded, amount: back, decision: 'Waived', decided_by: 'Jordan Ellis', reason: 'Return receipt shows one case short; one case waived' });
  remit('2027-01-08', 'PMT-990170', due('2027-01-08'));
  const d9 = due('2027-01-09'); [...d9].sort((a, b) => b.paid - a.paid)[0].adjustments.push({ amount: back, reason: '72', ref: q.ded, note: `Waived ${q.qty - q.received} CA, ${q.ref}, case ${caseId}` });
  remit('2027-01-09', 'PMT-990171', d9);
  // Ashby's credit memos (812) against the original invoice, for what Northfield kept: 4 mugs; 5 jars after the waiver.
  for (const p of picked.filter((x) => x.credit)) {
    const qty = p.received; const amount = r2(qty * p.price);
    L.doc({ type: '812', from: 'ASHBY', to: 'NORTHFIELD', at: et(...p.credit), ref: `CM-ASH-${p.ref.slice(-5)}`, flag: 'C', amount, invoice: p.inv.ref, po: p.O.po, return_ref: p.ref, deduction: p.ded,
      lines: [{ reason: '72', amount, qty, price: p.price, sku: p.sku, gtin: p.gtin, line: p.line }] });
  }
}

// ---------- typed rows ----------
function derive(d, T, ctx) {
  for (const t of ['return_authorisations', 'return_lines', 'credit_debit_adjustments', 'credit_debit_lines']) T[t] ||= [];
  if (d.type === '180') {
    const inv = ctx.T.invoices.find((i) => i.invoice === d.invoice);
    T.return_authorisations.push({ rtv: d.ref, doc_id: d.doc_id, supplier_id: d.receiver, po: d.po, receipt: d.receipt, invoice: d.invoice, invoice_doc_id: inv?.doc_id ?? null, requested_at: d.at, return_on: d.return_on,
      return_from: ctx.loc(d.parties.SF.gln), return_to: ctx.loc(d.parties.ST.gln), status: 'Requested', deduction_ref: null, deduction_payment: null, deducted_at: null, deducted_amount: null, waived_amount: 0, credit_memo: null, credited_amount: null });
    for (const l of d.lines) T.return_lines.push({ rtv: d.ref, line: l.line, po: d.po, sku: l.sku, gtin: l.gtin, qty: l.qty, uom: l.uom, price: l.price, amount: r2(l.qty * l.price), reason_code: l.reason, reason: RETURN_REASON[l.reason] || l.reason });
  } else if (d.type === '812') {
    T.credit_debit_adjustments.push({ adjustment_id: d.ref, doc_id: d.doc_id, issued_by: d.sender, issued_to: d.receiver, issued_at: d.at, credit_debit: d.flag === 'C' ? 'Credit' : 'Debit', handling_code: d.handling, amount: d.amount,
      invoice: d.invoice, po: d.po, return_ref: d.return_ref, deduction_ref: d.deduction, status: 'Sent' });
    d.lines.forEach((l, i) => T.credit_debit_lines.push({ adjustment_id: d.ref, seq: i + 1, po: d.po, line: l.line, sku: l.sku, reason_code: l.reason, credit_debit: l.flag === 'C' ? 'Credit' : 'Debit', qty: l.qty, uom: l.uom, price: l.price, amount: l.amount }));
  }
}

const RTV_NOTE = /^Return (RTV-\S+) PO (NR-\d+) (\d+) CA (\S+) x ([\d.]+)$/;
export const parseReturnDeduction = (a) => { const m = RTV_NOTE.exec(a.note || ''); return m ? { rtv: m[1], po: m[2], qty: +m[3], sku: m[4], price: +m[5] } : null; };
const CASE = /case ([A-Z]{2}-\d+)/;
function finish(T, ctx) {
  for (const t of ['return_authorisations', 'return_lines', 'credit_debit_adjustments', 'credit_debit_lines']) T[t] ||= [];
  const docOf = new Map(ctx.docs.filter((d) => d.type === '820').map((d) => [d.ref, d.doc_id]));
  // Every repayment (a positive adjustment) and the deduction it repays: the negative adjustment with the same deduction
  // reference to the same payee (NF-7.6: repaid on a later remittance, referencing the original deduction).
  T.deduction_repayments = T.adjustments.filter((a) => a.amount > 0).map((a) => {
    const o = T.adjustments.filter((x) => x.amount < 0 && x.reference === a.reference && x.payee_id === a.payee_id);
    if (o.length !== 1) throw new Error(`returns: repayment ${a.payment} ${a.reference} has ${o.length} original deductions`);
    const orig = o[0];
    return { repayment_payment: a.payment, repayment_doc_id: docOf.get(a.payment), repayment_invoice: a.invoice, reference: a.reference, repaid_amount: a.amount, repaid_at: a.paid_at,
      original_payment: orig.payment, original_doc_id: docOf.get(orig.payment), original_invoice: orig.invoice, original_amount: orig.amount, deducted_at: orig.paid_at,
      case_id: (a.note || '').match(CASE)?.[1] ?? (orig.note || '').match(CASE)?.[1] ?? null, payee_id: a.payee_id, dated_after_deduction: a.paid_at > orig.paid_at ? 1 : 0 };
  });
  // Return status from what followed the 180: the deduction that names it, any waiver, and Ashby's credit memo.
  for (const r of T.return_authorisations) {
    const ded = T.adjustments.find((a) => a.amount < 0 && parseReturnDeduction(a)?.rtv === r.rtv);
    if (ded) Object.assign(r, { deduction_ref: ded.reference, deduction_payment: ded.payment, deducted_at: ded.paid_at, deducted_amount: -ded.amount, status: 'Deducted' });
    const rep = ded ? T.deduction_repayments.filter((x) => x.reference === ded.reference) : [];
    if (rep.length) { r.waived_amount = r2(rep.reduce((s, x) => s + x.repaid_amount, 0)); r.status = 'Partly waived'; }
    const cm = T.credit_debit_adjustments.find((c) => c.return_ref === r.rtv);
    if (cm) { r.credit_memo = cm.adjustment_id; r.credited_amount = cm.amount; r.status = 'Credited'; }
  }
}

export default {
  id: 'returns',
  docs: { 180: doc180, 812: doc812 },
  // Neither is an origin: the 180 is created from the goods received (861) and invoiced (810); the 812 from the invoice it credits.
  origins: [],
  prev(d, ctx) {
    const out = [];
    if (d.type === '180') {
      const rcv = (ctx.byRef.get(`861:${d.receipt}:NORTHFIELD`) || []).filter((x) => x.at <= d.at).pop(); if (rcv) out.push({ doc: rcv, kind: 'returns goods received on' });
      const inv = (ctx.byRef.get(`810:${d.invoice}:${d.receiver}`) || []).filter((x) => !x.rejected && x.at <= d.at).pop(); if (inv) out.push({ doc: inv, kind: 'returns goods billed on' });
    } else if (d.type === '812') {
      const inv = (ctx.byRef.get(`810:${d.invoice}:${d.sender}`) || []).filter((x) => !x.rejected && x.at <= d.at).pop(); if (inv) out.push({ doc: inv, kind: 'credits invoice' });
      const ded = ctx.T.adjustments.find((a) => a.amount < 0 && a.reference === d.deduction && a.payee_id === d.sender);
      const pay = ded && (ctx.byRef.get(`820:${ded.payment}:NORTHFIELD`) || []).find((x) => x.at <= d.at); if (pay) out.push({ doc: pay, kind: 'settles deduction' });
      const rtv = d.return_ref && (ctx.byRef.get(`180:${d.return_ref}:NORTHFIELD`) || []).find((x) => x.at <= d.at); if (rtv) out.push({ doc: rtv, kind: 'credits return' });
    }
    return out;
  },
  // A remittance that deducts a return names the 180; one that repays a deduction names the remittance that took it,
  // when that came first (the 13 early history repayments cannot point forward in time; see the header).
  alsoPrev(d, ctx) {
    if (d.type !== '820') return [];
    const out = [];
    for (const i of d.items) for (const a of i.adjustments) {
      if (a.amount < 0 && a.reason === '72') { const c = parseReturnDeduction(a); const rtv = c && (ctx.byRef.get(`180:${c.rtv}:NORTHFIELD`) || []).find((x) => x.at <= d.at); if (rtv) out.push({ doc: rtv, kind: 'deducts return' }); }
      if (a.amount > 0) {
        const orig = ctx.T.adjustments.find((x) => x.amount < 0 && x.reference === a.ref && x.payee_id === d.receiver && x.paid_at < d.at);
        const od = orig && (ctx.byRef.get(`820:${orig.payment}:NORTHFIELD`) || []).find((x) => x.at < d.at); if (od) out.push({ doc: od, kind: 'repays deduction' });
      }
    }
    return out;
  },
  schema: `
-- T1.17: return authorisations (180) and their lines, credit and debit adjustments (812) and their lines, and every
-- repayment linked to the deduction it repays.
CREATE TABLE return_authorisations (rtv TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(doc_id), supplier_id TEXT NOT NULL REFERENCES parties(id), po TEXT NOT NULL REFERENCES orders(po),
  receipt TEXT NOT NULL, invoice TEXT NOT NULL REFERENCES invoices(invoice), invoice_doc_id TEXT REFERENCES documents(doc_id), requested_at TEXT NOT NULL, return_on TEXT,
  return_from TEXT NOT NULL REFERENCES locations(id), return_to TEXT NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL CHECK (status IN ('Requested','Deducted','Partly waived','Credited')), deduction_ref TEXT, deduction_payment TEXT, deducted_at TEXT, deducted_amount REAL,
  waived_amount REAL NOT NULL, credit_memo TEXT, credited_amount REAL);
CREATE TABLE return_lines (rtv TEXT NOT NULL REFERENCES return_authorisations(rtv), line INTEGER NOT NULL, po TEXT NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), gtin TEXT, qty INTEGER NOT NULL CHECK (qty > 0), uom TEXT NOT NULL,
  price REAL NOT NULL, amount REAL NOT NULL, reason_code TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (rtv, line), FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE credit_debit_adjustments (adjustment_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(doc_id), issued_by TEXT NOT NULL REFERENCES parties(id), issued_to TEXT NOT NULL REFERENCES parties(id), issued_at TEXT NOT NULL,
  credit_debit TEXT NOT NULL CHECK (credit_debit IN ('Credit','Debit')), handling_code TEXT, amount REAL NOT NULL CHECK (amount > 0), invoice TEXT NOT NULL REFERENCES invoices(invoice), po TEXT REFERENCES orders(po),
  return_ref TEXT REFERENCES return_authorisations(rtv), deduction_ref TEXT, status TEXT NOT NULL);
CREATE TABLE credit_debit_lines (adjustment_id TEXT NOT NULL REFERENCES credit_debit_adjustments(adjustment_id), seq INTEGER NOT NULL, po TEXT, line INTEGER, sku TEXT REFERENCES items(sku), reason_code TEXT NOT NULL,
  credit_debit TEXT NOT NULL, qty INTEGER, uom TEXT, price REAL, amount REAL NOT NULL, PRIMARY KEY (adjustment_id, seq), FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE deduction_repayments (repayment_payment TEXT NOT NULL, repayment_doc_id TEXT NOT NULL REFERENCES documents(doc_id), repayment_invoice TEXT NOT NULL REFERENCES invoices(invoice), reference TEXT NOT NULL,
  repaid_amount REAL NOT NULL CHECK (repaid_amount > 0), repaid_at TEXT NOT NULL, original_payment TEXT NOT NULL, original_doc_id TEXT NOT NULL REFERENCES documents(doc_id), original_invoice TEXT NOT NULL REFERENCES invoices(invoice),
  original_amount REAL NOT NULL CHECK (original_amount < 0), deducted_at TEXT NOT NULL, case_id TEXT, payee_id TEXT NOT NULL REFERENCES parties(id), dated_after_deduction INTEGER NOT NULL,
  PRIMARY KEY (repayment_payment, reference));
`,
  generate,
  derive,
  finish,
  views: {
    // Returns, credit memos and repayments are exchanged between the two: each side sees them for Ashby's orders.
    // Ashby's receipt of the returned goods stays an Ashby ERP event, seen by Northfield only when shared into a case.
    ashby: [
      "INSERT INTO return_authorisations SELECT * FROM m.return_authorisations WHERE supplier_id = 'ASHBY'",
      'INSERT INTO return_lines SELECT * FROM m.return_lines WHERE rtv IN (SELECT rtv FROM return_authorisations)',
      "INSERT INTO credit_debit_adjustments SELECT * FROM m.credit_debit_adjustments WHERE issued_by = 'ASHBY' OR issued_to = 'ASHBY'",
      'INSERT INTO credit_debit_lines SELECT * FROM m.credit_debit_lines WHERE adjustment_id IN (SELECT adjustment_id FROM credit_debit_adjustments)',
      "INSERT INTO deduction_repayments SELECT * FROM m.deduction_repayments WHERE payee_id = 'ASHBY'",
    ],
    northfield: [
      'INSERT INTO return_authorisations SELECT * FROM m.return_authorisations', 'INSERT INTO return_lines SELECT * FROM m.return_lines',
      'INSERT INTO credit_debit_adjustments SELECT * FROM m.credit_debit_adjustments', 'INSERT INTO credit_debit_lines SELECT * FROM m.credit_debit_lines',
      'INSERT INTO deduction_repayments SELECT * FROM m.deduction_repayments',
    ],
  },
  staedi: {
    SEG: {
      BLI: ['ID 2 2!', 'AN 1 48!', 'R 1 15', 'ID 2 2', 'ID 3 3', 'R 1 17', 'ID 2 2', 'ID 2 2', 'AN 1 48'],
      N9: ['ID 2 3!', 'AN 1 30', 'AN 1 45'],
      PID: ['ID 1 1!', 'ID 2 3', 'ID 2 2', 'AN 1 12', 'AN 1 80'],
      RDR: ['ID 2 2', 'ID 2 2', 'ID 2 2', 'AN 1 80', 'ID 1 1'],
      BCD: ['DT 8 8!', 'AN 1 22!', 'ID 1 2!', 'N 1 15!', 'ID 1 1!', 'DT 8 8', 'AN 1 22'],
      CDD: ['ID 2 2!', 'ID 1 1!', 'AN 1 20', 'N 1 15', 'ID 1 1', 'ID 1 3', 'R 1 10', 'ID 2 2', 'R 1 15', 'ID 3 3', 'R 1 17'],
    },
    SET: {
      180: ['BGN!', 'PRF', 'DTM+', ['N1!+'], ['BLI!+', 'N9+', 'PID', 'RDR']],
      812: ['BCD!', 'N9+', ['N1!+'], ['CDD!+', 'LIN', 'N9+']],
    },
  },
};
