// T1.18 Partner setup: Northfield's 816 organisational relationships to Ashby. Northfield's distribution centres and
// stores are read from these 816s, not typed into ref.js, and each location keeps a dated history (location_versions),
// so the closed ship-to check (NF-4.12, 824 code LOC) reads the location as it stood on the ship notice's date.
//
// Borrowed:
//   X12 004010 816 structure: BHT, DTM, REF, the N1 loop, then the HL loop with N1, N3, N4, REF, DTM and ASI, as in
//     bots-grammars x12/4010/816004010.py (https://github.com/bots-edi/bots-grammars), functional group OR.
//   Retailer usage: Kohl's 816 Organizational Relationships, Programmer's Reference Guide 4010VICS, revised
//     10 Feb 2005 (https://edi.jobisez.com/edi-igs/Kohls/edi_816.pdf): BHT01 0065 Location Address Structure,
//     BHT02 00 original or 04 change; HL03 35 company and 36 operating unit; N3 and N4 address; DTM 145 opening
//     date and 146 closing date; ASI 2 with 021 addition and 001 change. Departures from that guide, marked Invented:
//     N101 WH or SN names the kind directly (Kohl's sends BU with N106 SN or WH); N103 UL carries the GLN (Kohl's
//     sends 93 with its own number); REF ZZ carries Northfield's location code with its receiving note, REF ST the
//     store number, and a header DTM 007 the date the list takes effect; a header REF ZZ names the 816 a change amends.
//   NetSuite: a location is made inactive rather than deleted, so it "doesn't appear in location lists on records and
//     transactions" (https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N265253.html). The closure
//     816 changes DC 1 (ASI 001) with a closing date; it does not delete it, and the master row stays, inactive.
//   ERPNext Address: street, city, state and postal code per address, linked to its party
//     (https://docs.frappe.io/erpnext/address). The address lives on location_versions, dated like an Item Price.
//
// Values: every address, opening date and location code is Invented. GLNs, names, store numbers and receiving notes
// are the ones the world already had, so the locations table is unchanged (world-diff 0 changed).
//
// Dates, and P10's window (18 Oct to 17 Nov 2026, 11:00 ET): the full list is sent Sunday 1 March 2026, the start of
// the history period, effective that day; the closure is announced Monday 16 March 2026, effective 1 September, the
// months of notice a DC consolidation gives suppliers. Both are before the window, and the closure takes effect before
// the first LOC rejection (ASN-45749, 11 October 2026).
// Control numbers: both 816s are sent before the first history document on this pair (29 March), and are numbered in
// the history range (hist), so they take the two lowest numbers there and no existing interchange is renumbered. A
// document dated later would shift the control number of every document after it on Northfield to Ashby.
import { rng, et } from '../lib.js';
import { seg, d8, t4, day8, clean, n1, first } from '../x12.js';
import * as ref from '../ref.js';

const FULL_LIST = { ref: 'ORG-20260301', at: et('2026-03-01', '09:00'), effective: '2026-03-01' };
const CLOSURE = { ref: 'ORG-20260316', at: et('2026-03-16', '10:00'), effective: '2026-09-01' };
const DC1_GLN = '0614141001996';

// Invented addresses. Northfield's DCs and its Ohio (101-124) and Indiana (201-216) stores.
const DC_SITE = {
  DC2: { address: '2400 Prairie Logistics Way', city: 'Plainfield', state: 'IN', postal: '46168', opened: '2014-05-12' },
  DC4: { address: '880 Riverbend Parkway', city: 'Romeoville', state: 'IL', postal: '60446', opened: '2021-08-02' },
  'DC1-OLD': { address: '1100 Gateway Boulevard', city: 'Columbus', state: 'OH', postal: '43217', opened: '2009-04-06' },
};
const OH = [['Dublin', '43017'], ['Westerville', '43081'], ['Grove City', '43123'], ['Delaware', '43015'], ['Newark', '43055'], ['Lancaster', '43130'], ['Marion', '43302'], ['Mansfield', '44902'], ['Zanesville', '43701'], ['Chillicothe', '45601'], ['Hilliard', '43026'], ['Pickerington', '43147']];
const IN = [['Carmel', '46032'], ['Fishers', '46037'], ['Greenwood', '46142'], ['Noblesville', '46060'], ['Muncie', '47305'], ['Anderson', '46016'], ['Kokomo', '46901'], ['Lafayette', '47905']];
const STREETS = ['Main Street', 'Market Street', 'Commerce Drive', 'Town Center Boulevard', 'Maple Avenue', 'Union Street', 'Park Road', 'Oak Ridge Drive'];

