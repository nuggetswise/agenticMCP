// T1.14 Planning, inventory and order status: 830 planning schedule, 846 inventory advice, 870 order status report.
//
// What was borrowed, and from where (each page opened on 15 Nov 2026):
// - Forecast versions: SAP planned independent requirements keep a version per material and plant with an "active"
//   indicator (PBIM VERSB, VERVS: https://leanx.eu/en/sap/table/pbim.html). Here every 830 is one version in
//   `forecasts`; the one in force is Current, the ones it replaced are Superseded, with valid_from and valid_to
//   (exclusive, null open) so a check reads the forecast in force at an order's date, as T1.11 reads prices.
// - Stock by site and item: ERPNext keeps actual, reserved and projected quantity per item and warehouse
//   (https://docs.frappe.io/erpnext/user/manual/en/projected-quantity). `stock_positions` keeps what each source
//   reported, by site, item and time: Kinross's 846, Kinross's inventory read, and Ashby's ERP reads.
// - 830 layout: CVS 830 4010 (https://www.cvssuppliers.com/content/dam/enterprise/cvs-suppliers/plan-documents/topics/CVS-4010-830-2026-V1.2.pdf):
//   BFR05 A (actual discrete quantities), FST02 D (planning), FST03 F (flexible interval, FST04 to FST05).
//   Kroger/Fred Meyer forecast programme (https://edi.kroger.com/EDIPortal/ProgramAndRequirements/Fredmeyer/PR_Forecast.html):
//   a forecast by week, at most 52 weeks, and "not a request for delivery": purchase orders remain the only request.
// - 870 layout: Target 870 4010 (https://edi.jobisez.com/edi-igs/Target/e_ceg870xxx.pdf): BSR01 3 (unsolicited),
//   BSR02 PP (selected orders, selected items), order HL with PRF and N1 ST, item HL with PO1, ISR CP ("partial shipment
//   on date, considered no backorder") and QTY01 01 with the quantity that will ship. Northfield's NF-2.1 (no
//   backorders: the short remainder is cancelled) is the same rule.
// - 846 layout: BIA01 00 and QTY01 17 (quantity on hand) as in CDW's 846 4010
//   (https://webobjects.cdw.com/webobjects/media/pdf/e-procurement/downloads/846_I_4010.pdf) and Walmart's 846
//   (https://ecgrid.freshdesk.com/support/solutions/articles/6000285035-wamart-846-inventory-inquiry-advice). Invented
//   for this world: BIA02 MM, QTY01 33 (available) and one QTY loop per pick wave with DTM 007 giving its time, so the
//   stock at each pick can be read back; no public 3PL guide states those values.
//
// Who exchanges what: Northfield sends Ashby the 830 and Ashby answers at-risk orders with an 870. Kinross, a 3PL,
// reports its client Ashby's stock on an 846. Round plan, 26 November 2026 (EDI first): Ashby sends Northfield its own
// daily 846 per 3PL site (guide R30), the inventory record P4 and P8 read; Kinross's inventory read at Groveport on
// 8 December (P5) also travels as an 846, at the same minute and with the same figures.
import { rng, et, addH, etDay } from '../lib.js';
import { PARTY, ITEM, locations } from '../ref.js';
import { seg, d8, t4, money, clean, itemIds, first, n1, items as idsOf, day8 } from '../x12.js';

const H = 3600000;
const LOC = Object.fromEntries(locations.map((l) => [l.id, l]));
const LOC_BY_GLN = Object.fromEntries(locations.map((l) => [l.gln, l]));
const CORE = ['ASH-MUG-12', 'ASH-NAP-4', 'ASH-HNY-340'];
const ymd = (s) => s.replace(/-/g, '');
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Northfield weeks run Sunday to Saturday (ref.js QUARTER). */
export const weekOf = (date) => { const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)); return dayStr(t - new Date(t).getUTCDay() * 86400000); };
const plusDays = (date, n) => dayStr(Date.parse(`${date}T00:00:00Z`) + n * 86400000);

/** Kinross picks a truck's order three hours before departure (the wms.short_pick records sit at departure less 3 h). */
export const PICK_LEAD_H = 3;

// Northfield's planning calendar: 4-5-4 periods aligned to its quarters (ref.js QUARTER starts Sunday 27 September).
// The history quarter (29 March to 27 June) and the current quarter. Masters before transactions.
const PERIODS = [
  ['2026-Q1-P1', '2026-03-29', '2026-04-26'], ['2026-Q1-P2', '2026-04-26', '2026-05-31'], ['2026-Q1-P3', '2026-05-31', '2026-06-28'],
  ['2026-Q3-P1', '2026-09-27', '2026-10-25'], ['2026-Q3-P2', '2026-10-25', '2026-11-29'], ['2026-Q3-P3', '2026-11-29', '2026-12-27'],
];

