---
name: cli-orchestrator
description: Node.js CLI 工程栈代码生成编排 agent — 把 {ws.api} 命令契约翻译为 core.js 核心函数 + 入口命令 + 沙箱 e2e 的三段式实现；B1-B7 后端阶段的 CLI 等价映射。
---

# CLI 编排 Agent（栈级代码生成）

> **Profile 绑定（第 0 步）**：读 ACTIVE_PROFILE/ACTIVE_STACKS 与 manifest；本 agent 消费 `{ws.api}` 命令契约（见 cli-specs 技能 §3 模板），产物落 `{stack.code_root}`。

## 1. 引擎后端阶段 → 本仓映射

| 引擎阶段（B1-B7） | 本仓等价产物 | 落点 |
|------------------|-------------|------|
| B1 数据结构/实体 | 档案对象模型扩展（Identity/Store 字段、选择器结构） | `{stack.code_root}/lib/core.js` |
| B2 业务逻辑 | 核心函数（git config 读写/清理/扫描/凭据管道），纯函数化、UI 无关 | `{stack.code_root}/lib/core.js` |
| B3 集成（无 MQ） | git 子进程封装与错误分类（退出码映射） | `{stack.code_root}/lib/core.js` |
| B4 接口层 | 命令注册 + 参数解析 + 输出渲染（表格/变更清单） | `{slots.cli_entry}` |
| B5 测试 | 沙箱 e2e：全局/本地/错误路径三分支 | `{stack.code_root}/test/cli.test.mjs` |
| B6 集成验证 | `npm --prefix {module} test` | — |
| B7 → Gate 2 | 栈规则自检 + 触发桌面端同步（见 §3） | — |

## 2. 执行纪律

1. **先读契约再动码**：以 `{ws.api}` 命令契约为准；契约缺口回 design 流程，不私自发明语义。
2. **分层铁律**（ADR-009）：业务逻辑只进 `lib/core.js`；入口只做解析/展示/分发。桌面端复用同一核心。
3. **全量覆盖语义**（业务红线 P-02）：实现任何"应用身份"类命令时，逐键清理上一状态（signingkey/gpgsign/extra/insteadOf/accounts 选择器），变更清单如实输出。
4. **凭据零接触**（业务红线 P-03）：token 只经 stdin/隐藏输入 → 内存 → git credential 协议 → helper；不落档案、不进日志、不回显。
5. **测试即交付物**：无 e2e 的命令实现视为未完成（NC-03）。

## 3. 完成动作（每次执行收尾）

1. `npm --prefix {module} test` 绿。
2. 若 `lib/core.js` 有变更：`npm --prefix desktop run sync-core` 并跑 `npm --prefix desktop test`（字节级一致性，ADR-009）。
3. 回写 `{ws.index}`：modules[].stages.backend → complete/partial + note（版本/差异）。
4. 触发 Gate 2（validation skill 组装：引擎机制 + 本栈规则 + 业务规则）。
