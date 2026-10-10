# PageSpec — 身份管理（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 用户类型 | 个人开发者 |
| 视图 | IdentityView（既有 Tab「身份管理」） |
| 业务类型 | master_data（本机档案） |
| 页面类型 | config |
| 设计文档 | `{ws.api}/cli-increment.md` + `{ws.api}/desktop-ipc.md` |

## 1. 模块元信息

| 项 | 值 |
|----|-----|
| 编码 | C-01-identity |
| 载体 | 桌面 Tab，非独立路由 |
| i18n | 全部可见文案走 en/zh key |

## 2. Action

| Action | IPC | 说明 |
|--------|-----|------|
| save | identity:save | fields 含 gpgFormat |
| remove | identity:remove | 既有 |
| applyGlobal | identity:applyGlobal | 既有 |
| importGlobal | identity:importGlobal | 既有 |
| getStore | store:get | 既有 |

## 3. 字典

| Key | 值 | 对应 |
|-----|----|------|
| gpgFormat | openpgp / ssh / x509 / （空=不声明） | Identity.gpgFormat |

## 4. 列表

沿用既有表格。增量列：

| 列 | 来源 | 组件 |
|----|------|------|
| 签名 | signingkey + gpgsign + gpgFormat | 文本：有 format 时显示 `key · ssh` 等 |

无新筛选。工具栏不变。

## 5. 表单（Dialog，既有 Modal）

| 字段 | 组件 | 必填 | 来源 Save 字段 |
|------|------|------|----------------|
| id | input | 是 | id（编辑禁用） |
| name | input | 是 | name |
| email | input | 是 | email |
| signingkey | input | 否 | signingkey |
| **gpgFormat** | select | 否 | gpgFormat；选项空/openpgp/ssh/x509 |
| gpgsign | switch | 否 | gpgsign |
| insteadOf | textarea | 否 | 既有 |
| accounts | textarea | 否 | 既有 |

按钮：保存 / 取消（既有）。保存后留在列表。空 format 不得写 extras。

## 6. 详情

无独立详情页。

## 7. 路由

无。Tab key=`identities`。

## 8. 确认记录（D4 七项，基线=既有 UI + 需求）

1. 元信息：C-01，桌面身份 Tab，master_data，config
2. 查询：无新增
3. 列：签名列展示 format
4. operList：不新增行按钮
5. 表单：增加签名格式 select；仍为 Dialog
6. 详情：无
7. 页面类型：保持 config，无需 hybrid

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-10 | 增量：gpgFormat 表单与列 |