/** The list Northfield sends on 1 March, built from the world's location masters with invented addresses. */
function fullList() {
  const r = rng(18160301);
  const nf = [...ref.locations, ...ref.moreLocations].filter((l) => l.party_id === 'NORTHFIELD');
  return nf.map((l) => {
    const store = l.store_number ?? ref.STORE_NUMBER[l.id] ?? null;
    if (!store) {
      const s = DC_SITE[l.id]; const closedLater = l.gln === DC1_GLN;
      return { kind: 'WH', code: closedLater ? 'DC1' : l.id, name: closedLater ? 'Northfield DC 1' : l.name, gln: l.gln, store_number: null, note: closedLater ? 'Dock window 05:00 to 13:00' : l.note, ...s, closed: null, action: '021' };
    }
    const [city, postal] = (Number(store) < 200 ? OH : IN)[Math.floor(r() * (Number(store) < 200 ? OH : IN).length)];
    return { kind: 'SN', code: l.id, name: l.name, gln: l.gln, store_number: String(store), note: l.note, address: `${100 + Math.floor(r() * 9800)} ${STREETS[Math.floor(r() * STREETS.length)]}`, city, state: Number(store) < 200 ? 'OH' : 'IN', postal,
      opened: `${2005 + Math.floor(r() * 16)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`, closed: null, action: '021' };
  });
}

