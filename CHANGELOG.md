# Changelog
- 记录正向闭环首次真实跑通：派发 runId `42a53888-…`、验证 runId `5f4858d2-…`（exit 0）、四条证据、`completed` revision 10、`gateStatus.ready true`；交付确认仍待用户本人。

- 文档门禁补上 README 的通过数：`readmeTally` 校验「N 项（P 通过、S 跳过）」三项自洽且与实测一致（第 127 轮同类漂移的第二个面）。
- 修掉两个以时间为判据的不稳定测试：空锁只要求「没有持有者」的说明，观测注入改为等磁盘计数增长后再杀。
- 新增 `tests/concurrency.test.js`：三个子进程并发保存同一变更，核对 `revision` 与承认写入数一致、无撕裂写、无损坏条目。
- 新增 `tests/invariants.test.js`：种子化随机操作流下校验状态不变量（status 推导、completed 的双视图证据、拒绝与导出不动 revision），并以变异检验确认测试会失败。
- 文档门禁：`check-doc-counts.mjs` 新增 `deliveryStatusTally`，校验交付状态头部「N 项（P pass / S skip）」的算术一致性与实测总数（此前只比总数，pass 数独自漂移到 778）。
- `context.gate` 增加命令统计计数 `commands: { total, succeeded, failed, unrun }`（刻意不含逐条运行记录），恢复上下文时可直接判断命令是否执行过。
- `export` 的 `progress.md` 增加运行段：列出当前方案版本的验证与派发运行（状态、命令、退出码），并声明运行记录不等于验收；无记录时给出明确说明。新增 `tests/export-runs.test.js` 三项。
- `gateStatus` 增加 `commands` 逐命令统计与 `warnings`（证据通过但当前版本无成功命令，仅提示不阻塞），界面在核心判定块展示；新增 `tests/command-summary.test.js` 六项。
- 界面读数长期缺失的原因查清并写入 `docs/UI-ACCEPTANCE.md`：插件安装会 dispose 窗口里的客户端半边，页面不重载则工作台与浏览器桥接都停在旧状态。修复仓库改为桥接未轮询时立即拒绝并提示重载。
- 新增 `tests/full-loop.test.js`：整条闭环（批准 → 派发 → 验证 → 证据 → 完成 → 交付门禁 → 用户交付）首次端到端通过，执行器为桩；同时固化工具返回 `{jobId,runId}`、`requestHeader()` 与 `shell.execute` 进程句柄三项契约。
- 覆盖率补测：`/engineering` 命令的终止入口（`cancelRun`）、`JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`、`already-finished` 与异常码保留，新增 `tests/command-cancel.test.js` 六项。
- 补两条清理失败路径（Git 采集失败后 `kill` 抛错、验证取消失败时写 `cancelled` 也失败），四个 Host 模块行覆盖达 100%（整体 98.08%）。
- 文档：记录「插件热启停后 `conversation.view` 注册变为 inactive、页签空白」的定位过程与判据（`cordis_inspect_query` 前后对比），并说明需页面重载恢复。
- 修复：「质量门禁」页签渲染崩溃（`ReferenceError: Cannot access 'selectedTask' before initialization`）——第 106 轮插入的 `postMortem` 读取了下一行才声明的 `selectedTask`。
- 新增 `scripts/check-declaration-order.mjs` 与 `tests/declaration-order.test.js`（5 项），并入 `npm run check`。
## 0.3.0

### 观测记录的崩溃注入

- `tests/observation-record-crash.test.js`：`SIGKILL` 打断 Git 观测写入后，已写观测仍完整、`requestId` 唯一、目录内文件均为 JSON 对象。
- 至此四个写入面的崩溃注入证据齐全。


### 派发记录的崩溃注入

- `tests/dispatch-record-crash.test.js`：`SIGKILL` 打断派发记录写入后，记录仍合法且 `requestId`/`taskSnapshotHash` 未丢。
- `tests/crash.test.js` 的长度断言改为从值本身解析（原写法在轮次号涨到两位时误报）。


