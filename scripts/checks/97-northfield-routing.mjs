// Northfield's trail on collect freight (owner decision of 20 November 2026, carried out 23 November 2026, rebuild plan
// Step 4 Bucket 3): Northfield routes a collect load, so the routing request and instructions (753, 754) it exchanged and
// Lakeline's shipment status (214) on that load are Northfield's records. Ashby's warehouse documents, its 997s with
// Kinross, and its own carrier exchanges on a load it tenders stay Ashby's.
import * as NR from '../../src/retailer.js';

export default function ({ nf, ok, eq }) {
  const at = new Date('2026-12-09T22:30:00.000Z'); // P8's moment, the merged P24 view
  const t = NR.trail(nf, { po: 'NR-46616', asOf: at });
  eq('nf_routing.trail_carries_753_754_and_lakelines_214', t.documents.filter((d) => ['753', '754', '214'].includes(d.set)).map((d) => `${d.set}:${d.reference}`),
    ['753:RR-46616', '754:NRL-46616', '214:PRO-46616 X3+SD']);
  eq('nf_routing.trail_leaves_out_kinross_997s', t.documents.filter((d) => /^FA-K|^FA-AK/.test(d.reference)).length, 0);
  ok('nf_routing.routing_instructions_open_for_northfield', NR.documentNF(nf, 'NRL-46616').found === true);
  ok('nf_routing.lakeline_status_opens_for_northfield', NR.documentNF(nf, 'PRO-46616 X3+SD').found === true);
  ok('nf_routing.kinross_997_stays_ashbys', NR.documentNF(nf, 'FA-K599').not_available === true);
  // Every 214 Northfield holds is on a load it routed; none on a prepaid load Ashby tendered.
  eq('nf_routing.no_214_outside_a_routed_load', nf.prepare("SELECT count(*) n FROM documents WHERE doc_type = '214' AND po NOT IN (SELECT po FROM routing_requests)").get().n, 0);
}
