// Expected answers from SQL alone, on the built Ashby copy (same world as the live server).
import { DatabaseSync } from 'node:sqlite'; import fs from 'fs';
const db = new DatabaseSync(process.argv[2] || 'build/ashby.db');
const Q = JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url)));
const out = Object.fromEntries(Q.map((q) => [q.id, db.prepare(q.sql).all()]));
fs.writeFileSync(new URL('./expected.json', import.meta.url), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out));
