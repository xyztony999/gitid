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
  const run = (args, cwd = home, input) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd, env, input });
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

test('insteadOf/extras 全量覆盖：切换与清除不残留，变更清单可见（ADR-016）', () => {
  const sb = makeSandbox();
  sb.run(['add', 'mirror', '--name', '张三', '--email', 'zhangsan@corp.com',
    '--insteadOf', 'https://github.com/=https://gh.example.com/']);
  sb.run(['add', 'plain', '--name', '李四', '--email', 'li@personal.com', '--set', 'user.company=acme']);

  const use1 = sb.run(['use', 'mirror']);
  assert.equal(use1.code, 0, use1.err);
  assert.match(use1.out, /url\.https:\/\/gh\.example\.com\/\.insteadOf/); // 重写写入在变更清单中可见
  assert.equal(sb.git(['config', '--global', '--get', 'url.https://gh.example.com/.insteadOf']).out, 'https://github.com/');

  const cur = sb.run(['current']);
  assert.equal(cur.code, 0);
  assert.match(cur.out, /URL重写/);
  assert.match(cur.out, /https:\/\/github\.com\/\s+→\s+https:\/\/gh\.example\.com\//);

  const use2 = sb.run(['use', 'plain']); // mirror 的重写应被清除，plain 的 extra 写入
  assert.equal(use2.code, 0, use2.err);
  assert.notEqual(sb.git(['config', '--global', '--get', 'url.https://gh.example.com/.insteadOf']).code, 0);
  assert.equal(sb.git(['config', '--global', '--get', 'user.company']).out, 'acme');

  const use3 = sb.run(['use', 'mirror']); // 再切回：plain 的 extra 被清除、重写恢复
  assert.notEqual(sb.git(['config', '--global', '--get', 'user.company']).code, 0);
  assert.equal(sb.git(['config', '--global', '--get', 'url.https://gh.example.com/.insteadOf']).out, 'https://github.com/');

  sb.run(['unset', '--global']); // unset 连带清除匹配档案的 extras/insteadOf
  assert.notEqual(sb.git(['config', '--global', '--get', 'url.https://gh.example.com/.insteadOf']).code, 0);
});

test('insteadOf 非法输入：缺 = / 地址相同 / 含空白', () => {
  const sb = makeSandbox();
  assert.notEqual(sb.run(['add', 'x', '--name', 'a', '--email', 'a@b.c', '--insteadOf', 'nodelimiter']).code, 0);
  assert.notEqual(sb.run(['add', 'y', '--name', 'a', '--email', 'a@b.c', '--insteadOf', 'https://a/=https://a/']).code, 0);
  assert.notEqual(sb.run(['add', 'z', '--name', 'a', '--email', 'a@b.c', '--insteadOf', 'https://a b/=https://c/']).code, 0);
});

test('remote mirror：pushurl 双推、scan 展示、换镜像替换、unmirror 恢复', () => {
  const sb = makeSandbox();
  sb.run(['add', 'work', '--name', '张三', '--email', 'zhangsan@corp.com']);
  assert.notEqual(sb.run(['remote', 'list'], sb.home).code, 0); // 非仓库目录报错

  const repo = sb.repo('twin');
  sb.git(['remote', 'add', 'origin', 'https://github.com/example/twin.git'], repo);

  const list1 = sb.run(['remote', 'list'], repo);
  assert.equal(list1.code, 0, list1.err);
  assert.match(list1.out, /origin/);
  assert.match(list1.out, /github\.com\/example\/twin\.git/);

  const dup = sb.run(['remote', 'mirror', 'https://github.com/example/twin.git'], repo);
  assert.notEqual(dup.code, 0); // 镜像地址与原地址相同 → 拒绝

  const r = sb.run(['remote', 'mirror', 'https://gitee.com/example/twin.git'], repo);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /同时推/);
  const pushes = sb.git(['config', '--local', '--get-all', 'remote.origin.pushurl'], repo);
  assert.deepEqual(
    pushes.out.split('\n').sort(),
    ['https://github.com/example/twin.git', 'https://gitee.com/example/twin.git'].sort(),
  );

  const list2 = sb.run(['remote'], repo); // 不带子命令默认 list
  assert.match(list2.out, /⊕/);

  const scan = sb.run(['scan', path.join(sb.home, 'repos')]);
  assert.equal(scan.code, 0, scan.err);
  assert.match(scan.out, /origin⊕/);
  assert.match(scan.out, /1 个镜像推送/);

  // 换镜像地址：替换旧镜像而非追加
  sb.run(['remote', 'mirror', 'https://mirror.example.com/twin.git', '--remote', 'origin'], repo);
  const pushes2 = sb.git(['config', '--local', '--get-all', 'remote.origin.pushurl'], repo);
  assert.equal(pushes2.out.split('\n').length, 2);
  assert.match(pushes2.out, /mirror\.example\.com/);
  assert.doesNotMatch(pushes2.out, /gitee\.com/);

  const un = sb.run(['remote', 'unmirror'], repo);
  assert.equal(un.code, 0, un.err);
  assert.match(un.out, /已取消/);
  assert.notEqual(sb.git(['config', '--local', '--get-all', 'remote.origin.pushurl'], repo).code, 0);
});

