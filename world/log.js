// The event log builder. Streams add business documents and non-EDI events; emit() assigns control numbers,
// adds the technical acknowledgment each receiver returns, and renders every document to X12 text.
import { writeInterchange } from './x12.js';
import { PARTY, ITEM, locations } from './ref.js';
import { lotOf } from './lots.js';
import { carriesTrip, tripIdOf } from './stages/guide-change.js';

export const iso = (d) => { const x = new Date(d); x.setMilliseconds(0); return x.toISOString(); };
const LOC = Object.fromEntries(locations.map((l) => [l.id, l]));

/** Syntax faults: each changes the X12 text so the file really carries the fault the 997 reports. */
export const FAULTS = {
  // Standard X12 makes CTT optional on an 855, so its absence is not a syntax error: Northfield accepts the file and rejects it on an 824.
  no_ctt: { accept: true, apply: (t) => { const n = Number(t.match(/\nSE\*(\d+)\*/)[1]); return t.replace(/\nCTT\*[^~]*~/, '').replace(/\nSE\*\d+\*/, `\nSE*${n - 1}*`); } },
  missing_segment: { apply: (t) => { const n = Number(t.match(/\nSE\*(\d+)\*/)[1]); return t.replace(/\nCTT\*[^~]*~/, '').replace(/\nSE\*\d+\*/, `\nSE*${n - 1}*`); }, ak: (t) => ({ seg_errors: [{ seg: 'CTT', pos: segPos(t, 'SE'), code: '3' }], set_code: '5' }) },
  invalid_date: { apply: (t) => t.replace(/\nDTM\*011\*\d{8}/, '\nDTM*011*20261340'), ak: (t) => ({ seg_errors: [{ seg: 'DTM', pos: segPos(t, 'DTM'), code: '8' }], elem_errors: [{ pos: 2, ref: '373', code: '8', bad: '20261340' }], set_code: '5' }) },
  se_count: { apply: (t) => t.replace(/\nSE\*(\d+)\*/, (m, n) => `\nSE*${Number(n) + 1}*`), ak: () => ({ set_code: '4' }) },
  too_long: { apply: (t) => t.replace(/\nN1\*ST\*[^*]*\*/, `\nN1*ST*${'NORTHFIELD DISTRIBUTION CENTRE RECEIVING DOCK AND CROSS DOCK FACILITY 2'}*`), ak: (t) => ({ seg_errors: [{ seg: 'N1', pos: segPos(t, 'N1*ST'), code: '8' }], elem_errors: [{ pos: 2, ref: '93', code: '5', bad: 'NORTHFIELD DISTRIBUTION CENTRE RECEIVING DOCK AND CROSS DOCK FACILITY 2' }], set_code: '5' }) },
  po_ref_long: { apply: (t) => t, ak: (t, d) => ({ seg_errors: [{ seg: d.type === '856' ? 'PRF' : 'BIG', pos: segPos(t, d.type === '856' ? 'PRF' : 'BIG'), code: '8' }], elem_errors: [{ pos: d.type === '856' ? 1 : 4, ref: '324', code: '5', bad: d.po_ref }], set_code: '5' }) },
};
function segPos(text, tag) { const segs = text.split('~\n'); const st = segs.findIndex((s) => s.startsWith('ST*')); const i = segs.findIndex((s, k) => k > st && s.startsWith(tag + (tag.includes('*') ? '' : '*'))); return i < 0 ? 0 : i - st + 1; }

export class Log {
  constructor() { this.docs = []; this.events = []; this.seq = 0; }

  /** Runs `fn` so the documents it adds take their order numbers from a separate range. Records added to the world
   * later (Phase 1 additions) must not shift the numbering, and with it the acknowledgment delay, of the records already there. */
  aside(fn) { const seq = this.seq, from = this.docs.length; this.sideSeq ??= 5000000; fn(); for (const x of this.docs.slice(from)) { x._n = this.sideSeq++; x.ackDelay = 2 + (x._n % 8); if (this.asideHist) x.hist = true; } this.seq = seq; }

