# TG for Retail prototype programme · resume handoff

State as of 14 November 2026, 01:45 UTC. A new chat in this project picks this file up when the owner says to continue. The rest is the state that chat needs. This file is the only handoff; do not create another.

## Start prompt

You are continuing the TG for Retail prototype programme for Mandip (Industry Principal PM, Retail/CPG). Read `claude/TG-for-Retail-Phase-1-Prompt.md` and resume from "Work order". The owner has delegated open decisions to the builder: take the pragmatic, professional call, log it in CALLS, and ask only when a call cannot be undone. Ask for push access to `github.com/nuggetswise/agenticMCP`, clone it (`--depth=200` fetches all of it), run the gate, confirm the counts match this file, then start. Work down the list in one chat without prompting the owner, committing and pushing after each item and refreshing the Build Guide doc and this file as you go; stop only when blocked or when the chat is too long to work reliably. Report only what changed, what was verified, and what failed.

**How to report to the owner.** He does not remember the guide's reference codes. In chat, never use task, decision, rule or CALLS codes (T2.3, D35, R05, CALLS 79 and the like). Name the thing in plain words: "the agent governance work", "the rule that builders don't re-mine Northstar". Prototype numbers are fine only with their name ("P13 Silent order watch"). Give specific counts and names, not summaries.

## Verified state

Repo `github.com/nuggetswise/agenticMCP`, branch main, HEAD `82579b2`. Build Guide as-of commit is `196aaef`; it must move in both places in `docs/build-guide.md` when behaviour changes (guide-check counts `src/`, `world/`, `scripts/` and `registry/`). A cited commit hash must contain a letter: if a new commit's short hash is all digits, amend it before citing. The Build Guide Claude Doc `5fb2Z4j5jAZeTdMpjkQSvJ` matches the repo guide at HEAD.

Gate, all passing: `npm run build` 389 checks, `npm run smoke` 56, `npm run aviator-test` 11, `npm run validate`, `python3 -I validator/botscheck.py <bots-grammars>` (clone `https://github.com/bots-edi/bots-grammars` into `/tmp/ext/`; commit 6c1d8a5), `node scripts/guide-check.mjs`. Needs Node 22 or later. `npm run contract` needs screens saved to `contract/screens/<id>.html`; it fails on every screen, as Phase 4 expects.

Render service `tg-retail-demo-mcp` (id `srv-dbqth3jrjlhs73cbte8g`, workspace `tea-d19i7r2li9vc73822nqg`): deploy `dep-dbrrfgm1egvs73c1lvmg` at `639a15a` (server code identical to HEAD; confirm it went live). A push starts no deploy; trigger one through the Render connector after a push that changes `src/` or `world/`. `/healthz` reports 0.3.0, writes on, Aviator on.

## Decisions taken under the owner's delegation (CALLS 79, do not reopen)

The six Prototype Plan suggestions are accepted. Change list 2 point 1 is approved. No extra weeks of store sales. Writes stay on. Ashby's `get_order` and `check_deliveries` answer as of a time throughout. T3.2 depends on T2.3's built parts, not its golden questions.

Added 14 November (log as CALLS 80 in the first commit): three Northstar candidates become prototype specs of their own, retailer side, on the shared world: Retailer ship notice chase (Northfield chases missing or late ship notices across all suppliers before the goods reach the DC; absorbs the "receiving cannot anticipate late loads" flow), Buyer's daily exception queue (one ranked queue of a Northfield buyer's urgent decisions across suppliers, with order trace and connection health as drill-downs), and Supplier delivery attribution (Northfield attributes poor delivery to supplier, carrier or its own DC from shared records; distinct from P7, which is supplier-side). Agent governance stays inside every agent prototype, not standalone. The two Northstar onboarding flows stay parked with P2.

## Parked by the owner: do not work on these until he says

Aviator and connector testing: the second golden round (`docs/phase0/golden/t03-r2/`, CALLS 73), T2.10's test page (slug `4b066d69-567e-4536-8ae2-765e962a68df`), T2.11, T2.9, and T2.3's governance golden questions.

## Held by the owner: do not touch

P1, P2 and P4 (D48), and every task serving them: T0.10, T0.11, T0.12, T1.7, T4.10, T4.11, T4.12, and their parts of T0.3 and T4.5. P2 is off limits: never propose work for it or fold anything into it.

## Work order

Small commits; full gate before each push; each judgement call logged in `docs/build-log/CALLS.md` (79 entries exist, next is 80).

1. Apply change list 2 point 1 (`docs/phase1/change-list-2.md`): RCV-46215 to 18 November 11:30 ET with `numAt` keeping its control number, its 997 with it, and a gate check that no receipt precedes its ship notice. Rerun both validators and commit their reports. Then close T3.1.
2. Decision 4 of CALLS 79: `get_order` and `check_deliveries` hide records after `as_of` (default the story clock), as Northfield's trail does. Re-baseline any gate, smoke or golden figure that moves, in the same commit, and deploy.
3. README: writes are on in this release (decision 3).
4. T2.8: copy the Prototype Plan doc into `docs/prototype-plan.md` as a dated snapshot, now that its six suggestions are accepted.
5. Write the three promoted specs (above) into the guide's Prototype specs tab in the P14/P15 format (seen by, agent or tool verdict, entry, tools, anchor, user stories with acceptance, world gaps), and check each against the world as T3.1 did; world gaps go to a change list.
6. T2.3, stories 1, 2 and 4 (access log fields on every write; pause and override; the trial, drift and rollback record).
7. T3.2: rank P13, P14, P15 and the three promoted specs, place them on the story calendar, and build the top one through the prototype skills (decide the ranking; report it in plain words).
8. Phase 4 in R39 order, P1, P2 and P4 excluded, from `docs/phase4/agent-entry.md` (check AE-SKILL-1 first). Each prototype still needs the owner's go-ahead on its change list before the page is edited; draft change lists, click maps and contract findings freely. T4.16 (P8): the three definitions beside their figures and two label faults. P11's live page runs on PO-104728 and ASN-78452, not PO-104912 and ASN-78260.

## Owner actions outside the chat

Rotate the Gemini key in Render.

## Things that break the build if forgotten

New documents go in through `L.aside()`. A document sent later than first planned takes `numAt`. History documents take control numbers below 1001. `normPo` keeps the `PO-<digits>` form. The guide may not contain numbers of four or more digits other than 0614141, 2026 and 2027, and may not repeat an eight-word passage. Proof counts in the guide must match a fresh run. Backticked lower-case snake_case names in the guide must be real tools or gate checks. No charge exists for a late ship notice. In Claude Docs, resend edited blocks as markdown or code formatting is lost. The Prototype Plan Claude Doc `Ux8ZjNd7BTj6mdH7e5rJ2S` carries a stale artifact title the docs tools cannot change.

## Standing rules

All data fictional. A 997 is never business acceptance. Write Trading Grid Catalogue or TGC, never AC. Never name OpenText colleagues in any artifact. Never open internal OpenText links. Do not use the Lucid connector. No new project docs; evidence goes in the repo. No key or token in any page, project doc or the repo. Separate verified findings from assumptions in every report. New use cases come from the Prototype specs tab; mining the Northstar teardown again is a planning task, not a builder task.
