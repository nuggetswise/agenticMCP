# Agent governance golden questions, 15 November 2026

Five no-context runs, each answering through the live connectors only (Ashby's for GQ1 to GQ4, Northfield's for GQ5), with no file, repository or SQL access. Questions: `questions.json`; expected values: `expected.json`, from the governance code (`src/governance.js`, `src/scout.js`) and the replay recorded in CALLS 78; grader: `grade.mjs`; report: `grade-report.json`.

| Question | What it tests | Passed |
| --- | --- | --- |
| GQ1 | Each Ashby agent, its state, and Claim Agent's authority (AP-4.1, $250) | 5 of 5 |
| GQ2 | A changed agent rule trialled before going live: AP-4.1 at $50 moves DC-40877 ($88.40) to Priya Raman; no next step changes | 5 of 5 |
| GQ3 | Scout's editable approval modes, its locked actions (AP-5.1, AP-1.4, AP-1.3) and guardrails (AP-1.4, AP-7.1, AP-3.3) | 5 of 5 |
| GQ4 | The rule baseline on NR-460207 loads 659 of 660 and changes no recorded record | 5 of 5 |
| GQ5 | Northfield's agents (Review Agent under NF-7.7, Match Agent) recommend only; the assistant can pause an agent and cannot resume one | 5 of 5 |

Each GQ2 run recorded its trial on the live server's change list (trials CL-0001 onward); the catalogue still holds AP-4.1 at $250 after every run. The server's change list resets when the service restarts.
