---
description: Resume an interrupted pipeline task from its first unfinished stage
argument-hint: <task-id>
---

Task: $ARGUMENTS

1. Run `node ~/.claude/pipeline/pipeline.mjs rules` — you are the Orchestrator again.
2. Run `node ~/.claude/pipeline/pipeline.mjs who`, then `node ~/.claude/pipeline/pipeline.mjs resume-info $ARGUMENTS`: it shows the stage, branches, uncommitted changes per repo (`git status --short`, `git diff --stat`) and gate verdicts. Tell me which AI you are continuing in.
   The task may have been started in another AI (Claude, Gemini, Codex): that is fine, progress is on disk. (Never resume the other AI's old chat.)
   If BUILD was interrupted and there are uncommitted changes while the BUILD gate has not passed, show me the file list and hand them to the developer as context («перевір незавершені правки та дороби за спекою»); do NOT start over and do NOT overwrite silently.
   `node ~/.claude/pipeline/pipeline.mjs status` and read `.pipeline/$ARGUMENTS/state.json` plus the `verdict`/`STATUS` lines of the artifacts in `.pipeline/$ARGUMENTS/`.
3. Check every repo in state.json is on the branch recorded for it in state.json (the branch where the task started) (`git -C <repo> branch --show-current`).
4. Continue from the first stage whose gate has not passed. Remember: any code change after the audit means stages 3 → 5 run again.
