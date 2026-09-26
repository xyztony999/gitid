# service-pool — 外部数据源

本工具为本地 CLI，无后端服务依赖。唯一外部调用为 **git 命令行**：

| 标识 | 调用 | 用途 |
|------|------|------|
| git-rev-parse | `git rev-parse --show-toplevel` / `--abbrev-ref HEAD` | 仓库根与分支判定（current/list/use --local/scan） |
| git-config | `git config [--global\|--local] --get <key>` / `git config --<scope> <key> <value>` / `--unset` | 全部身份键的读写 |

> 约束：全部经 `spawnSync('git', …)` 同步调用；git 缺失时统一报错"未找到 git 命令"。
