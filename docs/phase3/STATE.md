# Phase 3 state

Read PROMPT.md and this file before each step. One line per step.

- Gate: done 16 Nov. Workspace skill has "Every turn" and allows Requirements v8 (business problem); agent skill names "Direction A · Agent working live" and lists P13 and P14.
- Repo: attached with push access; HEAD ed78898.
- Step 1 Analyse: done 16 Nov; findings in the Phase 3 approval packet (https://claude.ai/artifact/HNumZwYzyjd7SmQTpnredD).
- Step 2 Approval packet: done 16 Nov. Owner answers: (a) change lists, (b) cut list, (c) skill restructure, (d) open calls, all Approve as drafted. Click maps frozen in docs/phase3/<id>/approved/click-map.json.
- Step 3 Design system and kit: in progress.
- Step 4 Agents: not started.
- Step 5 Rebuild P13, P14, P15: not started.
- Step 6 Cleanup: not started.
- Step 7 Skill restructure: not started.
- Step 8 Build Guide doc: not started.

## Page route

Fallback: Claude in Chrome not connected. Pages built from the repo and rendered at 1440 in headless Chrome on their recorded runs; the board rendered from its own source and logic. Published P13 and P14 are byte-identical to the builds (SHA-256); published P15 carries kit 1.1.0, the repo builds 1.2.0.
Recorded runs: the shell reaches tg-retail-demo-mcp.onrender.com (healthz 200), so runs are fetched with curl.

## Pending calls

1. Prompt asks for a primary button labelled with its outcome; the board and agent skill keep Approve with an outcome sentence. Packet open call 1.
2. Prototype Plan's P15 row says 493 ship notices change; the world gives 509 added failures (32 to 541).
3. Published P15 carries kit 1.1.0 while the repo builds 1.2.0; the log said its page was unchanged.
4. P13 shows the model's Reason text on screen, including a date and a contradiction on NR-46220.
5. P14 shows a tool name, the model's first-person text and "story moment" on screen.
6. P14's line 2 request is never answered in the world: INV-7731C keeps line 2 at 120, and Northfield later deducts one case (DM-55102).
7. contract/claims.json has no entries for P13, P14 or P15, so the contract check cannot cover them.
8. Design system font token still reads Arial; Inter is settled.
9. Prototype Plan and the strategy brief describe P13 starting from a rules step and a start click, against R16; the task card draft supersedes them.
10. Scout Agent's run loop has the same limit pattern as Watch Agent's. Packet open call 2.
