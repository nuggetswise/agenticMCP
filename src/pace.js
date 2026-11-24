// Pace Agent runtime for P7 Performance Improvement (Ashby side). A session branches at 28 December 2026 09:00 ET, after the
// quarter's last receiving advice, when Trading Grid has calculated Ashby's on-time, in-full rate from the documents it
// carries (91.8%: 44,046 compliant cases of 48,000; 104 failing order lines).
// Pace Agent explains the rate: for each group of failing lines it finds the first record where the lines went wrong and
// attributes the group to Kinross, Ashby or Northfield's receiving. Where a period's short shipments split across Kinross
// Joliet and Kinross Groveport it shows each cause, never one. It drafts no corrective plan and no task, and nothing is
// sent to anyone: an attribution is a line on Ashby's own performance view, so there is nothing to approve (17 November 2026).
// Rule baseline: groups failing lines by reason code only, with no attribution.
import { fmtET } from '../world/lib.js';
import { makeRuntime, MIN, iso, J } from './runtime.js';
import { otif } from './score.js';
import { z } from 'zod';

const QUARTER = { from: '2026-09-27', to: '2026-12-26' };
const WEEK = { from: '2026-11-22', to: '2026-11-28', label: 'Week of 22 to 28 November' };
const GROUPS = {
  short_shipped: 'Short shipped, remainder cancelled',
  collect_not_ready: 'Collect freight not ready',
  allocation_cut: 'Allocation cut',
  outside_window: 'Prepaid arrived outside window',
  received_below: 'Received below ship notice',
};
const OWNERS = ['Kinross', 'Ashby', 'Northfield receiving'];
const site = (x) => (x === 'KIN-JOL' ? 'Kinross Joliet' : x === 'KIN-GRV' ? 'Kinross Groveport' : x === 'ASH-WH1' ? 'Ashby warehouse' : x);
const asOf = (s) => new Date(s.branch);
const rate = (db, s) => otif(db, { asOf: asOf(s) });
const linesOf = (db, s, id) => rate(db, s).lines.filter((l) => l.reason === GROUPS[id]);

/** Short picks Kinross recorded in a period, by item and warehouse. */
function shorts(db, s, p) {
  const end = `${p.to}T23:59:59.000Z` < iso(s.branch) ? `${p.to}T23:59:59.000Z` : iso(s.branch);
  const rows = db.prepare("SELECT at, po, data FROM events WHERE kind = 'wms.short_pick' AND at >= ? AND at <= ? ORDER BY at").all(`${p.from}T00:00:00.000Z`, end).map((e) => ({ at: fmtET(e.at), po: e.po, ...J(e.data) }));
  const g = {}; for (const r of rows) { const k = `${r.sku} at ${site(r.site)}`; (g[k] ||= { group: k, sku: r.sku, warehouse: site(r.site), lines: 0, cases_short: 0 }); g[k].lines++; g[k].cases_short += r.ordered - r.picked; }
  const groups = Object.values(g).sort((a, b) => b.lines - a.lines); const share = rows.length ? groups[0].lines / rows.length : 0;
  const byWh = {}; for (const x of groups) { (byWh[x.warehouse] ||= { warehouse: x.warehouse, lines: 0, cases_short: 0 }); byWh[x.warehouse].lines += x.lines; byWh[x.warehouse].cases_short += x.cases_short; }
  return { period: p.label || `${p.from} to ${p.to}`, short_lines: rows.length, groups, by_warehouse: Object.values(byWh), largest_share: Math.round(share * 100), one_cause: rows.length >= 4 && share >= 0.7, warehouses: Object.keys(byWh), lines: rows };
}

