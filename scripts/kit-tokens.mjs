// Writes the design system tokens (ui/ds/tokens.css and ui/ds/tokens-derived.css) into the agent kit between its
// tokens markers, so the kit carries the tokens it reads and every page built from it does too. Run after either file changes.
// Usage: node scripts/kit-tokens.mjs [--check]   (--check fails when the kit's copy differs from the files)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/`/g, '');
const block = `/*tokens:start*/${strip(readFileSync(join(ROOT, 'ui/ds/tokens.css'), 'utf8'))}${strip(readFileSync(join(ROOT, 'ui/ds/tokens-derived.css'), 'utf8'))}/*tokens:end*/`;
const p = join(ROOT, 'ui/tg-agent-kit.js'); const kit = readFileSync(p, 'utf8');
const next = kit.replace(/\/\*tokens:start\*\/[\s\S]*?\/\*tokens:end\*\//, () => block);
if (process.argv.includes('--check')) { if (next !== kit) { console.error('FAIL the kit’s tokens differ from ui/ds; run node scripts/kit-tokens.mjs'); process.exit(1); } console.log('PASS the kit carries the design system tokens'); }
else { writeFileSync(p, next); console.log('Wrote the design system tokens into ui/tg-agent-kit.js'); }
