---
description: Run tests or checks only (no fixes) — unit, lint, typecheck, comments, web, api, mobile, ios, android, security or all
argument-hint: [task-id] [unit|lint|typecheck|comments|web|api|mobile|ios|android|security|all] [сервіс або сценарій]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **TEST** procedure from "Direct commands".
Task: the id I gave, or `node ~/.claude/pipeline/pipeline.mjs current`. No scope given → `all`.
Don't change code. Report: what ran, passed/failed per project, failures with owner, and suggest `/fix-after-testing` or `/fix` if something failed.
