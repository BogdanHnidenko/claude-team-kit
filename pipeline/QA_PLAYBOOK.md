# QA playbook — test like a meticulous human tester

You are not a script runner. You are the tester who finds the bug before the user does.
Read this whole playbook before designing tests. The task's **depth** decides how far you go.

## 1. Depth levels

| Depth | Meaning | Min. cases per AC | Categories that must be covered in the task (tags) |
|---|---|---|---|
| `smoke` (поверхневе) | does the feature work at all | 1 | `happy` (+ `responsive` for web, 3 widths) |
| `deep` (поглиблене) | normal + wrong use, edges, interruptions | 4 | `happy`, `negative`, `boundary`, `partial`, `navigation`, `interrupt` (+ `responsive` for web, 7 widths) |
| `exhaustive` (дуже ретельне) | everything a real person could do | 8 | `happy`, `negative`, `boundary`, `partial`, `data`, `navigation`, `gesture`, `interrupt`, `network`, `state`, `a11y`, `visual` (+ `responsive` for web, 13 widths) |

- Get the depth: `node ~/.claude/pipeline/pipeline.mjs current --json` → `depth` (or the depth given in your prompt).
- A category that truly cannot apply (e.g. `partial` when the feature has no form) must be declared in your report under `"not_applicable": { "partial": "reason" }`. The coverage check accepts it only with a reason.
- Check yourself before stamping: `node ~/.claude/pipeline/pipeline.mjs coverage <id> mobile|web`. `stamp` runs the same check and refuses if coverage is below the depth.

## 2. Plan first: CASES.md

Before writing any test, write the test plan in Ukrainian:
- mobile: `<e2eMobile.path>/<id>/CASES.md`; web: `<e2e.path>/<id>.cases.md`.
- One table per AC: `# | case | category | data | steps | expected | auto/manual`.
- The user reads this file — make it clear enough that a person could run the tests by hand.

## 3. Case catalogue — go through every section that applies

### 3.1 Every form (category `partial`, `negative`, `happy`)
- **All valid** — realistic values, submit → success. Then the same with the *minimum* valid values and with the *maximum* valid values.
- **Nothing filled** — submit empty → every required field shows its error; nothing is sent.
- **One field missing at a time** — for N required fields write N cases: everything valid except field *i* empty → only field *i* errors.
- **One field invalid at a time** — everything valid except field *i* invalid → only field *i* errors, the others keep their values.
- **Only optional fields filled** — required empty → errors only on required.
- **Fill → clear → fill again** — errors appear and disappear correctly.
- **Wrong order** — fill the last field first, jump between fields, submit with the keyboard's Enter/Done.
- **Fix after error** — submit invalid, correct the field, submit again → success, no stale error.
- **Leave half-filled** — go back / switch tab / background the app → is the draft kept or discarded as the spec says? No crash.

### 3.2 Field values (category `boundary`, `data`, `negative`)
For **every** input, pick from this list what fits its type:

| Field type | Values to try |
|---|---|
| any text | empty; one space; only spaces; leading/trailing spaces; 1 char; max length; max+1; very long (1000+); emoji `🔧👷‍♂️`; Cyrillic `Ґанок і їжак`; mixed scripts; RTL `שלום`; HTML/script `<b>x</b><script>`; SQL-like `' OR 1=1 --`; newlines; tab; zero-width space; pasted text with formatting |
| email | valid; uppercase; with `+tag`; subdomain; no `@`; two `@`; no domain; trailing dot; spaces inside; very long; Cyrillic domain |
| password | min length; min−1; max; only digits; only letters; with spaces; emoji; same as email; paste; show/hide toggle keeps the value |
| number / price / quantity | 0; 1; −1; decimal with `.` and `,`; many decimals; leading zeros `007`; max; max+1; huge `99999999999`; letters; `1e5`; empty |
| phone | local; international `+380…`; with spaces/dashes/brackets; too short; too long; letters |
| date / time | today; past; future; 29 Feb; end of month; far past/future; time zone edge (23:59 / 00:00); changing device locale if supported |
| select / picker | each option; default; change and change back; required but untouched |
| checkbox / switch | on; off; toggle fast several times; required checkbox (terms) left off |
| file / photo | allowed type; wrong type; huge file; cancel the picker; permission denied |
| search | empty; one letter; no results; special chars; very long; fast typing; clear button |

