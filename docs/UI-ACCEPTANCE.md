# 原始方案要求与修正验收

## 交付评审专项审查修正

此前三项Client问题已完成源码修复及针对性回归：

- 历史只读区域展示归档snapshot中的审批、交付确认、任务与证据，以及task-restarted记录。
- delivery确认绑定changeId与planVersion；版本变化或重新规划撤销勾选，保留备注供重新审阅。
- 已确认交付版本的通用实施/验证请求在按钮及处理函数处阻断。

真实页面已确认历史区域存在；当前测试夹具没有历史快照，因此非空历史显示、真实重新规划及正向交付确认仍待验证。源码测试与真实交互证据分开记录。

## 全流程核对（0.3.0 开发中）

以下区分源码实现、自动测试与真实页面证据，不表示整体交付完成。原始方案目标继续保留。

| 原方案要求 | 当前证据 / 差距 |
|---|---|
| 需求入口与代码分析 | 变更创建、Agent 工具及规划请求到原生聊天草稿已实现；真实 smoke 计划创建/读取通过，完整代码分析阶段链待验收 |
| 规格、设计、影响分析、ADR | 持久文档及四视图已实现；真实业务数据编辑/刷新/跨会话仍待完整验收 |
| 方案评审与修改循环 | 人工 approve/replan、版本历史、六项准备状态已实现；smoke 保持未批准，未由 Agent 代批 |
| 可执行任务 DAG | 核心依赖、文件排他与真实任务 DAG SVG 已实现；完整运行页依赖交互仍待验收 |
| 分阶段开发、失败恢复 | 状态转换、context恢复、单命令验证和单任务原生派发已实现；派发持久记录、请求幂等及取消清理有模拟服务集成测试。真实正向执行、重启遗留处理、自动任务图编排与worktree仍待完成 |
| 质量门禁 | 显式自报验收矩阵 + 独立持久 runs；engineering_verify 单条已批准命令适配已实现；真实正向执行/取消及验收映射仍待验证 |
| 交付及知识沉淀 | 标准14项/轻量按内容导出；独立人工acceptDelivery绑定版本、记录人/时间/备注，确认后冻结状态与证据，replan归档。95项回归及真实未满足条件按钮禁用已验证；正向人工交付、知识服务接入待完成 |
| 精简模式 | 核心三文档展开、高级规划/设计折叠；必选5文件+非空内容+有任务时DAG。90项回归通过；重新安装后真实页面三文档展开/高级规划折叠、smoke实际6文件导出通过。旧导出保留，以本次files清单为准 |
| 三类工程 Skill | 随 bundle 注册 planning/design/review 三个 Skill；Host 注册与清理测试已覆盖 |
| 原生服务组合与模块分层 | 工具、人工命令、会话UI、shell/jobs及subagents已接入；未实现原方案全部服务对接和多包结构 |
| 外部 Agent 与知识能力（P2） | 尚未实现，按原方案独立跟踪 |

来源：用户提供的 DSH-plugin-engineering-plan.md 第196–205行及工作台截图。此文件记录要求与证据，不作为整体完成证明。

| 要求 | 首版偏差 | 修正实现与待验收 |
|---|---|---|
| 独立工程研发入口 | 会话内入口为工程规划 | 保留独立会话工作台，工程研发标题；四页签空态真实点击通过 |
| 开发规划 | 概览和通用文档分散 | 集中显示标题、ID、版本、审批、六项准备及评审要求；smoke 计划真实创建/读取通过 |
| 六项状态 | 缺少结构化准备状态 | 显式字段持久化，旧数据兼容及合并测试通过；真实编辑完整验收待做 |
| 架构设计 | 文档与图表混放 | 独立设计/ADR/影响分析编辑区；离线Mermaid架构、时序、数据流在真实DSH中渲染就绪及语法错误恢复已验证，完整视觉/主题覆盖待验 |
| 任务看板 | 顺序卡片列表 | 七状态、依赖与阻塞、任务 DAG SVG；有数据全流程验收待做 |
| 质量门禁 | 证据与资料混放 | 验收矩阵与真实 runs 分开展示；smoke 页面矩阵和记录空态已观察，非空 runs 仍待验收 |
| 结构化状态来源 | 缺少规划准备状态 | 准备状态由作者声明，不从 Markdown 非空推断 |
| 单命令验证入口 | 只有泛化验证请求 | 选择已保存命令并生成含 revision/planVersion/commandIndex/command/requestId 的草稿，用户发送后进入工具流程；不自动提交 |
| unknown 人工结案 | 缺少运行不确定性处理 | verification与dispatch分别使用专名人工操作、双CAS及历史记录。派发要求终止核查依据、引用和明确确认，草稿绑定change/run/revision，刷新撤销确认；只解除精确unknown的阻塞，active不受豁免。核心与表单回归通过并已安装；非空真实交互待验收 |

准备状态、命令 succeeded、criterion passed 和任务 completed 是不同信息。运行记录通过 verificationRuns 读取，不由静态 UI 样例替代；历史版本仅供追溯。active 与未结案 unknown 会阻塞相关操作，active 不自动变 unknown；当前入口不自动调用 recover，也不自动重跑。

Mermaid阶段父Agent完整回归242项，其中241通过、1项可选浏览器测试跳过（compact dot，退出码0），包含清理失败保持阻塞、派发unknown人工结案及过期草稿/验证确认身份修复，已重新安装。此前86/90/95/96/191/194/197/223项均为历史阶段结果。runner/tool使用模拟shell/jobs/subagents，不等于真实pipeline正向通过。

派发真实负向验证：未批准standard夹具调用engineering_dispatch返回人工批准门禁错误，前后dispatchRuns为空。真实页面三个任务的原生派发请求区可见，六个填入/复制按钮均disabled。strict五字段请求、审批/依赖/记录加载门禁及requestId缓存有源码回归；真实批准后的插入、执行、取消仍待验收。

## 执行参数记录（0.3.0 阶段新增，待真实页面确认）

质量门禁新增展示 `workdir / timeoutMs / onExpiry / stdoutMaxBytes`，并固定显示“Shell 身份未记录（当前执行接口未提供）”；旧记录显示“执行参数未记录”。Host 侧只允许这些字段随 `starting` 写入一次，重复写入返回 `IMMUTABLE_EXECUTION`，旧 schema-1 记录仍可读。Host 56 项、Client 31 项自动化测试通过。

**真实页面确认（旧记录路径已通过，新记录路径待执行）**：在已认证主窗口（`dsh-app://app/`）选中 v1 变更的 READONLY-SMOKE，质量门禁「真实验证运行记录」刷新后显示 runId `f9d8b388-3a87-4eaf-80b2-5577fc136476`、state `failed`、revision 4、exitCode 1、timedOut false、aborted false、jobId `bash-ec62fbd3397c432f`，命令 `printf ep-positive-smoke`，并显示「执行参数未记录」与「Shell身份未记录（当前执行接口未提供）」。即：缺 `execution` 的旧记录走的是未记录路径，没有伪造解释器身份。

含 `execution` 的新记录显示四项参数（workdir/timeoutMs/onExpiry/stdoutMaxBytes）仍需一次真实成功或失败的验证运行才能观察，目前被 v2 方案待批准挡住；该项不计为已验证。

**上一轮打不开主窗口的根因**：当时使用会话启动时记录的 `http://127.0.0.1:60069`，该端口已不再监听（应用重启后 web server 换到 `127.0.0.1:56356`）。修复插件按 `ctx.webServer.getOrigin()` 精确匹配，端口过期即回落 guest 并显示 `chrome-error`。这不是插件回归；以当前实际监听端口打开即恢复主窗口控制。

0.3.0 已由父 Agent 通过 plugin_manager remove/install，返回 application: applied、enabled: true。真实 smoke 变更 `85b71c73-9741-45fa-b6aa-f97ee79e2318` 为 revision 2 / planVersion 1，仅含 `printf engineering-verifier-smoke`，保持草稿未批准。实际 engineering_verify 返回 `Current plan must have human approval`，verificationRuns 返回空列表；证明未审批门禁，无正向运行成功结论。后续须由用户 approve 后验证正向执行。

真实standard夹具已通过评审文本编辑、保存（revision2→3）及重新加载保留，三节点两边DAG渲染、context工具读取通过。

> 历史状态（第 5–20 轮）已过时，本节原有的一段「剩余 UI 验收」清单不再维护。它当时把「跨会话读取、未保存内容保护、取消/失败反馈、明暗主题」列为待验——这四项后来分别在真机或门禁层完成（见本文件第 53–56 轮、第 61 轮、第 91/94 轮各节）。逐轮证据以本文件后续章节与 `docs/VERIFICATION.md` 为准，不要引用旧清单判断当前状态。

当前仍未取得的界面读数集中在两类：一是必须由用户本人操作的路径（人工批准、成功终止、交付确认），二是自第 79 轮起 `browser_eval` 间歇不应答期间新增的文案（每次都在对应章节标注「仅源码与单测支撑」）。

