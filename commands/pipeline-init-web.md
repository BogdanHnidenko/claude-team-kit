---
description: Set up the team pipeline for a WEB project (web frontend + backend services + infra) — writes or extends .pipeline/workspace.json
---

Talk to me in Ukrainian throughout.

Set up the Claude team pipeline in the current folder (the workspace root) for **web**: web frontend(s) → `team-frontend`, tests → `team-qa` (Playwright), plus backend services and infra.
Start from the scanner: `node ~/.claude/pipeline/pipeline.mjs detect --json` (services, git layout, checks, ports, links `dependsOn`), then verify it by reading files. Keep `dependsOn` links (caller → provider) for every client and service.
Reference format: `node ~/.claude/pipeline/pipeline.mjs template workspace`.

1. If `.pipeline/workspace.json` exists, read it and EXTEND it — keep every service and setting already there (the workspace may also have a mobile app). Never drop entries.
2. Explore the folder (max depth 3; skip `node_modules`, `dist`, `build`, `.git`, `vendor`, `ios`, `android`) and find:
   - **web frontends** → `type: "frontend"` (vue / react-dom / svelte / angular / next / nuxt / vite with a web entry);
   - **backends** → `type: "backend"` (express / fastify / nest / koa / hono / any HTTP server), **workers** → `type: "worker"` (queue/cron consumers), shared packages → `type: "library"`;
   - **infra** → `type: "infra"` (docker-compose, k8s, terraform, `.github/workflows`).
   Skip React Native apps here — they are set up by `/pipeline-init-mobile`.
3. For each service fill: `commands` (`lint`, `typecheck`, `test`, `build` — non-interactive forms, e.g. `npx vitest run`), `dev.start` + `dev.url` (port from scripts / vite config / `PORT` in `.env.example`; never open real `.env` files; prefer a `/health` URL for backends), one-line `stack`. Check whether each folder is its own git repo (`git -C <dir> rev-parse --show-toplevel`).
4. Set `"e2e": { "path": "e2e", "command": "npx playwright test" }` and `"contracts": { "path": "contracts" }` unless they already exist.
5. Set `conventions.replyLanguage` to `"uk"` and `conventions.comments` if missing: `{ "language": "uk", "level": "all", "enforce": true }` (comments in Ukrainian for every function and variable).
6. Show me ONE message: a table (name, type, path, repo, commands found, dev url), what you could not determine, and at most 4 questions (e.g. deploy environments and how they deploy, contracts codegen, comment level).
7. After I confirm: write `.pipeline/workspace.json`, run `node ~/.claude/pipeline/pipeline.mjs scaffold`, then `node ~/.claude/pipeline/pipeline.mjs doctor`.
8. If `e2e/package.json` is missing, propose: `cd e2e && npm init -y && npm i -D @playwright/test typescript && npx playwright install chromium`.
9. Don't add scripts or files inside services without asking; list services missing `lint`/`typecheck`/`test`.
10. If the workspace root is not a git repo, suggest `git init` there (it versions the manifest, specs, contracts, e2e).

For every web or mobile client offer to create its testing guide `docs/testing/<service>.md` from `docs/testing/_TEMPLATE.md`: ask me 3–5 short questions (what the app is for, who uses it and how, what must never break, where it usually breaks, test accounts) and fill it in Ukrainian.

Finish with: what was created, what is missing, and a first command to try, e.g. `/feature <small web feature>`.
