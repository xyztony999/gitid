# PageSpec — 仓库审计与处置（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 用户类型 | 个人开发者 |
| 视图 | RepoView（既有 Tab「仓库审计」） |
| 业务类型 | 台账 + 工具操作 |
| 页面类型 | hybrid（列表 + 批量条 + 历史抽屉 + 导出） |
| 设计文档 | `{ws.api}/cli-increment.md` + `{ws.api}/desktop-ipc.md` |

## 1. 模块元信息

| 项 | 值 |
|----|-----|
| 编码 | C-03-repos |
| 载体 | 桌面 Tab |
| i18n | 全部可见文案走 en/zh |

## 2. Action

| Action | IPC | 说明 |
|--------|-----|------|
| scan | repo:scan | 既有 |
| applyLocal | identity:applyLocal | 既有行内 |
| unsetLocal | identity:unsetLocal | 既有继承全局 |
| importScan | identity:importScan | 收编 ⚠ |
| applyLocalBatch | identity:applyLocalBatch | 多选批量 |
| audit | repo:audit | 历史抽屉 |
| exportScan | repo:exportScan | 导出文本 |
| saveSettings | settings:save | 既有默认目录 |
| pickDirectory | dialog:pickDirectory | 既有 |
| setMirror / clearMirror | repo:* | 既有 |

## 3. 字典

| Key | 值 |
|-----|-----|
| scanStatus | ok / missing / unknown（展示 ✓ 正常 / ✗ 缺失 / ⚠ 手配） |
| exportFormat | json / markdown / csv |

## 4. 列表

既有列：状态、仓库、远程、身份下拉、生效配置。增量：

| 项 | 说明 |
|----|------|
| rowSelection | checkbox，纳入左区；跨页不需要（无分页） |
| 行操作「历史」 | 打开审计抽屉；不进身份下拉 |

查询条件不变：目录 input、深度 number、扫描按钮、设为默认。

工具栏增量按钮：

| 按钮 | 可见 | 行为 |
|------|------|------|
| 收编手配 | 当前结果存在 unknown | 确认条数后 importScan(root,depth) |
| 批量应用 | 勾选 ≥1 | 选身份后 applyLocalBatch；默认勾选可一键「仅缺失」 |
| 导出 | 有结果 | 选 format，exportScan，再另存或下载 |

## 5. 表单

无新主表单。批量应用使用小型 Dialog：身份 select + 将处理的路径预览。镜像 Modal 不变。

## 6. 详情 / 抽屉 — 历史审计

| 项 | 说明 |
|----|------|
| 触发 | 行「历史」 |
| 数据 | repo:audit(repo, expectId?) |
| 块1 | 作者表：count / name / email / 匹配档案 / 污染 |
| 块2 | 期望身份 select（可选，改则重拉） |
| 块3 | mailmap 建议 textarea 只读 + 复制 |
| 不出现 | 写 .mailmap 按钮、rewrite 按钮 |

## 7. 路由

无。Tab key=`repos`。

## 8. 确认记录

1. 元信息：C-03，仓库审计 Tab，台账+工具，hybrid
2. 查询：目录/深度，无新筛
3. 列：加多选与历史操作
4. operList：行内身份下拉保持；+历史
5. 表单：批量 Dialog
6. 详情：历史抽屉三块
7. 覆盖：hybrid（批量条+抽屉），非画布类 code

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-10 | 增量：多选处置、导出、历史审计 |
