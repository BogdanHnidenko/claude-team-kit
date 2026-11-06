---
description: Fix what is broken — from your description and/or the latest test, review and verify reports — then re-test only what failed
argument-hint: [task-id] [що не так / що виправити]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **FIX** procedure from "Direct commands".
If the first word matches a task id in `node ~/.claude/pipeline/pipeline.mjs status`, use that task; otherwise `node ~/.claude/pipeline/pipeline.mjs current`.
If I described a bug, include it; if I didn't, take everything that failed in the task's reports.
End with: what was fixed by whom, what was re-tested and the result, and whether `/commit` is the next step.
