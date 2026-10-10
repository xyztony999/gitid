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

class GitidError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'GitidError';
    this.code = code;
  }
}

const IDENTITY_KEYS = ['user.name', 'user.email', 'user.signingkey', 'commit.gpgsign', 'gpg.format'];
const GPG_FORMATS = new Set(['openpgp', 'ssh', 'x509']);
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
  if (fields.gpgFormat !== undefined && fields.gpgFormat !== null && fields.gpgFormat !== '') {
    const fmt = String(fields.gpgFormat).trim();
    if (!GPG_FORMATS.has(fmt)) throw new GitidError('签名格式只允许 openpgp / ssh / x509');
    it.gpgFormat = fmt;
  }
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

// ---------- 设置（与身份档案同存 config.json：扫描目录/深度 + 界面语言） ----------

const DEFAULT_SCAN_DEPTH = 6;
const SCAN_DEPTH_MAX = 12;
const LOCALES = new Set(['zh', 'en']);

// 归一化读取：旧档案无 settings 或字段缺失时返回默认值，不抛错
function getSettings(store) {
  const raw = store && store.settings && typeof store.settings === 'object' ? store.settings : {};
  return {
    scanRoot: typeof raw.scanRoot === 'string' ? raw.scanRoot : '',
    scanDepth: Number.isInteger(raw.scanDepth) && raw.scanDepth >= 1 ? raw.scanDepth : DEFAULT_SCAN_DEPTH,
    locale: LOCALES.has(raw.locale) ? raw.locale : 'zh',
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
  if (!LOCALES.has(next.locale)) throw new GitidError(`locale 只允许 zh / en：${next.locale}`);
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
    gpgFormat: cfgGet(scope, 'gpg.format', { cwd }),
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

// 全量覆盖语义：身份没有的键（signingkey/gpgsign/gpg.format/extra/insteadOf）会被 unset，
// 不残留上一身份的签名、格式与 URL 重写配置（ADR-003/016）
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
  if (it.gpgFormat) cfgSet(scope, 'gpg.format', it.gpgFormat, { cwd });
  else cfgUnset(scope, 'gpg.format', { cwd });
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
  record('gpg.format', it.gpgFormat || undefined);
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

// ---------- 扫描收编 / 批量本地应用 / 导出 / 审计 / 体检 / 补全 ----------

function identityIdFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return local && ID_PATTERN.test(local) ? local : 'imported';
}

function uniqueIdentityId(store, base) {
  if (!store.identities[base]) return base;
  let n = 2;
  while (store.identities[`${base}-${n}`]) n += 1;
  return `${base}-${n}`;
}

function readEffectiveIdentity(cwd) {
  return {
    name: cfgGetEffective('user.name', { cwd }),
    email: cfgGetEffective('user.email', { cwd }),
    signingkey: cfgGetEffective('user.signingkey', { cwd }) || '',
    gpgsign: cfgGetEffective('commit.gpgsign', { cwd }) === 'true',
    gpgFormat: cfgGetEffective('gpg.format', { cwd }) || '',
  };
}

function identitySig(it) {
  return `${it.signingkey || ''}\t${it.gpgFormat || ''}\t${it.gpgsign === true ? '1' : ''}`;
}

// 仅收编 status=unknown；同 name+email 已在库则跳过；id 撞车 -2 递增。
// asId 用于单条；多条时由调用方先拦截。dryRun 不写 Store。
function importScanUnknown(store, root, depth, { dryRun = false, asId } = {}) {
  const { rows } = scanRepos(store, root, depth);
  const unknowns = rows.filter((r) => r.status === 'unknown');
  if (asId && unknowns.length > 1) throw new GitidError('多条手配请去掉 --as 或先筛目录');

  const imported = [];
  const skipped = [];
  const warnings = [];
  const seen = new Set();

  for (const row of unknowns) {
    const name = row.effective.name;
    const email = row.effective.email;
    const pair = `${name}\t${email}`;
    const existingId = matchIdentity(store, name, email) || (seen.has(pair) ? imported.find((x) => `${x.name}\t${x.email}` === pair)?.id : null);
    const live = readEffectiveIdentity(row.path);

    if (existingId) {
      const prev = store.identities[existingId] || imported.find((x) => x.id === existingId);
      if (prev && identitySig(prev) !== identitySig(live)) {
        warnings.push({
          id: existingId,
          name,
          email,
          path: row.path,
          message: `同名邮不同签名，先到者胜（已保留 ${existingId}）`,
        });
      }
      skipped.push({ id: existingId, name, email, path: row.path, reason: 'already' });
      continue;
    }

    const id = asId || uniqueIdentityId(store, identityIdFromEmail(email));
    if (!dryRun) {
      upsertIdentity(store, id, {
        name,
        email,
        signingkey: live.signingkey,
        gpgsign: live.gpgsign || null,
        gpgFormat: live.gpgFormat,
      });
    }
    seen.add(pair);
    imported.push({ id, name, email, path: row.path, signingkey: live.signingkey, gpgFormat: live.gpgFormat });
  }

  return { imported, skipped, warnings };
}

function parseScanReposFrom(jsonText, { includeUnknown = false } = {}) {
  let data = jsonText;
  if (typeof jsonText === 'string') {
    try { data = JSON.parse(jsonText); } catch { throw new GitidError('文件不是 gitid scan --json 结构'); }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) {
    throw new GitidError('文件不是 gitid scan --json 结构');
  }
  const paths = [];
  for (const row of data.rows) {
    if (!row || typeof row !== 'object' || !row.path) continue;
    if (row.status === 'missing' || (includeUnknown && row.status === 'unknown')) {
      paths.push(String(row.path));
    }
  }
  return paths;
}

function applyIdentityLocalBatch(store, it, repos) {
  const results = [];
  for (const raw of repos) {
    const p = path.resolve(String(raw));
    const root = repoRoot(p);
    if (!root) {
      results.push({ path: p, ok: false, error: `不是 git 仓库：${p}` });
      continue;
    }
    try {
      const changes = applyIdentity(it, 'local', { cwd: root, store });
      results.push({ path: root, ok: true, changes });
    } catch (e) {
      results.push({ path: p, ok: false, error: e.message });
    }
  }
  return results;
}

function csvEscape(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatScanReport({ rows, summary }, format) {
  const fmt = String(format || '').toLowerCase();
  if (fmt === 'json') return JSON.stringify({ rows, summary }, null, 2) + '\n';
  if (fmt === 'csv') {
    const header = 'status,identityId,hasLocal,name,email,remotes,path';
    const lines = (rows || []).map((r) => {
      const remotes = (r.remotes || []).map((x) => x.name + (x.mirror ? '⊕' : '')).join(' ');
      return [
        r.status,
        r.identityId || '',
        r.hasLocal,
        (r.effective && r.effective.name) || '',
        (r.effective && r.effective.email) || '',
        remotes,
        r.path,
      ].map(csvEscape).join(',');
    });
    return [header, ...lines].join('\n') + '\n';
  }
  if (fmt === 'markdown') {
    const lines = [
      '| status | identity | hasLocal | name | email | remotes | path |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const r of rows || []) {
      const remotes = (r.remotes || []).map((x) => x.name + (x.mirror ? '⊕' : '')).join(' ') || '—';
      const cells = [
        r.status,
        r.identityId || (r.hasLocal ? '手配' : '继承'),
        r.hasLocal ? 'yes' : 'no',
        (r.effective && r.effective.name) || '',
        (r.effective && r.effective.email) || '',
        remotes,
        r.rel || r.path,
      ].map((c) => String(c).replace(/\|/g, '\\|'));
      lines.push(`| ${cells.join(' | ')} |`);
    }
    const s = summary || {};
    lines.push('');
    lines.push(`共 ${s.total || 0} 个仓库：${s.withLocal || 0} 个本地覆盖 · ${s.missing || 0} 个配置缺失 · ${s.unknown || 0} 个未匹配已存身份${s.mirrored ? ` · ${s.mirrored} 个镜像推送` : ''}`);
    return lines.join('\n') + '\n';
  }
  throw new GitidError('导出格式只允许 json / markdown / csv');
}

function buildMailmapSuggestion(authors, expect) {
  if (!authors.length) return '';
  const lines = [];
  if (expect) {
    lines.push(`${expect.name} <${expect.email}>`);
    for (const a of authors) {
      if (a.name !== expect.name || a.email !== expect.email) {
        lines.push(`${expect.name} <${expect.email}> ${a.name} <${a.email}>`);
      }
    }
    return lines.join('\n');
  }
  const byEmail = new Map();
  for (const a of authors) {
    if (!byEmail.has(a.email)) byEmail.set(a.email, []);
    byEmail.get(a.email).push(a);
  }
  for (const [email, group] of byEmail) {
    const canonical = [...group].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
    lines.push(`${canonical.name} <${email}>`);
    for (const a of group) {
      if (a.name !== canonical.name) lines.push(`${canonical.name} <${email}> ${a.name} <${email}>`);
    }
  }
  return lines.join('\n');
}

function auditRepo(store, repoPath, { expectId } = {}) {
  const root = repoRoot(repoPath || process.cwd());
  if (!root) throw new GitidError(`不是 git 仓库：${repoPath || process.cwd()}`);
  let expect = null;
  if (expectId) expect = getIdentity(store, expectId);

  const r = git(['log', '--all', '--format=%aN%x09%aE'], { allowFail: true, cwd: root });
  if (!r.ok) {
    const err = `${r.err} ${r.out}`.toLowerCase();
    const empty = /does not have any commits|no commits yet|bad default revision|unknown revision|ambiguous argument/.test(err)
      || (r.status === 128 && !r.out);
    if (!empty) throw new GitidError(`git log 失败：${r.err || r.out || '未知错误'}`, 2);
  }

  const counts = new Map();
  if (r.ok && r.out) {
    for (const line of r.out.split('\n')) {
      if (!line) continue;
      const tab = line.indexOf('\t');
      const name = tab >= 0 ? line.slice(0, tab) : line;
      const email = tab >= 0 ? line.slice(tab + 1) : '';
      const key = `${name}\t${email}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const authors = [...counts.entries()].map(([key, count]) => {
    const tab = key.indexOf('\t');
    const name = key.slice(0, tab);
    const email = key.slice(tab + 1);
    const matchId = matchIdentity(store, name, email);
    const polluted = expect ? email !== expect.email : null;
    return { name, email, count, matchId, polluted };
  }).sort((a, b) => b.count - a.count || a.email.localeCompare(b.email) || a.name.localeCompare(b.name));

  return {
    repo: root,
    authors,
    mailmapSuggestion: buildMailmapSuggestion(authors, expect),
    expectId: expectId || null,
  };
}

function hostFromGitUrl(url) {
  const s = String(url || '');
  let m = s.match(/^https?:\/\/([^/:]+)/i);
  if (m) return m[1].toLowerCase();
  m = s.match(/^git@([^:]+):/i);
  if (m) return m[1].toLowerCase();
  m = s.match(/^ssh:\/\/(?:[^@/]+@)?([^/:]+)/i);
  if (m) return m[1].toLowerCase();
  return '';
}

function parseSshConfig(text) {
  const hosts = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(Host|HostName|Hostname)\s+(\S+)/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'host') {
      if (val === '*') { current = null; continue; }
      current = { host: val, hostName: null };
      hosts.push(current);
    } else if (current) {
      current.hostName = val;
    }
  }
  return hosts;
}

function collectInsteadOfPairs(store) {
  const pairs = [];
  for (const w of listUrlRewrites()) pairs.push({ original: w.original, url: w.url, source: 'git' });
  for (const [id, it] of Object.entries((store && store.identities) || {})) {
    for (const p of it.insteadOf || []) pairs.push({ original: p.original, url: p.url, source: `identity:${id}` });
  }
  return pairs;
}

function checkInsteadOfConflicts(store) {
  const groups = [];
  const gitPairs = listUrlRewrites().map((w) => ({ original: w.original, url: w.url, source: 'git' }));
  groups.push(gitPairs);
  for (const [id, it] of Object.entries((store && store.identities) || {})) {
    groups.push((it.insteadOf || []).map((p) => ({ original: p.original, url: p.url, source: `identity:${id}` })));
  }
  const applied = store ? readApplied('global', store) : null;
  const appliedIt = applied && applied.identityId ? store.identities[applied.identityId] : null;
  if (appliedIt && gitPairs.length) {
    groups.push([
      ...gitPairs,
      ...(appliedIt.insteadOf || []).map((p) => ({ original: p.original, url: p.url, source: `identity:${applied.identityId}` })),
    ]);
  }
  const conflicts = [];
  const seen = new Set();
  for (const pairs of groups) {
    const byOriginal = new Map();
    for (const p of pairs) {
      if (!byOriginal.has(p.original)) byOriginal.set(p.original, []);
      byOriginal.get(p.original).push(p);
    }
    for (const [original, entries] of byOriginal) {
      const urls = new Set(entries.map((e) => e.url));
      if (urls.size > 1 && !seen.has(original)) {
        seen.add(original);
        conflicts.push({ original, entries });
      }
    }
  }
  return conflicts;
}

function checkSshInsteadOf(store) {
  const sshPath = path.join(os.homedir(), '.ssh', 'config');
  let sshText = '';
  try { sshText = fs.readFileSync(sshPath, 'utf8'); } catch { /* 无配置 */ }
  const sshHosts = parseSshConfig(sshText);
  const pairs = collectInsteadOfPairs(store);
  const sshNames = new Set();
  for (const h of sshHosts) {
    sshNames.add(h.host.toLowerCase());
    if (h.hostName) sshNames.add(h.hostName.toLowerCase());
  }
  const sshStyle = pairs.filter((p) => /^(git@|ssh:\/\/)/i.test(p.url));
  if (!sshHosts.length && !sshStyle.length) {
    return { level: 'ok', message: '无 SSH 别名与 insteadOf 可对照' };
  }
  if (sshStyle.length) {
    const missing = sshStyle.filter((p) => {
      const host = hostFromGitUrl(p.url);
      return host && !sshNames.has(host);
    });
    if (missing.length && !sshHosts.length) {
      return { level: 'warn', message: '存在 SSH 形式的 insteadOf，但未找到 ~/.ssh/config', detail: missing.map((p) => p.url).join(', ') };
    }
    if (missing.length) {
      return { level: 'warn', message: 'SSH Host 与 insteadOf 未完全对齐', detail: missing.map((p) => `${p.original}→${p.url}`).join(', ') };
    }
    return { level: 'ok', message: 'SSH Host 与 insteadOf 可对应' };
  }
  if (sshHosts.length && pairs.length) {
    const rewriteHosts = pairs.map((p) => hostFromGitUrl(p.original) || hostFromGitUrl(p.url)).filter(Boolean);
    const overlap = rewriteHosts.some((h) => sshNames.has(h));
    if (!overlap) return { level: 'warn', message: 'SSH Host 与 insteadOf 主机对不上' };
  }
  return { level: 'ok', message: sshHosts.length ? 'SSH 配置无需与 insteadOf 对照' : '无 SSH 形式的 insteadOf' };
}

function runDoctor(store) {
  const checks = [];
  let gitVersion = null;
  const ver = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (ver.error || ver.status !== 0) {
    checks.push({ id: 'git-version', level: 'fail', message: '未找到 git 命令，请先安装 git', detail: (ver.stderr || '').trim() });
  } else {
    gitVersion = (ver.stdout || '').trim();
    checks.push({ id: 'git-version', level: 'ok', message: gitVersion, detail: gitVersion });
  }

  let helper = null;
  const helperR = git(['config', '--get', 'credential.helper'], { allowFail: true });
  if (!helperR.ok || !helperR.out) {
    checks.push({ id: 'credential-helper', level: 'fail', message: '未配置 credential.helper', detail: null });
  } else {
    helper = helperR.out;
    checks.push({ id: 'credential-helper', level: 'ok', message: `已配置 ${helper}`, detail: helper });
  }

  const ssh = checkSshInsteadOf(store);
  checks.push({ id: 'ssh-insteadof', level: ssh.level, message: ssh.message, detail: ssh.detail || null });

  const conflicts = checkInsteadOfConflicts(store);
  if (conflicts.length) {
    const detail = conflicts.map((c) => `${c.original} → ${[...new Set(c.entries.map((e) => e.url))].join(' / ')}`).join('; ');
    checks.push({ id: 'insteadof-conflict', level: 'fail', message: '同一 original 映射到不同 url，或全局与档案规则互相覆盖', detail });
  } else {
    checks.push({ id: 'insteadof-conflict', level: 'ok', message: 'insteadOf 规则无冲突', detail: null });
  }

  return { checks, gitVersion, helper };
}

const COMPLETION_SHELLS = new Set(['bash', 'zsh', 'fish', 'pwsh']);

function completionScript(shell) {
  const name = String(shell || '').toLowerCase();
  if (!COMPLETION_SHELLS.has(name)) throw new GitidError(`未知 shell：${shell}。支持 bash / zsh / fish / pwsh`);
  if (name === 'bash') {
    return `# gitid bash 补全
_gitid() {
  local cur prev cmd
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmd="\${COMP_WORDS[1]}"
  local cmds="add list ls use local current cur unset remove rm import scan remote credential audit doctor completion help version"
  local global="--config --no-color --help --version -h -v"
  if [[ \$COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\$cmds \$global" -- "\$cur") )
    return
  fi
  case "\$prev" in
    --format) COMPREPLY=( $(compgen -W "openpgp ssh x509 json markdown csv" -- "\$cur") ); return ;;
    --repos|--repos-from|--output|--config|--scan) COMPREPLY=( $(compgen -f -- "\$cur") ); return ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish pwsh" -- "\$cur") ); return ;;
  esac
  case "\$cmd" in
    add) COMPREPLY=( $(compgen -W "--name --email --signingkey --gpgsign --format --set --insteadOf --account \$global" -- "\$cur") ) ;;
    use|local) COMPREPLY=( $(compgen -W "--local --repos --repos-from --include-unknown \$global" -- "\$cur") ) ;;
    import) COMPREPLY=( $(compgen -W "--as --scan --depth --dry-run \$global" -- "\$cur") ) ;;
    scan) COMPREPLY=( $(compgen -W "--depth --save --json --format --output \$global" -- "\$cur") ) ;;
    audit) COMPREPLY=( $(compgen -W "--expect --json \$global" -- "\$cur") ) ;;
    doctor) COMPREPLY=( $(compgen -W "--json \$global" -- "\$cur") ) ;;
    unset) COMPREPLY=( $(compgen -W "--local --global \$global" -- "\$cur") ) ;;
    remote) COMPREPLY=( $(compgen -W "list mirror unmirror --remote \$global" -- "\$cur") ) ;;
    credential) COMPREPLY=( $(compgen -W "list login set remove --token-stdin \$global" -- "\$cur") ) ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish pwsh" -- "\$cur") ) ;;
    *) COMPREPLY=( $(compgen -W "\$global" -- "\$cur") ) ;;
  esac
}
complete -F _gitid gitid
complete -F _gitid git-id
`;
  }
  if (name === 'zsh') {
    return `#compdef gitid git-id
