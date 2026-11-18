-- One Ashby and Northfield world. Every value is fictional. No scenario keys: one timeline, one set of records.
CREATE TABLE parties (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, gln TEXT, isa TEXT);
CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT NOT NULL, party_id TEXT NOT NULL REFERENCES parties(id), role TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE locations (id TEXT PRIMARY KEY, party_id TEXT NOT NULL REFERENCES parties(id), name TEXT NOT NULL, gln TEXT NOT NULL, active INTEGER NOT NULL, note TEXT, store_number TEXT UNIQUE);
CREATE TABLE items (sku TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES parties(id), description TEXT NOT NULL, gtin TEXT NOT NULL, pack TEXT NOT NULL, case_price REAL NOT NULL, northfield_item TEXT NOT NULL, on_northfield_list INTEGER NOT NULL);
CREATE TABLE rules (id TEXT PRIMARY KEY, owner TEXT NOT NULL, implements TEXT, params TEXT, rule_set TEXT NOT NULL, topic TEXT NOT NULL, doc_type TEXT, statement TEXT NOT NULL, window_hours REAL, limit_value TEXT, charge_code TEXT, charge TEXT, source TEXT NOT NULL, basis TEXT NOT NULL, public_sources TEXT NOT NULL);
CREATE TABLE calendar (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, stage TEXT NOT NULL, week INTEGER NOT NULL, moment TEXT NOT NULL, seen_by TEXT NOT NULL, prototype TEXT NOT NULL, as_of TEXT NOT NULL, anchor TEXT NOT NULL);

-- Every transaction set exchanged, read from the X12 files in build/x12.
CREATE TABLE documents (
  doc_id TEXT PRIMARY KEY, reference TEXT NOT NULL, po TEXT, doc_type TEXT NOT NULL, name TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES parties(id), receiver_id TEXT NOT NULL REFERENCES parties(id), supplier_id TEXT NOT NULL REFERENCES parties(id), partner_id TEXT NOT NULL REFERENCES parties(id),
  sent_at TEXT NOT NULL, isa_ctl INTEGER NOT NULL, gs_ctl INTEGER NOT NULL, st_ctl TEXT NOT NULL,
  status TEXT NOT NULL, answers_doc_id TEXT REFERENCES documents(doc_id), test INTEGER NOT NULL DEFAULT 0, file TEXT NOT NULL, body TEXT NOT NULL, raw TEXT NOT NULL);
