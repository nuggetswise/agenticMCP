// Protects the model key behind the public pages: a per-address rate limit per minute on each public route, and one daily
// cap on calls that reach the model (Aviator and the agent runtimes share it). There is no per-address daily limit. Hosted
// pages get error codes, never sentences. Counters live in memory and reset when the server restarts or the day (UTC) turns.

const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const LIMITS = {
  aviator_per_minute: num(process.env.AVIATOR_PER_MINUTE, 20),
  public_per_minute: num(process.env.PUBLIC_PER_MINUTE, 120),
  model_calls_per_day: num(process.env.MODEL_DAILY_CAP, 3000),
};

// Only the connected-assistant tools (ask_aviator over MCP) carry this text; hosted pages get the error code daily_cap.
export const MESSAGES = { cap: 'Aviator has reached its daily limit of model calls.' };

const today = () => new Date().toISOString().slice(0, 10);

/** A sliding-window limit per address: `hit(address)` records one request and says whether it is allowed. */
export function windowLimit(max, windowMs) {
  const seen = new Map();
  return {
    hit(addr, now = Date.now()) {
      const from = now - windowMs; const list = (seen.get(addr) || []).filter((t) => t > from);
      if (list.length >= max) { seen.set(addr, list); return { ok: false, retry_after: Math.ceil((list[0] + windowMs - now) / 1000) }; }
      list.push(now); seen.set(addr, list);
      if (seen.size > 5000) for (const [k, v] of seen) if (!v.some((t) => t > from)) seen.delete(k);
      return { ok: true };
    },
    reset() { seen.clear(); },
  };
}

/** The daily cap on model calls, across every route that reaches the model. */
const budget = { day: today(), used: 0 };
export function takeModelCall() {
  if (budget.day !== today()) { budget.day = today(); budget.used = 0; }
  if (budget.used >= LIMITS.model_calls_per_day) return false;
  budget.used += 1; return true;
}
export const modelBudget = () => ({ day: budget.day, used: budget.used, cap: LIMITS.model_calls_per_day });
export const resetModelBudget = () => { budget.day = today(); budget.used = 0; };
export class ModelCapReached extends Error { constructor() { super(MESSAGES.cap); this.cap = true; } }
