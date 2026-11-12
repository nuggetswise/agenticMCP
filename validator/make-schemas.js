// Writes StAEDI transaction schemas for Northfield's 004010 implementation of each document.
// Element types and lengths follow the X12 004010 data element dictionary; which segments are
// mandatory follows the Northfield implementation guide in this repository (invented, see registry/rules).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'schemas');

// element: 'TYPE min max' with trailing ! when mandatory. Types: AN ID N R DT TM
const pairs = (n) => Array(n).fill(['ID 2 2', 'AN 1 48']).flat();
const SEG = {
  BEG: ['ID 2 2!', 'ID 2 2!', 'AN 1 22!', 'AN 1 30', 'DT 8 8!'],
  REF: ['ID 2 3!', 'AN 1 30', 'AN 1 80'],
  DTM: ['ID 3 3!', 'DT 8 8', 'TM 4 8'],
  N1: ['ID 2 3!', 'AN 1 60', 'ID 1 2', 'AN 2 80'],
  PO1: ['AN 1 20', 'R 1 15', 'ID 2 2', 'R 1 17', 'ID 2 2', ...pairs(4)],
  CTT: ['N 1 6!', 'R 1 10'],
  BAK: ['ID 2 2!', 'ID 2 2!', 'AN 1 22!', 'DT 8 8!', 'AN 1 30', 'AN 1 45', 'AN 1 30', 'AN 1 30'],
  ACK: ['ID 2 2!', 'R 1 15', 'ID 2 2', 'ID 3 3', 'DT 8 8'],
  BCH: ['ID 2 2!', 'ID 2 2!', 'AN 1 22!', 'AN 1 30', 'AN 1 8', 'DT 8 8!', 'AN 1 45', 'AN 1 30', 'AN 1 30', 'DT 8 8', 'DT 8 8'],
  POC: ['AN 1 20', 'ID 2 2!', 'R 1 15', 'R 1 15', 'ID 2 2', 'R 1 17', 'ID 2 2', ...pairs(4)],
  BCA: ['ID 2 2!', 'ID 2 2!', 'AN 1 22!', 'AN 1 30', 'AN 1 8', 'DT 8 8!'],
  BSN: ['ID 2 2!', 'AN 2 30!', 'DT 8 8!', 'TM 4 8!', 'ID 4 4'],
  HL: ['AN 1 12!', 'AN 1 12', 'ID 1 2!', 'ID 1 1'],
  TD1: ['ID 3 5', 'N 1 7'],
  TD5: ['ID 1 2', 'ID 1 2', 'AN 2 80'],
  PRF: ['AN 1 22!'],
  MAN: ['ID 1 2!', 'AN 1 48!'],
  LIN: ['AN 1 20', 'ID 2 2!', 'AN 1 48!', ...pairs(3)],
  SN1: ['AN 1 20', 'R 1 10!', 'ID 2 2!', 'R 1 15', 'R 1 15', 'ID 2 2', 'AN 1 20', 'ID 2 2'],
  BIG: ['DT 8 8!', 'AN 1 22!', 'DT 8 8', 'AN 1 22'],
  ITD: ['ID 2 2', 'ID 1 2', 'R 1 6', 'DT 8 8', 'N 1 3', 'DT 8 8', 'N 1 3'],
  IT1: ['AN 1 20', 'R 1 10', 'ID 2 2', 'R 1 17', 'ID 2 2', ...pairs(4)],
  TDS: ['N 1 15!'],
  BRA: ['AN 1 30!', 'DT 8 8!', 'ID 2 2!', 'ID 1 1!'],
  RCD: ['AN 1 20', 'R 1 9', 'ID 2 2', 'R 1 9', 'ID 2 2', 'R 1 9', 'ID 2 2', 'ID 2 2'],
  BGN: ['ID 2 2!', 'AN 1 30!', 'DT 8 8!', 'TM 4 8'],
  OTI: ['ID 1 2!', 'ID 2 3!', 'AN 1 30!', 'AN 2 15', 'AN 2 15', 'DT 8 8', 'TM 4 8', 'N 1 9', 'AN 4 9', 'ID 3 3'],
  TED: ['ID 1 3!', 'AN 1 60', 'ID 2 3', 'N 1 6', 'N 1 2', 'N 1 4', 'AN 1 99'],
  NTE: ['ID 3 3', 'AN 1 80!'],
  AK1: ['ID 2 2!', 'N 1 9!'],
  AK2: ['ID 3 3!', 'AN 4 9!'],
  AK3: ['ID 2 3!', 'N 1 6!', 'AN 1 6', 'ID 1 3'],
  AK4: ['N 1 2!', 'N 1 4', 'ID 1 3!', 'AN 1 99'],
  AK5: ['ID 1 1!', 'ID 1 3'],
  AK9: ['ID 1 1!', 'N 1 6!', 'N 1 6!', 'N 1 6!', 'ID 1 3'],
  BPR: ['ID 1 2!', 'R 1 18!', 'ID 1 1!', 'ID 3 5!', 'ID 1 10', ...Array(10).fill('AN 1 35'), 'DT 8 8'],
  TRN: ['ID 1 2!', 'AN 1 30!'],
  ENT: ['N 1 6'],
  RMR: ['ID 2 3', 'AN 1 30', 'ID 1 2', 'R 1 18', 'R 1 18'],
  ADX: ['R 1 18!', 'ID 2 2!', 'ID 2 3', 'AN 1 30'],
  W05: ['ID 1 1!', 'AN 1 22!', 'AN 1 22'],
  G62: ['ID 2 2', 'DT 8 8', 'ID 1 2', 'TM 4 8'],
  LX: ['N 1 6!'],
  W01: ['R 1 15!', 'ID 2 2!', 'AN 1 12', 'ID 2 2', 'AN 1 48'],
  W76: ['N 1 10!'],
  W06: ['ID 1 1!', 'AN 1 22', 'DT 8 8', 'AN 1 30', 'AN 1 30', 'AN 1 22'],
  W12: ['ID 2 2!', 'R 1 15', 'R 1 15', 'R 1 15', 'ID 2 2', 'AN 1 12', 'ID 2 2', 'AN 1 48'],
  W03: ['N 1 7!'],
  XQ: ['ID 1 1!', 'DT 8 8!', 'DT 8 8'],
  ZA: ['ID 2 2!'],
  SDQ: ['ID 2 2!', 'ID 2 2', 'AN 2 80!', 'R 1 15!', ...Array(9).fill(['AN 2 80', 'R 1 15']).flat()],
};
// structure: 'TAG' optional, 'TAG!' mandatory, 'TAG+' repeating, 'TAG!+' both; arrays are loops headed by their first segment
const L = (...x) => x;
const SET = {
  850: ['BEG!', 'REF!+', 'DTM!+', L('N1!+'), L('PO1!+'), 'CTT'],
  855: ['BAK!', L('PO1!+', L('ACK+')), 'CTT'],
  860: ['BCH!', L('POC!+', 'DTM+'), 'CTT'],
  865: ['BCA!', 'REF+', L('POC!+', L('ACK+')), 'CTT'],
  856: ['BSN!', L('HL!+', 'LIN', 'SN1', 'PRF', 'TD1+', 'TD5+', 'REF+', 'MAN+', 'DTM+', L('N1+')), 'CTT'],
  810: ['BIG!', 'REF+', L('N1+'), 'ITD+', L('IT1!+'), 'TDS!', 'CTT'],
  861: ['BRA!', 'REF+', 'DTM+', 'PRF', L('N1+'), L('RCD!+', 'LIN+', 'MAN+')],
  824: ['BGN!', L('OTI!+', L('TED+', 'NTE+'))],
  997: ['AK1!', L('AK2+', L('AK3+', 'AK4+'), 'AK5!'), 'AK9!'],
  820: ['BPR!', 'TRN', L('N1+'), L('ENT+', L('RMR+', 'REF+', L('ADX+', 'NTE+')))],
  940: ['W05!', L('N1+'), 'G62+', L('LX!+', L('W01+')), 'W76'],
  945: ['W06!', L('N1+'), 'G62+', L('LX!+', L('W12+')), 'W03'],
  852: ['XQ!', L('N1+'), L('LIN!+', L('ZA+', 'SDQ+')), 'CTT'],
};
const BASE = { AN: 'string', ID: 'identifier', N: 'numeric', R: 'decimal', DT: 'date', TM: 'time' };
const elTypes = new Map();
const elName = (spec) => { const [t, mn, mx] = spec.replace('!', '').split(' '); const n = `E_${t}_${mn}_${mx}`; elTypes.set(n, `<elementType name="${n}" base="${BASE[t]}" minLength="${mn}" maxLength="${mx}"/>`); return n; };
function struct(items, used, depth = 0, counter = { n: 0 }) {
  return items.map((it) => {
    if (Array.isArray(it)) { const head = it[0]; const m = head.includes('!'); const code = `L${++counter.n}_${head.replace(/[!+]/g, '')}`; const inner = [head.replace('+', ''), ...it.slice(1)]; return `<loop code="${code}" minOccurs="${m ? 1 : 0}" maxOccurs="999999"><sequence>${struct(inner, used, depth + 1, counter)}</sequence></loop>`; }
    const tag = it.replace(/[!+]/g, ''); used.add(tag);
    return `<segment type="${tag}" minOccurs="${it.includes('!') ? 1 : 0}"${it.includes('+') ? ' maxOccurs="999999"' : ''}/>`;
  }).join('');
}
mkdirSync(OUT, { recursive: true });
for (const [set, items] of Object.entries(SET)) {
  elTypes.clear(); const used = new Set();
  const body = struct(items, used);
  const segs = [...used].map((tag) => `<segmentType name="${tag}"><sequence>${SEG[tag].map((sp) => `<element type="${elName(sp)}" minOccurs="${sp.endsWith('!') ? 1 : 0}"/>`).join('')}</sequence></segmentType>`).join('\n');
  writeFileSync(join(OUT, `${set}.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<schema xmlns="http://xlate.io/EDISchema/v4">\n<transaction><sequence>${body}</sequence></transaction>\n${[...elTypes.values()].join('\n')}\n${segs}\n</schema>\n`);
}
console.log(`Wrote ${Object.keys(SET).length} schemas to ${OUT}`);