CREATE TABLE orders (po TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES parties(id), retailer_id TEXT NOT NULL REFERENCES parties(id), programme TEXT NOT NULL, stream TEXT NOT NULL, ship_to TEXT NOT NULL REFERENCES locations(id), received_at TEXT NOT NULL, requested_delivery TEXT NOT NULL, order_value REAL NOT NULL, accepted_value REAL);
CREATE TABLE order_lines (po TEXT NOT NULL REFERENCES orders(po), line INTEGER NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), northfield_item TEXT, qty_original INTEGER NOT NULL, qty_ordered INTEGER NOT NULL, qty_accepted INTEGER, price REAL NOT NULL, uom TEXT NOT NULL, delivery_date TEXT, price_original REAL, PRIMARY KEY (po, line));
CREATE TABLE order_changes (po TEXT NOT NULL, seq INTEGER NOT NULL, sent_at TEXT NOT NULL, line INTEGER NOT NULL, code TEXT NOT NULL, qty INTEGER, delivery_date TEXT, state TEXT NOT NULL, price REAL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE shipments (shipment_id TEXT PRIMARY KEY, po TEXT NOT NULL REFERENCES orders(po), doc_id TEXT NOT NULL REFERENCES documents(doc_id), sent_at TEXT NOT NULL, shipped_at TEXT NOT NULL, delivery_date TEXT, cartons INTEGER NOT NULL, ship_from TEXT REFERENCES locations(id), ship_to TEXT REFERENCES locations(id), bol TEXT, seal TEXT, complete INTEGER NOT NULL);
CREATE TABLE shipment_lines (shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id), po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT REFERENCES items(sku), qty INTEGER NOT NULL, uom TEXT, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE cartons (sscc TEXT NOT NULL, shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id), po TEXT NOT NULL, line INTEGER NOT NULL, sku TEXT REFERENCES items(sku), qty INTEGER NOT NULL, received INTEGER NOT NULL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE receipts (receipt TEXT NOT NULL, po TEXT NOT NULL, shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id), received_at TEXT NOT NULL, location TEXT REFERENCES locations(id), line INTEGER NOT NULL, qty INTEGER NOT NULL, short INTEGER NOT NULL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE invoices (invoice TEXT PRIMARY KEY, po TEXT NOT NULL REFERENCES orders(po), doc_id TEXT NOT NULL REFERENCES documents(doc_id), sent_at TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL, replaces TEXT REFERENCES invoices(invoice), terms_days INTEGER);
CREATE TABLE invoice_lines (invoice TEXT NOT NULL REFERENCES invoices(invoice), po TEXT NOT NULL, line INTEGER NOT NULL, qty INTEGER NOT NULL, price REAL NOT NULL, FOREIGN KEY (po, line) REFERENCES order_lines(po, line));
CREATE TABLE remittance_items (payment TEXT NOT NULL, paid_at TEXT NOT NULL, payee_id TEXT NOT NULL REFERENCES parties(id), invoice TEXT NOT NULL REFERENCES invoices(invoice), po TEXT, paid REAL NOT NULL, invoice_amount REAL NOT NULL);
CREATE TABLE adjustments (payment TEXT NOT NULL, paid_at TEXT NOT NULL, payee_id TEXT NOT NULL REFERENCES parties(id), invoice TEXT NOT NULL REFERENCES invoices(invoice), po TEXT REFERENCES orders(po), amount REAL NOT NULL, reason TEXT, reference TEXT, note TEXT);
CREATE TABLE errors (error_id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(doc_id), reported_by TEXT NOT NULL REFERENCES documents(doc_id), channel TEXT NOT NULL, code TEXT, cause TEXT NOT NULL, field TEXT, sent_value TEXT, allowed TEXT, rule_id TEXT REFERENCES rules(id), status TEXT NOT NULL, corrected_by TEXT REFERENCES documents(doc_id));
CREATE TABLE warehouse_orders (ref TEXT PRIMARY KEY, po TEXT NOT NULL REFERENCES orders(po), site TEXT REFERENCES locations(id), sent_at TEXT NOT NULL, advice_at TEXT, shipped_at TEXT);
CREATE TABLE store_activity (period_start TEXT NOT NULL, period_end TEXT NOT NULL, sent_at TEXT NOT NULL, sku TEXT NOT NULL REFERENCES items(sku), store TEXT NOT NULL REFERENCES locations(store_number), sold INTEGER NOT NULL, on_hand INTEGER NOT NULL);
-- Records that do not travel as EDI: Supplier ERP postings, warehouse scans, carrier documents, case entries, phone calls.
CREATE TABLE events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, po TEXT, system TEXT NOT NULL, party TEXT NOT NULL, channel TEXT NOT NULL, data TEXT NOT NULL);

-- Access: one connection per company, scopes picked by its admin. Proposals hold approval-gated writes (off in this release).
CREATE TABLE connections (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_name TEXT NOT NULL, scopes TEXT NOT NULL, read_only INTEGER NOT NULL, configured_by TEXT NOT NULL, configured_at TEXT NOT NULL);
CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, connection_id TEXT NOT NULL, user_name TEXT NOT NULL, tool TEXT NOT NULL, scopes_used TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT NOT NULL, records TEXT NOT NULL,
  -- On every write (T2.3 story 1): the agent or person who proposed it, the authority it ran under (rule id and mode: suggest, approve or policy), who approved and the outcome.
  agent TEXT, authority_rule TEXT, authority_mode TEXT, approver TEXT, outcome TEXT);
CREATE TABLE proposals (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL DEFAULT 'ashby-assistant', kind TEXT NOT NULL DEFAULT 'change', approver TEXT NOT NULL DEFAULT 'Priya Raman', rule_id TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, decided_by TEXT, decided_at TEXT, result_event INTEGER, authority_mode TEXT NOT NULL DEFAULT 'approve', note TEXT);
-- The change list (T2.3): every pause and resume of an agent and every trial of a changed agent rule, with who did it and when.
CREATE TABLE agent_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, connection_id TEXT NOT NULL, agent TEXT NOT NULL, kind TEXT NOT NULL, rule_id TEXT, change TEXT NOT NULL, result TEXT NOT NULL, run_by TEXT NOT NULL, note TEXT);
-- Northfield's own records: reviewer notes on deduction cases, draft rules and their replays. Not shared with suppliers.
CREATE TABLE review_notes (id INTEGER PRIMARY KEY, case_id TEXT NOT NULL, charge TEXT NOT NULL, at TEXT NOT NULL, author TEXT NOT NULL, note TEXT NOT NULL);
CREATE TABLE draft_rules (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, author TEXT NOT NULL, statement TEXT NOT NULL, check_kind TEXT NOT NULL, value REAL NOT NULL, charge REAL, state TEXT NOT NULL, charge_basis TEXT NOT NULL DEFAULT 'per document', basis TEXT NOT NULL DEFAULT 'Northfield', in_force_from TEXT);
CREATE TABLE rule_replays (id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id TEXT, at TEXT NOT NULL, by_connection TEXT NOT NULL, result TEXT NOT NULL);

