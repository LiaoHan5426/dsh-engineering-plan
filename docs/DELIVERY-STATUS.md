# 原方案阶段交付状态

更新：2026-11-20（第 155 轮）｜套件 669 项（668 pass / 1 skip）。**不作为整体完成声明**：本表按阶段列出实现与待办，只有「验证证据」一栏写下的真实读数才算证据。

「验证证据」一列只写真正发生过的读数：真实界面 DOM 读数、原生工具返回、真实子 Agent/命令运行。只有单元测试支撑的，会明确写「仅测试」。

| 原阶段 | 已实现 | 验证证据 | 剩余工作 |
|---|---|---|---|
| P0 contract | 版本化规划、依赖任务、逐项证据、审批与版本失效、执行记录；两类只读查询（`gateStatus`/`readyTasks`）；人工专属动作与模型工具枚举分离；21 个人类可触发拒绝码的本地化映射 | 673 项自动回归；真实工具调用覆盖 gateStatus、readyTasks、dispatchRuns；README 与动作枚举由 `tests/readme-actions.test.js` 绑定 | 独立类型包与显式迁移体系 |
| P0 planner | 八份文档 + 六项自报就绪度 + 评审要求；三种运行时 Skill（planning/architecture-design/review），正文已与现有能力对齐 | 真实创建、保存、刷新、`context` 读取（含截断清单）；标准与轻量两种导出真实落盘；`skill-content.test.js` 防漂移 | 从代码分析到评审的完整真实需求闭环（需人工批准，尚未跑通） |
| P0 storage | 原子写入、CAS、四把锁、历史快照、导出 + `manifest.json`（含 `stale` 旧投影）、不可变运行记录 | 并发与双进程回归连续 8 轮无失败；真实导出 14/8/6 文件与 `stale` 三种读数；LF 行尾门禁覆盖 77 文件 | 大规模历史拆分与迁移 |
| P0 policy | 人工审批、改版失效、依赖门禁、文件冲突（支持 `/` 目录前缀，冲突明细列出最多 3 对） | 真实读数：未批准时派发/验证被拒、`gateStatus` 列出 `APPROVAL_REQUIRED`、批准后状态流转放行「执行中」；冲突明细**仅测试** | 跨任务证据失效、冲突明细与在飞运行的界面读数 |
| P1 workflow | 单任务原生子 Agent 派发（幂等 requestId、结果返回不代表完成）、`cancelRun` 人工终止、`abandonRun` 残留预留放弃、unknown 人工结案 | 真实派发 run `2d330e17` returned（childId 真实）；真实验证 run `f9d8b388` 因 PowerShell 无 `printf` 失败并落证据；终止表单双门禁 + 跨宿主拒绝文案有读数；结案表单三项必填有读数 | 成功派发后完整收尾、成功终止（需当前宿主持有 job）、自动 DAG 编排、旧 Host 活动记录恢复、worktree 隔离 |
| P1 verifier | 已批准单命令执行、独立结果记录（exitCode/signal/timedOut/aborted/sandbox）、执行参数四字段持久化、逐项证据与人工交付冻结 | 模拟 shell/jobs 回归；真实执行参数读数为「未记录」（v1 失败run 早于该特性），新记录路径由 runner/store 测试覆盖；`gateStatus` 的 `MISSING_EVIDENCE`/`NO_COMPLETED_TASK` 有真机读数 | 获批命令的成功运行与取消、可信验收映射、真实人工交付确认、批量检查 |
| P1 UI | 四视图 + `tablist/tab/tabpanel` 语义 + roving tabIndex；五任务并行 DAG 的 SVG；三张 Mermaid 图（离线渲染、错误恢复）；交付门禁（核心判定）、当前可开始、运行记录与四种运行表单；导出清单；双语与浅/深色 | 真机读数覆盖：四页签与 ARIA、并行 DAG 分叉合流坐标、并行/证据矩阵空标准、门禁三态与未知运行、英文界面、浅色对比度缺陷修复、导出清单与 `stale` 提示、冲突/放弃草稿、轮询不覆盖编辑、派发草稿内容、`requestId` 稳定 | 正向闭环的整套界面读数（需批准）、成功终止与结案后的展示、像素级视觉验收（`browser_screenshot` 始终超时，只有计算样式与 DOM 读数） |
| P2 agent-adapter | 使用原生父 Agent 路由的单任务派发 | 原生契约核实；外部 provider（codex/claude-code）实际 `availability: missing`，方案写入 `docs/EXTERNAL-AGENT-ADAPTER.md` | 独立外部 Agent 适配 |
| P2 knowledge | 来源分类（reference/verified/assumption）、文档与发现导出 | 核心保存/导出测试 | 项目知识服务接入 |
## 最近已核实证据
- **第 152 轮**：`requiredApproval` 从元数据变成门禁归属——Agent 证据齐后推进 `completed` 被改写为 `awaiting-review`，只有 `user` 身份的推进才真正完成（`src/core.js:778`）；新增 `amendTask` 让 Agent 在实施中改任务内容（复用 `planTasks` 的依赖环与冲突校验，改验收标准清证据并退回 `running`）；规划页六项 readiness 改为只读徽标；`autoArchitectureDiagram()` 按任务依赖与 `affectedModules` 自动出图并随状态重画。真实界面读数：三页签、`.ep-notices` 显示「2 项送达阻塞」、规划页 `selects = 0`、架构折叠展开后自动图提示与 `iframe = 1`、任务看板八列含「待人工审核 · 0」。门禁读数：全套件 684 项（683 pass / 1 skip）、`npm run check` 三项通过。同时修掉一处真实的锁竞态（见验证记录第 152 轮末段）。闭环本身仅有 `tests/gate-automation.test.js` 支撑，标为「仅测试」。- **第 150 轮**：Git 能力整体下线——删除 `engineering_git` 工具、`gitObservations`/`approvalBaselineStatus`/`scopeAudit` 三个动作、审批的基线绑定与 `gateStatus.scope`，以及 `src/git-facts.js`/`src/git-operations.js`/`src/git-observation-store.js`/`src/git-comparison.js`/`src/scope-audit.js`；工具面收敛为 `engineering_plan`/`engineering_dispatch`/`engineering_verify`。客户端删掉 58 个文案键、173 行内嵌比较算法、22 个纯函数、9 个组件（client.js 5196 → 4545 行），`resources` 页签保留。门禁读数：全套件 673 项（672 pass / 1 skip，退出码 0）、`check-syntax` 18 文件、`check-locale-keys` 与 `check-declaration-order` 通过。**尚未**重载页面复核四页签与三个工具行的实际渲染。
- **第 149 轮**：Git 执行能力下线——删除 `src/git-collector.js`（子进程 + `git status --porcelain=v2` 解析），新增 `src/git-facts.js` 只校验调用方经 DSH shell 采集的事实；`engineering_git` 动作 `capture`→`record`，`compare` 必须同时带当前 `observation`；同一 `requestId` 携带不同事实返回 `REQUEST_CONFLICT`。门禁读数：全套件 836 项（835 pass / 1 skip，退出码 0）、`npm run check` 语法 25 文件/本地化键/声明顺序三项通过、`check-doc-counts` 通过。专项 `tests/git-tool.test.js` 15 项断言插件 ctx 内无 `shell`。**尚未**在真实宿主上用两条真实采集事实跑过 record/compare。
- **第 148 轮**：会话降噪——常规命令/工具行落到 `.ep-command-quiet`/`.ep-tool-quiet` 且不生成原始 JSON 节点（旧会话 3423 次命令合计 4,330,988 字符不再进 DOM）；错误、告警、阻塞、unknown 运行升为 `.ep-*-alert` 并默认展开；工作台顶部 `.ep-notices` 只列需要人工决策的项。门禁读数：全套件 860 项（859 pass / 1 skip）、`npm run check` 三项通过、`check-doc-counts` 通过。
- **第 147 轮**：三项需求收口——侧栏改 `ctx.inject(["betterSidebar"], …)` 正规动态依赖；工具行改从 `block.content` 的 text 块解析（`ToolResultNode` 无 `result` 字段）；新增 `conversation.chat.commandview`（key `engineering`）把命令 JSON 折成几行，原契约不变。门禁 855 项（854 pass / 1 skip），`npm run check` 全绿。重载后真实读数：页签条出现两个「工程研发」（会话页签 + 右侧栏页签），`.ep-compact` 计数 1；实测 `/engineering {"action":"list"}` 折成「工程研发 · list · 4 个变更」+ 四行变更明细，原文与 JSON 收进 `<details>`（1256/1500 字符）。工具行的解析路径仍仅结构测试覆盖。
- **第 146 轮**：对话流里的工程研发行改为摘要 + 可展开原文（`tool.call.toolview` 四个 key，原文截断 1200 字符）。真实读数待一次页面刷新后补；本轮只完成了代码与结构测试（4 项）。