### 运行记录写入的崩溃注入

- `lockHolder` 对「存在但解析失败」的锁返回时间戳与 `unreadable` 标记，`staleLockMessage` 据此给出「锁文件未记录持有者（最后修改 …）」。
- `tests/run-record-crash.test.js`：`SIGKILL` 打断验证运行记录的写入后，记录仍合法、`revision` 不回退、文件不撕裂。
- 修掉两处测试里的 `close` 监听器晚注册（子进程先退出会让测试永久挂住）。


### 运行记录存储的崩溃一致性

- `lockHolder`、`staleLockMessage`、`cleanTemporaries` 移入 `src/lock-retry.js`，`src/core.js` 与三个运行记录 store 共用，避免同一判断出现四份实现。
- 三个 store 的 `LOCK_BUSY` 现在点名持有者并说明存活判断；写入前清理超过 10 分钟的 `*.tmp`。


### 崩溃注入与陈旧锁诊断

- `tests/crash.test.js`：`SIGKILL` 打断保存后，`state.json` 仍可解析且不出现半截 `proposal`；残留临时文件被读取方忽略。
- `src/core.js`：新增 `cleanTemporaries()`，mutation 前清理超过 10 分钟的 `state.json.<uuid>.tmp`；`LOCK_BUSY` 现在点名持锁 pid、获取时间与存活判断，锁仍只能由人删除。

