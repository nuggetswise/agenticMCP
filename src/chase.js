// Chase Agent runtime for P19 Ship notice chase (Northfield side). A session branches Northfield's records at Wednesday
// 9 December 2026 17:00 ET, two hours after Lakeline's assigned pickups on Ashby's collect freight from Kinross. On collect
// freight Northfield routes the load and Lakeline is its carrier (NF-3.3), so Lakeline's shipment status (214) is Northfield's
// own record. Chase Agent reads the routing instructions (754), the 214s and the ship notices (856) and picks the next step
// from which trail is wrong:
//   arrived, not ready (X3 SD), no ship notice  -> the load never left: no ship notice is due yet (NF-4.2 runs from departure);
//                                                  record the readiness failure for Jordan to decide (RT01, NF-3.6) and show
//                                                  that Ashby owns the new ready time (its new routing request)
//   departed (X3 AF), no ship notice after 1 h  -> show that Ashby owes the ship notice (NF-4.2); it stays Late when it arrives
//   no carrier status at all                    -> show that Lakeline owns the status; its next 214 confirms it
//   ship notice says shipped, carrier says not  -> reject the ship notice with an 824 before the load reaches the DC (NF-4.2)
// Recorded records after the branch (Lakeline's later 214s, Ashby's ship notices, receiving advice) arrive at their time.
// Presets add three synthetic trails on NR-46602, NR-46609 and NR-46616. Rule baseline: chase every order with no ship
// notice an hour after its assigned pickup.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { makeRuntime, MIN, H, iso, J } from './runtime.js';
import { z } from 'zod';