// 830 cadence: Northfield issues a planning schedule at the start of each period, early Sunday morning Eastern.
// The 25 October period start falls inside P10's window (18 Oct 11:00 ET to 17 Nov 11:00 ET), where no stage document
// between Ashby and Northfield may sit, so the 27 September schedule stays in force through it. Northfield then issues
// a revision on Thursday 19 November, after the window closes and after P13's moment on 18 November, so P10's
// 30-day count (3,412 documents with their 997s) does not move. The build refuses any 830 inside the window.
const ISSUES = [
  { day: '2026-03-29', hm: '06:00', period: '2026-Q1-P1' }, { day: '2026-04-26', hm: '06:00', period: '2026-Q1-P2' }, { day: '2026-05-31', hm: '06:00', period: '2026-Q1-P3' },
  { day: '2026-09-27', hm: '06:00', period: '2026-Q3-P1' },
  { day: '2026-11-19', hm: '07:00', period: '2026-Q3-P2', revision: true },
  { day: '2026-11-29', hm: '06:00', period: '2026-Q3-P3' },
];
const HORIZON_WEEKS = 13; // Kroger allows up to 52; a quarter is 13 Northfield weeks
// Interchange control numbers: stage documents and their 997s take numbers from the stage range in world/log.js emit
// (coordinator's change on main), so an 830, 846 or 870 dated between existing interchanges renumbers none of them.
const PEAK = new Set(['2026-11-29', '2026-12-06', '2026-12-13']); // Northfield's December peak weeks

const isReplen = (d) => d.type === '850' && d.from === 'NORTHFIELD' && d.to === 'ASHBY' && /^NR-\d{5}$/.test(d.po) && !['STORE', 'DSD'].includes(d.programme);

// ---------- writers and readers ----------
const docs = {
  830: {
    func: 'PS', name: 'Planning schedule',
    body: (d) => {
      const out = [
        seg('BFR', d.purpose, d.ref, '', 'DL', 'A', ymd(d.horizon_start), ymd(d.horizon_end), d8(d.at)),
        seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln),
        seg('N1', 'SU', clean(d.vendor_name), 'UL', d.vendor_gln),
      ];
      for (const l of d.lines) {
        out.push(seg('LIN', l.line, ...itemIds(l)), seg('UIT', 'CA'), seg('N1', 'ST', clean(l.loc_name), 'UL', l.loc_gln));
        for (const w of l.weeks) out.push(seg('FST', w.qty, 'D', 'F', ymd(w.start), ymd(w.end)));
      }
      out.push(seg('CTT', d.lines.length, d.lines.reduce((a, l) => a + l.weeks.reduce((b, w) => b + w.qty, 0), 0)));
      return out;
    },
    read: (S) => {
      const b = first(S, 'BFR'); const lines = []; let hdr = true; const parties = {};
      for (const e of S) {
        if (e[0] === 'LIN') { hdr = false; lines.push({ line: +e[1], ...idsOf(e, 2), loc_gln: null, weeks: [] }); }
        else if (e[0] === 'N1') { if (hdr) parties[e[1]] = { name: e[2], gln: e[4] }; else lines[lines.length - 1].loc_gln = e[4]; }
        else if (e[0] === 'FST') lines[lines.length - 1].weeks.push({ qty: +e[1], start: day8(e[4]), end: day8(e[5]) });
      }
      return { ref: b[2], po: null, purpose: b[1], schedule_type: b[4], horizon_start: day8(b[6]), horizon_end: day8(b[7]), created: day8(b[8]), parties, lines };
    },
  },
  846: {
    func: 'IB', name: 'Inventory advice',
    body: (d) => {
      const out = [seg('BIA', '00', 'MM', d.ref, d8(d.at), t4(d.at)), seg('N1', 'WH', clean(d.site_name), 'UL', d.site_gln), seg('N1', 'SE', clean(d.client_name), 'UL', d.client_gln)];
      d.items.forEach((it, i) => {
        out.push(seg('LIN', i + 1, 'VN', it.sku, 'UK', it.gtin));
        for (const w of it.waves) out.push(seg('QTY', '33', w.available, 'CA'), seg('DTM', '007', d8(w.at), t4(w.at)));
        out.push(seg('QTY', '17', it.on_hand, 'CA'), seg('DTM', '007', d8(d.as_of), t4(d.as_of)), seg('QTY', '33', it.available, 'CA'), seg('DTM', '007', d8(d.as_of), t4(d.as_of)));
        // Cases held back for damage replacement, reported apart from the cases available to orders (QTY01 QH, quantity on hold).
        if (it.held != null) out.push(seg('QTY', 'QH', it.held, 'CA'), seg('DTM', '007', d8(d.as_of), t4(d.as_of)));
      });
      out.push(seg('CTT', d.items.length));
      return out;
    },
    read: (S) => {
      const b = first(S, 'BIA'); const parties = n1(S); const its = []; let q = null;
      for (const e of S) {
        if (e[0] === 'LIN') its.push({ ...idsOf(e, 2), readings: [] });
        else if (e[0] === 'QTY') { q = { code: e[1], qty: +e[2], uom: e[3] || null, at: null }; its[its.length - 1].readings.push(q); }
        else if (e[0] === 'DTM' && q) q.at = `${day8(e[2])}T${e[3].slice(0, 2)}:${e[3].slice(2, 4)}:00.000Z`;
      }
      return { ref: b[3], po: null, report_type: b[2], parties, items: its };
    },
  },
  // 947 (round plan, 26 November 2026, EDI first): Kinross's damage scan reaches Ashby as a warehouse inventory adjustment
  // advice, one adjustment per damaged carton. Invented for this world: W1901 07 (damaged) and the carton's SSCC in N9 LS.
  947: {
    func: 'AW', name: 'Warehouse inventory adjustment advice',
    body: (d) => [seg('W15', d8(d.at), d.ref), seg('N1', 'WH', clean(d.site_name), 'UL', d.site_gln), seg('N1', 'SE', clean(d.client_name), 'UL', d.client_gln),
      ...d.items.flatMap((it, i) => [seg('LX', i + 1), seg('W19', '07', -it.cases, 'CA', '', 'VN', it.sku), seg('N9', 'LS', it.sscc), seg('N9', 'PO', d.po)])],
    read: (S) => { const w = first(S, 'W15'); const its = []; for (const e of S) { if (e[0] === 'W19') its.push({ reason: e[1], cases: -Number(e[2]), sku: e[6] }); else if (e[0] === 'N9' && e[1] === 'LS' && its.length) its[its.length - 1].sscc = e[2]; }
      const po = (S.find((e) => e[0] === 'N9' && e[1] === 'PO') || [])[2] || null; return { ref: w[2], po, parties: n1(S), items: its }; },
  },
  870: {
    func: 'RS', name: 'Order status report',
    body: (d) => {
      const out = [seg('BSR', '3', 'PP', d.ref, d8(d.at)), seg('HL', 1, '', 'O'), seg('PRF', d.po), seg('N1', 'ST', clean(d.ship_to_name), 'UL', d.ship_to_gln)];
      let h = 1;
      for (const l of d.lines) { h++; out.push(seg('HL', h, 1, 'I'), seg('PO1', l.line, l.qty, 'CA', money(l.price), 'PE', ...itemIds(l)), seg('ISR', l.status, ymd(l.status_date)), seg('QTY', '01', l.qty_ship, 'CA')); }
      out.push(seg('CTT', h));
      return out;
    },
    read: (S) => {
      const b = first(S, 'BSR'); const lines = [];
      for (const e of S) {
        if (e[0] === 'PO1') lines.push({ line: +e[1], qty: +e[2], price: +e[4], ...idsOf(e, 6) });
        else if (e[0] === 'ISR') Object.assign(lines[lines.length - 1], { status: e[1], status_date: day8(e[2]) });
        else if (e[0] === 'QTY' && e[1] === '01') lines[lines.length - 1].qty_ship = +e[2];
      }
      return { ref: b[3], po: first(S, 'PRF')[1], report_date: day8(b[4]), parties: n1(S), lines };
    },
  },
};

