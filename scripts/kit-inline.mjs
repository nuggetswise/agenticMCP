// Inlines the agent kit into a page so the page is self-contained for publishing: replaces
// <script src="tg-agent-kit.js"></script> (any path ending in tg-agent-kit.js) with the kit's source.
// Usage: node scripts/kit-inline.mjs <in.html> <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [inp, out] = process.argv.slice(2);
const kit = readFileSync(join(ROOT, 'ui', 'tg-agent-kit.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = readFileSync(inp, 'utf8'); const re = /<script src="[^"]*tg-agent-kit\.js"><\/script>/;
if (!re.test(html)) { console.error('No tg-agent-kit.js script tag found'); process.exit(1); }
writeFileSync(out, html.replace(re, () => `<script>/* TG for Retail agent kit ${JSON.stringify(kit.match(/version: '([^']+)'/)?.[1])} */\n${kit}</script>`));
console.log(`Wrote ${out}`);
