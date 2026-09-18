'use strict';

/**
 * gitid 核心（UI 无关）：身份档案存取 + git 配置读写 + 仓库扫描。
 * CLI（bin/gitid.js）与桌面端（desktop/main）共用本文件——桌面端经
 * desktop/scripts/sync-core.mjs 同步副本打包，修改请以本文件为准。
 * 所有函数均不打印、不 process.exit；错误抛 GitidError。
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

class GitidError extends Error {}

const IDENTITY_KEYS = ['user.name', 'user.email', 'user.signingkey', 'commit.gpgsign'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCAN_SKIP = new Set([
  'node_modules', '.git', '.svn', '.hg', 'target', 'dist', 'build', 'vendor',
  '.venv', '__pycache__', '.cache', '.npm', '.idea', '.vscode',
]);

// ---------- 配置档案存取 ----------

function configPath() {
  if (process.env.GITID_CONFIG) return process.env.GITID_CONFIG;
  // Windows 惯例位置为 %APPDATA%；其余平台维持 XDG
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'gitid', 'config.json');
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'gitid', 'config.json');
}

function loadStore(p = configPath()) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.identities !== 'object') {
      throw new GitidError(`配置文件结构不合法：${p}`);
    }
    return raw;
  } catch (e) {
    if (e.code === 'ENOENT') return { version: 1, identities: {} };
    if (e instanceof GitidError) throw e;
    throw new GitidError(`无法解析配置文件 ${p}：${e.message}`);
  }
}

function saveStore(store, p = configPath()) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 先写临时文件再原子改名，避免写一半损坏
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.renameSync(tmp, p);
  } catch (e) {
    // Windows 下目标被占用（杀软/另一进程 watch）会 EPERM，回退直接写入
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EAGAIN'].includes(e.code)) {
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
    fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function upsertIdentity(store, id, fields) {
  if (!ID_PATTERN.test(id)) throw new GitidError(`身份 id 只允许字母数字与 . _ - ，且以字母数字开头：「${id}」不合法`);
  if (!fields.name) throw new GitidError('姓名不能为空');
  if (!fields.email || !EMAIL_PATTERN.test(fields.email)) throw new GitidError(`邮箱格式不合法：${fields.email || '（空）'}`);
  const exists = !!store.identities[id];
  const it = { name: fields.name, email: fields.email, signingkey: fields.signingkey || '' };
  if (fields.gpgsign === true) it.gpgsign = true;
  if (fields.extra && Object.keys(fields.extra).length) it.extra = fields.extra;
  store.identities[id] = it;
  return { store, exists };
}

function getIdentity(store, id) {
  const it = store.identities[id];
  if (!it) {
    const known = Object.keys(store.identities);
    throw new GitidError(
      `身份「${id}」不存在。${known.length ? `可用身份：${known.join('、')}` : '配置档案为空，先创建一个身份'}`,
    );
  }
  return it;
}

// ---------- 设置（与身份档案同存 config.json；目前为默认扫描目录/深度） ----------

const DEFAULT_SCAN_DEPTH = 6;
const SCAN_DEPTH_MAX = 12;

// 归一化读取：旧档案无 settings 或字段缺失时返回默认值，不抛错
function getSettings(store) {
  const raw = store && store.settings && typeof store.settings === 'object' ? store.settings : {};
  return {
    scanRoot: typeof raw.scanRoot === 'string' ? raw.scanRoot : '',
    scanDepth: Number.isInteger(raw.scanDepth) && raw.scanDepth >= 1 ? raw.scanDepth : DEFAULT_SCAN_DEPTH,
  };
}

// patch 为部分更新；scanRoot 空串 = 清除默认（CLI 回退 '.'，桌面端回退 ~/Projects）。
// 目录存在性不在保存时校验（可能尚未创建），由 scanRepos 扫描时统一报错
function saveSettings(store, patch = {}) {
  const next = { ...getSettings(store), ...patch };
  if (typeof next.scanRoot !== 'string') throw new GitidError(`scanRoot 需为字符串：${next.scanRoot}`);
  next.scanRoot = next.scanRoot.trim();
  if (!Number.isInteger(next.scanDepth) || next.scanDepth < 1 || next.scanDepth > SCAN_DEPTH_MAX) {
    throw new GitidError(`scanDepth 需为 1-${SCAN_DEPTH_MAX} 的整数：${next.scanDepth}`);
  }
  store.settings = next;
  return store;
}

// ---------- git 封装（cwd 可选，供桌面端操作任意仓库） ----------

function git(args, { allowFail = false, cwd } = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd });
  if (r.error) throw new GitidError('未找到 git 命令，请先安装 git');
  if (!allowFail && r.status !== 0) {
    throw new GitidError(`git ${args.join(' ')} 失败：${(r.stderr || '').trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function scopeFlag(scope) { return scope === 'local' ? '--local' : '--global'; }

function cfgGet(scope, key, { cwd } = {}) {
  const r = git(['config', scopeFlag(scope), '--get', key], { allowFail: true, cwd });
  return r.ok ? r.out : undefined;
}

function cfgGetEffective(key, { cwd } = {}) {
  const r = git(['config', '--get', key], { allowFail: true, cwd });
  return r.ok ? r.out : undefined;
}

function cfgSet(scope, key, value, { cwd } = {}) {
  git(['config', scopeFlag(scope), key, value], { cwd });
}

function cfgUnset(scope, key, { cwd } = {}) {
  git(['config', scopeFlag(scope), '--unset', key], { allowFail: true, cwd });
}

function repoRoot(cwd) {
  const r = git(['rev-parse', '--show-toplevel'], { allowFail: true, cwd });
  return r.ok ? r.out : null;
}

function repoBranch(cwd) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true, cwd });
  return r.ok ? r.out : null;
}

// ---------- 身份匹配与应用 ----------

function matchIdentity(store, name, email) {
  if (name === undefined && email === undefined) return null;
  for (const [id, it] of Object.entries(store.identities)) {
    if (it.name === name && it.email === email) return id;
  }
  return null;
}

function readApplied(scope, store, { cwd } = {}) {
  return {
    name: cfgGet(scope, 'user.name', { cwd }),
    email: cfgGet(scope, 'user.email', { cwd }),
    signingkey: cfgGet(scope, 'user.signingkey', { cwd }),
    gpgsign: cfgGet(scope, 'commit.gpgsign', { cwd }),
    identityId: matchIdentity(store, cfgGet(scope, 'user.name', { cwd }), cfgGet(scope, 'user.email', { cwd })),
  };
}

// 全量覆盖语义：身份没有的键会被 unset（签名配置不残留，ADR-003）
function applyIdentity(it, scope, { cwd } = {}) {
  const before = {};
  for (const key of IDENTITY_KEYS) before[key] = cfgGet(scope, key, { cwd });

  cfgSet(scope, 'user.name', it.name, { cwd });
  cfgSet(scope, 'user.email', it.email, { cwd });
  if (it.signingkey) cfgSet(scope, 'user.signingkey', it.signingkey, { cwd });
  else cfgUnset(scope, 'user.signingkey', { cwd });
  if (it.gpgsign === true) cfgSet(scope, 'commit.gpgsign', 'true', { cwd });
  else cfgUnset(scope, 'commit.gpgsign', { cwd });
  for (const [k, v] of Object.entries(it.extra || {})) cfgSet(scope, k, v, { cwd });

  const changes = [];
  const record = (key, now) => {
    const old = before[key];
    if (old !== now) changes.push({ key, from: old, to: now });
  };
  record('user.name', it.name);
  record('user.email', it.email);
  record('user.signingkey', it.signingkey || undefined);
  record('commit.gpgsign', it.gpgsign === true ? 'true' : undefined);
  return changes;
}

function unsetIdentity(scope, { cwd } = {}) {
  const removed = [];
  for (const key of IDENTITY_KEYS) {
    if (cfgGet(scope, key, { cwd }) !== undefined) {
      cfgUnset(scope, key, { cwd });
      removed.push(key);
    }
  }
  return removed;
}

// ---------- 仓库扫描 ----------

function findRepos(root, maxDepth) {
  const found = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === '.git')) { found.push(dir); return; }
    if (depth <= 0) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.git' || SCAN_SKIP.has(e.name)) continue;
      walk(path.join(dir, e.name), depth - 1);
    }
  };
  walk(root, maxDepth);
  return found;
}

// 返回结构化行，展示格式由调用方决定
function scanRepos(store, root, depth = 6) {
  if (!Number.isInteger(depth) || depth < 1) throw new GitidError(`depth 需为正整数：${depth}`);
  // ~ / ~/x / ~\x 按主目录展开（shell 语义）：桌面端扫描通道没有 shell，统一在此处理
  const resolved = String(root).replace(/^~(?=[/\\]|$)/, os.homedir());
  if (!fs.existsSync(resolved)) throw new GitidError(`目录不存在：${resolved}`);
  const base = path.resolve(resolved);
  const repos = findRepos(base, depth);
  const rows = repos.sort().map((repo) => {
    const local = {
      name: cfgGet('local', 'user.name', { cwd: repo }),
      email: cfgGet('local', 'user.email', { cwd: repo }),
    };
    const effective = {
      name: cfgGetEffective('user.name', { cwd: repo }),
      email: cfgGetEffective('user.email', { cwd: repo }),
    };
    const hasLocal = local.name !== undefined || local.email !== undefined;
    const identityId = matchIdentity(store, effective.name, effective.email);
    let status = 'ok';
    if (effective.name === undefined || effective.email === undefined) status = 'missing';
    else if (!identityId) status = 'unknown';
    return { path: repo, rel: path.relative(base, repo) || '.', local, effective, hasLocal, identityId, status };
  });
  const summary = {
    total: rows.length,
    withLocal: rows.filter((r) => r.hasLocal).length,
    missing: rows.filter((r) => r.status === 'missing').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
  };
  return { rows, summary };
}

module.exports = {
  GitidError,
  IDENTITY_KEYS,
  ID_PATTERN,
  EMAIL_PATTERN,
  configPath,
  loadStore,
  saveStore,
  upsertIdentity,
  getIdentity,
  getSettings,
  saveSettings,
  git,
  cfgGet,
  cfgGetEffective,
  cfgSet,
  cfgUnset,
  repoRoot,
  repoBranch,
  matchIdentity,
  readApplied,
  applyIdentity,
  unsetIdentity,
  findRepos,
  scanRepos,
};
