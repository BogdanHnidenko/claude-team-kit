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
const VALUE_FLAGS = new Set(['task', 'type', 'file', 'platform', 'service', 'only', 'flows', 'tags']);
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
const SAFE_ALLOW = ['rules', 'detect', 'current', 'stamp', 'coverage', 'playbook', 'conventions', 'services', 'owner', 'status', 'diff', 'verify', 'comments', 'sim', 'screen', 'mark', 'template', 'doctor']
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
  for (const s of ws.services) {
    for (const d of s.dependsOn ?? []) if (!names.has(d)) e.push(`service "${s.name}": dependsOn "${d}" is not a known service`);
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
// All services a service needs at runtime (transitively, via dependsOn).
function dependencyClosure(ws, names) {
  const out = new Set(); const stack = [...names];
  while (stack.length) { const n = stack.pop(); for (const d of ws.services.find((s) => s.name === n)?.dependsOn ?? []) if (!out.has(d)) { out.add(d); stack.push(d); } }
  return [...out];
}
const usedBy = (ws, name) => ws.services.filter((s) => (s.dependsOn ?? []).includes(name)).map((s) => s.name);
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
// Paths registered as git submodules of a repo (from .gitmodules).
function submodulePaths(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, '.gitmodules'))) return [];
  const r = git(repoRoot, ['config', '-f', '.gitmodules', '--get-regexp', String.raw`^submodule\..*\.path$`], { allowFail: true });
  return r.status === 0 ? r.stdout.trim().split('\n').filter(Boolean).map((l) => cleanPath(l.split(/\s+/).slice(1).join(' '))) : [];
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

