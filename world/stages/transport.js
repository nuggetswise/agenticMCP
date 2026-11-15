// T1.15 Transport: 753 routing request, 754 routing instructions, 204 load tender, 214 shipment status, 210 freight invoice.
//
// Who moves the freight (freight_terms, a dated master per ship-from site, read by pickup date):
//   Ashby warehouse ASH-WH1: prepaid. Ashby tenders each load to Lakeline on a 204, Lakeline reports milestones on 214s
//     and bills on a 210 (Ashby pays). Documents run Ashby <-> Lakeline only, so P10's window rule does not apply to them.
//   Kinross Groveport and Joliet: prepaid and booked by Kinross under Ashby's warehouse agreement until 6 December (no
//     EDI in this world between Kinross and Lakeline); from 6 December collect, routed by Northfield for peak: Ashby
//     sends a 753 per shipment, Northfield answers with a 754 naming Lakeline and the pickup window, and Lakeline copies
//     its 214s to Ashby. The 18 pickup_missed cases (8 to 10 Dec) are such collect shipments. Invented, see below.
//   Buyer and store orders (NR-450118, NR-450415, the P5 risk orders) keep only the records already written for them:
//     their freight terms sit on their own bills of lading, and P5 shows NR-460241's routing request as missing.
// P10's window (18 Oct to 17 Nov, 11:00 ET): the only Ashby<->Northfield documents here are 753 and 754, and the first
// collect pickup is 6 Dec, so the earliest is sent on 4 Dec. The build refuses any that falls inside.
//
// ERP practice borrowed (pages opened 15 Nov 2026):
//   ERPNext Shipment doctype (https://docs.frappe.io/erpnext/shipment.md): a shipment record created from the delivery
//     note, with pickup from and delivery to, pickup date, carrier, shipment id and shipment amount -> `loads`.
//   SAP shipment header VTTK (https://sapstack.com/tables/tabledetails.php?table=VTTK): overall transportation status
//     STTRG, planned check-in DPREG against actual check-in DAREG, start and end of shipment DATBG/DATEN, forwarding
//     agent TDLNR -> `loads.status`, the assigned pickup against the carrier's arrival, and `shipment_status`.
//   Dated rate and terms rows follow the T1.11 practice (ERPNext Item Price valid from/upto; SAP KONH DATAB/DATBI).
//
// Public guides used for structure and values (opened 15 Nov 2026):
//   Cabela's 753 guide, version 004030 (https://edi.jobisez.com/edi-igs/Cabelas/753_fileDisplay.pdf): BGN, ship-from N1,
//     LX, ship-to N1 with earliest and latest pickup, OID with PO (OID02), cartons (OID04 CTN, OID05), pounds (OID06 L,
//     OID07); the 754's load id comes back in BGN02 and the shipment id in OID03.
//   NEXCOM 754 routing instruction information (https://www.mynavyexchange.com/assets/Static/DoingBusinessWithUs/
//     contractor_vendor/docs/754-Routing-Instruction-Information_32923.pdf): GS08 004030 under ISA12 00401; L11 RRC is
//     the routing request control number the supplier sends on the 753 and gets back on the 754; BLR carries the SCAC.
//   XGS 204 outbound load tender (https://www.xgsi.com/wp-content/uploads/204-XGS-Outbound-Load-Tender-1.pdf): B206 PP,
//     B2A 00 LT, S5 CL and CU, G62 69/U scheduled pickup, 38/K ship no later than, 54/L deliver no later than.
//   CN 204 implementation guide 4010 (https://www.cn.ca/-/media/files/customer-centre/customer-centre-documents/
//     204-implementation-guide-4010.pdf): L11 PO, N1 SH/SF/ST, L3 weight.
//   US Transportation Command 214 guide 004010 (https://www.ustranscom.mil/cmd/associated/dteb/files/transportationics/
//     dteb214a004010_Version_10.pdf): AT701 X3 arrived at pick-up location, AF carrier departed pick-up location with
//     shipment, X1 arrived at delivery location, D1 completed unloading at delivery location, SD shipment delayed;
//     AT702 NS normal status, BB held per shipper, used for "vendor not ready for pickup" with AT701 SD.
//   ArcBest 214 specification (https://arcb.com/sites/www/files/2024-12/ArcBest-EDI-Specs-214.pdf): B1001 PRO, B1002
//     shipment id from the 204's B204, B1003 SCAC.
//   Kroger 210 guidelines (https://edi.kroger.com/EDIPortal/documents/Maps/ht/HT_210_X12_4020_Guidelines.pdf): B3 with
//     B304 PP, B307 net amount in cents, B311 SCAC; N9 SI; L1 with L108 405 fuel surcharge; L3 total charge.
// Timing: NF-3.2 (routing request by 11:00, two business days before the ready date; adapted from DSG, DXL and Gordmans)
//   is read as P5 reads it: NR-460241's request was due at 11:00 on 9 Dec for its 10 Dec pickup, so a request is due by
//   11:00 Eastern on the day before the assigned pickup. Cabela's asks for 48 hours; the world's orders ship about 40
//   hours after the PO, so that value is not used. Pickup window: two hours from the assigned pickup (invented).
// Invented: Kinross lanes going collect from 6 Dec; Lakeline's rate card and fuel surcharge; carton weight and cube;
//   the two-hour pickup window; Lakeline copying collect 214s to Ashby; PRO and load numbers.
import { rng, et, etDay, addH, addD, money } from '../lib.js';
import { iso } from '../log.js';
import { seg, d8, t4, iso8, first, n1, clean } from '../x12.js';
import { locations, PARTY, QUARTER, HISTORY_START } from '../ref.js';

