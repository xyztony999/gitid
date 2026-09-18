# gitid 架构与技术选型

## 结构分层

| 分区 | 位置 | 说明 |
|------|------|------|
| 共用核心 | `cli/lib/core.js` | UI 无关：档案存取 + 设置存取 + git 配置读写 + 仓库扫描（唯一事实源，ADR-009） |
| CLI | `cli/`（bin/ 入口 + test/ e2e） | 交互与展示层；`npm install -g ./cli` 安装 |
| 桌面端 | `desktop/` | Electron + Vue3 + AntD，见下节 |
| 文档 | `docs/` | 设计决策（ADR）/ 对象模型 / 架构 |

> 2026-09-18 拆分：本仓原携带的 ai-project-engine 流水线引擎资产（`engine/`、`.claude/`、`profiles/`）已移出至独立仓库，本仓仅保留产品与文档。

## 桌面端结构（desktop/）

| 分区 | 职责 |
|------|------|
| `main/index.js` | Electron 主进程：窗口/系统托盘/10 个 IPC 通道/档案监听广播（watchFile 档案 + `~/.gitconfig` + `$XDG_CONFIG_HOME/git/config`） |
| `main/core.js` | `cli/lib/core.js` 的构建期同步副本（gitignore，由 `scripts/sync-core.mjs` 生成，测试逐字节比对） |
| `main/preload.js` | contextBridge 唯一桥：全部 `ipcRenderer.invoke`，返回 `{ok, data|error}`（ADR-012） |
| `renderer/src/` | Vue3 + AntD 4：App（布局/全局身份标签/刷新）+ 身份管理视图 + 仓库审计视图（vite 构建至 renderer-dist/） |
| `scripts/` | sync-core（核心同步）/ make-icon（程序化 PNG 图标）/ make-deb（deb 离线装配） |

## 技术栈版本表

| 组件 | 版本约束 | 说明 |
|------|---------|------|
| Node | ≥ 18（开发机 v22） | readline/promises、node:test |
| git | ≥ 2.x（开发机 2.25 验证） | 未使用 2.32+ 特性（如 GIT_CONFIG_GLOBAL） |
| Electron | 33.x（linux-arm64 官方预编译） | AppImage 打包经 electron-builder 25；win-x64 NSIS |
| Vue / AntD | Vue 3.5 / ant-design-vue 4.2 | vite 5 构建 |
| 依赖 | CLI 运行时 0 依赖；桌面端仅 vue/antd/icons | 渲染层 bundle 后无运行时 node_modules 依赖 |

## cli 内部结构

`cli/bin/gitid.js` 仅剩交互层：颜色/CJK 对齐表格、交互式询问、命令分发；档案与 git 操作全部来自 `lib/core.js`（见共用核心行）。