- **第 145 轮**：工程研发可进右侧栏，与对话并排（`ctx.betterSidebar.registerTab`，id `engineering-planner:workbench`，`single: true`，同一 Panel 加 `compact`）。真实读数：会话视图页签出现「工程研发」；选中变更后出现「在侧边栏打开」；点击后右栏多出「工程研发」标签，与「Git」「任务管理」并列；`.ep-layout` 计数 2（compact 1、非 compact 1）。过程中修掉两个真实故障：`inject` 对象形式使整个客户端模块不加载、`ctx.betterSidebar` 直接读取触发 Cordis 未声明服务异常导致 `apply` 中止。侧栏入口卡片与窄栏布局的真实读数已记录，尚无像素截图（`browser_screenshot` 仍返回 DOM 渲染图）。

- 第 144 轮：跨宿主残留运行的人工释放出口已实现——`terminateRun`（命令专属，模型不可调）先由 Host 向 jobs 注册表求证不可触达，再要求用户填写终止理由/核实依据/确认项，core 记为 `run-terminated-unattached` 并把运行结算为 `cancelled`；带 `abandoned` 而无 `terminationEvidence` 的取消被 store 拒绝。证据为 `tests/terminate-run.test.js` 7 项与 `tests/client-termination.test.js` 5 项，界面渲染未取真实读数。

- 第 143 轮：浅色主题下「质量门禁」页实测——卡片正文 18.9:1、`.ep-muted` 5.8:1、`.ep-warn`/`.ep-success`/`.ep-badge`/矩阵单元格/插件页签均 18.9:1，全部通过 AA；宿主壳层视图页签 4.23:1（宿主 token，非插件）。切回深色后 `body rgb(21,21,23)`、卡片 `rgb(35,35,36)` 复原。

- 第 142 轮：正向闭环由用户本人走完——`9dd058d6` 的 `deliveryAcceptance = { planVersion 1, actor user: session-d428891f-…, acceptedAt 2026-11-20T10:27:49.649Z, note "确认" }`，`state.revision 11 / status completed`，任务带 4 条证据；界面同步显示「当前版本已确认交付」。TDZ 修复后「质量门禁」页签在真实页面正常渲染。

- 第 140 轮：控制台实读 `ReferenceError: Cannot access 'selectedTask' before initialization`（`resourcesView`）导致 `conversation.view` 整槽崩溃；已修（声明顺序），并新增 `check-declaration-order` 门禁（真实 `client.js` 通过、构造缺陷被报出）。

- 第 139 轮：`conversation.view` 的 `engineering-planner` 占用在 bundle `set_bundle false → true` 后为 `active:false`（页签可见、内容空白），页面重载后恢复 `active:true`；宿主侧同刻 `enabled:true` / `fiberPhase:active`。判据来自 `cordis_inspect_query(client, Slots)` 前后对比，不是渲染异常（`window.__epErr` 为空）。

- **第 138 轮 正向闭环首次跑通**：v2 变更 `9dd058d6-…` 由用户本人批准（`approvalRevision 3`）→ `engineering_dispatch` 返回真实子 Agent（runId `42a53888-…`，childId `08472fc1-…`，`returned`）→ `pending→running→verifying` → `engineering_verify` 成功（runId `5f4858d2-…`，`exitCode 0`，stdout `ep-positive-smoke`）→ 四条标准逐条 `passed` → `completed`（revision 10）→ `gateStatus.ready true`、`blockers []`、`commands {1/1/0/0}`。**交付确认仍未发生**，需用户在工作台点击。

- **第 138 轮 正向闭环首次跑通**：v2 变更 `9dd058d6-…` 由用户本人批准（`approvalRevision 3`）→ `engineering_dispatch` 返回真实子 Agent（runId `42a53888-…`，childId `08472fc1-…`，`returned`）→ `pending→running→verifying` → `engineering_verify` 成功（runId `5f4858d2-…`，`exitCode 0`，stdout `ep-positive-smoke`）→ 四条标准逐条 `passed` → `completed`（revision 10）→ `gateStatus.ready true`、`blockers []`、`commands {1/1/0/0}`。**交付确认仍未发生**，需用户在工作台点击。

### 第 134 轮：文档数字与测试稳定性

- 真实：门禁当场报出 `README.md tally 681 pass + 1 skip != 814 total`（总数对、通过数错）。
- 真实：全量套件在并行负载下 3 次里 2 次失败；改用「等磁盘事实」后连续 4 次全绿。
- 结论：`lockHolder` 对空锁的宽容是设计而非缺陷，是断言比现实强。

### 第 133 轮：观测记录的崩溃性质

