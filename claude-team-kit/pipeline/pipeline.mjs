#!/usr/bin/env node
// Claude Team Kit — deterministic helper for the multi-agent pipeline.
// Zero dependencies, Node >= 18. Run `node pipeline.mjs help`.
//
// Everything that must be exact (branches, diffs, gates, commits, rollback,
// deploy, loop limits) lives here. Agents only decide; this script executes.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PL = 'node ~/.claude/pipeline/pipeline.mjs';
const MANIFEST_REL = path.join('.pipeline', 'workspace.json');
const SERVICE_TYPES = ['frontend', 'mobile', 'backend', 'worker', 'infra', 'library', 'other'];
const STATUSES = ['IN_PROGRESS', 'BLOCKED', 'DONE', 'FAILED'];
const VALUE_FLAGS = new Set(['task', 'type', 'file', 'platform', 'service']);
const PIPELINE_EXCLUDE = ':(exclude,glob).pipeline/**';

// Files the blind auditor never sees: intent (specs, agent configs, pipeline
// artifacts) and token noise (lockfiles, build output, snapshots, maps).
const AUDIT_EXCLUDES = [
  '.pipeline/**', '.claude/**', 'CLAUDE.md', '**/CLAUDE.md', 'docs/**',
  '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock', '**/bun.lockb',
  '**/dist/**', '**/build/**', '**/.next/**', '**/.nuxt/**', '**/coverage/**',
  '**/*.min.js', '**/*.snap', '**/*.map',
];

// Read-only / low-risk subcommands that can run without a permission prompt.
// start, commit, rollback and deploy change state, so the user approves them.
const SAFE_ALLOW = ['rules', 'conventions', 'services', 'owner', 'status', 'diff', 'verify', 'comments', 'sim', 'mark', 'template', 'doctor']
  .map((c) => `Bash(${PL} ${c}:*)`);

// ---------------------------------------------------------------- utils
const log = (...a) => console.log(...a);
function die(msg, code = 1) { console.error(`✖ ${msg}`); process.exit(code); }
const posix = (p) => p.split(path.sep).join('/');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const label = (r) => r.rel || '(workspace)';
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const cleanPath = (p) => posix(p).replace(/^\.\//, '').replace(/\/+$/, '');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    die(`${file}: ${e.message}`);
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function run(cmd, args, cwd, opts = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, input: opts.input });
  if (r.error) die(`${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) die(`${cmd} ${args.join(' ')} failed in ${cwd}\n${(r.stderr || r.stdout || '').trim()}`);
  return r;
}
const git = (cwd, args, opts) => run('git', args, cwd, opts);
const gitOut = (cwd, args, opts) => git(cwd, args, opts).stdout.trim();

function parseArgs(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-m') { flags.m = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (VALUE_FLAGS.has(k) && argv[i + 1] !== undefined) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
function table(head, rows) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)));
  const line = (r) => r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ').trimEnd();
  log(line(head)); log(w.map((n) => '-'.repeat(n)).join('  ')); rows.forEach((r) => log(line(r)));
}

// ------------------------------------------------------------ workspace
function findRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, MANIFEST_REL))) return d;
    const p = path.dirname(d);
    if (p === d) return null;
    d = p;
  }
}
function validate(ws, root) {
  const e = [];
  if (!Array.isArray(ws.services) || !ws.services.length) return ['"services" must be a non-empty array'];
  const names = new Set();
  for (const s of ws.services) {
    if (!s.name || !/^[a-z0-9][a-z0-9_-]*$/i.test(s.name)) e.push(`service name "${s.name}" must be a simple slug`);
    if (names.has(s.name)) e.push(`duplicate service name "${s.name}"`);
    names.add(s.name);
    if (!SERVICE_TYPES.includes(s.type)) e.push(`service "${s.name}": type must be one of ${SERVICE_TYPES.join(', ')}`);
    if (!s.path) e.push(`service "${s.name}": "path" is required`);
    else if (!fs.existsSync(path.resolve(root, s.path))) e.push(`service "${s.name}": path "${s.path}" does not exist`);
    if (s.type === 'mobile') {
      const m = s.mobile;
      if (!m || !Array.isArray(m.platforms) || !m.platforms.length) e.push(`mobile service "${s.name}": "mobile.platforms" must list ios and/or android`);
      else for (const pf of m.platforms) {
        if (!['ios', 'android'].includes(pf)) e.push(`mobile service "${s.name}": unknown platform "${pf}"`);
        if (!m.appId?.[pf]) e.push(`mobile service "${s.name}": "mobile.appId.${pf}" is required`);
        if (!m.build?.[pf]) e.push(`mobile service "${s.name}": "mobile.build.${pf}" is required`);
        if (!m.device?.[pf]) e.push(`mobile service "${s.name}": "mobile.device.${pf}" (simulator / AVD name) is required`);
      }
    }
  }
  for (const [env, cfg] of Object.entries(ws.deploy?.environments ?? {})) {
    if (!Array.isArray(cfg.steps) || !cfg.steps.length) e.push(`deploy.environments.${env}.steps must be a non-empty array`);
  }
  return e;
}
function loadWorkspace(cwd = process.cwd()) {
  const root = findRoot(cwd);
  if (!root) die(`No ${posix(MANIFEST_REL)} here or in parent folders. Run /pipeline-init-web or /pipeline-init-mobile in the workspace root first.`);
  const ws = readJson(path.join(root, MANIFEST_REL));
  const errors = validate(ws, root);
  if (errors.length) die(`workspace.json is invalid:\n  - ${errors.join('\n  - ')}`);
  return { root, ws };
}
function getService(ws, name) {
  return ws.services.find((s) => s.name === name)
    ?? die(`Unknown service "${name}". Known: ${ws.services.map((s) => s.name).join(', ')}`);
}

// ---------------------------------------------------------------- repos
function repoInfo(root, absPath) {
  const r = git(absPath, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (r.status !== 0) return null;
  const top = fs.realpathSync(r.stdout.trim());
  const rel = posix(path.relative(fs.realpathSync(root), top));
  return { root: top, rel, key: rel === '' ? 'workspace' : rel.replace(/\//g, '__') };
}
function groupRepos(root, ws, serviceNames) {
  const map = new Map();
  const add = (info, svc) => {
    if (!map.has(info.root)) map.set(info.root, { ...info, services: [] });
    if (svc) map.get(info.root).services.push(svc);
  };
  for (const name of serviceNames) {
    const s = getService(ws, name);
    const info = repoInfo(root, path.resolve(root, s.path));
    if (!info) die(`Service "${name}" (${s.path}) is not in a git repository. Run "git init" there and make a first commit.`);
    if (info.rel.startsWith('..')) die(`Service "${name}" belongs to a git repo above the workspace (${info.root}). Put .pipeline/workspace.json at that repo's root.`);
    add(info, name);
  }
  const w = repoInfo(root, root); // specs, contracts, e2e live in the workspace repo (if it is one)
  if (w && !w.rel.startsWith('..')) add(w);
  // A repo must never see files of another repo nested inside it.
  const all = allRepoRoots(root, ws);
  for (const r of map.values()) {
    r.nested = all.filter((o) => o !== r.root && o.startsWith(r.root + path.sep)).map((o) => posix(path.relative(r.root, o)));
  }
  return [...map.values()];
}
function allRepoRoots(root, ws) {
  const set = new Set();
  for (const s of ws.services) {
    const abs = path.resolve(root, s.path);
    const info = fs.existsSync(abs) ? repoInfo(root, abs) : null;
    if (info) set.add(info.root);
  }
  return [...set];
}
// Pathspec for "this repo, minus .pipeline and minus nested repos".
// Nested repos already in .gitignore need no exclude (git refuses pathspecs naming ignored paths).
function scope(r, extra = []) {
  if (!r._nestedSpecs) {
    r._nestedSpecs = (r.nested ?? [])
      .filter((n) => git(r.root, ['check-ignore', '-q', '--no-index', n], { allowFail: true }).status !== 0)
      .map((n) => `:(exclude)${n}`);
  }
  return ['.', PIPELINE_EXCLUDE, ...r._nestedSpecs, ...extra];
}
function auditSpecs(ws) {
  const extra = [...(ws.audit?.exclude ?? [])];
  if (ws.e2e?.path) extra.push(`${cleanPath(ws.e2e.path)}/**`);
  if (ws.e2eMobile?.path) extra.push(`${cleanPath(ws.e2eMobile.path)}/**`);
  return [...AUDIT_EXCLUDES, ...extra].map((p) => `:(exclude,glob)${p}`);
}
// Make untracked files visible to `git diff` without really staging them.
function withIntentToAdd(repo, specs, fn) {
  const untracked = git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...scope(repo, specs)])
    .stdout.split('\0').filter(Boolean);
  for (const c of chunks(untracked, 200)) git(repo.root, ['add', '--intent-to-add', '--', ...c]);
  try { return fn(); }
  finally { for (const c of chunks(untracked, 200)) git(repo.root, ['reset', '-q', '--', ...c], { allowFail: true }); }
}
function repoDiff(repo, specs, { names = false } = {}) {
  const prefix = repo.rel ? `${repo.rel}/` : '';
  return withIntentToAdd(repo, specs, () => {
    const patch = git(repo.root, ['diff', repo.base, '--unified=8', '--no-color', '--no-ext-diff',
      `--src-prefix=a/${prefix}`, `--dst-prefix=b/${prefix}`, '--', ...scope(repo, specs)]).stdout;
    const files = names
      ? git(repo.root, ['diff', repo.base, '--name-only', '--', ...scope(repo, specs)]).stdout.split('\n').filter(Boolean).map((f) => prefix + f)
      : [];
    return { patch, files };
  });
}
const fingerprint = (st, specs) => sha(st.repos.map((r) => `${r.key}\n${repoDiff(r, specs).patch}`).join('\n\0\n'));

