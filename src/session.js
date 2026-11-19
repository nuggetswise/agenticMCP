// Viewer sessions for hosted pages (/p/<id>). A session is a private branch of the demo world for one viewer: every write an
// action card makes is tagged to it, every read made for it sees the recorded world plus its own writes, and other viewers and
// the recorded world never change. A switcher page shares one session across both sides, so Jordan sees the dispute Priya
// opened. Sessions live in memory and end after 30 minutes idle, or when the server restarts.
//
// How the branch works. The recorded world sits in main.events, main.documents and main.draft_rules. Session writes go to
// TEMP tables in this connection only. TEMP views named events and documents shadow the main tables for every unqualified
// query: each is the recorded rows plus the rows of the session in force (tg_session()), so the read code needs no change.
// draft_rules reads Published for a draft the session (or the recorded world) published. Calls run synchronously, so the
// session in force is set around one call at a time and never leaks into another viewer's call.
import { randomBytes } from 'node:crypto';

export const IDLE_MS = 30 * 60 * 1000;
export const LIMITS = { per_address: 8, total: 2000, writes: 40, cards: 60 };
let CURRENT = null;
const SESSIONS = new Map();
const SESSION_ID_BASE = 1e12; // session rows never collide with recorded ids
let nextId = SESSION_ID_BASE;

export const SHADOW = ['invoices', 'invoice_lines', 'errors', 'shipments', 'shipment_lines'];
const COLS = {};
// Keyed tables take session overlay rows: a session row with a recorded row's key replaces it for that session only.
const KEY = { invoices: 'invoice', errors: 'error_id' };
const EVENT_COLS = ['id', 'at', 'kind', 'po', 'system', 'party', 'channel', 'data'];
const DOC_COLS = ['doc_id', 'reference', 'po', 'doc_type', 'name', 'sender_id', 'receiver_id', 'supplier_id', 'partner_id', 'sent_at', 'isa_ctl', 'gs_ctl', 'st_ctl', 'status', 'answers_doc_id', 'test', 'file', 'body', 'raw'];

/** Installs the session branch on the server's main connection. Call once, before any statement is prepared. */
export function installSessions(db) {
  db.function('tg_session', { deterministic: false }, () => CURRENT);
  const draftCols = db.prepare("SELECT name FROM pragma_table_info('draft_rules')").all().map((r) => r.name).filter((c) => c !== 'state');
  // The derived tables a card's document changes, so every calculated view (three-way match, scorecards, open-order value,
  // rejections) sees the session's own documents: invoices and their lines, shipments and their lines, and 824 errors.
  for (const t of SHADOW) { const cols = db.prepare(`SELECT name, type FROM pragma_table_info('${t}')`).all(); COLS[t] = cols.map((c) => c.name);
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS session_${t} (${cols.map((c) => `${c.name} ${c.type || 'TEXT'}`).join(', ')}, session_id TEXT NOT NULL);
      ${KEY[t] ? `CREATE INDEX IF NOT EXISTS temp.session_${t}_k ON session_${t} (session_id, ${KEY[t]});` : ''}
      CREATE TEMP VIEW IF NOT EXISTS ${t} AS SELECT ${COLS[t].join(', ')} FROM main.${t} m${KEY[t] ? ` WHERE NOT EXISTS (SELECT 1 FROM temp.session_${t} o WHERE o.session_id = tg_session() AND o.${KEY[t]} = m.${KEY[t]})` : ''}
        UNION ALL SELECT ${COLS[t].join(', ')} FROM temp.session_${t} WHERE session_id = tg_session();`); }
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS session_events (${EVENT_COLS.map((c) => (c === 'id' ? 'id INTEGER PRIMARY KEY' : `${c} TEXT`)).join(', ')}, session_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS temp.session_events_s ON session_events (session_id, po);
    CREATE TEMP TABLE IF NOT EXISTS session_documents (${DOC_COLS.map((c) => `${c} ${['isa_ctl', 'gs_ctl', 'test'].includes(c) ? 'INTEGER' : 'TEXT'}`).join(', ')}, session_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS temp.session_documents_s ON session_documents (session_id, reference);
    CREATE TEMP VIEW IF NOT EXISTS events AS SELECT ${EVENT_COLS.join(', ')} FROM main.events
      UNION ALL SELECT ${EVENT_COLS.join(', ')} FROM temp.session_events WHERE session_id = tg_session();
    CREATE TEMP VIEW IF NOT EXISTS documents AS SELECT ${DOC_COLS.join(', ')} FROM main.documents
      UNION ALL SELECT ${DOC_COLS.join(', ')} FROM temp.session_documents WHERE session_id = tg_session();
    CREATE TEMP VIEW IF NOT EXISTS draft_rules AS SELECT ${draftCols.map((c) => `d.${c}`).join(', ')},
      CASE WHEN EXISTS (SELECT 1 FROM events e WHERE e.kind = 'rule.published' AND json_extract(e.data, '$.draft') = d.id) THEN 'Published' ELSE d.state END AS state
      FROM main.draft_rules d;`);
}

/** Runs fn with the given session in force for every read and write it makes. */
export function withSession(id, fn) { const prev = CURRENT; CURRENT = id || null; try { return fn(); } finally { CURRENT = prev; } }
export const currentSession = () => CURRENT;