  /** Adds a business document. `from` and `to` are party ids; the rest is what the X12 writer needs. */
  doc(d) { const x = { ...d, at: iso(d.at), _n: this.seq++ }; x.ackDelay = 2 + (x._n % 8); this.docs.push(x); return x; }

  /** Keeps the place of a document withdrawn from the world. Its order number and the control numbers it and its
   * acknowledgment held stay unused, so no other interchange is renumbered; nothing is written for it. */
  retire(d) { return this.doc({ ...d, type: 'retired', retired: true }); }

  /** Adds a record that does not travel as EDI: a Supplier ERP posting, a warehouse scan, a case entry. */
  event(e) { const x = { ...e, at: iso(e.at), data: e.data || {} }; this.events.push(x); return x; }

  /** Keeps the place of a record withdrawn from the world, so the records after it keep their ids. Never stored. */
  retireEvent(at) { const x = { at: iso(at), kind: 'retired', retired: true, data: {} }; this.events.push(x); return x; }

  /** Renders the log. Returns interchanges in send order: { text, from, to, at, doc }. */
  emit() {
    // Round plan, 26 November 2026 (EDI first): on the orders P6 and P22 show, the 3PL warehouse's 945 carries each carton's
    // SSCC (and lot where the item has one) and the bill of lading, taken from the ship notice for the same shipment.
    const CARTON_945 = new Set(["NR-447976", "NR-448011", "NR-448137", "NR-448249", "NR-448263", "NR-448326", "NR-448424", "NR-448487", "NR-448501", "NR-448515", "NR-448564", "NR-448571", "NR-448578", "NR-448669", "NR-448753", "NR-448809", "NR-448879", "NR-449047", "NR-449075", "NR-449145", "NR-449236", "NR-449257", "NR-449292", "NR-449313", "NR-449334", "NR-449425", "NR-449453", "NR-449481", "NR-449551", "NR-449607", "NR-449621", "NR-449635", "NR-449642", "NR-449649", "NR-449663", "NR-449677", "NR-449740", "NR-449761", "NR-449775", "NR-449803", "NR-449824", "NR-449845", "NR-449873", "NR-449950", "NR-450083", "NR-450097", "NR-450111", "NR-450118", "NR-450146", "NR-450188", "NR-450279", "NR-450390", "NR-450415", "NR-451207", "NR-460207", "NR-460219", "NR-460233", "NR-460241", "NR-460262", "NR-460288", "NR-462410", "NR-462411", "NR-462412", "NR-470001", "NR-470004"]);
    for (const d of this.docs) if (d.type === '945' && CARTON_945.has(d.po) && !d.lines.some((l) => l.cartons)) {
      const asn = this.docs.find((x) => x.type === '856' && x.po_ref === d.po && x.shipped_at === d.shipped_at && x.cartons);
      if (!asn) continue; const byLine = (line) => (asn.lines.find((l) => l.line === line) || {});
      d.tracking ??= asn.bol || null;
      for (const l of d.lines) l.cartons = asn.cartons.filter((c) => byLine(c.line).sku === l.sku).map((c) => ({ sscc: c.sscc, lot: byLine(c.line).lot || null, best_before: byLine(c.line).best_before || null }));
    }
    // A document sent later than first planned keeps its place in the numbering (`numAt`), so moving it renumbers nothing else.
    const key = (d) => d.numAt || d.at;
    const docs = [...this.docs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a._n - b._n));
    const ctl = new Map(); const next = (k, base) => { const v = (ctl.get(k) ?? base) + 1; ctl.set(k, v); return v; };
    // History documents come first in time. They count up to the period's base, so the current period keeps its numbers.
    const histN = new Map(); for (const d of docs) if (d.hist && !d.stage) { for (const k of [`${d.from}>${d.to}`, ...(d.no_ack ? [] : [`${d.to}>${d.from}:FA`])]) histN.set(k, (histN.get(k) || 0) + 1); }
    // Documents added by a world-coverage stage are sent by the system that owns that stage (planning, transport,
    // catalogue…) and take interchange numbers from that system's own range, so adding one never renumbers an existing
    // interchange. Their acknowledgments likewise. Ranges: business 700,000,000 up, acknowledgments 600,000,000 up.
    // Records added on 17 November 2026 (stage `records`) take a range of their own (800,000,000 up; acknowledgments
    // 900,000,000 up), so they renumber no earlier stage's interchanges either.
    // Records added on 18 November 2026 (`batch: 2` in stage `records`) take a further range (850,000,000 up; acknowledgments
    // 950,000,000 up): they are dated before records the stage already held, and would otherwise renumber them.
    // Records added on 20 November 2026 (stage `item-accuracy`, P25) take their own range too (870,000,000 up;
    // acknowledgments 970,000,000 up), so they renumber nothing on a pair other stages share.
    // Records added on 20 November 2026 (stage `lot-trace`, P26) likewise: 880,000,000 up; acknowledgments 980,000,000 up.
    // Records added on 23 November 2026 (stage `disputes-week`, P6) likewise: 890,000,000 up; acknowledgments 990,000,000 up.
    const nextCtl = (d, k, base) => (d.stage === 'disputes-week' ? next(`${k}:DW`, /:FA/.test(k) ? 990000000 : 890000000) : d.stage === 'lot-trace' ? next(`${k}:LT`, /:FA/.test(k) ? 980000000 : 880000000) : d.stage === 'item-accuracy' ? next(`${k}:IA`, /:FA/.test(k) ? 970000000 : 870000000) : d.batch === 2 ? next(`${k}:R2`, /:FA/.test(k) ? 950000000 : 850000000) : d.stage === 'records' ? next(`${k}:R`, /:FA/.test(k) ? 900000000 : 800000000) : d.stage ? next(`${k}:S`, k.endsWith(':FA') ? 600000000 : 700000000) : d.hist ? next(`${k}:H`, base - histN.get(k)) : next(k, base));
    const out = []; const acks = [];
    for (const d of docs) {
      const from = PARTY[d.from], to = PARTY[d.to];
      // A stage document (D60) takes control numbers from its own range on the pair, so adding it renumbers no existing
      // document: 700,000,000 up, and 600,000,000 up for its 997s (the same ranges as main after dfef3cd).
      d.ctl = nextCtl(d, `${d.from}>${d.to}${d.stage ? ':S' : ''}`, d.stage ? 700000000 : [d.from, d.to].includes('MARKETPLACE') ? 300000000 : [d.from, d.to].includes('TRADINGGRID') ? 200000000 : 1000); // Northfield Marketplace (P4): its own range
      if (d.retired) { if (!d.no_ack) acks.push({ d, numAt: iso(new Date(Date.parse(d.numAt || d.at) + d.ackDelay * 60000)), fa: { from: d.to, to: d.from } }); continue; }
      if (typeof d.answers_gs === 'function') d.answers_gs = d.answers_gs();
      let text = writeInterchange(d, { isaSender: from.isa, isaReceiver: to.isa, ctl: d.ctl });
      if (d.test) text = text.replace(/\*0\*P\*>~/, '*0*T*>~');
      const fault = d.fault ? FAULTS[d.fault] : null;
      if (fault) text = fault.apply(text);
      out.push({ text, from: d.from, to: d.to, at: d.at, type: d.type });
      if (d.no_ack) continue;
      // The receiver's technical acknowledgment, 2 to 9 minutes later.
      const at = iso(new Date(Date.parse(d.at) + d.ackDelay * 60000));
      const numAt = d.numAt ? iso(new Date(Date.parse(d.numAt) + d.ackDelay * 60000)) : at;
      acks.push({ d, numAt, fa: { type: '997', from: d.to, to: d.from, at, group_id: text.match(/\nGS\*([A-Z]{2})\*/)[1], group_ctl: d.ctl, set_id: d.type, set_ctl: '0001', result: fault && !fault.accept ? 'R' : 'A', ...(fault && !fault.accept ? fault.ak(text, d) : {}) } });
    }
    // Acknowledgment control numbers are allocated in the order the acknowledgments are sent.
    acks.sort((x, y) => (x.numAt < y.numAt ? -1 : x.numAt > y.numAt ? 1 : x.d._n - y.d._n));
    for (const { d, fa } of acks) {
      fa.ctl = nextCtl(d, `${fa.from}>${fa.to}:FA${d.stage ? ':S' : ''}`, d.stage ? 600000000 : 500000000);
      if (d.retired) continue;
      let faText = writeInterchange(fa, { isaSender: PARTY[fa.from].isa, isaReceiver: PARTY[fa.to].isa, ctl: fa.ctl });
      if (d.test) faText = faText.replace(/\*0\*P\*>~/, '*0*T*>~');
      out.push({ text: faText, from: fa.from, to: fa.to, at: fa.at, type: '997' });
    }
    out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return out;
  }
}