_gitid() {
  local -a cmds
  cmds=(
    'add:新增/更新身份'
    'list:列出身份'
    'use:应用身份'
    'local:本地应用身份'
    'current:查看生效身份'
    'unset:清除身份键'
    'remove:删除档案'
    'import:导入/收编'
    'scan:扫描仓库'
    'remote:远程镜像'
    'credential:凭据管道'
    'audit:提交历史审计'
    'doctor:环境体检'
    'completion:打印补全脚本'
    'help:帮助'
    'version:版本'
  )
  if (( CURRENT == 2 )); then
    _describe 'command' cmds
    return
  fi
  case \$words[2] in
    add) _arguments '--name[姓名]' '--email[邮箱]' '--signingkey[签名键]' '--gpgsign' '--format[签名格式]:fmt:(openpgp ssh x509)' '--set[自定义键]' '--insteadOf[URL重写]' '--account[凭据选择器]' ;;
    use|local) _arguments '--local' '--repos[仓库路径]:path:_files -/' '--repos-from[scan JSON]:file:_files' '--include-unknown' ;;
    import) _arguments '--as[id]' '--scan[扫描收编]:dir:_files -/' '--depth[深度]' '--dry-run' ;;
    scan) _arguments '--depth[深度]' '--save' '--json' '--format[导出格式]:fmt:(json markdown csv)' '--output[文件]:file:_files' ;;
    audit) _arguments '--expect[档案 id]' '--json' ;;
    doctor) _arguments '--json' ;;
    completion) _arguments '1:shell:(bash zsh fish pwsh)' ;;
  esac
}
_gitid
`;
  }
  if (name === 'fish') {
    return `# gitid fish 补全
