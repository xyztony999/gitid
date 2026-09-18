#!/usr/bin/env node
/**
 * 开发模式：起 vite dev server + electron（渲染层热更新）。
 * 生产运行请用 npm start（构建 renderer-dist 后加载本地文件）。
 * 端口默认 5273（GITID_DEV_PORT 可覆盖）。就绪检测校验响应含 gitid 标记：
 * 端口被其他项目（如占用 5173 的 exms）抢占时明确报错，绝不误载他人页面。
 */
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.GITID_DEV_PORT) || 5273;
const MARKER = 'x-gitid-dev';
// Windows 下 npx 是 npx.cmd，须借 shell 启动
const IS_WIN = process.platform === 'win32';

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'inherit', shell: IS_WIN });
const viteAlive = () => vite.exitCode === null && vite.signalCode === null;

function waitPort(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get({ port, path: '/', timeout: 1500 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (body.includes(MARKER)) resolve();
          else reject(new Error(`端口 ${port} 已被其他应用占用（响应不是 gitid 渲染层）。请停掉占用进程，或用 GITID_DEV_PORT=<端口> 换端口重试`));
        });
      });
      req.on('error', () => {
        if (!viteAlive()) reject(new Error(`vite dev server 已退出（端口 ${port} 可能被占用，--strictPort 下无法接管）。请释放该端口，或用 GITID_DEV_PORT=<端口> 换端口重试`));
        else if (Date.now() - start > timeoutMs) reject(new Error('vite dev server 启动超时'));
        else setTimeout(probe, 400);
      });
    };
    probe();
  });
}

const children = [];
function killAll() {
  for (const p of children) {
    if (p && !p.killed) {
      try { p.kill(); } catch { /* noop */ }
    }
  }
}
process.on('SIGINT', () => { killAll(); process.exit(0); });
process.on('exit', killAll);

children.push(vite);

try {
  await waitPort(PORT);
  console.log(`\n[dev] vite ready at http://localhost:${PORT}, launching electron...\n`);
  spawnSync('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: IS_WIN,
    env: { ...process.env, GITID_DEV_URL: `http://localhost:${PORT}` },
  });
} catch (e) {
  console.error(`[dev] ${e.message}`);
  process.exitCode = 1;
} finally {
  killAll();
}
