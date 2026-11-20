# Changelog

## 0.3.0 — 第 155 轮：瘦身与一次误删的恢复

- 精简不再使用的词条：删掉 13 个只声明不引用的 i18n 条目（`editArchitecture`、`advancedDesign`、`liteModeHint`、`standardModeHint`、`selectChange`、`diagramHint`、`planRequest`、`taskRequest`、`verifyRequest`、`sourceOnly`、`emptyArchitecture`、`errUnknownCode`、`commandRequest`，共 14 处声明）。全量套件与 `npm run check`（语法/词条重复/声明顺序）保持全绿。
- 删掉 `src/termination-evidence.js` 里无人引用的 `export const TERMINATION_SCOPE = SCOPE;`；`SCOPE` 常量本身仍在三处使用，只去掉多余的再导出。
- 审查结论：仓库真正的体量在 `client.js` 的内嵌 mermaid（单行 3.7MB，占 93%），由 `scripts/embed-mermaid.mjs` 从 `assets/mermaid-11.17.2.min.js` 生成、为 iframe `srcdoc` 自包含所必需；手写客户端代码约 260KB。`readyCodes` / `planErrorKey` / `errorMessageKey` 三个函数在运行时没有调用者，但被若干源码切片测试当作断言对象引用，删掉会让测试失去覆盖面，因此保留。
- 事故与恢复（如实记录）：本轮为「删死词条」写的脚本先用 `^ {6}],$` 猜块结束、后用 `indexOf("\n      };")` 猜 words 块结尾，两次都猜错位置，第二次连带删掉 words 之后约 67KB / 974 行真实代码，`client.js` 结构被破坏到无法解析。工作区版本（含第 153/154 轮的读缓存、`QUIET_ACTIONS`、`alertBlockers`、命令卡 `inferAction`/`commandTitle`/`commandDetail`）此前没有提交过，`git` 只有 HEAD 与更早的 blob，`git stash`、VS Code History、DSH 的 Code Cache 都取不到源码文本。
- 恢复方式：以 HEAD 版 `client.js` 为底，把幸存的工作区前端（words 之后的头部、文件尾部）重新拼接，按测试失败逐项补回被牵连的 11 个函数（`planApproved`、`revisionConflict`、`dispatchRequestBlock`、`dispatchResolutionKey`、`dispatchResolutionHistory`、`resetDispatchConfirmations`、`bindVerificationResolution`、`abandonmentEligible`、`strandedNotice`、`abandonmentKey`、`bindAbandonment`、`abandonmentHistory`、`abandonmentPayload`）与 `awaiting-review` 词条/状态列，最后套件 686 项（685 pass / 1 skip）、`npm run check` 全过、夹具 `--mode check` 21/21、工作台在真实 GUI 里读数正常。第 153/154 轮的行为确认仍在（`readCache`、`sharedRead`、`inferAction`、`commandDetail` 等符号在位）。
- 教训写进流程：改 `client.js` 这种带巨型内嵌字符串的文件，定位块边界必须用「花括号/缩进计数」而不是猜结束串；批量删声明前必须同时 `grep tests/`，因为测试引用源码字符串也算引用；改动前先落一份工作区备份，`git` 只保护提交过的版本。

## 0.3.0 — 第 153 轮：工作台不再往会话里刷读命令

