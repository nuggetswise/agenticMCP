// T1.12 Catalogue as evidence: Ashby's item and price catalogue to Northfield, the GS1 packaging hierarchy behind it,
// item maintenance when an item version changes, price information for a dated cost change, and Northfield's decision
// on each. A pack, case-label GTIN or price question is then settled from the catalogue in force on the ship date.
//
// Borrowed (pages opened 15 Nov 2026):
//  - SAP table MARM, units of measure per material: one row per unit with its own EAN (EAN11), conversion to the base
//    unit (UMREZ/UMREN), the lower-level unit (MESUB), length, width, height (LAENG, BREIT, HOEHE, MEABM) and gross
//    weight (BRGEW, GEWEI). `packaging_levels` is MARM with GS1 level names and dates. https://leanx.eu/en/sap/table/marm.html
//  - GS1 hierarchy (each, inner, case, pallet; a GTIN per level): GS1 Global Data Model
//    https://www.gs1.org/standards/gs1-global-data-model-attribute-implementation-guide/14 and GS1 Sweden on trade item
//    hierarchies https://gs1.se/en/support/what-are-trade-item-hierarchies-and-trade-item-levels-2/ (both cited in
//    docs/phase1/world-model.md).
//  - GS1 GDSN Package Measurement Rules 3.2: height from the natural base to the top, width the shorter side of the
//    natural base, depth (length) the longer side, for cases and unit loads alike (5.2, 5.7).
//    https://www.gs1.org/docs/gdsn/3.1/GDSN_Package_Measurement_Rules.pdf
//  - Kohl's Consumer Package Dimensions (a retailer's public item-setup page): one decimal place, gross weight includes
//    the packaging. https://link.kohls.com/content/dam/klink/pdfs/Kohls_Consumer_Package_Dimensions.pdf
//  - CVS 4010 832 item setup guide (retailer, public): BCT01 PC price catalogue, header DTM*007 effective date, LIN UK
//    shipping container GTIN-14, PO4 pack, CTP price. https://www.cvssuppliers.com/content/dam/enterprise/cvs-suppliers/plan-documents/topics/CVS-4010-832-IMS-IB-2026-V1.pdf
//  - Dot Foods 888 item maintenance guide (distributor, public): G53 001 change / 003 add, G62*09 process date, G39 with
//    UK GTIN-14, gross weight in pounds, height, width and length in inches, volume in cubic feet, G3916 pallet block and
//    tiers (3 digits cases per layer, 3 digits layers), G3917 pack, G3923/24 VN vendor item.
//    https://www.dotfoods.com/globalassets/corporate/pdfs/customer-edi/distributor-888-item-maintenance.pdf
//  - Dot Foods 879 price information (G91 B original price change, G62*88 first ship date, G28, G20 pack, G40 bracket
//    price) https://www.dotfoods.com/globalassets/corporate/pdfs/customer-edi/distributor-879-price.pdf and Walmart's
//    879 (G62*87 first order date, G40 G4002 new cost with G4007 unit) https://developer.walmart.com/suppliers/docs/879-price-information-advice
//
// Every dimension, weight, TI/HI, inner pack, the 1 February 2027 cost change and the honey case change are invented
// for this world and marked Invented in the EDI Review Pack (registry/catalogue-pack.json, `catalogue`).
//
// Dates and control numbers. Interchange control numbers rise with time per sender and receiver, and every existing
// document keeps its number (world-diff). Between Ashby and Northfield the history range starts on 29 March 2026 and
// the current range ends on 28 December 2026, so a stage document can only sit before the first or after the last:
//  - the catalogue (832) goes on 23 February 2026, in the history range, before anything else between the two;
//  - item maintenance (888) and price information (879) go on 29 December 2026, after the quarter closes, Ashby's
//    quarterly catalogue maintenance. Both are far from P10's window (18 October to 17 November 2026).
// Item setup changes inside the quarter (AHP-8820 on 27 September and 23 to 24 November) travel on Trading Grid item
// setup, not EDI, and are recorded as events; the 888 then brings Ashby's EDI catalogue in line.
import { et } from '../lib.js';
import { gs1Check } from '../lib.js';
import { seg, d8, t4, day8, money, clean, n1, first } from '../x12.js';
import { PARTY, ITEM, HISTORY_START } from '../ref.js';

const NF = PARTY.NORTHFIELD, ASH = PARTY.ASHBY;
const gtin = (indicator, itemRef) => { const b = `${indicator}0614141${itemRef}`; return b + gs1Check(b); };
const r1 = (x) => Math.round(x * 10) / 10;
const PALLET = { length: 48, width: 40, deck_height: 5.5, weight: 45 }; // a 48 x 40 in wood pallet. Invented.

