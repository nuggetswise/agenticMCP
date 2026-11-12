// X12 004010 writer and parser for the document types the world exchanges.
// The writer turns a business document into one interchange; the parser reads interchanges back.
// Database rows are derived from parser output only (see world/derive.js).
// Envelope dates and times are UTC. Element separator *, segment terminator ~, component separator >.

const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
const z = (n, w) => String(n).padStart(w, '0');
const d8 = (iso) => iso.slice(0, 10).replace(/-/g, '');
const t6 = (iso) => iso.slice(11, 19).replace(/:/g, '');
const t4 = (iso) => iso.slice(11, 16).replace(':', '');
const iso8 = (d, t = '000000') => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${(t.slice(4, 6) || '00')}.000Z`;
const day8 = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null);
const money = (n) => Number(n).toFixed(2);
const clean = (s) => String(s ?? '').replace(/[*~>\n\r]/g, ' ').trim();
const seg = (...e) => { while (e.length && (e[e.length - 1] === '' || e[e.length - 1] == null)) e.pop(); return e.map((x) => (x == null ? '' : String(x))).join('*'); };

export const FUNC = { 850: 'PO', 855: 'PR', 860: 'PC', 865: 'CA', 856: 'SH', 810: 'IN', 861: 'RC', 824: 'AG', 997: 'FA', 820: 'RA', 940: 'OW', 945: 'SW', 852: 'PD' };

const itemIds = (l) => ['IN', l.nf_item, 'VN', l.sku, ...(l.gtin ? ['UK', l.gtin] : [])];

/** Body segments (between ST and SE) for one document. */
const BODY = {
  850: (d) => [
    seg('BEG', '00', 'SA', d.po, '', d8(d.at)),
    seg('REF', '19', d.programme),
    seg('DTM', '002', d8(d.requested_delivery)),
    seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln),
    seg('N1', 'ST', clean(d.ship_to_name), 'UL', d.ship_to_gln),
    seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln),
    ...d.lines.map((l) => seg('PO1', l.line, l.qty, l.uom || 'CA', money(l.price), 'PE', ...itemIds(l))),
    seg('CTT', d.lines.length, d.lines.reduce((a, l) => a + l.qty, 0)),
  ],
  855: (d) => [
    seg('BAK', '00', d.lines.every((l) => l.code === 'IA') ? 'AD' : 'AC', d.po, d8(d.at), '', '', '', d.ref),
    ...d.lines.flatMap((l) => [
      seg('PO1', l.line, l.qty_ordered, 'CA', money(l.price), 'PE', ...itemIds(l)),
      ...(l.backorder ? [seg('ACK', 'IA', l.qty - l.backorder, 'CA'), seg('ACK', 'IB', l.backorder, 'CA')] : [seg('ACK', l.code, l.qty, 'CA', l.date ? '067' : '', l.date ? d8(l.date) : '')]),
    ]),
    seg('CTT', d.lines.length),
  ],
  860: (d) => [
    seg('BCH', '04', 'SA', d.po, '', d.seq, d8(d.po_date), '', '', '', '', d8(d.at)),
    ...d.changes.flatMap((c) => [
      seg('POC', c.line, c.code, c.qty, c.qty_left ?? '', 'CA', money(c.price), 'PE', ...itemIds(c)),
      ...(c.date ? [seg('DTM', '002', d8(c.date))] : []),
    ]),
    seg('CTT', d.changes.length),
  ],
  865: (d) => [
    seg('BCA', '00', d.lines.every((l) => l.code === 'IA') ? 'AT' : 'AC', d.po, '', d.seq, d8(d.at)),
    seg('REF', 'ZZ', d.ref),
    ...d.lines.flatMap((l) => [
      seg('POC', l.line, 'NC', l.qty_ordered, '', 'CA', money(l.price), 'PE', ...itemIds(l)),
      ...(l.backorder ? [seg('ACK', 'IA', l.qty - l.backorder, 'CA'), seg('ACK', 'IB', l.backorder, 'CA')] : [seg('ACK', l.code, l.qty, 'CA', l.date ? '067' : '', l.date ? d8(l.date) : '')]),
    ]),
    seg('CTT', d.lines.length),
  ],
  856: (d) => {
    const s = [
      seg('BSN', d.resend ? '05' : '00', d.ref, d8(d.at), t4(d.at), d.cartons ? '0001' : '0004'),
      seg('HL', 1, '', 'S'),
      seg('TD1', 'CTN', d.carton_count),
      ...(d.scac ? [seg('TD5', 'B', '2', d.scac)] : []),
      ...(d.bol ? [seg('REF', 'BM', d.bol)] : []),
      ...(d.seal ? [seg('REF', 'SN', d.seal)] : []),
      seg('DTM', '011', d8(d.shipped_at), t4(d.shipped_at)),
      seg('DTM', '017', d8(d.delivery_date)),
      seg('N1', 'ST', clean(d.ship_to_name), 'UL', d.ship_to_gln),
      seg('N1', 'SF', clean(d.ship_from_name), 'UL', d.ship_from_gln),
      seg('HL', 2, 1, 'O'),
      seg('PRF', d.po_ref),
    ];
    let h = 2;
    const item = (parent, l, qty) => { h++; s.push(seg('HL', h, parent, 'I'), seg('LIN', l.line, ...itemIds(l)), seg('SN1', l.line, qty, l.uom || 'CA', '', '', '', '', d.status || 'CC')); };
    if (d.cartons) for (const c of d.cartons) { h++; const p = h; s.push(seg('HL', p, 2, 'P'), seg('MAN', 'GM', c.sscc)); item(p, d.lines.find((l) => l.line === c.line), c.qty ?? 1); }
    else for (const l of d.lines) item(2, l, l.qty);
    s.push(seg('CTT', h));
    return s;
  },
  810: (d) => [
    seg('BIG', d8(d.at), d.ref, d.po_date ? d8(d.po_date) : '', d.po_ref),
    ...(d.replaces ? [seg('REF', 'OI', d.replaces)] : []),
    seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln),
    seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln),
    seg('ITD', '01', '3', '', '', '', '', d.terms_days ?? 30),
    ...d.lines.map((l) => seg('IT1', l.line, l.qty, l.uom || 'CA', money(l.price), '', ...itemIds(l))),
    seg('TDS', Math.round(d.total * 100)),
    seg('CTT', d.lines.length),
  ],
  861: (d) => [
    seg('BRA', d.ref, d8(d.received_at), '00', '1'),
    seg('REF', 'SI', d.asn_ref),
    seg('DTM', '050', d8(d.received_at), t4(d.received_at)),
    seg('PRF', d.po),
    seg('N1', 'ST', clean(d.location_name), 'UL', d.location_gln),
    ...d.lines.flatMap((l) => [
      seg('RCD', l.line, l.qty, 'CA', '', '', l.short ? l.short : '', l.short ? 'CA' : '', l.short ? '02' : ''),
      seg('LIN', l.line, ...itemIds(l)),
      ...(l.not_scanned || []).map((x) => seg('MAN', 'GM', x)),
    ]),
  ],
  824: (d) => [
    seg('BGN', '11', d.ref, d8(d.at), t4(d.at)),
    seg('OTI', d.action, 'TN', d.answers_ref, '', '', '', '', d.answers_gs, d.answers_st, d.answers_set),
    ...d.errors.flatMap((e) => [
      seg('TED', e.code, clean(e.cause).slice(0, 60), e.seg || '', '', e.elem || '', '', clean(e.bad || '').slice(0, 99)),
      ...(e.allowed ? [seg('NTE', 'GEN', clean(e.allowed).slice(0, 80))] : []),
    ]),
  ],
  997: (d) => [
    seg('AK1', d.group_id, d.group_ctl),
    seg('AK2', d.set_id, d.set_ctl),
    ...(d.seg_errors || []).map((e) => seg('AK3', e.seg, e.pos, '', e.code)),
    ...(d.elem_errors || []).map((e) => seg('AK4', e.pos, e.ref || '', e.code, clean(e.bad || '').slice(0, 99))),
    seg('AK5', d.result, d.result === 'R' ? (d.set_code || '5') : ''),
    seg('AK9', d.result, 1, 1, d.result === 'A' ? 1 : 0, d.group_code || ''),
  ],
  820: (d) => [
    seg('BPR', 'C', money(d.amount), 'C', 'ACH', 'CCP', '', '', '', '', '', '', '', '', '', '', d8(d.at)),
    seg('TRN', '1', d.ref),
    seg('N1', 'PR', clean(d.payer_name), 'UL', d.payer_gln),
    seg('N1', 'PE', clean(d.payee_name), 'UL', d.payee_gln),
    seg('ENT', 1),
    ...d.items.flatMap((i) => [
      seg('RMR', 'IV', i.invoice, '', money(i.paid), money(i.invoice_amount)),
      seg('REF', 'PO', i.po),
      ...(i.adjustments || []).flatMap((a) => [seg('ADX', money(a.amount), a.reason, 'CM', a.ref), ...(a.note ? [seg('NTE', 'PMT', clean(a.note).slice(0, 80))] : [])]),
    ]),
  ],
  940: (d) => [
    seg('W05', 'N', d.ref, d.po),
    seg('N1', 'WH', clean(d.site_name), 'UL', d.site_gln),
    seg('N1', 'ST', clean(d.ship_to_name), 'UL', d.ship_to_gln),
    seg('G62', '10', d8(d.ship_date)),
    ...d.lines.flatMap((l, i) => [seg('LX', i + 1), seg('W01', l.qty, 'CA', '', 'VN', l.sku)]),
    seg('W76', d.lines.reduce((a, l) => a + l.qty, 0)),
  ],
  945: (d) => [
    seg('W06', 'N', d.ref, d8(d.shipped_at), d.shipment_id, '', d.po),
    seg('N1', 'WH', clean(d.site_name), 'UL', d.site_gln),
    seg('G62', '11', d8(d.shipped_at), 'W', t4(d.shipped_at)),
    ...d.lines.flatMap((l, i) => [seg('LX', i + 1), seg('W12', l.shipped === l.ordered ? 'CC' : 'CP', l.ordered, l.shipped, l.ordered - l.shipped, 'CA', '', 'VN', l.sku)]),
    seg('W03', d.lines.reduce((a, l) => a + l.shipped, 0)),
  ],
  852: (d) => [
    seg('XQ', 'H', d8(d.period_start), d8(d.period_end)),
    seg('N1', 'BY', clean(d.buyer_name), 'UL', d.buyer_gln),
    seg('N1', 'VN', clean(d.vendor_name), 'UL', d.vendor_gln),
    ...d.items.flatMap((it) => [
      seg('LIN', '', 'UP', it.upc, 'VN', it.sku),
      ...['QS', 'QA'].flatMap((k) => {
        const rows = it.stores.map((s) => [s.store, k === 'QS' ? s.sold : s.on_hand]);
        const out = [seg('ZA', k)];
        for (let i = 0; i < rows.length; i += 10) out.push(seg('SDQ', it.uom || 'EA', '92', ...rows.slice(i, i + 10).flat()));
        return out;
      }),
    ]),
    seg('CTT', d.items.length),
  ],
};

/** One interchange holding one functional group and one transaction set. */
export function writeInterchange(d, { isaSender, isaReceiver, ctl }) {
  const body = BODY[d.type](d);
  const st = z(1, 4);
  const lines = [
    `ISA*00*${pad('', 10)}*00*${pad('', 10)}*ZZ*${pad(isaSender, 15)}*ZZ*${pad(isaReceiver, 15)}*${d8(d.at).slice(2)}*${t4(d.at)}*U*00401*${z(ctl, 9)}*0*P*>`,
    seg('GS', FUNC[d.type], isaSender, isaReceiver, d8(d.at), t6(d.at), ctl, 'X', '004010'),
    seg('ST', d.type, st),
    ...body,
    seg('SE', body.length + 2, st),
    seg('GE', 1, ctl),
    seg('IEA', 1, z(ctl, 9)),
  ];
  return lines.join('~\n') + '~\n';
}

/** Splits X12 text into interchanges with their transaction sets. Structure only; no business meaning. */
export function parseX12(text) {
  const out = [];
  let ic = null, gs = null, set = null;
  for (const raw of text.split('~')) {
    const s = raw.replace(/^[\r\n]+/, '');
    if (!s) continue;
    const e = s.split('*'); const tag = e[0];
    if (tag === 'ISA') { ic = { sender: e[6].trim(), receiver: e[8].trim(), ctl: Number(e[13]), groups: [] }; out.push(ic); }
    else if (tag === 'GS') { gs = { id: e[1], ctl: Number(e[6]), at: iso8(e[4], e[5]), version: e[8], sets: [] }; ic.groups.push(gs); }
    else if (tag === 'ST') { set = { type: e[1], ctl: e[2], segs: [] }; gs.sets.push(set); }
    else if (tag === 'SE') { set.count = Number(e[1]); set = null; }
    else if (tag === 'GE') { gs.count = Number(e[1]); gs = null; }
    else if (tag === 'IEA') { ic.count = Number(e[1]); ic = null; }
    else if (set) set.segs.push(e);
  }
  return out;
}

const items = (e, from) => { const o = {}; for (let i = from; i + 1 < e.length; i += 2) { if (e[i] === 'IN') o.nf_item = e[i + 1]; if (e[i] === 'VN') o.sku = e[i + 1]; if (e[i] === 'UK') o.gtin = e[i + 1]; if (e[i] === 'UP') o.upc = e[i + 1]; } return o; };
const n1 = (segs) => Object.fromEntries(segs.filter((e) => e[0] === 'N1').map((e) => [e[1], { name: e[2], gln: e[4] }]));
const first = (segs, tag, q) => segs.find((e) => e[0] === tag && (q == null || e[1] === q));

/** Business reading of one transaction set. */
const READ = {
  850: (S) => ({ po: first(S, 'BEG')[3], ref: first(S, 'BEG')[3], po_date: day8(first(S, 'BEG')[5]), programme: first(S, 'REF', '19')?.[2], requested_delivery: day8(first(S, 'DTM', '002')[2]), parties: n1(S),
    lines: S.filter((e) => e[0] === 'PO1').map((e) => ({ line: +e[1], qty: +e[2], uom: e[3], price: +e[4], ...items(e, 6) })), ctt_qty: +first(S, 'CTT')[2] }),
  855: (S) => { const b = first(S, 'BAK'); const lines = []; for (const e of S) { if (e[0] === 'PO1') lines.push({ line: +e[1], qty_ordered: +e[2], price: +e[4], ...items(e, 6) }); if (e[0] === 'ACK') { const l = lines[lines.length - 1]; if (l.code && e[1] === 'IB') Object.assign(l, { code: 'IB', backorder: +e[2], qty: l.qty + +e[2] }); else Object.assign(l, { code: e[1], qty: +e[2], date: day8(e[5]) }); } } return { po: b[3], ref: b[8], ack_type: b[2], lines }; },
  860: (S) => { const b = first(S, 'BCH'); const changes = []; for (const e of S) { if (e[0] === 'POC') changes.push({ line: +e[1], code: e[2], qty: +e[3], price: +e[6], ...items(e, 8) }); if (e[0] === 'DTM' && e[1] === '002') changes[changes.length - 1].date = day8(e[2]); } return { po: b[3], seq: +b[5], ref: `${b[3]} Change ${+b[5]}`, changes }; },
  865: (S) => { const b = first(S, 'BCA'); const lines = []; for (const e of S) { if (e[0] === 'POC') lines.push({ line: +e[1], qty_ordered: +e[3], price: +e[6], ...items(e, 8) }); if (e[0] === 'ACK') Object.assign(lines[lines.length - 1], { code: e[1], qty: +e[2], date: day8(e[5]) }); } return { po: b[3], seq: +b[5], ref: first(S, 'REF', 'ZZ')[2], lines }; },
  856: (S) => {
    const b = first(S, 'BSN'); const dep = first(S, 'DTM', '011');
    const cartons = []; const lines = new Map(); let sscc = null; let level = null; let status = null;
    for (const e of S) {
      if (e[0] === 'HL') { level = e[3]; if (level !== 'I') sscc = null; }
      if (e[0] === 'MAN' && e[1] === 'GM') sscc = e[2];
      if (e[0] === 'LIN') { const l = { line: +e[1], ...items(e, 2), qty: 0 }; if (!lines.has(l.line)) lines.set(l.line, l); lines._cur = l.line; }
      if (e[0] === 'SN1') { const l = lines.get(lines._cur); l.qty += +e[2]; l.uom = e[3]; if (e[8]) status = e[8]; if (sscc) cartons.push({ sscc, line: l.line, sku: l.sku, qty: +e[2] }); }
    }
    return { ref: b[2], resend: b[1] === '05', structure: b[5], po: first(S, 'PRF')[1], po_ref: first(S, 'PRF')[1], carton_count: +first(S, 'TD1')[2], scac: first(S, 'TD5')?.[3] || null, bol: first(S, 'REF', 'BM')?.[2] || null, seal: first(S, 'REF', 'SN')?.[2] || null,
      shipped_at: iso8(dep[2], dep[3] + '00'), delivery_date: day8(first(S, 'DTM', '017')[2]), parties: n1(S), lines: [...lines.values()], cartons, complete: status !== 'BP', hl_count: +first(S, 'CTT')[1] };
  },
  810: (S) => { const b = first(S, 'BIG'); return { ref: b[2], po: b[4], po_ref: b[4], replaces: first(S, 'REF', 'OI')?.[2] || null, parties: n1(S), terms_days: +first(S, 'ITD')[7],
    lines: S.filter((e) => e[0] === 'IT1').map((e) => ({ line: +e[1], qty: +e[2], uom: e[3], price: +e[4], ...items(e, 6) })), total: +first(S, 'TDS')[1] / 100 }; },
  861: (S) => { const b = first(S, 'BRA'); const dt = first(S, 'DTM', '050'); const lines = []; for (const e of S) { if (e[0] === 'RCD') lines.push({ line: +e[1], qty: +e[2], short: e[6] ? +e[6] : 0, not_scanned: [] }); if (e[0] === 'LIN') Object.assign(lines[lines.length - 1], items(e, 2)); if (e[0] === 'MAN') lines[lines.length - 1].not_scanned.push(e[2]); }
    return { ref: b[1], po: first(S, 'PRF')[1], asn_ref: first(S, 'REF', 'SI')[2], received_at: iso8(dt[2], dt[3] + '00'), parties: n1(S), lines }; },
  824: (S) => { const b = first(S, 'BGN'); const o = first(S, 'OTI'); const errors = []; for (const e of S) { if (e[0] === 'TED') errors.push({ code: e[1], cause: e[2], seg: e[3] || null, elem: e[5] || null, bad: e[7] || null, allowed: null }); if (e[0] === 'NTE' && errors.length) errors[errors.length - 1].allowed = e[2]; }
    return { ref: b[2], action: o[1], answers_ref: o[3], answers_gs: +o[8], answers_st: o[9], answers_set: o[10], errors }; },
  997: (S) => { const a1 = first(S, 'AK1'), a2 = first(S, 'AK2'), a5 = first(S, 'AK5'), a9 = first(S, 'AK9');
    return { ref: `FA-${a1[2]}`, group_id: a1[1], group_ctl: +a1[2], set_id: a2[1], set_ctl: a2[2], result: a5[1], set_code: a5[2] || null, group_code: a9[5] || null,
      seg_errors: S.filter((e) => e[0] === 'AK3').map((e) => ({ seg: e[1], pos: +e[2], code: e[4] })), elem_errors: S.filter((e) => e[0] === 'AK4').map((e) => ({ pos: +e[1], ref: e[2] || null, code: e[3], bad: e[4] || null })) }; },
  820: (S) => { const itemsOut = []; for (const e of S) { if (e[0] === 'RMR') itemsOut.push({ invoice: e[2], paid: +e[4], invoice_amount: +e[5], adjustments: [] }); if (e[0] === 'REF' && e[1] === 'PO' && itemsOut.length) itemsOut[itemsOut.length - 1].po = e[2]; if (e[0] === 'ADX') itemsOut[itemsOut.length - 1].adjustments.push({ amount: +e[1], reason: e[2], ref: e[4], note: null }); if (e[0] === 'NTE' && e[1] === 'PMT') { const adj = itemsOut[itemsOut.length - 1].adjustments; adj[adj.length - 1].note = e[2]; } }
    return { ref: first(S, 'TRN')[2], amount: +first(S, 'BPR')[2], pay_date: day8(first(S, 'BPR')[16]), parties: n1(S), items: itemsOut, po: itemsOut[0]?.po || null }; },
  940: (S) => { const w = first(S, 'W05'); return { ref: w[2], po: w[3], parties: n1(S), ship_date: day8(first(S, 'G62', '10')[2]), lines: S.filter((e) => e[0] === 'W01').map((e) => ({ qty: +e[1], sku: e[5] })) }; },
  945: (S) => { const w = first(S, 'W06'); const g = first(S, 'G62', '11'); return { ref: w[2], po: w[6], shipment_id: w[4], parties: n1(S), shipped_at: iso8(g[2], g[4] + '00'), lines: S.filter((e) => e[0] === 'W12').map((e) => ({ ordered: +e[2], shipped: +e[3], sku: e[8] })), units: +first(S, 'W03')[1] }; },
  852: (S) => { const x = first(S, 'XQ'); const its = []; let k = null; for (const e of S) { if (e[0] === 'LIN') its.push({ upc: e[3], sku: e[5], stores: new Map() }); if (e[0] === 'ZA') k = e[1]; if (e[0] === 'SDQ') for (let i = 3; i + 1 < e.length; i += 2) { const m = its[its.length - 1].stores; const r = m.get(e[i]) || { store: e[i], sold: 0, on_hand: 0 }; r[k === 'QS' ? 'sold' : 'on_hand'] = +e[i + 1]; m.set(e[i], r); } }
    return { ref: `PA-${x[2]}-${x[3]}`, po: null, period_start: day8(x[2]), period_end: day8(x[3]), parties: n1(S), items: its.map((i) => ({ ...i, stores: [...i.stores.values()] })) }; },
};

/** Reads every transaction set in X12 text into business documents with envelope identity. */
export function readDocuments(text, source = null) {
  const docs = [];
  for (const ic of parseX12(text)) for (const g of ic.groups) for (const s of g.sets) {
    const read = READ[s.type];
    if (!read) throw new Error(`No reader for transaction set ${s.type}`);
    docs.push({ type: s.type, isa_sender: ic.sender, isa_receiver: ic.receiver, isa_ctl: ic.ctl, gs_ctl: g.ctl, st_ctl: s.ctl, at: g.at, segments: s.segs.length + 2, se_count: s.count, source, ...read(s.segs) });
  }
  return docs;
}