（开发中）
- 文档更正：README 与 `docs/DESIGN.md` 三处仍在描述「运行属于别的宿主实例就被拒绝」的旧逻辑，已改为「job 句柄仍在当前进程注册表即可终止；句柄缺失返回 `ENGINEERING_RUN_EXECUTOR_GONE`；`already-finished` 单独作为 `outcome`；`hostInstanceId` 只作 `sameHost` 告警」。新增 `tests/cancel-run-claims.test.js`。
- 修复：`engineering_plan` 的 `expectedRevision` 补 `minimum: 1`，与另外三个工具一致；schema 描述与工具描述补明「只读动作省略该字段」「每个动作只接受自己的字段」。新增 `tests/schema-bounds.test.js`。
- 修复：Git 工具（`engineering_git`）改为使用宿主注入的 `admittedWorkspace`，不再在模块内重复比对工作区策略；工作区不符时错误码与另外三个工具一致（`ENGINEERING_WORKSPACE_MISMATCH`），并补上 `sandboxPolicy` 缺失时的守卫。新增 `tests/git-admission.test.js`。
- 修复：验证运行把调用方 `exec.signal` 接入自己的 `AbortController`，取消后不再执行已批准的命令；`done` 与准入失败路径都会解绑监听。
- 修复：派发不再把 `AbortError` 重新包装成普通 `Error`（保留 `name` 与 DOMException `code`），取消不会被上报为失败。
- 修复：`cancelRun` 不再用 apply 级 `hostInstanceId` 拒绝上一次 apply 创建的运行；改为调用 `jobs.kill` 并由 `JOB_NOT_FOUND` 判定 `ENGINEERING_RUN_EXECUTOR_GONE`，结果新增 `sameHost`、`outcome`，caller 改用记录里的 `ownerSessionId`。
- 文档更正：`docs/DESIGN.md` 的残留运行段改为三档人工出口表（`abandonRun` / `cancelRun` / 人工结案），并写明跨宿主实例仍无出口、`recover` 无调用点；`docs/UI-ACCEPTANCE.md` 一段第 5–20 轮的旧验收清单改为历史说明。新增 `tests/design-claims.test.js` 防止再退回。
- 增强：`gateStatus` 的 `scope` 摘要新增 `stale`（观测所属修订与当前修订不同），工作台显示「该观测采集于修订 N，当前是 M」的警示；它只是信息，不进入阻塞项、不影响 `ready`。新增 `tests/client-scope-stale.test.js`。
- 增强：`gateStatus` 的 `scope` 摘要现在带 `observedAt`（观测完成时间），工作台据此在「已声明 / 共 N 条路径」后面显示观测时间，缺失时显示 `—`；此前一组过期数字与刚采的数字外观完全相同。新增 `tests/client-scope-time.test.js`。
- 工程：删除仓库根上遗留的 `CON`（git 凭据提示重定向产物，Windows 设备名会让目录遍历工具跳过整棵树），新增 `tests/repo-root.test.js` 固定根条目白名单、禁止设备名、检查入口文件完整性。
- 修复：`scripts/embed-mermaid.mjs` 的 `--check` 参数此前未被解析，任何调用都会重写 `client.js`；转义步骤还会改写 vendor 源码中出现的 `\u2028` 文本，使内嵌库每次重建多出 21 个反斜杠。现为真正只读的检查（内容比较、漂移即失败、不写盘），转义仅针对原始 U+2028/U+2029，重建后自校验。新增 `tests/embed-mermaid-check.test.js`。
- 修复：工具侧错误此前只把 `error.message` 交给模型，`engineering_git` 这类自带明细的守卫会丢掉错误码；现统一经 `codedError` 前置 `CODE:`（幂等，命令通道格式不变）。
- 增强：规划视图按规划模式显示说明——轻量模式只导出有内容的文档与图源、旧文件列入 `manifest.stale`，标准模式无条件写全部八篇与四张图源。新增 `tests/tool-error-code.test.js`、`tests/client-mode-hint.test.js`。
- 修复：Host 守卫错误（25 处）此前不携带 `code`，命令通道因此输出 `ENGINEERING_ERROR: CODE`，工作台按码建表的本地化文案全部命中不了；现改为 `fail(code)` 并让通道去重，同时补齐 10 个守卫码的双语文案。新增 `tests/guard-error-codes.test.js`（含「每个守卫码都必须有映射」的源码扫描门禁）。
- 增强：任务处于 failed 或 blocked 时仍可补记**失败**证据（只能 failed），用于记录失败原因与现场；不影响完成任务的门禁。客户端证据表单同步三态并在失败任务上把 outcome 收窄为 failed。新增 `tests/evidence-task-states.test.js`、`tests/client-evidence-postmortem.test.js`。
- 工程门禁：`check-doc-counts.mjs` 现在同时校验 `docs/DELIVERY-STATUS.md` 的套件数与轮号，并要求它与 `docs/VERIFICATION.md` 的最新轮号一致；首次运行即抓到 694/715 与第 98/104 轮两处漂移。新增 `tests/doc-rounds.test.js`。
- 修复：运行状态徽章在中文界面回退为原始英文值（`succeeded`/`timed_out` 等），补齐七个运行状态的双语音条并加标签覆盖测试。
- 修复：验证请求每次点击都会生成新的 `requestId`，与「同一尝试复用 requestId」的说明不符；改为插件作用域缓存（键含命令索引），并同步修正派发提示文案。新增 `tests/client-verify-request-id.test.js`。
- 界面：任务详情在每条验证命令旁显示最近一次运行的状态与退出码（未运行显示「尚未运行」）；新增 `latestCommandRun` 与 `tests/client-command-runs.test.js`，并加「不得使用 `h(null`」门禁（该写法会让整个视图白屏）。
- 界面：任务详情新增「此刻还不能开始的原因」（复用 `readyTasks` 判定，六类原因带 detail）；修正派发提示里「重挂载会换 requestId」的过时文案。新增 `tests/client-ready-reasons.test.js`。
- 修复：范围审计的路径比较改为大小写不敏感（与文件冲突判定一致），避免同一仓库两处判定相反；点段仍不折叠，输出保留观测原始大小写。
- 文档/验证：在已批准夹具上合成 `reserved` 验证运行，取得 `dispatchVerificationRunning` 的界面读数（派发按钮禁用 + 明确提示），补上第 76 轮遗留的仅测试分支。
- 文档：`docs/DELIVERY-STATUS.md` 的 P0/P1/P2 阶段表按真实读数重写（只写发生过的事，仅测试支撑的明确标注），下一验收顺序改为五步；新增 `tests/delivery-status.test.js` 防止「不作为完成声明」的限制语被删。
- 文档更正：`stale` 的成因是轻量模式「有内容才写」导致的旧文件残留，而非「标准改轻量」（`mode` 创建后不可改）。
- 新增：`export` 写出 `manifest.json`（本次写入文件、mode、planVersion、revision、`stale` 旧投影清单），界面显示清单路径并在存在旧文件时提示；旧文件仍保留，导出语义不变。
- 文档：README 新增「只读查询（Agent 与界面共用）」一节，补齐 `gateStatus`/`readyTasks`/`scopeAudit`/`approvalBaselineStatus`/`list`/`get`/`context`；新增 `tests/readme-actions.test.js` 把动作枚举与文档、人工专属名单、并发白名单绑死。