function cmdVerify({ pos, flags }) {
  const id = pos[0] ?? die('Usage: verify <task-id> [service,service]');
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  const names = pos[1] ? pos[1].split(',') : st.services;
  const only = typeof flags.only === 'string' ? flags.only.split(',').map((x) => x.trim()) : null;
  const steps = (ws.pipeline?.verifySteps ?? ['lint', 'typecheck', 'test', 'build']).filter((x) => !only || only.includes(x));
  const timeout = (ws.pipeline?.stepTimeoutSec ?? 900) * 1000;
  const logFile = path.join(taskDir(root, id), 'verify.log');
  const results = [];
  let failed = null;

  if (commentsEnforced(ws) && (!only || only.includes('comments'))) { // project convention: every function/variable has a comment in the chosen language
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
  writeJson(path.join(taskDir(root, id), only || pos[1] ? 'verify-partial.json' : 'verify.json'), { // partial runs never count as the release gate
    partial: Boolean(only || pos[1]), only, services: names,
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
      const app = st.services.map((n) => getService(ws, n)).find((x) => x.type === 'mobile') ?? ws.services.find((x) => x.type === 'mobile');
      for (const p of app ? platformsFor(ws, app, st.depth ?? taskDepth(root, ws, id)) : []) if (!sims.includes(`sim-${p}.json`)) problems.push(`no simulator run for ${p} (required for this depth)`);
      for (const f of sims) { const v = readJson(path.join(dir, f), null)?.verdict; if (v !== 'PASS') problems.push(`${f} verdict is ${v ?? 'missing'} (need PASS)`); }
    }
  }
  const ver = readJson(path.join(dir, 'verify.json'), null);
  if (ver?.verdict !== 'PASS') problems.push(`verify.json verdict is ${ver?.verdict ?? 'missing'} (need PASS)`);
  if (!problems.length) {
    if (fingerprint(st, auditSpecs(ws)) !== st.auditHash) problems.push('code changed after the security audit — run diff + audit again');
    const full = fingerprint(st, [PIPELINE_EXCLUDE]);
    if (full !== ver.hash) problems.push('code changed after verify — run verify again');
    for (const t of targets) {
      const kind = t === 'web' ? 'qa' : 'qa-mobile';
      const stamp = st.stamps?.[kind];
      if (!stamp) problems.push(`${kind} result is not stamped (QA agent must run: ${PL} stamp ${id} ${kind})`);
      else if (stamp.hash !== full) problems.push(`code changed after ${kind === 'qa' ? 'web' : 'mobile'} tests — re-run them (/test)`);
      else if (st.depth && stamp.depth && stamp.depth !== st.depth) problems.push(`QA depth changed to "${st.depth}" after ${kind} was tested at "${stamp.depth}" — test again at the new depth`);
    }
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
    let files = staged.get(r.root);
    // Parent repo with submodules: record the new commits of the sub-repos of this task.
    const bumped = submodulePaths(r.root).filter((p) => st.repos.some((o) => o !== r && o.root === path.join(r.root, p) && commits.some((c) => c.repo === label(o))));
    if (bumped.length) {
      git(r.root, ['add', '--', ...bumped]);
      files = gitOut(r.root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
      log(`  ${label(r)}: updating submodule pointers → ${bumped.join(', ')}`);
    }
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
  if (!id || !kv.length) die('Usage: mark <task-id> [stage=<n>] [status=IN_PROGRESS|BLOCKED|DONE|FAILED] [loop=<security|qa|verify>] [depth=smoke|deep|exhaustive] [note=<text>]');
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
    else if (k === 'depth') {
      if (!DEPTHS[v]) die(`depth must be one of ${Object.keys(DEPTHS).join(', ')}`);
      patch.depth = v;
      const st = loadState(root, id); st.depth = v; saveState(root, st);
    }
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
  log(`✔ ${id}: stage ${t.stage} ${t.status}${t.depth ? `, QA depth ${t.depth}` : ''}${t.note ? ` — ${t.note}` : ''}`);
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
  table(['service', 'type', 'path', 'uses', 'used by', 'agent'], list.map((s) => [s.name, s.type, s.path, (s.dependsOn ?? []).join(',') || '—', usedBy(ws, s.name).join(',') || '—', agentFor(s.type)]));
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
  const reply = LANGUAGES[ws.conventions?.replyLanguage ?? 'uk'] ?? LANGUAGES.uk;
  text = text.replaceAll('{{LANGUAGE}}', `${lang.name} (${lang.native})`).replaceAll('{{LEVEL}}', c?.level ?? 'all').replaceAll('{{REPLY_LANGUAGE}}', `${reply.name} (${reply.native})`);
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

// name + tags of every Maestro flow file in a folder (one file = one case).
function flowMeta(dir) {
  return listFiles(dir, /\.ya?ml$/i).filter((f) => !f.includes(`${path.sep}_shared${path.sep}`)).map((f) => {
    const head = readText(f).split(/^---\s*$/m)[0];
    const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(head)?.[1] ?? path.basename(f).replace(/\.ya?ml$/i, '');
    const tagBlock = /tags:\s*\[([^\]]*)\]/.exec(head)?.[1] ?? [...head.matchAll(/^\s*-\s*([\w-]+)\s*$/gm)].map((m) => m[1]).join(',');
    return { file: f, name, base: path.basename(f).replace(/\.ya?ml$/i, ''), tags: tagBlock.split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean) };
  });
}
// Which platforms a QA run must cover: exhaustive → all, otherwise the primary platform only (configurable).
function platformsFor(ws, svc, depth) {
  const all = svc.mobile.platforms;
  const explicit = ws.qa?.platformsByDepth?.[depth];
  if (Array.isArray(explicit) && explicit.length) return explicit.filter((p) => all.includes(p));
  if (depth === 'exhaustive') return all;
  const primary = svc.mobile.primaryPlatform ?? (process.platform === 'darwin' && all.includes('ios') ? 'ios' : all.includes('android') ? 'android' : all[0]);
  return [primary];
}
const fmtMs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${Math.round(ms / 1000)}s`);
async function simPlatform({ root, ws, st, id, svc, platform, flags, started }) {
  const m = svc.mobile;
  const cwd = path.resolve(root, svc.path);
  const custom = typeof flags.flows === 'string' ? flags.flows : null; // exploration or regression run
  const tag = custom ? `sim-${platform}-custom` : `sim-${platform}`;
  const outDir = path.join(taskDir(root, id), tag);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = { task: id, service: svc.name, platform, verdict: 'FAIL', device: null, built: false, flows: [], logErrors: [], screenshots: [], timings: {}, at: now() };
  const write = () => writeJson(path.join(taskDir(root, id), `${tag}.json`), report);
  const mainFile = path.join(taskDir(root, id), `sim-${platform}.json`);
  const previous = custom ? null : readJson(mainFile, null);
  let t0 = Date.now();
  const phase = (name) => { report.timings[name] = Date.now() - t0; t0 = Date.now(); };
  const appHash = fingerprint(st, auditSpecs(ws)); // app code only (tests/docs excluded)
  try {
    // 1. simulator
    const device = platform === 'ios' ? await bootIos(m.device.ios) : await bootAndroid(m.device.android);
    phase('boot');
    report.device = device.name;
    const env = { E2E: '1', E2E_PLATFORM: platform, DEVICE_ID: device.id, DEVICE_NAME: device.name };
    // 2. backends (+ metro) with dev.start/dev.url; on Android, map their ports into the emulator
    const needed = svc.dependsOn?.length ? new Set(dependencyClosure(ws, [svc.name])) : null; // only what the app talks to
    for (const s of ws.services.filter((x) => ['backend', 'worker'].includes(x.type) && x.dev?.start && (!needed || needed.has(x.name)))) {
      await startBackground(s.name, s.dev.start, path.resolve(root, s.path), s.dev.url, outDir, {}, started);
    }
    if (m.metro?.start) await startBackground(`${svc.name}-metro`, m.metro.start, cwd, m.metro.url, outDir, { ...env, CI: '1', EXPO_PUBLIC_E2E: '1', RN_E2E: '1' }, started);
    if (platform === 'android') {
      const ports = [...ws.services.map((s) => s.dev?.url), m.metro?.url].map((u) => u && portOf(u)).filter(Boolean);
      for (const p of new Set(ports)) tool('adb', ['-s', device.id, 'reverse', `tcp:${p}`, `tcp:${p}`]);
    }
    phase('backends');
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
    phase('build');
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
    const flowsDir = custom ? path.resolve(root, custom) : path.join(root, cleanPath(ws.e2eMobile?.path ?? 'e2e-mobile'), id);
    if (!fs.existsSync(flowsDir)) fail(`no flows in ${posix(path.relative(root, flowsDir))}/ — write Maestro flows there first`);
    const meta = flowMeta(flowsDir);
    let targets = [flowsDir];
    let subset = false;
    if (typeof flags.tags === 'string') {
      const want = flags.tags.split(',').map((x) => x.trim());
      const picked = meta.filter((f) => f.tags.some((t) => want.includes(t)) || want.includes(f.base));
      if (!picked.length) fail(`no flows tagged ${flags.tags} in ${posix(path.relative(root, flowsDir))}/`);
      targets = picked.map((f) => f.file); subset = true;
    }
    if (flags['rerun-failed']) {
      const policy = ws.qa?.retest ?? 'failed+smoke';
      // failed last time + flows that became stale because the app code changed since they ran
      const failedNames = new Set((previous?.flows ?? []).filter((f) => f.status !== 'passed'
        || (f.appHash !== appHash && (policy === 'all' || (f.tags ?? []).includes('happy')))).map((f) => f.name));
      for (const f of meta) if (!(previous?.flows ?? []).some((r) => r.name === f.name || r.name === f.base)) failedNames.add(f.name); // never run yet
      const picked = meta.filter((f) => failedNames.has(f.name) || failedNames.has(f.base));
      if (!picked.length) { log(`= nothing failed in the last ${platform} run — nothing to re-run`); report.flows = previous?.flows ?? []; }
      targets = picked.map((f) => f.file); subset = true;
      if (!picked.length) targets = [];
    }
    const junit = path.join(outDir, 'report.xml');
    const args = ['--device', device.id, 'test', ...targets, '--format', 'junit', '--output', junit, '--test-output-dir', outDir,
      '-e', `APP_ID=${m.appId[platform]}`, '-e', `PLATFORM=${platform}`];
    log(`▶ maestro test ${subset ? `${targets.length} flow(s)` : `${posix(path.relative(root, flowsDir))}/`} on ${device.name}`);
    const t = targets.length ? spawnSync('maestro', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, timeout: (ws.e2eMobile?.timeoutSec ?? 1800) * 1000 }) : { status: 0, stdout: '', stderr: '' };
    if (t.error) fail(`maestro: ${t.error.message}`);
    fs.writeFileSync(path.join(outDir, 'maestro.log'), `${t.stdout ?? ''}\n${t.stderr ?? ''}`);
    await sleep(1500);
    try { process.kill(-logger.pid, 'SIGTERM'); } catch { /* gone */ }
    // 6. results
    const ran = fs.existsSync(junit) ? parseJunit(fs.readFileSync(junit, 'utf8')) : [];
    for (const f of ran) { const mm = meta.find((x) => x.name === f.name || x.base === f.name); f.tags = mm?.tags ?? []; f.file = mm ? posix(path.relative(root, mm.file)) : null; f.appHash = appHash; }
    phase('tests');
    // subset run: merge into the full report of this platform (latest result per flow wins)
    if (subset && previous?.flows?.length) {
      const byName = new Map(previous.flows.map((f) => [f.name, f]));
      for (const f of ran) byName.set(f.name, f);
      report.flows = [...byName.values()];
      report.merged = { reran: ran.map((f) => f.name), kept: previous.flows.length - ran.filter((f) => previous.flows.some((p) => p.name === f.name)).length };
    } else report.flows = ran.length ? ran : report.flows;
    // freshness: after an app change, every failed flow and every "happy" flow must have run on the current app code
    const policy = ws.qa?.retest ?? 'failed+smoke';
    report.stale = report.flows.filter((f) => f.appHash !== appHash && (policy === 'all' || (f.tags ?? []).includes('happy'))).map((f) => f.name);
    report.logErrors = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => LOG_ERROR.test(l)).slice(0, 50);
    report.screenshots = listFiles(outDir, /\.png$/i).map((f) => posix(path.relative(root, f)));
    report.log = `.pipeline/${id}/${tag}/maestro.log`;
    report.deviceLog = `.pipeline/${id}/${tag}/device.log`;
    if (custom) report.flowsDir = posix(path.relative(root, flowsDir));
    // every flow file of the task must have a result (new files added after the last full run, deleted ones dropped)
    const names = new Set(meta.flatMap((f) => [f.name, f.base]));
    report.flows = report.flows.filter((f) => names.has(f.name));
    report.notRun = custom ? [] : meta.filter((f) => !report.flows.some((r) => r.name === f.name || r.name === f.base)).map((f) => f.base);
    const failedFlows = report.flows.filter((f) => f.status === 'failed');
    report.verdict = report.flows.length && !failedFlows.length && !report.stale.length && !report.notRun.length && (subset || t.status === 0) ? 'PASS' : 'FAIL';
    if (!report.flows.length) report.error = `maestro produced no results (exit ${t.status}): ${`${t.stdout}\n${t.stderr}`.trim().split('\n').slice(-10).join(' | ')}`;
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    report.error = e.message;
  }
  write();
  return report;
}
async function cmdScreen({ flags }) {
  const { root, ws } = loadWorkspace();
  const svc = (flags.service ? getService(ws, flags.service) : ws.services.find((s) => s.type === 'mobile')) ?? die('No mobile service in this workspace.');
  const platform = flags.platform ?? (process.platform === 'darwin' && svc.mobile.platforms.includes('ios') ? 'ios' : 'android');
  try {
    const device = platform === 'ios' ? await bootIos(svc.mobile.device.ios) : await bootAndroid(svc.mobile.device.android);
    const dir = path.join(root, '.pipeline', '_screen');
    fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, `${platform}-${Date.now()}.png`);
    const cap = platform === 'ios'
      ? tool('xcrun', ['simctl', 'io', device.id, 'screenshot', shot])
      : (() => { const r = spawnSync('adb', ['-s', device.id, 'exec-out', 'screencap', '-p'], { maxBuffer: 1 << 28 }); if (r.status === 0) fs.writeFileSync(shot, r.stdout); return r; })();
    const h = which('maestro') ? tool('maestro', ['--device', device.id, 'hierarchy'], { timeout: 60000 }) : null;
    const tree = h?.status === 0 ? h.stdout : '';
    // compact list of what a user can see/tap: text, testID (resource-id / identifier), accessibility label
    const items = [...tree.matchAll(/"(text|resource-id|identifier|accessibilityText|hintText)"\s*:\s*"([^"]{1,120})"/g)].map((m) => `${m[1]}: ${m[2]}`);
    fs.writeFileSync(path.join(dir, 'hierarchy.json'), tree);
    log(`device: ${device.name} (${platform})`);
    log(cap.status === 0 ? `screenshot: ${posix(path.relative(root, shot))}` : '⚠ screenshot failed');
    log(items.length ? `visible elements:\n  ${[...new Set(items)].slice(0, 80).join('\n  ')}` : '⚠ no UI tree (is maestro installed and the app open?)');
    log('full tree: .pipeline/_screen/hierarchy.json');
  } catch (e) { if (e instanceof SimError) die(e.message); throw e; }
}
async function cmdSim({ pos, flags }) {
  const id = pos[0] ?? die('Usage: sim <task-id> [--platform ios|android|all] [--tags AC-1,happy] [--rerun-failed] [--service name] [--rebuild] [--skip-build] [--flows dir]');
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  const mobiles = (flags.service ? [getService(ws, flags.service)] : st.services.map((n) => getService(ws, n)).filter((s) => s.type === 'mobile'));
  const svc = mobiles[0] ?? ws.services.find((s) => s.type === 'mobile') ?? die('No mobile service in this workspace.');
  const depth = taskDepth(root, ws, id);
  const wanted = flags.platform === 'all' ? svc.mobile.platforms : flags.platform ? [flags.platform] : platformsFor(ws, svc, depth);
  if (!flags.platform) log(`platforms for depth "${depth ?? '?'}": ${wanted.join(', ')}  (all: --platform all)`);
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
    log(`${r.verdict === 'PASS' ? '✔' : '✖'} ${platform} (${r.device ?? '?'}): ${r.flows.length - failedFlows.length}/${r.flows.length} flows passed${r.built ? ', app rebuilt' : ''}${r.merged ? ` (re-ran ${r.merged.reran.length}, kept ${r.merged.kept} earlier results)` : ''}`);
    log(`   time: ${Object.entries(r.timings ?? {}).map(([k, v]) => `${k} ${fmtMs(v)}`).join(' · ')}`);
    if (r.notRun?.length) log(`   ✖ not run yet: ${r.notRun.slice(0, 8).join(', ')}${r.notRun.length > 8 ? '…' : ''}  (--tags <AC-n> or a full run)`);
    if (r.stale?.length) log(`   ✖ app code changed since these flows ran — re-run them: ${r.stale.slice(0, 8).join(', ')}${r.stale.length > 8 ? '…' : ''}  (--rerun-failed)`);
    for (const f of failedFlows) log(`   ✖ ${f.name}: ${f.error}`);
    if (r.error) log(`   ✖ ${r.error}`);
    if (r.logErrors.length) log(`   ⚠ ${r.logErrors.length} error line(s) in device log — see ${r.deviceLog}`);
    log(`   report: .pipeline/${id}/${flags.flows ? `sim-${platform}-custom` : `sim-${platform}`}.json, screenshots: ${r.screenshots.length}${flags.flows ? '  (custom run — not a release gate)' : ''}`);
  }
  if (!results.length) die('No platform could be tested on this machine.');
  if (results.some((r) => r.verdict !== 'PASS')) process.exit(1);
}

// ------------------------------------------------------ detect (scanner)
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'Pods', 'ios', 'android', '.expo',
  'coverage', '.pipeline', '.claude', 'vendor', 'e2e', 'e2e-mobile', 'docs', 'contracts', '.turbo', '.cache', 'tmp', '.venv', 'venv', '__pycache__', 'target']);
const DEP = {
  mobile: ['react-native', 'expo'],
  frontend: ['vue', 'react-dom', 'svelte', '@sveltejs/kit', '@angular/core', 'next', 'nuxt', 'solid-js', 'astro', 'preact'],
  backend: ['express', 'fastify', '@nestjs/core', 'koa', 'hono', '@hapi/hapi', 'apollo-server', '@apollo/server', '@trpc/server', 'restify', 'elysia'],
  worker: ['bullmq', 'bull', 'amqplib', 'kafkajs', 'node-cron', 'agenda', 'bee-queue', '@aws-sdk/client-sqs'],
};
const OTHER_STACKS = [['go.mod', 'Go'], ['pyproject.toml', 'Python'], ['requirements.txt', 'Python'], ['pom.xml', 'Java (Maven)'], ['build.gradle', 'Java/Kotlin (Gradle)'], ['Cargo.toml', 'Rust'], ['composer.json', 'PHP'], ['Gemfile', 'Ruby']];
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const readPkg = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; } };
const PORT_IN_TEXT = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.0\.2\.2|host\.docker\.internal):(\d{2,5})/g;

function packageManager(dir, root) {
  for (let d = dir; d.startsWith(root); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(d, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(d, 'bun.lockb')) || fs.existsSync(path.join(d, 'bun.lock'))) return 'bun';
    if (fs.existsSync(path.join(d, 'package-lock.json'))) return 'npm';
    if (d === root) break;
  }
  return 'npm';
}
function scanDirs(root, maxDepth = 3) {
  const out = [];
  const walk = (dir, depth) => {
    out.push(dir);
    if (depth >= maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return out;
}
function guessPort(pkg, dir, kind, deps) {
  const scripts = Object.values(pkg?.scripts ?? {}).join(' ');
  const m = /(?:--port[= ]|-p\s+|PORT=)(\d{2,5})/.exec(scripts);
  if (m) return { port: Number(m[1]), sure: true };
  const env = readText(path.join(dir, '.env.example')) + readText(path.join(dir, '.env.sample'));
  const e = /^\s*PORT\s*=\s*(\d{2,5})/m.exec(env);
  if (e) return { port: Number(e[1]), sure: true };
  const vite = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].map((f) => readText(path.join(dir, f))).join('');
  const v = /port\s*:\s*(\d{2,5})/.exec(vite);
  if (v) return { port: Number(v[1]), sure: true };
  const src = ['src/index.ts', 'src/main.ts', 'src/server.ts', 'src/app.ts', 'index.js', 'server.js', 'src/index.js', 'src/server.js'].map((f) => readText(path.join(dir, f))).join('\n');
  const l = /listen\(\s*(?:process\.env\.PORT\s*(?:\|\||\?\?)\s*)?(\d{2,5})/.exec(src);
  if (l) return { port: Number(l[1]), sure: true };
  if (kind === 'frontend') return { port: deps.next || deps.nuxt ? 3000 : deps['@angular/core'] ? 4200 : 5173, sure: false };
  if (kind === 'backend') return { port: 3000, sure: false };
  return { port: null, sure: false };
}
function hasHealthRoute(dir) {
  const files = listFiles(path.join(dir, 'src'), /\.(ts|js|mjs)$/).slice(0, 300);
  return files.some((f) => /['"`]\/(api\/)?health(z)?['"`]/.test(readText(f)));
}
function detectService(root, dir, notes) {
  const rel = cleanPath(posix(path.relative(root, dir))) || '.';
  const name = (rel === '.' ? path.basename(root) : path.basename(dir)).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const pkg = readPkg(dir);
  if (!pkg) {
    const other = OTHER_STACKS.find(([f]) => fs.existsSync(path.join(dir, f)));
    if (other) return { name, type: 'backend', path: rel, stack: other[1], commands: {}, _note: `${rel}: ${other[1]} project — fill "commands" (lint/test/build) by hand` };
    return null;
  }
  if (pkg.workspaces) return null; // monorepo root, its packages are scanned separately
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (list) => list.filter((d) => deps[d]);
  const kind = has(DEP.mobile).length ? 'mobile' : has(DEP.frontend).length ? 'frontend' : has(DEP.backend).length ? 'backend'
    : has(DEP.worker).length ? 'worker' : (pkg.main || pkg.exports) && !pkg.scripts?.dev && !pkg.scripts?.start ? 'library' : null;
  if (!kind) return null;
  const pm = packageManager(dir, root);
  const runS = (s) => (pm === 'npm' ? `npm run ${s}` : `${pm} ${s}`);
  const sc = pkg.scripts ?? {};
  const commands = {};
  if (sc.lint) commands.lint = runS('lint');
  const tc = ['typecheck', 'type-check', 'tsc', 'check-types', 'types'].find((s) => sc[s]);
  if (tc) commands.typecheck = runS(tc);
  else if (fs.existsSync(path.join(dir, 'tsconfig.json'))) commands.typecheck = 'npx tsc --noEmit';
  if (sc.test && !/no test specified/.test(sc.test)) commands.test = pm === 'npm' ? 'npm test' : `${pm} test`;
  if (sc.build && kind !== 'mobile') commands.build = runS('build');
  const stackBits = [...has(DEP.mobile), ...has(DEP.frontend), ...has(DEP.backend), ...has(DEP.worker)];
  if (deps.typescript) stackBits.push('TypeScript');
  if (deps.pg || deps.postgres || deps['@prisma/client'] || deps.typeorm || deps.knex || deps['drizzle-orm']) stackBits.push('SQL DB');
  if (deps.mongoose || deps.mongodb) stackBits.push('MongoDB');
  const svc = { name, type: kind, path: rel, stack: stackBits.join(' + '), commands };
  const missing = ['lint', 'typecheck', 'test', ...(kind === 'mobile' ? [] : ['build'])].filter((k) => !commands[k]);
  if (missing.length) notes.push(`${name}: no ${missing.join('/')} script — fewer checks will run`);

  if (kind === 'frontend' || kind === 'backend') {
    const devScript = sc.dev ? 'dev' : sc.start ? 'start' : sc.serve ? 'serve' : null;
    const { port, sure } = guessPort(pkg, dir, kind, deps);
    if (devScript && port) {
      const health = kind === 'backend' && hasHealthRoute(dir);
      svc.dev = { start: runS(devScript), url: `http://localhost:${port}${kind === 'backend' ? (health ? '/health' : '/') : ''}` };
      if (!sure) notes.push(`${name}: port ${port} is a guess — check dev.url`);
      if (kind === 'backend' && !health) notes.push(`${name}: no /health route found — dev.url points to "/"; a /health endpoint makes tests and deploy checks reliable`);
    } else notes.push(`${name}: could not find how to start it locally (dev/start script + port) — fill "dev" by hand`);
  }
  if (kind === 'mobile') {
    const expo = Boolean(deps.expo);
    const appJson = (() => { try { return JSON.parse(readText(path.join(dir, 'app.json'))); } catch { return {}; } })();
    const cfg = appJson.expo ?? appJson;
    const gradle = readText(path.join(dir, 'android/app/build.gradle'));
    const pbx = listFiles(path.join(dir, 'ios'), /\.pbxproj$/).map(readText).join('');
    const appId = {
      ios: cfg?.ios?.bundleIdentifier ?? /PRODUCT_BUNDLE_IDENTIFIER = ([\w.-]+);/.exec(pbx)?.[1] ?? null,
      android: cfg?.android?.package ?? /applicationId\s+["']([\w.]+)["']/.exec(gradle)?.[1] ?? null,
    };
    const platforms = process.platform === 'darwin' ? ['ios', 'android'] : ['android'];
    const device = { ios: null, android: null };
    if (platforms.includes('ios') && which('xcrun')) {
      try {
        const all = Object.values(JSON.parse(spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }).stdout).devices).flat();
        device.ios = all.filter((d) => /^iPhone/.test(d.name)).map((d) => d.name).sort().pop() ?? null;
      } catch { /* no simulators */ }
    }
    if (which('emulator')) device.android = spawnSync('emulator', ['-list-avds'], { encoding: 'utf8' }).stdout?.split('\n').map((x) => x.trim()).filter(Boolean)[0] ?? null;
    const fast = !deps['expo-dev-client']; // a dev-client app opens its launcher instead of the bundle — use release builds there
    svc.mobile = fast
      ? {
        framework: expo ? 'expo' : 'bare', mode: 'fast', platforms, appId, device,
        build: expo
          ? { ios: 'npx expo run:ios --configuration Debug --no-bundler --device "{device}"', android: 'npx expo run:android --variant debug --no-bundler' }
          : { ios: 'npx react-native run-ios --mode Debug --simulator "{device}" --no-packager', android: 'npx react-native run-android --mode debug --no-packager' },
        metro: { start: expo ? 'npx expo start --port 8081' : 'npx react-native start --port 8081', url: 'http://localhost:8081/status' },
        rebuildOn: 'native',
      }
      : {
        framework: expo ? 'expo' : 'bare', mode: 'release', platforms, appId, device,
        build: expo
          ? { ios: 'npx expo run:ios --configuration Release --no-bundler --device "{device}"', android: 'npx expo run:android --variant release --no-bundler' }
          : { ios: 'npx react-native run-ios --mode Release --simulator "{device}" --no-packager', android: 'npx react-native run-android --mode release --no-packager' },
        rebuildOn: 'any',
      };
    if (fast) notes.push(`${name}: fast test mode — the app is built once (debug) and JS changes load from Metro without rebuilding; hide LogBox in tests: if (process.env.EXPO_PUBLIC_E2E === '1') LogBox.ignoreAllLogs()`);
    else notes.push(`${name}: expo-dev-client found — release builds are used for tests (every JS change = rebuild, slower)`);
    for (const pf of platforms) {
      if (!appId[pf]) notes.push(`${name}: ${pf} app id not found (${expo ? `app.json → expo.${pf === 'ios' ? 'ios.bundleIdentifier' : 'android.package'}` : 'native project'}) — fill mobile.appId.${pf}`);
      if (!device[pf]) notes.push(`${name}: no ${pf === 'ios' ? 'iOS simulator' : 'Android emulator (AVD)'} found — create one and fill mobile.device.${pf}`);
    }
    if (process.platform !== 'darwin') notes.push(`${name}: not macOS — iOS testing disabled (platforms: android)`);
  }
  return svc;
}
// Links: which service talks to which (by localhost ports in config, and by *_URL env names).
function detectLinks(root, services) {
  const byPort = new Map();
  for (const s of services) { const p = s.dev?.url && portOf(s.dev.url); if (p) byPort.set(p, s.name); }
  const CONFIG_FILES = ['.env.example', '.env.sample', '.env.template', '.env.development.example', 'app.json', 'eas.json', 'vite.config.ts', 'vite.config.js',
    'next.config.js', 'next.config.mjs', 'nuxt.config.ts', 'src/config.ts', 'src/config/index.ts', 'src/api/client.ts', 'src/lib/api.ts', 'src/constants.ts', 'config.ts', 'app.config.ts', 'app.config.js'];
  const links = [];
  for (const s of services) {
    const dir = path.resolve(root, s.path);
    const text = CONFIG_FILES.map((f) => readText(path.join(dir, f))).join('\n');
    const deps = new Set();
    for (const m of text.matchAll(PORT_IN_TEXT)) {
      const target = byPort.get(Number(m[1]));
      if (target && target !== s.name) { deps.add(target); links.push({ from: s.name, to: target, why: `uses localhost:${m[1]}` }); }
    }
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]*?)_(?:SERVICE_)?(?:URL|HOST|API_URL|BASE_URL)\b/g)) {
      const key = m[1].toLowerCase().replace(/^(expo_public|vite|next_public|nuxt_public|react_app)_/, '').replace(/_/g, '-');
      const target = services.find((o) => o.name !== s.name && (o.name === key || o.name.endsWith(`-${key}`) || key.endsWith(o.name)));
      if (target && !deps.has(target.name)) { deps.add(target.name); links.push({ from: s.name, to: target.name, why: `env ${m[0]}` }); }
    }
    if (deps.size) s.dependsOn = [...deps];
  }
  // docker compose depends_on (service names that match ours)
  for (const f of listFiles(root, /^(docker-)?compose[^/]*\.ya?ml$/).filter((f) => !f.includes('node_modules')).slice(0, 5)) {
    const y = readText(f);
    for (const m of y.matchAll(/^ {2}([\w-]+):\s*\n((?: {4,}.*\n?)*)/gm)) {
      const from = services.find((s) => s.name === m[1]);
      const dep = /depends_on:\s*\n((?:\s+-\s*[\w-]+\s*\n?)+)/.exec(m[2]);
      if (!from || !dep) continue;
      for (const d of dep[1].matchAll(/-\s*([\w-]+)/g)) {
        const to = services.find((s) => s.name === d[1]);
        if (to && !(from.dependsOn ?? []).includes(to.name)) { (from.dependsOn ??= []).push(to.name); links.push({ from: from.name, to: to.name, why: `compose depends_on (${posix(path.relative(root, f))})` }); }
      }
    }
  }
  return links;
}
function cmdDetect({ flags }) {
  const root = findRoot(process.cwd()) ?? process.cwd();
  const notes = [];
  const existing = fs.existsSync(path.join(root, MANIFEST_REL)) ? readJson(path.join(root, MANIFEST_REL)) : null;
  const dirs = scanDirs(root);
  const services = [];
  const subRoots = [];
  for (const dir of dirs) {
    const s = detectService(root, dir, notes);
    if (s?._note) { notes.push(s._note); delete s._note; }
    if (!s) continue;
    if (dir === root && dirs.some((d) => d !== root && readPkg(d))) continue; // root package.json of a workspace with sub-projects
    if (subRoots.some((p) => dir.startsWith(p + path.sep) && services.find((x) => x.path === cleanPath(posix(path.relative(root, p))))?.type !== 'library')) continue;
    subRoots.push(dir);
    services.push(s);
  }
  // unique names
  const seen = new Map();
  for (const s of services) { const n = seen.get(s.name) ?? 0; seen.set(s.name, n + 1); if (n) s.name = `${s.name}-${n + 1}`; }
  // infra
  const infraDir = ['infra', 'deploy', 'deployment', 'k8s', 'helm', 'terraform', 'ops'].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
  if (infraDir) services.push({ name: 'infra', type: 'infra', path: cleanPath(posix(path.relative(root, infraDir))), stack: 'Docker / CI / IaC', commands: {} });
  const infraFiles = [...listFiles(root, /^(Dockerfile[^/]*|(docker-)?compose[^/]*\.ya?ml)$/), ...listFiles(path.join(root, '.github', 'workflows'), /\.ya?ml$/)]
    .filter((f) => !f.includes('node_modules')).map((f) => posix(path.relative(root, f))).slice(0, 30);
  const links = detectLinks(root, services);
  // git layout
  const ws = { services };
  const rootRepo = repoInfo(root, root);
  const subs = rootRepo ? submodulePaths(rootRepo.root) : [];
  for (const s of services) {
    const info = repoInfo(root, path.resolve(root, s.path));
    s._repo = !info ? 'NOT A GIT REPO' : info.rel === '' ? '(workspace)' : subs.includes(info.rel) ? `${info.rel} (submodule)` : info.rel;
    if (!info) notes.push(`${s.name}: not in a git repository — run "git init" + first commit in ${s.path}`);
  }
  if (!rootRepo) notes.push('workspace root is not a git repo — "git init" here to version the manifest, specs, contracts and e2e');
  const kept = existing?.services?.filter((e) => !services.some((s) => s.path === cleanPath(e.path))) ?? [];
  const proposal = {
    name: existing?.name ?? path.basename(root),
    services: [...(existing?.services ?? []).map((e) => services.find((s) => s.path === cleanPath(e.path)) ? { ...services.find((s) => s.path === cleanPath(e.path)), ...e } : e),
      ...services.filter((s) => !existing?.services?.some((e) => cleanPath(e.path) === s.path))].map(({ _repo, ...s }) => s),
    conventions: existing?.conventions ?? { replyLanguage: 'uk', comments: { language: 'uk', level: 'all', enforce: true } },
    qa: existing?.qa ?? { defaultDepth: 'ask' },
    contracts: existing?.contracts ?? { path: 'contracts' },
    ...(services.some((s) => s.type === 'frontend') || existing?.e2e ? { e2e: existing?.e2e ?? { path: 'e2e', command: 'npx playwright test' } } : {}),
    ...(services.some((s) => s.type === 'mobile') || existing?.e2eMobile ? { e2eMobile: existing?.e2eMobile ?? { path: 'e2e-mobile', timeoutSec: 1800 } } : {}),
    ...(existing?.audit ? { audit: existing.audit } : {}),
    ...(existing?.pipeline ? { pipeline: existing.pipeline } : {}),
    ...(existing?.deploy ? { deploy: existing.deploy } : {}),
  };
  if (flags.json) return log(JSON.stringify({ root: posix(root), proposal, links, infraFiles, notes, keptFromExisting: kept.map((k) => k.name) }, null, 2));
  log(`Scanned ${posix(root)}\n`);
  table(['service', 'type', 'path', 'repo', 'stack', 'checks', 'dev url'], services.map((s) => [s.name, s.type, s.path, s._repo, s.stack, Object.keys(s.commands).join(',') || '—', s.dev?.url ?? (s.mobile ? 'simulator' : '—')]));
  if (links.length) { log('\nLinks:'); for (const l of links) log(`  ${l.from} → ${l.to}   (${l.why})`); } else log('\nLinks: none found (fill "dependsOn" by hand if clients call backends)');
  if (infraFiles.length) log(`\nInfra files: ${infraFiles.join(', ')}`);
  if (notes.length) log(`\nTo check:\n  - ${notes.join('\n  - ')}`);
  log(`\nFull proposal: ${PL} detect --json`);
}

