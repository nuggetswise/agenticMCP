# TG for Retail demo world and MCP server

One fictional quarter of trade between Ashby Supplier and Northfield Retailer, behind every TG for Retail prototype. All data is fictional. Identifiers use the GS1 example prefix 0614141.

## How it works

1. `world/` generates the quarter (27 September to 26 December 2026, settlement to 6 January 2027) as X12 004010 interchanges in `build/x12/`.
2. The same parser reads the files back; every database row is derived from the parsed documents (`world/build.js`). Records that never travel as EDI are stored as events.
3. `src/server.js` serves one read-only connection for Ashby over MCP (`/mcp/<token>`) and REST (`/api/<token>/v1/...`, described by `/openapi.json`). Both come from `src/tools.js`.
4. Questions are answered as of a time (`as_of`); the default is the story clock, Tuesday 17 November 2026 11:00 Eastern (`STORY_CLOCK`).
5. `WRITES=on` turns `request_change` into approval-gated proposals; approval appends an event, reset returns to baseline. Off in this release.

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
