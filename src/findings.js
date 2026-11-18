// The finding log (P22 Finding Outcomes): what happened to every finding Trading Grid raised, for Ashby and for Northfield,
// over the quarter and the closed prior period.
//
//   findings          one row per finding: use case, rule, side, record, owner, raised time, deadline.
//   finding_actions   each finding's stages with time, actor and the record that proves them:
//                     Raised, Opened, Decided, Owner fixed, Confirmed, Money settled.
//
// How the log is built (buildFindingLog, run by world/build.js once every other table is in place):
//   1. Findings come from replaying the rules in force over the documents and records, the way replay_draft_rule replays
//      a draft: the 09:00 morning check on every day (orders_needing_attention with the warehouse), the ship-notice hour
//      (NF-4.2), every rejection Northfield returned, the shipment checks on warehouse, Supplier ERP and hold records,
//      every deduction and promotion deduction, store activity findings, every dispute Northfield received and every draft rule.
//   2. Owner fixed, Confirmed and Money settled are read from records already in the world: the document sent, the
//      warehouse advice, the receiving advice, the decision, the repayment, the receivables match. Nothing is assumed:
//      a stage with no record is absent, and reads as Unknown.
//   3. Opened and Decided are the people's history. Where the world names the person (an approval, a dispute, a
//      decision, a release, a correction) the action carries that record. Where a document went out on a person's
//      approval the approval is written at the document's send time. Opened is written a few minutes before each
//      decision (fixed per finding, never random). Rows written this way carry written = 1.
//   4. A proposal is the answer a rule set gives on the records as they stood just before the person decided (Ashby's
//      evidence rules: src/agents.js claimDecision; Northfield's evidence rules: src/retailer.js reviewRecommendation;
//      Ashby's replenishment rules: the recorded recommendation), credited to that rule set; no agent is named. A person's
//      decision on a proposal is one of three: Approved as proposed (it went ahead as it stood), Edited (the person
//      changed it, then it went ahead) or Declined (the person did something else), with the change stated. A decision
//      taken where no proposal stood carries none of the three. Every dispute is a person's decision (AP-4.1).
// Everything is a pure function of the world's tables, so the same build gives the same log and the same read the same figures.
import { readFileSync } from 'node:fs';
import { fmtET, et, etDay, addD } from '../world/lib.js';
const FINDING_IDS = JSON.parse(readFileSync(new URL('../registry/finding-ids.json', import.meta.url), 'utf8'));
import { P5 } from '../world/p5-physical.js';
import * as D from './domain.js';
import { claimDecision } from './agents.js';
import { ruleSet } from './credit.js';
import { caseNF } from './retailer.js';

export const STAGES = ['Raised', 'Opened', 'Decided', 'Owner fixed', 'Confirmed', 'Money settled'];
export const USE_CASES = ['Missing documents', 'Shipment checks', 'Deductions', 'Invoice holds', 'Store activity', 'Promotions', 'Rule changes'];
const PERIODS = [{ name: 'Quarter', from: '2026-09-27T04:00:00.000Z', to: '2027-01-10T05:00:00.000Z' }, { name: 'Prior period', from: '2026-03-29T04:00:00.000Z', to: '2026-08-08T04:00:00.000Z' }];
const periodOf = (at) => PERIODS.find((p) => at >= p.from && at < p.to)?.name || null;
const H = 3600000; const MIN = 60000;
const J = (s) => (s ? JSON.parse(s) : {});
const iso = (d) => new Date(d).toISOString();
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const r2 = (x) => Math.round(x * 100) / 100;

export const SCHEMA = `
-- P22: the finding log. One row per finding Trading Grid raised, and one row per stage a record proves.
CREATE TABLE findings (finding_id TEXT PRIMARY KEY, side TEXT NOT NULL CHECK (side IN ('Ashby','Northfield')), period TEXT NOT NULL CHECK (period IN ('Quarter','Prior period')), use_case TEXT NOT NULL, rule TEXT NOT NULL,
  record TEXT NOT NULL, po TEXT, problem TEXT NOT NULL, owner TEXT NOT NULL, raised_at TEXT NOT NULL, deadline TEXT, decision_needed INTEGER NOT NULL, proposed_by TEXT NOT NULL, proposal TEXT, rule_baseline TEXT, amount REAL);
CREATE TABLE finding_actions (finding_id TEXT NOT NULL REFERENCES findings(finding_id), stage TEXT NOT NULL CHECK (stage IN ('Raised','Opened','Decided','Owner fixed','Confirmed','Money settled')), at TEXT NOT NULL, actor TEXT NOT NULL,
  record TEXT NOT NULL, record_kind TEXT NOT NULL, detail TEXT, decision TEXT CHECK (decision IN ('Approved as proposed','Edited','Declined')), change TEXT, amount REAL, written INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (finding_id, stage));
`;

