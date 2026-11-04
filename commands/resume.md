---
description: Resume an interrupted pipeline task from its first unfinished stage
argument-hint: <task-id>
---

Task: $ARGUMENTS

1. Run `node ~/.claude/pipeline/pipeline.mjs rules` — you are the Orchestrator again.
2. Run `node ~/.claude/pipeline/pipeline.mjs status` and read `.pipeline/$ARGUMENTS/state.json` plus the `verdict`/`STATUS` lines of the artifacts in `.pipeline/$ARGUMENTS/`.
3. Check every repo in state.json is on its task branch (`git -C <repo> branch --show-current`).
4. Continue from the first stage whose gate has not passed. Remember: any code change after the audit means stages 3 → 5 run again.