- 修复：派发/取 Git 观测的 `requestId` 缓存原本挂在组件状态里，离开工作台再回来会换 id；改为插件作用域的 `requestMaps`（按 `sessionId|kind`），随插件清理。新增 `tests/client-request-id.test.js`。

- 修复派发请求按钮永远禁用：验证列表的形状判断错误（组件存数组、守卫读信封），并补上「同任务存在非终态验证运行」分支与按任务过滤。
- 真机确认「当前可开始 1」与「下一项」在已批准计划上正确显示。

- 修复切换变更后不再自动加载运行记录/门禁/可开始任务的问题：后台只读刷新不再排队等人工动作锁。

- 新增只读 `readyTasks`：列出当前可开始的任务及每个阻塞原因（与 transition 共用判定）；抽出 `startConstraints` 消除预览与执行的分叉。套件 667 → 673 项。

- `gateStatus` 附带改动范围摘要（改动/未跟踪/已声明/未声明计数），仅作信息不拦截；界面在核心判定下方显示一行。套件 666 → 667 项。

- 文件冲突错误携带明细：指出碰撞的任务与两条路径（最多 3 对），错误码保持 `FILE_CONFLICT`。套件 665 → 666 项。

- 技能正文补上 `scopeAudit` 用法与 `expectedFiles` 声明要求；新增测试固定「目录声明被核心拒绝」这一契约错位。套件 659 → 661 项。

- 修正范围审计的新鲜度徽章：`no_observation` / `observation_incomplete` 不再显示「与当前版本一致」；三种状态的界面读数已补齐。套件 658 → 659 项。

- 质量门禁新增「改动范围审计」：把观测保留的路径与任务 expectedFiles 对照，列出未声明路径与悬空声明；只报告，不参与门禁。套件 648 → 658 项。

- 新增只读 `engineering_plan {action:"scopeAudit"}`：把 Git 观测保留的路径清单与任务 `expectedFiles` 比对，输出已声明/未声明/未动到的声明；不写入、不改变任何门禁。
- Git 观测新增 `changedPaths` 与 `untrackedPaths`（各上限 2000，截断记 limitation）；旧观测以可选字段继续可读，无需迁移。套件 634 → 648 项。

- Git 观测修复：diff 流单独使用 16 MiB 上限且不计入留存证据预算（diff 只用于 sha256），`core.autocrlf` 的行尾警告记入 limitations 而不再判为失败；本仓库首次成功采集与比较。

- 派发前置检查补上「验证列表未加载」分支：不再把未知当成没有运行，新增 `dispatchVerificationLoading` 提示先刷新运行记录（套件 631 项）。

- 技能正文对齐当前能力：修正 architecture-design 的过时描述，engineering-review 补 gateStatus、人工终止运行与同任务验证互斥，两个执行类技能都写明 PowerShell 下 POSIX 命令不可用；新增 5 项内容门禁测试（套件 630 项）。

- 可访问性：四个视图改为 tablist/tab/tabpanel 语义，支持 ←/→/Home/End；禁用按钮补 `aria-disabled` 与原因 `title`。
- 派发入口新增「同一任务已有未结案验证运行」检查，与核心 `reserveDispatch` 一致，不再给出必然被拒的请求。套件 612 → 625 项。