// ---------- document helpers shared by the streams ----------
export const lineOf = (l) => { const it = ITEM[l.sku]; return { line: l.line, qty: l.qty, price: l.price ?? it?.case_price, nf_item: l.nf_item ?? it?.northfield_item, sku: l.sku, gtin: l.gtin ?? it?.gtin, uom: l.uom || 'CA', ...(l.upc ? { upc: l.upc } : {}) }; };
const NF = PARTY.NORTHFIELD;

export const D = {
  po(L, O, at) {
    const sup = PARTY[O.supplier];
    const by = PARTY[O.partner || 'NORTHFIELD'];
    return L.doc({ type: '850', from: O.partner || 'NORTHFIELD', to: O.supplier, at, po: O.po, programme: O.programme || 'WHSL', requested_delivery: O.requested, buyer_name: by.name, buyer_gln: by.gln, ship_to_name: LOC[O.shipTo].name, ship_to_gln: LOC[O.shipTo].gln, vendor_name: sup.name, vendor_gln: sup.gln, lines: O.lines.map(lineOf) });
  },
  ack(L, O, at, { codes = {}, qty = {}, dates = {}, backorder = {}, ref, numAt } = {}) {
    return L.doc({ type: '855', from: O.supplier, to: O.partner || 'NORTHFIELD', at, ...(numAt ? { numAt: iso(numAt) } : {}), po: O.po, ref: ref || `ACK-${O.po.slice(3)}`, lines: O.lines.map((l) => ({ ...lineOf(l), qty_ordered: l.qty, code: codes[l.line] || 'IA', qty: qty[l.line] ?? l.qty, date: dates[l.line] || null, backorder: backorder[l.line] || 0 })) });
  },
  change(L, O, at, seq, changes) {
    return L.doc({ type: '860', from: 'NORTHFIELD', to: O.supplier, at, po: O.po, seq, po_date: O.poDate, changes: changes.map((c) => ({ ...lineOf(O.lines.find((l) => l.line === c.line)), ...c })) });
  },
  changeAck(L, O, at, seq, ref, lines) {
    return L.doc({ type: '865', from: O.supplier, to: 'NORTHFIELD', at, po: O.po, seq, ref, lines: lines.map((x) => ({ ...lineOf(O.lines.find((l) => l.line === x.line)), qty_ordered: O.lines.find((l) => l.line === x.line).qty, ...x })) });
  },
  asn(L, O, at, o) {
    const site = o.shipFrom || LOC[o.site || O.site || 'ASH-WH1']; const st = LOC[o.shipTo || O.shipTo];
    // A food line carries its lot and best-before date (P26): the lot it shipped from, world/lots.js.
    const lines = (o.lines || O.lines.map((l) => ({ line: l.line, sku: l.sku, qty: o.qty?.[l.line] ?? l.qty }))).filter((l) => l.qty > 0).map((l) => { const x = lineOf({ ...O.lines.find((y) => y.line === l.line), ...l }); return { ...x, ...(lotOf(x.sku, o.shippedAt) || {}) }; });
    (L.shippedAt ??= new Map()).set(o.ref, iso(o.shippedAt));
    return L.doc({ type: '856', from: O.supplier, to: O.partner || 'NORTHFIELD', at, ref: o.ref, resend: !!o.resend, po_ref: o.poRef || O.po, carton_count: o.cartonCount ?? (o.cartons ? o.cartons.length : lines.reduce((a, l) => a + l.qty, 0)), scac: o.scac ?? 'LKLF', bol: o.bol || null, seal: o.seal || null,
      shipped_at: iso(o.shippedAt), trip_id: o.tripId !== undefined ? o.tripId : carriesTrip(O.supplier, iso(o.shippedAt)) ? tripIdOf(o.ref, iso(o.shippedAt)) : null, delivery_date: o.deliveryDate, ship_to_name: st.name, ship_to_gln: o.shipToGln || st.gln, ship_from_name: site.name, ship_from_gln: site.gln, lines, cartons: o.cartons || null, status: o.status || 'CC', fault: o.fault || null });
  },
  invoice(L, O, at, o) {
    const sup = PARTY[O.supplier];
    const lines = O.lines.map((l) => ({ ...lineOf({ ...l, ...(o.items?.[l.line] || {}) }), qty: o.qty?.[l.line] ?? l.qty })).filter((l) => l.qty > 0);
    const sum = Math.round(lines.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
    return L.doc({ type: '810', from: O.supplier, to: 'NORTHFIELD', at, ref: o.ref, po_ref: o.poRef || O.po, po_date: O.poDate, replaces: o.replaces || null, buyer_name: NF.name, buyer_gln: NF.gln, vendor_name: sup.name, vendor_gln: sup.gln, terms_days: o.terms ?? 30, lines, total: o.total ?? sum, fault: o.fault || null });
  },
  receipt(L, O, at, o) {
    const st = LOC[o.location || O.shipTo];
    return L.doc({ type: '861', from: 'NORTHFIELD', to: O.supplier, at, ...(o.numAt ? { numAt: iso(o.numAt) } : {}), ref: o.ref, po: O.po, asn_ref: o.asnRef, received_at: iso(at), location_name: st.name, location_gln: st.gln,
      // A food line repeats the lot and best-before date of the ship notice it was received against (P26).
      lines: Object.entries(o.qty).map(([line, q]) => { const x = lineOf(O.lines.find((l) => l.line === +line)); return { ...x, qty: q, short: o.short?.[line] || 0, not_scanned: o.notScanned?.[line] || [], ...(lotOf(x.sku, L.shippedAt?.get(o.asnRef)) || {}) }; }) });
  },
  advice(L, target, at, { action = 'TR', errors }) {
    return L.doc({ type: '824', from: target.to, to: target.from, at, ref: `AA-${target.ref}${target.resend ? '-2' : ''}`, action, answers_ref: target.ref, answers_gs: () => target.ctl, answers_st: '0001', answers_set: target.type, errors, _target: target });
  },
  remit(L, to, at, ref, items) {
    const sup = PARTY[to]; const amount = Math.round(items.reduce((a, i) => a + i.paid, 0) * 100) / 100;
    return L.doc({ type: '820', from: 'NORTHFIELD', to, at, ref, amount, payer_name: NF.name, payer_gln: NF.gln, payee_name: sup.name, payee_gln: sup.gln, items });
  },
  whOrder(L, O, at, ref, o = {}) {
    const site = LOC[O.site]; const st = LOC[O.shipTo];
    return L.doc({ type: '940', from: 'ASHBY', to: 'KINROSS', at, ref, po: O.po, site_name: site.name, site_gln: site.gln, ship_to_name: st.name, ship_to_gln: st.gln, ship_date: o.shipDate, lines: O.lines.map((l) => ({ sku: l.sku, qty: o.qty?.[l.line] ?? l.qty })) });
  },
  whAdvice(L, O, at, ref, o = {}) {
    const site = LOC[O.site];
    return L.doc({ type: '945', from: 'KINROSS', to: 'ASHBY', at, ref, po: O.po, shipment_id: o.shipmentId, site_name: site.name, site_gln: site.gln, shipped_at: iso(o.shippedAt || at), tracking: o.tracking || null, ...(o.noLedger ? { no_ledger: true } : {}), lines: O.lines.filter((l) => !o.shipped || (o.ordered?.[l.line] ?? l.qty) > 0 || o.shipped[l.line] > 0).map((l) => ({ sku: l.sku, ordered: o.ordered?.[l.line] ?? l.qty, shipped: o.shipped?.[l.line] ?? l.qty, cartons: o.cartons ? o.cartons.filter((c) => c.line === l.line).map(({ sscc, lot, best_before }) => ({ sscc, lot: lot || null, best_before: best_before || null })) : null })) });
  },
};
