// Compliance chargebacks (20 November 2026, owner decision for P22's deductions by cause): Northfield's January
// chargeback batch for the quarter. Each chargeback cites a Northfield rule with a charge, opens a deduction case on
// Thursday 7 January 2027 at 10:00 ET and is taken on the remittance of Friday 8 January (PMT-990170), so it lands
// after P20's moment (6 January 14:00) and before P22's (9 January 17:00). No other prototype's moment sees any record
// this stage adds, and no existing order, shipment, receipt, invoice, case or finding changes.
//
// What each charge rests on:
//  - Collect freight not ready at the assigned pickup (NF-3.6, RT01 $150): every Lakeline missed-pickup record already in
//    the world (8 to 10 December, 18 loads). None falls under NF-8.5's exclusions: Lakeline arrived, and no order was
//    changed after its routing request. Northfield charges the supplier whoever handled the freight (NF-10.1).
//  - Invoice billing more than accepted (NF-7.8, IV01 $100): the two invoices the world's 824s already rejected for it
//    (INV-7731 and INV-7790). Each was corrected afterwards; the charge is for the invoice sent with the error.
//  - Northfield's DC compliance audit (Invented records, 20 November 2026): at receipt the DC records carton labels,
//    case packs, price tickets, carton prep and pallets on a sample of loads in its own receiving system, and shares
//    the audit only into the chargeback case it opens. So each audit record is dated when the case opens; the receipt it
//    observed is named inside it. Rules: NF-4.1 (LB01, labels) and NF-4.9 (units per case against item setup), in force
//    all quarter, and NF-6.1 to NF-6.3 (TK01 ticketing, PK01 carton prep, PL01 pallets), adapted from public retailer
//    guides (world/ref.js) and in force all quarter. Audited receipts are chosen from orders no prototype names: plain
//    replenishment at DC 2 received 10 to 24 December, with no rejected document, hold, correction, case, missed
//    pickup, short pick, substitution or receiving discrepancy.
//  - Drop-ship fulfilment is not charged: Ashby has no drop-ship order in the world, and adding one would change other
//    prototypes' order counts.
//
// The money: each deduction sits on one invoice paid on PMT-990170, largest first, as promotions place theirs, and the
// remittance's paid amounts follow. Case ids DC-50001 up and deduction references DM-56001 up are unused elsewhere.
import { et, etDay } from '../lib.js';

const OPEN_AT = et('2027-01-07', '10:00');
const AUDIT_AT = et('2027-01-07', '09:30');
export const COMPLIANCE_REMITTANCE = 'PMT-990170';
const r2 = (x) => Math.round(x * 100) / 100;

/** The charge codes this stage opens cases for, with the rule each cites, the cause the deduction is reported under and
 *  the evidence Northfield puts in the case. `where` is the point in the order's life the failure began. */
export const COMPLIANCE = {
  RT01: { rule: 'NF-3.6', cause: 'Shipping documents and routing', where: 'Collect pickup', evidence: ['Routing instructions', 'Carrier missed-pickup status'] },
  IV01: { rule: 'NF-7.8', cause: 'Ship notice and invoice data', where: 'Invoice', evidence: ['Invoice', 'Application advice rejecting the invoice'] },
  LB01: { rule: 'NF-4.1', cause: 'Carton labels', where: 'Warehouse preparation', evidence: ['DC compliance audit', 'Receiving advice', 'Ship notice'] },
  'NF-4.9': { rule: 'NF-4.9', cause: 'Item setup and product data', where: 'Item setup', evidence: ['DC compliance audit', 'Item setup in force', 'Receiving advice'] },
  TK01: { rule: 'NF-6.1', cause: 'Price ticketing', where: 'Warehouse preparation', evidence: ['DC compliance audit', 'Receiving advice', 'Purchase order retail'] },
  PK01: { rule: 'NF-6.2', cause: 'Packing and carton prep', where: 'Warehouse preparation', evidence: ['DC compliance audit', 'Receiving advice', 'Ship notice'] },
  PL01: { rule: 'NF-6.3', cause: 'Pallet build', where: 'Load build', evidence: ['DC compliance audit', 'Bill of lading', 'Receiving advice'] },
};
export const isCompliance = (charge) => Object.prototype.hasOwnProperty.call(COMPLIANCE, charge);

