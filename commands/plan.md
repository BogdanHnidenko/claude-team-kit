---
description: Plan only - create the task, spec and contracts, then stop so you can review before any code is written
argument-hint: <що треба зробити>
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **PLAN** procedure from "Direct commands" (stage 1 only).
Show me: task id, affected projects and why (use the links from `node ~/.claude/pipeline/pipeline.mjs services`), the spec summary, contract changes, acceptance criteria, open questions.
Then stop. Tell me I can edit `docs/specs/<id>.md` and continue with `/resume <id>` (full chain) or `/assign …` (step by step).
