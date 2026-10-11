# gitid CLI 命令契约（增量：includeIf 目录绑定）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-11 |
| 模块 | cli |
| 功能类型 | 工具类 |
| 对照规格 | profiles/node-cli/skills/cli-specs/SKILL.md |

退出码通例：0=成功；1=用户/参数错误；2=git/IO 错误。

IDENTITY_KEYS 不变：`user.name` `user.email` `user.signingkey` `commit.gpgsign` `gpg.format`。snippet 另含 extra / insteadOf / accounts，语义与 `applyIdentity` 相同（P-02/P-03）。

配置目录记为 `<gitid-dir>`（与 `config.json` 同根）。托管文件：

- `<gitid-dir>/includes.gitconfig`
- `<gitid-dir>/snippets/<id>.gitconfig`

`~/.gitconfig` 至多一条 `include.path=<gitid-dir>/includes.gitconfig`，禁止把 includeIf 写进正文。

---

## bind

- 用途：把 Identity 绑定到一棵目录树并立即物化 include 片段（对象：Identity.gitdirs / IncludeSnippet）
- 参数：| 名称 | 必填 | 说明 |
  | id | 是 | 档案 id |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --dir | 路径 | 无 | **必填**。相对路径相对 cwd resolve；支持 `~` |
- 输入来源：参数
- 输出：变更清单行：`set gitdirs`、`write snippet`、`write includes`、`ensure hook`（已存在则 `keep hook`）
- 退出码：0；1=id 不存在 / 缺 --dir / 路径已被其它身份占用；2=写文件或 git 失败
- 副作用：写 Store.identities[id].gitdirs；写 snippet（整文件）；按全库 gitdirs 重生 includes.gitconfig；必要时给全局 gitconfig 增加 include 钩子。不写 user.* 到 ~/.gitconfig 正文，不写各仓 local
- 全量覆盖语义：snippet 按 P-02 整文件重写该身份键；不清理其它身份 snippet
- 规则：规范化=展开 `~` + resolve + 正斜杠 + 末尾 `/`。win32 条件键 `gitdir/i:<path>`，其它平台 `gitdir:<path>`。目录不存在仍可绑定

---

## unbind

- 用途：解除目录绑定并回收片段
- 参数：| id | 否 | 与 --dir 至少有一；仅 id 则解绑该身份全部 |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --dir | 路径 | 无 | 只解这一条；无 id 时按规范化路径反查身份 |
- 输入来源：参数
- 输出：变更清单：`unset gitdirs`、`rewrite includes`、`remove snippet`（该身份已无绑定时）
- 退出码：0；1=id 不存在 / 两者皆缺 / 路径未绑定 / --dir 反查到多个（不应发生，若发生则 1）；2=IO
- 副作用：更新 Store.gitdirs；重生 includes.gitconfig；无剩余绑定则删 snippet。不改 global/local 已应用键，不删除 include 钩子（可留空 includes 文件）
- 全量覆盖语义：不应用身份

---

## use / local（变更）

- 用途：既有全量覆盖写入
- 变更：
  - **全局** `use <id>`（无 --local / --repos）：成功写入全局后，若该身份 `gitdirs.length > 0`，按当前档案刷新其 snippet（P-02），不增删 gitdirs、不改其它身份片段
  - `use --local` / `local` / `--repos` / `--repos-from`：**不**写 includeIf / snippet
- 输出：既有变更清单后可多一行 `refresh snippet <id>`
- 其余契约同 `cli-increment.md`

---

## add（变更）

- 用途：既有新建/更新档案
- 变更：更新已有身份且该身份已有 gitdirs 时，保存后刷新其 snippet。无 `--dir` 选项
- 副作用：仍不写 git 全局/本地键；仅可能刷新 snippet / includes（内容变、绑定不变）

---

## remove（变更）

- 用途：删除档案
- 变更：若 `gitdirs[]` 非空，先执行与 `unbind <id>` 相同的片段回收，再删档案
- 输出：可含回收行 + `removed <id>`
- 副作用：不 unset 全局/本地 IDENTITY_KEYS

---

## list（变更）

- 用途：列出档案
- 变更：人读表增加「绑定目录」列（多路径以 `; ` 分隔；无则为空）。JSON（若已有）含 `gitdirs`
- 副作用：无

---

## current（变更）

- 用途：查看 cwd 生效身份与来源
- 变更：每条展示键标注 `source=local|includeIf|global`；总出来源取 user.name / user.email 的 origin（两者不一致时分别标注）。includeIf 时打印 `originFile`
- 判定：`git config --show-origin --get <key>`（**不用** `--show-scope`）
  - origin 文件为 `<repo>/.git/config` → local
  - origin 为 `<gitid-dir>/snippets/*` 或其它被 include 的文件（非主 gitconfig 正文）→ includeIf
  - origin 为主 `~/.gitconfig`（或 GIT_CONFIG_GLOBAL 指向的正文）→ global
- 退出码：沿用既有
- 副作用：无
- 帮助文案：由「本地覆盖 → 全局回退」改为「本地覆盖 → 目录绑定 → 全局回退」

---

## scan（变更）

- 用途：只读扫描
- 变更：
  - 每行增 `source`、`originFile`（对 effective user.name 的 origin；email 若不同可另给 `originFileEmail`，默认同源则省略）
  - 人读状态列：source=includeIf 时附加 `▣`（可与 ✓/⚠ 同列，如 `✓ ▣`）
  - summary 增 `withIncludeIf`
  - json / markdown / csv 增加 `source,originFile` 列
- 退出码/副作用：不变（仅 --save 写 settings）
- 全量覆盖语义：无

---

## completion（变更）

- 用途：静态补全脚本
- 变更：命令列表增加 `bind` `unbind`；`bind`/`unbind` 补 `--dir`；身份 id 补全沿用既有档案 id 源（若有）

---

## import / audit / doctor / unset / remote / credential

- 无本增量契约变更。`unset --local` 之后生效来源按 git 回退到 includeIf 或 global（展示层已由 current/scan 覆盖）

---

## 枚举

| 枚举 | 值 | 来源 |
|------|----|------|
| configSource | local, includeIf, global, none | 本增量 |
| scanMark | ✓, ✗, ⚠, ◆, ⊕, ▣ | ▣ 本增量 |

---

## 错误码（CLI 文案）

| 场景 | 退出 | 文案要点 |
|------|------|----------|
| 缺 --dir | 1 | bind 需要 --dir |
| 路径已被占用 | 1 | 目录已绑定到 \<id\>，请先 unbind |
| 路径未绑定 | 1 | 未找到该目录绑定 |
| id 不存在 | 1 | 与 getIdentity 相同 |
| 写托管文件失败 | 2 | 无法写入 include 片段 |

---

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|----------|------|
| v1.0 | 2026-10-11 | initial / interface_added | bind/unbind；use/add/remove/list/current/scan/completion 变更 |