const LOC = Object.fromEntries(locations.map((l) => [l.id, l]));
export const COLLECT_FROM = '2026-12-06';
const WINDOW_H = 2;
const SCAC = 'LKLF';
/** Shipping weight (lb) and cube (cubic feet) of one carton. Invented. */
const CARTON = { 'ASH-MUG-12': [15.5, 1.3], 'ASH-NAP-4': [9.0, 1.1], 'ASH-HNY-340': [12.5, 0.9] };
const DOCK = Object.fromEntries(locations.filter((l) => /Dock window/.test(l.note || '')).map((l) => { const m = l.note.match(/(\d\d:\d\d) to (\d\d:\d\d)/); return [l.id, { open: m[1], close: m[2] }]; }));

// ---------- masters ----------
export const FREIGHT_TERMS = [
  { id: 'FT-ASH-WH1', ship_from: 'ASH-WH1', terms: 'Prepaid', tendered_by: 'ASHBY', carrier_id: 'LAKELINE', scac: SCAC, valid_from: HISTORY_START, valid_to: null, source: 'Ashby ships prepaid from its own warehouse and tenders Lakeline on a 204. Invented.' },
  ...['KIN-GRV', 'KIN-JOL'].flatMap((s) => [
    { id: `FT-${s}-1`, ship_from: s, terms: 'Prepaid', tendered_by: 'KINROSS', carrier_id: 'LAKELINE', scac: SCAC, valid_from: HISTORY_START, valid_to: COLLECT_FROM, source: 'Kinross books Lakeline for Ashby under the warehouse agreement. Invented.' },
    { id: `FT-${s}-2`, ship_from: s, terms: 'Collect', tendered_by: 'NORTHFIELD', carrier_id: 'LAKELINE', scac: SCAC, valid_from: COLLECT_FROM, valid_to: null, source: 'Northfield routes Kinross freight for peak (NF-3.2 to NF-3.6); Lakeline is its routed carrier. Invented.' },
  ]),
];
/** Lakeline's rate card for Ashby's prepaid lanes: a flat charge per load, a charge per carton and a fuel surcharge on
 * the linehaul, dated. Invented. */
export const CARRIER_RATES = ['DC2', 'DC4'].flatMap((to) => [
  { carrier_id: 'LAKELINE', ship_from: 'ASH-WH1', ship_to: to, valid_from: HISTORY_START, valid_to: '2026-11-01', per_load: to === 'DC2' ? 165 : 190, per_carton: to === 'DC2' ? 0.85 : 0.95, fuel_pct: 0.18, source: 'Lakeline rate card 2026. Invented.' },
  { carrier_id: 'LAKELINE', ship_from: 'ASH-WH1', ship_to: to, valid_from: '2026-11-01', valid_to: null, per_load: to === 'DC2' ? 165 : 190, per_carton: to === 'DC2' ? 0.85 : 0.95, fuel_pct: 0.21, source: 'Lakeline rate card 2026, fuel surcharge from 1 Nov. Invented.' },
]);
const inForce = (rows, day, f) => rows.find((r) => f(r) && r.valid_from <= day && (r.valid_to == null || day < r.valid_to));
export const termsAt = (site, day) => inForce(FREIGHT_TERMS, day, (r) => r.ship_from === site);
export const rateAt = (from, to, day) => inForce(CARRIER_RATES, day, (r) => r.ship_from === from && r.ship_to === to);
export function freightCharge(from, to, day, cartons) {
  const r = rateAt(from, to, day); if (!r) return null;
  const linehaul = money(r.per_load + r.per_carton * cartons); const fuel = money(linehaul * r.fuel_pct);
  return { linehaul, fuel, total: money(linehaul + fuel) };
}
/** NF-3.2 as P5 reads it: 11:00 Eastern on the day before the assigned pickup. */
export const routingDue = (pickupIso) => et(etDay(addD(new Date(pickupIso), -1)), '11:00').toISOString();

