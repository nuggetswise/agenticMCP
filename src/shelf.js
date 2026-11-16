// Shelf Agent runtime for P9 Shelf Recovery. A session branches when Northfield's weekly store activity report (852) is read,
// Monday 26 October 2026 08:07 ET (or 17:30 ET, when a ship notice to store 114 is in transit). For each store an empty
// shelf leads to a new order, a transfer from a slow store, or a wait for goods already on the way. Priya Raman approves
// each recommendation; Jordan Ellis decides the order in Northfield's own system. Northfield's purchase order, the ship
// notice, the receipt and the next week's 852 are recorded records revealed at their time; answers with no record behind
// them are synthetic. Rule baseline: a carton-multiple order for every empty shelf (AP-6.4).
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { shelfDecision } from './agents.js';
import { makeRuntime, MIN, H, iso, J } from './runtime.js';
import { z } from 'zod';

const st = (s) => (s.state.sh ||= { recs: {}, orders: {}, waits: {} });
function stores(db, s) {
  const wk = db.prepare("SELECT max(period_end) p FROM store_activity WHERE sent_at <= ?").get(iso(s.branch)).p;
  return db.prepare('SELECT DISTINCT store FROM store_activity WHERE period_end = ? ORDER BY store').all(wk).map((r) => r.store);
}
function decision(db, s, store) { const d = shelfDecision(db, store, new Date(s.branch)); return d.found === false ? null : d; }
function rows(db, s) { const k = st(s); const out = [];
  for (const store of stores(db, s)) { const d = decision(db, s, store); if (!d) continue; const ev = d.evidence;
    if (d.next_step === 'nothing_to_do' && ev.on_hand > 0) continue;
    const rec = k.recs[store], ord = k.orders[store], wait = k.waits[store];
    out.push({ id: `Store ${store}`, record: store, what: `${ev.sold} sold, ${ev.on_hand} on hand, ${ev.weekly_average} a week average${ev.weeks_of_supply != null ? `, ${ev.weeks_of_supply} weeks of supply` : ''}${ev.ship_notice_in_transit !== 'None' ? `; ${ev.ship_notice_in_transit} in transit` : ''}`,
      state: ord?.refilled ? `Refilled: ${ord.refilled}` : ord?.sales_order ? `Sales order ${ord.sales_order}; shipping` : ord?.po ? `Purchase order ${ord.po} received` : rec ? `Recommended to Jordan Ellis: ${rec.what}` : wait ? 'Waiting for goods in transit' : 'Open',
      closed: !!(ord?.refilled || wait || (rec && rec.kind === 'transfer')) }); }
  return out; }
const PO_114 = { po: 'NR-451207', at: '2026-10-26T14:20:00.000Z', pairs: 40 };

