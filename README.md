# 工程研发工作台 / Engineering workbench

DSH 原生插件，为软件工程变更提供可持久化的规划、任务依赖、人工评审、进度及验收证据。当前版本 `0.3.0`（开发中；本轮已安装并启用），面向 DSH `0.2.2-rc.5`。使用原生会话视图、工具和人工命令；没有另建 AgentLoop。

## 安装为 DSH 插件

仓库：https://github.com/LiaoHan5426/dsh-engineering-plan

这是 Cordis Host + DSH Client 原生插件 bundle，包含工程工具、会话工作台和三个 Skill。当前包名为 `@local/dsh-engineering-planner`，尚未发布到 npm；请从源码目录安装。

```sh
git clone https://github.com/LiaoHan5426/dsh-engineering-plan.git
cd dsh-engineering-plan
```

在 DSH 插件管理器添加克隆目录的绝对路径，或让 DSH Agent 调用：

```json
{"action":"install_bundle","target":"<克隆目录的绝对路径>"}
```

上述 JSON 是 `plugin_manager` 工具参数。安装到当前 profile；切换其他 profile 需单独安装。已验证环境为 Windows、DSH `0.2.2-rc.5`、desktop profile，其他版本尚待兼容验证，清单当前固定该 DSH 版本。

更新时先 `git pull --ff-only`，再通过插件管理器重新加载/安装；若管理器返回 `already-installed`，按其提示移除 bundle 后从同一目录重新安装。规划数据位于各目标工程工作区，独立于插件安装目录。若安装结果提示重启，请重启 DSH。

## 使用

在目标项目会话的视图切换中选择「工程研发」（顶栏同名按钮，或「更多会话视图」菜单里的同名项）。工作台包括「开发规划」「架构设计」「任务看板」「质量门禁」四个视图。

1. 在目标项目工作区开启会话，进入工程研发视图，创建变更并填写目标。
2. 请 Agent 分析当前代码，然后调用 `engineering_plan` 保存规格文档及任务。将文档参考、源码已核实事实和待验证假设分开记录。
3. 在工作台审阅方案、任务依赖、预计修改文件及验收标准，保存后点击批准。修改规划将产生新版本并使旧批准失效。
4. Agent 用 DSH 现有文件、终端、子 Agent 工具实施开发，通过 `engineering_plan` 推进任务状态。任务依赖须全部完成；进行中任务声明的重叠文件会阻止并行启动。
5. 进入 `verifying` 后，可请求 `engineering_verify` 执行当前人工批准方案中的一条精确验证命令，通过 jobs 收集结果；再按实际检查逐项记录验收证据及产物。命令 `succeeded` 不自动产生 criterion `passed`，全部当前验收项最近一次证据通过后，任务才能完成。
6. 导出文档，或获取上下文摘要以继续跨会话开发。

可直接给 Agent 这样的指令：

> 使用 engineering_plan 为当前需求建立开发规划。先检查当前源码和工作区状态，将历史文档作为参考；输出需求、模块边界、实现步骤、影响分析、验收标准及依赖任务。保存草稿供我在工程研发工作台评审。评审后按任务推进，只有实际检查通过才记录 passed 证据。

已有规划恢复：

> 使用 engineering_plan list 找到该变更，然后读取 context 和 get，核对当前代码是否仍符合规划。继续当前任务；不要把恢复上下文视为重新批准，也不要把历史通过结果视为这次验证已通过。

人工命令 `/engineering {"action":"list"}` 与 UI 共用操作边界。

正在运行的派发或验证可由人工终止：`/engineering {"action":"cancelRun","changeId":"<id>","kind":"verification"|"dispatch","runId":"<run>","reason":"<必填>"}`。它只调用原生 `jobs.kill`，由 runner 自己把运行结算成 `cancelled`；插件不改写任务状态、证据、审批或交付。仅对 `starting`/`running` 且有 `jobId` 的运行生效，条件是**该 job 句柄仍在当前进程的注册表里**——包括插件重载之前创建的运行，因为注册表是进程级的。`reserved`（无 jobId）走「放弃残留预留」。句柄已不在进程里时返回 `ENGINEERING_RUN_EXECUTOR_GONE`：这不代表运行成功终止，只是说明进程内已无句柄，记录不会被自动改写，需人工确认后按 unknown 结案。job 已自然结束时 `kill` 为 `already-finished`、结果里 `outcome: "already-finished"`，不伪装成「已请求终止」。记录里的 `hostInstanceId` 与本 apply 不同只作为 `sameHost: false` 的告警，不再拒绝终止。模型工具不暴露该动作。模型工具没有批准操作；批准来自人工命令/UI 路径。

