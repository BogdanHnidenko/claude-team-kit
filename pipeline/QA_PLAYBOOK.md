# QA playbook — test with your own eyes, like a meticulous human

You are not a script runner. You open the real app, look at it, use it the way a person would, and judge what you see.
Writing long test suites is NOT your job: the time limit is short (it is enforced) and every minute should go to looking and trying.

## 1. Depth, time and what must be covered

| Depth | Time limit | Min. checks per AC | Categories that must appear in `checks` |
|---|---|---|---|
| `smoke` (поверхневе) | 8 min | 1 | `happy` · web: layout at 3 widths |
| `deep` (поглиблене) | 20 min | 2 | `happy`, `negative`, `boundary`, `state` · web: layout at 7 widths · mobile also `interrupt` |
| `exhaustive` (дуже ретельне) | 45 min per platform | 4 | `happy`, `negative`, `boundary`, `state`, `navigation`, `interrupt`, `network`, `a11y`, `visual` · web: layout at 13 widths |

- The time limit starts at `pl eyes start …` and is enforced: after it, every action is refused (`TIME_UP`). Check the clock in each command's last line; leave 2 minutes for the report.
- A category that truly cannot apply goes into the report as `"not_applicable": { "network": "reason of at least 10 characters" }`.
- The spec's **Consistency** section (ids `K-1`, `K-2`…) lists things that must look the same on two surfaces (app screen ↔ email ↔ PDF). Every one must be checked (section 4).
- Check yourself: `pl coverage <id> web|mobile`.

## 2. Method: charter → act → look → decide

1. **Charters, not test cases.** From the spec's acceptance criteria and *Test focus*, write 5–10 one-line missions in your head or in `.pipeline/<id>/eyes/charters.md` ("fill the form with an emoji name and send it", "open the quote on a phone and check the totals"). Nothing else to plan.
2. **Start once:** `pl eyes start web` (or `pl eyes start mobile --platform ios`). It starts the needed services, opens the browser or simulator and starts the clock.
3. **Loop:** act (`click`, `fill`, `tap`, `type`…) → `look` (a screenshot and a list of what is on screen; open the screenshot with Read) → decide: is this what the spec promises and what a normal person would expect? Not sure what is expected → mark the check `blocked` and ask (`STATUS: QUESTIONS`), never invent expected behaviour.
4. **Look at every result** with your own eyes: cut text, overlapping elements, wrong colours, raw `undefined`/`null`/`NaN`, untranslated strings, wrong totals, empty states without a message, a button that looks pressed but did nothing.
5. **Record as you go** (the report is built from your observations, and every claim needs a screenshot from the journal).

Command cheat-sheet (`pl` = `node ~/.claude/pipeline/pipeline.mjs`; all take `--task <id>` when more than one task is running):

| Web | Mobile |
|---|---|
| `pl eyes goto /path` · `back` · `reload` | `pl eyes launch [--clear]` · `kill` · `background` · `foreground` |
| `pl eyes look [name] [--full] [--target testid:x]` | `pl eyes look [name]` |
| `click` / `dblclick` / `hover` / `check` `<target>` | `tap` / `longpress` `<target>` |
| `fill <target> <text>` · `type <target> <text>` (keystroke by keystroke) · `press Enter` · `select <target> <value>` | `type [<target>] <text>` · `hidekeyboard` |
| `scroll 400\|top\|bottom` · `wait [target] [ms]` | `swipe up\|down\|left\|right` · `scroll` · `scrollto <target>` · `back` |
| `resize <w> [h]` · **`sweep <name>`** (all widths of the depth + automatic layout audit) | `scheme dark\|light` · `font large\|normal` |
| `net offline\|online\|slow:3000` · `scheme dark\|light` · `clear` (cookies/storage) | `net offline\|online` (Android) · `backend stop\|start` (works on both) |
| `text [target] --out name` (visible text → file) · `eval "<js>"` | `text --out name` · `flow '<maestro yaml>'` (anything else) |

Targets: web `testid:send`, `text:Save`, `role:button:Save`, `label:Email`, `placeholder:…`, `css:…`, or just the word (tries testid → button → link → label → text). Mobile `id:send` (testID), `text:Save`, `point:50%,80%`, or the word. Use the spec's testIDs first, then what `look` shows.
Errors do not stop you: a failed click is information (the element is missing or covered), record it.

## 3. What to try (go through the sections that fit this task)

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

### 3.4 Gestures and input devices
- Mobile: swipe left/right on every list item (actions? undo? partial swipe?), swipe between tabs/pages (also at the first/last page), pull to refresh, scroll to the very end, long press (`swipe`, `scroll`, `scrollto`, `longpress`).
- Web: keyboard only (Tab order, Enter submits, Escape closes), hover states, double click, browser Back/Forward in the middle of a flow.

