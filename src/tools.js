// The tool surface: one list that the MCP server, the OpenAPI draft and the registry check all read.
// Each tool is derived from a recurring job a customer's own assistant does (see registry/registry.json).
import { z } from 'zod';
import * as D from './domain.js';
import * as A from './agents.js';
import { scorecard } from './score.js';

const asOf = z.string().optional().describe('Point in time to answer as of, ISO 8601 (2026-11-18T09:00:00-05:00) or a date. Default: the story clock, Tuesday 17 November 2026 11:00 Eastern.');
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
    input: { po: z.string().describe('PO number, for example NR-450118') }, run: (db, a) => D.lifecycle(db, a.po) },
  { name: 'get_document', title: 'Document with its X12', job: 'Evidence retrieval', rest: ['GET', '/v1/documents/{reference}'], required: ['documents'], optional: [],
    description: 'One exchanged document by reference: who sent it, when, its status, its control numbers, every version sent under that reference, and the X12 text as exchanged.',
    input: { reference: z.string().describe('Document reference, for example ASN-450118-2 or RCV-DC2-77355') }, run: (db, a) => D.document(db, a.reference) },
  { name: 'lookup_retailer_rules', title: 'Retailer rules', job: 'Requirement lookup', rest: ['GET', '/v1/rules'], required: ['rules'], optional: [],
    description: 'The rule catalogue Ashby works under, each rule with its owner (Industry standard, US law, Northfield, Ashby, Ashby agreement), the Northfield rule an Ashby rule implements, its basis and source, and the precedence statement saying which rule wins. Covers Northfield’s supplier guide 2026.2 (deadlines, field limits, item and location rules, charges, evidence and scorecard rules), Ashby’s own policies and its Kinross and marketplace agreements. Filter by rule id or charge code, topic words, or X12 document number.',
    input: { rule_id: z.string().optional().describe('Rule id or charge code, for example NF-4.2 or AS02'), topic: z.string().optional().describe('Words to match, for example "ship notice"'), document: z.string().optional().describe('X12 set, for example 856') }, run: (db, a) => D.rules(db, { id: a.rule_id, topic: a.topic, document: a.document }) },
  { name: 'list_deductions', title: 'Deduction cases', job: 'Deduction triage', rest: ['GET', '/v1/deductions'], required: ['deductions'], optional: [],
    description: 'Northfield deduction cases opened against Ashby up to a point in time, each with its charge, amount and order.', input: { as_of: asOf }, run: (db, a) => D.deductions(db, t(a.as_of)) },
  { name: 'get_deduction_case', title: 'Deduction case', job: 'Deduction triage', rest: ['GET', '/v1/deductions/{case}'], required: ['deductions'], optional: ['rules'],
    description: 'One deduction case: the charge and its rule, the remittance that withheld it, the dispute deadline and time left, where each piece of required evidence sits (in the case, held by another system, or not found), the case history and any repayment.',
    input: { case: z.string().describe('Case id (DC-40877), deduction reference (DM-55102) or PO number'), as_of: asOf }, run: (db, a) => D.deductionCase(db, a.case, t(a.as_of)) },
  { name: 'get_scorecard', title: 'Northfield scorecard', job: 'Performance review', rest: ['GET', '/v1/scorecard'], required: ['orders', 'documents'], optional: [],
    description: 'Northfield’s on-time, in-full scorecard for Ashby over the 13-week quarter, recomputed from orders and receiving advice: cases, failing cases, failing lines by reason, and the figures Northfield published.',
    input: { lines: z.boolean().optional().describe('Include every failing line') }, run: (db, a) => { const s = scorecard(db); if (!a.lines) delete s.lines; return s; } },
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
