# PRD — 增量：审计处置闭环 + SSH 签名 + 分发采用 + CLI 改善

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 模块 | cli + desktop（同一次增量） |
| 功能类型 | 工具类（本机 CLI/桌面，无服务端聚合根持久化以外的流程单据） |

## 1. 业务目标（G1）

个人开发者扫描出 ✓/✗/⚠/◆/⊕ 后，能在同一工具内收编手配、批量补齐缺失，并核验仓库历史有没有混进另一套邮箱；身份可声明 SSH 等签名格式，切换时一起清理。分发与采用不改业务逻辑：桌面自动更新、英文 README + 渲染层 en/zh、shell 补全、扫描报告导出。

服务角色：个人开发者。价值：从「只看见问题」变成「能处置」，并堵住 SSH 签名半残状态。

## 2. 功能范围（G2）

### 做什么

- `import --scan`：收编扫描 ⚠ 手配为档案
- `use`/`local --repos` / `--repos-from`：对选定仓库批量本地全量覆盖
- 桌面仓库审计：多选批量应用、收编手配、导出报告、行内历史审计
- `audit`：git log 作者分布 + 档案对照 + 可选污染标记 + mailmap 建议（只展示）
- `doctor`：git 版本、helper 在位、SSH 别名 vs insteadOf、insteadOf 冲突
- Identity 一等字段 `gpg.format` = openpgp\|ssh\|x509，纳入 IDENTITY_KEYS 与 use 清理
- `scan --json` / `--format markdown|csv` / `--output`
- `completion bash|zsh|fish|pwsh`
- 桌面 electron-updater（GitHub Releases）
- 渲染层 en/zh + 英文 README

### 不做什么

- 守护进程、git 钩子、「已应用」标记（P-01）
- 重写提交历史或自动写入 `.mailmap`
- token 入档案/日志/IPC（P-03）
- 在 desktop 副本私改业务逻辑（P-04）
- 测试碰真实 `~/.gitconfig`（P-05）
- 把 `gpg.format` 继续塞进 extras
- 本期翻译 CLI 人读中文输出
- 全局 `use` 因 `--repos` 改写全部继承仓

## 3. 角色（G3）

| 角色 | 职责 |
|------|------|
| 个人开发者 | 建档、应用、扫描、处置、历史审计、体检、更新、切换语言 |

无审批流、无多租户权限。

## 4. 领域对象与关系（G4/G5）

| 对象 | 分类 | 关系 | 关键属性 |
|------|------|------|----------|
| Identity | 聚合根（本机档案） | 属于 Store | id, name, email, signingkey, gpgsign, **gpgFormat**, insteadOf, accounts, extra |
| Store | 聚合（文件） | 含 identities + settings | version, identities, settings, credentialHosts |
| Settings | 值对象 | 嵌于 Store | scanRoot, scanDepth, **locale** |
| ScanRow | 过程数据 | 由扫描派生 | path, status(ok/missing/unknown), hasLocal, identityId, remotes |
| ScanReport | 过程数据 | ScanRow 集合的导出形态 | format=json\|markdown\|csv |
| HistoryAuthor | 值对象 | 属于一次 AuditReport | name, email, count, matchId, polluted |
| AuditReport | 过程数据 | 引用仓库 + Store | authors[], mailmapSuggestion, expectId? |
| DoctorCheck | 值对象 | 属于 DoctorReport | id, level(ok/warn/fail), message, detail |
| DoctorReport | 过程数据 | 只读 | checks[], gitVersion, helper |
| CompletionScript | 过程数据 | 无持久化 | shell, text |

关系：Store 1—N Identity；ScanRow 通过 (name,email) 匹配 Identity；AuditReport 只读 git 对象库；DoctorReport 只读 git/ssh/helper；mailmap 建议不回写仓库。

被引用：Identity 被 use/local/scan/audit/doctor 引用；ScanReport JSON 被 `--repos-from` 引用。无跨系统服务接口。

## 5. 业务字段（T1 / T9）

### Identity（增量字段）

| 字段 | 必填 | 说明 |
|------|------|------|
| gpgFormat | 否 | openpgp / ssh / x509；空=档案不声明，应用时 unset `gpg.format` |

### 命令输入输出（工具类 T9）

见 D3 `cli-increment.md`。要点：

| 能力 | 输入 | 输出 |
|------|------|------|
| import --scan | 目录、depth、可选 --as | 新增/跳过/冲突清单；写 Store |
| use --repos | id + 路径或 JSON | 每仓 set/unset 变更；写各仓 local |
| audit | 仓库路径、可选 expect | 作者表 + mailmap 文本；无写 |
| doctor | 无 | 检查项表；无写 |
| scan 导出 | 目录 + format | 文件或 stdout |
| completion | shell 名 | 脚本文本 |

## 6. 查询与导出（T4/T5，扫描台账向）

扫描筛选维度：目录、深度、（导出后由消费方按 status 滤）。导出字段：status, identityId, hasLocal, name, email, remotes, path。格式：json / markdown / csv。

