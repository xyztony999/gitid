# Gate 1 验证报告 — 设计→代码门控

**模块**：cli + desktop（增量 audit-loop）
**检查时间**：2026-10-10
**设计文档版本**：v1.0
**总体判定**：**WARN**

> 未进入 B1/F1。等待用户确认后才能代码生成。
> 本产品为 CLI+桌面工具，HTTP/DDL/工作流类清单标 N/A，按 cli-specs / desktop-specs 验收。

## 逐项检查（设计 skill G1-01~G1-08）

| # | 检查项 | 结果 | 说明 |
|---|--------|------|------|
| G1-01 | 三文档全局检查 | ✅ | BA/AA/FL 层级、树与第二部分一致；BA 无用户类型；AA 四层齐全；L3→模块、L4→子模块可追溯；平台模块仅 AA/FL |
| G1-02 | PRD 完备性 | ✅ | G1–G5、T1、T1a、T9、T4/T5 通过；T2/T3 N/A |
| G1-03 | 领域模型分离 | ✅ | 聚合根 Identity；Scan/Audit/Doctor 为过程数据；无审批子流程 |
| G1-04 | API 全局检查 | ✅ | CLI 按命令契约模板；IPC 按桌面模板。HTTP/Result/DDL 等 CH* 项 N/A |
| G1-05 | API 变更摘要 | ✅ | cli-increment / desktop-ipc 均有 section 6 |
| G1-06 | PageSpec 输出校验 | ⚠️ | 三份 PageSpec 已落盘且 Action↔IPC 对齐；D4「七项现场确认」按既有 UI+需求默认，未经用户逐条点头 |
| G1-07 | 跨阶段一致性 | ✅ | gpg.format、--repos 本地、收编仅 ⚠、doctor 四项、mailmap 只展示、更新/i18n 不进 core 全阶段一致 |
| G1-08 | 枚举池无冲突 | ✅ | gpgFormat / scanStatus / doctorLevel / exportFormat / locale / completionShell 无重复定义 |

## PRD 就绪

| 层级 | 通过/总数 | 状态 |
|------|----------|------|
| 第一层（G1-G5） | 5/5 | PASS |
| 第二层（适用 T1/T1a/T4/T5/T9） | 5/5 | PASS |
| 第三层（N1-N3） | 已填 | INFO |

## API 文档完整性（栈适配）

| 章节 | 状态 | 说明 |
|------|------|------|
| CLI 命令契约 | PASS | add/import/use/scan/audit/doctor/completion |
| IPC 契约 | PASS | 新增 6 通道 + 2 字段扩展 |
| HTTP/混合模式/DDL/MQ | N/A | 非本栈 |

## 前后端契约一致性

| 编号 | 检查项 | 状态 |
|------|--------|------|
| CT-001 | 命令/IPC 与 PageSpec Action 对齐 | PASS |
| CT-002 | 字段对应（gpgFormat、locale、AuditReport） | PASS |
| CT-003 | 枚举值一致 | PASS |

## 建议项（WARN，不阻塞）

| # | 问题描述 | 建议 |
|---|---------|------|
| 1 | D4 七项确认用了默认推断 | 确认：仓库审计用 hybrid（多选+抽屉）、体检入口在页头不在凭据 Tab、README 采用「英文主文档 + 中文副本」 |
| 2 | BA/AA/FL 为首次形式化 | 确认 L2/L3 切分（历史审计放在「仓库审计与处置」下）可接受 |
| 3 | `--repos-from` 默认只处理 missing | 若希望 JSON 里勾选的 unknown 也能被应用，实现阶段再加开关（契约已留 `--include-unknown`） |

## 不通过项

无 CRITICAL 失败。

## 判定说明

WARN：建议项需用户确认，但不要求回改文档即可进入代码。用户确认后父 agent 可启动 cli-orchestrator + desktop-orchestrator（B1/F1）。