// Packaging codes (X12 element 103) say which GS1 level a G39 describes. Northfield's guide (invented) fixes the map.
export const LEVEL_OF_CODE = { PKG: 'Each', BOX: 'Inner', CTN: 'Case', PLT: 'Pallet' };
const CODE_OF_LEVEL = { Each: 'PKG', Inner: 'BOX', Case: 'CTN25', Pallet: 'PLT94' };

// One spec per item: [length, width, height (in), gross weight (lb)] per level, quantity of the level below, pallet TI x HI.
// Indicator digits: 0 the each (GTIN-12 written as GTIN-14), 1 the case (items.gtin, unchanged), 3 the inner, 5 the
// pallet; 2 and 6 an alternative case and its pallet. The indicator carries no meaning in GS1; it only keeps GTINs apart.
const C = (indicator, from, to, qty, dims, extra = {}) => ({ indicator, valid_from: from, valid_to: to, qty, dims, ...extra });
const SPEC = [
  { sku: 'ASH-MUG-12', ref: '00012', each: [5.3, 4.0, 4.4, 1.1], inner: [4, [10.9, 8.3, 4.7, 4.8]], cases: [C(1, HISTORY_START, null, 3, [11.2, 8.6, 14.4, 14.9], { ti: 18, hi: 4 })] },
  { sku: 'ASH-NAP-4', ref: '00013', each: [8.5, 6.0, 1.6, 0.9], inner: [6, [12.4, 8.7, 5.0, 5.6]], cases: [C(1, HISTORY_START, null, 4, [17.6, 12.7, 10.3, 22.9], { ti: 8, hi: 5 })] },
  // Honey moves from a case of 12 to a shelf-ready case of 6 from 1 February 2027 (888 of 29 December 2026). A new
  // quantity takes a new GTIN (GS1 GTIN Management Standard), so the case of 6 has its own.
  { sku: 'ASH-HNY-340', ref: '00014', each: [3.1, 3.1, 4.9, 1.3], cases: [C(1, HISTORY_START, '2027-02-01', 12, [12.6, 9.5, 5.3, 16.3], { ti: 14, hi: 8 }), C(2, '2027-02-01', null, 6, [9.5, 6.4, 5.3, 8.2], { ti: 28, hi: 8 })] },
  { sku: 'ASH-TRL-09', ref: '00016', each: [13.0, 8.1, 4.9, 2.2], cases: [C(1, HISTORY_START, null, 1, [13.6, 8.6, 5.4, 2.6], { ti: 14, hi: 10 })], note: 'Pack "Pair": one pair in its shoebox ships in a single-pair shipper' },
  { sku: 'ASH-MUG-16', ref: '00017', each: [5.8, 4.4, 5.0, 1.4], inner: [4, [11.9, 9.1, 5.3, 6.0]], cases: [C(1, HISTORY_START, null, 3, [12.2, 9.4, 16.2, 18.6], { ti: 15, hi: 3 })] },
  // AHP-8820: Northfield requires a case of 6 from 27 September (item version 1). Ashby's NetSuite item held a case of
  // 12 (AHP-8820-C12) until the trade-test correction on 23 November 2026 (event test.correction); that case had its own GTIN.
  { sku: 'AHP-8820', ref: '00018', from: '2026-09-27', each: [9.4, 7.6, 10.5, 3.4], cases: [C(1, '2026-09-27', null, 6, [23.4, 15.6, 11.2, 22.0], { ti: 5, hi: 5 }), C(2, '2026-09-27', '2026-11-23', 12, [23.4, 15.6, 21.6, 43.1], { pallet: false })] },
  // P25's shirt, published to Northfield on 11 January 2027 (world/stages/item-accuracy.js). A case of 12 folded shirts
  // in the solid-size carton a public apparel guide sets as standard (21.5 x 15.5 x 12.5 in, DXL Group vendor manual,
  // p. 6); the each, the weights and the pallet are Invented.
  { sku: 'ASH-SHT-M', ref: '00019', from: '2027-01-11', each: [14.0, 10.0, 1.5, 0.7], cases: [C(1, '2027-01-11', null, 12, [21.5, 15.5, 12.5, 10.0], { ti: 4, hi: 5 })] },
  { sku: 'ASH-SHT-L', ref: '00020', from: '2027-01-11', each: [14.0, 10.0, 1.5, 0.7], cases: [C(1, '2027-01-11', null, 12, [21.5, 15.5, 12.5, 10.0], { ti: 4, hi: 5 })] },
  { sku: 'BRK-TWL-2', ref: '00401', each: [11.0, 8.0, 4.2, 1.9], cases: [C(1, HISTORY_START, null, 12, [22.4, 16.4, 12.8, 23.8], { ti: 5, hi: 4 })] },
  { sku: 'CDP-CND-8', ref: '00501', each: [3.6, 3.6, 4.1, 0.9], inner: [6, [11.2, 7.5, 4.4, 5.8]], cases: [C(1, HISTORY_START, null, 4, [15.4, 11.6, 9.0, 23.9], { ti: 10, hi: 6 })] },
];

