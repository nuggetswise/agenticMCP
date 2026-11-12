// Shared reference data. One person per side: Priya Raman (Ashby) and Jordan Ellis (Northfield).
// GS1 identifiers use the GS1 example company prefix 0614141 and are fictional.

export const parties = [
  { id: 'NORTHFIELD', name: 'Northfield Retailer', kind: 'Retailer', gln: '0614141000050' },
  { id: 'ASHBY', name: 'Ashby Supplier', kind: 'Supplier', gln: '0614141002085' },
  { id: 'KINROSS', name: 'Kinross Logistics', kind: '3PL warehouse', gln: '0614141003006' },
  { id: 'BROOKLINE', name: 'Brookline Goods', kind: 'Supplier', gln: '0614141004003' },
  { id: 'CEDARPINE', name: 'Cedar & Pine Home', kind: 'Supplier', gln: '0614141005000' },
];

export const people = [
  { id: 'priya', name: 'Priya Raman', party_id: 'ASHBY', role: 'Supplier operations and EDI administrator', email: 'priya@ashby.example' },
  { id: 'jordan', name: 'Jordan Ellis', party_id: 'NORTHFIELD', role: 'Buyer and supplier contact', email: 'jordan.ellis@northfield.example' },
];

export const locations = [
  { id: 'DC2', party_id: 'NORTHFIELD', name: 'Northfield DC 2', gln: '0614141002061', active: 1, note: 'Dock window 06:00 to 14:00' },
  { id: 'DC4', party_id: 'NORTHFIELD', name: 'Northfield DC 4', gln: '0614141002115', active: 1, note: 'Dock window 07:00 to 15:00' },
  { id: 'STORE114', party_id: 'NORTHFIELD', name: 'Northfield Store 114', gln: '0614141002078', active: 1, note: null },
  { id: 'DC1-OLD', party_id: 'NORTHFIELD', name: 'Northfield DC 1 (closed)', gln: '0614141001996', active: 0, note: 'Closed; no longer a valid ship-to' },
  { id: 'ASH-WH1', party_id: 'ASHBY', name: 'Ashby warehouse ASH-WH1', gln: '0614141002122', active: 1, note: 'Ship-from for Wholesale' },
  { id: 'EX-WH1', party_id: 'KINROSS', name: 'Kinross Logistics warehouse EX-WH1', gln: '0614141003013', active: 1, note: '3PL ship-from' },
];

export const items = [
  { sku: 'ASH-MUG-12', supplier_id: 'ASHBY', description: 'Stoneware mug 12 oz', gtin: '10614141000125', pack: 'Case of 12', case_price: 54.0, northfield_item: '448120', on_northfield_list: 1 },
  { sku: 'ASH-NAP-4', supplier_id: 'ASHBY', description: 'Linen napkin 4-pack', gtin: '10614141000132', pack: 'Case of 24', case_price: 38.4, northfield_item: '448121', on_northfield_list: 1 },
  { sku: 'ASH-HNY-340', supplier_id: 'ASHBY', description: 'Wildflower honey 340 g', gtin: '10614141000149', pack: 'Case of 12', case_price: 46.8, northfield_item: '448122', on_northfield_list: 1 },
  { sku: 'ASH-MUG-16', supplier_id: 'ASHBY', description: 'Stoneware mug 16 oz', gtin: '10614141000170', pack: 'Case of 12', case_price: 58.0, northfield_item: '448190', on_northfield_list: 0 },
  { sku: 'BRK-TWL-2', supplier_id: 'BROOKLINE', description: 'Cotton towel 2-pack', gtin: '10614141004017', pack: 'Case of 12', case_price: 41.0, northfield_item: '451010', on_northfield_list: 1 },
  { sku: 'CDP-CND-8', supplier_id: 'CEDARPINE', description: 'Soy candle 8 oz', gtin: '10614141005014', pack: 'Case of 24', case_price: 62.4, northfield_item: '452020', on_northfield_list: 1 },
];