const spec = {
  agent: 'Shelf Agent', prefix: 'SH', person: 'Priya Raman', company: 'Ashby Supplier', prototype: 'P9 Shelf Recovery',
  toolText: 'Northfield’s weekly store activity for ASH-TRL-09',
  moments: { '2026-10-26 08:07 ET': '2026-10-26T12:07:00.000Z', '2026-10-26 17:30 ET': '2026-10-26T21:30:00.000Z' }, defaultMoment: '2026-10-26 08:07 ET', horizonHours: 24 * 8, queueNoun: 'stores',
  goal: 'Refill every empty Northfield shelf of ASH-TRL-09 with the right move: a new order, a transfer from a slow store, or a wait for goods already on the way. The job is done when the next store activity report shows the shelf refilled.',
  instruction: `Read the store activity, Ashby's available stock and ship notices in transit. Empty shelf, nothing in transit and stock available: recommend a new order in whole cartons sized from the weekly average (AP-6.1, AP-6.4; read_store gives each rule as it stands). Empty shelf with goods in transit: wait, and recommend nothing. Slow sell-through with the weeks of supply AP-6.2 sets: recommend a transfer leaving the weeks AP-6.3 keeps at the sending store (AP-6.2, AP-6.3). Jordan Ellis decides every order; a sales order is created only after Northfield's purchase order arrives.`,
  opening: () => 'Northfield’s weekly store activity report (852) for ASH-TRL-09 was read.',
  facts: {
    moment: { values: ['2026-10-26 08:07 ET', '2026-10-26 17:30 ET'], recorded: '2026-10-26 08:07 ET', owner: 'Presenter', says: 'Story moment: 08:07 (nothing in transit) or 17:30 (ASN-451207-1 in transit to store 114)' },
    jordan_orders: { values: ['as_recommended', 'no_order'], recorded: 'as_recommended', owner: 'Northfield', says: 'Whether Jordan Ellis orders after a recommendation (as recorded: NR-451207 for 40 pairs to store 114)' },
  },
  variations: { canonical: {}, in_transit: { moment: '2026-10-26 17:30 ET' }, jordan_declines: { jordan_orders: 'no_order' } },
  actions: {
    recommend_order: { label: 'Recommend a new order to Jordan Ellis', actor: 'Jordan Ellis (recommendation from Trading Grid)', rule: 'AP-6.4', mode: 'approve', editable: true, args: ['record', 'pairs'] },
    recommend_transfer: { label: 'Recommend a store-to-store transfer to Jordan Ellis', actor: 'Jordan Ellis (recommendation from Trading Grid)', rule: 'AP-6.3', mode: 'approve', editable: true, args: ['record', 'pairs', 'to_store'] },
    wait_for_transit: { label: 'Record that the store waits for goods already in transit; nothing is sent', actor: 'Trading Grid', rule: 'AP-6.1', mode: 'policy', editable: false, args: ['record'] },
    create_sales_order: { label: 'Create the sales order in the Supplier ERP from Northfield’s purchase order', actor: 'Supplier ERP', rule: 'AP-3.2', mode: 'approve', editable: true, args: ['record'] },
  },
  argTypes: { pairs: z.number().int() },
  guardrails: [
    { id: 'NF-7.7', owner: 'Administrator', text: 'Jordan Ellis decides every order; Shelf Agent only recommends.' },
    { id: 'AP-3.2', owner: 'Administrator', text: 'Nothing is reserved or created in the Supplier ERP until Northfield’s purchase order arrives.' },
  ],
  queue: (db, s) => ({ as_of: fmtET(iso(s.clock)), rows: rows(db, s) }),
  reads: {
    read_store: { description: 'One store’s activity at the session clock: last week sold and on hand, the 4-week average, weeks of supply, the chain median, any ship notice in transit to it, and Ashby’s available stock.', input: { record: z.string().describe('Store number, for example 114') },
      run: (db, s, a) => { const d = decision(db, s, String(a.record)); return d ? { store: String(a.record), evidence: d.evidence, rules: ['AP-6.1', 'AP-6.2', 'AP-6.3', 'AP-6.4'].map((id) => D.rule(db, id)), session: { recommendation: st(s).recs[a.record] || null, order: st(s).orders[a.record] || null } } : { found: false }; } },
    read_stores: { description: 'Every store in the latest store activity report with sold, on hand and weekly average.', input: {},
      run: (db, s) => ({ stores: stores(db, s).map((x) => { const d = decision(db, s, x); return { store: x, sold: d?.evidence.sold, on_hand: d?.evidence.on_hand, weekly_average: d?.evidence.weekly_average }; }) }) },
  },
  validate: (db, s, action, a) => { const k = st(s); const store = String(a.record || ''); const d = decision(db, s, store); if (!d) return `No store activity for store ${store}.`; const ev = d.evidence;
    switch (action) {
      case 'recommend_order': if (ev.on_hand > 0) return `Store ${store} has ${ev.on_hand} on hand; an order is for an empty shelf (AP-6.1).`; { const carton = D.param(db, 'AP-6.4', 'carton'); if (!a.pairs || a.pairs % carton) return `AP-6.4: whole cartons of ${carton} pairs.`; } if (k.recs[store]) return 'Already recommended.'; if (a.pairs > ev.ashby_available) return `Ashby has ${ev.ashby_available} pairs available.`; return null;
      case 'recommend_transfer': if (!a.to_store || !a.pairs) return 'Give pairs and to_store.'; if (a.pairs > ev.on_hand) return `Store ${store} has ${ev.on_hand} on hand.`; if (k.recs[store]) return 'Already recommended.'; return null;
      case 'wait_for_transit': if (ev.ship_notice_in_transit === 'None') return `Nothing is in transit to store ${store}.`; if (k.waits[store]) return 'Already waiting.'; return null;
      case 'create_sales_order': if (!k.orders[store]?.po) return `No purchase order from Northfield for store ${store} yet; nothing is created before it arrives.`; if (k.orders[store].sales_order) return 'The sales order exists.'; return null; }
    return null; },
  execute: (db, s, p, by, ctx) => { const a = p.args; const k = st(s); const store = String(a.record); s.clock += 2 * MIN;
    switch (p.action) {
      case 'recommend_order': { k.recs[store] = { kind: 'order', what: `${a.pairs} pairs`, at: fmtET(iso(s.clock)) }; k.orders[store] = {};
        if (s.facts.jordan_orders === 'as_recommended') { const recorded = store === '114' && Date.parse(PO_114.at) > s.branch; const po = recorded ? PO_114.po : `NR-S${s.id.slice(3, 7).toUpperCase()}`; const at = recorded ? iso(Math.max(Date.parse(PO_114.at), s.clock + 30 * MIN)) : iso(s.clock + 2 * H);
          ctx.schedule(s, { key: `po:${store}`, at, record: store, reference: po, actor: recorded ? 'Northfield ordering (recorded)' : 'Northfield ordering (synthetic)', synthetic: !recorded, what: `Northfield purchase order ${po} for ${recorded ? PO_114.pairs : a.pairs} pairs to store ${store} (EDI 850)`, on: () => { k.orders[store].po = po; } }); }
        return { state: 'Sent', response: `Recommendation sent to Jordan Ellis: ${a.pairs} pairs for store ${store}; no order or reservation is created` }; }
      case 'recommend_transfer': k.recs[store] = { kind: 'transfer', what: `${a.pairs} pairs to store ${a.to_store}`, at: fmtET(iso(s.clock)) }; return { state: 'Sent', response: `Transfer recommendation sent to Jordan Ellis: ${a.pairs} pairs from store ${store} to store ${a.to_store}` };
      case 'wait_for_transit': k.waits[store] = { at: fmtET(iso(s.clock)) }; return { state: 'Completed', response: `Store ${store} waits for the goods in transit; nothing sent` };
      case 'create_sales_order': { const o = k.orders[store]; o.sales_order = o.po === PO_114.po ? 'SO-451207' : `SO-S${s.id.slice(3, 7)}`;
        if (o.po === PO_114.po) { ctx.schedule(s, { key: `asn:${store}`, at: '2026-10-26T20:05:00.000Z', record: store, reference: 'ASN-451207-1', actor: 'Trading Grid (recorded)', what: 'Ship notice ASN-451207-1 sent: 40 pairs to store 114' });
          ctx.schedule(s, { key: `rcv:${store}`, at: '2026-10-27T13:10:00.000Z', record: store, reference: 'RCV-S114-51207', actor: 'Northfield receiving (recorded)', what: 'Store 114 received 40 pairs (RCV-S114-51207)' });
          ctx.schedule(s, { key: `852:${store}`, at: '2026-11-01T11:10:00.000Z', record: store, actor: 'Northfield store activity (recorded)', what: 'Next store activity report: store 114 sold 31, 9 on hand', on: () => { o.refilled = '31 sold, 9 on hand in the next report'; } }); }
        return { state: 'Completed', response: `Sales order ${o.sales_order} created in the Supplier ERP from ${o.po}` }; } }
    return { state: 'Refused', response: 'Unknown action' }; },
  baseline: (db, s, act) => { const k = st(s);
    for (const r of rows(db, s)) { const d = decision(db, s, r.record);
      if (k.orders[r.record]?.po && !k.orders[r.record].sales_order) act('create_sales_order', { record: r.record });
      else if (d.evidence.on_hand === 0 && !k.recs[r.record]) act('recommend_order', { record: r.record, pairs: Math.max(40, Math.ceil(d.evidence.weekly_average / 40) * 40) }); } },
  outcome: (db, s) => { const k = st(s); const violations = [];
    for (const [store, r] of Object.entries(k.recs)) { const d = decision(db, s, store); if (r.kind === 'order' && d.evidence.ship_notice_in_transit !== 'None') violations.push(`Store ${store}: order recommended while ${d.evidence.ship_notice_in_transit} was in transit (duplicate stock)`); }
    return { as_of: fmtET(iso(s.clock)), recommendations: k.recs, orders: k.orders, waits: Object.keys(k.waits), refilled: Object.entries(k.orders).filter(([, o]) => o.refilled).map(([st2, o]) => `Store ${st2}: ${o.refilled}`), violations,
      synthetic: 'Store 114’s purchase order, ship notice, receipt and next report are recorded; any other order is synthetic, from src/shelf.js.' }; },
};
export const Shelf = makeRuntime(spec);
