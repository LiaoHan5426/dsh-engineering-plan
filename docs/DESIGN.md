# 首版设计与扩展边界

## 目标

把研发规划从聊天文字变成可读取、可评审、可推进并留有证据的工程状态。以用户提供的 DSH-plugin-engineering-plan.md 为产品方向，优先实现可安装、可验证的最小闭环。

## 与原方案的对应

| 领域 | 当前实现 | 后续扩展 |
| --- | --- | --- |
| contract | 运行时严格校验、schemaVersion、任务和证据契约 | 独立类型包、显式迁移 |
| planner | 模型工具写入详细方案，工作台编辑和审阅 | 原生流程中的分阶段分析与评审模板 |
| storage | 工作区 JSON、原子更新、版本记录、导出；不可变 Git 观测 envelope 与请求意图重放绑定 | 独立历史存储、大规模查询 |
| policy | 人工批准、版本失效、任务依赖、声明文件冲突；可选Git基线与审批原子绑定、只读漂移状态 | 对实际修改和运行环境的策略适配、真实批准后基线验收 |
| workflow | 状态机、恢复读取、原生subagents单任务派发及持久记录 | 自动DAG编排、跨Host遗留执行核查与恢复 |
| verifier | 逐项自报证据门禁；0.3.0 单命令验证、jobs 与独立 runs、只读查询 | 真实 pipeline 验收、检查批次与可信验收映射、Git SHA 与运行环境绑定 |
| UI | 四视图、任务 DAG SVG、离线 Mermaid 三图预览、证据矩阵、运行/Git观测记录与聊天草稿请求 | 有数据全流程验收、完整视觉/主题验收、差异审阅 |
| agent adapter / knowledge | 复用现有会话工具、分类来源 | 外部 Agent 与知识库接入 |

首版只安装一个 bundle，领域核心与 Host/Client 分离。把不稳定接口过早拆成多个 npm 包会增加版本协调成本；领域契约稳定后可按上述边界提取。

## 状态模型

`revision` 是每次权威状态变更的乐观锁；`planVersion` 表示审批所针对的方案版本。批准后编辑规划会撤销当前批准并递增方案版本。已经开始的计划通过人工 `replan` 返回草稿，保留旧快照，全部任务重新开始。

任务 pending → running → verifying → completed；异常路径使用 blocked/failed/cancelled。依赖任务必须 completed，cancelled 不满足依赖。running/verifying 占用预计文件。重跑任务清空当前尝试证据并保留历史；每条验收标准最新的当前版本证据均为 passed 才允许完成。

取消操作是过程记录，非验收成功。完成汇总必须结合 completed/cancelled 数量读取。

## 信任与一致性

- actor 由 Host 适配器决定，不从工具参数接受。模型工具不包含 approve/replan。
- `/engineering` 属于 DSH 人工命令，UI 通过官方 remote.commands.execute 调用。
- 文件存储可由项目拥有者修改，本插件不是防篡改审计系统，也不提供机器级访问隔离。
- 验收证据是归因的自报记录；UI/Agent 的 passed 不替代真实命令输出或独立审查。
- 短暂锁用于防止不同会话/进程覆盖；进程退出遗留锁需确认后清理。
- 导出不是权威源，部分导出可重建；无需修改 revision。
- 会话恢复只恢复项目状态，不自动恢复或重新执行开发命令。

## 已知信任边界（只读审查结论，2026-11-20）

审查确认了两条**不是缺陷而是边界**的事实，使用前必须知道：

