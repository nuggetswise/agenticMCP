// P28 Guide change hits next week's shipments, and P21's "Create rules from a document" (24 November 2026, owner decisions;
// spec: "TG for Retail · Prototype build prompts", sections P21 and P28).
//
// Rule documents. Every rule now cites the document and section it comes from: Northfield's supplier guide in three
// versions (2026.1, 2026.2 in force for the quarter, 2026.3 published 20 November, in force from Monday 30 November),
// and the agreements behind Ashby's agreement rules (Kinross, Kanmon, the marketplace). Each section carries a segment
// note: where in the X12 a supplier meets it. Segment notes are reference data for rule authoring and stay off screen.
//
// The guide change. Guide 2026.3 adds one ship notice requirement, NF-4.18: a trip ID on every ship notice, from
// 30 November, charged $150 per ship notice without it. Modelled on a published retailer trip ID notice; the rule, its
// start and its charge are invented for Northfield. On Friday 27 November 14:30 ET Ashby's EDI operations add the trip ID
// to Ashby's ship notice map, so every Ashby ship notice the Supplier ERP sends from then carries it (world/log.js asn);
// every other supplier's ship notice carries it from the start date. No ship notice in the world is charged under it.
//
// What is invented: the guide versions' dates and sections, the trip ID rule, its charge, the agreement documents, their
// sections and the map fix. Public basis: the trip ID pattern (a retailer notice requiring the trip ID in the ship notice
// from a dated start) and REF as the X12 carrier for a reference number.
import { et } from '../lib.js';
import * as ref from '../ref.js';

export const TRIP_RULE = 'NF-4.18';
export const TRIP_START = et('2026-11-30', '00:00').toISOString(); // Monday 30 November 2026, 00:00 Eastern
export const ASHBY_MAP_FIX = et('2026-11-27', '14:30').toISOString(); // Ashby's ship notice map sends the trip ID from here
export const GUIDE_PUBLISHED = et('2026-11-20', '10:00').toISOString();
export const TRIP_CHARGE = 150;
export const NEW_GUIDE = 'GUIDE-NF-2026.3', OLD_GUIDE = 'GUIDE-NF-2026.2';
/** The trip ID a ship notice carries: T, the ship date and the ship notice's own number. Invented format. */
export const tripIdOf = (ref, shippedAt) => `T${String(shippedAt).slice(0, 10).replace(/-/g, '')}${String(ref).replace(/\D/g, '').slice(-6)}`;
/** Whether a ship notice from this supplier, shipped at this time, carries the trip ID. */
export const carriesTrip = (supplier, shippedAt) => String(shippedAt) >= (supplier === 'ASHBY' ? ASHBY_MAP_FIX : TRIP_START);

const SET_NAME = { 850: 'Purchase order (850)', 855: 'Order acknowledgment (855)', 856: 'Ship notice (856)', 810: 'Invoice (810)', 824: 'Application advice (824)', 861: 'Receiving advice (861)', 820: 'Remittance advice (820)', 860: 'Order change (860)', 865: 'Change acknowledgment (865)', 997: 'Technical acknowledgment (997)', 832: 'Catalogue (832)', 945: 'Warehouse shipping advice (945)', 940: 'Warehouse shipping order (940)' };
// Where a supplier meets a rule in the X12, for the rules whose place is specific. Others read the set alone.
const SEGMENT = {
  'NF-1.4': 'Order acknowledgment (855): BAK date against the purchase order\'s BEG date', 'NF-1.7': 'Order acknowledgment (855): CTT with the number of order items',
  'NF-4.2': 'Ship notice (856): BSN date and time against DTM 011 (shipped)', 'NF-4.3': 'Ship notice (856): MAN GM with the SSCC under each carton level',
  'NF-4.5': 'Ship notice (856): carton levels and SN1 quantities against the shipment', 'NF-4.7': 'Ship notice (856): N1 ST against the current purchase order',
  'NF-4.8': 'Ship notice (856): LIN order item numbers against the current purchase order', 'NF-4.10': 'Ship notice (856) PRF01 and invoice (810) BIG04: the Northfield PO number',
  'NF-4.13': 'Ship notice (856): TD1 carton count against the carton levels', 'NF-4.14': 'Ship notice (856): SN1 unit of measure CA',
  'NF-4.15': 'Ship notice (856): DTM 011 on or before DTM 017', 'NF-4.16': 'Ship notice (856): LIN item numbers (UP, UK) against the catalogue records',
  'NF-4.17': 'Ship notice (856): REF LT and DTM 036 under each food item', [TRIP_RULE]: 'Ship notice (856) header: REF with qualifier TI carrying the trip ID',
  'NF-7.8': 'Invoice (810): IT1 quantity against the shipped quantity', 'NF-7.9': 'Invoice (810): BIG date against the ship notice\'s DTM 011', 'NF-7.10': 'Invoice (810): TDS against the IT1 amounts',
  'NF-7.11': 'Invoice (810): IT1 price against the acknowledged price', 'NF-1.8': 'Application advice (824): TED01 error code and TED02 message',
  'KX-945': 'Warehouse shipping advice (945) against the warehouse shipping order (940)', 'AP-7.1': 'Warehouse shipping order (940) and advice (945): no change without Kinross\'s acceptance',
  'KN-1': 'Invoice (810) with its receiving advice (861) and application advice (824)', 'AM-1': 'Marketplace shipment confirmation (API)',
};

