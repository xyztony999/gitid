# PageSpec — 身份管理：gitdirs 展示（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-11 |
| 用户类型 | 个人开发者 |
| 视图 | IdentityView（既有 Tab「身份管理」） |
| 业务类型 | master_data |
| 页面类型 | config |
| 设计文档 | `{ws.api}/cli-includeif.md` + `{ws.api}/desktop-ipc-includeif.md` |

## 1. 模块元信息

| 项 | 值 |
|----|-----|
| 编码 | C-01-identity（字段展示增强） |
| 载体 | 桌面 Tab |
| i18n | en/zh |

## 2. Action

| Action | IPC | 说明 |
|--------|-----|------|
| getStore | store:get | identities 含 gitdirs |
| unbindDir | identity:unbind | 点除单条目录 |
| remove | identity:remove | 先回收片段 |
| applyGlobal | identity:applyGlobal | 刷新 snippet |
| save | identity:save | fields 不含 gitdirs |

## 3. 字典

无新字典。路径原样展示。

## 4. 列表

增量列或行内 Tags：

| 列 | 来源 | 组件 |
|----|------|------|
| 绑定目录 | identity.gitdirs | Tag 列表；每个 Tag 可关闭 → `unbind({id, dir})`；空则「无」 |

无新筛选。工具栏不新增「绑定」（绑定入口在审计页，避免无扫描根时乱填路径）。

## 5. 表单

**不增加** gitdirs 输入。签名格式等上一轮字段保持。

## 6. 详情

无。

## 7. 路由

无。Tab key=`identities`。

## 8. 确认记录

1. 元信息：C-01，config
2. 查询：无新增
3. 列：绑定目录 Tags
4. operList：Tag 关闭=解绑；删除走 remove
5. 表单：不手填 gitdirs
6. 详情：无
7. 页面类型：保持 config

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-11 | 列表展示 gitdirs，点除解绑 |
