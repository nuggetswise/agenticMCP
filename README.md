# Trading Grid demo MCP server

A read-only MCP server and seeded database for TG for Retail prototypes. A company's own AI assistant (Claude or any MCP client) connects to it as Ashby Supplier and asks Trading Grid questions about its trade with Northfield Retailer. Every answer links to its order record, and every call is logged.

All data is fictional. GS1 identifiers use the GS1 example company prefix 0614141.

## People

One person per side:

| Person | Company | Role |
| --- | --- | --- |
| Priya Raman | Ashby Supplier | Supplier operations and EDI administrator; the assistant's user |
| Jordan Ellis | Northfield Retailer | Buyer and supplier contact |

Ashby's IT admin is a role, not a named person.

## Deploy on Render (free)

1. In Render, delete any service already created for this repository.
2. New → Blueprint → pick this repository. Render reads `render.yaml`, which sets Node 22, the build and start commands, the health check and a generated `MCP_TOKEN`.
3. After the first deploy, open the service's Environment tab and copy `MCP_TOKEN`.
4. Connector URL: `https://<service>.onrender.com/mcp/<MCP_TOKEN>`
5. Admin page (scopes and access log): `https://<service>.onrender.com/admin/<MCP_TOKEN>`

The build seeds the database and runs the checks; a failed check stops the deploy.

Free tier limits ([Render](https://render.com/docs/free)): the service sleeps after 15 minutes without traffic and takes about a minute to wake, and its disk resets on restart, so the access log clears. Open the connector URL or admin page a few minutes before a demo.

## Connect Claude

Settings → Connectors → Add custom connector → paste the connector URL. No sign-in is needed; the token in the URL is the access key. That is suitable for fictional data only.

## Demo script (P10)

Clock: 2026-11-17 11:00 ET.

1. **Connect.** Show the admin page: four read scopes, read only.
2. "Which Northfield orders need attention today?" → NR-46156 (ship notice rejected, 4 hours left), NR-46142 (acknowledgment not sent, 5 hours), NR-46151 (ship notice not sent, 7 hours), NR-46133 (invoice rejected, 1 day). Each carries the rule, its source and a link.
3. "Why did Northfield reject ASN-46118?" → the PO reference was 26 characters against Northfield's 22-character limit. The same field broke ASN-46124, ASN-46129 (both corrected) and INV-46133 (still open).
4. "Summarize Northfield EDI health for the last 30 days." → 3,412 documents by type, 41 failures, top causes: item not on Northfield's item list (11), ship-to not recognized (6), PO reference over 22 characters (4).
5. Paste Jordan's email and ask the assistant to check it:

   > Subject: Late deliveries
   > Priya, these six POs arrived late at DC 2: NR-46101, NR-46103, NR-46104, NR-46106, NR-46108, NR-46110. Please explain.
   > Jordan Ellis, Northfield Retailer

   → Five on time, NR-46108 one day late (the truck left a day late). The assistant drafts a reply; Priya sends it from her own mail. No Trading Grid record changes.
6. Open the admin page: every call, user, scope, result and record.

Guardrails to show:

- "How do other Northfield suppliers score on rejections?" → Not available to Ashby.
- Untick Retailer rules on the admin page and ask question 2 again: rules read "Scope not granted". Tick it again and they return on the next call.
- "Resend the NR-46133 invoice." → Action not available, with a link to the order record.

## Scenarios

| Scenario | Clock (ET) | Contents |
| --- | --- | --- |
| `p10` (default) | 2026-11-17 11:00 | 30 days of Ashby and Northfield EDI; two other suppliers for the guardrail |
| `p13` | 2026-11-18 09:00 | Five open orders; four required documents missing; one needs nothing because Northfield returns a 997 only |
| `core` | 2026-12-07 09:00 | PO NR-450118 from purchase order to deduction reversal |

Rules follow the Requirements v8 sample world (Northfield MIG); P13 adds the Kinross 945 rule. Set `CLOCK_P10` (ISO time) to move a scenario's clock.

## Tools

All read-only.

| Tool | Scopes |
| --- | --- |
| `orders_needing_attention` | orders, documents (errors and rules add causes and rules) |
| `explain_rejection` | documents, errors (rules adds the rule) |
| `edi_health_summary` | documents (errors adds failures and causes) |
| `check_deliveries` | orders, documents |
| `get_order` | orders (documents and errors add detail) |
| `lookup_retailer_rules` | rules |
| `run_readonly_sql` | all four; runs one SELECT on a copy holding only Ashby's records |
| `compare_with_other_suppliers` | none; always Not available to Ashby |
| `request_change` | none; always Action not available, with the record link |
| `get_access_log`, `list_scenarios` | none |

## Local

```
npm install
npm run build        # seed build/tg.db and build/ashby.db, then run the checks
MCP_TOKEN=dev npm start
SMOKE_BASE=http://localhost:3000 MCP_TOKEN=dev npm run smoke
```

## Layout

- `data/reference.js`: parties, people, locations, items, rules
- `data/scenarios/`: one generator per scenario, deterministic
- `data/seed.js`: writes `build/tg.db` and the Ashby-only `build/ashby.db`
- `scripts/check.js`: plan values, totals, check digits, isolation
- `src/domain.js`: answer logic shared by tools, pages and checks
- `src/server.js`: MCP endpoint, record pages, admin page