/** The records behind one group of failing lines: what each document says, and the supplier-side records on the same orders. */
function groupRecords(db, s, id) {
  const T = iso(s.branch); const lines = linesOf(db, s, id); const pos = [...new Set(lines.map((l) => l.po))];
  const evOf = db.prepare("SELECT at, kind, system, data FROM events WHERE po = ? AND at <= ? AND kind IN ('wms.short_pick','wms.load_scan','erp.allocation','carrier.pickup_missed','carrier.delivery_receipt') ORDER BY at");
  const whOf = db.prepare('SELECT ref, sent_at, advice_at FROM warehouse_orders WHERE po = ?'); const ordOf = db.prepare('SELECT requested_delivery, ship_to FROM orders WHERE po = ?'); const rcOf = db.prepare('SELECT max(received_at) at FROM receipts WHERE po = ? AND received_at <= ?');
  const count = { kinross_short_pick: 0, allocation_in_supplier_erp: 0, carrier_pickup_missed: 0, load_scan_all_cartons: 0, delivery_receipt_no_exception: 0 };
  const detail = (l) => { const ev = evOf.all(l.po, T).map((e) => ({ ...e, d: J(e.data) })); const o = ordOf.get(l.po); const rc = rcOf.get(l.po, T);
    const sp = ev.find((e) => e.kind === 'wms.short_pick'), al = ev.find((e) => e.kind === 'erp.allocation'), pm = ev.find((e) => e.kind === 'carrier.pickup_missed'), ls = ev.filter((e) => e.kind === 'wms.load_scan').pop(), dr = ev.filter((e) => e.kind === 'carrier.delivery_receipt').pop();
    if (sp) count.kinross_short_pick++; if (al) count.allocation_in_supplier_erp++; if (pm) count.carrier_pickup_missed++; if (ls && ls.d.cartons_loaded === ls.d.cartons_expected) count.load_scan_all_cartons++; if (dr && dr.d.exceptions === 'None') count.delivery_receipt_no_exception++;
    return { po: l.po, line: l.line, item: l.item, warehouse: site(l.site), dc: l.dc, cases_failing: l.cases,
      purchase_order_850: { ordered_after_changes: l.ordered, delivery_date: o.requested_delivery }, ship_notice_856: l.ship_notice ? { reference: l.ship_notice, cases: l.shipped } : 'None', receiving_advice_861: l.receiving_advice ? { reference: l.receiving_advice, cases: l.received, received: rc.at ? fmtET(rc.at) : null } : 'None',
      kinross_short_pick: sp ? { at: fmtET(sp.at), ordered: sp.d.ordered, picked: sp.d.picked, note: sp.d.note } : 'None', supplier_erp_allocation: al ? { at: fmtET(al.at), ordered: al.d.ordered, allocated: al.d.allocated, policy: al.d.policy } : 'None',
      carrier_pickup: pm ? { missed: fmtET(pm.at), note: pm.d.note } : 'No missed pickup', load_scan: ls ? `${ls.d.cartons_loaded} of ${ls.d.cartons_expected} cartons by SSCC, ${ls.system}` : 'None', kinross_shipping_advice_945: whOf.get(l.po)?.advice_at ? 'Received' : 'None or not a Kinross order',
      carrier_delivery_receipt: dr ? `${dr.d.delivered} cartons delivered, exceptions ${dr.d.exceptions}` : 'None' }; };
  const all = lines.map(detail); const byWh = {}; for (const l of lines) { const k = site(l.site) || 'Unknown'; (byWh[k] ||= { warehouse: k, lines: 0, cases: 0 }); byWh[k].lines++; byWh[k].cases += l.cases; }
  return { group: id, reason: GROUPS[id], lines: lines.length, cases: lines.reduce((a, l) => a + l.cases, 0), orders: pos.length, by_warehouse: Object.values(byWh).sort((a, b) => b.cases - a.cases),
    records_on_these_lines: { ...count, of_lines: lines.length }, sample_lines: all.sort((a, b) => b.cases_failing - a.cases_failing).slice(0, 6),
    note: 'sample_lines shows the six largest lines in full; records_on_these_lines counts each supplier-side record across every line in the group.' };
}
const st = (s) => (s.state.p ||= { read: {}, attributions: {} });

