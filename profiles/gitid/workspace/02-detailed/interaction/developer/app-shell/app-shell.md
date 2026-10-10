# PageSpec — 页头、体检与采用面（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 用户类型 | 个人开发者 |
| 视图 | App.vue 页头 + Doctor Modal + 更新横幅 |
| 业务类型 | 工具 / 平台 |
| 页面类型 | config |
| 设计文档 | `{ws.api}/desktop-ipc.md` |

## 1. 模块元信息

| 项 | 值 |
|----|-----|
| 编码 | P-shell |
| 载体 | 全局壳，三 Tab 共享 |
| i18n | 页头、Tab 名、本模态；CLI 不在此 |

## 2. Action

| Action | IPC | 说明 |
|--------|-----|------|
| doctor | env:doctor | 打开体检前或打开时拉取 |
| saveLocale | settings:save | `{ locale }` |
| checkUpdate | app:checkUpdate | 启动后静默；也可手动 |
| quitAndInstall | app:quitAndInstall | 横幅主按钮 |

凭据 Tab 不改布局；doctor 不放在凭据页以免与 token 管道混淆，入口在页头。

## 3. 字典

| Key | 值 |
|-----|-----|
| locale | zh / en |
| doctorLevel | ok / warn / fail（绿/橙/红 Tag） |

## 4. 页头增量

| 控件 | 行为 |
|------|------|
| 语言切换 | Select 或双按钮 zh/en；写入 settings.locale；antd locale 同步 enUS/zhCN |
| 环境体检 | 按钮打开 Modal |
| 更新横幅 | updateAvailable 时 Alert：版本号 +「重启安装」+「稍后」 |

深色模式仍跟随系统，不新增第二套主题开关。

## 5. 体检 Modal

| 区 | 内容 |
|----|------|
| 表格 | 级别、检查项、说明（四项：git-version / credential-helper / ssh-insteadof / insteadof-conflict） |
| 按钮 | 重新检测 / 关闭 |
| 禁止 | 一键修复写 git、展示 token |

## 6. 详情 / 路由

无独立路由。启动：main 检查更新，结果经既有广播或下次 getFlags/invoke 给渲染层。

## 7. README（非页面）

仓库根 README 增加英文主文档或 `README.md` 英文化 + `README.zh-CN.md` 中文（实现阶段二选一，推荐：英文 README + 中文副本）。不进入渲染层。

## 8. 确认记录

1. 元信息：P-shell，App 壳，平台工具，config
2. 查询：无
3. 列：体检表三列
4. operList：无行按钮
5. 表单：无
6. 详情：体检即 Modal
7. 类型：config；更新横幅非 hybrid 大厅

## 更新记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-10-10 | 语言、doctor、自动更新入口 |
