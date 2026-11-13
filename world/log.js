// The event log builder. Streams add business documents and non-EDI events; emit() assigns control numbers,
// adds the technical acknowledgment each receiver returns, and renders every document to X12 text.
import { writeInterchange } from './x12.js';
import { PARTY, ITEM, locations } from './ref.js';

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
  aside(fn) { const seq = this.seq, from = this.docs.length; this.sideSeq ??= 5000000; fn(); for (const x of this.docs.slice(from)) { x._n = this.sideSeq++; x.ackDelay = 2 + (x._n % 8); } this.seq = seq; }

  /** Adds a business document. `from` and `to` are party ids; the rest is what the X12 writer needs. */
  doc(d) { const x = { ...d, at: iso(d.at), _n: this.seq++ }; x.ackDelay = 2 + (x._n % 8); this.docs.push(x); return x; }

  /** Adds a record that does not travel as EDI: a Supplier ERP posting, a warehouse scan, a phone call, a case entry. */
  event(e) { const x = { ...e, at: iso(e.at), data: e.data || {} }; this.events.push(x); return x; }

  /** Renders the log. Returns interchanges in send order: { text, from, to, at, doc }. */
  emit() {
    const docs = [...this.docs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a._n - b._n));
    const ctl = new Map(); const next = (k, base) => { const v = (ctl.get(k) ?? base) + 1; ctl.set(k, v); return v; };
    const out = []; const acks = [];
    for (const d of docs) {
      const from = PARTY[d.from], to = PARTY[d.to];
      d.ctl = next(`${d.from}>${d.to}`, 1000);
      if (typeof d.answers_gs === 'function') d.answers_gs = d.answers_gs();
      let text = writeInterchange(d, { isaSender: from.isa, isaReceiver: to.isa, ctl: d.ctl });
      if (d.test) text = text.replace(/\*0\*P\*>~/, '*0*T*>~');
      const fault = d.fault ? FAULTS[d.fault] : null;
      if (fault) text = fault.apply(text);
      out.push({ text, from: d.from, to: d.to, at: d.at, type: d.type });
      if (d.no_ack) continue;
      // The receiver's technical acknowledgment, 2 to 9 minutes later.
      const at = iso(new Date(Date.parse(d.at) + d.ackDelay * 60000));
      acks.push({ d, fa: { type: '997', from: d.to, to: d.from, at, group_id: text.match(/\nGS\*([A-Z]{2})\*/)[1], group_ctl: d.ctl, set_id: d.type, set_ctl: '0001', result: fault && !fault.accept ? 'R' : 'A', ...(fault && !fault.accept ? fault.ak(text, d) : {}) } });
    }
    // Acknowledgment control numbers are allocated in the order the acknowledgments are sent.
    acks.sort((x, y) => (x.fa.at < y.fa.at ? -1 : x.fa.at > y.fa.at ? 1 : x.d._n - y.d._n));
    for (const { d, fa } of acks) {
      fa.ctl = next(`${fa.from}>${fa.to}:FA`, 500000000);
      let faText = writeInterchange(fa, { isaSender: PARTY[fa.from].isa, isaReceiver: PARTY[fa.to].isa, ctl: fa.ctl });
      if (d.test) faText = faText.replace(/\*0\*P\*>~/, '*0*T*>~');
      out.push({ text: faText, from: fa.from, to: fa.to, at: fa.at, type: '997' });
    }
    out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return out;
  }
}

// ---------- document helpers shared by the streams ----------
export const lineOf = (l) => { const it = ITEM[l.sku]; return { line: l.line, qty: l.qty, price: l.price ?? it?.case_price, nf_item: l.nf_item ?? it?.northfield_item, sku: l.sku, gtin: l.gtin ?? it?.gtin, uom: l.uom || 'CA' }; };
const NF = PARTY.NORTHFIELD;