/** The packaging hierarchy master: one row per GTIN (SAP MARM, GS1 trade item hierarchy). */
export function packagingLevels() {
  const rows = [];
  const row = (s, level, g, child, qty, units, [length, width, height, weight], from, to, o = {}) => rows.push({ gtin: g, sku: s.sku, supplier_id: ITEM[s.sku].supplier_id, level, child_gtin: child, child_qty: qty, units, length, width, height, dim_uom: 'IN', gross_weight: weight, weight_uom: 'LB', pallet_ti: o.ti ?? null, pallet_hi: o.hi ?? null, packaging_code: CODE_OF_LEVEL[level], valid_from: from, valid_to: to, basis: 'Invented', note: o.note ?? null });
  const from0 = s0 => s0.from || HISTORY_START;
  for (const s of SPEC) {
    const each = gtin(0, s.ref); row(s, 'Each', each, null, null, 1, s.each, from0(s), null, { note: s.note });
    let inner = null; if (s.inner) { inner = gtin(3, s.ref); row(s, 'Inner', inner, each, s.inner[0], s.inner[0], s.inner[1], from0(s), null); }
    for (const c of s.cases) {
      const caseG = gtin(c.indicator, s.ref); const units = (s.inner ? s.inner[0] : 1) * c.qty;
      row(s, 'Case', caseG, inner || each, c.qty, units, c.dims, c.valid_from, c.valid_to);
      if (c.pallet === false) continue;
      const [, , h, w] = c.dims;
      row(s, 'Pallet', gtin(c.indicator + 4, s.ref), caseG, c.ti * c.hi, units * c.ti * c.hi, [PALLET.length, PALLET.width, r1(c.hi * h + PALLET.deck_height), r1(c.ti * c.hi * w + PALLET.weight)], c.valid_from, c.valid_to, { ti: c.ti, hi: c.hi });
    }
  }
  return rows;
}
const LEVELS = packagingLevels();
const levelsOf = (sku, at) => LEVELS.filter((l) => l.sku === sku && l.valid_from <= at && (l.valid_to == null || l.valid_to > at));
const caseOf = (sku, at) => levelsOf(sku, at).find((l) => l.level === 'Case');

// ---------- the messages ----------
const CATALOGUE = 'CAT-ASH-2026-01'; // the 832
const MAINTENANCE = 'IM-ASH-2026-12-29'; // the 888
const PRICE_LIST = 'PL-ASH-2027-02'; // the 879
const AT = { catalogue: et('2026-02-23', '14:00'), accepted832: '2026-02-27T15:00:00.000Z', maintenance: et('2026-12-29', '10:00'), prices: et('2026-12-29', '10:30'), decided888: et('2026-12-30', '10:00'), decided879: et('2026-12-30', '10:30') };
const CHANGE_FROM = '2027-02-01'; // honey case of 6 and the new costs: first ship / first order date, outside the world's period
const ASHBY_CATALOGUE = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340', 'ASH-MUG-16', 'ASH-TRL-09'];
const NEW_COST = { 'ASH-MUG-12': 55.62, 'ASH-HNY-340': 23.4 }; // a 3% cost increase; honey's case of 6 at the same unit cost. Invented.

/** Later item versions and prices (T1.11 holds version 1 and one price per item). typed.js closes the row before each. */
export function dated() {
  return {
    item_versions: [
      { sku: 'AHP-8820', version: 2, valid_from: '2026-11-24', valid_to: null, description: ITEM['AHP-8820'].description, pack: 'Case of 6', units_per_case: 6, accepted_by: 'NORTHFIELD', accepted_at: et('2026-11-24', '15:00').toISOString() },
      { sku: 'ASH-HNY-340', version: 2, valid_from: CHANGE_FROM, valid_to: null, description: ITEM['ASH-HNY-340'].description, pack: 'Case of 6', units_per_case: 6, accepted_by: 'NORTHFIELD', accepted_at: AT.decided888.toISOString() },
    ],
    item_prices: Object.entries(NEW_COST).map(([sku, amount]) => ({ sku, price_list: 'Northfield cost', uom: 'CA', amount, valid_from: CHANGE_FROM, valid_to: null, source: `Price information ${PRICE_LIST}` })),
  };
}

const g39 = (l) => { const e = Array(28).fill(''); e[1] = 'UK'; e[2] = l.gtin; e[4] = l.gross_weight; e[5] = 'G'; e[6] = 'L'; e[7] = l.height; e[8] = 'IN'; e[9] = l.width; e[10] = 'IN'; e[11] = l.length; e[12] = 'IN';
  e[13] = money(l.length * l.width * l.height / 1728); e[14] = 'CF'; if (l.level === 'Pallet') e[15] = `${String(l.pallet_ti).padStart(3, '0')}${String(l.pallet_hi).padStart(3, '0')}`; if (l.child_qty) e[16] = l.child_qty; e[22] = 'VN'; e[23] = l.sku; e[27] = l.packaging_code; return seg('G39', ...e); };