## 已实现

- 工作区隔离的变更列表；轻量模式优先展示提案、实施和验收文档，高级规划与设计默认折叠；标准模式展示完整表单。
- 8 类规格文档、图表源码、结构化任务和分类参考来源。
- DAG 校验、依赖完成门禁、预计文件冲突检查。
- 乐观并发 revision、计划版本 planVersion、批准与证据归档历史。
- 原子状态写入与进程间互斥锁，状态持久化后可跨会话读取。
- 当前计划版本、当前任务尝试的逐项验收证据门禁。
- 原生主题与中英文界面、四视图工作台、任务依赖 SVG、七状态看板与逐项证据矩阵。
- 六项显式规划就绪状态与评审要求；状态由作者填写，不从 Markdown 推断。
- 规划、任务实施和验证请求可插入原生会话输入草稿，由用户确认发送。
- `engineering-planning`、`architecture-design`、`engineering-review` 三个运行时 Skill。
- 编辑与运行表单的会话内草稿缓存、导航保护及导出。

## 单命令验证（0.3.0 开发中）

`engineering_verify` 接受 `changeId`、`taskId`、`expectedRevision`、`planVersion`、`commandIndex`、`command`、`requestId`。新请求须匹配当前 revision/planVersion、当前版本人工批准、任务 `verifying` 状态及已保存命令的精确文本。每次只执行一条命令；工作目录绑定目标工作区，调用经过原生工具入口并使用 DSH shell/jobs。它不是自动开发 executor。

首次调用返回 `jobId`、`runId`；用 `job_output` 收集、`job_kill` 取消。相同会话以同一 `requestId` 和命令快照重放只返回原 run，即使之后规划 revision 已改变，也不重新执行。新尝试应由显式新请求产生新 ID。

使用 `engineering_plan` 的 `verificationRuns` action（必填 `changeId`，可选 `runId`）只读列举/读取真实持久记录。质量门禁视图有刷新记录入口，展示状态、版本、job ID、退出码、输出与截断标记；已批准且处于 verifying 的任务可选择保存的命令，将完整请求插入原生聊天草稿，由用户确认发送。

`reserved`/`starting`/`running` 和尚未人工结案的 `unknown` 是 blocker：阻止同任务新验证及状态转换，阻止该变更保存/重新规划，历史版本记录也参与检查。预留与相关状态变更在 change 锁内检查，按 change → runs 顺序加锁。仅人工 `/engineering` 或 UI 可 `resolveUnknown`，需最新 change revision、run revision 和核查理由；结案只追加历史，不把 run 改为成功，也不自动执行命令。active 不等于 unknown；当前入口不自动调用存储层 `recover`，不自动恢复或重跑。

## 原生子 Agent 派发（0.3.0 开发中）

`engineering_dispatch` 接受 `changeId`、`taskId`、`expectedRevision`、`planVersion`、`requestId`。任务须为当前人工批准版本中的 pending，依赖已完成。同一变更内串行派发，同一任务的派发与验证互斥。入口使用 DSH 原生 subagents/jobs，绑定当前会话、工作区、模型配置、preset 和深度上限；没有任意 prompt、cwd 或模型覆盖参数。

新请求返回 `jobId/runId` 表示已发布，用原生 job 工具收集或取消；相同 requestId 返回原记录。`engineering_plan` 的 `dispatchRuns` 动作读取持久记录，任务看板支持手动刷新。`returned` 仅代表子 Agent 返回，不自动更改任务状态或生成验收证据；需审查实际差异，再推进 running/verifying 和验收。记录保存于变更目录的 `dispatches` 子目录。

