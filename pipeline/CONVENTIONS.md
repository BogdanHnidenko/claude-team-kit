# Coding conventions (all team agents)

These rules apply to every file an agent writes: services, apps, tests, scripts, infra code.
A service's own `CLAUDE.md` can add rules; it cannot switch off the comment rules below.

## 1. Comments — language: {{LANGUAGE}}, level: {{LEVEL}}

All comments are written in **{{LANGUAGE}}**. Identifiers (names of functions, variables, types, files) stay in English.
Commit messages, branch names and API field names stay in English.

**Every function, method, class, React/Vue component and hook** gets a JSDoc block right above it:
- first line — what it does and why (not a retelling of the code);
- `@param` for each parameter, `@returns`, `@throws` when it can throw;
- for components — what it renders and its key props.

**Every variable and constant** (`const`, `let`, `var`, including inside functions, when level is `all`)
gets a short comment: on the line above, or at the end of the same line for short ones.
Level `functions` = functions, classes, methods, components, module-level variables and function-valued variables only.

Examples:

```ts
/**
 * Змінює email користувача після перевірки поточного пароля.
 * @param userId - ідентифікатор користувача
 * @param newEmail - нова адреса електронної пошти
 * @param password - поточний пароль для підтвердження
 * @returns оновлений профіль без чутливих полів
 * @throws ConflictError якщо email вже зайнятий
 */
export async function changeEmail(userId: string, newEmail: string, password: string): Promise<PublicProfile> {
  // Користувач з бази разом із хешем пароля
  const user = await usersRepo.findWithPassword(userId);
  const MAX_ATTEMPTS = 5; // ліміт спроб до тимчасового блокування
  // ...
}
```

```vue
<script setup lang="ts">
/** Форма зміни email у профілі; показує помилки валідації з сервера. */

// Поточне значення поля email
const email = ref('');

/**
 * Відправляє форму і переходить на сторінку профілю після успіху.
 */
async function onSubmit() { /* ... */ }
</script>
```

```tsx
/**
 * Екран налаштувань профілю у мобільному додатку.
 * @param navigation - навігатор стеку налаштувань
 */
export function ProfileSettingsScreen({ navigation }: Props) {
  // Стан відправки форми, блокує кнопку під час запиту
  const [isSaving, setIsSaving] = useState(false);
  // ...
}
```

Rules for good comments:
- Explain intent, constraints, units, edge cases — not syntax ("// додаємо 1" is useless).
- Keep comments true: when you change code, update its comment.
- Tool directives (`// eslint-disable-next-line`, `// @ts-expect-error`) don't count as comments — add a real comment too.
- Maestro / YAML flows: a `#` comment in {{LANGUAGE}} above each logical step.

The pipeline checks this automatically for JS/TS/Vue files (`verify` step `comments`).
Run `node ~/.claude/pipeline/pipeline.mjs comments <task-id> <service>` before you report DONE and fix every line it lists.

## 2. Language of reports
- Your reports in `.pipeline/<id>/*.md` and the free-text parts of your reply (NOTES, error explanations, findings `impact`/`fix`, QA `error`) are written in **{{REPLY_LANGUAGE}}**.
- Keep in English: reply keys and values the script reads (`STATUS: DONE`, `SERVICE:`, `verdict: PASS|FAIL|BLOCK`, severity names), code, paths, commands.

## 3. Quality bar — work like the best engineer on the team
- **Understand before you type.** Read the spec, the contracts, the service's `CLAUDE.md` and the code you will touch. Know which other code calls what you change (`grep` usages) before changing a signature.
- **Never guess.** If something that changes behaviour, data, UX or a contract is unclear, ask (see §4). Guessing and "probably fine" are not allowed.
- **Handle every path**, not just the happy one: empty, null/undefined, errors from every call, timeouts, concurrent calls, permissions, very large and very small inputs.
- **Tests prove it**: a test for each branch you add (happy + each error/edge); a bug fix starts with a test that fails without the fix.
- **No leftovers**: no `console.log`/debug code, no commented-out code, no `TODO` without a reason, no unused imports/variables, no `any` without a comment, no magic numbers without a named constant.
- **Self-review before you report DONE** — read your own diff top to bottom as a strict reviewer and fix what you find:
  1. Does every acceptance criterion work? Did I check it, not assume it?
  2. Any edge case or error path not handled? Any user-visible text missing or untranslated?
  3. Any security issue (input validation, auth/ownership, secrets, injection, unsafe rendering)?
  4. Names clear, functions small, no duplication, matches the existing style of the service?
  5. Every new function/variable has its comment in {{LANGUAGE}}?
  6. Lint, typecheck, tests, comments check — all green, run by me just now?
- **Report the truth**: what you did, what you did NOT do, what you are unsure about. Never claim something works without having run it.

## 4. Questions instead of guesses
You cannot talk to the user directly — the orchestrator relays your questions and brings the answers back.
- **Blocking question** (the answer changes data model, contract, behaviour the user sees, security, or which approach to take) → do not write the code that depends on it. Reply with `STATUS: QUESTIONS` and the list below. Do the parts that don't depend on the answer first, and say what is already done.
- **Non-blocking** (a reasonable default exists and is cheap to change) → proceed with the default, and list it under `ASSUMPTIONS:` so the orchestrator can confirm it with the user.
- Format each question so the user can answer in one tap:
  ```
  QUESTIONS:
  1. <question in {{REPLY_LANGUAGE}}>
     why it matters: <one line>
     options: A) <option>  B) <option>  C) <option>
     my recommendation: <A/B/C and why>
  ```
- Before asking, check `docs/specs/<id>.md` → section **Decisions** — the answer may already be there.

## 5. General
- TypeScript strict; no `any` without a comment explaining why.
- Small focused files; no drive-by refactors outside the task.
- Validate external input at the boundary; never trust the client.
- No secrets in code; document new env vars in `.env.example`.
- Follow the existing patterns of the service before inventing new ones.

## 6. Workspace-specific rules