// ---------------------------------------------------------------- state
const taskDir = (root, id) => path.join(root, '.pipeline', id);
const statePath = (root, id) => path.join(taskDir(root, id), 'state.json');
const tasksPath = (root) => path.join(root, '.pipeline', 'tasks.json');
function loadState(root, id) {
  if (!fs.existsSync(statePath(root, id))) die(`Task "${id}" is not started. Run: ${PL} start ${id} <services>`);
  return readJson(statePath(root, id));
}
const saveState = (root, st) => writeJson(statePath(root, st.id), { ...st, repos: st.repos.map(({ _nestedSpecs, ...r }) => r) });
function updateTask(root, id, patch) {
  const db = readJson(tasksPath(root), { tasks: [] });
  let t = db.tasks.find((x) => x.id === id);
  if (!t) { t = { id, stage: 0, status: 'IN_PROGRESS', loops: {}, note: null }; db.tasks.push(t); }
  Object.assign(t, patch, { updatedAt: now() });
  writeJson(tasksPath(root), db);
  return t;
}
function verdictOf(root, id, file) {
  const p = path.join(taskDir(root, id), file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).verdict ?? '?'; } catch { return 'INVALID'; }
}

// ------------------------------------------------------------- commands
function cmdStart({ pos, flags }) {
  const [id, svcArg] = pos;
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || id === 'adhoc') die('Usage: start <task-id in kebab-case> <service,service|all> [--no-qa] [--allow-dirty]');
  if (!svcArg) die('List affected services, e.g. "users,web" or "all"');
  const { root, ws } = loadWorkspace();
  if (fs.existsSync(statePath(root, id))) die(`Task "${id}" already exists. Use /resume ${id} or choose another id.`);
  const services = svcArg === 'all' ? ws.services.map((s) => s.name) : [...new Set(svcArg.split(',').map((s) => s.trim()).filter(Boolean))];
  services.forEach((n) => getService(ws, n));
  const repos = groupRepos(root, ws, services);
  const branch = `${ws.pipeline?.branchPrefix ?? 'feat/'}${id}`;

  for (const r of repos) { // check everything before touching anything
    if (git(r.root, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }).status !== 0) die(`${label(r)}: no commits yet — make an initial commit first.`);
    const dirty = gitOut(r.root, ['status', '--porcelain', '--', ...scope(r)]);
    if (dirty && !flags['allow-dirty']) die(`${label(r)} has uncommitted changes:\n${dirty}\nCommit or stash them first (or pass --allow-dirty).`);
    if (git(r.root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { allowFail: true }).status === 0) die(`${label(r)}: branch ${branch} already exists.`);
  }
  for (const r of repos) {
    r.base = gitOut(r.root, ['rev-parse', 'HEAD']);
    r.fromBranch = gitOut(r.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    r.branch = branch;
    git(r.root, ['checkout', '-q', '-b', branch]);
  }
  const qa = flags['no-qa'] ? [] : qaTargets(ws, services);
  saveState(root, { id, services, repos, qa, createdAt: now() });
  updateTask(root, id, { services, branch, stage: 1, status: 'IN_PROGRESS', loops: {}, note: null });
  log(`✔ Task ${id} started on ${branch}`);
  for (const r of repos) log(`  ${label(r).padEnd(28)} base ${r.base.slice(0, 8)}  services: ${r.services.join(', ') || '— (specs/contracts/e2e)'}`);
  log(`  QA: ${qa.length ? qa.map((q) => (q === 'web' ? 'web → team-qa' : 'mobile → team-qa-mobile')).join(', ') : 'skipped (--no-qa)'}`);
}
// Which QA agents a task needs: web for web frontends, mobile for apps;
// backend-only tasks are tested through whatever e2e kind the workspace has.
function qaTargets(ws, services) {
  const types = services.map((n) => getService(ws, n).type);
  const t = new Set();
  if (types.includes('frontend')) t.add('web');
  if (types.includes('mobile')) t.add('mobile');
  if (!t.size) {
    if (ws.e2e?.path) t.add('web');
    else if (ws.e2eMobile?.path) t.add('mobile');
  }
  return [...t];
}
const QA_FILES = { web: 'qa.json', mobile: 'qa-mobile.json' };

function cmdDiff({ pos }) {
  const id = pos[0] ?? die('Usage: diff <task-id|adhoc>');
  const { root, ws } = loadWorkspace();
  let st;
  if (id === 'adhoc') { // audit current uncommitted work against HEAD, no branches
    const repos = groupRepos(root, ws, ws.services.map((s) => s.name));
    for (const r of repos) r.base = 'HEAD';
    st = { id, services: ws.services.map((s) => s.name), repos, adhoc: true, createdAt: now() };
  } else st = loadState(root, id);

  const specs = auditSpecs(ws);
  const parts = st.repos.map((r) => ({ r, ...repoDiff(r, specs, { names: true }) }));
  const patch = parts.map((p) => p.patch).filter(Boolean).join('\n');
  const files = parts.flatMap((p) => p.files);
  const dir = taskDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'diff.patch'), patch ? patch + '\n' : '');
  fs.writeFileSync(path.join(dir, 'changed_files.txt'), files.length ? files.join('\n') + '\n' : '');
  st.auditHash = sha(parts.map((p) => `${p.r.key}\n${p.patch}`).join('\n\0\n'));
  st.diffAt = now();
  saveState(root, st);

  const lines = patch ? patch.split('\n').length : 0;
  log(`✔ diff: .pipeline/${id}/diff.patch (${lines} lines, ${files.length} files, ${st.repos.length} repo(s))`);
  log(`  files: .pipeline/${id}/changed_files.txt`);
  if (!files.length) log('  (no changes)');
  const max = ws.audit?.maxDiffLines ?? 3000;
  if (lines > max) log(`⚠ diff is larger than ${max} lines — consider splitting the task; audit quality drops on huge diffs.`);
}

function cmdVerify({ pos }) {
  const id = pos[0] ?? die('Usage: verify <task-id> [service,service]');
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  const names = pos[1] ? pos[1].split(',') : st.services;
  const steps = ws.pipeline?.verifySteps ?? ['lint', 'typecheck', 'test', 'build'];
  const timeout = (ws.pipeline?.stepTimeoutSec ?? 900) * 1000;
  const logFile = path.join(taskDir(root, id), 'verify.log');
  const results = [];
  let failed = null;

  if (commentsEnforced(ws)) { // project convention: every function/variable has a comment in the chosen language
    process.stdout.write(`▶ comments (${commentLanguage(ws).name}) … `);
    const v = checkComments(root, ws, st, names);
    if (v.length) {
      log(`FAIL (${v.length})`);
      const owners = [...new Set(v.map((x) => `${x.agent}${x.service ? `:${x.service}` : ''}`))];
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, `# comments check: ${v.length} violation(s)\n${formatViolations(v)}\n`);
      log(formatViolations(v.slice(0, 25)));
      failed = { service: owners.join(', '), owners, path: null, step: 'comments', command: `${PL} comments ${id} <service>` };
      results.push({ service: '*', step: 'comments', status: 'failed', count: v.length });
    } else { log('ok'); results.push({ service: '*', step: 'comments', status: 'passed' }); }
  }

  outer: for (const name of failed ? [] : names) {
    const s = getService(ws, name);
    for (const step of steps) {
      const cmd = s.commands?.[step];
      if (!cmd) { results.push({ service: name, step, status: 'skipped' }); continue; }
      process.stdout.write(`▶ ${name} › ${step}: ${cmd} … `);
      const t0 = Date.now();
      const r = spawnSync(cmd, { cwd: path.resolve(root, s.path), shell: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
      const ok = r.status === 0;
      log(ok ? `ok (${((Date.now() - t0) / 1000).toFixed(1)}s)` : r.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : `FAIL (exit ${r.status})`);
      results.push({ service: name, step, status: ok ? 'passed' : 'failed', ms: Date.now() - t0 });
      if (!ok) {
        const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-120);
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        fs.writeFileSync(logFile, `# ${name} › ${step}: ${cmd}  (cwd: ${s.path})\n${out.join('\n')}\n`);
        failed = { service: name, path: s.path, step, command: cmd };
        log(out.slice(-25).join('\n'));
        break outer;
      }
    }
  }
  const ran = results.filter((r) => r.status !== 'skipped').length;
  const verdict = failed ? 'FAIL' : 'PASS';
  writeJson(path.join(taskDir(root, id), 'verify.json'), {
    task: id, verdict, failed, log: failed ? `.pipeline/${id}/verify.log` : null,
    warning: ran === 0 ? 'no verify commands configured for these services' : null,
    results, hash: failed ? null : fingerprint(st, [PIPELINE_EXCLUDE]), at: now(),
  });
  if (ran === 0) log('⚠ no lint/typecheck/test/build commands configured — nothing was really checked.');
  log(`${failed ? '✖' : '✔'} verify ${verdict}${failed ? ` — ${failed.service} › ${failed.step} (log: .pipeline/${id}/verify.log)` : ''}`);
  if (failed) process.exit(1);
}

