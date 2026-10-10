# Gate 2 验证报告 — 代码→交付门控

**模块**：cli + desktop（增量：审计处置闭环 / gpg.format / doctor / i18n / 自动更新）
**扫描路径**：`cli/` `desktop/`
**扫描时间**：2026-10-10

## 引擎 / 栈 CRITICAL

| 编号 | 检查项 | 结果 | 说明 |
|------|--------|------|------|
| EC-01 | contextIsolation + 渲染层无 Node | PASS | `contextIsolation: true`，`nodeIntegration: false`；`renderer/src` 无 `require(` / `process.` / `node:` |
| EC-02 | IPC `{ok,data\|error}` 三端对齐 | PASS | 新增通道 main ↔ preload ↔ api.js 签名一致；doctor/更新载荷无 token |
| EC-03 | 核心只改 CLI 再 sync-core | PASS | 仅改 `cli/lib/core.js` 的 settings.locale，`desktop/main/core.js` 由 sync-core 生成 |
| EC-04 | 无自有状态 / 无已应用标记 | PASS | 无新持久化点；locale 写入既有 `settings` |
| EC-05 | 沙箱测试 | PASS | desktop 6 绿（xvfb 集成跳过）；cli 29 绿 |
| EC-06 | 凭据零接触 | PASS | 新通道不传 token；体检输出仅 helper 名/级别 |
| P-01 | git 为事实源 | PASS | 无守护/钩子/已应用标记 |
| P-02 | use 全量覆盖 | PASS | 批量本地走 `applyIdentityLocalBatch` |
| P-03 | 凭据零接触 | PASS | 同 EC-06 |
| P-04 | 双端单一核心 | PASS | 同 EC-03 |
| P-05 | 测试沙箱 | PASS | 同 EC-05 |
| P-06 | 镜像 per-repo | PASS | 未改镜像语义 |

## 栈 WARNING

| 编号 | 检查项 | 结果 | 说明 |
|------|--------|------|------|
| EW-01 | 深色跟随系统 | PASS | 无第二套主题开关 |
| EW-02 | 只用 AntD | PASS | 未引入第二 UI 库 |
| EW-03 | 打包矩阵抽检 | WARN | 已加 publish + `--publish never` + Release 上传 `latest*.yml`；本机未跑 AppImage/NSIS |
| EW-04 | 产物不入库 | PASS | `renderer-dist/` `dist/` 仍 gitignore |
| EW-05 | 视图经 api.js | PASS | 视图不直写 `window.gitid` |
| EW-06 | 提交约定 | N/A | 本次按指令不 commit |

## 测试

| 命令 | 结果 |
|------|------|
| `npm --prefix cli test` | 29/29 绿 |
| `npm --prefix desktop test` | 6 绿，1 skip（无 xvfb-run） |
| `npm --prefix desktop run build:renderer` | 绿 |

## 前后端契约对齐（IPC）

| 通道 | 结果 |
|------|------|
| identity:save + gpgFormat | PASS |
| settings:save + locale | PASS |
| identity:importScan / applyLocalBatch | PASS |
| repo:audit / repo:exportScan | PASS |
| env:doctor | PASS |
| app:checkUpdate / app:quitAndInstall | PASS（不进 core） |

## 总结

**判定**：WARN

- CRITICAL：全部通过
- WARN：本机未跑打包矩阵；未在 Electron 窗口内点击验证新交互（语言/体检/批量/历史/更新横幅）
- 未阻断交付的工程事实：开发态 `checkUpdate` 固定返回 `{updateAvailable:false}`
