// The tool surface: one list that the MCP server, the OpenAPI draft and the registry check all read.
// Each tool is derived from a recurring job a customer's own assistant does (see registry/registry.json).
import { z } from 'zod';
import * as D from './domain.js';
import * as A from './agents.js';
import { scorecard, scorecardAsOf } from './score.js';
import * as NR from './retailer.js';

const asOf = z.string().optional().describe('Point in time to answer as of, ISO 8601 (2026-11-18T09:00:00-05:00) or a date. Default: the story clock, Tuesday 17 November 2026 11:00 Eastern.');
const fromD = z.string().optional().describe('Earliest opening date to include, ISO 8601 or a date. Default: the start of the current quarter, 27 September 2026.');
const t = (v) => D.asOfDate(v);

export const SCOPES = ['orders', 'documents', 'errors', 'rules', 'deductions'];
export const TOOLS = [
  { name: 'orders_needing_attention', title: 'Orders needing attention', job: 'Start-of-day triage', rest: ['GET', '/v1/orders/attention'], required: ['orders', 'documents'], optional: ['errors', 'rules'],
    description: 'Ashby orders with Northfield that need action at a point in time: rejected documents, and required documents not sent as their deadline nears. Each item carries the reason, the Northfield rule and its source, the deadline, the time left and a link to the order record. Set include_warehouse to add the Kinross shipping advice (945). Also lists items checked that need nothing.',
    input: { as_of: asOf, include_warehouse: z.boolean().optional().describe('Also check the warehouse shipping advice from Kinross') },
    run: (db, a) => D.attention(db, t(a.as_of), { warehouse: !!a.include_warehouse }) },
  { name: 'explain_rejection', title: 'Explain a rejected document', job: 'Rejection diagnosis', rest: ['GET', '/v1/documents/{reference}/rejection'], required: ['documents', 'errors'], optional: ['rules'],
    description: 'Why Northfield rejected an Ashby document: the failing field, the value sent and its length, what is allowed, the rule and its source, the root cause where the Supplier ERP records one, whether it was corrected, and later documents that failed for the same cause. Accepts a document reference such as ASN-46118 or a PO number.',
    input: { reference: z.string().describe('Document reference (ASN-46118, INV-46133) or PO number') }, run: (db, a) => D.explainRejection(db, a.reference) },
  { name: 'edi_health_summary', title: 'EDI health summary', job: 'Periodic health review', rest: ['GET', '/v1/health'], required: ['documents'], optional: ['errors'],
    description: 'Ashby’s EDI exchange with Northfield over a period: documents by type, failures, failures by channel (application advice 824 or technical acknowledgment 997), open failures and the top causes.',
    input: { days: z.number().int().min(1).max(120).optional().describe('Days ending at as_of, default 30'), as_of: asOf }, run: (db, a) => D.health(db, a.days || 30, t(a.as_of)) },
  { name: 'check_deliveries', title: 'Check deliveries for POs', job: 'Escalation check', rest: ['POST', '/v1/deliveries/check'], required: ['orders', 'documents'], optional: [],
    description: 'For a list of PO numbers, whether each was delivered on time: the requested delivery date on the purchase order against the date on Northfield’s receiving advice (861), with truck departure, ship notices and receipts. Use it to check a buyer’s claim that orders arrived late.',
    input: { pos: z.array(z.string()).min(1).max(50).describe('PO numbers, for example NR-46101') }, run: (db, a) => D.deliveries(db, a.pos) },
  { name: 'get_order', title: 'Order record', job: 'Order lookup', rest: ['GET', '/v1/orders/{po}'], required: ['orders'], optional: ['documents', 'errors', 'deductions'],
    description: 'One Ashby order with Northfield, whole history: lines as first ordered, as now ordered and as accepted; order changes; every document in order with its status; shipments; receipts; invoices; payments; charges; and records from the Supplier ERP, the warehouse, the carrier and the deduction case.',
    input: { po: z.string().describe('PO number, for example NR-450118'), as_of: asOf.describe('Point in time to answer as of, ISO 8601 or a date. An order Northfield had not yet sent at that time is reported as no such order. Default: the story clock, Tuesday 17 November 2026 11:00 Eastern.') }, run: (db, a) => D.lifecycle(db, a.po, t(a.as_of)) },
  { name: 'get_document', title: 'Document with its X12', job: 'Evidence retrieval', rest: ['GET', '/v1/documents/{reference}'], required: ['documents'], optional: [],
    description: 'One exchanged document by reference: who sent it, when, its status, its control numbers, every version sent under that reference, and the X12 text as exchanged.',
    input: { reference: z.string().describe('Document reference, for example ASN-450118-2 or RCV-DC2-77355') }, run: (db, a) => D.document(db, a.reference) },
  { name: 'lookup_retailer_rules', title: 'Retailer rules', job: 'Requirement lookup', rest: ['GET', '/v1/rules'], required: ['rules'], optional: [],
    description: 'The rule catalogue Ashby works under, each rule with its owner (Industry standard, US law, Northfield, Ashby, Ashby agreement), the Northfield rule an Ashby rule implements, its basis and source, and the precedence statement saying which rule wins. Covers Northfield’s supplier guide 2026.2 (deadlines, field limits, item and location rules, charges, evidence and scorecard rules), Ashby’s own policies and its Kinross and marketplace agreements. Filter by rule id or charge code, topic words, or X12 document number.',
    input: { rule_id: z.string().optional().describe('Rule id or charge code, for example NF-4.2 or AS02'), topic: z.string().optional().describe('Words to match, for example "ship notice"'), document: z.string().optional().describe('X12 set, for example 856') }, run: (db, a) => D.rules(db, { id: a.rule_id, topic: a.topic, document: a.document }) },
  { name: 'list_deductions', title: 'Deduction cases', job: 'Deduction triage', rest: ['GET', '/v1/deductions'], required: ['deductions'], optional: [],
    description: 'Northfield deduction cases opened against Ashby in the current quarter up to a point in time, each with its charge, amount and order. Pass from (a date, for example 2026-03-29) to include decided cases from the history before the quarter.', input: { as_of: asOf, from: fromD }, run: (db, a) => D.deductions(db, t(a.as_of), a.from) },
  { name: 'get_deduction_case', title: 'Deduction case', job: 'Deduction triage', rest: ['GET', '/v1/deductions/{case}'], required: ['deductions'], optional: ['rules'],
    description: 'One deduction case: the charge and its rule, the remittance that withheld it, the dispute deadline and time left, where each piece of required evidence sits (in the case, held by another system, or not found), the case history and any repayment.',
    input: { case: z.string().describe('Case id (DC-40877), deduction reference (DM-55102) or PO number'), as_of: asOf }, run: (db, a) => D.deductionCase(db, a.case, t(a.as_of)) },
  { name: 'get_scorecard', title: 'Northfield scorecard', job: 'Performance review', rest: ['GET', '/v1/scorecard'], required: ['orders', 'documents'], optional: [],
    description: 'Northfield’s on-time, in-full scorecard for Ashby over the 13-week quarter, recomputed from orders and receiving advice: cases, failing cases, failing lines by reason, and the figures Northfield published. Northfield publishes it on 28 Dec 2026; before then it answers that the quarter is not published and lists the files published so far.',
    input: { lines: z.boolean().optional().describe('Include every failing line'), as_of: asOf }, run: (db, a) => { const r = scorecardAsOf(db, t(a.as_of)); if (r.published && a.lines) r.lines = scorecard(db).lines; return r; } },
  { name: 'recommend_next_step', title: 'Next step for an exception', job: 'Exception investigation', rest: ['POST', '/v1/next-step'], required: ['orders', 'documents'], optional: ['errors', 'rules', 'deductions'],
    description: 'For one exception, reads the Supplier ERP, warehouse, carrier and Trading Grid records and returns the next step with the evidence behind it and what a fixed rule would have done. Jobs: missing_document (record: PO), deduction (record: case id), trade_test (record: test ship notice), shelf (record: store number), shipment_risk (record: PO), scorecard (record: "YYYY-MM-DD to YYYY-MM-DD", optional). It proposes; it sends and changes nothing.',
    input: { job: z.enum(Object.keys(A.JOBS)).describe('Kind of exception'), record: z.string().optional().describe('The record to investigate'), as_of: asOf }, run: (db, a) => A.JOBS[a.job](db, a.record || '', t(a.as_of)) },
  { name: 'get_story_calendar', title: 'Story calendar', job: 'Orientation', rest: ['GET', '/v1/calendar'], required: [], optional: [],
    description: 'The quarter of trade this connection holds and the moments on it, each with the time to pass as as_of and its anchor record.', input: {}, run: (db) => D.calendar(db) },
];

