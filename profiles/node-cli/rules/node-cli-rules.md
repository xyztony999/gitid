# Node.js CLI 工程栈 — Gate 2 规则集

> 栈级验证规则（随栈分发；Gate 2 由 validation skill 按「引擎机制 ⊕ 栈规则 ⊕ 业务规则」分层组装执行）。
> 槽位约定：`{profile}`=业务产品名；`{slots.cli_entry}`=CLI 入口脚本（业务 manifest slots）；`$GITID_CONFIG`=配置档案覆盖变量。
> 级别：CRITICAL=阻断（FAIL）；WARNING=建议（用户确认后继续）。
> 产品级不变量（use 全量覆盖 / 凭据零接触 / git 唯一事实源 / 双端单一核心 / 测试沙箱红线）见业务规则 `product-rules.md`，本表不重复、只给栈侧判定方法。

## CRITICAL

| # | 规则 | 判定方法 |
|---|------|---------|
| NC-01 | **单一事实源分层**（ADR-009）：业务逻辑（档案读写/git 子进程封装/扫描）只写 `cli/lib/core.js`；入口脚本 `{slots.cli_entry}` 只允许参数解析、交互询问、表格渲染与命令分发 | review 改动落点：新增 git 调用或档案操作函数不得出现在入口脚本；入口不 import 除 `lib/core.js` 外的本地模块 |
| NC-02 | **运行时零依赖**（ADR-001）：`cli/package.json` 的 `dependencies` 必须为空；新增任何依赖（含 devDependencies 中的构建链）须先落 ADR | `node -p "Object.keys(require('{module}/package.json').dependencies??{}).length"` 输出 0 |
| NC-03 | **e2e 全覆盖**：新增/变更命令必须在 `cli/test/cli.test.mjs` 带对应用例，至少覆盖全局态与仓库本地态两分支 + 一条错误路径（非 0 退出码断言） | `npm --prefix {module} test` 通过；review 用例分支清单 |
| NC-04 | **沙箱机制不旁路**（ADR-006/014，业务红线 P-05 的栈侧判定）：测试经独立 `HOME` + `$GITID_CONFIG` + `GIT_CONFIG_NOSYSTEM=1`（win32 另设 `USERPROFILE`/`APPDATA`）隔离；夹具用 `git config --file` / `credential store --file` 指向临时目录 | grep 测试文件无真实 HOME 字面量；e2e 断言全程未触真实 `~/.gitconfig` |
| NC-05 | **配置档案原子写**（ADR-007）：tmp + rename，mode 0600；win32 rename 遇 EPERM/EACCES 回退直写（ADR-014） | review 写入实现；注入中断（杀进程/异常）后档案文件完整 |
| NC-06 | **Node ≥ 18 运行时兼容**（ADR-001）：不使用高于 18 的专属 API；确需提级须同步 `engines.node` 并落 ADR | review diff 中的新 API；`npm --prefix {module} test` 在最低支持版本通过 |
| NC-07 | **同步核心链路完整**：凡改动 `cli/lib/core.js`，必须执行 `npm --prefix desktop run sync-core`（或依赖 `npm start`/`package` 前置自动执行）；桌面端测试逐字节比对不一致即 FAIL | `npm --prefix desktop test` 的核心一致性用例通过 |

## WARNING

| # | 规则 | 判定方法 |
|---|------|---------|
| NW-01 | 版本号由 `package.json` 派生（`npm` 注入或运行时读取），源码不硬编码版本字面量 | grep 源码无 `\d+\.\d+\.\d+`（package.json/bin banner 除外） |
| NW-02 | 输出对脚本友好：列表稳定排序、退出码语义明确（0 成功/非 0 失败）、变更清单如实展示（含 unset 项与 URL 重写类高危变更显式标注） | review + e2e 断言排序与退出码 |
| NW-03 | CJK 表格对齐用自实现宽字符计数；不得为排版引入依赖（零依赖纪律，例外须 ADR） | review |
| NW-04 | win32 路径兼容：`~` 展开同时接受 `/` 与 `\`；路径拼接用 `path` 而非字符串拼接（ADR-014） | e2e win32 分支通过 |
| NW-05 | 提交约定：中文 Conventional Commits（`feat(cli): …`/`fix(cli): …`），一次提交一个完整关注点 | review 提交历史 |

## 编译/测试命令（{stack.build_cmd}）

```
npm --prefix {module} test        # {module} ∈ { cli, desktop }
```