- 修掉「只要在工程研发页面点一下，会话轨迹就冒一条命令卡」的观感问题。根因有两处：工作台同时挂载两份（`conversation.view` 与侧栏 tab），每次操作两处各读一次；且每次 `loadChange` 后又串行触发 `verificationRuns` / `gateStatus` / `readyTasks` / `dispatchRuns`。实测同一交互在 transcript 里成对出现（119 条 `command/run`，多条同毫秒）。
- 读命令共享缓存：新增 `readCache` / `sharedRead(key, ttl, produce)`，同一次读在两份挂载间复用同一个未决 Promise，TTL 内命中直接返回（`list` 1500ms、`get` 800ms、`gateStatus`/`readyTasks` 1500ms、`verificationRuns`/`dispatchRuns` 1200ms）。`command()` 现拆成 `sendCommand()`（原实现）+ 读缓存/写标记两层。
- 写操作本地合并不再重读列表：`markWrite()` 记录写时刻，`mutate`/`create`/`save`/`abandonRun`/`terminateRun`/`resolveDispatchUnknown` 用返回的 `data.change` 经 `mergeSummary()` 就地更新列表行（投影与 `src/core.js:562` 一致），不再 `await list()` 打一次命令；文件监听在写完 1.2s 内跳过自读。
- 焦点/切页不再触发读：`focus`/`visibilitychange` 改成 `wake()`，距上次同步不足 30s 时不动。
- 读命令不再占会话行：`QUIET_ACTIONS`（`list/get/gateStatus/readyTasks/verificationRuns/dispatchRuns/context/export`）在 `EngineeringCommandRow` 里于 `severity === "quiet"` 时返回 `null`，transcript 仍留档，聊天流里只在出错/告警/未决运行时出现。
- 常态进度不再当告警：新增 `ALERT_BLOCKER_CODES`（`UNRESOLVED_UNKNOWN`、`MISSING_EVIDENCE`、`APPROVAL_REQUIRED`）与 `alertBlockers()`，`toolSeverity`/`commandSeverity`/`commandAlert` 与面板通知条 `openItems` 都改用它——「任务还没做完」「还没完成任务」「有在跑的运行」是进行中的正常形状，不再顶一条「需要你处理」。
- 实测（真实 GUI，`location.reload()`）：刷新 + 打开变更 A 由约 10 条命令降到 5 条（`get` + `verificationRuns` + `gateStatus` + `readyTasks` + `dispatchRuns`，一次一套）；点「刷新列表」1 条；顶部「2 项送达阻塞」消失，只保留 B 的「1 项待你确认完成」；会话里的 `工程研发 · list` 卡只剩真实告警那一类。
- 测试：新增 `tests/client-file-watch.test.js` 的缓存与 quiet 用例，改写 `client-approve-guard`、`client-notice` 与五个 `async function command(` 切片锚点为 `sendCommand`。套件 685 项（684 pass / 1 skip），退出码 0。
- 会话里的命令卡也按同一套逻辑重做（用户指出「和别的不一样」）：命令注册用了 `recordInput: false`，`CommandNode.args` 永远为 null，所以每一行都退化成「list」；现在 `inferAction()` 从作答形状还原动作（changes→列表、blockers→门禁检查、runs→运行记录、ready→可开始任务、change→变更详情），行首写 `工程研发 · 门禁检查` 这样的人话。
- 行内不再铺原始 JSON：删掉 `commandRaw`/`COMMAND_RAW_LIMIT`，`commandDetail()` 只给人类句子（一条变更一行、blocker/warning 的 `code · taskId`、失败的运行各一行），`details` 默认收起、不再自动展开；只有真正的告警才在行尾追加「N 项需要你处理」。
- counts 与 alert 不再重复计数（曾出现「1 条告警 · 1 条告警」），`commandChangeParts` 也认得裸 `changeId` 载荷，摘要不再只剩 `v1 · rev 14`。
- 夹具 A 的 A1 现在带一条 succeeded 的验证记录（`scripts/test-history.mjs` 的 `seedRun()`），门禁不再报 `NO_SUCCEEDED_COMMAND` ——那条告警原本是夹具自己制造的噪声。`--mode check` 21/21 通过。

## 0.3.0 — 第 152 轮：让 DSH 自己把任务推完