### 3.3 Navigation (category `navigation`)
- Back button / swipe back in the middle of every step; Android hardware back; closing a modal by tapping outside / swipe down.
- Open the screen from every entry point (tab, list item, deep link, notification tap if applicable).
- Protected screen while logged out → redirect, then return to the original screen after login.
- Double navigation: tap a link twice quickly → only one screen opens.

### 3.4 Gestures (category `gesture`, mobile; for web: drag, hover, keyboard navigation)
- **Swipe left and right** on every list item / card (actions like delete/archive appear? Undo? Swipe partially and release?).
- Swipe left/right between tabs / pages / carousel; swipe at the first and last page.
- Swipe down to close modals/bottom sheets; **pull to refresh** on lists (with and without network).
- Long press on items (context menu?); double tap; tap during an animation.
- Scroll to the very end of long lists (pagination/infinite load, "no more items"), scroll fast up and down.
- Rotate the device if the app supports landscape.

Maestro examples:
```yaml
# Свайп елемента списку вліво — мають з'явитися дії
- swipe:
    from:
      id: "quote-item-0"
    direction: LEFT
- assertVisible:
    id: "quote-item-0-delete"
# Свайп вправо — дія скасовується або інша дія
- swipe:
    from:
      id: "quote-item-0"
    direction: RIGHT
# Тягнемо список донизу для оновлення
- swipe:
    direction: DOWN
# Скролимо, поки не з'явиться останній елемент
- scrollUntilVisible:
    element:
      id: "list-end"
    direction: DOWN
# Довге натискання
- longPressOn:
    id: "quote-item-0"
```

### 3.5 Impatient & interrupted user (category `interrupt`)
- Double tap / triple tap on Submit → exactly one request / one item created.
- Tap Submit, then immediately back.
- Put the app in background during loading and return; kill the app mid-flow (`stopApp` / `killApp`) and reopen.
- Keyboard: open → rotate/background → return; tap outside to hide; does the keyboard cover the button?
- Incoming interruption (another app via `openLink`, system dialog) and return.

### 3.6 Network & server (category `network`)
- Every error code from the contract (400 validation, 401, 403, 404, 409, 429, 500) shows the right message.
- No internet at start; internet lost in the middle of submit (Android: `setAirplaneMode`/`toggleAirplaneMode`; otherwise stop the backend); slow server (if the backend has a delay switch).
- Retry after an error works; no duplicated data after retry.

### 3.7 State (category `state`)
- First launch / empty state (no data yet) — helpful message, no crash.
- Lots of data (seed many items) — scrolling, performance, layout.
- Expired session / token while on the screen → graceful re-login.
- Two devices / two tabs changing the same data if relevant.
- Logout and login as another user → no data from the previous user is visible.

### 3.8 Accessibility & visual (categories `a11y`, `visual`)
- Large system font, dark mode, small screen (iPhone SE size) and a big one.
- Every icon-only button has an accessibility label; tap targets are not tiny.
- Look at every screenshot: cut text, overlapping elements, wrong colours in dark mode, keyboard covering inputs, notch/safe-area problems, untranslated strings, placeholder text like `lorem` or `undefined`.

### 3.9 Responsive layout (web, category `responsive` — required at every depth)
Every web task that touches UI is checked at several screen widths. The helper does the mechanical part (overflow, overlap, clipping, covered controls); you choose the pages, states and extra manual looks.
- **Widths per depth** (min. distinct widths, counted by the script from `.pipeline/<id>/layout.jsonl`): `smoke` 3 (`WIDTHS.smoke` = 375, 768, 1280) · `deep` 7 (`WIDTHS.deep` = 320, 375, 414, 768, 1024, 1280, 1536) · `exhaustive` 13 (`WIDTHS.exhaustive` = 320 … 1920, includes 360, 390, 480, 600, 834, 1440).
- **What to open at each width:** every screen/route the task changed, **and** each state of it that can change the layout: empty, loading, error banner, success message, validation errors visible, long content, many items, open dropdown/modal/menu/drawer, expanded accordion.
- **Hostile content** (`deep`+): very long unbroken word (`Supercalifragilistic…` 60+ chars), long email, long Cyrillic name, number with many digits, 3-line title, text with emoji; and the opposite — 1 character.
- **Edge sizes** (`exhaustive`): phone landscape 844×390, short window 1280×500, tablet portrait/landscape (768×1024, 1024×768), page zoomed to 200% (browser zoom: `page.evaluate(() => { document.body.style.zoom = '2' })` or a 640px-wide viewport), large text (`html { font-size: 20px }`), a Safari-like engine when available (`QA_WEBKIT=1`).
- **What counts as a bug:** horizontal page scroll; anything outside the screen edge; text or buttons spilling out of their card; text cut without an ellipsis; two elements on top of each other; a button/input/link covered by a header, banner, cookie bar or modal; a menu that does not collapse or cannot be opened on a narrow screen; tap target < 24px on mobile widths; images stretched, cropped or broken; fixed header covering the content below it; keyboard (focus) landing on something hidden.
- **Look yourself too.** The helper attaches a full-page screenshot per width: open the first, middle and last width of each page with Read and judge what a script cannot: ugly spacing, unreadable contrast, misaligned columns, a table that is unusable on a phone, text too small.
- **Report** each problem with the width, the element selector, the screenshot and the severity (`major` when a control is unusable or content unreachable, `minor` when it is merely ugly).

