#!/usr/bin/env node
// «Очі й руки» тестувальника для веба: невеликий демон навколо одного живого браузера (Playwright).
// Запускається командою `pl eyes start web`, далі приймає команди від `pl eyes <команда>` по HTTP (127.0.0.1).
// Навіщо демон: браузер відкривається один раз, сесія (логін, стан) живе між діями, одна дія = десятки мілісекунд.
// Кожна дія пишеться в журнал journal.jsonl; скріншоти лежать у shots/. Звіт тестувальника може посилатися
// лише на скріншоти з журналу, тож «докази» підробити не вийде.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Аргументи запуску: --key value. */
const argv = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
/** Папка сесії (.pipeline/<задача>/eyes). */
const DIR = argv.dir;
/** Папка зі скріншотами. */
const SHOTS = path.join(DIR, 'shots');
/** Базова адреса застосунку для відносних URL. */
const BASE = argv.base || '';
/** Шлях до модуля Playwright, знайденого клієнтом. */
const PW = argv.pw;
/** Папка завдання (там лежить layout.jsonl, який читає перевірка покриття). */
const TASK_DIR = path.dirname(DIR);
/** Крайній час сесії (мс від епохи). */
const DEADLINE = Number(argv.deadline || 0);
fs.mkdirSync(SHOTS, { recursive: true });

const { chromium } = await import(pathToFileURL(createRequire(import.meta.url).resolve(PW)).href).then((m) => m.default ?? m);
const { auditInPage } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'layout-audit.mjs')).href);