const readG39 = (e) => ({ gtin: e[3], gross_weight: +e[5], height: +e[8], width: +e[10], length: +e[12], pallet_ti: e[16] ? +e[16].slice(0, 3) : null, pallet_hi: e[16] ? +e[16].slice(3) : null, child_qty: e[17] ? +e[17] : null, sku: e[24], level: LEVEL_OF_CODE[String(e[28]).slice(0, 3)] });
const parties = (d) => [seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln), seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln)];
const levelsFor = (sku, at) => { const ls = levelsOf(sku, at); const order = ['Each', 'Inner', 'Case', 'Pallet']; return ls.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level)); };

const DOCS = {
  // 832 Price/Sales Catalog: header BCT, effective date, parties; per item LIN (VN, UK case GTIN, UP consumer UPC), PID,
  // PO4 (pack, inner pack), CTP cost with its own effective DTM, and one G39 per packaging level.
  832: { func: 'SC', name: 'Price and item catalogue',
    body: (d) => [seg('BCT', 'PC', d.ref, '', '', '', '', '', '', '', '00'), seg('DTM', '007', d8(d.effective)), ...parties(d),
      // CM and SM: NRF colour and size codes (P25, 26 November 2026).
      ...d.items.flatMap((it) => [seg('LIN', it.line, 'VN', it.sku, 'UK', it.gtin, 'UP', it.upc, ...(it.nrf ? ['CM', it.nrf.colour, 'SM', it.nrf.size] : [])), seg('PID', 'F', '', '', '', clean(it.description)),
        seg('PO4', it.pack, 1, it.uom, '', '', '', '', '', '', '', '', '', '', it.inner || ''), seg('CTP', '', 'INV', money(it.cost), '', 'CA'), seg('DTM', '007', d8(it.cost_from)), ...it.levels.map(g39)]),
      seg('CTT', d.items.length)],
    read: (S) => { const items = []; let cur = null; let inLin = false;
      for (const e of S) { if (e[0] === 'LIN') { cur = { line: +e[1], sku: e[3], gtin: e[5], upc: e[7], levels: [], ...(e[8] === 'CM' ? { nrf: { colour: e[9], size: e[11] } } : {}) }; items.push(cur); inLin = true; }
        else if (!inLin) continue; else if (e[0] === 'PID') cur.description = e[5]; else if (e[0] === 'PO4') Object.assign(cur, { pack: +e[1], uom: e[3], inner: e[14] ? +e[14] : null }); else if (e[0] === 'CTP') cur.cost = +e[3]; else if (e[0] === 'DTM' && e[1] === '007') cur.cost_from = day8(e[2]); else if (e[0] === 'G39') cur.levels.push(readG39(e)); }
      return { ref: first(S, 'BCT')[2], po: null, effective: day8(first(S, 'DTM', '007')[2]), parties: n1(S), items }; } },
  // 888 Item Maintenance: BGN, parties, N9 naming the catalogue it updates, process date; per item G53 (003 add, 001
  // change), G62*88 first ship date, a note, and the full hierarchy as G39s.
  888: { func: 'QG', name: 'Item maintenance',
    body: (d) => [seg('BGN', '00', d.ref, d8(d.at), t4(d.at)), ...parties(d), seg('N9', 'ZZ', d.catalogue, 'Catalogue updated'), seg('G62', '09', d8(d.at)),
      ...d.items.flatMap((it) => [seg('G53', it.action), seg('G62', '88', d8(it.first_ship)), seg('NTE', 'GEN', clean(it.note).slice(0, 80)), ...it.levels.map(g39)])],
    read: (S) => { const items = []; let cur = null;
      for (const e of S) { if (e[0] === 'G53') { cur = { action: e[1], levels: [] }; items.push(cur); } else if (!cur) continue; else if (e[0] === 'G62' && e[1] === '88') cur.first_ship = day8(e[2]); else if (e[0] === 'NTE') cur.note = e[2]; else if (e[0] === 'G39') { const l = readG39(e); cur.levels.push(l); cur.sku = l.sku; } }
      return { ref: first(S, 'BGN')[2], po: null, catalogue: first(S, 'N9', 'ZZ')[2], parties: n1(S), items }; } },
  // 879 Price Information: G91 B (original price change), parties, N9 naming the catalogue it reprices, G36 price list,
  // process date; per item G28 (UK case GTIN, VN item), G20 pack, G62*87 first order date, G40 new cost per case.
  879: { func: 'QG', name: 'Price information',
    body: (d) => [seg('G91', 'B'), ...parties(d), seg('N9', 'ZZ', d.catalogue, 'Catalogue repriced'), seg('G36', d.ref, '', d8(d.at)), seg('G62', '09', d8(d.at)),
      ...d.items.flatMap((it) => [seg('G28', '', '', 'UK', it.gtin, 'VN', it.sku), seg('G20', it.pack, 1, 'EA'), seg('G62', '87', d8(it.first_order)), seg('G40', '', money(it.cost), '', '', '', '', 'CA')])],
    read: (S) => { const items = []; let cur = null;
      for (const e of S) { if (e[0] === 'G28') { cur = { gtin: e[4], sku: e[6] }; items.push(cur); } else if (!cur) continue; else if (e[0] === 'G20') cur.pack = +e[1]; else if (e[0] === 'G62' && e[1] === '87') cur.first_order = day8(e[2]); else if (e[0] === 'G40') { cur.cost = +e[2]; cur.uom = e[7]; } }
      return { ref: first(S, 'G36')[1], po: null, catalogue: first(S, 'N9', 'ZZ')[2], parties: n1(S), items }; } },
};

