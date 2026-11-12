import { DatabaseSync } from 'node:sqlite'; import fs from 'fs';
const db = new DatabaseSync(process.argv[2] || 'build/northfield.db', { readOnly: true });
const Q = JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url)));
const out = Object.fromEntries(Q.map((q) => [q.id, db.prepare(q.sql).all().map((r) => ({ ...r }))]));
fs.writeFileSync(new URL('./expected.json', import.meta.url), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
