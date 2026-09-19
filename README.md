# gitid — Git 多身份管理器

管理多套 git 身份（`user.name` / `user.email` / `user.signingkey` / `commit.gpgsign` / 自定义键），一键应用于**全局**或**单个仓库本地**配置——避免"用公司邮箱提交了个人仓库"。**CLI + 桌面端（Electron）双形态**，共用同一份身份档案。

CLI 零依赖 Node（≥ 18），档案存于 `~/.config/gitid/config.json`，git 配置始终以 git 自身为事实源，无后台钩子。

## 安装

```bash
npm install -g ./cli        # 同时注册 gitid 与 git-id 两个命令（git id 亦可调用）
```

## 快速开始

```bash
gitid import                                   # 把现有全局 git 配置导入为第一个身份
gitid add personal --name tony --email tony@me.dev
gitid add work     --name 张三 --email zhangsan@corp.com --signingkey KEY123 --gpgsign

gitid use work                                 # 切换全局身份
gitid use personal --local                     # 仅当前仓库用个人身份（本地覆盖）
gitid current                                  # 查看当前目录生效身份与来源
gitid scan ~/Projects                          # 批量审计各仓库的身份配置
gitid scan ~/Projects --save                   # 把它存为默认扫描目录，此后 gitid scan 直接用
```

## 命令一览

| 命令 | 用途 |
|------|------|
| `add <id> --name --email [--signingkey] [--gpgsign] [--set k=v]` | 新增/更新身份档案（重复 add 为覆盖更新） |
| `list` | 列出所有身份（★ 当前全局 ◆ 当前仓库本地覆盖） |
| `use <id> [--local]` / `local <id>` | 应用身份：默认全局；`--local` 仅当前仓库 |
| `current` | 生效身份及每键来源（本地覆盖 → 全局回退） |
| `unset [--local\|--global]` | 清除身份键（默认 --local） |
| `remove <id>` | 删除身份档案（不影响已写入的 git 配置） |
| `import [--as <id>]` | 导入现有全局 git 身份 |
| `scan [目录] [--depth N] [--save]` | 扫描 git 仓库审计身份（✓ 正常 / ✗ 缺失 / ⚠ 手配 / ◆ 本地覆盖）；`--save` 将目录与深度存为默认，桌面端共用 |

完整帮助：`gitid help`。

## 设计要点

- **档案与配置分离**：展示"当前身份"时用生效 name+email 对档案无状态匹配，永不与 git 实际配置漂移（ADR-002）
- **use 为全量覆盖**：切换到无签名身份时自动清理 `user.signingkey` / `commit.gpgsign`，不残留（ADR-003）
- **原子写入**：档案 tmp+rename 落盘，权限 0600（ADR-007）

更多决策见 [docs/design-decisions.md](./docs/design-decisions.md)，对象模型见 [docs/object-model.md](./docs/object-model.md)，架构见 [docs/architecture.md](./docs/architecture.md)。

## 开发

```bash
cd cli && npm test     # e2e 15 例，沙箱 HOME 隔离，不触碰真实 ~/.gitconfig
```

## 桌面端（Electron + Vue3 + AntD）

与 CLI 共用同一份身份档案（`~/.config/gitid/config.json`），**CLI 的改动实时同步到界面**（档案监听广播），托盘可在不打开主窗口的情况下快速切换全局身份。

```bash
cd desktop
npm install
npm start          # 构建渲染层并启动（生产形态）
npm run dev        # 开发模式（vite 热更新 + electron）
npm run package    # 打包 linux-arm64 AppImage + deb → desktop/dist/
npm run package:win # 打包 Windows x64 NSIS 安装包 → desktop/dist/
```

配置档案位置：Linux/macOS 为 `~/.config/gitid/config.json`（XDG），Windows 为 `%APPDATA%\gitid\config.json`；`$GITID_CONFIG` 可覆盖。两形态均要求 `git` 在 PATH 上（桌面端只调用 git 自身，不内置）。

| 功能 | 说明 |
|------|------|
| 身份管理 | 新增/编辑/删除身份，一键切换全局身份（含签名键自动清理，与 `gitid use` 同语义） |
| 仓库审计 | 扫描任意目录下的 git 仓库，可视化各仓库生效身份/缺失/手配状态；每个仓库通过下拉独立选择「继承全局」或单独设置本地身份，选即生效（对应 `scan` / `use --local` / `unset --local`）；可把目录与深度「设为默认」（与 CLI `scan --save` 共用），此后打开即用它 |
| 托盘快速切换 | 系统托盘列出全部身份，单击即切换全局身份；关闭主窗口后托盘常驻 |

架构：主进程 `desktop/main/`（窗口/托盘/IPC/档案监听）+ 渲染层 `desktop/renderer/`（Vue3 + AntD 4），业务核心直接复用 `cli/lib/core.js`（打包时经 `scripts/sync-core.mjs` 同步，一致性有测试保障）。

## 发版流水线

打版本 tag 并推送到两端即触发：

```bash
git tag v0.1.0 && git push github v0.1.0 && git push origin v0.1.0
```

- **GitHub Actions**（`.github/workflows/release.yml`）：沙箱测试（CLI e2e + 桌面端含 xvfb 全链路）→ 构建 linux-arm64 AppImage/deb 与 win-x64 NSIS → 自动创建 GitHub Release 并附产物。
- **gitee 镜像**：在 GitHub 仓库 Secrets 配置 `GITEE_TOKEN`（gitee 私人令牌）后，同一流水线会自动在 gitee 创建同名 Release 并上传同源附件；未配置则跳过。gitee 侧另有 Gitee Go 原生流水线（`.workflow/release.yml`，需在仓库设置开通）做同源构建验证。
- **日常 CI**（`.github/workflows/ci.yml`）：push/PR 在 ubuntu/windows 双平台跑沙箱测试。

## 仓库结构

| 内容 | 位置 |
|------|------|
| CLI 实现 | `cli/`（bin/ 入口 + lib/ 共用核心 + test/） |
| 桌面端实现 | `desktop/`（main/ 主进程 + renderer/ Vue3 渲染层 + scripts/） |
| 设计文档 | `docs/`（设计决策 ADR-001~014 / 对象模型 / 架构） |
| CI/CD | `.github/workflows/`（Actions 发版/日常测试）+ `.workflow/`（Gitee Go） |

> 2026-09-18 拆分：本仓原携带的 ai-project-engine 引擎资产（engine/、.claude/、profiles/）已移出至独立仓库维护，本仓专注 gitid 产品本身。

## License

[MIT](./LICENSE) © Xinyi Zhang