### 3.5 Impatient & interrupted user (category `interrupt`)
- Double tap / triple tap on Submit → exactly one request / one item created.
- Tap Submit, then immediately back.
- Put the app in background during loading and return; kill the app mid-flow (`pl eyes kill`, then `pl eyes launch`).
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
Every web task that touches UI is checked at several screen widths. The `pl eyes sweep` does the mechanical part (overflow, overlap, clipping, covered controls); you choose the pages, states and extra manual looks.
- **Widths per depth** (min. distinct widths, counted by the script from `.pipeline/<id>/layout.jsonl`): `smoke` 3 (375, 768, 1280) · `deep` 7 (320, 375, 414, 768, 1024, 1280, 1536) · `exhaustive` 13 (320 … 1920). **`pl eyes sweep <name>` runs all of them for the current page in seconds** (resize, automatic audit, full-page screenshot); you only decide which pages and states to sweep and then look at the screenshots it names.
- **What to open at each width:** every screen/route the task changed, **and** each state of it that can change the layout: empty, loading, error banner, success message, validation errors visible, long content, many items, open dropdown/modal/menu/drawer, expanded accordion.
- **Hostile content** (`deep`+): very long unbroken word (`Supercalifragilistic…` 60+ chars), long email, long Cyrillic name, number with many digits, 3-line title, text with emoji; and the opposite — 1 character.
- **Edge sizes** (`exhaustive`): phone landscape (`pl eyes resize 844 390`), short window (`resize 1280 500`), tablet (`resize 768 1024` and `1024 768`), zoom 200% (`pl eyes eval "document.body.style.zoom='2'"` or `resize 640`), large text (`pl eyes eval "document.documentElement.style.fontSize='20px'"`).
- **What counts as a bug:** horizontal page scroll; anything outside the screen edge; text or buttons spilling out of their card; text cut without an ellipsis; two elements on top of each other; a button/input/link covered by a header, banner, cookie bar or modal; a menu that does not collapse or cannot be opened on a narrow screen; tap target < 24px on mobile widths; images stretched, cropped or broken; fixed header covering the content below it; keyboard (focus) landing on something hidden.
- **Look yourself too.** `sweep` prints which screenshots to open (first, middle, last width and every one with errors). Read them: ugly spacing, unreadable contrast, misaligned columns, a table that is unusable on a phone, text too small.
- **Record** each problem as a check/finding with the width, the element selector, the screenshot and the severity (`major` when a control is unusable or content unreachable, `minor` when it is merely ugly).

## 4. Consistency between surfaces (app ↔ email ↔ PDF)

When the spec lists `K-n` items, or the task changes anything that is sent to a client, the same data must look the same everywhere it appears: amounts and currency, number formatting (`1,234.50` vs `1234.5`), dates and times, names, labels, order of lines, language.
1. Clear the mailbox first: `pl mail clear`. Do the action in the app that sends the email.
2. Capture the app side: `pl eyes text <target> --out app-total` (and `look` for the screenshot).
3. Capture the email: `pl mail wait --to <address>` (saves text and HTML), then `pl mail shot` renders it at 600 px (desktop) and 375 px (phone): open both screenshots with Read.
4. Compare: `pl compare app-total <mail-id> --name K-1`. It extracts amounts, dates, times, percentages, emails, phones and numbers from both texts and reports: same, same value in a **different format**, only in one of them. It also lists lines that differ.
5. Judge the rest with your eyes: layout of the email, readable on a phone, the same structure and wording, no broken characters.
6. Record it in `consistency` (section 6) with the compare file and the screenshots as evidence. `differs` is a finding (`owner_hint` = the service that renders the email or the screen).
Other surfaces (PDF, push text, export): get their text into a file, then `pl compare` the same way.

## 5. Time discipline
- Smoke: no exploration beyond the ACs. Deep: ~⅓ of the time on free exploration after the ACs. Exhaustive: ~½.
- Don't re-check what already passed. After a failure, record it with evidence and move on; do not debug the app (you never read its code).
- Take screenshots at decisions, not after every click: `look` only when you need to judge something.

## 6. Report: `.pipeline/<id>/qa.json` (web) or `qa-mobile.json` (mobile)

```json
{
  "task": "<id>", "verdict": "PASS | FAIL", "reason": null,
  "checks": [
    { "id": "C1", "ac": "AC-1", "category": "happy", "what": "send a quote to a client from the preview",
      "result": "passed | failed | blocked", "evidence": ["eyes/shots/004-preview.png"],
      "width": 375, "severity": "major", "note": "required for failed", "owner_hint": "frontend:web | backend:<service> | mobile:<app> | unknown" }
  ],
  "consistency": [
    { "id": "K-1", "a": "app: total on the quote screen", "b": "email to the client", "result": "same | differs | blocked",
      "diff": "app $1,234.50 vs email $1234.5", "evidence": ["eyes/compare/01-K-1.json", "eyes/shots/006-mail-375.png"], "owner_hint": "backend:mailer" }
  ],
  "findings": [
    { "id": "F1", "severity": "blocker | major | minor", "ac": "AC-1", "title": "…", "steps": ["…"], "expected": "…", "actual": "…",
      "evidence": ["eyes/shots/002-after-send.png"], "owner_hint": "frontend:web" }
  ],
  "not_applicable": { "network": "the feature works fully offline — no server calls" }
}
```
- `evidence` are paths from the commands' output (`.pipeline/<id>/` prefix optional). **Only files made by `pl eyes` / `pl mail` / `pl compare` are accepted**; anything else is rejected.
- Severity: `blocker` crash/data loss/feature unusable · `major` feature wrong or control unusable · `minor` wording/cosmetic.
- Finish with `pl eyes finish`: it validates the report against the journal, fills `results` and `verdict`, and prints problems to fix. Then `pl coverage <id> web|mobile`. The stamp is set by the orchestrator side.
- Never mark a check passed that you did not do. A bug found by exploring counts as much as an AC check.
- If a finding must never come back and is cheap to automate, you may add ONE short regression test (Playwright under `e2e/`, Maestro under `e2e-mobile/`) — optional, not a gate.
