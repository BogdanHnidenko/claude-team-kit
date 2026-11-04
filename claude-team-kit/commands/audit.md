---
description: Blind security audit of a task, or of current uncommitted changes across all services
argument-hint: [task-id]
---

Task id: "$ARGUMENTS" (empty means `adhoc` — audit uncommitted changes in every service repo against HEAD).

1. `node ~/.claude/pipeline/pipeline.mjs diff <id>`
2. Call agent `team-security` with exactly:
   `Audit task <id>. Diff: .pipeline/<id>/diff.patch. Changed files: .pipeline/<id>/changed_files.txt. Write report to .pipeline/<id>/security.json.`
3. Show me the verdict and a table: severity, file:line, issue, fix, owner (`node ~/.claude/pipeline/pipeline.mjs owner <files>`).
Do not fix anything unless I ask.