- 真实：两次 `SIGKILL` 后，已写观测全部可读，`head` 字段仍是 40 字符，`requestId` 唯一且一一对应。
- 真实：残留锁拒绝时给出 `pid` 或「names no holder」。
- 四个写入面（state / runs / dispatches / git-observations）的注入证据至此齐全。

### 第 132 轮：派发记录的崩溃性质

- 真实：两次随机 `SIGKILL` 后，派发记录的 `state` 合法、`revision` 不回退、`requestId` 与 `taskSnapshotHash` 仍在。
- 真实：残留锁拒绝时给出 `pid` 或「names no holder」。
- 未做：`git-observations/` 的同类注入（该 store 只有 `create`，没有 `update` 循环可打断）。

### 第 131 轮：`SIGKILL` 打断运行记录写入

- 真实：被杀写手留下的空锁会报「names no holder (last modified …)」，不自动删除。
- 真实：三次随机打断后，运行记录的 `state` 合法、`revision` 不回退、关键字段齐全、目录内 `.json` 均为完整对象。
- 仅测试：`dispatches/`、`git-observations/` 两个 store 的同类注入未做（它们与 `runs/` 共用同一 `atomic()`/`locked()` 实现）。

### 第 130 轮：运行记录存储的崩溃性质

- 真实：`VerificationRunStore` 在陈旧锁上拒绝并点名 pid、说明「该进程已不再运行」，锁不被自动删除。
- 真实：`cleanTemporaries` 只删超龄 `*.tmp`，阈值内的与无关文件保留。
- 仅测试：另两个 store（`dispatches/`、`git-observations/`）沿用同一 helper，未各自构造陈旧锁读数；`SIGKILL` 打断运行记录写入本身仍未注入。

### 第 129 轮：崩溃注入与陈旧锁诊断

- 真实：被 `SIGKILL` 的写手不会留下半截 `state.json`（4 个时刻各杀一次，每次都读回校验）。
- 真实：`state.json.<uuid>.tmp` 残留会被读取方忽略；把 `mtime` 回拨 1 小时后，下一次保存删除它。
- 真实：残留 `.lock` 使 mutation 报 `LOCK_BUSY`，消息点名 pid、获取时间与存活判断；锁不被自动删除。
- 仅测试：`.lock` 内容的解析与「无法解析」分支（后者在 `lockHolder` 返回 null 时走另一条消息）。

- **第 129 轮**：新增 `tests/concurrency.test.js`——三个独立进程并发保存同一变更，断言 `revision == 1 + 承认写入数`、文档非撕裂写、`list` 无损坏警告；变异检验（注释掉 `s.revision++`）确认会红。
- **第 128 轮**：新增 `tests/invariants.test.js`——固定种子 60 步随机操作流，每步读盘校验「status 可由审批与任务状态推出」「completed 任务在任务视图与变更视图都有当前通过证据」「拒绝与导出不移动 revision」；以变异检验（把 `status()` 改成恒 `draft`）确认测试会红。套件 805 项。
- **第 127 轮**：文档门禁补上交付状态头部的算术检查——原「803 项（778 pass / 1 skip）」三数字互相矛盾（应为 802 pass），且该文件里有三个重复的 `## 最近已核实证据` 标题。已修正并合并标题，`check-doc-counts.mjs` 新增 `deliveryStatusTally` 与两条不变量。套件 804 项。
- **第 126 轮**：`context.gate` 增加 `commands: { total, succeeded, failed, unrun }`（只给计数，不含逐条运行记录），使恢复上下文的模型知道命令跑没跑过。`tests/context-gate.test.js` 增至 4 项，套件 803 项。
- **第 125 轮**：`export` 的 `progress.md` 增加 `## Runs for this plan version`（当前版本验证/派发运行逐条，含命令与退出码，并声明运行≠验收；无记录时明写而非空表）。`tests/export-runs.test.js` 三项，套件 802 项。
- **第 124 轮**：`gateStatus` 新增 `commands` 统计（按当前 `planVersion` 逐命令取最后一次尝试）与 `warnings`（证据通过但本版本无成功命令 → `NO_SUCCEEDED_COMMAND`，**不阻塞**）；界面在核心判定块追加该提示。`tests/command-summary.test.js` 六项，套件 799 项。
- **第 123 轮**：主窗口控制长期超时的根因查清——工具侧把命令压队、由应用窗口里的客户端半边长轮询执行，而该半边只在**页面加载**时注册；任何插件安装/移除都会 dispose 它。修复仓库已改为「桥接未轮询则立即拒绝并提示 Ctrl+R」，不再白等 30 秒并把方向指向「窗口没开」。恢复界面读数仍需一次页面重载（代理无法代替）。



- **第 122 轮**：`tests/full-loop.test.js` 两项首次把整条闭环走通（执行器为桩）：草稿 → 批准 → 派发（返回非完成）→ running/verifying → 验证 `succeeded` → 无证据不能 completed → 证据 → completed → `gateStatus.ready=true` → 工具侧交付被拒 → 命令侧用户交付成功 → 交付后 `ready=false`。另覆盖 blocked 必须带 reason、blocked 只接受失败证据。同时记录三处先前未写进测试的契约（工具返回 `{jobId,runId}`、`requestHeader()` 依赖、`shell.execute` 必须返回进程句柄）。



- **第 121 轮**：覆盖率补测到 98.08%，`index.js`、`src/core.js`、`src/git-collector.js`、`src/verification-runner.js` 行覆盖 100%。新增 `tests/command-cancel.test.js` 六项覆盖 `/engineering` 命令的终止入口（含 `JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`、`already-finished`、异常码不被借用、验证运行走自己的 store 与 owner），以及两条清理失败路径。界面读数仍因 webview IPC 不应答而未取得。
- **第 119 轮（重复键检查）**：新增 `scripts/check-locale-keys.mjs`，检测 `words`/`ERROR_KEYS`/`READY_REASON_KEYS` 三处的重复键（JS 里后者静默胜出，第 57 轮曾手工删过 6 个此类键）。`npm run check` 现在含语法 + 重复键两项。首版检查器因块结束位置取错，报了 8 个假阳性（块文本多吞 70KB 后续代码），已修为取最早结束位置；`tests/locale-keys.test.js` 6 项同时验证「真实文件无重复」与「构造出的重复必须被报出」。全套件 779 项。

- **第 118 轮（终止口径更正）**：第 115 轮把 `cancelRun` 的判据换成「job 句柄仍在注册表」，但 README、DESIGN 出口表、DESIGN 的 cancelRun 条目三处仍在描述旧的 `hostInstanceId` 拒绝逻辑。三处已按实现改写：句柄在则能终止（含重载前创建的运行）、`sameHost` 仅告警、`JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`、`already-finished` 单独作为 `outcome`、caller 用 `ownerSessionId`、`FOREIGN_HOST` 降为历史兼容。新增 `tests/cancel-run-claims.test.js` 4 项（含一条断言实现本身）。全套件 773 项。

