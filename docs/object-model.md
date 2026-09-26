# gitid 对象模型

## 对象表

| 对象 | 英文 | 定义 | 关键字段 |
|------|------|------|---------|
| 身份 | Identity | 一套可复用的 git 提交者配置档案 | id、name、email、signingkey、gpgsign、insteadOf（URL 重写对，ADR-016）、accounts（凭据账号选择器 [{host, username}]，ADR-017）、extra（任意 k=v） |
| 身份档案库 | Store | 本机全部身份的持久化集合 | `~/.config/gitid/config.json`（version + identities + settings，可被 `$GITID_CONFIG` 覆盖；Windows 为 `%APPDATA%\gitid\config.json`） |
| 作用域 | Scope | 身份的写入目标：`global`（`git config --global`）或 `local`（当前仓库 `git config --local`） | — |
| 本地覆盖 | Override | 仓库本地设置了 user.name/user.email，优先生效于全局 | 判定 = `git config --local --get user.name/email` 任一存在 |
| 生效身份 | Effective | git 实际采用的提交者配置，按「本地覆盖 → 全局回退」解析，与 git 自身语义一致 | name、email、signingkey |
| 远程 | Remote | 仓库的远程配置（仓库私有，不进全局 profile） | name、url（fetch）、pushurls（多值；≥2 即镜像推送 mirror）、account（该远程生效的凭据账号选择器） |
| 凭据（外部） | Credential | git credential 协议托管于 helper（GCM/libsecret/store）与 OS 钥匙串；gitid 仅为管道，不存储 | host、username；token 本体 gitid 全程不留存（ADR-017） |
| 设置 | Settings | 与身份档案同存的用户偏好：默认扫描目录/深度（`scanRoot`/`scanDepth`） | 由 `scan --save` / 桌面端「设为默认」写入，两端共用 |

## 状态机

本工具无单据类状态流转。唯一"状态"是身份匹配：生效 (name, email) 与档案逐条精确比对 → 命中则展示身份 id；未命中标记为「手配」（⚠）；name/email 缺失标记为「配置缺失」（✗）。

## 命令与对象的关系

| 命令 | 读/写对象 |
|------|----------|
| add / remove / import | 写 Store（含 insteadOf URL 重写对与 accounts 凭据选择器） |
| use / local / unset | 写 git 配置（global 或 local 作用域）；全量覆盖含上一身份的 extras/insteadOf/accounts（ADR-016/017） |
| scan [--save] | 只读：Store + git 配置联查（含各仓库远程/镜像/凭据账号状态）；`--save` 写 Settings |
| remote [list \| mirror <url> \| unmirror] | 读写当前仓库 `remote.<name>.pushurl`（镜像双推）；不触碰凭据 |
| credential [list \| login \| set \| remove] | 凭据管道：经 git credential 协议读写 helper（ADR-017）；token 不入 Store 不回显 |