test('credential：set 管道写入 / list 探测 / remove 删除（store helper 沙箱，假 token）', () => {
  const sb = makeSandbox();
  const credFile = path.join(sb.home, 'creds').replace(/\\/g, '/');
  sb.git(['config', '--global', 'credential.helper', `store --file ${credFile}`]);

  const empty = sb.run(['credential', 'list']);
  assert.equal(empty.code, 0, empty.err);
  assert.match(empty.out, /尚无凭据线索/);

  // set：stdin 管道喂假 token（子进程非 TTY 自动走 stdin 分支）
  const set = sb.run(['credential', 'set', 'example.com', 'corp-zhang'], sb.home, 'sandbox-token-not-real');
  assert.equal(set.code, 0, set.err);
  assert.match(set.out, /已保存 example\.com/);

  // login/set 记录的非密钥线索让 list"看得到"凭据（协议无枚举，凭线索点名）
  const hinted = sb.run(['credential', 'list']);
  assert.equal(hinted.code, 0, hinted.err);
  assert.match(hinted.out, /example\.com/);
  assert.match(hinted.out, /corp-zhang/);
  assert.match(hinted.out, /✓/);
  assert.match(hinted.out, /登录线索/);

  // gitid 档案零 token 痕迹（credential 管道不触碰档案——此刻档案甚至尚不存在）
  const cfgPath = path.join(sb.home, '.config/gitid/config.json');
  assert.ok(!fs.existsSync(cfgPath) || !fs.readFileSync(cfgPath, 'utf8').includes('sandbox-token-not-real'));
  // helper 侧确有凭据（store 文件明文本就是其语义）
  assert.ok(fs.readFileSync(credFile, 'utf8').includes('corp-zhang'));

  // 选择器 + current 展示
  sb.run(['add', 'work', '--name', '张三', '--email', 'z@corp.com', '--account', 'example.com=corp-zhang']);
  sb.run(['use', 'work']);
  assert.equal(sb.git(['config', '--global', '--get', 'credential.https://example.com.username']).out, 'corp-zhang');

  const list = sb.run(['credential', 'list']);
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /example\.com/);
  assert.match(list.out, /corp-zhang/);
  assert.match(list.out, /✓/);

  const cur = sb.run(['current']);
  assert.match(cur.out, /凭据账号/);
  assert.match(cur.out, /corp-zhang/);

  // 覆盖（修改）：同键再 set 换 token 成功
  const re = sb.run(['credential', 'set', 'example.com', 'corp-zhang'], sb.home, 'sandbox-token-2-not-real');
  assert.equal(re.code, 0, re.err);

  // remove 后 helper 实存消失，选择器仍在
  sb.run(['credential', 'remove', 'example.com', 'corp-zhang']);
  const list2 = sb.run(['credential', 'list']);
  assert.match(list2.out, /未存储/);
});

test('credential 选择器随身份全量覆盖：切换即清理', () => {
  const sb = makeSandbox();
  sb.run(['add', 'a', '--name', 'A', '--email', 'a@x.com', '--account', 'github.com=corp-zhang']);
  sb.run(['add', 'b', '--name', 'B', '--email', 'b@x.com']);
  sb.run(['use', 'a']);
  assert.equal(sb.git(['config', '--global', '--get', 'credential.https://github.com.username']).out, 'corp-zhang');
  sb.run(['use', 'b']);
  assert.notEqual(sb.git(['config', '--global', '--get', 'credential.https://github.com.username']).code, 0);
});

test('credential：无 helper 拒绝 / 空 token / 坏 host / 坏 --account', () => {
  const sb = makeSandbox(); // 干净 HOME + NOSYSTEM：无任何 helper
  const r = sb.run(['credential', 'set', 'example.com', 'corp-zhang'], sb.home, 'sandbox-token-not-real');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /credential\.helper/);

  const credFile = path.join(sb.home, 'creds').replace(/\\/g, '/');
  sb.git(['config', '--global', 'credential.helper', `store --file ${credFile}`]);
  assert.notEqual(sb.run(['credential', 'set', 'example.com', 'u'], sb.home, '').code, 0); // 空 token
  assert.notEqual(sb.run(['credential', 'set', 'not a host', 'u'], sb.home, 'x').code, 0); // 坏 host
  assert.notEqual(sb.run(['add', 'x', '--name', 'a', '--email', 'a@b.c', '--account', 'noeq']).code, 0);
});

test('配置档案写入位置与原子性', () => {
  const sb = makeSandbox();
  sb.run(['add', 'a', '--name', 'A', '--email', 'a@x.com']);
  const p = path.join(sb.home, '.config/gitid/config.json');
  assert.ok(fs.existsSync(p));
  assert.ok(!fs.existsSync(`${p}.tmp-${process.pid}`));
  JSON.parse(fs.readFileSync(p, 'utf8')); // 可解析
});
