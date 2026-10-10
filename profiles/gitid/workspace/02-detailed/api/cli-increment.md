# gitid CLI 命令契约（增量）

| 属性 | 值 |
|------|-----|
| 版本 | v1.0 |
| 状态 | 草稿 |
| 最后更新 | 2026-10-10 |
| 模块 | cli |
| 功能类型 | 工具类 |
| 对照规格 | profiles/node-cli/skills/cli-specs/SKILL.md |

退出码通例：0=成功；1=用户/参数错误；2=git/IO 错误。凭据类命令不在本增量新增。

IDENTITY_KEYS（增量后）：`user.name` `user.email` `user.signingkey` `commit.gpgsign` **`gpg.format`**。

---

## add

- 用途：新建/更新 Identity（对象模型：身份）
- 参数：| 名称 | 必填 | 说明 |
  | id | 是 | 档案 id |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --name | 字符串 | 询问 | 姓名 |
  | --email | 字符串 | 询问 | 邮箱 |
  | --signingkey | 字符串 | 保留旧值 | 签名键 |
  | --gpgsign | bool | 否 | 写 commit.gpgsign |
  | --format | openpgp\|ssh\|x509 | 不声明 | 写档案 gpgFormat；非法值退出 1 |
  | --set / --insteadOf / --account | 既有 | | 不变 |
- 输入来源：参数 / 交互询问
- 输出：已新增/已更新一行；若带 format 则展示
- 退出码：0/1
- 副作用：写 Store.identities[id].gpgFormat（有 --format 时）；不写 git
- 全量覆盖语义：本命令不应用身份

---

## import

- 用途：把已有 git 配置收编为档案
- 参数：无位置参数（全局导入）或与 `--scan` 联用
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --as | id | 邮箱本地部分 | 单条 id |
  | --scan | 目录，可省略用默认扫描根 | 关 | 开启扫描收编 |
  | --depth | 正整数 | settings/6 | 仅 --scan |
  | --dry-run | bool | 否 | 只打印将收编项 |
- 输入来源：参数；扫描走 core.scanRepos
- 输出：表格「动作 / id / name / email / 来源仓库」；动作=新增/跳过/冲突警告
- 退出码：0=完成（含 0 条）；1=目录无效或 --as 用于多条手配；2=扫描 IO 失败
- 副作用：--scan 且非 dry-run 时写 Store；不写 git。仅 status=unknown。同 name+email 已存在则跳过。id 撞车则 `-2` 递增。多仓同名邮不同签名：先到者胜 + 警告
- 全量覆盖语义：不应用

无 `--scan` 时保持既有「导入全局」行为。

---

## use / local

- 用途：将 Identity 全量覆盖写入 git（全局或本地）
- 参数：| id | 是 | 档案 id |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --local | bool | 否 | 当前仓；`local` 子命令恒为 true |
  | --repos | 路径，可重复 | 无 | **强制 local**，对每个路径（须为仓库根或内路径）apply |
  | --repos-from | 文件路径或 `-` | 无 | 读 scan JSON；默认只取 status=missing |
  | --include-unknown | bool | 否 | 与 --repos-from 联用，另含 unknown |
- 输入来源：参数；JSON 须含 `{ rows: [{ path, status }] }`（与 scan --json 一致）
- 输出：每仓一行变更清单（set/unset，含 `gpg.format`）；URL 重写类高危变更沿用既有标注
- 退出码：0=全部成功；1=id 不存在/JSON 非法/--repos 与全局意图冲突（无需，因强制 local）；2=部分或全部仓 git 失败（仍继续）。建议：有失败则 2，stdout 含成功行
- 副作用：各仓 local 域写入 IDENTITY_KEYS + extra/insteadOf/accounts；未声明的 `gpg.format` unset
- 全量覆盖语义：与单仓 applyIdentity 完全一致（P-02），含 gpg.format
- 约束：`--repos` / `--repos-from` 出现时忽略「写全局」；`use <id> --repos` ≡ `local <id> --repos`。路径不是仓库则该行失败

---

## scan

- 用途：只读扫描仓库身份（对象：ScanRow）
- 参数：| 目录 | 否 | 默认 settings.scanRoot 或 `.` |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --depth | int | settings | 1–12 |
  | --save | bool | 否 | 写 settings |
  | --json | bool | 否 | 等价 `--format json` 且默认 stdout |
  | --format | json\|markdown\|csv | 人读表 | 导出 |
  | --output | 路径 | stdout | 写入文件 |