活动派发及 unknown 会阻塞相关规划修改和交付确认。当前不自动识别重启遗留运行、不自动恢复或重跑。任务看板中的 unknown 可由用户填写结案原因、对子 Agent／后代／相关进程的停止核查依据及证据引用，明确勾选确认后提交。结案核对 change/run 双版本，只追加历史并解除对应 unknown 的阻塞，原运行仍为 unknown；不会停止进程或生成验收成功。活动记录不接受此操作，重启遗留 active 的恢复仍待实现。不得仅因 Agent 无活动就认定执行成功。测试已覆盖取消等待清理和持久化失败。清理失败持久化为unknown并继续阻塞；若该写入失败，保留原活动状态，不回退为error。该修复已重新加载到运行插件并通过其专项回归；真实批准后的执行与取消仍待验证（当前完整套件见文末）。

## 崩溃注入与陈旧锁

`tests/crash.test.js` 在随机时刻用 `SIGKILL` 杀掉正在保存的写手，然后读回 `state.json`：

- 文件必须始终可解析，`proposal` 要么为空、要么是完整长度，不会出现半截写入（临时文件 + `fsync` + `rename`）。
- 被杀的写手会留下 `state.json.<uuid>.tmp`；读取方忽略它们，下一次成功写入会清掉超过 10 分钟的旧临时文件（并发写手的活文件不会被误删）。
- 被杀的写手还会在 `.lock` 上留下痕迹。插件**不会**自动删除它：锁里记录了 `pid` 与获取时间，超时后报 `LOCK_BUSY` 并说明「该进程已不在运行，锁可能已陈旧」，由人确认后删除。
- 运行记录（`runs/`、`dispatches/`、`git-observations/`）用同一套锁与原子写，因此同样具备这两条性质：陈旧锁点名持有者、旧临时文件在下一次写入时清理。
## 导出与 manifest

`progress.md` 末尾还包含 `## Runs for this plan version`：当前方案版本的验证与派发运行逐条列出（`runId`、任务、状态、命令与退出码），并注明「运行记录是宿主观察到的尝试，不等于验收」。没有记录时写明确说明，而不是空表。

`export` 只重建 Markdown 投影（八份文档、`tasks.json`、`progress.md`、`diagrams/*.mmd`），不改 revision、不改状态。目录里**不会删除任何旧文件**——这是有意的：导出是投影，不是同步。

因此每次导出都会写一份 `manifest.json`，记录本次实际写了哪些文件（`files`）、当时是哪个 `mode`/`planVersion`/`revision`，以及目录里存在但**本次没有更新**的已知投影（`stale`）。界面在「导出文件」卡片末尾显示清单路径，并在 `stale` 非空时先给一行「另有旧导出的文件未被本次导出更新」。

看到 `stale` 里的文件名时，不要把它们当成当前方案的产物——它们属于更早的一次导出（例如标准模式导出后改用轻量模式，`requirements.md` 会留在目录里）。

## 只读查询（Agent 与界面共用）

下面四个动作都只读：不改 revision、不写任务状态、不生成证据，也不代表任何门禁已被满足。界面上的「当前可开始 N」「交付门禁（核心判定）」「改动范围」都来自它们，因此人和 Agent 看到的是同一份判定。

- `gateStatus`（`changeId`）：交付前体检。返回 `ready`、`approved`、`deliveryAccepted`、七状态任务计数、`runs`，以及 `blockers`：`APPROVAL_REQUIRED`、`ACTIVE_RUN`、`UNRESOLVED_UNKNOWN`、`TASK_NOT_TERMINAL`、`NO_COMPLETED_TASK`、`MISSING_EVIDENCE`（同时比对任务内证据与全局证据，与 `acceptDelivery` 同源）。另带 `scope` 摘要（最近一次 `ok` 观测的路径统计），**不产生 blocker**。它只回答「现在能不能交付」，不替你确认交付。
- `readyTasks`（`changeId`）：每个任务给出 `reasons`，说明此刻为什么还不能开始——`APPROVAL_REQUIRED`、`TASK_NOT_PENDING`、`DEPENDENCY_BLOCKED`（带缺失依赖）、`FILE_CONFLICT`（带 `mine overlaps TASK theirs`）、`ACTIVE_RUN`、`UNRESOLVED_UNKNOWN`。`ready` 数组就是可以立刻推进的任务；它不启动任何东西。
  界面把同一份判定直接显示在任务卡片上：每个任务卡片的「任务详情」里会列出它此刻还不能开始的原因（未批准的方案、未完成的前置任务、重叠的在跑文件、未结束的运行），因此不必自己拼依赖关系。
