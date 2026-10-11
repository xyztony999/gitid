# Gate 1 验证报告 — 设计→代码门控

**模块**：cli + desktop（增量 includeIf 目录绑定）
**检查时间**：2026-10-11
**设计文档版本**：BA/AA/FL v1.1；PRD/API/PageSpec v1.0
**总体判定**：**WARN**

> 未进入 B1/F1。**等待用户确认后才能改 `cli/lib/core.js` 或写业务代码。**
> 本产品为 CLI+桌面工具，HTTP/DDL/工作流类清单标 N/A，按 cli-specs / desktop-specs 验收。

## 逐项检查（设计 skill G1-01~G1-08）

| # | 检查项 | 结果 | 说明 |
|---|--------|------|------|
| G1-01 | 三文档全局检查 | ✅ | BA L3「目录级身份绑定」↔ AA 核心域同名模块 ↔ FL 绑定/解绑菜单；扫描 ▣ 三文档同步；BA 无用户类型；AA 四层齐全 |
| G1-02 | PRD 完备性 | ✅ | G1–G5、T1、T1a、T9 通过；T2/T3 N/A |
| G1-03 | 领域模型分离 | ✅ | 聚合根仍为 Identity；GitdirBinding 为值对象；IncludeSnippet 为生成物；无审批子流程 |
| G1-04 | API 全局检查 | ✅ | CLI 按命令契约；IPC 按桌面模板。HTTP/Result/DDL 等 CH* 项 N/A |
| G1-05 | API 变更摘要 | ✅ | cli-includeif / desktop-ipc-includeif 均有 section 6 |
| G1-06 | PageSpec 输出校验 | ⚠️ | repos-includeif + identity-includeif 已落盘且 Action↔IPC 对齐；D4 七项按方案默认，未经用户逐条点头 |
| G1-07 | 跨阶段一致性 | ✅ | bind 立即物化、正文不写 includeIf、source 用 --show-origin、P-02 snippet、P-03 零 token、P-04 只进 core 全阶段一致 |
| G1-08 | 枚举池无冲突 | ✅ | configSource 与 ▣ 为新值；不与 gpgFormat/scanStatus/locale 冲突 |

## PRD 就绪

| 层级 | 通过/总数 | 状态 |
|------|----------|------|
| 第一层（G1-G5） | 5/5 | PASS |
| 第二层（适用 T1/T1a/T9） | 3/3 | PASS |
| 第三层（N1-N3） | 已填 | INFO |

## API 文档完整性（栈适配）

| 章节 | 状态 | 说明 |
|------|------|------|
| CLI 命令契约 | PASS | bind/unbind + use/add/remove/list/current/scan/completion 变更 |
| IPC 契约 | PASS | identity:bind / unbind + scan/store 字段 |
| HTTP/混合模式/DDL/MQ | N/A | 非本栈 |

## 前后端契约一致性

| 编号 | 检查项 | 状态 |
|------|--------|------|
| CT-001 | 命令/IPC 与 PageSpec Action 对齐 | PASS |
| CT-002 | gitdirs / source / originFile 字段对应 | PASS |
| CT-003 | 枚举值一致（configSource、▣） | PASS |

## 建议项（WARN，不阻塞代码，但请先确认）

| # | 问题描述 | 建议 / 请确认 |
|---|---------|----------------|
| 1 | D4 七项用了方案默认 | 审计页用「绑定此目录树」Dialog（身份+只读扫描根）；身份列表只展示/点除 gitdirs，不在表单手填 |
| 2 | 删除身份自动回收托管片段 | 不改 global/local user.*；与旧文案「删除不改 git」相比，只回收 gitid 自己的 include 文件 |
| 3 | bind 立即物化（不是等到下次 `use`） | 方案「use 时写 snippet」落实为：bind 立刻写；全局 use / 改档案只刷新该身份已有 snippet |
| 4 | 同一规范化路径拒绝双绑 | 重叠的祖先/后代目录允许，includes 按路径长度升序 |

## 不通过项

无 CRITICAL 失败。

## 判定说明

**WARN**：建议项需用户确认。确认后父 agent 可启动 cli-orchestrator + desktop-orchestrator（B1/F1）。确认前不得改 `cli/lib/core.js`。