function cmdCommit({ pos, flags }) {
  const id = pos[0] ?? die('Usage: commit <task-id> -m "<conventional commit message>"');
  const msg = typeof flags.m === 'string' ? flags.m.trim() : die('Commit message required: -m "feat(scope): summary"');
  if (!/^(feat|fix|refactor|perf|chore|docs|test|build|ci|style)(\([^)]+\))?!?: .+/.test(msg.split('\n')[0])) {
    die('Message must follow Conventional Commits, e.g. "feat(users): add password reset"');
  }
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  if (st.adhoc) die('adhoc audits cannot be committed');
  const dir = taskDir(root, id);

  const problems = [];
  const sec = readJson(path.join(dir, 'security.json'), null);
  if (sec?.verdict !== 'PASS') problems.push(`security.json verdict is ${sec?.verdict ?? 'missing'} (need PASS)`);
  else if (!st.diffAt || fs.statSync(path.join(dir, 'security.json')).mtimeMs < Date.parse(st.diffAt)) problems.push('security.json is older than the last diff — re-run the audit');
  const targets = Array.isArray(st.qa) ? st.qa : st.qa === 'skip' ? [] : ['web'];
  for (const t of targets) {
    const qa = readJson(path.join(dir, QA_FILES[t]), null);
    if (qa?.verdict !== 'PASS') problems.push(`${QA_FILES[t]} verdict is ${qa?.verdict ?? 'missing'} (need PASS)`);
    if (t === 'mobile') {
      const sims = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^sim-(ios|android)\.json$/.test(f)) : [];
      if (!sims.length) problems.push('no simulator run found (sim-ios.json / sim-android.json)');
      for (const f of sims) { const v = readJson(path.join(dir, f), null)?.verdict; if (v !== 'PASS') problems.push(`${f} verdict is ${v ?? 'missing'} (need PASS)`); }
    }
  }
  const ver = readJson(path.join(dir, 'verify.json'), null);
  if (ver?.verdict !== 'PASS') problems.push(`verify.json verdict is ${ver?.verdict ?? 'missing'} (need PASS)`);
  if (!problems.length) {
    if (fingerprint(st, auditSpecs(ws)) !== st.auditHash) problems.push('code changed after the security audit — run diff + audit again');
    if (fingerprint(st, [PIPELINE_EXCLUDE]) !== ver.hash) problems.push('code changed after verify — run verify again');
  }
  if (problems.length) die(`Commit refused:\n  - ${problems.join('\n  - ')}`, 2);

  for (const r of st.repos) {
    const cur = gitOut(r.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (cur !== r.branch) die(`${label(r)} is on "${cur}", expected "${r.branch}"`);
  }
  const forbidden = (f) => (/(^|\/)\.env(\.[^/]*)?$/.test(f) && !/\.env\.(example|sample|template)$/.test(f))
    || /\.(pem|key|p12|pfx|keystore|jks)$/i.test(f) || /(^|\/)id_(rsa|ed25519|ecdsa)$/.test(f);
  const limit = (ws.pipeline?.maxFileSizeKb ?? 1024) * 1024;

  const staged = new Map();
  const bad = [];
  const unstageAll = () => { for (const r of st.repos) git(r.root, ['reset', '-q'], { allowFail: true }); };
  for (const r of st.repos) { // stage + check every repo before committing any
    const add = git(r.root, ['add', '-A', '--', ...scope(r)], { allowFail: true });
    if (add.status !== 0) { unstageAll(); die(`${label(r)}: git add failed\n${add.stderr.trim()}`); }
    const files = gitOut(r.root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
    staged.set(r.root, files);
    for (const f of files) {
      const abs = path.join(r.root, f);
      if (forbidden(f) || (fs.existsSync(abs) && fs.statSync(abs).size > limit)) bad.push(`${label(r)}/${f}`);
    }
  }
  if (bad.length) {
    unstageAll();
    die(`Refusing to commit secrets or oversized files:\n  ${bad.join('\n  ')}\nAdd them to .gitignore or remove them, then re-run verify and commit.`, 2);
  }
  const commits = [];
  for (const r of st.repos) {
    const files = staged.get(r.root);
    if (!files.length) { log(`  ${label(r)}: nothing to commit`); continue; }
    const c = git(r.root, ['commit', '-q', '-F', '-'], { input: `${msg}\n\nTask: ${id}\n`, allowFail: true });
    if (c.status !== 0) {
      st.commits = commits; saveState(root, st);
      die(`${label(r)}: git commit failed (a git hook?)\n${(c.stderr || c.stdout).trim()}\nAlready committed: ${commits.map((x) => `${x.repo} ${x.sha.slice(0, 8)}`).join(', ') || 'none'}. Fix and re-run commit.`);
    }
    const hash = gitOut(r.root, ['rev-parse', 'HEAD']);
    commits.push({ repo: label(r), sha: hash, files: files.length });
    log(`✔ ${label(r)}: ${hash.slice(0, 8)} on ${r.branch} (${files.length} files)`);
  }
  st.commits = commits; st.committedAt = now(); saveState(root, st);
  updateTask(root, id, { stage: 5, status: 'DONE', note: `committed in ${commits.length} repo(s)` });
  log('Nothing was pushed. Review and push yourself, or run a deploy step.');
}

function cmdRollback({ pos }) {
  const id = pos[0] ?? die('Usage: rollback <task-id>');
  const { root } = loadWorkspace();
  const st = loadState(root, id);
  const tag = `team-kit-rollback-${id}-${Date.now()}`;
  for (const r of st.repos) {
    const dirty = gitOut(r.root, ['status', '--porcelain', '--', ...scope(r)]);
    if (dirty) git(r.root, ['stash', 'push', '--include-untracked', '-q', '-m', tag, '--', ...scope(r)]);
    const back = r.fromBranch && r.fromBranch !== 'HEAD' ? r.fromBranch : r.base;
    if (back && gitOut(r.root, ['rev-parse', '--abbrev-ref', 'HEAD']) !== back) git(r.root, ['checkout', '-q', back]);
    log(`↺ ${label(r)}: ${dirty ? `changes stashed as "${tag}"` : 'no uncommitted changes'}; back on ${back}; branch ${r.branch} kept`);
  }
  st.rolledBackAt = now(); st.stash = tag; saveState(root, st);
  updateTask(root, id, { status: 'FAILED', note: `rolled back (stash: ${tag})` });
  log(`Recover: git checkout ${st.repos[0]?.branch} && git stash list | grep ${id} && git stash pop <stash@{n}>`);
}

function cmdMark({ pos }) {
  const [id, ...kv] = pos;
  if (!id || !kv.length) die('Usage: mark <task-id> [stage=<n>] [status=IN_PROGRESS|BLOCKED|DONE|FAILED] [loop=<security|qa|verify>] [note=<text>]');
  const { root, ws } = loadWorkspace();
  const db = readJson(tasksPath(root), { tasks: [] });
  const cur = db.tasks.find((t) => t.id === id) ?? die(`Unknown task "${id}"`);
  const patch = {};
  let loopName = null;
  for (const pair of kv) {
    const i = pair.indexOf('=');
    if (i < 1) die(`Bad argument "${pair}" (expected key=value)`);
    const k = pair.slice(0, i); const v = pair.slice(i + 1);
    if (k === 'stage') patch.stage = Number(v);
    else if (k === 'status') { if (!STATUSES.includes(v)) die(`status must be one of ${STATUSES.join(', ')}`); patch.status = v; }
    else if (k === 'note') patch.note = v;
    else if (k === 'loop') loopName = v;
    else die(`Unknown key "${k}"`);
  }
  if (loopName) {
    const loops = { ...(cur.loops ?? {}) };
    loops[loopName] = (loops[loopName] ?? 0) + 1;
    patch.loops = loops;
    const max = ws.pipeline?.maxLoops ?? 3;
    if (loops[loopName] > max) {
      updateTask(root, id, { ...patch, status: 'BLOCKED', note: `loop limit reached: ${loopName}` });
      log(`LOOP_LIMIT ${loopName}: ${max} fix rounds already used. Stop fixing — run rollback and report to the user.`);
      process.exit(3);
    }
    log(`fix round ${loopName}: ${loops[loopName]}/${max}`);
  }
  const t = updateTask(root, id, patch);
  log(`✔ ${id}: stage ${t.stage} ${t.status}${t.note ? ` — ${t.note}` : ''}`);
}

function cmdStatus() {
  const { root } = loadWorkspace();
  const db = readJson(tasksPath(root), { tasks: [] });
  if (!db.tasks.length) return log('No tasks yet.');
  table(['task', 'stage', 'status', 'services', 'loops', 'security', 'qa', 'verify', 'note'], db.tasks.map((t) => [
    t.id, t.stage, t.status, (t.services ?? []).join(','),
    Object.entries(t.loops ?? {}).map(([k, v]) => `${k}:${v}`).join(' ') || '—',
    verdictOf(root, t.id, 'security.json') ?? '-', verdictOf(root, t.id, 'qa.json') ?? '-', verdictOf(root, t.id, 'verify.json') ?? '-',
    t.note ?? '',
  ]));
}

function agentFor(type) {
  return { frontend: 'team-frontend', mobile: 'team-mobile', backend: 'team-backend', worker: 'team-backend', library: 'team-backend', infra: 'team-devops (infra)', other: 'orchestrator' }[type];
}
function cmdServices({ flags }) {
  const { root, ws } = loadWorkspace();
  let list = ws.services;
  if (flags.type) list = list.filter((s) => s.type === flags.type);
  if (flags.json) return log(JSON.stringify({ root: posix(root), contracts: ws.contracts ?? null, e2e: ws.e2e ?? null, e2eMobile: ws.e2eMobile ?? null, conventions: ws.conventions ?? null, services: list }, null, 2));
  log(`workspace: ${ws.name ?? path.basename(root)}  (${posix(root)})`);
  table(['service', 'type', 'path', 'stack', 'agent'], list.map((s) => [s.name, s.type, s.path, s.stack ?? '', agentFor(s.type)]));
  if (ws.contracts?.path) log(`contracts: ${ws.contracts.path}${ws.contracts.codegen ? `  (codegen: ${ws.contracts.codegen})` : ''}`);
  if (ws.e2e?.path) log(`e2e web: ${ws.e2e.path}  (Playwright → team-qa)`);
  if (ws.e2eMobile?.path) log(`e2e mobile: ${ws.e2eMobile.path}  (Maestro on simulators → team-qa-mobile)`);
  if (commentsEnforced(ws)) log(`comments: ${commentLanguage(ws).name}, level "${ws.conventions.comments.level ?? 'all'}" — checked in verify`);
  const envs = Object.keys(ws.deploy?.environments ?? {});
  if (envs.length) log(`deploy: ${envs.map((e) => `${e}${ws.deploy.environments[e].requireApproval ? ' (approval)' : ''}`).join(', ')}`);
}

function ownerOf(ws, file) {
  const f = cleanPath(file);
  const under = (p) => p && (f === cleanPath(p) || f.startsWith(cleanPath(p) + '/'));
  if (ws.e2e?.path && under(ws.e2e.path)) return { agent: 'team-qa' };
  if (ws.e2eMobile?.path && under(ws.e2eMobile.path)) return { agent: 'team-qa-mobile' };
  if (ws.contracts?.path && under(ws.contracts.path)) return { agent: 'orchestrator', why: 'contracts' };
  let best = null;
  for (const s of ws.services) {
    const p = cleanPath(s.path);
    if ((p === '' || p === '.' || under(p)) && (!best || p.length > best.p.length)) best = { s, p };
  }
  const isInfra = /(^|\/)(Dockerfile[^/]*|\.dockerignore|(docker-)?compose[^/]*\.ya?ml)$/.test(f) || /^\.(github|gitlab)\//.test(f) || /^\.gitlab-ci/.test(f);
  if (isInfra) return { agent: 'team-devops', mode: 'infra', service: best?.s.name };
  if (!best) return { agent: 'orchestrator', why: 'outside any service' };
  const t = best.s.type;
  if (t === 'frontend') return { agent: 'team-frontend', service: best.s.name };
  if (t === 'mobile') return { agent: 'team-mobile', service: best.s.name };
  if (t === 'infra') return { agent: 'team-devops', mode: 'infra', service: best.s.name };
  if (t === 'other') return { agent: 'orchestrator', service: best.s.name };
  return { agent: 'team-backend', service: best.s.name };
}
function cmdOwner({ pos, flags }) {
  const { root, ws } = loadWorkspace();
  let files = pos;
  if (flags.file) files = fs.readFileSync(path.resolve(root, flags.file), 'utf8').split('\n').filter(Boolean);
  if (!files.length) die('Usage: owner <file...> | owner --file .pipeline/<id>/changed_files.txt');
  const groups = new Map();
  for (const f of files) {
    const o = ownerOf(ws, f);
    const key = `${o.agent}${o.mode ? ` mode=${o.mode}` : ''}${o.service ? ` service=${o.service}` : ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  if (flags.json) return log(JSON.stringify(Object.fromEntries(groups), null, 2));
  for (const [k, v] of groups) log(`${k}\n  ${v.join('\n  ')}`);
}

async function checkHealth(list, report) {
  for (const hc of list) {
    const c = typeof hc === 'string' ? { url: hc } : hc;
    const retries = c.retries ?? 10; const interval = (c.intervalSec ?? 6) * 1000;
    let ok = false; let last = '';
    for (let i = 1; i <= retries && !ok; i++) {
      try {
        const res = await fetch(c.url, { signal: AbortSignal.timeout((c.timeoutSec ?? 5) * 1000) });
        ok = c.expectStatus ? res.status === c.expectStatus : res.ok;
        last = `HTTP ${res.status}`;
      } catch (e) { last = e.cause?.code ?? e.name ?? String(e); }
      if (!ok && i < retries) await new Promise((r) => setTimeout(r, interval));
    }
    report.healthchecks.push({ url: c.url, status: ok ? 'passed' : 'failed', last });
    log(`${ok ? '✔' : '✖'} health ${c.url} → ${last}`);
    if (!ok) return false;
  }
  return true;
}
async function cmdDeploy({ pos, flags }) {
  const env = pos[0] ?? die('Usage: deploy <env> [--task <id>] [--approved]');
  const { root, ws } = loadWorkspace();
  const cfg = ws.deploy?.environments?.[env]
    ?? die(`No deploy.environments.${env} in workspace.json. Known: ${Object.keys(ws.deploy?.environments ?? {}).join(', ') || 'none'}`);
  if (cfg.requireApproval && !flags.approved) die(`Environment "${env}" requires explicit approval. Ask the user; only after a clear "yes" re-run with --approved.`, 4);
  const id = typeof flags.task === 'string' ? flags.task : null;
  if (id && !loadState(root, id).commits?.length) die(`Task ${id} has no commits yet — finish the pipeline (commit) before deploying.`, 2);

  const dir = id ? taskDir(root, id) : path.join(root, '.pipeline', '_deploys');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, `deploy-${env}.log`);
  fs.writeFileSync(logFile, `# deploy ${env} ${now()}\n`);
  const report = { env, task: id, verdict: 'PASS', steps: [], healthchecks: [], rolledBack: false, at: now() };
  const runSteps = (steps, kind) => {
    for (const step of steps) {
      const name = step.name ?? step.run;
      log(`▶ [${kind}] ${name}`);
      const t0 = Date.now();
      const r = spawnSync(step.run, { cwd: path.resolve(root, step.cwd ?? '.'), shell: true, encoding: 'utf8', maxBuffer: 1 << 28,
        timeout: (step.timeoutSec ?? 1800) * 1000, env: { ...process.env, DEPLOY_ENV: env } });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      fs.appendFileSync(logFile, `\n### ${kind}: ${name}\n$ ${step.run}\n${out}`);
      const ok = r.status === 0;
      report.steps.push({ kind, name, status: ok ? 'passed' : 'failed', ms: Date.now() - t0 });
      if (!ok) { log(out.trim().split('\n').slice(-30).join('\n')); log(`✖ step failed: ${name}`); return false; }
    }
    return true;
  };
  let ok = runSteps(cfg.steps, 'deploy');
  if (ok) ok = await checkHealth(cfg.healthchecks ?? [], report);
  if (!ok) {
    report.verdict = 'FAIL';
    if (cfg.rollback?.length) { log('↺ running rollback steps'); report.rolledBack = runSteps(cfg.rollback, 'rollback'); }
  }
  report.log = posix(path.relative(root, logFile));
  writeJson(path.join(dir, `deploy-${env}.json`), report);
  if (id) updateTask(root, id, { stage: 6, status: ok ? 'DONE' : 'FAILED', note: `deploy ${env}: ${report.verdict}` });
  log(`${ok ? '✔' : '✖'} deploy ${env}: ${report.verdict}${report.rolledBack ? ' (rolled back)' : ''}`);
  if (!ok) process.exit(1);
}

// --------------------------------------------------- comment convention
const LANGUAGES = {
  uk: { name: 'Ukrainian', native: 'українська', re: /[А-Яа-яІіЇїЄєҐґ]/ },
  en: { name: 'English', native: 'English', re: /[A-Za-z]/ },
};
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/;
const SKIP_FILE = /(\.d\.ts$|(^|\/)(generated|__generated__|vendor)\/|\.min\.js$|\.config\.(js|ts|mjs|cjs)$)/;
const TOOL_DIRECTIVE = /^\s*\/\/\s*(eslint|@ts-|prettier|istanbul|biome|#region|#endregion|tslint|c8|v8)/;
const KEYWORDS = 'if|for|while|switch|catch|return|function|else|do|try|new|await|throw|typeof|delete|void|yield|super|import|export';
const DECLARATIONS = [
  ['function', /^(export\s+)?(default\s+)?(async\s+)?function\b/],
  ['class', /^(export\s+)?(default\s+)?(abstract\s+)?class\s+[\w$]+/],
  ['variable', /^(export\s+)?(declare\s+)?(const|let|var)\s+[\w${[]/],
  ['method', new RegExp(String.raw`^(?!(${KEYWORDS})\b)((public|private|protected|static|readonly|async|override|get|set)\s+)*\*?[\w$]+\s*(<[^>]*>)?\s*\([^)]*\)\s*(:\s*[^={;]+)?\{\s*$`)],
];
const IS_FUNCTION_VALUE = /=\s*(async\s+)?(function\b|(\([^)]*\)|[\w$]+)\s*(:\s*[^=]+)?=>)/;

const commentsEnforced = (ws) => Boolean(ws.conventions?.comments) && ws.conventions.comments.enforce !== false;
const commentLanguage = (ws) => LANGUAGES[ws.conventions?.comments?.language ?? 'uk'] ?? LANGUAGES.uk;

// Line numbers (in the new file) of every added line, per file.
function addedLines(patch) {
  const files = new Map(); let cur = null; let ln = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) { cur = line.startsWith('+++ b/') ? line.slice(6) : null; if (cur) files.set(cur, new Set()); continue; }
    if (line.startsWith('diff --git')) { cur = null; continue; }
    if (line.startsWith('@@')) { ln = Number(/\+(\d+)/.exec(line)?.[1] ?? 0); continue; }
    if (!cur) continue;
    if (line.startsWith('+')) { files.get(cur).add(ln); ln++; }
    else if (line.startsWith(' ')) ln++;
  }
  return files;
}
// Text of the comment attached to line i (trailing // or the block right above), or null.
function attachedComment(lines, i) {
  const trailing = /\s\/\/\s?(.+)$/.exec(lines[i]);
  if (trailing && !TOOL_DIRECTIVE.test('//' + trailing[1])) return trailing[1];
  let j = i - 1;
  while (j >= 0) {
    const t = lines[j].trim();
    if (t === '' ) return null;
    if (t.startsWith('@')) { j--; continue; }                       // decorators
    if (TOOL_DIRECTIVE.test(t)) { j--; continue; }                  // eslint-disable-next-line etc.
    if (t.startsWith('//')) { const out = []; while (j >= 0 && lines[j].trim().startsWith('//')) { if (!TOOL_DIRECTIVE.test(lines[j])) out.unshift(lines[j].trim().slice(2)); j--; } return out.join(' ').trim() || null; }
    if (t.endsWith('*/')) { const out = []; while (j >= 0) { out.unshift(lines[j]); if (/\/\*/.test(lines[j])) break; j--; } return out.join(' ').replace(/\/\*\*?|\*\/|^\s*\*/gm, '').replace(/@\w+\s+[\w.$[\]]*/g, '').trim() || null; }
    return null;
  }
  return null;
}
function vueScriptRanges(lines) {
  const ranges = []; let start = -1;
  lines.forEach((l, i) => { if (/^\s*<script\b/.test(l)) start = i; else if (/^\s*<\/script>/.test(l) && start >= 0) { ranges.push([start, i]); start = -1; } });
  return ranges;
}
function checkComments(root, ws, st, serviceNames) {
  const lang = commentLanguage(ws);
  const level = ws.conventions?.comments?.level ?? 'all';
  const extra = (ws.conventions?.comments?.exclude ?? []).map((p) => `:(exclude,glob)${p}`);
  const specs = [...AUDIT_EXCLUDES.map((p) => `:(exclude,glob)${p}`), ...extra];
  const svcPaths = serviceNames ? serviceNames.map((n) => cleanPath(getService(ws, n).path)) : null;
  const violations = [];
  for (const r of st.repos) {
    const { patch } = repoDiff(r, specs);
    for (const [file, added] of addedLines(patch)) {
      if (!CODE_FILE.test(file) || SKIP_FILE.test(file) || !added.size) continue;
      const owner = ownerOf(ws, file);
      if (svcPaths && owner.service && !serviceNames.includes(owner.service) && owner.agent !== 'team-qa' && owner.agent !== 'team-qa-mobile') continue;
      const abs = path.join(root, file);
      if (!fs.existsSync(abs)) continue;
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      const vue = file.endsWith('.vue') ? vueScriptRanges(lines) : null;
      let depth = 0; // rough brace depth, used for level "functions"
      lines.forEach((raw, i) => {
        const t = raw.trim();
        const inScript = !vue || vue.some(([a, b]) => i > a && i < b);
        if (inScript && added.has(i + 1)) {
          const kind = DECLARATIONS.find(([, re]) => re.test(t))?.[0];
          const relevant = kind && (level === 'all' || kind !== 'variable' || depth === 0 || IS_FUNCTION_VALUE.test(t));
          if (relevant) {
            const text = attachedComment(lines, i);
            if (!text) violations.push({ file, line: i + 1, kind, problem: 'missing comment', code: t.slice(0, 90), service: owner.service, agent: owner.agent });
            else if (!lang.re.test(text)) violations.push({ file, line: i + 1, kind, problem: `comment is not in ${lang.name}`, code: t.slice(0, 90), service: owner.service, agent: owner.agent });
          }
        }
        if (inScript) depth += (raw.match(/\{/g) ?? []).length - (raw.match(/\}/g) ?? []).length;
      });
    }
  }
  return violations;
}
function formatViolations(v) {
  return v.map((x) => `${x.file}:${x.line}  [${x.kind}] ${x.problem}  →  ${x.code}   (${x.agent}${x.service ? `:${x.service}` : ''})`).join('\n');
}
function cmdComments({ pos }) {
  const id = pos[0] ?? die('Usage: comments <task-id> [service,service]');
  const { root, ws } = loadWorkspace();
  if (!ws.conventions?.comments) return log('No conventions.comments in workspace.json — nothing to check.');
  const st = loadState(root, id);
  const v = checkComments(root, ws, st, pos[1] ? pos[1].split(',') : null);
  if (!v.length) return log(`✔ comments: every new function/variable has a ${commentLanguage(ws).name} comment`);
  log(formatViolations(v));
  log(`✖ ${v.length} violation(s). Add a ${commentLanguage(ws).name} comment above each line (JSDoc for functions).`);
  process.exit(1);
}
function cmdConventions() {
  const root = findRoot(process.cwd());
  const ws = root ? readJson(path.join(root, MANIFEST_REL)) : {};
  const lang = commentLanguage(ws);
  const c = ws.conventions?.comments;
  let text = fs.readFileSync(path.join(KIT_DIR, 'CONVENTIONS.md'), 'utf8');
  text = text.replaceAll('{{LANGUAGE}}', `${lang.name} (${lang.native})`).replaceAll('{{LEVEL}}', c?.level ?? 'all');
  if (!c) text += '\n> This workspace has no `conventions.comments` — the comment rules above are recommended, not enforced.\n';
  for (const rule of ws.conventions?.extra ?? []) text += `\n- ${rule}`;
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

// --------------------------------------------------------- mobile / sim
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const which = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
class SimError extends Error {}
const fail = (m) => { throw new SimError(m); };
function tool(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.error) fail(`${bin}: ${r.error.message}`);
  return r;
}
async function urlUp(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); return r.status < 500; } catch { return false; }
}
const portOf = (url) => { try { const u = new URL(url); return Number(u.port || (u.protocol === 'https:' ? 443 : 80)); } catch { return null; } };