- 输入来源：参数
- 输出：
  - 默认：既有 CJK 表格
  - json：`{ rows, summary }`，rows 字段与 core.scanRepos 一致（path, rel, local, effective, hasLocal, identityId, status, remotes）
  - markdown：表格 + 汇总
  - csv：表头 status,identityId,hasLocal,name,email,remotes,path
- 退出码：0；1=目录/depth 非法；2=IO
- 副作用：仅 --save 写 settings
- 全量覆盖语义：无

---

## audit

- 用途：只读聚合作者分布（对象：AuditReport）
- 参数：| 仓库 | 否 | 默认 cwd |
- 选项：| --flag | 取值 | 默认 | 说明 |
  | --expect | 档案 id | 无 | 作者 email ≠ 该身份 email 则 polluted |
  | --json | bool | 否 | 结构化输出 |
- 输入来源：参数
- 输出：表格列：count, name, email, 匹配档案, 污染?；文末 mailmap 建议块（`Name <email>` 行）。json：`{ repo, authors, mailmapSuggestion, expectId }`
- 退出码：0；1=非仓库/--expect 不存在；2=git log 失败
- 副作用：无（不写 .mailmap、不改 refs、不写 Store）
- 全量覆盖语义：无
- 规则：作者匹配与 scan 相同（name+email 精确）。无 --expect 时「污染」列为空，仅展示命中/手配

---

## doctor

- 用途：只读环境体检（对象：DoctorReport）
- 参数：无
- 选项：| --json | bool | 否 | 结构化 |
- 输入来源：无
- 输出：表格列：级别, 检查项, 说明。检查项固定：
  1. `git-version`：git --version；不在 PATH 为 fail
  2. `credential-helper`：credential.helper 已配置且可探测（扩展现有 list 探测，关闭交互，不读 token）
  3. `ssh-insteadof`：`~/.ssh/config` 的 Host/HostName 与生效 insteadOf / 档案 insteadOf 能否对上；对不上 warn
  4. `insteadof-conflict`：同一 original 映射到不同 url，或全局+档案规则互相覆盖 → fail
- 退出码：0=无 fail（可有 warn）；1=参数错误；2=存在 fail 项
- 副作用：无
- 全量覆盖语义：无
- 凭据：载荷与输出仅 helper 名/是否在位，零 token（P-03）

---

## completion

- 用途：打印静态补全脚本
- 参数：| shell | 是 | bash\|zsh\|fish\|pwsh |
- 选项：无
- 输入来源：参数
- 输出：脚本全文到 stdout（零依赖，覆盖已有子命令 + 本增量命令/选项）
- 退出码：0；1=未知 shell
- 副作用：无
- 全量覆盖语义：无

---

## current / unset / list / remove / remote / credential

- 用途：既有命令
- 变更：`current` 在有 `gpg.format` 时多展示一行来源（与 signingkey 相同展示规则）；`unset` 清除 IDENTITY_KEYS 时含 `gpg.format`；其余无契约变更

---

## 枚举

| 枚举 | 值 | 来源 |
|------|----|------|
| gpgFormat | openpgp, ssh, x509 | 本增量（对照 git gpg.format） |
| scanStatus | ok, missing, unknown | 已有 core |
| doctorLevel | ok, warn, fail | 本增量 |
| exportFormat | json, markdown, csv | 本增量 |
| locale | zh, en | 本增量（桌面设置；CLI 不用） |
| completionShell | bash, zsh, fish, pwsh | 本增量 |

---

## 错误码（CLI 文案，非 HTTP）

| 场景 | 退出 | 文案要点 |
|------|------|----------|
| 非法 --format | 1 | 签名格式只允许 openpgp / ssh / x509 |
| --as 用于多条手配 | 1 | 多条手配请去掉 --as 或先筛目录 |
| --repos-from 非 scan JSON | 1 | 文件不是 gitid scan --json 结构 |
| 路径不是 git 仓库 | 2（该行） | 不是 git 仓库：\<path\> |
| expect 档案不存在 | 1 | 与 getIdentity 相同 |

---

## 6. 更新记录

| 版本 | 日期 | 变更类型 | 说明 |
|------|------|----------|------|
| v1.0 | 2026-10-10 | initial | 增量命令契约：import --scan, use --repos, scan 导出, audit, doctor, completion, add --format |
