// Core order story: PO NR-450118 from the Requirements v8 shared sample world (Day 1 = 2 Nov 2026).
// One person per side: every Northfield decision is Jordan Ellis's, every Ashby decision is Priya Raman's.
import { Scenario } from '../builder.js';
import { et, addH, sscc } from '../lib.js';

const day = (n) => `2026-11-${String(1 + n).padStart(2, '0')}`.replace(/2026-11-(3[1-9])/, (m, d) => `2026-12-${String(d - 30).padStart(2, '0')}`);
const at = (n, hm) => et(day(n), hm).toISOString();
export const CLOCK = et('2026-12-07', '09:00');

export function buildCore() {
  const S = new Scenario({
    id: 'core', name: 'PO NR-450118 order story', clock: CLOCK, rule_set: 'northfield-v8',
    summary: 'One Wholesale order from purchase order to remittance and deduction reversal: changes, 270 accepted by phone, held ship notice, one-carton shortage, invoice hold, $88.40 deduction reversed.',
  });
  const po = 'NR-450118';
  S.order({ scenario: 'core', po, supplier_id: 'ASHBY', retailer_id: 'NORTHFIELD', programme: 'Wholesale', ship_to: 'DC2', received_at: at(1, '09:12'), requested_delivery: day(6), order_value: 24552.0, ship_from: 'ASH-WH1', note: 'L2 delivery moved to Day 8 by Change 3' });
  [[1, 'ASH-MUG-12', 300, 270, 54.0], [2, 'ASH-NAP-4', 120, 120, 38.4], [3, 'ASH-HNY-340', 80, 80, 46.8]]
    .forEach(([line, sku, q, a, p]) => S.line({ scenario: 'core', po, line, sku, qty_ordered: q, qty_accepted: a, case_price: p }));

  const ack997 = (id, when) => S.doc({ type: '997', reference: `FA-${S.getDoc(id).group_control}`, po, sender: S.getDoc(id).receiver_id, receiver: S.getDoc(id).sender_id, at: when, answers: id, covers: JSON.stringify([id]), body: { ak5: 'A' } });
  const p = S.doc({ type: '850', reference: po, po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: at(1, '09:12'), body: { lines: [{ line: 1, sku: 'ASH-MUG-12', qty: 300 }, { line: 2, sku: 'ASH-NAP-4', qty: 120 }, { line: 3, sku: 'ASH-HNY-340', qty: 80 }], requested_delivery: day(6), total: 24552.0 } });
  ack997(p, at(1, '09:14'));
  const c2 = S.doc({ type: '860', reference: `${po} Change 2`, po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: at(1, '10:40'), status: 'Superseded', body: { change: 'L1 to 250 cases' } });
  ack997(c2, at(1, '10:42'));
  const c3 = S.doc({ type: '860', reference: `${po} Change 3`, po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: at(1, '13:05'), body: { change: 'L1 back to 300 cases; L2 delivery to Day 8' } });
  ack997(c3, at(1, '13:07'));
  const r865 = S.doc({ type: '865', reference: `CHA-450118`, po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: at(1, '16:12'), body: { lines: [{ line: 1, response: 'Accept with changes', qty: 270 }, { line: 2, response: 'Accept', qty: 120, date: day(8) }, { line: 3, response: 'Accept', qty: 80 }], sent_after_latest_change: '3 h 7 min', accepted_value: 22932.0 } });
  ack997(r865, at(1, '16:20'));
  S.confirmations.push({ scenario: 'core', po, method: 'Phone', confirmed_by: 'Jordan Ellis', recorded_by: 'Priya Raman', at: at(1, '16:40'), scope: 'Business acceptance of the change acknowledgment: L1 270, L2 120 on Day 8, L3 80' });

  S.shipment({ scenario: 'core', shipment_id: 'SHP-450118', po, planned_departure: at(5, '18:00'), departed_at: at(5, '18:00'), cartons: 470, carrier: 'Ashby fleet' });
  const asn = S.doc({ type: '856', reference: 'ASN-450118', po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: at(5, '11:25'), body: { po_reference: po, cartons: 470, lines: [{ line: 1, qty: 270 }, { line: 2, qty: 120 }, { line: 3, qty: 80 }], hold: 'Draft L1 300 held at 11:00 against accepted 270; corrected by Priya Raman 11:00, approved by Jordan Ellis 11:20, released 11:25', exposure_estimate: 150 } });
  ack997(asn, at(5, '11:32'));
  let serial = 1;
  for (const [line, sku, n] of [[1, 'ASH-MUG-12', 270], [2, 'ASH-NAP-4', 120], [3, 'ASH-HNY-340', 80]]) {
    for (let k = 0; k < n; k++, serial++) {
      const code = sscc(serial);
      S.cartons.push({ scenario: 'core', sscc: code, po, line, sku, received: code === '006141410000003006' ? 0 : 1 });
    }
  }
  const rcv = S.doc({ type: '861', reference: 'RCV-450118', po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: at(6, '07:20'), body: { lines: [{ line: 1, cartons: 270 }, { line: 2, cartons: 119 }, { line: 3, cartons: 80 }], not_scanned: ['006141410000003006'] } });
  ack997(rcv, at(6, '07:25'));

  const inv = S.doc({ type: '810', reference: 'INV-7731', po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: at(7, '10:00'), status: 'Held by Northfield', body: { lines: [{ line: 1, qty: 300 }, { line: 2, qty: 120 }, { line: 3, qty: 80 }], total: 24552.0, held_variance: '30 cases, $1,620.00' } });
  ack997(inv, at(7, '10:05'));
  const inv2 = S.doc({ type: '810', reference: 'INV-7731C', po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: at(7, '15:30'), answers: inv, body: { replaces: 'INV-7731', lines: [{ line: 1, qty: 270 }, { line: 2, qty: 120 }, { line: 3, qty: 80 }], total: 22932.0 } });
  ack997(inv2, at(7, '15:35'));

  const rem = S.doc({ type: '820', reference: 'REM-450118', po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: at(30, '08:00'), body: { invoice: 'INV-7731C', paid: 22843.6, deduction: { case: 'DED-88401', amount: 88.4, reason: 'Shortage L2, 1 carton: $38.40 carton plus $50 charge' } } });
  ack997(rem, at(30, '08:05'));
  S.deductions.push({ scenario: 'core', case_id: 'DED-88401', po, amount: 88.4, reason: 'Shortage, PO NR-450118 line 2, 1 carton', opened_at: at(30, '08:00'), disputed_at: at(30, '14:00'), decided_at: at(34, '10:00'), decision: 'Reversed: load scan shows carton 006141410000003006 loaded', decided_by: 'Jordan Ellis' });

  S.scorecards.push(
    { scenario: 'core', period: '2026-11', metric: 'OTIF', value: 0.91, label: 'Retailer official', note: 'Counts PO NR-450118 L2 one carton short' },
    { scenario: 'core', period: '2026-11', metric: 'OTIF', value: 0.94, label: 'Network-derived', note: 'Uses the reversed deduction: the carton was delivered' },
  );
  return S;
}