// ---------- X12 bodies and readers ----------
const cents = (x) => Math.round(x * 100);
const dt = (e) => (e ? iso8(e[2], (e[4] || '0000') + '00') : null);
const g62 = (S, q) => S.find((e) => e[0] === 'G62' && e[1] === q);
const l11 = (S, q) => S.find((e) => e[0] === 'L11' && e[2] === q)?.[1] ?? null;
const party = (role, l) => seg('N1', role, clean(l.name), 'UL', l.gln);

const docs = {
  753: {
    func: 'RF', name: 'Routing request', version: '004030',
    body: (d) => [
      seg('BGN', '00', d.ref, d8(d.at), t4(d.at)),
      party('SF', d.from_loc),
      seg('LX', 1),
      party('ST', d.to_loc),
      seg('L11', d.ref, 'RRC'),
      seg('G62', '37', d8(d.ready_at), 'I', t4(d.ready_at)),
      seg('G62', '38', d8(d.latest_at), 'K', t4(d.latest_at)),
      seg('OID', d.shipment, d.po, '', 'CTN', d.cartons, 'L', d.weight, 'E', d.cube),
    ],
    read: (S) => { const b = first(S, 'BGN'); const o = first(S, 'OID'); const p = n1(S);
      return { ref: b[2], po: o[2], request: l11(S, 'RRC'), shipment: o[1], ship_from_gln: p.SF.gln, ship_to_gln: p.ST.gln, ready_at: dt(g62(S, '37')), latest_at: dt(g62(S, '38')), cartons: +o[5], weight: +o[7], cube: +o[9] }; },
  },
  754: {
    func: 'RG', name: 'Routing instructions', version: '004030',
    body: (d) => [
      seg('BGN', '00', d.ref, d8(d.at), t4(d.at)),
      party('SF', d.from_loc),
      party('ST', d.to_loc),
      seg('N1', 'CA', clean(PARTY.LAKELINE.name), 'UL', PARTY.LAKELINE.gln),
      seg('LX', 1),
      seg('L11', d.request, 'RRC'),
      seg('BLR', SCAC),
      seg('OID', d.shipment, d.po, d.ref, 'CTN', d.cartons, 'L', d.weight),
      seg('G62', '69', d8(d.pickup_from), 'U', t4(d.pickup_from)),
      seg('G62', '38', d8(d.pickup_to), 'K', t4(d.pickup_to)),
    ],
    read: (S) => { const b = first(S, 'BGN'); const o = first(S, 'OID'); const p = n1(S);
      return { ref: b[2], load: b[2], po: o[2], request: l11(S, 'RRC'), shipment: o[1], scac: first(S, 'BLR')[1], carrier_gln: p.CA?.gln || null, ship_from_gln: p.SF.gln, ship_to_gln: p.ST.gln, pickup_from: dt(g62(S, '69')), pickup_to: dt(g62(S, '38')), cartons: +o[5], weight: +o[7] }; },
  },
  204: {
    func: 'SM', name: 'Load tender',
    body: (d) => [
      seg('B2', '', SCAC, '', d.ref, '', 'PP'),
      seg('B2A', '00', 'LT'),
      seg('L11', d.po, 'PO'),
      seg('L11', d.shipment, 'SI'),
      party('SH', PARTY.ASHBY),
      seg('S5', 1, 'CL', d.weight, 'L', d.cartons, 'CT'),
      seg('G62', '69', d8(d.pickup_at), 'U', t4(d.pickup_at)),
      party('SF', d.from_loc),
      seg('S5', 2, 'CU', d.weight, 'L', d.cartons, 'CT'),
      seg('G62', '54', d8(d.deliver_by), 'L', t4(d.deliver_by)),
      party('ST', d.to_loc),
      seg('L3', d.weight, 'G', '', '', '', '', '', '', '', '', d.cartons),
    ],
    read: (S) => { const b = first(S, 'B2'); const p = n1(S); const s5 = S.filter((e) => e[0] === 'S5');
      return { ref: b[4], load: b[4], scac: b[2], payment: b[6], po: l11(S, 'PO'), shipment: l11(S, 'SI'), ship_from_gln: p.SF.gln, ship_to_gln: p.ST.gln, pickup_at: dt(g62(S, '69')), deliver_by: dt(g62(S, '54')), weight: +s5[0][3], cartons: +s5[0][5] }; },
  },
  214: {
    func: 'QM', name: 'Shipment status',
    body: (d) => [
      seg('B10', d.pro, d.load, SCAC),
      seg('L11', d.po, 'PO'),
      party('SF', d.from_loc),
      party('ST', d.to_loc),
      ...d.statuses.flatMap((s, i) => [seg('LX', i + 1), seg('AT7', s.code, s.reason, '', '', d8(s.at), t4(s.at))]),
    ],
    read: (S) => { const b = first(S, 'B10'); const p = n1(S); const statuses = S.filter((e) => e[0] === 'AT7').map((e) => ({ code: e[1], reason: e[2], at: iso8(e[5], e[6] + '00') }));
      // A 214 has no number of its own: it is named by the carrier's PRO and the statuses it carries.
      return { ref: `${b[1]} ${statuses.map((s) => s.code).join('+')}`, pro: b[1], load: b[2], scac: b[3], po: l11(S, 'PO'), ship_from_gln: p.SF.gln, ship_to_gln: p.ST.gln, statuses }; },
  },
  210: {
    func: 'IM', name: 'Freight invoice',
    body: (d) => [
      seg('B3', '', d.ref, d.load, 'PP', 'L', d8(d.at), cents(d.total), '', '', '', SCAC),
      seg('N9', 'PO', d.po),
      seg('N9', 'SI', d.shipment),
      seg('G62', '11', d8(d.shipped_at)),
      party('SH', PARTY.ASHBY),
      party('SF', d.from_loc),
      party('ST', d.to_loc),
      seg('LX', 1), seg('L5', 1, 'LINEHAUL'), seg('L0', 1, '', '', d.weight, 'G', '', '', d.cartons, 'CTN', '', 'L'), seg('L1', 1, money(d.linehaul).toFixed(2), 'FR', cents(d.linehaul)),
      seg('LX', 2), seg('L5', 2, 'FUEL SURCHARGE'), seg('L1', 2, '', '', cents(d.fuel), '', '', '', '405', '', '', '', 'FUEL SURCHARGE'),
      seg('L3', d.weight, 'G', '', '', cents(d.total), '', '', '', '', '', d.cartons),
    ],
    read: (S) => { const b = first(S, 'B3'); const p = n1(S); const l1 = S.filter((e) => e[0] === 'L1');
      return { ref: b[2], load: b[3], payment: b[4], total: +b[7] / 100, scac: b[11], po: first(S, 'N9', 'PO')[2], shipment: first(S, 'N9', 'SI')[2], shipped_on: iso8(g62(S, '11')[2]).slice(0, 10),
        ship_from_gln: p.SF.gln, ship_to_gln: p.ST.gln, linehaul: +l1[0][4] / 100, fuel: +l1[1][4] / 100, weight: +first(S, 'L3')[1], cartons: +first(S, 'L3')[11] }; },
  },
};

