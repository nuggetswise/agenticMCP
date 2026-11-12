// Shared helpers for the seed: deterministic random numbers, Eastern-time clock arithmetic, GS1 check digits.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// All demo times are US Eastern. Conversion goes through Intl so the DST change on 1 Nov 2026 is handled.
const TZ = 'America/New_York';
function offsetMinutes(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return (asUtc - utcMs) / 60000;
}

/** Eastern wall-clock date and time to a Date. et('2026-11-17', '11:00') */
export function et(day, hm = '00:00') {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  guess -= offsetMinutes(guess) * 60000;
  guess = Date.UTC(y, m - 1, d, hh, mm) - offsetMinutes(guess) * 60000;
  return new Date(guess);
}

export const H = 3600000;
export const addH = (d, h) => new Date(d.getTime() + h * H);
export const addD = (d, n) => new Date(d.getTime() + n * 24 * H);

/** Eastern calendar day (YYYY-MM-DD) of a Date. */
export function etDay(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Readable Eastern time: "2026-11-17 11:00 ET". */
export function fmtET(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(dt);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')} ET`;
}

/** Shift a Date to the same wall-clock time on another Eastern day offset. */
export function atDay(baseDay, offsetDays, hm) {
  const d = et(baseDay, '12:00');
  return et(etDay(addD(d, offsetDays)), hm);
}

/** GS1 mod-10 check digit for the digits given (without the check digit). */
export function gs1Check(body) {
  let sum = 0;
  const digits = body.split('').reverse();
  digits.forEach((c, i) => { sum += +c * (i % 2 === 0 ? 3 : 1); });
  return String((10 - (sum % 10)) % 10);
}
export const gs1Valid = (code) => gs1Check(code.slice(0, -1)) === code.slice(-1);

export function sscc(serial) {
  const body = '0' + '0614141' + String(serial).padStart(9, '0');
  return body + gs1Check(body);
}

export const money = (n) => Math.round(n * 100) / 100;