const itemLine = (sku, at, line) => { const it = ITEM[sku]; const c = caseOf(sku, at); const each = levelsOf(sku, at).find((l) => l.level === 'Each'); const inner = levelsOf(sku, at).find((l) => l.level === 'Inner');
  return { line, sku, gtin: c.gtin, upc: each.gtin.slice(2), description: it.description, pack: c.child_qty, inner: inner ? inner.child_qty : null, uom: /pair/i.test(it.pack) ? 'PR' : 'EA', cost: it.case_price, cost_from: HISTORY_START, levels: levelsFor(sku, at) }; };
const ev = (L, at, kind, party, system, data) => L.event({ at, kind, po: null, system, party, channel: 'Trading Grid', data });
/** One catalogue (832) item line for an item, its cost in force from `costFrom`. Used by a later stage that publishes items. */
export const catalogueLine = (sku, at, line, costFrom = HISTORY_START) => ({ ...itemLine(sku, at, line), cost_from: costFrom });

function generate(L) {
  const head = { from: 'ASHBY', to: 'NORTHFIELD', vendor_name: ASH.name, vendor_gln: ASH.gln, buyer_name: NF.name, buyer_gln: NF.gln };
  // The catalogue at the start of the history period. `hist` numbers it in the history range (see the header comment).
  L.doc({ ...head, type: '832', at: AT.catalogue, hist: true, ref: CATALOGUE, effective: HISTORY_START, items: ASHBY_CATALOGUE.map((sku, i) => itemLine(sku, HISTORY_START, i + 1)) });
  ev(L, AT.accepted832, 'catalogue.decision', 'NORTHFIELD', 'Northfield item setup', { message: CATALOGUE, doc_type: '832', lines: ASHBY_CATALOGUE.map((sku) => ITEM[sku].on_northfield_list
    ? { sku, decision: 'Accepted', item_version: 1 } : { sku, decision: 'Not accepted', reason: 'Not on Northfield’s item list for Ashby (NF-4.11)' }) });
  // AHP-8820 on Trading Grid item setup. Ashby submits its NetSuite case of 12; Northfield requires a case of 6.
  const c12 = LEVELS.find((l) => l.sku === 'AHP-8820' && l.level === 'Case' && l.child_qty === 12);
  ev(L, et('2026-09-27', '11:45'), 'catalogue.item_submitted', 'ASHBY', 'Trading Grid item setup', { message: 'TGS-AHP-8820-1', sku: 'AHP-8820', case_gtin: c12.gtin, units_per_case: 12, cost: 144, effective: '2026-09-27', source: 'NetSuite item AHP-8820, case configuration AHP-8820-C12' });
  ev(L, et('2026-09-27', '12:30'), 'catalogue.decision', 'NORTHFIELD', 'Northfield item setup', { message: 'TGS-AHP-8820-1', lines: [{ sku: 'AHP-8820', decision: 'Returned', reason: 'Case of 6 required by Northfield (NF-4.9); a case of 12 is not set up' }] });
  ev(L, et('2026-11-23', '10:50'), 'catalogue.item_submitted', 'ASHBY', 'Trading Grid item setup', { message: 'TGS-AHP-8820-2', sku: 'AHP-8820', case_gtin: ITEM['AHP-8820'].gtin, units_per_case: 6, cost: ITEM['AHP-8820'].case_price, effective: '2026-11-24', source: 'NetSuite item AHP-8820 after the correction to AHP-8820-C6' });
  ev(L, et('2026-11-24', '15:00'), 'catalogue.decision', 'NORTHFIELD', 'Northfield item setup', { message: 'TGS-AHP-8820-2', lines: [{ sku: 'AHP-8820', decision: 'Accepted', item_version: 2, reason: 'Trade tests passed; programme activated for item AHP-8820' }] });
  // After the quarter: item maintenance and price information.
  L.doc({ ...head, type: '888', at: AT.maintenance, ref: MAINTENANCE, catalogue: CATALOGUE, items: [
    { sku: 'AHP-8820', action: '003', first_ship: '2026-11-24', note: 'Add AHP-8820 case of 6 as accepted on Trading Grid item setup 24 Nov 2026', levels: levelsFor('AHP-8820', '2026-11-24') },
    { sku: 'ASH-HNY-340', action: '001', first_ship: CHANGE_FROM, note: 'Case of 12 replaced by shelf-ready case of 6 with a new case GTIN', levels: levelsFor('ASH-HNY-340', CHANGE_FROM) }] });
  L.doc({ ...head, type: '879', at: AT.prices, ref: PRICE_LIST, catalogue: CATALOGUE, items: Object.entries(NEW_COST).map(([sku, cost]) => { const c = caseOf(sku, CHANGE_FROM); return { sku, gtin: c.gtin, pack: c.units, cost, first_order: CHANGE_FROM }; }) });
  ev(L, AT.decided888, 'catalogue.decision', 'NORTHFIELD', 'Northfield item setup', { message: MAINTENANCE, doc_type: '888', lines: [{ sku: 'AHP-8820', decision: 'Accepted', item_version: 2, reason: 'Matches item version 2, accepted 24 Nov 2026' }, { sku: 'ASH-HNY-340', decision: 'Accepted', item_version: 2 }] });
  ev(L, AT.decided879, 'catalogue.decision', 'NORTHFIELD', 'Northfield item setup', { message: PRICE_LIST, doc_type: '879', lines: Object.keys(NEW_COST).map((sku) => ({ sku, decision: 'Accepted' })) });
}