// ---------- generator ----------
function generate(L, { G }) {
  const R = rng(20261215);
  const doc = (x) => L.doc(x);
  for (const O of G.life) {
    // Five draws per order, whether used or not, so one order's records never move another's.
    const r = [R(), R(), R(), R(), R()];
    if (!O.dep || !O.cartons || !O.rcvAt) continue;
    const day = etDay(O.dep); const ft = termsAt(O.site, day);
    const prepaid = ft.tendered_by === 'ASHBY' && day >= QUARTER.start && day <= QUARTER.end;
    const collect = ft.terms === 'Collect';
    if (!prepaid && !collect) continue;
    const from_loc = LOC[O.site], to_loc = LOC[O.shipTo];
    const cartons = O.cartons.length;
    const weight = Math.round(O.cartons.reduce((a, c) => a + CARTON[O.lines.find((l) => l.line === c.line).sku][0], 0));
    const cube = Math.round(O.cartons.reduce((a, c) => a + CARTON[O.lines.find((l) => l.line === c.line).sku][1], 0));
    const base = { po: O.po, shipment: `SHP-${O.n}`, from_loc, to_loc, cartons, weight };
    let load;
    if (prepaid) {
      load = `LT-${O.n}`;
      const at = addH(O.ackAt, 0.3 + 0.9 * r[0]); if (at >= O.dep) throw new Error(`Load tender for ${O.po} after its pickup`);
      const close = DOCK[O.shipTo].close;
      doc({ type: '204', from: 'ASHBY', to: 'LAKELINE', at, ref: load, ...base, pickup_at: iso(O.dep), deliver_by: iso(et(O.requested, close)) });
    } else {
      const req = `RR-${O.n}`; load = `NRL-${O.n}`;
      const at = addH(O.ackAt, 0.2 + 0.7 * r[0]);
      if (at.toISOString() >= routingDue(iso(O.dep))) throw new Error(`Routing request for ${O.po} would be late under NF-3.2`);
      const latest = addH(O.dep, WINDOW_H);
      doc({ type: '753', from: 'ASHBY', to: 'NORTHFIELD', at, ref: req, ...base, ready_at: iso(O.dep), latest_at: iso(latest), cube });
      const at754 = addH(at, 1.5 + 2 * r[1]); if (at754 >= O.dep) throw new Error(`Routing instructions for ${O.po} after the pickup`);
      doc({ type: '754', from: 'NORTHFIELD', to: 'ASHBY', at: at754, ref: load, request: req, ...base, pickup_from: iso(O.dep), pickup_to: iso(latest) });
    }
    // Milestones: they agree with the warehouse departure scan (= the 856's ship time), Lakeline's delivery receipt
    // (0.6 hours before the receipt) and the 861. A departure more than the window after the assigned pickup means the
    // carrier came at the pickup and the freight was not ready (the pickup_missed cases).
    const st = { pro: `PRO-${O.n}`, load, ...base };
    const sent = (t, k) => addH(t, 0.1 + 0.3 * r[k]);
    if (O.departed - O.dep > WINDOW_H * 3600000) {
      const arrived = addH(O.dep, -0.25), delayed = addH(O.dep, 0.5);
      doc({ type: '214', from: 'LAKELINE', to: 'ASHBY', at: sent(delayed, 2), ...st, statuses: [{ code: 'X3', reason: 'NS', at: iso(arrived) }, { code: 'SD', reason: 'BB', at: iso(delayed) }] });
    }
    const arrivedPick = addH(O.departed, -(1.0 + 0.5 * r[2]));
    doc({ type: '214', from: 'LAKELINE', to: 'ASHBY', at: sent(O.departed, 3), ...st, statuses: [{ code: 'X3', reason: 'NS', at: iso(arrivedPick) }, { code: 'AF', reason: 'NS', at: iso(O.departed) }] });
    const unloaded = addH(O.rcvAt, -0.6), arrivedDc = addH(unloaded, -(0.5 + 0.4 * r[4]));
    doc({ type: '214', from: 'LAKELINE', to: 'ASHBY', at: sent(unloaded, 4), ...st, statuses: [{ code: 'X1', reason: 'NS', at: iso(arrivedDc) }, { code: 'D1', reason: 'NS', at: iso(unloaded) }] });
    if (prepaid) {
      const c = freightCharge(O.site, O.shipTo, day, cartons);
      doc({ type: '210', from: 'LAKELINE', to: 'ASHBY', at: et(etDay(addD(unloaded, 1)), `${10 + Math.floor(r[1] * 2)}:${String(Math.floor(r[3] * 6) * 10).padStart(2, '0')}`), ref: `LKI-${O.n}`, load, ...base, shipped_at: iso(O.departed), ...c });
    }
  }
}

