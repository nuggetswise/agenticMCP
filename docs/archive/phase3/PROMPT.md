Amendments (these override any line below them)

Order and access
- Gate first, since it writes nothing. Then attach nuggetswise/agenticMCP with push
  access; if that is refused, stop and tell me. Then save PROMPT.md and STATE.md.
- Prompts the app shows to approve a push, deploy, publish or delete are not
  questions to me. Wait on them; I will tap them. If I type "continue", resume from
  STATE.md.
- Names allowed in chat: P13, P14, P15 and the step numbers of this prompt.

Logging during step 1
- Hold conflicts and calls found in step 1 in STATE.md under "Pending calls" and
  move them to CALLS in step 3's first commit.

Approval packet
- Four questions: change lists (all three prototypes), cut list, skill restructure,
  open calls. To treat prototypes differently, I answer "Approve with my edits" and
  name the prototype. Put whether Scout Agent shares the limit flaw under open calls,
  with your recommendation.

Seeing the pages
- Preferred: if Claude in Chrome tools are present, take screenshots and run walks
  in my Chrome at 1440 wide.
- Fallback: render the repo's page source locally at 1440 in headless Chromium, with
  connector calls served from recorded runs. Then confirm each published artifact
  matches the built file, using read_artifact and a hash comparison. Log which route
  you used.

Recorded runs
- Test once whether the shell can reach tg-retail-demo-mcp.onrender.com. If it can,
  fetch /sessions/<id> with curl and save the bytes unchanged. If it cannot, write
  the connector tool's result to a file by script, not by hand, and log the route.
  Never summarise or reformat a run.

Archiving the skills
- "The old references folder" means the current skill bodies. Before step 7 changes
  anything, save the text of each changed skill exactly as the Skill tool loads it
  to docs/archive/skills/<name>/SKILL.md. If the repo already holds a copy, archive
  that as well.

Step 8 replaced
- Record a SHA-256 of docs/build-guide.md in docs/guide-doc-sync.json at each doc
  refresh. guide-check fails when the file's hash differs from the recorded one.
  Refreshing the doc and updating the hash are the last edit of any commit that
  changes the guide.

Task cards
- If the Prototype Plan doc cannot take suggestions through the docs tools, post the
  new card text as a comment on the card. That is a proposed edit, not a question.

Reports
- Two lines after each step. The headings Completed, Verified and Open issues only
  in the final report.

Repo: nuggetswise/agenticMCP (main, commit ed78898). This prompt, the Build Guide and
the saved skills are the full handoff; do not rely on any earlier chat.

Goal: finish Phase 3 (P13, P14, P15) to the approved design, make the skills and the
project lean, and stop the back-and-forth. You ask me once (step 2); then you work to
the end.

Keeping your place
- First action: save this prompt unchanged as docs/phase3/PROMPT.md and create
  docs/phase3/STATE.md (one line per step: not started, done with commit, or blocked
  with reason).
- Before each step, re-read PROMPT.md and STATE.md. After each step, update STATE.md
  in the same commit.
- If a session ends, the next one reads both files and continues from the first
  unfinished step. It does not re-ask or re-decide anything already approved.

Gate before anything else: load tg-retail-workspace-prototype,
tg-retail-agent-prototype, enterprise-product-writing and visual-treatment-planner
with the Skill tool. Confirm the 16 November corrections are in them: the workspace
skill has an "Every turn" section and allows Requirements v8 for the business problem;
the agent skill names the approved board "Direction A · Agent working live" and lists
P13 and P14. If any is missing, stop and tell me to save the skill cards; build
nothing on the old skills.

Read before deciding (all of it, not samples), and list in your first message what
each one settles:
1. docs/build-guide.md and the last three CALLS entries.
2. The approved board: the canvas https://claude.ai/artifact/N5zQWtnMqqFhg2b7x93d3F,
   files project/canvas.json and project/AgentLive.dc.html. It is the template for
   every agent screen and is not re-decided.