## 真实页面观察：任务看板与运行记录（2026-11-20 复核）

在已认证主窗口（`dsh-app://app/`）对 v1 变更 `3c83caa4-1249-4752-a4cf-59eaab8d83d5`（执行中，方案版本 1）复核，观察到：

- **看板**：头部显示「已完成 0 / 1」「阻塞任务 0」「执行记录」；七列全部渲染为 `待执行 · 0`、`执行中 · 0`、`验证中 · 0`、`已阻塞 · 0`、`失败 · 1`、`已完成 · 0`、`已取消 · 0`，失败列中存在卡片「只读派发与固定输出验证 · 失败」。状态筛选与「列表 / 看板」切换、添加任务、任务依赖图入口均可见。
- **任务依赖图**：展开后是真实 `svg`，节点为任务名与状态（`只读派发与固定输出验证` / `失败`），并带说明「箭头从前置任务指向依赖它的任务，基于当前草稿。此图不代表模块架构。」——与"真实任务依赖而非模块架构图"的要求一致。
- **运行记录**：刷新后列出 runId `f9d8b388-3a87-4eaf-80b2-5577fc136476`、state `failed`、revision 4、exitCode 1、timedOut/aborted false、jobId `bash-ec62fbd3397c432f`、命令 `printf ep-positive-smoke`，并显示「执行参数未记录」「Shell身份未记录（当前执行接口未提供）」。`stdout`/`stderr` 折叠区存在。
- **交付区**：显示「技术任务尚未收尾」「当前版本待用户确认交付」，交付按钮与必填备注提示可见，说明交付确认只在条件满足后可提交。

仍未通过真实页面验证的部分：批准后的原生派发/验证/取消全链路、`execution` 四字段（新记录）展示、派发与验证的 unknown 结案表单实际提交。这些都需要人工批准 v2 方案后才会产生真实记录。

## 已修：已批准方案仍被要求"批准当前方案"（2026-11-20）

真实页面复核时发现任务看板的状态流转卡片固定显示「运行前需批准当前方案。修改规划内容会使原审批失效。」，即使该变更 `3c83caa4-1249-4752-a4cf-59eaab8d83d5` 的 `approvals` 中确有 `planVersion: 1`、`actor.kind: "user"` 的有效批准（审批记录 `approvalRevision: 3`，当前 `revision: 7`）。同一页面切换状态本身并不需要批准，文案与实际门禁不一致，会诱导用户重复批准。

修复内容（`client.js`）：

- 新增 `planApproved(change)`：只认当前 `planVersion` 且 `actor.kind === "user"` 的批准。
- 状态流转卡片改为按状态分支：已批准显示"当前方案已批准，按状态图推进；失败或阻塞可回到待执行"，未批准显示"状态流转不要求批准，原生派发与命令验证需要先批准"。
- 新增测试 `tests/client-transition-hint.test.js`（4 项）：旧版本批准、agent 批准、缺 actor 均不算批准；`dispatchRequestBlock` 仍保留自身孤立可测的批准检查并与 `planApproved` 结论一致。

复核证据：全量 `node --test --test-reporter=dot tests/*.test.js` 退出码 0；`scripts/validate-package.mjs`、`embed-mermaid.mjs --check`、`embed-git-comparison.mjs --check` 均通过；真实主窗口重载后（无需重装，插件目录为链接安装）同一变更显示新文案。

## 已修：批准基线卡片标题重复（2026-11-20 第 52 轮）

架构设计视图的「高级信息与诊断」折叠区内，批准基线卡片原本用同一个 `baselineStatusTitle` 同时渲染 `h3` 标题和 `select` 前的 `label`，页面上出现两遍「批准基线后续观测（只读）」。

修复：新增双语 locale `baselineStatusSelect`（「用于比较的后续观测」/「Subsequent observation to compare」），`label` 改用它；新增 `tests/client-baseline-label.test.js` 2 项（断言 `label` 使用 `baselineStatusSelect`、`h3` 只出现一次）。

真实主窗口复核（`dsh-app://app/`，展开「高级信息与诊断」后读取 DOM）：

```text
h3      = ["批准基线后续观测（只读）", "Git 观测记录与请求"]
labels  = ["用于比较的后续观测不指定后续观测", "选择已存观测作为比较基线…", ...]
```

即标题只出现一次，下拉前的标签已是「用于比较的后续观测」。

## 锁竞争修复对界面的影响（同轮）

`src/lock-retry.js` 的竞争判定只影响 Host 侧并发读写：页面不需要重装，也没有新增可见控件。真实页面在修复后仍能列出四个变更（含 `原生研发闭环正向验收 v2（跨 Shell 命令） 草稿 · 方案版本 1`）并切换四个视图，说明列表与详情读取未被改坏。界面层仍需人工批准 v2 后才能验证派发/验证的正向记录。

## 真实页面复核：并行分支 DAG 与证据矩阵空标准（2026-11-20 第 53 轮）

夹具 `511370f8-7448-4bb9-9071-78bdb771cafb`（UI回归夹具：标准规划与任务依赖）在本轮扩为五任务、含并行分支与合流：

```text
ANALYZE ──► API ──┐
        └─► UI  ──┴─► JOIN ──► REVIEW（无验收标准）
```

未批准、未执行任何任务，仅用于界面验收。

任务看板「任务依赖图」展开后的真实 SVG（`viewBox="0 0 760 500"`，5 个节点，5 条边，每条边另带一个独立箭头 `path`，共 10 个 `path`）：

```text
分析（测试数据）        x=20  y=20
接口（测试数据）        x=20  y=140
前端原型（测试数据）    x=270 y=140     ← 同层并行任务并排
联调（测试数据）        x=20  y=260     ← 合流节点
复核（无验收标准）      x=20  y=380
```

边线：`M 125 82 L 125 135`（分析→接口）、`M 125 82 L 375 135`（分析→前端原型，斜线分叉）、`M 125 202 L 125 255`（接口→联调）、`M 375 202 L 125 255`（前端原型→联调，斜线汇合）、`M 125 322 L 125 375`（联调→复核）。即并行分支横向铺开、合流节点正确收束，与原始设计图「T02/T03 并排、T04 联调汇合」的结构一致。

同轮发现并修复的缺陷（质量门禁「逐项验收证据矩阵」）：没有验收标准的任务，同一行既显示"尚未配置验收标准"又显示"缺少当前版本证据"，自相矛盾。修复后结果列在无标准时显示 `—`，只有存在标准时才报缺失证据；新增 `tests/client-matrix-empty.test.js` 2 项。真实页面复核（同一夹具，质量门禁视图）：

```text
联调（测试数据） JOIN 联调结果审阅 缺少当前版本证据 — — — —
复核（无验收标准） REVIEW 尚未配置验收标准 — — — — —
```

复核证据：`node --test tests/*.test.js` → 421 项、420 pass、1 skipped（可选真实 Chromium Mermaid）、退出码 0。

仍未验证：批准后的派发→验证→证据→交付正向链路（等待用户批准 v2 变更 `9dd058d6-8a19-4c3c-b8bc-11a1d7dc6a4c`）、取消运行的界面路径、`browser_screenshot` 像素级截图（本机 CDP 截图仍超时，只有 DOM 读数）。

## 已修：删除仍被依赖的任务会留下悬空分支（2026-11-20 第 54 轮）

任务卡片的「移除」原本直接从草稿里过滤掉该任务，不检查其他任务的 `dependencies`。五任务夹具下移除 `API` 会让 `JOIN` 依赖一个不存在的任务，草稿到此失效，只能在保存时靠核心 DAG 校验报错才发现，而且没有说明是哪条依赖。

修复：移除前先算依赖者，存在则拦下并列出阻塞的任务 ID，不修改草稿；没有依赖者时才清除提示并移除。新增 `tests/client-task-remove.test.js` 3 项（拦截分支、拦截必须发生在草稿变更之前、无依赖时仍可移除）。

真实页面复核（同一夹具，任务看板 → 接口（测试数据）→ 任务详情 → 移除）：

```text
仍有任务依赖此任务，请先在这些任务里移除依赖：JOIN
```

移除后看板仍是五个任务（分析 / 接口 / 前端原型 / 联调 / 复核），确认草稿未被改动。

同轮补充核实（均为真实 DOM 读数，未变更数据）：

- 列表 / 看板切换生效：`ep-task-list` 模式下空状态列 `display:none`，只保留有任务的列（此夹具为「待执行 · 5」）。
- 任务详情展示依赖的任务标题与 ID（`依赖: 接口（测试数据） (API), 前端原型（测试数据） (UI)`）、验收标准、实施请求与派发请求入口；未批准草稿的「填入派发请求 / 复制派发请求」按钮 `disabled=true`，编辑 / 移除 / 填入会话仍可用。
- 夹具描述已改为「五任务并行分支DAG、证据矩阵空标准」，避免与旧文案「三节点DAG」矛盾。

复核证据：`node --test tests/*.test.js` → 424 项、423 pass、1 skipped（可选真实 Chromium Mermaid）、退出码 0；`embed-mermaid --check` 与 `embed-git-comparison --check` 通过。

