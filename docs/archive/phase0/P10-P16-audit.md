# P10 server scopes and P16 connector: audit (T0.2), 13 November 2026

Run through the live connections enabled in the owner's Claude session: the Ashby connection (RetailStrategy), the Northfield connection (SupplierRetail) and the retailer catalogue connector (Retailer). Nothing was written on any of them.

## P10 Ashby
- **A1 story.** The task card's four questions and the escalation return its fixed points at the story clock:
  - Orders needing attention: four, NR-46151, NR-46142, NR-46156 and NR-46133, each with reason, rule, deadline and time left.
  - Rejection: ASN-46118 rejected on the 997, PO reference 26 characters against 22, root cause in Supplier ERP, the same cause on three later documents.
  - Health over 30 days: 3,412 documents, 41 failures, top three causes.
  - Escalation: of the six POs, five on time and NR-46108 one day late, with the receiving advice behind each.
- **A2 manual option.** Every answer links to a Trading Grid record page with the record and its X12, which is the same answer on a screen.
- **A6 overlap.** "Orders needing attention" lists a ship notice not sent after the truck left; that is P13's job as a question rather than an agent. They should share their records and not their wording.
- **A8 roles.** No people are named in the answers; Kinross appears as a company.

## P10 Northfield
- **A1 story.** From Jordan's side, the document trail for NR-46108 shows the late receipt the escalation is about, using shared documents only and saying so.
- **A2 manual option.** Answers link to Northfield record pages.
- **A3 agency.** Review Agent's next step changes with the case record: on 3 December it recommends reversing DC-40877's shortage charge, citing NF-5.3 and NF-7.4; on 10 December, after Jordan's decision, it has nothing to do.
- **A6 overlap.** Its deduction review is P6's retailer side; it should read the same case.
- **A8 roles.** Jordan Ellis decides; the agent only recommends; Priya appears as the approver of Ashby's dispute.

## P16 Retailer catalogue connector
- The connector in the owner's session answers as a Trading Grid Catalogue retailer-side demo: requirement profiles and supplier compliance monitoring, with writes that need confirmation.
- **Not yet confirmed as P16.** Its URL is not recorded, so Inventory's link stays "Not recorded".
- **Finding against R04.** It is connected as a real retailer and lists real brands among its suppliers next to invented ones. Every other prototype uses Northfield, Ashby and invented suppliers only.
- The rest of its grid row waits for the owner to confirm what P16 is.

## Server findings
- Of nine calls on the Ashby connection, three returned no result the first time and answered on a retry. Render's free tier is the likely cause. A live demo should open the connection a few minutes ahead.
- `explain_rejection` takes no time to answer as of. At the story clock it reports INV-46133 as "Corrected and accepted", while the attention list and the health summary at the same clock list it as open.
