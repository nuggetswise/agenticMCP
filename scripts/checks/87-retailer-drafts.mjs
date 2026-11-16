// Change list 4: two real retailers' chargeback rules as Northfield drafts (owner decision, 16 November 2026).
// Every draft replays deterministically or says what the world lacks; none is in force; neither retailer is named.
export default function ({ nf, ok, eq, NR }) {
  const drafts = NR.draftRules(nf).drafts;
  eq('drafts.change_list_4_present_and_not_in_force', drafts.filter((d) => /retailer/.test(d.basis)).map((d) => `${d.id}:${d.state}`),
    ['NFD-10:Draft', 'NFD-11:Draft', 'NFD-12:Draft', 'NFD-13:Draft', 'NFD-14:Draft', 'NFD-15:Draft', 'NFD-3:Draft', 'NFD-4:Draft', 'NFD-5:Draft', 'NFD-6:Draft', 'NFD-7:Draft', 'NFD-8:Draft', 'NFD-9:Draft']);
  const bad = []; const res = {};
  for (const d of drafts) { const a = JSON.stringify(NR.replayRule(nf, { draft: d.id })); const b = JSON.stringify(NR.replayRule(nf, { draft: d.id })); if (a !== b) bad.push(`${d.id} not deterministic`); res[d.id] = JSON.parse(a); }
  eq('drafts.replay_is_deterministic', bad, []);
  eq('drafts.ship_window_rules_say_what_the_world_lacks', ['NFD-8', 'NFD-9'].map((id) => res[id].replayable === false && /ship-not-(after|before) dates/.test(res[id].needs)), [true, true]);
  eq('drafts.unset_charge_reads_to_set', [res['NFD-7'].charge, res['NFD-7'].exposure_with_draft], ['To set', 'To set']);
  ok('drafts.no_retailer_named', drafts.every((d) => !/amazon|walmart|target|kohl/i.test(`${d.statement} ${d.basis}`)));
  ok('drafts.corrected_ship_notice_is_not_a_duplicate_shipment_id', res['NFD-11'].failing_with_draft === 0);
}