// ---------- typed rows ----------
const decisionsFrom = (events) => { const m = new Map(); for (const e of events) if (e.kind === 'catalogue.decision') for (const l of e.data.lines) m.set(`${e.data.message}|${l.sku}`, { ...l, at: e.at, event_id: e.id }); return m; };
function message(T, ctx, o) {
  ctx._dec ??= decisionsFrom(ctx.events);
  const dec = ctx._dec.get(`${o.message}|${o.sku}`);
  (T.item_setup_messages ??= []).push({ ...o, status: dec ? dec.decision : 'Awaiting Northfield', decided_by: dec ? 'NORTHFIELD' : null, decided_at: dec ? dec.at : null, item_version: dec?.item_version ?? null, reason: dec?.reason ?? null, decision_event_id: dec?.event_id ?? null });
}
function derive(d, T, ctx) {
  const base = { message: d.ref, doc_id: d.doc_id, channel: `EDI ${d.type}`, supplier_id: d.sender, sent_at: d.at };
  if (d.type === '832') for (const it of d.items) {
    const c = it.levels.find((l) => l.level === 'Case');
    message(T, ctx, { ...base, sku: it.sku, action: 'Catalogue', effective_from: it.cost_from, case_gtin: it.gtin, units_per_case: c ? unitsIn(it.levels, c) : null, cost: it.cost });
  }
  if (d.type === '888') for (const it of d.items) { const c = it.levels.find((l) => l.level === 'Case'); message(T, ctx, { ...base, sku: it.sku, action: it.action === '003' ? 'Add' : it.action === '001' ? 'Change' : it.action, effective_from: it.first_ship, case_gtin: c?.gtin ?? null, units_per_case: c ? unitsIn(it.levels, c) : null, cost: null }); }
  if (d.type === '879') for (const it of d.items) message(T, ctx, { ...base, sku: it.sku, action: 'Price change', effective_from: it.first_order, case_gtin: it.gtin, units_per_case: it.pack, cost: it.cost });
}
const unitsIn = (levels, l) => { let n = 1, x = l; while (x && x.level !== 'Each') { n *= x.child_qty; const i = levels.indexOf(x); x = levels[i - 1]; } return n; };
function finish(T, ctx) {
  // Item setup on Trading Grid (no EDI document): Ashby's submissions and Northfield's decisions, read from the events.
  for (const e of ctx.events) if (e.kind === 'catalogue.item_submitted') message(T, ctx, { message: e.data.message, doc_id: null, channel: 'Trading Grid item setup', supplier_id: e.party, sent_at: e.at, sku: e.data.sku, action: 'Add', effective_from: e.data.effective, case_gtin: e.data.case_gtin, units_per_case: e.data.units_per_case, cost: e.data.cost });
  T.item_setup_messages?.sort((a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : a.sku.localeCompare(b.sku)));
}

// ---------- settling a question from the catalogue in force ----------
const inForce = (table, key, at) => `SELECT * FROM ${table} WHERE ${key} AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC`;
/** NF-4.9 and the case label: is each ship notice line's case GTIN the case Northfield set up for the item version in
 * force, with the same units per case? Read as of the ship date unless `asOf` is given (to show what another version decides). */
