// T1.16 Warehouse and receiving: Ashby's stock transfers into Kinross (943 out, 944 back) and the carton-level
// receiving discrepancies Northfield reported on its receiving advice (861).
//
// Borrowed:
// - NetSuite's transfer order chain. A transfer order is fulfilled (item fulfillment) and then received (item receipt);
//   the item receipt is created from the transfer order and names the item fulfillment it receives, and one transfer
//   order can be fulfilled more than once. "You can initialize an item receipt from a Purchase Order, a Return
//   Authorization, a Transfer Order, or an Intercompany Transfer Order"; "the returned itemFulfillment parameter
//   specifies the item fulfillment record associated with the transfer order".
//   https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3681685.html (opened 15 Nov 2026).
//   Here: Ashby's transfer order (TO-) is the NetSuite transfer order in Ashby's ERP; its item fulfillment travels to
//   Kinross as the 943 (shipment TSH-); Kinross's item receipt comes back as the 944 (receipt KR-), which names the
//   transfer order and the shipment (W1704, W1705), as the NetSuite item receipt names both.
// - Transfer status: NetSuite carries a status per transfer (pending receipt, received). The world keeps three:
//   In transit (943 sent, no 944 yet), Received, Received short (a 944 line below the 943 line).
// - X12 004010 structure for 943 and 944 from bots-grammars x12/4010 (943004010.py, 944004010.py). Element use from a
//   public 3PL mapping: W06-01 / W17-01 "F" full detail, N1 SF and ST on the 943, N1 WH on the 944, W27-01 "M" motor,
//   W17-04 the depositor order number from the 943, W14-01 quantity received:
//   https://www.infopluscommerce.com/knowledge-base/943-warehouse-stock-transfer-shipment-advice and
//   https://www.infopluscommerce.com/knowledge-base/944-warehouse-stock-transfer-receipt-advice (opened 15 Nov 2026).
//   W13-03 receiving condition codes (element 412: 01 damaged, 02 quantity short, 03 quantity over):
//   https://edi.stedi.com/edi/x12/element/412 (opened 15 Nov 2026). The same code list is RCD-08 on the 861.
// - Quantities, dates, transfer numbers and the 2-day Ashby-to-Kinross transit are Invented: no public source states
//   them for this relationship. Transfer lines are sized as one to three weeks of what the receiving Kinross site ships
//   of that item over the quarter on its 945s, so a transfer never dwarfs or vanishes against the site's own outflow.
//
// Dates. The 943 and 944 are Ashby and Kinross documents, so P10's window does not restrict them. Their interchange
// control numbers do: every Ashby-to-Kinross and Kinross-to-Ashby number rises with time, and the quarter's 940s and
// 945s (28 Sep to 28 Dec 2026) already hold that range. So transfers sit either before the first 940 (opening stock
// moved into Kinross in September, numbered below it like the world's history documents) or after the last 945
// (restocking at the turn of the year, numbered after it). Nothing existing is renumbered.
//
// Receiving discrepancies. One row per carton Northfield reported missing, damaged or over on an 861. Investigation
// (15 Nov 2026, world at 45e8ec8): every 861 shortage on an Ashby shipment names its missing cartons in MAN segments,
// one SSCC per short case, each an SSCC listed on the ship notice the 861 received against; none relies on the cartons
// table. The 861 shortages on other suppliers' shipments (47 lines) cannot name an SSCC: those ship notices carry no
// carton level at all (no MAN), and the 861s name none, so no row is made for them and the gate counts them apart.
import { seg, d8, t4, clean, n1, first, day8, iso8, parseX12 } from '../x12.js';
import { rng, et, etDay, addD, addH } from '../lib.js';
import { PARTY, ITEM, locations, locByGln } from '../ref.js';

const LOC = Object.fromEntries(locations.map((l) => [l.id, l]));
const ids = (l) => ['VN', l.sku, ...(l.gtin ? ['UK', l.gtin] : [])];
const lineItems = (e, from) => { const o = {}; for (let i = from; i + 1 < e.length; i += 2) { if (e[i] === 'VN') o.sku = e[i + 1]; if (e[i] === 'UK') o.gtin = e[i + 1]; } return o; };

