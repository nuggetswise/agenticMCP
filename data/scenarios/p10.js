// P10 Trading Grid in the customer's AI: 30 days of Ashby and Northfield EDI ending at the demo clock.
// Fixed by the Prototype Plan: four orders needing attention, the ASN-46118 rejection and its three later
// documents, 3,412 documents with 41 failures, and the six-PO escalation (five on time, one late).
import { Scenario } from '../builder.js';
import { rng, et, atDay, addH, addD, etDay, money } from '../lib.js';
import { items } from '../reference.js';

export const DAY0 = '2026-11-17';
export const CLOCK = et(DAY0, '11:00');
const WINDOW_START = addD(CLOCK, -30);
export const TARGET_DOCS = 3412;
export const TARGET_FAILURES = 41;

const R = rng(20261117);
const U = (a, b) => a + (b - a) * R();
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const ITEM = Object.fromEntries(items.map((i) => [i.sku, i]));
const CORE_SKUS = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'];
const iso = (d) => d.toISOString();

function truckSlot(after) {
  // First truck at 15:00 or 18:00 Eastern at or after `after`.
  for (let k = 0; k < 6; k++) {
    const day = etDay(addD(after, k));
    for (const hm of ['15:00', '18:00']) { const t = et(day, hm); if (t >= after) return t; }
  }
  throw new Error('no slot');
}

