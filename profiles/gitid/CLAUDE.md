# gitid — 知识注入

Git 多身份管理器：管理多套 git 身份（user.name / user.email / user.signingkey / commit.gpgsign / 自定义键），一键应用于**全局**或**单个仓库本地**配置，并支持目录级仓库身份审计。

## 一句话业务认知

- 身份档案（本机 `~/.config/gitid/config.json`）与 git 配置（git 自身事实源）**分离存储**；`use` 把档案写入 git 配置，匹配展示靠 name+email 无状态反查
- 生效语义遵循 git 本身：**本地覆盖 → 全局回退**；`current` 展示来源，`scan` 批量审计
- 完整命令集与设计决策见知识库：business-concepts（对象模型）/ design-decisions（ADR）/ architecture-choices（结构与版本）

## 关键文件

| 内容 | 位置 |
|------|------|
| CLI 实现（零依赖单文件） | `cli/bin/gitid.js` |
| e2e 测试（沙箱隔离） | `cli/test/cli.test.mjs` |
| 模块状态 | `workspace/INDEX.md` |
