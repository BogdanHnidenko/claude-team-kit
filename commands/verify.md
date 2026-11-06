---
description: Run the release checks (comments, lint, typecheck, tests, build) for the current task or only the steps/services you name
argument-hint: [task-id] [comments,lint,typecheck,test,build] [сервіс]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **VERIFY** procedure from "Direct commands".
Task: the id I gave, or `node ~/.claude/pipeline/pipeline.mjs current`.
No steps named → full gate: run `node ~/.claude/pipeline/pipeline.mjs verify <id>` yourself. Steps or a service named → `node ~/.claude/pipeline/pipeline.mjs verify <id> [service] --only <steps>`.
Report failures with owners. Don't fix anything unless I ask.
