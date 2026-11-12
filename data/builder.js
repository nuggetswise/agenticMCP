// Collects one scenario's rows. Scenario generators call these methods; seed.js writes the rows.
import { docNames } from './reference.js';

export class Scenario {
  constructor(meta) {
    this.meta = meta; // { id, name, clock (Date), rule_set, summary }
    this.orders = []; this.lines = []; this.shipments = []; this.docs = []; this.errors = [];
    this.warehouse = []; this.confirmations = []; this.deductions = []; this.cartons = []; this.scorecards = [];
    this.ctl = 1000; this.errSeq = 1;
    this.docIndex = new Map();
  }

  order(o) { this.orders.push(o); return o; }
  line(l) { this.lines.push(l); return l; }
  shipment(s) { this.shipments.push(s); return s; }

  /** Adds a document. Returns its doc_id. */
  doc({ type, reference, po = null, supplier = 'ASHBY', retailer = 'NORTHFIELD', sender, receiver, at, status = 'Delivered', answers = null, covers = null, body = {}, id = null }) {
    let doc_id = id || `${type}:${reference}`;
    if (this.docIndex.has(doc_id)) { let n = 2; while (this.docIndex.has(`${doc_id}#${n}`)) n++; doc_id = `${doc_id}#${n}`; }
    const d = {
      scenario: this.meta.id, doc_id, reference, po, supplier_id: supplier, retailer_id: retailer, doc_type: type,
      name: docNames[type], sender_id: sender, receiver_id: receiver, sent_at: at, group_control: String(this.ctl++),
      status, answers_doc_id: answers, covers, body,
    };
    this.docs.push(d); this.docIndex.set(doc_id, d);
    return doc_id;
  }

  getDoc(id) { return this.docIndex.get(id); }

  /** Records a rejection of `docId` reported by `reportedBy`. */
  error(e) {
    const row = { scenario: this.meta.id, error_id: `E${String(this.errSeq++).padStart(4, '0')}`, status: 'Open', corrected_by: null, root_cause: null, rule_id: null, sent_value: null, allowed: null, ...e };
    this.errors.push(row);
    return row;
  }
}
