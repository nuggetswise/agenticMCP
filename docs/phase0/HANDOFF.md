# Phase 0 handoff, 12 November 2026

Phase 0 (read-only audit across every prototype) is not complete. Findings, and the last report verbatim, are in `docs/phase0/FINDINGS.md`. Nothing below has been approved; Phases 1 to 4 have not started.

## Live server

- URL: https://tg-retail-demo-mcp.onrender.com (Render free tier, deploys from `main`).
- The live server should be serving the latest commit on `main`. Server behaviour last changed in commit `7c277e2` ("Missing CTT is a guide rule, not syntax"); commits after it change only files under `docs/`.
- How to tell from outside: `lookup_retailer_rules` for document 855 returns rule NF-1.7, and `edi_health_summary` splits failures 31 on the 824 and 10 on the 997. The previous build returns no NF-1.7 and 29 / 12.
- `/healthz` reports version 0.2.0 for every commit, so it cannot show which commit is deployed.

## Remaining Phase 0 items

1. Scripted end-to-end walks for P1, P5, P6 and P7 (the generic walker stops at choice steps; P1 loops at the match-confirm step).
2. A1 (problem, turn, result) and A5 (repeats within a screen) beyond the first frame for every screen, and at all for P2, P8, NetSuite Chargeback Avoidance and ERP-native Activation. Screenshots taken so far are first frames only.
3. A6 and A8 confirmed on screen (current verdicts come from source).
4. Partner claim rows from Retail Direction section 9, the partner briefs (docx in the project) and every prototype route map. Only the Partner Map was checked.
5. The Orderful 3PL connector article (fetch was refused once; not retried).
6. Golden questions for agent decisions, the scorecard and deductions, five no-context runs through the live server, graded by SQL. Blocked on the live token.
7. The non-Claude MCP client against the live URL. Blocked on the token.
8. Film frames of "TG for Retail in Two Minutes" for A7.
9. Link check for retired pages in the Prove Value Prototype Plan, Prototype Briefs, field guide and decks.

## Known doc drift (docs frozen until approval)

- The three working docs still say 29 failures on the 824 and 12 on the 997; the world now has 31 and 10.
- They still give 24,130 transaction sets, 8,115 other records, 1,946 orders and 53 rules; the world now has 23,930, 8,111, 1,945 and 54 (NF-1.7 added).

## Prepared P1 copy (not published)

- File: `docs/phase0/P1-prepared.html`. It renumbers P1 to NR-449512 and INV-7702.
- Do not publish as it stands: it shows a variant selector ("One email / Sent twice"), product names in the header, and dates that contradict the world (received 2 Nov, delivered 7 Nov; the world has 28 Sep and 3 Oct).
- Live P1 equals the baseline this copy was made from (checked 12 Nov).

## Artifacts touched in this thread