export function settlePack(db, shipmentId, asOf = null) {
  const s = db.prepare('SELECT s.shipment_id, s.shipped_at, d.body FROM shipments s JOIN documents d ON d.doc_id = s.doc_id WHERE s.shipment_id = ?').get(shipmentId);
  if (!s) return { found: false, shipment: shipmentId };
  const at = asOf || s.shipped_at; const charge = db.prepare("SELECT charge FROM rules WHERE id = 'NF-4.9'").get()?.charge;
  const lines = JSON.parse(s.body).lines.map((l) => {
    const v = db.prepare(inForce('item_versions', 'sku = ?')).get(l.sku, at, at);
    const lvl = l.gtin ? db.prepare('SELECT * FROM packaging_levels WHERE gtin = ?').get(l.gtin) : null;
    const lvlInForce = lvl && lvl.valid_from <= at && (lvl.valid_to == null || lvl.valid_to > at);
    const out = { line: l.line, sku: l.sku, gtin: l.gtin, item_version: v?.version ?? null, units_per_case_set_up: v?.units_per_case ?? null, gtin_level: lvl?.level ?? null, units_in_gtin: lvl?.units ?? null, gtin_in_force: !!lvlInForce };
    if (!v) return { ...out, decision: 'No item version in force', rule: 'NF-4.11', charge: null };
    if (!v.accepted_by || v.accepted_at > at) return { ...out, decision: 'Held: the item version in force was not accepted by Northfield', rule: 'NF-4.11', charge: null };
    if (!lvl || lvl.sku !== l.sku || lvl.level !== 'Case' || !lvlInForce || lvl.units !== v.units_per_case) return { ...out, decision: 'Charge', rule: 'NF-4.9', charge };
    return { ...out, decision: 'No charge', rule: 'NF-4.9', charge: null };
  });
  const worst = lines.find((l) => l.decision === 'Charge') || lines.find((l) => l.decision !== 'No charge') || lines[0];
  return { found: true, shipment: s.shipment_id, shipped_at: s.shipped_at, as_of: at, decision: worst.decision, rule: worst.rule, charge: worst.charge, lines };
}
/** A price question: is the invoice line's price the catalogue cost in force on the ship date, within NF-7.11's tolerance
 * in force on the same date? */
export function settlePrice(db, invoice, line, asOf = null) {
  const r = db.prepare('SELECT i.invoice, i.sent_at, i.po, l.line, l.price, o.sku FROM invoices i JOIN invoice_lines l ON l.invoice = i.invoice JOIN order_lines o ON o.po = l.po AND o.line = l.line WHERE i.invoice = ? AND l.line = ?').get(invoice, line);
  if (!r) return { found: false, invoice, line };
  const ship = db.prepare('SELECT max(shipped_at) t FROM shipments WHERE po = ? AND shipped_at <= ?').get(r.po, r.sent_at).t;
  const at = asOf || ship || r.sent_at;
  const p = db.prepare(inForce('item_prices', "sku = ? AND price_list = 'Northfield cost'")).get(r.sku, at, at);
  const rv = db.prepare(inForce('rule_versions', "rule_id = 'NF-7.11'")).get(at, at); const tol = JSON.parse(rv.params).tolerance;
  const variance = p ? Math.abs(r.price - p.amount) / p.amount : null;
  const ok = p && variance <= tol;
  return { found: true, invoice, line, sku: r.sku, price: r.price, shipped_at: ship, as_of: at, catalogue_cost: p?.amount ?? null, price_source: p?.source ?? null, tolerance: tol, variance: variance == null ? null : Math.round(variance * 10000) / 10000,
    decision: !p ? 'No catalogue cost in force' : ok ? 'Matches the catalogue cost in force' : 'Held: beyond the NF-7.11 tolerance of the catalogue cost in force', rule: 'NF-7.11' };
}