CREATE INDEX ix_docs_po ON documents(po); CREATE INDEX ix_docs_ref ON documents(reference); CREATE INDEX ix_docs_time ON documents(supplier_id, partner_id, sent_at);
CREATE INDEX ix_err_doc ON errors(doc_id); CREATE INDEX ix_events_po ON events(po, at); CREATE INDEX ix_events_kind ON events(kind, at);
CREATE INDEX ix_cartons_ship ON cartons(shipment_id); CREATE INDEX ix_cartons_sscc ON cartons(sscc); CREATE INDEX ix_lines_po ON order_lines(po);

-- ── T1.11: dated values, the document flow, and typed records read from the event log ─────────────────────────────
-- One master per thing; transactions reference masters; a value that changes over time carries valid_from and valid_to
-- (exclusive; null is open) and is read as of the date of the document it judges. Borrowed from ERPNext (Item Price
-- Valid From and Valid Upto, Pricing Rule validity), SAP (condition records DATAB and DATBI) and NetSuite (records
-- created from another record). See docs/phase1/world-model.md.
CREATE TABLE rule_sets (id TEXT PRIMARY KEY, owner TEXT NOT NULL, published_at TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, note TEXT);
CREATE TABLE rule_versions (rule_id TEXT NOT NULL REFERENCES rules(id), rule_set TEXT NOT NULL REFERENCES rule_sets(id), valid_from TEXT NOT NULL, valid_to TEXT,
  statement TEXT NOT NULL, params TEXT, window_hours REAL, limit_value TEXT, charge TEXT, PRIMARY KEY (rule_id, valid_from));
-- What the item is, version by version (description, pack, units per case), and when Northfield accepted each version.
CREATE TABLE item_versions (sku TEXT NOT NULL REFERENCES items(sku), version INTEGER NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT, description TEXT NOT NULL,
  pack TEXT NOT NULL, units_per_case INTEGER NOT NULL, accepted_by TEXT REFERENCES parties(id), accepted_at TEXT, PRIMARY KEY (sku, version));
-- A price on a named list, dated: Northfield's cost per ordering unit. ERPNext Item Price; SAP condition record.
CREATE TABLE item_prices (sku TEXT NOT NULL REFERENCES items(sku), price_list TEXT NOT NULL, uom TEXT NOT NULL, amount REAL NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
  source TEXT NOT NULL, PRIMARY KEY (sku, price_list, valid_from));
-- The document flow: each document names the one it was created from (SAP VBFA preceding and subsequent document;
-- ERPNext against_sales_order and return_against; NetSuite created from). A document may name more than one.
CREATE TABLE document_links (doc_id TEXT NOT NULL REFERENCES documents(doc_id), prev_doc_id TEXT NOT NULL REFERENCES documents(doc_id), kind TEXT NOT NULL, PRIMARY KEY (doc_id, prev_doc_id));
-- Typed records read from the event log (events stays the log; these tables are derived from it, one row per event).
CREATE TABLE shipment_plans (event_id INTEGER PRIMARY KEY REFERENCES events(id), at TEXT NOT NULL, po TEXT REFERENCES orders(po), shipment TEXT NOT NULL, planned_departure TEXT, site TEXT, carrier TEXT, cartons INTEGER);
CREATE TABLE warehouse_scans (event_id INTEGER PRIMARY KEY REFERENCES events(id), at TEXT NOT NULL, po TEXT REFERENCES orders(po), system TEXT NOT NULL, kind TEXT NOT NULL, shipment TEXT,
  cartons_loaded INTEGER, cartons_expected INTEGER, by_sscc INTEGER, line INTEGER, sku TEXT, ordered INTEGER, picked INTEGER, site TEXT, note TEXT);
CREATE TABLE carrier_events (event_id INTEGER PRIMARY KEY REFERENCES events(id), at TEXT NOT NULL, po TEXT REFERENCES orders(po), kind TEXT NOT NULL, shipment TEXT, delivered INTEGER,
  exceptions TEXT, seal TEXT, bol TEXT, assigned_pickup TEXT, note TEXT);
CREATE INDEX ix_links_prev ON document_links(prev_doc_id); CREATE INDEX ix_rv ON rule_versions(rule_id, valid_from); CREATE INDEX ix_prices ON item_prices(sku, price_list, valid_from);
