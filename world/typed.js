// T1.11: masters, dated values, the document flow and typed records read from the event log.
// Nothing here changes an existing record; every table it fills is new, and the extra master rows (stores, supplier
// ship-from points, other suppliers' items) only give existing references a row to point at.
import * as ref from './ref.js';
import { HISTORY_START, unitsPerCase } from './ref.js';
import { gs1Check } from './lib.js';
import { STAGE_BY_TYPE, STAGES } from './stages/index.js';

// ---------- masters ----------
export function locationRows() {
  const supplierPoints = ref.supplierShipPoints(ref.parties.filter((p) => p.kind === 'Supplier' && p.id !== 'ASHBY').map((p) => p.gln));
  // A party whose locations a stage reads from its documents (T1.18: Northfield's 816) gets its rows from that stage's derive().
  const derived = new Set(STAGES.flatMap((s) => s.derivesLocationsOf || []));
  return [...ref.locations.map((l) => ({ ...l, store_number: ref.STORE_NUMBER[l.id] ?? null })), ...ref.moreLocations, ...supplierPoints].filter((l) => !derived.has(l.party_id));
}

/** Other suppliers' items, from Northfield's open-order fixture (P8) and the closed prior period. Each gets one master row
 * so every order line names an item that exists; the master takes its values from the first order that carried the item.
 * Those fixtures give each order line its own Northfield item number and price, and the order lines keep theirs, so no
 * figure moves. Ashby's, Brookline's and Cedar & Pine's items are set up in ref.js. */
export function otherItems(T) {
  const known = new Set(ref.items.map((i) => i.sku)); const sup = new Map(T.orders.map((o) => [o.po, o]));
  const first = new Map();
  for (const l of [...T.order_lines].sort((a, b) => (sup.get(a.po).received_at < sup.get(b.po).received_at ? -1 : 1))) if (!known.has(l.sku) && !first.has(l.sku)) first.set(l.sku, { l, o: sup.get(l.po) });
  return [...first.values()].sort((a, b) => a.l.sku.localeCompare(b.l.sku)).map(({ l, o }, i) => {
    const party = ref.PARTY[o.supplier_id]; const body = `1061414170${String(i).padStart(3, '0')}`;
    return { sku: l.sku, supplier_id: o.supplier_id, description: `${party.name} ${String(party.category || 'item').toLowerCase()} line ${l.sku.split('-').pop()}`, gtin: body + gs1Check(body), pack: 'Each', case_price: l.price_original ?? l.price, northfield_item: l.northfield_item, on_northfield_list: 1 };
  });
}

export function ruleRows(rules) {
  const sets = ref.ruleSets; const set = Object.fromEntries(sets.map((s) => [s.id, s]));
  const versions = [];
  for (const r of rules) {
    const own = set[r.rule_set]; if (!own) throw new Error(`Rule ${r.id} is in unknown rule set ${r.rule_set}`);
    const cur = { rule_id: r.id, rule_set: r.rule_set, valid_from: own.valid_from, valid_to: own.valid_to, statement: r.statement, params: r.params ? JSON.stringify(r.params) : null, window_hours: r.window_hours, limit_value: r.limit_value, charge: r.charge };
    versions.push(cur);
    if (r.rule_set === 'northfield-2026.2') {
      const prev = set['northfield-2026.1']; const ch = ref.earlierVersions.find((v) => v.rule_id === r.id && v.rule_set === prev.id);
      versions.push({ ...cur, rule_set: prev.id, valid_from: prev.valid_from, valid_to: prev.valid_to, ...(ch ? { statement: ch.statement, params: ch.params ? JSON.stringify(ch.params) : cur.params, limit_value: ch.limit_value ?? cur.limit_value } : {}) });
    }
  }
  for (const v of ref.earlierVersions) if (!rules.some((r) => r.id === v.rule_id)) throw new Error(`Earlier version of unknown rule ${v.rule_id}`);
  return { rule_sets: sets, rule_versions: versions };
}

export function itemRows() {
  const base = ref.items;
  const item_versions = base.map((i) => {
    const marketplace = i.sku === 'AHP-8820';
    return { sku: i.sku, version: 1, valid_from: marketplace ? '2026-09-27' : HISTORY_START, valid_to: null, description: i.description, pack: i.pack, units_per_case: unitsPerCase(i.pack),
      accepted_by: i.on_northfield_list && !marketplace ? 'NORTHFIELD' : null, accepted_at: i.on_northfield_list && !marketplace ? '2026-02-27T15:00:00.000Z' : null };
  });
  const item_prices = base.map((i) => ({ sku: i.sku, price_list: 'Northfield cost', uom: 'CA', amount: i.case_price, valid_from: i.sku === 'AHP-8820' ? '2026-09-27' : HISTORY_START, valid_to: null, source: 'Item setup' }));
  return { item_versions, item_prices };
}