## 真实页面复核：导出、上下文与状态流转（2026-11-20 第 55 轮）

夹具 `511370f8-7448-4bb9-9071-78bdb771cafb`（revision 6 / planVersion 1 / draft），主窗口 `dsh-app://app/`，界面语言中文。

- **导出 Markdown**（开发规划视图按钮）点击后输出卡标题「导出文件」，列出 14 个绝对路径。磁盘核对：`proposal.md`、`requirements.md`、`architecture.md`、`implementation.md`、`impact-analysis.md`、`acceptance.md`、`decisions.md`、`findings.md`、`progress.md`、`tasks.json`、`diagrams/architecture.mmd`、`diagrams/sequence.mmd`、`diagrams/data-flow.mmd`、`diagrams/task-dag.mmd` 全部存在，合计 3494 字节。夹具里空文档与未填图源导出为 0 字节文件；`progress.md`、`tasks.json`、`task-dag.mmd` 有内容。
- **导出不移动版本**：导出前后 `state.json` 均为 `revision 6`、`planVersion 1`、`status draft`、5 个任务、`history` 0 条。导出是衍生输出，不递增 revision。
- **恢复上下文**：输出为 JSON，顶层键 `changeId, title, goal, revision, planVersion, status, planning, deliveryAcceptance, documents, references, approvals, tasks`；`planning` 含 `reviewRequirements` 与六个 section（requirements/analysis/architecture/interfaces/tasks/acceptance），任务 5 条，与已保存版本一致。
- **状态流转选项**：选中 pending 任务「分析（测试数据）」后，状态下拉只有 `执行中 / 已阻塞 / 已取消`。`client.js:1089-1097` 的 graph 与 `src/core.js` 迁移表逐项一致（pending→running|blocked|cancelled、running→verifying|blocked|failed|cancelled、verifying→running|blocked|failed|completed|cancelled、blocked 与 failed→pending|running|cancelled、completed→无、cancelled→pending）。

仍未真实验证：保存草稿的版本冲突提示与从界面放弃草稿、非空执行/历史/结案/交付全流程、英文与浅色主题、像素级视觉（`browser_screenshot` 仍报窗口无响应）。

## 真实页面复核：新建变更与保存草稿（2026-11-20 第 56 轮）

为了让夹具集合保持干净，本轮先新建一个一次性变更，验证完删除其目录。

- **新建表单**：填「标题」「目标」后「创建」由禁用变可用；创建成功，工作台切换到该变更，头部显示标题，统计为 `0 任务数 / 0 证据数 / 轻量 规划模式`，评审要求显示「尚未填写」，六项就绪度为 `0 / 6 已准备项目`。
- **模式徽标**：创建时下拉显示 `lite` 默认值，落盘 `state.json` 也确为 `mode: "lite"`；界面统计徽标显示「轻量」，与 `t(change.mode)` 一致。教训：不要用整页文本首个「轻量|标准」匹配判断模式，创建下拉里同时存在「标准」选项会造成误读。
- **编辑规划 → 保存草稿**：进入编辑后出现评审要求 textarea、六组「备注」输入与六个「待准备/已准备」下拉；填入评审要求「需核对依赖顺序、验收标准与回滚方式后再批准」、把「需求」置为已准备并写备注，点「保存草稿」，`state.json` 变为 `revision 2`、`planning.reviewRequirements` 与 `planning.sections.requirements = {status:"ready", note:"第55轮表单验证：需求来源已核对"}` 与输入完全一致，界面就绪度变为 `1 / 6 已准备项目`、「需求 · 已准备」。
- **清理**：验证后删除该变更目录（`c3518275-fb7c-4ae1-8a33-c7362655c0f7`），现有四个夹具保持不变。

## 只读审查修复（2026-11-20 第 58 轮，客户端部分）

两份只读审查（core-audit / client-audit）各给出缺陷清单，客户端五项已修复，均以纯函数 + 源码断言覆盖，共新增 30 例：

1. **后台轮询覆盖未提交输入（P1）**：轮询在第二次 await 后只检查 `available()`（不含 dirty），用户正在编辑的标题或文档会被 5 秒轮询的响应静默覆盖并清掉保存按钮。现在用 `liveState` ref 在**每次 await 之后**重判，`shouldApplyPolledChange` 在有未提交输入、changeId 不符或 revision 未增大时一律返回 false；pendingPlans 分支同规则。
2. **`refreshRuns` 跨变更串台**：原实现 await 后只查 `mounted.current`，A 的验证记录会显示在 B 的质量门禁并影响 B 的交付门禁。现在先钉 `targetId`，再用 `acceptRunsFor` 校验响应归属（含每条记录的 changeId），过期响应直接丢弃。
3. **重新规划确认弹窗不复查锁**：入口按钮检查 running/verifying，确认按钮只看 `unsettled`，期间任务被推进会发出必被核心以 `PLAN_LOCKED` 拒绝的请求。现在 `replanBlocked` 共用，弹窗内按真实原因提示。
4. **证据矩阵计数自相矛盾**：无验收标准的行 outcome 渲染 `—`，却被计入「待补证据」。现在 `matrixTallies` 先剔除 `criterion` 为空的行，单列 `noCriteria` 徽章，四桶之和恒等于行数。
5. **依赖图静默丢边**：任务依赖填了不存在的 id 时，depth 归 0 使该节点被抬到第一列且没有连线，保存时才被核心以 `Missing dependency` 拒绝。现在提交前用 `missingDependencies` 拦下并列出缺失 id。

未真实验证：以上五项均只有静态/纯函数证据，尚未在运行页面上逐条复现修复前后的行为差异。

## 真实页面复核：恢复上下文截断提示（2026-11-20 第 59 轮）

截图与像素证据仍不可用（`browser_screenshot` 报窗口无响应），以下为 DOM 读数。

- 建了一个一次性变更（proposal 1470 字符，超过 1000 截断线），选中后点「恢复上下文」。
- 输出面板是一个只读 textarea，长度 2323，首行为：
  `以下文档在恢复上下文中被截断（每篇上限 1000 字符），完整内容请用读取文档或导出 Markdown： proposal`
  随后是完整 JSON，其中 `documents.proposal` 为 1000 字符、`documentsTruncated: ["proposal"]`、`documentLengths.proposal: 1470`。
- 未截断的变更（如夹具 `511370f8`）不出现该提示行，输出首字符即为 `{`。
- 验证后已删除该一次性变更目录与临时脚本，夹具集合仍为四个。

## 真实页面复核：版本冲突与放弃草稿（2026-11-20 第 59 轮）

此前「保存草稿的版本冲突提示与从界面放弃草稿」只有静态证据，本轮在真实页面走通：

1. 在开发规划里编辑「提案」文本，出现「保存草稿」与「有未保存编辑」标记。
2. 绕过界面把该夹具 `state.json` 从 revision 6 改到 7（模拟外部并发写）。
3. 点「保存草稿」→ 顶部出现 `REVISION_CONFLICT: State revision changed`，随后是「草稿已保留。若是版本冲突，可先复制草稿，再重新加载并合并修改。」与「复制草稿备份」按钮；方案区同时显示「有未保存编辑」及「方案有新修订。当前编辑已保留，可使用方案操作中的重新加载。」
4. 点「重新加载」→ 出现显式确认：「此操作会替换当前未保存的编辑。请先保存，或明确放弃草稿。」，按钮为「保留草稿」「放弃草稿并继续」。
5. 点「放弃草稿并继续」→ 冲突提示消失、未保存标记消失，界面显示磁盘上的 revision 7 内容（外部写入的目标文案）。

验证后已把夹具目标文案复原（revision 8），四个夹具仍在。

## 英文文案与浅色主题（2026-11-20 第 59 轮，仅静态）

- **英文文案**：不切换应用语言（会改用户设置），改用 tests/client-locale-coverage.test.js 三条断言：每个键两个非空字符串、所有字面量 t("key") 都有定义、变量传入的枚举（状态/模式/分区/页签/图源）都有定义。结论是英文不会回落成键名，但英文排版未做视觉验收。
- **浅色主题**：仍未验证。browser_screenshot 持续报窗口无响应；主题由 DSH 的 --dsw-* token 提供，客户端没有硬编码色值（沿用第 45 轮检查结论），但浅色下的对比度与图表配色没有实测证据。

## 真实页面复核：轮询不覆盖未提交编辑（2026-11-20 第 59 轮）

这是第 58 轮修的 P1 缺陷（5 秒轮询会覆盖正在编辑的文档并清掉保存按钮），此前只有静态证据。真实页面复现步骤：

1. 选中夹具并进入编辑规划，在「提案」里追加文字 → 出现「有未保存编辑」。
2. 绕过界面把 `state.json` 从 revision 8 改到 9（模拟另一个窗口保存）。
3. 等待 8 秒（超过一轮轮询），读取文本域：编辑内容仍在（长度 36，含测试标记），未保存标记仍在，同时出现「方案有新修订。当前编辑已保留，可使用方案操作中的重新加载。」