/** 943: Ashby (depositor) tells Kinross what it has shipped into a Kinross site. */
const doc943 = {
  func: 'AR', name: 'Warehouse stock transfer shipment advice',
  body: (d) => [
    seg('W06', 'F', d.transfer_order, d8(d.at), d.shipment_id),
    seg('N1', 'SF', clean(d.from_name), 'UL', d.from_gln),
    seg('N1', 'ST', clean(d.to_name), 'UL', d.to_gln),
    seg('G62', '11', d8(d.shipped_at), 'W', t4(d.shipped_at)),
    seg('G62', '17', d8(d.expected_at)),
    seg('W27', 'M', d.scac),
    ...d.lines.flatMap((l) => [seg('W04', l.qty, 'CA', '', ...ids(l)), seg('N9', 'LI', l.line)]),
    seg('W03', d.lines.reduce((a, l) => a + l.qty, 0)),
  ],
  read: (S) => {
    const w = first(S, 'W06'); const g = first(S, 'G62', '11'); const lines = [];
    for (const e of S) { if (e[0] === 'W04') lines.push({ qty: +e[1], uom: e[2], ...lineItems(e, 4) }); if (e[0] === 'N9' && e[1] === 'LI') lines[lines.length - 1].line = +e[2]; }
    return { ref: w[2], po: null, transfer_order: w[2], shipment_id: w[4], parties: n1(S), shipped_at: iso8(g[2], g[4] + '00'), expected_at: day8(first(S, 'G62', '17')?.[2]), scac: first(S, 'W27')[2], lines, units: +first(S, 'W03')[1] };
  },
};

/** 944: Kinross tells Ashby what it received against a 943, with an exception line (W13) for each short line. */
const doc944 = {
  func: 'RE', name: 'Warehouse stock transfer receipt advice',
  body: (d) => [
    seg('W17', 'F', d8(d.at), d.receipt, d.transfer_order, d.shipment_id),
    seg('N1', 'WH', clean(d.to_name), 'UL', d.to_gln),
    seg('N1', 'SF', clean(d.from_name), 'UL', d.from_gln),
    ...d.lines.flatMap((l) => [seg('W07', l.received, 'CA', '', ...ids(l)), seg('N9', 'LI', l.line), ...(l.received < l.shipped ? [seg('W13', l.shipped - l.received, 'CA', '02')] : [])]),
    seg('W14', d.lines.reduce((a, l) => a + l.received, 0)),
  ],
  read: (S) => {
    const w = first(S, 'W17'); const lines = [];
    for (const e of S) {
      if (e[0] === 'W07') lines.push({ received: +e[1], uom: e[2], ...lineItems(e, 4), exceptions: [] });
      if (e[0] === 'N9' && e[1] === 'LI') lines[lines.length - 1].line = +e[2];
      if (e[0] === 'W13') lines[lines.length - 1].exceptions.push({ qty: +e[1], uom: e[2], condition: e[3] });
    }
    return { ref: w[3], po: null, receipt: w[3], received_on: day8(w[2]), transfer_order: w[4], shipment_id: w[5], parties: n1(S), lines, units: +first(S, 'W14')[1] };
  },
};

// The transfers. `before` transfers move opening stock into Kinross ahead of the quarter's first 940; `after` transfers
// restock at the turn of the year, after the quarter's last 945. One is still on the road when the world ends.
const PLAN = [
  { to: 'TO-6001', site: 'KIN-GRV', ship: ['2026-09-08', '14:30'], receive: ['2026-09-10', '09:40'], short: false },
  { to: 'TO-6002', site: 'KIN-JOL', ship: ['2026-09-09', '15:10'], receive: ['2026-09-11', '10:20'], short: true },
  { to: 'TO-6003', site: 'KIN-GRV', ship: ['2026-09-21', '14:00'], receive: ['2026-09-23', '09:15'], short: true },
  { to: 'TO-6004', site: 'KIN-JOL', ship: ['2026-09-22', '15:40'], receive: ['2026-09-24', '11:05'], short: false },
  { to: 'TO-6005', site: 'KIN-JOL', ship: ['2026-12-29', '14:20'], receive: ['2026-12-31', '10:30'], short: true },
  { to: 'TO-6006', site: 'KIN-GRV', ship: ['2026-12-30', '15:00'], receive: ['2027-01-04', '09:50'], short: false },
  { to: 'TO-6007', site: 'KIN-JOL', ship: ['2027-01-04', '16:10'], receive: null, short: false },
];
const FIRST_KINROSS = et('2026-09-28', '00:00'); // the quarter's first 940 is sent the evening of 28 Sep ET

