---
description: Fix every failure from the last test run (web Playwright and/or mobile simulator), then re-run those tests
argument-hint: [task-id] [додаткові уточнення]
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **FIX** procedure from "Direct commands", with the source = the latest QA results of the task:
`.pipeline/<id>/qa.json`, `.pipeline/<id>/qa-mobile.json`, `.pipeline/<id>/sim-*.json` (failed flows, log errors, screenshots, `visual_issues`).
Task: the id I gave, or `node ~/.claude/pipeline/pipeline.mjs current`.
For each failure: route to the owner (`owner_hint`, or `node ~/.claude/pipeline/pipeline.mjs owner <file>`), pass the failure text, screenshot path and reproduction steps. Failures with `reason: "ENV"` are not code bugs — show me what to install or fix instead.
After the fixes, re-run the same tests at the task's depth (`current --json` → depth) (same platforms/ACs) via the QA agent that found them and report. Then tell me if `/commit` is next.
