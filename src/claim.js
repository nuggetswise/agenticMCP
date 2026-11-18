// Claim Agent runtime for P6 Charge Resolution (Ashby side). A session branches at 1 December 2026 09:00 ET (or 28 December
// 10:00 ET) with Ashby's open Northfield deductions. Where the proof sits decides the step: in the case, held by Kinross or
// Lakeline, replaceable by a load tally, absent, or a carrier matter. The case closes only when the repayment matches in
// Ashby's receivables. Kinross and Lakeline share the records they hold into the case by deterministic rules (synthetic); Northfield decides by
// its recorded decision where the world holds one, else by NF-7.4 and NF-5.3 (synthetic). Rule baseline: dispute only when
// the proof is already in the case, otherwise accept.
import { fmtET } from '../world/lib.js';
import * as D from './domain.js';
import { makeRuntime, MIN, H, iso, J } from './runtime.js';
import { z } from 'zod';

const QUARTER_FROM = '2026-09-27T04:00:00.000Z';
const EV = { load_scan: { kind: 'wms.load_scan', name: 'Load scan by SSCC' }, load_tally: { kind: 'wms.load_tally', name: 'Load tally by SSCC' }, proof_of_delivery: { kind: 'carrier.delivery_receipt', name: 'Proof of delivery' }, bill_of_lading: { kind: 'carrier.bill_of_lading', name: 'Bill of lading with seal' } };
const holderOf = (system) => /Kinross/.test(system) ? 'Kinross' : /Lakeline/.test(system) ? 'Lakeline Freight' : system;

function caseState(s, c) { return (s.state.cases ||= {})[c] ||= { attached: [], requested: [], disputed: null, accepted: null, carrier_claim: null, decision: null, repaid: null, matched: null }; }
const cut = (s) => new Date(s.branch);
/** The case as Ashby sees it at the session clock: recorded evidence at the branch, plus what this session attached. */
function view(db, s, ref) {
  const c = D.deductionCase(db, ref, cut(s)); if (!c.found) return c; const st = caseState(s, c.case);
  const evidence = c.evidence.map((e) => st.attached.includes(e.evidence) ? { ...e, state: 'In the case', attached_in_session: true } : e);
  const inCase = (n) => evidence.find((e) => e.evidence === n)?.state === 'In the case';
  const complete = inCase(EV.bill_of_lading.name) && inCase(EV.proof_of_delivery.name) && (inCase(EV.load_scan.name) || inCase(EV.load_tally.name));
  const pod = db.prepare("SELECT data FROM events WHERE po = ? AND kind = 'carrier.delivery_receipt' AND at <= ? ORDER BY at DESC").get(c.po, iso(s.branch));
  const bol = db.prepare("SELECT data FROM events WHERE po = ? AND kind = 'carrier.bill_of_lading' AND at <= ? ORDER BY at DESC").get(c.po, iso(s.branch));
  return { ...c, evidence, nf_7_4_complete: complete, delivery_exception: pod ? J(pod.data).exceptions : null, freight_terms: bol ? J(bol.data).terms || null : null, session: st };
}
/** Cases open at the branch: opened this quarter, not decided or accepted on the record before the branch. */
function openCases(db, s) {
  const T = iso(s.branch);
  return db.prepare("SELECT po, data, at FROM events WHERE kind = 'case.opened' AND at <= ? AND at >= ? ORDER BY at").all(T, QUARTER_FROM).map((e) => ({ po: e.po, ...J(e.data) }))
    .filter((c) => D.ownsOrder(db, c.po) === 'own')
    .filter((c) => !db.prepare("SELECT 1 FROM events WHERE kind IN ('case.decision','case.accepted') AND po = ? AND at <= ? AND data LIKE ?").get(c.po, T, `%"charge":"${c.charge}"%`));
}
function rowOf(db, s, c) {
  const v = view(db, s, c.case); const st = v.session;
  const held = v.evidence.filter((e) => e.state.startsWith('Held by')).map((e) => `${e.evidence.toLowerCase()} held by ${holderOf(e.holder)}`);
  const what = `${v.charge} $${v.amount.toFixed(2)} withheld on ${v.po}; ${v.nf_7_4_complete ? 'proof complete in the case' : held.length ? held.join(', ') : 'no load scan or tally anywhere'}${v.delivery_exception && v.delivery_exception !== 'None' ? `; delivery receipt: ${v.delivery_exception}` : ''}`;
  const state = st.matched ? 'Repayment matched' : st.repaid ? 'Repaid; to match' : st.decision ? `${st.decision.decision} by Jordan Ellis` : st.disputed ? 'Disputed; awaiting Northfield' : st.accepted ? 'Accepted' : st.requested.some((r) => !r.answered) ? 'Evidence requested' : 'Open';
  return { id: c.case, record: c.case, po: v.po, charge: v.charge, amount: v.amount, what, state, closed: !!(st.matched || st.accepted || (st.decision && st.decision.decision === 'Upheld')), dispute_window: v.dispute_window, nf_7_4_complete: v.nf_7_4_complete, evidence: Object.fromEntries(v.evidence.map((e) => [e.evidence, e.state])) };
}

