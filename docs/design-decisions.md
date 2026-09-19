# gitid 设计决策（ADR）

| 编号 | 决策 | 影响 |
|------|------|------|
| ADR-001 | **零依赖 Node 单文件 CLI**（`cli/bin/gitid.js`，Node ≥ 18） | `npm install -g` 即用，无构建链、无供应链依赖；代价是自实现参数解析/CJK 对齐表格（约百行），可接受 |
| ADR-002 | **档案与 git 配置分离，git 为唯一事实源**：Store 只存身份档案；展示"当前身份"时用生效 (name, email) 对档案做**无状态精确匹配**，不持久化"已应用"标记 | 不会出现记录与实际配置漂移；用户手改 `.gitconfig` 后 `current`/`list` 仍准确；代价是同名同邮身份不可区分（多身份同 name+email 视为同一身份） |
| ADR-003 | **use 为全量覆盖语义**：name/email 必写；signingkey 无则 `--unset`，gpgsign 非 true 则 `--unset`；extra 键逐条写入 | 切换身份后不残留上一身份的签名配置（signed→plain 切换自动清理）；意味着"保留手配的其他键"不可行，需用 `--set` 纳入档案管理 |
| ADR-004 | **local 优先于 global 的展示模型**：`current` 按 git 语义（本地覆盖 → 全局回退）解析并标注每键来源；`use`（全局）后若 cwd 仓库存在本地覆盖则提示"不影响该仓库" | 用户可预期每个仓库的实际提交身份；不做任何后台钩子/自动切换 |
| ADR-005 | **bin 双注册 `gitid` + `git-id`** | 同时获得 `git id list` 子命令体验；`git id` 与 git 内置命令无冲突 |
| ADR-006 | **测试沙箱 = 独立 HOME + `$GITID_CONFIG`**（不用 `GIT_CONFIG_GLOBAL`，因 git 2.32 才引入，本机 2.25） | e2e 全程不触碰真实 `~/.gitconfig`；`GIT_CONFIG_NOSYSTEM=1` 隔离系统级配置 |
| ADR-007 | **配置档案原子写入**（tmp + rename，mode 0600） | 中断不产生半写文件；邮箱属个人信息，收紧文件权限 |
| ADR-008 | **scan 不深入仓库内部**（发现 `.git` 即停），跳过 node_modules 等目录，默认深度 6 | 大目录扫描可控；嵌套 submodule 场景需显式指定子目录再扫 |
| ADR-009 | **CLI 与桌面端共用单一核心**：`cli/lib/core.js` 为唯一事实源；桌面打包经 `scripts/sync-core.mjs` 同步副本（asar 内可用），一致性由 desktop 测试逐字节比对保障 | 双端行为永不漂移（切换/扫描语义完全一致）；代价是改 core 需重新同步（prestart/prepackage 已自动化） |
| ADR-010 | **桌面端 Electron 33 + Vue3 + Ant Design Vue 4** | 复用成熟前端生态；无 Rust/Qt 工具链要求；代价为安装包 ~130MB |
| ADR-011 | **桌面端无自有状态**：身份数据只存档案 + git config；主进程 `fs.watchFile` 监听档案与 `~/.gitconfig`，变更广播刷新界面与托盘 | CLI 侧任何改动实时同步到桌面端；桌面端崩溃/关闭不留下任何中间态；不引入守护进程或 git 钩子 |
| ADR-012 | **渲染层经 contextBridge 唯一桥**（nodeIntegration 关闭，contextIsolation 开启），IPC 全部 `invoke` 返回 `{ok, data\|error}` | 安全基线（无 Node 泄漏到页面）；错误处理统一，Vue 层只处理展示 |
| ADR-013 | **分发双格式：AppImage（主）+ deb（`scripts/make-deb.mjs` 离线装配）**，均 arm64 | AppImage 免安装免 root、跨麒麟/统信通用；deb 适配麒麟 V10（deb 系）桌面生态，含桌面入口/图标/`/usr/bin/gitid`；不走 electron-builder 的 deb 目标（fpm 需联 github 且仅 x86，内网不可用） |
| ADR-014 | **跨平台适配（Windows）**：配置档案目录按平台分置（win32 用 `%APPDATA%\gitid`，其余维持 XDG，`$GITID_CONFIG` 恒最高优先）；`~` 展开同时接受 `/` 与 `\`；`saveStore` 在 win32 rename 遇 EPERM/EACCES 时回退直写；dev 脚本 win32 下以 shell 启动 `npx`；分发新增 win-x64 NSIS（`package:win`） | Windows 本机可开发/安装/分发；测试沙箱增设 `USERPROFILE`/`APPDATA`（Node 在 Windows 忽略 `HOME`）；非 Windows 行为零变化 |
| ADR-015 | **发版全平台矩阵，CI 走 electron-builder 原生目标**：linux x64/arm64 × AppImage/deb/rpm + win x64/arm64 NSIS（`dist:linux` / `package:win` 双架构）。deb/rpm 在 CI 由 electron-builder 原生目标产出（fpm 经 app-builder 联网下载）；内网开发机保留 `package` + make-deb 离线装配路径（ADR-013 场景不变） | 一次 tag 发布覆盖主流桌面全架构；rpm 仅在 CI 产出；本地内网构建不受影响，两条路径产物语义一致（同一 unpacked 装配） |