1. **人工审批不是安全控制。** approvals 与计划同存于 `state.json` 明文，`readState` 只做结构校验（`src/core.js` 的 `readState` 与 `currentApproval` 要求 `planVersion` 匹配且 `actor.kind === 'user'`，无 MAC/签名）。任何能写工作区文件的执行者——包括模型的 shell/文件工具——都可以追加一条 approvals 记录，使 `draft → approved`、`acceptDelivery`、派发与验证的批准校验全部放行，而导出与界面会如实显示「用户已批准」。它约束的是**工作流**（把决定权留给人的操作路径），不是权限。真正的隔离需要把审批记录或签名密钥放到工作区外，当前未实现。
2. **`engineering_plan` 与另外两个工具一致核对工作区根。** 此前只有 `engineering_verify` / `engineering_dispatch` / `engineering_git` 比对 `sandboxPolicy.workspaceRoot`，`engineering_plan` 直接信 `workingDirectory.ensure`，于是 `working_directory {cd: 子目录}` 后 `create` 会写出一个 `list` 永远看不到的第二个 store，`cd` 到工作区外还能以宿主权限在别处写 `state.json`。现由 `index.js` 的 `admittedWorkspace` 统一执行「取根 → 解析 policy → `path.resolve` 比对」三步，三个工具共用，并要求工具调用具备 `callId`/`rootCallId`/`signal`；回归见 `tests/plan-workspace-guard.test.js`。

残留运行的人工出口（分三档，均不改任务状态、证据与审批）：

| 运行状态 | 出口 | 条件 |
| --- | --- | --- |
| `reserved` | `abandonRun` | 无 `jobId`——可证明进程从未启动 |
| `starting` / `running` | `cancelRun` | 有 `jobId`，且该句柄仍在当前进程的 jobs 注册表里；只调用原生 `jobs.kill`，终态由运行器自己结算 |
| `unknown` | `resolveUnknown` / `resolveDispatchUnknown` | 人明确声明「子 Agent、所有后代及相关进程均已停止」后结案 |

已补齐的一档：**`starting`/`running` 但 job 句柄已不在当前进程的注册表里**（进程重启过、或该 job 从未在本次进程启动）。
此时 `cancelRun` 抛 `JOB_NOT_FOUND` 并返回 `ENGINEERING_RUN_EXECUTOR_GONE`；改用人工动作 `terminateRun`（`/engineering` 命令，不在模型工具枚举里）：
Host 先向 jobs 注册表求证「本进程不可触达」（若 `kill` 返回 `requested`，说明句柄还在，直接拒绝并提示改用 `cancelRun`），
再由用户填写终止理由、核实依据、核查资料与确认项；core 把这些记为 `run-terminated-unattached` 历史并把运行结算为 `cancelled`。

这一刻意保留的限制：**注册表是进程级的**。`JOB_NOT_FOUND` 只证明本进程没有该句柄，不能证明别的宿主进程里那个子 Agent 已经停止，
因此插件不写「已终止」这种事实陈述，只记录「某人在某时以某依据确认终止」；这也是该动作只对人类开放、且必须带核实依据的原因。
人工声明若与事实不符，记录里的 `terminationEvidence` 会把责任指回填写者，而不是被插件伪装成客观观测。

自动恢复（`recover`）仍无调用点，且不应仅凭「实例不同」「句柄缺失」或「超时」就把 active 改判 unknown：句柄缺失说明进程内没有执行者，但也没有证明子 Agent 已停止。

## 0.3.0 验证模块与执行边界（开发中）

