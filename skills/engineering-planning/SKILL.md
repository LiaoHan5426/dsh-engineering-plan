# Engineering planning

用于从工程需求建立可评审、可恢复的开发规划。使用 engineering_plan 和 DSH 原生读取、搜索、编辑工具。插件已提供 engineering_dispatch 单任务原生子 Agent 派发和 engineering_verify 单条已批准命令执行，运行记录与任务验收分开；自动任务图调度、自动工作树隔离及独立语义验收仍未实现。

## 恢复与调查

1. 先调用 engineering_plan list，选定变更后读取 get 与 context。没有变更时 create 草稿。每次写操作使用最新返回的 revision 作为 expectedRevision；遇到 REVISION_CONFLICT 重新 get/context 并合并变更，不覆盖其他人的修改。
2. 读取用户需求及相关代码，追踪真实入口、调用链、数据流、测试和配置。文件存在或旧文档的描述并不证明当前实现行为。涉及 DSH 扩展先加载 dsh-doc 并 Inspect 实际接口。
3. references 区分 reference（历史文档或外部参考）、verified（实际读过代码或观察到行为，并附路径/行号/命令结果）、assumption（尚待验证）。源码证据只支持静态结论，运行行为需实际观察。EAP 等参考项目不构成固定流程要求。

## 形成规划

按需求澄清、现状分析、架构设计、接口契约、任务拆解、验收设计顺序推进。保存 proposal、requirements、architecture、implementation、impact-analysis、acceptance、decisions、findings 中相关文档；图表源码可保存到 diagrams.architecture、sequence、data-flow。

将待人工关注的要求保存为 planning.reviewRequirements。逐项显式填写 planning.sections 的 requirements、analysis、architecture、interfaces、tasks、acceptance，每项含 status（pending 或 ready）与 note。就绪度是自报；依据实际分析结果填写，绝不通过解析 Markdown 标题、复选框或文档长度推断。证据不足留 pending，note 说明缺口。六项 ready 不是新增审批门禁。

将工作拆为调查与契约、核心实现、集成界面、验证交付等适合本需求的阶段。任务使用唯一 id，明确 dependencies、expectedFiles、acceptanceCriteria、verificationCommands；阶段顺序用依赖表达。每个验收条件可观察、可执行，验证命令仅为计划，尚未执行就不记为通过。同文件任务避免并行。

验证命令会在宿主实际使用的 Shell 中执行，而不一定是你当前终端的 Shell。Windows 上 DSH 常用 PowerShell（`pwsh`），`printf`、`grep`、`sed` 等 POSIX 命令与 `&&`、单引号语义可能不存在或不同；`job` 的 kind 为 `bash` 只是任务分类，不是执行器证据。写命令时：

- 优先选择跨 Shell 通用的最小命令（如 `echo <marker>`），或显式使用目标 Shell 的调用方式（如 `pwsh -NoProfile -Command "..."`）。
- 不要把只有在 Bash 中才成立的管道、重定向、引号和退出码约定直接写进计划。
- 无法确定 Shell 时，在计划中加入一条先探测再断言的步骤，或让命令自身同时验证标记与退出码，而不是假设环境。
- 命令一旦获批即受版本约束；执行失败时记录失败证据并按计划停止，不要静默替换成另一个命令继续。

## 评审与实施

保存草稿后交由用户在工作台人工 approve；Agent 不调用人类命令冒充批准。工程工具也不授予任意源码修改权限。经当前版本人工批准后，使用 DSH 原生工具执行任务并记录 pending → running → verifying → completed；依赖、冲突和验收门禁仍适用。遇阻记录 blocked 与具体 reason。

需要派发时使用 engineering_dispatch 的 changeId、taskId、expectedRevision、planVersion、requestId；保存返回的 jobId/runId，同一次尝试重用 requestId。通过 job 工具收集结果，并用 engineering_plan dispatchRuns 读取持久记录；returned 不代表验收通过。验证任务进入 verifying 后使用 engineering_verify 执行当前批准的原样命令，通过 verificationRuns 核对结果；退出码零不自动满足业务验收条件。活动或未知运行先调查，勿通过改写状态文件解除阻塞。

仅根据实际执行的测试、退出码、日志或产物登记 evidence，note 或 artifact 必须非空；任务已 failed 或 blocked 时仍可补记失败证据（只能 failed），用于复盘而不是翻案；禁止捏造测试成功、截图、审查结果或独立验证。自报证据与独立验证明确区分。对已批准规划的修改会失效批准并产生新版本；已启动规划修改需由用户停止活动任务并人工 replan。结束时 export，报告完成内容、实际验证和未验证项。

## 任务执行元数据

写任务时按实际情况填四个规划元数据，它们只表达计划意图，不改变门禁：

- `affectedModules`：本任务会改动的模块或包名（不是文件路径，不做路径归一化）。
- `executor`：`local` / `subagent` / `external` 的**计划**执行者；本版没有执行器读取它。
- `requiredApproval`：计划上认为需要人工审批的标记；派发与验证本来就始终要求当前方案已获人工批准。
- `maxRetries`：0–10 的计划重试上限；本版不会自动重试，失败必须由人决定下一步。

## 交付前自检用 gateStatus

完成或取消全部任务后，用 `engineering_plan { action: "gateStatus", changeId }` 核对交付前置条件，不要靠界面或猜测：

- `ready: true` 才表示技术侧已就绪（已批准、全部任务终态、至少一个 completed、逐项当前版本证据齐备、无活动或未结案运行）。
- `blockers` 中每条都带 code，必要时带 taskId / runId / criterion；按 code 逐条补齐，例如 `MISSING_EVIDENCE` 指向缺证据的验收标准。
- 即使 `ready: true`，交付确认仍是用户本人的动作，Agent 不得调用 `acceptDelivery`。

## 终止运行属于人工动作

正在运行的派发与验证只能由人工从工作台（或在会话里执行 `/engineering {"action":"cancelRun",...}`）终止。模型工具没有该动作：不要试图用 `engineering_plan` 或 shell 去 kill 一个运行，也不要把「运行卡住」当作可以自行绕过的状态——如实报告 `runId`、`state`、`jobId` 与阻塞的变更操作，交给人工处理。

## 声明文件要经得起对照

`expectedFiles` 写具体文件路径，或以 `/` 结尾的目录（不带 `..`、不带 Windows 保留名）；目录声明按前缀覆盖其下所有路径，并会与其中任何文件声明判为同一范围。它是范围审计判断「这次改动应该落在哪里」的唯一依据：只写你确认会改的文件；漏写不会阻止保存，但事后 `engineering_plan { action: "scopeAudit" }` 会把实际改到的路径标成未声明，评审时无法解释来源。
