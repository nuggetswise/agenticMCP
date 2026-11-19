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

- `/p/<id>` serves `pages/<id>.html` (noindex; `robots.txt` disallows `/p/`). These pages are the prototypes; the build chat owns `pages/<id>.html` on its own branch. `npm run pages` checks every page in `pages/` against `pages/pages.json` (see `scripts/pages.mjs`).
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

### 0.4.3

- Claude artifacts are retired: the prototypes are the pages at `/p/<id>`. `pages.json` holds no artifact field, `npm run pages` checks whatever is in `pages/`, and `npm run contract` reads `pages/<id>.html` (a prototype with no page is Not assessed).
- Aviator is a chatbot with action cards (`src/actions.js`). Asked to act, it returns a card the server builds from the side's rules and records, inside the side's P21 permissions; nothing happens until the person presses Approve (`POST /aviator/<token>/cards/<card>`, `decision` approve or cancel). The card id is the idempotency key. Cards cover a dispute, a held ship notice release, the 855, 865, 856 and 810, the 997 with the corrected invoice that answers an 824, Northfield's 824 (each error coded, TED02 at most 60 characters, NTE as the guide allows), a charge decision, a readiness chargeback and a rule publish. A request to email, call or instruct anyone, or to change another company's system, is answered as done outside Trading Grid, with the owner and the place, and no card.
- Viewer sessions (`src/session.js`): each viewer gets a private branch of the world for 30 minutes idle, shared across both sides of a switcher page. Card writes are tagged to the session; other viewers and the recorded world never change. `/public/...` reads take `session`.
- Trading Grid writes into no system of record: accepting a charge, matching a repayment, creating a sales order and creating an invoice are Ashby's own steps in the Supplier ERP, shown as owner fixes; their records arrive from the Supplier ERP.
- New write tools on the connections: `send_document` (Ashby), `send_application_advice` and `decide_chargeback` (Northfield). Each company's access log includes its public-route and hosted-page calls. "Edit suggestion" is removed (0.4.4).

### 0.4.4

- Take over is gone. A rule decision is Approve or Reject; an Aviator card is Approve or Cancel. There is no third choice in the server, the tools, the runtimes or the tests.
- Aviator no longer gates on keywords. The model decides whether the person asked for an action ("fix the invoice", "sort this out", "can you handle it") and calls `propose_action`; the server still checks the P21 permission, refuses anything outside Trading Grid, builds the card from rules and records, and writes nothing until Approve. Ashby asking to send an 824 still gets the 997 and the corrected resend.
- A message to the other company that a Trading Grid record carries is not refused. Northfield's application advice carries it (TED02 up to 60 characters, else an NTE note up to 80); Ashby's dispute carries it as a note. "Tell", "message" or "ask" a party with no such record named is still answered as done outside Trading Grid, with the owner.
- Session views: a card's 810, 856 or 824 adds its invoice, shipment and error rows to the viewer's session (TEMP tables shadowing `invoices`, `invoice_lines`, `shipments`, `shipment_lines`, `errors`), so every calculated view sees it in that session only. `three_way_match` lists the application advice sent against the order's invoices.
- Rules: NF-1.8 records Northfield's 824 error codes (QTY, TTL, IID, LOC, CTN, TOT, UOM, DTE) as invented for this world, and the codes carry basis invented. NF-11.1 states that a draft rule is published only after its replay; the publish card cites it.

### 0.4.5

