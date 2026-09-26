# Electron + Vue3 + AntD 桌面端工程栈 — Gate 2 规则集

> 栈级验证规则（随栈分发；Gate 2 由 validation skill 分层组装执行）。
> 槽位约定：`{stack.frontend_root}`=桌面端代码根（env `DESKTOP_ROOT`）；`{slots.*}` ← 业务 manifest；`{profile}`=业务产品名。
> 级别：CRITICAL=阻断（FAIL）；WARNING=建议。产品级不变量见业务规则 `product-rules.md`；CLI 侧规则见 CLI 工程栈规则。

## CRITICAL

| # | 规则 | 判定方法 |
|---|------|---------|
| EC-01 | **安全基线**（ADR-012）：`contextIsolation: true`、`nodeIntegration: false`、渲染层无 Node；主进程↔渲染层唯一通道 = `preload.js` 的 contextBridge 桥 | review 主窗口 webPreferences；grep `renderer/src` 无 `require(` / `process.` / `node:` |
| EC-02 | **IPC 契约统一**（ADR-012）：全部通道走 `ipcMain.handle` + `ipcRenderer.invoke`，返回 `{ok, data|error}`；错误在主进程归一，Vue 层只处理展示 | grep 新增通道两端（`{stack.frontend_root}/main/index.js` ↔ `renderer/src/api.js`）签名一致；载荷不含凭据/token（业务红线 P-03） |
| EC-03 | **核心同步链路**（ADR-009）：业务逻辑禁止写入 `desktop/main/core.js`（构建期副本）；只改 CLI 侧 `lib/core.js` 后 `npm run sync-core`；desktop 测试逐字节比对 | grep diff：`main/core.js` 不得出现在人工改动文件清单；`npm --prefix {module} test` 一致性用例通过 |
| EC-04 | **无自有状态**（ADR-011）：身份数据只存档案 + git config；主进程经 `fs.watchFile` 监听档案与用户 gitconfig，变更广播刷新；不落任何桌面端中间态/缓存 | review 新增持久化点；关闭应用后无残留状态文件（日志/缓存除外） |
| EC-05 | **沙箱测试**（ADR-006/014）：desktop 测试经独立 HOME + `$GITID_CONFIG` 隔离，不触真实用户配置 | review `{stack.frontend_root}/test` 夹具 |
| EC-06 | **渲染层凭据直管道**（ADR-017）：凭据操作经 IPC 触发主进程走 git credential 协议（GCM 弹窗/login/set/remove）；token 不落盘、不进 IPC 广播载荷、不回显渲染层 | review 通道载荷；渲染层代码无 token 变量持久化 |

## WARNING

| # | 规则 | 判定方法 |
|---|------|---------|
| EW-01 | 深色模式跟随系统：antd 暗色算法 + CSS 变量背景 + `html.dark` 预置类 + 窗口原生底色防闪白；新增视图接入同一套主题机制 | review 新视图样式来源 |
| EW-02 | 组件规范：优先 ant-design-vue 4.x 组件与 `@ant-design/icons-vue` 图标；不引入第二套 UI 库（例外须 ADR） | grep 新依赖 |
| EW-03 | 打包矩阵（ADR-013/015）：内网 `npm run package`（linux-arm64 AppImage + make-deb 离线装配 deb）；CI `dist:linux`（linux x64/arm64 × AppImage/deb/rpm）；Windows `package:win`（NSIS x64/arm64）；产物语义两条路径一致 | review 构建脚本改动；dist 产物抽检 |
| EW-04 | vite 产物纪律：`renderer-dist/` 与 `dist/` 不入库（gitignore）；渲染层改动必须经 `npm run build:renderer` 验证可构建 | git status 无产物文件 |
| EW-05 | 视图结构：业务页面落 `renderer/src/views/*.vue`，IPC 访问统一经 `renderer/src/api.js`，不在组件内直写 `window.<bridge>` 调用 | grep 视图文件 |
| EW-06 | 提交约定：中文 Conventional Commits（`feat(desktop): …`/`fix(desktop): …`），一次提交一个完整关注点 | review 提交历史 |

## 构建/测试命令

```
npm --prefix {module} test               # sync-core 一致性 + 沙箱应用测试
npm --prefix {module} run build:renderer # 渲染层 vite 构建
```
