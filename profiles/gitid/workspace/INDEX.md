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

reference:
  - title: "设计决策（ADR）"
    path: "../knowledge/design-decisions/index.md"
  - title: "对象模型"
    path: "../knowledge/business-concepts/index.md"
  - title: "架构与选型"
    path: "../knowledge/architecture-choices/index.md"

modules:
  - name: cli
    domain: tool
    stages:
      requirement: { status: complete, note: "多身份管理：全局+项目级 user.name/email/签名配置；2026-09-02 用户澄清：审计视图按仓库设置不同本地身份、清除即回退继承全局（ADR-002/004，设为本地/清除覆盖，xvfb 实操验证，零代码增量）" }
      api: { status: complete, note: "命令集：add/list/use/local/current/unset/remove/import/scan（gitid help 全文）；2026-09-18 增量：scan --save 把目录与深度存为默认扫描目录，裸 scan 优先用它" }
      interaction: { status: complete, note: "中文 CLI 输出、CJK 对齐表格、★/◆ 标记、--no-color" }
      backend: { status: complete, note: "v0.1.0 核心抽出 lib/core.js（与桌面端共用），bin 仅交互层；2026-09-18 增量：settings（默认扫描目录/深度）入 config.json，getSettings/saveSettings 归一化读写" }
      frontend: { status: todo, note: "无前端（由 desktop 模块承担）" }
      validation: { status: complete, note: "e2e 15/15 通过（沙箱 HOME 隔离，不触碰真实 gitconfig）" }
    gates:
      gate1: { status: pass, note: "对象模型/ADR/架构三节知识库即 D0-D4 等价产物（轻量路径）" }
      gate2: { status: pass, note: "npm test 全绿" }

  - name: desktop
    domain: tool
    stages:
      requirement: { status: complete, note: "用户确认：Electron+Vue3+AntD；身份管理/仓库审计+项目级切换/托盘快切（2026-09-02）" }
      api: { status: complete, note: "IPC 10 通道（store:get / identity:save·remove·applyGlobal·applyLocal·unsetLocal·importGlobal / repo:scan / settings:save / dialog:pickDirectory），{ok,data|error} 统一返回；store 载荷带 settings" }
      interaction: { status: complete, note: "两视图 + 头部全局标签 + 托盘单选；2026-09-03 增量：仓库审计行内「仓库身份」下拉——继承全局（含当前值提示）/单独设置身份/手配占位，选即生效；2026-09-18 增量：扫描工具栏「设为默认/清除默认」——持久化默认扫描目录与深度（与 CLI scan --save 共用 settings），输入框初始回填" }
      backend: { status: complete, note: "主进程 main/index.js：窗口/托盘/档案监听广播；GITID_DRIVE 集成验证通道；dev 专属端口 5273+标记校验；2026-09-03 修任务栏图标——assets 入包（tray.png 此前未打包）+ app.setName/--class 统一 WM_CLASS=gitid（匹配 StartupWMClass）" }
      frontend: { status: complete, note: "Vue3 + ant-design-vue 4（vite 构建）；截图验证两视图 + 打包产物一致（xvfb）" }
      validation: { status: complete, note: "desktop 测试 4 用例（core 一致性+沙箱应用+settings 读写+Electron 全链路驱动，后者无 xvfb 环境跳过）；AppImage+deb（make-deb.mjs 离线装配，ADR-013）打包验证通过；同日修复空输入扫描「目录不存在：~」——~ 展开收敛 core.js，实机回归通过" }
    gates:
      gate1: { status: pass, note: "ADR-009~012 落盘" }
      gate2: { status: pass, note: "构建/打包/xvfb 截图验证通过；托盘实机体验待用户确认（无头环境不可自动化）" }
