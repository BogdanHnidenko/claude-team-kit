# <Feature title>

- **Task id:** <id>
- **Services:** <users (backend), gateway (backend), web (frontend)>
- **Infra changes:** yes | no
- **QA:** e2e | api-only | skip (reason)
- **Design:** none | docs/design/<id>.md (the designer's document; its V-n are copied into the acceptance criteria below)

## 1. Goal
One or two sentences: who gets what, and why.

## 2. Service changes
List only the services that change, in build order (providers before consumers).

### <service-name> (backend)
- **DB:** tables / columns / constraints / indexes. Migration must be reversible.
- **Endpoints / consumers:** what is added or changed.
- **Calls to other services:** sync HTTP or async event, timeout, behaviour on failure, idempotency.
- **Env vars:** name, purpose, secret yes/no.

### <web> (frontend)
- **Route / place in UI:**
- **States:** idle, loading, success, validation error, server error, empty.
- **Required `data-testid`:** ... (names fixed here by the PM: developers use exactly these, the tester relies on them)

### <app> (mobile, if any)
- **Screen / place in the app:**
- **States:** idle, loading, success, validation error, server error, offline, empty.
- **Required `testID`:** ... (fixed here by the PM, same rule)

## 3. Contracts
- **HTTP:** `contracts/<service>.openapi.yaml` — paths added/changed, request/response schemas.
- **Events:** `contracts/events/<event-name>.json` — producer → consumers, payload schema, version.
- **Auth per endpoint:** public | user | admin | internal (service-to-service).
- **Errors:** `400 VALIDATION_ERROR`, `401`, `403`, `404`, `409`, `429`, `500` — body `{ code, message, fields? }`.
- **Limits:** rate limits, max payload / page size.

## 4. Infra / deploy
- Docker / compose / CI changes.
- Migration order at deploy, backwards compatibility during rollout.
- New env vars per environment.

## 5. Acceptance criteria
1. AC-1: ...
2. AC-2: ...
3. AC-3: ...

## 6. Test focus (for QA)
- **What changed for the user:** screens / flows / API that are new or different.
- **What could break nearby:** neighbouring flows that share the same screens, data or API (e.g. auth change → login, logout, session expiry, deep links into protected screens).
- **Not to re-test:** unrelated parts of the app.
- **Screens and states to check at different widths (web):** which pages / states change the layout (empty, error, long text, open menu or modal, many items); anything known to be tight on a phone.
- **Risky cases specific to this feature:** e.g. offline while saving, double submit, very long input.

## 6a. Consistency between surfaces (what must look the same in two places)
Fill this in whenever the task touches data that is shown in the app AND sent or exported somewhere (email to a client, PDF, push text, another screen). The tester compares both sides (amounts, number formats, dates, names, order of lines, wording, layout on a phone). No such data → write `none` and no K-items.
| id | surface A | surface B | what must match |
|---|---|---|---|
| K-1 | e.g. quote screen in the app | e.g. the email sent to the client | totals, currency format, dates, line order, language |

## 6b. Test matrix and risk (helps the tester NOT to test everything)
Fill this in whenever the feature multiplies across languages, screens, roles, currencies, devices or document types. The tester takes one representative per class and expands only where a bug is found.
- **Risk per AC:** high (new logic, money, data) / medium / low (copy or style only): one line each if not obvious.
| dimension | class (similar behaviour) | members | why they differ from other classes |
|---|---|---|---|
| language | long-latin | de, fr, es, it | long words: text gets cut first |
| language | cyrillic | uk | different script and diacritics, font fallback |
| screen | editor / preview / PDF | … | … |
- **Already covered by automated tests:** …
No multiplication → write `none`.

## 7. Decisions (questions answered by the user)
Every question an agent asked and the user's answer — agents read this before asking again.
| # | Question | Answer | Asked by | Date |
|---|---|---|---|---|

## 8. Out of scope
- ...
