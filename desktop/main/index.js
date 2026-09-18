'use strict';

/**
 * gitid 桌面端 — Electron 主进程。
 * 职责：窗口/托盘/IPC/档案监听；全部业务逻辑在 core.js（与 CLI 共用）。
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, Notification, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 打包态用同步副本；开发态回退到 cli 源文件（见 scripts/sync-core.mjs）
let core;
try {
  core = require('./core.js');
} catch {
  core = require('../../cli/lib/core.js');
}

const { GitidError } = core;

// 统一应用名：userData 归一到 ~/.config/gitid
app.setName('gitid');
// X11 下 WM_CLASS 不随 app.setName 变（由可执行名定型），显式覆盖为 "gitid"，
// 与 .desktop 的 StartupWMClass 匹配，任务栏才能关联图标
app.commandLine.appendSwitch('class', 'gitid');

const DEV_URL = process.env.GITID_DEV_URL;
const IS_TEST = !!process.env.GITID_SCREENSHOT;

let mainWindow = null;
let tray = null;

// ---------- 窗口 ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 880,
    minHeight: 600,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (DEV_URL) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer-dist', 'index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });

  if (IS_TEST) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.GITID_DRIVE) {
            // 集成验证通道：GITID_DRIVE='[{"op":"applyLocal","args":["<repo>","<id>"]},…]'
            // 经渲染层真实桥（preload）顺序调用，配合测试断言 UI→IPC→core→git 全链路
            for (const s of JSON.parse(process.env.GITID_DRIVE)) {
              const r = await mainWindow.webContents.executeJavaScript(
                `window.gitid.${s.op}(${(s.args || []).map((a) => JSON.stringify(a)).join(',')})`,
              );
              console.log(`[drive] ${s.op} ->`, JSON.stringify(r));
            }
          }
          const img = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.GITID_SCREENSHOT, img.toPNG());
          console.log(`screenshot: ${process.env.GITID_SCREENSHOT}`);
        } catch (e) {
          console.error('screenshot failed:', e);
          process.exitCode = 1;
        } finally {
          app.quit();
        }
      }, 1600);
    });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    watchForChanges();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    // 关窗后保留托盘常驻（linux/windows）；托盘"退出"才真正退出
    if (!tray || process.platform === 'darwin') app.quit();
  });
}

// ---------- 托盘 ----------

function globalLabel(store) {
  const g = core.readApplied('global', store);
  if (g.identityId) return { id: g.identityId, text: `${g.identityId} · ${g.name} <${g.email}>` };
  if (g.name !== undefined || g.email !== undefined) return { id: null, text: `（未匹配）${g.name || '?'} <${g.email || '?'}>` };
  return { id: null, text: '未配置' };
}

function createTray() {
  if (IS_TEST) return; // 无显示环境下托盘不可靠，跳过
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('gitid — Git 多身份管理器');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      else createWindow();
    });
  } catch (e) {
    console.warn('托盘初始化失败（不影响主功能）：', e.message);
    tray = null;
  }
}

function buildTrayMenu() {
  const store = core.loadStore();
  const label = globalLabel(store);
  const items = Object.entries(store.identities).map(([id, it]) => ({
    label: `${id} — ${it.name}`,
    type: 'radio',
    checked: label.id === id,
    click: () => { ipcApplyGlobal(null, id); },
  }));
  return Menu.buildFromTemplate([
    { label: `全局身份：${label.text}`, enabled: false },
    { type: 'separator' },
    ...(items.length ? items : [{ label: '（尚无身份档案）', enabled: false }]),
    { type: 'separator' },
    { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
    { label: '退出 gitid', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) { try { tray.setContextMenu(buildTrayMenu()); } catch { /* 重建失败不致命 */ } }
}

// ---------- 广播与监听（与 CLI 互通互同步） ----------

let broadcastTimer = null;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    refreshTray();
    const payload = buildStorePayload();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('store-updated', payload);
    }
  }, 250);
}