// ---------- tables ----------
const schema = `
CREATE TABLE freight_terms (id TEXT PRIMARY KEY, ship_from TEXT NOT NULL REFERENCES locations(id), terms TEXT NOT NULL, tendered_by TEXT NOT NULL REFERENCES parties(id), carrier_id TEXT NOT NULL REFERENCES parties(id), scac TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, source TEXT NOT NULL);
CREATE TABLE carrier_rates (carrier_id TEXT NOT NULL REFERENCES parties(id), ship_from TEXT NOT NULL REFERENCES locations(id), ship_to TEXT NOT NULL REFERENCES locations(id), valid_from TEXT NOT NULL, valid_to TEXT, per_load REAL NOT NULL, per_carton REAL NOT NULL, fuel_pct REAL NOT NULL, source TEXT NOT NULL, PRIMARY KEY (carrier_id, ship_from, ship_to, valid_from));
CREATE TABLE routing_requests (request_id TEXT PRIMARY KEY, po TEXT NOT NULL REFERENCES orders(po), shipment_id TEXT REFERENCES shipments(shipment_id), doc_id TEXT NOT NULL REFERENCES documents(doc_id), sent_at TEXT NOT NULL, due_by TEXT NOT NULL,
  ship_from TEXT NOT NULL REFERENCES locations(id), ship_to TEXT NOT NULL REFERENCES locations(id), ready_at TEXT NOT NULL, latest_at TEXT NOT NULL, cartons INTEGER NOT NULL, weight_lb REAL NOT NULL, cube_ft REAL,
  status TEXT NOT NULL, instructions_doc_id TEXT REFERENCES documents(doc_id), routed_at TEXT, load_id TEXT, carrier_id TEXT REFERENCES parties(id), scac TEXT, pickup_from TEXT, pickup_to TEXT);
CREATE TABLE loads (load_id TEXT PRIMARY KEY, po TEXT NOT NULL REFERENCES orders(po), shipment_id TEXT REFERENCES shipments(shipment_id), terms TEXT NOT NULL, tendered_by TEXT NOT NULL REFERENCES parties(id), carrier_id TEXT NOT NULL REFERENCES parties(id), scac TEXT NOT NULL,
  source_doc_id TEXT NOT NULL REFERENCES documents(doc_id), request_id TEXT REFERENCES routing_requests(request_id), ship_from TEXT NOT NULL REFERENCES locations(id), ship_to TEXT NOT NULL REFERENCES locations(id),
  pickup_at TEXT NOT NULL, pickup_latest TEXT, deliver_by TEXT, cartons INTEGER NOT NULL, weight_lb REAL NOT NULL, status TEXT NOT NULL);
CREATE TABLE shipment_status (load_id TEXT NOT NULL REFERENCES loads(load_id), doc_id TEXT NOT NULL REFERENCES documents(doc_id), seq INTEGER NOT NULL, status_code TEXT NOT NULL, reason_code TEXT, status TEXT NOT NULL, at TEXT NOT NULL,
  location TEXT REFERENCES locations(id), sent_at TEXT NOT NULL, PRIMARY KEY (doc_id, seq));
CREATE TABLE freight_invoices (invoice TEXT PRIMARY KEY, load_id TEXT NOT NULL REFERENCES loads(load_id), po TEXT NOT NULL REFERENCES orders(po), doc_id TEXT NOT NULL REFERENCES documents(doc_id), sent_at TEXT NOT NULL, shipped_on TEXT NOT NULL,
  linehaul REAL NOT NULL, fuel REAL NOT NULL, total REAL NOT NULL, rated_total REAL, status TEXT NOT NULL);
CREATE INDEX ix_status_load ON shipment_status(load_id, at); CREATE INDEX ix_loads_po ON loads(po); CREATE INDEX ix_rr_po ON routing_requests(po);
`;
const STATUS = { X3: 'Arrived at pick-up location', AF: 'Departed pick-up location with shipment', SD: 'Shipment delayed', X1: 'Arrived at delivery location', D1: 'Completed unloading at delivery location' };

