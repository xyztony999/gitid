# PageSpec — 仓库审计：目录绑定（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-11 |
| 用户类型 | 个人开发者 |
| 视图 | RepoView（既有 Tab「仓库审计」） |
| 业务类型 | 台账 + 工具操作 |
| 页面类型 | hybrid（沿用上一轮：列表 + 批量条 + 历史抽屉 + 导出；本轮加绑定条） |
| 设计文档 | `{ws.api}/cli-includeif.md` + `{ws.api}/desktop-ipc-includeif.md` |

## 1. 模块元信息

| 项 | 值 |
|----|-----|
| 编码 | C-07-dirbind（审计页承载；模块归属 AA 目录级身份绑定） |
| 载体 | 桌面 Tab |
| i18n | 全部可见文案走 en/zh |

## 2. Action

| Action | IPC | 说明 |
|--------|-----|------|
| scan | repo:scan | 行含 source / originFile |
| bindDir | identity:bind | 绑定**当前扫描根** |
| unbindDir | identity:unbind | 解绑当前扫描根 |
| exportScan | repo:exportScan | 导出含 source |
| applyLocal / unsetLocal / importScan / applyLocalBatch / audit | 既有 | 无形状变更 |

## 3. 字典

| Key | 值 |
|-----|-----|
| scanStatus | ok / missing / unknown |
| configSource | local / includeIf / global / none |
| scanMark | ✓ / ✗ / ⚠ / ◆ / ⊕ / ▣ |

## 4. 列表

既有列保留。增量：

| 项 | 说明 |
|----|------|
| 状态列 | source=includeIf 时在 ✓/⚠ 旁加 `▣` 或 Tag「目录绑定」；source=local 仍只标 ◆ |
| origin tooltip | 悬停状态/身份列可看 originFile |
| 无新筛选 | 目录/深度不变 |

工具栏增量：

| 按钮 | 可见 | 行为 |
|------|------|------|
| 绑定此目录树 | 已扫描或已填扫描根 | Dialog：身份 select + 展示将绑定的规范化路径；确认后 `identity:bind({id, dir: scanRoot})`，成功后自动再 scan |
| 解除目录绑定 | 当前扫描根（规范化后）命中任一身份 gitdirs | 确认后 `identity:unbind({dir: scanRoot})`，再 scan |

绑定与上一轮「批量应用」并列，文案需区分：绑定=目录树默认身份（新仓也生效）；批量应用=逐仓写 local。

## 5. 表单

绑定 Dialog（<5 字段）：

| 字段 | 组件 | 必填 |
|------|------|------|
| 身份 | select（store identities） | 是 |
| 目录树 | 只读文本=当前扫描根 | — |

按钮：绑定 / 取消。无 gitdirs 自由输入。

解绑：Popconfirm，无额外表单。

## 6. 详情

无新抽屉。历史审计抽屉不变。

## 7. 路由

无。Tab key=`repos`。

## 8. 确认记录（D4 七项，按方案默认）

1. 元信息：C-07，仓库审计 Tab，台账+工具，hybrid
2. 查询：仍为目录/深度，无新筛
3. 列：状态附加 ▣；tooltip 看来源
4. operList：工具栏绑定/解绑；行内身份下拉保持（仍是 local）
5. 表单：绑定 Dialog
6. 详情：无
7. 覆盖：保持 hybrid，非 code

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-11 | 绑定此目录树 / 解绑 / scan ▣ |
