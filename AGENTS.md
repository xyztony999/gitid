# gitid — 工作区指令（ZCode AGENTS.md）

Git 多身份管理器：**CLI + Electron 桌面端**双形态，管理全局与项目级 git 身份配置（user.name/email/signingkey/gpgsign/自定义键）与默认扫描目录设置。开源产品仓（MIT），引擎资产已于 2026-09-18 拆出至独立本地仓维护，本仓专注产品。

## 仓库地图

| 目录 | 内容 |
|------|------|
| `cli/lib/core.js` | **共用核心（唯一事实源）**：档案/设置存取 + git 配置读写 + 仓库扫描，UI 无关 |
| `cli/bin/gitid.js` | CLI 交互层（add/list/use/local/current/unset/remove/import/scan） |
| `desktop/main/` | Electron 主进程（窗口/托盘/IPC/档案监听）；`core.js` 为构建期同步副本 |
| `desktop/renderer/` | Vue3 + AntD 渲染层（身份管理/仓库审计两视图），vite 构建 |
| `docs/` | 设计决策（ADR-001~014）/ 对象模型 / 架构 |

## 硬性纪律

1. **业务逻辑只写进 `cli/lib/core.js`**，CLI 与桌面端都不得私改逻辑；改完必须 `cd desktop && npm run sync-core`（`npm start/package` 会自动前置），desktop 测试会逐字节比对一致性。
2. **测试一律沙箱**：CLI/desktop 测试通过独立 `HOME` + `GITID_CONFIG` 隔离，严禁读写真实 `~/.gitconfig` 与 `~/.config/gitid`；新增功能必须带沙箱 e2e。
3. **`use` 是全量覆盖语义**：身份没有的键（signingkey/gpgsign）必须 unset，不允许残留上一身份的签名配置（ADR-003）。
4. **git 配置以 git 自身为事实源**：档案与配置分离，展示靠 name+email 无状态匹配；不引入守护进程、git 钩子或"已应用"标记（ADR-002/011）。
5. 桌面端安全基线：`contextIsolation` 开启、渲染层无 Node；IPC 统一 `invoke` 返回 `{ok, data|error}`（ADR-012）。

## 常用命令

```bash
cd cli && npm test                 # CLI e2e（沙箱）
cd desktop && npm test             # 核心一致性 + 沙箱应用
cd desktop && npm run dev          # 开发（vite 热更新 + electron）
cd desktop && npm start            # 生产形态运行
cd desktop && npm run package      # 内网开发机：linux-arm64 AppImage + 离线装配 deb → dist/
cd desktop && npm run dist:linux  # 联网/CI：linux x64+arm64 × AppImage/deb/rpm
cd desktop && npm run package:win  # 打包 Windows x64 + arm64 NSIS 安装包 → dist/
npm install -g ./cli               # 安装 CLI（注册 gitid / git-id）
```

## 提交约定

中文 Conventional Commits（`feat(desktop): …` / `fix(cli): …` / `docs: …`），一次提交一个完整关注点。

## 详细文档

- 项目入口：`README.md`
- 设计决策：`docs/design-decisions.md`（ADR-001~014，改架构先读）；对象模型/架构：`docs/`