- **第 117 轮（schema 下限）**：`engineering_plan` 的 `expectedRevision` 补 `minimum: 1`（另外三个工具早已有），并在 schema 描述与工具描述里写明「只读动作必须省略该字段」「每个动作只接受自己的字段」。新增 `tests/schema-bounds.test.js` 4 项。全套件 769 项。

- **第 116 轮（准入统一）**：Git 工具不再自带一份工作区准入，改为接受宿主注入的 `admittedWorkspace`；真实读数从 `ENGINEERING_WORKSPACE_MISMATCH: Workspace policy changed` 变为与另外三个工具同形的裸码 `ENGINEERING_WORKSPACE_MISMATCH`，切回工作区根后 `list` 恢复四个夹具。新增 `tests/git-admission.test.js` 3 项。全套件 765 项。

- **第 115 轮（审查缺陷修复）**：`host-audit` 指出的三条真缺陷已修——①验证运行没有把 `exec.signal` 接到自己的 `AbortController`，导致「spawn 前取消」分支不可达、取消后命令仍执行；②派发把 `AbortError` 包装成普通 `Error`，取消被上报为失败；③`cancelRun` 用 apply 级 `hostInstanceId` 当闸门，插件重载后运行永久卡死（`abandonRun` 只收 `reserved`）。修复后 `hostInstanceId` 降为告警（结果带 `sameHost`），判据交给 `jobs.kill`（`JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`），caller 改用记录里的 `ownerSessionId`。未采纳：git 准入未复用 `admittedWorkspace`（P2，记入待办）、plan schema 缺 `minimum: 1`（P3）。全套件 762 项。

- **第 114 轮（过时断言更正）**：全仓 `TODO|FIXME|未实现` 扫描发现两处「写着没做、其实做了」——`docs/DESIGN.md` 的残留运行段（`abandonRun`/`cancelRun` 已实现，却仍写「只能手工删除 `runs/*.json`」）、`docs/UI-ACCEPTANCE.md` 的 700 字旧验收清单（把已完成项列为待验）。均已改写，并新增 `tests/design-claims.test.js` 3 项防止回归。仍未实现且已写明的一档：跨宿主实例的 `starting`/`running` 无出口，`recover` 无调用点。全套件 759 项。

- **第 113 轮（观测过期提示）**：`gateStatus.scope` 增加 `stale`（观测修订 ≠ 当前修订），工作台据此显示「该观测采集于修订 12，当前是 13」；刻意不进 `blockers`、不影响 `ready`。真实读数：夹具 `511370f8` 返回 `stale: true`、`sourceRevision 12`、当前 `revision 13`。界面警示无读数（IPC 故障）。全套件 756 项。

- **第 112 轮（范围时间戳）**：`gateStatus.scope` 增加 `observedAt`（`finishedAt` 回退 `capturedAt`，无观测时 `null`），工作台把观测时间渲染在 id 旁边、缺失降级为 `—`。真实读数：夹具 `511370f8` 的 scope 显示 `observedAt 2026-11-20T05:45:33.745Z` 与 `sourceRevision 12`（当前 revision 13），说明数字属于哪一版需要时间一起看。界面文案仍无读数。全套件 753 项。

- **第 111 轮（context 门禁摘要）**：`context` 现附 `gate` 摘要（是否批准、能否交付、阻塞码、活动运行、未结案 unknown），复用 `gateStatus` 的判定而非另写一套；真实读数与单独 `gateStatus` 逐项一致且 revision 未变。另对浏览器工具长期超时做了定性排查（HTTP 在线、无 CDP、CPU 无空转），确认是主窗口通道故障而非插件渲染环。全套件 750 项。

- **第 110 轮（仓库根门禁）**：工作区根上有一个 2026-11-19 遗留的 `CON`（git 凭据提示被重定向落盘），其名字是 Windows 保留设备名，导致遍历工具跳过整棵树（`scanComplete=false`）。已删除，并新增 `tests/repo-root.test.js`：根条目白名单、禁止设备名、入口文件完整性；门禁经过「重新造出 `CON` 必须失败」的验证。全套件 747 项。

- **第 109 轮（重建脚本）**：`scripts/embed-mermaid.mjs` 的 `--check` 从未被解析，任何调用都会重写 `client.js`；且其转义步骤会误伤 vendor 源码里的 `\u2028` 文本、每次重建都给内嵌库多加 21 个反斜杠。现实现真正的只读检查（内容比较、不写盘、漂移即非零退出）、只转义原始 U+2028/U+2029、重建后自校验，并补 3 项测试覆盖「篡改块」「缺失块」两类场景。全套件 744 项。

- **第 108 轮（错误码与模式说明）**：工具侧错误现在经 `codedError` 前置错误码（真实读数：切到 `docs` 后 `engineering_git` 从 `Workspace policy changed` 变为 `ENGINEERING_WORKSPACE_MISMATCH: Workspace policy changed`，`engineering_plan` 保持裸码不重复前缀）；规划视图按 mode 显示轻量与标准在导出上的差别（轻量只写有内容的文档，旧文件进 `manifest.stale`），该行无界面读数。全套件 741 项。

- **第 107 轮（守卫错误码）**：把工作区根守卫（P1-a）从单测搬到真实调用——切到 `docs` 后 `engineering_plan`/`engineering_verify` 返回 `ENGINEERING_WORKSPACE_MISMATCH`、`engineering_git` 返回 `Workspace policy changed`，`docs/.dsh` 未生成，切回后 `list` 恢复四个夹具。顺带发现并修掉守卫错误无 `code` 导致界面永远显示 `ENGINEERING_ERROR: CODE` 的问题（25 处改为 `fail(code)`、命令通道去重、新增 10 个码的本地化），并加源码扫描门禁。界面读数因 IPC 超时未取得。全套件 733 项。

- **第 106 轮（复盘证据）**：evidence 门禁从「仅 verifying」扩为 verifying/failed/blocked，失败与阻塞只接受 `outcome: "failed"`，避免从 failed 直接写「通过」绕开验收；客户端下拉同步三态并在失败任务上收窄 outcome。真实工具读数：failed 任务接受失败证据（rev 10 → 11，任务仍 failed），同标准提交 passed 被拒（`A failed or blocked task only accepts failed evidence`）。界面读数因 webview IPC 超时未取得。全套件 728 项。

