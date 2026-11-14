// P5 physical state at Kinross Groveport, Tuesday 8 December 2026 17:12 ET (story moment P5, anchor NR-460207).
// Synthetic, and owned by Kinross: Ashby sees these facts only through what Kinross reports back (an inventory read,
// or a task's response). Scout never reads this object directly; the Kinross simulator in src/scout.js does.
// Added for the Scout runtime (owner-approved world extension, 14 November 2026). The recorded NR-460207 history is untouched:
// a Scout session branches at `branch_at` and hides every recorded event after it.
export const P5 = {
  po: 'NR-460207',
  branch_at: '2026-12-08T22:12:00.000Z',     // 17:12 ET, the moment on the story calendar
  seal_at: '2026-12-08T22:52:00.000Z',       // trailer sealed at door 7 (P5's screen: "seals in about 40 minutes")
  departure_at: '2026-12-08T23:00:00.000Z',  // Lakeline Freight departs, as the recorded history has it (18:00 ET)
  receipt_at: '2026-12-09T13:20:00.000Z',    // DC 2 receiving, as the recorded history has it
  site: 'KIN-GRV', door: 7,
  carton: { sscc: '006141410006005172', line: 1, sku: 'ASH-MUG-12', condition: 'crushed', contents: 'damaged', label: 'readable', staged: true },
  load_minutes: 5,                            // Kinross moves a staged carton onto the trailer
  relabel_minutes: 10, overpack_minutes: 15,
  // Groveport stock of the carton's item. All 520 cases are reserved across the three ASH-MUG-12 orders the
  // 17:10 inventory record names (NR-460262 and two others, 640 ordered); none is free.
  stock: [{ sku: 'ASH-MUG-12', site: 'KIN-GRV', on_hand: 520, reserved: 520, reserved_for: 'NR-460262 and two other ASH-MUG-12 orders (640 ordered)', staging_minutes: 25 }],
  // Free text Kinross adds to a task response, if any. Null: Kinross answers with its structured reason only.
  kinross_note: null,
  // Carrier hold: Northfield routes collect freight with Lakeline; a hold request gets no answer before the seal.
  hold_answer: null,
  // SSCC serials Ashby may issue for a replacement or overpacked carton (GS1 prefix 0614141, AP-2.2, NF-4.1).
  next_serial: 905001,
};

/** The variations a governance replay may set. Each changes Kinross-held physical facts only; nothing else. */
export const VARIATION_FIELDS = ['carton.condition', 'carton.contents', 'carton.label', 'stock.0.reserved', 'stock.0.on_hand', 'stock.0.staging_minutes', 'kinross_note', 'load_minutes'];