function iosDevice(name) {
  const r = tool('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  if (r.status !== 0) fail(`xcrun simctl failed: ${r.stderr}`);
  const all = Object.values(JSON.parse(r.stdout).devices).flat();
  return all.find((d) => d.name === name || d.udid === name)
    ?? fail(`iOS simulator "${name}" not found. Available: ${[...new Set(all.map((d) => d.name))].join(', ')}`);
}
async function bootIos(name) {
  const dev = iosDevice(name);
  if (dev.state !== 'Booted') { log(`▶ booting iOS simulator "${dev.name}"`); tool('xcrun', ['simctl', 'boot', dev.udid]); }
  tool('xcrun', ['simctl', 'bootstatus', dev.udid, '-b']);
  if (process.platform === 'darwin') spawnSync('open', ['-a', 'Simulator'], { stdio: 'ignore' });
  return { id: dev.udid, name: dev.name };
}
async function bootAndroid(avd) {
  const online = () => tool('adb', ['devices']).stdout.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
  let serial = online().find((s) => s.startsWith('emulator-'));
  if (!serial) {
    log(`▶ starting Android emulator "${avd}"`);
    const child = spawn('emulator', ['-avd', avd, '-no-snapshot-save', '-no-audio', '-no-boot-anim'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
    for (let i = 0; i < 90 && !serial; i++) { await sleep(2000); serial = online().find((s) => s.startsWith('emulator-')); }
    if (!serial) fail(`emulator "${avd}" did not appear in "adb devices" within 3 minutes`);
  }
  for (let i = 0; i < 90; i++) {
    if (tool('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).stdout.trim() === '1') return { id: serial, name: avd };
    await sleep(2000);
  }
  fail('Android emulator did not finish booting');
}
function appInstalled(platform, device, appId) {
  return platform === 'ios'
    ? tool('xcrun', ['simctl', 'get_app_container', device.id, appId]).status === 0
    : tool('adb', ['-s', device.id, 'shell', 'pm', 'path', appId]).stdout.includes('package:');
}
async function startBackground(name, cmd, cwd, url, logDir, env, started) {
  if (url && await urlUp(url)) { log(`= ${name} already running (${url})`); return; }
  const out = fs.openSync(path.join(logDir, `${name}.log`), 'w');
  const child = spawn(cmd, { cwd, shell: true, detached: true, stdio: ['ignore', out, out], env: { ...process.env, ...env } });
  child.on('error', () => {});
  started.push({ name, child });
  log(`▶ started ${name}${url ? ` → waiting for ${url}` : ''}`);
  if (!url) return;
  for (let i = 0; i < 90; i++) { if (await urlUp(url)) return; await sleep(2000); }
  fail(`${name} did not respond at ${url} within 3 minutes (log: .pipeline/…/${name}.log)`);
}
function stopAll(started) {
  for (const { child } of started.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } } }
}
// Hash of the files whose change requires a new native build of the app.
function buildFingerprint(root, st, svc) {
  const abs = fs.realpathSync(path.resolve(root, svc.path));
  const repo = st.repos.find((r) => abs === r.root || abs.startsWith(r.root + path.sep));
  if (!repo) return sha(`no-repo:${svc.name}:${Date.now()}`);
  const rel = posix(path.relative(repo.root, abs));
  const pre = rel ? `${rel}/` : '';
  const globs = (svc.mobile.rebuildOn ?? (svc.mobile.metro ? 'native' : 'any')) === 'native'
    ? ['package.json', 'app.json', 'app.config.*', 'eas.json', 'ios/**', 'android/**', 'plugins/**', '*.podspec']
    : ['**'];
  const specs = [...globs.map((g) => `:(glob)${pre}${g}`), ':(exclude,glob)**/node_modules/**', ':(exclude,glob)**/Pods/**', ':(exclude,glob)**/build/**'];
  const untracked = git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...specs]).stdout.split('\0').filter(Boolean);
  for (const c of chunks(untracked, 200)) git(repo.root, ['add', '--intent-to-add', '--', ...c]);
  try { return sha(repo.base + git(repo.root, ['diff', repo.base, '--', ...specs]).stdout); }
  finally { for (const c of chunks(untracked, 200)) git(repo.root, ['reset', '-q', '--', ...c], { allowFail: true }); }
}
const unxml = (t) => String(t ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
function parseJunit(xml) {
  const cases = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1];
    const body = m[3] ?? '';
    const failure = /<(failure|error)\b([^>]*)>?([\s\S]*?)(<\/\1>|$)/.exec(body);
    cases.push({ name: unxml(attr('name') ?? '?'), status: failure ? 'failed' : 'passed', ms: Math.round(Number(attr('time') ?? 0) * 1000),
      error: failure ? unxml(/message="([^"]*)"/.exec(failure[2])?.[1] ?? failure[3]).trim().slice(0, 300) : null });
  }
  return cases;
}
function listFiles(dir, re, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, re, out); else if (re.test(e.name)) out.push(p);
  }
  return out;
}
const LOG_ERROR = /(\bE\/|\berror\b|exception|fatal|unhandled|TypeError|ReferenceError|Invariant Violation|Possible Unhandled Promise)/i;

