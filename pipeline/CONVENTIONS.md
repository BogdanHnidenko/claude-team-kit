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

## 3. General
- TypeScript strict; no `any` without a comment explaining why.
- Small focused files; no drive-by refactors outside the task.
- Validate external input at the boundary; never trust the client.
- No secrets in code; document new env vars in `.env.example`.
- Follow the existing patterns of the service before inventing new ones.

## 4. Workspace-specific rules