结论：轮询不再吞掉输入，改动以提示方式暴露。随后用「重新加载 → 放弃草稿并继续」回到磁盘内容，夹具目标文案已复原（revision 10）。

## 真实页面复核：证据矩阵计数徽章（2026-11-20 第 59 轮）

同一夹具的质量门禁顶部读数为「通过 0 / 失败 0 / 待验证 4 / 尚未配置验收标准 1」，四桶之和 5 等于任务数；`REVIEW` 行（无验收标准）结果列为 `—`，不再同时计入「待验证」。修复前该行会同时报「尚未配置验收标准」和「待验证」，使计数大于行数。

## 主题变量而非硬编码色（2026-11-20 第 59 轮）

真实浅色主题仍未切换（会改用户设置），改为两层证据：

1. **静态**：`tests/client-theme-tokens.test.js` 从 client.js 抽出工作台样式块（约 4.5 KB），断言其中没有任何十六进制、`rgb()/rgba()` 或 CSS 具名颜色，并要求至少使用 `--dsw-alias-bg-base`、`bg-layer-1`、`label-primary`、`border-l1`、`brand-primary` 五个 token。
2. **运行页面（模拟）**：在真实 `.ep-card` 上临时覆盖 `--dsw-alias-bg-layer-1` 为 `#f7f8fa`，`getComputedStyle` 的 `backgroundColor` 从 `rgb(35,35,36)` 变为 `rgb(247,248,250)`，移除覆盖后恢复原值——说明颜色确实来自 token 而不是写死值。

限制：这是 DOM 级模拟，不是应用浅色主题后的真实渲染；对比度、Mermaid 预览在浅色下的配色仍未验证。
## 命名对齐（第 59 轮）

工作台内标题与会话视图标签一直是「工程研发」，但 README 标题、README 使用步骤的两处入口名和插件元数据 `meta.title` 仍是「工程规划」。已统一为「工程研发工作台」/「Engineering workbench」，使文档、插件卡片与界面标签一致。

插件卡片标题来自元数据 `locale/*.json`，需要重新加载 bundle 才会在插件管理页更新；工作台内部标签已随 client.js 实时生效。

## 真实英文界面与浅色主题（2026-11-20 第 61 轮）

此前「英文排版」与「浅色主题」两项一直没有实测证据，只有静态断言与 DOM 模拟。本轮把 DSH 语言切成 English、外观切成 Light，在主窗口（`dsh-app://app/`）逐项读回真实 DOM，测完再恢复中文 + 深色。

### 英文界面

视图菜单（`More conversation views` 的 `pointerdown` 后取 `button[role=menuitem]`）为 `Fleet` / `Engineering` / `Browse other plugins` / `Create your plugin`。工作台读数为：`Engineering workbench`、四页签 `Development planning` / `Architecture design` / `Task board` / `Quality gates`、`Describe a request`、`New change`、`Plan actions`、`Planning readiness`、`0 / 6 Ready sections`，六项就绪为 `Requirements` / `Code analysis` / `Architecture` / `Interfaces & database` / `Task board` / `Acceptance` 且均为 `Pending`；另有 `5 Tasks`、`0 Evidence entries`、`Standard Planning mode`、`Recovery context`、`Export Markdown`、`Copy “Ask agent to refine plan” prompt`、`Planning request` / `Insert into chat` / `Copy`。质量门禁侧读到 `No current-version evidence`、`No acceptance criteria configured`、`User delivery review`、`Technical tasks not finalized`、`Current delivery awaits user acceptance`、`Archived versions and restarted tasks (read only)`、`Dispatch unknown human resolution history`、`Verification runs`。没有任何键名回退（不存在形如 `deliveryPending` 的裸键）。

页签点击后需要等一次重渲染再读，同步读取会拿到上一页内容；本轮读取统一加 `setTimeout(…, 800)`。

### 浅色主题与对比度缺陷

切到 `Light` 后 `document.body` 与 `.ep-card` 背景均为 `rgb(255,255,255)`，正文 `rgb(15,17,21)`、`.ep-muted` `rgb(97,102,107)`。此时暴露出真实缺陷：

| 类名 | 修复前文字色 | 白底对比度 | 结论 |
|---|---|---|---|
| `.ep-warn` | `#f59e0b` | 约 2.1:1 | 不合格 |
| `.ep-success` | `#22c55e` | 约 2.2:1 | 不合格 |
| `.ep-error` | `#ec1313` | 约 4.6:1 | 勉强合格 |

深色主题下这些亮色作文字本是可读的，所以前几轮只做深色复核时没有暴露。

DSH 主题只有 `--dsw-alias-state-{error,success,warn,idle}-primary` 一组单值 token（`cordis_inspect_query` 的 client/Theme 只有 14 个 token），没有「前景文本专用」变体。因此改为：状态色只用于边框与 `color-mix(in srgb, var(--token) 10%, transparent)` 底色，文字统一用 `--dsw-alias-label-primary`。可读性由彩色边框与淡底色维持，不再牺牲对比度。

复测值（Light）：`.ep-warn` 文字 `rgb(15,17,21)`、底 `color(srgb 0.960784 0.619608 0.0431373 / 0.1)`、边框 `rgb(245,158,11)`；`.ep-success` 文字 `rgb(15,17,21)`、边框 `rgb(34,197,94)`。更强的一条断言：遍历 `.ep-layout` 下所有元素，**没有任何元素的 `color` 等于四个状态 token 的解析值**（计数 0）。

恢复中文 + 深色后复测：`.ep-card` 背景 `rgb(35,35,36)`、正文 `rgb(249,250,251)`，`.ep-warn` 文字 `rgb(249,250,251)`、边框 `rgb(245,158,11)`、底色为同款 10% amber，四页签恢复为「开发规划 / 架构设计 / 任务看板 / 质量门禁」。

### 仍未验收

- 像素级截图：`browser_screenshot` 仍报 `the DSH window did not answer in time`，以上全部结论来自计算样式与 DOM 文本。
- 英文界面下的长文案换行、窄窗口布局未逐项检查。
- 真实人工批准与交付确认仍需用户本人操作。

## 真实页面复核：残留预留运行的人工放弃出口（2026-11-20 第 62 轮）

此前「reserved 且无 jobId 的运行可以由人工放弃」只有单元测试与静态审查证据，本轮构造真实预留记录并在真实主窗口核对界面。

构造方式：用临时变更（验证后已删除）写入一个任务，再直接调用 `DispatchRunStore.reserve()`（真实 store API，不经模型工具、不产生审批）得到 `state: reserved`、`jobId: —` 的运行记录。

读到的界面（任务看板 → 执行记录 → 重新加载）：

- 运行卡片列出 `runId`、`taskId`、`planVersion`、`state reserved`、`childId`、`jobId —`、时间、`truncated false`，与磁盘记录一致。
- 折叠区标题为「放弃残留预留」，说明文案为「只记录人工放弃：运行记为 cancelled 并追加历史；不改变任务状态、证据、审批与交付确认。」
- 表单字段：「放弃理由（必填）」多行输入；确认项「我确认该预留从未启动（无 jobId），放弃为终态且不可恢复。」；提交按钮初始为禁用。
- 交互验证：仅填写理由时按钮仍禁用；再勾选确认项后按钮变为可用。两项都是必要条件，缺一不可。
- 提交按钮没有被点击：这是人工专属动作，本代理只验证可发现性与门禁，执行后产生的 cancelled 记录与历史条目仍未在真实页面核对，记录为空缺项。
- 验证结束后已清空表单输入并删除该临时变更目录，工作区恢复到原有四个夹具。

未覆盖项：`starting`/`running` 的运行只显示「需执行终止证据，本版未提供」，本轮未构造该状态（需要真实派发才可能进入，且按设计不提供放弃）。

操作提示：用 grep 检索 `client.js` 会命中内嵌的 Mermaid 产物（单行约 3.9 MB），必须用按行读取或极窄的锚定模式，否则一次检索就会占满上下文。

## 真实页面复核：批准门禁与 unknown 结案表单（2026-11-20 第 63 轮）

两项此前只有客户端单元测试/静态断言的行为，本轮在真实主窗口做了界面级核对。全部夹具在验证后删除，工作区恢复原有四个变更。

### 1. 「转为执行中」需要当前版本批准

任务看板的状态流转表单会把提交按钮的可用性绑定到「目标状态是否为 `running` 且当前方案未获人工批准」：

- 草稿变更（v2，方案版本 1，无审批）：选中任务后状态选项为「执行中 / 已阻塞 / 已取消」，保持默认「执行中」时按钮禁用；改成「已取消」才可用。
- 已批准变更（v1，方案版本 1，存在 `actor.kind = user` 的审批）：同一表单选「执行中」按钮可用，状态选项为「待执行 / 执行中 / 已取消」（按该任务当前的失败状态推导）。
- 表单下方提示随方案状态切换：「任务状态流转不要求批准；原生派发与命令验证需要先人工批准当前方案。」与「当前方案已批准。任务状态按下方状态图推进……」

