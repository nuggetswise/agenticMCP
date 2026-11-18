# Renamed fields (17 and 18 November 2026)

No tool response names an agent. These are every field and value the server renamed, on both connections (MCP and REST). The old names are gone: no alias answers to them. Pages that read an old name must change to the new one.

The "renamed by" column says where: **source** means the tool builds the new name itself; **presenter** means `src/credit.js` renames it on the way out of every tool, so the same rule holds for any tool that emits that key. The presenter list was taken by logging every rename during a sweep of all 99 tools on both connections (814 calls).

## Fields

| Old field | New field | Where it appears | Renamed by |
|---|---|---|---|
| `agent` (on a finding) | `found_by`, the rule that found it, for example "Northfield matching rule NF-7.8" | `recommend_next_step`, `three_way_match`, `review_deduction_case` (inside `recommendation`) | source |
| `agent` (a rule set's old name, for example "Claim Agent") | `rules` (for example "Ashby’s evidence rules") and `runtime` (for example `claim`) | `pause_agent`, `resume_agent`, `set_agent_mode`, `replay_agent_rule`, `update_supplier_rule` (`effect`), `get_change_list` (`entries`, `rule_sets`), `get_access_log` (`rule_sets`), and the setup, start, state and baseline tools of the claim, pace, shelf, review and chase sessions | presenter |
| `agent` (an object: the model's side of a replay) | `model_run` | the replay tools of the claim, pace, shelf, review, chase and match sessions, and `get_change_list` (`entries[].result`) | presenter |
| `agent` (who proposed a write: a person's assistant, or a rule set) | `proposed_by` | `get_access_log` (`calls[].write`) | presenter |
| `agents` | `rule_sets` | `get_change_list`, `get_access_log` | presenter |
| `review_agent` | `recommendation` | `review_deduction_case` | presenter |
| `agent_state` | `rules_state` | `review_deduction_case` (`recommendation`), `three_way_match`, `recommend_next_step` while a rule set is paused | presenter |
| `review_agent_recommended` | `rules_recommended` | the write record of `decide_charge` | source |
| `agent_only` | `model_only` | the `automation` block of a replay | presenter |
| `suggested_by` | `proposed_by` | `finding_outcomes` | source |
| `suggestion` | `proposal` | `finding_outcomes` | source |
| `suggestions` | `proposals` | `finding_outcomes` | source |
| `suggestion_differs_from_rule` | `proposal_differs_from_rule` | `finding_outcomes` (`against_rule_baseline`) | source |
| `agents` (list of rule sets and their suggestions) | `proposals.by_rule_set` | `finding_outcomes` summary | source |
| `agent` (inside that list) | `proposed_by` | `finding_outcomes` (`proposals.by_rule_set[]`) | source |
| `approved_as_suggested` | `approved_as_proposed` | `finding_outcomes` (`proposals.by_rule_set[]`) | source |
| `taken_over` | `declined` | `finding_outcomes` (`proposals.by_rule_set[]`) | source |
| `under_standing_policy` | removed: every dispute needs Priya Raman’s approval (AP-4.1) | `finding_outcomes` | source |
| `why_not_automatic` | removed; the proposal carries `nf_7_4_evidence` and `needs` | `submit_dispute` | source |
| `shipped` (on a Supplier ERP invoice draft) | `to_ship`, with `to_ship_from` | `run_readonly_sql` on `events` (`erp.invoice_draft`), `recommend_next_step` (shipment risk), shipment sessions | source |
| `sent_to` (on a store recommendation) | removed: nothing is sent | `run_readonly_sql` on `events` (`rule.recommendation`) | source |
| `also` (store 207 inside store 114's recommendation) | removed: store 207 has its own record on 26 October | `run_readonly_sql` on `events` (`rule.recommendation`) | source |

## Values

| Field | Old value | New value | Where |
|---|---|---|---|
| `decision` | Approved as suggested | Approved as proposed | `finding_outcomes` |
| `decision` | Taken over | Declined | `finding_outcomes` |
| `decision` | Worked manually, Standing policy | removed: a decision with no proposal before it carries no `decision` | `finding_outcomes` |
| `result` | Agent paused, Agent resumed | Paused, Resumed | `pause_agent`, `resume_agent` |
| `next_step` | accept (a promotion deduction its deal supports) | no_decision_needed | `recommend_next_step` (deduction) |
| `kind` (event) | `agent.recommendation` | `rule.recommendation`, with `found_by` in place of `agent` in its data | `run_readonly_sql` on `events` |
| trace actor and `proposed_by` in shipment sessions | Scout | Model | `scout_*` tools |
| any text naming "X Agent" | X Agent | the rule set, for example "Northfield’s matching rules" | every tool (presenter) |

## Unchanged

Tool names (`pause_agent`, `resume_agent`, `set_agent_mode`, `replay_agent_rule`) and their `agent` argument. The argument takes the runtime's short name (`claim`, `scout`, `match` …), the rule set, or the old name.

## Added (not renames)

`quantities_in` on `get_order`, `supplier_document_trail` (one PO) and `three_way_match`; `aviator_permissions` on `get_change_list` (set with `set_agent_mode`, agent `aviator`); `as_of` on `replay_draft_rule` (the result then carries `documents_up_to`); event kinds `carrier.arrived_at_pickup` and `erp.shipment_quantity`; `stage` on each story calendar moment; `status: "Open"` on open scorecard lines; `case_pack` on a supplier's rate when its lines count in the order's unit.
