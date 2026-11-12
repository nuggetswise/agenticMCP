-- TG for Retail demo database. Every value is fictional.
-- Scenario-keyed tables hold one isolated story per prototype; reference tables are shared.

CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,           -- p10, p13, core
  name TEXT NOT NULL,
  clock TEXT NOT NULL,           -- fixed demo time, ISO UTC
  rule_set TEXT NOT NULL,
  summary TEXT NOT NULL
);

CREATE TABLE parties (
  id TEXT PRIMARY KEY,           -- NORTHFIELD, ASHBY, KINROSS ...
  name TEXT NOT NULL,
  kind TEXT NOT NULL,            -- Retailer, Supplier, 3PL warehouse
  gln TEXT
);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  party_id TEXT NOT NULL REFERENCES parties(id),
  role TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL REFERENCES parties(id),
  name TEXT NOT NULL,
  gln TEXT NOT NULL,
  active INTEGER NOT NULL,       -- 1 when Northfield lists it as a current ship-to
  note TEXT
);

CREATE TABLE items (
  sku TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES parties(id),
  description TEXT NOT NULL,
  gtin TEXT NOT NULL,
  pack TEXT NOT NULL,
  case_price REAL NOT NULL,
  northfield_item TEXT NOT NULL,
  on_northfield_list INTEGER NOT NULL
);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  rule_set TEXT NOT NULL,        -- northfield-v8, kinross
  topic TEXT NOT NULL,           -- acknowledgment, ship notice, invoice, item, location, reference, acceptance, charges, warehouse
  doc_type TEXT,                 -- X12 set the rule governs
  statement TEXT NOT NULL,
  window_hours REAL,             -- deadline length where the rule sets one
  limit_value TEXT,
  source TEXT NOT NULL
);

CREATE TABLE orders (
  scenario TEXT NOT NULL REFERENCES scenarios(id),
  po TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES parties(id),
  retailer_id TEXT NOT NULL REFERENCES parties(id),
  programme TEXT NOT NULL,
  ship_to TEXT NOT NULL REFERENCES locations(id),
  received_at TEXT NOT NULL,
  requested_delivery TEXT NOT NULL,   -- Eastern calendar day
  order_value REAL NOT NULL,
  ship_from TEXT NOT NULL,            -- Ashby warehouse or the 3PL
  note TEXT,
  PRIMARY KEY (scenario, po)
);

CREATE TABLE order_lines (
  scenario TEXT NOT NULL,
  po TEXT NOT NULL,
  line INTEGER NOT NULL,
  sku TEXT NOT NULL REFERENCES items(sku),
  qty_ordered INTEGER NOT NULL,
  qty_accepted INTEGER,
  case_price REAL NOT NULL,
  PRIMARY KEY (scenario, po, line)
);

CREATE TABLE shipments (
  scenario TEXT NOT NULL,
  shipment_id TEXT NOT NULL,          -- Supplier ERP record
  po TEXT NOT NULL,
  planned_departure TEXT NOT NULL,
  departed_at TEXT,                   -- null until the truck leaves
  cartons INTEGER NOT NULL,
  carrier TEXT NOT NULL,
  PRIMARY KEY (scenario, shipment_id)
);

CREATE TABLE documents (
  scenario TEXT NOT NULL,
  doc_id TEXT NOT NULL,               -- unique inside the scenario
  reference TEXT NOT NULL,            -- business reference shown to people (ASN-46118)
  po TEXT,
  supplier_id TEXT NOT NULL,          -- trading relationship the document belongs to
  retailer_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,             -- 850, 855, 856, 810, 860, 865, 861, 824, 997, 820, 940, 945
  name TEXT NOT NULL,                 -- trade name
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  group_control TEXT NOT NULL,        -- GS functional group control number
  status TEXT NOT NULL,               -- Delivered, Rejected, Corrected and resent
  answers_doc_id TEXT,                -- for 824 and 997: the document answered; for a resend: the rejected document
  covers TEXT,                        -- for 997: JSON array of doc_ids in the acknowledged group
  body TEXT NOT NULL,                 -- JSON of business fields
  PRIMARY KEY (scenario, doc_id)
);

CREATE TABLE errors (
  scenario TEXT NOT NULL,
  error_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,               -- rejected document
  reported_by TEXT NOT NULL,          -- doc_id of the 824 or 997
  channel TEXT NOT NULL,              -- Application advice (824) or Technical acknowledgment (997)
  cause TEXT NOT NULL,
  field TEXT NOT NULL,
  sent_value TEXT,
  allowed TEXT,
  rule_id TEXT,
  status TEXT NOT NULL,               -- Open, Corrected
  corrected_by TEXT,                  -- doc_id of the accepted resend
  root_cause TEXT,
  PRIMARY KEY (scenario, error_id)
);

CREATE TABLE warehouse_orders (
  scenario TEXT NOT NULL,
  po TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  order_sent_at TEXT NOT NULL,        -- 940 to the warehouse
  advice_at TEXT,                     -- 945 back, null if none
  status TEXT NOT NULL,
  PRIMARY KEY (scenario, po)
);

CREATE TABLE confirmations (
  scenario TEXT NOT NULL,
  po TEXT NOT NULL,
  method TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  at TEXT NOT NULL,
  scope TEXT NOT NULL
);

CREATE TABLE deductions (
  scenario TEXT NOT NULL,
  case_id TEXT NOT NULL,
  po TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  disputed_at TEXT,
  decided_at TEXT,
  decision TEXT,
  decided_by TEXT,
  PRIMARY KEY (scenario, case_id)
);

CREATE TABLE cartons (
  scenario TEXT NOT NULL,
  sscc TEXT NOT NULL,
  po TEXT NOT NULL,
  line INTEGER NOT NULL,
  sku TEXT NOT NULL,
  received INTEGER NOT NULL,          -- 1 when the receiving advice shows a scan
  PRIMARY KEY (scenario, sscc)
);

CREATE TABLE scorecards (
  scenario TEXT NOT NULL,
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  label TEXT NOT NULL,                -- Retailer official, Network-derived
  note TEXT
);

-- Access: one connection per customer company, scopes chosen by its IT admin.
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES parties(id),
  user_name TEXT NOT NULL,
  scopes TEXT NOT NULL,               -- JSON array of orders, documents, errors, rules
  read_only INTEGER NOT NULL,
  configured_by TEXT NOT NULL,
  configured_at TEXT NOT NULL
);

CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  tool TEXT NOT NULL,
  scenario TEXT,
  scopes_used TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT NOT NULL,               -- Answered, Not available to Ashby, Scope not granted, Action not available, Invalid request
  records TEXT NOT NULL               -- JSON array of record references returned
);

CREATE INDEX ix_docs_po ON documents(scenario, po);
CREATE INDEX ix_docs_ref ON documents(scenario, reference);
CREATE INDEX ix_docs_type ON documents(scenario, doc_type, sent_at);
CREATE INDEX ix_err_doc ON errors(scenario, doc_id);