结论：批准门禁只拦「进入执行中」，不拦阻塞/取消/待执行，与设计一致；两种方案的按钮禁用差异证明门禁确实由审批状态驱动，而不是常量。

### 2. unknown 派发运行的人工结案表单

用临时变更加 `DispatchRunStore` 直接构造 `reserved → starting → unknown` 记录（带 `jobId`，验证后删除），在「执行记录」中读到：

- 运行卡片显示 `state unknown`、`jobId`、`createdAt / finishedAt`、`truncated false`、`error` 等字段。
- 结案表单字段依次为：「人工结案原因（必填）」「停止核查依据（必填）」「核查资料（每行一项）」与确认项「我已明确核查子 Agent、所有后代及相关进程均已停止。」，提交按钮标签「人工核查结案」，初始禁用。
- 门禁实测：只填「原因」→ 仍禁用；再填「依据」→ 仍禁用；勾选确认项 → 才可用。三项同时满足才放行。
- 未点击提交（人工专属动作），随后清空三个输入并取消勾选；提交后产生的 `dispatch-unknown-resolved` 历史仍未在真实页面核对。

### 3. 构造夹具时的路径陷阱

`new DispatchRunStore(...)` 的构造参数是**工作区根**，store 内部自行拼接 `.dsh/engineering/changes/<changeId>/dispatches`。若把 change 目录传进去，记录会落到 `<change>/.dsh/engineering/changes/<changeId>/dispatches` 这种嵌套路径，界面查不到、也不会报错。第 62 轮记录里的同类描述同样以此为准。

## 真实页面复核：损坏变更的列表容错与警告展示（2026-11-20 第 64 轮）

`list` 的逐条隔离与界面警告此前只有核心单元测试，没有在真实页面验证「一个坏目录不会拖垮整个工作台」。本轮用一个损坏 JSON 目录（`ffffffff-…`）和一个 `state.id` 与目录名不一致的目录（`eeeeeeee-…`）做真机核对，夹具随后删除。

- 点「刷新列表」后，侧栏出现 `.ep-warn` 状态块：「部分变更读取失败」+ 两条明细 `eeeeeeee-1111-4222-8333-444444444444: State identifier mismatch`、`ffffffff-1111-4222-8333-444444444444: State JSON is corrupt`。
- 四个正常变更仍全部列出、可点击；选中「UI回归夹具：标准规划与任务依赖」后详情、页签、任务看板正常渲染（`已完成 0 / 5`），说明损坏条目没有阻断读取路径。
- 警告块在整个会话期间保留（切到另一个变更后仍显示），只在重新拉取列表时刷新。
- 删除两个坏目录后再「刷新列表」：警告块消失，列表仍为四个变更。

未覆盖：超过 2 MiB 的 `state.json`、符号链接目录、以及 `get` 直接读取损坏 id 时的错误文案（这些仍只有单元测试证据）。

## 真实页面复核：任务执行元数据字段（2026-11-20 第 65 轮）

- 任务卡片：默认任务显示「执行方式: 本地」；填过元数据的任务显示「影响模块: core, client · 执行方式: 子代理 · 需人工审批 · 重试次数: 2」，位置在标题与依赖段之间。
- 任务编辑表单新增四项：影响模块（逗号分隔文本）、执行方式（`local/subagent/external` 下拉）、需要人工审批（复选框）、最大重试次数（number，min 0 / max 10 / step 1）。中英文文案齐备。
- 往返证据：界面填 `core, client,core` + 子代理 + 勾选审批 + 重试 2 →「应用到草稿」后卡片立即显示去重结果 →「保存草稿」成功后 revision 10→11，磁盘与 `tasks.json` 均为 `["core","client"]`/`subagent`/`true`/2。
- 表单内即时校验（第 66 轮补）：201 字符模块名 → 「应用到草稿」禁用 + 「影响模块名不能超过 200 字符，也不能包含空字符。」；模块改回 `core, client`、重试填 99 → 仍禁用 + 「最大重试次数必须是 0 到 10 的整数。」；重试改 3 → 按钮可用、提示消失。点「取消」后无未保存标记。
- 仍未覆盖：真实浅色主题下新元信息行的间距只有结构断言，没有像素截图；空字符串重试值按默认 0 处理，界面不额外提示。

## 真实页面复核：交付门禁改由核心判定（2026-11-20 第 68 轮）

**修掉的缺陷**：质量门禁的「用户交付评审」卡片原本在浏览器里自行推断是否可交付，只用 `verificationRuns` 判断运行是否占用，**不看 dispatch 运行、也不看逐项证据**——因此可能显示「可提交」而在提交时被核心以 `DISPATCH_RUN_BLOCKED` 或 `EVIDENCE_REQUIRED` 拒绝。现在改为读取 `engineering_plan {action:"gateStatus"}` 的权威结果。

- 重新加载运行记录时会一并查询门禁（`if (typeof refreshGate === "function") await refreshGate(targetId)`，`typeof` 守卫用于兼容只求值 `refreshRuns` 的窄测试）。
- 结果只在 `changeId + planVersion + revision` 完全一致时算「当前版本」；不一致时显示「下面显示的是旧版本的门禁结果」而不静默采用。
- 当前版本判定为未就绪时，「确认当前版本交付」按钮保持禁用（`freshGateBlocked`），但提示照常给出原因，便于补齐。

**真实读数（主窗口 `dsh-app://app/`）**

- v1 变更 `3c83caa4`（已批准、任务失败）：「核心判定：尚未就绪，原因如下。 任务尚未收尾 · READONLY-SMOKE · failed 没有已完成任务」。
- v2 变更 `9dd058d6`（草稿待批）：「… 当前方案未获人工批准 任务尚未收尾 · READONLY-SMOKE · pending 没有已完成任务」。
- 两处与 `gateStatus` 的原生工具返回逐条一致（blockers 的 code 与明细相同）。

**仍未覆盖**：`ACTIVE_RUN`、`UNRESOLVED_UNKNOWN`、`MISSING_EVIDENCE` 三种 blocker 的真实界面读数只有单元测试覆盖；浅色主题下新卡片无像素证据。

## 真实页面复核：三类 blocker 与门禁过期提示（2026-11-20 第 69 轮）

**做法**：临时变更 `68033695-8107-4696-9d95-ad4a03f56deb`（lite，单任务 `GATE-PROBE`），用 `DispatchRunStore` 依次造 `reserved` → `starting(jobId)` → `unknown`，再写一份「任务 completed 但最新证据是 failed」的状态用于第三类 blocker。全部为合成夹具，验证后已删除，四个既有夹具未改。

**读数（主窗口 `dsh-app://app/` → 质量门禁 → 用户交付评审 → 重新加载）**

| 阶段 | 核心判定文本 | 交付按钮 |
|---|---|---|
| 运行 reserved | 当前方案未获人工批准；**存在活动运行 · GATE-PROBE · dispatch · b19dbb17-9ac0-44ab-a7ef-a5f13e6b1785 · reserved**；任务尚未收尾 · GATE-PROBE · pending；没有已完成任务 | 禁用 |
| 运行 unknown | 当前方案未获人工批准；**存在未结案 unknown 运行 · b19dbb17… · unknown**；任务尚未收尾 · pending；没有已完成任务 | 禁用 |
| 任务 completed + 最新证据 failed | 当前方案未获人工批准；存在未结案 unknown 运行…；**缺少当前版本证据 · GATE-PROBE · 探针标准** | 禁用 |

三类 blocker（`ACTIVE_RUN`、`UNRESOLVED_UNKNOWN`、`MISSING_EVIDENCE`）的界面渲染至此全部有真实读数，明细里的 taskId / kind / runId / state / criterion 与原生工具返回一致。

**顺带修掉的提示缺陷**：外部改了 state 之后，`gateStale` 原文只说「请刷新运行记录后再判断」——但交付卡片上的「重新加载」只刷新运行记录，不会重新读取变更，照做永远无法摆脱过期状态。现改为「请先在「方案操作」里重新加载变更，再刷新运行记录后判断」，并加了断言。

**顺带补的开发门禁**：本轮一次脚本改写把 `client.js` 整体转成 CRLF，导致 7 项按换行锚定源码的测试失败、diff 显示全文件重写。恢复 LF 后新增 `tests/line-endings.test.js`（2 项），扫描入口、`src/`、`scripts/`、`tests/` 下全部 JS/MJS 文件。

**仍未覆盖**：浅色主题下这三张卡片的间距无像素证据；`MISSING_EVIDENCE` 的界面读数来自合成状态（正常链路里 completed 任务必然带通过证据）。

## 真实页面复核：超限与链接目录的列表容错（2026-11-20 第 70 轮）

**做法**：在 `.dsh/engineering/changes` 下临时放两个非法条目——`11111111-…` 的 `state.json` 为 2,097,244 字节（超过 2 MiB 上限），`66666666-…` 为指向夹具 `85b71c73` 的 junction。刷新列表后读侧栏警告，随后删除（junction 用 `fs.unlinkSync` 只删链接，夹具文件完好）。