// ------------------------------------------------- direct-control helpers
// The task the user most likely means: the latest one that is not finished.
function cmdCurrent({ flags }) {
  const { root } = loadWorkspace();
  const db = readJson(tasksPath(root), { tasks: [] });
  const sorted = [...db.tasks].filter((t) => fs.existsSync(statePath(root, t.id))).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const open = sorted.find((t) => t.status === 'IN_PROGRESS' || t.status === 'BLOCKED');
  const t = open ?? (flags.any ? sorted[0] : null);
  if (!t) { log('NONE'); process.exit(3); }
  if (flags.json) {
    const st = readJson(statePath(root, t.id));
    const ws = readJson(path.join(root, MANIFEST_REL));
    return log(JSON.stringify({ id: t.id, status: t.status, stage: t.stage, services: t.services ?? [], qa: st.qa ?? [], depth: taskDepth(root, ws, t.id), defaultDepth: ws.qa?.defaultDepth ?? 'ask' }));
  }
  log(t.id);
}
// Add services (and their repos) to a running task, e.g. when a fix turns out to belong to another project.
function cmdAdd({ pos, flags }) {
  const [id, svcArg] = pos;
  if (!id || !svcArg) die('Usage: add <task-id> <service,service> [--allow-dirty]');
  const { root, ws } = loadWorkspace();
  const st = loadState(root, id);
  const wanted = svcArg.split(',').map((s) => s.trim()).filter(Boolean).filter((n) => !st.services.includes(getService(ws, n).name));
  if (!wanted.length) return log(`= ${id} already includes ${svcArg}`);
  const groups = groupRepos(root, ws, wanted);
  const branch = st.repos[0]?.branch ?? `${ws.pipeline?.branchPrefix ?? 'feat/'}${id}`;
  for (const g of groups) {
    const known = st.repos.find((r) => r.root === g.root);
    if (known) { known.services = [...new Set([...known.services, ...g.services])]; continue; }
    const dirty = gitOut(g.root, ['status', '--porcelain', '--', ...scope(g)]);
    if (dirty && !flags['allow-dirty']) die(`${label(g)} has uncommitted changes:\n${dirty}\nCommit or stash them first (or pass --allow-dirty).`);
    g.base = gitOut(g.root, ['rev-parse', 'HEAD']);
    g.fromBranch = gitOut(g.root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    g.branch = branch;
    const exists = git(g.root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { allowFail: true }).status === 0;
    git(g.root, exists ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch]);
    // keep the workspace repo last: it records submodule pointers after the others commit
    const wsIdx = st.repos.findIndex((r) => r.rel === '');
    if (wsIdx >= 0) st.repos.splice(wsIdx, 0, g); else st.repos.push(g);
  }
  st.services = [...st.services, ...wanted];
  if (Array.isArray(st.qa) && st.qa.length) st.qa = [...new Set([...st.qa, ...qaTargets(ws, st.services)])];
  saveState(root, st);
  updateTask(root, id, { services: st.services });
  log(`✔ ${id}: added ${wanted.join(', ')} (branch ${branch})`);
  log(`  QA now: ${(st.qa ?? []).join(', ') || 'skipped'}`);
}
// QA agents call this after writing their report: ties the verdict to the exact code that was tested.
function cmdStamp({ pos }) {
  const [id, kind] = pos;
  const file = { qa: 'qa.json', 'qa-mobile': 'qa-mobile.json' }[kind] ?? die('Usage: stamp <task-id> <qa|qa-mobile>');
  const { root } = loadWorkspace();
  const st = loadState(root, id);
  const verdict = readJson(path.join(taskDir(root, id), file), null)?.verdict ?? die(`.pipeline/${id}/${file} not found — write the report first`);
  const { ws } = loadWorkspace();
  const cov = coverageReport(root, ws, id, kind === 'qa' ? 'web' : 'mobile');
  if (!cov.ok) die(`Test coverage is below the "${cov.depth ?? '?'}" depth — not stamped:\n  - ${cov.problems.join('\n  - ')}\nAdd the missing cases (see: ${PL} playbook), re-run them, then stamp again.`, 2);
  st.stamps = { ...(st.stamps ?? {}), [kind]: { verdict, hash: fingerprint(st, [PIPELINE_EXCLUDE]), at: now() } };
  saveState(root, st);
  st.stamps[kind].depth = cov.depth; st.stamps[kind].cases = cov.total;
  saveState(root, st);
  log(`✔ ${kind} ${verdict} stamped for the current code of ${id} (depth ${cov.depth}, ${cov.total} cases)`);
}