// The DC compliance audit, Invented. Each entry: the code, cartons affected (null: the whole receipt or load), what the
// DC found, and the charge from the rule (world/ref.js). Applied in order to the audited receipts (see pick below).
const AUDIT = [
  { code: 'LB01', cartons: 8, finding: 'GS1-128 label on the wrong face; cartons relabelled at receiving', charge: (n) => 150 + n },
  { code: 'TK01', cartons: 6, finding: 'Units without a price ticket; re-ticketed at the DC', charge: (n) => 100 + n },
  { code: 'PK01', cartons: 4, finding: 'Cartons mixing two case packs without an odd-carton mark; reworked at the DC', charge: (n) => 100 + n },
  { code: 'NF-4.9', cartons: null, finding: 'Cases hold a unit count other than the case set up for the item; received against item setup', charge: () => 150 },
  { code: 'PL01', cartons: null, finding: 'Load on non-standard pallets, not stretch-wrapped; restacked at the dock', charge: () => 100 },
  { code: 'LB01', cartons: 14, finding: 'Carton labels unreadable at the dock scanner; cartons relabelled at receiving', charge: (n) => 150 + n },
  { code: 'TK01', cartons: 9, finding: 'Price ticket retail differs from the order retail; re-ticketed at the DC', charge: (n) => 100 + n },
];

const QUIET = new Set(['erp.shipment_planned', 'erp.fulfilment_posted', 'wms.load_scan', 'wms.departure_scan', 'carrier.delivery_receipt']);