- `index.js` 注册 `engineering_verify`；入口要求有效 Agent/tool call 身份，核对 workingDirectory 与 sandbox workspaceRoot。`engineering_plan verificationRuns` 只读列表/单条查询；人工命令/UI 才可 `resolveUnknown`。
- `src/verification-request.js` 校验新请求的 change、精确 revision/planVersion、当前版本人工批准、verifying 状态、命令索引与原文、requestId。命令参数不接受调用者自选 cwd 或隐式替换命令。
- `src/core.js` 的 `reserveVerification` 在 change 锁内读取当前状态、检查 requestId 重放与 blocker、预留 run；锁序为 change → runs。重放须命令快照及会话身份一致，只返回原记录。新请求与 save/replan/transition 的 blocker 检查共用 change 锁。
- `src/verification-runner.js` 在预留后再次核对工作区，用 `ctx.shell.resolve/execute` 和 `ctx.jobs.start` 启动单命令。job 关联持久化后返回 jobId/runId，完成、取消和失败由 jobs 跟踪；持久化失败保留失败语义。
- `src/verification-store.js` 将命令/版本/会话/Host 快照、jobId、run revision、输出与终态写入 `runs/<run-id>.json`，支持原子写入、跨进程幂等与 CAS，终态不可改写。`src/verification-result.js` 区分 succeeded、failed、cancelled、timed_out、error、unknown；缺失生命周期事实即使 exitCode 为 0 也不算成功。
- `reserved/starting/running` 及未人工结案的 unknown 阻止同任务新验证/transition 和变更 save/replan，包括历史计划版本的 run。人工 `resolveUnknown` 校验 change/run 双 revision，以理由追加历史并解除该 unknown 的 blocker；原 run 仍是 unknown，不改变任务、验收结论或执行命令。
- store 虽有 `recover` 方法，当前 Host/tool/UI 没有自动调用它（`terminateRun` 是人工动作，不是自动恢复）。旧 Host 的 active 记录不会仅凭实例不同或超时就自动变成 unknown；`abandonRun` 只接受无 `jobId` 的 `reserved`，`cancelRun` 只接受本宿主实例的 `starting`/`running`，跨宿主的 active 仍无出口（见上文三档表）。
- `client.js` 通过 `verificationRuns` 读取真实记录，显示运行版本与当前版本、状态、退出码、输出及截断信息。选择已批准 verifying 任务的保存命令会生成含稳定 requestId 的完整草稿；用户发送后才进入工具流程。unknown 结案入口要求核查确认与理由。

单命令执行记录不自动转成 criterion passed，不自动完成任务，也不是自动开发 executor。原方案的分阶段开发派发、失败恢复、工作树隔离、跨任务基线失效、独立用户交付验收、外部 Agent/知识服务及多包架构仍是未完成目标；本次增量不缩小原目标。0.3.0 已安装启用，真实未审批门禁及 smoke 计划页面已验证；真实正向 tools pipeline 与有数据 UI 全流程尚待验收。

## 原生单任务派发（已接入，正向运行待验证）

运行时Inspect及DSH 0.2.2-rc.5安装源码确认：`subagents.startActivation`支持预分配childId与`delivery:'caller'`，返回activation.result和dispose。启动signal只覆盖发布前；发布后取消须等待dispose及结果清理。`interrupt`与成员列表inactive均不是完成证据。生命周期事件的异步监听不保证被等待，主结果持久化应显式await。

engineering_dispatch已注册并安装，仅接受changeId/taskId/planVersion/expectedRevision/requestId，由服务器生成任务快照和提示。请求模块校验人工批准、依赖、声明文件冲突、交付冻结；core在change锁内重验并预留dispatch记录。相同requestId返回原记录，只有首次预留才启动。runner绑定工作区、父Agent路由和原生maxDepth，通过jobs管理startActivation及dispose，持久化jobId、childId和执行结果。当前194项回归包含模拟原生服务的集成测试；实际未批准请求被拦截，获批后的正向运行仍待验证。

执行记录已预留childId和requestId，绑定ownerSession/host/task/version；子Agent结果仅为执行报告，不自动写passed或completed。active及unknown阻塞相关任务操作，dispatchRuns提供只读查询。取消等待dispose；真实取消链路待验收。旧Host遗留执行核查及恢复仍待实现：hostInstanceId变化、jobs查不到、child inactive都不证明执行及后代已停止。禁止仅增加history豁免来释放active；后续恢复需要执行终止证据、存储写入隔离与跨文件提交协议。dispatch现有human-only resolveDispatchUnknown及工作台表单，使用change/run双CAS和明确终止核查声明，只对精确runId/runRevision的unknown追加结案历史；不改run或任务证据，active继续阻塞。集成回归232项通过且已安装；真实unknown表单提交待验证。dispose失败现使用粘性cleanupFailed标记，持久化为阻塞性的unknown；若unknown写盘失败则保留原活动状态，不回退为error。四种清理/写盘异常场景均通过真实EngineeringStore再次预留的阻塞断言，父Agent完整197项回归通过。测试使用模拟执行服务，实际异常恢复闭环仍待验证。子Agent使用原生maxDepth；提示文本中的禁止再派生不是强制隔离。

