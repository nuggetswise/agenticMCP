// P13 Silent order watch: five open orders at 09:00; four required documents never arrived.
import { Scenario } from '../builder.js';
import { et, atDay, addH } from '../lib.js';
import { items } from '../reference.js';

const DAY0 = '2026-11-18';
export const CLOCK = et(DAY0, '09:00');
const ITEM = Object.fromEntries(items.map((i) => [i.sku, i]));
const iso = (d) => d.toISOString();

export function buildP13() {
  const S = new Scenario({
    id: 'p13', name: 'Silent order watch', clock: CLOCK, rule_set: 'northfield-v8',
    summary: 'Five open Ashby orders at 09:00. Four required documents never arrived; one order needs nothing because Northfield returns a 997 only.',
  });
  const add = (po, r, lines, opts = {}) => {
    const total = lines.reduce((a, [sku, q]) => a + q * ITEM[sku].case_price, 0);
    S.order({ scenario: 'p13', po, supplier_id: 'ASHBY', retailer_id: 'NORTHFIELD', programme: 'Wholesale', ship_to: 'DC2', received_at: iso(r), requested_delivery: opts.requested, order_value: Math.round(total * 100) / 100, ship_from: opts.shipFrom || 'ASH-WH1', note: opts.note || null });
    lines.forEach(([sku, q], i) => S.line({ scenario: 'p13', po, line: i + 1, sku, qty_ordered: q, qty_accepted: opts.acked ? q : null, case_price: ITEM[sku].case_price }));
    const d850 = S.doc({ type: '850', reference: po, po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(r), body: { po, lines: lines.map(([sku, q], i) => ({ line: i + 1, sku, qty: q, uom: 'CA' })) } });
    S.doc({ type: '997', reference: `FA-${S.getDoc(d850).group_control}`, po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(addH(r, 0.08)), answers: d850, covers: JSON.stringify([d850]), body: { ak5: 'A' } });
    return d850;
  };
  const ack = (po, at) => {
    const id = S.doc({ type: '855', reference: `ACK-${po.slice(3)}`, po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(at), body: { po, response: 'Accept' } });
    S.doc({ type: '997', reference: `FA-${S.getDoc(id).group_control}`, po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(addH(at, 0.1)), answers: id, covers: JSON.stringify([id]), body: { ak5: 'A' } });
  };

  // NR-46210: purchase order yesterday 13:00, no acknowledgment. 24-hour rule: 4 hours left at 09:00.
  add('NR-46210', atDay(DAY0, -1, '13:00'), [['ASH-MUG-12', 120], ['ASH-NAP-4', 40]], { requested: '2026-11-21' });

  // NR-46215: truck left yesterday 18:00 with no ship notice sent. Late.
  add('NR-46215', atDay(DAY0, -3, '10:00'), [['ASH-HNY-340', 60]], { requested: '2026-11-18', acked: true });
  ack('NR-46215', atDay(DAY0, -3, '11:00'));
  S.shipment({ scenario: 'p13', shipment_id: 'SHP-46215', po: 'NR-46215', planned_departure: iso(atDay(DAY0, -1, '18:00')), departed_at: iso(atDay(DAY0, -1, '18:00')), cartons: 60, carrier: 'Ashby fleet' });
  // Supplier ERP sends invoices automatically at departure; the ship notice waits for carton confirmation, so only it is missing.
  const inv15 = S.doc({ type: '810', reference: 'INV-46215', po: 'NR-46215', sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(atDay(DAY0, -1, '18:30')), body: { po_reference: 'NR-46215', total: 2808.0 } });
  S.doc({ type: '997', reference: `FA-${S.getDoc(inv15).group_control}`, po: 'NR-46215', sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(atDay(DAY0, -1, '18:40')), answers: inv15, covers: JSON.stringify([inv15]), body: { ak5: 'A' } });

  // NR-46220: warehouse shipping order to Kinross 36 hours ago; no warehouse shipping advice back.
  add('NR-46220', atDay(DAY0, -3, '15:00'), [['ASH-MUG-12', 200]], { requested: '2026-11-19', acked: true, shipFrom: 'EX-WH1', note: 'Ships from Kinross Logistics' });
  ack('NR-46220', atDay(DAY0, -3, '16:30'));
  S.doc({ type: '940', reference: 'WSO-46220', po: 'NR-46220', sender: 'ASHBY', receiver: 'KINROSS', at: iso(atDay(DAY0, -2, '21:00')), body: { po: 'NR-46220', warehouse: 'EX-WH1', lines: [{ sku: 'ASH-MUG-12', qty: 200 }] } });
  S.warehouse.push({ scenario: 'p13', po: 'NR-46220', warehouse_id: 'KINROSS', order_sent_at: iso(atDay(DAY0, -2, '21:00')), advice_at: null, status: 'Unknown' });

  // NR-46226: shipped yesterday 09:00, no invoice. 2-day rule: 1 day left.
  add('NR-46226', atDay(DAY0, -4, '09:00'), [['ASH-NAP-4', 80], ['ASH-HNY-340', 40]], { requested: '2026-11-18', acked: true });
  ack('NR-46226', atDay(DAY0, -4, '10:15'));
  S.shipment({ scenario: 'p13', shipment_id: 'SHP-46226', po: 'NR-46226', planned_departure: iso(atDay(DAY0, -1, '09:00')), departed_at: iso(atDay(DAY0, -1, '09:00')), cartons: 120, carrier: 'Ashby fleet' });
  const asn = S.doc({ type: '856', reference: 'ASN-46226', po: 'NR-46226', sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(atDay(DAY0, -1, '07:30')), body: { po_reference: 'NR-46226', cartons: 120 } });
  S.doc({ type: '997', reference: `FA-${S.getDoc(asn).group_control}`, po: 'NR-46226', sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(atDay(DAY0, -1, '07:40')), answers: asn, covers: JSON.stringify([asn]), body: { ak5: 'A' } });

  // NR-46231: change acknowledgment sent; Northfield returned a 997 only, as its guide says. Nothing to chase.
  add('NR-46231', atDay(DAY0, -2, '09:00'), [['ASH-MUG-12', 150]], { requested: '2026-11-22', acked: true });
  ack('NR-46231', atDay(DAY0, -2, '10:00'));
  S.doc({ type: '860', reference: 'NR-46231', po: 'NR-46231', sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(atDay(DAY0, -1, '11:00')), body: { po: 'NR-46231', change: 'Line 1 to 120 cases' } });
  const ca = S.doc({ type: '865', reference: 'CHA-46231', po: 'NR-46231', sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(atDay(DAY0, -1, '15:00')), body: { po: 'NR-46231', response: 'Accept change, line 1 120 cases' } });
  S.doc({ type: '997', reference: `FA-${S.getDoc(ca).group_control}`, po: 'NR-46231', sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(atDay(DAY0, -1, '15:10')), answers: ca, covers: JSON.stringify([ca]), body: { ak5: 'A' } });

  return S;
}
