"""Independent X12 check: every document in the world against bots-grammars, schemas this repo did not write.

Usage: python3 -I validator/botscheck.py <bots-grammars checkout> [build/tg.db] [validator/bots-report.json]
Get the grammars with: git clone --depth 1 https://github.com/bots-edi/bots-grammars
The grammars are data (Python literals); bots itself is not needed. A stub stands in for bots.botsconfig.

Checks per transaction set, using x12/4010 grammars:
  structure  segment order and repeats against the grammar's nested structure (MIN, MAX, LEVEL)
  records    every element against its record definition: mandatory, length, format (N, R, DT, TM, ID/AN), element count
  envelope   SE01 equals the segments from ST to SE; SE02 equals ST02
Then the documents the world says Northfield rejected on a technical acknowledgment (997) must all fault,
and a set of injected faults must each be rejected for the stated reason.
"""
import json, os, re, sqlite3, sys, types, datetime, importlib.util, hashlib

GRAMMARS, DB, OUT = (sys.argv[1:] + [None, None, None])[:3]
DB = DB or 'build/tg.db'
OUT = OUT or 'validator/bots-report.json'
DIR = os.path.join(GRAMMARS, 'x12', '4010')

# stub for bots.botsconfig: the grammar files only use these four names
bots = types.ModuleType('bots'); cfg = types.ModuleType('bots.botsconfig')
for n in ('ID', 'MIN', 'MAX', 'LEVEL'): setattr(cfg, n, n)
cfg.__all__ = ['ID', 'MIN', 'MAX', 'LEVEL']
bots.botsconfig = cfg; sys.modules['bots'] = bots; sys.modules['bots.botsconfig'] = cfg

def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(DIR, name + '.py'))
    m = importlib.util.module_from_spec(spec); sys.modules[name] = m; spec.loader.exec_module(m); return m

RECORDS = load('records004010').recorddefs
_struct = {}
def structure(ts):
    if ts not in _struct: _struct[ts] = load(ts + '004010').structure
    return _struct[ts]

def check_value(v, name, length, fmt):
    if isinstance(length, tuple): lo, hi = length
    else: lo, hi = 1, length
    if fmt.startswith('N') or fmt == 'R':
        digits = re.sub(r'[-.]', '', v)
        if not re.fullmatch(r'-?\d*\.?\d*', v) or not digits: return f'{name} not numeric'
        if fmt.startswith('N') and '.' in v: return f'{name} has a decimal point in an implied-decimal field'
        n = len(digits)
    elif fmt == 'DT':
        if not re.fullmatch(r'\d{6}|\d{8}', v): return f'{name} invalid date'
        try: datetime.datetime.strptime(v, '%Y%m%d' if len(v) == 8 else '%y%m%d')
        except ValueError: return f'{name} invalid date'
        n = len(v)
    elif fmt == 'TM':
        if not re.fullmatch(r'\d{4}|\d{6}|\d{7,8}', v) or int(v[:2]) > 23 or int(v[2:4]) > 59: return f'{name} invalid time'
        n = len(v)
    else: n = len(v)
    if n > hi: return f'{name} too long ({n} > {hi})'
    if n < lo: return f'{name} too short ({n} < {lo})'
    return None

def check_record(seg, comp):
    tag = seg[0]; defs = RECORDS.get(tag)
    if defs is None: return [f'{tag} unknown segment']
    fields = defs[1:]; errs = []
    if len(seg) - 1 > len(fields): errs.append(f'{tag} has {len(seg)-1} elements, {len(fields)} allowed')
    for i, f in enumerate(fields):
        v = seg[i + 1] if i + 1 < len(seg) else ''
        name, req, length = f[0], f[1], f[2]
        if v == '':
            if req == 'M': errs.append(f'{name} mandatory, missing')
            continue
        if isinstance(length, list):
            parts = v.split(comp)
            for j, sf in enumerate(length):
                pv = parts[j] if j < len(parts) else ''
                if pv == '':
                    if sf[1] == 'M': errs.append(f'{sf[0]} mandatory, missing')
                    continue
                e = check_value(pv, sf[0], sf[2], sf[3])
                if e: errs.append(e)
        else:
            e = check_value(v, name, length, f[3])
            if e: errs.append(e)
    return errs

def walk(entries, segs, i, errs):
    for ent in entries:
        count = 0
        while i < len(segs) and segs[i][0] == ent['ID'] and count < ent['MAX']:
            i += 1; count += 1
            if 'LEVEL' in ent: i = walk(ent['LEVEL'], segs, i, errs)
        if count < ent['MIN']: errs.append(f"{ent['ID']} required, missing at segment {i + 1}")
    return i

def check_set(segs, comp):
    errs = []
    ts = segs[0][1] if segs and segs[0][0] == 'ST' and len(segs[0]) > 1 else None
    if not ts: return None, ['no ST']
    try: st = structure(ts)
    except FileNotFoundError: return ts, [f'no grammar for {ts}']
    end = walk(st, segs, 0, errs)
    if end < len(segs): errs.append(f'{segs[end][0]} not allowed at segment {end + 1}')
    for s in segs: errs += check_record(s, comp)
    se = segs[-1]
    if se[0] == 'SE':
        if len(se) > 1 and se[1] != str(len(segs)): errs.append(f'SE01 says {se[1]} segments, set has {len(segs)}')
        if len(se) > 2 and segs[0][2] != se[2]: errs.append('SE02 differs from ST02')
    return ts, errs