/** Браузер, контекст і сторінка. */
const browser = await chromium.launch({ headless: !argv.headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
let page = await context.newPage();
/** Помилки консолі та мережі з моменту останнього look. */
let consoleErrors = [];
let netErrors = [];
/** Діалоги (alert/confirm), які автоматично прийняті. */
let dialogs = [];
/** Лічильник скріншотів (продовжуємо нумерацію, якщо сесію перезапустили). */
let counter = fs.readdirSync(SHOTS).length;

/** Підписується на події сторінки: помилки консолі, невдалі запити, діалоги. */
function watch(p) {
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 300)}`));
  p.on('requestfailed', (r) => netErrors.push(`${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText ?? 'failed'}`));
  p.on('response', (r) => { if (r.status() >= 400) netErrors.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 120)}`); });
  p.on('dialog', async (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 200)}`); await d.accept().catch(() => {}); });
}
watch(page);

/** Додає запис у журнал і повертає його. */
function journal(entry) {
  const row = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(path.join(DIR, 'journal.jsonl'), JSON.stringify(row) + '\n');
  return row;
}
/** Безпечне ім'я файла зі слова. */
const slug = (s) => String(s || 'shot').toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'shot';
/** Відносний шлях скріншота від папки завдання (його тестувальник вказує як доказ). */
const rel = (abs) => path.relative(TASK_DIR, abs).split(path.sep).join('/');

/** Знаходить елемент за описом: testid:x | text:x | role:button:Назва | label:x | placeholder:x | css:x | просто слово. */
async function locate(target) {
  const t = String(target);
  const m = /^(testid|text|role|label|placeholder|css):(.*)$/s.exec(t);
  if (m) {
    const [, kind, val] = m;
    if (kind === 'testid') return page.getByTestId(val).first();
    if (kind === 'text') return page.getByText(val).first();
    if (kind === 'label') return page.getByLabel(val).first();
    if (kind === 'placeholder') return page.getByPlaceholder(val).first();
    if (kind === 'css') return page.locator(val).first();
    const [role, ...name] = val.split(':');
    return page.getByRole(role, name.length ? { name: name.join(':') } : undefined).first();
  }
  const candidates = [page.getByTestId(t), page.getByRole('button', { name: t }), page.getByRole('link', { name: t }), page.getByLabel(t), page.getByPlaceholder(t), page.getByText(t)];
  for (const c of candidates) if (await c.count()) return c.first();
  throw new Error(`не знайшов елемент "${t}" (спробуй testid:…, text:…, role:button:Назва, css:…)`);
}

/** Коротко описує, що є на сторінці: заголовки, поля, кнопки, посилання, повідомлення про помилки. */
async function outline() {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 70);
    const label = (el) => { const id = el.id && document.querySelector(`label[for="${el.id}"]`); return (id?.innerText || el.closest('label')?.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 50); };
    const items = [];
    for (const el of document.querySelectorAll('h1,h2,h3,button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=alert],[role=status],[aria-live],[role=dialog],[data-testid]')) {
      if (!vis(el)) continue;
      const tag = el.tagName.toLowerCase();
      const tid = el.getAttribute('data-testid');
      const base = { tag: el.getAttribute('role') || tag, tid };
      if (/^h[1-3]$/.test(tag)) items.push({ ...base, text: name(el) });
      else if (['input', 'select', 'textarea'].includes(tag)) items.push({ ...base, type: el.type, label: label(el), value: el.type === 'password' ? '•••' : String(el.value ?? '').slice(0, 40), disabled: el.disabled || undefined, invalid: el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true' || undefined });
      else items.push({ ...base, text: name(el), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined });
    }
    return { items: items.slice(0, 80), scroll: { y: Math.round(scrollY), h: document.documentElement.scrollHeight, vh: innerHeight } };
  });
}

/** Чекає, поки шрифти й анімації «заспокояться». */
async function settle(ms = 150) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
}

/** Знімає скріншот і повертає його відносний шлях. */
async function shot(name, { full = false, clip } = {}) {
  const file = path.join(SHOTS, `${String(++counter).padStart(3, '0')}-${slug(name)}.png`);
  if (clip) await (await locate(clip)).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: full });
  return rel(file);
}

/** Усі команди демона. Кожна повертає JSON-об'єкт; помилка = { error }. */
const handlers = {
  /** Відкриває адресу (відносну — від BASE). */
  async goto({ url }) { await page.goto(/^https?:/.test(url) ? url : new URL(url, BASE).href, { waitUntil: 'load' }); await settle(); return {}; },
  async back() { await page.goBack(); await settle(); return {}; },
  async reload() { await page.reload(); await settle(); return {}; },
  async click({ target }) { await (await locate(target)).click({ timeout: 8000 }); await settle(); return {}; },
  async dblclick({ target }) { await (await locate(target)).dblclick({ timeout: 8000 }); await settle(); return {}; },
  async hover({ target }) { await (await locate(target)).hover({ timeout: 8000 }); return {}; },
  async fill({ target, value }) { await (await locate(target)).fill(String(value ?? ''), { timeout: 8000 }); return {}; },
  /** Друкує по літері, як людина (спрацьовують onInput/маски). */
  async type({ target, value }) { const el = await locate(target); await el.click({ timeout: 8000 }); await el.pressSequentially(String(value ?? ''), { delay: 20 }); return {}; },
  async press({ key }) { await page.keyboard.press(key); await settle(80); return {}; },
  async select({ target, value }) { await (await locate(target)).selectOption(String(value)); return {}; },
  async check({ target }) { await (await locate(target)).check(); return {}; },
  async uncheck({ target }) { await (await locate(target)).uncheck(); return {}; },
  async upload({ target, value }) { await (await locate(target)).setInputFiles(String(value)); return {}; },
  /** Прокрутка: value = число (px вниз/вгору) або top|bottom. */
  async scroll({ value }) { await page.evaluate((v) => { if (v === 'top') scrollTo(0, 0); else if (v === 'bottom') scrollTo(0, document.documentElement.scrollHeight); else scrollBy(0, Number(v) || 400); }, value); await settle(80); return {}; },
  async wait({ target, value }) { if (target) await (await locate(target)).waitFor({ timeout: Number(value) || 8000 }); else await page.waitForTimeout(Math.min(Number(value) || 500, 10000)); return {}; },
  async resize({ width, height }) { await page.setViewportSize({ width: Number(width), height: Number(height) || (Number(width) <= 480 ? 800 : Number(width) <= 834 ? 1024 : 800) }); await settle(); return {}; },
  /** Мережа: offline | online | slow:<мс>. */
  async net({ value }) {
    await context.unroute('**/*').catch(() => {});
    await context.setOffline(value === 'offline');
    const m = /^slow:(\d+)$/.exec(String(value));
    if (m) await context.route('**/*', async (r) => { await new Promise((ok) => setTimeout(ok, Number(m[1]))); await r.continue().catch(() => {}); });
    return { note: `мережа: ${value}` };
  },
  /** Світла/темна тема. */
  async scheme({ value }) { await page.emulateMedia({ colorScheme: value === 'dark' ? 'dark' : 'light' }); return {}; },
  /** Очищає куки й сховище (як новий користувач). */
  async clear() { await context.clearCookies(); await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* немає доступу */ } }).catch(() => {}); return {}; },
  /** Виконує вираз у сторінці і повертає результат (для перевірки значень). */
  async eval({ value }) { return { result: await page.evaluate((js) => (0, eval)(js), String(value)) }; },
  /** Видимий текст сторінки або елемента (для порівняння з листом тощо). */
  async text({ target }) { return { text: target ? await (await locate(target)).innerText() : await page.evaluate(() => document.body.innerText) }; },
  /** Скріншот + опис того, що видно. */
  async look({ name, full, target }) {
    const file = await shot(name || 'look', { full: Boolean(full), clip: target });
    const o = await outline();
    const res = { shot: file, url: page.url(), title: await page.title(), viewport: page.viewportSize(), ...o, console: consoleErrors.splice(0), network: netErrors.splice(0), dialogs: dialogs.splice(0) };
    return res;
  },
  /** Перевірка верстки на списку ширин: для кожної — аудит у сторінці й скріншот усієї сторінки. */
  async sweep({ name, widths }) {
    const out = [];
    for (const w of String(widths).split(',').map((x) => Number(x)).filter(Boolean)) {
      await handlers.resize({ width: w });
      const issues = await page.evaluate(auditInPage, []);
      const file = await shot(`${name || 'sweep'}-${w}`, { full: true });
      const errors = issues.filter((i) => i.severity === 'error');
      fs.appendFileSync(path.join(TASK_DIR, 'layout.jsonl'), JSON.stringify({ name: name || 'sweep', width: w, url: page.url(), errors: errors.length, warnings: issues.length - errors.length, issues: issues.slice(0, 20), shot: file, at: new Date().toISOString() }) + '\n');
      out.push({ width: w, shot: file, errors: errors.length, warnings: issues.length - errors.length, issues: issues.slice(0, 8) });
    }
    return { url: page.url(), sweep: out };
  },
  async stop() { setTimeout(() => process.exit(0), 100); return { note: 'зупинено' }; },
};

/** HTTP-сервер: POST / { cmd, ...args } → JSON. Слухає лише 127.0.0.1. */
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let reply;
    try {
      const { cmd, ...args } = JSON.parse(body || '{}');
      if (cmd !== 'stop' && DEADLINE && Date.now() > DEADLINE) throw Object.assign(new Error('TIME_UP: ліміт часу тестування вичерпано. Зроби `pl eyes finish` і запиши звіт з того, що встиг.'), { timeUp: true });
      const fn = handlers[cmd] ?? (() => { throw new Error(`невідома команда ${cmd}`); });
      const result = await fn(args);
      const row = journal({ cmd, args, url: page.url(), viewport: page.viewportSize(), shot: result.shot, shots: result.sweep?.map((s) => s.shot) });
      reply = { ok: true, n: counter, ...result, at: row.at };
    } catch (e) {
      journal({ cmd: 'error', error: String(e.message).slice(0, 300) });
      reply = { ok: false, error: String(e.message).split('\n')[0].slice(0, 400), timeUp: e.timeUp };
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(reply));
  });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(path.join(DIR, 'web.json'), JSON.stringify({ pid: process.pid, port: server.address().port, base: BASE, startedAt: new Date().toISOString() }));
});
process.on('SIGTERM', async () => { await browser.close().catch(() => {}); process.exit(0); });
