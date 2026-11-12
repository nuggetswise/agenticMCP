-- One Ashby and Northfield world. Every value is fictional. No scenario keys: one timeline, one set of records.
CREATE TABLE parties (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, gln TEXT, isa TEXT);
CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, party_id TEXT NOT NULL, role TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE locations (id TEXT PRIMARY KEY, party_id TEXT NOT NULL, name TEXT NOT NULL, gln TEXT NOT NULL, active INTEGER NOT NULL, note TEXT);
CREATE TABLE items (sku TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, description TEXT NOT NULL, gtin TEXT NOT NULL, pack TEXT NOT NULL, case_price REAL NOT NULL, northfield_item TEXT NOT NULL, on_northfield_list INTEGER NOT NULL);
CREATE TABLE rules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, implements TEXT, params TEXT, rule_set TEXT NOT NULL, topic TEXT NOT NULL, doc_type TEXT, statement TEXT NOT NULL, window_hours REAL, limit_value TEXT, charge_code TEXT, charge TEXT, source TEXT NOT NULL, basis TEXT NOT NULL, public_sources TEXT NOT NULL);
CREATE TABLE calendar (id TEXT PRIMARY KEY, week INTEGER NOT NULL, moment TEXT NOT NULL, seen_by TEXT NOT NULL, prototype TEXT NOT NULL, as_of TEXT NOT NULL, anchor TEXT NOT NULL);

-- Every transaction set exchanged, read from the X12 files in build/x12.
CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY, reference TEXT NOT NULL, po TEXT, doc_type TEXT NOT NULL, name TEXT NOT NULL,
  sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL, supplier_id TEXT NOT NULL, partner_id TEXT NOT NULL,
  sent_at TEXT NOT NULL, isa_ctl INTEGER NOT NULL, gs_ctl INTEGER NOT NULL, st_ctl TEXT NOT NULL,
  status TEXT NOT NULL, answers_doc_id TEXT, test INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL, body TEXT NOT NULL, raw TEXT NOT NULL);
CREATE TABLE orders (po TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, retailer_id TEXT NOT NULL, programme TEXT NOT NULL, stream TEXT NOT NULL, ship_to TEXT NOT NULL, received_at TEXT NOT NULL, requested_delivery TEXT NOT NULL, order_value REAL NOT NULL, accepted_value REAL);
CREATE TABLE order_lines (po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT NOT NULL, northfield_item TEXT, qty_original INTEGER NOT NULL, qty_ordered INTEGER NOT NULL, qty_accepted INTEGER, price REAL NOT NULL, uom TEXT NOT NULL, delivery_date TEXT, PRIMARY KEY (po, line));
CREATE TABLE order_changes (po TEXT NOT NULL, seq INTEGER NOT NULL, sent_at TEXT NOT NULL, line INTEGER NOT NULL, code TEXT NOT NULL, qty INTEGER, delivery_date TEXT, state TEXT NOT NULL);
CREATE TABLE shipments (shipment_id TEXT PRIMARY KEY, po TEXT NOT NULL, doc_id TEXT NOT NULL, sent_at TEXT NOT NULL, shipped_at TEXT NOT NULL, delivery_date TEXT, cartons INTEGER NOT NULL, ship_from TEXT, ship_to TEXT, bol TEXT, seal TEXT, complete INTEGER NOT NULL);
CREATE TABLE shipment_lines (shipment_id TEXT NOT NULL, po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT, qty INTEGER NOT NULL, uom TEXT);
CREATE TABLE cartons (sscc TEXT NOT NULL, shipment_id TEXT NOT NULL, po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT, qty INTEGER NOT NULL, received INTEGER NOT NULL);
CREATE TABLE receipts (receipt TEXT NOT NULL, po TEXT NOT NULL, shipment_id TEXT NOT NULL, received_at TEXT NOT NULL, location TEXT, line INTEGER NOT NULL, qty INTEGER NOT NULL, short INTEGER NOT NULL);
CREATE TABLE invoices (invoice TEXT PRIMARY KEY, po TEXT NOT NULL, doc_id TEXT NOT NULL, sent_at TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL, replaces TEXT, terms_days INTEGER);
CREATE TABLE invoice_lines (invoice TEXT NOT NULL, po TEXT NOT NULL, line INTEGER NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL);
CREATE TABLE remittance_items (payment TEXT NOT NULL, paid_at TEXT NOT NULL, payee_id TEXT NOT NULL, invoice TEXT NOT NULL, po TEXT, paid REAL NOT NULL, invoice_amount REAL NOT NULL);
CREATE TABLE adjustments (payment TEXT NOT NULL, paid_at TEXT NOT NULL, payee_id TEXT NOT NULL, invoice TEXT NOT NULL, po TEXT, amount REAL NOT NULL, reason TEXT, reference TEXT, note TEXT);
CREATE TABLE errors (error_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, reported_by TEXT NOT NULL, channel TEXT NOT NULL, code TEXT, cause TEXT NOT NULL, field TEXT, sent_value TEXT, allowed TEXT, rule_id TEXT, status TEXT NOT NULL, corrected_by TEXT);
CREATE TABLE warehouse_orders (ref TEXT PRIMARY KEY, po TEXT NOT NULL, site TEXT, sent_at TEXT NOT NULL, advice_at TEXT, shipped_at TEXT);
CREATE TABLE store_activity (period_start TEXT NOT NULL, period_end TEXT NOT NULL, sent_at TEXT NOT NULL, sku TEXT NOT NULL, store TEXT NOT NULL, sold INTEGER NOT NULL, on_hand INTEGER NOT NULL);
-- Records that do not travel as EDI: Supplier ERP postings, warehouse scans, carrier documents, case entries, phone calls.
CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, po TEXT, system TEXT NOT NULL, party TEXT NOT NULL, channel TEXT NOT NULL, data TEXT NOT NULL);

-- Access: one connection per company, scopes picked by its admin. Proposals hold approval-gated writes (off in this release).
CREATE TABLE connections (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_name TEXT NOT NULL, scopes TEXT NOT NULL, read_only INTEGER NOT NULL, configured_by TEXT NOT NULL, configured_at TEXT NOT NULL);
CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, connection_id TEXT NOT NULL, user_name TEXT NOT NULL, tool TEXT NOT NULL, scopes_used TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT NOT NULL, records TEXT NOT NULL);
CREATE TABLE proposals (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, decided_by TEXT, decided_at TEXT, result_event INTEGER);

CREATE INDEX ix_docs_po ON documents(po); CREATE INDEX ix_docs_ref ON documents(reference); CREATE INDEX ix_docs_time ON documents(supplier_id, partner_id, sent_at);
CREATE INDEX ix_err_doc ON errors(doc_id); CREATE INDEX ix_events_po ON events(po, at); CREATE INDEX ix_events_kind ON events(kind, at);
CREATE INDEX ix_cartons_ship ON cartons(shipment_id); CREATE INDEX ix_cartons_sscc ON cartons(sscc); CREATE INDEX ix_lines_po ON order_lines(po);