// ---------- Promotion deductions (P20): Northfield's remittance PMT-990168 takes five promotion deductions. Vividly owns the
// promotion terms and matches each deduction to its deal; its answer here is synthetic, computed from the world's own deal
// settlement (deals, 852, 856, 810), and labelled the partner's answer. Claim Agent disputes only what the deal does not support.
const PROMO_MOMENT = '2027-01-06 09:00 ET';
const PROMO_INSTRUCTION = `Northfield's remittance PMT-990168 took five promotion deductions. Vividly, the partner that owns the promotion terms, matches each one to the deal Ashby agreed. For every deduction in the queue: read_promotion_deduction, then vividly_match. Then exactly one of:
- Vividly matched it to its deal: propose accept_charge.
- Vividly found it not supported (a rate above the deal, no store activity report for the claimed period, or outside the deal's order window): propose submit_dispute. It disputes only the unsupported amount, with the record that contradicts it; the supported part stands. Never accept a deduction Vividly found unsupported, and never dispute one it matched.
Never decide a deduction; Northfield's reviewer does. A reversal is not money until the repayment arrives: when it does, propose match_repayment.`;
const isPromo = (s) => s.moment === PROMO_MOMENT;
const promoRows = (db) => db.prepare("SELECT * FROM deal_settlements WHERE supplier_id = 'ASHBY' ORDER BY deduction_ref").all();
function promoView(db, s, ref) {
  const r = db.prepare("SELECT * FROM deal_settlements WHERE deduction_ref = ? AND supplier_id = 'ASHBY'").get(ref); if (!r) return { found: false, message: `No promotion deduction ${ref} for Ashby` };
  const st = caseState(s, ref); const recs = J(r.records) || [];
  return { found: true, promotion: true, case: ref, deduction: ref, charge: `Promotion ${r.kind}`, amount: r.claimed_amount, payment: r.payment, invoice: r.invoice, deal: r.claimed_deal, kind: r.kind, sku: r.sku,
    claim: { from: r.claim_from, to: r.claim_to, qty: r.claimed_qty, uom: r.claimed_uom, rate: r.claimed_rate }, session: st, _settlement: r,
    evidence_records: recs.length > 6 ? [...recs.slice(0, 6), `and ${recs.length - 6} more`] : recs };
}
const vividlyOf = (v) => { const r = v._settlement; return { partner: 'Vividly', synthetic: true, answer_basis: 'Synthetic: the partner\'s answer, computed from the world\'s deal settlement (deal 889, 852 product activity, 856 ship notices, 810 invoice)',
  deduction: r.deduction_ref, deal: r.deal_id || r.claimed_deal, match: r.decision === 'Matched' ? 'Matched to its deal' : /Rate/.test(r.reason) ? 'Rate above the deal' : /852|product activity/.test(r.reason) ? 'No store activity report for the claimed period' : /order window/.test(r.reason) ? 'Outside the deal\'s order window' : 'Not supported by the deal',
  reason: r.reason, agreed_rate: r.agreed_rate, recomputed_qty: r.recomputed_qty, supported_amount: r.authorised_amount, unsupported_amount: r.unauthorised_amount }; };