- **第 105 轮（文档口径门禁扩容）**：`scripts/check-doc-counts.mjs` 原来只比对 README 与 VERIFICATION 的套件数，`docs/DELIVERY-STATUS.md` 顶部的「套件 N 项」和「更新：…（第 N 轮）」无人校验，于是它一直停在 694 项 / 第 98 轮。本轮把两处都纳入门禁，并新增「DELIVERY-STATUS 的轮号必须等于 VERIFICATION 里最大的轮号」这条不变量。门禁首次运行即报出两处真实漂移（`claims 694, actual is 715`、`says round 98, latest round … is 104`），修正后通过。新增 `tests/doc-rounds.test.js` 5 项。
- **第 104 轮（运行状态标签）**：`textStatus` 缺 `reserved/starting/returned/succeeded/timed_out/error/unknown` 七个运行状态键，中文界面回退英文原文；补齐双语音条并加 `tests/client-run-state-labels.test.js` 3 项。真实读数：夹具 `3c83caa4` 的命令行徽章由原始 `succeeded` 变为「执行成功」（合成运行已清理，夹具 state 未改）。全套件 820 项（819 pass / 1 skip）。

- **第 103 轮（验证 requestId 复用）**：验证请求此前每次点击都 `crypto.randomUUID()`，与提示语「同一尝试复用 requestId」不符；改为插件作用域的 `cachedVerifyRequest`（键含 change/planVersion/revision/task/commandIndex），换版本、任务或命令才换 id。新增 `tests/client-verify-request-id.test.js` 5 项；界面读数待批准后取得。全套件 712 项（711 pass / 1 可选 Chromium skip）。

- **第 102 轮（命令运行状态）**：任务详情为每条验证命令显示最近一次运行（状态徽章 + 退出码，未运行则「尚未运行」），真机读到 `printf ep-positive-smoke · 失败 · exit 1`。同轮修复 `h(null, …)` 导致的白屏，并加 `h(null` 门禁。全套件 707 项（706 pass / 1 可选 Chromium skip）。

- **第 101 轮（任务可开始性说明）**：任务详情新增「此刻还不能开始的原因」，直接复用 `readyTasks` 的判定（六类原因，带 detail）；真机读到 `ANALYZE` 的 `APPROVAL_REQUIRED` 与 `API` 的 `DEPENDENCY_BLOCKED · ANALYZE`。同轮修正派发提示中过时的「重挂载会换 requestId」说法。全套件 702 项（701 pass / 1 可选 Chromium skip）。

- **第 100 轮（比较口径统一）**：`src/scope-audit.js` 的路径比较改为大小写不敏感，与核心的 `scopeOverlap` 冲突判定一致（此前同一仓库两处对「是否同一文件」答案相反）；点段仍不折叠，输出保留观测原始大小写。新增 2 项测试，重装后真实 `scopeAudit` 读数不变（17 条已跟踪 + 95 条未跟踪）。全套件 699 项（698 pass / 1 可选 Chromium skip）。

- **第 99 轮（验证互斥读数）**：在已批准夹具 `3c83caa4` 上合成一条 `reserved` 验证运行，取得 `dispatchVerificationRunning` 的界面读数——派发按钮禁用并提示「该任务已有未结束的验证运行…」。第 76 轮引入、长期仅测试支撑的分支补齐。合成运行已删除。

- **第 98 轮（状态表重写）**：按证据重写 P0/P1/P2 九行阶段表——「验证证据」只写真实读数（真实界面、原生工具返回、真实子 Agent/命令），仅测试支撑的明确标注；剩余工作写具体到「需要什么条件才能验」。下一验收顺序重写为五步并声明「完整成功链之前不扩展」。新增 `tests/delivery-status.test.js` 3 项防止限制语被删。全套件 697 项（696 pass / 1 可选 Chromium skip）。

- **第 97 轮（stale 成因更正）**：第 96 轮把 `stale` 的成因写成「标准模式导出后改轻量模式」是错的（`mode` 创建后固定）；真实成因是轻量模式下可选文档/图源「有内容才写」，先导出再清空某项会让旧文件变成 stale。已用 standard 反例（`stale: []`）与 lite 正例（`stale: ["diagrams/sequence.mmd","findings.md"]`）验证，并取得界面读数「另有旧导出的文件未被本次导出更新：…」。

- **第 96 轮（导出清单）**：`export` 现在同时写 `manifest.json`（本次写入的文件、模式、版本、以及目录里存在但本次未更新的已知投影 `stale`），不改 revision、不删旧文件；界面卡片显示清单路径并在 `stale` 非空时提示。真机读数：夹具 511370f8 的 manifest 为 `mode: standard`、14 项、`stale: []`。新增 5 项测试，全套件 694 项（693 pass / 1 可选 Chromium skip）。

- **第 95 轮（文档对齐门禁）**：README 补「只读查询」一节（gateStatus / readyTasks / scopeAudit / approvalBaselineStatus / list / get / context）；新增 `tests/readme-actions.test.js`，把工具动作枚举、人工专属动作、并发安全白名单三处与文档绑死。全套件 689 项（688 pass / 1 可选 Chromium skip）。

- **第 94 轮（终止运行界面）**：`cancelRun` 首次取得界面读数——`running` 运行出现「终止当前运行」，理由+确认双门禁，只填理由仍禁用；跨宿主提交得到「该运行由另一个宿主实例创建，本页面无法终止」。成功终止仍未被真实覆盖（需当前宿主持有该 job，而派发/验证都要用户批准）。

- **第 93 轮（requestId 稳定）**：派发请求 id 的缓存从组件状态提到插件作用域（`requestMaps` 按 `sessionId|kind`），视图重挂载后同一 change/planVersion/revision/task 复用同一 id；真机两次填入都是 `a74c4d50…`。新增 `tests/client-request-id.test.js` 4 项，全套件 686 项（685 pass / 1 可选 Chromium skip）。

- **第 92 轮（派发草稿内容）**：点「填入派发请求」后读回真实草稿——五个字段齐全、`expectedRevision` 取当前 revision 8、填入后切到会话且不自动发送、连续点击不叠加文本。同时确认 `requestId` 在视图重挂载后会重新生成（缓存存在组件状态里），已列为未覆盖项而非宣称一致。

- **第 91 轮（派发请求解锁）**：真机拿到「当前可开始 1」——已批准 v1 变更把 failed 任务放回 pending 后，看板自动显示 `已完成 0 / 1 阻塞任务 0 当前可开始 1` 与下一项任务名。同时查出派发按钮长期禁用的真因：守卫按信封形状读验证列表，而组件存的是普通数组，导致「验证记录尚未加载」恒成立。已修（两种形状都接受），并补上「同任务有非终态验证运行」这一原本缺失的分支。真机复验按钮由禁用变可用。客户端 248 项、全套件 682 项通过。

- **第 90 轮（背景刷新）**：切换变更后自动加载运行记录、交付门禁与「当前可开始」——此前 `autoRefreshRuns` 因人工动作锁而放弃，最多重试 2×250ms 仍不够。后台刷新只读，正确性已由响应归属与序列校验保证，故移除锁等待。真机：进入工作台 → 点开夹具 → 切任务看板，不点任何按钮，摘要自动变为「已完成 0 / 5 阻塞任务 0 当前可开始 0」；切到另一夹具同样自动更新。套件仍为 682 项。

