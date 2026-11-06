---
description: Run tests or checks only (no fixes) — unit, lint, typecheck, comments, web, api, mobile, ios, android, review, regression or all
argument-hint: [task-id] [unit|lint|typecheck|comments|web|api|mobile|ios|android|review|regression|all] [поверхнево|поглиблено|дуже ретельно] [сервіс або сценарій]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **TEST** procedure from "Direct commands".
Task: the id I gave, or `node ~/.claude/pipeline/pipeline.mjs current`. No scope given → `all`.
For web/api/mobile/ios/android/all: the QA depth is the one I named (поверхнево → smoke, поглиблено → deep, дуже ретельно → exhaustive); if I named none and the task has no depth, ask me (three options, see rules → PLAN → QA depth) and save it with `mark <id> depth=…`.
If a QA agent replies `STATUS: QUESTIONS`, relay them to me (rules → Questions from agents).
Don't change code. Report: what ran, passed/failed per project, failures with owner, and suggest `/fix-after-testing` or `/fix` if something failed.
