// No tool response names an agent (owner decision, 17 November 2026). Pages credit every finding to the rule that found
// it, so the server does too: a finding carries `found_by` with the rule, and a rule runtime is named by its rule set.
//
// The runtimes keep their internal names in code (the keys below, the agent_changes table, session actors). This module
// is the one place those names are turned into what a connection reads, and `present` is applied to every tool result,
// tool description and REST answer on both connections, so a name that slips into a new string is still never sent.
// Tool names (pause_agent, set_agent_mode, replay_agent_rule) and their `agent` argument stay as they are; the argument
// takes the runtime's short name (claim, scout, match…), its rule set, or the old name.

export const RULE_SETS = {
  'Watch Agent': { runtime: 'watch', set: 'Ashby’s document watch rules', one: 'Ashby document watch rule', rule: 'AP-3.4' },
  'Claim Agent': { runtime: 'claim', set: 'Ashby’s evidence rules', one: 'Ashby evidence rule', rule: 'AP-4.1' },
  'Test Agent': { runtime: 'test', set: 'Ashby’s trade test rules', one: 'Ashby trade test rule', rule: 'NF-4.9' },
  'Shelf Agent': { runtime: 'shelf', set: 'Ashby’s replenishment rules', one: 'Ashby replenishment rule', rule: 'AP-6.1' },
  'Scout Agent': { runtime: 'scout', set: 'Ashby’s shipment rules', one: 'Ashby shipment rule', rule: 'AP-3.2' },
  'Pace Agent': { runtime: 'pace', set: 'Ashby’s performance rules', one: 'Ashby performance rule', rule: 'NF-8.2' },
  'Review Agent': { runtime: 'review', set: 'Northfield’s evidence rules', one: 'Northfield evidence rule', rule: 'NF-7.4' },
  'Chase Agent': { runtime: 'chase', set: 'Northfield’s ship notice rules', one: 'Northfield ship notice rule', rule: 'NF-4.2' },
  'Match Agent': { runtime: 'match', set: 'Northfield’s matching rules', one: 'Northfield matching rule', rule: 'NF-7.8' },
};

/** The rule set a runtime runs, as a connection reads it: "Ashby’s evidence rules". */
export const ruleSet = (agent) => RULE_SETS[agent]?.set || agent;
/** The credit for one finding: "Northfield matching rule NF-7.8". `rule` is the rule that found it; default the set's lead rule.
 *  Where Ashby's check applies a rule of Northfield's guide, the credit says whose rule it is. */
export const foundBy = (agent, rule) => { const id = rule || RULE_SETS[agent].rule; return /^Ashby/.test(RULE_SETS[agent].set) && /^NF-/.test(id) ? `Northfield guide rule ${id}` : `${RULE_SETS[agent].one} ${id}`; };
/** The internal name for what a caller passed as `agent`: a short name (claim), a rule set, or the old name. */
export function runtimeOf(name) {
  const k = String(name || '').trim().toLowerCase().replace(/'/g, '’'); if (!k) return null;
  return Object.keys(RULE_SETS).find((a) => a.toLowerCase() === k || a.toLowerCase() === `${k} agent` || RULE_SETS[a].runtime === k || RULE_SETS[a].set.toLowerCase() === k) || null;
}

const NAME = new RegExp(`\\b(${Object.keys(RULE_SETS).map((a) => a.split(' ')[0]).join('|')}) Agent\\b(?:(’s|'s)| (is|was|has|does|proposes|works|uses|decides|checks|reads|recommends|suggests|explains|drafts|continues|waits|finishes|investigates|disputes|sends|names|finds)\\b)?`, 'g');
const PLURAL = { is: 'are', was: 'were', has: 'have', does: 'do' };
// Sentences written about a model run: said plainly, since a rule set neither "cannot run" nor "says" anything.
const N = '(?:[A-Z][a-z]+ Agent)';
const PHRASES = [
  [new RegExp(`No model is configured on this server; ${N} cannot run\\.`, 'g'), 'No model is configured on this server, so only the rule baseline runs.'],
  [new RegExp(`(Not measured: )?${N} did not run`, 'g'), (m, nm) => `${nm || ''}${nm ? 'the' : 'The'} model did not run`],
  [new RegExp(`also taken by ${N}`, 'g'), 'also taken by the model run'],
  [new RegExp(`${N} said`, 'g'), 'Model said'],
  [new RegExp(`(${N}) may only (suggest|propose)`, 'g'), (m, a, v) => `${a} only ${v}`],
  [new RegExp(`(${N}) only recommends`, 'g'), (m, a) => `${a} only recommend`],
  [new RegExp(`(${N}) has one action: (\\w+)\\. It drafts`, 'g'), (m, a, x) => `${a} have one action: ${x}. They draft`], [/They draft no plan or task and sends nothing/g, 'They draft no plan or task and send nothing'],
  [/by the agent only/g, 'by the model only'], [/Open findings the agent has not answered/g, 'Open findings not yet answered'], [/\bthe agent’s overhead/g, 'the model’s overhead'], [/\bagent overhead\b/g, 'model overhead'],
  [new RegExp(`(${N}) setup: `, 'g'), (m, a) => `Setup of ${a}: `],
];
const text = (s0) => PHRASES.reduce((s, [re, to]) => s.replace(re, to), s0).replace(NAME, (m, n, poss, verb) => { const set = RULE_SETS[`${n} Agent`].set; return poss ? `${set}’` : verb ? `${set} ${PLURAL[verb] || verb.replace(/(sh|ch)es$/, '$1').replace(/s$/, '')}` : set; });
const KEYS = { agents: 'rule_sets', agent_state: 'rules_state', review_agent: 'recommendation', review_agent_recommended: 'rules_recommended', agent_only: 'model_only' };

/** What a connection reads: no agent named in any value, and no key that calls a rule set an agent. */
export function present(v) {
  if (typeof v === 'string') return text(v);
  if (Array.isArray(v)) return v.map(present);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'agent') {
      if (typeof x === 'string' && RULE_SETS[x]) { o.rules = RULE_SETS[x].set; o.runtime = RULE_SETS[x].runtime; }
      else if (x && typeof x === 'object') o.model_run = present(x); // a governance replay's second run, beside the rule baseline
      else if (x != null) o.proposed_by = present(x); // an access-log attribution: a person's assistant, the rule baseline
    } else o[KEYS[k] || (/agent/i.test(k) ? k.replace(/agents?/gi, 'rules') : k)] = present(x);
  }
  return o;
}