// ------------------------------------------------------ QA depth & coverage
const DEPTHS = {
  smoke: { label: 'поверхневе', perAc: 1, cats: ['happy'] },
  deep: { label: 'поглиблене', perAc: 4, cats: ['happy', 'negative', 'boundary', 'partial', 'navigation', 'interrupt'] },
  exhaustive: { label: 'дуже ретельне', perAc: 8, cats: ['happy', 'negative', 'boundary', 'partial', 'data', 'navigation', 'gesture', 'interrupt', 'network', 'state', 'a11y', 'visual'] },
};
const CATEGORIES = new Set(['happy', 'negative', 'boundary', 'partial', 'data', 'navigation', 'gesture', 'interrupt', 'network', 'state', 'a11y', 'visual', 'regression']);
function taskDepth(root, ws, id) {
  const st = fs.existsSync(statePath(root, id)) ? readJson(statePath(root, id)) : {};
  return st.depth ?? (DEPTHS[ws.qa?.defaultDepth] ? ws.qa.defaultDepth : null);
}
// Acceptance criteria ids from the spec ("AC-1", "AC-2", …).
function specAcs(root, id) {
  const text = readText(path.join(root, 'docs', 'specs', `${id}.md`));
  const section = /##[^\n]*Acceptance criteria[^\n]*\n([\s\S]*?)(\n## |\s*$)/i.exec(text)?.[1] ?? text;
  return [...new Set([...section.matchAll(/\bAC-(\d+)\b/g)].map((m) => `AC-${m[1]}`))];
}
// Cases written by QA: mobile = one Maestro file per case (tags), web = one test() per case ("AC-1 [category] …").
function collectCases(root, ws, id, kind) {
  const cases = [];
  if (kind === 'mobile') {
    const dir = path.join(root, cleanPath(ws.e2eMobile?.path ?? 'e2e-mobile'), id);
    for (const f of listFiles(dir, /\.ya?ml$/i)) {
      const head = readText(f).split(/^---\s*$/m)[0];
      const tagBlock = /tags:\s*\[([^\]]*)\]/.exec(head)?.[1] ?? [...head.matchAll(/^\s*-\s*([\w-]+)\s*$/gm)].map((m) => m[1]).join(',');
      const tags = tagBlock.split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean);
      const ac = tags.find((t) => /^AC-\d+$/.test(t)) ?? /(AC-\d+)/.exec(path.basename(f))?.[1] ?? null;
      cases.push({ file: posix(path.relative(root, f)), ac, cats: tags.filter((t) => CATEGORIES.has(t)) });
    }
  } else {
    const dir = path.join(root, cleanPath(ws.e2e?.path ?? 'e2e'));
    for (const f of listFiles(dir, /\.(spec|test)\.(ts|js)$/).filter((f) => path.basename(f).startsWith(id))) {
      for (const m of readText(f).matchAll(/\btest(?:\.\w+)?\(\s*[`'"](AC-\d+)\s*\[([^\]]+)\]/g)) {
        cases.push({ file: posix(path.relative(root, f)), ac: m[1], cats: m[2].split(/[,\s]+/).filter((c) => CATEGORIES.has(c)) });
      }
    }
  }
  return cases;
}
function coverageReport(root, ws, id, kind) {
  const depth = taskDepth(root, ws, id);
  if (!depth) return { ok: false, depth: null, problems: [`depth is not set — ask the user and run: ${PL} mark ${id} depth=smoke|deep|exhaustive`] };
  const rule = DEPTHS[depth];
  const acs = specAcs(root, id);
  const cases = collectCases(root, ws, id, kind);
  const report = readJson(path.join(taskDir(root, id), kind === 'mobile' ? 'qa-mobile.json' : 'qa.json'), {});
  const na = report.not_applicable ?? {};
  const problems = [];
  if (!acs.length) problems.push(`no "AC-<n>" found in docs/specs/${id}.md (Acceptance criteria section)`);
  const planFile = kind === 'mobile' ? path.join(root, cleanPath(ws.e2eMobile?.path ?? 'e2e-mobile'), id, 'CASES.md') : path.join(root, cleanPath(ws.e2e?.path ?? 'e2e'), `${id}.cases.md`);
  if (!fs.existsSync(planFile)) problems.push(`test plan missing: ${posix(path.relative(root, planFile))}`);
  const perAc = acs.map((ac) => ({ ac, n: cases.filter((c) => c.ac === ac).length }));
  for (const { ac, n } of perAc) if (n < rule.perAc) problems.push(`${ac}: ${n} case(s), need at least ${rule.perAc} for ${depth}`);
  const present = new Set(cases.flatMap((c) => c.cats));
  for (const cat of rule.cats) {
    if (present.has(cat)) continue;
    if (typeof na[cat] === 'string' && na[cat].trim().length >= 10) continue;
    problems.push(`category "${cat}" not covered (or declare not_applicable.${cat} with a real reason in the report)`);
  }
  const untagged = cases.filter((c) => !c.ac || !c.cats.length).map((c) => c.file);
  if (untagged.length) problems.push(`cases without AC id or category tag: ${[...new Set(untagged)].slice(0, 10).join(', ')}`);
  return { ok: !problems.length, depth, label: rule.label, total: cases.length, perAc, categories: [...present], problems };
}
function cmdCoverage({ pos, flags }) {
  const [id, kindArg] = pos;
  if (!id) die('Usage: coverage <task-id> [mobile|web]');
  const { root, ws } = loadWorkspace();
  loadState(root, id);
  const kinds = kindArg ? [kindArg] : (readJson(statePath(root, id)).qa ?? []).map((q) => (q === 'web' ? 'web' : 'mobile'));
  let ok = true;
  for (const kind of kinds) {
    const r = coverageReport(root, ws, id, kind);
    if (flags.json) { log(JSON.stringify({ kind, ...r })); ok &&= r.ok; continue; }
    log(`${r.ok ? '✔' : '✖'} ${kind} coverage — depth: ${r.depth ?? '?'}${r.label ? ` (${r.label})` : ''}, cases: ${r.total ?? 0}`);
    for (const p of r.perAc ?? []) log(`   ${p.ac}: ${p.n}`);
    if (r.categories?.length) log(`   categories: ${r.categories.join(', ')}`);
    for (const p of r.problems) log(`   ✖ ${p}`);
    ok &&= r.ok;
  }
  if (!ok) process.exit(1);
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
const MEM_START = '<!-- claude-team-kit:start -->';
const MEM_END = '<!-- claude-team-kit:end -->';
// Adds (or refreshes) the kit's block in the user-level CLAUDE.md without touching the rest of the file.
function cmdInstallMemory({ pos }) {
  const file = pos[0] ?? die('Usage: install-memory <~/.claude/CLAUDE.md>');
  const block = `${MEM_START}\n${fs.readFileSync(path.join(KIT_DIR, 'USER_CLAUDE.md'), 'utf8').trim()}\n${MEM_END}`;
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const re = new RegExp(`${MEM_START}[\\s\\S]*?${MEM_END}`);
  const next = re.test(cur) ? cur.replace(re, block) : `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${cur ? '\n' : ''}${block}\n`;
  if (next !== cur) { if (cur) fs.copyFileSync(file, `${file}.bak.${Date.now()}`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, next); }
  log(`✔ language rules in ${file}`);
}
function cmdUninstallMemory({ pos }) {
  const file = pos[0] ?? die('Usage: uninstall-memory <~/.claude/CLAUDE.md>');
  if (!fs.existsSync(file)) return;
  const cur = fs.readFileSync(file, 'utf8');
  const next = cur.replace(new RegExp(`\\n*${MEM_START}[\\s\\S]*?${MEM_END}\\n?`), '\n').replace(/^\n+/, '');
  if (next !== cur) { fs.copyFileSync(file, `${file}.bak.${Date.now()}`); fs.writeFileSync(file, next); log(`✔ removed team-kit block from ${file}`); }
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
  if (ws.services.some((s) => ['frontend', 'mobile'].includes(s.type))) copyIfMissing(root, 'testing-guide.md', 'docs/testing/_TEMPLATE.md');
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
    const subs = submodulePaths(w.root);
    const nested = allRepoRoots(root, ws).filter((o) => o !== w.root && o.startsWith(w.root + path.sep))
      .map((o) => posix(path.relative(w.root, o)))
      .filter((rel) => !subs.includes(rel)) // submodules are tracked by the parent repo — never ignore them
      .map((rel) => rel + '/');
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
  const map = { workspace: 'workspace.example.json', spec: 'spec.md', playwright: 'playwright.config.ts', 'mobile-flow': 'maestro-flow.example.yaml', 'testing-guide': 'testing-guide.md' };
  const f = map[pos[0]] ?? die(`Usage: template <${Object.keys(map).join('|')}>`);
  process.stdout.write(fs.readFileSync(path.join(KIT_DIR, 'templates', f), 'utf8'));
}

const HELP = `Claude Team Kit — ${PL} <command>

  rules                          print the orchestrator rules
  conventions                    print coding conventions (comment language etc.) for agents
  detect [--json]                scan folders: services, types, repos/submodules, checks, ports, links between projects
  services [--type t] [--json]   list workspace services with their links (uses / used by)
  start <id> <svc,..|all>        create feat/<id> branches in affected repos [--no-qa] [--allow-dirty]
  diff <id|adhoc>                build the blind-audit diff (.pipeline/<id>/diff.patch)
  owner <files..> | --file f     which agent owns these files
  verify <id> [svc,..]           comments + lint/typecheck/test/build per service → verify.json
  verify <id> --only test,lint   partial run (any subset, incl. comments) → verify-partial.json, not a gate
  comments <id> [svc,..]         check that new functions/variables have comments in the workspace language
  sim <id> [--platform ios|android|all] [--service app] [--rebuild] [--skip-build] [--flows dir]
                                 boot simulator, build/install app, start backends, run Maestro flows
                                 (--flows: run another folder, e.g. exploration or full regression; not a gate)
                                 (--tags AC-1,happy: only matching flows; --rerun-failed: only what failed last time — merged into the report)
                                 (no --platform: platforms for the task's depth — primary only unless exhaustive)
  screen [--platform ios|android] what is on the simulator now: screenshot + visible elements (testID, text)
  mark <id> stage=N status=S [loop=name] [note=..]   update task state; exit 3 at loop limit
  commit <id> -m "feat(x): .."   gated commit in every affected repo (no push)
  rollback <id>                  stash changes, return repos to their original branches
  deploy <env> [--task id] [--approved]   run deploy steps + healthchecks (+ rollback)
  status                         table of all tasks
  current [--json] [--any]       the task the user most likely means (latest unfinished)
  add <id> <svc,..>              add services/projects to a running task (branches in their repos)
  stamp <id> <qa|qa-mobile>      tie a QA verdict to the current code (commit requires a fresh stamp; refused if coverage < depth)
  coverage <id> [mobile|web]     are there enough test cases and categories for the task's QA depth?
  playbook                       the tester's case catalogue (forms, fields, gestures, interruptions, network…)
  scaffold | doctor              set up / check the workspace
  template <workspace|spec|playwright|mobile-flow|testing-guide>
  guard                          PreToolUse hook (reads JSON on stdin)
  install-hook | uninstall-hook      used by install.sh / uninstall.sh
  install-memory | uninstall-memory  add/remove the language block in ~/.claude/CLAUDE.md`;

const COMMANDS = {
  rules: () => {
    const root = findRoot(process.cwd());
    const ws = root ? readJson(path.join(root, MANIFEST_REL), {}) : {};
    const lang = LANGUAGES[ws.conventions?.replyLanguage ?? 'uk'] ?? LANGUAGES.uk;
    process.stdout.write(fs.readFileSync(path.join(KIT_DIR, 'PIPELINE.md'), 'utf8').replaceAll('{{REPLY_LANGUAGE}}', `${lang.name} (${lang.native})`));
  },
  detect: cmdDetect, conventions: cmdConventions, current: cmdCurrent, add: cmdAdd, stamp: cmdStamp, coverage: cmdCoverage,
  playbook: () => process.stdout.write(fs.readFileSync(path.join(KIT_DIR, 'QA_PLAYBOOK.md'), 'utf8')), comments: cmdComments, sim: cmdSim, screen: cmdScreen,
  services: cmdServices, start: cmdStart, diff: cmdDiff, owner: cmdOwner, verify: cmdVerify, mark: cmdMark,
  commit: cmdCommit, rollback: cmdRollback, deploy: cmdDeploy, status: cmdStatus, scaffold: cmdScaffold,
  doctor: cmdDoctor, template: cmdTemplate, guard: cmdGuard,
  'install-hook': cmdInstallHook, 'uninstall-hook': cmdUninstallHook,
  'install-memory': cmdInstallMemory, 'uninstall-memory': cmdUninstallMemory,
  help: () => log(HELP),
};
const [sub, ...rest] = process.argv.slice(2);
const fn = COMMANDS[sub ?? 'help'] ?? (() => die(`Unknown command "${sub}"\n\n${HELP}`));
await fn(parseArgs(rest));
