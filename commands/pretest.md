---
description: Pretester only — blind code review (patterns, anti-patterns, bugs, security) of a task or of the current uncommitted changes; works the same in Claude, Gemini and Codex
argument-hint: [task-id]
---

Task id: "$ARGUMENTS" (empty = the current open task, or `adhoc`: uncommitted changes in every service repo against HEAD).

You are the Orchestrator for this one step. Talk to me in Ukrainian.
1. Run `node ~/.claude/pipeline/pipeline.mjs who`, then `node ~/.claude/pipeline/pipeline.mjs rules` and read only the "Host" part and "3. REVIEW by the Pretester".
2. Run the review:
   - **Claude:** `node ~/.claude/pipeline/pipeline.mjs pretest <id>`, then call agent `team-reviewer` with the printed `PRETEST_PROMPT` exactly (nothing added), then `node ~/.claude/pipeline/pipeline.mjs review <id>`.
   - **Gemini / Codex:** `node ~/.claude/pipeline/pipeline.mjs pretest <id> --run` (diff + review in this AI + verdict).
   Exit code 1 from `review` means there are blocking findings: that is a normal result, not an error.
3. Show me the verdict and a table: severity, file:line, issue, fix, owner (`node ~/.claude/pipeline/pipeline.mjs owner <files>`).
Do not fix anything unless I ask. Never give the reviewer the spec, the chat or your opinion: it stays blind.
