'use strict';

/**
 * gitid e2e 测试：在临时沙箱（独立 HOME + GITID_CONFIG）中运行 CLI，
 * 全程不触碰真实的 ~/.gitconfig 与 ~/.config/gitid。
 * git 2.32 以下不支持 GIT_CONFIG_GLOBAL，故通过 HOME 隔离全局配置。
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'gitid.js');

let sandboxSeq = 0;

function makeSandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `gitid-test-${++sandboxSeq}-`));
  const env = {
    ...process.env,
    HOME: home,
    // Windows：Node 的 os.homedir() 只认 USERPROFILE，gitid 配置目录走 APPDATA
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    XDG_CONFIG_HOME: path.join(home, '.config'),
    GITID_CONFIG: path.join(home, '.config', 'gitid', 'config.json'),
    GIT_CONFIG_NOSYSTEM: '1',
    NO_COLOR: '1',
  };
  delete env.GIT_CONFIG_GLOBAL;
  delete env.GIT_CONFIG_SYSTEM;
  const run = (args, cwd = home) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd, env });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const git = (args, cwd = home) => {
    const r = spawnSync('git', args, { encoding: 'utf8', cwd, env });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const repo = (name) => {
    const dir = path.join(home, 'repos', name);
    fs.mkdirSync(dir, { recursive: true });
    git(['init', '-q'], dir);
    return dir;
  };
  return { home, run, git, repo, env };
}

test('import：从全局 git 配置导入身份', () => {
  const sb = makeSandbox();
  sb.git(['config', '--global', 'user.name', '张三']);
  sb.git(['config', '--global', 'user.email', 'zhangsan@corp.com']);

  const r = sb.run(['import']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /已导入身份 zhangsan/);
  assert.match(r.out, /张三 <zhangsan@corp\.com>/);

  const list = sb.run(['list']);
  assert.match(list.out, /★/); // 导入值即当前全局 → 标记生效
});

test('add + use 全局切换，git 配置随之变化', () => {
  const sb = makeSandbox();
  assert.equal(sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']).code, 0);
  assert.equal(sb.run(['add', 'personal', '--name', 'tony', '--email', 'tony@me.dev']).code, 0);

  assert.equal(sb.run(['use', 'work']).code, 0);
  assert.equal(sb.git(['config', '--global', '--get', 'user.email']).out, 'zhangsan@corp.com');

  assert.equal(sb.run(['use', 'personal']).code, 0);
  assert.equal(sb.git(['config', '--global', '--get', 'user.email']).out, 'tony@me.dev');
});

test('use --local 仅写入当前仓库，不影响全局', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['add', 'personal', '--name', 'tony', '--email', 'tony@me.dev']);
  sb.run(['use', 'personal']);

  const repo = sb.repo('oss-lib');
  const r = sb.run(['use', 'work', '--local'], repo);
  assert.equal(r.code, 0, r.err);

  assert.equal(sb.git(['config', '--local', '--get', 'user.email'], repo).out, 'zhangsan@corp.com');
  assert.equal(sb.git(['config', '--global', '--get', 'user.email']).out, 'tony@me.dev');
});

test('use --local 在非仓库目录报错', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  const r = sb.run(['use', 'work', '--local'], sb.home);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /不在 git 仓库/);
});

test('current：本地覆盖 → 全局回退的判定', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['add', 'personal', '--name', 'tony', '--email', 'tony@me.dev']);
  sb.run(['use', 'personal']);

  const repo = sb.repo('mix');
  let cur = sb.run(['current'], repo);
  assert.equal(cur.code, 0);
  assert.match(cur.out, /personal/);
  assert.match(cur.out, /继承全局/);

  sb.run(['use', 'work', '--local'], repo);
  cur = sb.run(['current'], repo);
  assert.match(cur.out, /work/);
  assert.match(cur.out, /本地覆盖/);
  assert.match(cur.out, /user\.email\s+zhangsan@corp\.com\s+← 本地/);
});

test('unset --local 后回退为继承全局', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['use', 'work', '--global']);

  const repo = sb.repo('tmp');
  sb.run(['local', 'work'], repo);
  assert.equal(sb.run(['unset', '--local'], repo).code, 0);

  const name = sb.git(['config', '--local', '--get', 'user.name'], repo);
  assert.notEqual(name.code, 0); // 本地键已清除
  const cur = sb.run(['current'], repo);
  assert.match(cur.out, /继承全局/);
});

test('signingkey：切换到无签名身份时自动清理签名键', () => {
  const sb = makeSandbox();
  sb.run(['add', 'signed', '--name', 'A', '--email', 'a@x.com', '--signingkey', 'KEY123', '--gpgsign']);
  sb.run(['add', 'plain', '--name', 'B', '--email', 'b@x.com']);

  sb.run(['use', 'signed']);
  assert.equal(sb.git(['config', '--global', '--get', 'user.signingkey']).out, 'KEY123');
  assert.equal(sb.git(['config', '--global', '--get', 'commit.gpgsign']).out, 'true');

  sb.run(['use', 'plain']);
  assert.notEqual(sb.git(['config', '--global', '--get', 'user.signingkey']).code, 0);
  assert.notEqual(sb.git(['config', '--global', '--get', 'commit.gpgsign']).code, 0);
});

test('remove 删除档案；use 未知身份报错', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  assert.equal(sb.run(['remove', 'work']).code, 0);
  assert.match(sb.run(['list']).out, /尚无身份档案/);

  const r = sb.run(['use', 'work']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /身份「work」不存在/);

  assert.notEqual(sb.run(['use', 'ghost']).code, 0);
  assert.notEqual(sb.run(['frobnicate']).code, 0);
  assert.equal(sb.run(['help']).code, 0);
});

test('add 重复 id 为覆盖更新', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhang@old.com']);
  const r = sb.run(['add', 'work', '--name', '张三', '--email', 'zhang@new.com']);
  assert.equal(r.code, 0);
  assert.match(r.out, /已更新/);
  const store = JSON.parse(fs.readFileSync(path.join(sb.home, '.config/gitid/config.json'), 'utf8'));
  assert.equal(store.identities.work.email, 'zhang@new.com');
});

test('非法输入：坏邮箱 / 坏 id', () => {
  const sb = makeSandbox();
  assert.notEqual(sb.run(['add', 'x', '--name', 'a', '--email', 'not-an-email']).code, 0);
  assert.notEqual(sb.run(['add', '坏 id', '--name', 'a', '--email', 'a@b.c']).code, 0);
});

test('scan：多仓库身份审计（覆盖/继承/未匹配）', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['use', 'work']);

  const covered = sb.repo('covered'); // 本地覆盖（匹配档案）
  sb.run(['local', 'work'], covered);

  sb.repo('inherits'); // 继承全局

  const manual = sb.repo('manual'); // 本地手配，不在档案中
  sb.git(['config', '--local', 'user.name', 'someone'], manual);
  sb.git(['config', '--local', 'user.email', 'someone@else.io'], manual);

  const nested = sb.repo('nested/pkg'); // 深一层目录
  sb.run(['local', 'work'], nested);

  const r = sb.run(['scan', path.join(sb.home, 'repos'), '--depth', '4']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /covered/);
  assert.match(r.out, /inherits/);
  assert.match(r.out, /manual/);
  assert.match(r.out, /共 4 个仓库/);
  assert.match(r.out, /3 个本地覆盖/);
  assert.match(r.out, /1 个未匹配已存身份/);
});

test('scan：~ 展开主目录与 ~/x（桌面端扫描同走 core）', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['use', 'work']);

  const demo = path.join(sb.home, 'Projects', 'demo');
  fs.mkdirSync(demo, { recursive: true });
  sb.git(['init', '-q'], demo);

  let r = sb.run(['scan', '~']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /demo/);

  r = sb.run(['scan', '~/Projects']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /demo/);

  r = sb.run(['scan', '~/nope']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /目录不存在/);
});

test('scan：生效配置缺失的场景', () => {
  const sb = makeSandbox(); // 不设置全局身份
  sb.repo('nothing');
  const r = sb.run(['scan', path.join(sb.home, 'repos'), '--depth', '2']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /1 个配置缺失/);
  assert.match(r.out, /✗/);
});

test('scan --save：持久化默认扫描目录，此后裸 scan 直接使用', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  sb.run(['use', 'work']);

  const alpha = path.join(sb.home, 'Projects', 'alpha');
  fs.mkdirSync(alpha, { recursive: true });
  sb.git(['init', '-q'], alpha);
  sb.repo('repos/beta'); // 只有回退到 '.' 扫描时才会被发现的仓库

  const save = sb.run(['scan', '~/Projects', '--save', '--depth', '3']);
  assert.equal(save.code, 0, save.err);
  assert.match(save.out, /已保存默认扫描目录/);

  const cfg = JSON.parse(fs.readFileSync(path.join(sb.home, '.config/gitid/config.json'), 'utf8'));
  assert.equal(cfg.settings.scanRoot, '~/Projects');
  assert.equal(cfg.settings.scanDepth, 3);

  const bare = sb.run(['scan']); // cwd = home；若默认目录未生效会按 '.' 扫出 beta
  assert.equal(bare.code, 0, bare.err);
  assert.match(bare.out, /alpha/);
  assert.doesNotMatch(bare.out, /beta/);

  const noDir = sb.run(['scan', '--save']);
  assert.notEqual(noDir.code, 0);
  assert.match(noDir.err, /--save 需要目录参数/);
});

test('配置档案写入位置与原子性', () => {
  const sb = makeSandbox();
  sb.run(['add', 'a', '--name', 'A', '--email', 'a@x.com']);
  const p = path.join(sb.home, '.config/gitid/config.json');
  assert.ok(fs.existsSync(p));
  assert.ok(!fs.existsSync(`${p}.tmp-${process.pid}`));
  JSON.parse(fs.readFileSync(p, 'utf8')); // 可解析
});