- `scopeAudit`（`changeId`，可选 `observationId`）：把任务声明的 `expectedFiles` 与已保存观测的路径清单对照，给出 `entries`、`undeclared`、`untouched`。`state` 为 `no_observation` 或 `observation_incomplete` 时**不能**得出「范围正确」的结论。路径比较不区分大小写（与文件冲突判定一致，`SRC/Core.js` 与 `src/core.js` 视为同一文件），但不折叠点段（`src/../client.js` 与 `client.js` 仍视为不同）；声明以 `/` 结尾表示目录前缀。它不读文件内容，也不拦截任何操作。
- `approvalBaselineStatus`（`changeId`，可选 `observationId`）：读取批准时绑定的 Git 基线，判断后续观测是否漂移。不自动撤销批准，也不触发采集。

另有三个通用只读动作：`list` 返回变更摘要与逐条读取警告（单个损坏条目不拖垮整表），`get` 返回完整状态（损坏或缺失时直接报错，不猜），`context` 返回供 Agent 恢复工作的紧凑投影——文档每篇截断到 1000 字符，并给出 `documentsTruncated` 与 `documentLengths`，先用它们判断是否需要 `get` 读全文。 `context` 的 `gate` 块另带 `commands: { total, succeeded, failed, unrun }`——只给四个计数（逐条运行记录请用 `gateStatus`），使恢复上下文的模型能判断命令是否执行过。

写操作（`create`、`save`、`transition`、`evidence`、`export`、`replan`）中，`save`/`replan`/`export` 需要 `expectedRevision`；`approve`、`replan`、`acceptDelivery`、`resolveUnknown`、`resolveDispatchUnknown`、`abandonRun` 只对人工入口开放，模型工具列表里没有它们。

## 用户交付评审

质量门禁页独立记录用户交付确认，不由任务完成自动推导。当前方案须已批准，至少一个任务 completed，其余全部 completed/cancelled，且不存在活动验证或未结案 unknown。用户审阅取消任务影响、填写备注并勾选确认后提交。

确认绑定方案版本、操作者和时间，随后锁定任务状态及证据。需要继续修改时由用户重新规划，旧确认留在历史中。此确认表示用户接受交付，不是独立执行测试。核心与Host回归已覆盖，真实页面已验证未满足条件时禁用；正向人工确认仍待验收。

## 数据与恢复

规划权威数据在目标工作区 `.dsh/engineering/changes/<change-id>/state.json`；独立验证运行记录在同目录的 `runs/<run-id>.json`，保留命令快照、会话/Host 身份、job 关联及结果，不依赖聊天上下文存活。Markdown 是导出投影，手工编辑它不会回写规划。建议将规划纳入项目版本控制前先检查是否包含私密内容。

标准模式导出：`proposal.md`、`requirements.md`、`architecture.md`、`implementation.md`、`impact-analysis.md`、`acceptance.md`、`decisions.md`、`findings.md`、`progress.md`、`tasks.json`，以及 `diagrams/` 中 architecture、sequence、data-flow、task-dag 的 Mermaid 源码。任务 DAG 自动生成；其他图表由规划作者提供。架构页使用内嵌 Mermaid 11.17.2 离线预览三类图源，真实 DSH 中的三图渲染与语法错误恢复已验证。渲染成功只表示图源可展示，不代表架构设计通过评审。

