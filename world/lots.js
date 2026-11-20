// Lot and best-before date for food items (P26 Lot data and recall reach, 20 November 2026, owner decision; spec:
// "TG for Retail · Prototype build prompts", section P26). Wildflower honey is the one food item in the world.
// Every honey carton on a ship notice carries the lot it was packed in and that lot's best-before date, and the
// matching receiving advice line carries the same pair. Invented: the lot scheme (one lot per packing week, packed
// two weeks before it ships, best before two years after packing). No quantity, order or charge changes.
const FOOD = new Set(['ASH-HNY-340']);
const DAY = 86400000;
const BASE = Date.UTC(2026, 0, 5); // Monday 5 January 2026: packing week 1 of 2026
export const isFood = (sku) => FOOD.has(sku);
/** The lot a food item ships from when it leaves on `shippedAt`, and its best-before date. Null for any other item. */
export function lotOf(sku, shippedAt) {
  if (!FOOD.has(sku) || !shippedAt) return null;
  const packed = new Date(shippedAt).getTime() - 14 * DAY;
  const week = Math.floor((packed - BASE) / (7 * DAY)); const monday = new Date(BASE + week * 7 * DAY);
  const yy = String(monday.getUTCFullYear()).slice(2); const jan1 = Date.UTC(monday.getUTCFullYear(), 0, 1);
  const ww = String(Math.floor((monday.getTime() - jan1) / (7 * DAY)) + 1).padStart(2, '0');
  return { lot: `WH${yy}${ww}`, best_before: new Date(monday.getTime() + 730 * DAY).toISOString().slice(0, 10) };
}
