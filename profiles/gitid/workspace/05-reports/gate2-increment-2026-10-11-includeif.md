# Gate 2 验证报告 — 代码→交付门控（includeIf，含桌面端 F1–F4）

**模块**：cli + desktop（增量：目录级 includeIf.gitdir 绑定）
**扫描路径**：`cli/` `desktop/main/` `desktop/renderer/src/` `desktop/test/`
**扫描时间**：2026-10-11
**总体判定**：**PASS**（CRITICAL 全过；真机 Electron 交互与打包矩阵未抽检，记 WARNING）

## 引擎 / 栈 CRITICAL

| 编号 | 检查项 | 结果 | 说明 |
|------|--------|------|------|
| NC-01 / EC-03 / P-04 | 单一核心 | PASS | 未手改 `desktop/main/core.js`；`sync-core` 后字节级一致 |
| EC-01 | 安全基线 | PASS | `contextIsolation: true`、`nodeIntegration: false`；views 无 `require`/`process`/`node:` |
| EC-02 | IPC 契约 | PASS | `identity:bind` / `identity:unbind` 三端对齐；`{ok, data\|error}`；载荷仅 id/dir |
| EC-04 / P-01 | 无自有状态 | PASS | 无新持久化；watch 扩到 includes.gitconfig + snippets，不监听工作树、不自动切身份 |
| EC-05 / P-05 | 沙箱测试 | PASS | 新增 includeIf 沙箱用例；独立 HOME + GITID_CONFIG |
| EC-06 / P-03 | 凭据零接触 | PASS | 本增量无凭据通道；bind/unbind 无 token |
| P-02 | 全量覆盖 | PASS | snippet 仍走 core 整文件重写；save 剥掉 fields.gitdirs |
| P-06 | 镜像 per-repo | PASS | 未改 remote 语义 |

## 已确认的 4 条 WARN 落地

| # | 设计默认 | 实现 |
|---|---------|------|
| 1 | bind 立即物化 | `identity:bind` → `bindGitdir` + `saveStore` |
| 2 | 删除身份只回收托管片段 | `identity:remove` → `removeIdentity` |
| 3 | 同路径拒绝对撞 | 复用 `findGitdirOwners`，错误回 IPC error |
| 4 | 审计页绑当前扫描根；身份列表只展示/点除 | RepoView Dialog 只读路径；IdentityView Tags 点除；表单无 gitdirs |

## 测试

| 命令 | 结果 |
|------|------|
| `npm --prefix cli test` | 34/34 绿（本轮未重跑，沿用 B7） |
| `npm --prefix desktop run sync-core` | 已同步 |
| `npm --prefix desktop test` | 8 绿，1 skip（无 xvfb-run） |
| `npm --prefix desktop run build:renderer` | 绿 |

## WARNING（不阻断）

- 本机无 xvfb，未跑 `GITID_DRIVE` Electron 全链路，也未点验绑定 Dialog / Tag 点除 / ▣ 展示
- 未改打包配置，未抽检 AppImage/NSIS（EW-03）

## 总结

**判定**：PASS

- CLI + 桌面 IPC/视图已按契约落地
- 未 commit（按指令）
