// P13 Silent order watch: the Watch Agent runtime (src/watch.js) held to the spec (docs/agent-and-mcp-strategy.md, Build brief 2)
// and to D61: the queue at the branch is computed from records, the rule baseline gives the spec's next step on each changed-evidence
// record, Priya's Kinross window changes which rows are flagged, NR-46231 is never chased, a 997 is never acceptance, a session
// changes no recorded row, and no read returns a record from after the branch unless it was revealed as a confirmation.
import * as W from '../../src/watch.js';
import * as A from '../../src/agents.js';
import * as D from '../../src/domain.js';

export default function ({ db, ok, eq }) {
  const branch = new Date(W.MOMENTS[W.P13_MOMENT]);
  const counts = () => ['events', 'documents', 'proposals', 'access_log', 'agent_changes', 'order_lines', 'warehouse_orders', 'receipts'].map((t) => db.prepare(`SELECT count(*) n, coalesce(max(rowid), 0) m FROM ${t}`).get()).map((r) => `${r.n}/${r.m}`).join(',');
  const before = counts();
  const base = (v) => { const s = W.startSession(db, { variation: W.VARIATIONS[v] || v }); const o = W.runBaseline(db, s); return { s, o }; };
  const steps = (s, po) => s.proposals.filter((p) => p.args.po === po && p.state === 'Executed').map((p) => `${p.action}${p.args.document ? ' ' + p.args.document : ''}`);

  // ---------- 1. The queue at the branch: five orders from the records ----------
  const s0 = W.startSession(db, { variation: W.VARIATIONS.canonical }); const q0 = W.read(db, s0, 'read_queue');
  eq('watch.queue_at_branch_is_the_four_missing_documents', q0.rows.map((r) => `${r.po} ${r.document} ${r.state} ${r.time_left}`),
    ['NR-46215 856 Late Overdue by 14 hours', 'NR-46220 945 Overdue Overdue by 12 hours', 'NR-46210 855 Missing 4 hours left', 'NR-46226 810 Missing 1 day left']);
  eq('watch.nr46231_checked_nothing_to_chase', q0.nothing_to_chase.map((r) => `${r.po} ${r.state} ${r.rule}`), ['NR-46231 Not expected NF-1.5']);
  const att = D.attention(db, branch, { warehouse: true });
  eq('watch.queue_matches_domain_attention', q0.rows.map((r) => r.po), att.items.map((i) => i.po));
  const o46215 = W.read(db, s0, 'read_order', { po: 'NR-46215' }), w46215 = W.read(db, s0, 'read_warehouse', { po: 'NR-46215' }), w46220 = W.read(db, s0, 'read_warehouse', { po: 'NR-46220' }), o46226 = W.read(db, s0, 'read_order', { po: 'NR-46226' }), o46210 = W.read(db, s0, 'read_order', { po: 'NR-46210' });
  ok('watch.nr46215_fulfilment_load_and_departure_agree', w46215.load_scan.cartons_loaded === 6 && w46215.load_scan.cartons_expected === 6 && w46215.departure_scan.at === '2026-11-17 18:00 ET' && o46215.supplier_erp.fulfilment.cartons === 6 && !o46215.documents.some((d) => d.type === '856'), JSON.stringify(w46215).slice(0, 200));
  ok('watch.nr46220_940_sent_36_hours_earlier_no_945_no_load_scan', w46220.warehouse_order_940.sent === '2026-11-16 21:00 ET' && w46220.shipping_advice_945 === 'Not received' && w46220.load_scan === 'None' && w46220.departure_scan === 'None', JSON.stringify(w46220).slice(0, 200));
  ok('watch.nr46226_shipped_no_invoice_in_erp', o46226.supplier_erp.invoice === 'None' && o46226.documents.some((d) => d.type === '856') && !o46226.documents.some((d) => d.type === '810'));
  ok('watch.nr46210_sales_order_matches_every_line', o46210.supplier_erp.sales_order.matches_current_order && o46210.supplier_erp.sales_order.lines.length === o46210.lines.length && o46210.lines.every((l, i) => l.qty === o46210.supplier_erp.sales_order.lines[i].qty));

  // ---------- 2. The baseline's next step on each changed-evidence record (the spec's table), from the same code ----------
  const canon = base('canonical');
  eq('watch.baseline_nr46215_drafts_from_load_scan_and_stays_late', [steps(canon.s, 'NR-46215'), canon.s.docs.find((d) => d.po === 'NR-46215').built_from.startsWith('Load scan'), canon.o.rows.find((r) => r.po === 'NR-46215').state],
    [['draft_ship_notice', 'release_document 856'], true, 'Closed; sent Late']);
  const first46220 = canon.s.proposals.filter((p) => p.args.po === 'NR-46220'); const k945 = canon.s.revealed.find((r) => r.po === 'NR-46220' && r.doc_type === '945');
  ok('watch.baseline_nr46220_sends_nothing_and_asks_kinross_first', first46220[0]?.action === 'ask_kinross_status' && !canon.s.docs.some((d) => d.po === 'NR-46220' && d.state === 'Sent' && Date.parse(d.sent_at) < Date.parse(k945.at)), JSON.stringify(first46220.map((p) => p.action)));
  eq('watch.baseline_canonical_end_state', { on_time: canon.o.sent_on_time, late: canon.o.sent_late, confirmed: canon.o.kinross_confirmed, left_alone: canon.o.nothing_to_chase },
    { on_time: ['NR-46210 855', 'NR-46226 810', 'NR-46220 856'], late: ['NR-46215 856'], confirmed: ['NR-46220'], left_alone: ['NR-46231'] });
  const f302 = base('early_fulfilment_46302'); const p302 = f302.s.proposals.filter((p) => p.args.po === 'NR-46302'); const dep302 = f302.s.revealed.find((r) => r.kind === 'wms.departure_scan');
  ok('watch.baseline_nr46302_holds_asks_flags_then_drafts_after_departure', JSON.stringify(steps(f302.s, 'NR-46302')) === JSON.stringify(['flag_erp_record', 'ask_kinross_status', 'escalate_to_priya', 'draft_ship_notice', 'release_document 856'])
    && !!p302.length && f302.s.docs.find((d) => d.doc_type === '856').sent_at >= dep302.at && f302.s.docs.find((d) => d.doc_type === '856').built_from.startsWith('Load scan'), JSON.stringify(steps(f302.s, 'NR-46302')));
  const r156 = base('rejected_ship_notice_46156'); const d156 = r156.s.docs.find((d) => d.po === 'NR-46156');
  ok('watch.baseline_nr46156_shows_824_and_drafts_corrected_ship_notice', JSON.stringify(steps(r156.s, 'NR-46156')) === JSON.stringify(['draft_ship_notice', 'release_document 856']) && d156.corrects === 'ASN-46156' && /NF-4\.11/.test(d156.correction)
    && W.read(db, r156.s, 'read_order', { po: 'NR-46156' }).open_rejections.length === 0 && W.queue(db, W.startSession(db, { variation: W.VARIATIONS.rejected_ship_notice_46156 })).rows.find((r) => r.po === 'NR-46156')?.rejection?.rule_id === 'NF-4.11', JSON.stringify(d156).slice(0, 200));
  const un = base('kinross_unreachable');
  ok('watch.baseline_kinross_unreachable_drafts_nothing_unknown_escalates', !un.s.docs.some((d) => d.po === 'NR-46220') && un.o.rows.find((r) => r.po === 'NR-46220').state.startsWith('Unknown') && un.o.escalated.includes('NR-46220'), JSON.stringify(un.o.rows.find((r) => r.po === 'NR-46220')));
  const dsc = base('departure_scanned_46220');
  ok('watch.baseline_departed_without_source_waits_for_load_scan', dsc.s.trace.every((t) => !/^Refused/.test(t.what)) && dsc.s.docs.find((d) => d.po === 'NR-46220' && d.doc_type === '856')?.built_from.startsWith('Load scan') && dsc.o.sent_late.includes('NR-46220 856') && dsc.o.escalated.includes('NR-46220'));
  // The same decision rows from the agents' decision table (watchDecision) at each record's moment.
  eq('watch.decision_table_rows_at_each_moment', [['NR-46215', W.P13_MOMENT], ['NR-46220', W.P13_MOMENT], ['NR-46302', '2026-11-19 16:00 ET'], ['NR-46156', '2026-11-17 11:00 ET']].map(([po, m]) => A.watchDecision(db, po, new Date(W.MOMENTS[m])).next_step),
    ['draft_ship_notice_from_load_scan', 'ask_warehouse_for_status', 'hold_draft_and_ask_warehouse', 'show_rejection_and_draft_correction']);

  // ---------- 3. Priya's Kinross window changes which rows are flagged ----------
  const w48 = W.read(db, W.startSession(db, { variation: W.VARIATIONS.window_48 }), 'read_queue');
  ok('watch.kinross_window_48_to_24_changes_flagged_rows', !w48.rows.some((r) => r.po === 'NR-46220') && w48.watching_not_flagged.some((r) => r.po === 'NR-46220') && q0.rows.some((r) => r.po === 'NR-46220' && r.document === '945')
    && !D.attention(db, branch, { warehouse: true, kinrossHours: 48 }).items.some((i) => i.po === 'NR-46220'), JSON.stringify(w48.rows.map((r) => r.po)));

  // ---------- 4. NR-46231 is never chased ----------
  const all = Object.keys(W.VARIATIONS).map((v) => (v === 'canonical' ? canon : v === 'early_fulfilment_46302' ? f302 : v === 'rejected_ship_notice_46156' ? r156 : v === 'kinross_unreachable' ? un : v === 'departure_scanned_46220' ? dsc : base(v)));
  const t231 = W.startSession(db, { variation: W.VARIATIONS.canonical });
  const tries = Object.keys(W.ACTIONS).map((a) => W.propose(db, t231, 'Test', a, { po: 'NR-46231', ...(a === 'release_document' ? { document: '855' } : {}), ...(a === 'escalate_to_priya' ? { message: 'Chase the acceptance' } : {}) }).state);
  ok('watch.nr46231_never_chased', all.every(({ s }) => !s.proposals.some((p) => p.args.po === 'NR-46231')) && tries.every((x) => x === 'Refused'), JSON.stringify(tries));

  // ---------- 5. A 997 is never shown as acceptance; a late document stays Late; a row closes only on its confirmation ----------
  const accepted = all.flatMap(({ o }) => o.rows.filter((r) => /accept/i.test(`${r.state} ${r.confirmation || ''}`.replace(/no business acceptance|not business acceptance/gi, ''))));
  const acks = all.flatMap(({ s }) => s.trace.filter((t) => /\(997\)/.test(t.what)));
  ok('watch.no_997_shown_as_acceptance', !accepted.length && acks.length >= 4 && acks.every((t) => /not business acceptance/.test(t.what)) && all.every(({ o }) => o.violations.length === 0), JSON.stringify(accepted).slice(0, 200));
  { const s = W.startSession(db, { variation: W.VARIATIONS.canonical }); const ok1 = (r) => (r.state === 'Awaiting approval' ? W.decide(db, s, r.proposal, 'approve') : r);
    W.propose(db, s, 'Test', 'draft_ship_notice', { po: 'NR-46215' }); ok1(W.propose(db, s, 'Test', 'release_document', { po: 'NR-46215', document: '856' }));
    const mid = W.queue(db, s).rows.find((r) => r.po === 'NR-46215'); W.advance(db, s, { minutes: 30 }); const ack = W.queue(db, s).rows.find((r) => r.po === 'NR-46215');
    W.advance(db, s, { to: Date.parse('2026-11-18T16:40:00Z') }); const end = W.queue(db, s).rows.find((r) => r.po === 'NR-46215');
    eq('watch.late_stays_late_and_row_closes_only_on_861', [mid.state, mid.closed, ack.state, ack.closed, /997/.test(ack.technical_ack), end.state, end.closed, /RCV-46215/.test(end.confirmation)], ['Sent Late', false, 'Sent Late', false, true, 'Closed; sent Late', true, true]); }

  // ---------- 6. Guardrails and approvals the server enforces ----------
  { const s = W.startSession(db, { variation: W.VARIATIONS.canonical, policy: { release_document: 'policy', draft_ship_notice: 'approve' } });
    ok('watch.guard_ship_notice_only_from_load_scan_or_fulfilment', W.propose(db, s, 'Test', 'draft_ship_notice', { po: 'NR-46215', cartons: 6 }).state === 'Refused' && /AP-1\.4/.test(W.propose(db, s, 'Test', 'draft_ship_notice', { po: 'NR-46220' }).message || ''));
    ok('watch.guard_release_always_needs_priya', s.modes.release_document === 'approve' && s.modes.draft_ship_notice === 'policy' && W.propose(db, s, 'Test', 'draft_acknowledgment', { po: 'NR-46210' }).state === 'Executed' && W.propose(db, s, 'Test', 'release_document', { po: 'NR-46210', document: '855' }).state === 'Awaiting approval');
    const p = s.proposals.at(-1); W.decide(db, s, p.id, 'approve'); ok('watch.guard_an_approval_cannot_be_replayed', W.decide(db, s, p.id, 'approve').state === 'Refused'); }
  { const s = W.startSession(db, { variation: W.VARIATIONS.early_fulfilment_46302 }); W.propose(db, s, 'Test', 'draft_ship_notice', { po: 'NR-46302' });
    ok('watch.guard_no_ship_notice_sent_before_departure', /NF-4\.2/.test(W.propose(db, s, 'Test', 'release_document', { po: 'NR-46302', document: '856' }).message || '')); }
  { const bad = (f) => { try { W.factsToVariation(f); return false; } catch { return true; } };
    ok('watch.facts_out_of_range_refused', bad({ kinross_window_hours: 12 }) && bad({ kinross_reachable: 'maybe' }) && bad({ kinross_note: 'x'.repeat(301) }) && bad({ ship_to: 'DC 2' }) && bad({ moment: '2026-11-17 11:00 ET', departure_scanned_46220: 'yes' })); }
  { const su = W.setup(); ok('watch.setup_lists_facts_rules_actions_guardrails', su.facts.kinross_window_hours.recorded === 48 && su.priya_rules.kinross_window_hours.allowed.join() === '24,48' && su.actions.release_document.priya_may_change === false && su.guardrails.length === 3 && Object.keys(su.presets).length === Object.keys(W.VARIATIONS).length); }

  // ---------- 7. No read returns a record from after the branch unless revealed as a confirmation (leak check) ----------
  const leaks = []; let reads = 0;
  for (const { s } of all) {
    const pos = new Set(); for (const r of s.reads) for (const m of r.out.matchAll(/NR-\d{5,6}/g)) pos.add(m[0]);
    // References first sent after the branch (a later version of a document sent before it, such as a corrected ship notice, keeps its reference).
    const later = [...pos].flatMap((po) => db.prepare('SELECT reference FROM documents WHERE po = ? GROUP BY reference HAVING min(sent_at) > ?').all(po, new Date(s.branch).toISOString()).map((d) => d.reference));
    for (const r of s.reads) { reads++; for (const ref of later) if (r.out.includes(`"${ref}"`) && !r.revealed.includes(ref)) leaks.push(`${s.label}:${r.name}:${ref}`); }
  }
  ok('watch.no_read_returns_a_record_after_the_branch', !leaks.length && reads > 100, `${reads} reads; ${leaks.slice(0, 5).join(', ')}`);
  // Revealed records arrive only after the session action that asks for them: no 861 without a sent ship notice, no 945 without an ask.
  ok('watch.confirmations_follow_session_actions', all.every(({ s }) => s.revealed.every((r) => r.doc_type === '997' || (r.doc_type === '861' ? s.docs.some((d) => d.po === r.po && d.doc_type === '856' && d.state === 'Sent' && d.sent_at <= r.at) : s.tasks.some((t) => t.po === r.po && t.sent_iso <= r.at)))));

  // ---------- 8. A session changes no recorded row ----------
  eq('watch.sessions_change_no_recorded_row', counts(), before);
}