const MIG = 'Northfield MIG';
export const rules = [
  { id: 'NF-ACK', rule_set: 'northfield-v8', topic: 'acknowledgment', doc_type: '855', statement: 'Send the order acknowledgment within 24 hours of receiving the purchase order', window_hours: 24, limit_value: null, source: MIG },
  { id: 'NF-CHG', rule_set: 'northfield-v8', topic: 'acknowledgment', doc_type: '865', statement: 'Answer an order change within 24 hours of the latest change; a new change restarts the clock', window_hours: 24, limit_value: null, source: MIG },
  { id: 'NF-ASN', rule_set: 'northfield-v8', topic: 'ship notice', doc_type: '856', statement: 'Send the ship notice before the truck leaves, and at least 2 hours before the DC dock window', window_hours: null, limit_value: 'Truck departure', source: MIG },
  { id: 'NF-ASNQ', rule_set: 'northfield-v8', topic: 'ship notice', doc_type: '856', statement: 'Ship notice quantity per line must not exceed the accepted quantity', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-INV', rule_set: 'northfield-v8', topic: 'invoice', doc_type: '810', statement: 'Send the invoice within 2 days of shipment', window_hours: 48, limit_value: null, source: MIG },
  { id: 'NF-TOL', rule_set: 'northfield-v8', topic: 'invoice', doc_type: '810', statement: 'Invoice prices within 0.5% of the acknowledged order price per line', window_hours: null, limit_value: '0.5%', source: 'Trading Grid' },
  { id: 'NF-POREF', rule_set: 'northfield-v8', topic: 'reference', doc_type: '856,810', statement: 'The PO reference (ship notice PRF01, invoice BIG04) is the Northfield PO number, at most 22 characters', window_hours: null, limit_value: '22 characters', source: MIG },
  { id: 'NF-ITEM', rule_set: 'northfield-v8', topic: 'item', doc_type: '856,810', statement: 'Every item must be on Northfield’s item list for the supplier; substitutes need buyer approval first', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-SHIPTO', rule_set: 'northfield-v8', topic: 'location', doc_type: '856', statement: 'The ship-to GLN must be an active Northfield location', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-CTN', rule_set: 'northfield-v8', topic: 'ship notice', doc_type: '856', statement: 'Carton count in the ship notice must equal the cartons listed under it', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-UOM', rule_set: 'northfield-v8', topic: 'item', doc_type: '856,810', statement: 'Quantities are in cases (CA)', window_hours: null, limit_value: 'CA', source: MIG },
  { id: 'NF-TOTAL', rule_set: 'northfield-v8', topic: 'invoice', doc_type: '810', statement: 'The invoice total must equal the sum of its line amounts', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-DATES', rule_set: 'northfield-v8', topic: 'ship notice', doc_type: '856', statement: 'Ship date must be on or before the delivery date', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-997', rule_set: 'northfield-v8', topic: 'acceptance', doc_type: '997', statement: 'Northfield returns a technical acknowledgment (997) only; it sends no business acceptance of an acknowledgment or change response', window_hours: null, limit_value: null, source: MIG },
  { id: 'NF-CHG-ASN', rule_set: 'northfield-v8', topic: 'charges', doc_type: '856', statement: 'Compliance charge: $150 per ship notice with a rule failure', window_hours: null, limit_value: '$150', source: 'Northfield charge schedule' },
  { id: 'NF-CHG-SHORT', rule_set: 'northfield-v8', topic: 'charges', doc_type: '861', statement: 'Shortage charge: $50 per short-shipped carton plus the carton cost', window_hours: null, limit_value: '$50 + carton cost', source: 'Northfield charge schedule' },
  { id: 'KX-945', rule_set: 'kinross', topic: 'warehouse', doc_type: '945', statement: 'Kinross returns the warehouse shipping advice (945) within 24 hours of the warehouse shipping order (940)', window_hours: 24, limit_value: null, source: 'Ashby warehouse agreement with Kinross' },
];

export const docNames = {
  '850': 'Purchase order', '855': 'Order acknowledgment', '856': 'Ship notice', '810': 'Invoice', '860': 'Order change',
  '865': 'Change acknowledgment', '861': 'Receiving advice', '824': 'Application advice', '997': 'Technical acknowledgment',
  '820': 'Remittance advice', '940': 'Warehouse shipping order', '945': 'Warehouse shipping advice', '852': 'Product activity',
};