- 核心拒绝码本地化：21 个可触发码映射为双语句子（未映射保留原文），带任务 id/runId 的四类追加明细；套件 604 → 612 项。

- 新增人工终止运行 `cancelRun`（仅 `/engineering` 命令与工作台，不进模型工具）：校验状态/jobId/宿主实例后调用原生 `jobs.kill`，由 runner 结算为 `cancelled`；`reserved` 仍走「放弃残留预留」。新增 5 项 Host 测试与 11 项界面测试。
- 按只读客户端审查修复 6 处缺陷：交付评审不再把「运行记录未加载」当成阻塞并自动刷新、批准按钮预判计划完整性、轮询 get 增加变更身份序列守卫、`abandonment` 草稿纳入未提交保护、`gateError` 不再跨变更残留、Mermaid 超时与非安全上下文 nonce 回退。新增 41 项客户端测试。
- 核心依赖门禁改为 `?.status`：依赖指向已删除任务时返回 `DEPENDENCY_BLOCKED` 而不是 `TypeError`，新增 2 项测试。

- 新增 `npm run check:counts`：把 README 与 `docs/VERIFICATION.md` 声明的套件数与真实 TAP 计数对齐，防止测试数量继续漂移；5 项测试，套件 540 → 545 项。

- 核实选中后被删除的变更：`重新加载` 读作 `NOT_FOUND: Change not found`，不附加版本冲突提示；列表容错与 `get` 的两类错误至此均有真实界面读数。

- 错误卡的草稿提示改为只在 `REVISION_CONFLICT` 时出现：此前损坏、权限、路径类错误都会附带「若是版本冲突，可先复制草稿」的误导指引；新增 3 项测试，套件 537 → 540 项。

- 核实列表容错的剩余两条路径：超限 state（`State exceeds size limit`）与链接目录（`Linked change directory`）在真实界面只降级为警告，正常变更不受影响。

- 修正交付门禁过期提示：原文只说「刷新运行记录」，但交付卡片的「重新加载」不会重读变更，改为指明先在「方案操作」重新加载变更；新增 1 项断言。
- 新增 LF 行尾门禁（入口、src、scripts、tests 共 77 个文件）：一次脚本改写曾把 client.js 转成 CRLF，使 7 项按换行锚定的源码测试失败；套件 534 → 537 项。

- 交付评审改用核心 `gateStatus` 判定：修复浏览器只查验证运行、漏掉派发运行与逐项证据的误判；结果按 changeId+planVersion+revision 绑定，未就绪时禁用交付确认并逐条说明原因。6 项测试，套件 534 项。

- 新增只读动作 `engineering_plan {action:"gateStatus"}`：以 `blockers` 数据返回交付前置条件（审批、任务终态、逐项当前版本证据、活动/未结案运行），不写状态、不改 revision；7 项测试，套件 528 项。

- 任务表单新增即时校验：超长模块名与 0–10 之外的重试次数直接提示并禁用应用，避免「提交时悄悄夹取」；新增 8 项测试，套件 513 → 521 项。

- 任务结构体新增 `affectedModules` / `executor` / `requiredApproval` / `maxRetries` 四个规划元数据字段：核心默认与校验、旧 state 读取补默认、`context` 与 `tasks.json` 导出、Host 工具 schema、界面编辑与卡片元信息行。四字段不参与 DAG、文件冲突、审批与证据门禁，也不驱动任何自动执行或重试。
- 新增 `tests/task-fields.test.js`（6 项）与 `tests/client-task-fields.test.js`（9 项），套件 498 → 513 项。