export const D = {
  po(L, O, at) {
    const sup = PARTY[O.supplier];
    return L.doc({ type: '850', from: 'NORTHFIELD', to: O.supplier, at, po: O.po, programme: O.programme || 'WHSL', requested_delivery: O.requested, buyer_name: NF.name, buyer_gln: NF.gln, ship_to_name: LOC[O.shipTo].name, ship_to_gln: LOC[O.shipTo].gln, vendor_name: sup.name, vendor_gln: sup.gln, lines: O.lines.map(lineOf) });
  },
  ack(L, O, at, { codes = {}, qty = {}, dates = {}, backorder = {}, ref } = {}) {
    return L.doc({ type: '855', from: O.supplier, to: 'NORTHFIELD', at, po: O.po, ref: ref || `ACK-${O.po.slice(3)}`, lines: O.lines.map((l) => ({ ...lineOf(l), qty_ordered: l.qty, code: codes[l.line] || 'IA', qty: qty[l.line] ?? l.qty, date: dates[l.line] || null, backorder: backorder[l.line] || 0 })) });
  },
  change(L, O, at, seq, changes) {
    return L.doc({ type: '860', from: 'NORTHFIELD', to: O.supplier, at, po: O.po, seq, po_date: O.poDate, changes: changes.map((c) => ({ ...lineOf(O.lines.find((l) => l.line === c.line)), ...c })) });
  },
  changeAck(L, O, at, seq, ref, lines) {
    return L.doc({ type: '865', from: O.supplier, to: 'NORTHFIELD', at, po: O.po, seq, ref, lines: lines.map((x) => ({ ...lineOf(O.lines.find((l) => l.line === x.line)), qty_ordered: O.lines.find((l) => l.line === x.line).qty, ...x })) });
  },
  asn(L, O, at, o) {
    const site = o.shipFrom || LOC[o.site || O.site || 'ASH-WH1']; const st = LOC[o.shipTo || O.shipTo];
    const lines = (o.lines || O.lines.map((l) => ({ line: l.line, sku: l.sku, qty: o.qty?.[l.line] ?? l.qty }))).filter((l) => l.qty > 0).map((l) => ({ ...lineOf({ ...O.lines.find((x) => x.line === l.line), ...l }) }));
    return L.doc({ type: '856', from: O.supplier, to: 'NORTHFIELD', at, ref: o.ref, resend: !!o.resend, po_ref: o.poRef || O.po, carton_count: o.cartonCount ?? (o.cartons ? o.cartons.length : lines.reduce((a, l) => a + l.qty, 0)), scac: o.scac ?? 'LKLF', bol: o.bol || null, seal: o.seal || null,
      shipped_at: iso(o.shippedAt), delivery_date: o.deliveryDate, ship_to_name: st.name, ship_to_gln: o.shipToGln || st.gln, ship_from_name: site.name, ship_from_gln: site.gln, lines, cartons: o.cartons || null, status: o.status || 'CC', fault: o.fault || null });
  },
  invoice(L, O, at, o) {
    const sup = PARTY[O.supplier];
    const lines = O.lines.map((l) => ({ ...lineOf({ ...l, ...(o.items?.[l.line] || {}) }), qty: o.qty?.[l.line] ?? l.qty })).filter((l) => l.qty > 0);
    const sum = Math.round(lines.reduce((a, l) => a + l.qty * l.price, 0) * 100) / 100;
    return L.doc({ type: '810', from: O.supplier, to: 'NORTHFIELD', at, ref: o.ref, po_ref: o.poRef || O.po, po_date: O.poDate, replaces: o.replaces || null, buyer_name: NF.name, buyer_gln: NF.gln, vendor_name: sup.name, vendor_gln: sup.gln, terms_days: o.terms ?? 30, lines, total: o.total ?? sum, fault: o.fault || null });
  },
  receipt(L, O, at, o) {
    const st = LOC[o.location || O.shipTo];
    return L.doc({ type: '861', from: 'NORTHFIELD', to: O.supplier, at, ref: o.ref, po: O.po, asn_ref: o.asnRef, received_at: iso(at), location_name: st.name, location_gln: st.gln,
      lines: Object.entries(o.qty).map(([line, q]) => ({ ...lineOf(O.lines.find((l) => l.line === +line)), qty: q, short: o.short?.[line] || 0, not_scanned: o.notScanned?.[line] || [] })) });
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
    return L.doc({ type: '945', from: 'KINROSS', to: 'ASHBY', at, ref, po: O.po, shipment_id: o.shipmentId, site_name: site.name, site_gln: site.gln, shipped_at: iso(o.shippedAt || at), lines: O.lines.map((l) => ({ sku: l.sku, ordered: o.ordered?.[l.line] ?? l.qty, shipped: o.shipped?.[l.line] ?? l.qty })) });
  },
};
