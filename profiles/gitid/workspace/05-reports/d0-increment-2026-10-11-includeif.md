# D0 需求澄清报告 — 增量「目录级 includeIf.gitdir 绑定」

| 属性 | 值 |
|------|-----|
| 日期 | 2026-10-11 |
| 启动模式 | 增量 |
| 需求类型 | 增强（入口=BA，向下级联 AA/FL） |
| 澄清状态 | 已完成（决定点均可从方案切片 + 现有 ADR/不变量推出，未再追问） |

## 1. 启动模式判定

| 项 | 结论 |
|----|------|
| 模式 | **增量** |
| 依据 | INDEX 中 `gitid-bootstrap` / `gitid-desktop` 均为 complete；上一轮 `gitid-increment-audit-loop` 的 cli/desktop 各阶段与 Gate 1/2 均为 complete/accepted。`00-architecture` 与 `02-detailed` 已有基线。本次是已交付产品上的**另一次**增强，不是冷启动，也不是上一轮断点续跑。 |
| 变更入口 | BA（L2「身份生效」新增 L3「目录级身份绑定」；扫描标记与删除/应用活动增强） |

## 2. 业务概念提取

| 维度 | 提取结果 |
|------|----------|
| 业务术语 | 目录绑定、目录树、include 片段、include 钩子、生效来源（local / includeIf / global）、绑定标记 |
| 业务流程 | 选定身份 → 绑定目录树 → gitid 物化 snippet + includeIf → 该树下新仓由 git 自行命中；解绑则回收片段；current/scan 按 git 真实来源展示 |
| 业务角色 | 个人开发者（无新角色） |
| 业务规则 | 见 §4；不得违反 P-01~P-06 与 ADR-002/003/004/011/017 |
| 业务数据 | Identity 增可选 `gitdirs[]`；ScanRow/Current 增 `source`；gitid 托管的 includes/snippet 文件（非档案正文） |

## 3. 与现有架构匹配

| 概念 | 匹配 | 对应项 | 后续 |
|------|------|--------|------|
| 身份 / 档案库 / name+email 匹配 | 完全匹配 | Identity / Store / Effective | 字段增强：`gitdirs[]` |
| `use` 全量覆盖 / 原子写 | 完全匹配 | ADR-003/007，`applyIdentity` | snippet 复用同一套键与清理语义 |
| Scope `global \| local` | 部分匹配 | 对象模型 Scope 仅两层 | 增强：展示与扫描增加 includeIf 中间层；写入命令仍分 global / local / bind |
| `current` 来源标注 | 部分匹配 | ADR-004：本地覆盖 → 全局回退 | 增强：local > includeIf > global |
| `scan` ✓/✗/⚠/◆/⊕ | 部分匹配 | ScanRow.status + hasLocal + mirror | 增强：目录绑定标记与 `source` |
| 删除身份「不改 git」 | 部分匹配 | BA 2.1.1.4 | 修正：不改 global/local 已应用键；**回收**该身份的 gitid 托管 include 片段 |
| 监听目录自动切身份 | 无匹配且明确不做 | ADR-002/004/011 | 不进入范围 |
| 目录级生效 / bind / unbind | 无匹配 | — | 新增 L3 |

**需求类型判定**：整体为**增强**。无新业务域；L1 仍是「Git 多身份管理」。

## 4. 已确认的边界与默认（从方案 + ADR 推出）

1. **命令**：`gitid bind <id> --dir <路径>` / `gitid unbind <id> [--dir <路径>]`；`unbind <id>` 不解绑指定目录时回收该身份全部绑定。另支持 `unbind --dir <路径>`（按规范化路径反查身份）。
2. **档案**：Identity 可选 `gitdirs[]`（规范化绝对路径，以 `/` 结尾表示目录树前缀）。`add` 不提供 `--dir`；只有 bind/unbind 写该字段。
3. **物化时机**：`bind` **立即**生成 snippet + includeIf（否则「绑定此目录树」无可见效果）。`use`（全局）以及档案字段更新：只**刷新该身份**已有 snippet 内容，不增删绑定。`use --local` / `--repos` 不写 includeIf。
4. **文件布局（不把目录规则塞进 ~/.gitconfig 正文）**：
   - `~/.gitconfig` 最多一条稳定 include 钩子：`include.path = <gitid 配置目录>/includes.gitconfig`
   - 全部 `includeIf.gitdir` 写在 `includes.gitconfig`
   - 身份键写在 `snippets/<id>.gitconfig`
   - 配置目录与 `config.json` 同根（含 `$GITID_CONFIG` /  win32 `%APPDATA%\gitid`）
5. **生效仍由 git 计算**：local > includeIf > global。`current`/`scan` 用 `git config --show-origin` 判来源（`--show-scope` 会把 includeIf 仍报成 global，不可用）。
6. **snippet 内容**：与 `applyIdentity` 同一 IDENTITY_KEYS + extra / insteadOf / accounts；未声明键按 P-02 不出现在 snippet（整文件重写，不残留）。token 永不写入（P-03）。
7. **路径冲突**：规范化后的**同一路径**不可绑到两个身份（退出 1，提示先 unbind）。祖先/后代重叠允许；`includes.gitconfig` 按路径长度升序排列，使更具体的后写、同键胜出。
8. **Windows**：gitdir 条件用 `gitdir/i:`；路径正斜杠；`~` 展开沿用 ADR-014。
9. **删除身份**：不改 global/local 已应用的 user.\* 等键；若仍有 `gitdirs[]` 则先回收该身份全部 include 片段再删档案。
10. **scan 标记**：status 仍为 ok/missing/unknown；新增来源 `source=local|includeIf|global|none`。includeIf 人读标记 `▣`（可与 ✓/⚠ 并存；有本地覆盖时 source=local，仍只标 ◆）。JSON 增 `source`、`originFile`。
11. **桌面**：仓库审计页「绑定此目录树」= 把**当前扫描根**绑到所选身份；已绑定则提供「解除目录绑定」。身份列表只读展示 gitdirs，可点除单条绑定。表单不手填 gitdirs。
12. **监听**：桌面可把 watch 扩到 `includes.gitconfig` 与 `snippets/`（主进程，不进 core），以便 CLI bind 后刷新。这不是「按目录自动切身份」。
13. **明确不做**：守护进程、git 钩子、监听工作树自动切换身份、把 includeIf 块写入 `~/.gitconfig` 正文、改写 `use` 的 global/local 语义、在 snippet/档案/IPC 落 token。

## 5. D0 完成判定

- [x] 全部业务概念已匹配或标注新增
- [x] 新增概念业务边界已确认
- [x] 用户类型已明确（个人开发者）
- [x] 核心实体与关系已识别
- [x] 无新单据状态机；绑定是声明 + 物化，生效仍由 git 计算
- [x] 关键业务规则已确认（含产品不变量）
- [x] 集成关系已明确（仅 git include / includeIf；gitid 生成/回收片段）
