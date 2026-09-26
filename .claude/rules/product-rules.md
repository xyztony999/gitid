# 产品级不变量（业务规则）

> 业务 profile 规则（Gate 2 分层的最上层：引擎机制 ⊕ 栈规则 ⊕ **业务规则**）。
> 这里只放"本产品拍过板的不变量"（ADR 事实），栈级工程规范见两个栈的规则集；槽位：`{profile}`=产品名，`$GITID_CONFIG`=档案覆盖变量。
> 全部为 CRITICAL——违反任何一条即 FAIL。

| # | 不变量 | 依据 ADR | 栈侧判定方法 |
|---|--------|---------|-------------|
| P-01 | **git 自身为唯一事实源**：档案只存身份数据；"当前身份"展示用生效 (name, email) 对档案做无状态精确匹配；不持久化"已应用"标记；不引入守护进程、git 钩子或后台自动切换 | ADR-002/004/011 | CLI 规则 NC-01 / 桌面端规则 EC-04 |
| P-02 | **use 全量覆盖语义**：name/email 必写；身份未定义的 signingkey / gpgsign / extra 键 / insteadOf URL 重写 / accounts 凭据选择器必须逐键 unset，不允许残留上一身份任何配置；变更清单如实展示（URL 重写类高危变更显式标注） | ADR-003/016/017 | e2e 断言切换后无残留键（NC-03 用例集） |
| P-03 | **凭据零接触**：token 生命周期 = stdin/隐藏输入 → 进程内存 → git credential 协议 → helper/OS 钥匙串；不落档案（config.json）、不进日志、不进 IPC 载荷、不回显；任何能力不含"查看 token"；源码/示例/测试零可用凭据字面量（测试用 `store --file <沙箱>` + 显式假 token）；登录线索仅 host+username 级非密钥信息 | ADR-017 | CLI 规则 NC-04/凭据 grep / 桌面端规则 EC-02/EC-06 |
| P-04 | **双端单一核心**：业务逻辑唯一事实源 = CLI 侧 `lib/core.js`；桌面端 `main/core.js` 为构建期同步副本（字节级一致由测试保障）；禁止在副本或桌面端私改逻辑 | ADR-009 | CLI 规则 NC-07 / 桌面端规则 EC-03 |
| P-05 | **测试沙箱红线**：一切测试经独立 `HOME` + `$GITID_CONFIG`（win32 另设 `USERPROFILE`/`APPDATA`）隔离，严禁读写真实 `~/.gitconfig` 与真实档案目录 | ADR-006/014 | CLI 规则 NC-04 / 桌面端规则 EC-05 |
| P-06 | **remote 镜像为 per-repo 能力**：远程镜像（`remote.<name>.pushurl` 双推）只作用于仓库本地配置，不进全局档案/全局 profile | ADR-016 | e2e 断言镜像键只落 local 域 |
