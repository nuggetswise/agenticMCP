// Extracts the items (bullets and table rows) of named sections from a Markdown file.
// Used by guide-check.mjs to prove every rule in a retired governing section has a home in the Build Guide.
import { readFileSync } from 'node:fs';
export function sectionItems(file, heading) {
  const L = readFileSync(file, 'utf8').split('\n');
  const i = L.findIndex((l) => l.trim().replace(/’/g, "'") === heading.replace(/’/g, "'"));
  if (i < 0) return null;
  const lvl = heading.match(/^#+/)[0].length; const out = []; let inTable = false;
  for (let j = i + 1; j < L.length; j++) {
    const l = L[j]; const m = l.match(/^(#+) /);
    if (m && m[1].length <= lvl) break;
    if (m) { inTable = false; continue; }
    if (/^\s*- /.test(l)) { out.push(l.replace(/^\s*- /, '').trim()); inTable = false; continue; }
    if (l.includes(' | ')) { if (/^\|?\s*-{3}/.test(l)) continue; if (!inTable) { inTable = true; continue; } out.push(l.replace(/^\|\s*/, '').split(' | ')[0].trim()); continue; }
    if (!l.trim()) inTable = false;
  }
  return out;
}
export const key = (s) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 32).toLowerCase();
