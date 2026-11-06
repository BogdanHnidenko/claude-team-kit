---
description: Set up the team pipeline for a MOBILE project (React Native / Expo app + backend services) with simulator QA — writes or extends .pipeline/workspace.json
---

Talk to me in Ukrainian throughout.

Set up the Claude team pipeline in the current folder (the workspace root) for **mobile**: React Native / Expo app(s) → `team-mobile`, tests on iOS simulator / Android emulator → `team-qa-mobile` (Maestro), plus backend services and infra.
Start from the scanner: `node ~/.claude/pipeline/pipeline.mjs detect --json` (services, git layout, checks, ports, links `dependsOn`), then verify it by reading files. Keep `dependsOn` links (caller → provider) for every client and service.
Reference format: `node ~/.claude/pipeline/pipeline.mjs template workspace` (see the `mobile` service and `e2eMobile`).

1. If `.pipeline/workspace.json` exists, read it and EXTEND it — keep every service and setting already there (the workspace may also have a web frontend). Never drop entries.
2. Explore the folder (max depth 3; skip `node_modules`, `Pods`, `build`, `.git`) and find:
   - **mobile apps** → `type: "mobile"`: `react-native` in dependencies. `expo` in dependencies → `framework: "expo"`, otherwise `"bare"`.
   - **backends / workers / libraries / infra** exactly as in a web workspace (`type: backend | worker | library | infra`, with `commands`, `dev.start`, `dev.url` — a `/health` URL for backends).
3. For each mobile app determine (read files, never real `.env`):
   - `appId.ios` — `app.json`/`app.config.*` → `expo.ios.bundleIdentifier`, or `ios/*/Info.plist` / Xcode project `PRODUCT_BUNDLE_IDENTIFIER`;
   - `appId.android` — `expo.android.package`, or `android/app/build.gradle` `applicationId`;
   - `platforms` — ask me; default: `["ios","android"]` on macOS, `["android"]` elsewhere;
   - `device.ios` — pick from `xcrun simctl list devices available` (prefer a recent iPhone); `device.android` — from `emulator -list-avds`. If none exist, tell me how to create one (Xcode → Settings → Platforms; Android Studio → Device Manager).
   - `build` per platform (it must build AND install the app on that simulator/emulator; `{device}` is replaced with the device name):
     - Expo: `npx expo run:ios --configuration Release --no-bundler --device "{device}"` and `npx expo run:android --variant release --no-bundler`
     - bare RN: `npx react-native run-ios --mode Release --simulator "{device}" --no-packager` and `npx react-native run-android --mode release --no-packager`
     Release builds embed the JS bundle, so the tests don't depend on Metro. Keep `"rebuildOn": "any"`.
   - `commands`: `lint`, `typecheck` (`npx tsc --noEmit`), `test` (`npx jest --ci`). No `build` here — the simulator build happens in QA.
4. Set `"e2eMobile": { "path": "e2e-mobile", "timeoutSec": 1800 }` and `"contracts": { "path": "contracts" }` unless they exist.
5. Set `conventions.replyLanguage` to `"uk"` and `conventions.comments` if missing: `{ "language": "uk", "level": "all", "enforce": true }`.
6. Backend URLs inside the app: the app must reach local backends during tests. iOS simulator sees the Mac's `localhost`; for Android the runner does `adb reverse` for every `dev.url` port, so `localhost` works too. Check how the app reads its API URL (e.g. `EXPO_PUBLIC_API_URL`) and tell me if it is hardcoded to a remote server.
7. Check tools and report what's missing (don't install anything yourself): `maestro` (`curl -Ls "https://get.maestro.mobile.dev" | bash`), `java` 17+, Xcode + `xcrun` (iOS, macOS only), Android SDK `adb` + `emulator` in PATH.
8. Show me ONE message: a table of services (name, type, path, repo, commands, dev url), the mobile block (framework, appIds, devices, build commands), missing tools, and at most 4 questions (e.g. platforms, EAS deploy profiles for `deploy`, comment level).
9. After I confirm: write `.pipeline/workspace.json`, run `node ~/.claude/pipeline/pipeline.mjs scaffold` and `node ~/.claude/pipeline/pipeline.mjs doctor`.
10. Offer a smoke test once tools are installed: create `e2e-mobile/smoke/AC-1.yaml` (launch app, screenshot), `node ~/.claude/pipeline/pipeline.mjs start smoke <app> --no-qa`, then `node ~/.claude/pipeline/pipeline.mjs sim smoke`, and finally `node ~/.claude/pipeline/pipeline.mjs rollback smoke` — this proves build + install + Maestro work before the first real feature.

For every web or mobile client offer to create its testing guide `docs/testing/<service>.md` from `docs/testing/_TEMPLATE.md`: ask me 3–5 short questions (what the app is for, who uses it and how, what must never break, where it usually breaks, test accounts) and fill it in Ukrainian.

Set `"qa": { "defaultDepth": "ask" }` unless it exists (the orchestrator asks the depth per task). If I say I always want one level, use `smoke`, `deep` or `exhaustive` instead.

**Fast test mode for mobile apps.** If an existing mobile service has no `"mode": "fast"` (release builds, `rebuildOn: "any"`) and the app does not use `expo-dev-client`, offer to switch it — it is the biggest speed-up for QA: debug build once, JS loaded from Metro, rebuild only on native changes. The fast block (Expo): `"mode": "fast"`, `build.ios: npx expo run:ios --configuration Debug --no-bundler --device "{device}"`, `build.android: npx expo run:android --variant debug --no-bundler`, `"metro": { "start": "npx expo start --port 8081", "url": "http://localhost:8081/status" }`, `"rebuildOn": "native"` (bare RN: `npx react-native run-ios --mode Debug --simulator "{device}" --no-packager`, `run-android --mode debug --no-packager`, metro `npx react-native start --port 8081`). Also suggest hiding LogBox in tests: `if (process.env.EXPO_PUBLIC_E2E === '1') LogBox.ignoreAllLogs()`. Then prove it with the smoke test.

Finish with: what was created, what is missing, and a first command to try, e.g. `/feature <small mobile feature>`.
