// Change list 4: two real retailers' chargeback rules as Northfield drafts (owner decision, 16 November 2026).
// Every draft replays deterministically or says what the world lacks; none is in force; neither retailer is named.
export default function ({ nf, ok, eq, NR }) {
  const drafts = NR.draftRules(nf).drafts;
  // D72: published to go into force on 4 January 2027, after the quarter's last shipment, so no shipment in the world falls under them.
  const cl4 = drafts.filter((d) => /retailer/.test(d.basis));
  eq('drafts.change_list_4_scheduled_from_4_january_2027', [...new Set(cl4.map((d) => `${d.state}:${d.in_force_from}`))], ['Scheduled:2027-01-04T05:00:00.000Z']);
  eq('drafts.change_list_4_count', cl4.length, 13);
  eq('drafts.no_shipment_on_or_after_the_in_force_date', nf.prepare('SELECT count(*) n FROM shipments WHERE shipped_at >= ?').get('2027-01-04T05:00:00.000Z').n, 0);
  eq('drafts.nfd1_nfd2_still_drafts', drafts.filter((d) => ['NFD-1', 'NFD-2'].includes(d.id)).map((d) => d.state), ['Draft', 'Draft']);
  const bad = []; const res = {};
  for (const d of drafts) { const a = JSON.stringify(NR.replayRule(nf, { draft: d.id })); const b = JSON.stringify(NR.replayRule(nf, { draft: d.id })); if (a !== b) bad.push(`${d.id} not deterministic`); res[d.id] = JSON.parse(a); }
  eq('drafts.replay_is_deterministic', bad, []);
  eq('drafts.ship_window_rules_say_what_the_world_lacks', ['NFD-8', 'NFD-9'].map((id) => res[id].replayable === false && /ship-not-(after|before) dates/.test(res[id].needs)), [true, true]);
  eq('drafts.unset_charge_reads_to_set', [res['NFD-7'].charge, res['NFD-7'].exposure_with_draft], ['To set', 'To set']);
  ok('drafts.no_retailer_named', drafts.every((d) => !/amazon|walmart|target|kohl/i.test(`${d.statement} ${d.basis}`)));
  ok('drafts.corrected_ship_notice_is_not_a_duplicate_shipment_id', res['NFD-11'].failing_with_draft === 0);
}
