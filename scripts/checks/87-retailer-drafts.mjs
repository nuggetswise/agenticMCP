// Change list 4: two real retailers' chargeback rules as Northfield drafts (owner decision, 16 November 2026).
// Every draft replays deterministically or says what the world lacks; none is in force; neither retailer is named.
export default function ({ nf, ok, eq, NR }) {
  const drafts = NR.draftRules(nf).drafts;
  // D72: published to go into force on 4 January 2027, after the quarter's last shipment, so no shipment in the world falls under them.
  const cl4 = drafts.filter((d) => /retailer/.test(d.basis));
  eq('drafts.change_list_4_scheduled_from_4_january_2027', [...new Set(cl4.map((d) => `${d.state}:${d.in_force_from}`))], ['Scheduled:2027-01-04T05:00:00.000Z']);
  eq('drafts.change_list_4_count', cl4.length, 13);
  // P25 (20 November 2026) ships on 13 January 2027, after P22's moment and so after the in-force date: it is the only
  // shipment that falls under change list 4, and it passes every draft (the replay to P22's moment fails as many as the whole replay).
  // P26 (20 November 2026) ships on 18 January 2027, the second shipment under change list 4; it passes every draft too.
  eq('drafts.only_p25_and_p26_ship_on_or_after_the_in_force_date', nf.prepare('SELECT shipment_id FROM shipments WHERE shipped_at >= ? ORDER BY shipment_id').all('2027-01-04T05:00:00.000Z').map((r) => r.shipment_id), ['ASN-47300', 'ASN-47400']);
  { const p22 = nf.prepare("SELECT as_of FROM calendar WHERE id = 'P22'").get().as_of; const fails = (x) => x.failing_with_draft ?? x.failing_now ?? null;
    eq('drafts.p25_shipment_passes_every_draft', drafts.filter((d) => fails(NR.replayRule(nf, { draft: d.id })) !== fails(NR.replayRule(nf, { draft: d.id, as_of: p22 }))).map((d) => d.id), []); }
  eq('drafts.nfd1_nfd2_still_drafts', drafts.filter((d) => ['NFD-1', 'NFD-2'].includes(d.id)).map((d) => d.state), ['Draft', 'Draft']);
  const bad = []; const res = {};
  for (const d of drafts) { const a = JSON.stringify(NR.replayRule(nf, { draft: d.id })); const b = JSON.stringify(NR.replayRule(nf, { draft: d.id })); if (a !== b) bad.push(`${d.id} not deterministic`); res[d.id] = JSON.parse(a); }
  eq('drafts.replay_is_deterministic', bad, []);
  eq('drafts.ship_window_rules_say_what_the_world_lacks', ['NFD-8', 'NFD-9'].map((id) => res[id].replayable === false && /ship-not-(after|before) dates/.test(res[id].needs)), [true, true]);
  eq('drafts.unset_charge_reads_to_set', [res['NFD-7'].charge, res['NFD-7'].exposure_with_draft], ['To set', 'To set']);
  ok('drafts.no_retailer_named', drafts.every((d) => !/amazon|walmart|target|kohl/i.test(`${d.statement} ${d.basis}`)));
  ok('drafts.corrected_ship_notice_is_not_a_duplicate_shipment_id', res['NFD-11'].failing_with_draft === 0);
}