async function simPlatform({ root, ws, st, id, svc, platform, flags, started }) {
  const m = svc.mobile;
  const cwd = path.resolve(root, svc.path);
  const outDir = path.join(taskDir(root, id), `sim-${platform}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = { task: id, service: svc.name, platform, verdict: 'FAIL', device: null, built: false, flows: [], logErrors: [], screenshots: [], at: now() };
  const write = () => writeJson(path.join(taskDir(root, id), `sim-${platform}.json`), report);
  try {
    // 1. simulator
    const device = platform === 'ios' ? await bootIos(m.device.ios) : await bootAndroid(m.device.android);
    report.device = device.name;
    const env = { E2E: '1', E2E_PLATFORM: platform, DEVICE_ID: device.id, DEVICE_NAME: device.name };
    // 2. backends (+ metro) with dev.start/dev.url; on Android, map their ports into the emulator
    for (const s of ws.services.filter((x) => ['backend', 'worker'].includes(x.type) && x.dev?.start)) {
      await startBackground(s.name, s.dev.start, path.resolve(root, s.path), s.dev.url, outDir, {}, started);
    }
    if (m.metro?.start) await startBackground(`${svc.name}-metro`, m.metro.start, cwd, m.metro.url, outDir, env, started);
    if (platform === 'android') {
      const ports = [...ws.services.map((s) => s.dev?.url), m.metro?.url].map((u) => u && portOf(u)).filter(Boolean);
      for (const p of new Set(ports)) tool('adb', ['-s', device.id, 'reverse', `tcp:${p}`, `tcp:${p}`]);
    }
    // 3. build + install only when native inputs (or, without metro, any app code) changed
    const cacheFile = path.join(root, '.pipeline', '_sim', `${svc.name}-${platform}.json`);
    const fp = buildFingerprint(root, st, svc);
    const cached = readJson(cacheFile, null);
    const needBuild = flags.rebuild || cached?.fingerprint !== fp || cached?.device !== device.id || !appInstalled(platform, device, m.appId[platform]);
    if (needBuild && !flags['skip-build']) {
      const cmd = m.build[platform].replaceAll('{device}', device.name).replaceAll('{deviceId}', device.id);
      log(`▶ building ${svc.name} for ${platform}: ${cmd}  (this can take several minutes)`);
      const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 1 << 28, timeout: (m.buildTimeoutSec ?? 2400) * 1000, env: { ...process.env, ...env, CI: '1' } });
      fs.writeFileSync(path.join(outDir, 'build.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`);
      if (r.status !== 0) fail(`build failed (exit ${r.status ?? 'timeout'}) — see .pipeline/${id}/sim-${platform}/build.log\n${`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-20).join('\n')}`);
      if (m.install?.[platform]) {
        const i = spawnSync(m.install[platform].replaceAll('{device}', device.name).replaceAll('{deviceId}', device.id), { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env } });
        if (i.status !== 0) fail(`install failed: ${(i.stderr || i.stdout).trim().slice(-500)}`);
      }
      if (!appInstalled(platform, device, m.appId[platform])) fail(`app ${m.appId[platform]} is not installed on ${device.name} after the build — check mobile.build/mobile.install`);
      writeJson(cacheFile, { fingerprint: fp, device: device.id, at: now() });
      report.built = true;
    } else log(`= ${svc.name} ${platform} build is up to date — reusing installed app`);
    // 4. app logs
    const logFile = path.join(outDir, 'device.log');
    const logOut = fs.openSync(logFile, 'w');
    if (platform === 'android') tool('adb', ['-s', device.id, 'logcat', '-c']);
    const logger = platform === 'ios'
      ? spawn('xcrun', ['simctl', 'spawn', device.id, 'log', 'stream', '--style', 'compact', '--level', 'debug', '--predicate', 'subsystem == "com.facebook.react.log" OR eventMessage CONTAINS "ReactNativeJS"'], { stdio: ['ignore', logOut, logOut], detached: true })
      : spawn('adb', ['-s', device.id, 'logcat', '-v', 'time', 'ReactNativeJS:V', 'ReactNative:W', 'AndroidRuntime:E', '*:S'], { stdio: ['ignore', logOut, logOut], detached: true });
    logger.on('error', () => {});
    started.push({ name: 'device-log', child: logger });
    // 5. maestro
    const flowsDir = path.join(root, cleanPath(ws.e2eMobile?.path ?? 'e2e-mobile'), id);
    if (!fs.existsSync(flowsDir)) fail(`no flows in ${posix(path.relative(root, flowsDir))}/ — write Maestro flows there first`);
    const junit = path.join(outDir, 'report.xml');
    const args = ['--device', device.id, 'test', flowsDir, '--format', 'junit', '--output', junit, '--test-output-dir', outDir,
      '-e', `APP_ID=${m.appId[platform]}`, '-e', `PLATFORM=${platform}`];
    log(`▶ maestro test ${posix(path.relative(root, flowsDir))}/ on ${device.name}`);
    const t = spawnSync('maestro', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, timeout: (ws.e2eMobile?.timeoutSec ?? 1800) * 1000 });
    if (t.error) fail(`maestro: ${t.error.message}`);
    fs.writeFileSync(path.join(outDir, 'maestro.log'), `${t.stdout ?? ''}\n${t.stderr ?? ''}`);
    await sleep(1500);
    try { process.kill(-logger.pid, 'SIGTERM'); } catch { /* gone */ }
    // 6. results
    report.flows = fs.existsSync(junit) ? parseJunit(fs.readFileSync(junit, 'utf8')) : [];
    report.logErrors = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => LOG_ERROR.test(l)).slice(0, 50);
    report.screenshots = listFiles(outDir, /\.png$/i).map((f) => posix(path.relative(root, f)));
    report.log = `.pipeline/${id}/sim-${platform}/maestro.log`;
    report.deviceLog = `.pipeline/${id}/sim-${platform}/device.log`;
    const failedFlows = report.flows.filter((f) => f.status === 'failed');
    report.verdict = t.status === 0 && report.flows.length && !failedFlows.length ? 'PASS' : 'FAIL';
    if (!report.flows.length) report.error = `maestro produced no results (exit ${t.status}): ${`${t.stdout}\n${t.stderr}`.trim().split('\n').slice(-10).join(' | ')}`;
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    report.error = e.message;
  }
  write();
  return report;
}
async function cmdSim({ pos, flags }) {
  const id = pos[0] ?? die('Usage: sim <task-id> [--platform ios|android|all] [--service name] [--rebuild] [--skip-build]');
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  const mobiles = (flags.service ? [getService(ws, flags.service)] : st.services.map((n) => getService(ws, n)).filter((s) => s.type === 'mobile'));
  const svc = mobiles[0] ?? ws.services.find((s) => s.type === 'mobile') ?? die('No mobile service in this workspace.');
  const wanted = !flags.platform || flags.platform === 'all' ? svc.mobile.platforms : [flags.platform];
  const missing = (bins) => bins.filter((b) => !which(b));
  const results = [];
  for (const platform of wanted) {
    if (!svc.mobile.platforms.includes(platform)) die(`${svc.name} does not target ${platform}`);
    if (platform === 'ios' && process.platform !== 'darwin') { log('⚠ iOS simulators need macOS + Xcode — skipping ios'); continue; }
    const need = missing(['maestro', ...(platform === 'ios' ? ['xcrun'] : ['adb', 'emulator'])]);
    if (need.length) die(`Missing tools for ${platform}: ${need.join(', ')}. See README → "Mobile QA setup".`);
    const started = [];
    let r;
    try { r = await simPlatform({ root, ws, st, id, svc, platform, flags, started }); }
    finally { stopAll(started); }
    results.push(r);
    const failedFlows = r.flows.filter((f) => f.status === 'failed');
    log(`${r.verdict === 'PASS' ? '✔' : '✖'} ${platform} (${r.device ?? '?'}): ${r.flows.length - failedFlows.length}/${r.flows.length} flows passed${r.built ? ', app rebuilt' : ''}`);
    for (const f of failedFlows) log(`   ✖ ${f.name}: ${f.error}`);
    if (r.error) log(`   ✖ ${r.error}`);
    if (r.logErrors.length) log(`   ⚠ ${r.logErrors.length} error line(s) in device log — see ${r.deviceLog}`);
    log(`   report: .pipeline/${id}/sim-${platform}.json, screenshots: ${r.screenshots.length}`);
  }
  if (!results.length) die('No platform could be tested on this machine.');
  if (results.some((r) => r.verdict !== 'PASS')) process.exit(1);
}

// ------------------------------------------------------------ guard hook
// `git` followed by any global options (-C dir, -c k=v, --no-pager…) before the subcommand.
const G = String.raw`\bgit(?:\s+(?:-C|-c)\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+`;
const gre = (rest) => new RegExp(G + rest);
const DENY = [
  [gre(String.raw`push\b`), 'git push is done by you or by a deploy step in workspace.json, never directly by an agent'],
  [gre(String.raw`reset\b[^|;&]*--hard\b`), 'use "pipeline.mjs rollback" (recoverable stash) instead of git reset --hard'],
  [gre(String.raw`clean\b[^|;&]*\s-[a-zA-Z]*[fdx]`), 'git clean deletes untracked work; use "pipeline.mjs rollback"'],
  [gre(String.raw`(checkout|restore)\s+(--\s+)?\.(\s|$)`), 'discarding all changes is not allowed; use "pipeline.mjs rollback"'],
  [gre(String.raw`(rebase|filter-branch|filter-repo)\b`), 'history rewriting is not allowed in the pipeline'],
  [gre(String.raw`branch\s+[^|;&]*-D\b`), 'deleting branches is not allowed'],
  [/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(\/|~|\$HOME|\.{1,2}\/?|\*)(\s|$)/, 'recursive delete of root/home/project'],
  [/(^|[\s;|&(])(printenv|env)\s*($|[|;&])/, 'dumping environment variables can leak secrets'],
  [/(^|[\s;|&])(cat|less|more|head|tail|bat|nl|strings|xxd|base64|source|\.)\s[^|;&]*(^|[\s/'"])\.env(\.(?!example\b|sample\b|template\b)[\w.-]+)?(?=$|[\s'"|;&])/, 'reading .env files can leak secrets; use .env.example'],
  [/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'piping a remote script into a shell'],
  [/\bnpm\s+publish\b|\bdocker\s+push\b/, 'publishing is a deploy step — configure it in workspace.json "deploy"'],
];
const ASK = [
  [/pipeline\.mjs\s+deploy\b[^|;&]*--approved/, 'Deploy to an approval-only environment. Allow only if YOU asked for this deploy in this chat.'],
  [gre(String.raw`commit\b[^|;&]*--no-verify`), 'Commit that skips git hooks.'],
];
function cmdGuard() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  const cmd = String(input.tool_input?.command ?? '');
  if (!cmd || !findRoot(input.cwd || process.cwd())) process.exit(0); // active only inside a team workspace
  for (const [re, why] of DENY) if (re.test(cmd)) { console.error(`BLOCKED by team-kit guard: ${why}`); process.exit(2); }
  for (const [re, why] of ASK) {
    if (re.test(cmd)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: why } }));
      process.exit(0);
    }
  }
  process.exit(0);
}

// ------------------------------------------------------ install / setup
function cmdInstallHook({ pos }) {
  const [file, mjs] = pos;
  if (!file || !mjs) die('Usage: install-hook <settings.json> <path/to/pipeline.mjs>');
  const settings = readJson(file, {});
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak.${Date.now()}`);
  settings.hooks ??= {};
  settings.hooks.PreToolUse = (settings.hooks.PreToolUse ?? []).filter((e) => !JSON.stringify(e).includes('pipeline.mjs') || !JSON.stringify(e).includes(' guard'));
  settings.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: `node "${posix(mjs)}" guard` }] });
  settings.permissions ??= {};
  settings.permissions.allow ??= [];
  for (const a of SAFE_ALLOW) if (!settings.permissions.allow.includes(a)) settings.permissions.allow.push(a);
  writeJson(file, settings);
  log(`✔ guard hook + safe permissions added to ${file}`);
}
function cmdUninstallHook({ pos }) {
  const file = pos[0] ?? die('Usage: uninstall-hook <settings.json>');
  if (!fs.existsSync(file)) return;
  const settings = readJson(file, {});
  fs.copyFileSync(file, `${file}.bak.${Date.now()}`);
  if (settings.hooks?.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((e) => !(JSON.stringify(e).includes('pipeline.mjs') && JSON.stringify(e).includes(' guard')));
    if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
  if (settings.permissions?.allow) settings.permissions.allow = settings.permissions.allow.filter((a) => !SAFE_ALLOW.includes(a));
  writeJson(file, settings);
  log(`✔ removed team-kit hook and permissions from ${file}`);
}
function copyIfMissing(root, tpl, rel) {
  const dst = path.join(root, rel);
  if (fs.existsSync(dst)) return log(`  = ${rel} (exists)`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(KIT_DIR, 'templates', tpl), dst);
  log(`  + ${rel}`);
}
function cmdScaffold() {
  const { root, ws } = loadWorkspace();
  log(`Scaffolding ${posix(root)}`);
  copyIfMissing(root, 'spec.md', 'docs/specs/_TEMPLATE.md');
  if (ws.contracts?.path) { fs.mkdirSync(path.join(root, ws.contracts.path, 'events'), { recursive: true }); log(`  + ${cleanPath(ws.contracts.path)}/ (and events/)`); }
  if (ws.e2e?.path) copyIfMissing(root, 'playwright.config.ts', path.join(cleanPath(ws.e2e.path), 'playwright.config.ts'));
  if (ws.e2eMobile?.path) copyIfMissing(root, 'maestro-flow.example.yaml', path.join(cleanPath(ws.e2eMobile.path), '_examples', 'AC-1.example.yaml'));
  if (!fs.existsSync(tasksPath(root))) { writeJson(tasksPath(root), { tasks: [] }); log('  + .pipeline/tasks.json'); }
  const gi = path.join(root, '.gitignore');
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!cur.includes('.pipeline/*')) {
    fs.appendFileSync(gi, `${cur && !cur.endsWith('\n') ? '\n' : ''}\n# claude team kit (only the manifest is versioned)\n.pipeline/*\n!.pipeline/workspace.json\n`);
    log('  + .gitignore entries for .pipeline/');
  }
  const w = repoInfo(root, root);
  if (w) {
    const nested = allRepoRoots(root, ws).filter((o) => o !== w.root && o.startsWith(w.root + path.sep)).map((o) => posix(path.relative(w.root, o)) + '/');
    const text = fs.readFileSync(gi, 'utf8');
    const missing = nested.filter((n) => !text.split('\n').some((l) => l.trim() === n || l.trim() === '/' + n));
    if (missing.length) {
      fs.appendFileSync(gi, `${text.endsWith('\n') ? '' : '\n'}# separate service repos (managed in their own git)\n${missing.map((n) => '/' + n).join('\n')}\n`);
      log(`  + .gitignore: ${missing.join(', ')} (separate repos)`);
    }
  }
  if (ws.e2eMobile?.path && !which('maestro')) log('\nNext for mobile e2e: install Maestro → curl -Ls "https://get.maestro.mobile.dev" | bash  (needs Java 17+)');
  if (ws.e2e?.path && !fs.existsSync(path.join(root, ws.e2e.path, 'package.json'))) {
    log(`\nNext for e2e: cd ${cleanPath(ws.e2e.path)} && npm init -y && npm i -D @playwright/test && npx playwright install chromium`);
  }
}
function cmdDoctor() {
  const ok = (m) => log(`✔ ${m}`); const warn = (m) => log(`⚠ ${m}`);
  const major = Number(process.versions.node.split('.')[0]);
  major >= 18 ? ok(`node ${process.versions.node}`) : warn(`node ${process.versions.node} — need >= 18`);
  ok(gitOut(process.cwd(), ['--version']));
  const home = path.join(os.homedir(), '.claude');
  const settings = readJson(path.join(home, 'settings.json'), {});
  JSON.stringify(settings.hooks ?? {}).includes('pipeline.mjs') ? ok('guard hook installed') : warn('guard hook not found in ~/.claude/settings.json — re-run install.sh');
  for (const a of ['team-backend', 'team-frontend', 'team-mobile', 'team-security', 'team-qa', 'team-qa-mobile', 'team-devops']) {
    fs.existsSync(path.join(home, 'agents', `${a}.md`)) ? null : warn(`agent ${a} not installed in ~/.claude/agents`);
  }
  const root = findRoot(process.cwd());
  if (!root) return warn('no .pipeline/workspace.json here — run /pipeline-init-web or /pipeline-init-mobile');
  const { ws } = loadWorkspace();
  ok(`workspace ${ws.name ?? path.basename(root)}: ${ws.services.length} service(s)`);
  for (const s of ws.services) {
    const info = repoInfo(root, path.resolve(root, s.path));
    const missing = (s.type === 'mobile' ? ['lint', 'typecheck', 'test'] : ['lint', 'typecheck', 'test', 'build']).filter((k) => !s.commands?.[k]);
    const msg = `${s.name} [${s.type}] ${s.path} — repo: ${info ? label(info) : 'NOT A GIT REPO'}${missing.length ? `, no ${missing.join('/')}` : ''}`;
    info && !missing.length ? ok(msg) : warn(msg);
    const local = path.join(root, s.path, 'CLAUDE.md');
    if (!fs.existsSync(local)) log(`   tip: add ${cleanPath(s.path)}/CLAUDE.md with this service's own conventions`);
  }
  if (ws.e2e?.path) fs.existsSync(path.join(root, ws.e2e.path, 'playwright.config.ts')) ? ok(`e2e config in ${ws.e2e.path}`) : warn(`no playwright.config.ts in ${ws.e2e.path} — run scaffold`);
  for (const [env, c] of Object.entries(ws.deploy?.environments ?? {})) ok(`deploy ${env}: ${c.steps.length} step(s), ${(c.healthchecks ?? []).length} healthcheck(s)${c.requireApproval ? ', approval required' : ''}${c.rollback?.length ? ', rollback defined' : ''}`);
  fs.existsSync(path.join(root, 'docs/specs/_TEMPLATE.md')) ? ok('spec template present') : warn('no docs/specs/_TEMPLATE.md — run scaffold');
  commentsEnforced(ws) ? ok(`comments enforced: ${commentLanguage(ws).name}, level ${ws.conventions.comments.level ?? 'all'}`) : warn('conventions.comments not set — comment language is not enforced');
  for (const s of ws.services.filter((x) => x.type === 'mobile')) {
    const pf = s.mobile?.platforms ?? [];
    which('maestro') ? ok('maestro installed') : warn('maestro not installed: curl -Ls "https://get.maestro.mobile.dev" | bash (needs Java 17+)');
    which('java') ? ok('java found') : warn('java not found — Maestro needs Java 17+');
    if (pf.includes('ios')) {
      if (process.platform !== 'darwin') warn(`${s.name}: iOS simulator testing needs macOS — ios flows will be skipped here`);
      else if (!which('xcrun')) warn('xcrun not found — install Xcode + command line tools');
      else { try { iosDevice(s.mobile.device.ios); ok(`${s.name}: iOS simulator "${s.mobile.device.ios}" available`); } catch (e) { warn(`${s.name}: ${e.message}`); } }
    }
    if (pf.includes('android')) {
      which('adb') ? ok('adb found') : warn('adb not found — install Android SDK platform-tools and add to PATH');
      if (which('emulator')) {
        const avds = spawnSync('emulator', ['-list-avds'], { encoding: 'utf8' }).stdout?.split('\n').map((x) => x.trim()).filter(Boolean) ?? [];
        avds.includes(s.mobile.device.android) ? ok(`${s.name}: AVD "${s.mobile.device.android}" available`) : warn(`${s.name}: AVD "${s.mobile.device.android}" not found. Available: ${avds.join(', ') || 'none'}`);
      } else warn('emulator not found — add $ANDROID_HOME/emulator to PATH');
    }
  }
}
function cmdTemplate({ pos }) {
  const map = { workspace: 'workspace.example.json', spec: 'spec.md', playwright: 'playwright.config.ts', 'mobile-flow': 'maestro-flow.example.yaml' };
  const f = map[pos[0]] ?? die(`Usage: template <${Object.keys(map).join('|')}>`);
  process.stdout.write(fs.readFileSync(path.join(KIT_DIR, 'templates', f), 'utf8'));
}

