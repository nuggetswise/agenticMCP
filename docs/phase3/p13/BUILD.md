# P13 Silent Order Watch: build record, 16 November 2026 (UTC)

Published: [P13 Silent Order Watch](https://claude.ai/artifact/MGDhE28iCZ1bdb4he73uup), private to the owner. Source `ui/p13.html`; built with `node scripts/page-build.mjs p13`, which inlines the agent kit and the recorded run in `recorded-run.json`. Declared connector tools: RetailStrategy `watch_start`, `watch_decide`, `watch_state`, `watch_setup`, `watch_replay`, `ask_aviator`. The page holds no key.

On load the page starts a Watch Agent session through the viewer's Ashby connector (the morning check, no start button). Approve and Edit suggestion call `watch_decide`; after an approval the page moves the session clock to the order's next due record with `watch_state` and the agent continues. Without the connector the page plays the recorded real run under Simulated.

Recorded run: session WS-ae55e5dbb5 through the owner's reconnected Ashby connector, approvals made by the builder in the isolated session. Watch Agent proposed sending the 856 for NR-46215 (sent Late, then closed by receiving advice RCV-46215, 6 cartons matching), the 855 for NR-46210 (sent before its deadline; a 997 only), a Kinross status ask for NR-46220 (Kinross answered, then the 945 WSA-46220 arrived), the invoice for NR-46226 (created in the Supplier ERP, then sent), left NR-46231 alone, and after the 945 drafted the NR-46220 ship notice from the Kinross load scan with 10 minutes left and proposed sending it. Five sends, every one with Priya Raman's approval; no violation.

| Click | What changes | Beat |
| --- | --- | --- |
| Approve on NR-46215 | Ship notice sent, recorded Late; queue moves on | Turn |
| Approve on NR-46220 | Kinross asked; queue moves on | Turn |
| Approve on NR-46210 | Order acknowledgment sent before its deadline | Turn |
| Approve on NR-46226 | Invoice created and sent | Turn |
| Approve on NR-46220 (it comes back after the 945) | Ship notice from the Kinross load scan sent | Result |

Checks: `node scripts/kit-check.mjs build/pages/p13/index.html` all pass; `node scripts/walk-p13.mjs` all pass, five clicks on the main path. Screenshots: `open.png`, `approved.png`.

Findings from the real runs: before commit e42e78e, two runs drafted the 855 and 856 under policy and never proposed sending them; the instruction now asks for a release proposal for every draft. Not checked: Edit suggestion through the live connector (checked only on the recorded run by kit-check).
