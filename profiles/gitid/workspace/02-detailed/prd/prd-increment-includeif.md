# PRD — 增量：目录级 includeIf.gitdir 绑定

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-11 |
| 模块 | cli + desktop（同一次增量） |
| 功能类型 | 工具类 |

## 1. 业务目标（G1）

个人开发者希望「`~/work` 下所有仓默认公司身份，`~/oss` 默认个人」，新 clone 不必再逐仓 `use --local`。gitid 用 git 原生 `includeIf.gitdir` 做到这一点：只生成/回收 include 片段，生效仍由 git 计算。

服务角色：个人开发者。价值：上一轮解决「已有仓库怎么收」，本轮解决「以后别再散」。

## 2. 功能范围（G2）

### 做什么

- `gitid bind <id> --dir <路径>`：档案写入 `gitdirs[]` 并立即物化 snippet + includeIf
- `gitid unbind <id> [--dir]` / `unbind --dir <路径>`：解除绑定并回收片段
- Identity 可选 `gitdirs[]`（规范化绝对目录前缀）
- `use`（全局）与档案字段更新：刷新该身份已有 snippet 内容，不增删绑定
- `current` / `scan`：按 `git config --show-origin` 展示 local | includeIf | global；scan 人读标记 `▣`
- 删除身份：先回收该身份全部托管片段，不改 global/local 已应用键
- 桌面仓库审计：「绑定此目录树」「解除目录绑定」；身份列表只读展示 gitdirs 并可点除
- `completion` 覆盖 bind/unbind
- 桌面 watch 可扩到 includes/snippets（主进程，不进 core）

### 不做什么

- 守护进程、git 钩子、监听工作树自动切身份（P-01 / ADR-002/004/011）
- 把 `includeIf` 块或目录规则写入 `~/.gitconfig` 正文（仅允许一条稳定 include 钩子）
- 改变 `use` 的 global / `--local` / `--repos` 语义
- token 入档案 / snippet / 日志 / IPC（P-03）
- 在 desktop 副本私改业务逻辑（P-04）
- 测试碰真实 `~/.gitconfig`（P-05）
- 同一规范化路径绑到两个身份（拒绝，不静默覆盖）

## 3. 角色（G3）

| 角色 | 职责 |
|------|------|
| 个人开发者 | 绑定/解绑目录树，查看真实来源，继续建档与扫描处置 |

无审批流、无多租户权限。

## 4. 领域对象与关系（G4/G5）

| 对象 | 分类 | 关系 | 关键属性 |
|------|------|------|----------|
| Identity | 聚合根 | 属于 Store | 既有字段 + **gitdirs[]** |
| Store | 聚合（文件） | 含 identities + settings | 与托管 include 文件同配置目录 |
| GitdirBinding | 值对象 | Identity.gitdirs 元素 | 规范化绝对路径（`/` 结尾） |
| IncludeHook | 过程数据（生成物） | 全局 gitconfig 一条 include.path | 指向 includes.gitconfig |
| IncludeSnippet | 过程数据（生成物） | 每身份一个文件 | IDENTITY_KEYS + extra/insteadOf/accounts |
| ScanRow | 过程数据 | 扫描派生 | 既有 + **source** + **originFile** |
| Effective | 值对象 | git 计算 | name/email + source |

关系：Store 1—N Identity；Identity 0—N GitdirBinding；绑定物化 IncludeSnippet；git 按 local > includeIf > global 计算 Effective；ScanRow/current 只读 git 来源。

被引用：`gitdirs[]` 被 bind/unbind/use/remove/scan/current 使用。无跨系统 HTTP。

## 5. 业务字段（T1 / T9）

### Identity（增量字段）

| 字段 | 必填 | 说明 |
|------|------|------|
| gitdirs | 否 | 字符串数组；规范化绝对路径且以 `/` 结尾；空=无目录绑定 |

### 文件布局

| 路径 | 职责 |
|------|------|
| `<gitid-dir>/config.json` | 档案（含 gitdirs） |
| `<gitid-dir>/includes.gitconfig` | 全部 includeIf.gitdir → snippet |
| `<gitid-dir>/snippets/<id>.gitconfig` | 该身份键（整文件重写） |
| `~/.gitconfig` | 至多一条 `include.path` 钩子，无目录规则正文 |

`<gitid-dir>` 与现有档案目录相同（`$GITID_CONFIG` 最高优先；win32 `%APPDATA%\gitid`）。

### 命令输入输出（工具类 T9）

见 D3 `cli-includeif.md`。要点：

| 能力 | 输入 | 输出 |
|------|------|------|
| bind | id + --dir | 变更清单（档案 + 片段 + 钩子）；写 Store 与托管文件 |
| unbind | id 和/或 --dir | 回收清单 |
| current | cwd | 身份 + source + originFile |
| scan | 目录 | 行增 source/originFile；▣ |
| use（全局） | id | 既有变更 + 若有 gitdirs 则刷新 snippet |
| remove | id | 删档案；先回收片段 |

## 6. 查询与导出（T4/T5）

扫描筛选维度不变。导出字段在既有列上增加 `source,originFile`。格式仍 json / markdown / csv。

## 7. 状态流转（T2）