/** Appends one event: to the recorded world when no session is in force, otherwise to the session alone. Returns its id. */
export function appendEvent(db, row) {
  if (!CURRENT) return Number(db.prepare(`INSERT INTO main.events (at, kind, po, system, party, channel, data) VALUES (?,?,?,?,?,?,?)`).run(row.at, row.kind, row.po, row.system, row.party, row.channel, row.data).lastInsertRowid);
  const id = ++nextId; db.prepare(`INSERT INTO temp.session_events (${EVENT_COLS.join(', ')}, session_id) VALUES (?,?,?,?,?,?,?,?,?)`).run(id, row.at, row.kind, row.po, row.system, row.party, row.channel, row.data, CURRENT);
  SESSIONS.get(CURRENT)?.writes.push({ kind: 'event', id }); return id;
}
/** Adds one document a card sent: to the viewer's session, or, approved on a company's own connection, to the shared world
 *  (file 'session', removed again by the admin reset). */
export function appendDocument(db, doc) {
  if (!CURRENT) { db.prepare(`INSERT INTO main.documents (${DOC_COLS.join(', ')}) VALUES (${DOC_COLS.map(() => '?').join(',')})`).run(...DOC_COLS.map((c) => doc[c] ?? (c === 'test' ? 0 : null))); return doc.doc_id; }
  db.prepare(`INSERT INTO temp.session_documents (${DOC_COLS.join(', ')}, session_id) VALUES (${DOC_COLS.map(() => '?').join(',')},?)`).run(...DOC_COLS.map((c) => doc[c] ?? (c === 'test' ? 0 : null)), CURRENT);
  SESSIONS.get(CURRENT)?.writes.push({ kind: 'document', id: doc.doc_id }); return doc.doc_id;
}

/** Adds one row to a derived table: to the session in force, or, with no session, to the shared world (removed by the admin reset). */
export function appendRow(db, table, row) {
  if (!SHADOW.includes(table)) throw new Error(`No derived table ${table}`); const cols = COLS[table];
  if (!CURRENT) { db.prepare(`INSERT INTO main.${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null)); return; }
  db.prepare(`INSERT INTO temp.session_${table} (${cols.join(', ')}, session_id) VALUES (${cols.map(() => '?').join(',')},?)`).run(...cols.map((c) => row[c] ?? null), CURRENT);
}

/** Changes a keyed row (an invoice's status, an 824 error's status) for the session in force only: a session row is updated
 *  in place, a recorded row is overlaid by a session copy. With no session in force nothing changes. Returns whether it did. */
export function overlayRow(db, table, key, changes) {
  const k = KEY[table]; if (!k || !CURRENT) return false; const cols = COLS[table];
  const own = db.prepare(`SELECT 1 FROM temp.session_${table} WHERE session_id = ? AND ${k} = ?`).get(CURRENT, key);
  if (own) { const set = Object.keys(changes); db.prepare(`UPDATE temp.session_${table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE session_id = ? AND ${k} = ?`).run(...set.map((c) => changes[c]), CURRENT, key); return true; }
  const row = db.prepare(`SELECT * FROM main.${table} WHERE ${k} = ?`).get(key); if (!row) return false;
  const merged = { ...row, ...changes }; db.prepare(`INSERT INTO temp.session_${table} (${cols.join(', ')}, session_id) VALUES (${cols.map(() => '?').join(',')},?)`).run(...cols.map((c) => merged[c] ?? null), CURRENT); return true;
}

// ---------- The session store ----------
const sweep = (now = Date.now()) => { for (const [id, s] of SESSIONS) if (now - s.last > IDLE_MS) end(null, id); };
function end(db, id) { SESSIONS.delete(id); ENDERS.forEach((f) => f(id)); }
const ENDERS = [];
/** Registers cleanup for an ended session (its TEMP rows). */
export function onEnd(db) { ENDERS.push((id) => { for (const t of ['events', 'documents', ...SHADOW]) db.prepare(`DELETE FROM temp.session_${t} WHERE session_id = ?`).run(id); }); }

/** The viewer's session for this page: the one named if it is live and bound to this page, else a new one. */
export function sessionFor({ id, page, address, now = Date.now() }) {
  sweep(now);
  const s = id && SESSIONS.get(String(id));
  if (s && s.page === page) { s.last = now; return { session: s, created: false }; }
  // A viewer keeps a few sessions at most; the oldest idle one ends first. The store as a whole is capped too.
  const mine = [...SESSIONS.values()].filter((x) => x.address === address).sort((a, b) => a.last - b.last);
  while (mine.length >= LIMITS.per_address) end(null, mine.shift().id);
  while (SESSIONS.size >= LIMITS.total) end(null, [...SESSIONS.values()].sort((a, b) => a.last - b.last)[0].id);
  const ns = { id: `VS-${randomBytes(6).toString('hex')}`, page, address, created: now, last: now, writes: [], cards: new Map() };
  SESSIONS.set(ns.id, ns); return { session: ns, created: true };
}
export const getSession = (id) => { sweep(); return SESSIONS.get(String(id)) || null; };
export const endSession = (id) => end(null, id);
export const sessionCount = () => SESSIONS.size;
export const sessionInfo = (s) => ({ session: s.id, idle_timeout_minutes: IDLE_MS / 60000, writes: s.writes.length, cards: [...s.cards.values()].map((c) => ({ id: c.id, action: c.action, state: c.state })) });
