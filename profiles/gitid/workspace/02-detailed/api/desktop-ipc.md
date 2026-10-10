# gitid 桌面端 IPC 契约（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 对照规格 | profiles/electron-vue3/skills/desktop-specs/SKILL.md |

既有通道保持 `{ok, data\|error}`。业务通道经 main 调 `core.js`；更新通道不进 core。凭据通道零 token 广播（P-03）。

---

## ipc:identity:save（变更）

- 用途：新增/更新档案
- 方向：renderer → main（invoke）
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | id | string | 是 | |
  | fields | object | 是 | 增 `gpgFormat`: `openpgp\|ssh\|x509\|''` |
- 响应：`{ok, data: {exists}}`
- 副作用：写 Store；`gpgFormat` 空则档案不带该字段
- 凭据：无

---

## ipc:identity:importScan（新增）

- 用途：收编当前扫描根下的 ⚠ 手配
- 方向：renderer → main
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | root | string | 是 | 扫描根 |
  | depth | number | 否 | 默认 settings |
  | dryRun | boolean | 否 | 默认 false |
- 响应：`{ok, data: { imported: [{id,name,email,path}], skipped: [...], warnings: [...] }}`
- 副作用：非 dryRun 写 Store；不写 git；触发档案 watch 广播
- 凭据：无

---

## ipc:identity:applyLocalBatch（新增）

- 用途：对多仓本地全量覆盖
- 方向：renderer → main
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | id | string | 是 | 档案 |
  | repos | string[] | 是 | 仓库路径 |
- 响应：`{ok, data: { results: [{path, ok, changes\|error}] }}`；全部参数级失败则 ok=false
- 副作用：各仓 local IDENTITY_KEYS（含 gpg.format）+ extra 清理；watch 广播
- 凭据：无
- 全量覆盖：与 CLI `--repos` 相同

---

## ipc:repo:scan（不变）

- 用途：扫描。返回结构可供导出与多选。
- 响应 data 即 core.scanRepos 结果（已有）

---

## ipc:repo:audit（新增）

- 用途：提交历史作者审计
- 方向：renderer → main
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | repo | string | 是 | |
  | expectId | string | 否 | |
- 响应：`{ok, data: AuditReport }`
- 副作用：无
- 凭据：无

---

## ipc:repo:exportScan（新增）

- 用途：把当次扫描行格式化为文本（逻辑可在 core，避免渲染层拼 CSV）
- 方向：renderer → main
- 请求载荷：| 字段 | 类型 | 必填 | 说明 |
  | root | string | 是 | 用于复扫或 |
  | depth | number | 否 | |
  | format | json\|markdown\|csv | 是 | |
  | rows | object | 否 | 若传入则不再扫描 |
- 响应：`{ok, data: { text, format }}`
- 副作用：无（渲染层另存文件用 dialog）
- 凭据：无

---

## ipc:env:doctor（新增）

- 用途：环境体检
- 方向：renderer → main
- 请求载荷：无
- 响应：`{ok, data: DoctorReport }`
- 副作用：无；探测关闭交互、不读 token
- 凭据：无 token 字段

---

## ipc:settings:save（变更）

- 用途：写设置
- 请求载荷 patch 增 `locale`: `zh`\|`en`
- 副作用：写 Store.settings；广播刷新
- 凭据：无

---

## ipc:app:checkUpdate（新增，主进程，非 core）

- 用途：检查 GitHub Releases
- 请求载荷：无
- 响应：`{ok, data: { updateAvailable, version, releaseName }}` 或不可用时 `{ok,true,data:{updateAvailable:false}}`
- 副作用：无安装
- 凭据：无

---

## ipc:app:quitAndInstall（新增，主进程，非 core）

- 用途：退出并安装已下载更新
- 请求载荷：无
- 响应：调用后进程退出；失败 `{ok:false,error}`
- 副作用：退出应用
- 凭据：无

---

## 既有通道（无契约变更）

`store:get` / `identity:remove` / `identity:applyGlobal` / `identity:applyLocal` / `identity:unsetLocal` / `identity:importGlobal` / `repo:setMirror` / `repo:clearMirror` / `credential:*` / `dialog:pickDirectory`

`identity:applyLocal` 因 core IDENTITY_KEYS 变更自动覆盖 `gpg.format`，IPC 形状不变。

---

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|----------|------|
| v1.0 | 2026-10-10 | initial / interface_added | importScan, applyLocalBatch, repo:audit, repo:exportScan, env:doctor, app:checkUpdate, app:quitAndInstall；save/settings 字段扩展 |
