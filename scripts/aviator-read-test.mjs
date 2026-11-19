// "What Aviator read", tested offline with no model call (19 November 2026). The page lists the records the answer
// names and the record the question was about; every other record the tools returned (technical acknowledgments,
// scans) goes to also_read. Fed with the real get_order results for NR-460207 at the P5 page's two moments.
process.env.NO_LISTEN = '1';
import { DatabaseSync } from 'node:sqlite';
const { TOOLS } = await import('../src/tools.js');
const { recordsRead } = await import('../src/server.js');
const { instruction } = await import('../src/aviator.js');
const db = new DatabaseSync(new URL('../build/ashby.db', import.meta.url).pathname, { readOnly: true });
let pass = 0, fail = 0; const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const getOrder = (as_of) => TOOLS.find((t) => t.name === 'get_order').run(db, { po: 'NR-460207', as_of });
const names = (l) => l.map((r) => r.name);

for (const [moment, as_of] of [['17:12 opening', '2026-12-08T17:12:00-05:00'], ['the later moment', '2026-12-10T18:00:00-05:00']]) {
  const results = [getOrder(as_of)];
  // An answer in the new voice names no record; the question names the order.
  const plain = recordsRead("It's held because one carton was still in Kinross's staging area when they scanned the load, so the truck wasn't fully loaded.", results, ['NR-460207']);
  ok(`${moment}: an answer naming no record lists only the order asked about`, plain.read.length === 1 && plain.read[0].name === 'Purchase order NR-460207', JSON.stringify(names(plain.read)));
  ok(`${moment}: the other records read are kept in also_read, not dropped`, plain.also.length > 3 && !names(plain.also).includes('Purchase order NR-460207'), JSON.stringify(names(plain.also)));
  ok(`${moment}: technical acknowledgments stay out of the list the page shows`, !plain.read.some((r) => /^FA-/.test(r.record)) && plain.also.some((r) => /^FA-/.test(r.record)));
  // An answer that names a record the tools returned lists it beside the order.
  const doc = results[0] && JSON.stringify(results[0]).match(/\bWSO-460207\b/) ? 'WSO-460207' : null;
  if (doc) { const named = recordsRead(`Kinross has the warehouse shipping order ${doc}, but one carton is not loaded.`, results, ['NR-460207']);
    ok(`${moment}: a record the answer names is listed, then the order`, names(named.read).length === 2 && named.read[0].record === doc && named.read[1].name === 'Purchase order NR-460207', JSON.stringify(names(named.read))); }
  // A reference no tool returned is never listed.
  ok(`${moment}: a reference no tool returned is not listed`, !recordsRead('See ASN-999999.', results, ['NR-460207']).read.some((r) => r.record === 'ASN-999999'));
}
// A quarter question with no record in it lists only what the answer names.
const q = TOOLS.find((t) => t.name === 'list_deductions').run(db, { as_of: '2026-12-10T18:00:00-05:00' });
ok('a quarter answer naming no record lists nothing; the rest is in also_read', recordsRead('Five charges this quarter came to $586.80.', [q], []).read.length === 0 && recordsRead('Five charges this quarter came to $586.80.', [q], []).also.length > 0);

// The instruction: no records list, the voice line, and the date rule.
const text = instruction({ person: 'Priya Raman', company: 'Ashby Supplier', other: 'Northfield Retailer', clock: 'x', cards: true });
ok('the instruction asks for no records in the answer', /Do not mention records or their references in your answer unless the question asks which ones/.test(text) && !/then the records|Name the records|with its reference\./.test(text));
ok('the instruction sets the voice', /the way a colleague who knows these records would explain it in a chat message/.test(text));
ok('the instruction allows the time and day as the record states them, never a year or a worked-out weekday or date', /give the time as the record shows it \(16:48 ET\) and the day as the record or the question names it/.test(text) && /never write a year, and never work out a weekday or a date yourself/.test(text));
ok('the guarding rules stay', /Answer only from the results of the tools/.test(text) && /never mention a record, a status or an outcome dated after it/.test(text) && /is not business acceptance/.test(text) && /are not available to Ashby Supplier/.test(text));

console.log(`${pass} Aviator read-list checks passed, ${fail} failed`); process.exit(fail ? 1 : 0);
