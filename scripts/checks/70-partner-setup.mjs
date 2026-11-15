// T1.18 Partner setup: Northfield's locations are read from its 816s, each with a dated history, and the closed
// ship-to check (NF-4.12, 824 code LOC) reads the ship-to as it stood on the ship notice's date.
export default function ({ db, ash, nf, ok, eq, none, n }) {
  // The location as of a time: valid_from at or before it, valid_to (exclusive) after it or open.
  const locAt = (h, gln, at) => h.prepare("SELECT * FROM location_versions WHERE gln = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from DESC").get(gln, at, at) || null;

  // Every Northfield location row is the open version of its 816 history, and came from an 816 Northfield sent.
  none('partner-setup.locations_read_from_816', `SELECT l.id FROM locations l WHERE l.party_id = 'NORTHFIELD' AND NOT EXISTS (SELECT 1 FROM location_versions v JOIN documents d ON d.doc_id = v.doc_id
    WHERE v.location_id = l.id AND v.valid_to IS NULL AND d.doc_type = '816' AND d.sender_id = 'NORTHFIELD' AND v.gln = l.gln AND v.name = l.name AND v.active = l.active AND v.note IS l.note AND v.store_number IS l.store_number)`);
  none('partner-setup.every_version_names_a_northfield_location', "SELECT v.location_id FROM location_versions v LEFT JOIN locations l ON l.id = v.location_id WHERE l.party_id IS NOT 'NORTHFIELD'");
  eq('partner-setup.location_counts', [n("SELECT count(*) n FROM locations WHERE party_id = 'NORTHFIELD'"), n('SELECT count(DISTINCT location_id) n FROM location_versions'), n("SELECT count(*) n FROM location_versions WHERE valid_to IS NULL")], [43, 43, 43]);
  none('partner-setup.versions_do_not_overlap', "SELECT a.location_id FROM location_versions a JOIN location_versions b ON a.location_id = b.location_id AND a.version < b.version AND a.valid_from < coalesce(b.valid_to, '9999') AND b.valid_from < coalesce(a.valid_to, '9999')");
  none('partner-setup.every_version_has_an_address', "SELECT location_id, version FROM location_versions WHERE address = '' OR city = '' OR length(state) <> 2 OR postal_code = ''");

  // The closed ship-to check: every ship notice Northfield rejected with LOC named a ship-to that was closed on the
  // ship notice's date, and no ship notice or order it accepted names a Northfield location that was not active then.
  const loc = db.prepare(`SELECT d.doc_id, d.sent_at, json_extract(d.body, '$.parties.ST.gln') gln FROM errors e JOIN documents d ON d.doc_id = e.doc_id WHERE e.code = 'LOC' AND d.doc_type = '856' ORDER BY d.sent_at`).all();
  const judged = loc.map((r) => ({ doc: r.doc_id, active: locAt(db, r.gln, r.sent_at)?.active ?? null }));
  ok('partner-setup.closed_ship_to_check_fires', loc.length >= 6 && judged.every((j) => j.active === 0), JSON.stringify(judged.filter((j) => j.active !== 0)));
  const accepted = db.prepare(`SELECT d.doc_id, d.sent_at, json_extract(d.body, '$.parties.ST.gln') gln FROM documents d WHERE d.doc_type IN ('850','856') AND d.test = 0 AND d.status NOT LIKE 'Rejected%' AND d.status <> 'Corrected and resent'
    AND json_extract(d.body, '$.parties.ST.gln') IN (SELECT gln FROM location_versions)`).all();
  const wrong = accepted.filter((r) => locAt(db, r.gln, r.sent_at)?.active !== 1);
  ok('partner-setup.accepted_documents_name_an_active_ship_to', accepted.length > 1000 && wrong.length === 0, `${accepted.length} judged, ${wrong.length} not active, first ${JSON.stringify(wrong[0])}`);
  // The flip: DC 1's GLN is an active ship-to the day before its closure date and closed from that date on.
  const g = loc[0]?.gln; const closed = db.prepare('SELECT closed_on FROM location_versions WHERE gln = ? AND closed_on IS NOT NULL').get(g)?.closed_on;
  eq('partner-setup.same_gln_active_before_the_closure', [g, closed, locAt(db, g, '2026-08-31T16:00:00.000Z')?.active, locAt(db, g, `${closed}T04:00:00.000Z`)?.active, locAt(db, g, loc[0]?.sent_at)?.active], ['0614141001996', '2026-09-01', 1, 0, 0]);
  ok('partner-setup.closure_before_first_loc_rejection', closed && loc.every((r) => r.sent_at >= closed), `closed ${closed}, first rejection ${loc[0]?.sent_at}`);

  // The document flow: the 1 March list is an origin; the closure names the 816 it amends.
  const flow = db.prepare("SELECT d.reference, d.sent_at, (SELECT group_concat(p.reference || ':' || l.kind) FROM document_links l JOIN documents p ON p.doc_id = l.prev_doc_id WHERE l.doc_id = d.doc_id) prev FROM documents d WHERE d.doc_type = '816' ORDER BY d.sent_at").all();
  eq('partner-setup.closure_amends_the_full_list', flow.map((r) => [r.reference, r.prev]), [['ORG-20260301', null], ['ORG-20260316', 'ORG-20260301:amends']]);
  // P10's window: no 816 between Ashby and Northfield in the 30 days before 17 Nov 11:00 ET.
  none('partner-setup.outside_p10_window', "SELECT doc_id FROM documents WHERE doc_type = '816' AND sent_at > '2026-10-18T15:00:00.000Z' AND sent_at <= '2026-11-17T16:00:00.000Z'");

  // Views: both companies see the 816s, Northfield's locations and their history; Ashby sees no other party's sites.
  for (const [who, h] of [['ashby', ash], ['northfield', nf]]) {
    eq(`partner-setup.${who}_sees_816s_and_location_history`, [h.prepare("SELECT count(*) n FROM documents WHERE doc_type = '816'").get().n, h.prepare("SELECT count(*) n FROM locations WHERE party_id = 'NORTHFIELD'").get().n, h.prepare('SELECT count(*) n FROM location_versions').get().n], [2, 43, 44]);
    eq(`partner-setup.${who}_reads_the_same_flip`, [locAt(h, '0614141001996', '2026-08-31T16:00:00.000Z')?.active, locAt(h, '0614141001996', '2026-10-11T19:17:26.000Z')?.active], [1, 0]);
  }
  eq('partner-setup.ashby_sees_no_other_supplier_site', ash.prepare("SELECT count(*) n FROM locations WHERE party_id NOT IN ('NORTHFIELD','ASHBY','KINROSS','LAKELINE')").get().n, 0);
}
