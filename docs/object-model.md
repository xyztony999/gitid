# gitid 对象模型

## 对象表

| 对象 | 英文 | 定义 | 关键字段 |
|------|------|------|---------|
| 身份 | Identity | 一套可复用的 git 提交者配置档案 | id、name、email、signingkey、gpgsign、extra（任意 k=v） |
| 身份档案库 | Store | 本机全部身份的持久化集合 | `~/.config/gitid/config.json`（version + identities + settings，可被 `$GITID_CONFIG` 覆盖；Windows 为 `%APPDATA%\gitid\config.json`） |
| 作用域 | Scope | 身份的写入目标：`global`（`git config --global`）或 `local`（当前仓库 `git config --local`） | — |
| 本地覆盖 | Override | 仓库本地设置了 user.name/user.email，优先生效于全局 | 判定 = `git config --local --get user.name/email` 任一存在 |
| 生效身份 | Effective | git 实际采用的提交者配置，按「本地覆盖 → 全局回退」解析，与 git 自身语义一致 | name、email、signingkey |
| 设置 | Settings | 与身份档案同存的用户偏好：默认扫描目录/深度（`scanRoot`/`scanDepth`） | 由 `scan --save` / 桌面端「设为默认」写入，两端共用 |

## 状态机

本工具无单据类状态流转。唯一"状态"是身份匹配：生效 (name, email) 与档案逐条精确比对 → 命中则展示身份 id；未命中标记为「手配」（⚠）；name/email 缺失标记为「配置缺失」（✗）。

## 命令与对象的关系

| 命令 | 读/写对象 |
|------|----------|
| add / remove / import | 写 Store |
| use / local / unset | 写 git 配置（global 或 local 作用域） |
| scan [--save] | 只读：Store + git 配置联查；`--save` 写 Settings |