export function buildP10() {
  const S = new Scenario({
    id: 'p10', name: 'Trading Grid in the customer’s AI', clock: CLOCK, rule_set: 'northfield-v8',
    summary: 'Ashby Supplier and Northfield Retailer, Wholesale, 30 days of EDI ending at the demo clock. Four orders need attention; ASN-46118 rejection; six-PO escalation.',
  });

  // ---------- orders ----------
  const FIRST = 45700, LAST = 46157, N = LAST - FIRST + 1;
  const base = addD(CLOCK, -33), stepH = (33 * 24) / N;
  const special = {};
  const sp = (po, o) => { special[po] = o; };
  // Escalation POs NR-46101 to NR-46110: shipped day -4, due day -3. NR-46108 left a day late.
  for (let k = 0; k < 10; k++) {
    const po = 46101 + k;
    sp(po, {
      r: addH(atDay(DAY0, -6, '08:00'), k * 1.2),
      dep: atDay(DAY0, -4, k % 2 ? '18:00' : '15:00'),
      departLate: po === 46108 ? 24 : 0,
      receiptHm: po === 46108 ? '09:40' : `0${7 + (k % 3)}:${['10', '35', '50'][k % 3]}`,
    });
  }
  // PO reference chain: Supplier ERP adds the release suffix on orders released a second time.
  sp(46118, { r: atDay(DAY0, -5, '10:00'), dep: atDay(DAY0, -3, '15:00'), poref: 'asn', asnAt: '13:10' });
  sp(46124, { r: atDay(DAY0, -5, '14:00'), dep: atDay(DAY0, -3, '18:00'), poref: 'asn', asnAt: '16:20' });
  sp(46129, { r: atDay(DAY0, -4, '09:00'), dep: atDay(DAY0, -2, '15:00'), poref: 'asn', asnAt: '13:05' });
  sp(46133, { r: atDay(DAY0, -3, '09:30'), dep: atDay(DAY0, -1, '11:00'), poref: 'inv', asnAt: '09:30', invAt: '11:40' });
  // Attention today.
  sp(46142, { r: atDay(DAY0, -1, '16:00'), noAck: true, dep: atDay(DAY0, 1, '18:00') });
  sp(46151, { r: atDay(DAY0, -3, '13:00'), dep: atDay(DAY0, 0, '18:00'), noAsnYet: true });
  sp(46156, { r: atDay(DAY0, -3, '15:00'), dep: atDay(DAY0, 0, '15:00'), substitute: true, asnAt: '10:12' });

  const life = []; // per order: { po, r, ack, dep, departed, asn, inv, receipt, lines, ... }
  for (let i = 0; i < N; i++) {
    const n = FIRST + i, po = `NR-${n}`, s = special[n] || {};
    let r = s.r || addH(base, (i + 0.5) * stepH + U(-0.4, 0.4));
    if (!s.r && r > addH(CLOCK, -1.5)) r = addH(CLOCK, -1.5 - U(0, 0.3));
    const nl = 1 + Math.floor(R() * 3);
    const skus = [...CORE_SKUS].sort(() => R() - 0.5).slice(0, nl).sort();
    if (n === 46156 && !skus.includes('ASH-MUG-12')) skus[0] = 'ASH-MUG-12';
    const lines = skus.map((sku, j) => ({ line: j + 1, sku, qty: 10 * (2 + Math.floor(R() * 19)), price: ITEM[sku].case_price }));
    const shipTo = R() < 0.3 ? 'DC4' : 'DC2';
    let ack = s.noAck ? null : addH(r, s.r ? 2 : U(0.5, 4));
    if (ack && ack > addH(CLOCK, -0.2)) ack = addH(r, 0.5);
    let dep = s.dep || truckSlot(addH(r, 40));
    if (!s.dep && etDay(dep) === DAY0) dep = et(etDay(addD(dep, 1)), '15:00');
    const departed = dep <= CLOCK && !s.noAsnYet && !s.substitute ? addH(dep, s.departLate || 0) : null;
    const requested = etDay(addD(dep, 1));
    life.push({ n, po, r, ack, dep, departed, requested, lines, shipTo, s });
  }

  // ---------- documents ----------
  const val = (L) => money(L.lines.reduce((a, l) => a + l.qty * l.price, 0));
  const linesBody = (L) => L.lines.map((l) => ({ line: l.line, sku: l.sku, northfield_item: ITEM[l.sku].northfield_item, gtin: ITEM[l.sku].gtin, qty: l.qty, uom: 'CA', price: l.price }));
  const glnOf = { DC2: '0614141002061', DC4: '0614141002115' };

  for (const L of life) {
    S.order({ scenario: 'p10', po: L.po, supplier_id: 'ASHBY', retailer_id: 'NORTHFIELD', programme: 'Wholesale', ship_to: L.shipTo, received_at: iso(L.r), requested_delivery: L.requested, order_value: val(L), ship_from: 'ASH-WH1', note: null });
    for (const l of L.lines) S.line({ scenario: 'p10', po: L.po, line: l.line, sku: l.sku, qty_ordered: l.qty, qty_accepted: L.ack ? l.qty : null, case_price: l.price });
    L.d850 = S.doc({ type: '850', reference: L.po, po: L.po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(L.r), body: { po: L.po, ship_to_gln: glnOf[L.shipTo], requested_delivery: L.requested, lines: linesBody(L), total: val(L) } });
    if (L.ack) L.d855 = S.doc({ type: '855', reference: `ACK-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(L.ack), body: { po: L.po, lines: L.lines.map((l) => ({ line: l.line, response: 'Accept', qty: l.qty })) } });
    const shipmentId = `SHP-${L.n}`;
    S.shipment({ scenario: 'p10', shipment_id: shipmentId, po: L.po, planned_departure: iso(L.dep), departed_at: L.departed ? iso(L.departed) : null, cartons: L.lines.reduce((a, l) => a + l.qty, 0), carrier: 'Ashby fleet' });

    const asnBody = (poref, over = {}) => ({ asn: `ASN-${L.n}`, po_reference: poref, ship_to_gln: glnOf[L.shipTo], ship_date: etDay(L.dep), delivery_date: L.requested, cartons: L.lines.reduce((a, l) => a + l.qty, 0), uom: 'CA', lines: linesBody(L), ...over });
    if (L.s.substitute) {
      // Supplier ERP substituted the 16 oz mug on line 1; Northfield rejects the ship notice.
      const subLines = linesBody(L).map((x) => x.sku === 'ASH-MUG-12' ? { ...x, sku: 'ASH-MUG-16', northfield_item: '448190', gtin: ITEM['ASH-MUG-16'].gtin, price: ITEM['ASH-MUG-16'].case_price } : x);
      L.d856 = S.doc({ type: '856', reference: `ASN-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(et(DAY0, L.s.asnAt)), status: 'Rejected', body: asnBody(L.po, { lines: subLines }) });
      L.rejectAsn = { cause: 'Item not on Northfield item list', field: 'LIN03 item number', sent: '448190', allowed: 'Items on Ashby’s Northfield item list', rule: 'NF-ITEM', at: et(DAY0, '10:20'), open: true, root: 'Supplier ERP substituted ASH-MUG-16 (Northfield item 448190) for ASH-MUG-12 on line 1. 448190 is not on Ashby’s Northfield item list.' };
    } else if (L.departed || L.s.poref) {
      const asnAt = L.s.asnAt ? et(etDay(L.dep), L.s.asnAt) : addH(L.dep, -U(1.2, 2.2));
      if (L.s.poref === 'asn') {
        L.d856 = S.doc({ type: '856', reference: `ASN-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(asnAt), status: 'Corrected and resent', body: asnBody(`${L.po}-ASHBY-WHSL-REL-02`) });
        L.rejectAsn = { cause: 'PO reference longer than 22 characters', field: 'PRF01 PO reference', sent: `${L.po}-ASHBY-WHSL-REL-02`, allowed: '22 characters, the Northfield PO number', rule: 'NF-POREF', at: addH(asnAt, 0.25), resendAt: addH(asnAt, 0.75), resendBody: asnBody(L.po), root: 'Supplier ERP adds the release suffix "-ASHBY-WHSL-REL-02" to the PO number on orders released a second time. Each ship notice was corrected and resent by hand; the Supplier ERP setting is unchanged.' };
      } else {
        L.d856 = S.doc({ type: '856', reference: `ASN-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(asnAt), body: asnBody(L.po) });
      }
      L.asnAt = asnAt;
    }
    if (L.departed) {
      const invAt = L.s.invAt ? et(etDay(L.dep), L.s.invAt) : addH(L.departed, U(0.5, 2));
      const invBody = (poref) => ({ invoice: `INV-${L.n}`, po_reference: poref, lines: linesBody(L), total: val(L), terms: 'Net 30' });
      if (L.s.poref === 'inv') {
        L.d810 = S.doc({ type: '810', reference: `INV-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(invAt), status: 'Rejected', body: invBody(`${L.po}-ASHBY-WHSL-REL-02`) });
        L.rejectInv = { cause: 'PO reference longer than 22 characters', field: 'BIG04 PO reference', sent: `${L.po}-ASHBY-WHSL-REL-02`, allowed: '22 characters, the Northfield PO number', rule: 'NF-POREF', at: addH(invAt, 25 / 60), open: true, root: 'Same Supplier ERP setting as ASN-46118: the release suffix is added to the PO number on orders released a second time. This invoice has not been corrected.' };
      } else {
        L.d810 = S.doc({ type: '810', reference: `INV-${L.n}`, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(invAt), body: invBody(L.po) });
      }
      L.invAt = invAt;
      const recvDay = L.s.departLate ? etDay(addD(L.departed, 1)) : L.requested;
      const recvAt = et(recvDay, L.s.receiptHm || `0${7 + Math.floor(R() * 3)}:${String(Math.floor(R() * 6) * 10).padStart(2, '0')}`);
      if (recvAt <= CLOCK) {
        L.d861 = S.doc({ type: '861', reference: `RCV-${L.n}`, po: L.po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(recvAt), body: { po: L.po, asn: `ASN-${L.n}`, received_day: recvDay, location: L.shipTo, lines: L.lines.map((l) => ({ line: l.line, sku: l.sku, cases: l.qty })) } });
      }
    }
  }

  // ---------- rejections ----------
  const reject = (L, docKey, spec, channel = '824') => {
    const docId = L[docKey], d = S.getDoc(docId);
    const at = spec.at;
    let rep;
    if (channel === '824') {
      rep = S.doc({ type: '824', reference: `AA-${d.reference}`, po: L.po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(at), answers: docId, body: { rejected: d.reference, rejected_type: d.doc_type, cause: spec.cause, field: spec.field, sent_value: spec.sent } });
    } else {
      rep = S.doc({ type: '997', reference: `FA-${d.group_control}`, po: L.po, sender: 'NORTHFIELD', receiver: 'ASHBY', at: iso(at), answers: docId, covers: JSON.stringify([docId]), body: { ak5: 'R', group: d.group_control, cause: spec.cause, field: spec.field } });
    }
    d.status = spec.open ? 'Rejected' : 'Corrected and resent';
    const e = S.error({ doc_id: docId, reported_by: rep, channel: channel === '824' ? 'Application advice (824)' : 'Technical acknowledgment (997)', cause: spec.cause, field: spec.field, sent_value: spec.sent, allowed: spec.allowed, rule_id: spec.rule, root_cause: spec.root || null });
    if (!spec.open) {
      const resend = S.doc({ type: d.doc_type, reference: d.reference, po: L.po, sender: 'ASHBY', receiver: 'NORTHFIELD', at: iso(spec.resendAt || addH(at, U(0.4, 1.5))), answers: docId, body: spec.resendBody || { ...d.body, corrected: spec.field } });
      e.status = 'Corrected'; e.corrected_by = resend;
    }
    return e;
  };
  for (const L of life) {
    if (L.rejectAsn) reject(L, 'd856', L.rejectAsn);
    if (L.rejectInv) reject(L, 'd810', L.rejectInv);
  }

  // Generic failures across the window: 10 item, 6 ship-to, 12 other 824 causes, 8 rejected by 997.
  const pool = life.filter((L) => !special[L.n] && L.departed && L.asnAt > addH(WINDOW_START, 6) && L.d810 && L.d861);
  const used = new Set();
  const take = () => { let L; do { L = pick(pool); } while (used.has(L.n)); used.add(L.n); return L; };
  const plan = [
    ...Array(6).fill(['d856', { cause: 'Item not on Northfield item list', field: 'LIN03 item number', sent: '448190', allowed: 'Items on Ashby’s Northfield item list', rule: 'NF-ITEM' }]),
    ...Array(4).fill(['d810', { cause: 'Item not on Northfield item list', field: 'IT109 item number', sent: '448190', allowed: 'Items on Ashby’s Northfield item list', rule: 'NF-ITEM' }]),
    ...Array(6).fill(['d856', { cause: 'Ship-to location not recognized', field: 'N104 ship-to GLN', sent: '0614141001996', allowed: 'Active Northfield location GLN', rule: 'NF-SHIPTO' }]),
    ...Array(3).fill(['d856', { cause: 'Carton count does not match cartons listed', field: 'TD102 carton count', sent: 'Header count differs from listed cartons', allowed: 'Equal counts', rule: 'NF-CTN' }]),
    ...Array(3).fill(['d810', { cause: 'Invoice total does not match line amounts', field: 'TDS01 total', sent: 'Total differs from line sum', allowed: 'Sum of line amounts', rule: 'NF-TOTAL' }]),
    ...Array(3).fill(['d856', { cause: 'Quantity not in cases', field: 'SN103 unit of measure', sent: 'EA', allowed: 'CA', rule: 'NF-UOM' }]),
    ...Array(3).fill(['d856', { cause: 'Ship date after delivery date', field: 'DTM02 ship date', sent: 'Ship date later than delivery date', allowed: 'On or before delivery date', rule: 'NF-DATES' }]),
  ];
  for (const [key, spec] of plan) {
    const L = take(); const d = S.getDoc(L[key]);
    reject(L, key, { ...spec, at: addH(new Date(d.sent_at), 0.25) });
  }
  const syn = [
    ['Missing required segment', 'REF segment'], ['Missing required segment', 'REF segment'],
    ['Invalid date format', 'DTM02'], ['Invalid date format', 'DTM02'],
    ['Duplicate group control number', 'GS06'], ['Duplicate group control number', 'GS06'],
    ['Element longer than allowed', 'N102 name'], ['Element longer than allowed', 'N102 name'],
  ];
  for (const [cause, field] of syn) {
    const L = take(); const key = R() < 0.5 ? 'd856' : 'd855'; const d = S.getDoc(L[key]);
    reject(L, key, { cause, field, sent: null, allowed: 'X12 004010 syntax', rule: null, at: addH(new Date(d.sent_at), 0.2) }, '997');
  }

  // ---------- technical acknowledgments ----------
  // Every exchanged document is acknowledged by a 997 for its functional group. The number of in-window 997s
  // balances the window to the Plan's 3,412 documents.
  const inWin = (d) => new Date(d.sent_at) > WINDOW_START && new Date(d.sent_at) <= CLOCK;
  const rejected997 = new Set(S.docs.filter((d) => d.doc_type === '997').map((d) => d.answers_doc_id));
  const ackable = S.docs.filter((d) => d.doc_type !== '997' && !rejected997.has(d.doc_id) && new Date(d.sent_at) <= CLOCK);
  const nonAckWin = S.docs.filter((d) => inWin(d)).length; // 850..824 plus the 8 rejecting 997s
  const need = TARGET_DOCS - nonAckWin;
  const winAck = ackable.filter(inWin), preAck = ackable.filter((d) => !inWin(d));
  if (need < winAck.length / 3 || need > winAck.length) throw new Error(`997 balance out of range: need ${need} for ${winAck.length} documents`);
  const streams = {};
  for (const d of winAck) (streams[`${d.sender_id}|${d.doc_type}`] ||= []).push(d);
  const keys = Object.keys(streams).sort();
  for (const k of keys) streams[k].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  let alloc = keys.map((k) => Math.max(1, Math.round((need * streams[k].length) / winAck.length)));
  let diff = need - alloc.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % keys.length) {
    if (diff > 0 && alloc[i] < streams[keys[i]].length) { alloc[i]++; diff--; } else if (diff < 0 && alloc[i] > 1) { alloc[i]--; diff++; }
  }
  const emit = (group, maxAt) => {
    const first = group[0], last = group[group.length - 1];
    let at = addH(new Date(last.sent_at), 10 / 60); if (at > maxAt) at = maxAt;
    S.doc({ type: '997', reference: `FA-${first.group_control}`, po: group.length === 1 ? first.po : null, sender: first.receiver_id, receiver: first.sender_id, at: iso(at), answers: first.doc_id, covers: JSON.stringify(group.map((g) => g.doc_id)), body: { ak5: 'A', groups: group.map((g) => g.group_control), documents: group.length } });
  };
  keys.forEach((k, i) => {
    const arr = streams[k], g = alloc[i];
    for (let j = 0; j < g; j++) emit(arr.slice(Math.floor((j * arr.length) / g), Math.floor(((j + 1) * arr.length) / g)), CLOCK);
  });
  for (const d of preAck) emit([d], new Date(WINDOW_START.getTime()));

  // ---------- other suppliers (for the Not available guardrail) ----------
  for (const [sup, sku, start] of [['BROOKLINE', 'BRK-TWL-2', 81200], ['CEDARPINE', 'CDP-CND-8', 92400]]) {
    for (let k = 0; k < 40; k++) {
      const po = `NR-${start + k}`, r = addH(addD(CLOCK, -29), k * 16), qty = 10 * (3 + Math.floor(R() * 10));
      const price = ITEM[sku].case_price;
      S.order({ scenario: 'p10', po, supplier_id: sup, retailer_id: 'NORTHFIELD', programme: 'Wholesale', ship_to: 'DC2', received_at: iso(r), requested_delivery: etDay(addD(r, 4)), order_value: money(qty * price), ship_from: sup, note: null });
      S.line({ scenario: 'p10', po, line: 1, sku, qty_ordered: qty, qty_accepted: qty, case_price: price });
      S.doc({ type: '850', reference: po, po, supplier: sup, sender: 'NORTHFIELD', receiver: sup, at: iso(r), body: { po, lines: [{ line: 1, sku, qty }] } });
      S.doc({ type: '855', reference: `ACK-${start + k}`, po, supplier: sup, sender: sup, receiver: 'NORTHFIELD', at: iso(addH(r, 3)), body: { po } });
      const asnStatus = k % 9 === 4 ? 'Rejected' : 'Delivered';
      const asn = S.doc({ type: '856', reference: `ASN-${start + k}`, po, supplier: sup, sender: sup, receiver: 'NORTHFIELD', at: iso(addH(r, 40)), status: asnStatus, body: { po } });
      if (asnStatus === 'Rejected') {
        const rep = S.doc({ type: '824', reference: `AA-ASN-${start + k}`, po, supplier: sup, sender: 'NORTHFIELD', receiver: sup, at: iso(addH(r, 40.3)), answers: asn, body: { cause: 'Ship-to location not recognized' } });
        S.error({ doc_id: asn, reported_by: rep, channel: 'Application advice (824)', cause: 'Ship-to location not recognized', field: 'N104 ship-to GLN', rule_id: 'NF-SHIPTO' });
      }
    }
  }

  S.life = life; S.windowStart = WINDOW_START;
  return S;
}