轻量模式固定导出 `proposal.md`、`implementation.md`、`acceptance.md`、`progress.md`、`tasks.json`；其余文档和图表只在内容非空时导出，有任务时导出任务 DAG。内容保留原始空白。导出只重建本次适用的投影，不清除旧导出文件；目录可能仍含历史文件，当前输出清单以返回的 `files` 为准。更新运行插件后，真实轻量表单的展开状态与一次 6 文件导出已核实。标准模式下内容为空的文档与图源会导出为 0 字节文件：结构完整不等于内容已填写，评审时以文件内容为准。

每次修改必须携带最新 `expectedRevision`，冲突时重新读取并合并修改。重新规划归档旧版本，保留批准及证据；当前任务状态重新建立。运行中应先将所有进行中/验证中任务转为阻塞或失败，再由用户点击「重新规划」，之后修订并重新评审。

异常退出可能留下 `.lock`。先确认锁记录的进程已退出并备份状态，再移除该变更目录中的残留锁，然后重新打开工作台。插件不会仅凭时间自动抢锁。导出多文件并非整体事务；中途失败可从权威 state 重新导出。

## Git 观测

架构页的「Git 观测记录与请求」可刷新历史记录、选择比较基线，并将 `engineering_git` 请求填入聊天草稿或复制。请求由会话发送后执行，页面不自动提交。采集使用 `action: capture`；比较使用 `action: compare` 并指定已保存的 `baselineId`。两者均携带 `changeId`、`expectedRevision`、`planVersion` 和 `requestId`。同一请求ID返回原观测；需要新采样时使用新ID。通过 `engineering_plan` 的 `gitObservations` 动作读取记录。

观测分别记录HEAD、暂存差异、工作树差异及未跟踪路径摘要。未跟踪内容、ignored内容和工程状态目录不覆盖；输出上限或采样变化会明确报错，不生成完整摘要。比较结果仅针对观测范围，不建立完整工作区相等，也不自动批准计划或写入验收证据。当前工作目录必须与会话初始策略目录一致，单纯切换cwd不会重设该边界。真实宿主已验证截断错误、记录持久化、重放，以及独立顶层会话中unborn仓库的成功采集与比较。页面可选择两条已保存观测进行只读比较，展示四项差异三态和完整限制；中文正常路径已实测。已提交仓库各类变更仍待完整验证。

批准按钮旁可选择可选 Git 基线，默认不绑定。候选必须属于当前变更、方案版本和批准前修订，且观测status为ok；dirty/unborn可选。选择与人工批准一次性写入，重新规划时随旧审批归档。`engineering_plan` 的 `approvalBaselineStatus` 动作读取当前绑定；可传 `observationId` 显式比较后续观测，不自动采集或改变批准、任务、验收状态。新版选择控件和未批准查询已实测，实际批准绑定及后续漂移仍待正向验收。详见 [审批基线契约](docs/APPROVAL-BASELINE.md)。

## 并发与不变量测试

`tests/concurrency.test.js` 起三个独立进程对同一变更并发保存，断言 `revision` 等于「承认成功写入数 + 1」、最终文档是完整值而非撕裂写、`list` 无损坏警告。

## 不变量测试

`tests/invariants.test.js` 用固定种子驱动 60 步随机操作流（保存、状态流转、证据、批准、重新规划、导出、`gateStatus`），每步读盘校验：`status` 可从审批与任务状态推出；`completed` 任务在任务视图与变更视图都有当前通过证据；被拒绝的操作与 `export` 都不移动 `revision`。它还断言这条流必须真的走到批准、流转、证据、导出、任务完成与至少一次合法拒绝，避免「所有断言都通过但什么都没测」。

## 文档门禁

`node scripts/check-doc-counts.mjs` 校验 README、`docs/VERIFICATION.md`、`docs/DELIVERY-STATUS.md` 三处的套件总数，以及交付状态头部「N 项（P pass / S skip）」三个数字的算术关系与轮号一致性——只比对总数时，pass 数会独自漂移。

## 当前边界

本版是规划、过程跟踪与单命令验证适配的开发中版本。通过证据仍是带操作者来源的报告；独立 runs 只记录执行事实。显式 `engineering_verify` 请求可执行已批准的单条验证命令，`engineering_dispatch` 可派发单个已批准任务；两者都不自动遍历整个任务图或全部检查，不创建 Git worktree，也不拦截插件外的文件修改。文件冲突检测依据任务声明，未覆盖未申报文件或 Git 分支差异。开发实施仍由当前会话使用 DSH 原生工具完成。