function generate(L) {
  const latest = (docs) => { const m = new Map(); for (const d of docs) { const p = m.get(d.ref); if (!p || d.at >= p.at) m.set(d.ref, d); } return [...m.values()]; };
  const docsOf = (type, from, to) => L.docs.filter((d) => d.type === type && d.from === from && d.to === to && !d.test && !d.retired);
  const charges = [];

  // RT01: Lakeline's missed pickups, in the order they happened.
  const missed = L.events.filter((e) => e.kind === 'carrier.pickup_missed' && !e.retired && /not ready/i.test(e.data.note || '')).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.po < b.po ? -1 : 1));
  for (const e of missed) charges.push({ code: 'RT01', po: e.po, amount: 150, detail: { load: `NRL-${e.po.slice(3)}`, assigned_pickup: e.data.assigned_pickup, observed: e.at, carrier: 'Lakeline Freight' } });

  // IV01: invoices an 824 rejected for billing more than accepted.
  const rejected = docsOf('824', 'NORTHFIELD', 'ASHBY').filter((d) => d.answers_set === '810' && (d.errors || []).some((x) => /QTY|above accepted/i.test(`${x.code} ${x.cause || ''} ${x.text || ''}`)));
  const invRefs = [...new Set(rejected.map((d) => d.answers_ref))].sort();
  for (const ref of invRefs) { const inv = docsOf('810', 'ASHBY', 'NORTHFIELD').filter((d) => d.ref === ref).sort((a, b) => (a.at < b.at ? -1 : 1))[0]; if (!inv) throw new Error(`compliance: invoice ${ref} not found`);
    charges.push({ code: 'IV01', po: inv.po_ref, amount: 100, detail: { invoice: ref, advice: rejected.find((d) => d.answers_ref === ref).ref } }); }

  // The DC compliance audit: quiet replenishment orders received at DC 2 from 10 to 24 December.
  const busy = new Set(L.events.filter((e) => e.po && !QUIET.has(e.kind)).map((e) => e.po));
  for (const d of L.docs) if (d.type === '824' && d._target?.po_ref) busy.add(d._target.po_ref);
  for (const d of L.docs) if (d.type === '824' && d._target?.po) busy.add(d._target.po);
  for (const c of charges) busy.add(c.po);
  const asns = new Map(latest(docsOf('856', 'ASHBY', 'NORTHFIELD')).map((d) => [d.ref, d]));
  const day = (iso) => etDay(new Date(iso));
  const pool = latest(docsOf('861', 'NORTHFIELD', 'ASHBY'))
    .filter((r) => day(r.received_at) >= '2026-12-10' && day(r.received_at) <= '2026-12-24' && (r.location_name || '') === 'Northfield DC 2' && !busy.has(r.po) && /^NR-\d+$/.test(r.po))
    .filter((r) => r.lines.every((l) => !l.short && !(l.not_scanned || []).length))
    .filter((r) => { const a = asns.get(r.asn_ref); return a && a.carton_count >= 16; })
    .sort((a, b) => (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.po < b.po ? -1 : 1));
  if (pool.length < AUDIT.length * 3) throw new Error(`compliance: only ${pool.length} quiet DC 2 receipts to audit`);
  const step = Math.floor(pool.length / AUDIT.length);
  AUDIT.forEach((x, k) => {
    const r = pool[k * step + Math.floor(step / 2)]; const a = asns.get(r.asn_ref);
    const n = x.cartons == null ? null : Math.min(x.cartons, a.carton_count);
    charges.push({ code: x.code, po: r.po, amount: x.charge(n ?? 0), detail: { receipt: r.ref, ship_notice: a.ref, received_at: r.received_at, location: r.location_name, cartons_received: a.carton_count, cartons: n, bol: a.bol || null, finding: x.finding } });
  });

  // Cases, audit records and deductions.
  const pay = L.docs.find((d) => d.type === '820' && d.ref === COMPLIANCE_REMITTANCE && d.from === 'NORTHFIELD' && d.to === 'ASHBY');
  if (!pay) throw new Error(`compliance: remittance ${COMPLIANCE_REMITTANCE} not found`);
  const room = [...pay.items].sort((a, b) => b.paid - a.paid || (a.invoice < b.invoice ? -1 : 1));
  charges.forEach((c, k) => {
    c.case = `DC-${50001 + k}`; c.dm = `DM-${56001 + k}`; c.amount = r2(c.amount);
    const R = COMPLIANCE[c.code];
    if (c.detail.finding) L.event({ at: AUDIT_AT, kind: 'receiving.compliance_audit', po: c.po, system: 'Northfield DC compliance audit', party: 'NORTHFIELD', channel: 'API',
      data: { receipt: c.detail.receipt, ship_notice: c.detail.ship_notice, observed_at: c.detail.received_at, location: c.detail.location, rule: R.rule, charge: c.code, finding: c.detail.finding, cartons: c.detail.cartons, cartons_received: c.detail.cartons_received, in_case: c.case } });
    L.event({ at: OPEN_AT, kind: 'case.opened', po: c.po, system: 'Northfield deduction case', party: 'NORTHFIELD', channel: 'API',
      data: { case: c.case, charge: c.code, amount: c.amount, deduction: c.dm, rule: R.rule, cause: R.cause, ...(c.detail.cartons != null ? { cartons: c.detail.cartons } : {}), ...Object.fromEntries(Object.entries(c.detail).filter(([k2]) => ['load', 'assigned_pickup', 'invoice', 'advice', 'receipt', 'ship_notice'].includes(k2))) } });
    const it = room[k % room.length];
    if (it.paid <= c.amount) throw new Error(`compliance: ${c.dm} exceeds invoice ${it.invoice}`);
    it.adjustments.push({ amount: -c.amount, reason: '04', ref: c.dm, note: `${c.code} chargeback, PO ${c.po}, case ${c.case}` });
    it.paid = r2(it.paid - c.amount);
  });
  pay.amount = r2(pay.items.reduce((a, i) => a + i.paid, 0));
  pay.items.sort((a, b) => b.paid - a.paid);
}

export default {
  id: 'compliance',
  docs: {},
  origins: [],
  prev: () => [],
  schema: '',
  generate,
  derive: () => {},
  views: { ashby: [], northfield: [] },
};