## 7. 状态流转（T2）

无单据状态机。扫描 status 是匹配结果，处置后需重新扫描才能看到新标记（P-01，不存「已处置」）。

## 8. 业务规则

1. `--repos` 强制 local；逐仓 `applyIdentity`，单仓失败不回滚其他仓。
2. `--repos-from` 默认只取 `status=missing`；可用 `--include-unknown` 显式扩大（默认关闭，避免误覆盖手配）。
3. `import --scan` 只收编 `unknown`；同 name+email 已在库则跳过；id 冲突则后缀 `-2`…；单条时可 `--as`。
4. 同 name+email 不同 signingkey/format：先到者胜，警告。
5. `gpg.format` 非法值拒绝写入；有 format 无 signingkey 允许（git 允许，但 doctor 可 warn）。
6. audit 只用 `git log`，不改 refs；mailmap 不落盘。
7. doctor / audit / completion / 导出不写身份档案（scan --save 除外，沿用已有）。
8. 自动更新与 i18n 不进 `core.js`。

## 9. 异常（N2）

| 场景 | 处理 |
|------|------|
| 仓库路径不是 git 仓 | 该行失败，继续其余 |
| JSON 不是 scan 结构 | 退出码 1 |
| 无 ⚠ 可收编 | 成功，提示 0 条 |
| git 不在 PATH | doctor fail 项；audit 退出码 2 |
| 更新检查失败 | 静默或非阻断提示，不挡主功能 |

## 10. 非功能（N1）

扫描深度默认 6、最大 12（已有）。audit 对超大仓库只聚合作者，不拉 patch。补全脚本零依赖静态生成。测试必须沙箱 HOME + GITID_CONFIG。

## 11. 领域建模结果（D2-2）

| 项目 | 内容 |
|------|------|
| 本域名称 | Git 多身份管理 |
| 领域分层 | 核心域（档案/应用/扫描处置/历史审计）；支撑（凭据/镜像/体检）；通用（更新/i18n/补全） |
| 聚合根 | Identity（经 Store 文件一致性边界） |

### 领域对象清单

| 对象名 | 分类 | 与上级关系 | 核心业务字段 | 关键枚举字段 | 备注 |
|--------|------|-----------|------------|------------|------|
| Identity | 聚合根 | Store 内 | id,name,email,signingkey,gpgsign,gpgFormat,insteadOf,accounts,extra | gpgFormat | |
| Store | 实体（文件） | — | identities, settings | — | |
| Settings | 值对象 | Store | scanRoot,scanDepth,locale | locale=zh\|en | |
| ScanRow | 过程数据 P2 | — | path,status,effective | status | |
| HistoryAuthor | 值对象 | AuditReport | name,email,count | match/polluted | |
| DoctorCheck | 值对象 | DoctorReport | id,level,message | level | |
| ScanReport/AuditReport/DoctorReport | 过程数据 P4 | — | 导出/展示载体 | — | |

### 子流程 I/O 契约

无审批/变更申请子流程。

### 关联领域对象

| 关联领域对象 | 所属业务域 | 关联字段 | 需获取信息 | 触发关系 | 映射模式 |
|------------|--------|---------|----------|---------|---------|
| git 配置/对象库 | 外部（git） | 无（读命令） | name/email/log/config | 扫描/应用/审计 | ACL：只经 core 封装 |
| credential helper | 外部 | host,username | 是否实存 | 凭据/doctor | 遵奉者（协议） |
| GitHub Releases | 外部 | 版本 | 安装包 | 自动更新 | 遵奉者（electron-updater） |

### 过程数据分类表

| 数据项 | 类别 | 处理方式 |
|--------|------|---------|
| 扫描筛选/多选 | P1 | 不持久化 |
| 状态标签文案 | P2 | 前端/CLI 渲染 |
| mailmap 文本 | P2 | 只展示 |
| JSON/CSV 报告 | P4 | stdout 或文件 |
| 补全脚本 | P4 | stdout |
| 更新进度 | P3 | 主进程 UI |

## 12. PRD 完备性检查

功能类型：工具类 + 扫描台账导出。

| # | 结果 |
|---|------|
| G1 业务目标 | 通过 |
| G2 功能范围 | 通过（含不做什么） |
| G3 角色 | 通过 |
| G4 领域对象 | 通过 |
| G5 对象关系 | 通过 |
| T1 业务字段 | 通过（gpgFormat 等） |
| T1a 被引用 | 通过（JSON 被 --repos-from 引用；无对外 HTTP） |
| T9 输入输出 | 通过 |
| T4/T5 扫描导出 | 通过 |
| T2/T3 | N/A 无流程单据 |
| N1–N3 | 已补充，不阻塞 |

**结论**：可进入 D3。

## 更新记录

| 版本 | 日期 | 更新说明 |
|------|------|---------|
| v1.0 | 2026-10-10 | 增量 PRD 初稿 |
