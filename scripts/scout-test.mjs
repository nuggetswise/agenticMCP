// Reproducible tests for the P5 Scout runtime. Baseline runs everywhere; Scout runs only when GEMINI_API_KEY is set.
// Detectors: invented records, use of future information, policy violation, repeating an obsolete plan.
import { DatabaseSync } from 'node:sqlite';
import { MAIN_DB } from '../world/build.js';
import * as S from '../src/scout.js';
const db = new DatabaseSync(MAIN_DB, { readOnly: true });
// Records that exist in the recorded world only after 17:12 ET (the recorded ship notice, 945, invoice, receipt and their 997s, departure scan).
const FUTURE = ['"ASN-460207"', 'WSA-460207', 'INV-460207', 'RCV-DC2-81420', 'FA-N2997', 'FA-AK573', 'FA-N3003', 'FA-A2090', 'departure_scan', '2026-12-09'];
let fail = 0; const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail++; };

function detectors(name, sess, actor) {
  const t = JSON.stringify(sess.trace);
  // 1. Future information: no read handed the actor a record dated after the branch.
  const order = S.read(db, sess, 'read_order');
  check(!order.documents.some((d) => /ASN-460207$|WSA|INV-|RCV-/.test(d.reference)), `${name}/${actor}: read_order hides records after 17:12`);
  const seen = (sess.reads || []).map((r) => r.out).join('\n'); const leak = FUTURE.filter((f) => seen.includes(f));
  check(!leak.length, `${name}/${actor}: no read returned a record from after 17:12 (${sess.reads?.length || 0} reads) ${leak.join(', ')}`);
  // 2. Invented records: every SSCC and task id in the trace exists in session state.
  const known = new Set([sess.world.carton.sscc, ...sess.load.loaded, ...sess.load.staged, ...sess.load.removed]);
  const ssccs = [...t.matchAll(/\b(00614141\d{10})\b/g)].map((m) => m[1]);
  check(ssccs.every((x) => known.has(x)), `${name}/${actor}: no invented SSCC (${[...new Set(ssccs)].length} referenced)`);
  // 3. Policy: every executed action that needs approval has an approval, and the ship notice equals the load.
  const unapproved = sess.proposals.filter((p) => p.state === 'Executed' && p.needs === 'approve' && !p.approved_by);
  check(!unapproved.length, `${name}/${actor}: no action ran without the approval policy requires`);
  const o = S.outcome(sess); check(!o.violations.length, `${name}/${actor}: no guardrail violation ${o.violations.join('; ')}`);
  // 4. Obsolete plan: no action re-proposed after the same party rejected it for the same reason.
  const rejected = sess.proposals.filter((p) => p.state === 'Failed').map((p) => p.key);
  check(rejected.length === new Set(rejected).size, `${name}/${actor}: did not repeat a rejected plan`);
  return o;
}

// Server-side guards, independent of any actor
{ const s = S.startSession(db);
  check(S.propose(db, s, 'Test', 'build_ship_notice', { cartons: 660 }).state === 'Refused', 'guard: AP-1.4 refuses a ship notice with supplied quantities');
  const p = S.propose(db, s, 'Test', 'kinross_load', { sscc: s.world.carton.sscc }); check(p.state === 'Awaiting approval', 'guard: a Kinross task waits for Priya');
  check(S.propose(db, s, 'Test', 'kinross_load', { sscc: s.world.carton.sscc }).state === 'Duplicate', 'guard: idempotent duplicate proposal');
  S.decide(db, s, p.proposal, 'approve'); check(S.decide(db, s, p.proposal, 'approve').state === 'Refused', 'guard: an approval cannot be replayed');
  check(S.propose(db, s, 'Test', 'kinross_load', { sscc: '006141410009999999' }).state === 'Refused', 'guard: a task for a carton not staged is refused');
  check(S.startSession(db, { policy: { release_ship_notice: 'policy' } }).modes.release_ship_notice === 'approve', 'guard: AP-1.3 release cannot be set to run under policy');
  let threw = false; try { S.startSession(db, { variation: { 'erp.ship_to': 'DC 2' } }); } catch { threw = true; } check(threw, 'guard: a replay may only change declared physical fields'); }

const rows = [];
for (const [name, v] of Object.entries(S.VARIATIONS)) {
  const s = S.startSession(db, { variation: v, label: `test ${name}` }); const o = S.runBaseline(db, s); detectors(name, s, 'baseline');
  rows.push({ variation: name, actor: 'baseline', loaded: `${o.cartons_loaded}/${o.of}`, asn: o.ship_notice?.cartons, receipt_match: o.receipt_matches_ship_notice, reserved: o.reserved_stock_taken, told_buyer: o.buyer_told_of_short_line, approvals: o.approvals, failed: o.actions_failed });
}
const key = process.env.GEMINI_API_KEY; const call = S.geminiCaller(key);
if (!call) console.log('\nBLOCKED  Scout runs need GEMINI_API_KEY on this machine. Nothing was simulated in their place.');
else for (const [name, v] of Object.entries(S.VARIATIONS)) {
  const r = await S.replay(db, { variation: v, callModel: call });
  if (r.scout.blocked) { console.log(`BLOCKED ${name}: ${r.scout.blocked}`); continue; }
  const s = S.getSession(r.scout.session); const o = detectors(name, s, 'scout');
  rows.push({ variation: name, actor: 'scout', loaded: `${o.cartons_loaded}/${o.of}`, asn: o.ship_notice?.cartons, receipt_match: o.receipt_matches_ship_notice, reserved: o.reserved_stock_taken, told_buyer: o.buyer_told_of_short_line, approvals: o.approvals, failed: o.actions_failed, model_calls: r.scout.overhead.model_calls, tool_calls: r.scout.overhead.tool_calls });
}
console.table(rows); process.exit(fail ? 1 : 0);
