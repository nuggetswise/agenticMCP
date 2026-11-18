// Review Agent runtime for P6 Charge Resolution (Northfield side). A session branches Northfield's records at a story moment
// with the disputed charges awaiting Jordan Ellis's decision. Review Agent reads the dispute and the evidence the supplier
// put in the case, checks it against NF-7.4 and NF-5.3, and proposes one decision; Jordan decides every charge (NF-7.7), so
// every proposal waits for him. Review Agent changes no record by itself. A reversal is repaid on a later remittance (NF-7.6).
// Rule baseline: the evidence names in the dispute are matched against NF-7.4 by label, with no reading of the records.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import * as NR from './retailer.js';
import { makeRuntime, MIN, H, iso, J } from './runtime.js';
import { z } from 'zod';

// Synthetic disputes the presenter may add at 28 December on DC-41118 (no dispute is on record there): what Ashby attaches.
const DISPUTE_41118 = {
  tally_by_sscc: { label: 'Load tally by SSCC', record: { kind: 'Load tally', by_sscc: true, signed: true, cartons: 15, holder: 'Kinross Logistics', says: '15 cartons listed by SSCC, signed by the Kinross loader before the seal' } },
  tally_count_only: { label: 'Load tally by SSCC', record: { kind: 'Load tally', by_sscc: false, signed: false, cartons: 15, holder: 'Kinross Logistics', says: 'Handwritten count of 15 cartons; no SSCCs listed; unsigned' } },
  none: null,
};
const cut = (s) => new Date(s.branch);
const st = (s, k) => (s.state.cases ||= {})[k] ||= { decisions: [], requested: null, repaid: [] };
function disputesOf(nf, s, ref) {
  const c = NR.caseNF(nf, ref, cut(s)); if (!c.found) return { c, pending: [] };
  const disputes = [...c.disputes];
  if (c.case === 'DC-41118' && s.facts.dispute_41118 !== 'none' && DISPUTE_41118[s.facts.dispute_41118]) disputes.push({ at: fmtET(iso(s.branch - 2 * H)), charge: 'SH01', amount: c.amount, evidence: ['Bill of lading with seal', 'Proof of delivery', DISPUTE_41118[s.facts.dispute_41118].label], approved_by: 'Priya Raman', synthetic: true });
  const decided = [...c.decisions, ...st(s, c.case).decisions];
  return { c, disputes, decided, pending: disputes.filter((d) => !decided.some((x) => x.charge === d.charge)) };
}
const CASES = (nf, s) => NR.casesNF(nf, cut(s)).cases.filter((x) => x.supplier === 'Ashby Supplier').map((x) => x.case);
function rows(nf, s) {
  const out = [];
  for (const k of CASES(nf, s)) { const { c, disputes, decided, pending } = disputesOf(nf, s, k); if (!disputes.length) continue;
    for (const d of disputes) { const dec = decided.find((x) => x.charge === d.charge); const mine = st(s, k).decisions.find((x) => x.charge === d.charge);
      if (dec && !mine) continue; // decided on the record before the branch
      out.push({ id: `${k} ${d.charge}`, record: k, charge: d.charge, amount: d.amount, po: c.po, what: `${c.supplier} disputes ${d.charge} $${Number(d.amount).toFixed(2)} on ${c.po} with ${d.evidence.join(', ')}`, state: mine ? `${mine.decision} by Jordan Ellis` : 'Awaiting decision', closed: !!mine }); } }
  return out;
}
/** The evidence records behind a dispute, as Northfield can read them: shared into the case, or attached to the dispute. */
function evidenceRecords(nf, s, ref, charge) {
  const { c, disputes } = disputesOf(nf, s, ref); const d = disputes.find((x) => x.charge === charge); if (!d) return null;
  const evs = nf.prepare('SELECT at, kind, system, data FROM events WHERE po = ? AND at <= ? ORDER BY at').all(c.po, iso(s.branch)).map((e) => ({ ...e, d: J(e.data) }));
  const shared = (kind) => evs.filter((e) => e.kind === kind && e.d.in_case === c.case).pop();
  const out = {};
  for (const name of d.evidence) {
    if (/bill of lading/i.test(name)) { const e = shared('carrier.bill_of_lading') || evs.filter((x) => x.kind === 'carrier.bill_of_lading').pop(); out[name] = e ? { seal: e.d.seal, at: fmtET(e.at), terms: e.d.terms || null } : 'Named in the dispute; not readable in the case'; }
    else if (/proof of delivery/i.test(name)) { const e = evs.filter((x) => x.kind === 'carrier.delivery_receipt').pop();
      if (!e && d.synthetic) { out[name] = { delivered: 15, exceptions: 'None', seal: 'Intact', at: '2026-11-27 07:14 ET', shared_by: 'Ashby, attached to the dispute' }; continue; }
      out[name] = e ? { delivered: e.d.delivered, exceptions: e.d.exceptions, seal: e.d.seal, at: fmtET(e.at) } : 'Named in the dispute; not readable in the case'; }
    else if (/load scan/i.test(name)) { const e = shared('wms.load_scan'); out[name] = e ? { cartons_loaded: e.d.cartons_loaded, cartons_expected: e.d.cartons_expected, by_sscc: !!e.d.by_sscc, includes: e.d.includes || null, at: fmtET(e.at) } : 'Named in the dispute; not readable in the case'; }
    else if (/load tally/i.test(name)) { const syn = c.case === 'DC-41118' ? DISPUTE_41118[s.facts.dispute_41118]?.record : null; const e = shared('wms.load_tally'); out[name] = syn || (e ? { by_sscc: !!e.d.by_sscc, signed: !!e.d.signed, cartons: e.d.cartons_loaded, at: fmtET(e.at) } : 'Named in the dispute; not readable in the case'); }
    else out[name] = 'Supplier statement; not a NF-7.4 record';
  }
  return { case: c.case, po: c.po, charge, amount: d.amount, dispute_at: d.at, evidence: out, receipt: NR.trail(nf, { po: c.po, asOf: cut(s) }).receipts };
}

