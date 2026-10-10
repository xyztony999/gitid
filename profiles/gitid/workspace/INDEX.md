---
# gitid 工作区状态索引（schema：engine/01-pipeline-definition.md §2.5）
pipeline:
  - id: gitid-bootstrap
    title: "gitid 立项与 v0.1.0 实现（CLI）"
    path: "../../README.md"
    status: complete
    note: "2026-09-02 立项：知识库四节落盘，CLI v0.1.0（13/13 e2e 通过）"

  - id: gitid-desktop
    title: "桌面端（Electron + Vue3 + AntD）"
    path: "../../../desktop/"
    status: complete
    note: "2026-09-02 用户确认三功能全量交付；核心共用 lib/core.js（ADR-009），AppImage arm64 打包通过"

  - id: gitid-increment-audit-loop
    title: "增量：审计处置闭环 + SSH 签名 + 分发采用 + CLI 改善"
    path: "05-reports/d0-increment-2026-10-10.md"
    status: in_progress
    note: "2026-10-10 Gate 1 已接受；CLI B1–B7 与 desktop F1–F4 已落地。desktop test 6 绿（xvfb 集成跳过）+ build:renderer 绿；正式 Gate 2 见 05-reports/gate2-increment-2026-10-10.md"

reference:
  - title: "设计决策（ADR）"
    path: "../knowledge/design-decisions/index.md"
  - title: "对象模型"
    path: "../knowledge/business-concepts/index.md"
  - title: "架构与选型"
    path: "../knowledge/architecture-choices/index.md"
  - title: "形式化业务架构"
    path: "00-architecture/business-arch.md"
  - title: "形式化应用架构"
    path: "00-architecture/application-arch.md"
  - title: "功能清单"
    path: "00-architecture/function-list.md"

modules:
  - name: cli
    domain: tool
    stages:
      requirement: { status: complete, note: "2026-10-10 增量 D0/D2：收编手配、批量本地应用、audit、doctor、gpg.format、scan 导出、completion；不变量 P-01~P-06 保持" }
      api: { status: complete, note: "2026-10-10 D3：02-detailed/api/cli-increment.md（命令契约，非 HTTP）" }
      interaction: { status: complete, note: "CLI 人读仍中文；补全脚本为平台能力" }
      backend: { status: complete, note: "2026-10-10 B1–B7 + settings.locale（zh|en）；cli e2e 绿，desktop sync-core 一致性通过" }
      frontend: { status: todo, note: "无前端（由 desktop 模块承担）" }
      validation: { status: complete, note: "2026-10-10 与 desktop 同一次 Gate 2：栈自检 + P-01~06 通过" }
    gates:
      gate1: { status: accepted, note: "2026-10-10 用户接受 WARN 三条，按设计默认落地" }
      gate2: { status: complete, note: "2026-10-10 见 05-reports/gate2-increment-2026-10-10.md" }

  - name: desktop
    domain: tool
    stages:
      requirement: { status: complete, note: "2026-10-10 增量：仓库审计闭环、gpg.format 表单、doctor、i18n、electron-updater" }
      api: { status: complete, note: "2026-10-10 D3：02-detailed/api/desktop-ipc.md" }
      interaction: { status: complete, note: "2026-10-10 D4 PageSpec：identity / repos / app-shell" }
      backend: { status: complete, note: "2026-10-10 IPC：importScan / applyLocalBatch / repo:audit / repo:exportScan / env:doctor / app:checkUpdate / app:quitAndInstall；identity:save 传 gpgFormat；settings:save 传 locale。更新通道不进 core；core 仅 sync-core" }
      frontend: { status: complete, note: "2026-10-10 F1–F4：IdentityView gpgFormat；RepoView 多选/收编/批量/导出/历史抽屉；App 壳语言/体检/更新横幅；凭据 Tab 只 i18n 不改布局。npm test 6 绿 + build:renderer 绿" }
      validation: { status: complete, note: "Gate 2 见 05-reports/gate2-increment-2026-10-10.md；本机无 xvfb，Electron 点击路径未实机点验" }
    gates:
      gate1: { status: accepted, note: "2026-10-10 与 cli 同一次增量门控，用户已确认 WARN" }
      gate2: { status: complete, note: "2026-10-10 栈 CRITICAL 通过；WARN：本机未跑打包矩阵、未点验 Electron UI" }