const STAGE = {
  id: 'partner-setup',
  // Northfield's location masters are derived from its 816s here; typed.js leaves them out of the ref.js masters.
  derivesLocationsOf: ['NORTHFIELD'],
  docs: {
    816: {
      func: 'OR', name: 'Organizational relationships',
      body: (d) => [
        seg('BHT', '0065', d.purpose, d.ref, d8(d.at), t4(d.at)),
        seg('DTM', '007', d8(d.effective)),
        ...(d.amends ? [seg('REF', 'ZZ', d.amends, 'Amends location list')] : []),
        seg('N1', 'FR', clean(d.from_name), 'UL', d.from_gln),
        seg('N1', 'SU', clean(d.to_name), 'UL', d.to_gln),
        seg('HL', 1, '', '35'),
        seg('N1', 'CQ', clean(d.from_name), 'UL', d.from_gln),
        ...d.locations.flatMap((l, i) => [
          seg('HL', i + 2, 1, '36'),
          seg('N1', l.kind, clean(l.name), 'UL', l.gln),
          seg('N3', clean(l.address)),
          seg('N4', clean(l.city), l.state, l.postal),
          seg('REF', 'ZZ', l.code, l.note ? clean(l.note) : ''),
          ...(l.store_number ? [seg('REF', 'ST', l.store_number)] : []),
          ...(l.opened ? [seg('DTM', '145', d8(l.opened))] : []),
          ...(l.closed ? [seg('DTM', '146', d8(l.closed))] : []),
          seg('ASI', '2', l.action),
        ]),
      ],
      read: (S) => {
        const b = first(S, 'BHT'); const hl = S.findIndex((e) => e[0] === 'HL');
        const head = S.slice(0, hl); const locs = []; let cur = null;
        for (const e of S.slice(hl)) {
          if (e[0] === 'N1' && (e[1] === 'WH' || e[1] === 'SN')) { cur = { kind: e[1], name: e[2], gln: e[4], code: null, note: null, store_number: null, opened: null, closed: null }; locs.push(cur); continue; }
          if (!cur) continue;
          if (e[0] === 'N3') cur.address = e[1];
          else if (e[0] === 'N4') Object.assign(cur, { city: e[1], state: e[2], postal: e[3] });
          else if (e[0] === 'REF' && e[1] === 'ZZ') Object.assign(cur, { code: e[2], note: e[3] || null });
          else if (e[0] === 'REF' && e[1] === 'ST') cur.store_number = e[2];
          else if (e[0] === 'DTM' && e[1] === '145') cur.opened = day8(e[2]);
          else if (e[0] === 'DTM' && e[1] === '146') cur.closed = day8(e[2]);
          else if (e[0] === 'ASI') cur.action = e[2];
        }
        return { ref: b[3], po: null, structure: b[1], purpose: b[2], effective: day8(first(head, 'DTM', '007')[2]), amends: first(head, 'REF', 'ZZ')?.[2] || null, parties: n1(head), locations: locs };
      },
    },
  },
  schema: `
-- T1.18: each version of a Northfield location as its 816s state it. valid_to is exclusive; null is open. The open
-- version is the locations row. location_id is the location's master key: the code on its latest 816.
CREATE TABLE location_versions (location_id TEXT NOT NULL REFERENCES locations(id), version INTEGER NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT,
  code TEXT NOT NULL, gln TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, store_number TEXT, address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, postal_code TEXT NOT NULL,
  opened_on TEXT, closed_on TEXT, active INTEGER NOT NULL, note TEXT, action TEXT NOT NULL, doc_id TEXT NOT NULL REFERENCES documents(doc_id), PRIMARY KEY (location_id, version));`,

  generate(L) {
    const NF = ref.PARTY.NORTHFIELD, A = ref.PARTY.ASHBY;
    const base = { type: '816', from: 'NORTHFIELD', to: 'ASHBY', from_name: NF.name, from_gln: NF.gln, to_name: A.name, to_gln: A.gln, structure: '0065', hist: true };
    const list = fullList();
    L.doc({ ...base, at: FULL_LIST.at, ref: FULL_LIST.ref, purpose: '00', effective: FULL_LIST.effective, amends: null, locations: list });
    // DC 1 closes: a change (ASI 001) with its closing date. Northfield retires the code DC1 to DC1-OLD and renames it.
    const dc1 = list.find((l) => l.gln === DC1_GLN); const now = ref.locations.find((l) => l.gln === DC1_GLN);
    L.doc({ ...base, at: CLOSURE.at, ref: CLOSURE.ref, purpose: '04', effective: CLOSURE.effective, amends: FULL_LIST.ref,
      locations: [{ ...dc1, code: now.id, name: now.name, note: now.note, closed: CLOSURE.effective, action: '001' }] });
  },

  derive(d, T) {
    T.location_versions ||= []; T.locations ||= [];
    for (const l of d.locations) {
      const prior = T.location_versions.filter((v) => v.gln === l.gln);
      const open = prior.find((v) => v.valid_to === null);
      const from = l.closed || d.effective;
      if (open) open.valid_to = from;
      T.location_versions.push({ location_id: null, version: prior.length + 1, valid_from: from, valid_to: null, code: l.code, gln: l.gln, kind: l.kind === 'WH' ? 'Distribution centre' : 'Store', name: l.name, store_number: l.store_number,
        address: l.address, city: l.city, state: l.state, postal_code: l.postal, opened_on: l.opened, closed_on: l.closed, active: l.closed && l.closed <= from ? 0 : 1, note: l.note, action: { '021': 'Addition', '001': 'Change', '002': 'Delete' }[l.action] || l.action, doc_id: d.doc_id, _party: d.sender });
    }
  },

  /** The master row is the open version; every version takes the code of its location's latest 816 as its key. */
  finish(T) {
    const vs = T.location_versions || []; const latest = new Map();
    for (const v of vs) if (v.valid_to === null) latest.set(v.gln, v);
    for (const v of vs) { v.location_id = latest.get(v.gln).code; }
    T.locations = [...latest.values()].map((v) => ({ id: v.code, party_id: v._party, name: v.name, gln: v.gln, active: v.active, note: v.note, store_number: v.store_number }));
    for (const v of vs) delete v._party;
  },

  // The 1 March list starts the flow: Northfield sends it unprompted at the start of the history period, answering
  // no document. A later 816 is a change to the list and names the 816 it amends (header REF ZZ).
  origins: ['816'],
  prev(d, ctx) { return d.amends ? [{ doc: ctx.byRef.get(`816:${d.amends}:${d.sender}`)?.[0], kind: 'amends' }] : []; },

  // Both companies see the 816s (documents between them) and Northfield's locations with their history.
  views: {
    ashby: ['INSERT INTO location_versions SELECT * FROM m.location_versions WHERE location_id IN (SELECT id FROM locations)'],
    northfield: ['INSERT INTO location_versions SELECT * FROM m.location_versions'],
  },

  staedi: {
    SEG: {
      BHT: ['ID 4 4!', 'ID 2 2!', 'AN 1 30', 'DT 8 8', 'TM 4 8', 'ID 2 2'],
      N3: ['AN 1 55!', 'AN 1 55'],
      N4: ['AN 2 30', 'ID 2 2', 'ID 3 15', 'ID 2 3'],
      ASI: ['ID 1 2!', 'ID 3 3!', 'ID 3 3'],
    },
    SET: { 816: ['BHT!', 'DTM+', 'REF+', ['N1!+', 'N3+', 'N4', 'REF+'], ['HL!+', ['N1!+', 'N3+', 'N4', 'REF+', 'DTM+', 'ASI']]] },
  },
};
export default STAGE;
