---
description: Universal setup — scan every folder of the workspace (web, mobile, backends, workers, infra, submodules), link the projects to each other and give each its own testing; writes or extends .pipeline/workspace.json
---

Talk to me in Ukrainian throughout.

Set up the Claude team pipeline for the current folder (the workspace root) — all project kinds at once.

1. Run `node ~/.claude/pipeline/pipeline.mjs detect` and then `node ~/.claude/pipeline/pipeline.mjs detect --json`. This is the proposal: services, types, git layout (separate repos / submodules), check commands, dev URLs, mobile block, links (`dependsOn`), and a "To check" list. If `.pipeline/workspace.json` exists, the proposal already merges it — never drop existing services or settings.
2. Verify the proposal by reading files (never real `.env` files):
   - **types**: `frontend` = web, `mobile` = React Native/Expo, `backend`, `worker`, `library`, `infra`;
   - **dev.url** of every backend / web frontend: confirm the port and that the URL answers (a `/health` route for backends if it exists);
   - **links (`dependsOn`)**: who calls whom. Confirm each detected link, and look for missed ones: API base URLs in client config/env examples, `fetch`/axios base URLs, proxy settings in vite/next config, service-to-service clients, queue producers/consumers (a worker that consumes jobs produced by a backend depends on that backend), `docker-compose` `depends_on`. A link always points from the caller to the provider.
   - **mobile**: appIds, simulator / emulator names (`xcrun simctl list devices available`, `emulator -list-avds`), build commands for Expo vs bare RN.
3. Testing per project — make sure each one has its own:
   - every service: `commands` (`lint`, `typecheck`, `test`, `build`; mobile without `build`) — run in its folder during verify;
   - web frontends present → `"e2e": { "path": "e2e" }` (Playwright, `team-qa`; starts the frontend and what it depends on);
   - mobile apps present → `"e2eMobile": { "path": "e2e-mobile" }` (Maestro on simulators, `team-qa-mobile`; starts only the backends the app depends on);
   - backends are tested through their own unit/integration tests plus API tests by `team-qa`.
4. `conventions`: keep existing; otherwise `{ "replyLanguage": "uk", "comments": { "language": "uk", "level": "all", "enforce": true } }`.
5. Show me ONE message:
   - the services table (name, type, path, repo/submodule, checks, dev url, testing);
   - a links diagram, e.g. `mobile → api`, `web → api`, `notifications → api`;
   - what you could not determine and what tools are missing (Playwright for web; Maestro, Java, Xcode, Android emulator for mobile);
   - at most 4 questions (e.g. unclear links, deploy environments, comment level).
6. After I confirm: write `.pipeline/workspace.json`, run `node ~/.claude/pipeline/pipeline.mjs scaffold`, then `node ~/.claude/pipeline/pipeline.mjs services` (shows uses / used by) and `node ~/.claude/pipeline/pipeline.mjs doctor`.
7. Don't add scripts or files inside services without asking. Suggest what is missing (scripts, `/health` routes, API URL from env instead of hardcoded).
8. Offer next steps per kind:
   - web: `cd e2e && npm init -y && npm i -D @playwright/test typescript && npx playwright install chromium`;
   - mobile: a smoke test (`e2e-mobile/smoke/AC-1.yaml` → `node ~/.claude/pipeline/pipeline.mjs start smoke <app> --no-qa` → `node ~/.claude/pipeline/pipeline.mjs sim smoke` → `node ~/.claude/pipeline/pipeline.mjs rollback smoke`);
   - if the root is not a git repo: `git init`; if sub-projects are separate repos and should be versioned together, see README part I (git submodules).

For every web or mobile client offer to create its testing guide `docs/testing/<service>.md` from `docs/testing/_TEMPLATE.md`: ask me 3–5 short questions (what the app is for, who uses it and how, what must never break, where it usually breaks, test accounts) and fill it in Ukrainian.

Finish with: what was created, the links, what is missing, and a first command to try, e.g. `/feature <small feature touching two projects>`.
