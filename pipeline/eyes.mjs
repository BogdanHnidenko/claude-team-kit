// «Очі й руки» тестувальника: `pl eyes`, `pl mail`, `pl compare`.
// Тестувальник сам керує справжнім браузером або симулятором, дивиться на скріншоти й приймає рішення.
// Кожна дія й кожен скріншот потрапляють у журнал (.pipeline/<задача>/eyes/journal.jsonl); у звіті можна
// посилатися лише на докази з журналу. Жорсткий ліміт часу задається глибиною тестування.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Папка з цим файлом (там лежать eyes-web.mjs і layout-audit.mjs). */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Ліміт часу сесії за глибиною, хвилини (можна змінити в workspace.json: qa.budgetMin). */
export const BUDGET_MIN = { smoke: 8, deep: 20, exhaustive: 45 };
/** Набори ширин екрана для `eyes sweep` за глибиною. */
export const WIDTH_SETS = {
  smoke: [375, 768, 1280],
  deep: [320, 375, 414, 768, 1024, 1280, 1536],
  exhaustive: [320, 360, 375, 390, 414, 480, 600, 768, 834, 1024, 1280, 1440, 1920],
};
const WEB_CMDS = new Set(['goto', 'back', 'reload', 'click', 'dblclick', 'hover', 'fill', 'type', 'press', 'select', 'check', 'uncheck', 'upload', 'scroll', 'wait', 'resize', 'net', 'scheme', 'clear', 'eval', 'text', 'look', 'sweep']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Хвилини, що залишились до дедлайну (від'ємне = час вийшов). */
const minutesLeft = (session) => (new Date(session.deadline).getTime() - Date.now()) / 60000;

/** Шляхи сесії тестування завдання. */
function paths(root, id) {
  const dir = path.join(root, '.pipeline', id, 'eyes');
  return { task: path.join(root, '.pipeline', id), dir, session: path.join(dir, 'session.json'), journal: path.join(dir, 'journal.jsonl'), web: path.join(dir, 'web.json') };
}
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
/** Додає рядок у журнал (його ж пишуть демон і мобільні команди). */
function addJournal(P, row) { fs.mkdirSync(P.dir, { recursive: true }); fs.appendFileSync(P.journal, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'); }
/** Прочитаний журнал. */
const readJournal = (P) => (fs.existsSync(P.journal) ? fs.readFileSync(P.journal, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
/** Множина доказів, які реально існують в журналі (скріншоти, листи, порівняння). */
export function journalEvidence(root, id) {
  const P = paths(root, id);
  const set = new Set();
  for (const r of readJournal(P)) for (const f of [r.shot, r.file, ...(r.shots ?? [])]) if (f) set.add(f);
  return set;
}

/** Платформи (ios/android), на яких був сеанс тестування (за журналом). */
export function journalPlatforms(root, id) {
  return new Set(readJournal(paths(root, id)).map((r) => r.platform).filter(Boolean));
}

/** Знаходить Playwright: спочатку в e2e, потім у корені, потім глобально. */
function resolvePlaywright(root, ws) {
  const dirs = [ws.e2e?.path && path.join(root, ws.e2e.path), root, process.cwd()].filter(Boolean);
  const global = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout?.trim();
  if (global) dirs.push(path.dirname(global));
  for (const d of dirs) {
    for (const mod of ['playwright', '@playwright/test']) {
      try { return createRequire(path.join(d, 'x.js')).resolve(mod); } catch { /* пробуємо далі */ }
    }
  }
  return null;
}

/** Чи знайдено Playwright для браузера тестувальника (для doctor). */
export const playwrightFound = (root, ws) => Boolean(resolvePlaywright(root, ws));

/** Сервіси, які потрібні для вебу: фронтенди та все, від чого вони залежать. */
function webServices(ctx, ws) {
  const fronts = ws.services.filter((s) => s.type === 'frontend').map((s) => s.name);
  const names = new Set([...fronts, ...ctx.dependencyClosure(ws, fronts)]);
  return ws.services.filter((s) => names.has(s.name) && s.dev?.start && s.dev?.url);
}

/** Базова адреса застосунку: dev.url без службового кінця (/health, /status тощо). */
const baseUrl = (u) => { try { const x = new URL(u); return /^\/(health|healthz|status|ping|api\/health)?\/?$/i.test(x.pathname) || /health|status|ping/i.test(x.pathname) ? x.origin : u; } catch { return u; } };
/** Шлях для читання файла з кореня воркспейсу (тестувальник відкриває його інструментом читання). */
const show = (id, rel) => `.pipeline/${id}/${rel}`;

/** Точка входу: pl eyes <команда> ... */
export async function cmdEyes(ctx, { pos, flags }) {
  const { die, log, loadWorkspace } = ctx;
  const [sub, ...rest] = pos;
  if (!sub) die('Usage: eyes start <web|mobile> | look | click … | finish | stop   (докладно: pl playbook)');
  const { root, ws } = loadWorkspace();
  const id = flags.task ?? ctx.currentTaskId(root) ?? die('Не знайшов задачу: додай --task <id>');
  const P = paths(root, id);
  if (sub === 'start') return start(ctx, { root, ws, id, P, kind: rest[0], flags });
  if (sub === 'stop') return stop(ctx, { root, id, P });
  if (sub === 'finish') return finish(ctx, { root, ws, id, P, kind: flags.kind });
  if (sub === 'status') { const s = readJson(P.session, null); return log(s ? `${s.kind} сесія, залишилось ${Math.max(0, minutesLeft(s)).toFixed(1)} хв` : 'сесії немає'); }
  const session = readJson(P.session, null) ?? die(`Сесію не запущено: pl eyes start <web|mobile> --task ${id}`);
  if (session.ended) die('Сесію завершено. Нова: pl eyes start …');
  if (minutesLeft(session) <= 0 && sub !== 'text') die(`TIME_UP: ліміт часу (${session.budgetMin} хв) вичерпано. Виконай pl eyes finish і запиши звіт з того, що встиг.`);
  if (session.kind === 'web') return webCommand(ctx, { P, session, sub, rest, flags, id });
  return mobileCommand(ctx, { root, ws, P, session, sub, rest, flags, id });
}

/** Запуск сесії: сервіси, демон або симулятор, відлік часу. */
async function start(ctx, { root, ws, id, P, kind, flags }) {
  const { die, log, which, startBackground, taskDepth } = ctx;
  if (!['web', 'mobile'].includes(kind)) die('Usage: eyes start <web|mobile> [--platform ios|android] [--headed]');
  const depth = taskDepth(root, ws, id) ?? die('Не задано глибину тестування (pl mark <id> depth=smoke|deep|exhaustive)');
  const old = readJson(P.session, null);
  if (old && !old.ended && minutesLeft(old) > 0 && old.kind === kind) return log(`= сесія вже запущена, залишилось ${minutesLeft(old).toFixed(1)} хв`);
  fs.mkdirSync(P.dir, { recursive: true });
  for (const f of [P.session, P.web]) fs.rmSync(f, { force: true });
  const lay = path.join(P.task, 'layout.jsonl'); // ширини рахуються заново в кожному сеансі (код міг змінитися)
  if (kind === 'web' && fs.existsSync(lay)) fs.renameSync(lay, path.join(P.task, 'layout.prev.jsonl')); // журнал і скріншоти лишаються: це докази всіх сеансів
  const budgetMin = Number(ws.qa?.budgetMin?.[depth] ?? BUDGET_MIN[depth]);
  const started = [];
  const session = { kind, depth, budgetMin, services: [], startedAt: null, deadline: null, ended: false };
  try {
    if (kind === 'web') {
      const pw = resolvePlaywright(root, ws) ?? die('Не знайшов Playwright. Один раз: cd e2e && npm init -y && npm i -D @playwright/test && npx playwright install chromium');
      const webSvc = ws.services.find((s) => s.type === 'frontend' && s.dev?.url) ?? die('У workspace.json немає frontend із dev.url');
      for (const s of webServices(ctx, ws)) await startBackground(s.name, s.dev.start, path.resolve(root, s.path), s.dev.url, P.dir, {}, started);
      session.services = started.map(({ name, child }) => ({ name, pid: child.pid }));
      started.forEach(({ child }) => child.unref());
      session.startedAt = new Date().toISOString();
      session.deadline = new Date(Date.now() + budgetMin * 60000).toISOString();
      fs.writeFileSync(P.session, JSON.stringify(session, null, 2));
      const out = fs.openSync(path.join(P.dir, 'daemon.log'), 'w');
      const daemon = spawn(process.execPath, [path.join(HERE, 'eyes-web.mjs'), '--dir', P.dir, '--base', baseUrl(webSvc.dev.url), '--pw', pw, '--deadline', String(new Date(session.deadline).getTime()), ...(flags.headed ? ['--headed', '1'] : [])], { detached: true, stdio: ['ignore', out, out] });
      daemon.unref();
      for (let i = 0; i < 60 && !fs.existsSync(P.web); i++) await sleep(500);
      if (!fs.existsSync(P.web)) die(`Браузер не запустився: ${fs.readFileSync(path.join(P.dir, 'daemon.log'), 'utf8').slice(-400)}\nМожливо, потрібно: npx playwright install chromium`);
      log(`✔ браузер готовий: ${webSvc.dev.url}`);
    } else {
      const res = await ctx.mobilePrepare({ root, ws, id, platform: flags.platform, started, dir: P.dir });
      session.services = started.map(({ name, child }) => ({ name, pid: child.pid }));
      started.forEach(({ child }) => child.unref?.());
      Object.assign(session, res);
      session.startedAt = new Date().toISOString();
      session.deadline = new Date(Date.now() + budgetMin * 60000).toISOString();
      fs.writeFileSync(P.session, JSON.stringify(session, null, 2));
      log(`✔ ${res.platform} (${res.deviceName}) готовий, застосунок ${res.appId}`);
    }
  } catch (e) {
    for (const { child } of started) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* уже немає */ } }
    die(e.message);
  }
  log(`⏱ ліміт часу: ${budgetMin} хв (глибина ${depth}); відлік пішов. Далі: pl eyes look`);
}

/** Зупинка: демон, сервіси, фіксація кінця сесії. */
function stop(ctx, { P }) {
  const session = readJson(P.session, null);
  if (!session) return ctx.log('сесії немає');
  const web = readJson(P.web, null);
  for (const pid of [web?.pid, ...session.services.map((s) => s.pid)].filter(Boolean)) {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* уже немає */ } }
  }
  fs.writeFileSync(P.session, JSON.stringify({ ...session, ended: true, endedAt: new Date().toISOString() }, null, 2));
  ctx.log('✔ сесію зупинено (браузер і сервіси закрито)');
}

// ------------------------------------------------------------------ веб
/** Надсилає команду демону. */
async function daemon(P, body) {
  const web = readJson(P.web, null);
  if (!web) throw new Error('браузер не запущено (pl eyes start web)');
  const r = await fetch(`http://127.0.0.1:${web.port}/`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  return r.json();
}
/** Перекладає позиційні аргументи CLI в аргументи демона. */
function webArgs(sub, rest, flags, session) {
  const num = (x) => /^\d+$/.test(String(x));
  switch (sub) {
    case 'goto': return { url: rest[0] };
    case 'click': case 'dblclick': case 'hover': case 'check': case 'uncheck': return { target: rest[0] };
    case 'fill': case 'type': case 'select': case 'upload': return { target: rest[0], value: rest.slice(1).join(' ') };
    case 'press': return { key: rest[0] };
    case 'scroll': return { value: rest[0] ?? '400' };
    case 'wait': return num(rest[0]) ? { value: rest[0] } : { target: rest[0], value: rest[1] };
    case 'resize': return { width: rest[0], height: rest[1] };
    case 'net': case 'scheme': return { value: rest[0] };
    case 'eval': return { value: rest.join(' ') };
    case 'text': return { target: rest[0] };
    case 'look': return { name: rest[0], full: Boolean(flags.full), target: flags.target };
    case 'sweep': return { name: rest[0], widths: flags.widths ?? WIDTH_SETS[session.depth].join(',') };
    default: return {};
  }
}
async function webCommand(ctx, { P, session, sub, rest, flags, id }) {
  const { log, die } = ctx;
  if (!WEB_CMDS.has(sub)) die(`Невідома команда "${sub}". Веб: ${[...WEB_CMDS].join(', ')}`);
  const res = await daemon(P, { cmd: sub, ...webArgs(sub, rest, flags, session) }).catch((e) => ({ ok: false, error: e.message }));
  const left = minutesLeft(session);
  if (!res.ok) { log(`✖ ${res.error}`); log(`⏱ залишилось ${Math.max(0, left).toFixed(1)} хв`); process.exit(res.timeUp ? 4 : 1); }
  if (sub === 'look') {
    log(`📷 ${show(id, res.shot)}   ${res.url}   «${res.title}»   ${res.viewport.width}×${res.viewport.height}   scroll ${res.scroll.y}/${res.scroll.h}`);
    for (const it of res.items) log(`  ${it.tag}${it.tid ? ` [${it.tid}]` : ''}${it.type ? ` (${it.type})` : ''}: ${it.text ?? it.label ?? ''}${it.value ? ` = "${it.value}"` : ''}${it.disabled ? ' (disabled)' : ''}${it.invalid ? ' (invalid)' : ''}`);
    if (res.console.length) log(`⚠ помилки консолі:\n  ${res.console.join('\n  ')}`);
    if (res.network.length) log(`⚠ мережа:\n  ${res.network.slice(0, 8).join('\n  ')}`);
    if (res.dialogs.length) log(`ℹ діалоги (прийнято): ${res.dialogs.join(' | ')}`);
  } else if (sub === 'sweep') {
    log(`Перевірка верстки на ${res.sweep.length} ширинах (${res.url}):`);
    for (const s of res.sweep) log(`  ${String(s.width).padStart(4)}px  ${s.errors ? `✖ ${s.errors} помилок` : '✔'}${s.warnings ? `, ${s.warnings} попереджень` : ''}  ${show(id, s.shot)}${s.issues.filter((i) => i.severity === 'error').slice(0, 4).map((i) => `\n        • ${i.kind} ${i.selector}: ${i.detail}`).join('')}`);
    const view = [...new Set([res.sweep[0], res.sweep[Math.floor(res.sweep.length / 2)], res.sweep.at(-1), ...res.sweep.filter((s) => s.errors)].filter(Boolean).map((s) => show(id, s.shot)))];
    log(`👁 Подивись самі ці скріншоти (перший, середній, останній і з помилками): ${view.join(', ')}`);
  } else if (sub === 'text') {
    const name = flags.out ?? `text-${Date.now()}`;
    const dir = path.join(P.dir, 'texts'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.txt`); fs.writeFileSync(file, res.text);
    log(`✔ текст (${res.text.length} символів) збережено: ${show(id, path.relative(P.task, file))}\n${res.text.slice(0, 300)}${res.text.length > 300 ? '…' : ''}`);
  } else if (sub === 'eval') log(JSON.stringify(res.result));
  else log(`✔ ${sub}${res.note ? ` — ${res.note}` : ''}`);
  log(`⏱ залишилось ${Math.max(0, left).toFixed(1)} хв`);
}

// -------------------------------------------------------------- мобільне
/** Запускає Maestro з кількох команд (одним коротким потоком). */
function maestro(session, yamlSteps) {
  const file = path.join(session.dir ?? '', `.step-${Date.now()}.yaml`);
  fs.writeFileSync(file, `appId: ${session.appId}\n---\n${yamlSteps.join('\n')}\n`);
  const r = spawnSync('maestro', ['--device', session.deviceId, 'test', file], { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26 });
  fs.rmSync(file, { force: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n') };
}
const yq = (s) => JSON.stringify(String(s));
/** Описує ціль дотику для Maestro: id:xxx | text:xxx | point:50%,80% | слово (спершу текст). */
function mTarget(t) {
  const m = /^(id|text|point):(.*)$/s.exec(String(t));
  if (m?.[1] === 'point') return `point: ${yq(m[2])}`;
  if (m?.[1] === 'id') return `id: ${yq(m[2])}`;
  return `text: ${yq(m ? m[2] : t)}`;
}
/** Скріншот + дерево елементів поточного екрана. */
function mobileLook(P, session, name) {
  const dir = path.join(P.dir, 'shots'); fs.mkdirSync(dir, { recursive: true });
  const n = fs.readdirSync(dir).length + 1;
  const file = path.join(dir, `${String(n).padStart(3, '0')}-${String(name || 'look').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.png`);
  const cap = session.platform === 'ios'
    ? spawnSync('xcrun', ['simctl', 'io', session.deviceId, 'screenshot', file])
    : (() => { const r = spawnSync('adb', ['-s', session.deviceId, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 28 }); if (r.status === 0) fs.writeFileSync(file, r.stdout); return r; })();
  const h = spawnSync('maestro', ['--device', session.deviceId, 'hierarchy'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 26 });
  const items = [...(h.stdout ?? '').matchAll(/"(text|resource-id|identifier|accessibilityText|hintText)"\s*:\s*"([^"]{1,120})"/g)].map((m) => `${m[1]}: ${m[2]}`);
  return { ok: cap.status === 0, shot: path.relative(P.task, file).split(path.sep).join('/'), items: [...new Set(items)].slice(0, 80) };
}
async function mobileCommand(ctx, { P, session, sub, rest, flags, id }) {
  const { log, die } = ctx;
  const left = minutesLeft(session);
  const dev = session.deviceId;
  const ios = session.platform === 'ios';
  const jr = (row) => addJournal(P, { platform: session.platform, ...row });
  const step = (label, yaml) => { const r = maestro({ ...session, dir: P.dir }, yaml); jr({ cmd: sub, args: rest, ok: r.ok }); if (!r.ok) { log(`✖ ${label}: ${r.out}`); process.exit(1); } log(`✔ ${label}`); };
  switch (sub) {
    case 'look': {
      const r = mobileLook(P, session, rest[0]);
      jr({ cmd: 'look', shot: r.shot });
      log(`📷 ${show(id, r.shot)}${r.ok ? '' : '  (⚠ скріншот не вдався)'}`);
      log(r.items.length ? `елементи на екрані:\n  ${r.items.join('\n  ')}` : '⚠ дерево елементів порожнє (застосунок відкритий? maestro встановлено?)');
      break;
    }
    case 'tap': step(`tap ${rest[0]}`, [`- tapOn:\n    ${mTarget(rest[0])}`]); break;
    case 'longpress': step(`longpress ${rest[0]}`, [`- longPressOn:\n    ${mTarget(rest[0])}`]); break;
    case 'type': {
      const text = rest.length > 1 ? rest.slice(1).join(' ') : rest[0];
      step(`type "${text}"`, [...(rest.length > 1 ? [`- tapOn:\n    ${mTarget(rest[0])}`] : []), `- inputText: ${yq(text)}`]);
      break;
    }
    case 'swipe': step(`swipe ${rest[0]}`, [`- swipe:\n    direction: ${String(rest[0] ?? 'UP').toUpperCase()}`]); break;
    case 'scroll': step('scroll', ['- scroll']); break;
    case 'scrollto': step(`scrollto ${rest[0]}`, [`- scrollUntilVisible:\n    element:\n      ${mTarget(rest[0])}`]); break;
    case 'back': step('back', [ios ? '- swipe:\n    start: 2%, 50%\n    end: 80%, 50%' : '- back']); break;
    case 'hidekeyboard': step('hideKeyboard', ['- hideKeyboard']); break;
    case 'launch': step(`launch${flags.clear ? ' (чистий стан)' : ''}`, [`- launchApp:\n    clearState: ${flags.clear ? 'true' : 'false'}`]); break;
    case 'kill': step('застосунок закрито', ['- stopApp']); break;
    case 'background': { const r = ios ? spawnSync('xcrun', ['simctl', 'launch', dev, 'com.apple.Preferences']) : spawnSync('adb', ['-s', dev, 'shell', 'input', 'keyevent', 'KEYCODE_HOME']); jr({ cmd: 'background' }); log(r.status === 0 ? '✔ застосунок у фоні (поверни: pl eyes foreground)' : '✖ не вдалося'); break; }
    case 'foreground': { const r = ios ? spawnSync('xcrun', ['simctl', 'launch', dev, session.appId]) : spawnSync('adb', ['-s', dev, 'shell', 'monkey', '-p', session.appId, '-c', 'android.intent.category.LAUNCHER', '1']); jr({ cmd: 'foreground' }); log(r.status === 0 ? '✔ застосунок повернуто' : '✖ не вдалося'); break; }
    case 'scheme': { const dark = rest[0] === 'dark'; const r = ios ? spawnSync('xcrun', ['simctl', 'ui', dev, 'appearance', dark ? 'dark' : 'light']) : spawnSync('adb', ['-s', dev, 'shell', 'cmd', 'uimode', 'night', dark ? 'yes' : 'no']); jr({ cmd: 'scheme', args: rest }); log(r.status === 0 ? `✔ тема: ${rest[0]}` : '✖ не вдалося'); break; }
    case 'font': { const big = rest[0] === 'large'; const r = ios ? spawnSync('xcrun', ['simctl', 'ui', dev, 'content_size', big ? 'extra-extra-extra-large' : 'large']) : spawnSync('adb', ['-s', dev, 'shell', 'settings', 'put', 'system', 'font_scale', big ? '1.5' : '1.0']); jr({ cmd: 'font', args: rest }); log(r.status === 0 ? `✔ розмір шрифту: ${rest[0]}` : '✖ не вдалося'); break; }
    case 'net': { // лише Android: режим «в літаку»; на iOS вимикай бекенд (pl eyes backend stop)
      if (ios) die('На iOS мережу не вимкнути командою: використай pl eyes backend stop (і start)');
      step(`мережа: ${rest[0]}`, [`- setAirplaneMode: ${rest[0] === 'offline' ? 'true' : 'false'}`]);
      break;
    }
    case 'backend': {
      for (const s of session.services.filter((x) => !/metro|device-log/.test(x.name))) { try { process.kill(-s.pid, rest[0] === 'stop' ? 'SIGSTOP' : 'SIGCONT'); } catch { /* немає */ } }
      jr({ cmd: 'backend', args: rest }); log(`✔ бекенд: ${rest[0] === 'stop' ? 'призупинено (застосунок побачить обрив)' : 'відновлено'}`);
      break;
    }
    case 'flow': step('flow', [rest.join(' ')]); break; // сирі команди Maestro (YAML)
    case 'text': {
      const r = mobileLook(P, session, 'text');
      const name = flags.out ?? `text-${Date.now()}`;
      const dir = path.join(P.dir, 'texts'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}.txt`); fs.writeFileSync(file, r.items.filter((i) => i.startsWith('text:') || i.startsWith('accessibilityText:')).map((i) => i.replace(/^[a-zA-Z]+: /, '')).join('\n'));
      jr({ cmd: 'text', shot: r.shot });
      log(`✔ текст екрана збережено: ${show(id, path.relative(P.task, file))}`);
      break;
    }
    default: die(`Невідома мобільна команда "${sub}". Є: look, tap, longpress, type, swipe, scroll, scrollto, back, hidekeyboard, launch [--clear], kill, background, foreground, scheme dark|light, font large|normal, net offline|online (Android), backend stop|start, flow '<yaml>', text`);
  }
  log(`⏱ залишилось ${Math.max(0, left).toFixed(1)} хв`);
}

// --------------------------------------------------- перевірка звіту (finish)
/** Перевіряє звіт тестувальника проти журналу: докази справжні, поля заповнені. Повертає { problems, report }. */
export function validateReport(root, id, kind, CATEGORIES) {
  const file = path.join(root, '.pipeline', id, kind === 'mobile' ? 'qa-mobile.json' : 'qa.json');
  const report = readJson(file, null);
  const problems = [];
  if (!report) return { problems: [`${path.basename(file)} не знайдено або не JSON`], report: null };
  const ev = journalEvidence(root, id);
  const norm = (e) => String(e).replace(new RegExp(`^\\.?/?(\\.pipeline/${id}/)?`), '');
  const checkEvidence = (label, list, required = true) => {
    if (required && (!Array.isArray(list) || !list.length)) problems.push(`${label}: немає evidence (скріншот/лист із журналу eyes)`);
    for (const e of list ?? []) if (!ev.has(norm(e))) problems.push(`${label}: доказу "${e}" немає в журналі eyes (зроби pl eyes look і вкажи його шлях)`);
  };
  if (!Array.isArray(report.checks) || !report.checks.length) problems.push('у звіті немає checks[]');
  for (const c of report.checks ?? []) {
    const label = `check ${c.id ?? '?'}`;
    if (!c.id || !c.what) problems.push(`${label}: потрібні id і what`);
    if (!CATEGORIES.has(c.category)) problems.push(`${label}: category "${c.category}" не з переліку`);
    if (!['passed', 'failed', 'blocked'].includes(c.result)) problems.push(`${label}: result має бути passed|failed|blocked`);
    if (c.result !== 'blocked') checkEvidence(label, c.evidence);
    if (c.result === 'failed' && (!c.severity || !c.note)) problems.push(`${label}: для failed потрібні severity і note`);
  }
  for (const k of report.consistency ?? []) {
    const label = `consistency ${k.id ?? '?'}`;
    if (!['same', 'differs', 'blocked'].includes(k.result)) problems.push(`${label}: result має бути same|differs|blocked`);
    if (k.result !== 'blocked') checkEvidence(label, k.evidence);
  }
  for (const f of report.findings ?? []) {
    const label = `finding ${f.id ?? '?'}`;
    if (!f.title || !f.severity || !f.owner_hint) problems.push(`${label}: потрібні title, severity, owner_hint`);
    checkEvidence(label, f.evidence);
  }
  return { problems, report };
}

/** Перевіряє звіт проти журналу, рахує results/verdict і записує їх назад. Повертає { ok, problems, report }. */
export function finalizeReport(root, id, kind, CATEGORIES) {
  const { problems, report } = validateReport(root, id, kind, CATEGORIES);
  if (problems.length) return { ok: false, problems, report };
  const P = paths(root, id);
  const session = readJson(P.session, null);
  const failed = report.checks.filter((c) => c.result === 'failed');
  const byAc = new Map();
  for (const c of report.checks) {
    const row = byAc.get(c.ac ?? 'general') ?? { ac: c.ac ?? 'general', status: 'passed', error: '', owner_hint: 'unknown', flaky: false };
    if (c.result === 'failed') { row.status = 'failed'; row.error = row.error || c.note; row.owner_hint = c.owner_hint ?? row.owner_hint; }
    byAc.set(row.ac, row);
  }
  const consistencyBad = (report.consistency ?? []).filter((x) => x.result === 'differs');
  for (const x of consistencyBad) byAc.set(`consistency:${x.id}`, { ac: `consistency:${x.id}`, status: 'failed', error: x.diff ?? `${x.a} ≠ ${x.b}`, owner_hint: x.owner_hint ?? 'unknown', flaky: false });
  report.results = [...byAc.values()];
  const blocking = failed.some((c) => ['blocker', 'major', 'critical', 'high', 'medium'].includes(String(c.severity).toLowerCase())) || consistencyBad.length > 0;
  report.verdict = blocking || report.reason === 'ENV' || report.verdict === 'FAIL' ? 'FAIL' : 'PASS';
  report.session = session ? { budgetMin: session.budgetMin, usedMin: Number(((Date.now() - new Date(session.startedAt).getTime()) / 60000).toFixed(1)), actions: readJournal(P).filter((r) => r.cmd && r.cmd !== 'error').length } : undefined;
  fs.writeFileSync(path.join(P.task, kind === 'mobile' ? 'qa-mobile.json' : 'qa.json'), JSON.stringify(report, null, 2) + '\n');
  return { ok: true, problems: [], report, failed: failed.length, inconsistent: consistencyBad.length };
}

/** pl eyes finish: перевіряє звіт, показує підсумок. */
function finish(ctx, { root, id, P, kind }) {
  const { log, CATEGORIES } = ctx;
  const k = kind ?? readJson(P.session, null)?.kind ?? 'web';
  const r = finalizeReport(root, id, k, CATEGORIES);
  if (!r.ok) {
    log(`✖ звіт не пройшов перевірку:\n  - ${r.problems.slice(0, 25).join('\n  - ')}`);
    process.exit(1);
  }
  log(`✔ звіт перевірено: ${r.report.checks.length} перевірок, ${r.failed} не пройшли, ${r.inconsistent} розбіжностей між поверхнями → ${r.report.verdict}`);
  if (r.report.session) log(`⏱ витрачено ${r.report.session.usedMin} із ${r.report.session.budgetMin} хв, дій ${r.report.session.actions}`);
}

// ------------------------------------------------------------------ пошта
/** Налаштування перехоплювача листів із workspace.json → mail. */
function mailConf(ws) {
  const m = ws.mail ?? {};
  return { kind: m.kind ?? 'mailpit', url: String(m.url ?? 'http://localhost:8025').replace(/\/$/, '') };
}
/** Декодує quoted-printable (для MailHog). */
const qp = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
/** Прибирає HTML-теги: простий текст листа. */
const stripHtml = (h) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Список листів (нові першими): [{ id, subject, to, at }]. */
async function mailList(c) {
  if (c.kind === 'mailhog') {
    const j = await (await fetch(`${c.url}/api/v2/messages?limit=50`)).json();
    return (j.items ?? []).map((m) => ({ id: m.ID, subject: qp(m.Content?.Headers?.Subject?.[0] ?? ''), to: (m.Content?.Headers?.To ?? []).join(', '), at: m.Created }));
  }
  const j = await (await fetch(`${c.url}/api/v1/messages?limit=50`)).json();
  return (j.messages ?? []).map((m) => ({ id: m.ID, subject: m.Subject, to: (m.To ?? []).map((x) => x.Address).join(', '), at: m.Created }));
}
/** Один лист: { id, subject, to, text, html }. */
async function mailGet(c, id) {
  if (c.kind === 'mailhog') {
    const m = await (await fetch(`${c.url}/api/v1/messages/${id}`)).json();
    const body = qp(m.Content?.Body ?? '');
    const isHtml = /<html|<body|<div|<table/i.test(body);
    return { id, subject: qp(m.Content?.Headers?.Subject?.[0] ?? ''), to: (m.Content?.Headers?.To ?? []).join(', '), html: isHtml ? body : '', text: isHtml ? stripHtml(body) : body };
  }
  const m = await (await fetch(`${c.url}/api/v1/message/${id}`)).json();
  return { id, subject: m.Subject, to: (m.To ?? []).map((x) => x.Address).join(', '), html: m.HTML ?? '', text: (m.Text && m.Text.trim()) || stripHtml(m.HTML ?? '') };
}

/** pl mail list|clear|show [id]|wait [--to x] [--subject x] [--timeout сек]|shot [id] — лист клієнту як його бачить людина. */
export async function cmdMail(ctx, { pos, flags }) {
  const { die, log, loadWorkspace } = ctx;
  const { root, ws } = loadWorkspace();
  const id = flags.task ?? ctx.currentTaskId(root) ?? die('Не знайшов задачу: додай --task <id>');
  const P = paths(root, id);
  const c = mailConf(ws);
  const [sub = 'list', arg] = pos;
  try {
    if (sub === 'clear') { await fetch(`${c.url}/api/v1/messages`, { method: 'DELETE' }); return log('✔ скриньку очищено (роби це перед дією, яка шле лист)'); }
    if (sub === 'list') { const l = await mailList(c); return log(l.length ? l.slice(0, 15).map((m) => `${m.id}  ${m.at ?? ''}  → ${m.to}  «${m.subject}»`).join('\n') : 'листів немає'); }
    let mail;
    if (sub === 'wait') {
      const until = Date.now() + Number(flags.timeout ?? 30) * 1000;
      while (Date.now() < until && !mail) {
        const hit = (await mailList(c)).find((m) => (!flags.to || m.to.includes(flags.to)) && (!flags.subject || m.subject.includes(flags.subject)));
        if (hit) mail = await mailGet(c, hit.id); else await sleep(1000);
      }
      if (!mail) die(`лист не прийшов за ${flags.timeout ?? 30} с (його справді відправляє застосунок? перехоплювач: ${c.url})`);
    } else mail = await mailGet(c, arg ?? (await mailList(c))[0]?.id ?? die('листів немає'));
    const dir = path.join(P.dir, 'mail'); fs.mkdirSync(dir, { recursive: true });
    const base = path.join(dir, String(mail.id).replace(/[^\w-]/g, '').slice(0, 24));
    fs.writeFileSync(`${base}.txt`, mail.text); if (mail.html) fs.writeFileSync(`${base}.html`, mail.html);
    addJournal(P, { cmd: 'mail', file: path.relative(P.task, `${base}.txt`).split(path.sep).join('/'), subject: mail.subject });
    if (sub === 'shot') {
      if (!mail.html) die('у листа немає HTML-частини');
      const pw = resolvePlaywright(root, ws) ?? die('Не знайшов Playwright (cd e2e && npm i -D @playwright/test)');
      const shots = [];
      for (const w of [600, 375]) {
        const dirS = path.join(P.dir, 'shots'); fs.mkdirSync(dirS, { recursive: true });
        const file = path.join(dirS, `${String(fs.readdirSync(dirS).length + 1).padStart(3, '0')}-mail-${w}.png`);
        const script = `const m=await import(${JSON.stringify('file://' + pw)});const {chromium}=m.default??m;const b=await chromium.launch();const p=await b.newPage({viewport:{width:${w},height:900}});await p.setContent(${JSON.stringify(mail.html)});await p.waitForTimeout(300);await p.screenshot({path:${JSON.stringify(file)},fullPage:true});await b.close();`;
        const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
        if (r.status !== 0) die(`не вдалося відрендерити лист: ${(r.stderr || '').slice(-300)}`);
        const relFile = path.relative(P.task, file).split(path.sep).join('/');
        addJournal(P, { cmd: 'mailshot', shot: relFile }); shots.push(relFile);
      }
      log(`📷 лист «${mail.subject}» відрендерено: ${shots.map((x) => show(id, x)).join(', ')} (600px — десктоп, 375px — телефон). Подивись їх і порівняй із додатком.`);
    }
    log(`✉ ${mail.id} → ${mail.to}  «${mail.subject}»\nтекст: ${show(id, path.relative(P.task, `${base}.txt`))}${mail.html ? `, html: ${show(id, path.relative(P.task, `${base}.html`))}` : ''}\n---\n${mail.text.slice(0, 1200)}${mail.text.length > 1200 ? '\n…' : ''}`);
  } catch (e) {
    if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(String(e.message))) die(`перехоплювач листів недоступний (${c.url}). Запусти його і вкажи в workspace.json: "mail": { "kind": "mailpit", "url": "…" }`);
    throw e;
  }
}

// ------------------------------------------------------------- порівняння
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, січ: 1, лют: 2, бер: 3, кві: 4, тра: 5, чер: 6, лип: 7, сер: 8, вер: 9, жов: 10, лис: 11, гру: 12 };
/** Число з тексту з урахуванням розділювачів тисяч і десяткових (1,234.50 | 1 234,50 | 1.234,50). */
function parseNumber(raw) {
  const s = raw.replace(/[\s\u00a0\u202f]/g, '');
  const seps = s.match(/[.,]/g) ?? [];
  if (!seps.length) return Number(s);
  const lastDot = s.lastIndexOf('.'); const lastComma = s.lastIndexOf(',');
  const decPos = Math.max(lastDot, lastComma);
  const decimals = s.length - decPos - 1;
  const mixed = lastDot !== -1 && lastComma !== -1;
  const intPart = s.slice(0, decPos);
  // три цифри після єдиного розділювача (1,234 | 1.234) або кілька однакових розділювачів — це тисячі
  if (!mixed && ((decimals === 3 && intPart.replace(/[.,]/g, '') !== '0') || seps.length > 1)) return Number(s.replace(/[.,]/g, ''));
  return Number(`${intPart.replace(/[.,]/g, '')}.${s.slice(decPos + 1)}`);
}
const CUR = { '$': 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP', '₴': 'UAH', грн: 'UAH', uah: 'UAH' };
/** Витягує з тексту «факти»: гроші, дати, час, відсотки, пошти, телефони, числа. Повертає { kind: [{ raw, canon }] }. */
export function extractFacts(text) {
  const facts = { money: [], date: [], time: [], percent: [], email: [], phone: [], number: [] };
  let rest = text;
  const take = (re, kind, canon) => { rest = rest.replace(re, (...m) => { const raw = m[0].trim(); const c = canon(m); if (c !== null) facts[kind].push({ raw, canon: c }); return ' '.repeat(m[0].length); }); };
  take(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'email', (m) => m[0].toLowerCase());
  take(/(?:\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})/g, 'date', (m) => { const s = m[0]; if (/^\d{4}/.test(s)) return s; const [d, mo, y] = s.split(/[./]/); return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; });
  take(/\b(\d{1,2})\s+(січ|лют|бер|кві|тра|чер|лип|сер|вер|жов|лис|гру)[а-яії]*\.?,?\s+(\d{4})/gi, 'date', (m) => `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  take(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/gi, 'date', (m) => `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`);
  take(/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[AaPp][Mm])?/g, 'time', (m) => { const t = /(\d{1,2}):(\d{2})(?::\d{2})?\s?([AaPp][Mm])?/.exec(m[0]); let h = Number(t[1]); const ap = t[3]?.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return `${String(h).padStart(2, '0')}:${t[2]}`; });
  take(/(?:[$€£₴]\s?\d[\d\s .,]*\d|\d[\d\s .,]*\d\s?(?:₴|грн\.?|UAH|USD|EUR|GBP|[$€£])|[$€£₴]\s?\d)/g, 'money', (m) => { const cur = /[$€£₴]|грн|uah|usd|eur|gbp/i.exec(m[0])?.[0].toLowerCase(); const num = /\d[\d\s .,]*\d|\d/.exec(m[0])?.[0]; return num ? `${CUR[cur] ?? cur}:${parseNumber(num).toFixed(2)}` : null; });
  take(/\d+(?:[.,]\d+)?\s?%/g, 'percent', (m) => String(parseNumber(m[0].replace('%', ''))));
  take(/\+?\d[\d\s()-]{8,}\d/g, 'phone', (m) => m[0].replace(/\D/g, ''));
  take(/\b\d[\d\s ]*(?:[.,]\d+)?\b/g, 'number', (m) => { const n = parseNumber(m[0]); return Number.isFinite(n) && String(m[0]).replace(/\D/g, '').length >= 2 ? String(n) : null; });
  return facts;
}
/** Порівнює два тексти за фактами та рядками. */
export function compareTexts(a, b) {
  const fa = extractFacts(a); const fb = extractFacts(b);
  const out = { same: [], format: [], onlyA: [], onlyB: [] };
  for (const kind of Object.keys(fa)) {
    const restB = [...fb[kind]];
    for (const x of fa[kind]) {
      const exact = restB.findIndex((y) => y.canon === x.canon && y.raw === x.raw);
      if (exact >= 0) { out.same.push({ kind, ...x }); restB.splice(exact, 1); continue; }
      const sameValue = restB.findIndex((y) => y.canon === x.canon);
      if (sameValue >= 0) { out.format.push({ kind, a: x.raw, b: restB[sameValue].raw }); restB.splice(sameValue, 1); continue; }
      out.onlyA.push({ kind, ...x });
    }
    out.onlyB.push(...restB.map((y) => ({ kind, ...y })));
  }
  const lines = (t) => new Set(t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 3));
  const la = lines(a); const lb = lines(b);
  out.wordingOnlyA = [...la].filter((l) => !lb.has(l)).slice(0, 20);
  out.wordingOnlyB = [...lb].filter((l) => !la.has(l)).slice(0, 20);
  return out;
}

/** pl compare <A> <B> [--name n] [--strict]: чи збігаються суми, дати, формати між двома поверхнями (додаток ↔ лист). */
export function cmdCompare(ctx, { pos, flags }) {
  const { die, log, loadWorkspace } = ctx;
  const { root } = loadWorkspace();
  const id = flags.task ?? ctx.currentTaskId(root) ?? die('Не знайшов задачу: додай --task <id>');
  const P = paths(root, id);
  const read = (x) => {
    if (!x) die('Usage: compare <файл-A> <файл-B> [--name назва] — файли з pl eyes text --out … та pl mail show/wait');
    const cands = [x, path.join(P.task, x), path.join(P.dir, 'texts', `${x}.txt`), path.join(P.dir, 'texts', x), path.join(P.dir, 'mail', x), path.join(P.dir, 'mail', `${x}.txt`)];
    const f = cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? die(`файл не знайдено: ${x}`);
    return fs.readFileSync(f, 'utf8');
  };
  const r = compareTexts(read(pos[0]), read(pos[1]));
  const dir = path.join(P.dir, 'compare'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(fs.readdirSync(dir).length + 1).padStart(2, '0')}-${String(flags.name ?? 'compare').replace(/[^\w-]+/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
  addJournal(P, { cmd: 'compare', file: path.relative(P.task, file).split(path.sep).join('/') });
  const bad = r.format.length + r.onlyA.length + r.onlyB.length;
  log(`${bad ? '✖ ВІДРІЗНЯЄТЬСЯ' : '✔ ЗБІГАЄТЬСЯ'}: однакових фактів ${r.same.length}, інший формат ${r.format.length}, лише в A ${r.onlyA.length}, лише в B ${r.onlyB.length}`);
  for (const f of r.format) log(`  ⚠ ${f.kind}: однакове значення, різний формат: A «${f.a}» ↔ B «${f.b}»`);
  for (const f of r.onlyA) log(`  − ${f.kind} лише в A: «${f.raw}»`);
  for (const f of r.onlyB) log(`  + ${f.kind} лише в B: «${f.raw}»`);
  if (r.wordingOnlyA.length || r.wordingOnlyB.length) log(`  ℹ рядки, що відрізняються (перші): A: ${r.wordingOnlyA.slice(0, 5).map((l) => `«${l.slice(0, 60)}»`).join(' ')} | B: ${r.wordingOnlyB.slice(0, 5).map((l) => `«${l.slice(0, 60)}»`).join(' ')}`);
  log(`доказ для звіту (consistency.evidence): ${path.relative(P.task, file).split(path.sep).join('/')}   (файл: ${show(id, path.relative(P.task, file))})`);
  if (flags.strict && bad) process.exit(1);
}