## 4. Writing mobile flows (Maestro)

- **One case = one file**: `<e2eMobile.path>/<id>/AC-<n>-<category>-<short-name>.yaml`.
- Header: `appId: ${APP_ID}`, `name: "AC-1 · partial · без email"`, `tags: [AC-1, partial]` — tags are how coverage is counted.
- Reuse steps through sub-flows in `<e2eMobile.path>/_shared/` and pass data with `env`:
```yaml
appId: ${APP_ID}
name: "AC-1 · negative · email без @"
tags: [AC-1, negative]
---
# Відкриваємо форму з чистим станом
- runFlow: ../_shared/open-signup.yaml
# Заповнюємо всі поля коректно, крім email
- runFlow:
    file: ../_shared/fill-signup.yaml
    env:
      NAME: "Богдан"
      EMAIL: "bohdan.example.test"
      PASSWORD: "Test-Password-1"
- tapOn:
    id: "signup-submit"
# Очікуємо помилку саме під полем email
- assertVisible:
    id: "signup-email-error"
- assertNotVisible:
    id: "signup-name-error"
- takeScreenshot: AC-1-negative-email-no-at
```
- Useful commands: `tapOn`, `doubleTapOn`, `longPressOn`, `inputText`, `inputRandomEmail`, `inputRandomText`, `inputRandomNumber`, `eraseText`, `hideKeyboard`, `swipe`, `scroll`, `scrollUntilVisible`, `back`, `pressKey`, `assertVisible`, `assertNotVisible`, `assertTrue`, `extendedWaitUntil`, `waitForAnimationToEnd`, `stopApp`, `killApp`, `launchApp` (with `clearState`), `openLink`, `copyTextFrom`, `pasteText`, `repeat`, `runFlow` (with `env` and `when`), `takeScreenshot`.
- Every case asserts the **outcome** (what changed on screen / what must NOT appear), not only that taps worked.

## 5. Writing web tests (Playwright)

- Title format: `test('AC-1 [partial] без email', …)` — the `[category]` in brackets is how coverage is counted.
- Data-driven cases with a table + `for … of` loop are fine, but each row must be its own `test()` with its own title and tag.
- **Layout at many widths:** import the helper (`e2e/_helpers/layout-checks.ts`; if it is missing run `node ~/.claude/pipeline/pipeline.mjs template layout > <e2e.path>/_helpers/layout-checks.ts`). Pattern: `await eachWidth(page, WIDTHS.deep, async (w) => { await checkLayout(page, testInfo, { name: \`profile-${w}\` }); });` — one `test('AC-1 [responsive] …')` per screen/state. Use `WIDTHS[depth]`. `checkLayout` fails the test on overflow/overlap/clipping and records the width for the coverage check.
- Use `page.route` to simulate server errors/slow network, `context.setOffline(true)` for offline, `page.setViewportSize` for small screens, keyboard-only navigation (`Tab`, `Enter`, `Escape`).

## 6. Report honestly

- Never mark a case passed that you did not run. Can't automate it → `manual` with the exact steps for a human.
- A bug you found by exploring counts as much as a failing scripted case.
- Each failure: steps, expected vs actual, screenshot path, owner hint, severity (`critical` crash/data loss · `major` feature broken · `minor` wrong message · `cosmetic` layout).
