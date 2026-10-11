# gitid 桌面端 IPC 契约（增量：includeIf 目录绑定）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-11 |
| 对照规格 | profiles/electron-vue3/skills/desktop-specs/SKILL.md |

既有通道保持 `{ok, data|error}`。业务通道经 main 调 `core.js`。凭据通道零 token（P-03）。

---

## ipc:identity:bind（新增）

- 用途：绑定目录树并立即物化
- 方向：renderer → main（invoke）
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | id | string | 是 | 档案 |
  | dir | string | 是 | 目录树根（桌面传当前扫描根） |
- 响应：`{ok, data: { gitdirs, changes } }`
- 副作用：写 Store.gitdirs + snippet + includes + 可能的全局 include 钩子；触发档案/gitconfig/includes watch 广播
- 凭据：无
- 全量覆盖：snippet 与 CLI bind 相同

---

## ipc:identity:unbind（新增）

- 用途：解除一条或全部目录绑定
- 方向：renderer → main
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | id | string | 否 | 与 dir 至少有一 |
  | dir | string | 否 | 省略且有 id 则解绑该身份全部 |
- 响应：`{ok, data: { gitdirs, changes } }`
- 副作用：更新 Store、回收片段、广播
- 凭据：无

---

## ipc:identity:remove（变更）

- 用途：删除档案
- 变更：core 先回收该身份 include 片段再删档案。IPC 形状不变
- 副作用：可能改 includes/snippet 与 Store

---

## ipc:identity:applyGlobal（变更）

- 用途：设为全局
- 变更：core 在全局 apply 后刷新该身份 snippet（若有 gitdirs）。IPC 形状不变

---

## ipc:identity:save（变更）

- 用途：新增/更新档案
- 变更：fields **不含** gitdirs（禁止表单手填）。更新后若已有 gitdirs 则刷新 snippet。IPC 形状其余同上一轮（含 gpgFormat）

---

## ipc:store:get（变更）

- 响应 identities 每项含 `gitdirs?: string[]`
- 无新副作用

---

## ipc:repo:scan（变更）

- 用途：扫描
- 响应 rows 增 `source: 'local'|'includeIf'|'global'|'none'`、`originFile?: string`；summary 增 `withIncludeIf`
- 副作用：无（与既有一致）

---

## ipc:repo:exportScan（变更）

- 导出文本含 source/originFile 列（与 CLI scan 导出一致）
- 请求形状不变

---

## 主进程 watch（非 core，变更说明）

- 既有：`fs.watchFile` 档案 + `~/.gitconfig`（ADR-011）
- 增量：同时监听 `<gitid-dir>/includes.gitconfig` 与 `<gitid-dir>/snippets`（目录或通配），变更后广播刷新。**不是**监听工作树、不是自动切身份

---

## 既有通道（无本增量形状变更）

`identity:applyLocal` / `identity:applyLocalBatch` / `identity:unsetLocal` / `identity:importGlobal` / `identity:importScan` / `repo:audit` / `env:doctor` / `settings:save` / `credential:*` / `dialog:pickDirectory` / `app:checkUpdate` / `app:quitAndInstall`

`unsetLocal` 之后行来源由下次 scan 的 `source` 反映。

---

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|----------|------|
| v1.0 | 2026-10-11 | initial / interface_added | identity:bind / identity:unbind；scan/store/remove/applyGlobal/save/export 字段或副作用扩展；watch 扩到托管片段 |
