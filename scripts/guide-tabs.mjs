// Splits docs/build-guide.md into the Claude doc's three tabs, as markdown the docs tools accept.
// Usage: node scripts/guide-tabs.mjs  -> writes build/guide-tab-1.md, -2.md, -3.md
// The figure marker becomes the embed token "<?claude block dia?>"; nested lists move to 4-space indents.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const md = readFileSync(join(ROOT, 'docs/build-guide.md'), 'utf8');
const tabs = md.split(/\n---\n\n<!-- Tab: [^>]+ -->\n\n/);
const toDoc = (t) => t
  .replace('<!-- figure: build-flow -->', '<?claude block dia?>')
  .split('\n')
  .map((l) => (/^  (Done when|Done for|Evidence:)/.test(l) ? `\n    ${l.trim()}` : l.replace(/^  (?=(- |\d+\. ))/, '    ').replace(/^   (?=- )/, '    ')))
  .join('\n')
  .trim();
mkdirSync(join(ROOT, 'build'), { recursive: true });
tabs.forEach((t, i) => writeFileSync(join(ROOT, `build/guide-tab-${i + 1}.md`), toDoc(t) + '\n'));
console.log(`${tabs.length} tabs written to build/guide-tab-N.md`);
