# D0 需求澄清报告 — 增量「审计处置闭环 + SSH 签名 + 分发采用 + CLI 改善」

| 属性 | 值 |
|------|-----|
| 日期 | 2026-10-10 |
| 启动模式 | 增量 |
| 需求类型 | 增强（四组同一次增量） |
| 澄清状态 | 已完成（全部条件可从需求 + 现有架构推出） |

## 1. 启动模式判定

| 项 | 结论 |
|----|------|
| 模式 | **增量** |
| 依据 | INDEX 中 pipeline `gitid-bootstrap` / `gitid-desktop` 均为 complete；模块 cli / desktop 各阶段与 Gate 1/2 均为 complete/pass；无 `todo`/`in_progress` 中断阶段。`00-architecture` 等目录此前不存在，等价基线为知识库三节 + `docs/`。本次为已交付产品上的四组增强，不是冷启动或断点续跑。 |

## 2. 业务概念提取

| 维度 | 提取结果 |
|------|----------|
| 业务术语 | 身份、档案库、手配、配置缺失、本地覆盖、扫描结果、收编、批量应用、提交历史污染、mailmap 建议、环境体检、签名格式、自动更新、界面语言、命令补全、扫描报告 |
| 业务流程 | 扫描 → 识别 ✓/✗/⚠/◆/⊕ → 对 ⚠ 收编档案 / 对 ✗ 批量写入本地身份 →（可选）历史审计 → mailmap 建议；另：建档时声明签名格式；启动时体检/检查更新 |
| 业务角色 | 个人开发者（单机，2~5 套身份；与现有对象模型一致，无新角色） |
| 业务规则 | 见 §5；不得违反 P-01~P-06 |
| 业务数据 | Identity 增 `gpg.format`；新增只读对象：扫描报告、历史审计报告、体检报告、mailmap 建议；设置增 `locale` |

## 3. 与现有架构匹配

| 概念 | 匹配 | 对应项 | 后续 |
|------|------|--------|------|
| 身份 / 档案库 / 作用域 / 生效匹配 | 完全匹配 | Identity / Store / Scope / Effective（name+email 无状态匹配） | 变更管理：字段增强 |
| `use` 全量覆盖 / 原子写 | 完全匹配 | ADR-003/007，`applyIdentity` | 组合复用，不改语义 |
| 仓库扫描 ✓/✗/⚠/◆/⊕ | 部分匹配 | `scanRepos` 已有 status=ok/missing/unknown + hasLocal + mirror | 增强：导出 + 处置入口 |
| `import` | 部分匹配 | 现仅导入**全局** git 身份 | 增强：`--scan` 收编 ⚠ 手配 |
| `use` / `local` | 部分匹配 | `use [--local]` 已支持当前仓；无多仓 | 增强：`--repos` 批量本地写 |
| 签名键 / gpgsign | 部分匹配 | IDENTITY_KEYS 无 `gpg.format` | 增强：一等字段 |
| helper 实存探测 | 部分匹配 | `credential list` / 凭据页 | 增强：扩展为 `doctor` |
| 桌面仓库审计行内切换 | 部分匹配 | RepoView 单行 `applyLocal` | 增强：多选批量 + 收编 + 历史审计 + 导出 |
| 身份表单 | 部分匹配 | 有 signingkey/gpgsign，无 format | 增强：签名格式 |
| 分发 | 部分匹配 | 手动下 Release（ADR-013/015） | 增强：electron-updater（不改业务逻辑） |
| UI 文案 | 部分匹配 | 渲染层/README 中文为主 | 增强：en/zh + 英文 README |
| 提交历史身份审计 | 无匹配 | — | 新增 L3 |
| mailmap 建议 | 无匹配 | — | 新增 L4（只展示） |
| `doctor` | 无匹配（雏形在凭据探测） | — | 新增 L3 |
| shell 补全 | 无匹配 | — | 新增平台能力 |
| `scan --json` / md / csv | 无匹配 | 扫描仅人读表格 | 新增导出 |

**需求类型判定**：整体为**增强**（入口=BA，向下级联 AA/FL）。无新业务域；L1 仍是「Git 多身份管理」。

## 4. 已确认的边界与默认（从需求推出，未再追问）

1. **范围**：四组同一次增量，同时改 cli + desktop；业务逻辑只进 `cli/lib/core.js`（P-04）。自动更新、i18n、补全不进 core。
2. **批量应用作用域**：`--repos` / 桌面多选 = **仓库本地**写入（复用 `applyIdentity(..., 'local')`）。全局 `use` 语义不变。依据：对「选定 ✗ 仓库」下手；若写全局会误伤所有继承仓。用户文案里的 `gitid use work --repos` 解释为 `use`/`local` 的多仓本地扩展（现有 `use --local` ≡ `local`）。
3. **收编对象**：仅扫描 status=`unknown`（⚠ 手配）。已在档案（name+email 命中）则跳过。✗ 缺失无名邮，不可收编。
4. **收编 id**：沿用现 `import` 规则——邮箱 `@` 前本地部分规范化；冲突时 `--as` 或自动加后缀。同名同邮不同签名键：先到者胜，冲突告警（ADR-002 同名同邮不可区分）。
5. **`gpg.format`**：可选一等字段，值域 `openpgp|ssh|x509`；未声明则 `use`/`unset` 时 `--unset gpg.format`（与 signingkey 同一 IDENTITY_KEYS 模式）。不因有 signingkey 而默认 openpgp。
6. **`audit`**：只读 `git log` 聚合作者；对照档案标注命中/手配。`--expect <id>` 可选，把「作者邮箱 ≠ 期望身份邮箱」标为污染。mailmap **只打印建议**，不写 `.mailmap`、不 rewrite。
7. **`doctor`**：只读体检，不写 git 配置、不碰 token（P-03）。
8. **i18n**：本期渲染层 en/zh + 英文 README；CLI 人读输出仍中文。
9. **导出**：`scan --json` / `--format markdown|csv`；JSON 同时作为 `--repos-from` 的输入。
10. **不做什么**：守护进程、git 钩子、「已应用」标记、重写提交历史、把 token 写入档案/IPC、在 extras 里继续塞 format。

## 5. D0 完成判定

- [x] 全部业务概念已匹配或标注新增
- [x] 新增概念业务边界已确认
- [x] 用户类型已明确（个人开发者）
- [x] 核心实体与关系已识别
- [x] 无新单据状态机；扫描标记仍为匹配结果而非工作流
- [x] 关键业务规则已确认（含产品不变量）
- [x] 集成关系已明确（git log / ssh config / credential.helper / GitHub Releases；只读或标准更新通道）