export default {
  id: 'catalogue',
  docs: DOCS,
  // The catalogue starts the item flow: it answers no document, as an ERPNext Item Price or an SAP condition record is
  // master data that later documents point at, not a document created from another.
  origins: ['832'],
  schema: `
-- GS1 packaging hierarchy per item (SAP MARM: a unit per row with its own EAN, lower-level unit, dimensions, gross weight).
CREATE TABLE packaging_levels (gtin TEXT PRIMARY KEY, sku TEXT NOT NULL REFERENCES items(sku), supplier_id TEXT NOT NULL REFERENCES parties(id),
  level TEXT NOT NULL CHECK (level IN ('Each','Inner','Case','Pallet')), child_gtin TEXT REFERENCES packaging_levels(gtin), child_qty INTEGER, units INTEGER NOT NULL,
  length REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, dim_uom TEXT NOT NULL, gross_weight REAL NOT NULL, weight_uom TEXT NOT NULL,
  pallet_ti INTEGER, pallet_hi INTEGER, packaging_code TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, basis TEXT NOT NULL, note TEXT);
CREATE INDEX ix_pack_sku ON packaging_levels(sku, level, valid_from);
-- Each catalogue message line (832, 888, 879, or Trading Grid item setup) with Northfield's decision on it.
CREATE TABLE item_setup_messages (message TEXT NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), doc_id TEXT REFERENCES documents(doc_id), channel TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES parties(id), sent_at TEXT NOT NULL, action TEXT NOT NULL, effective_from TEXT NOT NULL, case_gtin TEXT, units_per_case INTEGER, cost REAL,
  status TEXT NOT NULL, decided_by TEXT REFERENCES parties(id), decided_at TEXT, item_version INTEGER, reason TEXT, decision_event_id INTEGER REFERENCES events(id),
  PRIMARY KEY (message, sku), FOREIGN KEY (sku, item_version) REFERENCES item_versions(sku, version));`,
  masters: () => ({ packaging_levels: LEVELS }),
  dated,
  generate,
  derive,
  finish,
  // 888 names the catalogue it updates (N9*ZZ), else the latest earlier catalogue or maintenance from the same sender;
  // 879 names the catalogue it reprices.
  prev(d, ctx) {
    if (d.type === '832') return [];
    const named = ctx.byRef.get(`832:${d.catalogue}:${d.sender}`)?.find((x) => x.at <= d.at);
    if (named) return [{ doc: named, kind: d.type === '888' ? 'updates catalogue' : 'reprices catalogue' }];
    const before = ctx.docs.filter((x) => (x.type === '832' || x.type === '888') && x.sender === d.sender && x.at < d.at).pop();
    return before ? [{ doc: before, kind: 'updates catalogue' }] : [];
  },
  views: {
    ashby: ['INSERT INTO packaging_levels SELECT * FROM m.packaging_levels WHERE supplier_id = \'ASHBY\'', 'INSERT INTO item_setup_messages SELECT * FROM m.item_setup_messages WHERE supplier_id = \'ASHBY\''],
    northfield: ['INSERT INTO packaging_levels SELECT * FROM m.packaging_levels', 'INSERT INTO item_setup_messages SELECT * FROM m.item_setup_messages'],
  },
  staedi: {
    SEG: {
      BCT: ['ID 2 2!', 'AN 1 15', 'AN 1 15', 'AN 1 6', 'ID 2 2', 'AN 1 15', 'AN 1 15', 'AN 1 6', 'AN 1 80', 'ID 2 2'],
      PID: ['ID 1 1!', 'ID 2 3', 'ID 2 2', 'AN 1 12', 'AN 1 80'],
      PO4: ['N 1 6', 'R 1 8', 'ID 2 2', 'AN 3 5', 'ID 1 2', 'R 1 9', 'ID 2 2', 'R 1 9', 'ID 2 2', 'R 1 8', 'R 1 8', 'R 1 8', 'ID 2 2', 'N 1 6'],
      CTP: ['ID 2 2', 'ID 3 3', 'R 1 17', 'R 1 15', 'ID 2 2'],
      G39: ['AN 12 12', 'ID 2 2', 'AN 1 48', 'ID 2 3', 'R 1 8', 'ID 1 2', 'ID 1 1', 'R 1 8', 'ID 2 2', 'R 1 8', 'ID 2 2', 'R 1 8', 'ID 2 2', 'R 1 8', 'ID 2 2', 'N 6 6', 'N 1 6', 'R 1 8', 'ID 2 2', 'AN 1 10', 'R 1 10', 'ID 1 3', 'ID 2 2', 'AN 1 48', 'ID 1 2', 'R 1 8', 'N 1 6', 'AN 3 5'],
      G53: ['ID 3 3!'],
      N9: ['ID 2 3!', 'AN 1 30', 'AN 1 45'],
      G91: ['ID 1 1!'],
      G36: ['AN 1 16!', 'AN 1 16', 'DT 8 8!'],
      G28: ['AN 12 12', 'AN 12 12', 'ID 2 2', 'AN 1 48', 'ID 2 2', 'AN 1 48'],
      G20: ['N 1 6', 'R 1 8', 'ID 2 2'],
      G40: ['ID 1 3', 'R 1 9!', 'R 1 9', 'AN 1 45', 'N 2 7', 'N 2 7', 'ID 2 2', 'ID 3 3', 'R 1 9'],
    },
    SET: {
      832: ['BCT!', 'DTM+', ['N1+'], ['LIN!+', 'PID+', 'PO4', ['CTP+', 'DTM+'], ['G39+']], 'CTT'],
      888: ['BGN!', ['N1!+'], 'N9+', 'G62!', ['G53!+', 'G62+', 'NTE+', 'G39!+']],
      879: ['G91!', ['N1!+'], 'N9+', 'G36', 'G62!+', ['G28!+', 'G20', 'G62+', 'G40+']],
    },
  },
};