/** Refusals and the write boundary. */
export const BOUNDARY = [
  { name: 'compare_with_other_suppliers', title: 'Compare with other suppliers', rest: ['GET', '/v1/suppliers/compare'], description: 'Requests to compare Ashby with other Northfield suppliers or read their records. Always answers "Not available to Ashby".', input: { question: z.string().describe('What the user asked about other suppliers') } },
  { name: 'request_change', title: 'Request a change in Trading Grid', rest: ['POST', '/v1/proposals'], description: 'Use when the user asks to send, resend, correct, approve or change anything. In this release the connection is read-only: it answers "Action not available" with the Trading Grid record where an authorized user completes and approves the action. With writes enabled it records an approval-gated proposal instead; nothing changes until Priya Raman approves it in Trading Grid.', input: { action: z.string().describe('What the user asked to do'), po: z.string().optional().describe('PO number the action concerns'), document: z.string().optional().describe('Document reference the action concerns') } },
];

/** Ashby's writes beyond request_change. Each records a proposal a person approves, except AP-4.1's exception. */
export const ASHBY_WRITES = [
  { name: 'submit_dispute', title: 'Dispute a deduction', rule: 'AP-4.1', description: 'Disputes one charge in a Northfield deduction case with the evidence named. Under AP-4.1 Claim Agent may submit without asking only when the NF-7.4 evidence is already in the case and the amount is under $250; otherwise this records a proposal and Priya Raman decides between dispute and write-off in Trading Grid. The dispute lands in the shared case and in both companies’ access logs.',
    input: { case: z.string().describe('Case id, for example DC-41118'), charge: z.string().optional().describe('Charge code, default the case charge'), evidence: z.array(z.string()).optional().describe('Evidence to put in the case, for example "Load tally by SSCC"'), as_of: asOf } },
  { name: 'release_ship_notice', title: 'Release a held ship notice', rule: 'AP-1.3', description: 'Asks to release a held ship notice. Under AP-1.3 only a person releases a held ship notice, after every failure on it is fixed: this always records a proposal for Priya Raman and never sends anything itself.',
    input: { document: z.string().describe('Ship notice reference'), po: z.string().optional() } },
];
export const ASHBY_REFUSALS = [
  { name: 'read_retailer_records', title: 'Northfield’s own records', description: 'Requests to read Northfield’s accounts payable, draft rules, claims reviewer notes or internal systems. Always answers "Not available to Ashby": those records belong to Northfield Retailer.', input: { question: z.string().describe('What the user asked to see') } },
];