- 补上状态机的「待人工审核」态。`requiredApproval` 以前只是一个写进 `tasks.json` 的元数据字段，现在它决定收尾归属：`true` 的任务在证据齐全后由 Agent 推进 `completed` 会被改写成 `awaiting-review`（`src/core.js:778`），只有 `actor.kind === "user"` 的推进才真正完成；`false` 的任务证据齐即自动完成。`status()` 在存在 `awaiting-review` 任务时把整个变更报为 `awaiting-review`。
- 新增 `amendTask` 动作（`changeId`、`taskId`、`taskPatch`）：Agent 在实施中发现新情况时自己改任务——标题、描述、依赖、声明文件、验收标准、验证命令与四个元数据字段都可改。实现上是把任务投影后交给 `planTasks` 重算，依赖环/重复 id/文件冲突沿用 `save` 的同一套规则；验收标准变了会清掉该任务及变更级证据并把 `verifying` 退回 `running`，`history` 记一条 `task-amended`。
- 规划里的六项「准备状态」不再要求人工逐项点选，改为只读徽标展示；人工要做的只有批准方案、确认需要人工收尾的任务、确认交付。
- 架构图由规划自动生成：`autoArchitectureDiagram()` 用任务依赖与 `affectedModules` 画出 `flowchart LR`，按 `completed` / `awaiting-review` / `running` 着色，任务一动就重画；手写 `diagrams.architecture` 存在时仍以手写为准。
- 客户端：新增 `awaiting-review` 状态色与八列看板、任务卡片「确认完成」按钮、通知条「N 项待你确认完成」。
- 修掉一处真实的锁竞态：三个 store 获取锁时先 `open('wx')` 建空文件、再单独写 `{ pid, createdAt }`，进程在这两步之间被杀就留下没有持有者信息的空锁（`tests/run-record-crash.test.js` 偶发报「the refusal must name the holder」）。新增 `src/lock-retry.js` 的 `createLockFile()`，把 `open` 与写入紧挨执行、`stat` 放到写入之后。
- 测试：新增 `tests/gate-automation.test.js`（5 项）与 `tests/client-automation.test.js`（6 项），改写 `tests/task-fields.test.js` 与 `tests/client-mermaid.test.js` 的相应断言。套件 684 项（683 pass / 1 skip）。
## 0.3.0 — 第 151 轮：把界面收回到一次能看懂

- 页签从四个减到三个：开发规划、任务看板、质量门禁。原「总览」页只有一张状态卡和一张架构图，本身没有独立内容，整体并入开发规划；架构文档改成规划页里的折叠块（`details`），只在展开时挂载 `architectureView()`，图与文件列表都不再随页签切换重建。
- 解除全局忙碌锁。`button()` 原来把 `busy` 并进 `locked`，任何一次远程调用（列表、刷新、加载变更）期间整个面板的按钮全部置灰，观感与卡死无异；现在只锁调用方自己声明的 `disabled` 与不可编辑时的写操作，重复点击由 `run()` 的 `lock` 拦下并给一条 `busy` 提示。
- 标题下新增 `.ep-next` 提示条：一句话说明下一步，右侧直接给对应主按钮（计划待评审 → 评审计划；已批准 → 任务看板；已完成 → 去确认交付）。原先这句提示是灰色小字，而操作按钮在另一行，删除重复的「评审计划」按钮。
- 任务页默认列表视图：7 列看板只在宽屏排得开，默认进看板反而每次都要切回来。
- 上下文、导出、交接三个低频按钮与两段说明收进「上下文、导出与交接」折叠块；新增文案键 `moreActions`、`archSection`、`goDelivery`。
- 测试：`tests/client-tabs-aria.test.js` 末用例改为断言三元素 `TABS` 且源码不再出现 `tab === "overview"`。套件 673 项（672 pass / 1 skip）。

## 0.3.0 — 第 150 轮：插件不再接触 Git

- 上一轮把采集交给调用方，这一轮干脆把整条 Git 链路从插件里删掉。定位是流程控制：改动范围、代码基线、差异比较都是 DSH 与调用方 Agent 的事，插件不该为了这些自带存储、比较算法与面板。删除的能力包括：`engineering_git` 工具、动作 `gitObservations` / `approvalBaselineStatus` / `scopeAudit`、审批时的 `baselineObservationId` 绑定、`gateStatus.scope`、客户端整套 Git 观测与批准基线 UI，以及 `src/git-facts.js`、`src/git-operations.js`、`src/git-observation-store.js`、`src/git-comparison.js`、`src/scope-audit.js`。
- 工具面收敛为三个：`engineering_plan`、`engineering_dispatch`、`engineering_verify`。`/engineering` 命令的 JSON 文本仍是机器契约（`tests/host.test.js`、`tests/verification-tool.test.js` 直接解析），未改动。
- 审批记录只保留 `planVersion`/`actor`/`recordedAt`：没有观测可绑定，`approvalRevision` 与 `codeBaseline` 一并去掉；导出里的「Approval code baseline」段随之删除。
- `gateStatus` 不再返回 `scope`，也不再为了算路径漂移去读观测。任务的 `expectedFiles` 仍在，用途回到它本来该有的地方——同一文件的并行派发冲突判定。
- 客户端删掉 58 个只服务这些能力的文案键、173 行内嵌比较算法、22 个纯函数、9 个组件与 7 组状态；`resources` 页签保留（证据矩阵、交付评审、运行记录都在里面），只是少了范围审计那一行。行数 5196 → 4545。
- 文档：删除 `docs/GIT-OBSERVATIONS.md` 与 `docs/APPROVAL-BASELINE.md`；README 删掉「Git 观测」整节与只读动作里的两条；`skills/engineering-review/SKILL.md` 删掉「对照声明的改动范围」一节；`skills/engineering-planning/SKILL.md` 把 `expectedFiles` 的作用改回派发冲突。
- 测试：删除 19 个 Git/基线相关测试文件（`client-git`、`client-git-comparison`、`git-tool`、`git-facts`、`git-comparison`、`git-observation-store`、`approval-baseline`、`scope-audit` 等），宿主侧工具数与 disposer 数改成 3/7。套件 673 项（672 pass / 1 skip）。

