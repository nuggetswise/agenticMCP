// Records for P14 and P15 (Phase 1 change list 1, section C): invoice price and total variances on other suppliers'
// orders, each settled by a different record. All sit after 18 November and in Northfield's records only.
import { et, addH } from './lib.js';
import { D, iso } from './log.js';
import { PARTY } from './ref.js';

export function variance(L, W) {
  const mk = (po, supplier, lines, recv) => ({ po, supplier, shipTo: 'DC2', site: null, programme: 'WHSL', stream: 'buyer', requested: '2026-11-27', poDate: iso(recv),
    lines: lines.map(([k, qty, price], i) => ({ line: i + 1, k, sku: `${supplier}-${k}`, nf_item: `5${supplier.slice(3)}9${i}0`, gtin: null, qty, price, uom: 'EA' })) });
  const flow = (O, recv, inv) => {
    const sup = PARTY[O.supplier]; D.po(L, O, recv); D.ack(L, O, addH(recv, 20), { ref: `ACK-${O.po.slice(3)}` });
    const dep = et('2026-11-24', '10:00'); const asnRef = `ASN-V${O.po.slice(3)}`; const qty = Object.fromEntries(O.lines.map((l) => [l.line, l.qty]));
    return { dep, ship: () => { D.asn(L, O, dep, { ref: asnRef, shippedAt: dep, deliveryDate: '2026-11-27', lines: O.lines.map((l) => ({ line: l.line, sku: l.sku, qty: l.qty, uom: 'EA' })), cartonCount: Math.max(1, Math.ceil(O.lines.reduce((a, l) => a + l.qty, 0) / 24)), shipFrom: { name: sup.name, gln: sup.gln }, scac: 'LKLF' });
      D.receipt(L, O, et('2026-11-27', '08:40'), { ref: `RCV-V${O.po.slice(3)}`, asnRef, qty }); return inv(qty); } };
  };
  // 1. A line billed 2% above the order price, with no order change: held under NF-7.11.
  { const O = mk('NR-470001', 'SUP04', [['V1', 120, 12.5]], et('2026-11-19', '09:00')); flow(O, et('2026-11-19', '09:00'), (qty) => {
      const inv = D.invoice(L, O, et('2026-11-24', '13:00'), { ref: 'INV-V470001', qty, items: { 1: { price: 12.75 } } });
      D.advice(L, inv, et('2026-11-24', '13:20'), { action: 'TE', errors: [{ code: 'PRC', cause: W.TED.PRC.cause, seg: 'IT1', elem: 4, bad: '12.75', allowed: '12.50 on the order, within 0.5%; held value $30.00' }] }); }).ship(); }
  // 2. A line billed 3% above the first order price, where an accepted order change set that price before the invoice: it matches.
  { const O = mk('NR-470002', 'SUP04', [['V2', 96, 20]], et('2026-11-19', '09:30')); const f = flow(O, et('2026-11-19', '09:30'), (qty) => D.invoice(L, O, et('2026-11-24', '13:10'), { ref: 'INV-V470002', qty, items: { 1: { price: 20.6 } } }));
    D.change(L, O, et('2026-11-21', '10:00'), 1, [{ line: 1, code: 'PC', qty: 96, qty_left: 96, price: 20.6 }]);
    D.changeAck(L, O, et('2026-11-21', '15:00'), 1, 'CHA-470002', [{ line: 1, code: 'IA', qty: 96, price: 20.6 }]); f.ship(); }
  // 3. A line billed 0.4% above the order price: inside NF-7.11's tolerance, outside draft NFD-2's.
  { const O = mk('NR-470003', 'SUP12', [['V1', 240, 10]], et('2026-11-19', '10:00')); flow(O, et('2026-11-19', '10:00'), (qty) => D.invoice(L, O, et('2026-11-24', '13:20'), { ref: 'INV-V470003', qty, items: { 1: { price: 10.04 } } })).ship(); }
  // 4. An invoice whose total differs from the sum of its lines: rejected as a document fault (NF-7.10), then corrected.
  { const O = mk('NR-470004', 'SUP12', [['V2', 48, 15], ['V3', 72, 8]], et('2026-11-19', '10:30')); flow(O, et('2026-11-19', '10:30'), (qty) => {
      const inv = D.invoice(L, O, et('2026-11-24', '13:30'), { ref: 'INV-V470004', qty }); inv.total = Math.round((inv.total + 25) * 100) / 100;
      D.advice(L, inv, et('2026-11-24', '13:45'), { action: 'TR', errors: [{ code: 'TOT', cause: W.TED.TOT.cause, seg: 'TDS', elem: 1, bad: String(Math.round(inv.total * 100)), allowed: 'The sum of the line amounts' }] });
      D.invoice(L, O, et('2026-11-25', '09:00'), { ref: 'INV-V470004', qty }); }).ship(); }
}