- 修复：浅色外观下状态文字对比度不足。`.ep-warn`（`#f59e0b` 在白底约 2.1:1）与 `.ep-success`（`#22c55e` 约 2.2:1）低于 WCAG AA 小字 4.5:1，深色主题下可读所以此前未暴露。DSH 主题只有 `state-*-primary` 单一 token、没有前景文本变体，故改为「状态色只用于边框与 `color-mix` 10% 底色，文字统一 `--dsw-alias-label-primary`」；新增 `tests/client-state-colors.test.js` 4 项（状态 token 不得作为文字色、三类必须使用 primary 文字色、仍保留状态边框与 token 派生底色、该窗口零十六进制与 `rgb()`）。真实切换 English + Light 复测：`.ep-warn` 文字 `rgb(15,17,21)`、底 `color(srgb …amber / 0.1)`、边框 `rgb(245,158,11)`，`.ep-layout` 内已无任何元素以状态色作文字。
- 命名对齐：README 标题与入口说明改为「工程研发工作台 / 工程研发」，插件元数据 `locale/zh.json` 标题由「工程规划工作台」改为「工程研发工作台」、`locale/en.json` 由 Engineering planner 改为 Engineering workbench，与实际会话视图标签一致。
- 开发门禁：新增 `scripts/check-syntax.mjs`，对 `index.js`、`client.js`、`src/*.js` 与 `scripts/*.mjs` 共 19 个模块逐个 `node --check`（原先只查三个入口）；`npm run check` 改用它，另加 `tests/check-syntax.test.js` 3 项确保新增模块不会被静默漏检。
- 验收：新增主题门禁 `tests/client-theme-tokens.test.js`（样式块零硬编码颜色、必须使用 DSH 别名 token），并在真实 `.ep-card` 上覆盖 `--dsw-alias-bg-layer-1` 验证 `backgroundColor` 随 token 变化（`rgb(35,35,36)` → `rgb(247,248,250)`，移除后复原）。真实浅色主题渲染仍未验收。
- 验收：真实页面复核两项第 58 轮客户端修复。①编辑提案后外部把 revision 从 8 改到 9，等 8 秒读回文本域，输入仍在并出现「方案有新修订」提示（修复前会被轮询响应覆盖并清掉保存按钮）。②质量门禁读数为「通过 0 / 失败 0 / 待验证 4 / 尚未配置验收标准 1」，四桶和等于任务数，无标准行结果列为 `—`。
- 验收：新增中英文案完整性断言（每个键两串非空、所有字面量 t("key") 都有定义、变量传入的枚举均有定义），488 项门禁通过；英文排版与浅色主题仍无实测证据，已在文档中分开标注。
- 验收：真实页面走通「保存草稿 → 版本冲突 → 重新加载 → 放弃草稿」。外部并发写使 revision 从 6 变 7 后保存，界面显示 `REVISION_CONFLICT: State revision changed`、草稿保留提示与「复制草稿备份」；重新加载先要求显式放弃，确认后才切到磁盘内容。此前这两条只有静态证据。
- 修复（审查 P1）：`engineering_plan` 是三个工具里唯一不核对工作区根、也不校验工具调用准入的入口。`working_directory {cd: 子目录}` 后 `create` 会写出一个 `list` 永远看不到的第二个 store，`cd` 到工作区外还会让宿主以自身权限在别处新建或覆盖 `state.json`。现由 `index.js` 的 `admittedWorkspace` 统一实现「取根 → 解析 `sandboxPolicy` → `path.resolve` 比对」，`engineering_plan` / `engineering_verify` / `engineering_dispatch` 共用，并要求 `callId`/`rootCallId`/`signal`。新增 `tests/plan-workspace-guard.test.js` 4 项（工作区内正常、子目录被拒、工作区外被拒、未准入或已取消不触存储）。
- 修复（审查 P2）：核心 `identifier` 未排除 Windows 设备名，`changeId: "nul"` 能通过校验并落到 `changes\nul\`，与其他三个 store 的规则不一致（仓库根那个 `CON` 残留文件即同类）。现统一拒绝 `con|prn|aux|nul|com[1-9]|lpt[1-9]`，`nulx` 等普通前缀仍合法；新增 `tests/identifier-guard.test.js`。
- 修复（审查 P2）：核心 `locked()` 的 `finally` 直接 `unlink` 锁文件，不比对持有者身份，锁被替换时会删掉别人的锁并让第二个写者进入临界区。现在用打开时取得的 `dev/ino` 与 `lstat` 结果比对，且要求 `nlink === 1`，不一致时保留文件并报 `PATH_UNSAFE`。
- 文档：`docs/DESIGN.md` 新增「已知信任边界（只读审查结论）」——人工审批记录与计划同库明文、可被任何能写工作区的人（含模型 shell）追加，因此它是工作流约束而不是安全控制；真正隔离需把审批或签名密钥移到工作区外，当前未实现。同节记录残留非终态 run 尚无人工出口。
- 清理：语言字典里有 6 个键被同名后定义静默覆盖（`title`、`overview`、`plan`、`tasks`、`resources`、`implementation`）。对象字面量重复键只会保留最后一个，前一组「工程规划 / 概览 / 方案 / 任务 / 证据与资料 / 实现方案」实际从未生效，改它也不会有效果。删除被遮蔽的旧键后，真实页面的四个页签仍为「开发规划 / 架构设计 / 任务看板 / 质量门禁」，工作台标题仍为「工程研发工作台」，行为不变。完整回归退出码 0。
- 修复：任务卡片的「移除」会直接删掉任务而不看依赖，移除被依赖的任务会留下悬空分支，只有保存时靠核心 DAG 校验才发现。现在先算依赖者，存在即拦下并列出阻塞的任务 ID，且不改草稿；新增 `tests/client-task-remove.test.js` 3 项，真实页面复核提示为「仍有任务依赖此任务，请先在这些任务里移除依赖：JOIN」。
- 修复：质量门禁「逐项验收证据矩阵」中，没有验收标准的任务同一行既显示“尚未配置验收标准”又显示“缺少当前版本证据”。现在无标准时结果列为 `—`，只有存在标准才报缺失证据；新增 `tests/client-matrix-empty.test.js` 2 项，真实页面复核确认。
- 验收：任务依赖图在真实页面上以五任务夹具验证并行分支与合流（同层任务并排 `x=20`/`x=270`，斜线分叉与汇合，5 节点 5 边），与原始设计图的并行结构一致；证据记入 `docs/UI-ACCEPTANCE.md`。
- 修复：Windows 上锁竞争会被报成 `EPERM/EACCES/EBUSY` 而非 `EEXIST`，且被删除中的锁文件 `lstat` 可能瞬时报告零链接数，使三个存储层与 `core` 把正常竞争当成硬错误（实测 `EPERM ... dispatches\.lock` 与 `PATH_UNSAFE ... must be an unlinked regular file`）。新增 `src/lock-retry.js`（`CONTENTION_CODES`、`isLockContention`、`lockFileState`），四把锁统一把竞争当作“他人持有”在 3 秒期限内重试，零链接数视为已释放，符号链接/目录/硬链接（`nlink > 1`）仍在写入前 `PATH_UNSAFE`。三个存储套件连续 8 轮无失败，完整 419 项（418 pass / 1 跳过可选 Chromium 用例）退出码 0。新增 `tests/lock-retry.test.js` 3 项。
- 修复：批准基线卡片的标题文案重复（`h3` 与 `label` 同用 `baselineStatusTitle`），下拉标签改用新增 `baselineStatusSelect`（“用于比较的后续观测”）。新增 `tests/client-baseline-label.test.js` 2 项。
- 修复：已批准方案的任务状态卡片不再固定要求“批准当前方案”。新增 `planApproved`（当前 `planVersion` 且人工批准）并按批准状态分支提示；状态流转本不需要批准，派发与验证才需要。新增 `tests/client-transition-hint.test.js` 4 项，完整套件退出码 0，真实主窗口重载后文案已切换。
- 修复跨进程锁的释放窗口：等待者独占打开得到 `EEXIST` 后、`lstat` 之前持有者可能已 `unlink`，旧实现把“锁已消失”当成路径错误并抛 `ENOENT`。现在锁文件不存在视为已释放并重试独占打开；符号链接、目录、硬链接仍报 `PATH_UNSAFE`。新增两个真实多进程回归（并发保存、IPC 精确制造交错），完整套件退出码 0。
- 验证运行记录新增执行参数：`workdir/timeoutMs/onExpiry/stdoutMaxBytes` 在 `starting` 同一次写入，重复写入返回 `IMMUTABLE_EXECUTION`；质量门禁展示四项并固定标注“Shell 身份未记录（当前执行接口未提供）”，旧记录显示“执行参数未记录”，不从 job kind、平台或 stderr 推断解释器。
- 规划与评审技能新增验证命令可移植性约束：命令在宿主 Shell（Windows 上通常是 PowerShell）执行，优先跨 Shell 写法（如 `echo`），失败不得静默替换命令。真实测试中 `printf` 在 PowerShell 不存在，改为 `echo ep-positive-smoke` 并已实测退出码 0。
- 新增 `engineering_verify`：当前人工批准版本、verifying 任务、revision/planVersion 与精确命令快照校验；一次执行一条命令，工作目录绑定目标工作区。
- 使用 DSH shell/jobs 管理执行与取消，独立 runs 持久化结果；requestId 幂等重放只观察原运行，运行写入采用 CAS。
- 新增只读 `verificationRuns` 列表/详情；质量门禁展示真实记录、输出和截断信息，支持生成完整验证请求到原生聊天草稿。
- 在 change 锁内原子检查 blocker 与预留；active 和未结案 unknown（含历史版本）阻止相关变更。unknown 仅人工核查结案，保留原 run；没有自动 recover、自动重跑或自动开发 executor。
- 命令 succeeded 与逐项验收 passed 独立，不自动提交验收证据或完成任务。
- 父 Agent 修复 Skill 测试旧字面 `executor` 断言后，Host 3/3 及最终完整 86/86 通过（compact dot，退出码 0）；此前 85 pass / 1 fail 为阶段结果。
- 父 Agent 已安装并启用 0.3.0（application: applied）。真实页面完成四页签空态及 smoke 计划创建/读取、矩阵和 runs 空态；实际 engineering_verify 未审批门禁生效。正向执行待用户批准，真实 shell/jobs 成功链和完整 UI 流程仍待验收。
- unknown 多记录结案表单按 runId 独立保存草稿，语法检查通过，真实交互待验收。
- 轻量模式优先展开提案/实施/验收文档，高级规划及设计折叠；导出5项必要文件、非空可选内容及有任务时的DAG，保留旧导出，以返回files为本次清单。父完整回归90/90通过，重新安装后真实表单与6文件导出已验证。

- 新增独立人工交付评审：版本绑定、确认人/时间/说明、任务终态与运行阻塞校验；确认后锁定状态和证据，重新规划保留历史。完整95/95通过，运行插件已更新，真实未满足条件按钮禁用已验证，正向人工确认待验收。

- 修复context对缺少reason的任务返回undefined导致DSH拒收JSON的问题；新增无损JSON与只读回归。完整96/96通过，真实工具复测成功；页面保存/重新加载及三节点两边DAG已核实。

## 0.2.0

- 新增开发规划、架构设计、任务看板、质量门禁四个工作台视图。
- 新增六项显式规划就绪状态、评审要求、任务依赖图和验收证据矩阵。
- 新增规划、实施、验证请求到 DSH 原生输入草稿的桥接。
- 注册 engineering-planning、architecture-design、engineering-review 三个 Skill。
- 修复资料、任务状态和证据表单的草稿保护。
- 24 项核心及 Host 集成测试通过。
- 实际页面点击验证、自动验证器、任务自动派发仍未完成。

## 0.1.0

- 初始原生 DSH bundle：持久化规划、结构化依赖任务、人工审批、版本控制、证据记录及文档导出。
- 工作区隔离、并发 revision 检查、进程锁、路径保护及坏条目隔离。