const NOT_ASHBY = 'Not available to Northfield';
const st = (s) => (s.state.ch ||= { requests: {}, charges: {}, carrier: {}, corrections: {} });
const status214 = (ref) => { const m = String(ref).match(/\s([A-Z0-9]{2})\+([A-Z0-9]{2})$/); return m ? { event: m[1], reason: m[2], says: m[2] === 'AF' ? 'Departed pickup location' : m[2] === 'SD' ? 'Arrived at pickup; shipment not ready' : m[2] === 'D1' ? 'Delivered' : `${m[1]} ${m[2]}` } : null; };
function synthetic(s) {
  const f = s.facts; const out = [];
  if (f.carrier_departed_46602 === 'yes') out.push({ po: 'NR-46602', doc_type: '214', reference: 'PRO-46602 X3+AF', sent_at: '2026-12-09T20:12:00.000Z', synthetic: true, replaces: 'X3+SD' });
  if (f.carrier_silent_46609 === 'yes') out.push({ po: 'NR-46609', hide214: true });
  if (f.asn_before_pickup_46616 === 'yes') out.push({ po: 'NR-46616', doc_type: '856', reference: 'ASN-46616-E', sent_at: '2026-12-09T20:05:00.000Z', synthetic: true, says: 'Shipped 15:00 ET, 77 cartons' });
  return out;
}
function docs(nf, s, po) {
  const syn = synthetic(s).filter((x) => x.po === po);
  let rec = nf.prepare("SELECT doc_type, reference, sent_at FROM documents WHERE po = ? AND sent_at <= ? AND doc_type IN ('753','754','214','856','861','997') ORDER BY sent_at").all(po, iso(s.branch)).map((d) => ({ ...d, source: 'Recorded' }));
  if (syn.some((x) => x.hide214)) rec = rec.filter((d) => d.doc_type !== '214');
  if (syn.some((x) => x.replaces)) rec = rec.filter((d) => !(d.doc_type === '214' && d.reference.endsWith(syn.find((x) => x.replaces).replaces)));
  const rev = s.revealed.filter((r) => r.po === po && r.doc && Date.parse(r.at) <= s.clock).map((r) => ({ doc_type: r.doc.doc_type, reference: r.doc.reference, sent_at: r.at, source: r.synthetic ? 'Synthetic' : 'Recorded (arrived later)' }));
  return [...rec, ...syn.filter((x) => x.doc_type).map((x) => ({ doc_type: x.doc_type, reference: x.reference, sent_at: x.sent_at, source: 'Synthetic (preset)', says: x.says })), ...rev].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
}
function routed(nf, s) {
  return nf.prepare("SELECT r.po, r.pickup_from, r.pickup_to, r.cartons, r.ship_from, r.ship_to, r.load_id FROM routing_requests r JOIN orders o ON o.po = r.po WHERE o.supplier_id = 'ASHBY' AND r.status = 'Routed' AND r.pickup_from <= ? AND r.pickup_from >= ? ORDER BY r.pickup_from, r.po")
    .all(iso(s.branch - H), iso(s.branch - 26 * H));
}
function trailOf(nf, s, r) {
  const d = docs(nf, s, r.po); const last214 = d.filter((x) => x.doc_type === '214').map((x) => ({ ...x, ...status214(x.reference) })).filter((x) => x.reason !== 'D1').pop() || null;
  const asn = d.filter((x) => x.doc_type === '856').pop() || null; const rcv = d.filter((x) => x.doc_type === '861').pop() || null; const dep = last214?.reason === 'AF' ? last214.sent_at : null;
  let kind;
  if (rcv) kind = 'received';
  else if (asn && last214?.reason === 'SD') kind = 'disagree';
  else if (asn) kind = 'ok';
  else if (!last214) kind = 'carrier_silent';
  else if (last214.reason === 'SD') kind = 'not_ready';
  else if (dep && s.clock - Date.parse(dep) > H) kind = 'asn_missing';
  else kind = 'ok';
  return { po: r.po, assigned_pickup: `${fmtET(r.pickup_from)} to ${fmtET(r.pickup_to).slice(11)}`, cartons: r.cartons, ship_from: r.ship_from === 'KIN-GRV' ? 'Kinross Groveport' : 'Kinross Joliet', ship_to: r.ship_to, load: r.load_id, carrier_status: last214 ? `${last214.says} (${fmtET(last214.sent_at)})` : 'None received', ship_notice: asn ? `${asn.reference} at ${fmtET(asn.sent_at)}${asn.says ? `: ${asn.says}` : ''}` : 'None', receiving_advice: rcv ? rcv.reference : 'None', kind, documents: d };
}
const STATE = { not_ready: 'Not picked up: not ready', asn_missing: 'Departed; no ship notice', carrier_silent: 'No carrier status', disagree: 'Ship notice and carrier disagree', received: 'Received', ok: 'On track' };