**读数**

| 条目 | 侧栏警告 |
|---|---|
| 超限 state | `11111111-2222-4333-8444-555555555555: State exceeds size limit` |
| 链接目录 | `66666666-7777-4888-8999-aaaaaaaaaaaa: Linked change directory` |

两条并列在「部分变更读取失败」下，四个正常变更仍完整列出（`已完成 0 / 5` 中的 4 个条目 + 已批准 v1 的执行中条目），点击照常打开；删除后刷新列表，警告块消失。

**仍未覆盖**：`get` 直接读取损坏/超限 id 时的界面文案（界面上无法从列表进入这类条目，只能通过 `/engineering` 命令或工具触发，本轮未在界面复现）。

## 真实页面复核：损坏变更的 get 路径与错误提示（2026-11-20 第 71 轮）

**做法**：选中夹具 `85b71c73` 后把它的 `state.json` 写成非法 JSON，点「方案操作 → 重新加载」触发 `get`；随后恢复原文件（备份文件已删除）。

**读数**

- 侧栏：「部分变更读取失败 / `85b71c73-9741-45fa-b6aa-f97ee79e2318: State JSON is corrupt`」，其余变更照常列出。
- 主区错误卡：`CORRUPT_STATE: State JSON is corrupt` + 「复制草稿备份」。

**顺带修掉的误导**：错误卡原先只要存在草稿就追加「草稿已保留。若是版本冲突，可先复制草稿，再重新加载并合并修改。」——对损坏、权限、路径类错误是错误指引。现改为仅当错误码是 `REVISION_CONFLICT` 时显示（`revisionConflict(error)`），并新增 `tests/client-error-hint.test.js`（3 项）。修复后同样的损坏场景只剩错误本身与草稿备份按钮，提示消失。

**仍未覆盖**：像素级排版；`NOT_FOUND`（选中后整目录被删）的界面文案本轮未构造。

## 真实页面复核：选中后被删除的 NOT_FOUND 路径（2026-11-20 第 72 轮）

**做法**：先选中夹具 `85b71c73`，把整个变更目录临时移到 `.dsh/engineering/.hold-85b71c73`（不删除），点「方案操作 → 重新加载」触发 `get`，然后移回原位并刷新列表。

**读数**

- `方案操作 → 重新加载`：错误卡 `NOT_FOUND: Change not found` + 「复制草稿备份」，不再附加任何版本冲突提示（第 71 轮修好的守卫在此同样生效）。
- 移回后「刷新列表」：四个变更全部回来，点开发规划照常加载（无残留错误）。

**说明**：这是「选中后目录消失」的路径，与列表容错（`list` 那条）不同——`list` 只对当前存在的条目降级为警告，`get` 直接报错，界面不做自动重选。

## 开发门禁：文档测试数一致性（2026-11-20 第 73 轮）

测试数量在这些文档里漂过一次又一次（197 → 242 → 513 → 534 → 537 → 540），每次都要手工同步。现在由 `npm run check:counts` 兜底：跑一次 TAP 套件取 `1..N`，与 README 的「当前完整套件为 N 项」和 `docs/VERIFICATION.md` 里最大的「全套件 N 项」比对，不一致就非零退出并打印两侧数值。

实现上把解析与比对做成纯函数（`readmeClaim` / `verificationClaim` / `compareClaims`）便于测试；缺声明、actual 不可用都算失败，不静默通过。

## 真实页面抽验：批准门禁与交付评审的「未加载」文案（2026-11-20 第 74 轮）

夹具 `511370f8`（草稿、5 任务，其中 `REVIEW` 无验收标准），主窗口 `dsh-app://app/`，1707×912：

| 位置 | 读数 |
|---|---|
| 方案操作 → 评审方案 | 「批准前每个任务至少需要一条验收标准。」；「批准当前方案」`disabled=true` |
| 质量门禁 → 用户交付评审（初次进入） | 「运行记录尚未加载：先刷新运行记录，再确认交付。」+「先刷新运行记录」按钮 |
| 同上（点「先刷新运行记录」后） | 核心判定列表：当前方案未获人工批准 / 任务尚未收尾 · ANALYZE、API、UI、JOIN、REVIEW · pending / 没有已完成任务 |

两条修复的行为差异明显：批准按钮不再等到提交才被核心以英文错误拒绝；「未加载」不再渲染成「有阻塞运行」。自动刷新在该次导航里没有生效（交互占用 `lock.current`，退避 3 次后放弃），手动入口文案如实说明，没有虚报状态。

**仍未验证**：手工「终止当前运行」没有提交过（会真的 kill 一个已批准运行，需人工发起）；`ENGINEERING_RUN_FOREIGN_HOST` 的双实例场景未构造；浅色主题下这些卡片的间距无像素证据；`browser_screenshot` 仍报 `the DSH window did not answer in time`。

## 第 75 轮：拒绝码本地化（未取得界面读数）

尝试在真实页面制造核心拒绝，三次都被界面自身守卫先拦住：

- 外部改 revision → 点「保存草稿」：先出现「方案有新修订。当前编辑已保留，可使用方案操作中的重新加载。」，保存未发出。
- 隐藏选中变更 → 点「重新加载」：确认弹层拦截，未发出 `get`。
- 外部改 revision → 点「重新规划」→「确认重新规划」：状态未变（revision 4 / planVersion 1），未产生错误横幅。

结论：守卫按设计生效，但「核心拒绝 → 中文句子」这一跳没有界面证据，目前仅由 `tests/client-error-messages.test.js`（8 项）与源码断言支撑。要取得读数需要一条不经过任何提交前守卫的拒绝路径，本版没有这样的入口——这本身是好事，但意味着该项验收仍不完整。

## 第 76 轮：标签页语义、禁用原因与派发前置检查（真实读数）

- `nav.ep-tabs` 为 `role=tablist`；四个按钮 `role=tab`、`aria-selected` `true/false/false/false`、`tabIndex` `0/-1/-1/-1`；`#ep-tabpanel` 带 `role=tabpanel` 与 `aria-labelledby=ep-tab-overview`。
- 在首个标签派发 `ArrowRight`：选中与焦点一起移到「架构设计」，面板 `aria-labelledby` 更新为 `ep-tab-plan`。
- 「批准当前方案」：`disabled=true`、`aria-disabled="true"`、`title="批准前每个任务至少需要一条验收标准。"`。
- 渲染仍为四张卡片，`div` 包装没有改变布局（样式无直接子元素选择器）。
- 未覆盖：屏幕阅读器实读（只有属性读数）、键盘 Tab 顺序在真实系统的完整走查、`dispatchVerificationRunning` 的界面文案（没有可用的同任务在飞验证运行夹具，未实际制造该状态）。

## 第 78 轮补记：`dispatchVerificationLoading` 没有界面读数

该分支要求「派发记录已加载、验证记录加载失败」，客户端没有构造这种半加载状态的入口，因此只有单元测试与源码断言。真实触发条件记录下来备查：验证列表请求失败后 `verificationRuns` 停在 `null`，或刷新过程中 `loading/stale`，此时派发按钮应显示「验证记录尚未加载，先刷新运行记录」而不是给出可点击的请求。

## 第 79 轮：两处"读数"其实是测量与门禁顺序问题

**1. `dispatchVerificationRunning` 的真机读数仍然拿不到，原因已确认在门禁顺序。**
做法：用 `VerificationRunStore(root).reserve(...)` 给夹具 `511370f8` 的 `ANALYZE` 造一条 `reserved` 验证运行（runId `ba5d766d-789a-4eac-b192-30fdf3ca1772`），重载后看该任务的派发按钮。结果按钮确实禁用，但界面给的原因是「运行前需批准当前方案。修改规划内容会使原审批失效。」——因为 `dispatchRequestBlock` 先判审批、再判同任务验证运行，而该夹具是未批准草稿。合成运行随后已删除（`runs/` 归零），四个夹具完好。

结论：要在界面上读到 `dispatchVerificationRunning`，必须有一个**已获人工批准**的变更 + 该变更某任务上有未结案验证运行。这两者都不能由代理自己制造（批准是人工信任根），所以此文案只能由单元测试覆盖。

**2. 上一轮记录的「重新规划确认面板反复出现」是我的测量错误。**
确认面板 `replanConfirm && h("div", { className: "ep-card ep-warn" })` 是 `<details className="ep-action-menu">` 的**兄弟节点**，不在 details 内部；而我当时把读数范围限定在 details 元素上（`details.innerText`），自然永远读不到面板，看上去就像"点了没反应、面板又回来了"。正确读法是在整块工作台文本里找「确认重新规划」。本轮已在主窗口恢复后复测：点「重新规划」后整块工作台文本出现「重新规划会归档当前版本并重置任务状态、审批与证据。确认后再编辑新方案。」与「确认重新规划 / 取消」两个按钮，点「取消」后提示消失、方案版本不变。**确认面板功能正常**，此前只是读数范围错了。