function generate(L) {
  const R = rng(161600943);
  // Each Kinross site's 945 shipments per item over the quarter (13 weeks), read from the documents already in the log.
  const weekly = new Map();
  for (const d of L.docs) if (d.type === '945' && !d.test) { const site = locByGln[d.site_gln]?.id; for (const l of d.lines) weekly.set(`${site}|${l.sku}`, (weekly.get(`${site}|${l.sku}`) || 0) + l.shipped / 13); }
  const from = LOC['ASH-WH1'];
  PLAN.forEach((p) => {
    const site = LOC[p.site]; const shippedAt = et(...p.ship);
    const skus = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'].filter((s) => weekly.get(`${p.site}|${s}`));
    const lines = skus.map((sku, i) => ({ line: i + 1, sku, gtin: ITEM[sku].gtin, qty: Math.max(1, Math.round(weekly.get(`${p.site}|${sku}`) * (1 + 2 * R()))) }));
    const shortLine = p.short ? Math.floor(R() * lines.length) : -1; const shortQty = 2 + Math.floor(R() * 6);
    const n = p.to.slice(3); const hist = shippedAt < FIRST_KINROSS;
    const common = { transfer_order: p.to, shipment_id: `TSH-${n}`, from_name: from.name, from_gln: from.gln, to_name: site.name, to_gln: site.gln };
    const a = L.doc({ type: '943', from: 'ASHBY', to: 'KINROSS', at: addH(shippedAt, 0.25), ...common, shipped_at: shippedAt.toISOString(), expected_at: etDay(addD(shippedAt, 2)), scac: 'LKLF', lines });
    if (hist) a.hist = true; // numbered below the quarter's first Ashby-to-Kinross interchange, as the world's history documents are
    if (p.receive) {
      const b = L.doc({ type: '944', from: 'KINROSS', to: 'ASHBY', at: et(...p.receive), ...common, receipt: `KR-${n}`, lines: lines.map((l, i) => ({ ...l, shipped: l.qty, received: i === shortLine ? l.qty - shortQty : l.qty })) });
      if (hist) b.hist = true;
    }
  });
}

/** Rows from the documents as read back from X12. */
function derive(d, T, ctx) {
  for (const t of ['stock_transfers', 'transfer_lines']) T[t] ||= [];
  if (d.type === '943') {
    T.stock_transfers.push({ transfer_order: d.transfer_order, shipment_id: d.shipment_id, depositor_id: d.sender, warehouse_id: d.receiver, from_location: ctx.loc(d.parties.SF.gln), to_location: ctx.loc(d.parties.ST.gln), carrier_scac: d.scac,
      shipped_at: d.shipped_at, expected_on: d.expected_at, shipment_doc_id: d.doc_id, receipt: null, receipt_doc_id: null, received_at: null, status: 'In transit', qty_shipped: d.units, qty_received: null });
    for (const l of d.lines) T.transfer_lines.push({ transfer_order: d.transfer_order, line: l.line, sku: l.sku, uom: l.uom, qty_shipped: l.qty, qty_received: null, qty_short: null, condition_code: null });
  } else if (d.type === '944') {
    const t = T.stock_transfers.find((x) => x.transfer_order === d.transfer_order && x.shipment_id === d.shipment_id);
    if (!t) throw new Error(`944 ${d.ref} receives transfer ${d.transfer_order} ${d.shipment_id}, which no 943 shipped`);
    let short = false;
    for (const l of d.lines) {
      const r = T.transfer_lines.find((x) => x.transfer_order === t.transfer_order && x.line === l.line);
      if (!r) throw new Error(`944 ${d.ref} line ${l.line} is not on ${t.transfer_order}`);
      const ex = l.exceptions.find((e) => e.condition === '02');
      r.qty_received = l.received; r.qty_short = ex ? ex.qty : 0; r.condition_code = ex ? ex.condition : null; if (r.qty_short) short = true;
    }
    Object.assign(t, { receipt: d.receipt, receipt_doc_id: d.doc_id, received_at: d.at, status: short ? 'Received short' : 'Received', qty_received: d.units });
  }
}

