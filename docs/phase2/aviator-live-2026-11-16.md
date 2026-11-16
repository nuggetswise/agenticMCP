# Aviator, live through the owner's reconnected connector · 16 November 2026 (UTC)

Route: `ask_aviator` on RetailStrategy (Ashby), the same tool every prototype page calls through the viewer's connector. The owner reconnected both connectors in claude.ai before this run, and the connector now lists `ask_aviator`, `watch_*` (Ashby) and `match_*` (Northfield).

Question: "Which of my Northfield orders are missing a document Northfield requires right now?" (context: Open Northfield orders)

Answer (model gemini-3.5-flash-lite, primary route; tool called: `orders_needing_attention` with the warehouse check): NR-46151, NR-46142, NR-46156 and NR-46133 need attention; records cited: those four orders, ship notice ASN-46156 and invoice INV-46133.

Check: the same tool called directly at the story clock (17 November 11:00 ET) lists exactly those four orders: NR-46151 ship notice not sent (NF-4.2), NR-46142 order acknowledgment not sent (NF-1.4), NR-46156 ship notice ASN-46156 rejected (NF-4.11), NR-46133 invoice INV-46133 rejected (NF-4.10). Aviator's answer matches and invents nothing.