function derive(d, T, { loc }) {
  for (const k of ['routing_requests', 'loads', 'shipment_status', 'freight_invoices']) T[k] ||= [];
  if (d.type === '753') {
    T.routing_requests.push({ request_id: d.ref, po: d.po, shipment_id: null, doc_id: d.doc_id, sent_at: d.at, due_by: routingDue(d.ready_at), ship_from: loc(d.ship_from_gln), ship_to: loc(d.ship_to_gln), ready_at: d.ready_at, latest_at: d.latest_at,
      cartons: d.cartons, weight_lb: d.weight, cube_ft: d.cube, status: 'Requested', instructions_doc_id: null, routed_at: null, load_id: null, carrier_id: null, scac: null, pickup_from: null, pickup_to: null });
  } else if (d.type === '754') {
    const r = T.routing_requests.find((x) => x.request_id === d.request);
    const carrier = Object.values(PARTY).find((p) => p.gln === d.carrier_gln)?.id || null;
    if (r) Object.assign(r, { status: 'Routed', instructions_doc_id: d.doc_id, routed_at: d.at, load_id: d.load, carrier_id: carrier, scac: d.scac, pickup_from: d.pickup_from, pickup_to: d.pickup_to });
    T.loads.push({ load_id: d.load, po: d.po, shipment_id: null, terms: 'Collect', tendered_by: 'NORTHFIELD', carrier_id: carrier, scac: d.scac, source_doc_id: d.doc_id, request_id: d.request, ship_from: loc(d.ship_from_gln), ship_to: loc(d.ship_to_gln),
      pickup_at: d.pickup_from, pickup_latest: d.pickup_to, deliver_by: null, cartons: d.cartons, weight_lb: d.weight, status: 'Routed' });
  } else if (d.type === '204') {
    T.loads.push({ load_id: d.load, po: d.po, shipment_id: null, terms: d.payment === 'PP' ? 'Prepaid' : d.payment, tendered_by: d.sender, carrier_id: d.receiver, scac: d.scac, source_doc_id: d.doc_id, request_id: null, ship_from: loc(d.ship_from_gln), ship_to: loc(d.ship_to_gln),
      pickup_at: d.pickup_at, pickup_latest: null, deliver_by: d.deliver_by, cartons: d.cartons, weight_lb: d.weight, status: 'Tendered' });
  } else if (d.type === '214') {
    d.statuses.forEach((s, i) => T.shipment_status.push({ load_id: d.load, doc_id: d.doc_id, seq: i + 1, status_code: s.code, reason_code: s.reason || null, status: STATUS[s.code] + (s.reason === 'BB' ? ': held per shipper, freight not ready' : ''),
      at: s.at, location: loc(['X1', 'D1'].includes(s.code) ? d.ship_to_gln : d.ship_from_gln), sent_at: d.at }));
  } else if (d.type === '210') {
    T.freight_invoices.push({ invoice: d.ref, load_id: d.load, po: d.po, doc_id: d.doc_id, sent_at: d.at, shipped_on: d.shipped_on, linehaul: d.linehaul, fuel: d.fuel, total: d.total, rated_total: null, status: 'Received' });
  }
}

/** After every document: the shipment each load moved (the 856 for the PO from the load's ship-from), each load's
 * status from its latest milestone, and each freight invoice judged against the rate card in force on the pickup date. */
