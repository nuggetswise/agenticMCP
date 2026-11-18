# TG for Retail demo world and MCP server

One fictional quarter of trade between Ashby Supplier and Northfield Retailer, behind every TG for Retail prototype. All data is fictional. Identifiers use the GS1 example prefix 0614141.

## How it works

1. `world/` generates the quarter (27 September to 26 December 2026, settlement to 6 January 2027) as X12 004010 interchanges in `build/x12/`.
2. The same parser reads the files back; every database row is derived from the parsed documents (`world/build.js`). Records that never travel as EDI are stored as events.
3. `src/server.js` serves one read-only connection for Ashby over MCP (`/mcp/<token>`) and REST (`/api/<token>/v1/...`, described by `/openapi.json`). Both come from `src/tools.js`.
4. Questions are answered as of a time (`as_of`); the default is the story clock, Tuesday 17 November 2026 11:00 Eastern (`STORY_CLOCK`).
5. `WRITES=on` turns the write tools (`submit_dispute`, `release_ship_notice`, `decide_charge`, `publish_rule`) into approval-gated proposals; approval appends an event, reset returns to baseline. There is no general request tool: Trading Grid sends only business documents and opens records in its own workflows, and a fix that belongs to the owner of a record is shown with who owns it and where it is fixed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the world, the OpenAPI draft, and runs the gate. Render runs this; a failure stops the deploy. |
| `npm run check` | Invariants, fixed values, agent decision tests, registry and document sync |
| `npm run validate` | Independent X12 check with StAEDI (needs Java). Records `validator/report.json` with a hash of the X12 files; the gate fails if the build's files do not match it. Run after any change to the world. |
| `npm run contract` | Diffs built prototype screens against the world. Put screen sources in `contract/screens/<id>.html` or set `SCREENS`. |
| `npm run smoke` | Starts the server and checks it through an MCP client |
| `npm run names` | Starts the server, calls every tool on both connections and fails if any result, title, description or instruction names an agent |
| `npm start` | Runs the server (`MCP_TOKEN`, `PORT`) |

## Files that must agree

`registry/registry.json` lists each prototype's calendar moment, agent job, decision records, tools, anchor records, acceptance tests, capability status and owner. `docs/` holds text copies of the three working documents. The gate fails when the registry, the server's tools or a document copy disagree. After editing a working document, export it again into `docs/`.

## Rules, not agents

No tool response names an agent. A finding carries `found_by` with the rule that found it ("Northfield matching rule NF-7.8"), and a rule runtime is named by its rule set ("Ashby's evidence rules") and its short name (`claim`). The runtimes keep their internal names in code; `src/credit.js` turns them into what a connection reads and is applied to every result, description and REST answer. Tool names (`pause_agent`, `set_agent_mode`, `replay_agent_rule`) stay; their `agent` argument takes the short name, the rule set or the old name. Every dispute needs Priya Raman's approval (AP-4.1 holds no amount).

The story calendar (`CALENDAR` in `world/build.js`) mirrors the "Story calendar" table in the Shared context of the prototype build prompts: same rows, same order (supply chain stage, not date).

## What is invented

The rule catalogue (`world/ref.js`) marks each rule public, adapted or invented and carries its sources. The validator schemas (`validator/make-schemas.js`) take element types and lengths from X12 004010; which segments are mandatory is the invented Northfield guide. `validator/staedi.jar` is StAEDI 1.26.7 from Maven Central (Apache 2.0).

## Hosted pages, Aviator for pages and the public read route (0.4.0)

- `/p/<id>` serves `pages/<id>.html` (noindex; `robots.txt` disallows `/p/`). A claude.ai artifact cannot call this server, so the hosted copy is the link shared with viewers. Sync one page with `npm run sync -- <id> <file> <sha256>` after reading its published artifact; the routine refuses a file whose hash is not the artifact's (see `scripts/pages.mjs`).
- `POST /aviator/<page token>` takes `question`, `side`, `as_of`, `context`, `history`. `pages/pages.json` binds each token to its prototype, sides and story window; anything outside is refused. With no `as_of` the page's calendar moment is used, never the story clock. Replies carry the answer in plain words and the records read by business name. A page token opens nothing else.
- Limits (`src/limits.js`, env `AVIATOR_PER_MINUTE` 6, `AVIATOR_PER_ADDRESS_DAY` 60, `PUBLIC_PER_MINUTE` 120, `MODEL_DAILY_CAP` 600): per-address rate limits and one daily cap on every model call, each with a plain message. Questions are capped at 500 characters and history at 10 turns.
- `/public/<side>/tools/<name>`: read tools only, with that side's scopes and refusals, logged as `public-<side>`. Writes, governance, sessions, SQL and the access log are refused.
- `npm run hosted` tests all of this from `pages/_test.html` in Chrome with a local stand-in model.

### 0.4.1

- Periods resolve from `as_of`. `get_scorecard`, `supplier_scorecard` and the new Northfield tool `open_order_value` take `from` and `to` (dates) or `period` (`this_week`, `last_week`, `next_week`; weeks run Sunday to Saturday) and return `period_covered`. `get_scorecard` also takes `warehouse` and lists failing lines by warehouse.
- A hosted Aviator question that names a week or dates is resolved on the server and checked: an answer that read a different period is asked again on the secondary model, and refused if that also misses.
- Every Kinross shipping advice (945) reports the quantity picked and loaded, as its load scan and ship notice do.
- Page tokens for P7 and P8 are in `pages/pages.json`. Window ends (`through`) stay open until the build chat states them.

### 0.4.2

- Trading Grid sends only business documents. `request_change` is gone from both connections. Every runtime step that sent a request, task, note or email to Kinross, Lakeline, Ashby's desks or Northfield now shows what is wrong, who owns it and where it is fixed, with no Approve; the owner's next record confirms the fix. Northfield's correction request is the application advice (EDI 824) Jordan Ellis approves, and a ship notice the carrier contradicts is rejected with an 824. Aviator's order-change permissions are the 865 change acknowledgment (Ashby) and the 860 order change (Northfield).
- The per-address limits key on the viewer: `CF-Connecting-IP` behind Render's Cloudflare edge, the socket address otherwise. X-Forwarded-For is never read for a limit.
- `three_way_match` reads the remittance that paid an invoice or the invoice that replaced it, as of the moment, and names the settlement; a missing reference is refused in plain words.
- Aviator answers name a rule set without its code ("Northfield's matching rule"), and the records read list only records.
