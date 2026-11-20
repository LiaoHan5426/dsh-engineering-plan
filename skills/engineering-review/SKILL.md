# Engineering review

用于规划评审与实现验收。审查意见是有来源的判断，不等于人工批准。插件提供单任务原生子 Agent 派发（engineering_dispatch）与单条已审批验证命令的执行记录（engineering_verify），但不提供自动任务调度：每次派发与验证都由人显式发起；命令成功也不等于全部验收条件满足。

## 恢复待评审对象

先调用 engineering_plan list/get/context，确认变更 id、当前 planVersion、revision、审批和任务状态。每次写入以最新 revision 作为 expectedRevision，遇冲突重新 get/context 后复核。不用过期摘要批准新版本，不把历史 evidence 当作当前版本结果。

读取真实相关代码、调用方、配置、测试与变更内容；将设计文档与实现逐项比较。实际追踪控制流、数据流、异常与边界行为，而不是仅检查标题或文件数量。references 分别标记 reference（外部或历史资料）、verified（实际源码/运行证据）、assumption（尚待核实）；每项发现附路径、行号或实际命令结果及适用范围。

## 规划评审

核对用户原始需求是否覆盖，假设是否清楚，现状分析是否有代码证据，架构边界和接口契约是否完整。检查任务 DAG、依赖、共享文件冲突、分阶段顺序和逐项验收条件。任务应能按调查与契约、实现、集成、验证交付推进，验收标准与实际需求对应。

核对 planning.reviewRequirements 和六项 planning.sections（requirements、analysis、architecture、interfaces、tasks、acceptance）。这些状态是自报；不从 Markdown 推断，不因全部 ready 自动批准。发现缺口时在 note 与 findings 中说明依据，必要时将相关项置 pending。规划修改会沿用现有版本递增和审批失效规则；运行中先报告问题，需人工 replan 后才能修改受锁规划。

## 实施验收

复核当前任务的预期文件、实现差异、依赖状态和验收条件。可在用户已有授权范围内使用 DSH 原生工具运行适当验证，收集真实退出码、输出、产物路径及时间/版本信息。尚未执行的命令标明未执行，失败如实记录；禁止捏造测试成功、审查通过、截图或覆盖率。

对于当前已审批任务中列明的 verificationCommands，在任务进入 verifying 后使用 engineering_verify。提供 changeId、taskId、最新 expectedRevision、planVersion、从 0 开始的 commandIndex、完全一致的 command 和本次请求唯一 requestId。保留 requestId；重试同一请求会查询已有记录，不会重复启动。新尝试须使用新 requestId。工具返回 jobId/runId 后用原生 job 工具收集或取消，用 engineering_plan verificationRuns 查询持久运行记录。核对记录的 planVersion、command、退出码、timedOut、aborted、输出截断状态；unknown 不是成功，报告给用户核查，勿绕开运行阻塞或冒充用户结案。

审阅计划的验证命令时，先判断它能否在宿主实际 Shell 中执行：Windows 上的 DSH 通常使用 PowerShell，`printf`、`grep`、`sed` 等 POSIX 命令与 `&&`、单引号可能不可用。命令不存在、语法不被识别或标记未出现在 stdout 时，按失败处理并如实报告；不要把退出码非 0 解释为通过，也不要自行改写已获批命令后重跑。运行记录中的 `execution.resolved` 只描述目录、超时、超时策略和输出上限；当前执行接口未提供解释器身份时，界面会显示“Shell 身份未记录”，不得用 job kind 或平台推断。

存在派发记录时（engineering_dispatch 的运行），使用 engineering_plan dispatchRuns 核对任务快照、planVersion、childId、jobId、state 和 result。returned 仅说明子 Agent 已返回，不表示代码正确或验收通过；failed/error/cancelled 应核查输出和实际工作区差异。活动派发与 unknown 会阻塞相关写入，勿通过另一入口修改任务或绕过锁；运行记录也不替代逐项验收证据。

任务进入 verifying 后提交验收 evidence；任务已 failed 或 blocked 时仍可补记**失败**证据（只能 failed，用于留下失败原因与现场，不会让任务变成完成）。每个 criterion 对应实际 observation，至少提供非空 note 或 artifact。产物引用本身不证明成功；区分本人报告与独立复核。符合所有当前版本条件后再 transition completed；受阻用 blocked 和具体 reason，保留未完成项。

## 交付门禁与运行处置

- 用 `engineering_plan { action: "gateStatus", changeId }` 读取核心判定的交付前置条件，不靠界面文案或自行推断。`ready: false` 时按 blocker 的 code 补齐；`ready: true` 也不代表交付已确认，确认只能由用户本人在工作台完成。
- 同一任务已有未结案验证运行（含 unknown）时，派发入口会被核心拒绝；先核查该运行或请用户结案，不要换 taskId 或另开变更绕开。
- 运行卡在 starting/running 只能由人工终止：工作台的「终止当前运行」，或用户在会话里执行 `/engineering {"action":"cancelRun",...}`。模型工具没有该动作，不要用 shell kill，也不要改写 runs/*.json。
- unknown 运行须由用户确认子 Agent、后代及相关进程均已停止后在工作台结案；结案之前该变更的相关写入保持阻塞。
## 对照声明的改动范围

- 需要判断「实际改了哪些文件、是否越出任务声明」时，用 `engineering_plan { action: "scopeAudit", changeId, observationId? }`。它读最近一次 Git 观测保留的路径清单，与任务的 `expectedFiles` 逐条对照，返回 `declaredCount`（已声明的路径数）、`undeclared`（没有任何任务声明的路径）与 `untouched`（声明了但未出现的路径）。
- 这是证据，不是许可：审计不拦截任何操作，也不读文件内容。`state` 为 `no_observation` / `observation_incomplete` 时说明观测缺失或来自旧记录，此时不要下「范围正确」的结论。
- 路径比较不区分大小写（`SRC/Core.js` 与 `src/core.js` 是同一个文件），反斜杠归一、去重排序，但不折叠点段（`src/../client.js` 与 `client.js` 视为不同）。声明可以写具体文件，也可以写以 `/` 结尾的目录；目录声明按前缀匹配该目录下的路径，且与其中任何文件声明构成同一范围（冲突判定同样按前缀）。

## 给用户的结果

按影响列出发现、证据、建议修复和未验证部分。无发现也说明实际审查范围与验证局限。记录结果到适用文档或 evidence，按需 export。人工 approve/replan 只由用户在工作台操作，Agent 不走人类命令路径冒充用户。审查不启动第二个 AgentLoop，也不承诺自动执行或自动隔离。
