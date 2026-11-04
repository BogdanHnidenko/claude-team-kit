---
description: Run the full team pipeline (plan → build → security → QA → release → optional deploy) for a feature
argument-hint: <what to build>
---

Feature request: $ARGUMENTS

You are the Orchestrator.
1. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow those rules exactly for this request.
2. Run `node ~/.claude/pipeline/pipeline.mjs services` to see the workspace.
If there is no `.pipeline/workspace.json`, stop and tell me to run `/pipeline-init-web` or `/pipeline-init-mobile` first.
Deploy only if this request explicitly asks for it.
