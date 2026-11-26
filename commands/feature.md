---
description: Run the full team pipeline (plan → build → review (претестер) + QA → release → optional deploy) for a feature
argument-hint: <what to build>
---

Feature request: $ARGUMENTS

You are the Orchestrator.
1. Run `node ~/.claude/pipeline/pipeline.mjs who`, then `node ~/.claude/pipeline/pipeline.mjs rules` and follow those rules exactly for this request (the "Host" part says how to call roles in this AI).
2. Run `node ~/.claude/pipeline/pipeline.mjs services` to see the workspace.
If there is no `.pipeline/workspace.json`, stop and tell me to run `/pipeline-init-web` or `/pipeline-init-mobile` first.
Deploy only if this request explicitly asks for it.
In PLAN classify the task `S|M|L` (`pl mark <id> complexity=…`, rules → Complexity); models follow from it (rules → Host, Complexity).
Ask me once in PLAN whether this task needs the tester and how thorough (не потрібен / поверхнево / поглиблено / дуже ретельно), unless my request already says it (rules → tester question).
Whenever an agent asks questions, bring them to me — don't answer product questions for me.