## 0.3.0 — 第 149 轮：插件不再执行 Git

- 下线自行采集：删除 `src/git-collector.js`（起子进程、拼 `git status --porcelain=v2`、解析输出那套）。Git 事实改为由调用方 Agent 用 DSH shell 采集后随工具调用提交，插件只做校验、归一化与摘要。这符合插件定位——借助 DSH 的能力完成流程控制，而不是自带一套执行器。
- 新增 `src/git-facts.js`：`gitFactsParameters`（head/headState/repositoryRoot/trackedPaths/untrackedPaths/stagedDiff/worktreeDiff/limitations，2000 路径上限、16 MiB diff 上限）、`validateGitFacts`（拒绝未知字段、accessor、绝对路径、`..` 逃逸、NUL、`\ufffd`、head 与 headState 矛盾）、`buildGitObservation`（仓库根必须等于工作区，否则 `repository_outside_workspace`；调用方声明 `limitations` 时记录为 `partial`）。模块内无子进程、无文件读取、无 shell 调用。
- `engineering_git` 动作由 `capture`/`compare` 改为 `record`/`compare`：`record` 必须携带 `observation` 且禁止 `baselineId`；`compare` 必须同时携带当前 `observation` 与 `baselineId`——比较需要当前读数，插件不再替调用方采样。旧 `capture` 信封仍可读，重放时按 `record` 绑定。
- 重放判定把事实算进请求身份：同一 `requestId` 携带不同事实时返回 `REQUEST_CONFLICT`，不再默默返回旧观测。比对字段为 `head`/`headState`/`dirty`/三项摘要/`untrackedCount`/`changedPaths`/`untrackedPaths`/`limitations`，因此存储信封无需保留原始事实。
- `GitObservationStore` 的 request 校验接受 `record`（`capture` 作为旧拼写保留可读）。
- 客户端同步：请求模板改 `record` 并内置 `observation` 空模板；`gitRequestHint`/`gitPrompt` 明确写出先采集哪些 DSH shell 命令再填 `observation`；文案键 `gitCapture` → `gitRecord`。
- 门禁脚本修正：`scripts/check-doc-counts.mjs` 的 `verificationClaim` 原来对 `docs/VERIFICATION.md` 里所有「全套件 N 项」取**最大值**，隐含套件只增不减。本轮删掉 36 项采集器测试，套件从 863 降到 836，最大值仍指向历史条目，脚本持续误报。改为取文档中**第一条**声明（文件是从顶部逐轮追加的），并更新 `tests/check-doc-counts.test.js` 的用例（含 836/863 混排的收缩场景）。
- 测试：删除 `tests/git-collector.test.js`（36 项，随采集器下线）；重写 `tests/git-tool.test.js`（15 项，无 shell 桩，断言 `Object.hasOwn(ctx,'shell') === false`）；新增 `tests/git-facts.test.js`（9 项，含"模块内不得出现子进程/shell API"的静态断言）；`tests/git-admission.test.js`、`tests/client-git.test.js` 同步新动作与模板。套件 836 项（835 pass / 1 skip）。

## 0.3.0 — 第 148 轮：会话里的通知式展示