// ---------- typed records from the event log ----------
export function typedFromEvents(events) {
  const shipment_plans = [], warehouse_scans = [], carrier_events = [];
  for (const e of events) {
    const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data || {};
    if (e.kind === 'erp.shipment_planned') shipment_plans.push({ event_id: e.id, at: e.at, po: e.po, shipment: d.shipment, planned_departure: d.planned_departure ?? null, site: d.site ?? null, carrier: d.carrier ?? null, cartons: d.cartons ?? null });
    else if (e.kind.startsWith('wms.') && e.kind !== 'wms.inventory') warehouse_scans.push({ event_id: e.id, at: e.at, po: e.po, system: e.system, kind: e.kind.slice(4), shipment: d.shipment ?? null,
      cartons_loaded: d.cartons_loaded ?? d.cartons_packed ?? d.cartons ?? null, cartons_expected: d.cartons_expected ?? null, by_sscc: d.by_sscc == null ? null : d.by_sscc ? 1 : 0,
      line: d.line ?? null, sku: d.sku ?? null, ordered: d.ordered ?? null, picked: d.picked ?? null, site: d.site ?? null, note: d.note ?? (d.reused_sscc ? `${d.reused_sscc} SSCCs first used on ${d.first_used_on}` : null) });
    else if (e.kind.startsWith('carrier.')) carrier_events.push({ event_id: e.id, at: e.at, po: e.po, kind: e.kind.slice(8), shipment: d.shipment ?? null, delivered: d.delivered ?? null, exceptions: d.exceptions ?? null,
      seal: d.seal ?? null, bol: d.bol ?? null, assigned_pickup: d.assigned_pickup ?? null, note: d.note ?? (d.claim ? `Claim ${d.claim}: ${d.basis}, ${d.amount}` : null) });
  }
  return { shipment_plans, warehouse_scans, carrier_events };
}

// ---------- the document flow ----------
/** Types that start a flow: a purchase order, and Northfield's store activity report, which answers no document. */
export const ORIGINS = new Set(['850', '852', ...STAGES.flatMap((s) => s.origins || [])]);

/** Each document's predecessor, read from the documents themselves (references and time), never from the generator. */
export function documentLinks(docs, ctx) {
  const byPo = new Map(); const byId = new Map(docs.map((d) => [d.doc_id, d]));
  for (const d of docs) if (d.po) (byPo.get(d.po) || byPo.set(d.po, []).get(d.po)).push(d);
  const latest = (po, type, before, f = () => true) => { let r = null; for (const x of byPo.get(po) || []) if (x.type === type && x.at <= before && x !== null && f(x)) r = x; return r; };
  const inv810 = new Map(); for (const d of docs) if (d.type === '810' && !d.rejected) inv810.set(d.ref, d);
  const links = []; const add = (d, p, kind) => { if (p && p.doc_id !== d.doc_id && !links.some((l) => l.doc_id === d.doc_id && l.prev_doc_id === p.doc_id)) links.push({ doc_id: d.doc_id, prev_doc_id: p.doc_id, kind }); };
  for (const d of docs) {
    if (d.type === '997' || d.type === '824') { add(d, byId.get(d.answers), 'answers'); continue; }
    if (d.answers) add(d, byId.get(d.answers), 'corrects');
    const before = d.at;
    switch (d.type) {
      case '855': add(d, latest(d.po, '850', before), 'acknowledges'); break;
      case '860': add(d, d.seq > 1 ? latest(d.po, '860', before, (x) => x.seq === d.seq - 1) || latest(d.po, '850', before) : latest(d.po, '850', before), 'changes'); break;
      case '865': add(d, latest(d.po, '860', before, (x) => x.seq === d.seq) || latest(d.po, '860', before), 'answers change'); break;
      case '940': add(d, latest(d.po, '850', before), 'fulfils'); break;
      case '945': add(d, latest(d.po, '940', before), 'confirms'); break;
      case '856': if (!d.answers) add(d, latest(d.po, '945', before) || latest(d.po, '855', before) || latest(d.po, '850', before), 'ships'); break;
      case '861': add(d, latest(d.po, '856', before, (x) => x.ref === d.asn_ref) || latest(d.po, '856', before), 'receives'); break;
      case '810': if (d.replaces) add(d, inv810.get(d.replaces), 'replaces'); add(d, latest(d.po, '856', before) || latest(d.po, '850', before), 'bills'); break;
      case '820': for (const i of d.items) add(d, inv810.get(i.invoice), 'pays'); break;
      default: { const s = STAGE_BY_TYPE[d.type]; if (s?.prev) for (const p of s.prev(d, { ...ctx, latest, byId, byPo })) add(d, typeof p.doc === 'object' ? p.doc : byId.get(p.doc_id), p.kind); }
    }
  }
  return links;
}
