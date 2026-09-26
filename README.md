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
gitid remote mirror https://gitee.com/<user>/<repo>.git  # 当前仓库 git push 同时推 GitHub 与 gitee
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
| `scan [目录] [--depth N] [--save]` | 扫描 git 仓库审计身份与远程镜像状态（✓ 正常 / ✗ 缺失 / ⚠ 手配 / ◆ 本地覆盖 / ⊕ 镜像推送）；`--save` 将目录与深度存为默认，桌面端共用 |
| `remote [list \| mirror <url> \| unmirror] [--remote <name>]` | 当前仓库远程镜像管理：`mirror` 设多 pushurl 使 `git push` 同时推原始远程与镜像；fetch 与凭据（GCM/SSH）不受影响 |
| `credential [list \| login <host> \| set <host> <user> \| remove <host>]` | 凭据管道：token 经 git credential 协议直达 helper（GCM/钥匙串），gitid 不留存不回显；`login` 推荐（GCM 自身弹窗），`set` 走隐藏输入/管道粘贴 PAT |

身份可携带 `--insteadOf 原始地址=替换地址`（可重复）的 URL 重写（镜像加速 / 多账号 SSH 别名 / 带用户名 HTTPS），随 `use` 一并应用，切换身份自动清理不残留（ADR-016）；`gitid current` 可查看生效的重写。`--account host=用户名`（可重复）为凭据账号选择器：GCM 按用户名取对应凭据，切换身份同样自动清理（ADR-017）。

## 多账号与镜像推送

**HTTPS + GCM 多账号**（token 全程在钥匙串，gitid 不经手）：

```bash
gitid credential login github.com            # 触发 GCM 弹窗登录（推荐）
gitid credential set github.com corp-zhang   # 或粘贴 PAT（隐藏输入；同键再 set 即改密）
gitid add work --name 张三 --email z@corp.com --account github.com=corp-zhang
gitid use work                               # push 自动用 corp-zhang 的凭据
```

**SSH 多账号**（密钥归 `~/.ssh/config` 的 host 别名，gitid 只写重写规则）：

```bash
gitid add work --name 张三 --email z@corp.com \
  --insteadOf git@github.com:=git@github.com-work:   # 配合 ssh config 的 Host github.com-work
```

完整帮助：`gitid help`。

## 设计要点

- **档案与配置分离**：展示"当前身份"时用生效 name+email 对档案无状态匹配，永不与 git 实际配置漂移（ADR-002）
- **use 为全量覆盖**：切换到无签名身份时自动清理 `user.signingkey` / `commit.gpgsign`，不残留（ADR-003）；extras 与 insteadOf URL 重写同样切换即清理（ADR-016）
- **凭据零接触**：gitid 是凭据管道而非仓库——token 经 stdin→git credential 协议直达 helper/钥匙串，不落档案、不日志、不回显；身份只带"选哪个账号"的选择器（ADR-017）
- **原子写入**：档案 tmp+rename 落盘，权限 0600（ADR-007）

更多决策见 [docs/design-decisions.md](./docs/design-decisions.md)，对象模型见 [docs/object-model.md](./docs/object-model.md)，架构见 [docs/architecture.md](./docs/architecture.md)。

## 开发

```bash
cd cli && npm test     # e2e 21 例，沙箱 HOME 隔离，不触碰真实 ~/.gitconfig
```

## 桌面端（Electron + Vue3 + AntD）

与 CLI 共用同一份身份档案（`~/.config/gitid/config.json`），**CLI 的改动实时同步到界面**（档案监听广播），托盘可在不打开主窗口的情况下快速切换全局身份。

```bash
cd desktop
npm install
npm start          # 构建渲染层并启动（生产形态）
npm run dev        # 开发模式（vite 热更新 + electron）
npm run package     # 内网开发机：linux-arm64 AppImage + make-deb 离线装配 deb → desktop/dist/
npm run dist:linux  # 联网/CI：linux x64+arm64 的 AppImage/deb/rpm（electron-builder 原生目标）
npm run package:win # Windows x64 + arm64 NSIS 安装包 → desktop/dist/
```

配置档案位置：Linux/macOS 为 `~/.config/gitid/config.json`（XDG），Windows 为 `%APPDATA%\gitid\config.json`；`$GITID_CONFIG` 可覆盖。两形态均要求 `git` 在 PATH 上（桌面端只调用 git 自身，不内置）。

| 功能 | 说明 |
|------|------|
| 身份管理 | 新增/编辑/删除身份（含 insteadOf URL 重写与凭据账号选择器，多行成对编辑），一键切换全局身份（含签名键/重写/选择器自动清理，与 `gitid use` 同语义） |
| 仓库审计 | 扫描任意目录下的 git 仓库，可视化各仓库生效身份/缺失/手配状态与远程镜像（⊕）/凭据账号（@user）；每个仓库通过下拉独立选择「继承全局」或单独设置本地身份，选即生效；可一键开启/取消镜像推送（对应 `remote mirror/unmirror`）；可把目录与深度「设为默认」（与 CLI `scan --save` 共用） |
| 凭据 | 登录（触发 GCM 自身弹窗，token 不经 gitid）、凭据账号总览（选择器+登录线索 → helper 实存探测）、粘贴 PAT 保存/覆盖、删除；token 仅内存中转直达 helper，不落档案不回显（对应 `credential login/list/set/remove`） |
| 托盘快速切换 | 系统托盘列出全部身份，单击即切换全局身份；关闭主窗口后托盘常驻 |

架构：主进程 `desktop/main/`（窗口/托盘/IPC/档案监听）+ 渲染层 `desktop/renderer/`（Vue3 + AntD 4），业务核心直接复用 `cli/lib/core.js`（打包时经 `scripts/sync-core.mjs` 同步，一致性有测试保障）。

## 发版流水线

打版本 tag 并推送到两端即触发：

```bash
git tag v0.1.0 && git push github v0.1.0 && git push origin v0.1.0
```

- **GitHub Actions**（`.github/workflows/release.yml`）：沙箱测试（CLI e2e + 桌面端含 xvfb 全链路）→ 构建 **linux x64/arm64 × AppImage/deb/rpm**（6 个产物）与 **win x64/arm64 双架构合一 NSIS** → 自动创建 GitHub Release 并附产物。
- **gitee 侧**：仅接收代码与 tag 推送（不做 Release 镜像，正式产物以 GitHub Release 为准）；Gitee Go 原生流水线（`.workflow/release.yml`，需在仓库设置开通）做同源构建验证。
- **日常 CI**（`.github/workflows/ci.yml`）：push/PR 在 ubuntu/windows 双平台跑沙箱测试。

## 仓库结构

| 内容 | 位置 |
|------|------|
| CLI 实现 | `cli/`（bin/ 入口 + lib/ 共用核心 + test/） |
| 桌面端实现 | `desktop/`（main/ 主进程 + renderer/ Vue3 渲染层 + scripts/） |
| 设计文档 | `docs/`（设计决策 ADR-001~017 / 对象模型 / 架构） |
| CI/CD | `.github/workflows/`（Actions 发版/日常测试）+ `.workflow/`（Gitee Go） |

## License

[MIT](./LICENSE) © Xinyi Zhang
