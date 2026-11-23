// P6 Charge Resolution, Northfield's side: the week's other disputes (rebuild plan Step 3, Mandip's decision of
// 23 November 2026: add them, don't hold). Jordan Ellis's workspace opens on 1 December 09:00 with the disputes that
// arrived that week, sorted by Northfield's evidence rules. Until now Northfield's records held only Ashby's five cases.
//
// What is drawn from the world: every shortage on another supplier's receiving advice from 1 October to 26 November
// whose invoice is unpaid at the end of the story. There are eight; no receipt, quantity or price is invented, so the
// week holds eight disputes rather than the 24 first proposed. For each, Northfield's remittance pays the invoice less
// a shortage deduction (SH01: invoice cost of the short units plus $50, as Northfield's other shortage cases are
// charged, world/history.js), Northfield opens the case and the supplier disputes it.
//
// What is invented, and marked so: the remittance and case times (Monday 23 November), the dispute times (24 to
// 30 November) and the evidence each supplier names. The evidence follows the three groups the P6 section names: a load
// scan by SSCC, which conflicts with Northfield's receiving count; a load tally by SSCC, a complete pack; and no load
// proof, a pack missing evidence. No decision is recorded: every dispute awaits Jordan Ellis at P6's moment.
//
// Numbering: documents take their own range (890,000,000 up; acknowledgments 990,000,000 up, world/log.js), events an
// eighth id range (7,000,001 up, world/build.js), case ids DC-48001 up and deduction references DM-58001 up, unused
// elsewhere. Every record is new; no existing record changes.
import { et } from '../lib.js';
import { D } from '../log.js';

const r2 = (x) => Math.round(x * 100) / 100;
const FROM = '2026-10-01', TO = '2026-11-27';
export const WEEK_DISPUTES = { remitAt: et('2026-11-23', '08:00'), openAt: et('2026-11-23', '09:00'), firstCase: 48001, firstDm: 58001 };
const PACKS = [
  ['Bill of lading with seal', 'Proof of delivery', 'Load scan by SSCC'],
  ['Bill of lading with seal', 'Proof of delivery', 'Load tally by SSCC'],
  ['Bill of lading with seal', 'Proof of delivery'],
];
const DISPUTE_AT = [['2026-11-24', '10:05'], ['2026-11-24', '14:40'], ['2026-11-25', '09:15'], ['2026-11-25', '16:20'], ['2026-11-27', '11:30'], ['2026-11-30', '08:45'], ['2026-11-30', '13:10'], ['2026-11-30', '15:55']];

/** The shortages the week's disputes are drawn from: other suppliers' receiving advices with a short line whose invoice
 *  (the one numbered with the receipt) is not yet paid by any remittance. */
export function shortagesFrom(docs) {
  const paid = new Set(docs.filter((d) => d.type === '820').flatMap((d) => d.items.map((i) => i.invoice)));
  const out = [];
  for (const r of docs.filter((d) => d.type === '861' && d.to !== 'ASHBY' && d.from === 'NORTHFIELD' && d.at >= FROM && d.at < TO).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    const l = (r.lines || []).find((x) => x.short > 0); if (!l) continue;
    const key = String(r.ref).replace(/^RCV-SN/, 'IN');
    const inv = docs.find((d) => d.type === '810' && (d.po_ref || d.po) === r.po && String(d.ref).startsWith(`${key}-`));
    if (!inv || paid.has(inv.ref)) continue;
    const il = inv.lines.find((x) => x.line === l.line) || inv.lines[0];
    out.push({ supplier: r.to, po: r.po, receipt: r.ref, line: l.line, short: l.short, price: il.price, invoice: inv.ref, invoice_amount: inv.total });
  }
  return out;
}

function generate(L) {
  const ev = (at, kind, po, party, data) => L.event({ at, kind, po, system: 'Northfield deduction case', party, channel: 'API', data });
  const found = shortagesFrom(L.docs);
  found.forEach((s, k) => {
    const id = `DC-${WEEK_DISPUTES.firstCase + k}`, dm = `DM-${WEEK_DISPUTES.firstDm + k}`, amount = r2(s.short * s.price + 50);
    const base = { case: id, charge: 'SH01', amount };
    D.remit(L, s.supplier, WEEK_DISPUTES.remitAt, `PMT-W${s.po.slice(3)}`, [{ invoice: s.invoice, po: s.po, paid: r2(s.invoice_amount - amount), invoice_amount: s.invoice_amount,
      adjustments: [{ amount: -amount, reason: '04', ref: dm, note: `SH01 shortage, PO ${s.po} line ${s.line}, case ${id}` }] }]);
    ev(WEEK_DISPUTES.openAt, 'case.opened', s.po, 'NORTHFIELD', { ...base, line: s.line, units: s.short, receipt: s.receipt, deduction: dm, dispute_deadline: '2027-01-22', basis: 'Invented: case time; amount from the receipt and invoice' });
    const [d, hm] = DISPUTE_AT[k % DISPUTE_AT.length];
    ev(et(d, hm), 'case.dispute', s.po, s.supplier, { ...base, evidence: PACKS[k % PACKS.length], basis: 'Invented: dispute time and evidence named' });
  });
}

export default {
  id: 'disputes-week',
  docs: {},
  origins: [],
  generate,
};