Changed and published:
- P2 Programme Readiness: https://claude.ai/artifact/CM4B561qshaXjHkzWNtdi8
- P4 Marketplace to Wholesale: https://claude.ai/artifact/FLWwR1dFDG4tposZcw2Q85
- P5 Scout Shipment Watch: https://claude.ai/artifact/2Erv5An571ZHnR3WoUY5sf
- P6 Northfield Charge Resolution: https://claude.ai/artifact/3r1Xy87Vk4rDHDYSaKcQxo
- P7 Northfield Performance Improvement: https://claude.ai/artifact/9F1PiXsrUJ54AJq1dSJMbu
- NetSuite Chargeback Avoidance (Mandip's later version is the base; this thread published one names edit before it): https://claude.ai/artifact/AhjjX49TBdZ7qbMiHkZpnx
- EDI Review Pack (created): https://claude.ai/artifact/8BgJyjrA6nYLF32n9F9pxd
- Prototype Plan (doc): https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S
- Shared Demo Database and MCP Server Plan (doc): https://claude.ai/artifact/BH5yvtjF5thUSJhUjrSBun
- Agent and MCP strategy (doc): https://claude.ai/artifact/VXoARJoJoqyv4VmGRUjFtz

Read only:
- P1 Long-tail: https://claude.ai/artifact/N5Ly5kZWYqop1urPyH7WDp
- Money in Motion (P8): https://claude.ai/artifact/RB5p54UuQ9GFGDPxhGzU3a
- P9 Shelf Recovery: https://claude.ai/artifact/3D2tsVjwvnmMtPEoRKSpVe
- ERP-native Activation: https://claude.ai/artifact/NKh7WnRwiPQSqa7vz61zYj
- Agentic Retail Trade: https://claude.ai/artifact/P6KTkzJp8rVcY5wNUvrcwS
- TG for Retail in Two Minutes: https://claude.ai/artifact/RQbZQsmz433BjJCaEbU1BL
- Retail/CPG Partner Map: https://claude.ai/artifact/8P9x92mrPE2heyeUTLubby
- Retail Direction: Now, Next, Later: https://claude.ai/artifact/XgiKckfJgecFKwjg1ywRrG

## Retired pages, to unshare

- P4 Marketplace (superseded): https://claude.ai/artifact/BKP1moSkyhJr77aMiFKyy5
- Northfield Drop-ship Readiness: https://claude.ai/artifact/Px985kBmvG9y6aGTbp1K7g
- Northfield Receipt Differences: https://claude.ai/artifact/NoZBzVET4vkM1cwGXQ1zoK
- Trade the Accepted Order: https://claude.ai/artifact/8JXbnRP2qTkWz3S3Gw2Pgf
- Marketplace Channel Prototype: https://claude.ai/artifact/VMyoHpK34WaF5y3CtnwZs5
- Find Relationship Loss: https://claude.ai/artifact/SYDc298ZqBrweVqKHiRWop
- Document Order Desk: https://claude.ai/artifact/KXS2ohMoaGVSKvxUgAYgti
- Pocket Scanner: https://claude.ai/artifact/4gHrpxakbzGmfsmknnZJKZ
- Find Missing ASNs: https://claude.ai/artifact/U8dX74pSN1eMAFy8yrtoy9
- Carton Accuracy Comparison: https://claude.ai/artifact/19WMcTHSPjc22vhstjciE6
- Apply Order Changes: https://claude.ai/artifact/FFmiS1EjBfyjECKhW29YzQ

Possibly retired, awaiting Mandip's decision:
- P2 Get Ready: Supplier Activation Review: https://claude.ai/artifact/8QM1yvUPdbJizzP2ryK4by
- P1 Participate, Supplier Entry Audit: https://claude.ai/artifact/7emU9u11oJUrKM4MDy6QDw
- P5 Motion Study: https://claude.ai/artifact/JuPGgScsrnpYKVnXqN7DNP
- P1 Motion Study: https://claude.ai/artifact/V91GTxuN6Lemw3pFRvui7u
- Untitled (20 Oct): https://claude.ai/artifact/MDHRrTNRsKryFS6dTeKjsp
- Untitled (29 Oct): https://claude.ai/artifact/MSoxvSPZfdqRTpNcHw74KK
- Untitled (29 Oct): https://claude.ai/artifact/8dWEr4CPhtmrZEZg731uAY
- Untitled (29 Oct): https://claude.ai/artifact/JjUdcdjb5N2KP224BZ7gWC
- Untitled (29 Oct): https://claude.ai/artifact/3gyrJXusPycCEn7xSpFSat

## Working files not in the repo

Scratchpad files from this thread (walk scripts, screenshots, the bots-grammar checker, the golden grader) live only in the session container and will not survive it. The two that matter for the remaining items are described in FINDINGS.md: `phase0/botscheck.py` (independent X12 check using github.com/bots-edi/bots-grammars x12/4010) and `phase0/grade.mjs` (SQL-only golden grader).
