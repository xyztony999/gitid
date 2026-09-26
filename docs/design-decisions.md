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
| ADR-016 | **身份扩展与远程镜像管理**：① extras/insteadOf 纳入 use 全量覆盖——切换时按档案清除上一身份的 extra 与 URL 重写（本身份未再定义的），`unset` 连带清除匹配档案的同类键，变更清单如实展示（补齐 ADR-003 对 extra 的缺口）；② insteadOf 为 Identity 一等字段（成对校验、去重、空数组=清除），永不落密钥，凭据归 GCM/SSH；③ 远程镜像管理为 per-repo 能力：scan 展示远程与镜像状态，`remote mirror` 以多个 `remote.<name>.pushurl` 实现 `git push` 双推（remote 为仓库私有概念，不进全局 profile）。读取 URL 重写时按 git 小写化变量名匹配 | 镜像加速/多账号协议切换安全可逆；URL 重写这类可能重定向 push 的规则在 CLI/desktop 变更输出中显式可见，不残留、不静默；凭据零接触（源码/示例/测试不含凭据字面量） |
| ADR-017 | **凭据管道（conduit），不做凭据仓库**：① Identity 携带凭据账号选择器 `accounts: [{host, username}]`，落为 `credential.https://<host>.username`（GCM 按 username 取凭据），随 use 全量覆盖切换清理（ADR-016 机制）；② `credential` 命令组走 git credential 协议：`login`（交互 fill→GCM 自身弹窗→approve 回写）、`set`（token 经隐藏输入/stdin→approve，同键覆盖即修改）、`remove`（reject）、`list`（选择器→helper 实存只读探测，探测关闭全部交互通道）；③ 不变量：token 生命周期=stdin/输入→进程内存→helper stdin→密钥服务，不落 config.json/日志/IPC 载荷、不回显；展示永远只有 host→username，任何能力不含查看 token | 凭据选择与创建/修改/删除全覆盖，而 gitid 威胁模型不变成密钥库；凭据本体统一归 GCM/libsecret/store 等 helper 与 OS 钥匙串；credential 协议无枚举操作，list 只能以选择器为线索（如实声明边界）；测试用 `store --file <沙箱>` + 显式假 token，源码/测试零可用凭据字面量 |