/** The rule documents and the section of each rule in them. `rules` is the world's rule list (world/ref.js). */
export function ruleDocuments(rules) {
  const docs = [
    { doc_id: 'GUIDE-NF-2026.1', owner: 'Northfield', title: 'Northfield supplier guide', version: '2026.1', published_at: '2026-02-16T15:00:00.000Z', in_force_from: '2026-03-29T04:00:00.000Z', in_force_to: '2026-08-01T04:00:00.000Z', published_by: 'Jordan Ellis', replaces: null, basis: 'Invented' },
    { doc_id: OLD_GUIDE, owner: 'Northfield', title: 'Northfield supplier guide', version: '2026.2', published_at: '2026-07-15T14:00:00.000Z', in_force_from: '2026-08-01T04:00:00.000Z', in_force_to: TRIP_START, published_by: 'Jordan Ellis', replaces: 'GUIDE-NF-2026.1', basis: 'Invented' },
    { doc_id: NEW_GUIDE, owner: 'Northfield', title: 'Northfield supplier guide', version: '2026.3', published_at: GUIDE_PUBLISHED, in_force_from: TRIP_START, in_force_to: null, published_by: 'Jordan Ellis', replaces: OLD_GUIDE, basis: 'Invented' },
    { doc_id: 'AGR-ASHBY-KINROSS', owner: 'Ashby agreement', title: 'Warehouse services agreement, Ashby Supplier and Kinross Logistics', version: '2026', published_at: '2026-02-20T15:00:00.000Z', in_force_from: '2026-02-20T15:00:00.000Z', in_force_to: null, published_by: 'Priya Raman', replaces: null, basis: 'Invented' },
    { doc_id: 'AGR-ASHBY-KANMON', owner: 'Ashby agreement', title: 'Invoice financing agreement, Ashby Supplier and Kanmon', version: '2026', published_at: '2026-11-02T15:00:00.000Z', in_force_from: '2026-11-02T15:00:00.000Z', in_force_to: null, published_by: 'Priya Raman', replaces: null, basis: 'Invented' },
    { doc_id: 'AGR-ASHBY-MARKETPLACE', owner: 'Ashby agreement', title: 'Marketplace seller agreement, Ashby Supplier', version: '2026', published_at: '2026-02-20T15:00:00.000Z', in_force_from: '2026-02-20T15:00:00.000Z', in_force_to: null, published_by: 'Priya Raman', replaces: null, basis: 'Invented' },
  ];
  const sets = (r) => String(r.doc_type || '').split(',').filter(Boolean).map((c) => SET_NAME[c] || `EDI ${c}`).join(' and ');
  const note = (r) => SEGMENT[r.id] || (sets(r) ? `${sets(r)}` : 'No document carries it; the rule governs the trade');
  const sections = [];
  const guide = rules.filter((r) => r.owner === 'Northfield');
  for (const d of [OLD_GUIDE, NEW_GUIDE]) for (const r of guide) {
    if (r.id === TRIP_RULE && d === OLD_GUIDE) continue;
    sections.push({ doc_id: d, section: r.id.replace(/^NF-/, ''), rule_id: r.id, heading: r.topic, requirement: r.statement, segment_note: note(r), charge: r.charge, new_in_version: d === NEW_GUIDE && r.id === TRIP_RULE ? 1 : 0, in_force_from: d === NEW_GUIDE && r.id === TRIP_RULE ? TRIP_START : null });
  }
  const agreement = { 'KX-945': ['AGR-ASHBY-KINROSS', '3.1', 'Shipping advice'], 'AP-7.1': ['AGR-ASHBY-KINROSS', '5.2', 'Changes to warehouse records'], 'KN-1': ['AGR-ASHBY-KANMON', '2', 'Advance on a clean invoice'], 'AM-1': ['AGR-ASHBY-MARKETPLACE', '4', 'Shipment confirmation'] };
  for (const [id, [doc, section, heading]] of Object.entries(agreement)) { const r = rules.find((x) => x.id === id); if (!r) throw new Error(`guide-change: no rule ${id}`);
    sections.push({ doc_id: doc, section, rule_id: id, heading, requirement: r.statement, segment_note: note(r), charge: r.charge, new_in_version: 0, in_force_from: null }); }
  return { rule_documents: docs, rule_sections: sections };
}

