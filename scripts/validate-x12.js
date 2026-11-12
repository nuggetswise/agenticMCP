// Independent X12 check. Runs every generated file through StAEDI (io.xlate:staedi) with the Northfield implementation
// schemas, then proves two things: (1) the only files StAEDI faults are the ones Northfield rejected on a 997, each for
// the stated reason; (2) each fault injected into a clean file is rejected for the stated reason.
// Needs Java and the StAEDI jar (STAEDI_JAR). Skips with exit 0 when Java is absent unless REQUIRE_VALIDATOR=1.
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAULTS } from '../world/log.js';
import { corpusHash } from './corpus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JAR = process.env.STAEDI_JAR || join(ROOT, 'validator', 'staedi.jar');
const X12 = join(ROOT, 'build', 'x12'); const OUT = join(ROOT, 'build', 'validation'); mkdirSync(OUT, { recursive: true });
const haveJava = spawnSync('java', ['-version']).status === 0;
if (!haveJava || !existsSync(JAR)) { const msg = `Independent validator not run: ${!haveJava ? 'Java not found' : `StAEDI jar not found at ${JAR}`}`; console.log(msg); process.exit(process.env.REQUIRE_VALIDATOR ? 1 : 0); }
if (!existsSync(join(ROOT, 'validator', 'Validate.class'))) execFileSync('javac', ['-cp', JAR, join(ROOT, 'validator', 'Validate.java')], { stdio: 'ignore' });
const run = (files) => { const out = []; for (let i = 0; i < files.length; i += 400) { const r = execFileSync('java', ['-cp', `${JAR}:${join(ROOT, 'validator')}`, 'Validate', join(ROOT, 'validator', 'schemas'), ...files.slice(i, i + 400)], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); out.push(...r.trim().split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))); } return out; };
let fails = 0; const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` · ${detail}`}`); if (!ok) fails++; };

// 1. Every file in the world.
const files = []; for (const d of readdirSync(X12)) for (const f of readdirSync(join(X12, d))) files.push(join(X12, d, f));
const res = run(files); const sets = res.reduce((a, r) => a + r.transaction_sets, 0);
const db = new DatabaseSync(join(ROOT, 'build', 'tg.db'), { readOnly: true });
check(`StAEDI read all ${files.length} files, ${sets} transaction sets`, sets === db.prepare('SELECT count(*) n FROM documents').get().n && res.every((r) => !r.fatal), `${sets} sets; fatal: ${res.filter((r) => r.fatal).map((r) => r.fatal).slice(0, 2)}`);
const EXPECT = { 'AK4:5': 'DATA_ELEMENT_TOO_LONG', 'AK4:8': 'INVALID_DATE', 'AK3:3': 'MANDATORY_SEGMENT_MISSING', 'AK5:4': 'CONTROL_COUNT_DOES_NOT_MATCH_ACTUAL_COUNT' };
const rejected = db.prepare("SELECT d.file, d.doc_id, e.code, e.cause FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE e.channel LIKE '%997%'").all();
const faulted = res.filter((r) => r.errors.length);
const wantFiles = new Set(rejected.map((r) => join(X12, r.file)));
check(`StAEDI faults exactly the ${wantFiles.size} files that carry a 997 rejection`, faulted.length === wantFiles.size && faulted.every((r) => wantFiles.has(r.file)), `faulted ${faulted.length}: ${faulted.filter((r) => !wantFiles.has(r.file)).slice(0, 3).map((r) => `${r.file} ${JSON.stringify(r.errors[0])}`)}`);
let reasonOk = 0; const reasonBad = [];
for (const r of rejected) { const f = res.find((x) => x.file === join(X12, r.file)); const want = EXPECT[r.code]; if (f && f.errors.some((e) => e.error === want)) reasonOk++; else reasonBad.push(`${r.doc_id} wanted ${want}, got ${f ? f.errors.map((e) => e.error) : 'no file'}`); }
check(`each of the ${rejected.length} rejections is faulted for the reason its 997 states`, reasonOk === rejected.length, reasonBad.slice(0, 3).join('; '));

// 2. Injected faults on clean documents.
const clean = (type) => db.prepare("SELECT raw FROM documents WHERE doc_type = ? AND status = 'Delivered' AND supplier_id = 'ASHBY' ORDER BY sent_at LIMIT 1 OFFSET 40").get(type).raw;
const INJECT = [
  ['missing mandatory segment (855 without BAK)', '855', (t) => { const n = Number(t.match(/\nSE\*(\d+)\*/)[1]); return t.replace(/\nBAK\*[^~]*~/, '').replace(/\nSE\*\d+\*/, `\nSE*${n - 1}*`); }, 'MANDATORY_SEGMENT_MISSING'],
  ['invalid date (856 DTM02)', '856', FAULTS.invalid_date.apply, 'INVALID_DATE'],
  ['segment count wrong (856 SE01)', '856', FAULTS.se_count.apply, 'CONTROL_COUNT_DOES_NOT_MATCH_ACTUAL_COUNT'],
  ['element too long (856 N102)', '856', FAULTS.too_long.apply, 'DATA_ELEMENT_TOO_LONG'],
  ['PO reference over 22 characters (856 PRF01)', '856', (t) => t.replace(/\nPRF\*([^~]*)~/, '\nPRF*$1-ASHBY-WHSL-REL-02~'), 'DATA_ELEMENT_TOO_LONG'],
  ['PO reference over 22 characters (810 BIG04)', '810', (t) => t.replace(/(\nBIG\*[^*]*\*[^*]*\*[^*]*\*)([^~]*)~/, '$1$2-ASHBY-WHSL-REL-02~'), 'DATA_ELEMENT_TOO_LONG'],
  ['group control number mismatch (GE02)', '850', (t) => t.replace(/\nGE\*1\*(\d+)~/, (m, n) => `\nGE*1*${Number(n) + 1}~`), 'CONTROL_REFERENCE_MISMATCH'],
  ['unknown segment (850 with ZZZ)', '850', (t) => t.replace(/\nCTT\*/, '\nZZZ*1~\nCTT*').replace(/\nSE\*(\d+)\*/, (m, n) => `\nSE*${Number(n) + 1}*`), 'SEGMENT_NOT_IN_DEFINED_TRANSACTION_SET'],
  ['mandatory element missing (810 BIG02 invoice number)', '810', (t) => t.replace(/(\nBIG\*[^*]*\*)[^*]*\*/, '$1*'), 'REQUIRED_DATA_ELEMENT_MISSING'],
  ['non-numeric quantity (850 PO102)', '850', (t) => t.replace(/(\nPO1\*[^*]*\*)\d+\*/, '$1TEN*'), 'INVALID_CHARACTER_DATA'],
];
const report = [];
INJECT.forEach(([name, type, fn, want], i) => {
  const base = clean(type); const bad = fn(base); const pc = join(OUT, `clean-${i}.edi`), pb = join(OUT, `fault-${i}.edi`); writeFileSync(pc, base); writeFileSync(pb, bad);
  const [rc, rb] = run([pc, pb]); const got = [...new Set(rb.errors.map((e) => e.error))];
  check(`injected: ${name} → ${want}`, bad !== base && rc.errors.length === 0 && got.includes(want), `clean errors ${rc.errors.length}; fault errors ${got}`);
  report.push({ fault: name, document: type, expected: want, got, clean_passes: rc.errors.length === 0 });
});
const REPORT = { validator: 'StAEDI (io.xlate:staedi) 1.26.7', validator_published: '2026-11-08', jar_bytes: statSync(JAR).size, corpus: corpusHash(X12), passed: fails === 0, files: files.length, transaction_sets: sets, faulted_files: faulted.length, rejections_matched: reasonOk, injected: report };
writeFileSync(join(OUT, 'report.json'), JSON.stringify(REPORT, null, 1));
if (!fails) writeFileSync(join(ROOT, 'validator', 'report.json'), JSON.stringify(REPORT, null, 1));
console.log(fails ? `${fails} validator checks failed` : 'All validator checks passed');
process.exit(fails ? 1 : 0);
void readFileSync;