function finish(T) {
  if (!T.loads) return;
  const ship = new Map(); for (const s of T.shipments) if (!ship.has(`${s.po}|${s.ship_from}`)) ship.set(`${s.po}|${s.ship_from}`, s.shipment_id);
  const byLoad = new Map(); for (const s of T.shipment_status) (byLoad.get(s.load_id) || byLoad.set(s.load_id, []).get(s.load_id)).push(s);
  for (const l of T.loads) {
    l.shipment_id = ship.get(`${l.po}|${l.ship_from}`) ?? null;
    const ms = (byLoad.get(l.load_id) || []).sort((a, b) => (a.at < b.at ? -1 : 1)); const last = ms[ms.length - 1];
    if (last) l.status = { X3: 'At pickup', SD: 'Pickup missed: freight not ready', AF: 'In transit', X1: 'At delivery', D1: 'Delivered' }[last.status_code];
  }
  for (const r of T.routing_requests || []) r.shipment_id = ship.get(`${r.po}|${r.ship_from}`) ?? null;
  const loadBy = new Map(T.loads.map((l) => [l.load_id, l]));
  for (const f of T.freight_invoices) {
    const l = loadBy.get(f.load_id); const c = l ? freightCharge(l.ship_from, l.ship_to, etDay(new Date(l.pickup_at)), l.cartons) : null;
    f.rated_total = c ? c.total : null; f.status = c && Math.abs(c.total - f.total) < 0.005 ? 'Matches rate card' : 'Differs from rate card';
    if (l && l.status === 'Delivered') l.status = 'Delivered and billed';
  }
}

/** Document flow (SAP VBFA, NetSuite "created from"): each transport document names the one it was created from. */
function prev(d, { latest }) {
  switch (d.type) {
    case '753': return [{ doc: latest(d.po, '855', d.at) || latest(d.po, '850', d.at), kind: 'requests routing for' }];
    case '754': return [{ doc: latest(d.po, '753', d.at, (x) => x.ref === d.request), kind: 'routes' }];
    case '204': return [{ doc: latest(d.po, '850', d.at), kind: 'tenders freight for' }];
    case '214': return [{ doc: latest(d.po, d.load.startsWith('LT-') ? '204' : '754', d.at, (x) => x.ref === d.load), kind: 'reports status on' }];
    case '210': return [{ doc: latest(d.po, '204', d.at, (x) => x.ref === d.load), kind: 'bills freight for' }];
    default: return [];
  }
}

// ---------- decisions the gate settles ----------
/** RT01 (NF-3.6, read with NF-3.4 and the NF-8.5 exclusion) for a collect shipment, from the carrier's milestones as
 * known on `asOf`: the charge stands only when Lakeline arrived at the assigned pickup inside the window the 754 gave and
 * the freight was not ready (an SD with reason BB, or no departure inside the window). A late or absent carrier excludes it. */
export function decideRoutingCharge(db, po, asOf) {
  const rr = db.prepare('SELECT * FROM routing_requests WHERE po = ? AND routed_at <= ?').get(po, asOf);
  if (!rr) return { po, stands: false, why: 'No routing instructions on record', rule: 'NF-3.6' };
  const ms = db.prepare('SELECT status_code, reason_code, at FROM shipment_status WHERE load_id = ? AND sent_at <= ? ORDER BY at').all(rr.load_id, asOf);
  const arrived = ms.find((m) => m.status_code === 'X3');
  const base = { po, load_id: rr.load_id, assigned_pickup: rr.pickup_from, window_ends: rr.pickup_to, carrier_arrived: arrived?.at ?? null, rule: 'NF-3.6' };
  if (!arrived || arrived.at > rr.pickup_to) return { ...base, stands: false, why: 'Northfield’s routed carrier was late or did not come (NF-8.5 exclusion)' };
  const notReady = ms.find((m) => m.status_code === 'SD' && m.reason_code === 'BB' && m.at >= arrived.at);
  const departed = ms.find((m) => m.status_code === 'AF' && m.at <= rr.pickup_to);
  if (notReady || !departed) return { ...base, stands: true, freight_not_ready: notReady?.at ?? null, why: 'Carrier arrived inside the pickup window and the freight was not ready' };
  return { ...base, stands: false, why: 'Freight left inside the pickup window' };
}
/** Prepaid on time (NF-8.1): the carrier's arrival at the DC (214 X1) by the deliver-no-later-than time on the 204. */
export function decideOnTime(db, loadId, asOf) {
  const l = db.prepare('SELECT * FROM loads WHERE load_id = ?').get(loadId);
  const x1 = db.prepare("SELECT at FROM shipment_status WHERE load_id = ? AND status_code = 'X1' AND sent_at <= ? ORDER BY at LIMIT 1").get(loadId, asOf);
  if (!l || !l.deliver_by || !x1) return { load_id: loadId, on_time: null, why: 'No arrival on record' };
  return { load_id: loadId, on_time: x1.at <= l.deliver_by, arrived: x1.at, deliver_by: l.deliver_by, rule: 'NF-8.1' };
}