const sup = z.string().optional().describe('Supplier name or id, for example Ashby Supplier');
/** Northfield's connection for Jordan Ellis's own assistant, on the same world. */
export const NF_SCOPES = ['suppliers', 'documents', 'errors', 'rules', 'deductions', 'payables', 'rule_drafts'];
export const NF_TOOLS = [
  { name: 'supplier_document_trail', title: 'Supplier document trail', job: 'Supplier exchange review', required: ['suppliers', 'documents'], optional: ['errors'],
    description: 'Every document Northfield exchanged with a supplier on one PO, in order, with rejections, receipts and invoices; or a supplier’s exchange over a period with failures by channel. Shared records only: the supplier’s ERP, warehouse, carrier and agent records are not shown.',
    input: { po: z.string().optional().describe('PO number, for example NR-450118'), supplier: sup, days: z.number().int().min(1).max(120).optional(), as_of: asOf }, run: (db, a) => NR.trail(db, { po: a.po, supplier: a.supplier, days: a.days || 30, asOf: t(a.as_of) }) },
  { name: 'get_document', title: 'Document with its X12', job: 'Evidence retrieval', required: ['documents'], optional: [],
    description: 'One document Northfield sent or received, with the X12 as exchanged. The same X12 the supplier sees. Documents between a supplier and its own warehouse are not Northfield’s.',
    input: { reference: z.string().describe('Document reference, for example ASN-450118-2') }, run: (db, a) => NR.documentNF(db, a.reference) },
  { name: 'supplier_scorecard', title: 'Supplier scorecard', job: 'Performance review', required: ['suppliers'], optional: [],
    description: 'The on-time, in-full scorecard Northfield publishes for a supplier over the 13-week quarter: cases, failing cases, failing lines by reason and the published figures. Published on 28 Dec 2026; before then it answers that the quarter is not published and lists the files published so far.', input: { supplier: sup, as_of: asOf }, run: (db, a) => NR.scorecardNF(db, a.supplier, t(a.as_of)) },
  { name: 'list_deduction_cases', title: 'Deduction cases', job: 'Claims queue', required: ['deductions'], optional: [],
    description: 'Deduction cases Northfield has opened against its suppliers in the current quarter up to a point in time, with count and total. Pass from (a date, for example 2026-03-29) to include decided cases from the history before the quarter, across suppliers.', input: { as_of: asOf, from: fromD }, run: (db, a) => NR.casesNF(db, t(a.as_of), a.from) },
  { name: 'review_deduction_case', title: 'Review a deduction case', job: 'Claims review', required: ['deductions'], optional: ['rules'],
    description: 'One deduction case from Northfield’s side: the charges withheld, what the supplier put in the case, what NF-7.4 requires, the claims reviewer’s notes, the decisions so far, and Review Agent’s recommendation for the next undecided charge. Jordan Ellis decides each charge (NF-7.7); the agent only recommends.',
    input: { case: z.string().describe('Case id, deduction reference or PO number'), as_of: asOf }, run: (db, a) => NR.caseNF(db, a.case, t(a.as_of)) },
  { name: 'three_way_match', title: 'Three-way match variance', job: 'Payables exception', required: ['payables', 'documents'], optional: ['rules'],
    description: 'Purchase order, receiving advice and invoice for one invoice or PO: line by line ordered, accepted, shipped, received and billed; where any variance comes from (quantity, price, a missed correction; promotion and tax where present); and the record that settles it. Payment approval stays in Northfield accounts payable.',
    input: { reference: z.string().describe('Invoice number (INV-7731) or PO number'), as_of: asOf }, run: (db, a) => NR.threeWayMatch(db, a.reference, t(a.as_of)) },
  { name: 'list_draft_rules', title: 'Draft rules', job: 'Rule authoring', required: ['rule_drafts'], optional: [], description: 'Northfield’s draft supplier rules not yet published, with what each checks.', input: {}, run: (db) => NR.draftRules(db) },
  { name: 'replay_draft_rule', title: 'Replay a draft rule against the quarter', job: 'Rule authoring', required: ['rule_drafts', 'documents'], optional: [],
    description: `Applies a draft rule to every document exchanged in the current quarter (history before it is not replayed) and shows which suppliers would fail, how many documents, and the charge exposure, against the rule in force. Pass a draft id (NFD-1) or a check and value. Checks: ${Object.keys(NR.REPLAY_CHECKS).join(', ')}. Publishing a rule needs a replay on record.`,
    input: { draft: z.string().optional(), check: z.enum(Object.keys(NR.REPLAY_CHECKS)).optional(), value: z.number().optional(), charge: z.number().optional().describe('Charge per failure in dollars, default 150') }, run: (db, a) => NR.replayRule(db, a), records_replay: true },
  { name: 'lookup_rules', title: 'Supplier guide rules', job: 'Requirement lookup', required: ['rules'], optional: [],
    description: 'Northfield’s supplier guide 2026.2 with the industry and legal rules it relies on, each with owner, basis and source, and the precedence statement. Suppliers’ own policies are theirs and are not shown.',
    input: { rule_id: z.string().optional(), topic: z.string().optional(), document: z.string().optional() }, run: (db, a) => D.rules(db, { id: a.rule_id, topic: a.topic, document: a.document, viewer: 'NORTHFIELD' }) },
  { name: 'get_story_calendar', title: 'Story calendar', job: 'Orientation', required: [], optional: [], description: 'The quarter this connection holds and its moments, each with the time to pass as as_of.', input: {}, run: (db) => D.calendar(db) },
];
export const NF_WRITES = [
  { name: 'decide_charge', title: 'Decide a charge in a deduction case', rule: 'NF-7.7', description: 'Drafts Northfield’s decision on one disputed charge (reverse or uphold) with its reason. Under NF-7.7 the claims reviewer decides: this records a proposal and Jordan Ellis decides it in Trading Grid. The decision lands in the shared case and in both companies’ access logs.',
    input: { case: z.string(), charge: z.string(), decision: z.enum(['Reversed', 'Upheld']), reason: z.string().optional(), as_of: asOf } },
  { name: 'publish_rule', title: 'Publish a draft rule', rule: 'NFD', description: 'Asks to publish a draft rule to suppliers. Refused unless the draft has been replayed against the quarter on this connection; otherwise records a proposal Jordan Ellis approves. Publishing is recorded for every supplier it binds.',
    input: { draft: z.string().describe('Draft rule id, for example NFD-1') } },
  { name: 'request_change', title: 'Request a change in Trading Grid', description: 'Use when the user asks to send, correct or change anything else, for example a revised receiving advice. Records a proposal; nothing changes until Jordan Ellis approves it in Trading Grid.',
    input: { action: z.string(), po: z.string().optional(), document: z.string().optional() } },
];
export const NF_REFUSALS = [
  { name: 'read_supplier_records', title: 'A supplier’s own records', description: 'Requests to read a supplier’s ERP, warehouse, carrier or agent records, its warehouse documents (940, 945) or its internal policies. Always answers "Not available to Northfield": those records belong to the supplier unless it shares them into a case or on a document.', input: { question: z.string().describe('What the user asked to see'), supplier: sup } },
];
