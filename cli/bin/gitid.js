#!/usr/bin/env node
'use strict';

/**
 * gitid CLI — Git 多身份管理器命令行入口。
 * 核心逻辑在 ../lib/core.js（与桌面端共用），本文件只负责交互与展示。
 */

const fs = require('node:fs');
const readline = require('node:readline/promises');
const core = require('../lib/core.js');

const {
  GitidError,
  ID_PATTERN,
  configPath,
  loadStore,
  saveStore,
  getIdentity,
  repoRoot,
  repoBranch,
  readApplied,
  applyIdentity,
  unsetIdentity,
  scanRepos,
} = core;

const VERSION = require('../package.json').version;
const PROGRAM = 'gitid';
const FLAG_WITH_VALUE = new Set([
  'name', 'email', 'signingkey', 'set', 'config', 'depth', 'as', 'insteadOf', 'remote', 'account',
  'format', 'repos', 'repos-from', 'output', 'expect', 'scan',
]);

// ---------- 输出与颜色 ----------

const state = { color: null, noColorByFlag: false };

function useColor() {
  if (state.color === null) {
    state.color = process.stdout.isTTY && !process.env.NO_COLOR && !state.noColorByFlag;
  }
  return state.color;
}

function paint(str, code) {
  return useColor() ? `\x1b[${code}m${str}\x1b[0m` : str;
}
const bold = (s) => paint(s, '1');
const dim = (s) => paint(s, '2');
const red = (s) => paint(s, '31');
const green = (s) => paint(s, '32');
const yellow = (s) => paint(s, '33');
const cyan = (s) => paint(s, '36');

function info(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write(red(`✗ ${msg}`) + '\n'); }
function die(msg, code = 1) { throw new GitidError(msg, code); }

// ---------- 显示宽度（CJK 双宽对齐） ----------

function displayWidth(str) {
  const plain = String(str).replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) {
    const c = ch.codePointAt(0);
    const cjk =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd);
    w += cjk ? 2 : 1;
  }
  return w;
}

function pad(str, n) {
  return str + ' '.repeat(Math.max(0, n - displayWidth(str)));
}

function printTable(rows, { indent = '  ' } = {}) {
  const cols = rows[0].length;
  const widths = new Array(cols).fill(0);
  for (const row of rows) {
    row.forEach((cell, i) => { widths[i] = Math.max(widths[i], displayWidth(cell)); });
  }
  for (const [idx, row] of rows.entries()) {
    const line = row.map((cell, i) => pad(cell, widths[i])).join('  ');
    info(indent + (idx === 0 ? dim(line.trimEnd()) : line.trimEnd()));
  }
}

// ---------- 交互 ----------

