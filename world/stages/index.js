// Stage modules: each stage of procure-to-pay and order-to-cash that the world grows into (D60) lives in one file here
// and plugs into the build through this list, so stages can be added side by side without editing the core.
//
// A stage module default-exports:
//   id          short name, such as 'catalogue'
//   docs        { '<X12 code>': { func, name, body(d) -> segments, read(segments) -> business fields incl. ref, po } }
//   schema      SQL creating the stage's own tables (declare keys with REFERENCES; masters before transactions)
//   generate(L, ctx)  adds documents (L.doc) and non-EDI records (L.event). Runs inside L.aside, after every existing
//               stream, so control numbers and acknowledgment delays of existing records do not move. Use the
//               stage's own seeded rng (world/lib.js rng), never the shared one. ctx = { W, ref, P10_WINDOW }.
//   derive(d, T, ctx)  called for each accepted, non-test document of the stage's types, in send order; pushes rows into
//               T[<table>] (create the array if missing). ctx = { docs, byRef, loc, T }.
//   finish(T, ctx)     optional: after every document, for rows that need the whole set.
//   prev(d, ctx)       predecessor documents for the document flow: [{ doc_id, kind }]. Every document except an
//               origin type (STAGE.origins) must name the document it was created from (ERPNext Delivery Note
//               against_sales_order, NetSuite "created from", SAP document flow VBFA).
//   origins     X12 codes of this stage that start a flow and have no predecessor, with the reason in a comment.
//   masters     optional { table: rows } inserted before documents (reference data a stage owns).
//   views       { ashby: [sql], northfield: [sql] } INSERT ... SELECT statements copying the stage's tables from m.*
//               into each company's scoped copy. A table missing from a view is not visible to that company.
import { registerType } from '../x12.js';
import { docNames } from '../ref.js';
import planning from './planning.js';

export const STAGES = [planning];

for (const s of STAGES) for (const [code, def] of Object.entries(s.docs || {})) { registerType(code, def); docNames[code] = def.name; }
export const STAGE_BY_TYPE = Object.fromEntries(STAGES.flatMap((s) => Object.keys(s.docs || {}).map((c) => [c, s])));
export const STAGE_TYPES = new Set(Object.keys(STAGE_BY_TYPE));