- 会话行分两级。常规调用（成功且无告警、无阻塞、无 unknown 运行）落到 `.ep-command-quiet` / `.ep-tool-quiet` 的暗色单行；错误、`warnings`、`blockers`、`state: unknown` 的运行升为 `.ep-*-alert`，带左边线、加粗并默认展开。
- 安静行不再生成原始 JSON 节点，也不再计算 `commandRaw`/`toolRaw`。旧会话 `session-d428891f` 里 3423 次 `/engineering` 共 4,330,988 字符（每次中位 1250），这些文本此前会逐条进入 DOM；现在只有提醒行携带原文。
- 工作台顶部新增通知条 `.ep-notices`：只在「计划待你评审」「送达阻塞 N 项」「运行状态待确认」出现，列表为空时不渲染；点击跳到对应页签。提醒集中到常驻侧栏，会话里不再逐行复述状态。
- 新增 `tests/client-notice.test.js` 5 项；`tests/client-toolview.test.js`、`tests/client-command-row.test.js` 的断言同步为 `ep-tool/ep-command-<severity>` 与 `open: severity === "alert"`。套件 863 项（862 pass / 1 skip）。
- 修掉「循环输出」的执行层真因：工作台每 5 秒执行一次 `/engineering {"action":"list"}`，而 DSH 的命令生命周期写入没有静默通道（`@deepseek-ai/dsh-commands/lib/index.js:312` 的 `command/run`、`:319` 的 `command/done`，`recordInput:false` 只省略参数），命令因此逐条进转录。改为监听 `.dsh/engineering/changes` 的 `remote.workspaceFiles.changes` 帧流，700 ms 去抖、120 s 仅可见时兜底、effect 依赖收窄到 `[props.sessionId]`；新增 `tests/client-file-watch.test.js` 3 项锁定「不得再出现 5 秒轮询」。
- draft 的送达阻塞不再算提醒：新增 `draftGate(view)`（`view.status === "draft"`），在 `toolSeverity`/`toolAlert`/`toolSummary`/`commandSeverity`/`commandAlert` 五处排除 `blockers`——否则每个 draft 变更都带着 7 项预期阻塞（`APPROVAL_REQUIRED`、`TASK_NOT_TERMINAL` 等）亮成通知。
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
- 记录：浅色主题下「质量门禁」页对比度实测全部通过 AA（正文 18.9:1、次要文字 5.8:1）；宿主壳层页签 4.23:1 属宿主问题。
- 新增人工动作 `terminateRun`：释放「已启动但 job 句柄不在本进程」的运行。Host 先用 jobs 注册表证伪可触达性，用户填写核实依据后记账为 `run-terminated-unattached`；带 `abandoned` 而没有 `terminationEvidence` 的取消被拒绝。
## 0.3.0 — 第 147 轮：三项需求收口

- 侧栏改用正规动态依赖 `ctx.inject(["betterSidebar"], …)`：服务就绪后才注册页签，不再靠 `ctx.get` + try/catch 手动取值。
- 工具行改从 `block.content` 的 text 块解析返回 JSON（`ToolResultNode` 没有 `result`/`output`），参数优先 `block.call.argsRaw`；摘要计数改走双语键。
- 新增 `conversation.chat.commandview`（key `engineering`）：`/engineering` 的 JSON 文本保持机器契约不变，客户端折成「工程研发 · list · N 个变更」+ 每变更一行，列表最多 8 行，原文截断 1500 字符。
- `tests/client-command-row.test.js` 5 项、`tests/client-toolview.test.js` 5 项、`tests/client-sidebar.test.js` 7 项；套件 855 项（854 pass / 1 skip）。

## 0.3.0 — 第 146 轮：对话流里的工程研发行

- 四个工具在 `tool.call.toolview` 各注册一行：摘要 `工程研发 · plan · list · 4 个变更`，`<details>` 展开原文并截断到 1200 字符。
- 行不含 hook，只用原生 `details/summary/pre`。
- `tests/client-toolview.test.js` 4 项；套件 849 项。
- （第 147 轮修正：摘要恒为空，因为读的是并不存在的 `block.result`/`block.output`。）

## 0.3.0 — 第 145 轮：工程研发可进右侧栏

- 新增 `ctx.betterSidebar.registerTab`：页签 id `engineering-planner:workbench`、`single: true`、`order: 60`，复用同一 `Panel` 并加 `compact`。
- 全宽视图新增「在侧边栏打开」入口（`openTab({ type })`）。
- `betterSidebar` 改为可选服务，`inject` 保持字符串数组。
- （第 147 轮修正：`ctx.get` 只是让 `apply` 不中断，依赖从未声明；改为 `ctx.inject(["betterSidebar"], …)`。）
- 侧栏无会话输入框时，「填入会话」回退为复制到剪贴板。
- `tests/client-sidebar.test.js` 7 项；套件 845 项。

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
