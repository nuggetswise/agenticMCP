// One hash over every X12 file the build wrote. The validator report records it; the build check compares.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function corpusHash(dir) {
  const h = createHash('sha256'); let files = 0;
  for (const day of readdirSync(dir).sort()) for (const f of readdirSync(join(dir, day)).sort()) { h.update(`${day}/${f}\n`); h.update(readFileSync(join(dir, day, f))); files++; }
  return { sha256: h.digest('hex'), files };
}
