# <Feature title>

- **Task id:** <id>
- **Services:** <users (backend), gateway (backend), web (frontend)>
- **Infra changes:** yes | no
- **QA:** e2e | api-only | skip (reason)

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
- **Required `data-testid`:** ...

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
- **Risky cases specific to this feature:** e.g. offline while saving, double submit, very long input.

## 7. Out of scope
- ...
