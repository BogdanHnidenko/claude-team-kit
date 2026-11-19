---
description: Choose who runs the tester — Claude, Gemini (via Antigravity CLI) or ChatGPT (via Codex CLI); checks the install, sign-in and permissions
argument-hint: [claude|gemini|codex] [web|mobile|all]
---

Talk to me in Ukrainian throughout.

Request: $ARGUMENTS

You are the Orchestrator. Goal: set which AI runs the tester, so Claude's tokens are spent only on planning, coding and review.

1. Show the current state: `node ~/.claude/pipeline/pipeline.mjs qa-provider web` and `… qa-provider mobile`; `node ~/.claude/pipeline/pipeline.mjs qa-setup --check` (it is safe: it only probes).
2. If I did not name the provider or the kind, ask with AskUserQuestion (one question each, short):
   - Provider: `Gemini через agy (підписка Gemini)`, `ChatGPT через codex (підписка ChatGPT, експериментально)`, `Лишити Claude`.
   - Kind (only if the workspace has both web and mobile): `Лише веб (Recommended)`, `Лише мобільне`, `Обидва`. Mobile on an external AI is untested: recommend web first.
3. Run `node ~/.claude/pipeline/pipeline.mjs qa-setup --provider <p> --kind <k> --yes`. Without a terminal it cannot install tools or sign in — it does the permission setup and the probe, and prints what is still missing.
4. If it says the choice was NOT saved: tell me, in plain words, the exact commands for me to run in my own terminal (the script prints them), most likely just `cd <workspace> && node ~/.claude/pipeline/pipeline.mjs qa-setup` — an interactive dialog that installs, opens the sign-in and checks everything itself. Then offer to re-run `--check`.
5. When saved: confirm `qa.providers` in `.pipeline/workspace.json`, and remind me that if the external AI fails (limit used up, signed out) the orchestrator will ask before switching back to Claude (`qa.fallback`: `"ask"` or `"claude"`).