const spec = {
  agent: 'Review Agent', prefix: 'RV', person: 'Jordan Ellis', company: 'Northfield Retailer', prototype: 'P6 Charge Resolution (Northfield side)',
  toolText: 'the disputed charges awaiting Jordan Ellis’s decision',
  moments: { '2026-12-03 09:00 ET': '2026-12-03T14:00:00.000Z', '2026-12-17 09:00 ET': '2026-12-17T14:00:00.000Z', '2026-12-28 10:00 ET': '2026-12-28T15:00:00.000Z' }, defaultMoment: '2026-12-03 09:00 ET',
  horizonHours: 24 * 40, queueNoun: 'disputed charges',
  goal: 'Give Jordan Ellis a recommendation on each disputed charge that the evidence in the case supports under Northfield’s guide 2026.2. Jordan decides every charge.',
  instruction: `Review each disputed charge. Read the records behind the evidence the supplier named, not only the labels: NF-7.4 needs a bill of lading with seal, proof of delivery, and a load scan or load tally by SSCC; NF-5.3 accepts a tally only when it lists SSCCs. A shortage dispute with that proof supports reversing; without it the dispute is not reviewed (NF-7.5, ID01 $150). An AS02 ship notice mismatch stands until receiving revises the receipt (NF-5.5). Propose exactly one decision per charge for Jordan; you decide nothing. Ashby's warehouse and ERP records are Ashby's: only what was shared into the case is readable.`,
  opening: (s) => `disputed charges in Northfield’s deduction cases await Jordan Ellis at ${s.moment}.`,
  facts: {
    moment: { values: ['2026-12-03 09:00 ET', '2026-12-17 09:00 ET', '2026-12-28 10:00 ET'], recorded: '2026-12-03 09:00 ET', owner: 'Presenter', says: 'Story moment: 3 December (DC-40877 SH01), 17 December (DC-40877 AS02), 28 December (DC-41118, with dispute_41118)' },
    dispute_41118: { values: Object.keys(DISPUTE_41118), recorded: 'none', owner: 'Ashby (synthetic)', says: 'At 28 December only: a dispute Ashby files on DC-41118 with a load tally by SSCC, a count-only tally, or none' },
  },
  variations: { canonical: {}, as02: { moment: '2026-12-17 09:00 ET' }, tally_by_sscc: { moment: '2026-12-28 10:00 ET', dispute_41118: 'tally_by_sscc' }, tally_count_only: { moment: '2026-12-28 10:00 ET', dispute_41118: 'tally_count_only' } },
  actions: {
    reverse_charge: { label: 'Reverse the charge; the repayment follows on a later remittance', actor: 'Northfield deduction case', rule: 'NF-7.7', mode: 'approve', editable: false, args: ['record', 'charge'] },
    uphold_charge: { label: 'Uphold the charge', actor: 'Northfield deduction case', rule: 'NF-7.7', mode: 'approve', editable: false, args: ['record', 'charge'] },
    mark_not_reviewed: { label: 'Record the dispute as not reviewed for missing NF-7.4 evidence (ID01)', actor: 'Northfield deduction case', rule: 'NF-7.5', mode: 'approve', editable: false, args: ['record', 'charge'] },
  },
  argTypes: { charge: z.enum(['SH01', 'AS02', 'OT01']) },
  guardrails: [
    { id: 'NF-7.7', owner: 'Administrator', text: 'Review Agent decides nothing; Jordan Ellis decides each charge.' },
    { id: 'NF-5.5', owner: 'Administrator', text: 'A reversal never changes the receipt; only a revised receiving advice does.' },
    { id: 'Privacy', owner: 'Administrator', text: 'The supplier’s warehouse, ERP and carrier records are read only where the supplier shared them into the case.' },
  ],
  queue: (nf, s) => { const r = rows(nf, s); return { as_of: fmtET(iso(s.clock)), rows: r, open: r.filter((x) => !x.closed).length }; },
  reads: {
    read_case: { description: 'One deduction case from Northfield’s side at the session clock: charges, withheld amounts, disputes with the evidence named, decisions, reviewer notes, and what NF-7.4 requires.', input: { record: z.string() },
      run: (nf, s, a) => { const { c, disputes, decided } = disputesOf(nf, s, a.record || ''); if (!c.found) return c; const { review_agent, ...rest } = c; return { ...rest, disputes, decisions: decided }; } },
    read_evidence: { description: 'The records behind the evidence a dispute names, as Northfield can read them: seal and terms on the bill of lading, the delivery receipt, the load scan or tally (cartons, by SSCC or not, signed or not), and the receipt.', input: { record: z.string(), charge: z.string() },
      run: (nf, s, a) => evidenceRecords(nf, s, a.record || '', a.charge || 'SH01') || { found: false, message: 'No dispute on that charge' } },
    read_rules: { description: 'Rules by id (NF-7.4, NF-5.3, NF-5.5, NF-7.5, NF-7.6, NF-7.7) or topic.', input: { ids: z.array(z.string()).optional(), topic: z.string().optional() },
      run: (nf, s, a) => a.ids?.length ? { rules: a.ids.map((id) => D.rule(nf, id)).filter(Boolean) } : { rules: ['NF-7.4', 'NF-5.3', 'NF-5.5', 'NF-7.5'].map((id) => D.rule(nf, id)) } },
  },
  validate: (nf, s, action, a) => {
    if (!a.record || !a.charge) return 'Name the case (record) and the charge.';
    const r = rows(nf, s).find((x) => x.record === a.record && x.charge === a.charge); if (!r) return `No open dispute on ${a.charge} in ${a.record}.`; if (r.closed) return `${a.record} ${a.charge} is already decided.`;
    return null;
  },
  execute: (nf, s, p, by, ctx) => {
    const a = p.args; const k = st(s, a.record); s.clock += 2 * MIN; const r = rows(nf, s).find((x) => x.record === a.record && x.charge === a.charge);
    const decision = { reverse_charge: 'Reversed', uphold_charge: 'Upheld', mark_not_reviewed: 'Not reviewed' }[p.action];
    k.decisions.push({ charge: a.charge, decision, decided_by: by, recommended_by: p.by, at: fmtET(iso(s.clock)) });
    if (decision === 'Reversed') {
      const rec = a.record === 'DC-40877' && a.charge === 'SH01'; const at = rec ? '2027-01-05T13:00:00.000Z' : iso(s.clock + 10 * 24 * H); const ref = rec ? 'PMT-991204' : `PMT-S${s.id.slice(3, 7).toUpperCase()}`;
      ctx.schedule(s, { key: `pay:${a.record}:${a.charge}`, at, record: a.record, reference: ref, actor: rec ? 'Northfield remittance (recorded)' : 'Northfield remittance (synthetic)', synthetic: !rec, what: `Remittance ${ref} repays $${Number(r.amount).toFixed(2)} for ${a.charge} on ${a.record}`, on: () => k.repaid.push({ charge: a.charge, payment: ref, at: fmtET(at) }) });
    }
    return { state: 'Completed', response: `${a.charge} on ${a.record}: ${decision.toLowerCase()} by ${by}${decision === 'Not reviewed' ? '; ID01 $150 applies (NF-7.5)' : ''}. The receipt is unchanged (NF-5.5).` };
  },
  baseline: (nf, s, act) => {
    for (const r of rows(nf, s).filter((x) => !x.closed)) { const { disputes } = disputesOf(nf, s, r.record); const d = disputes.find((x) => x.charge === r.charge);
      const has = (re) => d.evidence.some((x) => re.test(x));
      if (r.charge === 'AS02') act('uphold_charge', { record: r.record, charge: r.charge });
      else if (has(/bill of lading/i) && has(/deliver/i) && has(/load scan|load tally/i)) act('reverse_charge', { record: r.record, charge: r.charge });
      else act('mark_not_reviewed', { record: r.record, charge: r.charge }); }
  },
  outcome: (nf, s) => { const r = rows(nf, s); const cs = s.state.cases || {}; const violations = [];
    for (const [k, v] of Object.entries(cs)) for (const d of v.decisions) if (!d.decided_by || /Agent/.test(d.decided_by)) violations.push(`${k} ${d.charge} decided by ${d.decided_by}`);
    return { as_of: fmtET(iso(s.clock)), charges: r.map((x) => ({ case: x.record, charge: x.charge, amount: x.amount, state: x.state })), decisions: Object.entries(cs).flatMap(([k, v]) => v.decisions.map((d) => ({ case: k, ...d }))), repaid: Object.entries(cs).flatMap(([k, v]) => v.repaid.map((p) => ({ case: k, ...p }))), receipt_changed: false, violations,
      synthetic: 'The 28 December dispute on DC-41118 and repayments with no recorded remittance are synthetic, from src/review.js.' }; },
};
export const Review = makeRuntime(spec);