def sets_in(raw):
    raw = raw.strip()
    if not raw.startswith('ISA') or len(raw) < 106: return [], '>'
    el, comp, term = raw[3], raw[104], raw[105]
    segs = [s.strip() for s in raw.split(term) if s.strip()]
    out, cur = [], None
    for s in segs:
        p = s.split(el)
        if p[0] == 'ST': cur = [p]
        elif cur is not None:
            cur.append(p)
            if p[0] == 'SE': out.append(cur); cur = None
    return out, comp

def run(raw):
    sets, comp = sets_in(raw)
    if not sets: return [('?', ['no transaction set in interchange'])]
    return [check_set(s, comp) for s in sets]

db = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
docs = db.execute('SELECT doc_id, doc_type, raw FROM documents WHERE raw IS NOT NULL ORDER BY doc_id').fetchall()
rejected_997 = {r[0] for r in db.execute("SELECT doc_id FROM errors WHERE channel LIKE '%997%'")}
faults, sets_checked, by_reason = {}, 0, {}
for doc_id, dtype, raw in docs:
    for ts, errs in run(raw):
        sets_checked += 1
        if errs:
            faults.setdefault(doc_id, []).extend(errs)
            for e in errs:
                k = re.sub(r'\d+', 'n', e); by_reason[k] = by_reason.get(k, 0) + 1

missed = sorted(rejected_997 - set(faults))
extra = sorted(set(faults) - rejected_997)

# Injected faults on one clean ship notice, each with the reason it must be rejected for
clean_id, clean = next((d, r) for d, t, r in docs if t == '856' and d not in faults)
el = clean[3]; term = clean[105]
def mutate(fn):
    segs = [s for s in clean.strip().split(term) if s.strip()]
    return term.join(fn(segs)) + term
def edit(tag, idx, val):
    def f(segs):
        out = []
        for s in segs:
            p = s.strip().split(el)
            if p[0] == tag and idx < len(p) and val is not None: p[idx] = val; val_ = None
            out.append(el.join(p))
        return out
    return f
def first(tag, fn):
    def f(segs):
        out, done = [], False
        for s in segs:
            p = s.strip().split(el)
            if p[0] == tag and not done: p = fn(p); done = True
            if p is not None: out.append(el.join(p))
        return out
    return f
INJ = [
    ('PO reference too long', first('PRF', lambda p: p[:1] + ['NR-449999-ASHBY-WHSL-REL-02'] + p[2:]), 'PRF01 too long'),
    ('Invalid ship date', first('BSN', lambda p: p[:3] + ['20261340'] + p[4:]), 'BSN03 invalid date'),
    ('Invalid ship time', first('BSN', lambda p: p[:4] + ['2575'] + p[5:]), 'BSN04 invalid time'),
    ('Missing BSN', first('BSN', lambda p: None), 'BSN required, missing'),
    ('Wrong segment count', first('SE', lambda p: [p[0], str(int(p[1]) + 1)] + p[2:]), 'SE01 says'),
    ('SE control number differs', first('SE', lambda p: p[:2] + ['9999']), 'SE02 differs'),
    ('Unknown segment', lambda segs: segs[:4] + ['ZZZ' + el + '1'] + segs[4:], 'ZZZ unknown segment'),
    ('Ship-to name too long', first('N1', lambda p: p[:2] + ['N' * 61] + p[3:]), 'N102 too long'),
    ('Non-numeric quantity', first('SN1', lambda p: p[:2] + ['12A'] + p[3:]), 'SN102 not numeric'),
    ('Too many elements', first('BSN', lambda p: p + [''] * 0 + ['X'] * 8), 'BSN has'),
]
injected = []
for name, fn, reason in INJ:
    raw = mutate(fn); errs = [e for _, es in run(raw) for e in es]
    hit = any(e.startswith(reason) for e in errs)
    injected.append({'fault': name, 'expected': reason, 'rejected_for_it': hit, 'errors': errs[:4]})

report = {
    'checked': datetime.date.today().isoformat(),
    'grammars': {'source': 'github.com/bots-edi/bots-grammars', 'path': 'x12/4010',
                 'commit': os.popen(f'git -C {GRAMMARS} log -1 --format=%h').read().strip()},
    'world_x12_sha256': hashlib.sha256(''.join(r for _, _, r in docs).encode()).hexdigest(),
    'documents': len(docs), 'transaction_sets': sets_checked,
    'documents_with_faults': len(faults),
    'faults_by_reason': dict(sorted(by_reason.items(), key=lambda x: -x[1])),
    'rejected_on_997_in_world': len(rejected_997),
    'rejected_on_997_and_faulted': len(rejected_997 & set(faults)),
    'rejected_on_997_but_clean': missed,
    'faulted_but_not_rejected_on_997': extra[:50],
    'faulted_but_not_rejected_on_997_count': len(extra),
    'injected_on': clean_id,
    'injected': injected,
    'pass': not missed and all(x['rejected_for_it'] for x in injected),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(report, open(OUT, 'w'), indent=1)
print(json.dumps({k: report[k] for k in ('documents', 'transaction_sets', 'documents_with_faults', 'rejected_on_997_in_world', 'rejected_on_997_and_faulted', 'faulted_but_not_rejected_on_997_count', 'pass')}))
for x in injected: print(('PASS ' if x['rejected_for_it'] else 'FAIL ') + x['fault'] + ' -> ' + '; '.join(x['errors'][:2]))
for k, v in list(report['faults_by_reason'].items())[:12]: print(v, k)
sys.exit(0 if report['pass'] else 1)
