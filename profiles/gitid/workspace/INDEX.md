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
    status: complete
    note: "2026-10-10 Gate 1 已接受；Gate 2 见 05-reports/gate2-increment-2026-10-10.md"

  - id: gitid-increment-includeif
    title: "增量：目录级 includeIf.gitdir 绑定"
    path: "05-reports/d0-increment-2026-10-11-includeif.md"
    status: complete
    note: "2026-10-11 Gate 1 四条 WARN 已按设计默认落地；CLI B1–B7 与桌面 F1–F4 已完成（bind/unbind IPC + 审计页绑定 + 身份 gitdirs）"

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
      requirement: { status: complete, note: "2026-10-11 增量 D0/D2：bind/unbind、gitdirs[]、current/scan 来源 includeIf；P-01~P-06 保持" }
      api: { status: complete, note: "2026-10-11 D3：02-detailed/api/cli-includeif.md" }
      interaction: { status: complete, note: "CLI 人读仍中文；completion 将含 bind/unbind" }
      backend: { status: complete, note: "2026-10-11 B1–B7：bind/unbind 立即物化 snippet+includeIf；current/scan --show-origin；use/add 只刷新已有 snippet；remove 回收片段；34/34 沙箱 e2e 绿" }
      frontend: { status: todo, note: "无前端（由 desktop 模块承担）" }
      validation: { status: complete, note: "CLI 34/34 绿；桌面端 F1–F4 已接，见 desktop.validation" }
    gates:
      gate1: { status: accepted, note: "2026-10-11 用户接受 4 条 WARN 按设计默认落地" }
      gate2: { status: complete, note: "CLI CRITICAL 通过；桌面端 F1–F4 已交付，见 gate2 报告" }

  - name: desktop
    domain: tool
    stages:
      requirement: { status: complete, note: "2026-10-11 增量：审计页绑定此目录树、scan ▣、身份列表 gitdirs" }
      api: { status: complete, note: "2026-10-11 D3：02-detailed/api/desktop-ipc-includeif.md" }
      interaction: { status: complete, note: "2026-10-11 D4：repos-includeif / identity-includeif" }
      backend: { status: complete, note: "2026-10-11 F4：identity:bind/unbind IPC；remove 回收片段、save 禁手填 gitdirs、applyGlobal 刷新 snippet；watch includes+snippets" }
      frontend: { status: complete, note: "2026-10-11 F1–F3：审计页绑定此目录树/解绑 + scan ▣；身份列表 gitdirs Tags 点除；en/zh i18n" }
      validation: { status: complete, note: "2026-10-11 desktop test 8 绿 1 skip（无 xvfb）+ build:renderer 绿；Electron 真机交互未点验" }
    gates:
      gate1: { status: accepted, note: "2026-10-11 与 cli 同一次增量：四条 WARN 按设计默认落地" }
      gate2: { status: complete, note: "2026-10-11 桌面 CRITICAL（EC-01~06 / P-01~06）通过；真机 UI / 打包矩阵未抽检" }
