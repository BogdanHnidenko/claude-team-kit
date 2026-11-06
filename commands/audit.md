---
description: Blind code review by the Pretester (patterns, anti-patterns, bugs, security) of a task, or of current uncommitted changes across all services
argument-hint: [task-id]
---

Task id: "$ARGUMENTS" (empty means `adhoc` — audit uncommitted changes in every service repo against HEAD).

1. `node ~/.claude/pipeline/pipeline.mjs diff <id>`
2. Call agent `team-reviewer` with exactly:
   `Review task <id>. Round: 1. Diff: .pipeline/<id>/diff.patch. Changed files: .pipeline/<id>/changed_files.txt. Write report to .pipeline/<id>/review.json.` Then run `node ~/.claude/pipeline/pipeline.mjs review <id>` for the real verdict.
3. Show me the verdict and a table: severity, file:line, issue, fix, owner (`node ~/.claude/pipeline/pipeline.mjs owner <files>`).
Do not fix anything unless I ask.