const HELP = `Claude Team Kit — ${PL} <command>

  rules                          print the orchestrator rules
  conventions                    print coding conventions (comment language etc.) for agents
  services [--type t] [--json]   list workspace services
  start <id> <svc,..|all>        create feat/<id> branches in affected repos [--no-qa] [--allow-dirty]
  diff <id|adhoc>                build the blind-audit diff (.pipeline/<id>/diff.patch)
  owner <files..> | --file f     which agent owns these files
  verify <id> [svc,..]           comments + lint/typecheck/test/build per service → verify.json
  comments <id> [svc,..]         check that new functions/variables have comments in the workspace language
  sim <id> [--platform ios|android|all] [--rebuild] [--skip-build]
                                 boot simulator, build/install app, start backends, run Maestro flows
  mark <id> stage=N status=S [loop=name] [note=..]   update task state; exit 3 at loop limit
  commit <id> -m "feat(x): .."   gated commit in every affected repo (no push)
  rollback <id>                  stash changes, return repos to their original branches
  deploy <env> [--task id] [--approved]   run deploy steps + healthchecks (+ rollback)
  status                         table of all tasks
  scaffold | doctor              set up / check the workspace
  template <workspace|spec|playwright|mobile-flow>
  guard                          PreToolUse hook (reads JSON on stdin)
  install-hook | uninstall-hook  used by install.sh / uninstall.sh`;

const COMMANDS = {
  rules: () => process.stdout.write(fs.readFileSync(path.join(KIT_DIR, 'PIPELINE.md'), 'utf8')),
  conventions: cmdConventions, comments: cmdComments, sim: cmdSim,
  services: cmdServices, start: cmdStart, diff: cmdDiff, owner: cmdOwner, verify: cmdVerify, mark: cmdMark,
  commit: cmdCommit, rollback: cmdRollback, deploy: cmdDeploy, status: cmdStatus, scaffold: cmdScaffold,
  doctor: cmdDoctor, template: cmdTemplate, guard: cmdGuard,
  'install-hook': cmdInstallHook, 'uninstall-hook': cmdUninstallHook,
  help: () => log(HELP),
};
const [sub, ...rest] = process.argv.slice(2);
const fn = COMMANDS[sub ?? 'help'] ?? (() => die(`Unknown command "${sub}"\n\n${HELP}`));
await fn(parseArgs(rest));