3. The Prototype Plan doc (https://claude.ai/artifact/Ux8ZjNd7BTj6mdH7e5rJ2S): P13's
   build-queue entry, the story calendar rows for P13, P14 and P15, and the task card
   format.
4. The Agent and MCP strategy doc (https://claude.ai/artifact/VXoARJoJoqyv4VmGRUjFtz):
   P13's build brief.
5. The design system (https://claude.ai/artifact/LDFHTCvphK9qbn7ecQx6S1): tokens.css
   and tokens.json.
6. P14's and P15's specs in the Build Guide's Prototype specs tab, and each
   prototype's business problem in Requirements v8 (business problem only).

When sources disagree, the higher one wins, and you log the conflict in CALLS:
1. This prompt.
2. My answers to the approval packet.
3. The approved board (layout and behaviour of agent screens).
4. The design system tokens (every visual value).
5. The saved skills.
6. The Build Guide.
7. The Prototype Plan doc.
8. The Agent and MCP strategy doc.
9. Requirements v8 (business problem only).

How to work
- Plain words to me. No decision, rule, task or log numbers in chat. One commit or
  link as proof. Report as Completed, Verified, Open issues.
- Check your own work before reporting. Decide from the sources and the skills; log
  every call in CALLS so I can overturn it. Never ask what they settle.
- When a prototype changes, update its task card in the Prototype Plan doc without
  being asked, laid as suggestions (the doc takes suggestions).
- Deploy with the Render MCP (service tg-retail-demo-mcp, workspace "My Workspace");
  pushes do not auto-deploy; poll the deploy (about 12 minutes).
- Pages reach the server only through the viewer's connector (RetailStrategy for
  Ashby, SupplierRetail for Northfield). No keys in pages. No raw X12 on any screen.
- Recorded runs are fetched from https://tg-retail-demo-mcp.onrender.com/sessions/<id>
  after each connector call, never retyped.
- Parallel agents work in their own git worktrees; you alone edit the Build Guide,
  the log and STATE.md, and you merge. Doc comments post under my name; never use
  them to ask me.
- Repo mechanics: after any change to src, world, scripts or registry, run npm run
  build, smoke, scout, watch, match and aviator-test, plus node scripts/world-diff.mjs
  and node scripts/guide-check.mjs. Move the guide's as-of commit (two places) and its
  proof counts in the same edit. A cited hash must contain a letter. Push with
  git -c push.negotiate=true.

Scope is closed
- Build nothing outside the eight steps. An idea you have goes in Open issues as one
  line, not into the work.
- Nothing under "Settled" or in my approval answers is re-opened, by you or by an
  agent you start.

When blocked (after step 2)
- Try two different fixes. If it still fails, log in CALLS what failed and what you
  tried, mark the step blocked in STATE.md, and continue with the next step that
  does not depend on it. Step 5 needs steps 3 and 4; steps 6, 7 and 8 do not need 5.
- Report every blocked item under Open issues. Do not ask me mid-run.
- Stop completely for one thing only: an action that cannot be undone and is not in
  the approved cut list.

Mine, not yours (list these in the final report; do not attempt them)
- Removing uploaded files from the project (you can delete only text docs).
- Memory files outside this project's folder (list the duplicates you find).
- Saving the skill cards, then deleting the old agent skill.

Settled, beyond the skills
- Font: Inter, as on the approved board and P1. Record it as the product-UI font in
  the design system's tokens and log the call.
- Agent rules and the data behind a run can be changed on screen (the setup view in
  the Agents drawer), without touching the repo or the recorded world.
- Skill structure, after Phase 3:
  - The agent pattern becomes a section named "Agent screens" inside the workspace
    skill's SKILL.md (the skill card cannot add files), and the agent skill's name
    retires; I delete it after saving.
  - The writing skill's Retail Direction section and the planner's Retail Direction
    figure defaults move to leadership-strategy-guide.
  - The new load rule: base plus writing always, the planner when a figure, motion
    or visual changes, and the Agent screens section for agent screens.

Already done (verify, do not redo)
- Removed from the project: both single-thread prompt copies, three presenter-notes
  files, the root Retail Direction v6 handoff duplicate, and the Prototype
  Intelligence handoff and Phase 1 prompt (archived in the repo first). The calendar
  snapshot branch is merged; merge docs/archive-handoffs if it passes the gate.
- P13 and P14 are published with recorded real runs; P15 is published; Aviator
  answered live.
- Skill content corrected on 16 November (verified by the gate above).

Do in this order
1. Analyse, editing nothing except PROMPT.md and STATE.md.
   - Screens: for P13, P14 and P15, every difference from the approved board (agent
     screens) and the design system, with screenshots of each page and the board at
     1440 wide.
   - Change lists: for each, keep, correct, delete and add, with its click map (each
     click, what it changes, the beat it serves; about eight actions; one primary
     button labelled with its outcome). Draft its task card (problem, turn, result,
     ends at) from the Plan's entry and its spec. Include P14's ending.
   - Cleanup: classify each remaining project upload (live, evidence or retired).
     Plan moving the dated repo snapshots to docs/archive, and the Build Guide's Done
     task rows to a Done section. Find duplicate memory files and draft the merges.
     Before anything is removed, check what points to it and archive content found
     nowhere else.
   - Skills: draft the restructure settled above.
2. One approval packet, in one doc ("Phase 3 approval packet"), recommendation first
   in each part:
   (a) the three change lists with difference lists and task cards;
   (b) the cut list across repo, project and memory, marking which removals are mine;
   (c) the skill restructure, as before-and-after text (no skill card yet);
   (d) any call no source settles, each with your recommendation.
   Then use the question tool once, linking the doc, with one question per part.
   Each is answered Approve as drafted, Approve with my edits, or Drop.
   - My answer is final. Approved parts proceed as drafted. Edited parts proceed
     with my words applied literally. Dropped parts are not done and are listed
     under Open issues. For (d), any call I do not address goes your way.
   - Update the packet to match my answers, freeze the click maps as JSON in
     docs/phase3/<id>/approved/, and continue. Do not ask again.
3. Design system and kit.
   - Record Inter in the design system's font token.
   - Make the agent kit read every visual value from the tokens.
   - Add the board's pieces the kit lacks: queue rows with "If nothing changes" and
     cutoff, appearing as the agent checks; "What the agent did" with its Working or
     Done chip; the choice under the person's rule; the Result list.
   - Add the kit-check rule that fails any value outside the tokens.
   - Republish the kit page and the design system's kit library.
4. Agents.
   - Match Agent escalates to Jordan Ellis when the supplier refuses a credit,
     instead of trying refused actions until its limit. It asks for every short line
     together, as the baseline does, and at its limit reports that it is waiting.
   - Fix the same limit flaw in Watch Agent.
   - Add gate checks that fail without these fixes.
   - Run both agents live on three variations each (one breaks the plan), compare
     with the baseline, and state the intelligence test each passes.
   - Deploy and log.
5. Rebuild P13, P14 and P15 to the approved change lists and the skills.
   - Generate each walk script from its frozen click map; a page passes only if every
     expected state follows its click.
   - Run kit-check and the contract check.
   - A separate agent that did not build the page compares it with the approved board
     and the design system; fix every difference not in the change list before
     publishing.
   - Record new real runs and republish with the connector tools declared.
   - Update the task cards.
   - Fill the coverage grid cells from evidence, and close the row for building the
     new prototypes.
6. Cleanup as approved: repo changes on a branch, gate and guide-check passing, then
   merge. Then the project text-doc removals and the memory merges inside this
   project's folder. Everything else on the cut list goes to my list.
7. Skill restructure as approved.
   - Change the Build Guide's skill rule to the new load rule, with one fallback
     line: until the workspace skill carries the Agent screens section, load
     tg-retail-agent-prototype in its place.
   - Repoint every mention of the retired agent skill in the guide and the kit
     scripts, keeping the same fallback.
   - Archive the old references folder in docs/archive.
   - Put the final drafts on skill proposal cards, at most three skills per card
     (four skills change, so two cards).
8. Build Guide doc.
   - Record in the repo the commit the Claude doc was last refreshed from.
   - Make guide-check fail when the guide has changed since.
   - Write into the guide that refreshing the doc is the last step of every commit
     that edits the guide.
   - Refresh the doc now and confirm it matches the repo.

After each step from 3 onward: checks run, commit pushed, STATE.md updated, deployed
if the server changed, and a two-line report. End with one report: what changed
across Phase 3, skills, project and repo, what is blocked or dropped, and my list
(remove the retired uploads, save the skill cards, then delete the old agent skill).
