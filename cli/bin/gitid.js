#!/usr/bin/env node
'use strict';

/**
 * gitid CLI — Git 多身份管理器命令行入口。
 * 核心逻辑在 ../lib/core.js（与桌面端共用），本文件只负责交互与展示。
 */

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

const VERSION = '0.1.0';
const PROGRAM = 'gitid';
const FLAG_WITH_VALUE = new Set(['name', 'email', 'signingkey', 'set', 'config', 'depth', 'as']);

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
function die(msg) { throw new GitidError(msg); }

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
  if (!id) die('用法：gitid add <id> --name <姓名> --email <邮箱> [--signingkey <key>] [--gpgsign] [--set k=v]');
  if (!ID_PATTERN.test(id)) die(`身份 id 只允许字母数字与 . _ - ，且以字母数字开头：「${id}」不合法`);

  const store = loadStore(flags.config && flags.config !== true ? flags.config : undefined);
  const exists = store.identities[id];
  const name = flags.name || (await prompt('姓名', exists && exists.name));
  const email = flags.email || (await prompt('邮箱', exists && exists.email));

  const signingkey = flags.signingkey && flags.signingkey !== true ? String(flags.signingkey) : (exists && exists.signingkey) || '';
  const gpgsign = flags.gpgsign === true ? true : null;
  const extra = {};
  const sets = Array.isArray(flags.set) ? flags.set : flags.set ? [flags.set] : [];
  for (const s of sets) {
    const eq = s.indexOf('=');
    if (eq <= 0) die(`--set 格式应为 key=value：${s}`);
    const [k, v] = [s.slice(0, eq), s.slice(eq + 1)];
    if (!v) die(`--set ${k} 的值不能为空（如需删除键请手动 git config --unset）`);
    extra[k] = v;
  }

  const store2 = core.upsertIdentity(store, id, { name, email, signingkey, gpgsign, extra }).store;
  saveStore(store2, flags.config && flags.config !== true ? flags.config : undefined);
  info(`${exists ? '已更新' : '已新增'}身份 ${bold(id)} —— ${name} <${email}>${signingkey ? cyan(` [签名 ${signingkey}]`) : ''}`);
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

async function cmdUse({ positional, flags }) {
  const [id] = positional;
  if (!id) die('用法：gitid use <id> [--local]');
  const store = loadStore();
  const it = getIdentity(store, id);

  const scope = flags.local ? 'local' : 'global';
  if (scope === 'local' && !repoRoot()) die('当前目录不在 git 仓库内（该操作需要 --local 作用域的仓库上下文）');

  const changes = applyIdentity(it, scope);
  const where = scope === 'local' ? `${bold('当前仓库')}（${repoRoot()}）` : bold('全局');
  info(`已将身份 ${bold(id)} —— ${it.name} <${it.email}> 应用于${where}`);
  for (const ch of changes) {
    info(green(`  ${dim(ch.key)}: ${ch.from === undefined ? dim('（未设置）') : ch.from} → ${ch.to}`));
  }
  if (!changes.length) info(dim('（配置无变化）'));

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
  for (const r of rows) info(pad(r[0], 18) + pad(r[1], 34) + dim(r[2]));

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
  const removed = unsetIdentity(scope);
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
  if (!rootArg && settings.scanRoot) info(dim(`使用默认扫描目录 ${settings.scanRoot}（指定目录可覆盖，scan --save 可更改）`));
  const { rows, summary } = scanRepos(store, root, depth);
  if (!rows.length) { info(`在 ${root} 下未发现 git 仓库（深度 ${depth}）`); return; }

  const statusMark = { ok: green('✓'), missing: red('✗'), unknown: yellow('⚠') };
  const table = [['状态', '身份', '生效配置', '仓库']];
  for (const r of rows) {
    const label = r.identityId
      ? (r.hasLocal ? cyan(`${r.identityId} ◆`) : r.identityId)
      : r.hasLocal ? cyan('本地手配 ◆') : dim('继承全局');
    const eff = r.status === 'missing' ? red('缺失') : `${r.effective.name ?? '?'} <${r.effective.email ?? '?'}>`;
    table.push([statusMark[r.status], label, eff, r.rel]);
  }
  printTable(table, { indent: '' });
  info('');
  info(dim(`共 ${summary.total} 个仓库：${summary.withLocal} 个本地覆盖 · ${summary.missing} 个配置缺失${summary.unknown ? ` · ${summary.unknown} 个未匹配已存身份` : ''}`));
  info(dim('状态：✓ 正常  ✗ 缺 user.name/user.email  ⚠ 生效值未匹配任何身份档案  ◆ 本地覆盖'));
}

// ---------- 帮助 ----------

function cmdHelp() {
  info(`${bold(PROGRAM)} v${VERSION} — Git 多身份管理器`);
  info('');
  info('管理多套 git 身份（user.name / user.email / 签名配置），应用于全局或单个仓库。');
  info('');
  info(bold('用法'));
  info(`  ${PROGRAM} add <id> --name <姓名> --email <邮箱> [--signingkey <key>] [--gpgsign] [--set k=v]`);
  info(`      ${dim('新增/更新身份档案（重复 add 为覆盖更新；姓名邮箱缺省时交互询问）')}`);
  info(`  ${PROGRAM} list                ${dim('列出所有身份（★=当前全局 ◆=当前仓库本地覆盖）')}`);
  info(`  ${PROGRAM} use <id> [--local]  ${dim('应用身份：默认写入全局，--local 仅当前仓库')}`);
  info(`  ${PROGRAM} local <id>          ${dim('等价于 use <id> --local')}`);
  info(`  ${PROGRAM} current             ${dim('查看当前目录生效身份与来源（本地覆盖 → 全局回退）')}`);
  info(`  ${PROGRAM} unset [--local|--global]`);
  info(`      ${dim('清除身份键（默认 --local，仅当前仓库）')}`);
  info(`  ${PROGRAM} remove <id>         ${dim('删除身份档案（不影响已写入的 git 配置）')}`);
  info(`  ${PROGRAM} import [--as <id>]  ${dim('将现有全局 git 身份导入为档案')}`);
  info(`  ${PROGRAM} scan [目录] [--depth N] [--save]`);
  info(`      ${dim('扫描目录下所有 git 仓库，审计身份配置（默认深度 6，不深入仓库内部）')}`);
  info(`      ${dim('--save 把目录与深度存为默认：此后不带参数的 scan（及桌面端扫描）直接使用')}`);
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
      if (FLAG_WITH_VALUE.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
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
  process.exit(1);
});
