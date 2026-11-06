---
description: Finish the current task - re-run whatever checks are stale (review, tests, verify) and commit in every affected repo
argument-hint: [task-id] [fix — дозволити авто-виправлення]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **COMMIT** procedure from "Direct commands".
Task: the id I gave, or `node ~/.claude/pipeline/pipeline.mjs current`.
If my request contains "fix" / "виправ", use the automatic fix loops when a check fails; otherwise stop at the first failure and report it with the owner.
Nothing is pushed. End with commit hashes per repo and the push command (`git push --recurse-submodules=on-demand origin <branch>` if the workspace uses submodules).
