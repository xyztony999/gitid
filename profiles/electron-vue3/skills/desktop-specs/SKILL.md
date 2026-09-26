---
name: desktop-specs
description: Electron + Vue3 + AntD 桌面端工程栈规格 — D4 交互设计与 F1-F4 前端实现的栈级规约：IPC 契约、视图结构、组件规范、主题/打包。设计或改桌面端页面、IPC 通道、托盘/监听行为前加载。
---

# Electron + Vue3 + AntD 桌面端工程栈规格

> **Profile 绑定（第 0 步）**：读 ACTIVE_PROFILE/ACTIVE_STACKS 与 manifest；`{stack.frontend_root}` ← env `DESKTOP_ROOT`；`{slots.*}`/{kb.*}/{ws.*} ← 业务 manifest。

## 1. 栈事实表

| 项 | 值 | 依据 |
|----|----|------|
| 框架 | Electron 33（linux-arm64 官方预编译）；electron-builder 25 | ADR-010/013 |
| 渲染层 | Vue 3.5 + ant-design-vue 4.2 + @ant-design/icons-vue 7；Vite 5 构建（产物 `renderer-dist/`） | ADR-010 |
| 模块形态 | 单 package：`main/`（主进程+preload）+ `renderer/`（Vue）+ `scripts/`（sync-core/make-icon/make-deb） | — |
| 代码根 | `{stack.frontend_root}`（env `DESKTOP_ROOT`，相对仓根） | — |
| 测试 | `node --test`：核心一致性（`main/core.js` 与 CLI 侧字节级比对）+ 沙箱应用测试 | ADR-009 |

## 2. 结构规约

| 分区 | 职责与约束 |
|------|-----------|
| `main/index.js` | 窗口/托盘/IPC 通道（`ipcMain.handle`，返回 `{ok, data\|error}`）/ `fs.watchFile` 档案与 gitconfig 监听广播（ADR-011/012） |
| `main/preload.js` | contextBridge 唯一桥：全部 `ipcRenderer.invoke` 包装；渲染层唯一入口 |
| `main/core.js` | 构建期同步副本（gitignore，`scripts/sync-core.mjs` 生成）——**只读产物，禁止手改**（ADR-009） |
| `renderer/src/api.js` | IPC 访问统一层：组件不得直写 `window.<bridge>` |
| `renderer/src/views/` | 业务视图（身份管理/仓库审计/凭据页）；App.vue 承布局/全局身份标签/刷新 |
| `scripts/` | sync-core（核心同步）/ make-icon / make-deb（离线装配 deb，ADR-013） |

## 3. IPC 契约模板（新增通道登记进 `{ws.api}` 文档）

```markdown
## ipc:<channel>
- 用途：（一句话）
- 方向：renderer → main（invoke）
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
- 响应：{ok: true, data: <结构>} | {ok: false, error: <码+信息>}
- 副作用：读/写哪些 git config 键域、档案字段；是否触发监听广播
- 凭据类通道：载荷仅 host/username 级信息，token 永不横穿（业务红线 P-03）
```

## 4. 主题与交互规约

- 深色模式：跟随系统——antd 暗色算法 + CSS 变量背景 + `html.dark` 预置类 + 窗口原生底色防闪白；新视图不得自造第二套主题开关。
- 展示语义与 CLI 一致：本地覆盖 → 全局回退，标注每键来源；**无"已应用"标记**（业务红线 P-01）。

## 5. 打包矩阵（ADR-013/015）

| 场景 | 命令 | 产物 |
|------|------|------|
| 内网开发机 | `npm run package` | linux-arm64 AppImage + 离线装配 deb |
| CI/联网 | `npm run dist:linux` | linux x64/arm64 × AppImage/deb/rpm |
| Windows | `npm run package:win` | win x64/arm64 NSIS |

## 6. 验证

Gate 2 按本栈规则集（`{stack.validation.rules}`）执行；`npm --prefix {module} test` + `npm --prefix {module} run build:renderer` 双绿。