async function prompt(label, fallback) {
  if (!process.stdin.isTTY) die(`${label}未提供且当前非交互环境，请通过参数指定`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = fallback ? dim(`（${fallback}）`) : '';
  let answer;
  try {
    answer = (await rl.question(`${label}${suffix}: `)).trim();
  } finally {
    rl.close();
  }
  return answer || fallback || undefined;
}

// ---------- 命令实现 ----------

async function cmdAdd({ positional, flags }) {
  const [id] = positional;
  if (!id) die('用法：gitid add <id> --name <姓名> --email <邮箱> [--signingkey <key>] [--gpgsign] [--format openpgp|ssh|x509] [--set k=v]');
  if (!ID_PATTERN.test(id)) die(`身份 id 只允许字母数字与 . _ - ，且以字母数字开头：「${id}」不合法`);

  const store = loadStore(flags.config && flags.config !== true ? flags.config : undefined);
  const exists = store.identities[id];
  const name = flags.name || (await prompt('姓名', exists && exists.name));
  const email = flags.email || (await prompt('邮箱', exists && exists.email));

  const signingkey = flags.signingkey && flags.signingkey !== true ? String(flags.signingkey) : (exists && exists.signingkey) || '';
  const gpgsign = flags.gpgsign === true ? true : null;
  // insteadOf：给出则整体替换；未给出时编辑场景保留既有（与 signingkey 同策略）
  let insteadOf;
  const ioFlags = flags.insteadOf === undefined ? null : (Array.isArray(flags.insteadOf) ? flags.insteadOf : [flags.insteadOf]);
  if (ioFlags === null) insteadOf = (exists && exists.insteadOf) || [];
  else {
    insteadOf = [];
    for (const s of ioFlags) {
      const eq = String(s).indexOf('=');
      if (eq <= 0) die(`--insteadOf 格式应为 原始地址=替换地址：${s}`);
      insteadOf.push({ original: String(s).slice(0, eq), url: String(s).slice(eq + 1) });
    }
  }
  // accounts：凭据账号选择器 host=用户名（GCM 按 username 取凭据，token 不入档案）
  let accounts;
  const acFlags = flags.account === undefined ? null : (Array.isArray(flags.account) ? flags.account : [flags.account]);
  if (acFlags === null) accounts = (exists && exists.accounts) || [];
  else {
    accounts = [];
    for (const s of acFlags) {
      const eq = String(s).indexOf('=');
      if (eq <= 0) die(`--account 格式应为 host=用户名：${s}`);
      accounts.push({ host: String(s).slice(0, eq), username: String(s).slice(eq + 1) });
    }
  }
  const extra = {};
  const sets = Array.isArray(flags.set) ? flags.set : flags.set ? [flags.set] : [];
  for (const s of sets) {
    const eq = s.indexOf('=');
    if (eq <= 0) die(`--set 格式应为 key=value：${s}`);
    const [k, v] = [s.slice(0, eq), s.slice(eq + 1)];
    if (!v) die(`--set ${k} 的值不能为空（如需删除键请手动 git config --unset）`);
    extra[k] = v;
  }
  let gpgFormat;
  if (flags.format === true) die('用法：gitid add <id> ... --format openpgp|ssh|x509');
  if (flags.format) gpgFormat = String(flags.format);
  else if (exists && exists.gpgFormat) gpgFormat = exists.gpgFormat;

  const store2 = core.upsertIdentity(store, id, { name, email, signingkey, gpgsign, gpgFormat, insteadOf, accounts, extra }).store;
  saveStore(store2, flags.config && flags.config !== true ? flags.config : undefined);
  const saved = store2.identities[id];
  info(`${exists ? '已更新' : '已新增'}身份 ${bold(id)} —— ${name} <${email}>${signingkey ? cyan(` [签名 ${signingkey}]`) : ''}${saved && saved.gpgFormat ? cyan(` [格式 ${saved.gpgFormat}]`) : ''}${insteadOf.length ? cyan(` [URL重写 ×${insteadOf.length}]`) : ''}${accounts.length ? cyan(` [凭据账号 ×${accounts.length}]`) : ''}`);
  info(dim(`应用：gitid use ${id}（全局） 或 gitid use ${id} --local（仅当前仓库）`));
}

async function cmdList() {
  const store = loadStore();
  const ids = Object.keys(store.identities);
  if (!ids.length) {
    info('尚无身份档案。快速开始：');
    info(`  ${dim('·')} gitid import                # 导入当前全局 git 配置为第一个身份`);
    info(`  ${dim('·')} gitid add work --name 张三 --email zhang@corp.com`);
    return;
  }
  const g = readApplied('global', store);
  const root = repoRoot();
  const l = root ? readApplied('local', store, { cwd: root }) : null;

  const rows = [['', 'ID', '姓名', '邮箱', '签名键']];
  for (const [id, it] of Object.entries(store.identities)) {
    const marks = [g.identityId === id ? yellow('★') : ' ', l && l.identityId === id ? cyan('◆') : ' '].join('');
    rows.push([marks, id, it.name, it.email, it.signingkey || dim('—')]);
  }
  printTable(rows, { indent: '' });
  const legend = [`  ${yellow('★')} = 当前全局生效`];
  if (root) legend.push(`${cyan('◆')} = 当前仓库本地覆盖`);
  info(dim(legend.join('    ')));
}

function printChanges(changes) {
  for (const ch of changes) {
    const mark = /^url\..+\.insteadOf$/i.test(ch.key) ? yellow(' [URL重写]') : '';
    info(green(`  ${dim(ch.key)}: ${ch.from === undefined ? dim('（未设置）') : ch.from} → ${ch.to === undefined ? dim('（已清除）') : ch.to}${mark}`));
  }
  if (!changes.length) info(dim('（配置无变化）'));
}

async function cmdUse({ positional, flags }) {
  const [id] = positional;
  if (!id) die('用法：gitid use <id> [--local] [--repos <路径>…] [--repos-from <文件|->]');
  const store = loadStore();
  const it = getIdentity(store, id);

  const repoFlags = flags.repos === undefined ? [] : [].concat(flags.repos);
  const fromFile = flags['repos-from'];
  const batch = repoFlags.length > 0 || fromFile;

  if (batch) {
    if (repoFlags.some((p) => p === true) && repoFlags.every((p) => p === true) && !fromFile) {
      die('用法：gitid use <id> --repos <路径>…');
    }
    let paths = repoFlags.filter((p) => p && p !== true).map(String);
    if (fromFile) {
      let raw;
      if (fromFile === '-' || fromFile === true) raw = await readAllStdin();
      else {
        try { raw = fs.readFileSync(String(fromFile), 'utf8'); } catch (e) {
          die(`无法读取 ${fromFile}：${e.message}`, 2);
        }
      }
      paths = paths.concat(core.parseScanReposFrom(raw, { includeUnknown: !!flags['include-unknown'] }));
    }
    if (!paths.length) {
      info(dim('没有符合条件的仓库'));
      return;
    }
    const results = core.applyIdentityLocalBatch(store, it, paths);
    for (const r of results) {
      if (r.ok) {
        info(`已将身份 ${bold(id)} —— ${it.name} <${it.email}> 应用于${bold('本地')}（${r.path}）`);
        printChanges(r.changes);
      } else {
        fail(r.error);
      }
    }
    if (results.some((x) => !x.ok)) process.exitCode = 2;
    return;
  }

  const scope = flags.local ? 'local' : 'global';
  if (scope === 'local' && !repoRoot()) die('当前目录不在 git 仓库内（该操作需要 --local 作用域的仓库上下文）');

  const changes = applyIdentity(it, scope, { store });
  const where = scope === 'local' ? `${bold('当前仓库')}（${repoRoot()}）` : bold('全局');
  info(`已将身份 ${bold(id)} —— ${it.name} <${it.email}> 应用于${where}`);
  printChanges(changes);

  if (scope === 'global') {
    const root = repoRoot();
    if (root) {
      const l = readApplied('local', store, { cwd: root });
      if (l.name !== undefined || l.email !== undefined) {
        info(yellow(`注意：当前仓库存在本地身份覆盖（${l.name || '?'} <${l.email || '?'}>），全局切换不影响该仓库`));
      }
    }
  }
}

async function cmdLocal(args) {
  return cmdUse({ positional: args.positional, flags: { ...args.flags, local: true } });
}

async function cmdCurrent() {
  const store = loadStore();
  const root = repoRoot();
  const l = root ? readApplied('local', store, { cwd: root }) : null;
  const g = readApplied('global', store);
  const eff = {
    name: core.cfgGetEffective('user.name'),
    email: core.cfgGetEffective('user.email'),
    signingkey: core.cfgGetEffective('user.signingkey'),
    gpgFormat: core.cfgGetEffective('gpg.format'),
  };
  const effId = core.matchIdentity(store, eff.name, eff.email);
  const hasLocal = l && (l.name !== undefined || l.email !== undefined);

  if (root) info(`${dim('仓库')}   ${root}${repoBranch() ? dim(`（${repoBranch()}）`) : ''}`);
  else info(`${dim('目录')}   ${process.cwd()}${dim('（非 git 仓库，仅展示全局身份）')}`);

  if (effId) {
    const tag = hasLocal ? yellow('本地覆盖') : '继承全局';
    info(`${dim('生效')}   ${bold(effId)} —— ${eff.name} <${eff.email}> ${dim(`[${tag}]`)}`);
  } else if (eff.name !== undefined || eff.email !== undefined) {
    info(`${dim('生效')}   ${eff.name || '?'} <${eff.email || '?'}> ${yellow('[未匹配到已存身份，可能为手动配置]')}`);
    info(dim('        可运行 gitid import 将其保存为身份档案'));
  } else {
    info(`${dim('生效')}   ${red('未配置 user.name / user.email')}`);
    info(dim('        先 gitid add <id> --name ... --email ...，再 gitid use <id>'));
  }

  const src = (key) => {
    if (hasLocal && l[key] !== undefined) return '← 本地';
    if (g[key] !== undefined) return '← 全局';
    return dim('未设置');
  };
  const rows = [
    [dim('  user.name'), eff.name ?? dim('—'), src('name')],
    [dim('  user.email'), eff.email ?? dim('—'), src('email')],
  ];
  if (eff.signingkey !== undefined || (hasLocal && l.signingkey !== undefined)) {
    rows.push([dim('  user.signingkey'), eff.signingkey ?? dim('—'), src('signingkey')]);
  }
  if (eff.gpgFormat !== undefined || (hasLocal && l.gpgFormat !== undefined)) {
    rows.push([dim('  gpg.format'), eff.gpgFormat ?? dim('—'), src('gpgFormat')]);
  }
  for (const r of rows) info(pad(r[0], 18) + pad(r[1], 34) + dim(r[2]));

  const rewrites = core.listUrlRewrites();
  if (rewrites.length) {
    info(`${dim('URL重写')}   ${dim('（insteadOf 生效值，本地覆盖合并全局）')}`);
    for (const w of rewrites) info(`  ${w.original} ${dim('→')} ${w.url}`);
  }

  const creds = core.credentialList();
  if (creds.length) {
    info(`${dim('凭据账号')}   ${dim('（选择器 → helper 实存；token 永不展示）')}`);
    for (const c of creds) {
      const live = c.stored ? green(c.storedUsername) : dim('未存储');
      info(`  ${c.host}  ${dim('选择器')} ${c.selector}  ${dim('helper')} ${live}`);
    }
  }

  if (root && hasLocal && g.identityId && g.identityId !== effId) {
    info(dim(`全局身份为 ${g.identityId}（${g.name} <${g.email}>），在本仓库被本地覆盖`));
  }
}

async function cmdUnset({ flags }) {
  const scope = flags.global ? 'global' : 'local';
  if (!flags.local && !flags.global && !repoRoot()) {
    die('当前目录不在 git 仓库内。清除全局请显式使用 gitid unset --global');
  }
  if (scope === 'local' && !repoRoot()) die('当前目录不在 git 仓库内（--local 需要仓库上下文）');
  const removed = unsetIdentity(scope, { store: loadStore() });
  const where = scope === 'local' ? `当前仓库${dim(`（${repoRoot()}）`)}` : '全局';
  if (removed.length) info(`已清除${where}的身份键：${removed.join('、')}`);
  else info(`${where}没有身份配置，无需清除`);
  if (scope === 'local') info(dim('该仓库此后继承全局身份（gitid current 可确认）'));
}

async function cmdRemove({ positional }) {
  const [id] = positional;
  if (!id) die('用法：gitid remove <id>');
  const store = loadStore();
  getIdentity(store, id);
  delete store.identities[id];
  saveStore(store);
  info(`已删除身份档案 ${bold(id)}${dim('（已写入 git 配置的值不受影响）')}`);
  const g = readApplied('global', store);
  if (g.name !== undefined && g.email && core.matchIdentity(store, g.name, g.email) === null) {
    info(yellow(`全局 git 配置仍指向 ${g.name} <${g.email}>，如需更换请 gitid use <其他身份>`));
  }
}

async function cmdImport({ flags }) {
  if (flags.scan) return cmdImportScan({ flags });

  const store = loadStore();
  const g = readApplied('global', store);
  if (g.name === undefined && g.email === undefined) {
    die('全局 git 尚未配置 user.name / user.email，无可导入；请先 gitid add 创建身份');
  }
  let id = flags.as && flags.as !== true ? String(flags.as) : null;
  if (!id) {
    const local = (g.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    id = local || 'default';
  }
  if (!ID_PATTERN.test(id)) die(`导入身份 id 不合法：「${id}」（可用 --as 指定）`);
  const exists = store.identities[id];
  store.identities[id] = {
    name: g.name,
    email: g.email,
    signingkey: g.signingkey || '',
    gpgsign: g.gpgsign === 'true' ? true : null,
  };
  saveStore(store);
  info(`已${exists ? '更新' : '导入'}身份 ${bold(id)} —— ${g.name} <${g.email}>${g.signingkey ? cyan(` [签名 ${g.signingkey}]`) : ''}`);
  info(dim('此后可用 gitid add 新增其他身份，用 gitid use 一键切换'));
}

function cmdImportScan({ flags }) {
  const store = loadStore();
  const settings = core.getSettings(store);
  const root = flags.scan !== true ? String(flags.scan) : (settings.scanRoot || '.');
  const depth = Number(flags.depth && flags.depth !== true ? flags.depth : settings.scanDepth);
  const asId = flags.as && flags.as !== true ? String(flags.as) : undefined;
  const dryRun = !!flags['dry-run'];
  const result = core.importScanUnknown(store, root, depth, { dryRun, asId });
  if (!dryRun && result.imported.length) saveStore(store);

  if (!result.imported.length && !result.skipped.length) {
    info(`没有可收编的手配（status=unknown）${dryRun ? dim('（演练）') : ''}`);
    return;
  }
  const table = [['动作', 'ID', '姓名', '邮箱', '来源仓库']];
  for (const x of result.imported) {
    table.push([dryRun ? yellow('将新增') : green('新增'), x.id, x.name, x.email, x.path]);
  }
  for (const x of result.skipped) {
    table.push([dim('跳过'), x.id, x.name, x.email, x.path]);
  }
  for (const w of result.warnings) {
    table.push([yellow('冲突警告'), w.id, w.name, w.email, w.path]);
  }
  printTable(table, { indent: '' });
  if (result.warnings.length) {
    for (const w of result.warnings) info(yellow(`  ${w.message}`));
  }
  info(dim(`${dryRun ? '演练：将' : '已'}收编 ${result.imported.length} 条 · 跳过 ${result.skipped.length} 条`));
}

async function cmdScan({ positional, flags }) {
  const store = loadStore();
  const settings = core.getSettings(store);
  const rootArg = positional[0]; // ~ / ~/x 的展开在 core.scanRepos 内统一处理
  const depth = Number(flags.depth && flags.depth !== true ? flags.depth : settings.scanDepth);

  if (flags.save) {
    if (!rootArg) die('用法：gitid scan <目录> --save（--save 需要目录参数，目录与 --depth 一并存为默认）');
    core.saveSettings(store, { scanRoot: rootArg, scanDepth: depth });
    saveStore(store);
    info(`已保存默认扫描目录 ${bold(rootArg)}（深度 ${depth}），此后 ${PROGRAM} scan 不带参数即用它`);
  }

  const root = rootArg || settings.scanRoot || '.';
  if (!rootArg && settings.scanRoot && !flags.json && !flags.format) {
    info(dim(`使用默认扫描目录 ${settings.scanRoot}（指定目录可覆盖，scan --save 可更改）`));
  }
  const { rows, summary } = scanRepos(store, root, depth);
  const format = flags.json ? 'json' : (flags.format && flags.format !== true ? String(flags.format) : null);
  if (format) {
    const text = core.formatScanReport({ rows, summary }, format);
    if (flags.output && flags.output !== true) {
      try { fs.writeFileSync(String(flags.output), text); } catch (e) {
        die(`无法写入 ${flags.output}：${e.message}`, 2);
      }
      info(`已导出 ${format} → ${flags.output}`);
    } else {
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    }
    return;
  }
  if (!rows.length) { info(`在 ${root} 下未发现 git 仓库（深度 ${depth}）`); return; }

  const statusMark = { ok: green('✓'), missing: red('✗'), unknown: yellow('⚠') };
  const table = [['状态', '身份', '远程', '生效配置', '仓库']];
  for (const r of rows) {
    const label = r.identityId
      ? (r.hasLocal ? cyan(`${r.identityId} ◆`) : r.identityId)
      : r.hasLocal ? cyan('本地手配 ◆') : dim('继承全局');
    const remotes = r.remotes.length
      ? r.remotes.map((x) => {
          const acc = x.account ? `@${x.account}` : '';
          return x.mirror ? cyan(`${x.name}${acc}⊕`) : `${x.name}${acc}`;
        }).join(' ')
      : dim('—');
    const eff = r.status === 'missing' ? red('缺失') : `${r.effective.name ?? '?'} <${r.effective.email ?? '?'}>`;
    table.push([statusMark[r.status], label, remotes, eff, r.rel]);
  }
  printTable(table, { indent: '' });
  info('');
  info(dim(`共 ${summary.total} 个仓库：${summary.withLocal} 个本地覆盖 · ${summary.missing} 个配置缺失${summary.unknown ? ` · ${summary.unknown} 个未匹配已存身份` : ''}${summary.mirrored ? ` · ${summary.mirrored} 个镜像推送` : ''}`));
  info(dim('状态：✓ 正常  ✗ 缺 user.name/user.email  ⚠ 生效值未匹配任何身份档案  ◆ 本地覆盖  ⊕ 镜像推送'));
}

// ---------- 远程镜像管理（当前仓库；凭据归 GCM/SSH，gitid 只写非密钥配置） ----------

async function cmdRemote({ positional, flags }) {
  const root = repoRoot();
  if (!root) die('当前目录不在 git 仓库内（gitid remote 管理当前仓库的远程与镜像推送）');
  const [action, url] = positional;
  const remoteName = flags.remote && flags.remote !== true ? String(flags.remote) : 'origin';

  if (!action || action === 'list') {
    const remotes = core.getRemotes(root);
    if (!remotes.length) { info('本仓库尚未配置远程（git remote add origin <url>）'); return; }
    const table = [['远程', 'fetch 地址', 'push 目标', '镜像']];
    for (const r of remotes) {
      const push = r.pushurls.length ? r.pushurls.join(' ; ') : (r.url || dim('—'));
      table.push([r.name, r.url || dim('—'), push, r.mirror ? cyan('⊕') : dim('—')]);
    }
    printTable(table, { indent: '' });
    info(dim('⊕ 镜像推送：git push 同时推全部 push 目标（gitid remote mirror 设置）'));
    return;
  }

  if (action === 'mirror') {
    if (!url) die('用法：gitid remote mirror <镜像地址> [--remote <name>]');
    const r = core.setMirrorPush(root, remoteName, url);
    info(`已开启 ${bold(remoteName)} 镜像推送，git push 将同时推：`);
    info(`  ${dim('·')} ${r.pushurls[0]}`);
    info(`  ${dim('·')} ${r.pushurls[1]} ${cyan('（镜像）')}`);
    info(dim('fetch 不受影响；取消：gitid remote unmirror；凭据仍由 GCM/SSH 管理'));
    return;
  }

  if (action === 'unmirror') {
    const r = core.clearMirrorPush(root, remoteName);
    if (r.removed) info(`已取消 ${bold(remoteName)} 镜像推送（清除 ${r.removed} 个 push 目标，push 回到 fetch 地址）`);
    else info(`${remoteName} 未配置镜像推送，无需取消`);
    return;
  }
  die(`未知子命令「${action}」。用法：gitid remote [list | mirror <url> | unmirror] [--remote <name>]`);
}

// ---------- 凭据管理（conduit：token 只经 stdin→helper，gitid 不留存） ----------

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

// 隐藏输入（terminal 模式下回显关闭）；非交互环境直接报错，由调用方改走 stdin 管道
function hiddenPrompt(label) {
  if (!process.stdin.isTTY) die(`${label}：当前非交互环境，请通过管道提供（echo <token> | gitid credential set …）`);
  return new Promise((resolve, reject) => {
    const realWrite = process.stdout.write.bind(process.stdout);
    let muted = false;
    process.stdout.write = (chunk, enc, cb) => {
      if (muted && typeof chunk === 'string' && chunk !== '\n' && !chunk.startsWith('\r')) {
        if (cb && typeof cb === 'function') cb();
        return true;
      }
      return realWrite(chunk, enc, cb);
    };
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(`${label}: `, (answer) => {
      process.stdout.write = realWrite;
      rl.close();
      realWrite('\n');
      resolve(answer);
    });
    muted = true; // 问题文案已输出后静默
  });
}

async function cmdCredential({ positional, flags }) {
  const [action, host, username] = positional;

  if (!action || action === 'list') {
    let rows = core.credentialList();
    if (host) rows = rows.filter((r) => r.host === core.parseCredBasis(host).host);
    if (!rows.length) { info('尚无凭据线索：gitid credential login <host> 登录（GCM 弹窗），或 gitid add --account <host>=<用户名> 配置选择器'); return; }
    const table = [['host', '选择器 username', 'helper 实存', '']];
    for (const r of rows) {
      table.push([r.host, r.selector || dim('—（登录线索）'), r.stored ? green(r.storedUsername) : dim('未存储'), r.stored ? green('✓') : dim('—')]);
    }
    printTable(table, { indent: '' });
    info(dim('helper 实存经 git credential 协议只读探测（协议无枚举，按线索点名）；token 永不展示（ADR-017）'));
    return;
  }

  if (action === 'login') {
    if (!host) die('用法：gitid credential login <host> [username]（host 如 github.com，GCM 将弹自身登录窗口）');
    const r = core.credentialLogin(host, username && username !== '' ? username : undefined);
    info(`已登录 ${bold(r.host)} —— ${r.username}${cyan('（凭据存于 helper/钥匙串，gitid 不留存）')}`);
    return;
  }

  if (action === 'set') {
    if (!host || !username) die('用法：gitid credential set <host> <username>（token 经隐藏输入或 stdin 管道，不回显不留存）');
    if (!core.hasCredentialHelper()) {
      die('未配置 credential.helper，token 将无处保存。先执行：git config --global credential.helper manager');
    }
    let token;
    if (flags['token-stdin'] || !process.stdin.isTTY) {
      token = (await readAllStdin()).replace(/\r?\n$/, '');
    } else {
      token = await hiddenPrompt(`Token（${host} · ${username}，输入不回显）`);
    }
    const r = core.credentialStore(host, username, token);
    info(`已保存 ${bold(r.host)} —— ${r.username}${cyan('（凭据存于 helper/钥匙串，gitid 不留存）')}`);
    info(dim('同 host+username 再次 set 即覆盖（修改凭据）；移除：gitid credential remove'));
    return;
  }

  if (action === 'remove') {
    if (!host) die('用法：gitid credential remove <host> [username]');
    const r = core.credentialErase(host, username && username !== '' ? username : undefined);
    info(`已从 helper 删除凭据：${bold(r.host)}${r.username ? `（${r.username}）` : dim('（该 host 全部）')}`);
    return;
  }

  die(`未知子命令「${action}」。用法：gitid credential [list | login <host> | set <host> <username> | remove <host>]`);
}

async function cmdAudit({ positional, flags }) {
  const repo = positional[0] || process.cwd();
  const expectId = flags.expect && flags.expect !== true ? String(flags.expect) : undefined;
  const report = core.auditRepo(loadStore(), repo, { expectId });
  if (flags.json) {
    info(JSON.stringify(report, null, 2));
    return;
  }
  if (!report.authors.length) {
    info(`仓库 ${report.repo} 尚无提交`);
  } else {
    const table = [['count', 'name', 'email', '匹配档案', '污染?']];
    for (const a of report.authors) {
      table.push([
        String(a.count),
        a.name,
        a.email,
        a.matchId || dim('手配'),
        expectId ? (a.polluted ? yellow('是') : '否') : '',
      ]);
    }
    printTable(table, { indent: '' });
  }
  if (report.mailmapSuggestion) {
    info('');
    info(dim('mailmap 建议（只展示，不写入 .mailmap）'));
    info(report.mailmapSuggestion);
  }
}

async function cmdDoctor({ positional, flags }) {
  if (positional.length) die('用法：gitid doctor [--json]');
  const report = core.runDoctor(loadStore());
  if (flags.json) {
    info(JSON.stringify(report, null, 2));
  } else {
    const table = [['级别', '检查项', '说明']];
    for (const c of report.checks) {
      const level = c.level === 'fail' ? red('fail') : c.level === 'warn' ? yellow('warn') : green('ok');
      table.push([level, c.id, c.message]);
    }
    printTable(table, { indent: '' });
  }
  if (report.checks.some((c) => c.level === 'fail')) process.exitCode = 2;
}

function cmdCompletion({ positional }) {
  const [shell] = positional;
  if (!shell) die('用法：gitid completion <bash|zsh|fish|pwsh>');
  process.stdout.write(core.completionScript(shell));
}

// ---------- 帮助 ----------

function cmdHelp() {
  info(`${bold(PROGRAM)} v${VERSION} — Git 多身份管理器`);
  info('');
  info('管理多套 git 身份（user.name / user.email / 签名配置），应用于全局或单个仓库。');
  info('');
  info(bold('用法'));
  info(`  ${PROGRAM} add <id> --name <姓名> --email <邮箱> [--signingkey <key>] [--gpgsign] [--format openpgp|ssh|x509] [--set k=v]`);
  info(`      ${dim('新增/更新身份档案（重复 add 为覆盖更新；姓名邮箱缺省时交互询问）')}`);
  info(`      ${dim('--format 声明 gpg.format；省略则档案不带该字段，应用时 unset')}`);
  info(`      ${dim('--insteadOf 原始地址=替换地址 可重复：随身份切换 URL 重写（镜像加速/多账号协议），凭据归 GCM/SSH')}`);
  info(`      ${dim('--account host=用户名 可重复：凭据账号选择器（GCM 按 username 取凭据，token 不入档案）')}`);
  info(`  ${PROGRAM} list                ${dim('列出所有身份（★=当前全局 ◆=当前仓库本地覆盖）')}`);
  info(`  ${PROGRAM} use <id> [--local] [--repos <路径>…] [--repos-from <文件|->] [--include-unknown]`);
  info(`      ${dim('应用身份：默认写入全局，--local 仅当前仓库；--repos / --repos-from 强制逐仓本地写入')}`);
  info(`      ${dim('--repos-from 读 scan --json，默认只取 missing；--include-unknown 另含 unknown')}`);
  info(`  ${PROGRAM} local <id>          ${dim('等价于 use <id> --local（亦可带 --repos / --repos-from）')}`);
  info(`  ${PROGRAM} current             ${dim('查看当前目录生效身份与来源（本地覆盖 → 全局回退）')}`);
  info(`  ${PROGRAM} unset [--local|--global]`);
  info(`      ${dim('清除身份键（默认 --local，仅当前仓库；含 gpg.format）')}`);
  info(`  ${PROGRAM} remove <id>         ${dim('删除身份档案（不影响已写入的 git 配置）')}`);
  info(`  ${PROGRAM} import [--as <id>] [--scan [目录]] [--depth N] [--dry-run]`);
  info(`      ${dim('无 --scan：将现有全局 git 身份导入为档案')}`);
  info(`      ${dim('--scan：只收编 status=unknown 的手配；同名邮已在库则跳过；--dry-run 只打印')}`);
  info(`  ${PROGRAM} scan [目录] [--depth N] [--save] [--json] [--format json|markdown|csv] [--output <文件>]`);
  info(`      ${dim('扫描目录下所有 git 仓库，审计身份配置与远程镜像状态（默认深度 6，不深入仓库内部）')}`);
  info(`      ${dim('--save 把目录与深度存为默认；--json / --format 导出，--output 写入文件')}`);
  info(`  ${PROGRAM} audit [仓库] [--expect <id>] [--json]`);
  info(`      ${dim('只读聚合作者 name/email；--expect 把邮箱不等于该身份的作者标为污染；mailmap 只建议不写文件')}`);
  info(`  ${PROGRAM} doctor [--json]     ${dim('环境体检：git / credential.helper / SSH vs insteadOf / insteadOf 冲突（零 token）')}`);
  info(`  ${PROGRAM} completion <shell>  ${dim('打印 bash|zsh|fish|pwsh 静态补全脚本')}`);
  info(`  ${PROGRAM} remote [list | mirror <url> | unmirror] [--remote <name>]`);
  info(`      ${dim('管理当前仓库远程：mirror 设多个 pushurl，git push 同时推原始远程与镜像（默认 origin）')}`);
  info(`      ${dim('fetch 与凭据不受影响——gitid 只写非密钥配置（ADR-016）')}`);
  info(`  ${PROGRAM} credential [list | login <host> | set <host> <username> | remove <host>]`);
  info(`      ${dim('凭据管道：token 经 git credential 协议直达 helper（GCM/钥匙串），gitid 不留存不回显')}`);
  info(`      ${dim('login 触发 GCM 自身登录窗口（推荐）；set 经隐藏输入/管道粘贴 PAT，同键再 set 即覆盖')}`);
  info('');
  info(bold('选项'));
  info(`  --config <file>   ${dim('指定配置档案路径（默认 ~/.config/gitid/config.json 或 $GITID_CONFIG）')}`);
  info(`  --no-color        ${dim('禁用彩色输出')}`);
  info(`  -h, --help        ${dim('显示本帮助')}`);
  info(`  -v, --version     ${dim('显示版本')}`);
  info('');
  info(dim('身份档案仅保存在本机；git 配置以 git 自身为准，gitid 不做后台钩子。'));
  info(dim('安装后 gitid 与 git id 均可调用（bin 同时注册 git-id）。'));
  info(dim('图形界面：desktop/（Electron + Vue3），与 CLI 共用同一份身份档案。'));
}

// ---------- 入口 ----------

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (a === '-h' || a === '--help') { flags.help = true; continue; }
    if (a === '-v' || a === '--version') { flags.version = true; continue; }
    if (a.startsWith('--') && a.length > 2) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) { flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }
      const key = body;
      if (FLAG_WITH_VALUE.has(key) && i + 1 < argv.length && (!argv[i + 1].startsWith('-') || argv[i + 1] === '-')) {
        const val = argv[i + 1];
        if (flags[key] !== undefined) flags[key] = [].concat(flags[key], val);
        else flags[key] = val;
        i++;
      } else if (flags[key] !== undefined) {
        flags[key] = [].concat(flags[key], true);
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

const COMMANDS = {
  add: cmdAdd,
  list: cmdList,
  ls: cmdList,
  use: cmdUse,
  local: cmdLocal,
  current: cmdCurrent,
  cur: cmdCurrent,
  unset: cmdUnset,
  remove: cmdRemove,
  rm: cmdRemove,
  import: cmdImport,
  scan: cmdScan,
  audit: cmdAudit,
  doctor: cmdDoctor,
  completion: cmdCompletion,
  remote: cmdRemote,
  credential: cmdCredential,
  help: cmdHelp,
  version: () => info(`${PROGRAM} v${VERSION}`),
};

async function main() {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);

  if (flags['no-color']) state.noColorByFlag = true;
  if (flags.version) { info(`${PROGRAM} v${VERSION}`); return; }

  const [cmd, ...rest] = positional;
  if (!cmd || flags.help) { cmdHelp(); return; }

  const handler = COMMANDS[cmd];
  if (!handler) {
    die(`未知命令「${cmd}」。运行 ${PROGRAM} help 查看用法`);
  }
  await handler({ positional: rest, flags });
}

// 管道下游提前退出（如 | head）时静默结束，而非抛 EPIPE
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
}

main().catch((e) => {
  fail(e instanceof GitidError ? e.message : (e && e.stack) ? e.stack : String(e));
  process.exit(e instanceof GitidError && e.code ? e.code : 1);
});