- **第 89 轮（看板用核心前沿）**：任务看板的「下一项」不再自己算依赖，改读 `readyTasks` 的结果；摘要新增「当前可开始 N」，与运行记录同一刷新入口。避免与既有的「已准备项目」共用 `readyCount`，新键为 `frontierCount`。真机读数 `已完成 0 / 5 阻塞任务 0 当前可开始 0`（计划未批准，与核心判定一致）。新增 9 项测试，套件 673 → 682 项。

- **第 88 轮（readyTasks）**：新增只读 `readyTasks`，返回当前可开始的任务与逐任务阻塞原因（审批/依赖/文件重叠/在飞运行/未结案 unknown），与 `transition` 共用同一套判定，避免预览与执行不一致。真机读数与夹具 DAG 一致（ANALYZE 只差审批，JOIN 缺 API、UI）。新增 6 项测试，套件 667 → 673 项。

- **第 87 轮（门禁带范围摘要）**：`gateStatus` 增加只读 `scope` 摘要（观测 id、版本、改动/未跟踪/已声明/未声明计数），**不产生 blocker**；界面在核心判定下方显示「改动范围：已声明 0 / 共 112 条路径（观测 65b1b407…）」，与同一夹具单独 `scopeAudit` 的 17 + 95 一致。修正一处口径错误（总数漏掉未跟踪路径，现为 pathCount）。套件 666 → 667 项。

- **第 86 轮（冲突明细）**：文件冲突不再只说「已被占用」，现在列出碰撞的任务与两条路径（最多 3 对，其余标注 `(+N more)`）；错误码不变，界面沿用本地化映射 + 明细。核心测试与离线渲染验证通过，界面读数需要用户批准的方案才能触发，尚未取得。套件 665 → 666 项。

- **第 85 轮（目录声明）**：消除上一轮记录的契约错位——核心现在接受以 `/` 结尾的目录声明，文件冲突判定改为前缀重叠（`docs/` 与 `docs/a.md` 互相冲突），非法目录写法仍 `PATH_UNSAFE`。工具级确认 `expectedFiles: ["docs/"]` 可保存。新增 4 项冲突测试，套件 661 → 665 项。

- **第 84 轮（审计写进工作流）**：`engineering-review` 与 `engineering-planning` 技能补上 `scopeAudit` 的使用与 `expectedFiles` 的声明要求；重装后运行时正文已含新节。顺带把一处契约错位固定成测试——审计支持目录前缀，但核心拒绝目录声明（`PATH_UNSAFE`），因此该分支当前不可从任何计划触发。套件 659 → 661 项。

- **第 83 轮（审计三态读数）**：补齐范围审计三种状态的界面读数——stale（外部把 revision 12→13 后读「这份结果属于另一个版本」）、no_observation（无观测夹具读「还没有 Git 观测」）、observation_incomplete（合成 partial 观测读「没有保留路径清单」）。借此发现并修掉「没有可比对内容时仍显示『与当前版本一致』徽章」的渲染缺陷，补 1 项反向断言。套件 658 → 659 项。

- **第 82 轮（范围审计入界面）**：质量门禁新增「改动范围审计」卡片，展示已声明/总路径数、未声明路径（前 12 条 + 余量）与悬空声明；四种状态（未审计/过期/无观测/观测不完整）各有措辞，卡片不参与任何门禁。真机读数：夹具 511370f8 显示「与当前版本一致 · 已声明 0 / 共 112 条路径 · 另有 100 条未显示」（该夹具未声明 expectedFiles，属事实）。新增 10 项测试，套件 648 → 658 项。

- **第 81 轮（声明范围审计）**：Git 观测开始保留路径清单（`changedPaths`/`untrackedPaths`，各上限 2000，截断记 limitation，仍不读内容），旧记录以「两者皆有或皆无」的可选字段继续可读；新增只读 `scopeAudit`，把观测路径归到声明它的任务并列出未声明与未动到的声明。真机：夹具 511370f8 上 `state compared`、112 个路径全部未声明（该夹具确实没声明 expectedFiles）。套件 634 → 648 项。

- **第 80 轮（Git 观测跑通）**：修掉 diff 与留存预算共用的 1 MiB 上限（diff 单给 16 MiB 且不入留存预算），并放行 `core.autocrlf` 的行尾警告（记入 limitations，其它诊断仍失败）。首次拿到正向读数：capture `status ok / head ddd4bdc / dirty true / untrackedCount 93 / error null`；compare 未改动时 `observedEqual true`，给已跟踪的 `docs/DESIGN.md` 追加一行后 `worktreeChanged true / observedEqual false`（随后按备份还原）。套件 633 → 634 项。

- **第 79 轮（读数归因）**：`dispatchVerificationRunning` 仍无界面读数——合成验证运行后确认按钮先被审批门禁挡住（`dispatchRequestBlock` 审批在前），要读到该文案需要已批准变更 + 未结案验证运行，代理无法自行制造批准。另修正第 75 轮记录的「重新规划确认面板反复出现」：确认面板是 details 的兄弟节点，当时读数只取了 details 内部，属测量错误而非缺陷；本轮复测确认面板正常出现（提示「重新规划会归档当前版本并重置任务状态、审批与证据」+ 确认/取消），取消后方案版本不变。期间主窗口 IPC 曾短暂无响应（`1+1` 超时），随后自行恢复，56356 服务始终返回 401，未重启用户应用。

- **第 78 轮（验证列表未加载不放行派发）**：同任务验证互斥此前只看 `verifyList.runs`，验证列表未加载会被当成「没有运行」，按钮可用但提交必被核心拒绝。现补 `dispatchVerificationLoading` 前置判定（null/loading/stale/changeId 不符），省略参数仍走旧路径以兼容窄测试。新增 6 项断言，套件 630 → 631 项；该分支无界面入口，只有单元测试支撑。

- **第 77 轮（技能正文对齐）**：architecture-design 的过时能力描述、engineering-review 缺失的 gateStatus/cancelRun/同任务验证互斥说明、以及只在 planning 里出现的 PowerShell 警告全部补齐；新增 `tests/skill-content.test.js`（5 项）防回归；重装后运行时读到的技能正文已更新。套件 625 → 630 项。

- **第 76 轮（可访问性与派发前置检查）**：四个视图改用 tablist/tab/tabpanel 语义并支持 ←/→/Home/End，禁用按钮带 aria-disabled 与原因 title；派发入口新增「同任务已有未结案验证运行」检查，与核心 reserveDispatch 对齐。真机确认 ARIA 属性、方向键切换与批准按钮的 title 文案。新增 13 项测试，套件 612 → 625 项。