const staedi = {
  SEG: {
    L11: ['AN 1 30', 'ID 2 3', 'AN 1 80'],
    OID: ['AN 1 30', 'AN 1 22', 'AN 1 30', 'ID 3 3', 'R 1 15', 'ID 1 1', 'R 1 10', 'ID 1 1', 'R 1 8'],
    BLR: ['ID 2 4!', 'DT 8 8', 'TM 4 8'],
    B2: ['ID 2 2', 'ID 2 4', 'ID 6 9', 'AN 1 30', 'ID 1 1', 'ID 2 2!'],
    B2A: ['ID 2 2!', 'ID 2 2'],
    S5: ['N 1 3!', 'ID 2 2!', 'R 1 10', 'ID 1 1', 'R 1 10', 'ID 2 2'],
    L3: ['R 1 10', 'ID 1 2', 'R 1 9', 'ID 2 2', 'N 1 12', 'N 1 9', 'N 1 9', 'ID 3 3', 'R 1 8', 'ID 1 1', 'R 1 7'],
    B10: ['AN 1 30', 'AN 1 30', 'ID 2 4!'],
    AT7: ['ID 2 2', 'ID 2 2', 'ID 2 2', 'ID 2 2', 'DT 8 8', 'TM 4 8', 'ID 2 2'],
    B3: ['ID 1 1', 'AN 1 22!', 'AN 1 30', 'ID 2 2!', 'ID 1 1', 'DT 8 8!', 'N 1 12!', 'ID 2 2', 'DT 8 8', 'ID 3 3', 'ID 2 4!'],
    N9: ['ID 2 3!', 'AN 1 30', 'AN 1 45'],
    L5: ['N 1 3', 'AN 1 50'],
    L0: ['N 1 3', 'R 1 11', 'ID 2 2', 'R 1 10', 'ID 1 2', 'R 1 8', 'ID 1 1', 'N 1 7', 'ID 3 3', 'N 1 6', 'ID 1 1'],
    L1: ['N 1 3', 'R 1 9', 'ID 2 2', 'N 1 12', 'N 1 9', 'N 1 9', 'ID 3 9', 'ID 3 3', 'AN 1 3', 'ID 1 1', 'ID 1 1', 'AN 2 25'],
  },
  SET: {
    753: ['BGN!', ['N1!'], 'LX!', ['N1!+', 'L11+', 'G62+', ['OID!+']]],
    754: ['BGN!', ['N1!+'], ['LX!+', 'L11+', 'BLR', 'OID+', 'G62+']],
    204: ['B2!', 'B2A!', 'L11+', ['N1+'], ['S5!+', 'G62+', ['N1']], 'L3'],
    214: ['B10!', 'L11+', ['N1+'], ['LX!+', ['AT7!+']]],
    210: ['B3!', 'N9+', 'G62+', ['N1+'], ['LX!+', 'L5', 'L0+', 'L1+'], 'L3'],
  },
};

export default {
  id: 'transport',
  docs,
  schema,
  masters: () => ({ freight_terms: FREIGHT_TERMS, carrier_rates: CARRIER_RATES }),
  generate,
  derive,
  finish,
  prev,
  origins: [], // every transport document is created from an order document or another transport document
  views: {
    // Ashby sees every transport record: its routing requests, its loads and Lakeline's milestones and invoices.
    ashby: [
      'INSERT INTO freight_terms SELECT * FROM m.freight_terms', 'INSERT INTO carrier_rates SELECT * FROM m.carrier_rates',
      'INSERT INTO routing_requests SELECT * FROM m.routing_requests WHERE po IN (SELECT po FROM orders)',
      'INSERT INTO loads SELECT * FROM m.loads WHERE po IN (SELECT po FROM orders)',
      'INSERT INTO shipment_status SELECT * FROM m.shipment_status WHERE load_id IN (SELECT load_id FROM loads)',
      'INSERT INTO freight_invoices SELECT * FROM m.freight_invoices WHERE load_id IN (SELECT load_id FROM loads)',
    ],
    // Northfield sees the routing it exchanged (753, 754) and its own collect terms; never Ashby's loads, Lakeline's
    // milestones or invoices, or Ashby's rate card (the 204, 214 and 210 are kept out of its documents in world/build.js).
    northfield: [
      "INSERT INTO freight_terms SELECT * FROM m.freight_terms WHERE terms = 'Collect'",
      'INSERT INTO routing_requests SELECT * FROM m.routing_requests',
    ],
  },
  staedi,
};
