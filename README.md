# Claude Team Kit — AI-команда для веб- і мобільних проєктів

Це набір агентів для Claude Code. Він ставиться **один раз на комп'ютер** і далі працює в будь-якому проєкті.
У проєкті з'являється тільки один файл-«паспорт», `.pipeline/workspace.json`, а створює його сам Claude.

**Зміст**
- [Частина A. Один раз на комп'ютер](#частина-a-один-раз-на-компютер) — встановити кіт
- [Частина B. Тільки для мобільних додатків](#частина-b-тільки-для-мобільних-додатків-один-раз-на-компютер) — Java, Android, Xcode, Maestro, `~/.zshenv`
- [Частина C. Один раз на кожен проєкт](#частина-c-один-раз-на-кожен-проєкт) — підключити проєкт
- [Частина D. Щоденна робота](#частина-d-щоденна-робота)
- [Частина E. Що де лежить і що куди вписувати](#частина-e-що-де-лежить-і-що-куди-вписувати)
- [Частина F. Як усе влаштовано](#частина-f-як-усе-влаштовано)
- [Частина G. Якщо щось не працює](#частина-g-якщо-щось-не-працює)
- [Частина H. Усі команди](#частина-h-усі-команди) — повний довідник
- [Частина I. Один проєкт із підпроєктами (git submodules)](#частина-i-один-проєкт-із-підпроєктами-git-submodules) — web, mobile, backend зі своєю історією всередині одного проєкту

### Дві речі, які варто знати перед стартом
- **`~`** — це твоя домашня тека. На Mac це `/Users/<твоє-імʼя>`, наприклад `/Users/bohdanhnidenko`. Тобто `~/.zshenv` = `/Users/bohdanhnidenko/.zshenv`.
- **Крапка на початку назви** (`.claude`, `.zshenv`, `.pipeline`) робить файл чи теку прихованими. У Finder їх видно, якщо натиснути `Cmd + Shift + .`. У терміналі їх показує `ls -la`.

---

## Частина A. Один раз на комп'ютер

### A1. Перевір, що є Node.js і git

```bash
node -v     # потрібно v18 або новіше
git --version
```

Якщо `node` не знайдено, встанови його з https://nodejs.org (версія LTS) і перезапусти термінал.

### A2. Скачай кіт

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/<ТВІЙ_НІК>/claude-team-kit.git
```

Тепер кіт лежить у `~/dev/claude-team-kit`.
⚠️ **Не видаляй і не переміщуй цю теку.** Claude читає налаштування саме звідти.

### A3. Встанови

```bash
cd ~/dev/claude-team-kit
bash install.sh --link
```

Що зробила ця команда:
| Куди | Що | Навіщо |
|---|---|---|
| `~/.claude/agents/` | посилання на 7 агентів `team-…` | Claude Code бачить їх у всіх проєктах |
| `~/.claude/commands/` | посилання на команди `/feature`, `/pipeline-init-web`, … | щоб з'явились слеш-команди |
| `~/.claude/pipeline/` | посилання на «двигун» `pipeline.mjs` і правила | точні операції: гілки, перевірки, коміти |
| `~/.claude/settings.json` | охоронець + дозволи | блокує `git push`, читання `.env` тощо |
| `~/.claude/CLAUDE.md` | блок «відповідай українською» | Claude відповідає українською в усіх сесіях |

`~/.claude` — це загальна тека Claude Code для твого користувача на цьому Mac. Твої власні налаштування в ній не перезаписуються, а від змінених файлів робляться копії `.bak.<час>`.

### A4. Перевір

```bash
node ~/.claude/pipeline/pipeline.mjs doctor
```

✅ Має бути `✔ node …`, `✔ git …`, `✔ guard hook installed`.
⚠️ Рядок `no .pipeline/workspace.json here` зараз нормальний: ти не в проєкті.

Потім відкрий Claude Code (`claude` у терміналі; якщо він був відкритий, закрий і відкрий знову):
- напиши `/agents` → у списку має бути 7 агентів `team-…`;
- напиши `/` → у підказках мають бути `/feature`, `/pipeline-init-web`, `/pipeline-init-mobile`.

### A5. Як оновлювати кіт потім

```bash
cd ~/dev/claude-team-kit && git pull && bash install.sh --link
```

Після цього перезапусти Claude Code.

---

## Частина B. Тільки для мобільних додатків (один раз на комп'ютер)

Якщо робиш лише веб, пропусти цю частину.

### B1. Android Studio (емулятор Android + Java)

1. Скачай і встанови Android Studio: https://developer.android.com/studio
2. Відкрий її → **More Actions → SDK Manager**:
   - вкладка **SDK Platforms**: постав галочку на одній свіжій версії Android (наприклад, Android 15 / API 35);
   - вкладка **SDK Tools**: галочки на **Android SDK Build-Tools**, **Android Emulator**, **Android SDK Platform-Tools** → **Apply**.
3. **More Actions → Virtual Device Manager → Create Device** → вибери, наприклад, Pixel 8 → систему API 35 → **Finish**.
4. Запам'ятай **точну назву** емулятора (AVD). Вона знадобиться в кроці B5.

Java окремо ставити не треба: вона вже є всередині Android Studio (папка `jbr`), і нижче ми просто вкажемо до неї шлях.

### B2. Xcode (симулятор iPhone), тільки на Mac

1. Встанови **Xcode** з App Store (він великий, це займе час).
2. Один раз виконай у терміналі:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   xcodebuild -runFirstLaunch
   ```
3. Відкрий Xcode → **Settings → Components** (або **Platforms**) → встанови **iOS** (симулятор).
4. Для React Native потрібен CocoaPods:
   ```bash
   brew install cocoapods
   ```
   Якщо `brew` не знайдено, спершу встанови Homebrew з https://brew.sh.

### B3. Maestro (запускає тести на симуляторі)

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

Він встановиться в `~/.maestro/bin`. Цю команду запускаєш **ти сам**: агентам таке заборонено правилами безпеки.

### B4. Пропиши шляхи в `~/.zshenv`

Термінал на Mac (zsh) читає файл `~/.zshenv` при кожному запуску, і Claude Code теж. Там ми скажемо, де лежать Java, Android-інструменти і Maestro.
`~/.zshenv` — це не тека, а прихований **файл** у домашній теці (`/Users/<твоє-імʼя>/.zshenv`). Якщо його ще немає, це нормально.

1. Створи (якщо його немає) і відкрий файл:
   ```bash
   touch ~/.zshenv && open -e ~/.zshenv
   ```
   `touch` створює файл, тільки якщо його ще немає, а якщо він є, нічого в ньому не змінює. `open -e` відкриває файл у TextEdit.

2. Встав у кінець файлу цей блок:
   ```sh
   # Claude Team Kit — інструменти для мобільних тестів
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$PATH:$HOME/.maestro/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin"
   ```
   Що це означає:
   - `JAVA_HOME` — де лежить Java (та, що вбудована в Android Studio). Вона потрібна Maestro і збірці Android.
   - `ANDROID_HOME` — де Android Studio тримає SDK.
   - `PATH` — список тек, де термінал шукає команди. Ми додаємо туди `maestro`, `adb` і `emulator`.

3. Збережи: `Cmd + S`. Якщо TextEdit пропонує формат, файл має лишитися **простим текстом** (меню **Format → Make Plain Text**).

4. Закрий **усі** вікна терміналу і відкрий новий. Якщо Claude Code був запущений, перезапусти і його.

### B5. Перевір мобільні інструменти

У новому вікні терміналу:

```bash
java -version                         # має показати версію 17 або новішу
adb version                           # Android Debug Bridge …
emulator -list-avds                   # назва твого емулятора, напр. Pixel_8_API_35
maestro --version                     # версія Maestro
xcrun simctl list devices available   # список симуляторів iPhone (тільки Mac)
```

Запиши дві назви, вони підуть у налаштування проєкту:
- **назва емулятора Android** з `emulator -list-avds`, наприклад `Pixel_8_API_35`;
- **назва симулятора iPhone** з `xcrun simctl list devices available`, наприклад `iPhone 16`.

Якщо якась команда пише `command not found`, дивись [Частину G](#частина-g-якщо-щось-не-працює).

---

## Частина C. Один раз на кожен проєкт

### C1. Підготуй теку проєкту

Структура може бути будь-яка. Головне, щоб усе було в одній теці (воркспейсі):

```
myapp/                    ← сюди заходиш і тут запускаєш claude
├── backend/              ← або services/users, services/orders …
├── web/                  ← сайт (якщо є)
└── mobile/               ← React Native / Expo додаток (якщо є)
```

Кожна підтека може бути окремим git-репозиторієм або частиною одного спільного.

**Новий проєкт:**
```bash
mkdir ~/projects/myapp && cd ~/projects/myapp
git init
# створи або склонуй сюди backend/, web/, mobile/ …
git add -A && git commit -m "init"
```

**Існуючий проєкт:**
```bash
cd ~/projects/myapp
git add -A && git commit -m "save before pipeline"
```
Пайплайн не стартує, якщо є незбережені зміни. Тому спершу закоміть.
Якщо в підтеці окремий репозиторій, закоміть і там.

### C2. Підключи проєкт до агентів

```bash
cd ~/projects/myapp
claude
```

Всередині Claude напиши **одну** команду:

```
/pipeline-init
```

Вона універсальна: сама проходить по всіх папках і знаходить сайти, мобільні додатки, бекенди, воркери, інфраструктуру й сабмодулі. Потім **зв'язує проєкти між собою** (хто кого викликає) і кожному налаштовує власне тестування.

Якщо хочеш налаштувати тільки одну частину, є вузькі варіанти: `/pipeline-init-web` (лише сайт + бекенди) і `/pipeline-init-mobile` (лише додаток + бекенди). Будь-яку з команд можна запускати повторно: вона доповнює маніфест і нічого не стирає.

Що буде далі: Claude покаже таблицю сервісів, **схему зв'язків** (наприклад `mobile → api`, `web → api`) і що треба перевірити, а також поставить до 4 питань. Для мобільного він ще перевірить назви симулятора й емулятора з кроку B5. Після твого «ок» він створить:

| Що | Навіщо |
|---|---|
| `.pipeline/workspace.json` | «паспорт» проєкту: які сервіси, де лежать, як перевіряти і деплоїти |
| `docs/specs/_TEMPLATE.md` | шаблон ТЗ, за яким Оркестратор пише задачі |
| `contracts/` | опис API між бекендом і клієнтами |
| `e2e/` | веб-тести Playwright |
| `e2e-mobile/` | мобільні сценарії Maestro |
| рядки в `.gitignore` | щоб тимчасові файли пайплайну не потрапляли в git |

### C3. Доустанови тестові інструменти проєкту

**Для веб-тестів** (Claude запропонує те саме):
```bash
cd e2e
npm init -y
npm i -D @playwright/test typescript
npx playwright install chromium
cd ..
```

**Для мобільного** запусти smoke-тест: він доводить, що збірка, встановлення і Maestro працюють. `/pipeline-init-mobile` запропонує його в кінці, просто погодься. Перша збірка iOS може йти 10–20 хвилин, це нормально.

### C4. Перевір і закоміть

```bash
node ~/.claude/pipeline/pipeline.mjs doctor
git add -A && git commit -m "add claude team pipeline"
```

✅ У `doctor` біля кожного сервісу має бути `✔`. Попередження `no lint/typecheck/test` означають, що в сервісі немає таких npm-скриптів. Агенти працюватимуть, але перевірок буде менше. Варто їх додати.

---

## Частина D. Щоденна робота

У теці проєкту запусти `claude` і пиши задачі так:

```
/feature Користувач може змінити email у профілі (веб і мобільний), з підтвердженням паролем
```

Агенти самі пройдуть етапи і писатимуть статус українською:

```
[1/6] план: docs/specs/change-email.md — сервіси users, web, mobile
[2/6] розробка: users ✔ → web ✔, mobile ✔
[3/6] безпека: BLOCK (1 high — немає rate limit) → виправлення 1/3
[3/6] безпека: PASS
[4/6] QA: веб PASS 4/4, мобільний PASS 4/4 (iOS + Android)
[5/6] перевірка і коміт: users 1a2b3c4, web 5d6e7f8, mobile 9a0b1c2
```

**Пушиш ти сам**, коли переглянеш результат: `git push` у потрібних репозиторіях.

| Команда | Що робить |
|---|---|
| `/feature <опис>` | нова задача від ТЗ до коміту |
| `/pipeline-status` | що зараз у роботі, де зупинилось |
| `/resume <назва-задачі>` | продовжити перервану задачу |
| `/audit` | тільки перевірка безпеки поточних змін |
| `/deploy <середовище> [задача]` | деплой за налаштуваннями (production — тільки після твого «так») |

---

## Частина E. Що де лежить і що куди вписувати

### Файли на твоєму комп'ютері (не в проєкті)

| Файл / тека | Що там | Чи треба редагувати |
|---|---|---|
| `~/dev/claude-team-kit/` | сам кіт (твій git-репо) | так, якщо хочеш змінити агентів чи правила; потім `git push` |
| `~/.claude/agents/`, `commands/`, `pipeline/` | посилання на кіт | ❌ ні, їх створює `install.sh` |
| `~/.claude/settings.json` | охоронець і дозволи Claude Code | зазвичай ні |
| `~/.claude/CLAUDE.md` | твої загальні правила для Claude + блок «українською» | можна дописувати свої правила **поза** блоком `claude-team-kit` |
| `~/.zshenv` | шляхи до Java, Android, Maestro | один раз (крок B4) |

### Файли в проєкті

| Файл | Хто створює | Що вписувати руками |
|---|---|---|
| `.pipeline/workspace.json` | `/pipeline-init-…` | виправляти, якщо Claude щось визначив не так (див. нижче) |
| `<сервіс>/CLAUDE.md` | ти (необов'язково) | правила саме цього сервісу: бібліотеки, патерни, стиль |
| `docs/specs/*.md` | Оркестратор | нічого, але можна читати і правити ТЗ |
| `.pipeline/<задача>/` | пайплайн | нічого — звіти, diff, скріншоти тестів |

### Головні поля `workspace.json`

Повний приклад: `node ~/.claude/pipeline/pipeline.mjs template workspace`.

**Мова і коментарі:**
```json
"conventions": {
  "replyLanguage": "uk",
  "comments": { "language": "uk", "level": "all", "enforce": true },
  "extra": ["Усі суми зберігаємо в копійках (integer)."]
}
```
- `replyLanguage` — мова відповідей і статусів;
- `comments.level`: `all` = коментар до кожної функції і змінної; `functions` = лише функції, класи і змінні верхнього рівня;
- `extra` — будь-які правила проєкту, їх отримають усі агенти.

**Сервіс (бекенд або веб):**
```json
{
  "name": "users",
  "type": "backend",
  "path": "services/users",
  "stack": "Node 20 + Express + TypeScript + PostgreSQL",
  "commands": { "lint": "npm run lint", "typecheck": "npx tsc --noEmit", "test": "npx vitest run", "build": "npm run build" },
  "dev": { "start": "npm run dev", "url": "http://localhost:3001/health" }
}
```
- `type`: `frontend` (сайт), `mobile` (додаток), `backend`, `worker`, `library`, `infra`;
- `commands` — як перевірити сервіс (виконується в його теці);
- `dev` — як запустити його локально для тестів і за якою адресою перевірити, що він живий;
- `dependsOn` — **зв'язки**: від яких сервісів цей залежить (кого він викликає). Приклад для додатку: `"dependsOn": ["api"]`.

**Зв'язки між проєктами (`dependsOn`)**

`/pipeline-init` знаходить їх сам, тобі лишається перевірити:
- за адресами в конфігах: якщо в `mobile/.env.example` є `http://localhost:4000`, а бекенд працює на `4000`, то `mobile → api`;
- за назвами змінних: `USERS_SERVICE_URL` означає зв'язок із сервісом `users`;
- за `depends_on` у `docker-compose.yml`.

Навіщо вони потрібні:
| Де | Що дають |
|---|---|
| План задачі | змінюється API бекенду → оркестратор бачить, які клієнти теж треба оновити |
| Порядок розробки | спершу той, хто надає API, потім ті, хто його використовує; незалежні — паралельно |
| Тести | веб-тести піднімають сайт і лише його бекенди; мобільні — лише бекенди додатку |

Подивитись: `pl services` → колонки **uses** і **used by**.

**Тестування кожного проєкту**
| Тип | Своє тестування |
|---|---|
| усі | `commands`: lint, typecheck, test, build — у своїй теці під час verify |
| `frontend` (сайт) | + Playwright у браузері (`e2e/`, агент `team-qa`) |
| `mobile` | + Maestro на iOS-симуляторі й Android-емуляторі (`e2e-mobile/`, агент `team-qa-mobile`) |
| `backend` / `worker` | + API-тести (`team-qa`) і перевірка через клієнтів, які від нього залежать |

**Мобільний додаток** — тут найчастіше треба вписати свої значення:
```json
{
  "name": "mobile",
  "type": "mobile",
  "path": "mobile",
  "commands": { "lint": "npm run lint", "typecheck": "npx tsc --noEmit", "test": "npx jest --ci" },
  "mobile": {
    "framework": "expo",
    "platforms": ["ios", "android"],
    "appId":  { "ios": "com.bohdan.myapp", "android": "com.bohdan.myapp" },
    "device": { "ios": "iPhone 16", "android": "Pixel_8_API_35" },
    "build": {
      "ios": "npx expo run:ios --configuration Release --no-bundler --device \"{device}\"",
      "android": "npx expo run:android --variant release --no-bundler"
    }
  }
}
```
| Поле | Де взяти значення |
|---|---|
| `appId.ios` | `app.json` → `expo.ios.bundleIdentifier` |
| `appId.android` | `app.json` → `expo.android.package` |
| `device.ios` | точна назва з `xcrun simctl list devices available` |
| `device.android` | точна назва з `emulator -list-avds` |
| `build` | для Expo як вище; для «голого» RN: `npx react-native run-ios --mode Release --simulator "{device}" --no-packager` і `npx react-native run-android --mode release --no-packager` |
| `platforms` | `["ios","android"]` на Mac, `["android"]` на Windows/Linux |

**Деплой** (необов'язково):
```json
"deploy": {
  "environments": {
    "staging":     { "steps": [{ "name": "up", "cwd": "infra", "run": "docker compose up -d --build" }],
                     "healthchecks": ["http://localhost:3000/health"],
                     "rollback": [{ "name": "down", "cwd": "infra", "run": "docker compose down" }] },
    "production":  { "requireApproval": true, "steps": [{ "run": "gh workflow run deploy.yml" }] },
    "mobile-store":{ "requireApproval": true, "steps": [{ "cwd": "mobile", "run": "npx eas-cli build --profile production --platform all --non-interactive --auto-submit" }] }
  }
}
```
`requireApproval: true` означає, що деплой піде тільки після твого «так» у чаті і підтвердження команди.

---

## Частина F. Як усе влаштовано

### Команда агентів
| Роль | Веб | Мобільний |
|---|---|---|
| Оркестратор (головна сесія) | ТЗ, контракти, керує всіма | те саме |
| Бекенд | `team-backend` | `team-backend` (той самий) |
| Клієнт | `team-frontend` | `team-mobile` |
| Безпека | `team-security` — бачить тільки diff | + мобільний чекліст |
| Тести | `team-qa` — Playwright у браузері | `team-qa-mobile` — Maestro на симуляторі |
| DevOps | `team-devops` — Docker, CI, коміти, деплой | + EAS build/submit |

### Етапи задачі
1. **План.** Оркестратор пише ТЗ і контракти, створює гілки `feat/<задача>`.
2. **Розробка.** Спершу бекенди, потім сайт і додаток (паралельно), потім інфраструктура.
3. **Безпека.** Пентестер бачить **тільки** зміни коду, без ТЗ і переписки, тому оцінює неупереджено.
4. **Тести.** Веб тестується в браузері. Мобільний на симуляторі: скрипт вмикає симулятор, піднімає бекенди, збирає додаток (тільки якщо код змінився), проганяє сценарії і робить скріншоти. Агент переглядає скріншоти і лог.
5. **Перевірка і коміт.** Спершу коментарі українською, потім lint → typecheck → test → build, і коміт у кожному репозиторії.
6. **Деплой.** Тільки якщо ти попросив.

### Що гарантує скрипт (а не обіцянка агента)
- Коміт можливий тільки після PASS безпеки, тестів і перевірки.
- Якщо код змінився після перевірок, коміт відхиляється.
- Функція чи змінна без коментаря українською не пройде перевірку.
- `.env`, ключі (`*.pem`, `*.key`, `*.p12`) і файли понад 1 MB не комітяться.
- Максимум 3 спроби виправлення, далі відкат через `git stash` (роботу можна відновити).
- `git push`, `reset --hard`, `git clean`, читання `.env` і `curl | sh` заблоковані (тільки в теках з `.pipeline/workspace.json`).
- Production-деплой можливий тільки після твого підтвердження.

### Чесно про обмеження
- Те, що агент пише тільки «у свою» теку, тримається на інструкції. Порушення видно в diff.
- Перевірка коментарів спрощена: більшість випадків ловить, але дуже нестандартний код може пропустити.
- iOS-симулятор працює тільки на Mac.
- Push-сповіщення, камера, покупки й біометрія на симуляторі не тестуються: агент позначає їх як `manual`.
- Великі задачі (diff понад 3000 рядків) дорожчі й менш точні, краще ділити.

---

## Частина G. Якщо щось не працює

| Симптом | Що зробити |
|---|---|
| `/agents` не показує `team-…` | `cd ~/dev/claude-team-kit && bash install.sh --link`, потім перезапусти Claude Code |
| `ls -la ~/.claude/agents` показує червоні / зламані посилання | ти перемістив теку кіта. Поверни її в `~/dev/claude-team-kit` або перевстанови звідти, де вона зараз |
| `java: command not found` або Maestro скаржиться на Java | перевір шлях: `ls "/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. Якщо такої теки немає, виправ `JAVA_HOME` у `~/.zshenv` на свій шлях |
| `adb` / `emulator: command not found` | перевір, що SDK є: `ls ~/Library/Android/sdk`. Якщо SDK в іншому місці (Android Studio → Settings → Android SDK → *Android SDK Location*), впиши цей шлях в `ANDROID_HOME` у `~/.zshenv` |
| `maestro: command not found` | `ls ~/.maestro/bin`. Якщо порожньо, повтори крок B3 |
| Змінив `~/.zshenv`, а нічого не змінилось | закрий **усі** вікна терміналу й Claude Code та відкрий заново (або `source ~/.zshenv`) |
| `iOS simulator "…" not found` | впиши в `workspace.json` → `mobile.device.ios` точну назву з `xcrun simctl list devices available` |
| `AVD "…" not found` | впиши в `mobile.device.android` точну назву з `emulator -list-avds` |
| Збірка iOS падає на CocoaPods | `brew install cocoapods`, потім у теці додатку `npx pod-install` |
| Додаток на емуляторі не бачить бекенд | в додатку адреса API має бути `http://localhost:<порт>` (скрипт сам прокидає порти в Android). Перевір, що вона не захардкоджена на віддалений сервер |
| `has uncommitted changes` при старті задачі | закоміть або сховай (`git stash`) зміни в тому репозиторії, який названо |
| `Commit refused` | прочитай причину: зазвичай треба повторити етап, який там названо. Оркестратор робить це сам |
| Хочеш повністю прибрати кіт | `cd ~/dev/claude-team-kit && bash uninstall.sh` (файли проєктів не зачіпаються) |

Загальна діагностика: `node ~/.claude/pipeline/pipeline.mjs doctor`. Запускай у теці проєкту, і він покаже, що саме не так.

---

## Частина H. Усі команди

Команди бувають трьох видів:
1. **Слеш-команди**: пишеш у чаті Claude Code (`/feature …`). Це основний спосіб роботи.
2. **Команди двигуна** `pipeline.mjs`: виконуються в терміналі. Здебільшого їх запускають самі агенти, але ти теж можеш, щоб щось перевірити.
3. **Скрипти встановлення**: `install.sh` / `uninstall.sh`.

### H1. Слеш-команди (у чаті Claude Code)

| Команда | Коли використовувати | Приклад |
|---|---|---|
| `/pipeline-init` | один раз на проєкт: **сам знаходить усе** (сайт, мобільний, бекенди, воркери, інфра, сабмодулі), зв'язує проєкти і налаштовує кожному тестування | `/pipeline-init` |
| `/pipeline-init-web` | підключити лише сайт + бекенди + інфраструктуру | `/pipeline-init-web` |
| `/pipeline-init-mobile` | один раз на проєкт: підключити React Native / Expo додаток і тести на симуляторі | `/pipeline-init-mobile` |
| `/feature <опис>` | нова задача: ТЗ → код → безпека → тести → коміт | `/feature Додати зміну email у профілі` |
| `/feature <опис> + деплой` | те саме, але з деплоєм у кінці (якщо деплой налаштований) | `/feature Виправити помилку логіну, задеплой на staging` |
| `/resume <задача>` | продовжити задачу, якщо сесія перервалась чи ти закрив Claude | `/resume change-email` |
| `/pipeline-status` | подивитись усі задачі: етап, статус, скільки було виправлень | `/pipeline-status` |
| `/audit` | перевірити безпеку **поточних незакомічених** змін (без пайплайну) | `/audit` |
| `/audit <задача>` | повторно перевірити безпеку конкретної задачі | `/audit change-email` |
| `/deploy <середовище>` | задеплоїти поточний стан | `/deploy staging` |
| `/deploy <середовище> <задача>` | задеплоїти закомічену задачу | `/deploy production change-email` |
| `/agents` | вбудована команда Claude Code: показати агентів (мають бути 7 `team-…`) | `/agents` |

Назву задачі (`change-email`) Оркестратор придумує сам на першому етапі й показує в статусі `[1/6] план: …`.

### H2. Команди двигуна (у терміналі)

Скорочення: замість довгого `node ~/.claude/pipeline/pipeline.mjs` нижче написано `pl`.
Можна зробити собі такий псевдонім: додай у `~/.zshenv` рядок
`alias pl="node ~/.claude/pipeline/pipeline.mjs"` і перезапусти термінал.
Агенти завжди пишуть повну форму: від неї залежать дозволи.

Запускати **в теці проєкту** (крім `help`, `doctor`, `template`, `rules`, `conventions`, які працюють будь-де).

**Довідка і перевірка**
| Команда | Що робить |
|---|---|
| `pl help` | короткий список усіх команд |
| `pl doctor` | перевіряє встановлення кіта, сервіси проєкту, Java / Android / Xcode / Maestro, симулятори |
| `pl detect` | просканувати папки: які проєкти є, їх тип, git/сабмодулі, команди перевірки, порти, **зв'язки між проєктами**, що треба доповнити. Нічого не змінює |
| `pl detect --json` | те саме у вигляді готової пропозиції `workspace.json` (так читає `/pipeline-init`) |
| `pl services` | таблиця сервісів: тип, тека, кого використовує (**uses**), хто використовує його (**used by**), який агент відповідає |
| `pl services --type mobile` | тільки сервіси певного типу (`frontend`, `mobile`, `backend`, …) |
| `pl services --json` | те саме у форматі JSON (так читають агенти) |
| `pl status` | усі задачі: етап, статус, вердикти безпеки, QA, перевірки |
| `pl rules` | правила Оркестратора (як він веде задачу) |
| `pl conventions` | правила коду для агентів: мова коментарів, мова звітів, `extra` з маніфесту |
| `pl template workspace` | повний приклад `workspace.json` з усіма полями |
| `pl template spec` | шаблон ТЗ |
| `pl template playwright` | конфіг Playwright для веб-тестів |
| `pl template mobile-flow` | приклад сценарію Maestro |
| `pl scaffold` | створює `docs/specs/`, `contracts/`, `e2e/`, `e2e-mobile/`, рядки в `.gitignore` (init робить це сам) |

**Перебіг задачі** (зазвичай запускають агенти)
| Команда | Що робить |
|---|---|
| `pl start <задача> <сервіси>` | створює гілку `feat/<задача>` у всіх зачеплених репозиторіях. Приклад: `pl start change-email users,web,mobile` або `all` |
| `pl start <задача> <сервіси> --no-qa` | те саме, але без етапу тестів (коли нема чого тестувати користувацьки) |
| `pl start … --allow-dirty` | дозволити старт з незакоміченими змінами (вони потраплять у задачу) |
| `pl diff <задача>` | готує diff для сліпого аудиту безпеки → `.pipeline/<задача>/diff.patch` |
| `pl diff adhoc` | diff поточних незакомічених змін у всіх репозиторіях (для `/audit`) |
| `pl owner <файл…>` | який агент відповідає за файл. Приклад: `pl owner services/users/src/a.ts` |
| `pl owner --file .pipeline/<задача>/changed_files.txt` | розкласти всі змінені файли по агентах |
| `pl comments <задача>` | перевірити, що всі нові функції і змінні мають коментар українською |
| `pl comments <задача> <сервіс>` | те саме тільки для одного сервісу |
| `pl verify <задача>` | коментарі → lint → typecheck → test → build для кожного сервісу задачі |
| `pl verify <задача> <сервіс,сервіс>` | те саме тільки для вказаних сервісів |
| `pl sim <задача>` | мобільні тести: вмикає симулятор/емулятор, піднімає бекенди, збирає додаток (якщо треба), запускає Maestro, збирає скріншоти й логи |
| `pl sim <задача> --platform ios` | тільки iOS (`android` — тільки Android, `all` — обидві) |
| `pl sim <задача> --rebuild` | примусово перезібрати додаток |
| `pl sim <задача> --skip-build` | не збирати, використати вже встановлений додаток |
| `pl sim <задача> --service <додаток>` | якщо в проєкті кілька мобільних додатків |
| `pl mark <задача> stage=3 status=BLOCKED note="…"` | оновити стан задачі (`IN_PROGRESS`, `BLOCKED`, `DONE`, `FAILED`) |
| `pl mark <задача> loop=security` | порахувати спробу виправлення; після 3-ї повертає код 3 (стоп) |
| `pl commit <задача> -m "feat(scope): опис"` | коміт у кожному репозиторії, **тільки** якщо безпека, тести і перевірка пройдені. Нічого не пушить |
| `pl rollback <задача>` | відкат: ховає зміни в `git stash` і повертає репозиторії на попередні гілки (роботу можна відновити) |

**Деплой**
| Команда | Що робить |
|---|---|
| `pl deploy <середовище>` | виконує кроки з `deploy.environments.<середовище>` + healthchecks; при помилці — кроки `rollback` |
| `pl deploy <середовище> --task <задача>` | деплой конкретної закоміченої задачі |
| `pl deploy <середовище> --approved` | для середовищ з `requireApproval: true` (production, mobile-store). Claude Code ще раз спитає підтвердження |

**Службові** (їх викликає `install.sh` / `uninstall.sh`, вручну не потрібно)
| Команда | Що робить |
|---|---|
| `pl guard` | охоронець, якого Claude Code викликає перед кожною shell-командою |
| `pl install-hook` / `pl uninstall-hook` | додати/прибрати охоронця й дозволи в `~/.claude/settings.json` |
| `pl install-memory` / `pl uninstall-memory` | додати/прибрати блок «відповідай українською» в `~/.claude/CLAUDE.md` |

### H3. Скрипти встановлення

| Команда | Що робить |
|---|---|
| `bash install.sh --link` | встановити або оновити кіт посиланнями (рекомендовано: зміни в `~/dev/claude-team-kit` діють одразу) |
| `bash install.sh` | встановити копіями (тоді після кожної зміни кіта треба запускати знову) |
| `bash uninstall.sh` | повністю прибрати кіт з `~/.claude`; файли проєктів не зачіпаються |

Запускаються з теки кіта: `cd ~/dev/claude-team-kit`.

### H4. Найчастіші сценарії

```bash
# Оновити кіт після змін у репозиторії
cd ~/dev/claude-team-kit && git pull && bash install.sh --link

# Перевірити, чи все гаразд у проєкті
cd ~/projects/myapp && node ~/.claude/pipeline/pipeline.mjs doctor

# Подивитись стан усіх задач
node ~/.claude/pipeline/pipeline.mjs status

# Самому прогнати мобільні тести задачі тільки на Android
node ~/.claude/pipeline/pipeline.mjs sim change-email --platform android

# Відновити роботу після відкату
git checkout feat/change-email && git stash list
git stash pop stash@{0}        # номер з попередньої команди
```

---

## Частина I. Один проєкт із підпроєктами (git submodules)

Мета: один «головний» репозиторій (наприклад, `fieldQuote`), а всередині нього підпроєкти `fieldQuote-web`, `fieldQuote-mobile`, `fieldQuote-backend`. У **кожного підпроєкту** своя історія, гілки і push, а весь проєкт скачується однією командою.

Для цього в git є **сабмодулі**: головний репозиторій зберігає посилання на інші репозиторії і пам'ятає, яка версія кожного з них іде в комплекті.

```
fieldQuote/                    ← головний репо (github.com/<ти>/fieldQuote)
├── .gitmodules                ← список підпроєктів і їх адрес (git створює сам)
├── .pipeline/workspace.json
├── docs/specs/  contracts/  e2e/  e2e-mobile/
├── fieldQuote-web/            ← окремий репо (github.com/<ти>/fieldQuote-web)
├── fieldQuote-mobile/         ← окремий репо (github.com/<ти>/fieldQuote-mobile)
└── fieldQuote-backend/        ← окремий репо (github.com/<ти>/fieldQuote-backend)
```

### I1. Створи репозиторії на GitHub

На github.com → **New repository**:
- `fieldQuote` — головний;
- `fieldQuote-web`, `fieldQuote-backend` — нові підпроєкти. **Постав галочку «Add a README file»**: порожній репозиторій не можна додати як сабмодуль.
- `fieldQuote-mobile` — якщо він уже є, нічого не створюй.

### I2. Збери головний проєкт

```bash
cd ~/projects
git clone https://github.com/<ти>/fieldQuote.git
cd fieldQuote

# додаємо підпроєкти: адреса репозиторію + назва папки
git submodule add https://github.com/<ти>/fieldQuote-mobile.git  fieldQuote-mobile
git submodule add https://github.com/<ти>/fieldQuote-web.git     fieldQuote-web
git submodule add https://github.com/<ти>/fieldQuote-backend.git fieldQuote-backend

git commit -m "add subprojects"
git push
```

Якщо в тебе вже є локальна папка мобільного додатку з незапушеними змінами, спершу запуш її у `fieldQuote-mobile` (`git push`), а потім додавай сабмодуль за адресою з GitHub.

### I3. Підключи кіт

```bash
cd ~/projects/fieldQuote
claude
```

```
/pipeline-init-mobile
/pipeline-init-web
```

Потім:

```bash
git add -A && git commit -m "add claude team pipeline" && git push
```

У `workspace.json` підпроєкти будуть прописані як `"path": "fieldQuote-mobile"`, `"path": "fieldQuote-web"`, `"path": "fieldQuote-backend"`.

### I4. Скачати весь проєкт (на іншому ПК чи заново)

```bash
git clone --recurse-submodules https://github.com/<ти>/fieldQuote.git
cd fieldQuote
git submodule foreach 'git checkout main'
```

⚠️ Остання команда важлива. Після клонування підпроєкти стоять не на гілці, а на конкретному коміті (стан «detached HEAD»). Ця команда перемикає кожен підпроєкт на `main`, щоб можна було нормально працювати і пушити.

### I5. Працювати з одним підпроєктом окремо

Кожна папка-підпроєкт є звичайним git-репозиторієм:

```bash
cd fieldQuote-backend
git checkout -b fix/login
# … зміни …
git add -A && git commit -m "fix: login"
git push origin fix/login          # пушиться ТІЛЬКИ бекенд
```

Головний репозиторій при цьому побачить, що бекенд змінився (`git status` у `fieldQuote` покаже `modified: fieldQuote-backend (new commits)`). Якщо хочеш зафіксувати «ця версія бекенду йде в комплекті»:

```bash
cd ~/projects/fieldQuote
git add fieldQuote-backend && git commit -m "bump backend" && git push
```

Це необов'язково робити щоразу, а лише тоді, коли хочеш зберегти узгоджений стан усього проєкту.

### I6. Через `/feature` усе робиться саме

Коли оркестратор виконує задачу, яка зачіпає кілька підпроєктів:
1. створює гілку `feat/<задача>` у кожному зачепленому підпроєкті й у головному репо;
2. агенти пишуть код у своїх підпроєктах;
3. на коміті робить **окремий коміт у кожному підпроєкті**, а потім **коміт у головному**, який оновлює посилання на нові версії підпроєктів (разом із ТЗ і тестами).

Пушиш потім одним із способів:

```bash
# все разом: спершу підпроєкти, потім головний
cd ~/projects/fieldQuote
git push --recurse-submodules=on-demand origin feat/<задача>

# або кожен окремо
cd fieldQuote-backend && git push origin feat/<задача>
cd ../fieldQuote-web  && git push origin feat/<задача>
```

### I7. Оновити все з GitHub

```bash
cd ~/projects/fieldQuote
git pull
git submodule update --init --recursive            # підтягнути версії, записані в головному
git submodule foreach 'git checkout main && git pull'   # або взяти найсвіжіші main кожного підпроєкту
```

### I8. Додати новий підпроєкт пізніше

```bash
cd ~/projects/fieldQuote
git submodule add https://github.com/<ти>/fieldQuote-notifications.git fieldQuote-notifications
git commit -m "add notifications service" && git push
claude      # → /pipeline-init-web (або -mobile) — допише новий сервіс у workspace.json
```

### Шпаргалка

| Хочу | Команда |
|---|---|
| Скачати все | `git clone --recurse-submodules <url>` → `git submodule foreach 'git checkout main'` |
| Запушити тільки один підпроєкт | `cd fieldQuote-web && git push` |
| Запушити все разом | у головному: `git push --recurse-submodules=on-demand` |
| Зафіксувати версії підпроєктів у головному | `git add fieldQuote-web fieldQuote-backend && git commit -m "bump"` |
| Оновити все | `git pull && git submodule update --init --recursive` |
| Подивитись стан усіх підпроєктів | `git submodule status` або `git submodule foreach git status -s` |