- **第 75 轮（拒绝码本地化）**：界面不再把核心英文拒绝原样抛出——21 个人类可触发的码映射为双语句子，未映射的码保留原文；四类带 id 的拒绝保留明细。新增 8 项测试，套件 604 → 612 项。真机触发被界面守卫先拦住，未取得「核心拒绝→中文」的界面读数，已如实记录。

- **第 74 轮（终止运行 + 审查修复 + 真机抽验）**：新增人工 `cancelRun`（仅命令与 UI，校验状态/jobId/宿主实例后调用 `jobs.kill`，由 runner 结算为 `cancelled`）；按只读审查修复 6 处客户端缺陷（交付评审「未加载」不再冒充阻塞并自动刷新、批准按钮预判计划完整性、轮询身份序列守卫、abandonment 草稿保护、gateError 跨变更残留、Mermaid 超时与 nonce 回退）。真机抽验：批准按钮在缺验收标准时禁用并给出中文提示；交付评审先显示「运行记录尚未加载」，刷新后显示核心判定列表。套件 545 → 604 项。

- **第 73 轮（文档测试数门禁）**：新增 `npm run check:counts`，把 README 与本文档声明的套件数与真实 TAP 计数对齐；本轮立即抓到 README/VERIFICATION 停在 540 而实际已 545。5 项测试，套件 540 → 545。

- **第 72 轮（NOT_FOUND 路径）**：选中后被移走的变更，`重新加载` 读到 `NOT_FOUND: Change not found`，且不再附加版本冲突提示；移回后刷新列表即恢复。列表容错的三种降级（损坏 JSON / 超限 / 链接目录）与 `get` 的两种错误（损坏 / 缺失）至此都有真实界面读数。

- **第 71 轮（损坏 get 与错误提示）**：选中后写坏 `state.json`，`方案操作 → 重新加载` 触发 `get`，错误卡读到 `CORRUPT_STATE: State JSON is corrupt`；顺带修掉「任何错误都提示按版本冲突复制草稿」的误导，改为仅 `REVISION_CONFLICT` 显示。新增 3 项测试，套件 537 → 540 项。

- **第 70 轮（超限与链接目录容错）**：2 MiB+ 的 state.json 与 junction 形式的变更目录在真实界面分别读作 `State exceeds size limit` 与 `Linked change directory`，只降级为「部分变更读取失败」，四个正常变更不受影响；删除后刷新即恢复。未覆盖 `get` 读取损坏 id 的界面文案。

- **第 69 轮（三类 blocker 与门禁过期提示）**：ACTIVE_RUN、UNRESOLVED_UNKNOWN、MISSING_EVIDENCE 在真实界面全部有读数（合成夹具，验证后删除）；顺带修掉 gateStale 提示指错刷新入口的问题；新增 LF 行尾门禁（77 个文件），起因是一次脚本改写把 client.js 整体转成 CRLF 导致 7 项测试失败。套件 534 → 537 项。

- **第 68 轮（界面改用核心门禁）**：质量门禁的交付评审不再由浏览器自行推断 —— 原实现只看 `verificationRuns`，漏掉 dispatch 运行与逐项证据，可能显示可提交而在提交时被核心拒绝。现在读 `gateStatus`，按 `changeId+planVersion+revision` 三重绑定判定新旧，未就绪即禁用交付按钮并列出 blocker。真实读数与原生工具返一致（v1 两条、v2 三条）。6 项新测试，套件 528 → 534 项。

- **第 67 轮（只读交付门禁查询）**：新增 `engineering_plan {action:"gateStatus"}`，把 `acceptDelivery` 的前置条件以 `blockers` 数据返回（审批、任务终态、至少一个 completed、逐项当前版本证据、活动与未结案运行），只读且不改 revision。7 项新测试；套件 521 → 528 项。设计意图与差异（查询不设门禁、交付仍需人工确认）写入 `docs/DESIGN.md`。