**3. 本轮结束时主窗口不再响应 IPC。**
`browser_eval` 连 `1+1` 都返回 `the DSH window did not answer in time`，`browser_tabs` / `browser_snapshot` 同样失败；同时 `http://127.0.0.1:56356/` 仍返回 401（服务在跑、需要鉴权），`60069` 返回 000（会话早先记录的端口早已不监听）。这与之前 `browser_screenshot` 持续超时属同一类现象：webview 的 IPC 通道没有响应。没有重启用户的应用，本轮此后不再有界面读数。

## 第 80 轮：Git 卡片现在有真实数据可看

本轮没有改界面代码，但架构视图的「Git 观测记录与请求」卡片终于有真实的成功记录（此前只有一条 `output_truncated` 的失败记录）：

- capture 与两次 compare 都以 `status ok` 落到 `.dsh/engineering/changes/511370f8-…/git-observations/`。
- 记录里 `head = ddd4bdc`、`dirty = true`、`untrackedCount = 93`、`worktreeDiffSha256` 为实际摘要；一次 compare 的 `observedEqual true`，另一次（给已跟踪文件追加一行后）`worktreeChanged true`。
- 未在界面上重新点开该卡片复核（本轮以工具返回为准），像素截图仍不可得。

## 第 81 轮：声明范围审计（仅工具，尚无界面）

- `scopeAudit` 目前只通过 `engineering_plan` 暴露，工作台没有对应卡片，因此本轮**没有界面读数**。要在 Git 卡片里展示「未声明路径」，需要下一轮补 UI 并重新采一次真机数据。
- 有界面读数的部分只到「观测里出现了路径清单」这一层：`engineering_git capture` 的返回里能看到 `changedPaths`（17 条）与 `untrackedPaths`（95 条）。

## 第 82 轮：改动范围审计卡片（真实读数）

- 卡片位置：质量门禁，紧随用户交付评审。
- 初始文案：「改动范围审计 / 把最近一次 Git 观测保留的路径与任务声明的 expectedFiles 对照；只报告，不拦截，也不读文件内容。/ 尚未审计。点击按钮后读取最近一次观测。」
- 点击「审计改动范围」后（夹具 511370f8）：「与当前版本一致 · 已声明 0 / 共 112 条路径 · 未声明路径 CHANGELOG.md、README.md、client.js、docs/DESIGN.md … 另有 100 条未显示 · 已声明但未出现：没有悬空声明。」
- 未覆盖：`scopeStale`、`scopeNoObservation`、`scopeIncomplete` 三种状态没有真实读数（需要外部改 revision、清空观测或写入不含路径的旧观测，本轮只做了单元与源码断言）；列表截断阈值为 12，只在大列表下看到余量提示。

## 第 83 轮：范围审计三态读数

- stale（夹具 511370f8，revision 12 审计 → 外部推到 13 → 刷新列表）：卡片读「这份结果属于另一个版本，请重新审计。」
- no_observation（夹具 `85b71c73`，无任何观测）：读「还没有 Git 观测。先在架构设计里采集一次。」
- observation_incomplete（合成 partial 观测，探针变更，验证后删除）：读「最近一次观测没有保留路径清单（旧记录或采集失败），无法审计。」
- 顺带修掉徽章缺陷：前两种状态此前仍显示「与当前版本一致」，现仅在 `state === "compared"` 时显示。
- 未覆盖：`scopeStale` 的「重新审计」点击后回到 fresh 的完整复位路径只做了一次（在同一会话内点击后仍显示 incomplete，因为该探针观测本身不含路径——属预期）。

## 第 87 轮：门禁里的范围摘要（真实读数）

- 位置：质量门禁 → 用户交付评审 → 核心判定列表下方。
- 有观测时（夹具 511370f8）：「改动范围：已声明 0 / 共 112 条路径（观测 65b1b407-b983-4cf4-a848-ecc547968828）」——112 = 17 条改动路径 + 95 条未跟踪路径，与单独执行 `scopeAudit` 的数字一致。
- 无观测时（同一卡片在未采集观测的变更上）：「改动范围：尚无可用观测（不影响交付判定）。」
- 未覆盖：`scope` 摘要不影响 blocker 这一点只有测试与源码断言；未构造「只差范围未声明」的已批准变更（需要用户批准）。

## 第 89 轮：任务看板的「当前可开始」（真实读数）

- 位置：任务看板顶部摘要，紧随「已完成 / 阻塞任务」。
- 读数（夹具 511370f8，未批准）：`已完成 0 / 5 阻塞任务 0 当前可开始 0`。
- 刷新方式：与运行记录共用「重新加载」；导航切换变更时清空，不会把上一份计划的前沿留在新计划上。
- 未覆盖：有可开始任务时的读数（需要已批准计划）。
- 刷新方式（第 90 轮修正）：当时记录的「需手点一次重新加载」是背景刷新被人工动作锁挡住所致，第 90 轮已修（后台只读刷新不再排队等锁），现在切换变更后会自动出现。

## 第 91 轮：可开始计数与派发入口（真实读数）

- 任务看板（夹具 3c83caa4，已批准，READONLY-SMOKE 回到 pending）：`已完成 0 / 1 阻塞任务 0 当前可开始 1 下一项依赖已满足的任务 · 只读派发与固定输出验证`，无需手动刷新。
- 任务卡的「填入派发请求 / 复制派发请求」：修复后 `disabled: false`（修复前恒为 `true`，提示「验证记录尚未加载，先刷新运行记录」）。
- 未覆盖：点击「填入派发请求」后草稿内容与 requestId 的真实呈现；`dispatchVerificationRunning` 的界面文案（需要同任务真有在飞验证，需人工发起）。

## 第 92 轮：派发请求草稿（真实内容）

- 位置：任务卡 → 填入派发请求。点击后视图切到会话，草稿进入输入框。
- 实测草稿含 `changeId`、`taskId`、`expectedRevision: 8`、`planVersion: 1`、`requestId`，并附一句「保留 requestId 重放此尝试；returned 不等于任务完成或验收通过」。
- 连续点击不叠加文本（提示词只出现一次）。
- 未覆盖/已知差异：离开工作台再回来重新填入，`requestId` 会重新生成（缓存随组件卸载丢失）；若期望「同一任务稳定复用同一个 id」，需要把缓存提升到会话级，本轮未做。

## 第 93 轮：派发 requestId 不再随视图重挂载漂移

- 实测：填入 → 清空 → 离开 → 重进 → 再填入，两次 `requestId` 都是 `a74c4d50-b7c0-45bc-8bb9-11d131cc86f8`（第 92 轮同一操作会变）。
- 仍不保证「换版本后复用」：`planVersion`/`revision` 变化会生成新 id，这是有意的——旧 id 属于旧版本的那次尝试。

## 第 94 轮：终止当前运行（表单 / 双门禁 / 跨宿主拒绝）

| 检查项 | 真实读数 |
| --- | --- |
| 折叠区出现条件 | 运行 `starting`/`running` 且有 `jobId` → 出现「终止当前运行」 |
| 说明文案 | 「终止只调用原生 jobs.kill：运行由 runner 结算为 cancelled，不改变任务状态、证据、审批与交付确认。」 |
| 只填理由 | 提交按钮 `disabled: true` |
| 理由 + 勾选确认 | `disabled: false` |
| 跨宿主提交 | 「该运行由另一个宿主实例创建，本页面无法终止；请在创建它的宿主实例中操作。」 |

- 未覆盖：成功终止（需当前宿主真实持有该 job）；终止后的 `cancelled` 记录展示。

## 第 96 轮：导出卡片显示清单与旧文件

- 真实读数（夹具 511370f8，standard 模式）：卡片末尾显示「导出清单：…\manifest.json」，磁盘 manifest 为 `mode: standard`、`files` 14 项、`stale: []`。
- 未取得读数：`stale` 非空时的提示行「另有旧导出的文件未被本次导出更新：…」（需先导出含可选文档、再清空这些文档后重新导出的夹具）。

## 第 97 轮：`stale` 提示行的真实读数（并更正第 96 轮成因）

- 第 96 轮记录的成因「标准模式导出后改轻量模式」是错的：`mode` 创建后不可改。
- 真实成因：轻量模式下可选文档/图源「有内容才写」，先导出再清空某项，旧文件留在目录中。
- 真实读数（lite 夹具 `fc4a2347`）：「另有旧导出的文件未被本次导出更新： diagrams/sequence.mmd, findings.md」。

## 第 99 轮：同任务验证互斥的界面读数

- 条件：已批准夹具 `3c83caa4`（revision 8，任务 `READONLY-SMOKE` pending）+ 合成 `reserved` 验证运行。
- 读数：两个派发按钮 `disabled`，提示「该任务已有未结束的验证运行，先等它结束或由人工终止后再派发。」
- 说明：这是第 76 轮引入、长期只有单测支撑的分支首次取得界面证据。

## 第 101 轮：任务卡片上的「此刻还不能开始的原因」