function generate(L) {
  // Northfield publishes guide 2026.3. Ashby's EDI operations add the trip ID to Ashby's ship notice map (the record of the
  // fix Priya Raman confirms on P28); the Supplier ERP's ship notices carry it from then.
  L.event({ at: GUIDE_PUBLISHED, kind: 'guide.published', po: null, system: 'Northfield supplier guide', party: 'NORTHFIELD', channel: 'Trading Grid',
    data: { document: NEW_GUIDE, version: '2026.3', replaces: OLD_GUIDE, in_force_from: TRIP_START, new_rules: [TRIP_RULE], published_by: 'Jordan Ellis' } });
  L.event({ at: ASHBY_MAP_FIX, kind: 'erp.correction', po: null, system: 'Supplier ERP', party: 'ASHBY', channel: 'API',
    data: { record: 'Ashby ship notice map to Northfield', change: 'Trip ID sent in the ship notice header (REF TI)', rule: TRIP_RULE, owner: 'EDI operations', fix_in: 'Ashby’s ship notice map', from: 'Not sent' } });
}

export default {
  id: 'guide-change',
  docs: {},
  origins: [],
  prev: () => [],
  schema: `
-- Rule documents (P21, P28): Northfield's supplier guide versions and the agreements behind Ashby's agreement rules.
CREATE TABLE rule_documents (doc_id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL, published_at TEXT NOT NULL, in_force_from TEXT NOT NULL, in_force_to TEXT,
  published_by TEXT NOT NULL, replaces TEXT, basis TEXT NOT NULL);
-- Each rule's section in its document, with the requirement as written and the segment note (where in the X12 it is met).
CREATE TABLE rule_sections (doc_id TEXT NOT NULL REFERENCES rule_documents(doc_id), section TEXT NOT NULL, rule_id TEXT NOT NULL, heading TEXT, requirement TEXT NOT NULL, segment_note TEXT NOT NULL,
  charge TEXT, new_in_version INTEGER NOT NULL, in_force_from TEXT, PRIMARY KEY (doc_id, section));`,
  masters: () => ruleDocuments(ref.rules),
  generate,
  derive: () => {},
  views: {
    ashby: ['INSERT INTO rule_documents SELECT * FROM m.rule_documents', 'INSERT INTO rule_sections SELECT * FROM m.rule_sections'],
    northfield: ["INSERT INTO rule_documents SELECT * FROM m.rule_documents WHERE owner = 'Northfield'", "INSERT INTO rule_sections SELECT * FROM m.rule_sections WHERE doc_id IN (SELECT doc_id FROM rule_documents)"],
  },
};