export function buildFindingLog(db) {
  const F = [];
  const q = (sql) => db.prepare(sql);
  const add = (f) => { f.actions = []; F.push(f); const a = (stage, at, actor, record, record_kind, o = {}) => { if (at && !f.actions.some((x) => x.stage === stage)) f.actions.push({ stage, at: iso(at), actor, record, record_kind, detail: null, decision: null, change: null, amount: null, written: 0, ...o }); return f; }; f.act = a; return f; };
  const docsOf = q("SELECT doc_id, reference, doc_type, sent_at, status, answers_doc_id, sender_id FROM documents WHERE po = ? AND test = 0 ORDER BY sent_at");
  const docById = q('SELECT doc_id, reference, doc_type, sent_at, po, sender_id, supplier_id FROM documents WHERE doc_id = ?');
  const faOf = q("SELECT reference, sent_at FROM documents WHERE doc_type = '997' AND answers_doc_id = ? ORDER BY sent_at");
  const rcvOf = q("SELECT reference, sent_at, body FROM documents WHERE po = ? AND doc_type = '861' AND test = 0 AND sent_at >= ? ORDER BY sent_at");
  const evOf = q('SELECT id, at, kind, system, data FROM events WHERE po = ? ORDER BY at');
  const name = (id) => q('SELECT name FROM parties WHERE id = ?').get(id)?.name || id;
  const confirmReceipt = (f, po, after) => { const r = rcvOf.get(po, after); if (r) { const b = J(r.body); const n = (b.lines || []).reduce((t, l) => t + l.qty, 0); f.act('Confirmed', r.sent_at, 'Northfield receiving', r.reference, 'Receiving advice (861)', { detail: `${n} received` }); } };
  const confirm997 = (f, docId) => { const a = faOf.get(docId); if (a) f.act('Confirmed', a.sent_at, 'Northfield', a.reference, 'Technical acknowledgment (997)', { detail: 'Technical only: Northfield sends no business acceptance' }); };

  // ───────── Ashby: missing documents, from the 09:00 morning check on every day of both periods ─────────
  const KIND = { 'Order acknowledgment not sent': ['855', 'Ashby order operations'], 'Invoice not sent': ['810', 'Ashby billing'], 'Ship notice not sent; the truck has left': ['856', 'Ashby order operations'], 'Warehouse shipping advice (945) not received from Kinross': ['945', 'Kinross'] };
  const seen = new Map();
  for (const [from, to] of [['2026-03-30', '2026-07-05'], ['2026-09-28', '2027-01-09']]) for (let d = et(from, '09:00'); d <= et(to, '09:00'); d = et(etDay(addD(d, 1)), '09:00'))
    for (const i of D.attention(db, d, { warehouse: true }).items) { const k = KIND[i.reason]; if (k && !seen.has(`${i.po}|${k[0]}`)) seen.set(`${i.po}|${k[0]}`, { at: d, i, type: k[0], owner: k[1] }); }
  for (const { at, i, type, owner } of seen.values()) {
    const f = add({ side: 'Ashby', use_case: 'Missing documents', rule: i.rule.id, record: i.po, po: i.po, problem: i.reason, owner, raised_at: iso(at), deadline: i.deadline_at, decision_needed: type === '945' ? 0 : 1, proposed_by: 'Rule', proposal: type === '945' ? null : 'Send the document drafted from the source record', amount: null });
    f.act('Raised', at, 'Trading Grid', `Morning check, ${fmtET(at)}`, 'Rule check');
    const docs = docsOf.all(i.po);
    if (type === '945') { const w = q('SELECT ref, advice_at FROM warehouse_orders WHERE po = ?').get(i.po); const adv = docs.find((x) => x.doc_type === '945');
      if (w?.advice_at && adv) { f.act('Owner fixed', w.advice_at, 'Kinross', adv.reference, 'Warehouse shipping advice (945)'); f.act('Confirmed', w.advice_at, 'Kinross', adv.reference, 'Warehouse shipping advice (945)', { detail: 'Shipping advice received' }); }
      continue; }
    const sent = docs.find((x) => (type === '855' ? ['855', '865'].includes(x.doc_type) : x.doc_type === type) && x.sent_at >= f.raised_at);
    if (!sent) continue;
    f.act('Decided', sent.sent_at, 'Priya Raman', sent.reference, 'Approval to send', { decision: 'Approved as proposed', detail: `Approved; ${sent.reference} sent`, written: 1 });
    f.act('Owner fixed', sent.sent_at, type === '810' ? 'Ashby billing' : 'Trading Grid', sent.reference, `Document sent (${sent.doc_type})`);
    if (type === '856') confirmReceipt(f, i.po, sent.sent_at); else confirm997(f, sent.doc_id);
  }
  // ───────── Ashby: ship notices sent more than an hour after departure that no morning check saw (NF-4.2) ─────────
  for (const e of q("SELECT at, po, data FROM events WHERE kind = 'tg.late_document' ORDER BY at").all()) { if (seen.has(`${e.po}|856`)) continue; const d = J(e.data);
    const dep = evOf.all(e.po).filter((x) => x.kind === 'wms.departure_scan' && x.at <= e.at).pop(); if (!dep) continue; const due = iso(Date.parse(dep.at) + H);
    const f = add({ side: 'Ashby', use_case: 'Missing documents', rule: 'NF-4.2', record: e.po, po: e.po, problem: 'Ship notice not sent within an hour of departure', owner: 'Supplier ERP', raised_at: due, deadline: due, decision_needed: 0, proposed_by: 'Rule', proposal: null, amount: null });
    f.act('Raised', due, 'Trading Grid', `Rule check on departure scan ${fmtET(dep.at)}`, 'Rule check').act('Owner fixed', e.at, 'Supplier ERP', d.document, 'Document sent (856)', { detail: 'Sent Late' }); confirmReceipt(f, e.po, e.at); }

  // ───────── Rejections Northfield returned (824, 997): Ashby corrects; for Northfield each is its own rule finding ─────────
  const errs = q("SELECT e.*, d.doc_type, d.reference, d.po, d.supplier_id, d.sent_at doc_at, r.sent_at reported_at, r.reference reported_ref, r.doc_type reported_type, c.sent_at corrected_at, c.reference corrected_ref FROM errors e JOIN documents d ON d.doc_id = e.doc_id JOIN documents r ON r.doc_id = e.reported_by LEFT JOIN documents c ON c.doc_id = e.corrected_by WHERE d.test = 0 ORDER BY r.sent_at, e.error_id").all();
  const dockOpen = (po) => { const o = q('SELECT requested_delivery, ship_to FROM orders WHERE po = ?').get(po); return o ? iso(et(o.requested_delivery, o.ship_to === 'DC4' ? '07:00' : '06:00')) : null; };
  const sameCause = new Set(); // a second error of the same cause on one document names its line, so the two findings read apart
  for (const e of errs) {
    const uc = e.doc_type === '810' ? 'Invoice holds' : 'Missing documents'; const again = sameCause.has(`${e.doc_id}|${e.cause}`); sameCause.add(`${e.doc_id}|${e.cause}`); const onLine = again ? (String(e.allowed).match(/on line (\d+)/) || [])[1] : null;
    const what = `${{ 810: 'Invoice', 856: 'Ship notice', 855: 'Order acknowledgment' }[e.doc_type] || `Document ${e.doc_type}`} ${e.reference} ${/held/i.test(e.status) || e.code === 'QTY' ? 'held' : 'rejected'}: ${e.cause}${onLine ? ` on line ${onLine}` : ''}`;
    const deadline = e.doc_type === '856' ? dockOpen(e.po) : null; const evs = e.po ? evOf.all(e.po) : [];
    const approval = evs.find((x) => x.kind === 'approval' && x.at >= e.reported_at && (!e.corrected_at || x.at <= e.corrected_at) && /Corrected/.test(J(x.data).what || ''));
    for (const side of e.supplier_id === 'ASHBY' ? ['Ashby', 'Northfield'] : ['Northfield']) {
      const f = add({ side, use_case: side === 'Northfield' && e.doc_type !== '810' ? 'Shipment checks' : uc, rule: e.rule_id || 'X12 004010 syntax', record: e.reference, po: e.po, problem: what, owner: side === 'Ashby' ? 'Supplier ERP' : name(e.supplier_id), raised_at: e.reported_at, deadline,
        decision_needed: side === 'Ashby' && approval ? 1 : 0, proposed_by: 'Rule', proposal: side === 'Ashby' && approval ? 'Send the corrected document' : null, amount: null });
      f.act('Raised', e.reported_at, side === 'Ashby' ? 'Northfield' : 'Northfield rule check', e.reported_ref, e.channel);
      if (side === 'Ashby' && approval) f.act('Decided', approval.at, 'Priya Raman', `Approval, ${fmtET(approval.at)}`, 'Approval', { decision: 'Approved as proposed', detail: J(approval.data).what });
      if (e.corrected_at) { f.act('Owner fixed', e.corrected_at, side === 'Ashby' ? 'Supplier ERP' : name(e.supplier_id), e.corrected_ref, `Corrected document (${e.doc_type})`);
        if (e.doc_type === '856') confirmReceipt(f, e.po, e.corrected_at); else confirm997(f, e.corrected_by); }
    }
  }

  // ───────── Ashby: shipment checks on warehouse, Supplier ERP and hold records ─────────
  const shipNotice = (po, after) => docsOf.all(po).find((x) => x.doc_type === '856' && x.sent_at >= after && x.status !== 'Rejected');
  const check = (e, o) => { const f = add({ side: 'Ashby', use_case: 'Shipment checks', po: e.po, record: e.po, raised_at: e.at, deadline: null, decision_needed: 0, proposed_by: 'Rule', proposal: null, amount: null, ...o }); f.act('Raised', f.raised_at, 'Trading Grid', o.raised_record, o.raised_kind); return f; };
  for (const e of q("SELECT id, at, kind, po, system, data FROM events WHERE po IS NOT NULL AND kind IN ('wms.load_scan','order.ship_to_changed','erp.invoice_draft','routing.request','wms.inventory','wms.label_scan','tg.hold') ORDER BY at, id").all()) {
    const d = J(e.data); const evs = evOf.all(e.po); const after = (kind, f = () => true) => evs.find((x) => x.kind === kind && x.at > e.at && f(J(x.data)));
    if (e.kind === 'wms.load_scan' && d.cartons_loaded < d.cartons_expected) {
      const hero = e.po === P5.po; const raised = hero ? P5.branch_at : e.at;
      const f = check(e, { rule: 'NF-4.5', problem: `Load scan ${d.cartons_loaded} of ${d.cartons_expected} cartons; carton ${d.missing} ${String(d.missing_state || 'not loaded').toLowerCase()}`, owner: 'Kinross', raised_at: raised, deadline: hero ? P5.seal_at : iso(Date.parse(e.at) + (d.seals_in_minutes || 0) * MIN), decision_needed: 1, proposal: 'Release the ship notice once Kinross’s scan shows every carton loaded', raised_record: `Kinross load scan, ${fmtET(e.at)}`, raised_kind: 'Kinross scan · API' });
      const full = after('wms.load_scan', (x) => x.cartons_loaded === x.cartons_expected); if (full) f.act('Owner fixed', full.at, 'Kinross', `Kinross load scan, ${fmtET(full.at)}`, 'Kinross scan · API', { detail: `${J(full.data).cartons_loaded} of ${J(full.data).cartons_expected} loaded${J(full.data).replacement ? ' with a replacement case' : ''}` });
      const asn = shipNotice(e.po, e.at); if (asn && full) { f.act('Decided', asn.sent_at, 'Priya Raman', asn.reference, 'Approval to release', { decision: 'Approved as proposed', detail: `Released; ${asn.reference} sent`, written: 1 }); confirmReceipt(f, e.po, asn.sent_at); }
    } else if (e.kind === 'wms.load_scan' && /not departed/i.test(d.trailer_state || '') && !evs.some((x) => x.kind === 'tg.hold')) {
      const ful = evs.filter((x) => x.kind === 'erp.fulfilment_posted' && x.at <= e.at).pop(); const plan = evs.find((x) => x.kind === 'erp.shipment_planned');
      const f = check(e, { rule: 'NF-4.2', problem: `Supplier ERP shows the shipment fulfilled${ful ? ` at ${fmtET(ful.at).slice(11, 16)}` : ''}; Kinross load scan says ${d.trailer_state.toLowerCase()}`, owner: 'Kinross', deadline: null, raised_record: `Kinross load scan, ${fmtET(e.at)}`, raised_kind: 'Kinross scan · API' }); void plan;
      const dep = after('wms.departure_scan'); if (dep) f.act('Owner fixed', dep.at, 'Kinross', `Kinross departure scan, ${fmtET(dep.at)}`, 'Kinross scan · API'); const asn = shipNotice(e.po, e.at); if (asn) confirmReceipt(f, e.po, asn.sent_at);
    } else if (e.kind === 'order.ship_to_changed') {
      const f = check(e, { rule: 'NF-4.7', problem: `Order change moved the ship-to from ${d.previous} to ${d.ship_to}; the Supplier ERP sales order still shows ${d.previous}`, owner: 'Ashby order desk', raised_at: e.po === P5.po ? P5.branch_at : e.at, deadline: e.po === P5.po ? P5.seal_at : null, raised_record: `${e.po} Change ${d.change}`, raised_kind: 'Order change (860)' });
      const asn = shipNotice(e.po, e.at); if (asn) { const st = q('SELECT ship_to FROM shipments WHERE shipment_id = ?').get(asn.reference)?.ship_to; if (st === d.ship_to.replace(' ', '')) { f.act('Owner fixed', asn.sent_at, 'Ashby order desk', asn.reference, 'Ship notice (856)', { detail: `Ships to ${d.ship_to}` }); confirmReceipt(f, e.po, asn.sent_at); } }
    } else if (e.kind === 'erp.invoice_draft' && d.billed > d.to_ship) {
      const f = check(e, { rule: 'NF-7.8', record: d.invoice, problem: `Invoice draft ${d.invoice} line ${d.line} bills ${d.billed} cases; ${d.to_ship} allocated to ship; $${d.over_value.toFixed(2)} over`, owner: 'Ashby billing', deadline: iso(Date.parse(e.at) + d.batch_sends_in_minutes * MIN), amount: d.over_value, raised_record: `Supplier ERP invoice draft ${d.invoice}`, raised_kind: 'Supplier ERP · API' });
      const inv = docsOf.all(e.po).find((x) => x.doc_type === '810' && x.reference === d.invoice); const il = inv && q('SELECT qty FROM invoice_lines WHERE invoice = ? AND line = ?').get(d.invoice, d.line);
      if (inv && il && il.qty === d.to_ship) { f.act('Owner fixed', inv.sent_at, 'Ashby billing', inv.reference, 'Invoice (810)', { detail: `Line ${d.line} bills ${il.qty}` }); confirm997(f, inv.doc_id); }
    } else if (e.kind === 'routing.request' && d.state === 'Missing') {
      const f = check(e, { rule: 'NF-3.2', problem: `Collect freight, ${d.cases} cases; no routing request sent`, owner: 'Ashby order operations', deadline: iso(Date.parse(e.at) + d.due_in_minutes * MIN), decision_needed: 1, proposal: 'Send the routing request (753)', raised_record: `Routing check, ${fmtET(e.at)}`, raised_kind: 'Rule check' });
      const rr = docsOf.all(e.po).find((x) => x.doc_type === '753' && x.sent_at >= e.at); if (rr) { const ok = after('tg.release', (r) => r.document === rr.reference); f.act('Decided', ok ? ok.at : rr.sent_at, ok ? J(ok.data).released_by : 'Priya Raman', rr.reference, 'Approval to send', { decision: 'Approved as proposed', written: 1 }); f.act('Owner fixed', rr.sent_at, 'Trading Grid', rr.reference, 'Routing request (753)'); const ri = docsOf.all(e.po).find((x) => x.doc_type === '754' && x.sent_at >= rr.sent_at); if (ri) f.act('Confirmed', ri.sent_at, 'Northfield transportation', ri.reference, 'Routing instructions (754)'); }
    } else if (e.kind === 'wms.inventory' && d.available < d.ordered_across_orders) {
      const f = check(e, { rule: 'NF-2.1', problem: `${d.site}: ${d.available} cases ${d.sku} free against ${d.ordered_across_orders} ordered on ${d.orders} orders; ${d.ordered_across_orders - d.available} short`, owner: 'Ashby order desk', deadline: iso(Date.parse(e.at) + d.change_cutoff_in_minutes * MIN), raised_record: `Kinross inventory read, ${fmtET(e.at)}`, raised_kind: 'Kinross inventory · API' });
      const chg = docsOf.all(e.po).find((x) => x.doc_type === '860' && x.sent_at > e.at); if (chg) { f.act('Owner fixed', chg.sent_at, 'Northfield buyer', chg.reference, 'Order change (860)'); const asn = shipNotice(e.po, chg.sent_at); if (asn) confirmReceipt(f, e.po, asn.sent_at); }
    } else if (e.kind === 'wms.label_scan' && d.reused_sscc) {
      const f = check(e, { rule: 'NF-4.1', problem: `${d.reused_sscc} of ${d.cartons} cartons carry SSCCs already used`, owner: 'Kinross', deadline: iso(Date.parse(e.at) + d.loading_starts_in_minutes * MIN), raised_record: `Kinross label scan, ${fmtET(e.at)}`, raised_kind: 'Kinross scan · API' });
      const asn = shipNotice(e.po, e.at); const reused = asn && q('SELECT count(*) n FROM cartons c WHERE c.shipment_id = ? AND EXISTS (SELECT 1 FROM cartons x WHERE x.sscc = c.sscc AND x.shipment_id <> c.shipment_id)').get(asn.reference).n;
      if (asn && reused === 0) { f.act('Owner fixed', asn.sent_at, 'Kinross', asn.reference, 'Ship notice (856)', { detail: 'No SSCC on the ship notice was used before' }); confirmReceipt(f, e.po, asn.sent_at); }
    } else if (e.kind === 'tg.hold') {
      const list = d.findings || [{ rule: d.rule, finding: d.finding, owner: d.owner || 'Ashby order operations' }];
      for (const x of list) { const f = check(e, { rule: x.rule || 'NF-4.2', record: String(d.document).replace(' draft', ''), problem: `Ship notice held: ${x.finding}`, owner: /Kinross/.test(x.owner || '') ? 'Kinross' : x.owner || 'Ashby order operations', decision_needed: 1, proposal: 'Release the ship notice once the finding is fixed', raised_record: `Hold on ${d.document}`, raised_kind: 'Trading Grid hold' });
        const fix = evs.find((y) => y.kind === 'erp.correction' && y.at > e.at && J(y.data).rule === x.rule) || (/Kinross/.test(x.owner || '') ? after('wms.departure_scan') : null);
        if (fix) f.act('Owner fixed', fix.at, fix.kind === 'erp.correction' ? J(fix.data).owner : 'Kinross', fix.kind === 'erp.correction' ? `Supplier ERP correction, ${fmtET(fix.at)}` : `Kinross departure scan, ${fmtET(fix.at)}`, fix.kind === 'erp.correction' ? 'Supplier ERP' : 'Kinross scan · API', { detail: J(fix.data).change || null });
        // A release counts for this hold when it names no document or names this one: an approval to send another document on the same order (an application advice, a routing request) is not a release of the ship notice.
        const held = String(d.document).replace(' draft', ''); const rel = after('tg.release', (r) => !r.document || String(r.document).replace(' draft', '') === held) || evs.find((y) => y.kind === 'approval' && y.at > e.at && /Release/.test(J(y.data).what || ''));
        if (rel) f.act('Decided', rel.at, J(rel.data).released_by || J(rel.data).approved_by || 'Priya Raman', `Release, ${fmtET(rel.at)}`, 'Approval to release', { decision: 'Approved as proposed', detail: J(rel.data).what || J(rel.data).basis || null });
        else if (d.corrected_by && d.released_at) { f.act('Decided', d.released_at, d.corrected_by, `Hold on ${d.document}`, 'Trading Grid hold', { decision: 'Edited', change: `${x.finding}: corrected before release`, detail: `Corrected by ${d.corrected_by}; released` });
          const asn0 = shipNotice(e.po, e.at); if (asn0) f.act('Owner fixed', asn0.sent_at, 'Trading Grid', asn0.reference, 'Ship notice (856)', { detail: 'Corrected ship notice sent' }); }
        const asn = shipNotice(e.po, e.at); if (asn) confirmReceipt(f, e.po, asn.sent_at); }
    }
  }

  // ───────── Deductions and promotion deductions: Ashby's cases, and the disputes Northfield received ─────────
  const repay = q('SELECT * FROM deduction_repayments WHERE reference = ? ORDER BY repaid_at');
  const matchOf = q("SELECT at, data FROM events WHERE kind = 'erp.receivables_match' AND json_extract(data, '$.matched_to') = ? ORDER BY at");
  const taken = q('SELECT payment, paid_at FROM adjustments WHERE reference = ? AND amount < 0 ORDER BY paid_at');
  const opened = q("SELECT at, po, data FROM events WHERE kind = 'case.opened' ORDER BY at, id").all().map((e) => ({ ...e, d: J(e.data) }));
  for (const c of opened) {
    const supplier = q('SELECT supplier_id FROM orders WHERE po = ?').get(c.po)?.supplier_id; const evs = evOf.all(c.po).map((e) => ({ ...e, d: J(e.data) })).filter((e) => e.kind.startsWith('case.') && e.d.case === c.d.case);
    const promo = c.d.charge === 'PROMO'; const charges = [...new Set([c.d.charge, ...evs.filter((e) => e.kind === 'case.dispute').map((e) => e.d.charge)])];
    for (const charge of charges) {
      const main = charge === c.d.charge; const dis = evs.find((e) => e.kind === 'case.dispute' && e.d.charge === charge); const acc = main ? evs.find((e) => e.kind === 'case.accepted') : null; const dec = evs.find((e) => e.kind === 'case.decision' && e.d.charge === charge);
      const ded = main ? c.d.deduction : null; const tk = ded ? taken.get(ded) : null; const reps = ded ? repay.all(ded) : []; const amount = dis ? dis.d.amount : c.d.amount;
      const settle = (f, actor) => { for (const r of reps.slice(0, 1)) { f.act(actor === 'Ashby' ? 'Confirmed' : 'Owner fixed', r.repaid_at, 'Northfield accounts payable', r.repayment_payment, 'Remittance (820)', { detail: `Repaid $${r.repaid_amount.toFixed(2)}`, amount: r.repaid_amount });
        if (actor === 'Ashby') { const m = matchOf.get(ded); if (m) f.act('Money settled', m.at, 'Supplier ERP', `Receivables match of ${J(m.data).payment}`, 'Supplier ERP', { detail: 'Repayment matched in receivables', amount: J(m.data).amount }); }
        else { const pd = q("SELECT doc_id FROM documents WHERE doc_type = '820' AND reference = ?").get(r.repayment_payment); const a = pd && faOf.get(pd.doc_id); if (a) f.act('Confirmed', a.sent_at, name(supplier), a.reference, 'Technical acknowledgment (997)', { detail: 'Remittance acknowledged' }); f.act('Money settled', r.repaid_at, 'Northfield accounts payable', r.repayment_payment, 'Remittance (820)', { detail: 'Charge reversed and repaid', amount: r.repaid_amount }); } } };
      if (supplier === 'ASHBY') {
        const at = main ? c.at : dis.at; const before = new Date(Date.parse((dis || acc || { at: iso(Date.parse(c.at) + MIN) }).at) - 1000);
        let sug = null, base = null; if (main) { try { const x = claimDecision(db, c.d.case, before); if (x && x.next_step) { sug = /^recommend_accept|^accept$/.test(x.next_step) ? 'Accept the charge' : promo ? `Dispute $${(x.dispute_amount ?? amount).toFixed(2)}` : 'Dispute the charge'; base = x.rule_baseline || null; } } catch { sug = null; } }
        const f = add({ side: 'Ashby', use_case: promo ? 'Promotions' : 'Deductions', rule: promo ? 'NF-7.3' : charge, record: main ? c.d.case : `${c.d.case} ${charge}`, po: c.po, problem: promo ? `Promotion deduction ${c.d.deduction} for deal ${c.d.deal}: $${c.d.amount.toFixed(2)} taken on ${c.d.payment}` : `${charge} charge of $${amount.toFixed(2)} in case ${c.d.case}`, owner: 'Northfield claims review',
          raised_at: at, deadline: tk ? iso(Date.parse(tk.paid_at) + 60 * 24 * H) : null, decision_needed: 1, proposed_by: sug ? (promo ? 'Ashby’s promotion deduction rules' : ruleSet('Claim Agent')) : 'Rule', proposal: sug, rule_baseline: base, amount });
        f.act('Raised', at, main ? 'Northfield' : 'Trading Grid', main ? `Case ${c.d.case} opened` : `Case ${c.d.case}`, 'Northfield deduction case');
        const did = dis ? 'Dispute the charge' : acc ? 'Accept the charge' : null; const same = sug && did && sug.slice(0, 6) === did.slice(0, 6);
        if (dis) f.act('Decided', dis.at, dis.d.approved_by || 'Priya Raman', `Dispute in ${c.d.case}`, 'Northfield deduction case', { decision: !sug ? null : same ? 'Approved as proposed' : 'Declined', change: sug && !same ? `Proposed: ${sug.toLowerCase()}; Priya Raman disputed` : null, detail: `Disputed $${dis.d.amount.toFixed(2)}`, amount: dis.d.amount });
        else if (acc) f.act('Decided', acc.at, 'Priya Raman', `Acceptance in ${c.d.case}`, 'Northfield deduction case', { decision: !sug ? null : same ? 'Approved as proposed' : 'Declined', change: sug && !same ? `Proposed: ${sug.toLowerCase()}; Priya Raman accepted` : null, detail: acc.d.reason || 'Accepted' });
        if (dec) { f.act('Owner fixed', dec.at, dec.d.decided_by || 'Jordan Ellis', `Decision in ${c.d.case}: ${dec.d.decision}`, 'Northfield deduction case', { detail: dec.d.decision, amount: dec.d.amount ?? null });
          if (dec.d.decision === 'Reversed') settle(f, 'Ashby'); else f.act('Confirmed', dec.at, dec.d.decided_by || 'Jordan Ellis', `Decision in ${c.d.case}: ${dec.d.decision}`, 'Northfield deduction case', { detail: 'Charge stands' }); }
        else if (acc) f.act('Confirmed', acc.at, 'Priya Raman', `Acceptance in ${c.d.case}`, 'Northfield deduction case', { detail: 'Charge accepted' });
      }
      if (dis) {
        let rec = null; try { rec = caseNF(db, c.d.case, new Date(Date.parse((dec || { at: iso(Date.parse(dis.at) + MIN) }).at) - 1000)).review_agent; } catch { rec = null; }
        const step = rec && rec.charge === charge ? rec.next_step : null; const sug = { recommend_reverse: 'Reverse the charge', recommend_uphold: 'Uphold the charge', recommend_not_reviewed: 'Record the dispute as not reviewed' }[step] || null;
        const f = add({ side: 'Northfield', use_case: promo ? 'Promotions' : 'Deductions', rule: 'NF-7.7', record: main ? c.d.case : `${c.d.case} ${charge}`, po: c.po, problem: `${name(supplier)} disputes ${promo ? `promotion deduction ${c.d.deduction}` : `${charge}`}: $${dis.d.amount.toFixed(2)} in case ${c.d.case}`, owner: 'Northfield accounts payable',
          raised_at: dis.at, deadline: null, decision_needed: 1, proposed_by: sug ? ruleSet('Review Agent') : 'Rule', proposal: sug, rule_baseline: null, amount: dis.d.amount });
        f.act('Raised', dis.at, name(supplier), `Dispute in ${c.d.case}`, 'Northfield deduction case');
        if (dec) { const did = dec.d.decision === 'Reversed' ? 'Reverse the charge' : 'Uphold the charge'; const same = sug === did;
          f.act('Decided', dec.at, dec.d.decided_by || 'Jordan Ellis', `Decision in ${c.d.case}: ${dec.d.decision}`, 'Northfield deduction case', { decision: !sug ? null : same ? 'Approved as proposed' : 'Declined', change: sug && !same ? `Proposed: ${sug.toLowerCase()}; Jordan Ellis decided ${dec.d.decision.toLowerCase()}` : null, detail: dec.d.reason || dec.d.decision, amount: dec.d.amount ?? null });
          if (dec.d.decision === 'Reversed') settle(f, 'Northfield'); else f.act('Confirmed', dec.at, dec.d.decided_by || 'Jordan Ellis', `Decision in ${c.d.case}: ${dec.d.decision}`, 'Northfield deduction case', { detail: 'Charge stands' }); }
      }
    }
  }
  // Promotion deductions that match their deal need no decision (AP-4.2, 18 November 2026): no case is opened and nothing is proposed.
  for (const s of q("SELECT * FROM deal_settlements WHERE supplier_id = 'ASHBY' AND decision = 'Matched' ORDER BY deduction_ref").all()) {
    const f = add({ side: 'Ashby', use_case: 'Promotions', rule: 'NF-7.3', record: s.deduction_ref, po: null, problem: `Promotion deduction ${s.deduction_ref} for deal ${s.claimed_deal}: $${s.claimed_amount.toFixed(2)} taken on ${s.payment}`, owner: 'Northfield claims review', raised_at: s.paid_at, deadline: iso(Date.parse(s.paid_at) + 60 * 24 * H), decision_needed: 0,
      proposed_by: 'Rule', proposal: null, rule_baseline: 'Accept every deduction carrying a promotion reason code', amount: s.claimed_amount });
    const at = iso(Date.parse(s.paid_at) + (100 + (hash(s.deduction_ref) % 20)) * MIN);
    f.act('Raised', s.paid_at, 'Northfield', s.payment, 'Remittance (820)').act('Confirmed', at, 'Trading Grid', `Deal match for ${s.deduction_ref}`, 'Trading Grid deductions', { detail: `Matched to its deal, no decision needed: ${s.reason}`, written: 1 });
  }
  // The disputed return (returns stage): one case, decided by Jordan Ellis.
  for (const e of q("SELECT at, po, data FROM events WHERE kind = 'return.dispute' ORDER BY at").all()) { const d = J(e.data); const dec = evOf.all(e.po).map((x) => ({ ...x, d: J(x.data) })).find((x) => x.kind === 'return.decision' && x.d.case === d.case); const reps = repay.all(d.deduction);
    const fa = add({ side: 'Ashby', use_case: 'Deductions', rule: 'NF-7.3', record: d.case, po: e.po, problem: `Return ${d.rtv} deducted as ${d.deduction}; Ashby received less than was deducted`, owner: 'Northfield claims review', raised_at: e.at, deadline: null, decision_needed: 1, proposed_by: 'Rule', proposal: null, amount: d.amount });
    fa.act('Raised', e.at, 'Trading Grid', `Return ${d.rtv}`, 'Return authorisation (180)').act('Decided', e.at, d.approved_by || 'Priya Raman', `Dispute in ${d.case}`, 'Northfield deduction case', { detail: `Disputed $${d.amount.toFixed(2)}`, amount: d.amount });
    const fn = add({ side: 'Northfield', use_case: 'Deductions', rule: 'NF-7.7', record: d.case, po: e.po, problem: `Ashby Supplier disputes return deduction ${d.deduction}: $${d.amount.toFixed(2)} in case ${d.case}`, owner: 'Northfield accounts payable', raised_at: e.at, deadline: null, decision_needed: 1, proposed_by: 'Rule', proposal: null, amount: d.amount });
    fn.act('Raised', e.at, 'Ashby Supplier', `Dispute in ${d.case}`, 'Northfield deduction case');
    if (dec) { fa.act('Owner fixed', dec.at, dec.d.decided_by, `Decision in ${d.case}: ${dec.d.decision}`, 'Northfield deduction case', { detail: dec.d.decision, amount: dec.d.amount });
      fn.act('Decided', dec.at, dec.d.decided_by, `Decision in ${d.case}: ${dec.d.decision}`, 'Northfield deduction case', { detail: dec.d.reason, amount: dec.d.amount });
      for (const r of reps.slice(0, 1)) { fa.act('Confirmed', r.repaid_at, 'Northfield accounts payable', r.repayment_payment, 'Remittance (820)', { detail: `Repaid $${r.repaid_amount.toFixed(2)}`, amount: r.repaid_amount });
        fn.act('Owner fixed', r.repaid_at, 'Northfield accounts payable', r.repayment_payment, 'Remittance (820)', { detail: `Repaid $${r.repaid_amount.toFixed(2)}`, amount: r.repaid_amount }).act('Money settled', r.repaid_at, 'Northfield accounts payable', r.repayment_payment, 'Remittance (820)', { detail: 'Charge reversed and repaid', amount: r.repaid_amount }); } } }

  // ───────── Ashby: store activity (the recorded recommendations of Ashby's replenishment rules) ─────────
  for (const e of q("SELECT id, at, data FROM events WHERE kind = 'rule.recommendation' ORDER BY at").all()) { const d = J(e.data); if (!/replenishment rule/.test(d.found_by || '')) continue;
    const f = add({ side: 'Ashby', use_case: 'Store activity', rule: d.finding === 'Empty shelf' ? 'AP-6.1' : 'AP-6.2', record: `Store ${d.store}`, po: null, problem: `Store ${d.store}: ${String(d.finding).toLowerCase()}`, owner: d.recommend === 'New order' ? 'Northfield buyer' : 'Northfield store operations', raised_at: e.at, deadline: null, decision_needed: 1,
      proposed_by: ruleSet('Shelf Agent'), proposal: d.recommend === 'New order' ? `Suggest a new order of ${d.pairs} pairs to the buyer` : `Suggest a transfer of ${d.pairs} pairs to store ${d.to_store}`, rule_baseline: 'Order for every store below its reorder point', amount: null });
    f.act('Raised', e.at, 'Trading Grid', `Store activity (852) for store ${d.store}`, 'Store activity (852)');
    if (d.approved_by) f.act('Decided', e.at, d.approved_by, `Recommendation for store ${d.store}`, 'Trading Grid', { decision: 'Approved as proposed', detail: 'Shown in Trading Grid to Priya Raman and Jordan Ellis; nothing is sent' });
    if (d.recommend === 'New order') { const o = q("SELECT po, received_at FROM orders WHERE stream = 'store' AND ship_to = ? AND received_at >= ? ORDER BY received_at").get(`STORE${d.store}`, e.at);
      if (o) { f.po = o.po; f.act('Owner fixed', o.received_at, 'Northfield buyer', o.po, 'Purchase order (850)'); confirmReceipt(f, o.po, o.received_at); } } }

  // ───────── Northfield: rule changes (draft rules) ─────────
  for (const r of q('SELECT * FROM draft_rules ORDER BY created_at, id').all()) {
    const f = add({ side: 'Northfield', use_case: 'Rule changes', rule: r.id, record: r.id, po: null, problem: `Draft rule ${r.id}: ${r.statement}`, owner: 'Jordan Ellis', raised_at: r.created_at, deadline: null, decision_needed: 1, proposed_by: 'Rule', proposal: 'Replay against the quarter, then publish, revise or keep as draft', amount: null });
    f.act('Raised', r.created_at, r.author, r.id, 'Draft rule');
    if (r.state === 'Scheduled') { f.act('Decided', r.created_at, r.author, r.id, 'Draft rule', { detail: `Published to take force ${fmtET(r.in_force_from).slice(0, 10)}` }); f.act('Confirmed', r.in_force_from, 'Northfield supplier guide', r.id, 'Rule in force'); } }

  // ───────── Opened: the person's view, written a fixed few minutes before each decision a person took ─────────
  for (const f of F) { const d = f.actions.find((a) => a.stage === 'Decided'); if (!d) continue;
    const at = Math.max(Date.parse(f.raised_at), Date.parse(d.at) - (3 + (hash(`${f.side}|${f.use_case}|${f.record}|${f.rule}`) % 27)) * MIN);
    f.act('Opened', at, d.actor, `${d.actor} opened ${f.record}`, 'Trading Grid view', { written: 1 }); }

  // ───────── ids and rows ─────────
  const kept = F.filter((f) => periodOf(f.raised_at)).sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.raised_at < b.raised_at ? -1 : a.raised_at > b.raised_at ? 1 : `${a.use_case}|${a.record}|${a.rule}|${a.problem}` < `${b.use_case}|${b.record}|${b.rule}|${b.problem}` ? -1 : 1));
  const n = { Ashby: 0, Northfield: 0 }; const insF = q('INSERT INTO findings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); const insA = q('INSERT INTO finding_actions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  // A finding recorded before 18 November 2026 keeps its number (registry/finding-ids.json, keyed by side, use case, record and rule), so a
  // finding added or moved in time renumbers no other. A finding with no number there takes the next one after the highest.
  const used = new Set(); const idOf = new Map(); const top = { Ashby: 0, Northfield: 0 };
  for (const f of kept) { const p = FINDING_IDS[`${f.side}|${f.use_case}|${f.record}|${f.rule}`]; if (p && !used.has(p)) { used.add(p); idOf.set(f, p); } }
  for (const p of Object.values(FINDING_IDS)) { const side = p[1] === 'A' ? 'Ashby' : 'Northfield'; top[side] = Math.max(top[side], Number(p.slice(3))); }
  for (const f of kept) { n[f.side]++; const id = idOf.get(f) || `F${f.side[0]}-${String(++top[f.side]).padStart(4, '0')}`;
    insF.run(id, f.side, periodOf(f.raised_at), f.use_case, f.rule, f.record, f.po ?? null, f.problem, f.owner, f.raised_at, f.deadline ?? null, f.decision_needed, f.proposed_by, f.proposal ?? null, f.rule_baseline ?? null, f.amount ?? null);
    for (const a of f.actions.sort((x, y) => STAGES.indexOf(x.stage) - STAGES.indexOf(y.stage))) insA.run(id, a.stage, a.at, a.actor, a.record, a.record_kind, a.detail, a.decision, a.change, a.amount, a.written); }
  db.exec('COMMIT');
  return { findings: kept.length, ...n };
}

