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
  if (fields.insteadOf !== undefined) {
    if (!Array.isArray(fields.insteadOf)) throw new GitidError('insteadOf 需为 [{original, url}] 数组');
    const seen = new Set();
    const clean = [];
    for (const p of fields.insteadOf) {
      const original = String(p.original || '').trim();
      const url = String(p.url || '').trim();
      if (!original || !url || /\s/.test(original) || /\s/.test(url)) {
        throw new GitidError(`insteadOf 需为不含空白的 原始地址=替换地址 对：${original || url || '（空）'} 不合法`);
      }
      if (original === url) throw new GitidError(`insteadOf 原始与替换地址不能相同：${url}`);
      const k = `${original}=>${url}`;
      if (!seen.has(k)) { seen.add(k); clean.push({ original, url }); }
    }
    if (clean.length) it.insteadOf = clean;
    else delete it.insteadOf; // 显式传空数组 = 清除该身份的全部 URL 重写
  }
  if (fields.accounts !== undefined) {
    // 凭据账号选择器（L1）：host=用户名，映射为 credential.<https://host>.username；
    // 只选不存——token 本体永远在 helper/密钥服务（ADR-017）
    if (!Array.isArray(fields.accounts)) throw new GitidError('accounts 需为 [{host, username}] 数组');
    const seen = new Set();
    const clean = [];
    for (const a of fields.accounts) {
      const host = String(a.host || '').trim().replace(/^\w+:\/\//, '').replace(/\/+$/, '');
      const username = String(a.username || '').trim();
      if (!host || !username || /\s/.test(host) || /\s/.test(username)) {
        throw new GitidError(`account 需为不含空白的 host=用户名 对：${host || username || '（空）'} 不合法`);
      }
      const k = host.toLowerCase();
      if (!seen.has(k)) { seen.add(k); clean.push({ host, username }); }
    }
    if (clean.length) it.accounts = clean;
    else delete it.accounts; // 空数组 = 清除该身份的全部凭据选择器
  }
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

function git(args, { allowFail = false, cwd, input, env } = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', cwd, input, env });
  if (r.error) throw new GitidError('未找到 git 命令，请先安装 git');
  if (!allowFail && r.status !== 0) {
    throw new GitidError(`git ${args.join(' ')} 失败：${(r.stderr || '').trim()}`);
  }
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
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

// 身份携带的非身份键配置键集合：extra 自定义键 + insteadOf 生成的 url.<url>.insteadOf
function insteadOfConfigKey(p) { return `url.${p.url}.insteadOf`; }

function accountConfigKey(a) { return `credential.https://${a.host}.username`; }

function extraConfigKeys(it) {
  const keys = new Set(Object.keys((it && it.extra) || {}));
  for (const p of (it && it.insteadOf) || []) keys.add(insteadOfConfigKey(p));
  for (const a of (it && it.accounts) || []) keys.add(accountConfigKey(a));
  return keys;
}

// 全量覆盖语义：身份没有的键（signingkey/gpgsign/extra/insteadOf）会被 unset，
// 不残留上一身份的签名与 URL 重写配置（ADR-003/016）
function applyIdentity(it, scope, { cwd, store } = {}) {
  const before = {};
  const watch = new Set(IDENTITY_KEYS);
  for (const key of IDENTITY_KEYS) watch.add(key);
  for (const key of extraConfigKeys(it)) watch.add(key);

  // 上一身份（按切换前生效 name+email 匹配档案）的 extra/insteadOf 若本身份未再定义，
  // 一并清除——防 URL 重写残留导致 push 被静默重定向（ADR-016）
  const cleanupKeys = [];
  if (store) {
    const prevName = cfgGet(scope, 'user.name', { cwd });
    const prevEmail = cfgGet(scope, 'user.email', { cwd });
    const prevId = matchIdentity(store, prevName, prevEmail);
    const prev = prevId ? store.identities[prevId] : null;
    if (prev && prev !== it) {
      const own = extraConfigKeys(it);
      for (const key of extraConfigKeys(prev)) {
        if (!own.has(key)) { cleanupKeys.push(key); watch.add(key); }
      }
    }
  }
  for (const key of watch) before[key] = cfgGet(scope, key, { cwd });

  for (const key of cleanupKeys) cfgUnset(scope, key, { cwd });

  cfgSet(scope, 'user.name', it.name, { cwd });
  cfgSet(scope, 'user.email', it.email, { cwd });
  if (it.signingkey) cfgSet(scope, 'user.signingkey', it.signingkey, { cwd });
  else cfgUnset(scope, 'user.signingkey', { cwd });
  if (it.gpgsign === true) cfgSet(scope, 'commit.gpgsign', 'true', { cwd });
  else cfgUnset(scope, 'commit.gpgsign', { cwd });
  for (const [k, v] of Object.entries(it.extra || {})) cfgSet(scope, k, v, { cwd });
  for (const p of it.insteadOf || []) cfgSet(scope, insteadOfConfigKey(p), p.original, { cwd });
  for (const a of it.accounts || []) cfgSet(scope, accountConfigKey(a), a.username, { cwd });

  const changes = [];
  const record = (key, now) => {
    const old = before[key];
    if (old !== now) changes.push({ key, from: old, to: now });
  };
  record('user.name', it.name);
  record('user.email', it.email);
  record('user.signingkey', it.signingkey || undefined);
  record('commit.gpgsign', it.gpgsign === true ? 'true' : undefined);
  for (const [k, v] of Object.entries(it.extra || {})) record(k, v);
  for (const p of it.insteadOf || []) record(insteadOfConfigKey(p), p.original);
  for (const a of it.accounts || []) record(accountConfigKey(a), a.username);
  for (const key of cleanupKeys) record(key, undefined);
  return changes;
}

function unsetIdentity(scope, { cwd, store } = {}) {
  const name = cfgGet(scope, 'user.name', { cwd });
  const email = cfgGet(scope, 'user.email', { cwd });
  const removed = [];
  for (const key of IDENTITY_KEYS) {
    if (cfgGet(scope, key, { cwd }) !== undefined) {
      cfgUnset(scope, key, { cwd });
      removed.push(key);
    }
  }
  // 匹配到档案时，其 extra/insteadOf 一并清除；手配（无匹配档案）不归属任何身份，不动
  if (store) {
    const id = matchIdentity(store, name, email);
    const it = id ? store.identities[id] : null;
    if (it) {
      for (const key of extraConfigKeys(it)) {
        if (cfgGet(scope, key, { cwd }) !== undefined) {
          cfgUnset(scope, key, { cwd });
          removed.push(key);
        }
      }
    }
  }
  return removed;
}

// ---------- 远程与镜像推送（per-repo；remote 为仓库私有概念，不进全局 profile） ----------

// 解析仓库本地 remote.*.url / remote.*.pushurl（多值）
function getRemotes(cwd) {
  const r = git(['config', '--local', '--get-regexp', '^remote\\..+\\.(url|pushurl)$'], { allowFail: true, cwd });
  const map = new Map();
  if (r.ok && r.out) {
    for (const line of r.out.split('\n')) {
      const m = line.match(/^remote\.(.+)\.(url|pushurl) (.+)$/);
      if (!m) continue;
      const [, name, kind, value] = m;
      if (!map.has(name)) map.set(name, { name, url: '', pushurls: [] });
      if (kind === 'url') map.get(name).url = value;
      else map.get(name).pushurls.push(value);
    }
  }
  const remotes = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const x of remotes) x.mirror = x.pushurls.length >= 2;
  return remotes;
}

// 开启镜像推送：remote.<name>.pushurl 置为 [原始 push 目标, 镜像地址]，
// git push 同时推两端；fetch（url）不受影响。重复调用以新镜像地址替换旧镜像
function setMirrorPush(cwd, remoteName, mirrorUrl) {
  const root = repoRoot(cwd);
  if (!root) throw new GitidError(`不是 git 仓库：${cwd}`);
  const url = String(mirrorUrl || '').trim();
  if (!url || /\s/.test(url)) throw new GitidError(`镜像地址不合法：${mirrorUrl || '（空）'}`);
  const remotes = getRemotes(root);
  const remote = remotes.find((x) => x.name === remoteName);
  if (!remote) throw new GitidError(`远程「${remoteName}」不存在。可用：${remotes.map((x) => x.name).join('、') || '（无）'}`);
  const others = remote.pushurls.filter((u) => u !== url);
  const original = others.length ? others[0] : remote.url;
  if (!original) throw new GitidError(`远程「${remoteName}」缺少 fetch 地址（remote.${remoteName}.url）`);
  if (original === url) throw new GitidError(`镜像地址与「${remoteName}」现有地址相同：${url}`);
  if (remote.pushurls.length) git(['config', '--local', '--unset-all', `remote.${remoteName}.pushurl`], { allowFail: true, cwd: root });
  git(['config', '--local', '--add', `remote.${remoteName}.pushurl`, original], { cwd: root });
  git(['config', '--local', '--add', `remote.${remoteName}.pushurl`, url], { cwd: root });
  return { name: remoteName, fetchUrl: remote.url, pushurls: [original, url] };
}

// 取消镜像推送：清除全部 pushurl，push 回到 fetch 地址
function clearMirrorPush(cwd, remoteName) {
  const root = repoRoot(cwd);
  if (!root) throw new GitidError(`不是 git 仓库：${cwd}`);
  const remotes = getRemotes(root);
  const remote = remotes.find((x) => x.name === remoteName);
  if (!remote) throw new GitidError(`远程「${remoteName}」不存在。可用：${remotes.map((x) => x.name).join('、') || '（无）'}`);
  if (remote.pushurls.length) git(['config', '--local', '--unset-all', `remote.${remoteName}.pushurl`], { allowFail: true, cwd: root });
  return { name: remoteName, fetchUrl: remote.url, removed: remote.pushurls.length };
}

// 生效的 URL 重写（url.<B>.insteadOf <A> → A 被重写为 B），本地覆盖合并全局。
// 注意：git 变量名不区分大小写且返回时统一小写，故按 insteadof 匹配
function listUrlRewrites({ cwd } = {}) {
  const r = git(['config', '--get-regexp', '^url\\..+\\.insteadof$'], { allowFail: true, cwd });
  if (!r.ok || !r.out) return [];
  const out = [];
  for (const line of r.out.split('\n')) {
    const m = line.match(/^url\.(.+)\.insteadof (.+)$/i);
    if (m) out.push({ original: m[2], url: m[1] });
  }
  return out;
}

// ---------- 凭据管道（ADR-017）：gitid 是 conduit 不是仓库 ----------
// token 生命周期：stdin/输入 → 进程内存 → git credential 协议 → helper（GCM/libsecret/store）；
// 不落 config.json、不落日志、不回显、不进任何 IPC 载荷。展示永远只有 host → username。

// host 输入归一为 credential 协议三元组：裸 host 补 https://
function parseCredBasis(hostInput) {
  let s = String(hostInput || '').trim();
  if (!s || /\s/.test(s)) throw new GitidError(`凭据 host 不合法：${hostInput || '（空）'}`);
  if (!s.includes('://')) s = `https://${s}`;
  const m = s.match(/^(https?):\/\/([^/?#]+)/);
  if (!m) throw new GitidError(`凭据 host 仅支持 http(s)：${hostInput}`);
  return { protocol: m[1], host: m[2], basis: `${m[1]}://${m[2]}` };
}

function credentialInput(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

function hasCredentialHelper({ cwd } = {}) {
  const r = git(['config', '--get', 'credential.helper'], { allowFail: true, cwd });
  return r.ok && !!r.out;
}

// 只读探测：返回 {host, username, stored}；password 读到即丢，绝不向上层返回。
// 全部交互通道关闭（终端/askpass/GCM GUI），查不到即安静返回 stored:false
function credentialProbe(hostInput, { username, cwd } = {}) {
  const { protocol, host } = parseCredBasis(hostInput);
  const query = { protocol, host };
  if (username) query.username = username;
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: ':',
    GCM_INTERACTIVE: 'never',
  };
  const r = git(['credential', 'fill'], { allowFail: true, cwd, input: credentialInput(query), env });
  if (!r.ok || !r.out) return { host, username: username || null, stored: false };
  let found = null;
  for (const line of r.out.split('\n')) {
    const m = line.match(/^username=(.+)$/);
    if (m) found = m[1];
    // password 行刻意丢弃
  }
  if (!found) return { host, username: username || null, stored: false };
  return { host, username: found, stored: true };
}

// 保存/覆盖凭据（同 host+username 覆盖）：token 由调用方保证来自 stdin/输入框
function credentialStore(hostInput, username, token, { cwd } = {}) {
  const { protocol, host } = parseCredBasis(hostInput);
  const user = String(username || '').trim();
  if (!user || /\s/.test(user)) throw new GitidError(`用户名不合法：${username || '（空）'}`);
  if (!token || /[\r\n]/.test(token)) throw new GitidError('token 不能为空，且不能包含换行');
  if (!hasCredentialHelper({ cwd })) {
    throw new GitidError('未配置 credential.helper，token 将无处保存。先执行：git config --global credential.helper manager（或 libsecret / store）');
  }
  git(['credential', 'approve'], {
    cwd,
    input: credentialInput({ protocol, host, username: user, password: token }),
  });
  noteCredentialHost(host, user); // 非密钥线索：让 list/凭据页"看得到"这次保存（协议无枚举）
  return { host, username: user };
}

// 删除凭据（erase）；未传 username 时按 helper 语义匹配该 host
function credentialErase(hostInput, username, { cwd } = {}) {
  const { protocol, host } = parseCredBasis(hostInput);
  const query = { protocol, host };
  const user = username ? String(username).trim() : '';
  if (user) query.username = user;
  git(['credential', 'reject'], { cwd, input: credentialInput(query) });
  dropCredentialHost(host, user || null);
  return { host, username: user || null };
}

// 交互式登录：放开交互跑 fill（GCM 弹自身 GUI / 终端询问），成功后 approve 回写。
// token 仅在内存中转（fill stdout → approve stdin），不落任何持久层
function credentialLogin(hostInput, username, { cwd } = {}) {
  const { protocol, host } = parseCredBasis(hostInput);
  if (!hasCredentialHelper({ cwd })) {
    throw new GitidError('未配置 credential.helper，无法登录。先执行：git config --global credential.helper manager');
  }
  const query = { protocol, host };
  if (username) query.username = String(username).trim();
  const r = git(['credential', 'fill'], { allowFail: true, cwd, input: credentialInput(query) });
  if (!r.ok || !r.out) throw new GitidError(`登录未完成（取消或 helper 不可用）：${r.err || host}`);
  const got = {};
  for (const line of r.out.split('\n')) {
    const m = line.match(/^(username|password)=(.*)$/);
    if (m) got[m[1]] = m[2];
  }
  if (!got.username || !got.password) throw new GitidError('登录未返回完整凭据（username/password 缺失）');
  git(['credential', 'approve'], {
    cwd,
    input: credentialInput({ protocol, host, username: got.username, password: got.password }),
  });
  noteCredentialHost(host, got.username);
  return { host, username: got.username };
}

// ---------- 凭据线索（非密钥）：login/set 成功后记 host+username，list 以此补足枚举 ----------
// git credential 协议没有"枚举钥匙串"能力，只能按线索点名探测；线索=配置选择器+此处记录。
// 只存 host/username（与展示信息相同，非密钥），失败静默——线索记录不影响凭据操作本身

function noteCredentialHost(host, username) {
  try {
    const store = loadStore();
    if (!Array.isArray(store.credentialHosts)) store.credentialHosts = [];
    const list = store.credentialHosts.filter(
      (x) => !(String(x.host) === String(host) && String(x.username) === String(username)),
    );
    list.push({ host: String(host), username: String(username) });
    store.credentialHosts = list.slice(-50); // 防无限增长
    saveStore(store);
  } catch { /* 线索记录失败不致命 */ }
}

function dropCredentialHost(host, username) {
  try {
    const store = loadStore();
    if (!Array.isArray(store.credentialHosts)) return;
    store.credentialHosts = store.credentialHosts.filter(
      (x) => x.host !== host || (username !== null && x.username !== username),
    );
    saveStore(store);
  } catch { /* 线索记录失败不致命 */ }
}

// 凭据总览：以两类非密钥线索点名探测——① 配置中的选择器（credential.<basis>.username，
// 身份写入或手配）；② login/set 记录的 credentialHosts。credential 协议无"枚举"操作，
// 钥匙串里还有什么无从得知，只能展示已知线索（协议能力边界，如实声明）
function credentialList({ cwd } = {}) {
  const entries = new Map(); // key: host|探测用户名
  const add = (host, username, selector) => {
    const key = `${host}|${username || ''}`;
    const cur = entries.get(key) || { host, selector: null, probeUser: username };
    if (selector) cur.selector = selector;
    entries.set(key, cur);
  };
  const r = git(['config', '--global', '--get-regexp', '^credential\\..+\\.username$'], { allowFail: true, cwd });
  if (r.ok && r.out) {
    for (const line of r.out.split('\n')) {
      const m = line.match(/^credential\.(https?:\/\/[^ ]+)\.username (.+)$/);
      if (!m) continue;
      add(m[1].replace(/^https?:\/\//, ''), m[2], m[2]);
    }
  }
  let hints = [];
  try { hints = loadStore().credentialHosts || []; } catch { /* 无档案时无线索 */ }
  for (const h of hints) {
    if (h && h.host && h.username) add(String(h.host), String(h.username), null);
  }
  const rows = [...entries.values()].sort(
    (a, b) => a.host.localeCompare(b.host) || String(a.probeUser).localeCompare(String(b.probeUser)),
  );
  for (const row of rows) {
    const p = credentialProbe(row.host, { username: row.probeUser, cwd });
    row.stored = p.stored;
    row.storedUsername = p.username;
  }
  return rows;
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
    const remotes = getRemotes(repo).map((x) => {
      // push 将用的凭据账号（生效选择器，含仓库本地覆盖）；仅 http(s) 远程有此语义
      const m = (x.url || '').match(/^https?:\/\/[^/?#]+/);
      return m ? { ...x, account: cfgGetEffective(`credential.${m[0]}.username`, { cwd: repo }) } : x;
    });
    return { path: repo, rel: path.relative(base, repo) || '.', local, effective, hasLocal, identityId, status, remotes };
  });
  const summary = {
    total: rows.length,
    withLocal: rows.filter((r) => r.hasLocal).length,
    missing: rows.filter((r) => r.status === 'missing').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
    mirrored: rows.filter((r) => r.remotes.some((x) => x.mirror)).length,
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
  getRemotes,
  setMirrorPush,
  clearMirrorPush,
  listUrlRewrites,
  parseCredBasis,
  hasCredentialHelper,
  credentialProbe,
  credentialStore,
  credentialErase,
  credentialLogin,
  credentialList,
  findRepos,
  scanRepos,
};