- **第 66 轮（表单即时校验）**：修掉「悄悄改值」——超长模块名与越界重试次数现在在表单内即时提示并禁用「应用到草稿」，提交处理器二次校验；存储值夹取仅用于渲染历史数据。真实页面三态验证（201 字符 → 禁用+提示；重试 99 → 禁用+另一条提示；重试 3 → 可用）。新增 8 项测试，套件 521 项。
- **第 65 轮（任务执行元数据字段）**：补上原始规格中的 `affectedModules` / `executor` / `requiredApproval` / `maxRetries` 四个规划元数据（默认值、校验、旧 state 兼容、`tasks.json` 导出、工具 schema、界面编辑与卡片展示）。真实界面往返一次：`core, client,core` 去重为 `["core","client"]`，revision 10→11，`tasks.json` 同步；随后改回默认（revision 12）。四字段不驱动任何执行或重试。门禁 513 项（512 pass / 1 skip）。
- **第 64 轮（真实页面：损坏变更的列表容错）**：放入一个非法 JSON 目录与一个 `state.id` 不匹配目录后刷新，侧栏显示「部分变更读取失败」及 `State JSON is corrupt`、`State identifier mismatch` 两条明细，四个正常变更仍可列出并打开；删除坏目录后警告消失。验证了核心逐条隔离与界面警告的端到端行为，夹具已清理。
- **第 63 轮（真实页面：批准门禁与 unknown 结案表单）**：草稿方案选「执行中」按钮禁用、改「已取消」可用；已批准 v1 方案同表单选「执行中」可用，证明门禁由审批状态驱动。另构造 `reserved → starting → unknown` 真实运行记录，确认结案表单三项必填（原因、依据、确认勾选）齐备后按钮才可用，未点击提交（人工专属动作）。夹具验证后删除，工作区恢复四个变更。
- **第 62 轮（真实页面：残留预留运行的人工放弃出口）**：用 `DispatchRunStore.reserve()` 构造真实 `reserved` 运行（无 jobId），在真实主窗口确认「放弃残留预留」折叠区、理由必填 + 确认勾选双门禁（仅填理由仍禁用、加勾选才可用）、未点击提交（人工专属动作）；验证后删除临时变更。`starting`/`running` 仍只显示「需执行终止证据，本版未提供」。
- 2026-11-20 第 61 轮（真实英文与浅色外观）：把 DSH 语言切到 English、外观切到 Light 逐项读回真实 DOM，确认工作台英文文案全部有翻译、无键名回退（四页签 Development planning / Architecture design / Task board / Quality gates，六项就绪与门禁文案均英文）。浅色下发现并修复真实缺陷：`.ep-warn` `#f59e0b`、`.ep-success` `#22c55e` 作文字色在白底仅约 2.1–2.2:1，低于 WCAG AA；现改为状态色只用于边框与 `color-mix` 10% 底色、文字统一 `--dsw-alias-label-primary`，新增 `tests/client-state-colors.test.js` 4 项。复测：`.ep-warn` 文字 `rgb(15,17,21)`、边框 `rgb(245,158,11)`，`.ep-layout` 内已无元素以状态色作文字。语言与外观已恢复为中文 + 深色并复测（深色下 warn 文字 `rgb(249,250,251)`）。套件 498 项（497 通过 / 1 可选 Chromium 跳过）退出码 0。像素截图仍不可用（`browser_screenshot` 报窗口未响应），故视觉结论均基于计算样式与 DOM 读数。
- 2026-11-20 第 59 轮（真实页面）：恢复上下文在文档超 1000 字符时先给出截断清单（`documentsTruncated`/`documentLengths`）；外部改 revision 后保存得到 `REVISION_CONFLICT` 且保留草稿，重新加载需显式放弃；轮询刷新不覆盖未提交编辑（编辑后外部改版本、等 8 秒，文本与未保存标记仍在）；证据矩阵四桶之和等于任务数、无标准行不再重复计数。新增门禁：locale 键完整性与枚举覆盖（3 项）、主题样式块零硬编码颜色且必须使用 DSH token（3 项），并在真实 `.ep-card` 上覆盖 token 验证背景色随之变化。套件 491 项（490 通过 / 1 可选 Chromium 跳过）退出码 0。
- 2026-11-20 第 58 轮（只读审查 + 修复）：`core-audit` 与 `client-audit` 各返回一份缺陷清单。已修复并加回归：`engineering_plan` 现在与另两个工具一致核对 `sandboxPolicy.workspaceRoot`（`index.js` 的 `admittedWorkspace`，新增 `tests/plan-workspace-guard.test.js` 4 项）；核心 `identifier` 拒绝 Windows 设备名（`tests/identifier-guard.test.js`）；核心 `locked()` 在 `finally` 内先比对 `dev/ino` 与 `nlink` 再删锁。审查同时确认一条**边界**而非缺陷：审批记录与被审批的计划同库明文，任何能写工作区的人（含模型 shell）都能追加，故审批是工作流约束不是安全控制，已写入 `docs/DESIGN.md`「已知信任边界」。残留非终态 run 的人工出口已在本轮补齐：`abandonRun` 仅接受「`reserved` 且无 `jobId`」的两个存储，理由+确认后置 `cancelled` 并追加历史；`starting`/`running` 需执行终止证据，本版不提供。
- 2026-11-20 第 56 轮：真实页面跑通「新建变更 → 编辑规划 → 保存草稿」：创建后六项就绪度 0/6、模式徽标「轻量」与 `mode: lite` 一致；保存后 revision 1→2，`planning.reviewRequirements` 与 `sections.requirements` 按输入落盘，界面刷新为 1/6。该一次性变更目录已在验证后删除。
- 2026-11-20 第 55 轮：真实页面确认「导出 Markdown」写出 14 个文件（合计 3494 字节）且 revision 不变；「恢复上下文」返回含 planning/sections/approvals 的结构化 JSON；pending 任务的状态流转下拉只有三项，与客户端 graph 及核心迁移表一致。完整 424 项测试、打包校验与两个嵌入一致性检查退出码 0。
- 2026-11-20 第 53–54 轮：真实页面验证并行分支 DAG（五任务、同层任务并排、斜线分叉与汇合，5 节点 5 边）与证据矩阵空标准修复；发现并修复「删除仍被依赖的任务会留下悬空分支」，拦截提示为「仍有任务依赖此任务，请先在这些任务里移除依赖：JOIN」。列表/看板切换、（`:has()` 隐藏空列）、派发请求在未批准草稿下 `disabled=true` 均以 DOM 读数确认。完整 424 项（423 pass / 1 跳过可选 Chromium）退出码 0。
- 独立顶层Session在unborn测试仓库完成真实Git capture/compare；观测持久化，state前后hash不变。观测相等不建立完整工作区相等。
- 真实页面通过实际下拉框比较同一对观测，四项Changed=false，limitations与not-established可见。
- 可选审批基线核心相关116/116、Client52通过/1可选Chromium跳过；随后父完整测试集dot退出0。重新安装返回applied/enabled。
- 基线真实页面检查只选择/清除候选，未批准。审批与交付的正向验证不能从这些只读结果推导。
- 2026-11-20独立基线审查已完成，未发现有充分证据的重大bug；本轮55项通过，昨日58项保留为历史证据。审查确认的审批卡后续状态缺口已补齐显式只读查询。真实DOM验证no_approval、刷新清除旧结果和规划输入不变；其他五态仍待真实批准夹具验证。

- 2026-11-20 打包校验增加Host静态相对import/export依赖遍历与files包含检查，14个Host模块及离线Mermaid库/许可证/重建脚本均通过。检查范围是静态资源，不替代实际安装或视觉验收。

- 2026-11-20 修复Windows锁竞争误判：四把锁统一经 `src/lock-retry.js` 把 `EEXIST/EPERM/EACCES/EBUSY` 视为持有、零链接数视为已释放，符号链接/目录/硬链接仍在写入前 `PATH_UNSAFE`。三个存储套件49/49且连续8轮无失败，完整419项（418通过/1跳过可选Chromium）退出码0；真实页面复核批准基线卡片标题只出现一次。

## 当前下一验收顺序

1. **等人工批准 v2 变更 `9dd058d6-8a19-4c3c-b8bc-11a1d7dc6a4c`**（lite，revision 2，命令已改为跨 Shell 的 `echo ep-positive-smoke`，PowerShell 实测退出码 0）。批准后按序执行：`engineering_dispatch`（requestId `ep2-dispatch-20261120-01`）→ 收集 run 与 job 输出 → 记录证据 → 任务 running → verifying → `engineering_verify`（requestId `ep2-verify-20261120-01`）→ 逐项写证据 → 完成任务 → `gateStatus` 自检 → **由用户本人点「确认当前版本交付」**。任何一步失败即停，不换命令重试。
2. 取得「成功终止」的真实读数：需要当前宿主真正持有 job，只有在第 1 步的真实派发/验证期间才可能出现，届时用 `cancelRun` 验证。
3. 补齐仅测试支撑的三处读数（都需要已批准方案或真实运行）：文件冲突明细、`dispatchVerificationRunning` 文案、审计 `stale`/`observation_incomplete` 之外的最后几个分支。
4. 再考虑自动 DAG 编排、旧 Host 活动记录的恢复协议、worktree 隔离；在单任务执行尚未取得「批准→派发→验证→证据→交付」完整成功链之前不扩展。
5. P2 外部 Agent 与知识服务保持明确待办。

详细证据见同目录 VERIFICATION.md 与 UI-ACCEPTANCE.md。未新增 Git 提交或推送。
