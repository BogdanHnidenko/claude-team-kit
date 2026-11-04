---
description: Give a direct instruction to one team agent - backend, web, mobile, qa, qa-mobile, security or devops
argument-hint: <роль> [сервіс] <що зробити>
---

Request: $ARGUMENTS

You are the Orchestrator. Run `node ~/.claude/pipeline/pipeline.mjs rules` and follow the **ASSIGN** procedure from "Direct commands".
Examples of what I may write:
- `backend додай пагінацію в GET /quotes`
- `mobile виправ відступи на екрані Profile на iPhone SE`
- `qa-mobile протестуй тільки логін на Android`
- `security перевір авторизацію, focus: IDOR`
- `devops додай healthcheck у docker-compose`
Pass my instruction to the agent as I wrote it (plus task id and spec path). Report the agent's result, and tell me which checks are now stale before `/commit`.