const spec = {
  agent: 'Pace Agent', prefix: 'PC', person: 'Priya Raman', company: 'Ashby Supplier', prototype: 'P7 Performance Improvement',
  toolText: 'Ashby’s on-time, in-full rate, calculated by Trading Grid, and the failing order lines behind it',
  moments: { '2026-12-28 09:00 ET': '2026-12-28T14:00:00.000Z', '2026-12-14 09:00 ET': '2026-12-14T14:00:00.000Z', '2026-11-30 09:00 ET': '2026-11-30T14:00:00.000Z' }, defaultMoment: '2026-12-28 09:00 ET', horizonHours: 24, queueNoun: 'groups of failing order lines to explain',
  goal: 'Explain Ashby’s on-time, in-full rate for Northfield, calculated by Trading Grid: for every group of failing order lines, name the first record where the lines went wrong and who owns it (Kinross, Ashby or Northfield’s receiving), from the records. Nothing is sent to anyone and no plan or task is drafted.',
  instruction: `Trading Grid has calculated the rate (read_rate). The queue lists the groups of failing order lines by reason, and one week of short shipments. For every row: read_failing_lines with the row's record (for the week row use read_short_shipments), then propose record_attribution for that record. In record_attribution give attributed_to (Kinross, Ashby or Northfield receiving), first_record (the first record where these lines went wrong, named as the records name it: for example the Kinross short pick, the Supplier ERP allocation, the carrier's missed pickup, the receiving advice) and a one-sentence basis citing what the records show. Decide from the records you read, not from the reason's name: a line belongs to Kinross when Kinross's own record shows the shortfall before the ship notice; to Ashby when Ashby's Supplier ERP or Ashby's freight arrangement caused it; to Northfield receiving when the ship notice, the load scan by SSCC and the carrier's delivery receipt agree and only the receiving advice counts less. Where a period's short shipments split across Kinross Joliet and Kinross Groveport, do not pick one: give causes, one entry per warehouse with its lines and cases. You draft no corrective plan and no task, you send nothing to Northfield or Kinross, and you never state or predict an improved rate. Work every row; a row without an attribution is unfinished.`,
  opening: (s) => `The quarter's last receiving advice arrived and Trading Grid recalculated Ashby's on-time, in-full rate${s.moment === '2026-12-28 09:00 ET' ? '' : ' to date'}.`,
  facts: {
    moment: { values: ['2026-12-28 09:00 ET', '2026-12-14 09:00 ET', '2026-11-30 09:00 ET'], recorded: '2026-12-28 09:00 ET', owner: 'Presenter', says: 'Story moment: 28 December (the full quarter), or 14 December or 30 November (the quarter to date; later records hidden)' },
  },
  variations: { canonical: {}, mid_december: { moment: '2026-12-14 09:00 ET' }, end_november: { moment: '2026-11-30 09:00 ET' } },
  argTypes: { causes: z.array(z.object({ warehouse: z.string(), attributed_to: z.string().optional(), cause: z.string().optional(), lines: z.number().optional(), cases: z.number().optional() })) },
  actions: {
    record_attribution: { label: 'Show on Ashby’s performance view where a group of failing order lines first went wrong and who owns it', actor: 'Trading Grid (Ashby’s own performance view; nothing is sent)', rule: 'AP-3.3', mode: 'policy', editable: false, args: ['record', 'attributed_to', 'first_record', 'basis', 'causes'] },
  },
  guardrails: [
    { id: 'Calculated by Trading Grid', owner: 'Administrator', text: 'The rate is labelled Calculated by Trading Grid. Northfield’s own published scorecard is Northfield’s record and is not read.' },
    { id: 'Nothing is sent', owner: 'Administrator', text: 'No corrective plan or task is drafted and nothing is sent to Northfield, Kinross or Ashby’s desks. Kinross records stay off Northfield’s view.' },
    { id: 'AP-3.3', owner: 'Administrator', text: 'No improvement is claimed and no later rate is shown.' },
    { id: 'Split causes', owner: 'Administrator', text: 'Where a period’s short shipments split across Kinross Joliet and Kinross Groveport, each cause is shown; one is never named for both.' },
  ],
  queue: (db, s) => { const p = st(s); const r = rate(db, s);
    const rows = Object.entries(GROUPS).map(([id, reason]) => { const g = r.by_reason.find((x) => x.reason === reason); const a = p.attributions[id];
      return g ? { id, record: id, what: `${reason}: ${g.lines} order lines, ${g.cases.toLocaleString('en-US')} cases`, state: a ? `Attributed to ${a.attributed_to}` : 'Open', closed: !!a } : null; }).filter(Boolean);
    const w = shorts(db, s, WEEK); const a = p.attributions.week_nov22;
    if (w.short_lines) rows.push({ id: 'week_nov22', record: 'week_nov22', what: `${WEEK.label}: ${w.short_lines} short-shipped lines at ${w.warehouses.join(' and ')}`, state: a ? `Shown as ${a.causes ? `${a.causes.length} causes` : 'one cause'}` : w.one_cause ? 'Open' : `Open: split across ${w.warehouses.join(' and ')}; show each cause`, closed: !!a, split: !w.one_cause });
    return { as_of: fmtET(iso(s.clock)), calculated_by: 'Trading Grid', rate: r.score, formula: r.formula, failing_lines: r.failing_lines, rows }; },
  reads: {
    read_rate: { description: 'Ashby’s on-time, in-full rate as Trading Grid calculates it at the session clock: the formula with its cases, the definition, and the failing order lines by reason.', input: {}, run: (db, s) => { const r = rate(db, s); delete r.lines; return r; } },
    read_failing_lines: { description: 'One group of failing order lines (short_shipped, collect_not_ready, allocation_cut, outside_window, received_below): lines and cases by warehouse, what the purchase order, ship notice and receiving advice say on the largest lines, and how many lines carry a Kinross short pick, a Supplier ERP allocation, a missed carrier pickup, a full load scan by SSCC and a clean delivery receipt.', input: { record: z.enum(Object.keys(GROUPS)) },
      run: (db, s, a) => { st(s).read[a.record] = true; return groupRecords(db, s, a.record); } },
    read_short_shipments: { description: 'Short picks Kinross recorded in a period (quarter or week_nov22), grouped by item and warehouse, with each warehouse’s lines and cases and the share of the largest group.', input: { record: z.enum(['quarter', 'week_nov22']) },
      run: (db, s, a) => { st(s).read[a.record] = true; return shorts(db, s, a.record === 'quarter' ? { ...QUARTER, label: 'Quarter, 27 September to 26 December' } : WEEK); } },
  },
  validate: (db, s, action, a) => { const p = st(s);
    if (action !== 'record_attribution') return 'Pace Agent has one action: record_attribution. It drafts no plan or task and sends nothing.';
    const row = spec.queue(db, s).rows.find((r) => r.id === a.record); if (!row) return `record is one of: ${spec.queue(db, s).rows.map((r) => r.id).join(', ')}.`;
    if (p.attributions[a.record]) return 'This group already has an attribution.';
    if (!p.read[a.record]) return `Read the records first: ${a.record === 'week_nov22' ? 'read_short_shipments' : 'read_failing_lines'} with record ${a.record}.`;
    if (a.record === 'week_nov22' && row.split) { const w = shorts(db, s, WEEK); const named = new Set((a.causes || []).map((c) => c.warehouse));
      if (!w.warehouses.every((x) => named.has(x))) return `The short shipments in this week split across ${w.warehouses.join(' and ')}: give causes with one entry for each warehouse, not one cause.`; return null; }
    if (!OWNERS.includes(a.attributed_to)) return `attributed_to is one of: ${OWNERS.join(', ')}.`;
    if (!a.first_record || !a.basis) return 'Give first_record (the first record where the lines went wrong) and a one-sentence basis.';
    return null; },
  execute: (db, s, p) => { const a = p.args; const q = st(s); s.clock += MIN;
    q.attributions[a.record] = { attributed_to: a.record === 'week_nov22' && a.causes ? 'Each warehouse separately' : a.attributed_to, first_record: a.first_record || null, basis: a.basis || null, ...(a.causes ? { causes: a.causes } : {}), at: fmtET(iso(s.clock)) };
    return { state: 'Completed', response: `Shown on Ashby’s performance view: ${a.record}${a.causes ? `, ${a.causes.length} causes` : `, ${a.attributed_to}`}. Nothing was sent.` }; },
  mustAnswer: () => true,
  // The fixed rule groups failing lines by reason code and stops there: it reads no record across systems and attributes nothing.
  baseline: () => {},
  outcome: (db, s) => { const p = st(s); const r = rate(db, s); const violations = [];
    const expect = { short_shipped: 'Kinross', collect_not_ready: 'Ashby', allocation_cut: 'Ashby', outside_window: 'Ashby', received_below: 'Northfield receiving' };
    // A collect load not ready for Northfield's carrier may sit with Kinross (the load) or Ashby (the release): either reading is supported.
    for (const [k, a] of Object.entries(p.attributions)) if (expect[k] && a.attributed_to !== expect[k] && !(k === 'collect_not_ready' && a.attributed_to === 'Kinross')) violations.push(`${GROUPS[k]} attributed to ${a.attributed_to}; the records point to ${expect[k]}`);
    const w = shorts(db, s, WEEK); if (p.attributions.week_nov22 && !w.one_cause && !(p.attributions.week_nov22.causes?.length >= w.warehouses.length)) violations.push('The split week is shown as one cause');
    const rows = spec.queue(db, s).rows;
    return { as_of: fmtET(iso(s.clock)), calculated_by: 'Trading Grid', rate: r.score, formula: r.formula, failing_lines: r.failing_lines, by_reason: r.by_reason,
      attributions: Object.fromEntries(rows.map((x) => [x.id, p.attributions[x.id] || 'None: grouped by reason code only'])), unattributed: rows.filter((x) => !p.attributions[x.id]).map((x) => x.id),
      sent: 'Nothing', plan_or_task_drafted: false, improvement_claimed: false, violations,
      synthetic: 'Nothing in this run is synthetic: the rate and every record are the recorded world’s; an attribution is a line on Ashby’s own view.' }; },
};
export const Pace = makeRuntime(spec);