complete -c gitid -f
complete -c git-id -f
set -l gitid_cmds add list ls use local current cur unset remove rm import scan remote credential audit doctor completion help version
for c in add list ls use local current cur unset remove rm import scan remote credential audit doctor completion help version
  complete -c gitid -n "not __fish_seen_subcommand_from \$gitid_cmds" -a \$c
  complete -c git-id -n "not __fish_seen_subcommand_from \$gitid_cmds" -a \$c
end
complete -c gitid -n "__fish_seen_subcommand_from add" -l name -l email -l signingkey -l gpgsign -l format -l set -l insteadOf -l account
complete -c gitid -n "__fish_seen_subcommand_from use local" -l local -l repos -l repos-from -l include-unknown
complete -c gitid -n "__fish_seen_subcommand_from import" -l as -l scan -l depth -l dry-run
complete -c gitid -n "__fish_seen_subcommand_from scan" -l depth -l save -l json -l format -l output
complete -c gitid -n "__fish_seen_subcommand_from audit" -l expect -l json
complete -c gitid -n "__fish_seen_subcommand_from doctor" -l json
complete -c gitid -n "__fish_seen_subcommand_from unset" -l local -l global
complete -c gitid -n "__fish_seen_subcommand_from completion" -a "bash zsh fish pwsh"
complete -c gitid -l config -l no-color -s h -l help -s v -l version
`;
  }
  return `# gitid PowerShell 补全