/** Rows that need the whole set: Kinross stock moves by site, item and month, and the 861 carton discrepancies. */
function finish(T, ctx) {
  for (const t of ['stock_transfers', 'transfer_lines']) T[t] ||= [];
  const live = ctx.docs.filter((d) => !d.rejected && !d.test);
  // Kinross stock moves: what came in on 944s and went out on 945s, per site, item and Eastern month.
  const moves = new Map();
  const add = (site, sku, at, kind, qty) => { const k = `${site}|${sku}|${etDay(new Date(at)).slice(0, 7)}|${kind}`; const m = moves.get(k) || moves.set(k, { site, sku, month: etDay(new Date(at)).slice(0, 7), kind, qty: 0, documents: new Set(), first_at: at, last_at: at }).get(k); m.qty += qty; if (at < m.first_at) m.first_at = at; if (at > m.last_at) m.last_at = at; return m; };
  for (const d of live) {
    if (d.type === '945') for (const l of d.lines) if (l.shipped) add(ctx.loc(d.parties.WH.gln), l.sku, d.shipped_at, 'Shipped (945)', l.shipped).documents.add(d.doc_id);
    if (d.type === '944') for (const l of d.lines) add(ctx.loc(d.parties.WH.gln), l.sku, d.at, 'Transfer received (944)', l.received).documents.add(d.doc_id);
  }
  T.transfer_stock_moves = [...moves.values()].map((m) => ({ ...m, documents: m.documents.size })).sort((a, b) => `${a.site}${a.sku}${a.month}${a.kind}`.localeCompare(`${b.site}${b.sku}${b.month}${b.kind}`));

  // Receiving discrepancies: each carton an 861 reports, read from the 861 itself (RCD and MAN) and the ship notice
  // it received against (the latest 856 with that number on the order sent before it, as the document flow links it).
  const cartonsOf = new Map(); for (const c of T.cartons) (cartonsOf.get(c.shipment_id) || cartonsOf.set(c.shipment_id, []).get(c.shipment_id)).push(c);
  const asns = live.filter((d) => d.type === '856');
  const KIND = { '01': 'Damaged', '02': 'Short', '03': 'Over' };
  T.receiving_discrepancies = [];
  for (const d of live) {
    if (d.type !== '861') continue;
    const segs = parseX12(d.raw)[0].groups[0].sets[0].segs; const lines = [];
    for (const e of segs) { if (e[0] === 'RCD') lines.push({ line: +e[1], qty: +e[2], short: e[6] ? +e[6] : 0, condition: e[8] || null, sscc: [] }); if (e[0] === 'MAN' && e[1] === 'GM') lines[lines.length - 1].sscc.push(e[2]); }
    const asn = ctx.docs.filter((x) => x.type === '856' && x.po === d.po && x.ref === d.asn_ref && x.at <= d.at).pop();
    let n = 0;
    for (const l of lines) {
      if (!l.short && !l.sscc.length) continue;
      const own = (cartonsOf.get(d.asn_ref) || []).filter((c) => c.line === l.line);
      let named = own.filter((c) => l.sscc.includes(c.sscc)); let found = '861 MAN segment names the carton';
      if (!named.length && l.short) { named = own.filter((c) => !c.received); found = 'Cartons table: carton on the ship notice not received (received = 0)'; }
      // No SSCC from either source (other suppliers' ship notices list no cartons): no row; the gate counts these apart.
      if (!named.length || !asn || !asns.includes(asn)) continue;
      for (const c of named) {
        T.receiving_discrepancies.push({ discrepancy_id: `${d.ref}-${++n}`, receipt: d.ref, receipt_doc_id: d.doc_id, received_at: d.received_at, location: ctx.loc(d.parties.ST.gln), po: d.po, shipment_id: d.asn_ref, ship_notice_doc_id: asn.doc_id,
          sscc: c.sscc, line: l.line, sku: c.sku, qty_expected: c.qty, qty_received: 0, kind: l.condition === '02' ? 'Not scanned' : KIND[l.condition] || 'Not scanned', condition_code: l.condition, found_by: found });
      }
    }
  }
}

