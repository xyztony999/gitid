'use strict';

/**
 * 桌面端核心一致性测试：验证 sync-core 副本与 cli 源一致、核心在沙箱下行为正确
 * （与 CLI 的 e2e 互补，不启动 Electron）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function loadCore(rel) {
  return import(pathToFileURL(path.resolve(here, rel)).href);
}

test('sync-core 副本与 cli/lib/core.js 一致（去掉自动生成横幅后）', async () => {
  const src = fs.readFileSync(path.resolve(here, '../../cli/lib/core.js'), 'utf8');
  let dst = fs.readFileSync(path.resolve(here, '../main/core.js'), 'utf8');
  dst = dst.replace(/^\/\/ ⚠️[^\n]*\n\n/, '');
  assert.equal(dst, src);
});

test('core 副本可加载并完成一次完整身份应用（沙箱）', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitid-desktop-test-'));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config/gitid/config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const core = await loadCore('../main/core.js');
  // loadCore 的 import 发生在沙箱 env 设置之前，core 的 configPath 依赖 env，
  // 因此这里用进程级替换验证：以子进程方式再跑一遍更严谨——见下一测试
  assert.equal(typeof core.loadStore, 'function');

  // 沙箱行为用子进程验证（env 隔离干净）
  const script = `
    const core = require(${JSON.stringify(path.resolve(here, '../main/core.js'))});
    const store = core.loadStore();
    core.upsertIdentity(store, 'work', { name: '张三', email: 'z@corp.com' });
    core.saveStore(store);
    const it = core.getIdentity(core.loadStore(), 'work');
    core.applyIdentity(it, 'global');
    console.log(JSON.stringify({
      store: core.loadStore().identities.work,
      global: core.readApplied('global', core.loadStore()).email,
    }));
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.store.email, 'z@corp.com');
  assert.equal(out.global, 'z@corp.com');
});

test('core 设置：默认扫描目录读写与校验（沙箱）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitid-desktop-settings-'));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config/gitid/config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const script = `
    const core = require(${JSON.stringify(path.resolve(here, '../main/core.js'))});
    const store = core.loadStore();
    const before = core.getSettings(store); // 旧档案无 settings → 默认值
    core.saveSettings(store, { scanRoot: '~/Projects', scanDepth: 4 });
    core.saveStore(store);
    const after = core.getSettings(core.loadStore());
    let thrown = '';
    try { core.saveSettings(core.loadStore(), { scanDepth: 0 }); } catch (e) { thrown = e.message; }
    console.log(JSON.stringify({ before, after, thrown }));
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual(out.before, { scanRoot: '', scanDepth: 6 });
  assert.deepEqual(out.after, { scanRoot: '~/Projects', scanDepth: 4 });
  assert.match(out.thrown, /scanDepth/);
});

test('core：insteadOf 覆盖语义与远程镜像管理（沙箱）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitid-desktop-ext-'));
  const repo = path.join(home, 'Projects', 'demo');
  fs.mkdirSync(repo, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config/gitid/config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const script = `
    const { spawnSync } = require('node:child_process');
    const core = require(${JSON.stringify(path.resolve(here, '../main/core.js'))});
    const store = core.loadStore();
    core.upsertIdentity(store, 'mirror', { name: '张三', email: 'z@corp.com',
      insteadOf: [{ original: 'https://github.com/', url: 'https://gh.example.com/' }] });
    core.upsertIdentity(store, 'plain', { name: '李四', email: 'li@x.com', extra: { 'user.company': 'acme' } });
    core.saveStore(store);
    const s = core.loadStore();
    core.applyIdentity(core.getIdentity(s, 'mirror'), 'global', { store: s });
    const applied = core.cfgGet('global', 'url.https://gh.example.com/.insteadOf');
    const appliedChanges = core.applyIdentity(core.getIdentity(s, 'plain'), 'global', { store: s });
    const cleaned = core.cfgGet('global', 'url.https://gh.example.com/.insteadOf') === undefined;
    const extraOn = core.cfgGet('global', 'user.company');
    spawnSync('git', ['init', '-q'], { cwd: ${JSON.stringify(repo)}, env: process.env });
    spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/example/demo.git'], { cwd: ${JSON.stringify(repo)}, env: process.env });
    const before = core.getRemotes(${JSON.stringify(repo)});
    core.setMirrorPush(${JSON.stringify(repo)}, 'origin', 'https://gitee.com/example/demo.git');
    const mirrored = core.getRemotes(${JSON.stringify(repo)});
    core.clearMirrorPush(${JSON.stringify(repo)}, 'origin');
    const after = core.getRemotes(${JSON.stringify(repo)});
    console.log(JSON.stringify({
      applied, cleaned, extraOn,
      changeKeys: appliedChanges.map((c) => c.key),
      before: before.map((r) => ({ name: r.name, mirror: r.mirror, pushurls: r.pushurls })),
      mirrored: mirrored.map((r) => ({ name: r.name, mirror: r.mirror, pushurls: r.pushurls })),
      after: after.map((r) => ({ name: r.name, mirror: r.mirror, pushurls: r.pushurls })),
    }));
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.applied, 'https://github.com/');
  assert.equal(out.cleaned, true); // 切到 plain 后上一身份的重写被清除
  assert.equal(out.extraOn, 'acme');
  assert.ok(out.changeKeys.some((k) => k.startsWith('url.') && k.endsWith('.insteadOf')));
  assert.deepEqual(out.before, [{ name: 'origin', mirror: false, pushurls: [] }]);
  assert.deepEqual(out.mirrored, [{
    name: 'origin', mirror: true,
    pushurls: ['https://github.com/example/demo.git', 'https://gitee.com/example/demo.git'],
  }]);
  assert.deepEqual(out.after, [{ name: 'origin', mirror: false, pushurls: [] }]);
});

test('core：凭据管道与选择器（沙箱 store helper，假 token）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitid-desktop-cred-'));
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config/gitid/config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const credFile = path.join(home, 'creds').replace(/\\/g, '/');
  const script = `
    const { spawnSync } = require('node:child_process');
    const core = require(${JSON.stringify(path.resolve(here, '../main/core.js'))});
    spawnSync('git', ['config', '--global', 'credential.helper', 'store --file ${credFile}'], { env: process.env });
    core.credentialStore('example.com', 'corp-zhang', 'sandbox-token-not-real');
    const probed = core.credentialProbe('example.com', { username: 'corp-zhang' });
    const miss = core.credentialProbe('other.example');
    core.credentialErase('example.com', 'corp-zhang');
    const gone = core.credentialProbe('example.com', { username: 'corp-zhang' });
    const store = core.loadStore();
    core.upsertIdentity(store, 'work', { name: '张三', email: 'z@corp.com', accounts: [{ host: 'example.com', username: 'corp-zhang' }] });
    core.saveStore(store);
    core.applyIdentity(core.getIdentity(core.loadStore(), 'work'), 'global', { store: core.loadStore() });
    const selector = core.cfgGet('global', 'credential.https://example.com.username');
    const hints = core.loadStore().credentialHosts || [];
    const listed = core.credentialList();
    console.log(JSON.stringify({
      probed, miss: miss.stored, gone: gone.stored, selector,
      hints, listed: listed.map((x) => ({ host: x.host, selector: x.selector || null, stored: x.stored })),
      leaked: JSON.stringify(core.loadStore()).includes('sandbox-token-not-real'),
    }));
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.deepEqual(out.probed, { host: 'example.com', username: 'corp-zhang', stored: true });
  assert.equal(out.miss, false);
  assert.equal(out.gone, false);
  assert.equal(out.selector, 'corp-zhang');
  assert.equal(out.hints.length, 0); // erase 已清除登录线索（非密钥）
  assert.deepEqual(out.listed, [{ host: 'example.com', selector: 'corp-zhang', stored: false }]); // 仅剩选择器行，实存已删
  assert.equal(out.leaked, false); // token 绝不进身份档案
});

// 渲染层 → IPC → core → git 全链路（真实 Electron，经 preload 桥；无 xvfb-run 则跳过）
test('GITID_DRIVE 集成验证：仓库单独设置身份 / 改回继承全局（沙箱）', { timeout: 90000 }, (t) => {
  const hasXvfb = spawnSync('which', ['xvfb-run']).status === 0;
  if (!hasXvfb) return t.skip('环境无 xvfb-run，跳过 Electron 集成验证');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gitid-drive-test-'));
  const repo = path.join(home, 'Projects', 'demo');
  fs.mkdirSync(repo, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config', 'gitid', 'config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (args, cwd = repo) => spawnSync('git', args, { encoding: 'utf8', env, cwd });
  git(['init', '-q']);
  git(['config', '--global', 'user.name', '张三']);
  git(['config', '--global', 'user.email', 'zhang@corp.com']);
  fs.mkdirSync(path.dirname(env.GITID_CONFIG), { recursive: true });
  fs.writeFileSync(env.GITID_CONFIG, JSON.stringify({
    version: 1,
    identities: {
      work: { name: '张三', email: 'zhang@corp.com', signingkey: '' },
      personal: { name: '李四', email: 'li@personal.com', signingkey: '' },
    },
  }));

  const runDrive = (steps) => {
    const r = spawnSync('xvfb-run', [
      '-a',
      path.resolve(here, '../node_modules/.bin/electron'), '.', '--no-sandbox',
    ], {
      encoding: 'utf8',
      cwd: path.resolve(here, '..'),
      env: { ...env, GITID_DRIVE: JSON.stringify(steps), GITID_SCREENSHOT: path.join(home, 'shot.png') },
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const line = r.stdout.match(/\[drive\] (\S+) -> (\{.*\})/);
    assert.ok(line, `驱动日志缺失：${r.stdout}`);
    return { op: line[1], result: JSON.parse(line[2]) };
  };

  // 第一步：仓库单独设置 personal → 磁盘本地键 = 李四
  const applied = runDrive([{ op: 'applyLocal', args: [repo, 'personal'] }]);
  assert.equal(applied.op, 'applyLocal');
  assert.equal(applied.result.ok, true);
  assert.equal(git(['config', '--local', '--get', 'user.email']).stdout.trim(), 'li@personal.com');
  assert.equal(git(['config', '--get', 'user.email']).stdout.trim(), 'li@personal.com');

  // 第二步：改回继承全局 → 本地键清除、生效回退全局
  const unset = runDrive([{ op: 'unsetLocal', args: [repo] }]);
  assert.equal(unset.op, 'unsetLocal');
  assert.equal(unset.result.ok, true);
  assert.deepEqual(unset.result.data.removed.sort(), ['user.email', 'user.name']);
  assert.equal(git(['config', '--local', '--get', 'user.email']).status, 1);
  assert.equal(git(['config', '--get', 'user.email']).stdout.trim(), 'zhang@corp.com');
});