const spec = {
  agent: 'Chase Agent', prefix: 'CH', person: 'Jordan Ellis', company: 'Northfield Retailer', prototype: 'P19 Ship notice chase',
  toolText: 'inbound collect-freight orders with no usable ship notice',
  moments: { '2026-12-09 17:00 ET': '2026-12-09T22:00:00.000Z' }, defaultMoment: '2026-12-09 17:00 ET', horizonHours: 48, queueNoun: 'inbound orders',
  goal: 'Every inbound order reaches DC 2 with a usable ship notice, or its readiness failure is recorded for Jordan Ellis to decide. Chase the party whose record is wrong, not the deadline.',
  instruction: `Work the inbound Kinross loads Northfield routed with Lakeline. For each order read the routing instructions, Lakeline's status (214) and any ship notice. A load the carrier found not ready has not left: no ship notice is due yet (NF-4.2 runs from departure), so propose recording the readiness failure for Jordan (RT01, NF-3.6) and show that Ashby owns the new ready time (its new routing request rebooks the pickup); never chase a ship notice for it. A load that departed with no ship notice an hour later: show that Ashby owes the ship notice; it stays Late. No carrier status at all: show that Lakeline owns the status and wait for its next 214 before looking at Ashby. A ship notice that says shipped while the carrier says not picked up: reject it with an application advice (EDI 824) before the load reaches the DC. Trading Grid sends only business documents: no request, task, note or email goes to Ashby or Lakeline. Ashby's warehouse and ERP records are not available to Northfield. Jordan decides every charge.`,
  opening: () => 'Lakeline’s assigned pickups at Kinross passed two hours ago; the inbound queue was checked.',
  facts: {
    carrier_departed_46602: { values: ['yes', 'no'], recorded: 'no', owner: 'Lakeline (synthetic)', says: 'NR-46602: Lakeline reports departure at 15:12 ET instead of not ready, and no ship notice follows' },
    carrier_silent_46609: { values: ['yes', 'no'], recorded: 'no', owner: 'Lakeline (synthetic)', says: 'NR-46609: no status from Lakeline at all' },
    asn_before_pickup_46616: { values: ['yes', 'no'], recorded: 'no', owner: 'Ashby (synthetic)', says: 'NR-46616: Ashby sends a ship notice saying shipped at 15:00 ET while Lakeline reports the load not ready' },
    lakeline_reachable: { values: ['yes', 'no'], recorded: 'yes', owner: 'Lakeline', says: 'Whether Lakeline’s next status (214) reaches Trading Grid' },
  },
  variations: { canonical: {}, mixed_trails: { carrier_departed_46602: 'yes', carrier_silent_46609: 'yes', asn_before_pickup_46616: 'yes' }, lakeline_unreachable: { carrier_silent_46609: 'yes', lakeline_reachable: 'no' } },
  actions: {
    ashby_owes_ship_notice: { label: 'Show that Ashby owes the ship notice for a load that departed (NF-4.2); it stays Late when it arrives. Nothing is sent', actor: 'Ashby Supplier (sends its ship notice)', rule: 'NF-4.2', mode: 'policy', editable: false, args: ['record'] },
    ashby_owns_ready_time: { label: 'Show that Ashby owns the new ready time: its new routing request rebooks the pickup. Nothing is sent', actor: 'Ashby Supplier (new routing request, EDI 753)', rule: 'NF-3.4', mode: 'policy', editable: false, args: ['record'] },
    record_readiness_failure: { label: 'Record that the collect load was not ready at the assigned pickup, for Jordan Ellis to decide the RT01 charge', actor: 'Northfield compliance record', rule: 'NF-3.6', mode: 'approve', editable: false, args: ['record'] },
    lakeline_owns_status: { label: 'Show that Lakeline owns the load’s status; its next status (EDI 214) confirms where the load is. Nothing is sent', actor: 'Lakeline Freight (status, EDI 214)', rule: 'NF-3.3', mode: 'policy', editable: false, args: ['record'] },
    reject_ship_notice_824: { label: 'Reject a ship notice the carrier contradicts with an application advice (EDI 824), before the load reaches the DC; Ashby answers with a 997 and a corrected ship notice', actor: 'Northfield (824 to the supplier)', rule: 'NF-4.2', mode: 'approve', editable: true, args: ['record'] },
  },

  guardrails: [
    { id: 'NF-7.7', owner: 'Administrator', text: 'Jordan Ellis decides every charge; a readiness record is a proposal until he approves it.' },
    { id: 'NF-4.2', owner: 'Administrator', text: 'A late ship notice stays Late after it arrives.' },
    { id: 'Privacy', owner: 'Administrator', text: 'Ashby’s warehouse and ERP records are not available to Northfield.' },
  ],
  init: (nf, s, ctx) => {
    // The world keeps moving: Lakeline's later 214s, Ashby's ship notices and Northfield's receiving advice arrive at their recorded time.
    for (const r of routed(nf, s)) for (const d of nf.prepare("SELECT doc_type, reference, sent_at FROM documents WHERE po = ? AND sent_at > ? AND sent_at <= ? AND doc_type IN ('214','856','861') ORDER BY sent_at").all(r.po, iso(s.branch), iso(s.horizon))) {
      if (r.po === 'NR-46609' && s.facts.carrier_silent_46609 === 'yes' && d.doc_type === '214') continue;
      const what = d.doc_type === '214' ? `Lakeline status ${status214(d.reference)?.says || d.reference} for ${r.po}` : d.doc_type === '856' ? `Ship notice ${d.reference} from Ashby for ${r.po}` : `Receiving advice ${d.reference} for ${r.po}`;
      ctx.schedule(s, { key: `doc:${d.reference}:${d.sent_at}`, at: d.sent_at, po: r.po, record: r.po, doc: d, reference: d.reference, actor: d.doc_type === '214' ? 'Lakeline Freight (recorded)' : d.doc_type === '856' ? 'Ashby Supplier (recorded)' : 'Northfield receiving (recorded)', what }); }
  },
  queue: (nf, s) => { const k = st(s); const rows = routed(nf, s).map((r) => trailOf(nf, s, r)).filter((t) => !['ok', 'received'].includes(t.kind) || k.requests[t.po] || k.charges[t.po] || k.carrier[t.po] || s.state.seen?.[t.po])
      .map((t) => { (s.state.seen ||= {})[t.po] = true; return t; }).map((t) => ({ id: t.po, record: t.po, what: `Pickup ${t.assigned_pickup}; carrier: ${t.carrier_status}; ship notice: ${t.ship_notice}`, state: k.charges[t.po] ? `${STATE[t.kind]}; readiness recorded` : k.requests[t.po] ? `${STATE[t.kind]}; ${k.requests[t.po].of}` : STATE[t.kind], closed: t.kind === 'received', kind: t.kind }));
    return { as_of: fmtET(iso(s.clock)), rows, open: rows.filter((r) => !r.closed).length }; },
  reads: {
    read_order: { description: 'One inbound order as Northfield sees it at the session clock: assigned pickup and load from the routing instructions, Lakeline’s latest status, the ship notice, receiving advice, and every document with its source. Ashby’s warehouse and ERP records are not available.', input: { record: z.string() },
      run: (nf, s, a) => { const po = D.normPo(a.record || ''); const r = routed(nf, s).find((x) => x.po === po); if (!r) return { found: false, message: `${po} is not an inbound routed order in this window` }; const t = trailOf(nf, s, r); return { ...t, carrier_answers: st(s).carrier[po] || null, ashby_warehouse_and_erp: NOT_ASHBY }; } },
    read_rules: { description: 'Rules by id (NF-4.2, NF-3.3, NF-3.4, NF-3.6) or topic.', input: { ids: z.array(z.string()).optional() }, run: (nf, s, a) => ({ rules: (a.ids?.length ? a.ids : ['NF-4.2', 'NF-3.3', 'NF-3.4', 'NF-3.6']).map((id) => D.rule(nf, id)).filter(Boolean) }) },
  },
  validate: (nf, s, action, a) => { const k = st(s); const po = D.normPo(a.record || ''); const r = routed(nf, s).find((x) => x.po === po); if (!r) return `${po} is not an inbound routed order in this window.`; const t = trailOf(nf, s, r);
    switch (action) {
      case 'ashby_owes_ship_notice': if (t.ship_notice !== 'None') return `A ship notice for ${po} is on file.`; if (k.requests[po]?.of === 'ship notice owed by Ashby') return 'Already shown.'; return null;
      case 'ashby_owns_ready_time': if (t.kind !== 'not_ready') return `${po} was not reported not ready.`; if (k.requests[po]) return 'Already shown.'; return null;
      case 'record_readiness_failure': if (!['not_ready', 'disagree'].includes(t.kind)) return `Lakeline did not report ${po} not ready at the assigned pickup.`; if (k.charges[po]) return 'Already recorded.'; return null;
      case 'lakeline_owns_status': if (t.kind !== 'carrier_silent') return `Lakeline already reported on ${po}.`; if (k.carrier[po]) return 'Already shown.'; return null;
      case 'reject_ship_notice_824': if (t.kind !== 'disagree') return `The ship notice and carrier do not disagree on ${po}.`; if (k.corrections[po]) return 'Already rejected.'; return null; }
    return null; },
  execute: (nf, s, p, by, ctx) => { const k = st(s); const po = D.normPo(p.args.record); s.clock += 2 * MIN;
    switch (p.action) {
      case 'ashby_owes_ship_notice': k.requests[po] = { of: 'ship notice owed by Ashby', at: fmtET(iso(s.clock)) }; return { state: 'Shown', response: `Shown to Jordan Ellis: Ashby owes the ship notice for ${po}; it stays Late when it arrives. Nothing is sent` };
      case 'ashby_owns_ready_time': k.requests[po] = { of: 'new ready time owed by Ashby', at: fmtET(iso(s.clock)) };
        ctx.schedule(s, { key: `ready:${po}`, at: iso(s.clock + 45 * MIN), record: po, actor: 'Ashby Supplier (synthetic)', synthetic: true, what: `Ashby’s new routing request (753) for ${po}: ready tomorrow 15:00 ET; Northfield’s routing instructions rebook Lakeline` });
        return { state: 'Shown', response: `Shown to Jordan Ellis: Ashby owns the new ready time of ${po}; its new routing request rebooks the pickup. Nothing is sent` };
      case 'record_readiness_failure': k.charges[po] = { charge: 'RT01', amount: D.chargeOf(nf, 'RT01'), decided_by: by, at: fmtET(iso(s.clock)) }; return { state: 'Completed', response: `Readiness failure on ${po} recorded; RT01 $${k.charges[po].amount} decided by ${by}` };
      case 'lakeline_owns_status': k.carrier[po] = { asked: fmtET(iso(s.clock)) };
        if (s.facts.lakeline_reachable === 'no') { k.carrier[po].answer = 'No status'; return { state: 'Shown', response: 'No Lakeline status has reached Trading Grid; status Unknown' }; }
        ctx.schedule(s, { key: `lk:${po}`, at: iso(s.clock + 20 * MIN), record: po, actor: 'Lakeline Freight (synthetic)', synthetic: true, what: `Lakeline status (214) for ${po}: not ready at the assigned pickup; driver left empty at 15:40 ET`, on: () => { k.carrier[po].answer = 'Not ready at pickup'; } });
        return { state: 'Shown', response: `Shown to Jordan Ellis: Lakeline owns the status of ${po}; its next status (214) confirms where the load is. Nothing is sent` };
      case 'reject_ship_notice_824': k.corrections[po] = { at: fmtET(iso(s.clock)) }; k.requests[po] = { of: 'ship notice rejected (824)', at: fmtET(iso(s.clock)) }; return { state: 'Sent', response: `Application advice (824) rejecting the ship notice for ${po} sent to Ashby: Lakeline reports the load not picked up. Ashby answers with a 997 and a corrected ship notice` }; }
    return { state: 'Refused', response: 'Unknown action' }; },
  baseline: (nf, s, act) => { for (const r of routed(nf, s)) { const t = trailOf(nf, s, r); if (t.ship_notice === 'None' && !st(s).requests[t.po]) act('ashby_owes_ship_notice', { record: t.po }); } },
  outcome: (nf, s) => { const k = st(s); const rows = spec.queue(nf, s).rows; const violations = [];
    for (const [po, r] of Object.entries(k.requests)) { const t = rows.find((x) => x.record === po); if (r.of === 'ship notice owed by Ashby' && t?.kind === 'not_ready') violations.push(`${po}: ship notice chased for a load that never left`); }
    return { as_of: fmtET(iso(s.clock)), orders: rows.map((r) => ({ po: r.record, state: r.state })), requests: k.requests, readiness_recorded: k.charges, carrier_status_owner_shown: k.carrier, corrections: k.corrections, violations,
      synthetic: 'Presets on NR-46602, NR-46609 and NR-46616 and every record after an owner fix is shown are synthetic, from src/chase.js; routing instructions, Lakeline 214s, ship notices and receiving advice are recorded.' }; },
};
export const Chase = makeRuntime(spec);