无单据状态机。绑定是声明 + 物化；是否生效以 git 读取结果为准（P-01，不存「已应用」）。

## 8. 业务规则

1. **bind 立即物化**。路径：展开 `~`、`path.resolve`、正斜杠、补末尾 `/`。目录当时不存在仍允许登记（与 scanRoot 一致）。
2. **路径唯一**：规范化后的同一字符串不可属于两个身份；退出 1。祖先/后代重叠允许；includes.gitconfig 按路径长度升序，使更具体者后写。
3. **Windows**：includeIf 条件用 `gitdir/i:`（ADR-014）。
4. **snippet = applyIdentity 全量覆盖**（P-02）：整文件重写；未声明键不出现。accounts 只写 username 选择器，不写 token（P-03）。
5. **use --local / --repos** 不写 includeIf。全局 `use` 与 `add` 更新字段时只刷新该身份 snippet。
6. **remove**：有 gitdirs 则先等价 unbind 全部，再删档案；不 unset 全局/本地 user.*。
7. **来源判定**：`git config --show-origin`（不用 `--show-scope`）。origin 为仓库 `.git/config` → local；为 gitid snippet 或其它被 include 的文件 → includeIf；为用户主 gitconfig 正文 → global；无名邮 → none。
8. **scan 标记**：status 仍 ok/missing/unknown；▣ 仅当 source=includeIf。有本地覆盖时 source=local，只标 ◆。
9. **钩子幂等**：已存在指向 includes.gitconfig 的 include.path 则不重复写；不改用户其它 ~/.gitconfig 内容。
10. **Store 为绑定声明源**：bind/unbind/remove/use-refresh 后按全部 identities.gitdirs 重生 includes.gitconfig。
11. 业务逻辑只进 `cli/lib/core.js`（P-04）。

## 9. 异常（N2）

| 场景 | 处理 |
|------|------|
| id 不存在 | 退出 1 |
| --dir 缺失（bind） | 退出 1 |
| 路径已被另一身份绑定 | 退出 1，指出占用 id |
| unbind 路径未绑定 | 退出 1 |
| 写 snippet / 钩子失败 | 退出 2；档案写入遵循先物化成功再 saveStore，失败不留下半套绑定 |
| cwd 非仓库（current） | 仅能报全局/includeIf（无 local）；行为与现网一致并标 source |
| 用户手改 includes.gitconfig | 下次 bind/unbind/use-refresh 按 Store 重生 |

## 10. 非功能（N1）

snippet 与 includes 原子写（tmp+rename，mode 0600，win32 沿用 ADR-014 回退）。测试必须沙箱 HOME + GITID_CONFIG，断言不写真实 ~/.gitconfig。扫描多仓增加 --show-origin 调用，保持现有深度上限。

## 11. 领域建模结果（D2-2）

| 项目 | 内容 |
|------|------|
| 本域名称 | Git 多身份管理 |
| 领域分层 | 核心域（档案/应用/目录绑定/扫描） |
| 聚合根 | Identity（经 Store 文件一致性边界） |

### 领域对象清单

| 对象名 | 分类 | 与上级关系 | 核心业务字段 | 关键枚举字段 | 备注 |
|--------|------|-----------|------------|------------|------|
| Identity | 聚合根 | Store 内 | 既有 + gitdirs | — | gitdirs 仅 bind/unbind 写 |
| GitdirBinding | 值对象 | Identity 内 | path | — | 规范化前缀 |
| IncludeSnippet | 过程数据 P4 | 生成物 | 身份键 | — | gitid 托管 |
| ScanRow | 过程数据 P2 | — | 既有 + source, originFile | source | |
| Effective | 值对象 | git 计算 | name,email,source | source | |

### 子流程 I/O 契约

无审批/变更申请子流程。

### 关联领域对象

| 关联领域对象 | 所属业务域 | 关联字段 | 需获取信息 | 触发关系 | 映射模式 |
|------------|--------|---------|----------|---------|---------|
| git 配置（include / includeIf） | 外部（git） | 无 | 生效键与 --show-origin | 绑定/扫描/current | ACL：只经 core 封装 |

### 过程数据分类表

| 数据项 | 类别 | 处理方式 |
|--------|------|---------|
| 扫描根（桌面绑定目标） | P1 | 不另存绑定专用设置 |
| ▣ / source 文案 | P2 | CLI/桌面渲染 |
| includes/snippet 文件 | P4 | gitid 生成/回收 |
| 钩子是否已写 | P7 | 幂等探测 |

## 12. PRD 完备性检查

功能类型：工具类。

| # | 结果 |
|---|------|
| G1 业务目标 | 通过 |
| G2 功能范围 | 通过（含不做什么） |
| G3 角色 | 通过 |
| G4 领域对象 | 通过 |
| G5 对象关系 | 通过 |
| T1 业务字段 | 通过（gitdirs、source） |
| T1a 被引用 | 通过（无对外 HTTP；scan JSON 增字段） |
| T9 输入输出 | 通过 |
| T2/T3 | N/A 无流程单据 |
| N1–N3 | 已补充，不阻塞 |

**结论**：可进入 D3。

## 更新记录

| 版本 | 日期 | 更新说明 |
|------|------|---------|
| v1.0 | 2026-10-11 | 目录级 includeIf 绑定增量 PRD |