function watchForChanges() {
  const watchFileSafe = (p) => {
    try { fs.watchFile(p, { interval: 1000 }, () => broadcast()); } catch { /* 文件不存在时 watchFile 也安全 */ }
  };
  watchFileSafe(core.configPath());
  watchFileSafe(path.join(os.homedir(), '.gitconfig'));
  if (process.platform !== 'win32') {
    const xdgGit = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    watchFileSafe(path.join(xdgGit, 'git', 'config'));
  }
}

// ---------- IPC ----------

function buildStorePayload() {
  const store = core.loadStore();
  const g = core.readApplied('global', store);
  return {
    configPath: core.configPath(),
    identities: Object.entries(store.identities).map(([id, it]) => ({ id, ...it })),
    global: {
      name: g.name,
      email: g.email,
      signingkey: g.signingkey,
      identityId: g.identityId,
    },
    settings: core.getSettings(store),
  };
}

function ok(data) { return { ok: true, data }; }
function err(e) { return { ok: false, error: e instanceof GitidError ? e.message : String(e && e.message || e) }; }
const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
  try { return ok(await fn(event, ...args)); } catch (e) { return err(e); }
});

handle('store:get', () => buildStorePayload());

handle('identity:save', (e, id, fields) => {
  const store = core.loadStore();
  const { store: s2, exists } = core.upsertIdentity(store, id, fields);
  core.saveStore(s2);
  broadcast();
  return { exists };
});

handle('identity:remove', (e, id) => {
  const store = core.loadStore();
  core.getIdentity(store, id);
  delete store.identities[id];
  core.saveStore(store);
  broadcast();
});

handle('identity:applyGlobal', (e, id) => {
  const store = core.loadStore();
  const it = core.getIdentity(store, id);
  const changes = core.applyIdentity(it, 'global');
  broadcast();
  if (!IS_TEST) {
    new Notification({ title: 'gitid 全局身份已切换', body: `${id} — ${it.name} <${it.email}>` }).show();
  }
  return { changes };
});

handle('identity:applyLocal', (e, repoPath, id) => {
  if (!core.repoRoot(repoPath)) throw new GitidError(`不是 git 仓库：${repoPath}`);
  const store = core.loadStore();
  const it = core.getIdentity(store, id);
  const changes = core.applyIdentity(it, 'local', { cwd: repoPath });
  broadcast();
  return { changes };
});

handle('identity:unsetLocal', (e, repoPath) => {
  if (!core.repoRoot(repoPath)) throw new GitidError(`不是 git 仓库：${repoPath}`);
  const removed = core.unsetIdentity('local', { cwd: repoPath });
  broadcast();
  return { removed };
});

handle('identity:importGlobal', () => {
  const store = core.loadStore();
  const g = core.readApplied('global', store);
  if (g.name === undefined && g.email === undefined) {
    throw new GitidError('全局 git 尚未配置 user.name / user.email，无可导入');
  }
  const id = (g.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
  const { store: s2, exists } = core.upsertIdentity(store, id, {
    name: g.name, email: g.email, signingkey: g.signingkey || '',
    gpgsign: g.gpgsign === 'true' ? true : null,
  });
  core.saveStore(s2);
  broadcast();
  return { id, exists };
});

handle('repo:scan', (e, root, depth) => core.scanRepos(core.loadStore(), root, depth || 6));

handle('settings:save', (e, patch) => {
  const store = core.loadStore();
  core.saveSettings(store, patch || {});
  core.saveStore(store);
  broadcast();
  return core.getSettings(store);
});

handle('dialog:pickDirectory', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

function ipcApplyGlobal(_event, id) {
  try {
    const store = core.loadStore();
    core.applyIdentity(core.getIdentity(store, id), 'global');
    broadcast();
  } catch (e) {
    console.error('托盘切换失败：', e.message);
  }
}