Register-ArgumentCompleter -Native -CommandName gitid, git-id -ScriptBlock {
  param(\$wordToComplete, \$commandAst, \$cursorPosition)
  \$cmds = @('add','list','ls','use','local','current','cur','unset','remove','rm','import','scan','remote','credential','audit','doctor','completion','help','version')
  \$tokens = \$commandAst.ToString().Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
  if (\$tokens.Count -le 1) { \$cmds | Where-Object { \$_ -like "\$wordToComplete*" } | ForEach-Object { \$_ } ; return }
  \$cmd = \$tokens[1]
  \$opts = switch (\$cmd) {
    'add' { @('--name','--email','--signingkey','--gpgsign','--format','--set','--insteadOf','--account') }
    { \$_ -in 'use','local' } { @('--local','--repos','--repos-from','--include-unknown') }
    'import' { @('--as','--scan','--depth','--dry-run') }
    'scan' { @('--depth','--save','--json','--format','--output') }
    'audit' { @('--expect','--json') }
    'doctor' { @('--json') }
    'unset' { @('--local','--global') }
    'completion' { @('bash','zsh','fish','pwsh') }
    default { @('--config','--no-color','--help','--version') }
  }
  \$opts | Where-Object { \$_ -like "\$wordToComplete*" }
}
`;
}

module.exports = {
  GitidError,
  IDENTITY_KEYS,
  GPG_FORMATS,
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
  identityIdFromEmail,
  uniqueIdentityId,
  importScanUnknown,
  parseScanReposFrom,
  applyIdentityLocalBatch,
  formatScanReport,
  auditRepo,
  runDoctor,
  completionScript,
};