## EAP 适配方式

在 J:/Code/Engineering-Automation-Platform 对应的 DSH 会话创建变更，数据自然保存到该工作区。先分析当前源代码，再把工程文档分类为 reference；实际核对过的结论才记 verified，未验证设计记 assumption。插件不写死 EAP 的模块、命令、技术栈和流程政策。

## 已知规模约束

200 个任务、每次输入/状态约 2 MiB，文本及数组有长度限制；大需求拆分变更。状态机不自动计算文件真实影响范围，不检查未申报的代码修改。工作树并行隔离、跨任务代码基线失效和独立用户交付验收是后续能力。

## 只读交付门禁查询（gateStatus）

`engineering_plan { action: "gateStatus", changeId }` 是 `acceptDelivery` 的前置条件以数据形式返回，供 Agent 判断还缺什么，而不是靠抛错或读界面推测。

- 返回 `{ changeId, revision, planVersion, status, approved, deliveryAccepted, ready, blockers, tasks, runs }`。
- `blockers` 的 code：`APPROVAL_REQUIRED`、`ACTIVE_RUN`（含 kind/runId/state/jobId）、`UNRESOLVED_UNKNOWN`、`TASK_NOT_TERMINAL`（含 taskId/status）、`NO_COMPLETED_TASK`、`MISSING_EVIDENCE`（含 taskId/criterion）。
- `ready` 只在没有 blocker 且当前版本尚未被接受时为 true；它不改变任何执行门禁，也不替代人工交付确认。
- 与 `acceptDelivery` 的差异是刻意的：门禁查询允许在未批准、未完成时调用并给出原因，而交付确认仍是人工动作。

## 人工终止运行（cancelRun）

运行中的派发与验证由 runner 通过原生 jobs 执行，job 的 `cancel` 钩子会 abort 当前 AbortController 并 kill 进程，随后 runner 自己把运行记录结算为 `cancelled`（清理失败则是 `unknown`）。因此人工终止只做了两件事：校验并调用 `ctx.jobs.kill`，然后让 runner 完成结算。

校验条件（任一不满足即拒绝）：

- `state` 必须是 `starting` 或 `running`（`reserved` 无 jobId，属于「放弃残留预留」，走 `abandonRun`）；`ENGINEERING_RUN_NOT_RUNNING`。
- 记录必须有 `jobId`；`ENGINEERING_RUN_WITHOUT_JOB`（防御性分支：正常链路 `starting` 与 jobId 同时写入）。
- 是否可终止由**注册表**决定，不由 apply 身份决定：jobs 注册表是进程级的，插件重载前创建的运行仍然可 kill。因此 `hostInstanceId` 与当前 apply 不同只作为 `sameHost: false` 的告警返回，不再拒绝。
- `jobs.kill` 抛 `JOB_NOT_FOUND` → `ENGINEERING_RUN_EXECUTOR_GONE`（句柄已不在进程内，记录保持原状）；返回 `already-finished` → 结果里 `outcome: "already-finished"`，不冒充「已请求终止」。
- kill 的 caller 使用记录里持久化的 `ownerSessionId`，而不是发命令的会话 id——由子会话创建的运行，其 job 属于该子会话，用命令会话去 kill 会得到 `JOB_FOREIGN_SESSION`。
- `ENGINEERING_RUN_FOREIGN_HOST` 与界面上的对应文案属于历史兼容：旧版本宿主仍可能返回该码，保留映射但不作为当前判据。
- 请求字段严格为 `action/changeId/kind/runId/reason`，理由非空且 ≤4000 字符。

刻意不做的：不写证据、不改任务状态、不改审批与交付确认、不重试、不自动重新派发。终止后该运行仍以 `cancelled` 参与既有的 blocker 计算（`cancelled` 是终态，不阻塞）。
