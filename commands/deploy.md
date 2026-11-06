---
description: Deploy (the PM runs the script, there is no DevOps agent) using the environments in workspace.json (production-like envs need explicit approval)
argument-hint: <env> [task-id]
---

Arguments: $ARGUMENTS (first = environment, optional second = task id).

1. `node ~/.claude/pipeline/pipeline.mjs services` — confirm the environment exists.
2. If a task id is given, check `node ~/.claude/pipeline/pipeline.mjs status` shows it committed.
3. Run `node ~/.claude/pipeline/pipeline.mjs deploy <env> --task <id>` yourself (without a task id: omit `--task`). Exit code 4 → ask the user, and only after an explicit yes run it again with `--approved`.
4. Report steps, healthchecks, and whether rollback ran.