// ---------- the stock ledger behind Kinross's 846 ----------
/**
 * Kinross's stock of each Ashby item at each site, rebuilt from records already in the world, never the reverse:
 *  - every pick: the 945's shipped quantity. Since 18 November 2026 each 945 reports what Kinross picked and loaded, the
 *    same figure as its pick record (wms.short_pick), Ashby's allocation (erp.allocation), the load scan and the ship notice.
 *  - a short pick means the stock at that wave was exactly what was picked;
 *  - Kinross's inventory read on 8 December (590 ASH-MUG-12 at Groveport, P5) is the stock at that minute.
 * Inbound stock is invented: receipts at Kinross's two dock slots (12:00 and 17:30 UTC), sized just in time to hold a
 * small buffer and to land exactly on each recorded figure. Write-downs are counted, and are expected to be none.
 */
export function stockLedger(allDocs, events) {
  const docs = allDocs.filter((d) => !d.test);
  const short = new Map(); const alloc = new Map(); const pins = [];
  for (const e of events) {
    if (e.kind === 'wms.short_pick') short.set(`${e.po}|${e.data.sku}`, e.data.picked);
    if (e.kind === 'erp.allocation') alloc.set(e.po, e.data.allocated);
    if (e.kind === 'wms.inventory') { const site = locations.find((l) => l.name === e.data.site)?.id; pins.push({ key: `${site}|${e.data.sku}`, t: Date.parse(e.at), X: e.data.available, level: true }); }
  }
  const groups = new Map(); const picks = [];
  for (const d of docs) {
    if (d.type !== '945' || d.from !== 'KINROSS' || d.no_ledger) continue; // no_ledger: 945s added 26 November 2026 for cartons only
    const site = LOC_BY_GLN[d.site_gln].id; const t = Math.floor(Date.parse(d.shipped_at) / 60000) * 60000 - PICK_LEAD_H * H; // minute precision, as the 945's G62 carries it
    for (const l of d.lines) {
      const sp = short.get(`${d.po}|${l.sku}`); const q = sp ?? (alloc.has(d.po) && d.lines.length === 1 ? alloc.get(d.po) : l.shipped);
      picks.push({ site, sku: l.sku, po: d.po, t, q, reported: l.shipped, short: sp != null });
      const key = `${site}|${l.sku}`; const g = (groups.get(key) || groups.set(key, new Map()).get(key));
      const x = g.get(t) || g.set(t, { t, q: 0, pin: false, pos: [] }).get(t); x.q += q; x.pos.push(d.po); if (sp != null) x.pin = true;
    }
  }
  const startDay = dayStr(Math.min(...picks.map((p) => p.t))); const endDay = dayStr(Math.max(...picks.map((p) => p.t)));
  const slots = []; for (let day = startDay; day <= endDay; day = plusDays(day, 1)) slots.push(Date.parse(`${day}T12:00:00Z`), Date.parse(`${day}T17:30:00Z`));
  const stats = { receipts: 0, received: 0, writeDowns: 0, lateReceipts: 0 };
  const waves = []; const receipts = []; const levelAt = new Map(); // key -> [{t, level}] after each movement
  for (const [key, g] of [...groups.entries()].sort()) {
    const outs = [...g.values()].sort((a, b) => a.t - b.t);
    const keyPins = [...outs.filter((o) => o.pin).map((o) => ({ t: o.t, X: o.q })), ...pins.filter((p) => p.key === key)].sort((a, b) => a.t - b.t);
    const days = (Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`)) / 86400000 + 1;
    const B = Math.round((outs.reduce((a, o) => a + o.q, 0) / days) * 1.5); // buffer: a day and a half of picks
    const sumOut = (a, b) => outs.reduce((s, o) => (o.t > a && o.t < b ? s + o.q : s), 0);
    const timeline = [...slots.map((t) => ({ t, slot: true })), ...keyPins.filter((p) => p.X != null && !outs.some((o) => o.t === p.t)).map((p) => ({ t: p.t, levelPin: p })), ...outs.map((o) => ({ t: o.t, out: o }))]
      .sort((a, b) => a.t - b.t || (a.slot ? -1 : b.slot ? 1 : a.levelPin ? -1 : 1));
    let L = 0; const hist = [{ t: slots[0] - 1, level: 0 }];
    const receive = (t, r, late = false) => { if (!r) return; if (r < 0) stats.writeDowns++; else { stats.receipts++; stats.received += r; if (late) stats.lateReceipts++; } L += r; receipts.push({ key, t, qty: r }); hist.push({ t, level: L }); };
    for (let i = 0; i < timeline.length; i++) {
      const e = timeline[i];
      if (e.slot) {
        const p = keyPins.find((x) => x.t > e.t); const s2 = timeline.slice(i + 1).find((x) => x.slot)?.t ?? Infinity;
        const maxR = p ? p.X + sumOut(e.t, p.t) - L : Infinity;
        let r;
        if (p && s2 >= p.t) r = maxR; // last dock slot before a recorded figure: land on it exactly
        else r = Math.max(0, Math.min(sumOut(e.t, s2) + B - L, maxR));
        receive(e.t, r);
      } else if (e.levelPin) {
        if (L !== e.levelPin.X) receive(e.t - 15 * 60000, e.levelPin.X - L, true);
      } else {
        const o = e.out;
        if (o.pin && L !== o.q) receive(o.t - 15 * 60000, o.q - L, true);
        else if (L < o.q) receive(o.t - 15 * 60000, o.q - L, true);
        waves.push({ key, site: key.split('|')[0], sku: key.split('|')[1], t: o.t, available: L, picked: o.q, pos: o.pos, short: o.pin });
        L -= o.q; hist.push({ t: o.t, level: L });
      }
    }
    levelAt.set(key, hist);
  }
  for (const h of levelAt.values()) h.sort((a, b) => a.t - b.t);
  const level = (key, t) => { const h = levelAt.get(key) || []; let v = 0; for (const x of h) { if (x.t <= t) v = x.level; else break; } return v; };
  return { waves, receipts, picks, level, keys: [...groups.keys()].sort(), startDay, endDay, stats };
}

// ---------- the stage ----------
const linkCache = new WeakMap();

export default {
  id: 'planning',
  docs,
  // Forecast versions (SAP PBIM VERSB and VERVS), stock by site and item (ERPNext Bin), order status history.
  schema: `
CREATE TABLE planning_periods (id TEXT PRIMARY KEY, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL, owner TEXT NOT NULL REFERENCES parties(id), note TEXT);
CREATE TABLE forecasts (forecast_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(doc_id), period TEXT NOT NULL REFERENCES planning_periods(id), issued_by TEXT NOT NULL REFERENCES parties(id), issued_to TEXT NOT NULL REFERENCES parties(id),
  issued_at TEXT NOT NULL, purpose TEXT NOT NULL, horizon_start TEXT NOT NULL, horizon_end TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, status TEXT NOT NULL, supersedes TEXT REFERENCES forecasts(forecast_id), superseded_by TEXT REFERENCES forecasts(forecast_id));
CREATE TABLE forecast_lines (forecast_id TEXT NOT NULL REFERENCES forecasts(forecast_id), sku TEXT NOT NULL REFERENCES items(sku), location TEXT NOT NULL REFERENCES locations(id), week_start TEXT NOT NULL, week_end TEXT NOT NULL, qty INTEGER NOT NULL, uom TEXT NOT NULL,
  PRIMARY KEY (forecast_id, sku, location, week_start));
CREATE TABLE stock_positions (site TEXT NOT NULL REFERENCES locations(id), sku TEXT NOT NULL REFERENCES items(sku), as_of TEXT NOT NULL, kind TEXT NOT NULL, on_hand INTEGER, committed INTEGER, available INTEGER, unit TEXT NOT NULL,
  reported_by TEXT NOT NULL REFERENCES parties(id), source TEXT NOT NULL, doc_id TEXT REFERENCES documents(doc_id), event_id INTEGER REFERENCES events(id));
CREATE TABLE order_status (po TEXT NOT NULL REFERENCES orders(po), line INTEGER NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), reported_at TEXT NOT NULL, status_code TEXT NOT NULL, status TEXT NOT NULL, status_date TEXT,
  qty_ordered INTEGER NOT NULL, qty_to_ship INTEGER NOT NULL, qty_cancelled INTEGER NOT NULL, doc_id TEXT NOT NULL REFERENCES documents(doc_id), state TEXT NOT NULL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
`,
  masters: () => ({ planning_periods: PERIODS.map(([id, from, to]) => ({ id, valid_from: from, valid_to: to, owner: 'NORTHFIELD', note: 'Northfield 4-5-4 planning period, Sunday to Saturday weeks. Invented.' })) }),

  generate(L, { P10_WINDOW }) {
    const R = rng(20261114); const doc = (x) => L.doc(x);
    const all = L.docs.filter((d) => !d.test);
    const NF = PARTY.NORTHFIELD, ASH = PARTY.ASHBY, KIN = PARTY.KINROSS;
    const inWindow = (t) => t > P10_WINDOW.start && t <= P10_WINDOW.end;

    // ---- 830: forecasts consistent with the replenishment orders Northfield actually placed ----
    // Northfield's plan per item, DC and delivery week is the cases it went on to order, with an error that grows with
    // the lead time (5% at the current week, 2 points more per week out); plans made before 29 November under-call the
    // December peak by a quarter, which the 29 November schedule corrects. Invented.
    const actual = new Map();
    for (const d of all) if (isReplen(d)) { const loc = LOC_BY_GLN[d.ship_to_gln]?.id; const wk = weekOf(d.requested_delivery); for (const l of d.lines) { const k = `${l.sku}|${loc}|${wk}`; actual.set(k, (actual.get(k) || 0) + l.qty); } }
    let prevRef = null;
    for (const is of ISSUES) {
      const at = et(is.day, is.hm); if (inWindow(at.getTime())) throw new Error(`830 of ${is.day} falls in P10's window`);
      const w0 = weekOf(is.day); const lines = []; let ln = 0;
      for (const sku of CORE) for (const loc of ['DC2', 'DC4']) {
        const weeks = [];
        for (let k = 0; k < HORIZON_WEEKS; k++) {
          const wk = plusDays(w0, 7 * k); const base = actual.get(`${sku}|${loc}|${wk}`) || 0; const e = (R() * 2 - 1) * (0.05 + 0.02 * k);
          if (!base) continue;
          const peak = PEAK.has(wk) && is.day < '2026-11-29' ? 0.75 : 1;
          weeks.push({ start: wk, end: plusDays(wk, 6), qty: Math.max(1, Math.round(base * peak * (1 + e))) });
        }
        if (weeks.length) lines.push({ line: ++ln, sku, nf_item: ITEM[sku].northfield_item, gtin: ITEM[sku].gtin, loc_name: LOC[loc].name, loc_gln: LOC[loc].gln, weeks });
      }
      const ref = `FC-${ymd(is.day)}`;
      doc({ type: '830', from: 'NORTHFIELD', to: 'ASHBY', at, ref, purpose: prevRef ? '05' : '00', horizon_start: w0, horizon_end: plusDays(w0, 7 * HORIZON_WEEKS - 1), buyer_name: NF.name, buyer_gln: NF.gln, vendor_name: ASH.name, vendor_gln: ASH.gln, lines });
      prevRef = ref;
    }

    // ---- 846: Kinross's daily inventory advice to Ashby, one per site, after the last pick wave (23:30 UTC) ----
    const led = stockLedger(L.docs, L.events);
    for (const site of ['KIN-GRV', 'KIN-JOL']) {
      const keys = led.keys.filter((k) => k.startsWith(`${site}|`));
      for (let day = led.startDay; day <= led.endDay; day = plusDays(day, 1)) {
        const asOf = Date.parse(`${day}T23:30:00Z`); const from = asOf - 24 * H;
        // 17 November 2026 (P5): Kinross holds 2 cases of ASH-MUG-12 back at Groveport for damage replacement, outside the
        // cases free for orders, and reports them apart. One replaces NR-460207's crushed carton at 17:46 ET on 8 December.
        const heldOf = (k) => (k === 'KIN-GRV|ASH-MUG-12' ? (asOf >= Date.parse('2026-12-08T22:46:00Z') ? 1 : 2) : null);
        const its = keys.map((k) => { const sku = k.split('|')[1]; const lv = led.level(k, asOf); const held = heldOf(k); return { sku, gtin: ITEM[sku].gtin, on_hand: lv + (held || 0), available: lv, ...(held != null ? { held } : {}), waves: led.waves.filter((w) => w.key === k && w.t > from && w.t <= asOf).map((w) => ({ at: new Date(w.t).toISOString(), available: w.available })) }; });
        doc({ type: '846', from: 'KINROSS', to: 'ASHBY', at: new Date(asOf + 10 * 60000), as_of: new Date(asOf).toISOString(), ref: `IA-${site.slice(4)}-${ymd(day)}`, site_name: LOC[site].name, site_gln: LOC[site].gln, client_name: ASH.name, client_gln: ASH.gln, items: its });        // Ashby's own 846 to Northfield, 15 minutes later: on hand and available per item, without pick waves or held stock.
        doc({ type: '846', from: 'ASHBY', to: 'NORTHFIELD', at: new Date(asOf + 25 * 60000), as_of: new Date(asOf).toISOString(), ref: `IA-ASH-${site.slice(4)}-${ymd(day)}`, site_name: LOC[site].name, site_gln: LOC[site].gln, client_name: ASH.name, client_gln: ASH.gln, items: its.map(({ held, waves, ...x }) => ({ ...x, on_hand: x.available, waves: [] })) });
      }
      // Kinross's intraday inventory reads (P5, 8 December) travel as an 846 at the same minute, from the same ledger.
      for (const e of L.events.filter((x) => x.kind === 'wms.inventory' && locations.find((l) => l.name === x.data.site)?.id === site)) {
        const asOf = Date.parse(e.at); const k = `${site}|${e.data.sku}`; const lv = led.level(k, asOf); const held = e.data.held_for_damage_replacement ?? null;
        doc({ type: '846', from: 'KINROSS', to: 'ASHBY', at: new Date(asOf), as_of: new Date(asOf).toISOString(), ref: `IA-${site.slice(4)}-${ymd(etDay(new Date(asOf)))}-${new Date(asOf).toISOString().slice(11, 16).replace(':', '')}`, site_name: LOC[site].name, site_gln: LOC[site].gln, client_name: ASH.name, client_gln: ASH.gln, items: [{ sku: e.data.sku, gtin: ITEM[e.data.sku].gtin, on_hand: lv + (held || 0), available: lv, ...(held != null ? { held } : {}), waves: [] }] });
      }
    }

    // ---- 870: Ashby reports each order at risk to Northfield ----
    // At risk: a Kinross short pick (sent 25 minutes after the pick, before the truck leaves) or an allocation cut in
    // Ashby's ERP (sent 30 minutes after the allocation). Every one falls outside P10's window: the short picks are
    // 29 Sep to 15 Oct and 21 to 25 Nov, the allocations 8 to 10 Dec.
    const po850 = new Map(); for (const d of all) if (d.type === '850') po850.set(d.po, d);
    const wh945 = new Map(); for (const d of all) if (d.type === '945') wh945.set(d.po, d);
    for (const e of L.events) {
      if (e.kind !== 'wms.short_pick' && e.kind !== 'erp.allocation') continue;
      const o = po850.get(e.po); const w = wh945.get(e.po); const ol = o.lines.find((l) => l.line === e.data.line);
      const at = new Date(Date.parse(e.at) + (e.kind === 'wms.short_pick' ? 25 : 30) * 60000);
      if (inWindow(at.getTime())) continue;
      const qtyShip = e.kind === 'wms.short_pick' ? e.data.picked : e.data.allocated;
      doc({ type: '870', from: 'ASHBY', to: 'NORTHFIELD', at, ref: `OSR-${e.po.slice(3)}`, po: e.po, ship_to_name: o.ship_to_name, ship_to_gln: o.ship_to_gln,
        lines: [{ line: ol.line, qty: ol.qty, price: ol.price, nf_item: ol.nf_item, sku: ol.sku, gtin: ol.gtin, status: 'CP', status_date: etDay(new Date(w.shipped_at)), qty_ship: qtyShip }] });
    }
  },

  derive(d, T, ctx) {
    for (const t of ['forecasts', 'forecast_lines', 'stock_positions', 'order_status']) T[t] ||= [];
    if (d.type === '830') {
      const cur = T.forecasts.find((f) => f.status === 'Current');
      const period = PERIODS.filter(([, from]) => from <= etDay(new Date(d.at))).pop()[0];
      if (cur) Object.assign(cur, { status: 'Superseded', valid_to: d.at, superseded_by: d.ref });
      T.forecasts.push({ forecast_id: d.ref, doc_id: d.doc_id, period, issued_by: d.sender, issued_to: d.receiver, issued_at: d.at, purpose: d.purpose === '00' ? 'Original' : 'Replace', horizon_start: d.horizon_start, horizon_end: d.horizon_end, valid_from: d.at, valid_to: null, status: 'Current', supersedes: cur ? cur.forecast_id : null, superseded_by: null });
      for (const l of d.lines) for (const w of l.weeks) T.forecast_lines.push({ forecast_id: d.ref, sku: l.sku, location: ctx.loc(l.loc_gln), week_start: w.start, week_end: w.end, qty: w.qty, uom: 'CA' });
    } else if (d.type === '846') {
      if (d.sender === 'ASHBY') return; // Ashby's 846 to Northfield repeats Kinross's figures; the stock positions come from Kinross's
      const site = ctx.loc(d.parties.WH.gln);
      for (const it of d.items) {
        const byAt = new Map(); for (const r of it.readings) (byAt.get(r.at) || byAt.set(r.at, []).get(r.at)).push(r);
        for (const [at, rs] of byAt) {
          const oh = rs.find((r) => r.code === '17'); const av = rs.find((r) => r.code === '33');
          T.stock_positions.push({ site, sku: it.sku, as_of: at, kind: oh ? 'End of day' : 'Pick wave', on_hand: oh ? oh.qty : null, committed: null, available: av ? av.qty : null, unit: 'Cases', reported_by: d.sender, source: 'Inventory advice (846)', doc_id: d.doc_id, event_id: null });
          const qh = rs.find((r) => r.code === 'QH'); if (qh) T.stock_positions.push({ site, sku: it.sku, as_of: at, kind: 'Held for damage replacement', on_hand: qh.qty, committed: null, available: 0, unit: 'Cases', reported_by: d.sender, source: 'Inventory advice (846)', doc_id: d.doc_id, event_id: null });
        }
      }
    } else if (d.type === '870') {
      for (const l of d.lines) {
        for (const r of T.order_status) if (r.po === d.po && r.line === l.line && r.state === 'Latest') r.state = 'Superseded';
        T.order_status.push({ po: d.po, line: l.line, sku: l.sku, reported_at: d.at, status_code: l.status, status: l.status === 'CP' ? 'Partial shipment, remainder cancelled (no backorder)' : l.status, status_date: l.status_date, qty_ordered: l.qty, qty_to_ship: l.qty_ship, qty_cancelled: l.qty - l.qty_ship, doc_id: d.doc_id, state: 'Latest' });
      }
    }
  },

  /** Stock readings that do not travel as EDI: Ashby's ERP reads (Northfield's API read among them, R30) and Kinross's inventory read. */
  finish(T, ctx) {
    T.stock_positions ||= [];
    const site = (name) => locations.find((l) => l.name === name)?.id;
    for (const e of ctx.events) {
      const x = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      // Ashby's ERP keeps its stock at its own warehouse; the two reads without a site are taken to be ASH-WH1 too.
      if (e.kind === 'erp.inventory_read') T.stock_positions.push({ site: x.site || 'ASH-WH1', sku: x.sku, as_of: e.at, kind: 'ERP read', on_hand: x.on_hand ?? null, committed: x.committed ?? null, available: x.available ?? null, unit: x.unit || 'Cases', reported_by: 'ASHBY', source: 'Supplier ERP', doc_id: null, event_id: e.id });
      if (e.kind === 'wms.inventory') T.stock_positions.push({ site: site(x.site), sku: x.sku, as_of: e.at, kind: 'Warehouse read', on_hand: null, committed: null, available: x.available, unit: 'Cases', reported_by: 'KINROSS', source: 'Kinross warehouse system', doc_id: null, event_id: e.id });
    }
  },

  // The 830 starts a flow (a plan answers no document) and names the 830 it replaces; the 846 is a periodic report,
  // like the 852, and names the previous 846 from the same site; the 870 reports on its 850.
  origins: ['830', '846', '947'],
  prev(d, ctx) {
    if (d.type === '870') return [{ doc: ctx.latest(d.po, '850', d.at), kind: 'reports on' }];
    let c = linkCache.get(ctx.docs);
    if (!c) { c = new Map(); const last = new Map(); for (const x of ctx.docs) { if (x.type !== '830' && x.type !== '846') continue; const k = x.type === '830' ? '830' : `846|${x.sender}>${x.receiver}|${x.parties.WH.gln}`; c.set(x.doc_id, last.get(k) || null); last.set(k, x); } linkCache.set(ctx.docs, c); }
    const p = c.get(d.doc_id);
    return p ? [{ doc: p, kind: d.type === '830' ? 'supersedes' : 'follows' }] : [];
  },

  views: {
    ashby: [
      'INSERT INTO planning_periods SELECT * FROM m.planning_periods', 'INSERT INTO forecasts SELECT * FROM m.forecasts', 'INSERT INTO forecast_lines SELECT * FROM m.forecast_lines',
      "INSERT INTO stock_positions SELECT * FROM m.stock_positions WHERE sku IN (SELECT sku FROM items)", 'INSERT INTO order_status SELECT * FROM m.order_status WHERE po IN (SELECT po FROM orders)',
    ],
    // Northfield exchanged the 830 and the 870, so it sees them; Kinross's 846 to Ashby and every stock position stay
    // out. The core view copies every document except the 940 and 945, so the 846s, their 997s and their links are
    // removed here.
    northfield: [
      'INSERT INTO planning_periods SELECT * FROM m.planning_periods', 'INSERT INTO forecasts SELECT * FROM m.forecasts', 'INSERT INTO forecast_lines SELECT * FROM m.forecast_lines',
      'INSERT INTO order_status SELECT * FROM m.order_status',
      "DELETE FROM document_links WHERE doc_id IN (SELECT doc_id FROM documents WHERE (doc_type = '846' AND sender_id = 'KINROSS') OR answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '846' AND sender_id = 'KINROSS')) OR prev_doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '846' AND sender_id = 'KINROSS')",
      "DELETE FROM documents WHERE doc_type = '997' AND answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '846' AND sender_id = 'KINROSS')",
      "DELETE FROM documents WHERE doc_type = '846' AND sender_id = 'KINROSS'",
      "DELETE FROM document_links WHERE doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '947' OR answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '947'))",
      "DELETE FROM documents WHERE doc_type = '997' AND answers_doc_id IN (SELECT doc_id FROM documents WHERE doc_type = '947')",
      "DELETE FROM documents WHERE doc_type = '947'",
    ],
  },

  staedi: {
    SEG: {
      BFR: ['ID 2 2!', 'AN 1 30', 'AN 1 30', 'ID 2 2!', 'ID 1 1!', 'DT 8 8!', 'DT 8 8', 'DT 8 8!'],
      UIT: ['ID 2 2!'],
      FST: ['R 1 15!', 'ID 1 1!', 'ID 1 1!', 'DT 8 8!', 'DT 8 8'],
      BIA: ['ID 2 2!', 'ID 2 2!', 'AN 1 30!', 'DT 8 8!', 'TM 4 8'],
      QTY: ['ID 2 2!', 'R 1 15', 'ID 2 2'],
      BSR: ['ID 1 2!', 'ID 2 2!', 'AN 1 30!', 'DT 8 8!'],
      ISR: ['ID 2 2!', 'DT 8 8'],
      W15: ['DT 8 8!', 'AN 1 30!'],
      N9: ['ID 2 3!', 'AN 1 30', 'AN 1 45'],
      W19: ['ID 2 2!', 'R 1 15!', 'ID 2 2!', 'AN 1 12', 'ID 2 2', 'AN 1 48'],
    },
    SET: {
      830: ['BFR!', ['N1+'], ['LIN!+', 'UIT', ['N1+'], 'FST+'], 'CTT'],
      846: ['BIA!', ['N1+'], ['LIN!+', ['QTY+', 'DTM+']], 'CTT'],
      947: ['W15!', ['N1+'], ['LX!+', 'W19!', 'N9+']],
      870: ['BSR!', ['HL!+', 'PRF', ['N1+'], ['PO1+', ['ISR+', 'QTY+']]], 'CTT'],
    },
  },
};

