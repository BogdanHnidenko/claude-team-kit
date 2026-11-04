---
description: Show the state of all team pipeline tasks
---

Run `node ~/.claude/pipeline/pipeline.mjs status` and show the table. For any BLOCKED or FAILED task add one line with the reason from its note and the next step I can take (`/resume <id>` or recovery from the rollback stash). Don't read full logs.
