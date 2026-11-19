# P15 Rule Replay: build record, 15 November 2026

Published: [P15 Rule Replay](https://claude.ai/artifact/6ytUrUPw3susuHkoDmA7Xr), private to the owner. Source `ui/p15.html`; built with `node scripts/page-build.mjs p15`, which fills the recorded replays from the world and inlines the agent kit.

A plain retailer screen with no agent (replay is fixed logic and Jordan Ellis decides; registry verdict, CALLS 87). Northfield's connector: `list_draft_rules`, `replay_draft_rule`, `publish_rule`, `ask_aviator`. The page holds no key.

| Click | What changes | Beat |
| --- | --- | --- |
| Replay against the quarter | Failing now, failing with the draft, added exposure and the supplier table appear | Turn |
| Publish to suppliers | `publish_rule` records the publish request for Jordan Ellis's approval; the bar shows that state | Result |
| Next draft in the queue | NFD-2 opens | Problem, next record |

Optional: Try another value replays a changed value; publishing then waits for a replay of the draft as written.

Checks run: `node scripts/kit-check.mjs build/pages/p15/index.html --retailer` (all pass) and `node scripts/walk-p15.mjs` (all pass). With no connector the recorded replay shows under Simulated, and Publish sends nothing and says so. Live: Northfield's connector returned the same replay for NFD-1 (32 failing now, 541 with the draft, $76,350) on 15 November. Screenshots: `open.png`, `replayed.png`.

User stories (Prototype specs, P15): 1 drafts exist as draft rules, no live document affected; 2 every figure comes from `replay_draft_rule`; 3 `publish_rule` refuses a draft with no replay (smoke); 4 Ashby never sees a draft (smoke, isolation).
