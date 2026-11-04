---
description: Deploy via team-devops using the environments in workspace.json (production-like envs need explicit approval)
argument-hint: <env> [task-id]
---

Arguments: $ARGUMENTS (first = environment, optional second = task id).

1. `node ~/.claude/pipeline/pipeline.mjs services` — confirm the environment exists.
2. If a task id is given, check `node ~/.claude/pipeline/pipeline.mjs status` shows it committed.
3. Call `team-devops` with `Task <id>. Mode: deploy <env>` (without a task id: `Mode: deploy <env>`, the agent omits `--task`).
4. If it returns `APPROVAL_REQUIRED`, ask me "Deploy to <env>? yes/no". Only after my explicit yes call it again with `Mode: deploy <env> approved`.
5. Report steps, healthchecks, and whether rollback ran.