export default {
  id: 'warehouse',
  docs: { 943: doc943, 944: doc944 },
  // The transfer order lives in Ashby's ERP, not on the EDI wire, so the 943 is the first document of a transfer's flow:
  // an origin, created from the NetSuite transfer order that stock_transfers.transfer_order names.
  origins: ['943'],
  prev(d, ctx) {
    if (d.type !== '944') return [];
    const a = ctx.docs.filter((x) => x.type === '943' && x.ref === d.transfer_order && x.shipment_id === d.shipment_id && x.at <= d.at).pop();
    return a ? [{ doc: a, kind: 'receives transfer' }] : [];
  },
  schema: `
-- T1.16: Ashby's stock transfers into Kinross (943, 944) and Northfield's carton-level receiving discrepancies (861).
CREATE TABLE stock_transfers (transfer_order TEXT PRIMARY KEY, shipment_id TEXT NOT NULL UNIQUE, depositor_id TEXT NOT NULL REFERENCES parties(id), warehouse_id TEXT NOT NULL REFERENCES parties(id),
  from_location TEXT NOT NULL REFERENCES locations(id), to_location TEXT NOT NULL REFERENCES locations(id), carrier_scac TEXT, shipped_at TEXT NOT NULL, expected_on TEXT,
  shipment_doc_id TEXT NOT NULL REFERENCES documents(doc_id), receipt TEXT UNIQUE, receipt_doc_id TEXT REFERENCES documents(doc_id), received_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('In transit','Received','Received short')), qty_shipped INTEGER NOT NULL, qty_received INTEGER);
CREATE TABLE transfer_lines (transfer_order TEXT NOT NULL REFERENCES stock_transfers(transfer_order), line INTEGER NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), uom TEXT NOT NULL,
  qty_shipped INTEGER NOT NULL, qty_received INTEGER, qty_short INTEGER, condition_code TEXT, PRIMARY KEY (transfer_order, line));
CREATE TABLE transfer_stock_moves (site TEXT NOT NULL REFERENCES locations(id), sku TEXT NOT NULL REFERENCES items(sku), month TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Transfer received (944)','Shipped (945)')), qty INTEGER NOT NULL, documents INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (site, sku, month, kind));
CREATE TABLE receiving_discrepancies (discrepancy_id TEXT PRIMARY KEY, receipt TEXT NOT NULL, receipt_doc_id TEXT NOT NULL REFERENCES documents(doc_id), received_at TEXT NOT NULL, location TEXT REFERENCES locations(id),
  po TEXT NOT NULL REFERENCES orders(po), shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id), ship_notice_doc_id TEXT NOT NULL REFERENCES documents(doc_id), sscc TEXT NOT NULL,
  line INTEGER NOT NULL, sku TEXT REFERENCES items(sku), qty_expected INTEGER NOT NULL, qty_received INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('Not scanned','Short','Over','Damaged')),
  condition_code TEXT, found_by TEXT NOT NULL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
`,
  generate,
  derive,
  finish,
  views: {
    // Ashby: its transfers, its warehouse's stock moves, and the discrepancies on its own orders.
    ashby: [
      'INSERT INTO stock_transfers SELECT * FROM m.stock_transfers WHERE depositor_id = \'ASHBY\'',
      'INSERT INTO transfer_lines SELECT * FROM m.transfer_lines WHERE transfer_order IN (SELECT transfer_order FROM stock_transfers)',
      'INSERT INTO transfer_stock_moves SELECT * FROM m.transfer_stock_moves',
      'INSERT INTO receiving_discrepancies SELECT * FROM m.receiving_discrepancies WHERE po IN (SELECT po FROM orders)',
    ],
    // Northfield: its own receiving discrepancies (every supplier's 861 data). Never Ashby's transfers: the 943, 944 and
    // their 997s, and any flow link to them, are taken out of the copy the core view made.
    northfield: [
      'INSERT INTO receiving_discrepancies SELECT * FROM m.receiving_discrepancies',
      "DELETE FROM document_links WHERE doc_id IN (SELECT doc_id FROM documents WHERE doc_type IN ('943','944') OR answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type IN ('943','944'))) OR prev_doc_id IN (SELECT doc_id FROM documents WHERE doc_type IN ('943','944'))",
      "DELETE FROM documents WHERE answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type IN ('943','944'))",
      "DELETE FROM documents WHERE doc_type IN ('943','944')",
    ],
  },
  staedi: {
    SEG: {
      W27: ['ID 1 2!', 'ID 2 4'],
      W04: ['R 1 10!', 'ID 2 2!', 'AN 12 12', 'ID 2 2', 'AN 1 48', 'ID 2 2', 'AN 1 48'],
      N9: ['ID 2 3!', 'AN 1 30', 'AN 1 45'],
      W17: ['ID 1 1!', 'DT 8 8!', 'AN 1 12!', 'AN 1 22', 'AN 1 30'],
      W07: ['R 1 7!', 'ID 2 2!', 'AN 12 12', 'ID 2 2', 'AN 1 48', 'ID 2 2', 'AN 1 48'],
      W13: ['R 1 15!', 'ID 2 2!', 'ID 2 2!', 'AN 1 12', 'ID 2 2'],
      W14: ['R 1 7!'],
    },
    SET: {
      943: ['W06!', ['N1!+'], 'G62+', 'W27!', ['W04!+', 'N9+'], 'W03!'],
      944: ['W17!', ['N1!+'], ['W07!+', 'N9+', ['W13+']], 'W14!'],
    },
  },
};