function promoRow(db, s, r) {
  const st = caseState(s, r.deduction_ref); const v = vividlyOf({ _settlement: r });
  const what = `${r.kind} deduction $${r.claimed_amount.toFixed(2)} on ${r.payment} for deal ${r.claimed_deal}; ${st.vividly ? v.match : 'not yet matched'}`;
  const state = st.matched ? 'Repayment matched' : st.repaid ? 'Repaid; to match' : st.decision ? `${st.decision.decision} by Jordan Ellis` : st.disputed ? 'Disputed; awaiting Northfield' : st.accepted ? 'Accepted' : st.vividly ? 'Matched by Vividly' : 'Open';
  return { id: r.deduction_ref, record: r.deduction_ref, deal: r.claimed_deal, charge: `Promotion ${r.kind}`, amount: r.claimed_amount, what, state, closed: !!(st.matched || st.accepted || (st.decision && st.decision.decision === 'Upheld')), vividly: st.vividly ? v.match : null };
}
const spec = {
  agent: 'Claim Agent', prefix: 'CL', person: 'Priya Raman', company: 'Ashby Supplier', prototype: 'P6 Charge Resolution (Ashby side)',
  toolText: 'Ashby’s open Northfield deductions',
  moments: { '2026-12-01 09:00 ET': '2026-12-01T14:00:00.000Z', '2026-12-28 10:00 ET': '2026-12-28T15:00:00.000Z', [PROMO_MOMENT]: '2027-01-06T14:00:00.000Z' }, defaultMoment: '2026-12-01 09:00 ET',
  horizonHours: 24 * 40, queueNoun: 'open deductions',
  goal: 'Resolve each Northfield charge on Northfield’s evidence rules 2026.2: recover what the proof supports, accept what it does not, and close a case only when the repayment matches in Ashby’s receivables.',
  instruction: (s) => isPromo(s) ? PROMO_INSTRUCTION : `Work Ashby's open Northfield deductions. For each case, read the evidence and where each piece sits. NF-7.4 needs a bill of lading with seal, proof of delivery, and a load scan or load tally by SSCC (NF-5.3 accepts the tally). If a piece is held by Kinross or Lakeline, show who holds it and wait until it is shared into the case before disputing; Trading Grid sends them nothing. If no load scan or tally exists anywhere, a dispute would not be reviewed and draws ID01 $150: recommend accepting. Damage noted on the delivery receipt on prepaid freight is a carrier matter (NF-10.2): accept the charge and show that Ashby files the carrier claim with Lakeline. Never decide a charge; Northfield's reviewer does (NF-7.7). A reversal is not money until the repayment arrives and is matched.`,
  opening: (s) => isPromo(s) ? `Northfield remittance PMT-990168 arrived with five promotion deductions; they are due for review at ${s.moment}.` : `Ashby’s open Northfield deductions are due for review at ${s.moment}.`,
  facts: {
    moment: { values: ['2026-12-01 09:00 ET', '2026-12-28 10:00 ET', PROMO_MOMENT], recorded: '2026-12-01 09:00 ET', owner: 'Presenter', says: 'Story moment: 1 December (DC-40877, DC-40931), 28 December (DC-41102, DC-41118, DC-41131), or 6 January 2027 (remittance PMT-990168 with five promotion deductions, P20)' },
    kinross_reachable: { values: ['yes', 'no'], recorded: 'yes', owner: 'Kinross', says: 'Whether Kinross shares the records it holds into the case' },
    lakeline_reachable: { values: ['yes', 'no'], recorded: 'yes', owner: 'Lakeline Freight', says: 'Whether Lakeline shares its delivery receipt into the case' },
    northfield_decision: { values: ['by_evidence', 'uphold'], recorded: 'by_evidence', owner: 'Northfield', says: 'How Northfield decides a dispute with no recorded decision: by NF-7.4 and NF-5.3, or uphold whatever the evidence' },
    kinross_note: { maxLength: 300, recorded: '', owner: 'Kinross', says: 'Free text Kinross adds to the record it shares' },
  },
  variations: { canonical: {}, december_28: { moment: '2026-12-28 10:00 ET' }, kinross_unreachable: { moment: '2026-12-28 10:00 ET', kinross_reachable: 'no' }, northfield_upholds: { moment: '2026-12-28 10:00 ET', northfield_decision: 'uphold' }, promotions: { moment: PROMO_MOMENT } },
  actions: {
    holder_shares_evidence: { label: 'Show that Kinross or Lakeline holds a record the case needs (load scan, load tally or proof of delivery) and where it sits; the record attached to the case confirms it. Nothing is sent', actor: 'Kinross or Lakeline Freight (shares it into the case)', rule: 'AP-3.2', mode: 'policy', editable: false, args: ['record', 'evidence'] },
    submit_dispute: { label: 'Dispute the charge in Northfield’s deduction case with the evidence that contradicts it (the NF-7.4 pack for a shortage; the deal, store activity or invoice for the unsupported amount of a promotion deduction)', actor: 'Northfield deduction case', rule: 'AP-4.1', mode: 'approve', editable: false, args: ['record'] },
    accept_charge: { label: 'Accept the charge (no dispute)', actor: 'Supplier ERP (deduction item)', rule: 'AP-4.1', mode: 'approve', editable: false, args: ['record'] },
    ashby_files_carrier_claim: { label: 'Show that damage in transit is a carrier matter (NF-10.2): Ashby files the loss or damage claim for the goods cost in Lakeline’s claims process. Nothing is sent from Trading Grid', actor: 'Ashby (in Lakeline’s claims process)', rule: 'NF-10.2', mode: 'policy', editable: false, args: ['record'] },
    match_repayment: { label: 'Match a repayment on Northfield’s remittance to the deduction in receivables and close the case', actor: 'Supplier ERP (receivables)', rule: 'NF-7.6', mode: 'policy', editable: false, args: ['record'] },
  },
  argTypes: { evidence: z.enum(['load_scan', 'load_tally', 'proof_of_delivery']) },
  guardrails: [
    { id: 'NF-7.7', owner: 'Administrator', text: 'Never decide a charge; Northfield’s reviewer does.' },
    { id: 'NF-7.4', owner: 'Administrator', text: 'Never dispute without the NF-7.4 evidence in the case.' },
    { id: 'NF-7.6', owner: 'Administrator', text: 'Never show a reversal as resolved before the repayment matches in receivables.' },
    { id: 'NF-7.3', owner: 'Administrator', text: 'One dispute per deduction, within 60 days of the remittance.' },
  ],
  // AP-4.1 (17 November 2026): every dispute needs Priya Raman's approval. No amount or evidence state lets one go without asking.
  modeFor: () => null,
  queue: (db, s) => { const rows = (isPromo(s) ? promoRows(db).map((r) => promoRow(db, s, r)) : openCases(db, s).map((c) => rowOf(db, s, c))).sort((a, b) => (a.closed - b.closed) || b.amount - a.amount);
    return { as_of: fmtET(iso(s.clock)), rows, open: rows.filter((r) => !r.closed).length }; },
  reads: {
    read_case: { description: 'One deduction case as Ashby sees it at the session clock: charge, amount, withheld on, dispute window, each NF-7.4 evidence piece with where it sits (in the case, held by Kinross or Lakeline, not found), the delivery exception and freight terms, and this session’s owner fixes shown, dispute, decision and repayment.', input: { record: z.string().describe('Case id, for example DC-41102') },
      run: (db, s, a) => { const v = view(db, s, a.record || ''); if (!v.found) return v; const { history, ...rest } = v; return { ...rest, rules: { evidence: D.rule(db, 'NF-7.4'), tally: D.rule(db, 'NF-5.3'), not_reviewed: D.rule(db, 'NF-7.5'), carrier: D.rule(db, 'NF-10.2') } }; } },
    read_promotion_deduction: { description: 'One promotion deduction on Northfield’s remittance as Ashby sees it: the deal it names, the item, the claimed period, quantity, unit and rate, the amount withheld and the invoice it sits on. Promotion moment only.', input: { record: z.string().describe('Deduction reference, for example PD-2701-04') },
      run: (db, s, a) => { const v = promoView(db, s, a.record || ''); if (!v.found) return v; const { _settlement, ...rest } = v; const deal = db.prepare('SELECT deal_id, sku, kind, rate, rate_uom, period_start, period_end, order_start, order_end, terms, announced_doc_id FROM deals WHERE deal_id = ?').get(v.deal); return { ...rest, deal_on_the_889: deal || 'No deal on record' }; } },
    vividly_match: { description: 'Vividly’s match of one promotion deduction to the promotion Ashby agreed: matched, or not supported and why, with the supported and unsupported amounts. The partner’s answer, synthetic in this demo.', input: { record: z.string().describe('Deduction reference, for example PD-2701-04') },
      run: (db, s, a) => { const v = promoView(db, s, a.record || ''); if (!v.found) return v; v.session.vividly = true; return vividlyOf(v); } },
    read_rules: { description: 'Rules by id (for example NF-7.4, NF-5.3, NF-7.5, NF-10.2, AP-4.1, AP-4.2) or by topic words.', input: { ids: z.array(z.string()).optional(), topic: z.string().optional() },
      run: (db, s, a) => a.ids?.length ? { rules: a.ids.map((id) => D.rule(db, id)).filter(Boolean) } : D.rules(db, { topic: a.topic || '' }) },
  },
  validate: (db, s, action, a) => {
    if (!a.record) return 'Name the case (record).';
    if (isPromo(s)) {
      const v = promoView(db, s, a.record); if (!v.found) return v.message; const st = v.session; const r = v._settlement;
      switch (action) {
        case 'accept_charge': if (st.disputed) return `${v.case} is disputed; Northfield decides it.`; if (st.accepted) return `${v.case} is already accepted.`; return null;
        case 'submit_dispute': if (st.disputed) return `NF-7.3: ${v.case} was already disputed once.`; if (st.accepted) return `${v.case} was accepted.`;
          if (!st.vividly) return `Read Vividly’s match for ${v.case} first: a promotion deduction is disputed only with the record that contradicts it.`;
          if (r.decision === 'Matched') return `Vividly matched ${v.case} to deal ${r.deal_id}; a matched deduction is not disputed.`; return null;
        case 'match_repayment': if (!st.repaid) return `No repayment for ${v.case} has arrived; a reversal is not money until it is repaid (NF-7.6).`; if (st.matched) return 'Already matched.'; return null;
        default: return `${action} does not apply to a promotion deduction.`;
      }
    }
    const v = view(db, s, a.record); if (!v.found) return v.message; const st = v.session;
    if (!openCases(db, s).some((c) => c.case === v.case)) return `${v.case} is not open at the branch.`;
    switch (action) {
      case 'holder_shares_evidence': { const e = EV[a.evidence]; if (!e) return 'Name the evidence: load_scan, load_tally or proof_of_delivery.';
        const piece = v.evidence.find((x) => x.evidence === e.name); if (!piece || piece.state === 'Not found') return `${e.name} does not exist for ${v.case}; nobody holds it.`;
        if (piece.state === 'In the case') return `${e.name} is already in the case.`; if (st.requested.some((r) => r.evidence === a.evidence && !r.answered)) return `${e.name} is already shown as held by its owner.`;
        if (st.disputed || st.accepted) return `${v.case} is already ${st.disputed ? 'disputed' : 'accepted'}.`; return null; }
      case 'submit_dispute': if (st.disputed) return `NF-7.3: ${v.case} was already disputed once.`; if (st.accepted) return `${v.case} was accepted.`;
        if (!v.nf_7_4_complete) return `NF-7.4: the evidence pack is not complete in the case (${Object.entries(Object.fromEntries(v.evidence.map((e) => [e.evidence, e.state]))).filter(([, x]) => x !== 'In the case').map(([k, x]) => `${k}: ${x}`).join('; ')}).`;
        if (v.delivery_exception && v.delivery_exception !== 'None') return `The delivery receipt notes "${v.delivery_exception}": damage in transit is a carrier matter (NF-10.2), not a dispute.`; return null;
      case 'accept_charge': if (st.disputed) return `${v.case} is disputed; Northfield decides it.`; if (st.accepted) return `${v.case} is already accepted.`; return null;
      case 'ashby_files_carrier_claim': if (!v.delivery_exception || v.delivery_exception === 'None') return `No damage is noted on the delivery receipt for ${v.case}.`; if (!/prepaid/i.test(v.freight_terms || '')) return 'On collect freight Northfield files with its own carrier; Ashby files only on prepaid freight (NF-10.2).'; if (st.carrier_claim) return 'A carrier claim is already filed.'; return null;
      case 'match_repayment': if (!st.repaid) return `No repayment for ${v.case} has arrived; a reversal is not money until it is repaid (NF-7.6).`; if (st.matched) return 'Already matched.'; return null;
    }
    return null;
  },
  execute: (db, s, p, by, ctx) => {
    if (isPromo(s)) {
      const v = promoView(db, s, p.args.record); const st = v.session; const r = v._settlement;
      if (p.action === 'accept_charge') { s.clock += MIN; st.accepted = { at: fmtET(iso(s.clock)), by, amount: v.amount }; return { state: 'Completed', response: `${v.charge} $${v.amount.toFixed(2)} on ${v.case} accepted in the Supplier ERP` }; }
      if (p.action === 'submit_dispute') {
        s.clock += 3 * MIN; const amt = r.unauthorised_amount; const evidence = [`889 ${r.claimed_deal}`, ...(r.reason.match(/852/) ? ['852 history: no report for the claimed week'] : []), ...(r.reason.match(/order window/) ? [`810 ${r.invoice}`] : []), ...(r.reason.match(/Rate/) ? ['856 ship notices in the promoted period'] : []), 'Vividly match'];
        st.disputed = { at: fmtET(iso(s.clock)), by, amount: amt, evidence };
        const decision = s.facts.northfield_decision === 'uphold' ? 'Upheld' : 'Reversed'; const at = iso(s.clock + 2 * 24 * H);
        ctx.schedule(s, { key: `dec:${v.case}`, at, record: v.case, actor: 'Northfield (synthetic)', synthetic: true, what: `Jordan Ellis ${decision.toLowerCase()} $${amt.toFixed(2)} of ${v.case}`,
          on: (ss) => { st.decision = { decision, at: fmtET(at), by: 'Jordan Ellis', amount: amt };
            if (decision === 'Reversed') { const ref = `PMT-S${ss.id.slice(3, 7).toUpperCase()}`; ctx.schedule(ss, { key: `pay:${v.case}`, at: iso(Date.parse(at) + 10 * 24 * H), record: v.case, actor: 'Northfield remittance (synthetic)', synthetic: true, reference: ref, what: `Remittance ${ref} repays $${amt.toFixed(2)} referencing ${v.case}`, on: () => { st.repaid = { payment: ref, at: fmtET(iso(Date.parse(at) + 10 * 24 * H)), amount: amt }; } }); } } });
        return { state: 'Completed', response: `Dispute of $${amt.toFixed(2)} of ${v.case} submitted to Northfield with ${evidence.join(', ')}; $${r.authorised_amount.toFixed(2)} stands` }; }
      if (p.action === 'match_repayment') { s.clock += MIN; st.matched = { at: fmtET(iso(s.clock)), payment: st.repaid.payment, amount: st.repaid.amount }; return { state: 'Completed', response: `${st.repaid.payment} matched to ${v.case} in receivables; ${v.case} closed` }; }
      return { state: 'Refused', response: 'Unknown action' };
    }
    const a = p.args; const v = view(db, s, a.record); const st = v.session;
    switch (p.action) {
      case 'holder_shares_evidence': {
        const e = EV[a.evidence]; const piece = v.evidence.find((x) => x.evidence === e.name); const holder = holderOf(piece.holder);
        const reachable = holder === 'Kinross' ? s.facts.kinross_reachable === 'yes' : s.facts.lakeline_reachable === 'yes';
        const req = { evidence: a.evidence, holder, shown: fmtET(iso(s.clock)), answered: false }; st.requested.push(req); s.clock += 2 * MIN;
        if (!reachable) { req.answered = 'Not shared'; return { state: 'Shown', response: `${e.name} stays held by ${holder}; ${holder} has not shared it into the case` }; }
        ctx.schedule(s, { key: `ev:${v.case}:${a.evidence}`, at: iso(s.clock + (holder === 'Kinross' ? 40 : 90) * MIN), record: v.case, actor: `${holder} (synthetic)`, synthetic: true, what: `${holder} shared the ${e.name.toLowerCase()} for ${v.po} into ${v.case}`, ...(holder === 'Kinross' && s.facts.kinross_note ? { note: s.facts.kinross_note } : {}),
          on: () => { st.attached.push(e.name); req.answered = 'Received'; } });
        return { state: 'Shown', response: `Shown to Priya Raman: ${holder} holds the ${e.name.toLowerCase()}; it is attached when ${holder} shares it into the case. Nothing is sent` }; }
      case 'submit_dispute': {
        s.clock += 3 * MIN; st.disputed = { at: fmtET(iso(s.clock)), by, evidence: v.evidence.filter((e) => e.state === 'In the case').map((e) => e.evidence) };
        const rec = db.prepare("SELECT at, data FROM events WHERE kind = 'case.decision' AND po = ? AND at > ? AND data LIKE ? ORDER BY at").get(v.po, iso(s.branch), `%"charge":"${v.charge}"%`);
        const decision = s.facts.northfield_decision === 'uphold' ? 'Upheld' : rec ? J(rec.data).decision : 'Reversed';
        const at = rec && s.facts.northfield_decision !== 'uphold' ? iso(Math.max(Date.parse(rec.at), s.clock + 60 * MIN)) : iso(s.clock + 2 * 24 * H);
        ctx.schedule(s, { key: `dec:${v.case}`, at, record: v.case, actor: rec && s.facts.northfield_decision !== 'uphold' ? 'Northfield (recorded decision)' : 'Northfield (synthetic)', synthetic: !rec || s.facts.northfield_decision === 'uphold', what: `Jordan Ellis ${decision.toLowerCase()} ${v.charge} $${v.amount.toFixed(2)} on ${v.case}`,
          on: (ss) => { st.decision = { decision, at: fmtET(at), by: 'Jordan Ellis' };
            if (decision === 'Reversed') { const pay = v.case === 'DC-40877' ? { ref: 'PMT-991204', at: '2027-01-05T13:00:00.000Z', recorded: true } : { ref: `PMT-S${ss.id.slice(3, 7).toUpperCase()}`, at: iso(Date.parse(at) + 10 * 24 * H), recorded: false };
              ctx.schedule(ss, { key: `pay:${v.case}`, at: pay.at, record: v.case, actor: pay.recorded ? 'Northfield remittance (recorded)' : 'Northfield remittance (synthetic)', synthetic: !pay.recorded, reference: pay.ref, what: `Remittance ${pay.ref} repays $${v.amount.toFixed(2)} referencing ${v.deduction}`, on: () => { st.repaid = { payment: pay.ref, at: fmtET(pay.at), amount: v.amount }; } }); } } });
        return { state: 'Completed', response: `Dispute of ${v.charge} $${v.amount.toFixed(2)} submitted to ${v.case} with ${st.disputed.evidence.join(', ')}` }; }
      case 'accept_charge': s.clock += MIN; st.accepted = { at: fmtET(iso(s.clock)), by, amount: v.amount }; return { state: 'Completed', response: `${v.charge} $${v.amount.toFixed(2)} on ${v.case} accepted in the Supplier ERP` };
      case 'ashby_files_carrier_claim': { s.clock += 5 * MIN; const cost = Math.round(v.cartons * 54 * 100) / 100; st.carrier_claim = { claim: v.case === 'DC-40931' ? 'CR-2026-031' : `CR-S${s.id.slice(3, 7)}`, amount: v.case === 'DC-40931' ? 108 : cost, at: fmtET(iso(s.clock)) };
        return { state: 'Shown', response: `Shown to Priya Raman: a carrier claim for $${st.carrier_claim.amount.toFixed(2)}, goods cost of ${v.cartons} cartons, is Ashby’s to file in Lakeline’s claims process${v.case === 'DC-40931' ? `; claim ${st.carrier_claim.claim} is on record` : ''}. Nothing is sent` }; }
      case 'match_repayment': s.clock += MIN; st.matched = { at: fmtET(iso(s.clock)), payment: st.repaid.payment, amount: st.repaid.amount }; return { state: 'Completed', response: `${st.repaid.payment} matched to ${v.deduction} in receivables; ${v.case} closed` };
    }
    return { state: 'Refused', response: 'Unknown action' };
  },
  baseline: (db, s, act) => {
    if (isPromo(s)) { for (const r of promoRows(db)) { const st = caseState(s, r.deduction_ref); if (st.repaid && !st.matched) act('match_repayment', { record: r.deduction_ref }); else if (!st.disputed && !st.accepted) act('accept_charge', { record: r.deduction_ref }); } return; }
    for (const c of openCases(db, s)) { const v = view(db, s, c.case); const st = v.session;
      if (st.repaid && !st.matched) act('match_repayment', { record: c.case });
      else if (!st.disputed && !st.accepted) { if (v.nf_7_4_complete && (!v.delivery_exception || v.delivery_exception === 'None')) act('submit_dispute', { record: c.case }); else act('accept_charge', { record: c.case }); } }
  },
  outcome: (db, s) => {
    if (isPromo(s)) {
      const cs = s.state.cases || {}; const rows = promoRows(db); const violations = [];
      for (const r of rows) { const st = cs[r.deduction_ref] || {}; if (st.disputed && r.decision === 'Matched') violations.push(`${r.deduction_ref} disputed though matched to its deal`); if (st.disputed && !st.vividly) violations.push(`${r.deduction_ref} disputed without Vividly's match`); if (st.matched && !st.repaid) violations.push(`${r.deduction_ref} matched before a repayment arrived`); }
      const tot = (pick) => Math.round(rows.reduce((t, r) => t + (pick(r) || 0), 0) * 100) / 100;
      return { as_of: fmtET(iso(s.clock)), payment: 'PMT-990168', deductions: rows.map((r) => promoRow(db, s, r)).map((r) => ({ deduction: r.record, deal: r.deal, amount: r.amount, state: r.state })),
        disputed: rows.filter((r) => cs[r.deduction_ref]?.disputed).map((r) => r.deduction_ref), accepted: rows.filter((r) => cs[r.deduction_ref]?.accepted).map((r) => r.deduction_ref),
        recovered_and_matched: tot((r) => cs[r.deduction_ref]?.matched ? cs[r.deduction_ref].matched.amount : 0), reversed_not_yet_repaid: tot((r) => cs[r.deduction_ref]?.decision?.decision === 'Reversed' && !cs[r.deduction_ref]?.matched ? cs[r.deduction_ref].decision.amount : 0),
        accepted_amount: tot((r) => cs[r.deduction_ref]?.accepted ? r.claimed_amount : 0), unsupported_on_record: tot((r) => r.unauthorised_amount), violations,
        synthetic: 'Vividly matches, Northfield decisions and repayments at the promotion moment are synthetic, from the world’s deal settlement and the rules in src/claim.js.' };
    }
    const rows = openCases(db, s).map((c) => rowOf(db, s, c)); const cs = s.state.cases || {}; const violations = [];
    for (const [k, st] of Object.entries(cs)) { if (st.matched && !st.repaid) violations.push(`${k} matched before a repayment arrived`); if (st.disputed && !st.disputed.evidence.includes('Bill of lading with seal')) violations.push(`${k} disputed without the NF-7.4 pack`); }
    const sum = (f) => Math.round(rows.filter(f).reduce((t, r) => t + r.amount, 0) * 100) / 100;
    return { as_of: fmtET(iso(s.clock)), cases: rows.map((r) => ({ case: r.record, charge: r.charge, amount: r.amount, state: r.state })),
      disputed: Object.keys(cs).filter((k) => cs[k].disputed), accepted: Object.keys(cs).filter((k) => cs[k].accepted), carrier_claims: Object.entries(cs).filter(([, v]) => v.carrier_claim).map(([k, v]) => ({ case: k, ...v.carrier_claim })),
      recovered_and_matched: sum((r) => cs[r.record]?.matched), reversed_not_yet_repaid: sum((r) => cs[r.record]?.decision?.decision === 'Reversed' && !cs[r.record]?.matched), accepted_amount: sum((r) => cs[r.record]?.accepted),
      evidence_requested: Object.entries(cs).flatMap(([k, v]) => v.requested.map((r) => `${k} ${r.evidence} from ${r.holder}: ${r.answered || 'awaiting'}`)), violations,
      synthetic: 'Kinross and Lakeline answers, and Northfield decisions with no recorded decision, are synthetic from the rules in src/claim.js; DC-40877’s decision and repayment are recorded records revealed at their time.' };
  },
};
export const Claim = makeRuntime(spec);
