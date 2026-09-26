---
name: cli-specs
description: Node.js CLI 工程栈规格 — D3 命令契约设计规约（命令行界面 + git config 键语义）；CLI 栈技术事实与命令/输出/退出码契约模板。设计 CLI 命令、改 CLI 参数或输出格式前加载。
---

# Node.js CLI 工程栈规格（D3 规约入口）

> **Profile 绑定（第 0 步）**：读 `.claude/settings.json` 的 ACTIVE_PROFILE/ACTIVE_STACKS 与对应 manifest；`{slots.*}` ← 业务 manifest slots；`{kb.*}` ← 业务知识分节；`{ws.*}` ← 业务工作区槽位；`{engine.*}` ← 引擎根/手册/工具。

## 1. 栈事实表

| 项 | 值 | 依据 |
|----|----|------|
| 运行时 | Node ≥ 18，CommonJS（`type: commonjs`） | ADR-001 |
| 依赖 | 运行时 0 依赖；仅用 node 内置模块（`readline/promises`、`node:test`） | ADR-001 |
| 安装形态 | `npm install -g ./cli`；bin 双注册：`{profile}` + `git-id`（`git id <cmd>` 体验） | ADR-005 |
| 代码根 | `{stack.code_root}`（env `CLI_ROOT`，相对仓根） | — |
| 测试 | `node --test`，e2e 沙箱（独立 HOME + `$GITID_CONFIG` + `GIT_CONFIG_NOSYSTEM=1`；win32 另设 `USERPROFILE`/`APPDATA`） | ADR-006/014 |
| 配置档案 | `~/.config/{profile}/config.json`（win32：`%APPDATA%\{profile}\`；`$GITID_CONFIG` 恒最高优先）；原子写 tmp+rename，mode 0600 | ADR-007/014 |

## 2. 结构规约

| 分区 | 职责 |
|------|------|
| `{stack.code_root}/lib/core.js` | **唯一业务核心**：档案 CRUD、git config 读写封装、仓库扫描、凭据协议管道；UI 无关，桌面端经字节级同步副本复用（ADR-009） |
| `{slots.cli_entry}` | 交互层：参数解析、交互式询问、CJK 对齐表格渲染、命令分发；不含业务逻辑 |
| `{stack.code_root}/test/` | e2e：沙箱夹具 + 命令全分支覆盖（全局/本地/错误路径） |

## 3. D3 产物：命令契约模板（{ws.api} 落盘格式）

CLI 的"API 设计"= **命令行界面契约**。每个新命令/参数变更在 `{ws.api}/<module>-cli.md` 按下表登记：

```markdown
## <command> <子命令?>
- 用途：（一句话；引用 {kb.business-concepts} 对象）
- 参数：| 名称 | 必填 | 说明 |
- 选项：| --flag | 取值 | 默认 | 说明 |
- 输入来源：参数 / 交互询问 / stdin（凭据类必须隐藏输入，见业务红线 P-03）
- 输出：表格列定义（含 CJK 对齐注意）/ 变更清单项类型（set/unset/rewrite）
- 退出码：0=成功；1=用户错误；2=git/IO 错误（逐条列）
- 副作用：写入的 git config 键域（global/local）、档案字段、URL 重写/选择器键
- 全量覆盖语义：本命令应用后必须清理哪些上一状态键（对照业务红线 P-02）
```

## 4. 契约暴露点（跨栈对齐）

- 命令语义/输出格式变更 → 桌面端视图与 IPC 通道需同步评估（见桌面端工程栈规格）；core.js 函数签名是双端唯一契约。
- git config 键域变更（新增 extra/insteadOf/选择器键）→ 必须同步业务知识 {kb.business-concepts} 对象模型与 `use` 清理清单。

## 5. 验证

Gate 2 按本栈规则集（`{stack.validation.rules}`）执行；构建验证命令：`{stack.build_cmd}`。