// ---------- the gate's judgement ----------
/**
 * Judges one short-shipped order line (an NF-2.1 in-full miss, charge OT01) against the forecast in force when the
 * order was placed and the stock Kinross had at the pick wave. Reads only the database it is given.
 *   forecast  the 830 issued last before the order; its line for the item, DC and delivery week
 *   ordered   cases Northfield had ordered for that item, DC and week up to and including this order
 *   stock     available at the site's last stock position at or before the pick (the 846's pick wave)
 */
export function judgeShortShip(db, po, line) {
  const ol = db.prepare('SELECT l.*, o.received_at, o.ship_to, o.requested_delivery FROM order_lines l JOIN orders o ON o.po = l.po WHERE l.po = ? AND l.line = ?').get(po, line);
  if (!ol) return { po, line, found: false };
  const shipped = db.prepare('SELECT coalesce(sum(qty), 0) n FROM shipment_lines WHERE po = ? AND line = ?').get(po, line).n;
  const shortBy = ol.qty_ordered - shipped;
  const fc = db.prepare('SELECT * FROM forecasts WHERE valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC LIMIT 1').get(ol.received_at, ol.received_at);
  const week = weekOf(ol.requested_delivery);
  const fl = fc ? db.prepare('SELECT qty FROM forecast_lines WHERE forecast_id = ? AND sku = ? AND location = ? AND week_start = ?').get(fc.forecast_id, ol.sku, ol.ship_to, week) : null;
  const forecast = fl ? fl.qty : 0;
  const ordered = db.prepare("SELECT coalesce(sum(l.qty_original), 0) n FROM order_lines l JOIN orders o ON o.po = l.po WHERE o.stream = 'replenishment' AND o.supplier_id = 'ASHBY' AND l.sku = ? AND o.ship_to = ? AND o.requested_delivery >= ? AND o.requested_delivery <= ? AND o.received_at <= ?")
    .get(ol.sku, ol.ship_to, week, plusDays(week, 6), ol.received_at).n;
  const wo = db.prepare('SELECT site, shipped_at FROM warehouse_orders WHERE po = ?').get(po);
  const pickAt = wo ? new Date(Date.parse(wo.shipped_at) - PICK_LEAD_H * H).toISOString() : null;
  const pos = wo ? db.prepare("SELECT as_of, kind, available, doc_id FROM stock_positions WHERE site = ? AND sku = ? AND as_of <= ? AND available IS NOT NULL ORDER BY as_of DESC, kind = 'Pick wave' DESC LIMIT 1").get(wo.site, ol.sku, pickAt) : null;
  const stock = pos ? pos.available : null;
  // Kinross picks a truck's orders in one wave; the stock at the wave is shared by every order in it. What the wave
  // needed is the cases ordered on all of them (this order's full quantity, not what was cut).
  const need = wo ? db.prepare('SELECT coalesce(sum(l.qty_ordered), 0) n FROM warehouse_orders w JOIN order_lines l ON l.po = w.po WHERE w.site = ? AND w.shipped_at = ? AND l.sku = ?').get(wo.site, wo.shipped_at, ol.sku).n : null;
  const over = ordered - forecast;
  const stockShort = stock != null && stock < need;
  const forecastable = stockShort ? over <= 0 : null;
  const stockText = `stock at the pick (${stock}) ${stockShort ? 'was below' : 'covered'} what the pick wave needed (${need} cases, this order ${ol.qty_ordered})`;
  const verdict = stock == null ? 'No stock record at the pick: cannot judge'
    : !stockShort ? `${stockText}: the short-ship was not a stock shortage`
    : over > 0 ? `Order took the week to ${ordered} cases, ${over} over the forecast of ${forecast} in force (${fc ? fc.forecast_id : 'none'}); ${stockText}: shortage not forecastable from the forecast`
    : `Order was within the forecast in force (${ordered} of ${forecast} cases, ${fc ? fc.forecast_id : 'none'}); ${stockText}: shortage forecastable`;
  return { po, line, sku: ol.sku, dc: ol.ship_to, week, ordered_qty: ol.qty_ordered, shipped, short_by: shortBy, forecast_id: fc ? fc.forecast_id : null, forecast, week_ordered: ordered, over_forecast: over,
    site: wo ? wo.site : null, pick_at: pickAt, stock_at_pick: stock, wave_needed: need, stock_record: pos ? pos.doc_id : null, stock_short: stockShort, forecastable, outcome: stock == null ? 'unknown' : !stockShort ? 'not_stock' : over > 0 ? 'not_forecastable' : 'forecastable', verdict,
    charge_ot01: Math.round(0.03 * Math.max(0, shortBy) * ol.price * 100) / 100 };
}