- 位置：任务看板 → 任务卡片 → 任务详情 → 依赖行之后。
- 真机读数（夹具 `511370f8`，未批准）：`ANALYZE` 显示「当前方案未获人工批准」；`API` 显示「当前方案未获人工批准」「前置任务未完成 · ANALYZE」。
- 门：只有在 `readyTasks` 结果属于当前 revision 时显示，过期不渲染（不给旧理由）。
- 同一轮修正：派发提示里「重挂载视图会生成新请求」已过时（第 93 轮改为插件作用域缓存），现文案为「在本插件加载期内复用 requestId（重挂载视图不会换号）」。

## 第 102 轮：验证命令的最近一次运行

- 位置：任务看板 → 任务详情 → 「验证命令（每行一项）」。
- 真机读数（夹具 `3c83caa4`）：`printf ep-positive-smoke · 失败 · exit 1`（对应运行 `f9d8b388`）。
- 未运行过的命令显示「尚未运行」；运行记录未加载时不显示任何状态。
- 同轮修复：第一版 `h(null, ...)` 导致工作台白屏（Element type is invalid），已改 `React.Fragment` 并加门禁。

## 第 106 轮（复盘证据）：未取得界面读数

`client.js` 的证据表单本轮扩为「verifying / failed / blocked」三态，并在失败/阻塞任务上把 outcome 收窄为 `failed`、显示提示「该任务只能补记失败证据…」。

尝试在真实主窗口复核时，`browser_eval` 与 `browser_tabs` 连续返回 `the DSH window did not answer in time`（同一现象在第 79 轮出现过，数十秒后自行恢复）。因此本轮**没有**界面读数：提示文案、下拉只剩 `failed`、提交按钮禁用条件都只有源码断言与单元测试支撑。

工具侧读数已取得（见 `docs/VERIFICATION.md` 第 106 轮）：failed 任务接受失败证据、拒绝通过证据。

## 第 107 轮（守卫错误码）：未取得界面读数

本轮给 `index.js` 的 25 处守卫错误补上 `error.code`，并让命令通道不再输出 `ENGINEERING_ERROR: CODE` 这种双段文本；`client.js` 的 `ERROR_KEYS` 新增 10 个守卫码与 10 对双语文案。

理论上界面现在会把「工作目录与会话工作区不一致」这类守卫错误显示成中文句子，而不是原始码。但 `browser_eval` 仍返回 `the DSH window did not answer in time`，因此**没有界面读数**：新文案只有单测（`tests/guard-error-codes.test.js`）与源码断言支撑。

工具侧读数已取得（切到 `docs` 后三个工具都拒绝、未生成 `docs/.dsh`、切回后 `list` 恢复）。

## 第 108 轮（模式说明）：未取得界面读数

规划视图统计行下方新增一行按 `change.mode` 切换的说明：轻量模式只导出有内容的文档与图源、旧文件会进 `manifest.stale`；标准模式无条件写全部八篇与四张图源。

`browser_eval` 本轮继续返回 `the DSH window did not answer in time`，这一行文字没有真实渲染证据，只有 `tests/client-mode-hint.test.js` 的源码与文案断言。

## 第 111 轮（context 门禁摘要）：工具侧已验，界面未验

本轮改的是 `context` 的返回结构（新增 `gate` 块），工作台界面侧没有新增控件，因此不引入新的界面缺口。

**未取得界面读数**的原因已在 VERIFICATION 第 111 轮定性：HTTP 服务在线、无 CDP 通道、CPU 采样显示主进程 5 秒仅 +0.55s（无空转），属于主窗口控制通道的偶发不应答，不是插件渲染环。此前所有「界面未验」条目沿用同一结论。

## 2026-11-20：为什么界面读数在插件安装后需要一次页面重载

DSH 的插件客户端半边只在页面加载时注册。每次  安装或移除 bundle，都会 dispose 窗口里的客户端模块；页面不重载，工作台就还是旧代码、浏览器工具的主窗口桥接也不再轮询（详见修复仓库  的「桥接失联的诊断与快速失败」）。所以本文件里「已取得界面读数」的条目都对应某次重载之后的状态；第 106 轮之后写下的「未取得界面读数」条目，原因即此，而不是视图渲染失败。

### 第 139 轮：插件热启停后的空白页签

- 已核实：`conversation.view` 的 `engineering-planner` 占用在 bundle `false → true` 后变为 `active:false`，页面重载后恢复 `active:true`（`cordis_inspect_query` 前后对比）。
- 已核实：宿主侧 `enabled:true` / `fiberPhase:active`，故「页签可见但空白」不是插件未加载，而是页内客户端注册过期。
- 未核实：重载后由用户点开「质量门禁」的实际渲染；合成事件无法驱动会话列表导航，故不由代理替代。

### 第 140 轮：「质量门禁」空白页的真实原因

- 已核实：控制台报 `ReferenceError: Cannot access 'selectedTask' before initialization`（`resourcesView`），`slot entry crashed in 'conversation.view'`。第 139 轮「客户端注册失效」的推断只解释了重载前的空占位；重载后仍然是同一处的渲染崩溃，两者是不同成因，此处更正。
- 已修复：`client.js` 中 `selectedTask` 的声明已提到 `postMortem` 之前，页面已重载。
- 已核实：`npm run check` 新增 `check-declaration-order`，真实 `client.js` 通过；构造同类缺陷会被报出（`tests/declaration-order.test.js` 5 项）。
- 未核实：重载后由用户本人点开「质量门禁」的最终渲染（合成事件无法驱动会话列表导航）。

### 第 142 轮：质量门禁页签与交付确认（真实页面）

- 已核实：TDZ 修复后工作台在真实页面挂载（`.ep-layout`），「质量门禁」页签不再崩溃，`window.__epErr` 为空。
- 已核实：该页显示「技术任务已收尾」「当前版本已确认交付」「交付确认人 user: session-d428891f-…」「交付确认时间 2026-11-20T10:27:49.649Z」「备注 确认」，与磁盘 `state.revision 11 / status completed / deliveryAcceptance` 逐字段一致。
- 已核实：交付后 `gateStatus` 转为 `ready:false`（已交付），界面显示「尚未就绪，原因如下」，属预期语义而非缺陷。
- 未核实：浅色主题下该页的视觉对比度（本轮只读深色）。

### 第 143 轮：浅色主题下「质量门禁」页的对比度

方法：设置 → 通用设置 → 外观切「浅色」，进入工程研发 → 质量门禁（选中 `9dd058d6`），用 `getComputedStyle` 取前景/背景并按 WCAG 相对亮度公式计算对比度；再切回「深色」核对复原。

| 元素 | 文字色 | 背景 | 对比度 | AA（4.5:1） |
| --- | --- | --- | --- | --- |
| `.ep-card` 正文 | `rgb(15,17,21)` | `rgb(255,255,255)` | 18.9 | 通过 |
| `.ep-muted` 次要文字 | `rgb(97,102,107)` | `rgb(255,255,255)` | 5.8 | 通过 |
| `.ep-warn`（核心判定提示） | `rgb(15,17,21)` | 状态色 10% 叠白 | 18.9 | 通过 |
| `.ep-success` / `.ep-badge` | `rgb(15,17,21)` | 状态色 10% 叠白 | 18.9 | 通过 |
| 证据矩阵单元格 | `rgb(15,17,21)` | `rgb(255,255,255)` | 18.9 | 通过 |
| 插件页签（含选中「质量门禁」） | `rgb(15,17,21)` | `rgb(255,255,255)` | 18.9 | 通过 |

结论：第 61 轮把 `.ep-warn`/`.ep-success`/`.ep-error` 的文字色改为 `--dsw-alias-label-primary`、只用状态色做边框与 10% 底色，这一策略在浅色主题下成立——状态文字不再是 `rgb(245,158,11)`（约 2.1:1），而是 18.9:1。

**宿主侧观察（不属于本插件）**：DSH 壳层的当前视图页签「工程研发」在浅色下为品牌蓝 `rgb(65,118,230)` on 白，约 **4.23:1**，低于 AA 的 4.5:1。该颜色由宿主 token 决定，插件无法改；如需调整应报给 DSH 本体。

复原核对：切回深色后 `document.body` 为 `rgb(21,21,23)`、卡片 `rgb(35,35,36)`、正文 `rgb(249,250,251)`、`.ep-muted` `rgb(207,211,214)`，页面仍停留在质量门禁且正常渲染。

### 第 144 轮：跨宿主残留运行的人工终止表单

- 已核实（源码与单测）：`starting`/`running` 且带 `jobId` 的运行显示「确认终止（句柄不在本进程）」折叠区，含终止理由、核实依据、核查资料、确认项；四项不齐时提交按钮禁用。
- 已核实（Host 单测）：句柄仍在本进程时点击会被拒绝并返回 `ENGINEERING_RUN_STILL_ATTACHED`，运行记录不变。
- 未核实：真实页面上的表单渲染与提交（需要一条「已启动且句柄已丢失」的真实运行；构造它要伪造 job 句柄，属人工声明场景，本轮只做了单测与源码断言）。