历史记录保存在同一状态文件，总大小上限 2 MiB；大型项目应拆分为多个变更。任务取消不等于通过验收，汇总完成态包括已取消任务，应同时审阅任务状态。

**审批是工作流约束，不是安全控制。** 批准记录与被批准的计划同存于 `state.json` 明文（无签名），任何能写工作区文件的人——包括模型自己的 shell 工具——都可以追加一条批准，界面与导出会如实标注为「用户已批准」。要在此之上做权限隔离，需要把审批记录或签名密钥放到工作区外，本插件未实现。详见 `docs/DESIGN.md` 的「已知信任边界」。

四个工具都要求会话工作区与 `sandboxPolicy.workspaceRoot` 一致；把工作目录切到子目录或其它位置后调用会得到 `ENGINEERING_WORKSPACE_MISMATCH`，不会在工作区外生成第二份状态。

原方案剩余目标继续跟踪：完整分阶段原生开发执行与恢复、检查批次编排及可信验收映射、Git 基线批准与用户交付确认的正向实测、工作树隔离、差异审阅，以及外部 Agent/知识服务和稳定后的多包拆分。单命令验证适配不替代这些目标；需用真实需求验收完整闭环。

EAP 可作为第一个使用项目；其工程说明是参考输入，不作为插件的硬编码规则，也未由本插件修改。

## 开发

Node.js >=22，Host 无额外 npm 运行依赖；Client 内嵌第三方 Mermaid 11.17.2，原库与许可证保留在 assets。使用 `node scripts/embed-mermaid.mjs` 校验固定 SHA 并重建嵌入区；7项独立重建测试覆盖内容一致性、幂等及失败时保留文件。Git 比较算法同样以字符串嵌入客户端，由 `node scripts/embed-git-comparison.mjs` 重建，`--check` 只读比对，配套 22 项测试。两个脚本的 `--check` 均已纳入发布前检查。

```sh
npm test
npm run check
node scripts/validate-package.mjs
```

当前完整套件为 826 项（825 通过、1 项可选真实 Chromium 测试默认跳过），`node --test --test-reporter=dot tests/*.test.js` 退出码 0；更早的 242 项、197 项、90 项数字均为当时阶段的历史结果。执行适配集成测试中的subagents/jobs/shell使用模拟服务，测试数量不代表真实链路验收。真实 engineering_dispatch 未审批拦截已验证，前后派发记录为空。0.3.0 已安装启用；真实页面四页签、smoke 计划创建/读取、质量矩阵、运行记录、导出 14 文件、恢复上下文、状态流转选项、并行分支 DAG、三张 Mermaid 图与英文界面均已按 DOM 读数核实，浅色外观下的状态色对比度缺陷已修复。实际 engineering_verify 对未审批 smoke 返回人工批准门禁错误、runs 为空；已批准 v1 的派发 returned、验证因 PowerShell 无 printf 失败并如实记录。任务结构体在 0.3.0 已支持 `affectedModules`/`executor`/`requiredApproval`/`maxRetries` 四个规划元数据字段，界面可编辑、导出进 `tasks.json`；它们不驱动任何自动执行或重试；超长模块名与越界重试次数在表单内即时提示并禁用「应用到草稿」，不会被静默保存或悄悄夹取。正向闭环与像素级视觉仍待验收。详细结果见 [验证记录](docs/VERIFICATION.md)，原始需求映射见 [验收跟踪](docs/UI-ACCEPTANCE.md)。

- `src/core.js`：数据契约校验、存储、版本、依赖与证据状态机。
- `index.js`：Host 工具和人工命令适配，共用同一领域操作。
- `client.js`：DSH conversation.view 原生界面。
- `tests/`：状态机、并发、路径及 Host 接口验证。

采用单个可安装 bundle、内部模块分层，后续在契约稳定后再拆为多包，避免首版安装与跨包版本维护成本。