// ───────────────────────────── The read: finding_outcomes ─────────────────────────────
const dur = (ms) => { if (ms == null) return 'Unknown'; const m = Math.round(Math.abs(ms) / MIN); const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return [d ? `${d} d` : null, h ? `${h} h` : null, mm || (!d && !h) ? `${mm} m` : null].filter(Boolean).join(' '); };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2); };
const HIDDEN = { Ashby: 'Not available to Ashby', Northfield: 'Not available to Northfield' };

/**
 * What happened to one side's findings, as of a time: totals per stage and use case, the leaks between stages, owner
 * response times from the records that arrived, proposals approved as proposed, edited and declined, and the value a
 * record proves. Reads only that side's rows; the same arguments always give the same figures.
 */
export function findingOutcomes(db, side, { asOf, period = 'quarter', use_case = null, finding = null, list = false } = {}) {
  const T = asOf.toISOString(); const per = { quarter: ['Quarter'], prior: ['Prior period'], all: ['Quarter', 'Prior period'] }[period] || ['Quarter'];
  const rows = db.prepare(`SELECT * FROM findings WHERE side = ? AND raised_at <= ? AND period IN (${per.map(() => '?').join(',')}) ORDER BY finding_id`).all(side, T, ...per);
  const acts = new Map(); for (const a of db.prepare('SELECT a.* FROM finding_actions a JOIN findings f ON f.finding_id = a.finding_id WHERE f.side = ? AND a.at <= ? ORDER BY a.finding_id, a.at').all(side, T)) (acts.get(a.finding_id) || acts.set(a.finding_id, []).get(a.finding_id)).push(a);
  const view = (f) => { const a = acts.get(f.finding_id) || []; const st = (s) => a.find((x) => x.stage === s) || null; const dec = st('Decided'), fix = st('Owner fixed'), conf = st('Confirmed'), money = st('Money settled');
    const late = dec && f.deadline ? Date.parse(dec.at) - Date.parse(f.deadline) : null;
    return { finding: f.finding_id, use_case: f.use_case, period: f.period, rule: f.rule, record: f.record, po: f.po, problem: f.problem, owner: f.owner, raised: fmtET(f.raised_at), deadline: f.deadline ? fmtET(f.deadline) : null, amount: f.amount,
      decision_needed: !!f.decision_needed, proposed_by: f.proposed_by, proposal: f.proposal, rule_baseline: f.rule_baseline,
      opened: st('Opened') ? fmtET(st('Opened').at) : null, decided: dec ? fmtET(dec.at) : null, decision: dec ? dec.decision : null, decided_by: dec ? dec.actor : null, change: dec ? dec.change : null,
      decided_against_deadline: late == null ? null : late > 0 ? `${dur(late)} after its deadline` : `${dur(late)} before its deadline`, decided_late: late != null && late > 0,
      owner_fixed: fix ? fmtET(fix.at) : null, owner_response: fix ? dur(Date.parse(fix.at) - Date.parse(f.raised_at)) : 'Unknown', confirmed: conf ? fmtET(conf.at) : null, confirmed_by: conf ? conf.record : null,
      money_settled: money ? { at: fmtET(money.at), amount: money.amount, record: money.record } : null, _a: a, _f: f, _late: late, _fix: fix ? Date.parse(fix.at) - Date.parse(f.raised_at) : null }; };
  const V = rows.map(view); const strip = ({ _a, _f, _late, _fix, ...x }) => x;
  const trail = (v) => ({ ...strip(v), trail: v._a.map((a) => ({ stage: a.stage, at: fmtET(a.at), actor: a.actor, record: a.record, record_kind: a.record_kind, detail: a.detail, ...(a.decision ? { decision: a.decision } : {}), ...(a.change ? { change: a.change } : {}), ...(a.amount != null ? { amount: a.amount } : {}), source: a.written ? 'Recorded history of the person’s work in Trading Grid' : 'Record in the world' })),
    link: v.po ? `order/${encodeURIComponent(v.po)}` : null });
  if (finding) { const key = String(finding).trim().toUpperCase(); const hit = V.filter((v) => v.finding === key || v.record.toUpperCase() === key || (v.po || '').toUpperCase() === key);
    if (!hit.length) { const other = db.prepare('SELECT 1 x FROM findings WHERE side <> ? AND (finding_id = ? OR upper(record) = ? OR upper(po) = ?)').get(side, key, key, key); return { found: false, message: other ? `${HIDDEN[side]}: that finding belongs to the other company` : `No ${side} finding ${finding} at ${fmtET(asOf)}` }; }
    return { found: true, as_of: fmtET(asOf), side, findings: hit.map(trail) }; }
  const count = (xs, p) => xs.filter(p).length; const has = (v, s) => v._a.some((a) => a.stage === s);
  const stageTotals = (xs) => Object.fromEntries(STAGES.map((s) => [s.toLowerCase().replace(' ', '_'), count(xs, (v) => has(v, s))]));
  const leaks = (xs) => ({ never_opened: count(xs, (v) => v.decision_needed && !has(v, 'Opened') && !has(v, 'Decided')), opened_not_decided: count(xs, (v) => has(v, 'Opened') && !has(v, 'Decided')), decided_after_deadline: count(xs, (v) => v.decided_late),
    decided_no_owner_record: count(xs, (v) => has(v, 'Decided') && !has(v, 'Owner fixed')), no_confirming_record: count(xs, (v) => !has(v, 'Confirmed')) });
  const by = USE_CASES.map((u) => { const xs = V.filter((v) => v.use_case === u); return xs.length ? { use_case: u, raised: xs.length, decision_needed: count(xs, (v) => v.decision_needed), opened: count(xs, (v) => has(v, 'Opened')), decided: count(xs, (v) => has(v, 'Decided')),
    decided_on_time: count(xs, (v) => has(v, 'Decided') && !v.decided_late), decided_late: count(xs, (v) => v.decided_late), owner_fixed: count(xs, (v) => has(v, 'Owner fixed')), confirmed: count(xs, (v) => has(v, 'Confirmed')), unconfirmed: count(xs, (v) => !has(v, 'Confirmed')), money_settled: count(xs, (v) => has(v, 'Money settled')) } : null; }).filter(Boolean);
  const owners = [...new Set(V.map((v) => v.owner))].sort().map((o) => { const xs = V.filter((v) => v.owner === o); const t = xs.filter((v) => v._fix != null).map((v) => v._fix); const slow = xs.filter((v) => v._fix != null).sort((a, b) => b._fix - a._fix || (a.finding < b.finding ? -1 : 1))[0];
    return { owner: o, findings: xs.length, with_a_record: t.length, unknown: xs.length - t.length, median_response: dur(median(t)), slowest: slow ? { finding: slow.finding, record: slow.record, response: dur(slow._fix) } : null }; });
  // Proposals by the rule set that made them, and what people decided on them. A finding with no proposal (proposed_by Rule, no proposal) is not here.
  const agents = [...new Set(V.filter((v) => v.proposal && v.proposed_by !== 'Rule').map((v) => v.proposed_by))].sort().map((ag) => { const xs = V.filter((v) => v.proposed_by === ag); const k = (d) => count(xs, (v) => v.decision === d);
    const differs = xs.filter((v) => v.rule_baseline && v.proposal && v.proposal.slice(0, 6).toLowerCase() !== String(v.rule_baseline).slice(0, 6).toLowerCase());
    return { proposed_by: ag, proposals: xs.length, approved_as_proposed: k('Approved as proposed'), edited: k('Edited'), declined: k('Declined'), not_decided: count(xs, (v) => !v.decided),
      changes_people_made: xs.filter((v) => v.change).map((v) => ({ finding: v.finding, record: v.record, change: v.change })),
      against_rule_baseline: { proposal_differs_from_rule: differs.length, of_those_money_settled: r2(differs.reduce((t, v) => t + (v.money_settled?.amount || 0), 0)), findings: differs.map((v) => v.finding) },
      note: 'Every proposal waits for a person; nothing here changes an approval mode.' }; });
  const settled = V.filter((v) => v.money_settled); const reversed = V.filter((v) => v._a.some((a) => (a.stage === 'Owner fixed' || a.stage === 'Decided') && /Reversed/.test(`${a.detail || ''} ${a.record}`)));
  const amt = (v) => (v._a.find((a) => (a.stage === 'Owner fixed' || a.stage === 'Decided') && /Reversed/.test(`${a.detail || ''} ${a.record}`))?.amount ?? v.amount ?? 0);
  const value = side === 'Ashby'
    ? { repayments_matched: { count: settled.length, amount: r2(settled.reduce((t, v) => t + v.money_settled.amount, 0)), records: settled.map((v) => ({ finding: v.finding, record: v.record, amount: v.money_settled.amount, proof: v.money_settled.record })) },
        charges_reversed: { count: reversed.length, amount: r2(reversed.reduce((t, v) => t + amt(v), 0)), findings: reversed.map((v) => v.finding) }, prevented: 'No figure: no record shows a charge prevented' }
    : { charges_reversed_and_repaid: { count: settled.length, amount: r2(settled.reduce((t, v) => t + v.money_settled.amount, 0)), records: settled.map((v) => ({ finding: v.finding, record: v.record, amount: v.money_settled.amount, proof: v.money_settled.record })) },
        charges_reversed: { count: reversed.length, amount: r2(reversed.reduce((t, v) => t + amt(v), 0)), findings: reversed.map((v) => v.finding) }, supplier_receivables_match: 'Not available to Northfield', prevented: 'No figure: no record shows a charge prevented' };
  const confirmed = count(V, (v) => has(v, 'Confirmed')); const late = count(V, (v) => v.decided_late);
  const out = { as_of: fmtET(asOf), side, person: side === 'Ashby' ? 'Priya Raman' : 'Jordan Ellis', period: per.join(' and '), calculated_by: 'Trading Grid',
    title: `${confirmed} of ${V.length} ${side} findings were confirmed${period === 'quarter' ? ' this quarter' : ''}; ${late} ${late === 1 ? 'was' : 'were'} decided after ${late === 1 ? 'its' : 'their'} deadline.`,
    findings: V.length, decision_needed: count(V, (v) => v.decision_needed), stages: stageTotals(V), leaks: leaks(V), by_use_case: by, owner_response: owners, proposals: { decisions: ['Approved as proposed', 'Edited', 'Declined'], by_rule_set: agents }, value_proven: value,
    visibility: side === 'Ashby' ? 'Ashby’s findings only. Northfield’s payables and reviewer notes: Not available to Ashby.' : 'Northfield’s findings only. A supplier’s ERP, warehouse and carrier records: Not available to Northfield.',
    how_to_reproduce: 'Every total counts rows of findings and finding_actions for this side (run_readonly_sql): a stage total is the number of findings with that stage at or before as_of.' };
  if (use_case) { const u = USE_CASES.find((x) => x.toLowerCase() === String(use_case).toLowerCase()); if (!u) return { found: false, message: `use_case is one of: ${USE_CASES.join(', ')}` }; const xs = V.filter((v) => v.use_case === u); out.use_case = { use_case: u, stages: stageTotals(xs), leaks: leaks(xs), findings: xs.slice(0, 200).map(strip) }; }
  else if (list) out.finding_list = V.slice(0, 200).map(strip);
  return out;
}