- An 824 carries the person's words. When a request gives a message ("tell Ashby they billed more cases than received"), it goes in TED02 of each error it concerns (the line it names, or the errors it describes: billed above received or shipped, price, total), and that error's rule cause moves to a note (NTE). Words over 60 characters go in a note of at most 80; longer is refused. The person's words win over any message the model drafts.
- Words that name a line the rules do not find in error are refused; the card for the line the rules found is offered instead, with the line number corrected in the message (`offered_instead` on the card).
- Aviator's answer is checked against the cards it raised before it is returned: quoted phrases and lines must be on a card, it may not say the action is done, and it may not claim a message the card does not carry. Otherwise the answer is the card's own description (`answer_from`: model, card or server).
- A card's sentence names no error codes, rule codes, X12 set numbers or Trading Grid reference numbers (application advice, acknowledgment and draft ids).
- PRC, STO and PCK are invented too; NF-1.8 lists all eleven 824 codes.
- In a session, Ashby's corrected invoice marks the 824's open errors Corrected and the original invoice "Replaced by …", as session overlay rows; recorded rows and other viewers are unchanged.
- Deleted: `ui/`, the kit and walk scripts, `scripts/page-build.mjs`, and the docs that described Take over or Edit suggestion. The build guide's R15 and D58 now read Approve or Reject, and Approve or Cancel for a card.

### 0.4.6

- Every word a viewer reads in Aviator's chat is written by Gemini from tool results. The server never writes or substitutes an answer: `answer_from` is always `model`, and `answer_replaced_because` is gone.
- The server still checks each answer against the cards and the records (codes, quoted phrases, lines, amounts, "done" claims, a card's message word for word, a refused line, an owner outside Trading Grid). On a mismatch it sends the model the reasons and it answers again, up to twice; then the page gets `error: no_answer` ("Aviator couldn't answer that. Try again.").
- Outside Trading Grid: the guard stays (propose_action is not offered, so no card can be raised); the model writes the reply from the owner and the place, which the response also carries as `outside_trading_grid`.
- Cards are data: `label`, `to`, `record`, `po`, `lines`, `detail`, `rule {owner, text}`, `message {text, in, lines}`, `approver`, `buttons`, `state`, `x12`, `offered_instead`. No `says`.
- A line the rules do not find is refused; the card for the line they found is raised with no message, and the person's words are never changed.
- Every refusal on the hosted routes is an error code, never a sentence.
- Limits: 20 Aviator questions a minute per address, no daily per-address limit, a model cap of 3,000 calls a day, and a forbidden (403) key also moves to the secondary route.
- Retired docs moved to `docs/archive/` (see its README). The guide scripts are deleted and the build gate reads no doc.
- P22, P23 and P24 are registered in `pages/pages.json`.

### 0.4.7

- Aviator's instruction names the action each side's ordinary requests call for (for Ashby, a rejected invoice is answered with the technical acknowledgment and the corrected invoice), and says never to answer a request to act with an explanation alone. Live on 0.4.6, Gemini explained instead of proposing for Ashby's "fix the invoice".
- `scripts/live-proof.mjs` proves the per-minute limit over one kept-alive connection, because this workspace leaves through a large pool of rotating egress addresses (70 distinct in 150 requests).

### 0.4.8

- Invented records: the answer check refuses any record reference that no tool call returned in that turn (live on 0.4.7, "Why is INV-7731 held?" cited REC-450118 and REC-450118-1, which do not exist), and the model answers again with that reason. `read` lists every record the tools returned in the turn.
- no_answer on "Reject INV-7731 line 3 and tell Ashby it is overbilled" (2 of 3 live on 0.4.7). The access log showed the cause: the check "It names line 3, which is on no card." The line was in the request, not in the message words, so the server built the card for lines 1 and 2 carrying the message and Gemini rightly said line 3 is not in error. Now a line the person names anywhere in the request is taken with the message: a named line the rules find no error on (or that the document does not have) is refused, the card is for the lines the rules found with no message, and the card's `offered_instead` gives `asked_lines`, `lines` and `missing`. The check is unchanged.
- The access log records the cause of every no_answer (`cause`: check_failed, model_error, key_limit, timeout, too_many_steps) and the checks that failed, by id and text; the error response carries `cause` and the check ids.
- `scripts/live-ten.mjs` proves both live, ten asks each.
